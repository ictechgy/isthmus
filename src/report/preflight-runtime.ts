import { compareStrings } from '../compare.ts';
import type { BridgeLocation } from '../exchange/parse.ts';
import type { PreflightContext } from '../exchange/preflight-context.ts';
import type { BridgeRuntimeDocument, RuntimeExpectations, RuntimeOutcome, RuntimePlatform, RuntimeRoute } from '../exchange/runtime.ts';
import { RuntimeValidationError } from '../exchange/runtime.ts';
import type { BridgeEndpoint } from '../join/join.ts';
import type { PreflightLimitation, PreflightReport } from './preflight.ts';
import { verifyRuntimeEvidence } from './runtime.ts';
import type { RuntimeVerificationReport } from './runtime.ts';

/** 실제 주소 관찰과 정적 후보를 구분하며 기록의 run·instance를 보존한다. */
export interface PreflightRuntimeRoute extends RuntimeRoute {
  readonly runId: string;
  readonly scenario: string;
  readonly platform: RuntimePlatform;
  readonly instance: string;
  readonly observedCalls: number;
  readonly outcomes: Readonly<Record<RuntimeOutcome, number>>;
  readonly callers: readonly BridgeLocation[];
  readonly callersOmitted: number;
  readonly selectionReasons: readonly ('route' | 'caller-file')[];
  readonly staticStatus: 'candidates' | 'unobserved' | 'unsupported';
  readonly boundaryKeys: readonly string[];
  readonly candidateKey?: string;
}

/** 같은 주소의 후보는 runtime 인스턴스 수와 무관하게 한 번만 싣는다. */
export interface PreflightRuntimeCandidates {
  readonly key: string;
  readonly channel: string;
  readonly method: string;
  readonly handlers: readonly BridgeEndpoint[];
  readonly handlersOmitted: number;
}

/** 선언된 시나리오의 검증과 선택한 정적 경계의 실행 공백을 별도로 제공한다. */
export interface PreflightRuntimeReport {
  readonly aligned: boolean;
  readonly verification: RuntimeVerificationReport;
  readonly routes: readonly PreflightRuntimeRoute[];
  readonly candidates: readonly PreflightRuntimeCandidates[];
  readonly unobservedBoundaries: readonly string[];
  readonly uncoveredBoundaries: readonly string[];
}

/** runtime은 원래 정적 간선을 바꾸지 않고 독립 검증과 후보 근거만 추가한다. */
export function attachPreflightRuntime(
  context: PreflightContext, report: PreflightReport,
  expectations: RuntimeExpectations, documents: readonly BridgeRuntimeDocument[],
): PreflightReport {
  if (expectations.project !== context.project || report.project !== context.project || report.revision !== context.revision) {
    throw new RuntimeValidationError('Preflight and runtime expectations must describe the same project and capture.');
  }
  const verification = verifyRuntimeEvidence(expectations, documents);
  const aligned = expectations.revision === context.revision;
  const files = new Set(report.reviewFiles);
  const addedFiles = new Set<string>();
  const byRoute = new Map<string, string[]>();
  const methodChannels = new Set<string>();
  for (const { subject } of report.boundaries) {
    if (subject.target !== 'flutter') continue;
    const key = routeKey(subject.channel, subject.method);
    const keys = byRoute.get(key) ?? [];
    keys.push(subject.key);
    byRoute.set(key, keys);
    if (subject.method !== undefined) methodChannels.add(subject.channel);
  }
  const required = report.boundaries.filter(({ subject }) => subject.target === 'flutter' &&
    (subject.method !== undefined || !methodChannels.has(subject.channel)));
  const declared = new Set(expectations.checks.filter((check) => apple(check.platform) && check.transport === 'method-channel')
    .flatMap((check) => [routeKey(check.channel, check.method), routeKey(check.channel, undefined)]));
  const observed = new Set<string>();
  const handlers = new Map<string, { channel: string; method: string; endpoints: Map<string, BridgeEndpoint> }>();
  for (const document of context.bridges) {
    if (document.platform !== 'swift' || document.target !== 'flutter') continue;
    for (const fact of document.facts) {
      if (fact.kind !== 'method-handle' || fact.dynamic || fact.channel === null || fact.method === undefined) continue;
      const key = routeKey(fact.channel, fact.method);
      let group = handlers.get(key);
      if (group === undefined) {
        group = { channel: fact.channel, method: fact.method, endpoints: new Map() };
        handlers.set(key, group);
      }
      group.endpoints.set(JSON.stringify([fact.location.path, fact.location.line, fact.location.column,
        fact.symbol?.usr ?? null, fact.symbol?.qualifiedName ?? null, fact.sourceLanguage ?? null]), {
        platform: 'swift', location: fact.location,
        ...(fact.symbol === undefined ? {} : { symbol: fact.symbol }),
        ...(fact.sourceLanguage === undefined ? {} : { sourceLanguage: fact.sourceLanguage }),
      });
    }
  }
  const candidateGroups = new Map<string, PreflightRuntimeCandidates>();
  const groups = new Map<string, {
    route: Omit<PreflightRuntimeRoute, 'callers' | 'callersOmitted' | 'selectionReasons' | 'observedCalls' | 'outcomes'>;
    count: number; outcomes: Record<RuntimeOutcome, number>;
    callers: Map<string, BridgeLocation>; reasons: Set<'route' | 'caller-file'>;
  }>();
  for (const document of [...documents].sort((a, b) => compareStrings(a.run.id, b.run.id))) {
    // 기대 문서가 이전 revision이어도 현재 정적 분석과 같은 실행만 경계 근거에 연결한다.
    if (document.revision !== context.revision) continue;
    for (const event of document.events) {
      const supported = apple(document.run.platform) && event.transport === 'method-channel';
      const route = routeKey(event.channel, event.method);
      const channel = routeKey(event.channel, undefined);
      const keys = supported ? [...(byRoute.get(route) ?? []), ...(byRoute.get(channel) ?? [])] : [];
      const fromFile = event.caller !== undefined && files.has(event.caller.path);
      if (keys.length === 0 && !fromFile) continue;
      if (supported) { observed.add(route); observed.add(channel); }
      const candidates = supported ? handlers.get(route) : undefined;
      if (candidates !== undefined && !candidateGroups.has(route)) {
        const endpoints = [...candidates.endpoints.entries()].sort(([a], [b]) => compareStrings(a, b)).map(([, value]) => value);
        for (const endpoint of endpoints) addedFiles.add(endpoint.location.path);
        candidateGroups.set(route, { key: route, channel: candidates.channel, method: candidates.method,
          handlers: endpoints.slice(0, 20), handlersOmitted: Math.max(0, endpoints.length - 20) });
      }
      const key = JSON.stringify([document.run.id, event.transport, event.channel, event.method ?? null, event.instance]);
      let group = groups.get(key);
      if (group === undefined) {
        group = { route: {
          runId: document.run.id, scenario: document.run.scenario, platform: document.run.platform,
          transport: event.transport, channel: event.channel, ...(event.method === undefined ? {} : { method: event.method }),
          instance: event.instance, staticStatus: !supported ? 'unsupported' : candidates !== undefined ? 'candidates' : 'unobserved',
          boundaryKeys: [...new Set(keys)].sort(compareStrings),
          ...(candidates === undefined ? {} : { candidateKey: route }),
        }, count: 0, outcomes: { success: 0, error: 0, timeout: 0, pending: 0, 'missing-handler': 0 },
        callers: new Map(), reasons: new Set() };
        groups.set(key, group);
      }
      group.count++;
      group.outcomes[event.outcome]++;
      if (keys.length > 0) group.reasons.add('route');
      if (fromFile) group.reasons.add('caller-file');
      if (event.caller !== undefined) {
        group.callers.set(JSON.stringify([event.caller.path, event.caller.line, event.caller.column]), event.caller);
        addedFiles.add(event.caller.path);
      }
    }
  }
  const routes = [...groups.entries()].sort(([a], [b]) => compareStrings(a, b)).map(([, group]): PreflightRuntimeRoute => ({
    ...group.route, observedCalls: group.count, outcomes: group.outcomes,
    callers: [...group.callers.entries()].sort(([a], [b]) => compareStrings(a, b)).slice(0, 20).map(([, caller]) => caller),
    callersOmitted: Math.max(0, group.callers.size - 20), selectionReasons: [...group.reasons].sort(compareStrings),
  }));
  const unobservedBoundaries = required.filter(({ subject }) => !observed.has(routeKey(subject.channel, subject.method)))
    .map(({ subject }) => subject.key).sort(compareStrings);
  const uncoveredBoundaries = required.filter(({ subject }) => !aligned || !declared.has(routeKey(subject.channel, subject.method)))
    .map(({ subject }) => subject.key).sort(compareStrings);
  const gaps: PreflightLimitation[] = [];
  if (!aligned) gaps.push({ code: 'stale-runtime-expectations', message: 'Runtime expectations target a different capture revision.' });
  if (verification.status !== 'passed') gaps.push({ code: 'runtime-verification-gap',
    message: 'Declared runtime scenarios contain failures, missing observations, stale runs, or incomplete evidence.' });
  if (unobservedBoundaries.length > 0) gaps.push({ code: 'unobserved-runtime-boundaries',
    message: `${unobservedBoundaries.length} related static boundary(s) have no current runtime observations.` });
  if (uncoveredBoundaries.length > 0) gaps.push({ code: 'uncovered-runtime-boundaries',
    message: `${uncoveredBoundaries.length} related static boundary(s) have no current scenario expectation.` });
  if (routes.some(({ staticStatus }) => staticStatus !== 'candidates')) gaps.push({ code: 'runtime-static-binding-gap',
    message: 'Some related runtime routes have no supported static handler candidate; observations do not identify native symbols.' });
  const reviewFiles = [...new Set([...report.reviewFiles, ...addedFiles])].sort(compareStrings);
  const candidates = [...candidateGroups.entries()].sort(([a], [b]) => compareStrings(a, b)).map(([, value]) => value);
  return { ...report, runtime: { aligned, verification, routes, candidates, unobservedBoundaries, uncoveredBoundaries },
    reviewFiles, limitations: [...report.limitations, ...gaps],
    summary: { ...report.summary, reviewFiles: reviewFiles.length, evidenceGaps: report.summary.evidenceGaps + gaps.length } };
}

function routeKey(channel: string, method: string | undefined): string { return JSON.stringify([channel, method ?? null]); }
function apple(platform: RuntimePlatform): boolean { return platform === 'ios' || platform === 'macos'; }
