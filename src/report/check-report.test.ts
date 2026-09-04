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

test('조인 결과의 오류·경고·정상 연결 수를 요약한다', () => {
  const joined = joinBridgeDocuments([dartDocument, swiftDocument]);

  const report = createCheckReport(joined);

  assert.deepEqual(report.summary, {
    errors: 1,
    warnings: 2,
    matchedChannels: 1,
    matchedMethods: 1,
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
  const joined = joinBridgeDocuments([documentWithOrphan, swiftDocument]);

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

/** 실제 Phase 0 JSON을 제품 파서로 검증한다. */
async function loadDocument(relativePath: string): Promise<BridgeFactsDocument> {
  const text = await readFile(new URL(relativePath, import.meta.url), 'utf8');
  return parseBridgeFactsDocument(JSON.parse(text));
}
