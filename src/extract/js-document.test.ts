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
  // 다른 모듈의 interop 결과는 react-native가 아니다.
  const other = assemble({ 'src/a.js': "var _shim = _interopRequireDefault(require('./shim'));\n_shim.default.NativeModules.Camera.open();\n" });
  assert.deepEqual(other.facts, []);
  assert.ok(other.limitations.some((line) => line.startsWith('unattributed-js-native-modules: 1 ')));
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
