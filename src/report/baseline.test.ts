import assert from 'node:assert/strict';
import test from 'node:test';

import type { BridgeTarget } from '../exchange/parse.ts';
import {
  applyBaseline,
  BridgeBaselineValidationError,
  createBaselineDocument,
  encodeBaselineDocument,
  MAX_BASELINE_ENTRIES,
  parseBaselineDocument,
} from './baseline.ts';
import type { CheckIssue, CheckIssueCode, CheckReport } from './check-report.ts';

const baseEntry = {
  code: 'unhandled-invocation',
  target: 'flutter',
  channel: 'dev.isthmus/camera',
  method: 'takePhotos',
};
const validDocument = {
  format: 'isthmus-baseline',
  version: 1,
  generatedAt: '2026-09-08T00:00:00.000Z',
  entries: [baseEntry],
};

test('유효 문서를 계약 필드만 남기고 검증·정규화한다', () => {
  const parsed = parseBaselineDocument({
    ...validDocument,
    extraTopLevel: 1,
    entries: [{ ...baseEntry, extraField: 2 }],
  });

  assert.deepEqual(parsed, {
    format: 'isthmus-baseline',
    version: 1,
    generatedAt: '2026-09-08T00:00:00.000Z',
    entries: [baseEntry],
  });
});

test('중복 항목은 하나로 합치고 code·target·channel·method 순으로 고정한다', () => {
  const parsed = parseBaselineDocument({
    ...validDocument,
    entries: [
      { code: 'unhandled-invocation', target: 'flutter', channel: 'b' },
      {
        code: 'handler-without-invocation',
        target: 'flutter',
        channel: 'a',
        method: 'z',
      },
      { code: 'unhandled-invocation', target: 'flutter', channel: 'b' },
      { code: 'unhandled-invocation', target: 'flutter', channel: 'a' },
    ],
  });

  assert.deepEqual(
    parsed.entries.map(({ code, channel, method }) => [code, channel, method ?? null]),
    [
      ['handler-without-invocation', 'a', 'z'],
      ['unhandled-invocation', 'a', null],
      ['unhandled-invocation', 'b', null],
    ],
  );
});

test('형식·버전·시각·항목 잘못을 원인별 정적 메시지로 거부한다', () => {
  const cases: Array<[unknown, string]> = [
    [{}, 'Expected format "isthmus-baseline".'],
    [null, 'Baseline must be a JSON object.'],
    [[], 'Baseline must be a JSON object.'],
    [
      { ...validDocument, format: 'other' },
      'Expected format "isthmus-baseline".',
    ],
    [
      { ...validDocument, version: 2 },
      'Unsupported isthmus-baseline version; expected version 1.',
    ],
    [
      { ...validDocument, generatedAt: 'yesterday' },
      'Invalid generatedAt timestamp.',
    ],
    [{ ...validDocument, entries: {} }, 'Entries must be an array.'],
    [
      { ...validDocument, entries: ['text'] },
      'Baseline entry at index 0 must be a JSON object.',
    ],
    [
      { ...validDocument, entries: [{ ...baseEntry, code: 'made-up-code' }] },
      'Unknown issue code in baseline entry at index 0.',
    ],
    [
      { ...validDocument, entries: [{ ...baseEntry, target: 'electron' }] },
      'Unsupported bridge target in baseline entry at index 0.',
    ],
    [
      { ...validDocument, entries: [{ ...baseEntry, channel: 'a\u0000b' }] },
      'Invalid channel in baseline entry at index 0.',
    ],
    [
      { ...validDocument, entries: [{ ...baseEntry, method: '  ' }] },
      'Invalid method in baseline entry at index 0.',
    ],
  ];

  for (const [input, message] of cases) {
    assert.throws(
      () => parseBaselineDocument(input),
      (error: unknown) =>
        error instanceof BridgeBaselineValidationError &&
        error.message === message,
      JSON.stringify(message),
    );
  }
});

test('상한을 넘긴 문서는 항목 정규화 전에 거부한다', () => {
  const entries = Array.from(
    { length: MAX_BASELINE_ENTRIES + 1 },
    (_, index) => ({ ...baseEntry, channel: `dev.isthmus/c${index}` }),
  );

  assert.throws(
    () => parseBaselineDocument({ ...validDocument, entries }),
    /item limit/u,
  );
});

test('현재 이슈에서 만든 문서는 중복을 합치고 키 순서로 정렬한다', () => {
  const document = createBaselineDocument(
    [
      issue('unhandled-invocation', 'flutter', 'b', 'm2'),
      issue('unhandled-invocation', 'flutter', 'b', 'm2'),
      issue('handler-without-invocation', 'flutter', 'a'),
    ],
    '2026-09-08T05:00:00.000Z',
  );

  assert.deepEqual(document.entries, [
    { code: 'handler-without-invocation', target: 'flutter', channel: 'a' },
    {
      code: 'unhandled-invocation',
      target: 'flutter',
      channel: 'b',
      method: 'm2',
    },
  ]);
  assert.equal(document.generatedAt, '2026-09-08T05:00:00.000Z');
});

test('인코딩은 키를 정렬하고 개행으로 끝나며 파싱과 왕복한다', () => {
  const document = createBaselineDocument(
    [issue('unhandled-invocation', 'flutter', 'b', 'm2')],
    '2026-09-08T05:00:00.000Z',
  );

  const encoded = encodeBaselineDocument(document);

  assert.equal(encoded.endsWith('\n'), true);
  assert.equal(encoded, encodeBaselineDocument(document));
  assert.ok(encoded.indexOf('"entries"') < encoded.indexOf('"format"'));
  assert.deepEqual(parseBaselineDocument(JSON.parse(encoded)), document);
});

test('적용은 맞은 이슈만 표시하고 요약을 다시 계산한다', () => {
  const report = makeReport([
    withSeverity(issue('unhandled-invocation', 'flutter', 'b', 'm2'), 'error'),
    withSeverity(issue('unregistered-channel-creation', 'flutter', 'b'), 'error'),
    withSeverity(issue('handler-without-invocation', 'flutter', 'a'), 'warning'),
  ]);

  const applied = applyBaseline(report, [
    {
      code: 'unhandled-invocation',
      target: 'flutter',
      channel: 'b',
      method: 'm2',
    },
  ]);

  assert.deepEqual(applied.summary, {
    errors: 1,
    warnings: 1,
    suppressed: 1,
    staleBaselineEntries: 0,
    matchedChannels: 0,
    matchedMethods: 0,
  });
  assert.deepEqual(
    applied.issues.map(({ code, suppressed }) => [code, suppressed ?? false]),
    [
      ['unhandled-invocation', true],
      ['unregistered-channel-creation', false],
      ['handler-without-invocation', false],
    ],
  );
  assert.deepEqual(applied.issues[0]?.evidence, report.issues[0]?.evidence);
  assert.equal(applied.issues[0]?.severity, 'error');
});

test('맞는 이슈가 없는 항목은 stale로 세고 이슈를 건드리지 않는다', () => {
  const report = makeReport([
    withSeverity(issue('unhandled-invocation', 'flutter', 'b', 'm2'), 'error'),
  ]);

  const applied = applyBaseline(report, [
    { code: 'unhandled-invocation', target: 'flutter', channel: 'elsewhere' },
  ]);

  assert.equal(applied.summary.staleBaselineEntries, 1);
  assert.equal(applied.summary.suppressed, 0);
  assert.equal(applied.summary.errors, 1);
  assert.equal(applied.issues[0]?.suppressed, undefined);
});

test('억제는 target과 code 경계를 넘지 않는다', () => {
  const report = makeReport([
    withSeverity(issue('unhandled-invocation', 'flutter', 'b', 'm2'), 'error'),
    withSeverity(
      issue('unhandled-invocation', 'react-native', 'b', 'm2'),
      'error',
    ),
    withSeverity(issue('unregistered-channel-creation', 'flutter', 'b'), 'error'),
  ]);

  const applied = applyBaseline(report, [
    {
      code: 'unhandled-invocation',
      target: 'flutter',
      channel: 'b',
      method: 'm2',
    },
  ]);

  assert.equal(applied.summary.suppressed, 1);
  assert.equal(applied.summary.errors, 2);
});

test('method 없는 항목은 method 없는 이슈만 억제한다', () => {
  const report = makeReport([
    withSeverity(issue('unregistered-channel-creation', 'flutter', 'b'), 'error'),
    withSeverity(issue('unhandled-invocation', 'flutter', 'b', 'm2'), 'error'),
  ]);

  const applied = applyBaseline(report, [
    { code: 'unregistered-channel-creation', target: 'flutter', channel: 'b' },
  ]);

  assert.deepEqual(
    applied.issues.map(({ code, suppressed }) => [code, suppressed ?? false]),
    [
      ['unregistered-channel-creation', true],
      ['unhandled-invocation', false],
    ],
  );
  assert.equal(applied.summary.staleBaselineEntries, 0);
});

test('억제 표시가 있는 보고서에 다시 적용해도 결과가 같다', () => {
  const report = makeReport([
    withSeverity(issue('unhandled-invocation', 'flutter', 'b', 'm2'), 'error'),
    withSeverity(issue('handler-without-invocation', 'flutter', 'a'), 'warning'),
  ]);
  const entries = [
    {
      code: 'unhandled-invocation' as const,
      target: 'flutter' as const,
      channel: 'b',
      method: 'm2',
    },
  ];

  const once = applyBaseline(report, entries);
  const twice = applyBaseline(once, entries);

  assert.deepEqual(twice, once);
});

test('쓰기 상한을 넘는 베이스라인 문서는 만들지 않는다', () => {
  const issues = Array.from(
    { length: MAX_BASELINE_ENTRIES + 1 },
    (_, index) => issue('unhandled-invocation', 'flutter', `dev.isthmus/c${index}`),
  );

  assert.throws(
    () => createBaselineDocument(issues, '2026-09-08T05:00:00.000Z'),
    /item limit/u,
  );
});

test('이슈가 없는 실행도 빈 문서로 왕복한다', () => {
  const document = createBaselineDocument([], '2026-09-08T05:00:00.000Z');

  assert.deepEqual(document.entries, []);
  assert.deepEqual(
    parseBaselineDocument(JSON.parse(encodeBaselineDocument(document))),
    document,
  );
});

/** 최소 증거를 가진 check 이슈를 만든다. */
function issue(
  code: CheckIssueCode,
  target: BridgeTarget,
  channel: string,
  method?: string,
): CheckIssue {
  return {
    severity: 'warning',
    code,
    target,
    channel,
    ...(method === undefined ? {} : { method }),
    evidence: [
      { platform: 'dart', location: { path: 'lib/a.dart', line: 1, column: 1 } },
    ],
  };
}

/** 심각도만 교체한 이슈 사본을 만든다. */
function withSeverity(
  base: CheckIssue,
  severity: 'error' | 'warning',
): CheckIssue {
  return { ...base, severity };
}

/** 이슈 목록에서 최소 check 보고서를 조립한다. */
function makeReport(issues: readonly CheckIssue[]): CheckReport {
  return {
    format: 'isthmus-check',
    version: 1,
    summary: {
      errors: issues.filter(({ severity }) => severity === 'error').length,
      warnings: issues.filter(({ severity }) => severity === 'warning').length,
      matchedChannels: 0,
      matchedMethods: 0,
    },
    issues,
    limitations: [],
  };
}
