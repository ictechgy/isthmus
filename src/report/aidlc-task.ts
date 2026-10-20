/** AI-DLC는 이 전달 결과의 severity/gate를 소유한다. adapter는 통과·승인을 만들지 않는다. */
export type AidlcGap = 'stale' | 'missing' | 'unverified' | 'unknown' | 'malformed' | 'timeout' | 'unavailable' | 'truncated';
type JsonObject = Record<string, unknown>;
interface BoundedList { readonly total: number; readonly omitted: number; readonly items: readonly unknown[] }

/** 고정 AI-DLC sensor의 pass/findings_count 계약과 원본 근거 전달 봉투다. */
export interface AidlcTaskVerdict {
  readonly format: 'isthmus-aidlc-evidence'; readonly version: 1;
  readonly pass: false; readonly findings_count: number;
  readonly findings: ReadonlyArray<{ readonly code: AidlcGap; readonly detail: string }>;
  readonly states: readonly AidlcGap[]; readonly stage: string;
  readonly phase: 'planning' | 'validation' | 'unavailable'; readonly currentCheckout: 'unverified';
  readonly sourceSha256?: string; readonly task?: Readonly<JsonObject>; readonly upstreamReason?: string;
}
const descriptions: Readonly<Record<AidlcGap, string>> = {
  stale: 'Recorded inputs or artifact bytes are stale.', missing: 'Recorded input provenance is missing.',
  unverified: 'Recorded evidence does not verify the current checkout.', unknown: 'The task retains unknown or incomplete evidence.',
  malformed: 'Input does not conform to the supported task or execution-gap contract.',
  timeout: 'The upstream evaluation timed out; no pass was established.',
  unavailable: 'The task evidence is unavailable; no pass was established.',
  truncated: 'Evidence is truncated; omitted detail is not a verified absence.',
};
const stages = ['delivery-planning', 'build-and-test'];
const gaps = ['timeout', 'unavailable', 'malformed', 'truncated'] as const;
function object(value: unknown): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('object');
  return value as JsonObject;
}
function count(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 1_000_000) throw new Error('count');
  return value as number;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) throw new Error('text');
  return value;
}
function status(value: unknown, allowed: readonly string[]): string {
  if (typeof value !== 'string' || !allowed.includes(value)) throw new Error('status');
  return value;
}
function bounded(value: unknown): BoundedList {
  const raw = object(value), total = count(raw.total), omitted = count(raw.omitted);
  if (!Array.isArray(raw.items) || raw.items.length > 100 || total !== raw.items.length + omitted) throw new Error('bounded');
  return { total, omitted, items: raw.items };
}
function counts(value: unknown, names: readonly string[]): number {
  const raw = object(value);
  return names.reduce((sum, name) => sum + count(raw[name]), 0);
}
function verdict(states: readonly AidlcGap[], stage: string): AidlcTaskVerdict {
  return { format: 'isthmus-aidlc-evidence', version: 1, pass: false, states,
    findings_count: states.length, findings: states.map(code => ({ code, detail: descriptions[code] })),
    stage, phase: stage === 'delivery-planning' ? 'planning' : stage === 'build-and-test' ? 'validation' : 'unavailable',
    currentCheckout: 'unverified' };
}

/** 파일/실행 경계 실패를 유효한 non-pass sensor 출력으로 바꿔 dispatcher의 noted pass를 피한다. */
export function aidlcFailure(reason: typeof gaps[number], stage: string): AidlcTaskVerdict {
  return verdict([reason], stages.includes(stage) ? stage : 'unsupported');
}

/**
 * 이미 bounded인 task v1을 재분석 없이 전달한다. 수집 때의 matched는 현재 checkout의 pass가 아니다.
 * 선택적 실패 봉투는 상위 실행기의 관찰이며 이 함수가 실행·timeout을 재현했다는 뜻이 아니다.
 */
export function adaptAidlcTask(value: unknown, stage: string, sourceSha256?: string): AidlcTaskVerdict {
  try {
    if (!stages.includes(stage) || sourceSha256 !== undefined && !/^[a-f0-9]{64}$/u.test(sourceSha256)) throw new Error('context');
    const task = object(value);
    if (task.format === 'isthmus-aidlc-input' && task.version === 1) {
      const gap = status(task.status, gaps) as typeof gaps[number];
      return { ...aidlcFailure(gap, stage), upstreamReason: text(task.reason), ...(sourceSha256 === undefined ? {} : { sourceSha256 }) };
    }
    if (task.format !== 'isthmus-task' || task.version !== 1 || task.complete !== false || task.requiresReview !== true) throw new Error('task');
    const evidence = object(task.evidence), trace = object(task.trace), rules = object(task.rules), tests = object(task.tests);
    if (evidence.verification !== 'unverified' || evidence.basis !== 'caller-declared') throw new Error('proof');
    status(evidence.alignment, ['matched', 'stale', 'missing', 'unverified']);
    const artifacts = bounded(evidence.artifacts), unknown = bounded(task.unknown), recordedTests = bounded(tests);
    if (counts(evidence.summary, ['matched', 'stale', 'missing', 'unverified']) !== artifacts.total
      || counts(tests.observedSummary, ['passed', 'failed', 'unknown']) !== recordedTests.total) throw new Error('summary');
    for (const row of unknown.items) { const entry = object(row); text(entry.code); text(entry.detail); }
    for (const row of artifacts.items) { const entry = object(row); text(entry.id); status(entry.alignment, ['matched', 'stale', 'missing', 'unverified']); }
    if (trace.format !== 'isthmus-trace' || trace.version !== 1 || typeof trace.complete !== 'boolean'
      || !Array.isArray(trace.chains) || !Array.isArray(trace.gaps) || !Array.isArray(trace.limitations)
      || !Array.isArray(trace.analysisLimitations)) throw new Error('trace');
    status(rules.status, ['observed', 'unverified']);
    if (rules.scope !== 'all-input-bridge-facts') throw new Error('rules');
    const issues = bounded(rules.issues), limitations = bounded(rules.limitations);
    if (rules.status === 'unverified') { text(rules.reason); if (rules.summary !== undefined) throw new Error('rules summary'); }
    else object(rules.summary);
    const states = new Set<AidlcGap>();
    const summary = object(evidence.summary);
    if (summary.stale as number > 0 || evidence.alignment === 'stale') states.add('stale');
    if (summary.missing as number > 0 || evidence.alignment === 'missing') states.add('missing');
    states.add('unverified'); states.add('unknown');
    if ([artifacts, unknown, recordedTests, issues, limitations].some(list => list.omitted > 0)) states.add('truncated');
    if (trace.truncation !== undefined) {
      const truncation = object(trace.truncation);
      if (typeof truncation.truncated !== 'boolean') throw new Error('truncation');
      if (truncation.truncated) states.add('truncated');
    }
    if (evidence.kartograph !== undefined) {
      const native = object(evidence.kartograph);
      if (native.currentVerification !== 'unverified') throw new Error('native current');
      for (const value of [native.nativeAtCapture, object(native.nativeBefore).status, object(native.nativeAfter).status]) {
        if (status(value, ['matched', 'stale', 'unverified']) === 'stale') states.add('stale');
      }
      if (status(native.integrity, ['matched', 'stale']) === 'stale') states.add('stale');
      for (const list of [native.artifacts, native.reasons, object(native.nativeBefore).reasons, object(native.nativeAfter).reasons]) {
        if (bounded(list).omitted > 0) states.add('truncated');
      }
    }
    return { ...verdict([...states], stage), ...(sourceSha256 === undefined ? {} : { sourceSha256 }), task };
  } catch { return aidlcFailure('malformed', stage); }
}
