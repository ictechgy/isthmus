import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  parseBridgeFactsDocument,
  type BridgeFactsDocument,
} from '../exchange/parse.ts';
import { joinBridgeDocuments } from '../join/join.ts';
import { createCheckReport, encodeCheckReport } from './check-report.ts';

const dartDocument = await loadDocument(
  '../../experiments/phase-0/expected/dart.json',
);
const swiftDocument = await loadDocument(
  '../../experiments/phase-0/expected/swift.json',
);

/** 수신 측 관찰 공백이 없는 Swift 문서다. 판정 가능한 경로를 검사할 때 쓴다. */
const fullyObservedSwiftDocument = parseBridgeFactsDocument({
  ...swiftDocument,
  facts: swiftDocument.facts.filter((fact) => !fact.dynamic),
  limitations: swiftDocument.limitations.filter(
    (message) => !message.startsWith('dynamic-'),
  ),
});

test('조인 결과의 오류·경고·정상 연결 수를 요약한다', () => {
  const joined = joinBridgeDocuments([dartDocument, swiftDocument]);

  const report = createCheckReport(joined);

  assert.deepEqual(report.summary, {
    errors: 1,
    warnings: 2,
    matchedChannels: 1,
    matchedMethods: 1,
    matchedModules: 0,
    matchedComponents: 0,
    observedFacts: 10,
    observedLimitations: 7,
  });
});

test('핸들러 없는 호출과 호출 없는 핸들러를 심각도·증거로 보고한다', () => {
  const joined = joinBridgeDocuments([dartDocument, swiftDocument]);

  const report = createCheckReport(joined);

  assert.deepEqual(report.issues, [
    {
      severity: 'error',
      code: 'unhandled-invocation',
      target: 'flutter',
      channel: 'dev.isthmus/camera',
      method: 'takePhotos',
      evidence: [
        {
          platform: 'dart',
          location: {
            path: 'lib/camera_bridge.dart',
            line: 17,
            column: 23,
          },
        },
      ],
    },
    {
      severity: 'warning',
      code: 'handler-without-invocation',
      target: 'flutter',
      channel: 'dev.isthmus/camera',
      method: 'captureStill',
      evidence: [
        {
          platform: 'swift',
          location: {
            path: 'ios/Runner/CameraPlugin.swift',
            line: 13,
            column: 31,
          },
          symbol: { qualifiedName: 'CameraPlugin.register' },
        },
      ],
    },
    {
      severity: 'warning',
      code: 'handler-without-invocation',
      target: 'flutter',
      channel: 'dev.isthmus/camera',
      method: 'recordVideo',
      evidence: [
        {
          platform: 'swift',
          location: {
            path: 'ios/Runner/CameraPlugin.swift',
            line: 15,
            column: 18,
          },
          symbol: { qualifiedName: 'CameraPlugin.register' },
        },
      ],
    },
  ]);
});

test('등록 없는 채널 생성을 method 없는 오류로 보고한다', () => {
  const documentWithOrphan = parseBridgeFactsDocument({
    ...dartDocument,
    facts: [
      ...dartDocument.facts,
      {
        kind: 'channel-create',
        channel: 'dev.isthmus/orphan',
        dynamic: false,
        location: {
          path: 'lib/orphan_bridge.dart',
          line: 2,
          column: 17,
        },
      },
    ],
  });
  const joined = joinBridgeDocuments([
    documentWithOrphan,
    fullyObservedSwiftDocument,
  ]);

  const report = createCheckReport(joined);

  assert.deepEqual(
    report.issues.find(({ code }) => code === 'unregistered-channel-creation'),
    {
      severity: 'error',
      code: 'unregistered-channel-creation',
      target: 'flutter',
      channel: 'dev.isthmus/orphan',
      evidence: [
        {
          platform: 'dart',
          location: {
            path: 'lib/orphan_bridge.dart',
            line: 2,
            column: 17,
          },
        },
      ],
    },
  );
});

test('생성 없는 채널 등록을 method 없는 경고로 보고한다', () => {
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

  const report = createCheckReport(joined);

  assert.deepEqual(
    report.issues.find(({ code }) => code === 'registration-without-creation'),
    {
      severity: 'warning',
      code: 'registration-without-creation',
      target: 'flutter',
      channel: 'dev.isthmus/native-only',
      evidence: [
        {
          platform: 'swift',
          location: {
            path: 'ios/NativeOnlyPlugin.swift',
            line: 4,
            column: 9,
          },
        },
      ],
    },
  );
});

test('check 문서 종류·버전과 입력 limitations를 함께 제공한다', () => {
  const joined = joinBridgeDocuments([dartDocument, swiftDocument]);

  const report = createCheckReport(joined);

  assert.equal(report.format, 'isthmus-check');
  assert.equal(report.version, 1);
  assert.deepEqual(report.limitations, joined.limitations);
});

test('보류된 조인을 깨끗한 check 보고서로 만들지 않는다', () => {
  const joined = joinBridgeDocuments([
    dartDocument,
    parseBridgeFactsDocument({
      ...swiftDocument,
      limitations: [...swiftDocument.limitations, 'mixed-targets: multiple bridges'],
    }),
  ]);

  assert.throws(
    () => createCheckReport(joined),
    /Cannot create a check report from a deferred bridge join\./,
  );
});

test('check JSON 객체 키를 재귀 정렬하고 마지막 개행을 붙인다', () => {
  const joined = joinBridgeDocuments([dartDocument, swiftDocument]);
  const report = createCheckReport(joined);

  const encoded = encodeCheckReport(report);

  const formatIndex = encoded.indexOf('"format"');
  const issuesIndex = encoded.indexOf('"issues"');
  const limitationsIndex = encoded.indexOf('"limitations"');
  const summaryIndex = encoded.indexOf('"summary"');
  const versionIndex = encoded.lastIndexOf('"version"');
  assert.ok(formatIndex < issuesIndex);
  assert.ok(issuesIndex < limitationsIndex);
  assert.ok(limitationsIndex < summaryIndex);
  assert.ok(summaryIndex < versionIndex);
  assert.equal(encoded.endsWith('\n'), true);
  assert.equal(encoded, encodeCheckReport(report));
});

test('수신 측이 소스 분석 공백을 신고하면 오류 대신 판정 불가로 보고한다', () => {
  const objectiveCSwift = parseBridgeFactsDocument({
    ...fullyObservedSwiftDocument,
    facts: [],
    target: null,
    limitations: [
      'objective-c-sources: 2 Objective-C file(s) were read only for React Native '
      + 'export macros, so a Flutter handler written in Objective-C cannot appear here',
    ],
  });

  const report = createCheckReport(
    joinBridgeDocuments([dartDocument, objectiveCSwift]),
  );

  assert.equal(report.summary.errors, 0);
  assert.deepEqual(
    report.issues.map(({ code, severity }) => [code, severity]),
    [
      ['unhandled-invocation-unverified', 'warning'],
      ['unhandled-invocation-unverified', 'warning'],
      ['unregistered-channel-creation-unverified', 'warning'],
    ],
  );
});

test('판정 불가로 낮춰도 증거와 한계는 그대로 남긴다', () => {
  const objectiveCSwift = parseBridgeFactsDocument({
    ...fullyObservedSwiftDocument,
    facts: [],
    target: null,
    limitations: ['objective-c-sources: 2 file(s) are not analysed'],
  });

  const report = createCheckReport(
    joinBridgeDocuments([dartDocument, objectiveCSwift]),
  );

  const unverified = report.issues.find(
    ({ code }) => code === 'unhandled-invocation-unverified',
  );
  assert.equal(unverified?.evidence[0]?.platform, 'dart');
  assert.equal(
    report.limitations.some(({ message }) =>
      message.startsWith('objective-c-sources:'),
    ),
    true,
  );
});

test('호출 측 한계는 네이티브 핸들러를 가리지 않으므로 심각도를 낮추지 않는다', () => {
  const callerLimitedDart = parseBridgeFactsDocument({
    ...dartDocument,
    limitations: [
      ...dartDocument.limitations,
      'opaque-handler-bodies: 2 handlers are not read',
      'objective-c-sources: 2 file(s) are not analysed',
    ],
  });

  const report = createCheckReport(
    joinBridgeDocuments([callerLimitedDart, fullyObservedSwiftDocument]),
  );

  assert.equal(
    report.issues.some(({ code }) => code === 'unhandled-invocation'),
    true,
  );
  assert.equal(report.summary.errors > 0, true);
});

test('go 문서의 한계는 수신 측 공백 완화에 쓰이지 않는다', () => {
  // go는 수신 측이 아니므로, go 문서가 수신 공백과 같은 접두사의 한계를
  // 실어 와도 핸들러 진단의 심각도를 낮추지 못한다 — 낮춘다면 생산자가
  // 진짜 불일치를 경고로 묻는 변조 경로가 된다.
  const goDocument = parseBridgeFactsDocument({
    ...dartDocument,
    platform: 'go',
    target: null,
    facts: [],
    limitations: [
      'unscanned-ffi-interop: 1 Go source file uses cgo',
      'objective-c-sources: 9 file(s) are not analysed',
    ],
  });

  const report = createCheckReport(
    joinBridgeDocuments([dartDocument, fullyObservedSwiftDocument, goDocument]),
  );

  assert.equal(
    report.issues.some(({ code }) => code === 'unhandled-invocation'),
    true,
  );
  assert.equal(report.summary.errors > 0, true);
  // go limitation 자체는 platform 귀속으로 보존·전달된다.
  assert.equal(
    report.limitations.some(({ platform }) => platform === 'go'),
    true,
  );
});

test('채널 이름을 가리는 공백은 메서드 진단을 낮추지 않는다', () => {
  const dynamicChannelSwift = parseBridgeFactsDocument({
    ...fullyObservedSwiftDocument,
    facts: [
      ...fullyObservedSwiftDocument.facts,
      {
        kind: 'channel-register',
        channel: 'dev.isthmus/$feature',
        dynamic: true,
        location: { path: 'ios/Runner/CameraPlugin.swift', line: 31, column: 17 },
      },
    ],
  });

  const report = createCheckReport(
    joinBridgeDocuments([dartDocument, dynamicChannelSwift]),
  );

  assert.equal(
    report.issues.some(({ code }) => code === 'unhandled-invocation'),
    true,
  );
  assert.equal(
    report.issues.some(({ code }) => code === 'unhandled-invocation-unverified'),
    false,
  );
});

test('핸들러 본문을 가리는 공백은 등록 진단까지 낮추지 않는다', () => {
  const opaqueSwift = parseBridgeFactsDocument({
    ...fullyObservedSwiftDocument,
    limitations: ['opaque-handler-bodies: 2 named-function handlers are not read'],
  });

  const report = createCheckReport(
    joinBridgeDocuments([dartWithOrphanChannel(), opaqueSwift]),
  );

  assert.deepEqual(codesOf(report, 'unhandled-invocation'), [
    'unhandled-invocation-unverified',
  ]);
  assert.deepEqual(codesOf(report, 'unregistered-channel-creation'), [
    'unregistered-channel-creation',
  ]);
});

test('isthmus가 직접 센 핸들러 공백도 판정 불가 근거로 쓴다', () => {
  const dynamicHandlerSwift = parseBridgeFactsDocument({
    ...fullyObservedSwiftDocument,
    facts: [
      ...fullyObservedSwiftDocument.facts,
      {
        kind: 'method-handle',
        channel: 'dev.isthmus/camera',
        method: 'takePhoto',
        dynamic: true,
        location: { path: 'ios/Runner/CameraPlugin.swift', line: 21, column: 18 },
      },
    ],
  });
  const unattributedSwift = parseBridgeFactsDocument({
    ...fullyObservedSwiftDocument,
    facts: [
      ...fullyObservedSwiftDocument.facts,
      {
        kind: 'method-handle',
        channel: null,
        method: 'takePhotos',
        dynamic: false,
        location: { path: 'ios/Runner/Detached.swift', line: 4, column: 10 },
      },
    ],
    limitations: ['unattributed-method-handles: 1 handler has no channel'],
  });

  for (const receiver of [dynamicHandlerSwift, unattributedSwift]) {
    const report = createCheckReport(
      joinBridgeDocuments([dartDocument, receiver]),
    );

    assert.deepEqual(codesOf(report, 'unhandled-invocation'), [
      'unhandled-invocation-unverified',
    ]);
  }
});

test('채널 이름을 가리는 공백은 등록 진단을 판정 불가로 낮춘다', () => {
  const dynamicChannelSwift = parseBridgeFactsDocument({
    ...fullyObservedSwiftDocument,
    facts: [
      ...fullyObservedSwiftDocument.facts,
      {
        kind: 'channel-register',
        channel: 'dev.isthmus/$feature',
        dynamic: true,
        location: { path: 'ios/Runner/CameraPlugin.swift', line: 31, column: 17 },
      },
    ],
  });

  const report = createCheckReport(
    joinBridgeDocuments([dartWithOrphanChannel(), dynamicChannelSwift]),
  );

  assert.deepEqual(codesOf(report, 'unregistered-channel-creation'), [
    'unregistered-channel-creation-unverified',
  ]);
  assert.deepEqual(codesOf(report, 'unhandled-invocation'), [
    'unhandled-invocation',
  ]);
});

test('사실 생성을 보류한 공백은 등록과 핸들러를 모두 낮춘다', () => {
  const shadowedSwift = parseBridgeFactsDocument({
    ...fullyObservedSwiftDocument,
    limitations: [
      'shadowed-flutter-method-channel: 1 local declaration shadows the import',
    ],
  });

  const report = createCheckReport(
    joinBridgeDocuments([dartWithOrphanChannel(), shadowedSwift]),
  );

  assert.deepEqual(codesOf(report, 'unregistered-channel-creation'), [
    'unregistered-channel-creation-unverified',
  ]);
  assert.deepEqual(codesOf(report, 'unhandled-invocation'), [
    'unhandled-invocation-unverified',
  ]);
});

test('kotlin 수신 문서가 신고한 공백도 같은 규칙으로 인정한다', () => {
  const kotlinReceiver = parseBridgeFactsDocument({
    ...fullyObservedSwiftDocument,
    platform: 'kotlin',
    tool: { name: 'kartograph', version: '0.1.0' },
    facts: [
      {
        kind: 'method-handle',
        channel: 'dev.isthmus/camera',
        method: 'takePhoto',
        dynamic: true,
        location: { path: 'android/src/CameraPlugin.kt', line: 21, column: 18 },
      },
    ],
  });

  const report = createCheckReport(
    joinBridgeDocuments([dartDocument, kotlinReceiver]),
  );

  assert.deepEqual(codesOf(report, 'unhandled-invocation'), [
    'unhandled-invocation-unverified',
    'unhandled-invocation-unverified',
  ]);
  assert.deepEqual(codesOf(report, 'unregistered-channel-creation'), [
    'unregistered-channel-creation',
  ]);
});

test('다른 target 수신 문서가 신고한 공백은 현재 target 진단을 낮추지 않는다', () => {
  const reactNativeReceiver = parseBridgeFactsDocument({
    ...fullyObservedSwiftDocument,
    target: 'react-native',
    facts: [
      {
        kind: 'method-handle',
        channel: 'CameraModule',
        method: 'recordVideo',
        dynamic: false,
        location: { path: 'ios/CameraModule.swift', line: 8, column: 12 },
      },
    ],
    limitations: ['objective-c-sources: 1 Objective-C file(s) are not analysed'],
  });

  const report = createCheckReport(
    joinBridgeDocuments([
      dartWithOrphanChannel(),
      jsReactNativeCaller(),
      fullyObservedSwiftDocument,
      reactNativeReceiver,
    ]),
  );

  assert.deepEqual(codesForTarget(report, 'flutter', 'unhandled-invocation'), [
    'unhandled-invocation',
  ]);
  assert.deepEqual(
    codesForTarget(report, 'flutter', 'unregistered-channel-creation'),
    ['unregistered-channel-creation'],
  );
  assert.deepEqual(
    codesForTarget(report, 'react-native', 'unhandled-invocation'),
    ['unhandled-invocation-unverified'],
  );
  assert.deepEqual(
    codesForTarget(report, 'react-native', 'unregistered-channel-creation'),
    ['unregistered-channel-creation-unverified'],
  );
});

test('isthmus가 다른 target에서 센 공백도 현재 target 진단을 낮추지 않는다', () => {
  const reactNativeReceiver = parseBridgeFactsDocument({
    ...fullyObservedSwiftDocument,
    platform: 'kotlin',
    target: 'react-native',
    tool: { name: 'kartograph', version: '0.1.0' },
    facts: [
      {
        kind: 'method-handle',
        channel: 'CameraModule',
        method: 'takePhoto',
        dynamic: true,
        location: { path: 'android/CameraModule.kt', line: 12, column: 9 },
      },
    ],
    limitations: [],
  });

  const report = createCheckReport(
    joinBridgeDocuments([
      dartWithOrphanChannel(),
      jsReactNativeCaller(),
      fullyObservedSwiftDocument,
      reactNativeReceiver,
    ]),
  );

  assert.deepEqual(codesForTarget(report, 'flutter', 'unhandled-invocation'), [
    'unhandled-invocation',
  ]);
  assert.deepEqual(
    codesForTarget(report, 'flutter', 'unregistered-channel-creation'),
    ['unregistered-channel-creation'],
  );
  assert.deepEqual(
    codesForTarget(report, 'react-native', 'unhandled-invocation'),
    ['unhandled-invocation-unverified'],
  );
  assert.deepEqual(
    codesForTarget(report, 'react-native', 'unregistered-channel-creation'),
    ['unregistered-channel-creation'],
  );
});

test('사실이 없는 수신 문서의 공백은 귀속할 target이 없어 모두에게 적용한다', () => {
  const emptySwift = parseBridgeFactsDocument({
    ...fullyObservedSwiftDocument,
    facts: [],
    target: null,
    limitations: ['objective-c-sources: 2 file(s) are not analysed'],
  });

  const report = createCheckReport(
    joinBridgeDocuments([dartDocument, jsReactNativeCaller(), emptySwift]),
  );

  assert.equal(report.summary.errors, 0);
  assert.deepEqual(codesForTarget(report, 'flutter', 'unhandled-invocation'), [
    'unhandled-invocation-unverified',
    'unhandled-invocation-unverified',
  ]);
  assert.deepEqual(
    codesForTarget(report, 'react-native', 'unhandled-invocation'),
    ['unhandled-invocation-unverified'],
  );
  assert.deepEqual(
    codesForTarget(report, 'flutter', 'unregistered-channel-creation'),
    ['unregistered-channel-creation-unverified'],
  );
  assert.deepEqual(
    codesForTarget(report, 'react-native', 'unregistered-channel-creation'),
    ['unregistered-channel-creation-unverified'],
  );
});

test('귀속된 수신 문서와 공존해도 사실 없는 문서의 공백은 전체에 적용한다', () => {
  const emptySwift = parseBridgeFactsDocument({
    ...fullyObservedSwiftDocument,
    facts: [],
    target: null,
    limitations: ['objective-c-sources: 2 file(s) are not analysed'],
  });

  const report = createCheckReport(
    joinBridgeDocuments([dartDocument, fullyObservedSwiftDocument, emptySwift]),
  );

  assert.equal(report.summary.errors, 0);
  assert.deepEqual(codesForTarget(report, 'flutter', 'unhandled-invocation'), [
    'unhandled-invocation-unverified',
  ]);
});

test('isthmus 계수 접두사를 차용한 생산자 문자열은 공백 근거가 되지 않는다', () => {
  const spoofingSwift = parseBridgeFactsDocument({
    ...fullyObservedSwiftDocument,
    limitations: [
      ...fullyObservedSwiftDocument.limitations,
      'unjoined-dynamic-methods: 9 method facts with a non-literal name were not joined',
      'unjoined-dynamic-channels: 9 channel facts with a non-literal name were not joined',
      'unjoined-unattributed-handlers: 9 method handler facts without a channel were not joined',
    ],
  });

  const report = createCheckReport(
    joinBridgeDocuments([dartWithOrphanChannel(), spoofingSwift]),
  );

  assert.deepEqual(codesOf(report, 'unhandled-invocation'), [
    'unhandled-invocation',
  ]);
  assert.deepEqual(codesOf(report, 'unregistered-channel-creation'), [
    'unregistered-channel-creation',
  ]);
  assert.equal(report.summary.errors, 2);
});

test('한계 문구의 접두사가 정확히 맞을 때만 공백으로 본다', () => {
  for (const message of [
    'see objective-c-sources: 2 file(s) are not analysed',
    'objective-c-sources-extended: 2 file(s) are not analysed',
  ]) {
    const nearMissSwift = parseBridgeFactsDocument({
      ...fullyObservedSwiftDocument,
      limitations: [message],
    });

    const report = createCheckReport(
      joinBridgeDocuments([dartDocument, nearMissSwift]),
    );

    assert.deepEqual(codesOf(report, 'unhandled-invocation'), [
      'unhandled-invocation',
    ]);
  }
});

test('부분 관측에서 매치된 연결은 그대로 두고 나머지만 낮춘다', () => {
  const partiallyObservedSwift = parseBridgeFactsDocument({
    ...fullyObservedSwiftDocument,
    limitations: ['objective-c-sources: 2 file(s) are not analysed'],
  });

  const report = createCheckReport(
    joinBridgeDocuments([dartDocument, partiallyObservedSwift]),
  );

  assert.equal(report.summary.matchedMethods, 1);
  assert.equal(report.summary.errors, 0);
  assert.deepEqual(codesOf(report, 'unhandled-invocation'), [
    'unhandled-invocation-unverified',
  ]);
  assert.equal(
    report.issues.some(({ code }) => code === 'handler-without-invocation'),
    true,
  );
});

test('알려지지 않은 수신 측 한계는 공백으로 넓게 해석하지 않는다', () => {
  const unknownLimitationSwift = parseBridgeFactsDocument({
    ...fullyObservedSwiftDocument,
    limitations: ['some-future-limitation: 3 things happened'],
  });

  const report = createCheckReport(
    joinBridgeDocuments([dartDocument, unknownLimitationSwift]),
  );

  assert.equal(
    report.issues.some(({ code }) => code === 'unhandled-invocation'),
    true,
  );
  assert.equal(report.summary.errors > 0, true);
});

test('짝 없는 RN 모듈·컴포넌트 이름은 오류와 경고로 나누어 보고한다', () => {
  const report = createCheckReport(
    joinBridgeDocuments([jsReactNativeBoundary(), rnReceiverWithOtherNames()]),
  );

  assert.equal(report.summary.errors, 2);
  assert.equal(report.summary.warnings, 2);
  assert.equal(report.summary.matchedModules, 0);
  assert.equal(report.summary.matchedComponents, 0);
  assert.deepEqual(codesOf(report, 'module-import-without-export'), [
    'module-import-without-export',
  ]);
  assert.deepEqual(codesOf(report, 'component-require-without-export'), [
    'component-require-without-export',
  ]);
  assert.deepEqual(codesOf(report, 'module-export-without-import'), [
    'module-export-without-import',
  ]);
  assert.deepEqual(codesOf(report, 'component-export-without-require'), [
    'component-export-without-require',
  ]);
});

test('수신 측의 동적 export 공백은 미수출 진단을 판정 불가로 낮춘다', () => {
  const dynamicExportSwift = parseBridgeFactsDocument({
    ...fullyObservedSwiftDocument,
    target: 'react-native',
    tool: { name: 'cartograph', version: '0.1.0' },
    facts: [
      {
        kind: 'module-export',
        channel: 'CameraModule',
        dynamic: true,
        location: { path: 'ios/CameraModule.m', line: 4, column: 1 },
      },
    ],
    limitations: [],
  });

  const report = createCheckReport(
    joinBridgeDocuments([jsReactNativeBoundary(), dynamicExportSwift]),
  );

  assert.equal(report.summary.errors, 0);
  assert.deepEqual(codesOf(report, 'module-import-without-export'), [
    'module-import-without-export-unverified',
  ]);
  assert.deepEqual(codesOf(report, 'component-require-without-export'), [
    'component-require-without-export-unverified',
  ]);
});

test('호출 측의 동적 import 공백은 수신 측 export를 가리지 않아 오류를 유지한다', () => {
  const dynamicImportJs = parseBridgeFactsDocument({
    ...jsReactNativeBoundary(),
    facts: [
      ...jsReactNativeBoundary().facts,
      {
        kind: 'module-import',
        channel: 'dynamicName',
        dynamic: true,
        location: { path: 'src/dynamic.ts', line: 9, column: 40 },
      },
    ],
  });

  const report = createCheckReport(
    joinBridgeDocuments([dynamicImportJs, rnReceiverWithOtherNames()]),
  );

  assert.deepEqual(codesOf(report, 'module-import-without-export'), [
    'module-import-without-export',
  ]);
  assert.equal(report.summary.errors > 0, true);
});

test('계수 접두사를 차용한 생산자 문자열은 export 공백 근거가 되지 않는다', () => {
  const spoofingSwift = parseBridgeFactsDocument({
    ...fullyObservedSwiftDocument,
    target: null,
    facts: [],
    limitations: [
      'unjoined-dynamic-exports: 9 module or component export facts with a non-literal name were not joined',
    ],
  });

  const report = createCheckReport(
    joinBridgeDocuments([jsReactNativeBoundary(), spoofingSwift]),
  );

  assert.deepEqual(codesOf(report, 'module-import-without-export'), [
    'module-import-without-export',
  ]);
  assert.equal(report.summary.errors > 0, true);
});

/** 수출 이름을 찾는 호출 측 RN js 문서다. */
function jsReactNativeBoundary(): BridgeFactsDocument {
  return parseBridgeFactsDocument({
    ...dartDocument,
    platform: 'js',
    target: 'react-native',
    tool: { name: 'isthmus-extract-js', version: '0.1.0' },
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
}

/** 다른 이름을 수출하는 RN 수신 측 문서다. */
function rnReceiverWithOtherNames(): BridgeFactsDocument {
  return parseBridgeFactsDocument({
    ...fullyObservedSwiftDocument,
    target: 'react-native',
    tool: { name: 'cartograph', version: '0.1.0' },
    facts: [
      {
        kind: 'module-export',
        channel: 'BatteryModule',
        dynamic: false,
        location: { path: 'ios/BatteryModule.m', line: 3, column: 1 },
      },
      {
        kind: 'component-export',
        channel: 'MapView',
        dynamic: false,
        location: { path: 'ios/MapViewManager.m', line: 7, column: 1 },
      },
    ],
    limitations: [],
  });
}

/** 등록되지 않은 채널 생성을 하나 더 가진 호출 측 문서를 만든다. */
function dartWithOrphanChannel(): BridgeFactsDocument {
  return parseBridgeFactsDocument({
    ...dartDocument,
    facts: [
      ...dartDocument.facts,
      {
        kind: 'channel-create',
        channel: 'dev.isthmus/orphan',
        dynamic: false,
        location: { path: 'lib/orphan_bridge.dart', line: 2, column: 17 },
      },
    ],
  });
}

/** 핸들러 없는 정적 호출을 가진 React Native 호출 측 js 문서다. */
function jsReactNativeCaller(): BridgeFactsDocument {
  return parseBridgeFactsDocument({
    ...dartDocument,
    platform: 'js',
    target: 'react-native',
    tool: { name: 'isthmus-extract-js', version: '0.1.0' },
    facts: [
      {
        kind: 'channel-create',
        channel: 'CameraModule',
        dynamic: false,
        location: { path: 'src/camera.js', line: 3, column: 18 },
      },
      {
        kind: 'method-invoke',
        channel: 'CameraModule',
        method: 'takePhoto',
        dynamic: false,
        location: { path: 'src/camera.js', line: 7, column: 3 },
      },
    ],
    limitations: [],
  });
}

/** 한 진단 계열에서 실제로 보고된 code만 추린다. */
function codesOf(
  report: ReturnType<typeof createCheckReport>,
  prefix: string,
): string[] {
  return report.issues
    .map(({ code }) => code)
    .filter((code) => code.startsWith(prefix));
}

/** 특정 target의 진단 계열에서 보고된 code만 추린다. */
function codesForTarget(
  report: ReturnType<typeof createCheckReport>,
  target: string,
  prefix: string,
): string[] {
  return report.issues
    .filter((issue) => issue.target === target)
    .map(({ code }) => code)
    .filter((code) => code.startsWith(prefix));
}

/** 실제 Phase 0 JSON을 제품 파서로 검증한다. */
async function loadDocument(relativePath: string): Promise<BridgeFactsDocument> {
  const text = await readFile(new URL(relativePath, import.meta.url), 'utf8');
  return parseBridgeFactsDocument(JSON.parse(text));
}

/** mechanism·optional이 실린 RN 경계 문서를 만드는 테스트 조립기다. */
function rnBoundaryDocument(
  platform: 'js' | 'swift' | 'kotlin',
  facts: ReadonlyArray<{
    kind: 'module-import' | 'component-require' | 'module-export' | 'component-export';
    channel: string;
    mechanism?: 'core' | 'expo';
    optional?: boolean;
  }>,
): BridgeFactsDocument {
  return parseBridgeFactsDocument({
    ...fullyObservedSwiftDocument,
    platform,
    // 사실이 없는 완전 관찰 문서는 target을 비워야 계약을 만족한다.
    target: facts.length === 0 ? null : 'react-native',
    tool: { name: 'fixture', version: '0.1.0' },
    facts: facts.map((fact, index) => ({
      kind: fact.kind,
      channel: fact.channel,
      ...(fact.mechanism === undefined ? {} : { mechanism: fact.mechanism }),
      ...(fact.optional === undefined ? {} : { optional: fact.optional }),
      dynamic: false,
      location: { path: 'src/boundary.ts', line: index + 1, column: 1 },
    })),
    limitations: [],
  });
}

test('같은 이름이 mechanism만 다르면 미수출 error가 아니라 불일치 warning이다', () => {
  const report = createCheckReport(
    joinBridgeDocuments([
      rnBoundaryDocument('js', [
        { kind: 'module-import', channel: 'CameraModule' },
      ]),
      rnBoundaryDocument('swift', [
        { kind: 'module-export', channel: 'CameraModule', mechanism: 'expo' },
      ]),
    ]),
  );

  assert.equal(report.summary.errors, 0);
  assert.deepEqual(codesOf(report, 'module-import'), [
    'module-import-mechanism-mismatch',
  ]);
  // 도달하지 못한 expo export는 호출자가 있지만 mechanism이 달라
  // 미호출이 아니라 불일치 warning이다.
  assert.deepEqual(codesOf(report, 'module-export'), [
    'module-export-mechanism-mismatch',
  ]);
});

test('Expo component-require는 폴백이 없어 core export 관찰 시 확정 error다', () => {
  const report = createCheckReport(
    joinBridgeDocuments([
      rnBoundaryDocument('js', [
        { kind: 'component-require', channel: 'CameraView', mechanism: 'expo' },
      ]),
      rnBoundaryDocument('swift', [
        { kind: 'component-export', channel: 'CameraView' },
      ]),
    ]),
  );

  assert.equal(report.summary.errors, 1);
  assert.deepEqual(codesOf(report, 'component-require'), [
    'component-require-without-export',
  ]);
});

test('core component-require가 expo export만 보면 상호운용 미해결 warning이다', () => {
  const report = createCheckReport(
    joinBridgeDocuments([
      rnBoundaryDocument('js', [
        { kind: 'component-require', channel: 'CameraView' },
      ]),
      rnBoundaryDocument('swift', [
        { kind: 'component-export', channel: 'CameraView', mechanism: 'expo' },
      ]),
    ]),
  );

  assert.equal(report.summary.errors, 0);
  assert.deepEqual(codesOf(report, 'component-require'), [
    'component-require-mechanism-mismatch',
  ]);
});

test('Expo module-import는 폴백으로 core export에 도달해 이슈가 없다', () => {
  const report = createCheckReport(
    joinBridgeDocuments([
      rnBoundaryDocument('js', [
        { kind: 'module-import', channel: 'CameraModule', mechanism: 'expo' },
      ]),
      rnBoundaryDocument('swift', [
        { kind: 'module-export', channel: 'CameraModule' },
      ]),
    ]),
  );

  assert.equal(report.summary.matchedModules, 1);
  assert.equal(report.issues.length, 0);
});

test('mechanism 불일치 진단은 호출·수신 양쪽 증거 위치를 함께 실는다', () => {
  const report = createCheckReport(
    joinBridgeDocuments([
      rnBoundaryDocument('js', [
        { kind: 'component-require', channel: 'CameraView', mechanism: 'expo' },
      ]),
      rnBoundaryDocument('swift', [
        { kind: 'component-export', channel: 'CameraView' },
      ]),
    ]),
  );

  // Expo require에 코어 export만 보인 확정 error다 — 증거에는 관찰된 수신 측
  // export 위치까지 실려 어느 export가 다른 경로로 해석되는지 보인다.
  const issue = report.issues.find(
    ({ code }) => code === 'component-require-without-export');
  assert.deepEqual(
    issue?.evidence.map(({ platform }) => platform).sort(),
    ['js', 'swift'],
  );
  // 도달 못한 core export도 불일치 호출 증거와 함께 warning으로 남는다.
  const exportIssue = report.issues.find(
    ({ code }) => code === 'component-export-mechanism-mismatch');
  assert.deepEqual(
    exportIssue?.evidence.map(({ platform }) => platform).sort(),
    ['js', 'swift'],
  );
});

test('mechanism이 섞인 호출자는 만족한 쪽만 매치하고 미만족 쪽을 따로 진단한다', () => {
  const report = createCheckReport(
    joinBridgeDocuments([
      rnBoundaryDocument('js', [
        { kind: 'component-require', channel: 'CameraView' },
        { kind: 'component-require', channel: 'CameraView', mechanism: 'expo' },
      ]),
      rnBoundaryDocument('swift', [
        { kind: 'component-export', channel: 'CameraView' },
      ]),
    ]),
  );

  // core 호출은 core export와 매치되고, expo 호출은 폴백이 없어 확정 error다.
  assert.equal(report.summary.matchedComponents, 1);
  assert.equal(report.summary.errors, 1);
  assert.deepEqual(codesOf(report, 'component-require'), [
    'component-require-without-export',
  ]);
  const issue = report.issues.find(
    ({ code }) => code === 'component-require-without-export');
  assert.deepEqual(
    issue?.evidence.map(({ mechanism }) => mechanism ?? 'core').sort(),
    ['core', 'expo'],
  );
});

test('호출자 전부가 부재 허용 API면 미수출은 error가 아니라 warning이다', () => {
  // requireOptionalNativeModule·Registry.get 계열은 부재 시 null을 돌려준다 —
  // 호출자가 부재를 감당하므로 미수출이 크래시를 뜻하지 않는다.
  const report = createCheckReport(
    joinBridgeDocuments([
      rnBoundaryDocument('js', [
        { kind: 'module-import', channel: 'MaybeModule', optional: true },
        { kind: 'module-import', channel: 'MaybeModule', optional: true },
      ]),
      rnBoundaryDocument('swift', []),
    ]),
  );

  assert.equal(report.summary.errors, 0);
  assert.deepEqual(codesOf(report, 'module-import'), [
    'module-import-without-export-optional',
  ]);
});

test('던지는 호출자가 섞이면 부재 허용 호출이 있어도 미수출은 error다', () => {
  // 같은 이름을 requireNativeModule로도 부르는 호출 지점이 있으면 그 쪽은
  // 부재 시 크래시하므로 error를 유지한다.
  const report = createCheckReport(
    joinBridgeDocuments([
      rnBoundaryDocument('js', [
        { kind: 'module-import', channel: 'CameraModule', optional: true },
        { kind: 'module-import', channel: 'CameraModule' },
      ]),
      rnBoundaryDocument('swift', []),
    ]),
  );

  assert.equal(report.summary.errors, 1);
  assert.deepEqual(codesOf(report, 'module-import'), [
    'module-import-without-export',
  ]);
});

test('optional 호출자에 mechanism 불일치 export가 관찰되면 불일치 진단이 우선이다', () => {
  // 코어 Registry.get 호출은 부재를 허용하지만 같은 이름의 expo export가
  // 관찰됐다면 "미검증"이 아니라 해석 경로 불일치가 정확한 진단이다.
  const report = createCheckReport(
    joinBridgeDocuments([
      rnBoundaryDocument('js', [
        { kind: 'module-import', channel: 'CameraModule', optional: true },
      ]),
      rnBoundaryDocument('swift', [
        { kind: 'module-export', channel: 'CameraModule', mechanism: 'expo' },
      ]),
    ]),
  );

  assert.equal(report.summary.errors, 0);
  assert.deepEqual(codesOf(report, 'module-import'), [
    'module-import-mechanism-mismatch',
  ]);
});
