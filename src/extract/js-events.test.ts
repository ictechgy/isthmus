import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMessageBridgeDocument } from '../exchange/messages.ts';
import { createJsEventFactsDocument } from './js-events.ts';

function scan(text: string) {
  return parseMessageBridgeDocument(createJsEventFactsDocument([{ path: 'src/events.ts', text }], 'test',
    '2026-09-19T00:00:00.000Z', '/app'));
}

test('RN 구독은 ESM 별칭·직접 emitter·한 단계 문자열 상수 이름을 보존한다', () => {
  const document = scan(`import { DeviceEventEmitter as E, NativeEventEmitter as N } from 'react-native';
const instance = new N();
const event = 'ready';
E.addListener(event, () => {});
instance.addListener('done', () => {});
new N().addListener('inline', () => {});`);
  assert.equal(document.transport, 'react-native-event');
  assert.equal(document.target, 'react-native');
  assert.deepEqual(document.facts.map(({ channel, kind, dynamic }) => ({ channel, kind, dynamic })), [
    { channel: 'ready', kind: 'event-listen', dynamic: false },
    { channel: 'done', kind: 'event-listen', dynamic: false },
    { channel: 'inline', kind: 'event-listen', dynamic: false },
  ]);
  assert.equal(document.facts[0]?.location.line, 4);
});

test('동적·안전하지 않은 이벤트 이름은 조인할 정적 이름으로 내보내지 않는다', () => {
  const document = scan(`import { DeviceEventEmitter as E } from 'react-native';
E.addListener(eventName, listener);
E.addListener('', listener);
E.addListener('bad\\nname', listener);`);
  assert.equal(document.facts.length, 3);
  assert.ok(document.facts.every(({ dynamic }) => dynamic));
  assert.ok(document.limitations.some((message) => message.startsWith('dynamic-event-names: 3')));
});

test('RN과 같은 메서드 이름의 Expo·로컬·타입 전용 import는 전역 이벤트가 아니다', () => {
  for (const source of [
    `import { DeviceEventEmitter } from 'expo'; DeviceEventEmitter.addListener('wrong', cb);`,
    `import type { DeviceEventEmitter } from 'react-native'; DeviceEventEmitter.addListener('wrong', cb);`,
    `const DeviceEventEmitter = local(); DeviceEventEmitter.addListener('wrong', cb);`,
    `import { DeviceEventEmitter } from 'react-native'; const fake = "DeviceEventEmitter.addListener('wrong', cb)";`,
  ]) assert.deepEqual(scan(source).facts, []);
});

test('재대입·매개변수 가림·emitter 전달·멤버 대입은 안전한 파일 바인딩으로 취급하지 않는다', () => {
  for (const code of [
    `E = other; E.addListener('wrong', cb);`,
    `function work(E) { E.addListener('wrong', cb); }`,
    `const work = E => E.addListener('wrong', cb);`,
    `mutate(E); E.addListener('wrong', cb);`,
    `E.addListener = fake; E.addListener('wrong', cb);`,
  ]) assert.deepEqual(scan(`import { DeviceEventEmitter as E } from 'react-native'; ${code}`).facts, []);
  assert.deepEqual(scan(`import { NativeEventEmitter as N } from 'react-native';
const e = new N(); e = fake; e.addListener('wrong', cb);`).facts, []);
});

test('UTF-8 열과 따옴표 안의 가짜 구독을 구분한다', () => {
  const document = scan(`import { DeviceEventEmitter as E } from 'react-native';
const label = '한글'; E.addListener('ready', cb); // E.addListener('fake', cb)`);
  assert.equal(document.facts.length, 1);
  assert.equal(document.facts[0]?.location.column, Buffer.byteLength("const label = '한글'; E.") + 1);
});

test('객체의 동명 속성은 import된 이벤트 수신자가 아니다', () => {
  const document = scan(`import { DeviceEventEmitter as E } from 'react-native';
E.addListener('real', cb);
remote.E.addListener('false', cb);
remote?.E.addListener('alsoFalse', cb);`);
  assert.deepEqual(document.facts.map(({ channel }) => channel), ['real']);
});

test('변경되지 않은 CommonJS namespace와 var emitter의 구독을 관찰한다', () => {
  const document = scan(`var ReactNative = require('react-native');
var RNSound = ReactNative.NativeModules.RNSound;
var eventEmitter = new ReactNative.NativeEventEmitter(RNSound);
function Sound() { eventEmitter.addListener('onPlayChange', listener); }`);
  assert.deepEqual(document.facts.map(({ channel, dynamic }) => ({ channel, dynamic })),
    [{ channel: 'onPlayChange', dynamic: false }]);
  assert.equal(document.facts[0]?.location.line, 4);
});

test('직접 초기화된 파일 범위 let과 var emitter는 재대입이 없을 때만 관찰한다', () => {
  for (const keyword of ['let', 'var']) {
    const prefix = `import { NativeEventEmitter as N } from 'react-native';\n${keyword} e = new N();\n`;
    assert.deepEqual(scan(prefix + `e.addListener('ready', cb);`).facts.map(({ channel }) => channel), ['ready']);
    for (const mutation of ['e = other;', 'mutate(e);', 'e.addListener = fake;', 'function work(e) {}']) {
      assert.deepEqual(scan(prefix + mutation + `e.addListener('wrong', cb);`).facts, []);
    }
  }
});

test('namespace 가림과 constructor 변경·별칭 탈출은 RN emitter로 확정하지 않는다', () => {
  const prefix = `var RN = require('react-native');\n`;
  for (const change of [
    'RN = other;', 'mutate(RN);', 'RN.NativeEventEmitter = Fake;',
    'const Alias = RN.NativeEventEmitter;', 'function work(RN) {}',
  ]) assert.deepEqual(scan(prefix + change + `var e = new RN.NativeEventEmitter(); e.addListener('wrong', cb);`).facts, []);
  assert.deepEqual(scan(`var require = fake; var RN = require('react-native');
var e = new RN.NativeEventEmitter(); e.addListener('wrong', cb);`).facts, []);
});

test('var 초기화 전이나 조건부·함수 내부 초기화를 파일 전체로 확대하지 않는다', () => {
  for (const body of [
    `e.addListener('wrong', cb); var e = new N();`,
    `if (enabled) { var e = new N(); } e.addListener('wrong', cb);`,
    `function setup() { var e = new N(); } e.addListener('wrong', cb);`,
    `if (enabled) var e = new N(); e.addListener('wrong', cb);`,
    `while (enabled) var e = new N(); e.addListener('wrong', cb);`,
    `for (;;) var e = new N(); e.addListener('wrong', cb);`,
    `if (enabled) work(); else var e = new N(); e.addListener('wrong', cb);`,
    `do var e = new N(); while (enabled); e.addListener('wrong', cb);`,
    `if (enabled) label: var e = new N(); e.addListener('wrong', cb);`,
  ]) {
    const document = scan(`import { NativeEventEmitter as N } from 'react-native'; ${body}`);
    assert.deepEqual(document.facts, []);
    assert.ok(document.limitations.some((item) => item.startsWith('unresolved-js-event-emitters:')));
  }
  assert.deepEqual(scan(`var e = new RN.NativeEventEmitter(); var RN = require('react-native');
e.addListener('wrong', cb);`).facts, []);
});

test('예약어 이름의 메서드 호출 뒤 ASI 선언은 조건문 본문으로 오인하지 않는다', () => {
  for (const call of ['obj.if(enabled)', 'obj.while(enabled)', 'obj?.for(enabled)']) {
    const document = scan(`import { NativeEventEmitter as N } from 'react-native';
${call}
var e = new N(); e.addListener('ready', cb);`);
    assert.deepEqual(document.facts.map(({ channel }) => channel), ['ready']);
  }
});

test('직접 초기화 범위 밖의 알려진 constructor와 초기화 전 구독은 미해석 한계로 남긴다', () => {
  for (const source of [
    `let a = 1, e = new N(); e.addListener('ready', cb);`,
    `let e = (new N()); e.addListener('ready', cb);`,
    `e.addListener('ready', cb); var e = new N();`,
  ]) {
    const document = scan(`import { NativeEventEmitter as N } from 'react-native'; ${source}`);
    assert.deepEqual(document.facts, []);
    assert.ok(document.limitations.some((item) => item.startsWith('unresolved-js-event-emitters:')));
  }
  assert.deepEqual(scan(`if (enabled) var RN = require('react-native');
var e = new RN.NativeEventEmitter(); e.addListener('wrong', cb);`).facts, []);
});

test('namespace 직접 구독과 inline 생성은 실제 import에만 귀속한다', () => {
  const document = scan(`import * as RN from 'react-native';
RN.DeviceEventEmitter.addListener('global', cb);
new RN.NativeEventEmitter().addListener('inline', cb);`);
  assert.deepEqual(document.facts.map(({ channel }) => channel), ['global', 'inline']);
  assert.deepEqual(scan(`var RN = require('other'); new RN.NativeEventEmitter().addListener('wrong', cb);`).facts, []);
});

test('const emitter의 lexical 범위와 namespace 멤버 쓰기를 보존한다', () => {
  const document = scan(`import { NativeEventEmitter as N } from 'react-native';
function setup() { const e = new N(); e.addListener('inside', cb); }
e.addListener('outside', cb);`);
  assert.deepEqual(document.facts.map(({ channel }) => channel), ['inside']);
  for (const mutation of ['RN.NativeModules ||= other;', 'delete RN.NativeModules;', 'RN.NativeModules.value++;']) {
    assert.deepEqual(scan(`var RN = require('react-native'); ${mutation}
var e = new RN.NativeEventEmitter(); e.addListener('wrong', cb);`).facts, []);
  }
});
