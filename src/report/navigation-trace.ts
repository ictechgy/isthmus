import { createHash } from 'node:crypto';
import { compareStrings } from '../compare.ts';
import { traversalWitness, traversalGraphFromDocument, type LanguageTraversal, type TraversalEvidence, type TraversalGraph,
  type TraversalReached } from '../exchange/language-traversal.ts';
import type { NavigationFactsDocument, ScreenRouteFact } from '../exchange/navigation.ts';
import type { BridgeFactsDocument, BridgeLocation, BridgeSymbol } from '../exchange/parse.ts';
import { isBridgeJoinDeferred, joinBridgeDocuments, type JoinLimitation } from '../join/join.ts';
import { canonicalJsonKey, uniqueByCanonicalJson } from './sorted-json.ts';
import { createHttpMatches, type HttpMatch } from './pairs.ts';

/** 근거를 신고하지 않은 이전 순회는 직접 호출로 승격하지 않는다. */
type NavigationEvidence = TraversalEvidence | 'unknown';

/** 화면→호출 심볼→실제 HTTP 조인 경로의 독립 보고서다. */
export interface NavigationTraceReport {
  readonly format: 'navigation-trace'; readonly version: 1; readonly project: string;
  readonly chains: readonly NavigationChain[];
  readonly analyses: readonly NavigationAnalysis[];
  readonly gaps: readonly { readonly code: string; readonly screen?: string }[];
  readonly limitations: readonly string[];
  readonly httpLimitations: readonly JoinLimitation[];
}
/** 선택된 순회 관찰의 출처다. 같은 revision 문자열만으로 현재 소스와의 일치를 증명하지 않는다. */
export type NavigationAnalysis = Pick<LanguageTraversal, 'tool' | 'generatedAt' | 'revision' | 'graphRevision'
  | 'dispatch' | 'truncated' | 'rootsTruncated' | 'truncationReasons' | 'limitations' | 'roots'> & { readonly id: string };

/** depth는 이 목격 경로의 root 기준이며 선택한 화면까지의 최단 거리라고 추정하지 않는다. */
export interface NavigationWitness {
  readonly depth: number;
  readonly evidence: NavigationEvidence;
  readonly path: readonly string[];
  readonly witnessRoot?: string;
  readonly witnessPartial?: true;
  readonly analysis?: string;
}

/** URL은 navigation namespace이며 backend method/template로 합성하지 않는다. */
export interface NavigationChain {
  readonly urlTemplate: string; readonly screen: NonNullable<ScreenRouteFact['screen']>;
  readonly location: BridgeLocation;
  readonly calls: readonly { readonly symbol?: BridgeSymbol; readonly location?: BridgeLocation;
    readonly depth: number; readonly evidence: NavigationEvidence; readonly path: readonly string[];
    readonly witnessRoot?: string; readonly witnessPartial?: true; readonly witnesses: readonly NavigationWitness[]; readonly route?: HttpMatch['uses'][number]['route']; readonly routes: readonly HttpMatch[] }[];
}
/** 새 목격 목록과 대표 경로가 반복해서 확장될 수 있는 직렬화 문자 총상한이다. */
export const MAX_NAVIGATION_WITNESS_CHARACTERS = 8 * 1024 * 1024;

/** 서로 다른 project·방향·과대한 입력을 부분 정상 결과로 합치지 않는다. */
export class NavigationTraceInputError extends Error {
  constructor(message: string) { super(message); this.name = 'NavigationTraceInputError'; }
}

/** 같은 발생으로 합친 JS HTTP 호출 하나와 그 호출이 닿는 backend 매치다. */
interface RecordedCall { endpoint: HttpMatch['uses'][number]; routes: HttpMatch[] }

/** 한 분석에서 화면 usr 하나가 root로 잇는 범위다. */
interface ScreenReach {
  readonly analysis: LanguageTraversal;
  /** 같은 분석의 화면들이 공유하는 순회 숲이다. 같은 객체여야 usr별 행 색인을 분석마다 한 번만 만든다. */
  readonly graph: TraversalGraph;
  /** 그 화면 usr을 symbol로 가진 root 인덱스다(원래 순서). */
  readonly roots: number[];
  /** 그 root 중 하나에서 닿은 행이다(원래 순서, 행마다 한 번). */
  readonly rows: TraversalReached[];
}

/** 검증된 입력에서 같은 root의 정방향 도달과 HTTP 조인만 사용한다. */
export function createNavigationTrace(navigation: NavigationFactsDocument, documents: readonly BridgeFactsDocument[],
  analyses: readonly LanguageTraversal[]): NavigationTraceReport {
  if (documents.some((doc) => doc.project !== navigation.project) || analyses.some((doc) =>
    doc.project !== navigation.project || doc.platform !== 'js' || doc.direction !== 'dependencies')) {
    throw new NavigationTraceInputError('Navigation trace requires one project and JS forward analyses.');
  }
  if (analyses.length > 256) throw new NavigationTraceInputError('Navigation trace exceeds its analysis limit.');
  const provenance = new Map(analyses.map((analysis) => [analysis, analysisProvenance(analysis)]));
  const joined = joinBridgeDocuments(documents, { composition: 'trace' });
  // mixed-targets 보류를 빈 결과나 쌍 생성기의 미분류 예외로 흘리지 않고 trace와 같은 입력 오류로 거부한다.
  if (isBridgeJoinDeferred(joined)) {
    throw new NavigationTraceInputError('Navigation trace cannot use documents with mixed bridge targets; split them by target.');
  }
  const matches = createHttpMatches(joined);
  let work = 0;
  const charge = (): void => {
    if (++work > 1_000_000) throw new NavigationTraceInputError('Navigation linking exceeds its work limit; narrow screen or analysis inputs.');
  };
  const byCall = new Map<string, RecordedCall>();
  const recordCall = (endpoint: HttpMatch['uses'][number], routes: readonly HttpMatch[] = []): void => {
    const key = callKey(endpoint);
    const value = byCall.get(key);
    if (value === undefined) { byCall.set(key, { endpoint, routes: [...routes] }); return; }
    const preferred = uniqueByCanonicalJson([withoutTestSource(value.endpoint), withoutTestSource(endpoint)])[0]!;
    const testSource = value.endpoint.route?.testSource === true || endpoint.route?.testSource === true;
    value.endpoint = testSource ? { ...preferred, route: { ...preferred.route!, testSource: true } } : preferred;
    value.routes.push(...routes);
  };
  for (const match of matches) for (const endpoint of match.uses) {
    if (endpoint.platform !== 'js' || endpoint.route?.kind !== 'route-call' || endpoint.symbol?.usr === undefined) continue;
    recordCall(endpoint, [match]);
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
      recordCall(endpoint);
    }
  }
  // 화면마다 분석·호출 전체를 다시 훑지 않게 한 번만 색인한다. 예산은 화면이 실제로 잇는 작업에만 쓴다.
  const reaches = screenReaches(navigation, analyses);
  const callsByUsr = new Map<string, RecordedCall[]>();
  for (const call of byCall.values()) appendTo(callsByUsr, call.endpoint.symbol!.usr!, call);
  const gaps: { code: string; screen?: string }[] = [];
  if (navigation.limitations.length > 0) gaps.push({ code: 'navigation-analysis-limitations' });
  if (joined.limitations.length > 0) gaps.push({ code: 'http-analysis-limitations' });
  if (missingCallSymbols > 0) gaps.push({ code: 'http-call-symbol-missing' });
  const chains: NavigationChain[] = [];
  let emitted = 0;
  let witnessCharacters = 0;
  for (const fact of navigation.facts) {
    if (fact.dynamic || fact.urlTemplate === null || fact.screen === undefined) { gaps.push({ code: 'screen-route-dynamic', ...(fact.screen === undefined ? {} : { screen: fact.screen.usr }) }); continue; }
    const reached = new Map<string, NavigationWitness[]>([[fact.screen.usr, [{ depth: 0, evidence: 'direct', path: [fact.screen.usr] }]]]);
    const selectedAnalyses: LanguageTraversal[] = [];
    let found = false;
    for (const { analysis, graph: certainty, roots, rows } of reaches.get(fact.screen.usr) ?? []) {
      for (const _ of roots) charge();
      found = true;
      selectedAnalyses.push(analysis);
      if (analysis.limitations.length > 0) gaps.push({ code: 'screen-analysis-limitations', screen: fact.screen.usr });
      if (analysis.truncated) gaps.push({ code: 'screen-analysis-truncated', screen: fact.screen.usr });
      if (analysis.rootsTruncated) gaps.push({ code: 'screen-analysis-roots-truncated', screen: fact.screen.usr });
      const graded = certainty.evidenceReported;
      if (!graded) gaps.push({ code: 'screen-analysis-evidence-unreported', screen: fact.screen.usr });
      if (!certainty.unresolvedCallsReported) gaps.push({ code: 'screen-unresolved-calls-unreported', screen: fact.screen.usr });
      if (roots.some((root) => (analysis.roots[root]?.unresolvedCalls ?? 0) > 0)) gaps.push({ code: 'screen-unresolved-calls', screen: fact.screen.usr });
      const analysisId = provenance.get(analysis)!.id;
      for (const row of rows) {
        charge();
        const evidence = row.evidence ?? (graded ? 'direct' : 'unknown');
        if ((row.unresolvedCalls ?? 0) > 0) gaps.push({ code: 'screen-unresolved-calls', screen: fact.screen.usr });
        if (evidence === 'candidate') gaps.push({ code: 'screen-candidate-dispatch', screen: fact.screen.usr });
        const witness = traversalWitness(certainty, row.symbol.usr);
        // path 구성도 link-work 예산에 넣어 많은 긴 목격의 곱을 제한한다.
        for (const _ of witness.path) charge();
        const witnessRoot = !witness.partial && witness.path[0] !== fact.screen.usr ? witness.path[0] : undefined;
        if (witnessRoot !== undefined) gaps.push({ code: 'screen-witness-other-root', screen: fact.screen.usr });
        if (witness.partial) gaps.push({ code: 'screen-witness-partial', screen: fact.screen.usr });
        const observation: NavigationWitness = { depth: row.depth, evidence, path: witness.path, analysis: analysisId,
          ...(witnessRoot === undefined ? {} : { witnessRoot }), ...(witness.partial ? { witnessPartial: true } : {}) };
        const previous = reached.get(row.symbol.usr);
        if (previous === undefined) reached.set(row.symbol.usr, [observation]);
        else previous.push(observation);
      }
    }
    const revisions = new Set(selectedAnalyses.flatMap(({ revision }) => revision === undefined ? [] : [revision]));
    const graphs = new Set(selectedAnalyses.flatMap(({ graphRevision }) => graphRevision === undefined ? [] : [graphRevision]));
    if (revisions.size > 1) gaps.push({ code: 'screen-analysis-revision-conflict', screen: fact.screen.usr });
    if (graphs.size > 1) gaps.push({ code: 'screen-analysis-graph-revision-conflict', screen: fact.screen.usr });
    if (selectedAnalyses.some(({ revision }) => revision === undefined)) gaps.push({ code: 'screen-analysis-revision-unknown', screen: fact.screen.usr });
    if (graphs.size > 0 && selectedAnalyses.some(({ graphRevision }) => graphRevision === undefined)) {
      gaps.push({ code: 'screen-analysis-graph-revision-unknown', screen: fact.screen.usr });
    }
    if (!found) gaps.push({ code: 'screen-analysis-missing', screen: fact.screen.usr });
    const calls: NavigationChain['calls'][number][] = [];
    // 호출은 화면이 닿은 심볼로만 찾는다. 출력은 아래에서 정렬하므로 처리 순서는 바이트에 영향이 없다.
    for (const [usr, observations] of reached) for (const { endpoint, routes } of callsByUsr.get(usr) ?? []) {
      charge();
      // 거대한 목록으로 합치기 전에 각 관찰을 제한하고 중복 제거한다.
      const distinct = new Map<string, NavigationWitness>();
      for (const observation of observations) {
        const key = canonicalJsonKey(observation);
        if (distinct.has(key)) continue;
        witnessCharacters += key.length;
        if (witnessCharacters > MAX_NAVIGATION_WITNESS_CHARACTERS) throw new NavigationTraceInputError('Navigation witness output exceeds its text limit; narrow screen or analysis inputs.');
        distinct.set(key, observation);
      }
      const witnesses = [...distinct.entries()].sort(([left], [right]) => compareStrings(left, right)).map(([, witness]) => witness);
      // 기존 대표 필드는 유지하되 모든 출처·불확실성을 별도 목록에 보존한다.
      const preferred = [...witnesses].sort((left, right) => strength(left.evidence) - strength(right.evidence)
        || witnessRank(left) - witnessRank(right) || left.depth - right.depth || compareStrings(canonicalJsonKey(left), canonicalJsonKey(right)))[0]!;
      const { analysis: _, ...via } = preferred;
      witnessCharacters += canonicalJsonKey(via).length;
      if (witnessCharacters > MAX_NAVIGATION_WITNESS_CHARACTERS) throw new NavigationTraceInputError('Navigation witness output exceeds its text limit; narrow screen or analysis inputs.');
      if (routes.length === 0) gaps.push({ code: 'screen-call-unjoined', screen: fact.screen.usr });
      if (++emitted > 100_000) throw new NavigationTraceInputError('Navigation trace exceeds its call-row limit.');
      calls.push({ ...via, witnesses, ...(endpoint.symbol === undefined ? {} : { symbol: endpoint.symbol }),
        ...(endpoint.location === undefined ? {} : { location: endpoint.location }),
        ...(endpoint.route === undefined ? {} : { route: endpoint.route }),
        routes: uniqueByCanonicalJson(routes.map((route) => ({ ...route, uses: [endpoint] }))) });
    }
    chains.push({ urlTemplate: fact.urlTemplate, screen: fact.screen, location: fact.location, calls: uniqueByCanonicalJson(calls) });
  }

  return { format: 'navigation-trace', version: 1, project: navigation.project, chains: uniqueByCanonicalJson(chains), gaps: uniqueByCanonicalJson(gaps),
    analyses: uniqueByCanonicalJson([...provenance.values()]),
    httpLimitations: uniqueByCanonicalJson(joined.limitations),
    limitations: uniqueByCanonicalJson([...(missingCallSymbols === 0 ? [] : [`navigation-http-caller-coverage: ${missingCallSymbols} HTTP call(s) have no caller symbol; screen reach cannot assess them`]), ...navigation.limitations, ...analyses.flatMap((item) => item.limitations),
      'navigation-freshness-unmeasured: navigation mappings and analysis source freshness are not attested by this report']) };
}

/**
 * 화면 usr마다 그 화면을 root로 가진 분석(입력 순서)과 그 root에서 닿은 행을 한 번에 모은다.
 *
 * 화면마다 모든 분석의 root·행과 모든 호출을 다시 훑으면 1,000,000 link-work 예산이 연결이 아니라 스캔에 쓰여,
 * 문서대로 화면 수십 개를 root로 넣은 분석 하나도 거부된다. 색인 비용은 입력 크기에 비례하고, 분석·행 순서를
 * 그대로 지키므로 화면마다 처리하는 관찰과 출력은 같다.
 */
function screenReaches(navigation: NavigationFactsDocument, analyses: readonly LanguageTraversal[]): Map<string, ScreenReach[]> {
  const screens = new Set(navigation.facts.flatMap(({ screen }) => screen === undefined ? [] : [screen.usr]));
  const reaches = new Map<string, ScreenReach[]>();
  for (const analysis of analyses) {
    for (const [usr, reach] of analysisScreenReaches(analysis, screens)) appendTo(reaches, usr, reach);
  }
  return reaches;
}

/** 분석 하나의 화면 usr별 root와 닿은 행이다. 화면 root가 없는 분석은 그래프와 행 목록을 만들지 않는다. */
function analysisScreenReaches(analysis: LanguageTraversal, screens: ReadonlySet<string>): Map<string, ScreenReach> {
  const own = new Map<string, ScreenReach>();
  let graph: TraversalGraph | undefined;
  for (const [index, root] of analysis.roots.entries()) {
    const usr = root.symbol?.usr;
    if (usr === undefined || !screens.has(usr)) continue;
    graph ??= traversalGraphFromDocument(analysis);
    const reach = own.get(usr);
    if (reach === undefined) own.set(usr, { analysis, graph, roots: [index], rows: [] });
    else reach.roots.push(index);
  }
  if (own.size === 0) return own;
  for (const row of analysis.reached) for (const root of row.roots) {
    const usr = analysis.roots[root]?.symbol?.usr;
    const reach = usr === undefined ? undefined : own.get(usr);
    // 같은 화면 usr의 root 여럿이 같은 행에 닿아도 한 번만 싣는다(화면 root 중 하나라도 닿으면 싣는 판정과 같다).
    if (reach !== undefined && reach.rows[reach.rows.length - 1] !== row) reach.rows.push(row);
  }
  return own;
}

/** 키의 목록 끝에 값을 더한다(추가 순서 유지). */
function appendTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else list.push(value);
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

/** 합성한 OR flag가 다음 대표 선택의 정렬 순서를 바꾸지 않게 분리한다. */
function withoutTestSource(endpoint: HttpMatch['uses'][number]): HttpMatch['uses'][number] {
  if (endpoint.route?.testSource !== true) return endpoint;
  const { testSource: _, ...route } = endpoint.route;
  return { ...endpoint, route };
}

/** 파일명이나 입력 순번을 출처로 추정하지 않고 생산자가 신고한 메타데이터만 보존한다. */
function analysisProvenance(analysis: LanguageTraversal): NavigationAnalysis {
  const { tool, generatedAt, revision, graphRevision, dispatch, truncated, rootsTruncated, truncationReasons, limitations, roots } = analysis;
  const id = `sha256:${createHash('sha256').update(canonicalJsonKey(analysis)).digest('hex')}`;
  return { id, tool, generatedAt, truncated, limitations, roots,
    ...(revision === undefined ? {} : { revision }), ...(graphRevision === undefined ? {} : { graphRevision }),
    ...(dispatch === undefined ? {} : { dispatch }), ...(rootsTruncated === undefined ? {} : { rootsTruncated }),
    ...(truncationReasons === undefined ? {} : { truncationReasons }) };
}

/** 같은 등급이면 화면에서 시작하는 완전한 목격을 다른 root·부분 목격보다 먼저 고른다. */
function witnessRank(witness: NavigationWitness): number {
  return witness.witnessPartial === true ? 2 : witness.witnessRoot === undefined ? 0 : 1;
}
