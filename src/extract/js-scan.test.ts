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
