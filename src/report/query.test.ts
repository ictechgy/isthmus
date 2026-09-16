import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  parseBridgeFactsDocument,
  type BridgeFactsDocument,
} from '../exchange/parse.ts';
import { joinBridgeDocuments } from '../join/join.ts';
import { createBridgeQuery, encodeBridgeQuery } from './query.ts';

const dartDocument = await loadDocument(
  '../../experiments/phase-0/expected/dart.json',
);
const swiftDocument = await loadDocument(
  '../../experiments/phase-0/expected/swift.json',
);

test('채널 질의가 생성 위치와 등록 위치를 양방향으로 답한다', () => {
  const joined = joinBridgeDocuments([dartDocument, swiftDocument]);

  const document = createBridgeQuery(joined, 'dev.isthmus/camera');

  assert.equal(document.status, 'found');
  assert.equal(document.requested, 'dev.isthmus/camera');
  assert.equal(document.level, 'bridge');
  assert.deepEqual(document.result?.subject, {
    name: 'dev.isthmus/camera',
    qualifiedName: 'flutter:dev.isthmus/camera',
    kind: 'channel',
  });
  assert.deepEqual(document.result?.usedBy, [
    {
      platform: 'dart',
      location: {
        path: 'lib/camera_bridge.dart',
        line: 3,
        column: 23,
      },
    },
  ]);
  assert.deepEqual(document.result?.dependsOn, [
    {
      platform: 'swift',
      location: {
        path: 'ios/Runner/CameraPlugin.swift',
        line: 11,
        column: 17,
      },
    },
  ]);
  assert.deepEqual(document.limitations, joined.limitations);
});

test('생성 없는 등록-only 채널도 수신 위치를 질의할 수 있다', () => {
  const receiverWithOrphan = parseBridgeFactsDocument({
    ...swiftDocument,
    facts: [
      ...swiftDocument.facts,
      {
        kind: 'channel-register',
        channel: 'dev.isthmus/native-only',
        dynamic: false,
        location: {
          path: 'ios/NativeOnlyPlugin.swift',
          line: 4,
          column: 9,
        },
      },
    ],
  });
  const joined = joinBridgeDocuments([dartDocument, receiverWithOrphan]);

  const document = createBridgeQuery(joined, 'dev.isthmus/native-only');

  assert.equal(document.status, 'found');
  assert.deepEqual(document.result?.usedBy, []);
  assert.deepEqual(document.result?.dependsOn, [
    {
      platform: 'swift',
      location: {
        path: 'ios/NativeOnlyPlugin.swift',
        line: 4,
        column: 9,
      },
    },
  ]);
});

test('메서드 질의가 호출 위치와 핸들러 위치를 양방향으로 답한다', () => {
  const joined = joinBridgeDocuments([dartDocument, swiftDocument]);

  const document = createBridgeQuery(joined, 'takePhoto');

  assert.equal(document.status, 'found');
  assert.deepEqual(document.result?.subject, {
    name: 'takePhoto',
    qualifiedName: 'flutter:dev.isthmus/camera#takePhoto',
    kind: 'method',
  });
  assert.deepEqual(document.result?.usedBy, [
    {
      platform: 'dart',
      location: {
        path: 'lib/camera_bridge.dart',
        line: 6,
        column: 23,
      },
    },
  ]);
  assert.deepEqual(document.result?.dependsOn, [
    {
      platform: 'swift',
      location: {
        path: 'ios/Runner/CameraPlugin.swift',
        line: 13,
        column: 18,
      },
      symbol: { qualifiedName: 'CameraPlugin.register' },
    },
  ]);
});

test('같은 짧은 이름의 채널과 메서드가 있으면 종류를 추측하지 않는다', () => {
  const channel = 'shared';
  const caller = parseBridgeFactsDocument({
    ...dartDocument,
    facts: [
      ...dartDocument.facts,
      {
        kind: 'channel-create',
        channel,
        dynamic: false,
        location: { path: 'lib/shared_bridge.dart', line: 2, column: 7 },
      },
      {
        kind: 'method-invoke',
        channel: 'dev.isthmus/camera',
        method: channel,
        dynamic: false,
        location: { path: 'lib/shared_bridge.dart', line: 4, column: 7 },
      },
    ],
  });
  const receiver = parseBridgeFactsDocument({
    ...swiftDocument,
    facts: [
      ...swiftDocument.facts,
      {
        kind: 'channel-register',
        channel,
        dynamic: false,
        location: { path: 'ios/SharedPlugin.swift', line: 2, column: 7 },
      },
      {
        kind: 'method-handle',
        channel: 'dev.isthmus/camera',
        method: channel,
        dynamic: false,
        location: { path: 'ios/SharedPlugin.swift', line: 4, column: 7 },
      },
    ],
  });

  const document = createBridgeQuery(joinBridgeDocuments([caller, receiver]), channel);

  assert.equal(document.status, 'ambiguous');
  assert.deepEqual(document.candidates, [
    { qualifiedName: 'flutter:dev.isthmus/camera#shared' },
    { qualifiedName: 'flutter:shared' },
  ]);
});

test('같은 메서드가 여러 채널에 있으면 후보를 주고 추측하지 않는다', () => {
  const dartWithSecondChannel = parseBridgeFactsDocument({
    ...dartDocument,
    facts: [
      ...dartDocument.facts,
      {
        kind: 'method-invoke',
        channel: 'dev.isthmus/secondary',
        method: 'takePhoto',
        dynamic: false,
        location: { path: 'lib/secondary.dart', line: 8, column: 19 },
      },
    ],
  });
  const swiftWithSecondChannel = parseBridgeFactsDocument({
    ...swiftDocument,
    facts: [
      ...swiftDocument.facts,
      {
        kind: 'method-handle',
        channel: 'dev.isthmus/secondary',
        method: 'takePhoto',
        dynamic: false,
        location: { path: 'ios/SecondaryPlugin.swift', line: 12, column: 18 },
        symbol: { qualifiedName: 'SecondaryPlugin.register' },
      },
    ],
  });
  const joined = joinBridgeDocuments([
    dartWithSecondChannel,
    swiftWithSecondChannel,
  ]);

  const document = createBridgeQuery(joined, 'takePhoto');

  assert.equal(document.status, 'ambiguous');
  assert.equal(document.result, undefined);
  assert.deepEqual(document.candidates, [
    {
      qualifiedName: 'flutter:dev.isthmus/camera#takePhoto',
    },
    {
      qualifiedName: 'flutter:dev.isthmus/secondary#takePhoto',
    },
  ]);

  const selected = createBridgeQuery(
    joined,
    'flutter:dev.isthmus/secondary#takePhoto',
  );

  assert.equal(selected.status, 'found');
  assert.equal(
    selected.result?.subject.qualifiedName,
    'flutter:dev.isthmus/secondary#takePhoto',
  );
});

test('같은 채널이 여러 target에 있으면 후보를 주고 qualifiedName으로 고른다', () => {
  const reactNativeCaller = parseBridgeFactsDocument({
    ...dartDocument,
    platform: 'js',
    target: 'react-native',
  });
  const reactNativeReceiver = parseBridgeFactsDocument({
    ...swiftDocument,
    target: 'react-native',
  });
  const joined = joinBridgeDocuments([
    dartDocument,
    swiftDocument,
    reactNativeCaller,
    reactNativeReceiver,
  ]);

  const ambiguous = createBridgeQuery(joined, 'dev.isthmus/camera');

  assert.equal(ambiguous.status, 'ambiguous');
  assert.deepEqual(ambiguous.candidates, [
    { qualifiedName: 'flutter:dev.isthmus/camera' },
    { qualifiedName: 'react-native:dev.isthmus/camera' },
  ]);

  const selected = createBridgeQuery(
    joined,
    'react-native:dev.isthmus/camera',
  );
  assert.equal(selected.status, 'found');
  assert.equal(
    selected.result?.subject.qualifiedName,
    'react-native:dev.isthmus/camera',
  );
});

test('qualifiedName은 채널의 구분 문자를 이스케이프해 메서드와 충돌하지 않는다', () => {
  const channel = 'dev.isthmus/camera#takePhoto';
  const caller = parseBridgeFactsDocument({
    ...dartDocument,
    facts: [
      ...dartDocument.facts,
      {
        kind: 'channel-create',
        channel,
        dynamic: false,
        location: { path: 'lib/hash_bridge.dart', line: 2, column: 7 },
      },
    ],
  });
  const receiver = parseBridgeFactsDocument({
    ...swiftDocument,
    facts: [
      ...swiftDocument.facts,
      {
        kind: 'channel-register',
        channel,
        dynamic: false,
        location: { path: 'ios/HashPlugin.swift', line: 4, column: 9 },
      },
    ],
  });
  const joined = joinBridgeDocuments([caller, receiver]);

  const method = createBridgeQuery(
    joined,
    'flutter:dev.isthmus/camera#takePhoto',
  );
  const escapedChannel = createBridgeQuery(
    joined,
    'flutter:dev.isthmus/camera%23takePhoto',
  );

  assert.equal(method.result?.subject.kind, 'method');
  assert.equal(escapedChannel.result?.subject.kind, 'channel');
});

test('qualifiedName 정확 일치는 다른 종류의 같은 짧은 이름보다 우선한다', () => {
  const channel = 'flutter:dev.isthmus/camera#takePhoto';
  const caller = parseBridgeFactsDocument({
    ...dartDocument,
    facts: [
      ...dartDocument.facts,
      {
        kind: 'channel-create',
        channel,
        dynamic: false,
        location: { path: 'lib/qualified_bridge.dart', line: 2, column: 7 },
      },
    ],
  });
  const receiver = parseBridgeFactsDocument({
    ...swiftDocument,
    facts: [
      ...swiftDocument.facts,
      {
        kind: 'channel-register',
        channel,
        dynamic: false,
        location: { path: 'ios/QualifiedPlugin.swift', line: 2, column: 7 },
      },
    ],
  });

  const document = createBridgeQuery(
    joinBridgeDocuments([caller, receiver]),
    channel,
  );

  assert.equal(document.status, 'found');
  assert.equal(document.result?.subject.kind, 'method');
  assert.equal(
    document.result?.subject.qualifiedName,
    'flutter:dev.isthmus/camera#takePhoto',
  );
});

test('query JSON 키를 재귀 정렬하고 마지막 개행을 붙인다', () => {
  const joined = joinBridgeDocuments([dartDocument, swiftDocument]);
  const document = createBridgeQuery(joined, 'takePhoto');

  const encoded = encodeBridgeQuery(document);

  assert.ok(encoded.indexOf('"level"') < encoded.indexOf('"limitations"'));
  assert.ok(encoded.indexOf('"limitations"') < encoded.indexOf('"requested"'));
  assert.ok(encoded.indexOf('"requested"') < encoded.indexOf('"result"'));
  assert.ok(encoded.indexOf('"result"') < encoded.indexOf('"status"'));
  assert.equal(encoded.endsWith('\n'), true);
  assert.equal(encoded, encodeBridgeQuery(document));
});

test('보류된 조인을 notFound query로 만들지 않는다', () => {
  const joined = joinBridgeDocuments([
    dartDocument,
    parseBridgeFactsDocument({
      ...swiftDocument,
      limitations: [...swiftDocument.limitations, 'mixed-targets: multiple bridges'],
    }),
  ]);

  assert.throws(
    () => createBridgeQuery(joined, 'takePhoto'),
    /Cannot query a deferred bridge join\./,
  );
});

test('`:`가 든 채널도 qualifiedName에서 구분자와 구분되고 되돌아온다', () => {
  const joined = joinBridgeDocuments([
    parseBridgeFactsDocument({
      ...dartDocument,
      facts: [
        {
          kind: 'channel-create',
          channel: 'com:example/camera',
          dynamic: false,
          location: { path: 'lib/colon.dart', line: 1, column: 3 },
        },
        {
          kind: 'method-invoke',
          channel: 'com:example/camera',
          method: 'takePhoto',
          dynamic: false,
          location: { path: 'lib/colon.dart', line: 2, column: 3 },
        },
      ],
    }),
    parseBridgeFactsDocument({
      ...swiftDocument,
      facts: [
        {
          kind: 'channel-register',
          channel: 'com:example/camera',
          dynamic: false,
          location: { path: 'ios/Colon.swift', line: 4, column: 7 },
        },
        {
          kind: 'method-handle',
          channel: 'com:example/camera',
          method: 'takePhoto',
          dynamic: false,
          location: { path: 'ios/Colon.swift', line: 5, column: 7 },
        },
      ],
    }),
  ]);

  const byName = createBridgeQuery(joined, 'com:example/camera');
  assert.equal(byName.status, 'found');
  assert.equal(byName.result?.subject.qualifiedName, 'flutter:com%3Aexample/camera');

  // 구분자 세 문자가 모두 이스케이프되므로 첫 `:`와 `#` 기준 분해가 가역이다.
  const byQualifiedName = createBridgeQuery(
    joined,
    'flutter:com%3Aexample/camera#takePhoto',
  );
  assert.equal(byQualifiedName.status, 'found');
  assert.equal(byQualifiedName.result?.subject.kind, 'method');
  const [target, ...rest] = (byQualifiedName.result?.subject.qualifiedName ?? '').split(':');
  const [encodedChannel = '', encodedMethod = ''] = rest.join(':').split('#');
  assert.equal(target, 'flutter');
  assert.equal(decodeURIComponent(encodedChannel), 'com:example/camera');
  assert.equal(decodeURIComponent(encodedMethod), 'takePhoto');
});

test('RN 모듈 질의가 import 위치와 export 위치를 양방향으로 답한다', () => {
  const joined = joinBridgeDocuments([
    reactNativeJsDocument,
    reactNativeSwiftDocument,
  ]);

  const document = createBridgeQuery(joined, 'CameraModule');

  assert.equal(document.status, 'found');
  assert.deepEqual(document.result?.subject, {
    name: 'CameraModule',
    qualifiedName: 'react-native:module:CameraModule',
    kind: 'module',
  });
  assert.deepEqual(document.result?.usedBy, [
    {
      platform: 'js',
      location: { path: 'src/camera.ts', line: 2, column: 30 },
    },
  ]);
  assert.deepEqual(document.result?.dependsOn, [
    {
      platform: 'swift',
      location: { path: 'ios/CameraModule.m', line: 4, column: 1 },
    },
  ]);
});

test('RN 컴포넌트 질의가 require 위치와 export 위치를 양방향으로 답한다', () => {
  const joined = joinBridgeDocuments([
    reactNativeJsDocument,
    reactNativeSwiftDocument,
  ]);

  const document = createBridgeQuery(joined, 'CameraView');

  assert.equal(document.status, 'found');
  assert.equal(document.result?.subject.kind, 'component');
  assert.equal(
    document.result?.subject.qualifiedName,
    'react-native:component:CameraView',
  );
});

test('짝 없는 모듈 이름도 호출 측 증거만으로 질의할 수 있다', () => {
  const joined = joinBridgeDocuments([
    reactNativeJsDocument,
    parseBridgeFactsDocument({
      ...reactNativeSwiftDocument,
      target: null,
      facts: [],
    }),
  ]);

  const document = createBridgeQuery(joined, 'CameraModule');

  assert.equal(document.status, 'found');
  assert.equal(document.result?.subject.kind, 'module');
  assert.equal(document.result?.usedBy.length, 1);
  assert.deepEqual(document.result?.dependsOn, []);
});

test('같은 이름의 모듈과 컴포넌트는 종류를 추측하지 않고 모호로 답한다', () => {
  const sharedJs = parseBridgeFactsDocument({
    ...reactNativeJsDocument,
    facts: [
      {
        kind: 'module-import',
        channel: 'Shared',
        dynamic: false,
        location: { path: 'src/shared.ts', line: 1, column: 30 },
      },
      {
        kind: 'component-require',
        channel: 'Shared',
        dynamic: false,
        location: { path: 'src/Shared.tsx', line: 2, column: 22 },
      },
    ],
  });
  const sharedSwift = parseBridgeFactsDocument({
    ...reactNativeSwiftDocument,
    facts: [
      {
        kind: 'module-export',
        channel: 'Shared',
        dynamic: false,
        location: { path: 'ios/Shared.m', line: 3, column: 1 },
      },
      {
        kind: 'component-export',
        channel: 'Shared',
        dynamic: false,
        location: { path: 'ios/SharedManager.m', line: 4, column: 1 },
      },
    ],
  });

  const document = createBridgeQuery(
    joinBridgeDocuments([sharedJs, sharedSwift]),
    'Shared',
  );

  // kind 세그먼트가 둘을 구분하므로 후보를 다시 질의하면 모호성이 풀린다.
  assert.equal(document.status, 'ambiguous');
  assert.deepEqual(document.candidates, [
    { qualifiedName: 'react-native:component:Shared' },
    { qualifiedName: 'react-native:module:Shared' },
  ]);

  const resolved = createBridgeQuery(
    joinBridgeDocuments([sharedJs, sharedSwift]),
    'react-native:module:Shared',
  );
  assert.equal(resolved.status, 'found');
  assert.equal(resolved.result?.subject.kind, 'module');
});

/** 저장된 교환 JSON을 제품 파서로 검증한다. */
async function loadDocument(relativePath: string): Promise<BridgeFactsDocument> {
  const text = await readFile(new URL(relativePath, import.meta.url), 'utf8');
  return parseBridgeFactsDocument(JSON.parse(text));
}

/** RN 호출 측 js 문서다. extract-js 산출물 형태를 미리 세운 독립 기대값이다. */
const reactNativeJsDocument = parseBridgeFactsDocument({
  format: 'bridge-facts',
  version: 1,
  tool: { name: 'isthmus-extract-js', version: '0.1.0' },
  generatedAt: '2026-09-04T12:00:00Z',
  platform: 'js',
  target: 'react-native',
  project: '/fixture',
  facts: [
    {
      kind: 'module-import',
      channel: 'CameraModule',
      dynamic: false,
      location: { path: 'src/camera.ts', line: 2, column: 30 },
    },
    {
      kind: 'component-require',
      channel: 'CameraView',
      dynamic: false,
      location: { path: 'src/Camera.tsx', line: 5, column: 22 },
    },
  ],
  limitations: [],
});

/** RN iOS 수신 측 문서다. cartograph의 RCT_EXPORT_* 스캔 형태를 따른다. */
const reactNativeSwiftDocument = parseBridgeFactsDocument({
  format: 'bridge-facts',
  version: 1,
  tool: { name: 'cartograph', version: '0.1.0' },
  generatedAt: '2026-09-04T12:00:00Z',
  platform: 'swift',
  target: 'react-native',
  project: '/fixture',
  facts: [
    {
      kind: 'module-export',
      channel: 'CameraModule',
      dynamic: false,
      location: { path: 'ios/CameraModule.m', line: 4, column: 1 },
    },
    {
      kind: 'component-export',
      channel: 'CameraView',
      dynamic: false,
      location: { path: 'ios/CameraViewManager.m', line: 9, column: 1 },
    },
  ],
  limitations: [],
});
