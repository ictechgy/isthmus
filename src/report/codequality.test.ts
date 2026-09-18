import assert from 'node:assert/strict';
import test from 'node:test';

import { baselineEntryKey } from './baseline.ts';
import type { CheckReport } from './check-report.ts';
import {
  createCodeQualityFindings,
  encodeCodeQualityReport,
} from './codequality.ts';

/** 해싱은 cli 계층 소관이므로, report 테스트는 논리 키를 그대로 지문으로 쓴다. */
const logicalKeyFingerprint = (issue: Parameters<typeof baselineEntryKey>[0]) =>
  baselineEntryKey(issue);

test('check 보고서의 이슈를 Code Quality 발견으로 옮긴다', () => {
  const findings = createCodeQualityFindings(reportFixture(), logicalKeyFingerprint);
  const [first, second] = findings;
  assert.ok(first);
  assert.ok(second);

  assert.equal(first.check_name, 'isthmus:unhandled-invocation');
  assert.equal(first.severity, 'major');
  // 형식에 규칙 표가 없으므로 description이 산문 설명과 맥락을 함께 담는다.
  assert.equal(
    first.description,
    'A caller-side bridge method invocation has no matching handler on any '
    + "receiver-side document. Channel 'com.example/a', method 'ping' (target: flutter)",
  );
  assert.deepEqual(first.location, {
    path: 'lib/a.dart',
    lines: { begin: 3 },
  });
  assert.equal(first.fingerprint, baselineEntryKey({
    code: 'unhandled-invocation',
    target: 'flutter',
    channel: 'com.example/a',
    method: 'ping',
  }));

  assert.equal(second.check_name, 'isthmus:registration-without-creation');
  assert.equal(second.severity, 'minor');
  // 다중 증거의 발견 위치는 첫 번째 끝점이다 — SARIF의 primary location과 같은 규칙.
  assert.equal(second.location.path, 'src/A.swift');
});

test('발견 순서는 보고서의 이슈 순서를 그대로 따른다', () => {
  const findings = createCodeQualityFindings(reportFixture(), logicalKeyFingerprint);

  assert.deepEqual(
    findings.map(({ check_name }) => check_name),
    ['isthmus:unhandled-invocation', 'isthmus:registration-without-creation'],
  );
});

test('이슈가 없으면 빈 발견 목록을 낸다', () => {
  const findings = createCodeQualityFindings(
    { ...reportFixture(), issues: [] },
    logicalKeyFingerprint,
  );

  assert.deepEqual(findings, []);
  assert.equal(encodeCodeQualityReport(findings), '[]\n');
});

test('베이스라인 억제 이슈는 발견 목록에서 제외한다', () => {
  const issues = reportFixture().issues;
  const suppressedAll = createCodeQualityFindings({
    ...reportFixture(),
    issues: issues.map((issue) => ({ ...issue, suppressed: true as const })),
  }, logicalKeyFingerprint);
  const mixed = createCodeQualityFindings({
    ...reportFixture(),
    issues: issues.map((issue, index) =>
      index === 0 ? { ...issue, suppressed: true as const } : issue),
  }, logicalKeyFingerprint);

  assert.deepEqual(suppressedAll, []);
  assert.deepEqual(
    mixed.map(({ check_name }) => check_name),
    ['isthmus:registration-without-creation'],
  );
});

test('증거 없는 이슈는 발견을 만들 수 없다', () => {
  const report = {
    ...reportFixture(),
    issues: [
      {
        severity: 'error' as const,
        code: 'unhandled-invocation' as const,
        target: 'flutter' as const,
        channel: 'com.example/a',
        method: 'ping',
        evidence: [],
      },
    ],
  };

  assert.throws(
    () => createCodeQualityFindings(report, logicalKeyFingerprint),
    /without evidence/u,
  );
});

test('증거 위치가 첫 행보다 앞서면 만들 수 없다', () => {
  const report = {
    ...reportFixture(),
    issues: [
      {
        severity: 'error' as const,
        code: 'unhandled-invocation' as const,
        target: 'flutter' as const,
        channel: 'com.example/a',
        method: 'ping',
        evidence: [
          {
            platform: 'dart' as const,
            location: { path: 'lib/a.dart', line: 0, column: 1 },
          },
        ],
      },
    ],
  };

  assert.throws(
    () => createCodeQualityFindings(report, logicalKeyFingerprint),
    /Code Quality location/u,
  );
});

test('같은 지문의 이슈가 두 개면 깨진 아티팩트 대신 실패한다', () => {
  const [first] = reportFixture().issues;
  assert.ok(first);
  const report = {
    ...reportFixture(),
    issues: [first, first],
  };

  assert.throws(
    () => createCodeQualityFindings(report, logicalKeyFingerprint),
    /duplicate fingerprints/u,
  );
});

test('인코딩은 결정적이고 지문은 이슈별로 다르다', () => {
  const first = createCodeQualityFindings(reportFixture(), logicalKeyFingerprint);
  const again = createCodeQualityFindings(reportFixture(), logicalKeyFingerprint);

  assert.equal(encodeCodeQualityReport(first), encodeCodeQualityReport(again));
  const fingerprints = first.map(({ fingerprint }) => fingerprint);
  assert.equal(new Set(fingerprints).size, fingerprints.length);
});

/** 두 이슈(다중 증거 포함)를 가진 최소 check 보고서다. */
function reportFixture(): CheckReport {
  return {
    format: 'isthmus-check',
    version: 1,
    summary: {
      errors: 1,
      warnings: 1,
      matchedChannels: 0,
      matchedMethods: 0,
      matchedModules: 0,
      matchedComponents: 0,
      observedFacts: 3,
      observedLimitations: 0,
    },
    issues: [
      {
        severity: 'error',
        code: 'unhandled-invocation',
        target: 'flutter',
        channel: 'com.example/a',
        method: 'ping',
        evidence: [
          {
            platform: 'dart',
            location: { path: 'lib/a.dart', line: 3, column: 7 },
          },
        ],
      },
      {
        severity: 'warning',
        code: 'registration-without-creation',
        target: 'flutter',
        channel: 'com.example/b',
        evidence: [
          {
            platform: 'swift',
            location: { path: 'src/A.swift', line: 10, column: 3 },
          },
          {
            platform: 'swift',
            location: { path: 'src/B.swift', line: 4, column: 9 },
          },
        ],
      },
    ],
    limitations: [],
  };
}
