import { compareStrings } from '../compare.ts';
import { isBridgeReceiverDocument } from '../exchange/parse.ts';
import type { BridgeEndpoint, JoinLimitation } from '../join/join.ts';
import type { CheckIssue } from './check-report.ts';
import { hasPreflightBlockers, PreflightGraphError, type PreflightAffected, type PreflightRelation, type PreflightReport, type PreflightSubject } from './preflight.ts';
import type { RuntimeCheckResult } from './runtime.ts';
import type { RuntimeVerificationReport } from './runtime.ts';

/** 모든 항목 수를 보존하면서 표시 항목만 제한하는 컬렉션이다. */
export interface PreflightBounded<T> {
  readonly total: number;
  readonly items: readonly T[];
  readonly omitted: number;
}

/** 목록 소비자가 사용할 수 있는 작은 심볼 투영이다. */
export type PreflightSubjectPreview = PreflightSubject;

export interface PreflightIssuePreview {
  readonly code: string;
  readonly severity: 'error' | 'warning';
  readonly channel: string;
  readonly method?: string;
  readonly message: string;
}

export interface PreflightLimitationPreview {
  readonly code: string;
  readonly message: string;
  readonly analysis?: string;
}

export interface PreflightBridgeLimitationPreview {
  readonly platform: JoinLimitation['platform'];
  readonly target: JoinLimitation['target'];
  readonly tool: string;
  readonly message: string;
  readonly channels?: PreflightBounded<string>;
}

export interface PreflightRuntimeRoutePreview {
  readonly runId: string;
  readonly scenario: string;
  readonly platform: string;
  readonly transport: string;
  readonly channel: string;
  readonly method?: string;
  readonly instance?: string;
  readonly observedCalls: number;
  readonly staticStatus: string;
  readonly candidateKey?: string;
}

export interface PreflightRuntimeCandidatePreview {
  readonly key: string;
  readonly channel: string;
  readonly method?: string;
  readonly transport?: 'basic-message-channel';
  readonly matching?: 'literal' | 'prefix';
  readonly handlerCount: number;
  readonly handlersOmitted: number;
  readonly handlers: PreflightBounded<BridgeEndpoint>;
}

export interface PreflightRuntimeView {
  readonly aligned: boolean;
  readonly verification: {
    readonly status: string;
    readonly scope: string;
    readonly summary: RuntimeVerificationReport['summary'];
    readonly declaredScenarioPlatforms: number;
    readonly nonpassedChecks: PreflightBounded<PreflightRuntimeCheckPreview>;
  };
  readonly unobservedBoundaries: PreflightBounded<string>;
  readonly uncoveredBoundaries: PreflightBounded<string>;
  readonly routes: PreflightBounded<PreflightRuntimeRoutePreview>;
  readonly candidates: PreflightBounded<PreflightRuntimeCandidatePreview>;
}

export interface PreflightRuntimeCheckPreview {
  readonly id: string;
  readonly scenario: string;
  readonly platform: string;
  readonly transport: string;
  readonly channel: string;
  readonly method?: string;
  readonly instance?: string;
  readonly status: string;
  readonly observedCalls: number;
}

/** 원본 보고서를 변경하지 않고 정적·runtime 정보를 압축한 뷰다. */
export interface PreflightSummaryView {
  readonly format: 'isthmus-preflight-summary';
  readonly version: 1;
  readonly project: string;
  readonly revision: string;
  readonly scope: PreflightReport['scope'];
  readonly complete: false;
  readonly status: PreflightReport['status'];
  readonly summary: PreflightReport['summary'];
  readonly requiresReview: boolean;
  readonly roots: PreflightBounded<{ readonly subject: PreflightSubjectPreview; readonly depth: 0 }>;
  readonly affected: PreflightBounded<{ readonly subject: PreflightSubjectPreview; readonly depth: number }>;
  readonly reviewFiles: PreflightBounded<string>;
  readonly issues: PreflightBounded<PreflightIssuePreview>;
  readonly limitations: PreflightBounded<PreflightLimitationPreview>;
  readonly bridgeLimitations: PreflightBounded<PreflightBridgeLimitationPreview>;
  readonly messageLimitations?: PreflightBounded<PreflightBridgeLimitationPreview>;
  readonly producers: PreflightBounded<PreflightReport['producers'][number]>;
  readonly runtime?: PreflightRuntimeView;
}

interface PreflightPathStep {
  readonly subject: PreflightSubjectPreview;
  readonly depth: number;
  readonly relations: PreflightBounded<PreflightRelationPreview>;
}

type PreflightRelationPreview =
  | { readonly kind: 'language'; readonly analysis: string; readonly relationships: PreflightBounded<string> }
  | Exclude<PreflightRelation, { readonly kind: 'language' }>;

export interface PreflightExplanationView {
  readonly format: 'isthmus-preflight-explanation';
  readonly version: 1;
  readonly project: string;
  readonly revision: string;
  readonly scope: PreflightReport['scope'];
  readonly complete: false;
  readonly status: 'found' | 'notFound' | 'ambiguous';
  readonly selector: string;
  readonly summary: PreflightReport['summary'];
  readonly requiresReview: boolean;
  readonly issues: PreflightBounded<PreflightIssuePreview>;
  readonly limitations: PreflightBounded<PreflightLimitationPreview>;
  readonly bridgeLimitations: PreflightBounded<PreflightBridgeLimitationPreview>;
  readonly messageLimitations?: PreflightBounded<PreflightBridgeLimitationPreview>;
  readonly runtime?: PreflightRuntimeView;
  readonly result?: { readonly subject: PreflightSubjectPreview; readonly path: readonly PreflightPathStep[] };
  readonly candidates?: PreflightBounded<{ readonly key: string; readonly subject: PreflightSubjectPreview }>;
}

const VIEW_LIMIT = 20;

/** 전체 보고서에서 상태와 개수를 계산한 뒤 목록 항목만 제한한 preflight 뷰를 만든다. */
export function createPreflightSummary(report: PreflightReport, limit = VIEW_LIMIT): PreflightSummaryView {
  assertLimit(limit);
  const view = commonView(report, limit);
  return {
    format: 'isthmus-preflight-summary', version: 1,
    project: report.project, revision: report.revision, scope: report.scope,
    complete: false, status: report.status, summary: report.summary,
    requiresReview: requiresReview(report),
    roots: bounded(sortedRoots(report.roots).map((subject) => ({ subject, depth: 0 as const })), limit),
    affected: bounded(sortedAffected(report.affected).map(({ subject, depth }) => ({ subject, depth })), limit),
    ...view,
  };
}

/** 정확히 일치하는 심볼을 설명하고, 찾으면 root부터의 전체 경로를 제공한다. */
export function createPreflightExplanation(report: PreflightReport, selector: string): PreflightExplanationView {
  const limit = VIEW_LIMIT;
  const view = commonView(report, limit);
  const subjects = allSubjects(report);
  const matches = matchingSubjects(subjects, selector);
  const base = {
    format: 'isthmus-preflight-explanation' as const, version: 1 as const,
    project: report.project, revision: report.revision, scope: report.scope,
    complete: false as const, selector, summary: report.summary,
    requiresReview: requiresReview(report), ...view,
  };
  if (matches.length === 0) return { ...base, status: 'notFound' };
  const candidates = bounded(matches.map(({ subject }) => ({ key: subject.key, subject })), limit);
  if (matches.length !== 1) return { ...base, status: 'ambiguous', candidates };
  const target = matches[0]!.subject;
  return { ...base, status: 'found', result: { subject: target, path: pathFor(report, target.key) } };
}

function commonView(report: PreflightReport, limit: number): Pick<PreflightSummaryView, 'reviewFiles' | 'issues' | 'limitations' | 'bridgeLimitations' | 'messageLimitations' | 'producers' | 'runtime'> {
  return {
    reviewFiles: bounded([...report.reviewFiles].sort(compareStrings), limit),
    issues: bounded([...report.issues].sort(compareIssues).map(issuePreview), limit),
    limitations: bounded([...report.limitations].sort(compareLimitations).map(({ code, message, analysis }) => ({
      code, message, ...(analysis === undefined ? {} : { analysis }),
    })), limit),
    bridgeLimitations: bounded([...report.bridgeLimitations].sort(compareBridgeLimitations).map((limitation) => ({
      platform: limitation.platform, target: limitation.target, tool: limitation.tool, message: limitation.message,
      ...(limitation.channels === undefined ? {} : { channels: bounded([...limitation.channels].sort(compareStrings), limit) }),
    })), limit),
    ...(report.messageLimitations === undefined ? {} : { messageLimitations: bounded([...report.messageLimitations]
      .sort(compareBridgeLimitations).map(({ platform, target, tool, message }) => ({ platform, target, tool, message })), limit) }),
    producers: bounded([...report.producers].sort((a, b) => compareStrings(a.analysis, b.analysis) || compareStrings(a.platform, b.platform)), limit),
    ...(report.runtime === undefined ? {} : { runtime: runtimeView(report, limit) }),
  };
}

function runtimeView(report: PreflightReport, limit: number): PreflightRuntimeView {
  const runtime = report.runtime!;
  const checks = runtime.verification.checks.filter(({ status }) => status !== 'passed');
  const pairs = new Set(runtime.verification.checks.map(({ expected }) => JSON.stringify([expected.scenario, expected.platform])));
  return {
    aligned: runtime.aligned,
    verification: {
      status: runtime.verification.status, scope: runtime.verification.scope,
      summary: runtime.verification.summary,
      declaredScenarioPlatforms: pairs.size,
      nonpassedChecks: bounded(checks.map(runtimeCheckPreview).sort(compareRuntimeChecks), limit),
    },
    unobservedBoundaries: bounded([...runtime.unobservedBoundaries].sort(compareStrings), limit),
    uncoveredBoundaries: bounded([...runtime.uncoveredBoundaries].sort(compareStrings), limit),
    routes: bounded(runtime.routes.map(runtimeRoutePreview).sort(compareRuntimeRoutes), limit),
    candidates: bounded(runtime.candidates.map((candidate) => ({
      key: candidate.key, channel: candidate.channel, ...(candidate.method === undefined ? {} : { method: candidate.method }),
      ...(candidate.transport === undefined ? {} : { transport: candidate.transport, matching: candidate.matching! }),
      handlerCount: candidate.handlers.length + candidate.handlersOmitted, handlersOmitted: candidate.handlersOmitted,
      handlers: { total: candidate.handlers.length + candidate.handlersOmitted,
        items: candidate.handlers.slice(0, limit),
        omitted: candidate.handlers.length + candidate.handlersOmitted - Math.min(candidate.handlers.length, limit) },
    })).sort((a, b) => compareStrings(a.key, b.key)), limit),
  };
}

function runtimeCheckPreview(check: RuntimeCheckResult): PreflightRuntimeCheckPreview {
  const expected = check.expected;
  return {
    id: expected.id, scenario: expected.scenario, platform: expected.platform,
    transport: expected.transport, channel: expected.channel,
    ...(expected.method === undefined ? {} : { method: expected.method }),
    ...(expected.instance === undefined ? {} : { instance: expected.instance }),
    status: check.status, observedCalls: check.observedCalls,
  };
}

function runtimeRoutePreview(route: NonNullable<PreflightReport['runtime']>['routes'][number]): PreflightRuntimeRoutePreview {
  return {
    runId: route.runId, scenario: route.scenario, platform: route.platform, transport: route.transport,
    channel: route.channel, ...(route.method === undefined ? {} : { method: route.method }),
    ...(route.instance === undefined ? {} : { instance: route.instance }),
    observedCalls: route.observedCalls, staticStatus: route.staticStatus,
    ...(route.candidateKey === undefined ? {} : { candidateKey: route.candidateKey }),
  };
}

/**
 * 증거 위치가 bridge 수신 측(네이티브) 문서에서 온 것인지 구분한다.
 *
 * 끝점에는 target이 없으므로 진단의 target을 함께 넘겨 명시 규칙으로 판정한다 —
 * platform만 보면 persistence 도메인의 kotlin·swift 증거도 수신 측으로 읽힌다.
 */
function isReceiverEndpoint(endpoint: BridgeEndpoint, target: CheckIssue['target']): boolean {
  return isBridgeReceiverDocument({ platform: endpoint.platform, target });
}

function issuePreview(issue: PreflightReport['issues'][number]): PreflightIssuePreview {
  const route = issue.method === undefined ? issue.channel : `${issue.channel}.${issue.method}`;
  const message = issue.code === 'unhandled-invocation' || issue.code === 'unhandled-invocation-unverified'
    ? `No native handler was verified for ${route}.`
    : issue.code === 'unregistered-channel-creation' || issue.code === 'unregistered-channel-creation-unverified'
      ? `No native registration was verified for ${route}.`
      : issue.code === 'registration-without-creation'
        ? `Native registration has no verified channel creation for ${route}.`
        : issue.code === 'module-import-without-export' || issue.code === 'module-import-without-export-unverified'
          ? `No native module export was verified for ${route}.`
          : issue.code === 'module-import-without-export-optional'
            ? `No native module export was verified for ${route}, but every caller tolerates absence.`
            : issue.code === 'module-import-mechanism-mismatch'
              ? `Observed module exports for ${route} resolve through a different bridge mechanism.`
              : issue.code === 'component-require-without-export' || issue.code === 'component-require-without-export-unverified'
              // Expo require가 코어 export만 관찰된 경우 error 코드지만
              // 원인은 mechanism 불일치다 — 없다는 문구는 틀리다.
              ? issue.evidence.some((endpoint) => isReceiverEndpoint(endpoint, issue.target))
                ? `Observed component exports for ${route} resolve through a different bridge mechanism.`
                : `No native component export was verified for ${route}.`
              : issue.code === 'component-require-mechanism-mismatch'
                ? `Observed component exports for ${route} resolve through a different bridge mechanism.`
                : issue.code === 'module-export-without-import'
                  ? `Native module export has no verified import for ${route}.`
                  : issue.code === 'module-export-mechanism-mismatch'
                    ? `Observed module imports for ${route} resolve through a different bridge mechanism.`
                    : issue.code === 'component-export-without-require'
                      ? `Native component export has no verified require for ${route}.`
                      : issue.code === 'component-export-mechanism-mismatch'
                        ? `Observed component requires for ${route} resolve through a different bridge mechanism.`
                        : `Native handler has no verified invocation for ${route}.`;
  return {
    code: issue.code, severity: issue.severity, channel: issue.channel,
    ...(issue.method === undefined ? {} : { method: issue.method }), message,
  };
}

function pathFor(report: PreflightReport, targetKey: string): PreflightPathStep[] {
  const roots = new Map(report.roots.map((subject) => [subject.key, subject]));
  const affected = new Map(report.affected.map((item) => [item.subject.key, item]));
  const steps: PreflightPathStep[] = [];
  const seen = new Set<string>();
  let reachedRoot = false;
  let key: string | undefined = targetKey;
  while (key !== undefined) {
    if (seen.has(key)) throw new PreflightGraphError('Preflight explanation encountered a cyclic path.');
    seen.add(key);
    const root = roots.get(key);
    if (root !== undefined) {
      steps.push({ subject: root, depth: 0, relations: bounded([], VIEW_LIMIT) });
      reachedRoot = true;
      break;
    }
    const item = affected.get(key);
    if (item === undefined) throw new PreflightGraphError('Preflight explanation refers to an unknown path node.');
    steps.push({ subject: item.subject, depth: item.depth, relations: relationPreview(item.relations, VIEW_LIMIT) });
    key = item.via;
  }
  if (!reachedRoot) {
    throw new PreflightGraphError('Preflight explanation could not find a root path.');
  }
  return steps.reverse();
}

function relationPreview(relations: readonly PreflightRelation[], limit: number): PreflightBounded<PreflightRelationPreview> {
  return bounded(relations.map((relation) => relation.kind === 'language'
    ? { kind: 'language' as const, analysis: relation.analysis, relationships: bounded([...relation.relationships].sort(compareStrings), limit) }
    : relation), limit);
}

function allSubjects(report: PreflightReport): Array<{ subject: PreflightSubject; index: number }> {
  const values = [...report.roots, ...report.affected.map(({ subject }) => subject)];
  const unique = new Map<string, { subject: PreflightSubject; index: number }>();
  values.forEach((subject, index) => { if (!unique.has(subject.key)) unique.set(subject.key, { subject, index }); });
  return [...unique.values()].sort((a, b) => compareStrings(a.subject.key, b.subject.key) || a.index - b.index);
}

function matchingSubjects(subjects: readonly { subject: PreflightSubject; index: number }[], selector: string): Array<{ subject: PreflightSubject; index: number }> {
  const keys = subjects.filter(({ subject }) => subject.key === selector);
  if (keys.length > 0) return keys;
  const ids = subjects.filter(({ subject }) => subject.kind === 'symbol' && subject.symbol.id === selector);
  if (ids.length > 0) return ids;
  return subjects.filter(({ subject }) => subject.kind === 'symbol' && subject.symbol.qualifiedName === selector);
}

function sortedRoots(subjects: readonly PreflightSubject[]): PreflightSubject[] { return [...subjects].sort((a, b) => compareStrings(a.key, b.key)); }
function sortedAffected(affected: readonly PreflightAffected[]): PreflightAffected[] {
  return [...affected].sort((a, b) => a.depth - b.depth || compareStrings(a.subject.key, b.subject.key));
}

function bounded<T>(items: readonly T[], limit: number): PreflightBounded<T> {
  return { total: items.length, items: items.slice(0, limit), omitted: Math.max(0, items.length - limit) };
}

function assertLimit(limit: number): asserts limit is number {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new RangeError('Preflight view limit must be an integer from 1 to 100.');
}

function requiresReview(report: PreflightReport): boolean {
  return hasPreflightBlockers(report);
}

function compareIssues(a: PreflightReport['issues'][number], b: PreflightReport['issues'][number]): number {
  return compareStrings(a.code, b.code) || compareStrings(a.channel, b.channel) || compareStrings(a.method ?? '', b.method ?? '') || compareStrings(a.severity, b.severity);
}
function compareLimitations(a: PreflightReport['limitations'][number], b: PreflightReport['limitations'][number]): number {
  return compareStrings(a.code, b.code) || compareStrings(a.analysis ?? '', b.analysis ?? '') || compareStrings(a.message, b.message);
}
function compareBridgeLimitations(a: JoinLimitation, b: JoinLimitation): number {
  return compareStrings(a.platform, b.platform) || compareStrings(a.target ?? '', b.target ?? '') || compareStrings(a.tool, b.tool) || compareStrings(a.message, b.message);
}
function compareRuntimeChecks(a: PreflightRuntimeCheckPreview, b: PreflightRuntimeCheckPreview): number { return compareStrings(a.id, b.id); }
function compareRuntimeRoutes(a: PreflightRuntimeRoutePreview, b: PreflightRuntimeRoutePreview): number {
  return compareStrings(a.runId, b.runId) || compareStrings(a.channel, b.channel) || compareStrings(a.method ?? '', b.method ?? '') || compareStrings(a.instance ?? '', b.instance ?? '');
}
