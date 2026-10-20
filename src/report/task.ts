import { compareStrings } from '../compare.ts';
import type { TaskValidation } from '../exchange/task-evidence.ts';
import type { CheckReport } from './check-report.ts';
import type { TaskEvidenceReport } from './task-evidence.ts';
import type { TraceAffected, TraceCallHop, TraceReach, TraceReport } from './trace.ts';
import { limitTraceReport } from './trace-view.ts';

/** 관련 검증 결과가 어느 파일 바이트에 속하는지 id로 보존한다. */
export interface TaskValidationInput { readonly artifact: string; readonly validation: TaskValidation }

/** 작업에서 확인하지 못한 사실이다. 빈 목록을 완전성으로 읽지 않게 별도 계수한다. */
interface TaskUnknown { readonly code: string; readonly detail: string }

/** 재탐색 없이 원본 trace chain과 도달 경로를 가리키는 이유다. */
interface TestReason {
  readonly chain: number;
  readonly source: string;
  readonly reach: TraceReach | TraceAffected | { readonly path: readonly string[]; readonly evidence: 'not-assessed' };
}

function bounded<T>(items: readonly T[], limit: number) {
  return { total: items.length, items: items.slice(0, limit), omitted: Math.max(0, items.length - limit) };
}

/**
 * 기존 trace/check의 관찰을 한 작업 뷰로 조립한다. 새 그래프·규칙·승인 판단은 만들지 않는다.
 *
 * 모든 판단과 우선순위는 자르기 전에 계산하며, 수동 manifest의 검증 공백은 항상 남긴다.
 */
export function createTaskReport(trace: TraceReport, check: CheckReport, evidence: TaskEvidenceReport,
  validations: readonly TaskValidationInput[], limit: number) {
  const unknown: TaskUnknown[] = [{ code: 'input-binding-unverified',
    detail: 'Manual manifests compare bytes and declared inputs; current source, compiler lifecycle and execution are unverified.' }];
  for (const entry of evidence.artifacts) {
    if (entry.alignment !== 'matched') unknown.push({ code: `evidence-${entry.alignment}`,
      detail: `${entry.id}: ${entry.reasons.join(', ')}` });
  }
  for (const gap of trace.gaps) unknown.push({ code: gap.code, detail: gap.detail });
  for (const entry of trace.limitations) unknown.push({ code: 'trace-limitation', detail: entry.message });
  for (const entry of trace.analysisLimitations) unknown.push({ code: 'analysis-limitation', detail: entry.message });
  const subjects = traceSubjects(trace);
  const evidenceById = new Map(evidence.artifacts.map((entry) => [entry.id, entry.alignment]));
  const tests = validations.flatMap(({ artifact, validation }) => {
    for (const detail of validation.limitations) unknown.push({ code: 'validation-limitation', detail });
    return validation.tests.flatMap((entry) => {
      const reason = subjects.get(JSON.stringify([entry.platform, entry.usr]));
      return reason === undefined ? [] : [{ id: entry.id, artifact, platform: entry.platform, usr: entry.usr,
        observedOutcome: entry.outcome, verification: 'unverified' as const,
        inputAlignment: evidenceById.get(artifact)!, reason }];
    });
  });
  const rank = { failed: 0, unknown: 1, passed: 2 };
  tests.sort((left, right) => rank[left.observedOutcome] - rank[right.observedOutcome]
    || compareStrings(left.artifact, right.artifact) || compareStrings(left.id, right.id));
  if (tests.length === 0) unknown.push({ code: 'test-mapping-missing',
    detail: 'No recorded test maps to an observed trace symbol; test absence or success cannot be inferred.' });
  else unknown.push({ code: 'test-execution-unverified',
    detail: 'Recorded outcomes are caller observations; matching artifact bytes do not prove test execution.' });
  const testSummary = { passed: 0, failed: 0, unknown: 0 };
  for (const entry of tests) testSummary[entry.observedOutcome]++;
  return {
    format: 'isthmus-task' as const, version: 1, complete: false as const, requiresReview: true as const,
    evidence: { ...evidence, artifacts: bounded(evidence.artifacts, limit) },
    trace: limitTraceReport(trace, { maxChains: limit, maxRows: limit }),
    rules: { scope: 'all-input-bridge-facts' as const, summary: check.summary, issues: bounded(check.issues, limit),
      limitations: bounded(check.limitations, limit) },
    tests: { ...bounded(tests, limit), observedSummary: testSummary },
    unknown: bounded(unknown, limit),
  };
}

/** 보고서에 이미 있는 심볼만 색인한다. 테스트 이름·소스 경로로 새 관계를 추측하지 않는다. */
function traceSubjects(trace: TraceReport): Map<string, TestReason> {
  const subjects = new Map<string, TestReason>();
  const add = (platform: string, usr: string, reason: TestReason) => {
    const key = JSON.stringify([platform, usr]);
    if (!subjects.has(key)) subjects.set(key, reason);
  };
  trace.chains.forEach((chain, index) => {
    for (const handler of chain.handlers) add(handler.platform, handler.usr,
      { chain: index, source: 'handler', reach: handler.reachedFrom[0] ?? { path: [handler.usr], evidence: 'not-assessed' } });
    for (const entry of chain.entryPoints ?? []) add(entry.platform, entry.usr,
      { chain: index, source: 'entry-point', reach: entry.reachedFrom[0] ?? { path: [entry.usr], evidence: 'not-assessed' } });
    for (const use of chain.relationUses) {
      if (use.use.symbol?.usr !== undefined) add(use.use.platform, use.use.symbol.usr,
        { chain: index, source: 'relation-use', reach: use.reachedFrom[0] ?? { path: [use.use.symbol.usr], evidence: 'not-assessed' } });
    }
    for (const database of chain.database) for (const entry of database.dependents) add(entry.platform, entry.usr,
      { chain: index, source: 'database-dependent', reach: entry });
    const calls = (entries: readonly TraceCallHop[]): void => {
      for (const call of entries) {
        if (call.call.symbol?.usr !== undefined) add(call.call.platform, call.call.symbol.usr,
          { chain: index, source: 'client-call', reach: { path: [call.call.symbol.usr], evidence: 'not-assessed' } });
        for (const entry of call.affected) add(entry.platform, entry.usr,
          { chain: index, source: 'client-dependent', reach: entry });
        for (const upstream of call.upstreamRoutes ?? []) for (const caller of upstream.callers ?? []) calls(caller.calls);
      }
    };
    for (const route of chain.routes) calls(route.calls);
  });
  return subjects;
}
