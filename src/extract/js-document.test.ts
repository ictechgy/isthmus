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
    path: fact.location.path,
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
