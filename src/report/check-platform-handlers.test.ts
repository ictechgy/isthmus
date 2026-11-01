import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { parseBridgeFactsDocument, type BridgeFactsDocument } from '../exchange/parse.ts';
import { joinBridgeDocuments } from '../join/join.ts';
import { createCheckReport, encodeCheckReport } from './check-report.ts';
import { createCodeQualityFindings } from './codequality.ts';
import { createSarifLog, encodeSarifLog } from './sarif.ts';

const dartDocument = await loadFixture('dart.json');
const swiftDocument = await loadFixture('swift.json');

interface ReceiverFact {
  readonly kind: 'channel-register' | 'method-handle';
  readonly channel: string | null;
  readonly method?: string;
  readonly line: number;
  readonly dynamic?: boolean;
}

/** fixtures/bridge와 같은 project의 수신 측 문서를 만든다. 위치는 플랫폼별 고정 경로다. */
function receiverDocument(
  platform: 'swift' | 'kotlin',
  facts: readonly ReceiverFact[],
  limitations: readonly string[] = [],
  limitationScopes?: readonly { limitationIndex: number; channels: readonly string[] }[],
): BridgeFactsDocument {
  const path = platform === 'kotlin' ? 'android/Handler.kt' : 'ios/Other.swift';
  return parseBridgeFactsDocument({
    format: 'bridge-facts',
    version: 1,
    project: '/fixture',
    platform,
    target: 'flutter',
    generatedAt: '2026-09-14T00:00:00Z',
    tool: { name: `fixture-${platform}`, version: '1' },
    limitations,
    ...(limitationScopes === undefined ? {} : { limitationScopes }),
    facts: facts.map(({ kind, channel, method, line, dynamic }) => ({
      kind,
      channel,
      ...(method === undefined ? {} : { method }),
      dynamic: dynamic ?? false,
      location: { path, line, column: 1 },
      symbol: { qualifiedName: 'Handler.handle' },
    })),
  });
}

const kotlinRegistersCamera = receiverDocument('kotlin', [
  { kind: 'channel-register', channel: 'camera', line: 7 },
]);

test('다른 수신 플랫폼만 처리하는 호출은 채널을 등록한 플랫폼의 핸들러 누락을 경고한다', () => {
  // 재현: Swift는 camera/photo를 처리하지만 같은 채널을 등록한 Kotlin에는 photo 핸들러가 없다.
  const report = createCheckReport(joinBridgeDocuments([dartDocument, swiftDocument, kotlinRegistersCamera]));

  assert.deepEqual(report.issues, [{
    severity: 'warning',
    code: 'invocation-unhandled-on-platform',
    target: 'flutter',
    channel: 'camera',
    method: 'photo',
    platform: 'kotlin',
    evidence: [
      {
        platform: 'dart',
        location: { path: 'lib/bridge.dart', line: 4, column: 1 },
        symbol: { qualifiedName: 'Bridge.photo' },
      },
      {
        platform: 'kotlin',
        location: { path: 'android/Handler.kt', line: 7, column: 1 },
        symbol: { qualifiedName: 'Handler.handle' },
      },
      {
        platform: 'swift',
        location: { path: 'ios/Handler.swift', line: 4, column: 1 },
        symbol: { qualifiedName: 'Handler.handle', usr: 's:handler' },
      },
    ],
  }]);
  // 기존 판정은 그대로다: 메서드는 여전히 match이고 error는 없다.
  assert.equal(report.summary.errors, 0);
  assert.equal(report.summary.warnings, 1);
  assert.equal(report.summary.matchedMethods, 1);
});

test('수신 플랫폼이 하나뿐인 입력의 check·SARIF 출력은 바뀌지 않는다', () => {
  const report = createCheckReport(joinBridgeDocuments([dartDocument, swiftDocument]));

  assert.equal(encodeCheckReport(report), `${JSON.stringify({
    format: 'isthmus-check',
    issues: [],
    limitations: [],
    summary: {
      errors: 0,
      matchedChannels: 1,
      matchedComponents: 0,
      matchedMethods: 1,
      matchedModules: 0,
      observedFacts: 4,
      observedLimitations: 0,
      warnings: 0,
    },
    version: 1,
  }, null, 2)}\n`);
  const rules = createSarifLog(report, undefined, () => 'fingerprint').runs[0]!.tool.driver.rules;
  assert.equal(rules.some(({ id }) => id.startsWith('invocation-unhandled-on-platform')), false);
});

test('두 수신 플랫폼이 모두 처리하면 경고하지 않는다', () => {
  const kotlin = receiverDocument('kotlin', [
    { kind: 'channel-register', channel: 'camera', line: 7 },
    { kind: 'method-handle', channel: 'camera', method: 'photo', line: 8 },
  ]);

  const report = createCheckReport(joinBridgeDocuments([dartDocument, swiftDocument, kotlin]));

  assert.deepEqual(report.issues, []);
});

test('채널을 관찰하지 않은 수신 플랫폼은 플랫폼 전용 채널일 수 있어 경고하지 않는다', () => {
  // Kotlin 문서는 다른 채널만 등록한다. camera가 iOS 전용 채널인지 Android 구현 누락인지
  // 정적 사실로 구분할 수 없으므로 추측해 연결하지 않는다.
  const kotlin = receiverDocument('kotlin', [
    { kind: 'channel-register', channel: 'battery', line: 7 },
    { kind: 'method-handle', channel: 'battery', method: 'level', line: 8 },
  ]);

  const report = createCheckReport(joinBridgeDocuments([dartDocument, swiftDocument, kotlin]));

  assert.deepEqual(
    report.issues.map(({ code, channel, method }) => [code, channel, method]),
    [
      ['registration-without-creation', 'battery', undefined],
      ['handler-without-invocation', 'battery', 'level'],
    ],
  );
});

test('어느 플랫폼도 처리하지 않는 호출은 기존 error 하나로만 보고한다', () => {
  const swiftWithoutHandler = receiverDocument('swift', [
    { kind: 'channel-register', channel: 'camera', line: 3 },
  ]);

  const report = createCheckReport(joinBridgeDocuments([dartDocument, swiftWithoutHandler, kotlinRegistersCamera]));

  assert.deepEqual(
    report.issues.map(({ code, severity, method }) => [code, severity, method]),
    [['unhandled-invocation', 'error', 'photo']],
  );
});

test('빠진 플랫폼이 스스로 신고한 핸들러 공백은 판정 불가로 내린다', () => {
  const kotlin = receiverDocument(
    'kotlin',
    [{ kind: 'channel-register', channel: 'camera', line: 7 }],
    ['opaque-handler-bodies: 1 handler body was not analyzed'],
  );

  const report = createCheckReport(joinBridgeDocuments([dartDocument, swiftDocument, kotlin]));

  assert.deepEqual(
    report.issues.map(({ code, severity, platform }) => [code, severity, platform]),
    [['invocation-unhandled-on-platform-unverified', 'warning', 'kotlin']],
  );
});

test('빠진 플랫폼의 동적 메서드 핸들러는 소비자 계수로 판정 불가가 된다', () => {
  const kotlin = receiverDocument('kotlin', [
    { kind: 'channel-register', channel: 'camera', line: 7 },
    { kind: 'method-handle', channel: 'camera', method: 'call.method', line: 8, dynamic: true },
  ], ['dynamic-methods: 1 handler uses a non-literal method name']);

  const report = createCheckReport(joinBridgeDocuments([dartDocument, swiftDocument, kotlin]));

  assert.deepEqual(
    report.issues.map(({ code, platform }) => [code, platform]),
    [['invocation-unhandled-on-platform-unverified', 'kotlin']],
  );
});

test('빠진 플랫폼의 사실 없는(target null) 문서가 신고한 공백도 그 플랫폼의 판정을 무른다', () => {
  // 수신 문서 여러 개가 소스 트리를 나눠 가질 수 있어, 귀속 없는 같은 플랫폼 문서의 공백도 모든 target에 적용한다.
  const kotlinGapOnly = parseBridgeFactsDocument({
    format: 'bridge-facts', version: 1, project: '/fixture', platform: 'kotlin', target: null,
    generatedAt: '2026-09-14T00:00:00Z', tool: { name: 'fixture-kotlin', version: '1' },
    limitations: ['opaque-handler-bodies: 1 handler body was not analyzed'], facts: [],
  });
  const swiftGapOnly = parseBridgeFactsDocument({ ...kotlinGapOnly, platform: 'swift' });

  const kotlinGap = createCheckReport(joinBridgeDocuments([dartDocument, swiftDocument, kotlinRegistersCamera, kotlinGapOnly]));
  const swiftGap = createCheckReport(joinBridgeDocuments([dartDocument, swiftDocument, kotlinRegistersCamera, swiftGapOnly]));

  assert.deepEqual(kotlinGap.issues.map(({ code, platform }) => [code, platform]),
    [['invocation-unhandled-on-platform-unverified', 'kotlin']]);
  assert.deepEqual(swiftGap.issues.map(({ code, platform }) => [code, platform]),
    [['invocation-unhandled-on-platform', 'kotlin']]);
});

test('다른 플랫폼·다른 채널의 공백은 빠진 플랫폼의 판정을 무르지 않는다', () => {
  // Swift가 신고한 공백은 Kotlin 핸들러를 가리지 못하고, Kotlin의 battery 범위 공백은 camera를 가리지 못한다.
  const swift = parseBridgeFactsDocument({
    ...swiftDocument,
    limitations: ['opaque-handler-bodies: 1 handler body was not analyzed'],
  });
  const kotlin = receiverDocument(
    'kotlin',
    [{ kind: 'channel-register', channel: 'camera', line: 7 }],
    ['opaque-handler-bodies: 1 handler body was not analyzed'],
    [{ limitationIndex: 0, channels: ['battery'] }],
  );

  const report = createCheckReport(joinBridgeDocuments([dartDocument, swift, kotlin]));

  assert.deepEqual(
    report.issues.map(({ code, severity, platform }) => [code, severity, platform]),
    [['invocation-unhandled-on-platform', 'warning', 'kotlin']],
  );
});

test('SARIF는 플랫폼 진단이 있을 때만 규칙을 싣고 메시지에 빠진 플랫폼을 밝힌다', () => {
  const report = createCheckReport(joinBridgeDocuments([dartDocument, swiftDocument, kotlinRegistersCamera]));

  const log = createSarifLog(report, undefined, () => 'fingerprint');
  const run = log.runs[0]!;
  const rule = run.tool.driver.rules.find(({ id }) => id === 'invocation-unhandled-on-platform');
  assert.equal(
    rule?.shortDescription.text,
    'A caller-side bridge method invocation is handled on another receiver platform, but not on a receiver platform that registers the same channel.',
  );
  assert.equal(
    run.tool.driver.rules.some(({ id }) => id === 'invocation-unhandled-on-platform-unverified'),
    false,
  );
  const result = run.results[0]!;
  assert.equal(result.ruleId, 'invocation-unhandled-on-platform');
  assert.equal(result.level, 'warning');
  assert.equal(
    result.message.text,
    "invocation-unhandled-on-platform on channel 'camera' for method 'photo' on platform 'kotlin'",
  );
  assert.deepEqual(result.properties, {
    target: 'flutter', channel: 'camera', method: 'photo', platform: 'kotlin',
  });
  // 주 위치는 호출, 관련 위치는 빠진 플랫폼의 채널 등록(핸들러를 더할 곳)과 다른 플랫폼의 핸들러다.
  assert.equal(result.locations?.[0]?.physicalLocation.artifactLocation.uri, 'lib/bridge.dart');
  assert.deepEqual(
    result.relatedLocations?.map(({ physicalLocation }) => physicalLocation.artifactLocation.uri),
    ['android/Handler.kt', 'ios/Handler.swift'],
  );
  assert.equal(JSON.parse(encodeSarifLog(log)).runs[0].results.length, 1);
});

test('Code Quality 발견도 빠진 수신 플랫폼을 설명에 싣는다', () => {
  const report = createCheckReport(joinBridgeDocuments([dartDocument, swiftDocument, kotlinRegistersCamera]));

  const [finding, ...rest] = createCodeQualityFindings(report, () => 'fingerprint');

  assert.deepEqual(rest, []);
  assert.equal(finding?.check_name, 'isthmus:invocation-unhandled-on-platform');
  assert.equal(finding?.severity, 'minor');
  assert.equal(
    finding?.description,
    'A caller-side bridge method invocation is handled on another receiver platform, but not on a receiver platform '
      + "that registers the same channel. Channel 'camera', method 'photo', platform 'kotlin' (target: flutter)",
  );
  assert.deepEqual(finding?.location, { path: 'lib/bridge.dart', lines: { begin: 4 } });
});

async function loadFixture(name: string): Promise<BridgeFactsDocument> {
  const text = await readFile(new URL(`../../fixtures/bridge/${name}`, import.meta.url), 'utf8');
  return parseBridgeFactsDocument(JSON.parse(text));
}
