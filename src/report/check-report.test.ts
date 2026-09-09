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
