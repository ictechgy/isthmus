import assert from 'node:assert/strict';
import test from 'node:test';
import { scanJsSource } from './js-scan.ts';

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
