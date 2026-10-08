import { traversalGraphFromDocument, type LanguageTraversal, type TraversalEvidence } from '../exchange/language-traversal.ts';
import type { NavigationFactsDocument, ScreenRouteFact } from '../exchange/navigation.ts';
import type { BridgeFactsDocument, BridgeLocation, BridgeSymbol } from '../exchange/parse.ts';
import { joinBridgeDocuments, type JoinLimitation } from '../join/join.ts';
import { uniqueByCanonicalJson } from './sorted-json.ts';
import { createHttpMatches, type HttpMatch } from './pairs.ts';

/** 근거를 신고하지 않은 이전 순회는 직접 호출로 승격하지 않는다. */
type NavigationEvidence = TraversalEvidence | 'unknown';

/** 화면→호출 심볼→실제 HTTP 조인 경로의 독립 보고서다. */
export interface NavigationTraceReport {
  readonly format: 'navigation-trace'; readonly version: 1; readonly project: string;
  readonly chains: readonly NavigationChain[];
  readonly gaps: readonly { readonly code: string; readonly screen?: string }[];
  readonly limitations: readonly string[];
  readonly httpLimitations: readonly JoinLimitation[];
}
/** URL은 navigation namespace이며 backend method/template로 합성하지 않는다. */
export interface NavigationChain {
  readonly urlTemplate: string; readonly screen: NonNullable<ScreenRouteFact['screen']>;
  readonly location: BridgeLocation;
  readonly calls: readonly { readonly symbol?: BridgeSymbol; readonly location?: BridgeLocation;
    readonly depth: number; readonly evidence: NavigationEvidence; readonly route?: HttpMatch['uses'][number]['route']; readonly routes: readonly HttpMatch[] }[];
}
/** 서로 다른 project·방향·과대한 입력을 부분 정상 결과로 합치지 않는다. */
export class NavigationTraceInputError extends Error {
  constructor(message: string) { super(message); this.name = 'NavigationTraceInputError'; }
}

/** 검증된 입력에서 같은 root의 정방향 도달과 HTTP 조인만 사용한다. */
export function createNavigationTrace(navigation: NavigationFactsDocument, documents: readonly BridgeFactsDocument[],
  analyses: readonly LanguageTraversal[]): NavigationTraceReport {
  if (documents.some((doc) => doc.project !== navigation.project) || analyses.some((doc) =>
    doc.project !== navigation.project || doc.platform !== 'js' || doc.direction !== 'dependencies')) {
    throw new NavigationTraceInputError('Navigation trace requires one project and JS forward analyses.');
  }
  if (analyses.length > 256) throw new NavigationTraceInputError('Navigation trace exceeds its analysis limit.');
  const joined = joinBridgeDocuments(documents, { composition: 'trace' });
  const matches = createHttpMatches(joined);
  let work = 0;
  const charge = (): void => {
    if (++work > 1_000_000) throw new NavigationTraceInputError('Navigation linking exceeds its work limit; narrow screen or analysis inputs.');
  };
  const byCall = new Map<string, { endpoint: HttpMatch['uses'][number]; routes: HttpMatch[] }>();
  for (const match of matches) for (const endpoint of match.uses) {
    if (endpoint.platform !== 'js' || endpoint.route?.kind !== 'route-call' || endpoint.symbol?.usr === undefined) continue;
    const key = callKey(endpoint);
    const value = byCall.get(key) ?? { endpoint, routes: [] };
    value.routes.push(match); byCall.set(key, value);
  }
  let missingCallSymbols = 0;
  for (const document of documents) {
    if (document.platform !== 'js' || document.target !== 'http') continue;
    for (const fact of document.facts) {
      if (fact.kind !== 'route-call') continue;
      if (fact.symbol?.usr === undefined) { missingCallSymbols++; continue; }
      const endpoint: HttpMatch['uses'][number] = { platform: 'js', symbol: fact.symbol,
        ...(fact.location === undefined ? {} : { location: fact.location }),
        route: { kind: 'route-call', ...(fact.method === undefined ? {} : { method: fact.method }),
          ...(fact.channel === null ? {} : { template: fact.channel }), pathAnchor: fact.pathAnchor ?? 'root',
          ...(fact.testSource === true ? { testSource: true } : {}) } };
      const key = callKey(endpoint);
      if (!byCall.has(key)) byCall.set(key, { endpoint, routes: [] });
    }
  }
  const gaps: { code: string; screen?: string }[] = [];
  if (navigation.limitations.length > 0) gaps.push({ code: 'navigation-analysis-limitations' });
  if (joined.limitations.length > 0) gaps.push({ code: 'http-analysis-limitations' });
  if (missingCallSymbols > 0) gaps.push({ code: 'http-call-symbol-missing' });
  const chains: NavigationChain[] = [];
  let emitted = 0;
  for (const fact of navigation.facts) {
    if (fact.dynamic || fact.urlTemplate === null || fact.screen === undefined) { gaps.push({ code: 'screen-route-dynamic', ...(fact.screen === undefined ? {} : { screen: fact.screen.usr }) }); continue; }
    const reached = new Map<string, { depth: number; evidence: NavigationEvidence }>([[fact.screen.usr, { depth: 0, evidence: 'direct' }]]);
    let found = false;
    for (const analysis of analyses) {
      const roots = analysis.roots.flatMap((root, index) => { charge(); return root.symbol?.usr === fact.screen!.usr ? [index] : []; });
      if (roots.length === 0) continue;
      found = true;
      if (analysis.truncated) gaps.push({ code: 'screen-analysis-truncated', screen: fact.screen.usr });
      if (analysis.rootsTruncated) gaps.push({ code: 'screen-analysis-roots-truncated', screen: fact.screen.usr });
      const certainty = traversalGraphFromDocument(analysis);
      const graded = certainty.evidenceReported;
      if (!graded) gaps.push({ code: 'screen-analysis-evidence-unreported', screen: fact.screen.usr });
      if (!certainty.unresolvedCallsReported) gaps.push({ code: 'screen-unresolved-calls-unreported', screen: fact.screen.usr });
      if (roots.some((root) => (analysis.roots[root]?.unresolvedCalls ?? 0) > 0)) gaps.push({ code: 'screen-unresolved-calls', screen: fact.screen.usr });
      for (const row of analysis.reached) {
        charge();
        if (!roots.some((root) => row.roots.includes(root))) continue;
        const evidence = row.evidence ?? (graded ? 'direct' : 'unknown');
        if ((row.unresolvedCalls ?? 0) > 0) gaps.push({ code: 'screen-unresolved-calls', screen: fact.screen.usr });
        const previous = reached.get(row.symbol.usr);
        if (previous === undefined || strength(evidence) < strength(previous.evidence) ||
            (evidence === previous.evidence && row.depth < previous.depth)) reached.set(row.symbol.usr, { depth: row.depth, evidence });
      }
    }
    if (!found) gaps.push({ code: 'screen-analysis-missing', screen: fact.screen.usr });
    const calls: NavigationChain['calls'][number][] = [];
    for (const { endpoint, routes } of byCall.values()) {
      charge();
      const via = reached.get(endpoint.symbol!.usr!);
      if (via === undefined) continue;
      if (routes.length === 0) gaps.push({ code: 'screen-call-unjoined', screen: fact.screen.usr });
      if (++emitted > 100_000) throw new NavigationTraceInputError('Navigation trace exceeds its call-row limit.');
      calls.push({ ...via, ...(endpoint.symbol === undefined ? {} : { symbol: endpoint.symbol }),
        ...(endpoint.location === undefined ? {} : { location: endpoint.location }),
        ...(endpoint.route === undefined ? {} : { route: endpoint.route }),
        routes: uniqueByCanonicalJson(routes.map((route) => ({ ...route, uses: [endpoint] }))) });
    }
    chains.push({ urlTemplate: fact.urlTemplate, screen: fact.screen, location: fact.location, calls: uniqueByCanonicalJson(calls) });
  }

  return { format: 'navigation-trace', version: 1, project: navigation.project, chains: uniqueByCanonicalJson(chains), gaps: uniqueByCanonicalJson(gaps),
    httpLimitations: uniqueByCanonicalJson(joined.limitations),
    limitations: uniqueByCanonicalJson([...(missingCallSymbols === 0 ? [] : [`navigation-http-caller-coverage: ${missingCallSymbols} HTTP call(s) have no caller symbol; screen reach cannot assess them`]), ...navigation.limitations, ...analyses.flatMap((item) => item.limitations),
      'navigation-freshness-unmeasured: navigation mappings and analysis source freshness are not attested by this report']) };
}

/** 실제로 관찰된 근거만 결정적으로 고른다. */
function strength(evidence: NavigationEvidence): number {
  return ['direct', 'bound', 'candidate', 'unknown'].indexOf(evidence);
}

/** 추가 선택 필드가 같은 발생의 source identity를 갈라 중복 gap을 만들지 않는다. */
function callKey(endpoint: HttpMatch['uses'][number]): string {
  return JSON.stringify([endpoint.symbol?.usr, endpoint.location, endpoint.route?.kind,
    endpoint.route?.method, endpoint.route?.template, endpoint.route?.pathAnchor]);
}
