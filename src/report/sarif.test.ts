import assert from 'node:assert/strict';
import test from 'node:test';

import type { CheckReport } from './check-report.ts';
import { checkIssueCodes } from './check-report.ts';
import { createSarifLog, encodeSarifLog, sarifUri } from './sarif.ts';

test('check 보고서의 이슈를 SARIF 결과로 옮긴다', () => {
  const log = createSarifLog(reportFixture(), '9.9.9');
  const [run] = log.runs;
  assert.ok(run);

  assert.equal(log.$schema, 'https://json.schemastore.org/sarif-2.1.0.json');
  assert.equal(log.version, '2.1.0');
  assert.equal(run.tool.driver.name, 'isthmus');
  assert.equal(run.tool.driver.version, '9.9.9');
  assert.deepEqual(
    run.tool.driver.rules.map(({ id }) => id),
    [...checkIssueCodes].sort(),
  );
  for (const rule of run.tool.driver.rules) {
    assert.equal(rule.shortDescription.text.length > 0, true);
  }

  const [first, second] = run.results;
  assert.ok(first);
  assert.ok(second);
  assert.equal(first.ruleId, 'unhandled-invocation');
  assert.equal(
    first.ruleIndex,
    run.tool.driver.rules.findIndex(({ id }) => id === 'unhandled-invocation'),
  );
  assert.equal(first.level, 'error');
  assert.equal(
    first.message.text,
    "unhandled-invocation on channel 'com.example/a' for method 'ping'",
  );
  assert.deepEqual(first.locations, [
    {
      physicalLocation: {
        artifactLocation: { uri: 'lib/a.dart' },
        region: { startLine: 3, startColumn: 7 },
      },
    },
  ]);
  assert.equal(first.relatedLocations, undefined);
  assert.deepEqual(first.properties, {
    target: 'flutter',
    channel: 'com.example/a',
    method: 'ping',
  });

  assert.equal(second.ruleId, 'registration-without-creation');
  assert.equal(second.level, 'warning');
  assert.deepEqual(second.relatedLocations?.map(({ id }) => id), [1, 2]);
  assert.deepEqual(
    second.relatedLocations?.map(
      ({ physicalLocation }) => physicalLocation.artifactLocation.uri,
    ),
    ['src/B.swift', 'src/C.swift'],
  );
});

test('경로 세그먼트를 RFC 3986으로 인코딩하고 구분자는 보존한다', () => {
  assert.equal(sarifUri('lib/a.dart'), 'lib/a.dart');
  assert.equal(sarifUri('lib/my app/ui.dart'), 'lib/my%20app/ui.dart');
  assert.equal(sarifUri('src/#1/카메라.swift'), 'src/%231/%EC%B9%B4%EB%A9%94%EB%9D%BC.swift');
  assert.equal(sarifUri('a%b.swift'), 'a%25b.swift');
});

test('이슈가 없으면 빈 결과 목록을 낸다', () => {
  const log = createSarifLog({
    ...reportFixture(),
    issues: [],
  });

  assert.deepEqual(log.runs[0]?.results, []);
});

test('증거 위치가 1행 1열보다 앞서면 만들 수 없다', () => {
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

  assert.throws(() => createSarifLog(report), /SARIF region/u);
});

test('베이스라인 억제 이슈는 external suppression으로 전달한다', () => {
  const log = createSarifLog({
    ...reportFixture(),
    issues: reportFixture().issues.map((issue, index) =>
      index === 0 ? { ...issue, suppressed: true as const } : issue,
    ),
  });

  const [first] = log.runs[0]?.results ?? [];
  assert.deepEqual(first?.suppressions, [
    { kind: 'external', status: 'accepted' },
  ]);
});

test('논리 키 지문은 같은 이슈에서 안정적이고 다른 이슈와 다르다', () => {
  const first = createSarifLog(reportFixture());
  const again = createSarifLog(reportFixture());
  const fingerprints = first.runs[0]?.results.map(
    ({ partialFingerprints }) => partialFingerprints.isthmusIssueV1,
  ) ?? [];

  assert.deepEqual(
    again.runs[0]?.results.map(
      ({ partialFingerprints }) => partialFingerprints.isthmusIssueV1,
    ),
    fingerprints,
  );
  assert.equal(new Set(fingerprints).size, fingerprints.length);
  assert.equal(fingerprints.every((value) => /^[0-9a-f]{64}$/u.test(value)), true);
});

test('버전을 모르면 driver에서 생략하고 인코딩은 결정적으로 유지한다', () => {
  const log = createSarifLog(reportFixture());

  assert.equal('version' in (log.runs[0]?.tool.driver ?? {}), false);
  assert.equal(encodeSarifLog(log), encodeSarifLog(createSarifLog(reportFixture())));
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
          {
            platform: 'swift',
            location: { path: 'src/C.swift', line: 1, column: 1 },
          },
        ],
      },
    ],
    limitations: [],
  };
}
