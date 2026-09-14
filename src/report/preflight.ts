import { compareStrings } from '../compare.ts';
import type { ImpactSymbol, PreflightContext } from '../exchange/preflight-context.ts';
import type { BridgeEndpoint, JoinLimitation } from '../join/join.ts';
import { joinBridgeDocuments } from '../join/join.ts';
import type { BridgeTarget } from '../exchange/parse.ts';
import { createCheckReport } from './check-report.ts';
import type { CheckIssue } from './check-report.ts';
import { encodeSortedJson } from './sorted-json.ts';
import type { PreflightRuntimeReport } from './preflight-runtime.ts';
import { joinMessageBridges } from '../join/messages.ts';
import type { MessageEndpoint } from '../join/messages.ts';
import type { BridgeHandlerDependency } from '../exchange/messages.ts';
import type { BridgeSymbol } from '../exchange/parse.ts';

type Language = 'dart' | 'swift' | 'kotlin';

/** 언어 심볼과 경계의 키 공간을 분리한다. 원래 producer ID는 symbol.id에 보존한다. */
export type PreflightSubject = {
  readonly key: string; readonly kind: 'symbol'; readonly platform: Language; readonly symbol: ImpactSymbol;
} | {
  readonly key: string; readonly kind: 'bridge'; readonly target: BridgeTarget;
  readonly channel: string; readonly method?: string;
  readonly transport?: 'basic-message-channel';
  readonly matching?: 'literal' | 'prefix';
};

/** 실제 producer 사용 관계와 문자열 브리지 관계를 서로 다른 근거로 표시한다. */
export type PreflightRelation = {
  readonly kind: 'language'; readonly analysis: string; readonly relationships: readonly string[];
} | {
  readonly kind: 'bridge-message-dependency'; readonly evidence: BridgeEndpoint;
  readonly dependency: Omit<BridgeHandlerDependency, 'dispatchTargets'>;
  readonly dispatchTarget?: BridgeSymbol;
} | {
  readonly kind: 'bridge-handler' | 'bridge-registration' | 'bridge-invocation' | 'bridge-creation'
    | 'bridge-message-send' | 'bridge-message-handler';
  readonly evidence: BridgeEndpoint;
};

/** 가장 가까운 변경 씨앗까지의 선행 정점을 공유해 긴 경로 복사를 피한다. */
export interface PreflightAffected {
  readonly subject: PreflightSubject;
  readonly depth: number;
  readonly via: string;
  readonly relations: readonly PreflightRelation[];
}

/** 근거를 연결할 수 없는 부분과 발생 위치다. */
export interface PreflightLimitation {
  readonly code: string;
  readonly message: string;
  readonly analysis?: string;
  readonly evidence?: BridgeEndpoint;
}

/** 언어별 영향 투영과 브리지 관계를 연결한 사전 검토 문서다. */
export interface PreflightReport {
  readonly format: 'isthmus-preflight'; readonly version: 1;
  readonly project: string; readonly revision: string;
  readonly scope: 'cross-language-impact'; readonly complete: false;
  readonly status: 'observed' | 'unobserved' | 'noChanges';
  readonly selection: PreflightContext['selection'];
  readonly roots: readonly PreflightSubject[];
  readonly affected: readonly PreflightAffected[];
  readonly boundaries: readonly {
    subject: Extract<PreflightSubject, { kind: 'bridge' }>;
    relationship: 'consumer' | 'dependency';
    callers: readonly BridgeEndpoint[];
    receivers: readonly BridgeEndpoint[];
  }[];
  readonly reviewFiles: readonly string[];
  readonly issues: readonly CheckIssue[];
  readonly limitations: readonly PreflightLimitation[];
  readonly bridgeLimitations: readonly JoinLimitation[];
  readonly messageLimitations?: readonly JoinLimitation[];
  readonly runtime?: PreflightRuntimeReport;
  readonly producers: ReadonlyArray<{ analysis: string; platform: Language; tool: { name: string; version: string }; truncated: boolean }>;
  readonly summary: {
    selectedSymbols: number; affectedSymbols: number; bridgeBoundaries: number;
    reviewFiles: number; errors: number; warnings: number; evidenceGaps: number;
  };
}

/** 잘못된 그래프 투영과 자원 상한 초과를 입력 값 없이 구분한다. */
export class PreflightGraphError extends Error {}

const MAX_RELATIONS = 1_000_000;

/** 전체 언어 그래프가 아닌 producer의 영향 숲을 경계에서 연결한다. */
export function createPreflightReport(context: PreflightContext): PreflightReport {
  const joined = joinBridgeDocuments(context.bridges);
  const messages = joinMessageBridges(context.messages ?? [], context.project);
  if (joined.deferred) throw new PreflightGraphError('Preflight cannot use mixed-target bridge documents.');
  const nodes = new Map<string, PreflightSubject>();
  const roots = new Set<string>();
  const consumers = new Map<string, Map<string, Map<string, PreflightRelation>>>();
  let relationCount = 0;
  const limits: PreflightLimitation[] = context.limitations.map((message) => ({ code: 'capture-limitation', message }));
  const bindings = new Map(context.bindings.map((binding) => [locationKey('dart', binding.location), binding.symbol]));
  const analyses = [...context.analyses].sort((a, b) => compareStrings(a.id, b.id));
  const dartRoots = new Set(analyses.filter(({ platform }) => platform === 'dart')
    .flatMap(({ roots }) => roots.map(({ id }) => symbolKey('dart', id))));

  function addSymbol(platform: Language, symbol: ImpactSymbol): string {
    const key = symbolKey(platform, symbol.id);
    const existing = nodes.get(key);
    if (existing !== undefined && existing.kind === 'symbol') {
      const before = existing.symbol.location;
      const after = symbol.location;
      if (existing.symbol.qualifiedName !== symbol.qualifiedName ||
        (before !== undefined && after !== undefined && (before.path !== after.path ||
          (before.line !== undefined && after.line !== undefined && before.line !== after.line) ||
          (before.column !== undefined && after.column !== undefined && before.column !== after.column)))) {
        throw new PreflightGraphError('Conflicting symbol identities in producer impact inputs.');
      }
      if (before !== undefined && after !== undefined) {
        nodes.set(key, { ...existing, symbol: { ...existing.symbol, location: {
          path: before.path,
          ...(before.line === undefined && after.line === undefined ? {} : { line: before.line ?? after.line }),
          ...(before.column === undefined && after.column === undefined ? {} : { column: before.column ?? after.column }),
        } } });
        return key;
      }
      if (before !== undefined || after === undefined) return key;
      nodes.set(key, { ...existing, symbol: { ...existing.symbol, location: after } });
      return key;
    }
    nodes.set(key, { key, kind: 'symbol', platform, symbol });
    return key;
  }

  function link(dependency: string, consumer: string, relation: PreflightRelation): void {
    let outgoing = consumers.get(dependency);
    if (outgoing === undefined) { outgoing = new Map(); consumers.set(dependency, outgoing); }
    let reasons = outgoing.get(consumer);
    if (reasons === undefined) { reasons = new Map(); outgoing.set(consumer, reasons); }
    const key = encodeSortedJson(relation, true);
    if (!reasons.has(key) && ++relationCount > MAX_RELATIONS) throw new PreflightGraphError('Preflight relation budget exceeded.');
    reasons.set(key, relation);
  }

  for (const analysis of analyses) {
    for (const symbol of analysis.roots) {
      const key = addSymbol(analysis.platform, symbol);
      if (analysis.trigger === undefined) roots.add(key);
    }
    for (const item of analysis.affected) addSymbol(analysis.platform, item.symbol);
    for (const item of analysis.affected) link(symbolKey(analysis.platform, item.via), symbolKey(analysis.platform, item.symbol.id),
      { kind: 'language', analysis: analysis.id, relationships: item.relationships });
  }

  function endpointKey(endpoint: BridgeEndpoint): string | undefined {
    if (endpoint.platform !== 'dart' && endpoint.platform !== 'swift' && endpoint.platform !== 'kotlin') return undefined;
    if (endpoint.sourceLanguage === 'objective-c') return undefined;
    const binding = endpoint.platform === 'dart' ? bindings.get(locationKey('dart', endpoint.location)) : undefined;
    const id = endpoint.symbol?.usr ?? binding?.id;
    if (id === undefined) return undefined;
    const key = symbolKey(endpoint.platform, id);
    if (binding !== undefined) {
      if (binding.id !== id) throw new PreflightGraphError('Conflicting symbol identities in Dart bridge bindings.');
      // 영향 root는 위치를 생략할 수 있다. query가 관찰한 선언 위치도 병합·대조한다.
      addSymbol(endpoint.platform, binding);
    } else if (!nodes.has(key) && endpoint.symbol !== undefined) {
      addSymbol(endpoint.platform, { id, qualifiedName: endpoint.symbol.qualifiedName });
    }
    return nodes.has(key) ? key : undefined;
  }

  const channelRecords = [
    ...joined.matchedChannels,
    ...joined.unregisteredChannelCreations.map((item) => ({ ...item, registrations: [] })),
    ...joined.registrationsWithoutCreations.map((item) => ({ ...item, creations: [] })),
  ];
  const registrations = new Map(channelRecords.map((item) => [JSON.stringify([item.target, item.channel]), item.registrations]));
  const routes: Array<{
    subject: Extract<PreflightSubject, { kind: 'bridge' }>;
    callers: readonly BridgeEndpoint[]; receivers: readonly BridgeEndpoint[];
    callerKeys: string[]; receiverKeys: string[]; missing: BridgeEndpoint[]; imprecise: BridgeEndpoint[];
  }> = [];

  function boundary(target: BridgeTarget, channel: string, method: string | undefined,
    callers: readonly BridgeEndpoint[], handlers: readonly MessageEndpoint[], wire: readonly BridgeEndpoint[],
    matching?: 'literal' | 'prefix'): void {
    const key = matching === undefined ? JSON.stringify(['bridge', target, channel, method ?? null])
      : JSON.stringify(['bridge', target, 'basic-message-channel', matching, channel]);
    const subject = { key, kind: 'bridge' as const, target, channel, ...(method === undefined ? {} : { method }),
      ...(matching === undefined ? {} : { transport: 'basic-message-channel' as const, matching }) };
    nodes.set(key, subject);
    const route = { subject, callers, receivers: [...handlers, ...wire], callerKeys: [] as string[], receiverKeys: [] as string[],
      missing: [] as BridgeEndpoint[], imprecise: [] as BridgeEndpoint[] };
    for (const [endpoints, kind] of [[handlers, 'bridge-handler'], [wire, 'bridge-registration']] as const) {
      for (const endpoint of endpoints) {
        const receiver = endpointKey(endpoint);
        if (receiver === undefined) { route.missing.push(endpoint); continue; }
        let linkEvidence: BridgeEndpoint = endpoint;
        if (matching !== undefined) {
          const { handlerScope, dependencies, ...evidence } = endpoint as MessageEndpoint;
          linkEvidence = evidence;
          if (handlerScope?.complete === true && dependencies !== undefined) {
            // 공통 등록 선언은 직접 선택했을 때 전체 배선을 검토한다. 다른 handler의 호출로
            // 선언에 도달한 경우에는 발생 위치로 구분한 사용 관계만 해당 boundary로 전파한다.
            if (roots.has(receiver)) {
              route.receiverKeys.push(receiver);
              link(receiver, key, { kind: 'bridge-message-handler', evidence });
            }
            for (const { dispatchTargets, ...dependency } of dependencies) {
              for (const target of [dependency.symbol, ...(dispatchTargets ?? [])]) {
                if (endpoint.platform !== 'swift' && endpoint.platform !== 'kotlin') continue;
                const dependencyKey = symbolKey(endpoint.platform, target.usr!);
                if (!nodes.has(dependencyKey)) continue;
                route.receiverKeys.push(dependencyKey);
                link(dependencyKey, key, { kind: 'bridge-message-dependency', evidence, dependency,
                  ...(target === dependency.symbol ? {} : { dispatchTarget: target }) });
              }
            }
            continue;
          }
          route.imprecise.push(evidence);
        }
        route.receiverKeys.push(receiver);
        link(receiver, key, { kind: matching === undefined ? kind : 'bridge-message-handler', evidence: linkEvidence });
      }
    }
    for (const endpoint of callers) {
      const caller = endpointKey(endpoint);
      if (caller === undefined) { route.missing.push(endpoint); continue; }
      route.callerKeys.push(caller);
      link(key, caller, { kind: matching !== undefined ? 'bridge-message-send' : method === undefined ? 'bridge-creation' : 'bridge-invocation', evidence: endpoint });
    }
    routes.push(route);
  }

  for (const item of channelRecords) boundary(item.target, item.channel, undefined, item.creations, [], item.registrations);
  for (const item of [
    ...joined.matchedMethods,
    ...joined.unhandledInvocations.map((value) => ({ ...value, handlers: [] })),
    ...joined.handlersWithoutInvocations.map((value) => ({ ...value, invocations: [] })),
  ]) boundary(item.target, item.channel, item.method, item.invocations, item.handlers,
    registrations.get(JSON.stringify([item.target, item.channel])) ?? []);
  for (const route of messages.routes) boundary('flutter', route.channel, undefined, route.senders, route.handlers, [], route.matching);

  const depths = new Map([...roots].map((key) => [key, 0]));
  const visits = new Map<string, PreflightAffected>();
  const queue = [...roots].sort(compareStrings);
  for (let head = 0; head < queue.length; head++) {
    const dependency = queue[head]!;
    for (const [key, reasons] of [...(consumers.get(dependency) ?? [])].sort(([a], [b]) => compareStrings(a, b))) {
      if (depths.has(key)) continue;
      const subject = nodes.get(key);
      if (subject === undefined) throw new PreflightGraphError('Producer impact refers to an unknown symbol.');
      const depth = depths.get(dependency)! + 1;
      depths.set(key, depth);
      visits.set(key, { subject, depth, via: dependency,
        relations: [...reasons.entries()].sort(([a], [b]) => compareStrings(a, b)).map(([, reason]) => reason) });
      queue.push(key);
    }
  }
  const rootSubjects = [...roots].sort(compareStrings).map((key) => nodes.get(key)!);
  const affected = [...visits.values()].sort((a, b) => a.depth - b.depth || compareStrings(a.subject.key, b.subject.key));
  const reachedFiles = new Set([...rootSubjects, ...affected.map(({ subject }) => subject)]
    .flatMap((item) => item.kind === 'symbol' && item.symbol.location !== undefined ? [item.symbol.location.path] : []));
  for (const selection of Object.values(context.selection)) for (const path of selection.files) reachedFiles.add(path);

  const relevant = routes.filter((route) => depths.has(route.subject.key) || route.callerKeys.some((key) => depths.has(key)) ||
    route.receiverKeys.some((key) => depths.has(key)) || route.missing.some(({ location }) => reachedFiles.has(location.path)));
  for (const route of relevant) {
    if (route.subject.transport === 'basic-message-channel') {
      for (const evidence of route.imprecise) limits.push({ code: 'unresolved-message-handler-scope',
        message: 'Handler dependencies could not be fully attributed in the observed index; enclosing declaration impact remains conservative.', evidence });
      if (route.subject.matching === 'prefix') limits.push({ code: 'dynamic-message-address',
        message: 'Message channel prefixes describe possible routes; suffix and instance wiring are not resolved.' });
      if (route.callers.length === 0 || route.receivers.length === 0) limits.push({ code: 'unmatched-message-boundary',
        message: 'A related message boundary has no observed counterpart in the Basic extraction scope.' });
    }
    for (const evidence of route.missing) limits.push({ code: 'unresolved-bridge-binding',
      message: 'A bridge endpoint has no verified language symbol binding.', evidence });
    if (depths.has(route.subject.key)) for (const key of route.callerKeys) {
      if (!dartRoots.has(key)) {
        const subject = nodes.get(key);
        const location = subject?.kind === 'symbol' ? subject.symbol.location : undefined;
        limits.push({ code: 'missing-language-continuation', message: 'Dart consumer impact was not supplied for a reached bridge caller.',
          ...(location?.line !== undefined && location.column !== undefined
            ? { evidence: { platform: 'dart' as const, location: { path: location.path, line: location.line, column: location.column } } } : {}) });
      }
    }
  }
  for (const analysis of analyses) {
    if (analysis.trigger !== undefined && !depths.has(symbolKey(analysis.platform, analysis.trigger))) continue;
    for (const message of analysis.limitations) limits.push({ code: 'producer-limitation', analysis: analysis.id, message });
    if (analysis.truncated) limits.push({ code: 'producer-truncated', analysis: analysis.id, message: 'The producer impact traversal or output was truncated.' });
    if (analysis.trigger === undefined && analysis.roots.length === 0) limits.push({ code: 'unobserved-selection', analysis: analysis.id,
      message: 'The producer did not resolve a requested change selection.' });
  }
  for (const document of context.bridges) for (const fact of document.facts) {
    if ((fact.dynamic || fact.channel === null) && reachedFiles.has(fact.location.path)) limits.push({
      code: 'unresolved-dynamic-boundary', message: 'A related dynamic or unattributed bridge fact could not be connected.',
      evidence: { platform: document.platform, location: fact.location },
    });
  }
  for (const evidence of messages.unresolved) if (reachedFiles.has(evidence.location.path)) limits.push({
    code: 'unresolved-message-boundary', message: 'A related message address could not be resolved to a literal or proven prefix.', evidence,
  });
  if (relevant.some(({ subject }) => subject.transport === undefined)) {
    for (const limit of joined.limitations) limits.push({ code: 'bridge-limitation', message: limit.message });
  }
  if (relevant.some(({ subject }) => subject.transport === 'basic-message-channel')) {
    for (const limit of messages.limitations) limits.push({ code: 'message-producer-limitation', message: limit.message });
  }
  const uniqueLimits = [...new Map(limits.map((item) => [encodeSortedJson(item, true), item])).entries()]
    .sort(([a], [b]) => compareStrings(a, b)).map(([, item]) => item);
  const routeKeys = new Set(relevant.filter(({ subject }) => subject.transport === undefined)
    .map(({ subject }) => JSON.stringify([subject.target, subject.channel, subject.method ?? null])));
  const issues = createCheckReport(joined).issues.filter((issue) => routeKeys.has(JSON.stringify([issue.target, issue.channel, issue.method ?? null])));
  for (const route of relevant) for (const endpoint of [...route.callers, ...route.receivers]) reachedFiles.add(endpoint.location.path);
  const reviewFiles = [...reachedFiles].sort(compareStrings);
  const hasSelection = Object.keys(context.selection).length > 0;
  return {
    format: 'isthmus-preflight', version: 1, project: context.project, revision: context.revision,
    scope: 'cross-language-impact', complete: false,
    status: !hasSelection ? 'noChanges' : roots.size === 0 ? 'unobserved' : 'observed',
    selection: context.selection, roots: rootSubjects, affected,
    boundaries: relevant.sort((a, b) => compareStrings(a.subject.key, b.subject.key)).map((route) => ({
      subject: route.subject, relationship: depths.has(route.subject.key) ? 'consumer' : 'dependency', callers: route.callers, receivers: route.receivers,
    })), reviewFiles, issues, limitations: uniqueLimits, bridgeLimitations: joined.limitations,
    ...(context.messages === undefined ? {} : { messageLimitations: messages.limitations }),
    producers: analyses.map(({ id, platform, tool, truncated }) => ({ analysis: id, platform, tool, truncated })),
    summary: { selectedSymbols: roots.size, affectedSymbols: affected.filter(({ subject }) => subject.kind === 'symbol').length,
      bridgeBoundaries: affected.filter(({ subject }) => subject.kind === 'bridge').length, reviewFiles: reviewFiles.length,
      errors: issues.filter(({ severity }) => severity === 'error').length,
      warnings: issues.filter(({ severity }) => severity === 'warning').length, evidenceGaps: uniqueLimits.length },
  };
}

/** 관찰된 영향과 "영향 없음"의 보증을 구분하며 관련 공백은 CI 검토를 요구한다. */
export function hasPreflightBlockers(report: PreflightReport): boolean {
  return report.status === 'unobserved' || report.summary.errors > 0 || report.summary.evidenceGaps > 0;
}

/** 언어 ID를 다른 언어의 같은 문자열과 혼동하지 않는 키다. */
function symbolKey(platform: Language, id: string): string { return JSON.stringify([platform, id]); }

/** 호출 위치와 선언 위치의 의미를 바꾸지 않고 정확한 fact binding만 찾는다. */
function locationKey(platform: string, location: { path: string; line?: number; column?: number }): string {
  return JSON.stringify([platform, location.path, location.line, location.column]);
}
