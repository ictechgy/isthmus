import type { AidlcTaskVerdict } from './aidlc-task.ts';

/** 고정 native dispatcher의 기본 1 MiB보다 작은 stdout 예산이다. 개행·wrapper도 포함한다. */
export const MAX_SENSOR_OUTPUT_BYTES = 256 * 1024;
const HEAD = 8;
type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => value as RecordValue;

/** JSON escape·다중 바이트 문자를 포함한 인코딩 크기로 자르며 코드 포인트를 쪼개지 않는다. */
function clipped(value: unknown, budget = 2048) {
  if (typeof value !== 'string') return { value: 'Unavailable detail.', truncated: true };
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') <= budget) return { value, truncated: false };
  let text = '', bytes = 2;
  for (const character of value) {
    const length = Buffer.byteLength(JSON.stringify(character), 'utf8') - 2;
    if (bytes + length > budget) break;
    text += character; bytes += length;
  }
  return { value: text, truncated: true };
}
function rows(value: unknown): readonly unknown[] { return Array.isArray(value) ? value : []; }
function detail(value: unknown) {
  const row = value !== null && typeof value === 'object' ? record(value) : {};
  const code = clipped(row.code ?? row.analysis ?? row.rule ?? row.id ?? 'limitation', 256);
  const message = clipped(row.detail ?? row.message);
  return { code: code.value, detail: message.value, detailTruncated: code.truncated || message.truncated };
}
function bounded(value: unknown, project: (value: unknown) => unknown = detail) {
  const list = record(value), items = rows(list.items).slice(0, HEAD).map(project);
  return { total: list.total, sourceOmitted: list.omitted, omitted: (list.total as number) - items.length, items };
}
function nativeSummary(value: unknown) {
  const native = record(value);
  const reason = (value: unknown) => { const text = clipped(value); return { detail: text.value, detailTruncated: text.truncated }; };
  const before = record(native.nativeBefore), after = record(native.nativeAfter);
  return { nativeAtCapture: native.nativeAtCapture, currentVerification: native.currentVerification, integrity: native.integrity,
    nativeBefore: { status: before.status, reasons: bounded(before.reasons, reason) },
    nativeAfter: { status: after.status, reasons: bounded(after.reasons, reason) },
    reasons: bounded(native.reasons, reason), artifacts: bounded(native.artifacts, value => {
      const row = record(value), id = clipped(row.id, 256);
      return { id: id.value, idTruncated: id.truncated, alignment: row.alignment };
    }) };
}
function limitations(value: unknown) {
  const source = rows(value), items = source.slice(0, HEAD).map(detail);
  return { reportedTotal: source.length, omittedByAdapter: source.length - items.length, items };
}
function numbers(value: unknown, keys: readonly string[]) {
  const source = record(value);
  return Object.fromEntries(keys.map(key => [key, source[key]]));
}
function summary(task: Readonly<RecordValue>) {
  const evidence = record(task.evidence), trace = record(task.trace), rules = record(task.rules), tests = record(task.tests);
  const ruleLimitations = record(rules.limitations);
  return { format: task.format, version: task.version, complete: task.complete, requiresReview: task.requiresReview,
    evidence: { alignment: evidence.alignment, verification: evidence.verification,
      summary: numbers(evidence.summary, ['matched', 'stale', 'missing', 'unverified']),
      ...(evidence.kartograph === undefined ? {} : { kartograph: nativeSummary(evidence.kartograph) }) },
    unknown: bounded(task.unknown),
    limitations: { trace: limitations(trace.limitations), analysis: limitations(trace.analysisLimitations),
      rules: bounded(ruleLimitations), sourceTraceTruncated: trace.truncation !== undefined && record(trace.truncation).truncated === true },
    rules: { status: rules.status, issuesTotal: record(rules.issues).total },
    tests: { total: tests.total, observedSummary: numbers(tests.observedSummary, ['passed', 'failed', 'unknown']) } };
}

/**
 * 일반 출력은 원본 task를 보존하고, 예산을 넘으면 명시적 truncated summary로 바꾼다.
 * unknown·limitations의 원래 계수/기존 생략과 추가 생략을 남기며 원본은 sourceSha256로 재확인한다.
 */
export function encodeAidlcVerdict(result: AidlcTaskVerdict): string {
  const original = JSON.stringify(result) + '\n', originalBytes = Buffer.byteLength(original, 'utf8');
  if (originalBytes <= MAX_SENSOR_OUTPUT_BYTES) return original;
  const { task, ...base } = result;
  const states = [...new Set([...result.states, 'truncated' as const])];
  const findings = [...result.findings.filter(row => row.code !== 'truncated'),
    { code: 'truncated', detail: 'Sensor stdout exceeded its byte budget; read the source task for full detail.' }];
  const compact = { ...base, states, findings, findings_count: findings.length,
    ...(task === undefined ? {} : { taskSummary: summary(task) }),
    outputTruncation: { reason: 'sensor-output-byte-budget', maximumBytes: MAX_SENSOR_OUTPUT_BYTES,
      originalBytes, taskOmitted: task !== undefined, detailsMayBeTruncated: true } };
  // 알려진 문자열은 JSON byte 단위로 제한했다. 앞으로 필드가 추가돼도 예산 검사를 건너뛰지 않는다.
  let encoded = JSON.stringify(compact) + '\n';
  if (Buffer.byteLength(encoded, 'utf8') > MAX_SENSOR_OUTPUT_BYTES) {
    const retained = compact.taskSummary;
    encoded = JSON.stringify({ format: result.format, version: result.version, pass: false, states,
      stage: result.stage, phase: result.phase, currentCheckout: 'unverified', sourceSha256: result.sourceSha256,
      findings: [{ code: 'truncated', detail: 'Sensor details omitted by the stdout byte budget.' }], findings_count: 1,
      taskSummary: retained === undefined ? undefined : { ...retained,
        unknown: { ...retained.unknown, omitted: retained.unknown.total, items: [] },
        limitations: { sourceTraceTruncated: retained.limitations.sourceTraceTruncated,
          trace: { ...retained.limitations.trace, omittedByAdapter: retained.limitations.trace.reportedTotal, items: [] },
          analysis: { ...retained.limitations.analysis, omittedByAdapter: retained.limitations.analysis.reportedTotal, items: [] },
          rules: { ...retained.limitations.rules, omitted: retained.limitations.rules.total, items: [] } } },
      outputTruncation: compact.outputTruncation }) + '\n';
  }
  return encoded;
}
