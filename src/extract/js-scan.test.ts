import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createBraceClauseTracker,
  findMatching,
  type ParamShadow,
  ParamShadowIndex,
  scanJsSource,
} from './js-scan.ts';
import type { JsToken } from './lexer.ts';
import { tokenizeJsSource } from './lexer.ts';

/** 배열의 숫자 인덱스 읽기를 세는 Proxy다 — 스캔 작업량을 시간 대신 읽은 원소 수로 잰다. */
function countingArray<T>(items: readonly T[]): { readonly items: readonly T[]; readonly reads: () => number } {
  let reads = 0;
  const proxy = new Proxy(items, {
    get(target, key, receiver) {
      if (typeof key === 'string' && /^\d+$/.test(key)) reads++;
      return Reflect.get(target, key, receiver) as unknown;
    },
  });
  return { items: proxy, reads: () => reads };
}

/** 여는 위치부터 같은 종류만 세는 선형 탐색이다 — 짝 표가 지켜야 할 기준 판정이다. */
function linearMatching(tokens: readonly JsToken[], open: number, openText: string, closeText: string) {
  let depth = 0;
  for (let index = open; index < tokens.length; index++) {
    if (tokens[index]!.text === openText) depth++;
    else if (tokens[index]!.text === closeText && --depth === 0) return index;
  }
  return undefined;
}

/** 시드가 같으면 같은 수열을 내는 의사 난수다. */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2 ** 31;
    return state / 2 ** 31;
  };
}

/** 스캔 결과에서 사실만 종류·채널·메서드·동적 여부로 평탄화한다. */
function flatten(source: string) {
  return scanJsSource(source).facts.map((fact) => ({
    kind: fact.kind,
    channel: fact.channel,
    method: fact.method,
    dynamic: fact.dynamic,
  }));
}

test('NativeModules의 점·대괄호·구조 분해 접근을 module-import로 읽는다', () => {
  const facts = flatten(`
    const { Direct } = NativeModules;
    const B = NativeModules['Bracket'];
    NativeModules.Dot.load();
  `);
  assert.deepEqual(facts, [
    { kind: 'module-import', channel: 'Direct', method: undefined, dynamic: false },
    { kind: 'module-import', channel: 'Bracket', method: undefined, dynamic: false },
    { kind: 'module-import', channel: 'Dot', method: undefined, dynamic: false },
    { kind: 'method-invoke', channel: 'Dot', method: 'load', dynamic: false },
  ]);
});

test('TurboModuleRegistry 조회와 연속 메서드 호출을 읽는다', () => {
  const facts = flatten(`
    const M = TurboModuleRegistry.getEnforcing('Turbo');
    TurboModuleRegistry.get('Other').ping();
    TurboModuleRegistry.getNullable<Spec>('Typed').pong();
  `);
  assert.deepEqual(facts, [
    { kind: 'module-import', channel: 'Turbo', method: undefined, dynamic: false },
    { kind: 'module-import', channel: 'Other', method: undefined, dynamic: false },
    { kind: 'method-invoke', channel: 'Other', method: 'ping', dynamic: false },
    { kind: 'module-import', channel: 'Typed', method: undefined, dynamic: false },
    { kind: 'method-invoke', channel: 'Typed', method: 'pong', dynamic: false },
  ]);
});

test('requireNativeModule 계열과 컴포넌트 API를 구분해 읽는다', () => {
  const facts = flatten(`
    requireNativeModule('ExpoStyle');
    requireOptionalNativeModule('Maybe');
    requireNativeComponent('List');
    codegenNativeComponent<Props>('Chart');
    requireNativeViewManager('Sheet');
  `);
  assert.deepEqual(facts, [
    { kind: 'module-import', channel: 'ExpoStyle', method: undefined, dynamic: false },
    { kind: 'module-import', channel: 'Maybe', method: undefined, dynamic: false },
    { kind: 'component-require', channel: 'List', method: undefined, dynamic: false },
    { kind: 'component-require', channel: 'Chart', method: undefined, dynamic: false },
    { kind: 'component-require', channel: 'Sheet', method: undefined, dynamic: false },
  ]);
});

test('비리터럴 이름은 원문 표현을 실은 동적 사실로 남긴다', () => {
  const facts = flatten(`
    requireNativeModule(name);
    requireNativeComponent(\`View\${suffix}\`);
    NativeModules[pick()].go();
  `);
  assert.deepEqual(facts, [
    { kind: 'module-import', channel: 'name', method: undefined, dynamic: true },
    { kind: 'component-require', channel: '`View${suffix}`', method: undefined, dynamic: true },
    { kind: 'module-import', channel: 'pick()', method: undefined, dynamic: true },
    { kind: 'method-invoke', channel: 'pick()', method: 'go', dynamic: true },
  ]);
});

test('한 단계 문자열 상수는 정적 이름으로 접는다', () => {
  const facts = flatten(`
    const MODULE_NAME = 'ConstBound';
    requireNativeModule(MODULE_NAME);
  `);
  assert.deepEqual(facts, [
    { kind: 'module-import', channel: 'ConstBound', method: undefined, dynamic: false },
  ]);
});

test('주석·문자열·정규식 안의 가짜 호출은 사실을 만들지 않는다', () => {
  const facts = flatten(`
    // requireNativeModule('InComment')
    /* requireNativeComponent('InBlock') */
    const s = 'requireNativeModule(\\'InString\\')';
    const r = /requireNativeModule\\('InRegex'\\)/;
  `);
  assert.deepEqual(facts, []);
});

test('바인딩된 식별자의 멤버 호출을 후보로 남기고 동적 메서드를 센다', () => {
  const scan = scanJsSource(`
    const M = requireNativeModule('Bound');
    M.start();
    M[key]();
    unbound.ignored();
  `);
  assert.deepEqual(scan.memberCalls.map((call) => ({
    ident: call.ident,
    method: call.method,
    dynamicMethod: call.dynamicMethod,
  })), [
    { ident: 'M', method: 'start', dynamicMethod: false },
    { ident: 'M', method: 'key', dynamicMethod: true },
  ]);
  assert.equal(scan.counts.dynamicMethodNames, 1);
});

test('import·export·배럴 재수출을 수집하고 import type은 제외한다', () => {
  const scan = scanJsSource(`
    import Default from './a';
    import { Named, Other as Alias } from './b';
    import type { SpecOnly } from './spec';
    import { type Inline, Runtime } from './c';
    export default requireNativeModule('D');
    export const Reused = requireNativeModule('N');
    export { Reused as Again } from './d';
    export { default as Barrel } from './e';
  `);
  assert.deepEqual(
    scan.imports.map((entry) => [entry.localName, entry.specifier, entry.exportedName]),
    [
      ['Default', './a', 'default'],
      ['Named', './b', 'Named'],
      ['Alias', './b', 'Other'],
      ['Runtime', './c', 'Runtime'],
    ],
  );
  assert.deepEqual(scan.exports.defaultName, { name: 'D' });
  assert.deepEqual(scan.exports.named.get('Reused'), { name: 'N' });
  assert.deepEqual(scan.exports.reexported.get('Again'),
    { specifier: './d', exportedName: 'Reused' });
  assert.deepEqual(scan.exports.reexported.get('Barrel'),
    { specifier: './e', exportedName: 'default' });
});

test('CommonJS module.exports와 exports.X를 수집한다', () => {
  const scan = scanJsSource(`
    module.exports = requireNativeModule('CjsDefault');
    exports.Named = requireNativeModule('CjsNamed');
  `);
  assert.deepEqual(scan.exports.defaultName, { name: 'CjsDefault' });
  assert.deepEqual(scan.exports.named.get('Named'), { name: 'CjsNamed' });
});

test('모듈 바인딩 재대입은 바인딩을 지워 이후 호출을 미귀속으로 둔다', () => {
  const scan = scanJsSource(`
    let M = requireNativeModule('First');
    M = somethingElse();
    M.call();
  `);
  assert.equal(scan.bindings.has('M'), false);
  assert.equal(scan.memberCalls.length, 0);
});

test('옵셔널 체이닝과 대괄호 메서드 호출을 읽는다', () => {
  const scan = scanJsSource(`
    const M = requireNativeModule('Opt');
    M?.go();
    M?.['bracket']();
    M?.[dynamic]();
  `);
  assert.deepEqual(scan.memberCalls.map((call) => ({
    method: call.method,
    dynamicMethod: call.dynamicMethod,
  })), [
    { method: 'go', dynamicMethod: false },
    { method: 'bracket', dynamicMethod: false },
    { method: 'dynamic', dynamicMethod: true },
  ]);
});

test('구조 분해의 ...rest는 열거 불가라 동적 사실로 남긴다', () => {
  const scan = scanJsSource('const { A, ...rest } = NativeModules;');
  assert.deepEqual(
    scan.facts.map((fact) => [fact.kind, fact.channel, fact.dynamic]),
    [
      ['module-import', 'A', false],
      ['module-import', '{ A, ...rest }', true],
    ],
  );
  assert.equal(scan.counts.dynamicModuleNames, 1);
});

test('베어 NativeModules 값 참조는 동적 사실로 남긴다', () => {
  const facts = flatten('pass(NativeModules);');
  assert.deepEqual(facts, [
    { kind: 'module-import', channel: 'NativeModules', method: undefined, dynamic: true },
  ]);
});

test('export default 바인딩 추적과 로컬 named re-export를 읽는다', () => {
  const scan = scanJsSource(`
    const M = requireNativeModule('Local');
    export default M;
    const Other = requireNativeModule('Other');
    export { Other as Renamed };
  `);
  assert.deepEqual(scan.exports.defaultName, { name: 'Local' });
  assert.deepEqual(scan.exports.named.get('Renamed'), { name: 'Other' });
});

test('네임스페이스 import는 모듈 바인딩으로 수집하지 않는다', () => {
  const scan = scanJsSource(`
    import * as ns from './x';
    ns.call();
  `);
  assert.equal(scan.imports.length, 0);
  assert.equal(scan.memberCalls.length, 0);
});

test('대괄호 접근의 연쇄 메서드 호출을 읽는다', () => {
  const facts = flatten("NativeModules['Chain'].link();");
  assert.deepEqual(facts, [
    { kind: 'module-import', channel: 'Chain', method: undefined, dynamic: false },
    { kind: 'method-invoke', channel: 'Chain', method: 'link', dynamic: false },
  ]);
});

test('인자 없는 호출과 비호출 참조는 사실로 만들지 않는다', () => {
  const facts = flatten(`
    requireNativeModule();
    const f = requireNativeComponent('View').render;
  `);
  assert.deepEqual(facts, [
    { kind: 'component-require', channel: 'View', method: undefined, dynamic: false },
  ]);
});

test('계약이 허용하지 않는 리터럴 이름은 동적 사실로 내린다', () => {
  const scan = scanJsSource(
    "requireNativeModule('');\nrequireNativeModule('A\\u0007B');\nconst M = requireNativeModule('Cam');\nM['a\\u0001']();",
  );
  // 빈 값·제어 문자 이름은 정적 채널이 될 수 없어 원문을 실은 동적 사실이다.
  assert.deepEqual(
    scan.facts.map((fact) => [fact.kind, fact.channel, fact.dynamic]),
    [
      ['module-import', "''", true],
      ['module-import', "'A\\u0007B'", true],
      ['module-import', 'Cam', false],
    ],
  );
  assert.deepEqual(
    scan.memberCalls.map((call) => [call.method, call.dynamicMethod]),
    [["'a\\u0001'", true]],
  );
});

test('세미콜론 없는 뒤 문장의 대입이 선언 바인딩으로 새지 않는다', () => {
  const scan = scanJsSource(
    "const Cam = requireNativeModule('Camera')\nstate.handler = Cam\nfunction run(handler) { handler.start() }",
  );
  assert.equal(scan.bindings.has('handler'), false);
  assert.equal(scan.bindings.has('state'), false);
  assert.equal(scan.memberCalls.length, 0);
});

test('타입 주석 선언은 바인딩하고 연결 초기값은 첫 토큰으로 자르지 않는다', () => {
  const scan = scanJsSource(
    "const M: Spec = TurboModuleRegistry.get('X');\nconst G = 'He' + 'llo';\nrequireNativeModule(G);\nM.ping();",
  );
  assert.deepEqual(scan.bindings.get('M'), { name: 'X' });
  assert.equal(scan.constStrings.has('G'), false);
  // `get('X')`는 호출 위치에서도 module-import를 내고, G는 미해석이라 동적이다.
  assert.deepEqual(
    scan.facts.map((fact) => [fact.kind, fact.channel, fact.dynamic]),
    [['module-import', 'X', false], ['module-import', 'G', true]],
  );
  assert.deepEqual(scan.memberCalls.map((call) => call.method), ['ping']);
});

test('비교 연산과 속성 대입이 살아 있는 바인딩을 지우지 않는다', () => {
  const scan = scanJsSource(
    "const MODE = 'cam';\nif (MODE === 'cam') { log(); }\nrequireNativeModule(MODE);\nconst prop = 'x';\nobj.prop = y;\nrequireNativeModule(prop);",
  );
  assert.deepEqual(
    scan.facts.map((fact) => [fact.channel, fact.dynamic]),
    [['cam', false], ['x', false]],
  );
});

test('함수 매개변수가 파일 바인딩을 가리면 그 본문 호출을 귀속하지 않는다', () => {
  const scan = scanJsSource(
    "const M = requireNativeModule('A');\nfunction f(M) { M.call(); }\nconst g = (M) => { M.other(); };\nM.top();",
  );
  assert.deepEqual(scan.memberCalls.map((call) => call.method), ['top']);
});

test('증감 연산 뒤의 나눗셈이 정규식으로 삼켜져 호출을 잃지 않는다', () => {
  const facts = flatten("x++ / requireNativeModule('A') / 1;");
  assert.deepEqual(facts, [
    { kind: 'module-import', channel: 'A', method: undefined, dynamic: false },
  ]);
});

test('Expo 전용 API는 mechanism을 expo로 표시한다', () => {
  const facts = scanJsSource(`
    import { requireNativeModule, requireNativeViewManager } from 'expo-modules-core';
    requireNativeModule('DeviceInfo');
    requireNativeViewManager('SheetView');
  `).facts.map((fact) => ({
    kind: fact.kind,
    channel: fact.channel,
    mechanism: fact.mechanism,
  }));

  assert.deepEqual(facts, [
    { kind: 'module-import', channel: 'DeviceInfo', mechanism: 'expo' },
    { kind: 'component-require', channel: 'SheetView', mechanism: 'expo' },
  ]);
});

test('import 없이 호출된 Expo API 이름도 expo로 읽는다', () => {
  const facts = scanJsSource(`
    requireOptionalNativeModule('Maybe');
    requireNativeViewManager('Bare');
  `).facts.map((fact) => ({
    kind: fact.kind,
    mechanism: fact.mechanism,
  }));

  assert.deepEqual(facts, [
    { kind: 'module-import', mechanism: 'expo' },
    { kind: 'component-require', mechanism: 'expo' },
  ]);
});

test('Expo가 아닌 specifier의 동명 래퍼는 mechanism을 생략한다', () => {
  const facts = scanJsSource(`
    import { requireNativeModule } from './native-module-helper';
    requireNativeModule('Wrapped');
  `).facts.map((fact) => ({
    kind: fact.kind,
    mechanism: fact.mechanism,
  }));

  assert.deepEqual(facts, [{ kind: 'module-import', mechanism: undefined }]);
});

test('코어 RN API는 mechanism을 실지 않는다', () => {
  const facts = scanJsSource(`
    const M = NativeModules.Core;
    TurboModuleRegistry.get('Turbo');
    requireNativeComponent('List');
    codegenNativeComponent('Chart');
  `).facts.filter((fact) => fact.kind !== 'method-invoke').map((fact) => ({
    kind: fact.kind,
    mechanism: fact.mechanism,
  }));

  assert.deepEqual(facts, [
    { kind: 'module-import', mechanism: undefined },
    { kind: 'module-import', mechanism: undefined },
    { kind: 'component-require', mechanism: undefined },
    { kind: 'component-require', mechanism: undefined },
  ]);
});

test('동적 이름의 Expo 호출도 mechanism 증거는 보존한다', () => {
  const facts = scanJsSource(`
    import { requireNativeModule } from 'expo';
    requireNativeModule(name);
  `).facts.map((fact) => ({
    kind: fact.kind,
    mechanism: fact.mechanism,
    dynamic: fact.dynamic,
  }));

  assert.deepEqual(facts, [
    { kind: 'module-import', mechanism: 'expo', dynamic: true },
  ]);
});

test('같은 파일에 선언된 동명 래퍼는 mechanism을 생략한다', () => {
  // 로컬 선언이 Expo API 이름을 가리면 그 호출은 Expo API가 아니다 —
  // expo 표시는 이전에 조인되던 코어 export와의 연결을 끊는다.
  const facts = scanJsSource(`
    function requireNativeViewManager(name) { return name; }
    requireNativeViewManager('LocalShim');
    const requireNativeModule = () => null;
    requireNativeModule('LocalConst');
  `).facts.map((fact) => ({
    kind: fact.kind,
    channel: fact.channel,
    mechanism: fact.mechanism,
  }));

  assert.deepEqual(facts, [
    { kind: 'component-require', channel: 'LocalShim', mechanism: undefined },
    { kind: 'module-import', channel: 'LocalConst', mechanism: undefined },
  ]);
});

test('CJS require 구조 분해의 specifier로 mechanism을 판정한다', () => {
  const facts = scanJsSource(`
    const { requireNativeModule } = require('expo-modules-core');
    const { requireNativeViewManager } = require('./local-helper');
    const requireOptionalNativeModule = require('expo');
    requireNativeModule('Cjs');
    requireNativeViewManager('CjsView');
    requireOptionalNativeModule('Opt');
  `).facts.map((fact) => ({
    kind: fact.kind,
    channel: fact.channel,
    mechanism: fact.mechanism,
  }));

  assert.deepEqual(facts, [
    { kind: 'module-import', channel: 'Cjs', mechanism: 'expo' },
    { kind: 'component-require', channel: 'CjsView', mechanism: undefined },
    { kind: 'module-import', channel: 'Opt', mechanism: 'expo' },
  ]);
});

test('별칭 import의 mechanism은 원본 export 이름으로 판정한다', () => {
  const facts = scanJsSource(`
    import { requireNativeModule as rnm } from 'expo-modules-core';
    import { requireNativeViewManager as localView } from './helper';
    rnm('Aliased');
    localView('AliasedView');
  `).facts.map((fact) => ({
    kind: fact.kind,
    channel: fact.channel,
    mechanism: fact.mechanism,
  }));

  assert.deepEqual(facts, [
    { kind: 'module-import', channel: 'Aliased', mechanism: 'expo' },
    { kind: 'component-require', channel: 'AliasedView', mechanism: undefined },
  ]);
});

test('매개변수가 가리는 이름의 호출은 Expo mechanism을 생략한다', () => {
  const facts = scanJsSource(`
    import { requireNativeModule } from 'expo-modules-core';
    function wrap(requireNativeModule) {
      requireNativeModule('Shadowed');
    }
  `).facts.map((fact) => ({
    kind: fact.kind,
    channel: fact.channel,
    mechanism: fact.mechanism,
  }));

  assert.deepEqual(facts, [
    { kind: 'module-import', channel: 'Shadowed', mechanism: undefined },
  ]);
});

test('별칭이 매개변수에 가려지면 경계 호출로 읽지 않는다', () => {
  const facts = scanJsSource(`
    import { requireNativeModule as rnm } from 'expo-modules-core';
    function wrap(rnm) {
      rnm('Shadowed');
    }
  `).facts;

  assert.equal(facts.length, 0);
});

test('부재를 허용하는 모듈 조회만 optional로 표시한다', () => {
  // requireOptionalNativeModule·Registry.get/getNullable은 부재 시 null을
  // 돌려주지만 requireNativeModule·getEnforcing·NativeModules 접근은
  // 부재를 감당한다는 의도가 없거나 던진다.
  const facts = scanJsSource(`
    requireOptionalNativeModule('Maybe');
    requireNativeModule('Must');
    TurboModuleRegistry.get('Nullable');
    TurboModuleRegistry.getNullable('Old');
    TurboModuleRegistry.getEnforcing('Required');
    NativeModules.Direct;
    requireNativeViewManager('Sheet');
  `).facts.map((fact) => ({
    kind: fact.kind,
    channel: fact.channel,
    optional: fact.optional,
  }));

  assert.deepEqual(facts, [
    { kind: 'module-import', channel: 'Maybe', optional: true },
    { kind: 'module-import', channel: 'Must', optional: undefined },
    { kind: 'module-import', channel: 'Nullable', optional: true },
    { kind: 'module-import', channel: 'Old', optional: true },
    { kind: 'module-import', channel: 'Required', optional: undefined },
    { kind: 'module-import', channel: 'Direct', optional: undefined },
    { kind: 'component-require', channel: 'Sheet', optional: undefined },
  ]);
});

test('별칭 import의 optional은 원본 export 이름으로 판정한다', () => {
  const facts = scanJsSource(`
    import { requireOptionalNativeModule as maybe } from 'expo-modules-core';
    import { requireNativeModule as must } from 'expo-modules-core';
    maybe('Opt');
    must('Req');
  `).facts.map((fact) => ({
    channel: fact.channel,
    optional: fact.optional,
  }));

  assert.deepEqual(facts, [
    { channel: 'Opt', optional: true },
    { channel: 'Req', optional: undefined },
  ]);
});

test('괄호 짝은 토큰 열마다 한 번 만든 표로 찾아 닫히지 않은 괄호가 많아도 토큰을 다시 훑지 않는다', () => {
  const size = 3_000;
  const { items: tokens, reads } = countingArray(tokenizeJsSource(`${'('.repeat(size)})`));
  for (let open = 0; open < size; open++) {
    assert.equal(findMatching(tokens, open, '(', ')'), open === size - 1 ? size : undefined);
  }
  // 표를 만들 때 한 번, 호출마다 여는 토큰 한 번 읽는다(약 6,000번). 여는 괄호마다 끝까지 훑으면 약 450만 번이다.
  assert.ok(reads() <= 3 * (size + 1), `token reads ${reads()}`);
});

test('괄호 짝 표는 다른 종류·짝 없는 닫는 괄호가 섞여도 같은 종류만 세는 선형 탐색과 같다', () => {
  const random = seededRandom(7);
  const pieces = ['(', ')', '[', ']', '{', '}', 'a', ','];
  for (let round = 0; round < 300; round++) {
    const source = Array.from({ length: 40 }, () => pieces[Math.floor(random() * pieces.length)]).join(' ');
    const tokens = tokenizeJsSource(source);
    for (const [openText, closeText] of [['(', ')'], ['[', ']'], ['{', '}']] as const) {
      tokens.forEach((token, open) => {
        if (token.text !== openText) return;
        assert.equal(findMatching(tokens, open, openText, closeText),
          linearMatching(tokens, open, openText, closeText), source);
      });
    }
  }
  // 표에 없는 짝이나 여는 토큰이 아닌 시작점은 지금처럼 그 위치부터 선형으로 센다.
  const angle = tokenizeJsSource('f<a<b> >(x)');
  assert.equal(findMatching(angle, 1, '<', '>'), 6);
  assert.equal(findMatching(angle, 0, '(', ')'), 9);
});

test('매개변수 가림 색인은 구간 전체를 훑는 판정과 같고 판정마다 구간 목록을 다시 읽지 않는다', () => {
  // 중첩·인접·부분 겹침·같은 시작점·정렬되지 않은 입력 순서를 섞는다.
  const fixed: ParamShadow[] = [
    { from: 30, to: 40, names: new Set(['M']) },
    { from: 2, to: 20, names: new Set(['M']) },
    { from: 5, to: 10, names: new Set(['M', 'N']) },
    { from: 20, to: 25, names: new Set(['M']) },
    { from: 30, to: 31, names: new Set(['N']) },
    { from: 12, to: 33, names: new Set(['N']) },
  ];
  const random = seededRandom(11);
  const generated = Array.from({ length: 50 }, (): ParamShadow[] => Array.from({ length: 30 }, () => {
    const from = Math.floor(random() * 100);
    return {
      from,
      to: from + 1 + Math.floor(random() * 30),
      names: new Set(['a', 'b', 'c'].filter(() => random() < 0.5)),
    };
  }));
  for (const shadows of [fixed, ...generated]) {
    const { items, reads } = countingArray(shadows);
    const index = new ParamShadowIndex(items);
    const built = reads();
    for (const name of ['M', 'N', 'a', 'b', 'c', 'Z']) {
      for (let position = 0; position < 135; position++) {
        const expected = shadows.some((shadow) =>
          position >= shadow.from && position < shadow.to && shadow.names.has(name));
        assert.equal(index.has(name, position), expected, `${name}@${position}`);
      }
    }
    assert.equal(reads(), built);
  }
});

test('중첩·인접 함수의 같은 이름 매개변수는 각자의 본문만 가린다', () => {
  const scan = scanJsSource([
    "const M = requireNativeModule('A');",
    'function outer(M) { function inner(M) { M.a(); } M.b(); }',
    'M.c();',
    'function next(M) { M.d(); }',
    'const arrow = (N, M) => { M.e(); };',
    'M.f();',
    'function other(N) { M.g(); }',
  ].join('\n'));
  assert.deepEqual(scan.memberCalls.map((call) => call.method), ['c', 'f', 'g']);
});

test('import 절 중괄호 판정은 앞 위치까지 센 깊이를 이어 써 절 길이에 선형이다', () => {
  const size = 3_000;
  const { items: tokens, reads } = countingArray(tokenizeJsSource(`import { ${'a '.repeat(size)}} from 'x'`));
  const inBraceClause = createBraceClauseTracker(tokens, 1);
  for (let index = 1; index < tokens.length; index++) {
    assert.equal(inBraceClause(index), index >= 2 && index <= size + 2, String(index));
  }
  // 위치마다 절 처음부터 다시 세면 약 450만 번 읽는다.
  assert.ok(reads() <= tokens.length, `token reads ${reads()}`);
});

test('import 절은 named·default·인라인 type·as 뒤 중괄호를 지금처럼 구분한다', () => {
  const scan = scanJsSource([
    "import D, { a, type T, b as c, default as e } from './x';",
    "import g as { h } from './z';",
  ].join('\n'));
  assert.deepEqual(
    scan.imports.map((entry) => [entry.localName, entry.specifier, entry.exportedName]),
    [
      ['D', './x', 'default'],
      ['a', './x', 'a'],
      ['c', './x', 'b'],
      ['e', './x', 'default'],
      ['g', './z', 'default'],
      ['h', './z', 'h'],
    ],
  );
});

test('import 색인은 수집된 순서대로 조회해 같은 이름 import의 바인딩·별칭·mechanism 판정을 유지한다', () => {
  const scan = scanJsSource([
    // 바인딩 수집은 앞에서부터라, 별칭 import보다 앞선 초기값은 아직 Expo 별칭으로 보지 않는다.
    "const Early = loadModule('Early');",
    "import { requireNativeModule as loadModule } from 'expo';",
    "const Late = loadModule('Late');",
    "import { requireNativeComponent as view } from './a';",
    "import { requireNativeModule as view } from 'expo';",
    "view('First');",
    "import { requireNativeModule } from './helper';",
    "import { requireNativeModule } from 'expo-modules-core';",
    "requireNativeModule('Mixed');",
    'Early.go(); Late.go();',
  ].join('\n'));
  assert.deepEqual([...scan.bindings.keys()], ['Late']);
  assert.deepEqual(
    scan.facts.map((fact) => [fact.kind, fact.channel, fact.mechanism ?? null]),
    [
      ['module-import', 'Early', 'expo'],
      ['module-import', 'Late', 'expo'],
      ['component-require', 'First', null],
      ['module-import', 'Mixed', 'expo'],
    ],
  );
  assert.deepEqual(scan.memberCalls.map((call) => call.ident), ['Late']);
});

test('NativeModules 레지스트리는 react-native 출처일 때만 읽고 로컬 shim·다른 모듈·매개변수가 가리면 읽지 않는다', () => {
  // 같은 이름의 로컬 객체나 다른 모듈의 대역을 RN 레지스트리로 읽으면 수신 측에 없는 모듈 import와 미처리 호출이
  // 거짓 error로 남는다.
  for (const source of [
    'const NativeModules = { Legacy: { run() {} } };\nNativeModules.Legacy.run();',
    "import { NativeModules } from './testing-shim';\nNativeModules.Legacy.run();",
    "const { NativeModules } = require('./testing-shim');\nNativeModules.Legacy.run();",
    'function f(NativeModules) { return NativeModules.Mock.x(); }',
  ]) {
    assert.deepEqual(flatten(source), [], source);
  }
});

test('react-native에서 가져온 NativeModules는 바인딩 위치를 사실로 세지 않고 별칭·namespace 접근도 읽는다', () => {
  const camera = [
    { kind: 'module-import', channel: 'Camera', method: undefined, dynamic: false },
    { kind: 'method-invoke', channel: 'Camera', method: 'open', dynamic: false },
  ];
  // import 절·구조 분해의 이름 자체는 레지스트리를 값으로 쓰는 것이 아니다.
  assert.deepEqual(flatten("import { NativeModules } from 'react-native';\nNativeModules.Camera.open();"), camera);
  assert.deepEqual(flatten("const { NativeModules } = require('react-native');\nNativeModules.Camera.open();"), camera);
  assert.deepEqual(flatten("import { NativeModules as NM } from 'react-native';\nNM.Camera.open();"), camera);
  for (const source of [
    "import * as RN from 'react-native';\nRN.NativeModules.Camera.open();",
    "const RN = require('react-native');\nRN.NativeModules.Camera.open();",
    "import RN from 'react-native';\nRN.NativeModules.Camera.open();",
  ]) {
    assert.deepEqual(flatten(source), camera, source);
  }
  // import 없이 쓰는 전역 이름과 레지스트리를 값으로 넘기는 접근은 기존 규칙 그대로다.
  assert.deepEqual(flatten('NativeModules.Camera.open();'), camera);
  assert.deepEqual(flatten("import { NativeModules } from 'react-native';\npass(NativeModules);"),
    [{ kind: 'module-import', channel: 'NativeModules', method: undefined, dynamic: true }]);
});

test('매개변수 기본값 식의 NativeModules는 가려지지 않고 레지스트리로 읽는다', () => {
  // 기본값 식은 매개변수 이름이 아니다. 기본값 안의 식별자까지 가림 집합에 넣으면 RN 레지스트리 접근이 사실 없이
  // 사라지고, 수신 측 module-export가 짝 없는 경고로 남는다(검토 재현).
  assert.deepEqual(
    flatten("import { NativeModules } from 'react-native';\nexport function createCamera(native = NativeModules.Camera) {\n  return native;\n}"),
    [{ kind: 'module-import', channel: 'Camera', method: undefined, dynamic: false }],
  );
  assert.deepEqual(
    flatten("import { NativeModules } from 'react-native';\nexport const useTorch = (mod = NativeModules.Torch) => {\n  mod.on();\n};"),
    [{ kind: 'module-import', channel: 'Torch', method: undefined, dynamic: false }],
  );
  // 구조 분해 매개변수의 기본값도 같다. 매개변수 이름 자체가 NativeModules면 여전히 가린다.
  assert.deepEqual(
    flatten("import { NativeModules } from 'react-native';\nfunction f({ cam = NativeModules.Camera } = {}) { return cam; }"),
    [{ kind: 'module-import', channel: 'Camera', method: undefined, dynamic: false }],
  );
  assert.deepEqual(flatten("import { NativeModules } from 'react-native';\nfunction f(NativeModules = fallback) { return NativeModules.Mock.x(); }"), []);
});

test('react-native 모듈 객체에서 구조 분해한 NativeModules도 레지스트리로 읽는다', () => {
  const camera = [
    { kind: 'module-import', channel: 'Camera', method: undefined, dynamic: false },
    { kind: 'method-invoke', channel: 'Camera', method: 'open', dynamic: false },
  ];
  for (const source of [
    "import RN from 'react-native';\nconst { NativeModules } = RN;\nNativeModules.Camera.open();",
    "import * as RN from 'react-native';\nconst { NativeModules } = RN;\nNativeModules.Camera.open();",
    "const RN = require('react-native');\nconst { NativeModules } = RN;\nNativeModules.Camera.open();",
    "import RN from 'react-native';\nconst { NativeModules: NM } = RN;\nNM.Camera.open();",
  ]) {
    assert.deepEqual(flatten(source), camera, source);
  }
  // 원천이 react-native 모듈 객체가 아니면 레지스트리가 아니다.
  for (const source of [
    "const RN = require('./testing-shim');\nconst { NativeModules } = RN;\nNativeModules.Legacy.run();",
    "import Shim from './testing-shim';\nconst { NativeModules } = Shim;\nNativeModules.Legacy.run();",
  ]) {
    assert.deepEqual(flatten(source), [], source);
  }
});

test('모듈 값이 바인딩 추적을 벗어난 위치만 범위 밖 참조로 센다', () => {
  // 귀속되는 멤버 호출, 스캔이 기록한 선언·export, 값이 원시값으로 소비되는 존재 검사·비교·typeof·대입 대상은
  // 모듈 값을 다른 바인딩으로 넘기지 않는다.
  for (const source of [
    'NativeModules.Cam.take();',
    'NativeModules.Cam?.take();',
    "NativeModules['Cam'].take();",
    "TurboModuleRegistry.getEnforcing<Spec>('Cam').take();",
    "requireNativeModule('Cam')?.['take']();",
    'const Cam = NativeModules.Cam;',
    'export default NativeModules.Cam;',
    'module.exports = NativeModules.Cam;',
    "exports.Cam = requireNativeModule('Cam');",
    "export const Cam = TurboModuleRegistry.get('Cam');",
    'const { Cam } = NativeModules;',
    'if (NativeModules.Cam) {}',
    'if (!NativeModules.Cam.take) {}',
    "if (typeof NativeModules.Cam.take === 'function' && NativeModules.Cam.ready) {}",
    'const ok = NativeModules.Cam != null;',
    'const ok = null !== NativeModules.Cam;',
    'const label = NativeModules.Cam ? 1 : 2;',
    'NativeModules.Cam && NativeModules.Cam.take();',
    'while ((NativeModules.Cam || NativeModules.Other)) {}',
    "if ('take' in NativeModules.Cam) {}",
    'NativeModules.Cam.take = mock;',
    'delete NativeModules.Cam.take;',
    "import { TurboModuleRegistry, NativeModules } from 'react-native';",
    "const { requireNativeModule } = require('expo-modules-core');",
    'jest.mock(name, () => ({ requireNativeModule: mock }));',
    'export { requireNativeModule };',
  ]) {
    assert.equal(scanJsSource(source).counts.escapedModuleReferences, 0, source);
  }
  // 인자·반환·인스턴스 상태·객체 값·대체값 연산·구조 분해·메서드 값 추출·귀속하지 않는 호출 형태·재대입·
  // 레지스트리와 조회 API 자체를 다른 이름에 담는 것은 하나씩 센다.
  for (const source of [
    'register(NativeModules.Cam);',
    'function load() { return NativeModules.Cam; }',
    'this.cam = NativeModules.Cam;',
    'const holder = [NativeModules.Cam];',
    'const Cam = NativeModules.Cam || {};',
    'const { take } = NativeModules.Cam;',
    'const take = NativeModules.Cam.take;',
    'NativeModules.Cam.take.call(null);',
    "NativeModules.Cam['take']();",
    "NativeModules?.['Cam'].take();",
    'NativeModules.Cam?.();',
    'if (NativeModules.Cam || [) {}',
    'NativeModules.Cam!.take();',
    '(NativeModules.Cam as Spec).take();',
    'NativeModules.Cam?.take?.();',
    'let Cam = NativeModules.Cam;\nCam = other;',
    'new NativeEventEmitter(NativeModules.Cam);',
    'if ((cached = NativeModules.Cam)) {}',
    "const Cam = TurboModuleRegistry.get<Spec>('Cam') as Spec | null;",
    "const Cam = await requireNativeModule('Cam');",
    'const Screen = () => { const Cam = NativeModules.Cam; };',
    "import { NativeModules as NM } from 'react-native';\nconst { Cam } = NM;",
    'const registry = TurboModuleRegistry;',
    'const load = requireNativeModule;',
    "import * as RN from 'react-native';\nconst modules = RN.NativeModules;",
    "import * as Core from 'expo-modules-core';\nconst load = Core.requireNativeModule;",
    // 조건 괄호 안이어도 값이나 그 괄호 그룹이 멤버 호출·호출의 대상이면 귀속되지 않는 호출이다.
    'if ((NativeModules.Cam as Spec).take()) {}',
    'if (NativeModules.Cam!.take()) {}',
    'if (!NativeModules.Cam.settings.read()) {}',
    'if (get(NativeModules.Cam)) {}',
    'const a = maybe!\nNativeModules.Cam?.take?.();',
  ]) {
    assert.equal(scanJsSource(source).counts.escapedModuleReferences, 1, source);
  }
});

test('모듈 바인딩 이름의 값 사용 중 추적을 벗어난 것만 이름별로 센다', () => {
  const scan = scanJsSource([
    "import Local from './local';",
    "import Pkg from 'package';",
    "const Cam = requireNativeModule('Cam');",
    'Cam.take();',
    'Cam?.[method]();',
    'if (Cam && typeof Cam.take === "function") Cam.take();',
    'const Alias = Cam;',
    'export default Cam;',
    'export { Cam as Camera };',
    'register(Cam, Local, Pkg);',
    'const { take } = Local;',
    'function shadow(Cam) { return Cam; }',
    'const holder = { Cam: 1, other: Local };',
    // `=` 재대입은 바인딩 자체를 지운다. 복합 대입의 대상과 수집되지 않는 본문 안의 같은 이름 선언은 값 사용이 아니다.
    'Cam ||= replacement;',
    'const later = () => { const Cam = other; };',
  ].join('\n'));
  // Cam: register 인자 1회. Local: register 인자·구조 분해 원천·객체 값 3회. 패키지 import는 해석될 수 없어 후보가 아니다.
  assert.deepEqual(Object.fromEntries(scan.identifierEscapes), { Cam: 1, Local: 3 });
});

test('출처를 따라가지 못하는 import 밖 값의 입구를 센다', () => {
  // ES import 바인딩의 해석은 문서 단계가 한다. 스캐너는 네임스페이스 import·require·동적 import의 입구만 센다.
  for (const [source, expected] of [
    ["import * as Lib from 'lib';", 1],
    ["import type * as Types from 'lib';", 0],
    ["import Lib from 'lib';", 0],
    ['import Lib', 0],
    // `import X, * as NS`의 X는 import 목록에 남아 문서 단계가 센다 — 스캐너는 네임스페이스 NS만 센다.
    ["import Main, * as Lib from 'lib';", 1],
    ['import * as', 0],
    ["import * as Lib from 'lib';\nconst url = import.meta.url;", 1],
    ["const Lib = require('lib');", 1],
    ["const { a, b: c } = require('lib');", 1],
    ["const { NativeModules } = require('react-native');", 0],
    ["const { NativeModules: NM } = require('react-native');", 1],
    ["const { requireNativeModule, TurboModuleRegistry } = require('expo');", 0],
    ["require('./setup');", 0],
    ["const ready = true\nrequire('./setup')\nstart()", 0],
    ["register(require('./camera'));", 1],
    ["const broken = require('./camera'", 1],
    ["const Cam = require('react-native').NativeModules.Cam;", 0],
    ["const mod = await import('./camera');", 1],
    ["function f(require) { return require('x'); }", 0],
    ["const require = createRequire(url);\nconst x = require('x');", 0],
    ['loader.require("x");', 0],
  ] as const) {
    assert.equal(scanJsSource(source).counts.untracedBindings, expected, source);
  }
});

test('쓰임을 판정할 수 없는 모듈 식은 추적한다고 단정하지 않고 센다', () => {
  // 식의 끝(닫는 괄호)을 찾지 못하면 뒤 문맥을 볼 수 없다.
  for (const source of ["requireNativeModule('Cam'", "NativeModules['Cam'", "TurboModuleRegistry.get('Cam'"]) {
    assert.equal(scanJsSource(source).counts.escapedModuleReferences, 1, source);
  }
});

test('선언 초기값의 객체 리터럴·함수 본문 안 이름은 로컬 선언으로 기록하지 않는다', () => {
  const torch = [
    { kind: 'module-import', channel: 'Torch', method: undefined, dynamic: false },
    { kind: 'method-invoke', channel: 'Torch', method: 'on', dynamic: false },
  ];
  // 초기값 안의 `NativeModules`를 구조 분해 로컬로 오인하면 import 없이 전역으로 읽는 파일의 레지스트리 사실이
  // 전부 사라졌다. 타입 주석의 쉼표 뒤 이름도 선언자가 아니다.
  for (const source of [
    'const api = { cam: NativeModules.Cam };\nNativeModules.Torch.on();',
    'const api = { NativeModules };\nNativeModules.Torch.on();',
    'const api = register({ first: 1, NativeModules });\nNativeModules.Torch.on();',
    'const run = () => { load(first, NativeModules.Cam); };\nNativeModules.Torch.on();',
    'const table: Map<string, NativeModules> = new Map();\nNativeModules.Torch.on();',
    'for (const key in { NativeModules }) {}\nNativeModules.Torch.on();',
    'for (const item of [{ NativeModules }]) {}\nNativeModules.Torch.on();',
  ]) {
    assert.deepEqual(flatten(source).filter((fact) => fact.channel === 'Torch'), torch, source);
  }
  // 구조 분해 선언 패턴(배열 패턴 안의 객체 패턴 포함)과 로컬 shim 선언은 그대로 로컬이다.
  for (const source of [
    'const { NativeModules } = shim;\nNativeModules.Torch.on();',
    'const [{ NativeModules }] = shims;\nNativeModules.Torch.on();',
    'const NativeModules = { Torch: mock };\nNativeModules.Torch.on();',
    'const first = 1, { NativeModules } = shim;\nNativeModules.Torch.on();',
  ]) {
    assert.deepEqual(flatten(source), [], source);
  }
  // 초기값 객체의 키는 Expo API 이름의 로컬 선언이 아니다 — 가져오기·선언 없는 호출은 expo로 읽는다.
  const mechanisms = scanJsSource("const mocks = { requireNativeModule: fake };\nrequireNativeModule('Cam');")
    .facts.map((fact) => fact.mechanism);
  assert.deepEqual(mechanisms, ['expo']);
});

test('선언 수집은 문장 끝에서 멈춰 뒤 선언을 삼키지 않는다', () => {
  // 세미콜론 없는 줄 끝(ASI)·for 머리의 닫는 괄호·감싼 블록의 끝에서 선언이 끝난다. 전에는 깊이 0의 `;`만
  // 끝으로 봐서 첫 선언이 파일 끝까지 이어졌고, 뒤의 바인딩·export가 수집되지 않아 호출이 귀속되지 않았다.
  for (const source of [
    "const a = 1\nconst Cam = requireNativeModule('Cam')\nCam.take()",
    "let ready\nconst Cam = requireNativeModule('Cam')\nCam.take()",
    "const done = () => {}\nconst Cam = requireNativeModule('Cam')\nCam.take()",
    "for (const x of list) {}\nconst Cam = requireNativeModule('Cam');\nCam.take();",
    "for (const key in table) use(key)\nconst Cam = requireNativeModule('Cam')\nCam.take()",
    "function f() { const a = 1 }\nconst Cam = requireNativeModule('Cam');\nCam.take();",
    "function f() { const a = 1 } const Cam = requireNativeModule('Cam'); Cam.take();",
  ]) {
    const scan = scanJsSource(source);
    assert.deepEqual([...scan.bindings.keys()], ['Cam'], source);
    assert.deepEqual(scan.memberCalls.map((call) => `${call.ident}.${call.method}`), ['Cam.take'], source);
  }
  assert.deepEqual(
    scanJsSource("const label = 'x'\nconst Cam = requireNativeModule('Cam')\nexport default Cam").exports.defaultName,
    { name: 'Cam' },
  );
  // 다음 줄이 식이나 선언 목록을 잇는 토큰으로 시작하면 같은 선언이다 — 뒤 선언자까지 그대로 묶는다.
  const continued = scanJsSource([
    'const first = 1',
    "  , Cam = requireNativeModule('Cam')",
    'const Other = base',
    '  .child',
    'const Picked = ready',
    '  ? first',
    "  : Other, Second = requireNativeModule('Second')",
    'Cam.take()',
  ].join('\n'));
  assert.deepEqual([...continued.bindings.keys()], ['Cam', 'Second']);
  assert.deepEqual(continued.memberCalls.map((call) => call.ident), ['Cam']);
});

test('default와 네임스페이스를 함께 가져오는 import는 default 이름을 그대로 남긴다', () => {
  // 전에는 `as`가 앞 default 항목의 이름을 네임스페이스 이름으로 바꿔 default 이름이 사라지고
  // 네임스페이스가 default로 기록됐다.
  const scan = scanJsSource("import Main, * as Lib from './lib';\nMain.go();\nLib.go();");
  assert.deepEqual(scan.imports.map((entry) => [entry.localName, entry.specifier, entry.exportedName]),
    [['Main', './lib', 'default']]);
  assert.deepEqual(scan.memberCalls.map((call) => call.ident), ['Main']);
  // react-native에서 함께 가져온 두 이름은 모두 모듈 객체다.
  assert.deepEqual(
    flatten("import RN, * as All from 'react-native';\nAll.NativeModules.Camera.open();\nRN.NativeModules.Torch.on();"),
    [
      { kind: 'module-import', channel: 'Camera', method: undefined, dynamic: false },
      { kind: 'method-invoke', channel: 'Camera', method: 'open', dynamic: false },
      { kind: 'module-import', channel: 'Torch', method: undefined, dynamic: false },
      { kind: 'method-invoke', channel: 'Torch', method: 'on', dynamic: false },
    ],
  );
});

test('속성 위치의 브리지 API 이름은 앞 링크 수와 무관하게 객체가 그 API의 모듈일 때만 읽는다', () => {
  const camera = [
    { kind: 'module-import', channel: 'Camera', method: undefined, dynamic: false },
    { kind: 'method-invoke', channel: 'Camera', method: 'open', dynamic: false },
  ];
  // react-native 모듈 객체(네임스페이스·default import·require 바인딩·인라인 require)를 거친 레지스트리는 읽는다.
  for (const source of [
    "import * as RN from 'react-native';\nRN.NativeModules.Camera.open();",
    "import RN from 'react-native';\nRN.NativeModules.Camera.open();",
    "const RN = require('react-native');\nRN.NativeModules.Camera.open();",
    "require('react-native').NativeModules.Camera.open();",
  ]) {
    assert.deepEqual(flatten(source), camera, source);
  }
  // 그 API를 내보내는 모듈 객체를 거치면 TurboModuleRegistry·조회·컴포넌트 API도 같은 규칙으로 읽는다.
  assert.deepEqual(flatten("import * as RN from 'react-native';\nRN.TurboModuleRegistry.getEnforcing('Camera').open();"), camera);
  const expo = scanJsSource("import * as Core from 'expo-modules-core';\nCore.requireNativeModule('Camera').open();");
  assert.deepEqual(expo.facts.map(({ kind, channel, mechanism }) => [kind, channel, mechanism ?? null]),
    [['module-import', 'Camera', 'expo'], ['method-invoke', 'Camera', null]]);
  assert.deepEqual(flatten("require('react-native').requireNativeComponent('Grid');"),
    [{ kind: 'component-require', channel: 'Grid', method: undefined, dynamic: false }]);
  // Expo 모듈 객체를 거친 조회는 같은 파일의 동명 래퍼 import와 무관하게 expo 경로다.
  for (const source of [
    "const Core = require('expo-modules-core');\nCore.requireNativeModule('Camera');",
    "import { requireNativeModule } from './wrapper';\nimport * as Core from 'expo';\nCore.requireNativeModule('Camera');",
  ]) {
    assert.deepEqual(scanJsSource(source).facts.map(({ channel, mechanism }) => [channel, mechanism ?? null]),
      [['Camera', 'expo']], source);
  }
  // 출처를 모르거나 그 API의 모듈이 아닌 객체의 속성은 링크 수와 무관하게 읽지 않는다 — 사실 없이 센다.
  for (const source of [
    'foo.NativeModules.Camera.open();',
    'foo.bar.NativeModules.Camera.open();',
    'this.NativeModules.Camera.open();',
    "require('./mock').NativeModules.Camera.open();",
    "jest.requireActual('react-native').NativeModules.Camera.open();",
    "import * as Shim from './shim';\nShim.NativeModules.Camera.open();",
    "import * as RN from 'react-native';\nfunction f(RN) { return RN.NativeModules.Camera.open(); }",
    "foo.TurboModuleRegistry.get('Camera');",
    "foo.bar.TurboModuleRegistry.get('Camera');",
    "foo.requireNativeModule('Camera');",
    "foo.bar.requireNativeModule('Camera');",
    "foo.bar.requireNativeComponent('Grid');",
    "import * as RN from 'react-native';\nRN.requireNativeModule('Camera');",
    "function require(name) { return mocks[name]; }\nrequire('react-native').NativeModules.Camera.open();",
    "import * as RN from 'react-native';\nfoo.RN.NativeModules.Camera.open();",
  ]) {
    const scan = scanJsSource(source);
    assert.deepEqual(scan.facts, [], source);
    assert.equal(scan.counts.untracedApiAccesses, 1, source);
  }
  // 대입 대상은 읽기가 아니다.
  assert.equal(scanJsSource('foo.NativeModules = mock;').counts.untracedApiAccesses, 0);
});

test('속성 위치의 이름은 파일 바인딩·별칭 import가 아니다', () => {
  // 전에는 앞 링크 수가 홀수면 obj.Cam이 파일 바인딩 Cam으로, a.b.load가 Expo 조회 별칭으로 읽혀 거짓 사실이 생겼다.
  const bound = scanJsSource("const Cam = requireNativeModule('Cam');\nobj.Cam.take();\na.b.Cam.take();\na.b.c.Cam.take();");
  assert.deepEqual(bound.memberCalls, []);
  assert.deepEqual(flatten("import { requireNativeModule as load } from 'expo';\na.load('X');\na.b.load('X');"), []);
});
