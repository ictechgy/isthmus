import { compareStrings } from '../compare.ts';
import type {
  BridgeRuntimeDocument, RuntimeEvent, RuntimeExpectation, RuntimeExpectations,
} from '../exchange/runtime.ts';
import { RuntimeValidationError } from '../exchange/runtime.ts';
import { MAX_DOCUMENTS_PER_JOIN } from '../join/join.ts';

/** 전체 평가와 무관한 증거 표시 상한. 생략 수를 명시한다. */
export const MAX_RUNTIME_EVIDENCE_PER_CHECK = 20;

/** 원본 run과 sequence로 재현 가능한 통신 결과 참조다. */
export interface RuntimeEvidence {
  readonly runId: string;
  readonly sequence: number;
  readonly instance: string;
  readonly outcome: RuntimeEvent['outcome'];
  readonly caller?: RuntimeEvent['caller'];
}

/** 같은 라우팅 기대를 반복해도 전체 호출을 다시 검사하지 않도록 집계한다. */
interface RouteObservations {
  observedCalls: number;
  failed: boolean;
  pending: boolean;
  evidence: RuntimeEvidence[];
}

/** 기대 항목 하나의 결과와 관찰 근거다. */
export interface RuntimeCheckResult {
  readonly expected: RuntimeExpectation;
  readonly status: 'passed' | 'failed' | 'unobserved' | 'incomplete';
  readonly observedCalls: number;
  readonly evidence: readonly RuntimeEvidence[];
  readonly evidenceOmitted: number;
}

/** 선언한 시나리오의 통신 검증 결과. 모든 실행 경로를 검증했다는 뜻은 아니다. */
export interface RuntimeVerificationReport {
  readonly format: 'isthmus-runtime-check';
  readonly version: 1;
  readonly revision: string;
  readonly scope: 'declared-scenarios';
  readonly complete: false;
  readonly status: 'passed' | 'failed' | 'incomplete';
  readonly summary: {
    readonly runs: number;
    readonly staleRuns: number;
    readonly incompleteRuns: number;
    readonly droppedEvents: number;
    readonly failedCalls: number;
    readonly pendingCalls: number;
    readonly passedChecks: number;
    readonly failedChecks: number;
    readonly unobservedChecks: number;
    readonly incompleteChecks: number;
  };
  readonly checks: readonly RuntimeCheckResult[];
  readonly failures: ReadonlyArray<{ readonly runId: string; readonly event: RuntimeEvent }>;
  readonly runs: ReadonlyArray<Omit<BridgeRuntimeDocument, 'events' | 'project' | 'format' | 'version'> & {
    readonly stale: boolean;
    readonly observedEvents: number;
  }>;
}

/** 검증된 관찰을 라우팅 키로 색인해 기대 항목마다 전체 이벤트를 다시 훑지 않는다. */
export function verifyRuntimeEvidence(
  expectations: RuntimeExpectations, documents: readonly BridgeRuntimeDocument[],
): RuntimeVerificationReport {
  if (documents.length > MAX_DOCUMENTS_PER_JOIN) throw new RuntimeValidationError('Too many runtime documents.');
  const ids = new Set<string>();
  for (const document of documents) {
    if (document.project !== expectations.project) throw new RuntimeValidationError('Runtime inputs must describe the same project.');
    if (ids.has(document.run.id)) throw new RuntimeValidationError('Duplicate runtime run identifiers.');
    ids.add(document.run.id);
  }
  const sorted = [...documents].sort((a, b) => compareStrings(a.run.id, b.run.id));
  const current = sorted.filter(({ revision }) => revision === expectations.revision);
  const eventsByRoute = new Map<string, RouteObservations>();
  const incompleteScenarios = new Set<string>();
  const failures: Array<{ runId: string; event: RuntimeEvent }> = [];
  let pendingCalls = 0;
  for (const { run, events, droppedEvents } of current) {
    if (run.status !== 'completed' || droppedEvents > 0) {
      incompleteScenarios.add(JSON.stringify([run.scenario, run.platform]));
    }
    for (const event of events) {
      const evidence: RuntimeEvidence = { runId: run.id, sequence: event.sequence,
        instance: event.instance, outcome: event.outcome,
        ...(event.caller === undefined ? {} : { caller: event.caller }) };
      for (const instance of [undefined, event.instance]) {
        const key = routeKey(run.scenario, run.platform, event, instance);
        let bucket = eventsByRoute.get(key);
        if (bucket === undefined) {
          bucket = { observedCalls: 0, failed: false, pending: false, evidence: [] };
          eventsByRoute.set(key, bucket);
        }
        bucket.observedCalls++;
        bucket.failed ||= failed(event.outcome);
        bucket.pending ||= event.outcome === 'pending';
        if (bucket.evidence.length < MAX_RUNTIME_EVIDENCE_PER_CHECK) bucket.evidence.push(evidence);
      }
      if (failed(event.outcome)) failures.push({ runId: run.id, event });
      if (event.outcome === 'pending') pendingCalls++;
    }
  }
  const checks = [...expectations.checks].sort((a, b) => compareStrings(a.id, b.id)).map((expected): RuntimeCheckResult => {
    const bucket = eventsByRoute.get(routeKey(expected.scenario, expected.platform, expected, expected.instance));
    const observedCalls = bucket?.observedCalls ?? 0;
    const status = bucket?.failed === true ? 'failed'
      : observedCalls === 0 ? 'unobserved'
        : bucket?.pending === true ||
          incompleteScenarios.has(JSON.stringify([expected.scenario, expected.platform])) ? 'incomplete'
          : 'passed';
    return { expected, status, observedCalls, evidence: bucket?.evidence ?? [],
      evidenceOmitted: Math.max(0, observedCalls - MAX_RUNTIME_EVIDENCE_PER_CHECK) };
  });
  const summary = {
    runs: documents.length, staleRuns: documents.length - current.length,
    incompleteRuns: current.filter(({ run }) => run.status !== 'completed').length,
    droppedEvents: current.reduce((sum, { droppedEvents }) => sum + droppedEvents, 0),
    failedCalls: failures.length, pendingCalls,
    passedChecks: checks.filter(({ status }) => status === 'passed').length,
    failedChecks: checks.filter(({ status }) => status === 'failed').length,
    unobservedChecks: checks.filter(({ status }) => status === 'unobserved').length,
    incompleteChecks: checks.filter(({ status }) => status === 'incomplete').length,
  };
  if (!Number.isSafeInteger(summary.droppedEvents)) {
    throw new RuntimeValidationError('Runtime dropped-event total exceeds the integer limit.');
  }
  const status = summary.failedCalls > 0 ? 'failed'
    : summary.staleRuns > 0 || summary.incompleteRuns > 0 || summary.droppedEvents > 0 ||
      summary.pendingCalls > 0 || summary.passedChecks !== checks.length ? 'incomplete' : 'passed';
  return { format: 'isthmus-runtime-check', version: 1, revision: expectations.revision,
    scope: 'declared-scenarios', complete: false, status, summary, checks, failures,
    runs: sorted.map(({ run, revision, tool, droppedEvents, events }) => ({
      run, revision, tool, droppedEvents, stale: revision !== expectations.revision, observedEvents: events.length,
    })) };
}

/** '*' 같은 실제 이름과 전체 인스턴스 선택(null)의 키 공간을 분리한다. */
function routeKey(
  scenario: string, platform: string, route: Pick<RuntimeEvent, 'transport' | 'channel' | 'method'>,
  instance: string | undefined,
): string {
  return JSON.stringify([scenario, platform, route.transport, route.channel, route.method ?? null, instance ?? null]);
}

/** 성공과 아직 응답을 받지 못한 상태를 실패와 구분한다. */
function failed(outcome: RuntimeEvent['outcome']): boolean {
  return outcome === 'missing-handler' || outcome === 'error' || outcome === 'timeout';
}
