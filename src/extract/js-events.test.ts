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
