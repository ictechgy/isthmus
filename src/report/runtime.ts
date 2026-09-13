import { compareStrings } from '../compare.ts';
import type {
  BridgeRuntimeDocument, RuntimeEvent, RuntimeExpectation, RuntimeExpectations, RuntimeTerminalOutcome,
} from '../exchange/runtime.ts';
import { RuntimeValidationError } from '../exchange/runtime.ts';
import { MAX_DOCUMENTS_PER_JOIN } from '../join/join.ts';

/** 전체 평가와 무관한 증거 표시 상한. 생략 수를 명시한다. */
export const MAX_RUNTIME_EVIDENCE_PER_CHECK = 20;

const RUNTIME_TERMINAL_OUTCOMES: readonly RuntimeTerminalOutcome[] = [
  'success', 'missing-handler', 'error', 'timeout',
];

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
  outcomes: Record<RuntimeEvent['outcome'], number>;
  evidence: RuntimeEvidence[];
}

/** 한 라우팅에 적용되는 기대 결과들의 교집합이다. */
interface RouteExpectations {
  broad?: readonly RuntimeTerminalOutcome[];
  instances: Map<string, readonly RuntimeTerminalOutcome[]>;
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
  readonly project: string;
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
    readonly expectedFailedCalls: number;
    readonly unexpectedFailedCalls: number;
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
  const expectationsByRoute = new Map<string, RouteExpectations>();
  for (const expected of expectations.checks) {
    const key = routeKey(expected.scenario, expected.platform, expected, undefined);
    let routeExpectations = expectationsByRoute.get(key);
    if (routeExpectations === undefined) {
      routeExpectations = { instances: new Map() };
      expectationsByRoute.set(key, routeExpectations);
    }
    const allowed = expected.allowedOutcomes ?? ['success'];
    if (expected.instance === undefined) {
      routeExpectations.broad = intersectAllowed(routeExpectations.broad, allowed);
    } else {
      routeExpectations.instances.set(expected.instance,
        intersectAllowed(routeExpectations.instances.get(expected.instance), allowed));
    }
  }
  const incompleteScenarios = new Set<string>();
  const failures: Array<{ runId: string; event: RuntimeEvent }> = [];
  let pendingCalls = 0;
  let expectedFailedCalls = 0;
  let unexpectedFailedCalls = 0;
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
          bucket = { observedCalls: 0, outcomes: emptyOutcomes(), evidence: [] };
          eventsByRoute.set(key, bucket);
        }
        bucket.observedCalls++;
        bucket.outcomes[event.outcome]++;
        if (bucket.evidence.length < MAX_RUNTIME_EVIDENCE_PER_CHECK) bucket.evidence.push(evidence);
      }
      const eventOutcome = event.outcome;
      if (failed(eventOutcome)) {
        failures.push({ runId: run.id, event });
        const routeExpectations = expectationsByRoute.get(routeKey(run.scenario, run.platform, event, undefined));
        const applicable = routeExpectations === undefined ? [] : [
          ...(routeExpectations.broad === undefined ? [] : [routeExpectations.broad]),
          ...(routeExpectations.instances.get(event.instance) === undefined ? [] :
            [routeExpectations.instances.get(event.instance)!]),
        ];
        if (applicable.length > 0 && applicable.every((allowed) => allowed.includes(eventOutcome))) {
          expectedFailedCalls++;
        } else {
          unexpectedFailedCalls++;
        }
      }
      if (event.outcome === 'pending') pendingCalls++;
    }
  }
  const checks = [...expectations.checks].sort((a, b) => compareStrings(a.id, b.id)).map((expected): RuntimeCheckResult => {
    const bucket = eventsByRoute.get(routeKey(expected.scenario, expected.platform, expected, expected.instance));
    const observedCalls = bucket?.observedCalls ?? 0;
    const allowed = expected.allowedOutcomes ?? ['success'];
    const terminalRejected = bucket === undefined ? false : RUNTIME_TERMINAL_OUTCOMES
      .some((outcome) => bucket.outcomes[outcome] > 0 && !allowed.includes(outcome));
    const status = terminalRejected ? 'failed'
      : observedCalls === 0 ? 'unobserved'
        : (bucket?.outcomes.pending ?? 0) > 0 ||
          incompleteScenarios.has(JSON.stringify([expected.scenario, expected.platform])) ? 'incomplete'
          : 'passed';
    return { expected, status, observedCalls, evidence: bucket?.evidence ?? [],
      evidenceOmitted: Math.max(0, observedCalls - MAX_RUNTIME_EVIDENCE_PER_CHECK) };
  });
  const summary = {
    runs: documents.length, staleRuns: documents.length - current.length,
    incompleteRuns: current.filter(({ run }) => run.status !== 'completed').length,
    droppedEvents: current.reduce((sum, { droppedEvents }) => sum + droppedEvents, 0),
    failedCalls: failures.length, expectedFailedCalls, unexpectedFailedCalls, pendingCalls,
    passedChecks: checks.filter(({ status }) => status === 'passed').length,
    failedChecks: checks.filter(({ status }) => status === 'failed').length,
    unobservedChecks: checks.filter(({ status }) => status === 'unobserved').length,
    incompleteChecks: checks.filter(({ status }) => status === 'incomplete').length,
  };
  if (!Number.isSafeInteger(summary.droppedEvents)) {
    throw new RuntimeValidationError('Runtime dropped-event total exceeds the integer limit.');
  }
  const status = summary.unexpectedFailedCalls > 0 || summary.failedChecks > 0 ? 'failed'
    : summary.staleRuns > 0 || summary.incompleteRuns > 0 || summary.droppedEvents > 0 ||
      summary.pendingCalls > 0 || summary.passedChecks !== checks.length ? 'incomplete' : 'passed';
  return { format: 'isthmus-runtime-check', version: 1, project: expectations.project, revision: expectations.revision,
    scope: 'declared-scenarios', complete: false, status, summary, checks, failures,
    runs: sorted.map(({ run, revision, tool, droppedEvents, events }) => ({
      run, revision, tool, droppedEvents, stale: revision !== expectations.revision, observedEvents: events.length,
    })) };
}

/** 모든 기대가 허용하는 결과만 남겨 겹치는 기대의 좁은 조건을 보존한다. */
function intersectAllowed(
  existing: readonly RuntimeTerminalOutcome[] | undefined,
  next: readonly RuntimeTerminalOutcome[],
): readonly RuntimeTerminalOutcome[] {
  return existing === undefined ? next : existing.filter((outcome) => next.includes(outcome));
}

/** 관찰 결과 카운터를 생성한다. */
function emptyOutcomes(): Record<RuntimeEvent['outcome'], number> {
  return { success: 0, 'missing-handler': 0, error: 0, timeout: 0, pending: 0 };
}

/** '*' 같은 실제 이름과 전체 인스턴스 선택(null)의 키 공간을 분리한다. */
function routeKey(
  scenario: string, platform: string, route: Pick<RuntimeEvent, 'transport' | 'channel' | 'method'>,
  instance: string | undefined,
): string {
  return JSON.stringify([scenario, platform, route.transport, route.channel, route.method ?? null, instance ?? null]);
}

/** 성공과 아직 응답을 받지 못한 상태를 실패와 구분한다. */
function failed(outcome: RuntimeEvent['outcome']): outcome is RuntimeTerminalOutcome {
  return outcome === 'missing-handler' || outcome === 'error' || outcome === 'timeout';
}
