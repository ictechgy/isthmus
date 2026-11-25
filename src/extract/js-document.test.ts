import assert from 'node:assert/strict';
import test from 'node:test';
import { parseBridgeFactsDocument } from '../exchange/parse.ts';
import { createJsFactsDocument } from './js-document.ts';

/** 테스트용 문서 조립 단축이다. */
function assemble(files: Record<string, string>) {
  return createJsFactsDocument(
    Object.entries(files).map(([path, text]) => ({ path, text })),
    '0.0.0-test',
    '2026-01-01T00:00:00.000Z',
    '/project',
  );
}

/** 계약 필드만 뽑아 비교하기 쉽게 평탄화한다. */
function flat(document: ReturnType<typeof assemble>) {
  return document.facts.map((fact) => ({
    kind: fact.kind,
    channel: fact.channel,
    method: fact.method,
    dynamic: fact.dynamic,
    path: fact.location?.path,
  }));
}

test('단일 파일의 모듈·컴포넌트·메서드 사실을 계약 문서로 조립한다', () => {
  const document = assemble({
    'src/app.ts': `
      const Cam = requireNativeModule('CameraModule');
      Cam.takePhoto();
      requireNativeComponent('PhotoView');
    `,
  });
  assert.equal(document.platform, 'js');
  assert.equal(document.target, 'react-native');
  assert.deepEqual(flat(document), [
    { kind: 'module-import', channel: 'CameraModule', method: undefined, dynamic: false, path: 'src/app.ts' },
    { kind: 'method-invoke', channel: 'CameraModule', method: 'takePhoto', dynamic: false, path: 'src/app.ts' },
    { kind: 'component-require', channel: 'PhotoView', method: undefined, dynamic: false, path: 'src/app.ts' },
  ]);
  // 결과가 소비자 계약을 그대로 통과해야 한다.
  assert.equal(parseBridgeFactsDocument(JSON.parse(JSON.stringify(document))).facts.length, 3);
});

test('상대 import의 default·named·배럴 재수출을 해석해 메서드를 귀속한다', () => {
  const document = assemble({
    'src/specs/camera.ts': "export default requireNativeModule('CameraModule');",
    'src/specs/index.ts': "export { default as Cam } from './camera';",
    'src/feature/screen.ts': `
      import { Cam } from '../specs/index';
      Cam.shoot();
    `,
  });
  assert.deepEqual(flat(document), [
    { kind: 'method-invoke', channel: 'CameraModule', method: 'shoot', dynamic: false, path: 'src/feature/screen.ts' },
    { kind: 'module-import', channel: 'CameraModule', method: undefined, dynamic: false, path: 'src/specs/camera.ts' },
  ]);
});

test('해석 못 한 상대·패키지 import 위의 호출은 한계로만 보고한다', () => {
  const document = assemble({
    'src/a.ts': `
      import Lost from './missing';
      import Pkg from 'some-package';
      Lost.go();
      Pkg.go();
    `,
  });
  assert.deepEqual(flat(document), []);
  assert.equal(document.target, null);
  assert.ok(document.limitations.some((line) => line.startsWith('unattributed-js-relative-calls: 1')));
  assert.ok(document.limitations.some((line) => line.startsWith('unattributed-js-package-calls: 1')));
  // 두 import 모두 스캔이 모듈 바인딩으로 따라가지 못한 값이라 범위 한계의 하한 근거로도 센다.
  const scope = bindingScope(document) ?? '';
  assert.ok(scope.startsWith('js-binding-scope: 0 native module references '), scope);
  assert.ok(scope.includes('lower bound because 2 entries'), scope);
});

/** js-binding-scope 한계 줄을 찾는다. */
function bindingScope(document: ReturnType<typeof assemble>): string | undefined {
  return document.limitations.find((line) => line.startsWith('js-binding-scope:'));
}

test('범위 밖 바인딩이 없으면 js-binding-scope 한계를 싣지 않는다', () => {
  // 모든 모듈 참조가 귀속 호출·추적 바인딩·export·존재 검사로만 쓰이고, 모든 import가 인식한 API이거나
  // 모듈 바인딩으로 해석되면 측정 결과가 0이다 — 고정 문구를 항상 싣던 이전 동작과 달리 한계가 없다.
  const document = assemble({
    'src/specs/NativeCamera.ts': [
      "import type { TurboModule } from 'react-native';",
      "import { TurboModuleRegistry } from 'react-native';",
      'export interface Spec extends TurboModule { shoot(): void; }',
      "export default TurboModuleRegistry.getEnforcing<Spec>('Camera');",
    ].join('\n'),
    'src/camera.ts': [
      "import NativeCamera from './specs/NativeCamera';",
      'export function shoot() { if (NativeCamera) NativeCamera.shoot(); }',
    ].join('\n'),
    'src/flash.ts': [
      "import { NativeModules } from 'react-native';",
      "import { requireNativeModule as load } from 'expo-modules-core';",
      'const { Flash } = NativeModules;',
      'Flash.on();',
      'if (!NativeModules.Torch.level) NativeModules.Torch?.off();',
      "const Lamp = load('Lamp');",
      'export default Lamp;',
    ].join('\n'),
  });
  assert.equal(document.target, 'react-native');
  assert.equal(bindingScope(document), undefined);
  assert.deepEqual(document.limitations, []);
  // 빈 스캔도 범위 밖 바인딩이 없다 — 남는 한계는 빈 스캔 자체다.
  assert.deepEqual(assemble({}).limitations, ['empty-js-scan: no JS/TS source files were scanned']);
});

test('스캔이 따라가지 않는 바인딩으로 넘어간 모듈 참조 수를 js-binding-scope에 싣는다', () => {
  const document = assemble({
    'src/app.ts': [
      "import { NativeModules } from 'react-native';",
      // 삼항의 검사 위치는 값을 소비하지만 결과 위치의 참조는 Calculator로 넘어간다(1).
      'const Calculator = NativeModules.Calculator ? NativeModules.Calculator : fallback;',
      'Calculator.add(1, 2);',
      // 인스턴스 상태(2)·함수 결과(3)·인자(4)·구조 분해(5).
      'class Shooter { constructor() { this.camera = NativeModules.Camera; } }',
      "function loadFlash() { return requireNativeModule('Flash'); }",
      "const Torch = requireNativeModule('Torch');",
      'register(Torch);',
      'const { on } = Torch;',
      // 바인딩이 따라가는 호출은 세지 않고 그대로 귀속한다.
      'Torch.off();',
    ].join('\n'),
  });
  const scope = bindingScope(document) ?? '';
  assert.ok(scope.startsWith('js-binding-scope: 5 native module references '), scope);
  assert.ok(!scope.includes('lower bound'), scope);
  const calls = document.facts.filter((fact) => fact.kind === 'method-invoke');
  assert.deepEqual(calls.map(({ channel, method }) => `${channel}.${method}`), ['Torch.off']);
});

test('해석된 import 이름이 추적을 벗어나면 그 파일에서 센다', () => {
  // 다른 파일의 모듈 바인딩으로 해석된 import도 인자·별칭으로 넘기면 추적을 벗어난다.
  const document = assemble({
    'src/camera.ts': "export default requireNativeModule('Camera');",
    'src/app.ts': [
      "import Camera from './camera';",
      'Camera.shoot();',
      'const Alias = Camera;',
      'attach(Camera);',
    ].join('\n'),
  });
  assert.ok(bindingScope(document)?.startsWith('js-binding-scope: 2 native module references '));
});

test('스캔이 출처를 따라가지 못하는 값이 있으면 0이어도 js-binding-scope를 하한으로 남긴다', () => {
  const document = assemble({
    'src/specs/camera.ts': "export const Camera = requireNativeModule('Camera');",
    'src/specs/index.ts': "export * from './camera';",
    'src/app.ts': [
      // export *는 따라가지 않아 Camera가 모듈인지 알 수 없다(1). 패키지 import(2)·require 결과(3)·동적 import(4).
      "import { Camera } from './specs/index';",
      "import Vision from 'vision-package';",
      "const Legacy = require('./specs/camera');",
      "const lazy = import('./specs/camera');",
      // 인식한 API import와 부작용 전용 require는 출처를 아는 값이라 세지 않는다.
      "import { NativeModules } from 'react-native';",
      "require('./polyfill');",
      'Camera.shoot();',
    ].join('\n'),
  });
  const scope = bindingScope(document) ?? '';
  assert.ok(scope.startsWith('js-binding-scope: 0 native module references '), scope);
  assert.ok(scope.includes('lower bound because 4 entries'), scope);

  // 측정한 이탈과 출처 모름이 함께 있으면 둘 다 싣는다.
  const mixed = assemble({
    'src/app.ts': "import Vision from 'vision-package';\nregister(requireNativeModule('Camera'));",
  });
  const mixedScope = bindingScope(mixed) ?? '';
  assert.ok(mixedScope.startsWith('js-binding-scope: 1 native module references '), mixedScope);
  assert.ok(mixedScope.includes('lower bound because 1 entries'), mixedScope);
});

test('배럴로 다시 내보낸 react-native NativeModules 접근은 조용히 버리지 않고 한계로 센다', () => {
  // 배럴(export * / export { NativeModules } from 'react-native')을 거친 레지스트리는 스캔 파일 하나로는 대역과
  // 구분할 수 없어 레지스트리로 단정하지 않는다. 그래도 사실 없이 사라지면 빈 결과가 청정으로 읽히므로 계수한다.
  for (const barrel of ["export * from 'react-native';", "export { NativeModules } from 'react-native';"]) {
    const document = assemble({
      'src/rn.ts': barrel,
      'src/app.ts': "import { NativeModules } from './rn';\nNativeModules.Camera.open();",
    });
    assert.deepEqual(flat(document), [], barrel);
    assert.ok(document.limitations.some((line) => line.startsWith('unattributed-js-native-modules: 1 ')), barrel);
  }
});

test('동적 이름 사실을 보존하고 계수 한계를 단다', () => {
  const document = assemble({
    'src/dyn.ts': `
      requireNativeModule(name);
      requireNativeComponent(\`View\${x}\`);
      const M = requireNativeModule('Static');
      M[key]();
    `,
  });
  assert.deepEqual(flat(document), [
    { kind: 'module-import', channel: 'name', method: undefined, dynamic: true, path: 'src/dyn.ts' },
    { kind: 'component-require', channel: '`View${x}`', method: undefined, dynamic: true, path: 'src/dyn.ts' },
    { kind: 'module-import', channel: 'Static', method: undefined, dynamic: false, path: 'src/dyn.ts' },
    { kind: 'method-invoke', channel: 'Static', method: 'key', dynamic: true, path: 'src/dyn.ts' },
  ]);
  for (const prefix of ['dynamic-module-names: 1', 'dynamic-component-names: 1', 'dynamic-method-names: 1']) {
    assert.ok(document.limitations.some((line) => line.startsWith(prefix)), prefix);
  }
});

test('import type과 미바인딩 호출은 사실을 만들지 않는다', () => {
  const document = assemble({
    'src/spec.ts': 'import type { Spec } from "./x";\nSpec.call();',
    'src/free.ts': 'loose.call();\nrequireNativeModule',
  });
  assert.deepEqual(flat(document), []);
});

test('default와 네임스페이스를 함께 가져온 default 이름도 해석해 귀속한다', () => {
  const document = assemble({
    'src/camera.ts': "export default requireNativeModule('Camera');",
    'src/app.ts': "import Camera, * as Everything from './camera';\nCamera.shoot();",
  });
  assert.deepEqual(document.facts.filter((fact) => fact.kind === 'method-invoke')
    .map(({ channel, method, location }) => [channel, method, location?.path]), [['Camera', 'shoot', 'src/app.ts']]);
});

test('CommonJS export를 통해 default 바인딩을 해석한다', () => {
  const document = assemble({
    'src/cjs.js': "module.exports = requireNativeModule('CjsMod');",
    'src/use.js': `
      import Cjs from './cjs';
      Cjs.run();
    `,
  });
  assert.deepEqual(flat(document), [
    { kind: 'module-import', channel: 'CjsMod', method: undefined, dynamic: false, path: 'src/cjs.js' },
    { kind: 'method-invoke', channel: 'CjsMod', method: 'run', dynamic: false, path: 'src/use.js' },
  ]);
});

test('여러 파일의 사실 순서와 위치별 중복 보존이 결정적이다', () => {
  const files = {
    'src/b.ts': "requireNativeModule('B');",
    'src/a.ts': "requireNativeModule('A');\nrequireNativeModule('A');",
  };
  const first = flat(assemble(files));
  const second = flat(assemble(files));
  assert.deepEqual(first, second);
  // 같은 호출이라도 호출 위치가 다르면 별개의 근거다.
  assert.deepEqual(first, [
    { kind: 'module-import', channel: 'A', method: undefined, dynamic: false, path: 'src/a.ts' },
    { kind: 'module-import', channel: 'A', method: undefined, dynamic: false, path: 'src/a.ts' },
    { kind: 'module-import', channel: 'B', method: undefined, dynamic: false, path: 'src/b.ts' },
  ]);
});

test('여러 파일의 사실은 로캘과 무관한 UTF-16 코드 단위 경로 순서다', () => {
  // 로캘 정렬이면 en-US·sv-SE·cs-CZ·da-DK마다 대소문자·ä·ch·aa 위치가 달라진다.
  const paths = ['src/h.ts', 'src/ä.ts', 'src/chat.ts', 'src/aa.ts', 'src/a.ts', 'src/B.ts'];
  const document = assemble(Object.fromEntries(paths.map((path) => [path, "requireNativeModule('M');"])));
  assert.deepEqual(
    document.facts.map((fact) => fact.location?.path),
    ['src/B.ts', 'src/a.ts', 'src/aa.ts', 'src/chat.ts', 'src/h.ts', 'src/ä.ts'],
  );
});

test('Expo 모듈 API 별칭 반환값의 호출과 optional 계약을 보존한다', () => {
  for (const [api, specifier, optional] of [
    ['requireNativeModule', 'expo', undefined],
    ['requireOptionalNativeModule', 'expo-modules-core', true],
  ] as const) {
    const document = assemble({
      'src/app.ts': `import { ${api} as loadModule } from '${specifier}';\nconst Camera = loadModule<Spec>('Camera');\nCamera.shoot();`,
    });
    const parsed = parseBridgeFactsDocument(JSON.parse(JSON.stringify(document)));
    assert.equal(parsed.facts.length, 2);
    assert.equal(parsed.facts[0]?.mechanism, 'expo');
    assert.equal(parsed.facts[0]?.optional, optional);
    assert.deepEqual(parsed.facts[1], {
      kind: 'method-invoke', channel: 'Camera', method: 'shoot', dynamic: false,
      location: { path: 'src/app.ts', line: 3, column: 8 },
    });
  }
});

test('Expo 별칭의 동적 반환값 호출과 상대 재수출을 보존한다', () => {
  const document = assemble({
    'src/module.ts': "import { requireNativeModule as loadModule } from 'expo';\nexport default loadModule('Camera');",
    'src/app.ts': "import Camera from './module';\nCamera.shoot();",
    'src/dynamic.ts': "import { requireNativeModule as loadModule } from 'expo';\nconst Camera = loadModule(name);\nCamera[key]();",
  });
  const calls = document.facts.filter((fact) => fact.kind === 'method-invoke');
  assert.deepEqual(calls.map(({ channel, method, dynamic }) => ({ channel, method, dynamic })), [
    { channel: 'Camera', method: 'shoot', dynamic: false },
    { channel: 'name', method: 'key', dynamic: true },
  ]);
  assert.equal(parseBridgeFactsDocument(JSON.parse(JSON.stringify(document))).facts.length, 4);
});

test('불확실한 Expo 별칭 초기값은 메서드에 귀속하지 않는다', () => {
  for (const source of [
    "import { requireNativeModule as loadModule } from './helper'; const Camera = loadModule('Camera'); Camera.shoot();",
    "import { requireNativeViewManager as loadModule } from 'expo'; const Camera = loadModule('Camera'); Camera.shoot();",
    "import { requireNativeModule as loadModule } from 'expo'; function wrap(loadModule) { const Camera = loadModule('Camera'); Camera.shoot(); }",
    "import { requireNativeModule as loadModule } from 'expo'; loadModule = factory; const Camera = loadModule('Camera'); Camera.shoot();",
    "import { requireNativeModule as loadModule } from 'expo'; const Camera = loadModule('Camera'); loadModule = factory; Camera.shoot();",
    "import { requireNativeModule as loadModule } from 'expo'; const Camera = loadModule('Camera').property; Camera.shoot();",
    "import { requireNativeModule as loadModule } from 'expo'; const Camera = loadModule('Camera'); Camera = other; Camera.shoot();",
    "import { requireNativeModule as loadModule } from 'expo'; const Camera = loadModule('Camera'); function wrap(Camera) { Camera.shoot(); }",
    "import { requireNativeModule as loadModule } from 'expo'; function wrap() { const loadModule = factory; const Camera = loadModule('Camera'); Camera.shoot(); }",
    "import { requireNativeModule as loadModule } from 'expo'; function wrap(helpers) { const { loadModule } = helpers; const Camera = loadModule('Camera'); Camera.shoot(); }",
    "import { requireNativeModule as loadModule } from 'expo'; function wrap(helpers) { const { factory: loadModule } = helpers; const Camera = loadModule('Camera'); Camera.shoot(); }",
    "import { requireNativeModule as loadModule } from 'expo'; function wrap(helpers) { const [loadModule] = helpers; const Camera = loadModule('Camera'); Camera.shoot(); }",
    "import { requireNativeModule as loadModule } from 'expo'; function wrap(loadModule): void { const Camera = loadModule('Camera'); Camera.shoot(); }",
  ]) {
    const document = assemble({ 'src/app.ts': source });
    assert.deepEqual(document.facts.filter((fact) => fact.kind === 'method-invoke'), [], source);
  }
});

test('Expo mechanism이 조립된 문서 사실까지 보존된다', () => {
  const document = assemble({
    'src/app.ts': `
      import { requireNativeModule, requireNativeViewManager } from 'expo-modules-core';
      requireNativeModule('CameraModule');
      requireNativeViewManager('PhotoView');
      requireNativeComponent('CoreView');
    `,
  });

  const mechanisms = document.facts.map((fact) => [
    fact.kind,
    fact.channel,
    fact.mechanism ?? null,
  ]);
  assert.deepEqual(mechanisms, [
    ['module-import', 'CameraModule', 'expo'],
    ['component-require', 'PhotoView', 'expo'],
    ['component-require', 'CoreView', null],
  ]);

  // 조립 산출물이 계약 파서를 그대로 통과한다.
  const reparsed = parseBridgeFactsDocument(JSON.parse(JSON.stringify(document)));
  assert.equal(reparsed.facts[0]?.mechanism, 'expo');
});

test('출처를 모르는 객체의 NativeModules 속성 접근은 레지스트리로 읽지 않고 한계로 센다', () => {
  const document = assemble({ 'src/app.ts': 'foo.bar.NativeModules.Camera.open();\nfoo.NativeModules.Torch.on();' });
  assert.deepEqual(flat(document), []);
  assert.ok(document.limitations.some((line) => line.startsWith('unattributed-js-native-modules: 2 ')));
});

test('타입 주석만 있는 선언 뒤의 모듈 선언은 앞 이름이 아니라 제 이름으로 귀속된다', () => {
  // 리뷰 재현: 전에는 timer.cancel()이 거짓 Haptics.cancel이 되고 Haptics.impact()는 빠졌으며, 잘못 묶인 초기값이
  // "추적됨"으로 분류돼 한계도 사라졌다.
  const document = assemble({
    'src/a.ts': "let timer: Timer\nconst Haptics = requireNativeModule('Haptics')\nexport function f() { timer.cancel(); Haptics.impact() }\n",
  });
  assert.deepEqual(document.facts.map(({ kind, channel, method }) => [kind, channel, method ?? null]),
    [['module-import', 'Haptics', null], ['method-invoke', 'Haptics', 'impact']]);
});

test('import 문이 아닌 import 낱말과 템플릿 보간은 사실을 삼키지 않고, 읽지 못한 부분은 범위 한계로 센다', () => {
  const camera = [['module-import', 'Camera', null], ['method-invoke', 'Camera', 'open']];
  // import.meta·객체 키·JSX 낱말의 `import`가 import 문처럼 문자열까지 이어져 뒤의 NativeModules 사실을 삼켰다(리뷰 S3a).
  for (const [source, untraced] of [
    ['const env = import.meta.env\nNativeModules.Camera.open()\n', 0],
    ['const x = { import: X }\nNativeModules.Camera.open()\n', 0],
    ['const v = <Text>import</Text>\nNativeModules.Camera.open()\n', 1],
  ] as const) {
    const document = assemble({ 'src/a.tsx': source });
    assert.deepEqual(document.facts.map(({ kind, channel, method }) => [kind, channel, method ?? null]), camera, source);
    const scope = bindingScope(document);
    if (untraced === 0) assert.equal(scope, undefined, source);
    else assert.ok(scope?.includes(`lower bound because ${untraced} entries`), scope);
  }
  // 문장 자리의 그 낱말을 import 문으로 읽어 뒤 문자열까지 삼키지 않는다 — 뒤 선언도 바인딩으로 수집한다.
  const bound = assemble({
    'src/a.tsx': "function Hint() {\n  return (\n    <Text>\n      import\n    </Text>\n  )\n}\n"
      + "const Cam = requireNativeModule('Cam')\nCam.take()\n",
  });
  assert.deepEqual(bound.facts.map(({ kind, channel, method }) => [kind, channel, method ?? null]),
    [['module-import', 'Cam', null], ['method-invoke', 'Cam', 'take']]);
  // 템플릿 보간 안은 읽지 않는다 — 브리지 API를 언급하는 보간은 범위 한계의 하한 근거로 센다(리뷰 S3b).
  const template = assemble({ 'src/a.ts': 'const s = `${NativeModules.Camera.getName()}`\n' });
  assert.deepEqual(template.facts, []);
  assert.ok(bindingScope(template)?.includes('lower bound because 1 entries'), bindingScope(template));
  // 쉼표가 든 제네릭 호출 인수는 선언자 목록이 아니다 — 뒤 객체 리터럴을 구조 분해 패턴으로 읽지 않는다(리뷰 S3c).
  for (const source of [
    'const api = useMemo<Record<string, unknown>>(() => ({ cam: NativeModules.Camera }), [])\nNativeModules.Torch.on()\n',
    'const pick = <T,>(value: T) => ({ first: 1, NativeModules })\nNativeModules.Torch.on()\n',
  ]) {
    const document = assemble({ 'src/a.tsx': source });
    assert.deepEqual(document.facts.filter((fact) => fact.channel === 'Torch').map(({ kind }) => kind),
      ['module-import', 'method-invoke'], source);
  }
});

test('Babel 기본 import 변환(_interopRequireDefault)의 .default.NativeModules도 react-native 레지스트리로 읽는다', () => {
  // 리뷰 S4: main은 체인 홀짝 덕에 읽었고 이 브랜치는 출처 모름으로 셌다.
  for (const source of [
    "var _reactNative = _interopRequireDefault(require('react-native'));\n_reactNative.default.NativeModules.Camera.open();\n",
    'const react_native_1 = __importDefault(require("react-native"));\nreact_native_1.default.NativeModules.Camera.open();\n',
    "var _reactNative = _interopRequireWildcard(require('react-native'));\n_reactNative.NativeModules.Camera.open();\n",
  ]) {
    const document = assemble({ 'src/a.js': source });
    assert.deepEqual(document.facts.map(({ kind, channel, method }) => [kind, channel, method ?? null]),
      [['module-import', 'Camera', null], ['method-invoke', 'Camera', 'open']], source);
    assert.ok(!document.limitations.some((line) => line.startsWith('unattributed-js-native-modules:')), source);
  }
  // 다른 모듈의 interop 결과는 react-native가 아니다. 기본 export가 모듈 객체인 것은 react-native뿐이라, Expo 패키지의
  // 기본 변환 `.default` 아래 조회도 ES 기본 import(`import Core from 'expo-modules-core'`)처럼 읽지 않고 센다.
  for (const source of [
    "var _shim = _interopRequireDefault(require('./shim'));\n_shim.default.NativeModules.Camera.open();\n",
    "var _core = _interopRequireDefault(require('expo-modules-core'));\n_core.default.requireNativeModule('Camera');\n",
  ]) {
    const other = assemble({ 'src/a.js': source });
    assert.deepEqual(other.facts, [], source);
    assert.ok(other.limitations.some((line) => line.startsWith('unattributed-js-native-modules: 1 ')), source);
  }
  // Expo 패키지의 네임스페이스 변환은 모듈 객체다.
  const wildcard = assemble({ 'src/a.js': "var _core = _interopRequireWildcard(require('expo-modules-core'));\n_core.requireNativeModule('Camera');\n" });
  assert.deepEqual(wildcard.facts.map(({ channel, mechanism }) => [channel, mechanism ?? null]), [['Camera', 'expo']]);
});

test('속성 자리 브리지 API 호출은 패키지 멤버 호출로 겹쳐 세지 않는다', () => {
  // 리뷰 N2: 속성 자리 판정이 사실로 읽거나 출처 모름으로 센 호출을 unattributed-js-package-calls에도 셌다.
  const read = assemble({ 'src/a.ts': "import RN from 'react-native';\nRN.requireNativeComponent('View');\n" });
  assert.deepEqual(read.facts.map(({ kind, channel }) => [kind, channel]), [['component-require', 'View']]);
  assert.ok(!read.limitations.some((line) => line.startsWith('unattributed-js-package-calls:')), read.limitations.join('\n'));
  const counted = assemble({ 'src/a.ts': "import Core from 'expo-modules-core';\nCore.requireNativeModule('X');\n" });
  assert.ok(counted.limitations.some((line) => line.startsWith('unattributed-js-native-modules: 1 ')));
  assert.ok(!counted.limitations.some((line) => line.startsWith('unattributed-js-package-calls:')), counted.limitations.join('\n'));
});

/** 사실을 `종류 채널.메서드@줄` 문자열로 줄여 비교한다. */
function factLines(document: ReturnType<typeof assemble>): string[] {
  return document.facts.map((fact) =>
    `${fact.kind} ${fact.channel}${fact.method === undefined ? '' : `.${fact.method}`}@${fact.location?.line}`);
}

test('형제 함수·블록·메서드가 같은 이름을 다른 모듈에 묶으면 호출을 각자의 모듈로 귀속한다', () => {
  // 바인딩 지도가 파일 전역이던 때는 마지막 선언이 이겨 앞 함수의 호출이 거짓 모듈(B.x)로 귀속됐다.
  const document = assemble({
    'src/a.js': [
      "import { NativeModules } from 'react-native';",
      'function A() { const M = NativeModules.A; M.x(); }',
      'function B() { const M = NativeModules.B; M.y(); }',
      'if (ready) { const S = NativeModules.C; S.z(); } else { const S = NativeModules.D; S.w(); }',
      'class Panel { open() { let P = NativeModules.E; P.p(); } close() { let P = NativeModules.F; P.q(); } }',
      // Babel 출력처럼 함수마다 var로 다시 선언해도 함수 본문이 범위다.
      'function C() { var V = NativeModules.G; V.g(); }',
      'function D() { var V = NativeModules.H; V.h(); }',
    ].join('\n'),
  });
  assert.deepEqual(factLines(document).filter((line) => line.startsWith('method-invoke')), [
    'method-invoke A.x@2',
    'method-invoke B.y@3',
    'method-invoke C.z@4',
    'method-invoke D.w@4',
    'method-invoke E.p@5',
    'method-invoke F.q@5',
    'method-invoke G.g@6',
    'method-invoke H.h@7',
  ]);
  // 모든 초기값이 그 범위의 바인딩으로 추적되므로 범위 밖 참조가 없다.
  assert.equal(bindingScope(document), undefined);
});

test('형제 함수의 같은 이름 문자열 상수는 각자의 범위에서만 모듈 이름이 된다', () => {
  const document = assemble({
    'src/a.js': [
      "import { requireNativeModule } from 'expo-modules-core';",
      "function a() { const name = 'Alpha'; requireNativeModule(name).go(); }",
      "function b() { const name = 'Beta'; requireNativeModule(name).go(); }",
    ].join('\n'),
  });
  assert.deepEqual(factLines(document), [
    'module-import Alpha@2',
    'method-invoke Alpha.go@2',
    'module-import Beta@3',
    'method-invoke Beta.go@3',
  ]);
});

test('안쪽 범위의 같은 이름 선언은 바깥 모듈 바인딩과 import를 가린다', () => {
  // 안쪽 M·Cam은 모듈이 아닌 값이다. 전에는 안쪽 선언을 무시하고 바깥 바인딩·import로 귀속해 거짓 호출을 냈다.
  const document = assemble({
    'src/cam.js': "import { NativeModules } from 'react-native';\nexport default NativeModules.Camera;",
    'src/app.js': [
      "import { NativeModules } from 'react-native';",
      "import Cam from './cam';",
      'const M = NativeModules.Outer;',
      'function run() { const M = makeFake(); M.fake(); }',
      'function shoot() { const Cam = makeFake(); Cam.fake(); }',
      'for (const M of fakes) { M.fake(); }',
      'M.real();',
      'Cam.open();',
    ].join('\n'),
  });
  assert.deepEqual(factLines(document).filter((line) => line.startsWith('method-invoke')), [
    'method-invoke Outer.real@7',
    'method-invoke Camera.open@8',
  ]);
  // 안쪽 Cam의 호출은 import 위 호출이 아니다 — 해석하지 못한 import 위 호출로도 세지 않는다.
  const unresolved = assemble({
    'src/app.js': "import Cam from './missing';\nfunction shoot() { const Cam = makeFake(); Cam.fake(); }\nCam.open();",
  });
  assert.ok(unresolved.limitations.includes(
    'unattributed-js-relative-calls: 1 member calls on imports that did not resolve inside the scanned file set '
    + 'could not be attributed to a module name'), unresolved.limitations.join('\n'));
});

test('같은 함수에서 다른 모듈로 다시 선언되거나 블록 밖에서 쓰인 var는 귀속하지 않고 범위 밖 참조로 센다', () => {
  for (const [source, expectedScope] of [
    // 다시 선언한 var는 같은 변수다 — M.x()는 A일 수도 B일 수도 있다. 두 초기값이 추적되지 않는다(2).
    ['function f(c) {\n  var M = NativeModules.A;\n  if (c) { var M = NativeModules.B; }\n  M.x();\n}', 2],
    // 블록 밖의 같은 함수 위치에서는 값이 정해지지 않는다 — 귀속하지 않는 쓰임을 센다(1).
    ['function f(c) {\n  if (c) { var M = NativeModules.A; }\n  M.x();\n}', 1],
    // 끌어올린 var는 함수 전체에서 바깥 이름을 가린다 — 바깥 Outer로 귀속하지 않는다.
    ['const M = NativeModules.Outer;\nfunction f(c) {\n  if (c) { var M = makeFake(); }\n  M.fake();\n}\nM.real();', 0],
    // 본문이 블록이 아닌 for 머리 선언은 본문 끝을 찾지 않고 감싼 블록 끝까지 가린다 — 가린 바깥 모듈의 쓰임을 센다(2).
    ['const M = NativeModules.Outer;\nfor (const M of fakes) M.fake();\nM.real();', 2],
  ] as const) {
    const document = assemble({ 'src/a.js': source });
    const calls = factLines(document).filter((line) => line.startsWith('method-invoke'));
    assert.deepEqual(calls, source.includes('M.real();') && expectedScope === 0 ? ['method-invoke Outer.real@6'] : [],
      source);
    const scope = bindingScope(document);
    if (expectedScope === 0) assert.equal(scope, undefined, source);
    else assert.ok(scope?.startsWith(`js-binding-scope: ${expectedScope} native module references `), `${source}\n${scope}`);
  }
});

test('선언 초기값의 함수 본문 안 선언을 수집해 함수형 컴포넌트·훅의 호출을 귀속한다', () => {
  // 전에는 `const Screen = () => { … }`의 본문을 건너뛰어 그 안의 바인딩 호출이 귀속되지 않았고, 본문 안 구조 분해는
  // module-import 사실도 내지 않았다.
  const document = assemble({
    'src/Screen.tsx': [
      "import { NativeModules } from 'react-native';",
      'const Screen = () => {',
      '  const Camera = NativeModules.Camera;',
      '  const { Torch } = NativeModules;',
      '  const onPress = useCallback(() => { const Flash = NativeModules.Flash; Flash.fire(); Torch.on(); }, []);',
      '  Camera.take();',
      '  return null;',
      '};',
      'export const useVibrate = () => { const Haptics = NativeModules.Haptics; return () => Haptics.buzz(); };',
    ].join('\n'),
  });
  assert.deepEqual(factLines(document), [
    'module-import Camera@3',
    'module-import Torch@4',
    'module-import Flash@5',
    'method-invoke Flash.fire@5',
    'method-invoke Torch.on@5',
    'method-invoke Camera.take@6',
    'module-import Haptics@9',
    'method-invoke Haptics.buzz@9',
  ]);
  assert.equal(bindingScope(document), undefined);
  // 본문 안의 대역 선언도 그 본문에서만 전역 레지스트리를 가린다 — 전에는 본문을 읽지 않아 대역 접근이 거짓 Fake
  // 사실이 됐다.
  const shim = assemble({
    'src/setup.js': 'const setup = () => { const NativeModules = mockModules(); NativeModules.Fake.x(); };\nNativeModules.Camera.take();',
  });
  assert.deepEqual(factLines(shim), ['module-import Camera@2', 'method-invoke Camera.take@2']);
});

test('범위 밖 참조는 그 위치의 이름이 모듈 바인딩일 때만 센다', () => {
  // 다른 함수의 같은 이름은 그 위치의 모듈 값이 아니다 — 전에는 파일 전역 이름으로 보고 b의 인자도 셌다.
  const document = assemble({
    'src/a.js': [
      "import { NativeModules } from 'react-native';",
      'function a() { const M = NativeModules.A; register(M); }',
      'function b() { register(M); }',
    ].join('\n'),
  });
  assert.ok(bindingScope(document)?.startsWith('js-binding-scope: 1 native module references '), bindingScope(document));
});

test('한 함수의 NativeModules·조회 API 대역 선언은 다른 위치의 전역 해석을 바꾸지 않는다', () => {
  // import 없이 전역 레지스트리를 읽는 파일이다. 대역 선언은 그 함수 안에서만 레지스트리·Expo 조회 API를 가린다.
  // 로컬 대역 조회 함수의 호출도 이름 경계 사실(Fake)은 그대로 내고 해석 경로(mechanism)만 생략한다(기존 규칙).
  const document = assemble({
    'src/a.js': [
      'function setup() { const NativeModules = mockModules(); NativeModules.Fake.x(); }',
      'function helper() { const requireNativeModule = fakeLoader; requireNativeModule("Fake"); }',
      'NativeModules.Camera.take();',
      "requireNativeModule('Haptics');",
    ].join('\n'),
  });
  assert.deepEqual(document.facts.map((fact) =>
    `${fact.kind} ${fact.channel}${fact.method === undefined ? '' : `.${fact.method}`} ${fact.mechanism ?? '-'}`), [
    'module-import Fake -',
    'module-import Camera -',
    'method-invoke Camera.take -',
    'module-import Haptics expo',
  ]);
  // react-native import가 있어도 안쪽 대역 선언이 이긴다 — 전에는 대역의 선언자 이름을 베어 레지스트리 사실로,
  // 대역의 접근을 거짓 Fake 사실로 냈다.
  const imported = assemble({
    'src/b.js': [
      "import { NativeModules } from 'react-native';",
      'function setup() { const NativeModules = mockModules(); NativeModules.Fake.x(); }',
      'NativeModules.Camera.take();',
    ].join('\n'),
  });
  assert.deepEqual(factLines(imported), ['module-import Camera@3', 'method-invoke Camera.take@3']);
});

test('매개변수·로컬 대역·다른 모듈의 NativeModules에서 구조 분해한 이름은 모듈이 아니다', () => {
  // 리뷰 재현 k01·k02: 구조 분해가 원천 이름만 보고 그 위치의 레지스트리인지 묻지 않아, 초기값 본문을 읽게 되면서
  // 대역의 Fake1·Fake3가 거짓 사실이 됐다(함수 선언 매개변수 Fake2는 main부터 거짓 사실이었다).
  const standIns = assemble({
    'src/a.js': [
      'const setup = (NativeModules) => { const { Fake1 } = NativeModules; Fake1.x(); };',
      'const setup3 = () => { const NativeModules = mockModules(); const { Fake3 } = NativeModules; Fake3.x(); };',
      'function setup2(NativeModules) { const { Fake2 } = NativeModules; Fake2.x(); }',
    ].join('\n'),
    'src/b.js': [
      "import { NativeModules } from 'react-native';",
      "jest.mock('react-native', () => { const NativeModules = { Fake: {} }; const { Fake } = NativeModules; Fake.x(); });",
      'const { Camera } = NativeModules;',
      'Camera.take();',
    ].join('\n'),
  });
  assert.deepEqual(factLines(standIns), ['module-import Camera@3', 'method-invoke Camera.take@4']);
  // 다른 모듈(배럴·대역)에서 가져온 NativeModules의 구조 분해는 멤버 접근처럼 꺼낸 이름마다 센다.
  const barrel = assemble({ 'src/a.js': "import { NativeModules } from './shim';\nconst { Cam, Torch } = NativeModules;\nCam.take();" });
  assert.deepEqual(barrel.facts, []);
  assert.ok(barrel.limitations.some((line) => line.startsWith('unattributed-js-native-modules: 2 ')), barrel.limitations.join('\n'));
  // 레지스트리의 중첩 구조 분해는 바깥 키만 모듈이다 — 안쪽 이름은 모듈 값을 다시 꺼낸 것이라 센다. 계산 키는 동적 사실이다.
  const nested = assemble({
    'src/a.js': [
      "import { NativeModules } from 'react-native';",
      'const { Camera: { take }, [name]: Dyn } = NativeModules;',
      'take(); Dyn.go(); Camera.open();',
    ].join('\n'),
  });
  assert.deepEqual(nested.facts.map((fact) => `${fact.kind} ${fact.channel}${fact.method === undefined ? '' : `.${fact.method}`} ${fact.dynamic}`), [
    'module-import Camera false',
    'module-import name true',
    'method-invoke name.go true',
  ]);
  assert.ok(bindingScope(nested)?.startsWith('js-binding-scope: 1 native module references '), bindingScope(nested));
});

test('선언자 모양이 아닌 const·let 낱말과 패턴 안 키·타입은 바깥 바인딩을 가리지 않는다', () => {
  // 리뷰 재현 l03·h01·l02·c01c: `as const,`·`const enum`·JSX 글자 `let you know … {…}`·중첩 패턴의 키·패턴의 타입 주석을
  // 선언으로 읽어 같은 이름의 바깥 Haptics를 가렸고, 참 호출이 한계 없이 사라졌다.
  const document = assemble({
    'src/a.tsx': [
      "import { NativeModules } from 'react-native';",
      'const { Haptics } = NativeModules;',
      "export const useFeedback = () => { register('native' as const, Haptics); Haptics.trigger(); };",
      'export function useSettingsFeedback() { const { Haptics: { enabled } } = useSettings(); if (enabled) Haptics.buzz(); }',
      'const enum Feature { Haptics, Camera }',
      'export const Other = () => { Haptics.tick(); return <Text>We will let you know when {Haptics.label} is ready</Text>; };',
      'function annotated() { const { a }: { Haptics?: boolean } = props; Haptics.tap(); }',
      // 줄 끝 `as const`·속성 `obj.var` 뒤 줄의 낱말 문장도 선언자가 아니다(ASI로 선언자처럼 보인다).
      'export function asserted() { register(Haptics)',
      '  options as const',
      '  Haptics',
      '  Haptics.ping()',
      '  config.var',
      '  Haptics',
      '  Haptics.pong() }',
    ].join('\n'),
  });
  assert.deepEqual(factLines(document).filter((line) => line.startsWith('method-invoke')), [
    'method-invoke Haptics.trigger@3',
    'method-invoke Haptics.buzz@4',
    'method-invoke Haptics.tick@6',
    'method-invoke Haptics.tap@7',
    'method-invoke Haptics.ping@11',
    'method-invoke Haptics.pong@14',
  ]);
  // 배열 구조 분해·중첩 패턴 안 이름은 선언이라 바깥 바인딩을 가린다(전에는 거짓 Foo.go가 났다).
  const patterns = assemble({
    'src/b.js': [
      "import { NativeModules } from 'react-native';",
      'const M = NativeModules.Foo;',
      'function a() { const [M] = useState(); M.go(); }',
      'function c() { const { x: { M } } = props; M.go(); }',
      'M.go();',
    ].join('\n'),
  });
  assert.deepEqual(factLines(patterns).filter((line) => line.startsWith('method-invoke')), ['method-invoke Foo.go@5']);
});

test('본문이 블록이 아닌 for 머리 선언 뒤의 재대입은 바깥 바인딩도 지운다', () => {
  // 리뷰 재현 g01: 넓게 잡힌 루프 변수가 마지막 대입을 가로채 바깥 M이 살아 남아 거짓 A.go가 났다.
  const document = assemble({
    'src/a.js': [
      "import { NativeModules } from 'react-native';",
      'let M = NativeModules.A;',
      'function useIt() { M.go(); }',
      'for (const M of xs) foo(M);',
      'M = NativeModules.B;',
    ].join('\n'),
  });
  assert.deepEqual(factLines(document).filter((line) => line.startsWith('method-invoke')), []);
  // 앞에 선언된 함수 본문의 대입도 뒤 선언의 바인딩을 지운다.
  const earlier = assemble({
    'src/b.js': "import { NativeModules } from 'react-native';\nfunction reset() { M = other(); }\nlet M = NativeModules.A;\nM.go();",
  });
  assert.deepEqual(factLines(earlier).filter((line) => line.startsWith('method-invoke')), []);
  assert.ok(bindingScope(earlier)?.startsWith('js-binding-scope: 1 native module references '), bindingScope(earlier));
});

test('제네릭·반환 타입·메서드 함수 본문의 var는 그 함수 안에만 있고 바깥 블록 선언과 섞이지 않는다', () => {
  // 리뷰 재현 g02·g04·g03·b01: 함수 본문을 알아보지 못해 var가 안쪽 let/const 블록 너머로 넓어졌고, 진실이 B.go인 호출이
  // 거짓 A.go가 됐다. 매개변수도 같은 형태에서 알아보지 못해 바깥 바인딩을 가리지 못했다.
  const document = assemble({
    'src/a.ts': [
      "import { NativeModules } from 'react-native';",
      '{',
      '  const M = NativeModules.A;',
      '  function pick<T>(x: T) { var M = NativeModules.B; M.go(); }',
      '  function g(): void { var M = NativeModules.C; M.ok(); }',
      '  const cb = function (): void { var M = makeFake(); M.fake2(); };',
      '  function shadow<T>(M: T): Promise<{ a: 1 }> { M.param(); }',
      '  const arrow = (M): number => { M.param2(); };',
      // 조건 반환 타입 함수의 본문에서도 var는 그 본문 너머로 넓어지지 않는다.
      '  function cond<T>(x: T): T extends string ? A : B { var M = NativeModules.D; M.cond(); }',
      '  M.run();',
      '}',
    ].join('\n'),
  });
  assert.deepEqual(factLines(document).filter((line) => line.startsWith('method-invoke')), [
    'method-invoke B.go@4',
    'method-invoke C.ok@5',
    'method-invoke D.cond@9',
    'method-invoke A.run@10',
  ]);
  // 메서드 약칭 본문은 뒤 `{`로만 추론한 함수 본문이다 — 그 안 var의 범위를 정하지 못해, var와 바깥 블록 선언 사이의
  // 같은 이름 쓰임을 귀속하지 않고 센다(3차 리뷰 원칙: 토큰이 보이지 않는 분류는 잠정이다).
  const method = assemble({
    'src/c.ts': [
      "import { NativeModules } from 'react-native';",
      '{',
      '  const M = NativeModules.A;',
      '  class Svc { start(): void { var M = makeFake(); M.fake(); } }',
      '  M.run();',
      '}',
    ].join('\n'),
  });
  assert.deepEqual(factLines(method).filter((line) => line.startsWith('method-invoke')), []);
  // M.fake(그 블록이 함수 본문이 아니면 바깥 블록의 A)·M.run 둘이다.
  assert.ok(bindingScope(method)?.startsWith('js-binding-scope: 2 native module references '), bindingScope(method));
  // 알아본 함수 본문의 블록 안 var는 그 함수 전체를 확실히 가린다 — 바깥 A를 정하지 못한 쓰임으로 세지 않는다.
  const exact = assemble({
    'src/b.ts': [
      "import { NativeModules } from 'react-native';",
      '{',
      '  const M = NativeModules.A;',
      '  function pick<T>(x: T) { if (c) { var M = makeFake(); } M.fake(); }',
      '  function g(): void { if (c) { var M = makeFake(); } M.fake2(); }',
      '  M.run();',
      '}',
    ].join('\n'),
  });
  assert.deepEqual(factLines(exact).filter((line) => line.startsWith('method-invoke')), ['method-invoke A.run@6']);
  assert.equal(bindingScope(exact), undefined);
});

test('본문이 블록이 아닌 for 머리 선언이 import를 가리면 귀속하지 않고 센다', () => {
  // 리뷰 지적 e01: 넓게 잡힌 가림 너머의 import 호출이 한계 없이 사라졌다.
  const document = assemble({
    'src/cam.js': "import { NativeModules } from 'react-native';\nexport default NativeModules.Camera;",
    'src/app.js': "import Cam from './cam';\nfor (const Cam of fakes) Cam.fake();\nCam.open();\nregister(Cam);",
  });
  assert.deepEqual(factLines(document), ['module-import Camera@2']);
  assert.ok(bindingScope(document)?.startsWith('js-binding-scope: 3 native module references '), bindingScope(document));
});

test('매개변수 함수 안쪽 본문의 같은 이름 선언은 매개변수를 가린다', () => {
  // 리뷰 지적 j01·j02: 매개변수 가림이 안쪽 선언보다 먼저 판정돼 참 A.go가 한계 없이 사라졌다.
  const document = assemble({
    'src/a.js': [
      "import { NativeModules } from 'react-native';",
      'function Screen(M) {',
      '  const run = () => { const M = NativeModules.A; M.go(); };',
      '  function later() { const M = NativeModules.B; M.go(); }',
      '  M.param();',
      '}',
    ].join('\n'),
  });
  assert.deepEqual(factLines(document).filter((line) => line.startsWith('method-invoke')), ['method-invoke A.go@3', 'method-invoke B.go@4']);
});

test('로컬 모듈 바인딩이 차지한 위치의 호출은 해석하지 못한 import 호출로 세지 않는다', () => {
  // 리뷰 지적 i01: 이 계수 변경(2 → 1)을 고정하는 테스트가 없었다.
  const document = assemble({
    'src/a.js': [
      "import { NativeModules } from 'react-native';",
      "import Cam from './missing';",
      'function f() { const Cam = NativeModules.Camera; Cam.take(); }',
      'Cam.open();',
    ].join('\n'),
  });
  assert.deepEqual(factLines(document), ['module-import Camera@3', 'method-invoke Camera.take@3']);
  assert.ok(document.limitations.includes('unattributed-js-relative-calls: 1 member calls on imports that did not '
    + 'resolve inside the scanned file set could not be attributed to a module name'), document.limitations.join('\n'));
});

test('종류를 정하지 못한 블록의 var는 함수 본문까지 끌어올리고 블록 밖 쓰임을 바깥 바인딩에 귀속하지 않고 센다', () => {
  // 2차 리뷰 n14·n02·n15: `case` 절·라벨·`}`·ASI 줄 뒤 블록의 var가 그 블록에만 있다고 보아, 같은 함수의 블록 뒤
  // 쓰임이 바깥 A로 거짓 귀속됐다. var는 함수 범위다 — `case` 절 블록은 블록이 확실해 var가 함수 전체를 가리고
  // (사실도 계수도 없다), 라벨·`}`·ASI 줄·호출 줄 뒤 블록은 함수 본문일 수도 있어 바깥 A가 보일 수도 있는 쓰임을 센다.
  const document = assemble({
    'src/a.js': [
      "import { NativeModules } from 'react-native';",
      'const M = NativeModules.A;',
      'function reducer(action) {',
      '  switch (action.type) {',
      "    case 'reset': { var M = makeFake(); break; }",
      '  }',
      '  return M.go();',
      '}',
      'function labeled() {',
      '  outer: { var M = makeFake(); break outer; }',
      '  M.go();',
      '}',
      'function afterBlock() {',
      '  if (a) { x(); }',
      '  { var M = makeFake(); }',
      '  M.go();',
      '}',
      'function afterAsi() {',
      '  x = 1',
      '  { var M = makeFake(); }',
      '  M.run();',
      '}',
      'function afterCall() {',
      '  noop()',
      '  { var M = makeFake(); }',
      '  M.walk();',
      '}',
      'M.top();',
    ].join('\n'),
  });
  assert.deepEqual(factLines(document), ['module-import A@2', 'method-invoke A.top@28']);
  assert.ok(bindingScope(document)?.startsWith('js-binding-scope: 4 native module references '), bindingScope(document));
  // 정하지 못한 var의 값은 어디에도 적용하지 않고, 그 var와 함수 본문 사이에서 그 var를 감싼 같은 이름 블록 선언의
  // 쓰임도 센다 — 다음 줄 `{`의 메서드는 호출 뒤 블록과 구분되지 않는다. 조건 반환 타입 함수는 함수 본문으로 알아본다.
  const between = assemble({
    'src/b.ts': [
      "import { NativeModules } from 'react-native';",
      '{',
      '  let M = NativeModules.A;',
      '  class K { run()',
      '  { var M = NativeModules.B; M.go(); } }',
      '  M.run();',
      '}',
      'function cond<T>(x: T): T extends string ? A : B { var N = NativeModules.D; N.cond(); }',
    ].join('\n'),
  });
  assert.deepEqual(factLines(between).filter((line) => line.startsWith('method-invoke')), ['method-invoke D.cond@8']);
  assert.ok(bindingScope(between)?.startsWith('js-binding-scope: 2 native module references '), bindingScope(between));
});

test('괄호로 끝나는 case 절 식 뒤 블록은 함수 본문이 아니다', () => {
  // 2차 리뷰 n01: `case (1): {`·`case kind(): {`의 `(…):`를 반환 타입 주석으로 읽어 블록을 함수 본문으로 보았고, var가
  // 그 블록에 갇혀 블록 뒤 M.go가 거짓 A.go가 됐다. 반환 타입이 있는 메서드 본문은 그대로 함수 본문이다.
  const document = assemble({
    'src/a.ts': [
      "import { NativeModules } from 'react-native';",
      'const M = NativeModules.A;',
      'function f(k) {',
      '  switch (k) {',
      '    case (1): { var M = makeFake(); break; }',
      '    case kind(): { var M = makeFake2(); break; }',
      '  }',
      '  M.go();',
      '}',
      'function start(): void { var M = makeFake(); } function stop() { M.ok(); }',
    ].join('\n'),
  });
  assert.deepEqual(factLines(document), ['module-import A@2', 'method-invoke A.ok@10']);
  assert.equal(bindingScope(document), undefined);
});

test('삼항 갈래의 호출 뒤 화살표·함수식은 그 호출 인자를 매개변수로 읽지 않는다', () => {
  // 2차 리뷰 n19·n28: `busy ? wrap(Haptics) : e => {…}`를 반환 타입 `e`가 붙은 매개변수 목록으로 읽어 Haptics가 가려졌고,
  // 참 Haptics.trigger와 wrap 인자의 범위 밖 계수가 함께 사라졌다. 삼항 갈래의 화살표 자체 매개변수는 가린다.
  const document = assemble({
    'src/a.js': [
      "import { NativeModules } from 'react-native';",
      'const { Haptics } = NativeModules;',
      'export const cb = busy ? wrap(Haptics) : e => { Haptics.trigger(); };',
      'export const cb2 = busy ? wrap(Haptics) : function () { Haptics.buzz(); };',
      'export const cb3 = busy ? wrap(x) : Haptics => { Haptics.fake(); };',
      'export const typed = (Haptics): void => { Haptics.fake2(); };',
    ].join('\n'),
  });
  assert.deepEqual(factLines(document), [
    'module-import Haptics@2', 'method-invoke Haptics.trigger@3', 'method-invoke Haptics.buzz@4',
  ]);
  assert.ok(bindingScope(document)?.startsWith('js-binding-scope: 2 native module references '), bindingScope(document));
});

test('단일 매개변수·반환 타입 화살표 본문 안 함수의 매개변수도 바깥 바인딩을 가린다', () => {
  // 2차 리뷰 n27·fail0: `M => {` 분기가 본문 끝으로 건너뛰어 본문 안 함수의 매개변수를 모으지 않았고, `(x): T => {`의
  // `T => {`도 같은 분기에 걸렸다. 오라클 고정 시드가 우연히 비껴갔다(시드 14 × 1만 회에서 거짓 2개).
  const document = assemble({
    'src/a.ts': [
      "import { NativeModules } from 'react-native';",
      'const { Camera } = NativeModules;',
      'export const useIt = items => {',
      '  items.forEach((Camera) => { Camera.release(); });',
      '  function open(Camera) { Camera.open(); }',
      '};',
      'const typed = (x): number => { function g(Camera) { Camera.close(); } Camera.snap(); };',
    ].join('\n'),
  });
  assert.deepEqual(factLines(document), ['module-import Camera@2', 'method-invoke Camera.snap@7']);
  assert.equal(bindingScope(document), undefined);
});

test('모듈 멤버 접근을 원천으로 한 구조 분해의 이름은 모듈이 아니다', () => {
  // 2차 리뷰 n23: 원천의 첫 토큰이 NativeModules이기만 하면 레지스트리 구조 분해로 읽어 거짓 module-import take·
  // getConstants와 거짓 take.x가 났다. 모듈 사실은 멤버 접근이 내고 구조 분해한 모듈 값은 센다. 대체값(`|| {}`)은
  // 레지스트리 그대로다. `&&` 뒤 값은 레지스트리가 아니다.
  const document = assemble({
    'src/a.js': [
      "import { NativeModules } from 'react-native';",
      'const { take: t2 } = NativeModules.Camera;',
      't2.x();',
      'const { getConstants } = NativeModules.PlatformConstants;',
      'const { Torch } = NativeModules || {};',
      'Torch.on();',
      'const { Fake } = NativeModules && mocks;',
      'Fake.go();',
    ].join('\n'),
  });
  assert.deepEqual(factLines(document), [
    'module-import Camera@2', 'module-import PlatformConstants@4', 'module-import Torch@5', 'method-invoke Torch.on@6',
  ]);
  assert.ok(bindingScope(document)?.startsWith('js-binding-scope: 2 native module references '), bindingScope(document));
});

test('구조 분해 대입·복합 대입·증감·for-of 대상도 재대입으로 바인딩을 지운다', () => {
  // 2차 리뷰 n10과 같은 계열: `=` 앞 이름만 재대입으로 보아 거짓 A.go~E.go가 났다. 매개변수 패턴의 기본값(`{ S } = {}`)은
  // 대입이 아니다.
  const document = assemble({
    'src/a.js': [
      "import { NativeModules } from 'react-native';",
      'let M = NativeModules.A, N = NativeModules.B, P = NativeModules.C, Q = NativeModules.D, R = NativeModules.E;',
      'function swap() { ({ M } = mocks); [N] = arr; }',
      'P &&= other(); Q++; for (R of xs) {}',
      'M.go(); N.go(); P.go(); Q.go(); R.go();',
      'function f({ S } = {}, [T] = []) { S.x(); }',
      'let S = NativeModules.F, T = NativeModules.G; S.y(); T.z();',
    ].join('\n'),
  });
  assert.deepEqual(factLines(document).filter((line) => line.startsWith('method-invoke')), ['method-invoke F.y@7', 'method-invoke G.z@7']);
  assert.ok(bindingScope(document)?.startsWith('js-binding-scope: 5 native module references '), bindingScope(document));
  // 멤버 접근 대입(`cache[K] = 1`)·클래스 필드 타입 주석의 `{…} =`·매개변수 안 중첩 패턴의 기본값은 대입 대상 이름이 아니다.
  const notAssigned = assemble({
    'src/b.ts': [
      "import { NativeModules } from 'react-native';",
      'let K = NativeModules.H, U = NativeModules.I, V = NativeModules.J;',
      'cache[K] = 1;',
      'function q([{ U } = {}]) { U.u(); }',
      'class C { field: { V: number } = init; }',
      'K.k(); U.i(); V.v();',
    ].join('\n'),
  });
  assert.deepEqual(factLines(notAssigned).filter((line) => line.startsWith('method-invoke')), [
    'method-invoke H.k@6', 'method-invoke I.i@6', 'method-invoke J.v@6',
  ]);
});

test('끌어올린 var가 차지한 앞 대입은 바깥 바인딩을 지우지 않고 확실한 매개변수 대입도 그렇다', () => {
  // 2차 리뷰 n17: 수집 중 반영한 무효(아직 보지 못한 var 대신 바깥 M을 지움)가 동결 뒤에도 남아 참 A.go를 셌다. 확실한
  // 매개변수에 대한 대입도 바깥 M을 지웠다(리뷰 n18). 매개변수를 다시 선언한 var는 선언 앞이 인자라 귀속하지 않고 센다.
  const document = assemble({
    'src/a.js': [
      "import { NativeModules } from 'react-native';",
      'const M = NativeModules.A;',
      'function f() { if (x) { M = other(); } var M = makeFake(); }',
      'function g(M) { M = other(); }',
      'function h(M) { M.go(); var M = NativeModules.B; }',
      'M.top();',
    ].join('\n'),
  });
  assert.deepEqual(factLines(document), ['module-import A@2', 'module-import B@5', 'method-invoke A.top@6']);
  assert.ok(bindingScope(document)?.startsWith('js-binding-scope: 1 native module references '), bindingScope(document));
});

test('함수 머리인지 정하지 못한 다음 줄 블록의 인자 이름은 바깥 모듈 쓰임을 조용히 가리지 않는다', () => {
  // `wrap(M)` 뒤 다음 줄 `{`는 호출 뒤 블록일 수도, 다음 줄 `{`의 메서드일 수도 있다. 전에는 매개변수로 단정해 바깥 A의
  // 호출이 한계 없이 사라졌다. const enum 멤버 이름은 값 쓰임이 아니다.
  const document = assemble({
    'src/a.ts': [
      "import { NativeModules } from 'react-native';",
      'const M = NativeModules.A;',
      'function f() {',
      '  wrap(M)',
      '  { M.go(); }',
      '}',
      'class K {',
      '  run(M)',
      '  { M.fake(); }',
      '  stop(M) { M.param(); }',
      '}',
      'const enum Feature { M, Camera = 2 }',
    ].join('\n'),
  });
  assert.deepEqual(factLines(document), ['module-import A@2']);
  // wrap 인자·M.go·run의 인자(호출이면 값 쓰임)·M.fake, 그리고 같은 줄 `{`의 메서드도 뒤 `{`로만 추론한 머리라 stop의
  // 인자·M.param까지 여섯이다(3차 리뷰 원칙).
  assert.ok(bindingScope(document)?.startsWith('js-binding-scope: 6 native module references '), bindingScope(document));
});

test('매개변수의 타입 주석·기본값·패턴 키는 바깥 바인딩을 가리지 않는다', () => {
  // 매개변수 목록의 이름을 모두 매개변수로 세어 `(options: Camera.Options)`의 Camera가 바깥 모듈을 가렸고 참 호출이
  // 한계 없이 사라졌다(반환 타입 주석 함수 본문을 알아보면서 더 자주 닿았다 — react-native의 `config?:
  // ?Animated.AnimatedConfig`가 Animated import 호출 계수 2개를 지웠다). 바인딩은 수식어·데코레이터·`...` 뒤의 이름과
  // 패턴의 바인딩 이름뿐이다.
  const document = assemble({
    'src/a.ts': [
      "import { NativeModules } from 'react-native';",
      'const { Camera } = NativeModules;',
      'function f(options: Camera.Options, next?: Map<string, Camera.Ref>): void { Camera.take(); }',
      'const g = ({ Camera: cam }) => { Camera.open(); };',
      'const h = (x = Camera.defaults) => { Camera.close(); };',
      'const k = ({ ref }: { ref: Camera.Ref }) => { Camera.snap(); };',
      'class S { constructor(private readonly Camera: X) { Camera.fake(); } }',
      'function m(@Inject() Camera: X, ...rest) { Camera.fake2(); }',
      'const n = (a, ...Camera) => { Camera.fake3(); };',
      'const p = ([first, { Camera }]) => { Camera.fake4(); };',
    ].join('\n'),
  });
  assert.deepEqual(factLines(document).filter((line) => line.startsWith('method-invoke')), [
    'method-invoke Camera.take@3', 'method-invoke Camera.open@4', 'method-invoke Camera.close@5', 'method-invoke Camera.snap@6',
  ]);
});

test('뒤 `{`로만 추론한 매개변수 목록은 재대입을 막지 않고 상속절 호출·세미콜론 없는 시그니처는 매개변수가 아니다', () => {
  // 3차 리뷰 BLOCKER 1: 같은 줄 `name(x) {` 규칙이 `extends withEvents(M) {`를 확실한 매개변수 목록으로 읽어 클래스 본문의
  // 재대입이 바깥 M을 지우지 못했고(거짓 A.go), 반환 타입 건너기가 세미콜론 없는 오버로드·추상 시그니처(`open(Camera:
  // string): void` 다음 줄)를 넘어 다음 메서드의 `{`까지 가서 같은 일이 났다. JSX 글자 `setup(Q) {…}`도 같다. 확실한
  // 매개변수 목록(`function` 머리·화살표)만 재대입을 막고, 추론한 목록 바깥은 무효로 하며 쓰임을 센다.
  const document = assemble({
    'src/a.tsx': [
      "import { NativeModules } from 'react-native';",
      'let M = NativeModules.A;',
      'class Foo extends withEvents(M) { reset() { M = makeFake(); } }',
      'let Camera = NativeModules.Camera;',
      'export class Store {',
      '  open(Camera: string): void',
      '  open(name: string, fallback?: string) { Camera = makeFake(); }',
      '}',
      'let P = NativeModules.P;',
      'abstract class Base {',
      '  abstract open(P): void',
      '  reset() { P = makeFake(); }',
      '}',
      'let Q = NativeModules.Q;',
      'const el = <Text>Retry setup(Q) {Q = makeFake()}</Text>;',
      'M.go(); Camera.take(); P.go(); Q.go();',
    ].join('\n'),
  });
  assert.deepEqual(factLines(document).filter((line) => line.startsWith('method-invoke')), []);
  assert.ok(bindingScope(document)?.startsWith('js-binding-scope: 6 native module references '), bindingScope(document));
  // 같은 오인이 쓰임도 조용히 가렸다(상속절 안 메서드의 N.go는 모든 트리에서, 추상 시그니처 뒤 메서드의 N.stop은 7d663be부터).
  const uses = assemble({
    'src/b.ts': [
      "import { NativeModules } from 'react-native';",
      'const N = NativeModules.B;',
      'class Bar extends mixin(N) { run() { N.go(); } }',
      'abstract class Base {',
      '  abstract open(N): void',
      '  run2() { N.stop(); }',
      '}',
    ].join('\n'),
  });
  assert.deepEqual(factLines(uses).filter((line) => line.startsWith('method-invoke')), ['method-invoke B.go@3', 'method-invoke B.stop@6']);
});

test('연산자 뒤 괄호 갈래의 삼항 화살표는 반환 타입이 아니라 단일 매개변수 화살표다', () => {
  // 3차 리뷰 BLOCKER 2: `enabled ? !(paused) : M => {…}`를 `(paused): M =>`(반환 타입 M)로 읽어 매개변수 M이 가리지 못했다
  // (거짓 A.go, node로 확인한 진실은 매개변수). 반환 타입이 붙은 화살표 매개변수는 화살표 함수 식이 올 자리 뒤에만 있다.
  const document = assemble({
    'src/a.js': [
      "import { NativeModules } from 'react-native';",
      'const M = NativeModules.A;',
      'const run = enabled ? !(paused) : M => { M.go(); };',
      'const run2 = enabled ? base + (offset) : M => { M.stop(); };',
      'const run3 = async () => (ready ? await (load) : M => { M.h(); });',
      'const typed = (x): M => { M.ok(); };',
    ].join('\n'),
  });
  assert.deepEqual(factLines(document), ['module-import A@2', 'method-invoke A.ok@6']);
  assert.equal(bindingScope(document), undefined);
});

test('제어문 머리·case 절 뒤 배열 대입, 괄호 대상, 선언 초기값 안 대입도 재대입이고 enum 멤버 초기값은 아니다', () => {
  // 3차 리뷰 SHOULD-FIX 2(모든 트리의 거짓 A.go): `if (c) [M, N] = …`의 `[`를 멤버 접근으로, `case 'mock': [P] = …`의
  // `[`를 타입 주석 뒤로 읽었다. `(Q) = x`와 선언 초기값 안의 대입(`const r = (R = x)`, 중첩 `[[S] = x] = y`)도 놓쳤다.
  // enum 멤버 초기값(`enum Flags { T = 1 }`)을 재대입으로 읽어 참 T.t를 잃던 것도 고친다.
  const document = assemble({
    'src/a.ts': [
      "import { NativeModules } from 'react-native';",
      'let M = NativeModules.A, N = NativeModules.B, P = NativeModules.C, Q = NativeModules.D, R = NativeModules.E, '
        + 'S = NativeModules.F;',
      'function flip(c) { if (c) [M, N] = [N, M]; }',
      "function reset(k) { switch (k) { case 'mock': [P] = mocks; break; } }",
      'function paren() { (Q) = makeFake(); }',
      'const r = (R = makeFake()), s = [[S] = x] = y;',
      'let T = NativeModules.G;',
      'enum Flags { T = 1, U = 2 }',
      'M.go(); N.go(); P.go(); Q.go(); R.go(); S.go(); T.t();',
    ].join('\n'),
  });
  assert.deepEqual(factLines(document).filter((line) => line.startsWith('method-invoke')), ['method-invoke G.t@9']);
  assert.ok(bindingScope(document)?.startsWith('js-binding-scope: 6 native module references '), bindingScope(document));
});

test('기본값 있는 제네릭·`>=` 토큰·제네릭 데코레이터 뒤에서도 매개변수를 알아본다', () => {
  // 3차 리뷰 SHOULD-FIX 3(모든 트리): 타입 매개변수 짝 찾기가 `<T = {}>`의 `{}`에서 멈춰 매개변수 M이 가리지 못했다.
  // SHOULD-FIX 4(6a5075a부터): 렉서가 `Array<string>= []`의 `>=`를 한 토큰으로 내 타입 주석이 목록 끝까지 갔고, `@Inject<Svc>()`
  // 데코레이터를 건너지 못해 매개변수 M을 잃었다. 생성자는 메서드 약칭이라 그 매개변수 쓰임은 센다.
  const document = assemble({
    'src/a.ts': [
      "import { NativeModules } from 'react-native';",
      'const M = NativeModules.A;',
      'function f<T = {}>(M: T) { M.go(); }',
      'function g<T extends Record<string, unknown> = {}>(M: T) { M.d(); }',
      'function h(list: Array<string>= [], M) { M.e(); }',
      'class K { constructor(@Inject<Svc>() M: Svc) { M.f(); } }',
      'M.top();',
    ].join('\n'),
  });
  assert.deepEqual(factLines(document), ['module-import A@2', 'method-invoke A.top@7']);
  assert.ok(bindingScope(document)?.startsWith('js-binding-scope: 2 native module references '), bindingScope(document));
});

test('선택 속성 뒤·선택·catch 메서드의 매개변수, 호출 인자의 구조 분해 대입, satisfies 원천을 바로 읽는다', () => {
  // 3차 리뷰 니트: 줄 끝 `label?`를 삼항으로 읽어 다음 메서드 매개변수를 잃었고(6a5075a 회귀), 선택 메서드 `run2?(M)`·
  // `catch(M)` 메서드의 매개변수는 모든 트리에서 가리지 못했다. `c ? fn({ N } = d) : other => {}`는 호출 인자의 대입인데
  // 매개변수 패턴으로 읽었다. `try {…} catch (M)`는 그대로 catch 절이다(그 매개변수는 가리지 않는다 — 기존 한계).
  const document = assemble({
    'src/a.ts': [
      "import { NativeModules } from 'react-native';",
      'const M = NativeModules.A;',
      'class K {',
      '  label?',
      '  run(M): void { M.go() }',
      '  run2?(M: X): void { M.stop(); }',
      '  catch(M) { return M.h(); }',
      '}',
      'function t() { try { work(); } catch (M) { log(); } M.top(); }',
      'let N = NativeModules.B;',
      'const r = c ? fn({ N } = defaults) : other => { other.x(); };',
      'N.go();',
      'const { Camera } = NativeModules satisfies Record<string, unknown>;',
      'Camera.take();',
    ].join('\n'),
  });
  assert.deepEqual(factLines(document), [
    'module-import A@2', 'method-invoke A.top@9', 'module-import B@10', 'module-import Camera@13', 'method-invoke Camera.take@14',
  ]);
  assert.ok(bindingScope(document)?.startsWith('js-binding-scope: '), document.limitations.join('\n'));
});

test('잠정적인 선언·매개변수가 가린 레지스트리 접근은 사실로 읽지 않고 센다', () => {
  // 3차 리뷰 니트: `wrap(NativeModules)` 뒤 다음 줄 블록과 라벨 블록의 `var NativeModules = mock` 뒤에서 레지스트리 접근이
  // 한계 없이 사라졌다(잠정 가림 계수가 모듈 바인딩·import만 보았다). 둘 다 레지스트리일 수도 아닐 수도 있다.
  const document = assemble({
    'src/a.js': [
      "import { NativeModules } from 'react-native';",
      'wrap(NativeModules)',
      '{',
      '  NativeModules.Camera.take();',
      '}',
      'function f() {',
      '  lbl: { var NativeModules = makeMock(); break lbl; }',
      '  NativeModules.Torch.on();',
      '}',
      'NativeModules.Haptics.go();',
    ].join('\n'),
  });
  assert.deepEqual(factLines(document), ['module-import Haptics@10', 'method-invoke Haptics.go@10']);
  // wrap 인자(호출이면 레지스트리 값)·Camera 접근·Torch 접근 셋이다.
  assert.ok(bindingScope(document)?.startsWith('js-binding-scope: 3 native module references '), bindingScope(document));
  // require로 꺼낸 레지스트리 선언을 잠정 매개변수가 가린 경우도 센다(4차 리뷰 S3 — 전에는 조용히 사라졌다).
  const required = assemble({
    'src/c.js': "const { NativeModules } = require('react-native');\nwrap(NativeModules)\n{ NativeModules.Camera.take(); }",
  });
  assert.deepEqual(required.facts, []);
  assert.ok(bindingScope(required)?.startsWith('js-binding-scope: 2 native module references '), bindingScope(required));
  // import 없이 전역 레지스트리를 읽는 파일도 같다.
  const global = assemble({ 'src/b.js': 'wrap(NativeModules)\n{\n  NativeModules.Camera.take();\n}' });
  assert.deepEqual(global.facts, []);
  assert.ok(bindingScope(global)?.startsWith('js-binding-scope: 2 native module references '), bindingScope(global));
});

test('같은 깊이 앞에 짝 없는 삼항 `?`·`case`가 있으면 반환 타입 화살표 목록을 정하지 않는다', () => {
  // 4차 리뷰 B1(349bd25 회귀): 화살표 함수 식이 올 자리 뒤면 `(…): T =>`를 확실한 매개변수 목록으로 보아, 중첩 삼항
  // `a ? b ? c : (x) : M => {…}`(진실은 매개변수 M)에서 거짓 Camera.take가 났고, 거울 `(M) : T =>`(진실은 바깥 M)에서는 참
  // 호출이 계수 없이 사라졌다. `yield`·`async`(JS에서는 호출)·`=>`·대입·`}`(함수식 끝)·`case 1, (x):`·`case a ? b : (x):`도
  // 같다. 이런 목록은 잠정이라 그 쓰임을 센다.
  const lines = [
    'const f1 = a ? b ? c : (x) : M => { M.take(); };',
    'function* g() { const f2 = a ? yield (x) : M => { M.take(); }; }',
    'const f3 = a ? async (x) : M => { M.take(); };',
    'const f4 = a ? y => (x) : M => { M.take(); };',
    'let f5; const f6 = a ? f5 = (x) : M => { M.take(); };',
    'switch (k) { case 1, (x): M => { M.take(); }; }',
    'switch (k) { case a ? b : (x): M => { M.take(); }; }',
    'const f7 = a ? b ? c : (M) : T => { M.take(); };',
    'const f8 = a ? function () {}(M) : T => { M.take(); };',
    // 같은 깊이를 거슬러 볼 때 함수식의 `function` 키워드는 문장 경계가 아니다.
    'const f9 = a ? b ? function () {} : (x) : M => { M.take(); };',
  ];
  for (const line of lines) {
    const document = assemble({ 'src/a.js': `import { NativeModules } from 'react-native';\nconst M = NativeModules.Camera;\n${line}` });
    assert.deepEqual(factLines(document), ['module-import Camera@2'], line);
    assert.ok(bindingScope(document)?.startsWith('js-binding-scope: '), line);
  }
  // 제어문 머리 뒤의 `(M): T => {…}`는 화살표 식 문장이라 매개변수가 확실하다(전에는 호출로 읽어 거짓 Camera.take).
  const control = assemble({
    'src/b.ts': "import { NativeModules } from 'react-native';\nconst M = NativeModules.Camera;\nif (c) (M): T => { M.take(); };",
  });
  assert.deepEqual(factLines(control), ['module-import Camera@2']);
  assert.equal(bindingScope(control), undefined);
});

test('enum 멤버 초기값 안의 대입·증감은 재대입이다', () => {
  // 4차 리뷰(349bd25 회귀): 멤버 이름 판정이 앞 토큰을 보지 않아 `enum E { A = M++ }`·`enum E { A = M = 1 }`의 M을 멤버
  // 이름으로 읽고 재대입을 건너뛰었다(거짓 Camera.take).
  for (const member of ['A = M++', 'A = M = 1']) {
    const document = assemble({
      'src/a.ts': `import { NativeModules } from 'react-native';\nlet M = NativeModules.Camera;\nenum E { ${member} }\nM.take();`,
    });
    assert.deepEqual(factLines(document), ['module-import Camera@2'], member);
  }
});

test('선언 패턴의 기본값·계산 키 안 재대입도 바인딩을 지운다', () => {
  // 4차 리뷰 B3(모든 트리의 거짓 Camera.take): 선언 수집이 패턴 구간을 건너뛰어 기본값 안 대입을 보지 못했다. 패턴의
  // 바인딩 이름(a·b·v)과 중첩 패턴은 선언이라 재대입이 아니다.
  for (const declaration of [
    'const [a = (M = other)] = arr;', 'const { a = (M = other) } = obj;', 'for (const [a = (M = other)] of arr) {}',
    'const z = 1, [b = (M = other)] = arr;', 'let { [M = "k"]: v } = obj;', 'const o = { a: 1 }, { b = M = other } = o;',
    'const [b = M = other] = arr;', 'const { b = M++ } = obj;',
  ]) {
    const document = assemble({
      'src/a.js': `import { NativeModules } from 'react-native';\nlet M = NativeModules.Camera;\n${declaration}\nM.take();`,
    });
    assert.deepEqual(factLines(document), ['module-import Camera@2'], declaration);
  }
  // 중첩 선언 패턴(`[[a] = x]`)은 바깥 M을 지우지 않는다.
  const kept = assemble({
    'src/b.js': "import { NativeModules } from 'react-native';\nlet M = NativeModules.Camera;\nconst [[a] = x, { b } = y] = arr;\nM.take();",
  });
  assert.deepEqual(factLines(kept), ['module-import Camera@2', 'method-invoke Camera.take@4']);
});

test('이름 있는 함수식·클래스식의 이름은 그 본문 안에서 바깥 바인딩을 가린다', () => {
  // 4차 리뷰 S1(모든 트리의 거짓 Camera.take): `function M() { M.take(); }`·`class M { run() { M.take(); } }` 안의 M은 함수·
  // 클래스 자신이다(node로 확인). 함수식 이름은 `function` 키워드와 함수 본문이 보이므로 확실한 가림이다. 클래스식 이름은
  // 잠정 가림이다 — 메서드 안 `var M`이 클래스 본문 밖까지 끌어올려져 엇갈리므로 바깥 모듈에 닿는 쓰임은 센다(오라클이
  // 찾은 경우). 본문 밖 M은 그대로 바깥 바인딩이다.
  const document = assemble({
    'src/a.js': [
      "import { NativeModules } from 'react-native';",
      'let M = NativeModules.Camera;',
      'const x = function M() { M.take(); };',
      '(function M() { M.open(); })();',
      'const C = class M { run() { M.snap(); } };',
      'M.close();',
    ].join('\n'),
  });
  assert.deepEqual(factLines(document), ['module-import Camera@2', 'method-invoke Camera.close@6']);
  // 클래스식 안 M.snap 하나만 센다.
  assert.ok(bindingScope(document)?.startsWith('js-binding-scope: 1 native module references '), bindingScope(document));
  // 메서드 안 `var M`(범위를 정하지 못한 선언)과 클래스식 이름이 엇갈리면 그 쓰임은 귀속하지도 버리지도 않고 센다.
  const crossed = assemble({
    'src/b.js': [
      "import { NativeModules } from 'react-native';",
      'const K = class M { run() { { var M = NativeModules.C; } M.go(); } };',
    ].join('\n'),
  });
  assert.deepEqual(factLines(crossed), ['module-import C@2']);
  assert.ok(bindingScope(crossed)?.startsWith('js-binding-scope: '), crossed.limitations.join('\n'));
});

test('레지스트리 출처는 이름이 아니라 그 위치를 차지한 선언의 것이다', () => {
  // 기록된 결함 B2: 레지스트리 판정이 `require('react-native')` 구조 분해·모듈 객체 구조 분해를 이름으로 찾아, 파일의 한
  // 범위에 레지스트리 선언이 있으면 다른 범위의 같은 이름 선언(jest 대역 `const NativeModules = { Camera: … }`, 블록 안
  // `var NativeModules = mock`, 로컬 별칭)의 접근도 레지스트리로 읽어 거짓 Camera.take를 냈다. 선언 범위 밖의 별칭(다른 함수의
  // `NM`)도 레지스트리로 읽었다.
  const document = assemble({
    'src/a.js': [
      "const { NativeModules } = require('react-native');",
      'function testHelper() {',
      '  const NativeModules = { Camera: { take() {} } };',
      '  NativeModules.Camera.take();',
      '  const { Torch } = NativeModules;',
      '  Torch.on();',
      '}',
      'function hoisted() {',
      '  if (ready) { var NativeModules = makeMock(); }',
      '  NativeModules.Haptics.go();',
      '}',
      'NativeModules.Real.call();',
    ].join('\n'),
    'src/b.js': [
      "import * as RN from 'react-native';",
      'function a() { const { NativeModules: NM } = RN; NM.A.a(); }',
      'function b() { const NM = mock; NM.B.b(); }',
      'function c() { NM.C.c(); }',
    ].join('\n'),
  });
  assert.deepEqual(factLines(document), [
    'module-import Real@12', 'method-invoke Real.call@12', 'module-import A@2', 'method-invoke A.a@2',
  ]);
  // 확실히 레지스트리가 아닌 위치라 세지 않는다(b.js의 RN 네임스페이스 import만 출처를 모르는 입구로 센다).
  assert.ok(bindingScope(document)?.startsWith('js-binding-scope: 0 native module references '), bindingScope(document));
  // 레지스트리 선언이 정하지 못하게 관여하는 위치(블록 밖의 `var`, 라벨 블록 안 대역 `var`, 재대입한 바인딩, 같은 범위의 다른
  // 값 재선언)의 접근은 사실로도 조용한 누락으로도 두지 않고 센다(전에는 모두 이름으로 레지스트리라 사실을 냈다).
  for (const [text, count] of [
    ["function f() {\n  if (x) { var { NativeModules } = require('react-native'); }\n  NativeModules.H.h();\n}", 1],
    ["const { NativeModules } = require('react-native');\nfunction f() {\n  lbl: { var NativeModules = mock; }\n  NativeModules.G.g();\n}", 1],
    // 값이 살아남지 못한 레지스트리 선언, 대입 대상, 뒤 접근 셋이다(대입한 값이 레지스트리인지 스캔은 모른다).
    ["let { NativeModules } = require('react-native');\nNativeModules = mock;\nNativeModules.F.f();", 3],
    // 같은 함수의 레지스트리가 아닌 `var` 재선언 앞 접근은 실제로 레지스트리일 수 있다 — 그 선언을 센다.
    ["function f() {\n  var { NativeModules } = require('react-native');\n  NativeModules.C.c();\n  var NativeModules = mock;\n}", 1],
    // 잠정 매개변수 목록(`wrap(NativeModules)` 뒤 다음 줄 블록) 안, 본문이 블록이 아닌 for 머리 선언 뒤의 접근은 그 목록이 없으면
    // 레지스트리 선언에 닿는다 — 인자와 그 접근 둘이다(오라클 레지스트리 모드가 찾은 경우).
    ["function f() {\n  let { NativeModules } = require('react-native');\n  wrap(NativeModules)\n  {\n    for (const NativeModules of xs)\n      noop();\n    NativeModules.Cam.go();\n  }\n}", 2],
  ] as const) {
    const undecided = assemble({ 'src/c.js': text });
    assert.deepEqual(undecided.facts, [], text);
    assert.ok(bindingScope(undecided)?.startsWith(`js-binding-scope: ${count} native module references `), text);
  }
  // 각 선언은 자기 출처로 판정한다 — 레지스트리 선언의 범위 안 접근, `require('react-native').NativeModules` 초기값, 뒤에
  // 온 react-native 기본 import의 모듈 객체에서 꺼낸 레지스트리는 그대로 사실이다.
  const kept = assemble({
    'src/d.js': [
      'function real() { const { NativeModules } = require(\'react-native\'); NativeModules.Torch.on(); }',
      'function fake() { const NativeModules = require(\'./mocks\'); NativeModules.Fake.x(); }',
      'const N = () => { const NativeModules = require(\'react-native\').NativeModules; NativeModules.L.l(); };',
      'const { NativeModules: Late } = RN;',
      'Late.K.k();',
      "import RN from 'react-native';",
    ].join('\n'),
  });
  assert.deepEqual(factLines(kept), [
    'module-import Torch@1', 'method-invoke Torch.on@1', 'module-import L@3', 'method-invoke L.l@3',
    'module-import K@5', 'method-invoke K.k@5',
  ]);
});

test('레지스트리가 아닌 NativeModules에서 꺼낸 바인딩·구조 분해는 모든 선언을 본 판정으로 거두거나 센다', () => {
  // PR #167 리뷰: 모듈 식 판정이 `NativeModules.X`·`NativeModules['X']`를 출처 없이 바인딩해, jest 대역에서 꺼낸
  // `const Camera = NativeModules['Camera']`의 `Camera.take()`가 module-import 없는 거짓 method-invoke로 남았다. 수집 중에는 뒤에
  // 오는 선언·재대입·import를 모르므로(끌어올린 var, 다른 함수의 재대입, 뒤의 import·함수 선언) 동결 뒤 그 자리를 다시 판정한다.
  for (const text of [
    "const { NativeModules } = require('react-native');\nfunction helper() {\n  const NativeModules = { Camera: { take() {} } };\n  const Camera = NativeModules['Camera'];\n  Camera.take();\n}",
    "import { NativeModules } from 'react-native';\ntest('x', () => {\n  const NativeModules = { Camera: { take: jest.fn() } };\n  const Camera = NativeModules.Camera;\n  Camera.take();\n});",
    'const NativeModules = mock;\nconst Camera = NativeModules.Camera;\nCamera.take();',
    // 별칭(`const D = C`)도 같은 값이라 함께 거둔다. 끌어올린 var 앞의 NativeModules는 undefined다.
    'function a() {\n  const C = NativeModules.Camera;\n  const D = C;\n  D.take();\n  var NativeModules = mock;\n}',
    'function a() { const C = NativeModules.Camera; C.take(); }\nfunction NativeModules() {}',
    "const { NativeModules } = require('react-native');\nfunction a() {\n  const { Camera } = NativeModules;\n  Camera.take();\n  const NativeModules = 1;\n}",
  ]) {
    assert.deepEqual(assemble({ 'src/a.js': text }).facts, [], text);
  }
  // PR #167 델타 리뷰: 대역에서 꺼낸 중첩 구조 분해(`{ Camera: { take } }`)로 센 범위 밖 참조도 거둔다 — 모듈이 아니다.
  for (const text of [
    "const { NativeModules } = require('react-native');\nfunction t() {\n  const NativeModules = { Camera: { take() {} } };\n  const { Camera: { take } } = NativeModules;\n  take();\n}",
    'function t(NativeModules) {\n  const { Camera: { take }, ...rest } = NativeModules;\n  take();\n}',
  ]) {
    const document = assemble({ 'src/n.js': text });
    assert.deepEqual(document.facts, [], text);
    assert.equal(bindingScope(document), undefined, text);
  }
  // 뒤에 온 다른 모듈 import면 멤버 접근·꺼낸 이름마다 출처 모름으로 센다.
  for (const text of [
    "function a() { const C = NativeModules.Camera; C.take(); }\nimport { NativeModules } from 'other-lib';",
    "function a() { const { Camera } = NativeModules; Camera.take(); }\nimport { NativeModules } from 'other-lib';",
  ]) {
    const document = assemble({ 'src/b.js': text });
    assert.deepEqual(document.facts, [], text);
    assert.ok(document.limitations.some((line) => line.startsWith('unattributed-js-native-modules: 1 ')), text);
  }
  // 레지스트리일 수도 있으면(다른 함수의 재대입) 사실 없이 센다 — 살아남지 못한 레지스트리 선언, 원천 접근, 대입 대상, 바인딩
  // 쓰임 넷이다. 수집 중 판정을 정하지 못한 위치(라벨 블록 안 레지스트리 var 뒤)의 바인딩 쓰임도 쓰임마다 센다.
  for (const [text, count] of [
    ["let { NativeModules } = require('react-native');\nfunction a() { const C = NativeModules.Camera; C.take(); }\nfunction b() { NativeModules = mock; }", 4],
    ["let { NativeModules } = require('react-native');\nfunction a() { const { Camera } = NativeModules; Camera.take(); }\nfunction b() { NativeModules = mock; }", 4],
    ["function f() {\n  if (x) { var { NativeModules } = require('react-native'); }\n  const { Camera } = NativeModules;\n  Camera.take();\n  Camera.close();\n}", 3],
    ["function f() {\n  if (x) { var { NativeModules } = require('react-native'); }\n  const C = NativeModules.Camera;\n  C.take();\n  C.close();\n}", 3],
    // 레지스트리일 수도 있는 원천의 중첩 구조 분해는 그 계수를 남긴다(확실히 대역일 때만 거둔다) — 살아남지 못한 선언, 원천
    // 접근, 중첩 패턴, 대입 대상이다.
    ["let { NativeModules } = require('react-native');\nfunction a() { const { Camera: { take } } = NativeModules; take(); }\nfunction r() { NativeModules = mock; }", 4],
  ] as const) {
    const document = assemble({ 'src/c.js': text });
    assert.deepEqual(document.facts, [], text);
    assert.ok(bindingScope(document)?.startsWith(`js-binding-scope: ${count} native module references `), text);
  }
  // 거둔 바인딩의 export는 다른 파일에서도 모듈이 아니다.
  const exported = assemble({
    'src/d.js': "export const C = NativeModules.Camera;\nexport default NativeModules.Torch;\nfunction NativeModules() {}",
    'src/e.js': "import T, { C } from './d';\nC.take();\nT.on();",
  });
  assert.deepEqual(exported.facts, []);
  // 레지스트리 자리는 그대로다 — 수집 중에는 몰랐던 뒤의 react-native 기본 import, 다른 함수의 라벨 블록 var도 판정에 쓴다.
  const kept = assemble({
    'src/f.js': "import { NativeModules } from 'react-native';\nexport const C = NativeModules['Camera'];\nC.take();",
    'src/g.js': "import { C } from './f';\nC.open();",
    'src/h.js': "const { NativeModules } = RN;\nconst { Torch } = NativeModules;\nTorch.on();\nimport RN from 'react-native';",
    'src/i.js': "function g() { lbl: { var NativeModules = mock; } }\nconst { NativeModules } = require('react-native');\nconst { Haptics } = NativeModules;\nHaptics.go();",
  });
  assert.deepEqual(factLines(kept), [
    'module-import Camera@2', 'method-invoke Camera.take@3', 'method-invoke Camera.open@2',
    'module-import Torch@2', 'method-invoke Torch.on@3', 'module-import Haptics@3', 'method-invoke Haptics.go@4',
  ]);
});

test('같은 범위 var 묶음의 대표 값을 받은 별칭·export도 거둔다', () => {
  // PR #167 델타 리뷰 S1: 같은 범위의 `var C` 두 번은 처음 본 값 객체를 대표로 두고 별칭(`const D = C`)·`export { C }`가 그 객체를
  // 받는다. 대역에서 꺼낸 두 번째 읽기의 객체만 거두면 별칭·export가 남아 거짓 Camera.take가 이 파일과 다른 파일에 남았다.
  const shared = [
    'var C = NativeModules.Camera;',
    '{',
    '  const NativeModules = { Camera: { take() {} } };',
    '  var C = NativeModules.Camera;',
    '}',
  ];
  const document = assemble({
    'src/a.js': [...shared, 'const D = C;', 'D.take();'].join('\n'),
    'src/b.js': [...shared, 'export { C };'].join('\n'),
    'src/c.js': "import { C } from './b';\nC.take();",
  });
  assert.deepEqual(factLines(document), ['module-import Camera@1', 'module-import Camera@1']);
  // 확실하게 거둔 뒤 같은 값 객체를 불확실하게 다시 거두면 그 쓰임을 센다 — 확실한 대역 읽기(2행)가 먼저 대표 값을 거두고,
  // 재대입된 레지스트리 읽기(3행)가 불확실하게 거둔다. 살아남지 못한 레지스트리 선언, 3행 접근, 대입 대상, D 초기값의 C,
  // D의 쓰임 둘이다(전에는 D의 쓰임이 조용히 빠질 수 있었다).
  const ordered = assemble({
    'src/d.js': [
      "let { NativeModules } = require('react-native');",
      '{ const NativeModules = mock; var C = NativeModules.Camera; }',
      'var C = NativeModules.Camera;',
      'const D = C;',
      'D.take();',
      'D.close();',
      'function r() { NativeModules = mock; }',
    ].join('\n'),
  });
  assert.deepEqual(ordered.facts, []);
  assert.ok(bindingScope(ordered)?.startsWith('js-binding-scope: 6 native module references '), bindingScope(ordered));
});

test('react-native가 아닌 모듈의 require로 가져온 NativeModules는 import 꼴처럼 세고 거기서 꺼낸 바인딩의 쓰임도 센다', () => {
  // PR #167 델타 리뷰 B1: `const NativeModules = require('../BatchedBridge/NativeModules').default`(react-native 내부 — 실제로
  // 레지스트리다)는 react-native가 아닌 값의 로컬 선언으로 읽혀 멤버 접근을 세지 않았고, 거기서 꺼낸 바인딩을 거두면서 그 쓰임
  // 계수까지 사라졌다(main 2 → 0). 다른 모듈에서 가져온 NativeModules는 ES import든 require든 대역일 수도 레지스트리를 다시
  // 내보낸 것일 수도 있다 — 멤버 접근을 `unattributed-js-native-modules:`로 세고, 거기서 꺼낸 바인딩의 쓰임도 센다.
  const unattributed = (document: ReturnType<typeof assemble>) =>
    document.limitations.find((line) => line.startsWith('unattributed-js-native-modules: '))?.split(' ')[1];
  for (const [text, scope, accesses] of [
    ["const NativeModules = require('../BatchedBridge/NativeModules').default;\nfunction f(name) {\n  const v = NativeModules[name];\n  v && Object.keys(v);\n  return v;\n}", 3, '1'],
    ["const NativeModules = require('../BatchedBridge/NativeModules').default;\nconst v = NativeModules.Camera;\nv.take();\nNativeModules.Torch.on();", 1, '2'],
    ["const { NativeModules } = require('other-lib');\nconst v = NativeModules.Camera;\nv.take();\nNativeModules.Torch.on();", 1, '2'],
    ["const { NativeModules: NM } = require('other-lib');\nNM.Camera.take();", 0, '1'],
    ["const NativeModules = require('../BatchedBridge/NativeModules');\nconst { Camera } = NativeModules;\nCamera.take();", 1, '1'],
    ["import { NativeModules } from 'other-lib';\nconst v = NativeModules.Camera;\nv.take();\nNativeModules.Torch.on();", 1, '2'],
  ] as const) {
    const document = assemble({ 'src/a.js': text });
    assert.deepEqual(document.facts, [], text);
    assert.equal(unattributed(document), accesses, text);
    assert.ok(bindingScope(document)?.startsWith(`js-binding-scope: ${scope} native module references `), text);
  }
});

test('표가 가리지 않는 자리에도 쓰이는 require 별칭 레지스트리는 사실 대신 센다', () => {
  // PR #167 델타 리뷰 N3: 새 출처 `const { NativeModules: NM } = require('react-native')`가 식 본문 화살표·`catch` 매개변수를
  // 가리지 않는 기존 한계에 닿아 `items.forEach(NM => NM.Camera.take())`가 거짓 Camera.take를 냈다(main은 이 출처를 읽지 않아
  // 사실이 없었다). 그 이름이 표가 가리지 않는 자리에도 쓰이면 이 출처로는 사실을 내지 않고 센다.
  for (const [text, count] of [
    ["const { NativeModules: NM } = require('react-native');\nitems.forEach(NM => NM.Camera.take());", 2],
    ["const { NativeModules: NM } = require('react-native');\nitems.forEach((NM) => NM.Camera.take());", 2],
    ["function a() {\n  const { NativeModules: NM } = require('react-native');\n  try { x(); } catch (NM) { NM.Camera.take(); }\n}", 2],
    ["function a() {\n  const { NativeModules: NM } = require('react-native');\n  NM.Camera.open();\n}\nfunction b() {\n  const g = ({ NM }) => NM.Camera.take();\n}", 1],
  ] as const) {
    const document = assemble({ 'src/a.js': text });
    assert.deepEqual(document.facts, [], text);
    assert.ok(bindingScope(document)?.startsWith(`js-binding-scope: ${count} native module references `), text);
  }
  // PR #167 재확인 리뷰: 생성기 함수 이름(`function* NM`, `async function* NM`, `function* NM() {…}` 식)과 반환 타입이 붙은 식 본문
  // 화살표(`(NM): T => …`, `<T,>(NM: T): T => …`, 괄호로 감싼 함수 반환 타입)의 매개변수도 표가 가리지 않는 자리다(전에는 거짓
  // Camera.take가 남았다).
  const head = "const { NativeModules: NM } = require('react-native');\nNM.Camera.open();\n";
  for (const [tail, count] of [
    ['function outer() { function* NM() {} return NM.Camera.take(); }', 3],
    ['async function outer() { async function* NM() {} return NM.Camera.take(); }', 3],
    ['const f = function* NM() { return NM.Camera.take(); };', 2],
    ['const f = (NM): Promise<void> => NM.Camera.take();', 3],
    ['const f = <T,>(NM: T): T => NM.Camera.take();', 3],
    ['const f = async (NM): Promise<number> => NM.Camera.take();', 3],
    ['const f = (a: string, NM?: number): ((x: number) => void) => NM.Camera.take();', 3],
  ] as const) {
    const document = assemble({ 'src/c.js': head + tail });
    assert.deepEqual(document.facts, [], tail);
    assert.ok(bindingScope(document)?.startsWith(`js-binding-scope: ${count} native module references `), tail);
  }
  // 생성기·일반 메서드 이름은 범위에 이름을 묶지 않고, 블록 본문은 반환 타입이 붙어도 매개변수가 가린다 — 그대로 사실이다.
  for (const tail of [
    'class K { *NM() { return 1; } }',
    'class K { async *NM() { return 1; } }',
    'const o = { *NM() { return 1; } };',
    'function f(NM): void { NM.Camera.take(); }',
    'const f = (NM): void => { NM.Camera.take(); };',
  ]) {
    assert.deepEqual(factLines(assemble({ 'src/d.js': head + tail })), ['module-import Camera@2', 'method-invoke Camera.open@2'], tail);
  }
  // 블록 본문 화살표는 매개변수가 가리므로 그대로 사실이다.
  const kept = assemble({
    'src/b.js': "const { NativeModules: NM } = require('react-native');\nNM.Haptics.go();\nitems.forEach((NM) => { NM.Camera.take(); });",
  });
  assert.deepEqual(factLines(kept), ['module-import Haptics@2', 'method-invoke Haptics.go@2']);
});

test('객체 키·메서드 이름 자리의 레지스트리 별칭은 값이 아니다', () => {
  // PR #167 재확인 중 확인: 객체·타입 리터럴 키(`{ NM: 1 }`)와 객체·클래스 메서드 이름(`NM() {`, `*NM() {`, `get NM() {`)을 베어
  // 레지스트리 값으로 읽어 동적 `module-import NativeModules`를 냈다 — 새 require 별칭 출처로도 닿았다. 이름 자리라 값 쓰임이
  // 아니다. 이름 그대로인 `NativeModules`는 main부터의 동작 그대로다(HANDOFF 후속 후보).
  for (const text of [
    "const { NativeModules: NM } = require('react-native');\nNM.Camera.open();\nclass K { NM() { return 1; } *NM2() {} get NM3() { return 1; } }\nconst o = { NM: 1, NM() {}, *NM() {} };",
    "import { NativeModules as NM } from 'react-native';\nNM.Camera.open();\nconst o = { NM: 1, get NM() { return 1; } };",
  ]) {
    assert.deepEqual(factLines(assemble({ 'src/a.js': text })), ['module-import Camera@2', 'method-invoke Camera.open@2'], text);
  }
  // 단축 속성(`{ NM }`)·계산 키(`[NM]`)는 값 쓰임이다. 다음 줄 `{`는 호출 뒤 블록일 수도 있어(올맨 메서드와 가르지 못한다) 값
  // 쓰임으로 둔다.
  const values = assemble({
    'src/b.js': "import { NativeModules as NM } from 'react-native';\nconst o = { NM };\nconst p = { [NM]: 1 };\nfunction f() {\n  NM(x)\n  {\n    noop();\n  }\n}",
  });
  assert.deepEqual(factLines(values), ['module-import NativeModules@2', 'module-import NativeModules@3', 'module-import NativeModules@5']);
});

test('레지스트리 별칭과 이름이 같은 다른 범위의 선언은 그 위치에서 다른 이름처럼 읽는다', () => {
  // PR #167 리뷰: 레지스트리 이름 판정의 입구가 이름 단위(구조 분해 원천 지도·import 별칭)라, 다른 함수의 레지스트리 별칭과
  // 이름이 같은 로컬 모듈 바인딩의 호출이 레지스트리 경로로 들어가 계수 없이 사라졌다(`Cam.take`, `Torch.on`). 마지막 구조
  // 분해가 이기는 지도라 다른 함수의 `const { NM } = props`·`const { Foo: NM } = RN`이 레지스트리 별칭 `NM`의 참 호출을 지웠다.
  const document = assemble({
    'src/a.js': "import * as RN from 'react-native';\nfunction a() { const { NativeModules: Cam } = RN; Cam.X.y(); }\nfunction b() { const Cam = requireNativeModule('Cam'); Cam.take(); }",
    'src/b.js': "import * as RN from 'react-native';\nfunction a() { const { NativeModules: NM } = RN; NM.A.a(); }\nfunction b() { const { NM } = props; NM.B.b(); }\nfunction c() { const { Foo: NM } = RN; NM.C.c(); }",
    'src/c.js': "import { NativeModules as Cam } from 'react-native';\nfunction b() { const Cam = requireNativeModule('Cam'); Cam.take(); }",
    'src/d.js': "const { NativeModules } = require('react-native');\nfunction b() { const NativeModules = requireNativeModule('Torch'); NativeModules.on(); }",
    // `require('react-native')`에서 별칭으로 구조 분해한 레지스트리도 레지스트리다(전에는 사실이 없었다).
    'src/e.js': "const { NativeModules: NM } = require('react-native');\nNM.Haptics.go();",
  });
  assert.deepEqual(factLines(document), [
    'module-import X@2', 'method-invoke X.y@2', 'module-import Cam@3', 'method-invoke Cam.take@3',
    'module-import A@2', 'method-invoke A.a@2',
    'module-import Cam@2', 'method-invoke Cam.take@2',
    'module-import Torch@2', 'method-invoke Torch.on@2',
    'module-import Haptics@2', 'method-invoke Haptics.go@2',
  ]);
});

test('템플릿 보간 안의 재대입은 바인딩을 지우고 보간 안의 모듈 쓰임은 센다', () => {
  // 기록된 결함 S2: 보간은 토큰 하나라 `` `${M = other}` `` 뒤의 `M.take()`가 거짓 Camera.take였고, `` `${M.take()}` ``의 호출은
  // 귀속도 계수도 없이 사라졌다(보간이 브리지 API 이름을 언급할 때만 하한으로 셌다).
  for (const [line, count] of [
    ['const s = `${M = other}`;', 3],
    ['log(`a${b}c${`${M += 1}`}`);', 3],
    ['const t = `${(() => { M = other; })()}`;', 3],
    ['const u = `${M++}`;', 3],
    // PR #167 리뷰: 보간 안 for-of/in의 선언 없는 대상도 재대입이다(전에는 대입·증감 토큰만 봐 거짓 Camera.take였다).
    ['log(`${(() => { for (M of fakes); })()}`);', 3],
    ['log(`${(() => { for (M in table); })()}`);', 3],
    ['log(`${(async () => { for await (M of stream); })()}`);', 3],
  ] as const) {
    const document = assemble({
      'src/a.js': `import { NativeModules } from 'react-native';\nlet M = NativeModules.Camera;\n${line}\nM.take();`,
    });
    assert.deepEqual(factLines(document), ['module-import Camera@2'], line);
    // 초기값·보간 안 M·뒤 호출이다.
    assert.ok(bindingScope(document)?.startsWith(`js-binding-scope: ${count} native module references `), line);
  }
  const used = assemble({
    'src/b.js': [
      "import { NativeModules } from 'react-native';",
      "import Shared from './shared';",
      'const M = NativeModules.Camera;',
      'log(`photo ${M.take()} ${Shared.go()}`);',
      // 멤버 증감·호출의 대상은 바인딩 자체를 바꾸지 않는다.
      'log(`n=${M.count++} ${M.reset()}`);',
      'M.close();',
    ].join('\n'),
    'src/shared.js': "export default requireNativeModule('Shared');",
  });
  assert.deepEqual(factLines(used), [
    'module-import Camera@3', 'method-invoke Camera.close@6', 'module-import Shared@1',
  ]);
  // 보간 안 M 쓰임 셋과 상대 import Shared 하나다.
  assert.ok(bindingScope(used)?.startsWith('js-binding-scope: 4 native module references '), bindingScope(used));
  // 보간 안 대입이 확실한 매개변수의 것이면 바깥 바인딩은 그대로다. 대입 연산자가 없으면 지우지 않는다.
  // 속성 자리 이름(`o.M = 1`의 M)과 태그 호출의 대상(`` M`t` ``의 M — 중첩 템플릿 자리)은 대입 대상이 아니다.
  const kept = assemble({
    'src/c.js': [
      "import { NativeModules } from 'react-native';",
      'const M = NativeModules.Camera;',
      'function f(M) { return `${M = 1}`; }',
      'const label = `${M === other ? "a" : "b"}`;',
      'log(`${o.M = 1}`);',
      'log(`${M`t`.length + (n = 1)}`);',
      // PR #167 델타 리뷰: 속성 이름·객체 키 `for`는 반복문 머리가 아니다(전에는 참 Camera.take가 "재대입"으로 세어졌다).
      'log(`${foo(M, x.for)} ${x.for(M)} ${f({ for: M })}`);',
      'M.take();',
    ].join('\n'),
  });
  assert.deepEqual(factLines(kept), ['module-import Camera@2', 'method-invoke Camera.take@8']);
  // PR #167 리뷰: 보간 안 레지스트리 별칭 쓰임은 사실도 계수도 없이 사라졌다(브리지 API 낱말 검사는 별칭을 못 본다). 위치에서
  // 레지스트리인 별칭 쓰임을 센다. 브리지 API 이름 그대로인 NativeModules는 그대로 하한으로만 세고, 다른 모듈의 별칭은 아니다.
  for (const [text, count] of [
    ["import { NativeModules as NM } from 'react-native';\nlog(`${NM.Camera.take()}`);", 1],
    ["import * as RN from 'react-native';\nconst { NativeModules: NM } = RN;\nlog(`${NM.Camera.take()} ${NM.Torch.on()}`);", 2],
    ["import { NativeModules } from 'react-native';\nlog(`${NativeModules.Camera.take()}`);", 0],
    ["import { NativeModules as NM } from 'other';\nlog(`${NM.Camera.take()}`);", 0],
  ] as const) {
    const document = assemble({ 'src/d.js': text });
    assert.deepEqual(document.facts, [], text);
    assert.ok(bindingScope(document)?.startsWith(`js-binding-scope: ${count} native module references `), text);
  }
});

test('보간 안 정규식 리터럴 뒤의 코드도 읽는다', () => {
  // 보간 건너뛰기가 정규식을 읽지 않아 `/"/g`·`/\//g`·`/{/` 안의 글자를 문자열·주석·깊이로 읽었고, 템플릿이 파일 뒤쪽까지
  // 이어졌다. 뒤의 참 Camera.take는 한계 없이 사라졌다(템플릿 원문이 브리지 API 이름을 언급할 때만 하한으로 셌다).
  for (const regex of ['/"/g', "/'/g", '/\\//g', '/{/g', '/`/g']) {
    const document = assemble({
      'src/a.js': [
        "import { NativeModules } from 'react-native';",
        'const Cam = NativeModules.Camera;',
        'export function label(name) {',
        `  return \`\${name.replace(${regex}, '')}\`;`,
        '}',
        'Cam.take();',
      ].join('\n'),
    });
    assert.deepEqual(factLines(document), ['module-import Camera@2', 'method-invoke Camera.take@6'], regex);
    assert.deepEqual(document.limitations, [], regex);
  }
  // 삼킨 구간이 같은 이름의 안쪽 선언을 가려 거짓 사실도 냈다 — `'"}\`'`의 `"`·`}`·백틱이 삼킴을 끝내면 함수 머리와 대역
  // 선언 없이 `M.take()`만 보여 바깥 Camera로 귀속됐다.
  const shadowed = assemble({
    'src/b.js': [
      "import { NativeModules } from 'react-native';",
      'const M = NativeModules.Camera;',
      "const q = `${s.replace(/\"/g, '')}`;",
      'function f() {',
      '  const M = makeFake();',
      "  log('\"}`');",
      '  M.take();',
      '}',
    ].join('\n'),
  });
  assert.deepEqual(factLines(shadowed), ['module-import Camera@2']);
});

test('보간 안 값 뒤의 나눗셈은 정규식으로 읽지 않아 뒤 코드를 삼키지 않는다', () => {
  // PR #168 리뷰 S1·S2·S3·N1: 타입 인수 `>`, `<Fade in />`의 예약어 이름 속성, 이름으로 쓴 `await`, private 이름·비ASCII 글자가
  // 붙은 예약어 꼴 이름 뒤의 `/`를 정규식 시작으로 읽어 템플릿이 뒤 코드를 삼켰고, 참 Camera.take가 한계 없이 사라졌다.
  const header = "import { NativeModules } from 'react-native';\nconst Cam = NativeModules.Camera;";
  for (const [path, line] of [
    ['src/a.ts', 'const label = (n: number) => `${n as Fixed<2> / 100} / ${max}`;'],
    ['src/b.tsx', 'const html = `<body>${renderToString(<Fade in />)}</body>`;'],
    ['src/c.js', 'var await = 2; const half = `${await / 2}"/`;'],
    ['src/d.js', 'class K { #new = 1; m() { return `${this.#new / 2}"/`; } }'],
    ['src/e.js', 'const Δin = 1; const r = `${Δin / 2}"/`;'],
  ] as const) {
    const document = assemble({ [path]: `${header}\n${line}\nCam.take();` });
    assert.deepEqual(factLines(document), ['module-import Camera@2', 'method-invoke Camera.take@4'], line);
    assert.deepEqual(document.limitations, [], line);
  }
});

test('속성 자리의 function·이름 뒤 다음 줄 블록은 함수 본문이 아니다', () => {
  // 기록된 결함 b07: `foo.function(M)` 뒤 다음 줄 `{`의 속성 이름 `function`을 함수 키워드로 읽어 블록 안 M을 확실히 가렸다
  // (참 Camera.take가 조용히 사라졌다). 같은 오인으로 그 블록의 `var`를 함수 본문에 가둬 블록 뒤 쓰임을 바깥 Camera로
  // 귀속했다(거짓 사실). 함수·메서드 이름은 `.` 뒤에 오지 않으므로 속성 자리 이름 뒤 괄호는 멤버 호출이다.
  for (const head of ['foo.function(M)', 'foo?.function(M)', 'foo.bar(M)', 'this.get(M)']) {
    const document = assemble({
      'src/a.js': `import { NativeModules } from 'react-native';\nconst M = NativeModules.Camera;\n${head}\n{\n  M.take();\n}`,
    });
    assert.deepEqual(factLines(document), ['module-import Camera@2', 'method-invoke Camera.take@5'], head);
  }
  const hoisted = assemble({
    'src/b.js': [
      "import { NativeModules } from 'react-native';",
      'const M = NativeModules.Camera;',
      'function g() {',
      '  foo.function(x)',
      '  {',
      '    var M = makeFake();',
      '  }',
      '  M.take();',
      '}',
    ].join('\n'),
  });
  assert.deepEqual(factLines(hoisted), ['module-import Camera@2']);
  assert.ok(bindingScope(hoisted)?.startsWith('js-binding-scope: '), hoisted.limitations.join('\n'));
  // 클래스·객체의 `function` 이름 메서드는 그대로 매개변수가 가린다.
  const method = assemble({
    'src/c.js': "import { NativeModules } from 'react-native';\nconst M = NativeModules.Camera;\nclass K {\n  function(M) {\n    M.take();\n  }\n}",
  });
  assert.deepEqual(factLines(method), ['module-import Camera@2']);
});
