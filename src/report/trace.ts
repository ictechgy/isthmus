import { compareStrings } from '../compare.ts';
import type { BridgeFact, BridgeFactsDocument, BridgePlatform } from '../exchange/parse.ts';
import { isBridgeDomainDocument } from '../exchange/parse.ts';
import {
  MAX_ROOTS_PER_REACHED,
  traversalWitness,
  type TraversalLocation,
  type TraversalPlatform,
  type TraversalReached,
} from '../exchange/language-traversal.ts';
import type {
  TraceAnalysis,
  TraceAnalysisRole,
  TraceContext,
  TraceRouteSelection,
  TraceSelection,
  TraceSymbolSelection,
} from '../exchange/trace-context.ts';
import type { RouteMethod } from '../exchange/route-template.ts';
import {
  compareEndpoints,
  createRelationResolver,
  isBridgeJoinDeferred,
  joinBridgeDocuments,
  relationDeclKey,
  type BridgeEndpoint,
  type BridgeJoinResult,
  type JoinLimitation,
  type RelationResolver,
} from '../join/join.ts';
import type { RouteDeclarationFact, RouteScope } from '../join/route-join.ts';
import type { RouteMatchQuality } from '../join/route-index.ts';
import { createPersistenceMatches, toPairEndpoint, type PairEndpoint, type PersistenceMatch } from './pairs.ts';
import { encodeSortedJson } from './sorted-json.ts';

/**
 * `isthmus trace` 보고서 — route 단위 영향 후보를 생산자 id 정확 일치로만 잇는다.
 *
 * 한 project의 bridge-facts(http·persistence)와 생산자 순회 숲을 받아 두 방향을 잇는다.
 *
 * - route 선택: route-decl → 핸들러 usr → 정방향 순회 → relation-use → persistence 조인 →
 *   relation-decl VertexId → schemagraph 의존자, 그리고 route → 귀속된 route-call → 클라이언트
 *   역방향 순회.
 * - relation·심볼 선택: relation-use(또는 심볼) → 역방향 순회 → route-decl 핸들러 → route → 클라이언트.
 *
 * 결과는 항상 `complete: false`다. 끊긴 곳은 gap으로만 보고하고 "닿지 않는다"를 주장하지 않는다.
 * 출력의 모든 id는 생산자가 준 문자열이며, 귀속되지 않은 호출의 경로·host는 싣지 않는다.
 */

/** trace 입력 묶음이다. CLI가 경로를 읽어 검증한 뒤 넘긴다. */
export interface TraceInput {
  readonly context: TraceContext;
  readonly documents: readonly BridgeFactsDocument[];
  readonly analyses: readonly TraceAnalysis[];
}

/** 체인의 시작 선택 하나다. */
export type TraceSelector =
  | { readonly route: TraceRouteSelection }
  | { readonly relation: string }
  | { readonly symbol: TraceSymbolSelection };

/** route 키다. scope는 check 진단 신원과 같은 규칙(service 또는 `default`)이다. */
export interface TraceRouteKey {
  readonly scope: string;
  readonly method: RouteMethod;
  readonly template: string;
}

/** 순회가 닿은 정점이다. `path`는 생산자 via 목격을 따른 root부터 이 정점까지의 id다. */
export interface TraceAffected {
  readonly platform: TraversalPlatform;
  readonly usr: string;
  readonly qualifiedName?: string;
  readonly kind?: string;
  readonly location?: TraversalLocation;
  readonly relationships?: readonly string[];
  readonly analysis: string;
  readonly depth: number;
  readonly path: readonly string[];
  /** 목격 경로가 이 hop의 시작 root가 아닌 다른 root에서 시작하면 그 root id다. */
  readonly witnessRoot?: string;
  /** root 항목의 목격이 그 root 자신으로 돌아와 경로 앞부분을 알 수 없다(`witness-partial` gap). */
  readonly witnessPartial?: true;
}

/**
 * 체인 시작점(`from`)에서 이 정점까지의 도달 근거다. 시작점 자체면 depth 0이고 analysis가 없다.
 * `witnessRoot`가 있으면 depth·path는 생산자가 목격한 다른 root 기준이다.
 */
export interface TraceReach {
  readonly from: string;
  readonly analysis?: string;
  readonly depth: number;
  readonly path: readonly string[];
  readonly witnessRoot?: string;
  readonly witnessPartial?: true;
}

/** route에 match된 귀속 호출 하나와 그 호출을 감싼 심볼의 클라이언트 영향이다. */
export interface TraceCallHop {
  readonly call: PairEndpoint;
  readonly side: 'decl' | 'contract';
  readonly quality: RouteMatchQuality;
  readonly affected: readonly TraceAffected[];
}

/** route 하나의 선언 측 증거와 클라이언트 hop이다. */
export interface TraceRouteHop extends TraceRouteKey {
  readonly declarations: readonly PairEndpoint[];
  readonly contracts: readonly PairEndpoint[];
  readonly calls: readonly TraceCallHop[];
}

/** route-decl 핸들러다. 역방향 선택이면 시작점에서의 도달 근거가 실린다. */
export interface TraceHandlerHop {
  readonly platform: BridgePlatform;
  readonly usr: string;
  readonly qualifiedName?: string;
  readonly routes: readonly TraceRouteKey[];
  readonly reachedFrom: readonly TraceReach[];
}

/** relation-use 사실 하나와 persistence 조인이 해석한 선언이다. */
export interface TraceRelationUseHop {
  readonly use: PairEndpoint;
  readonly relation: string;
  readonly column?: string;
  /** 조인이 해석한 선언 측 관계(와 컬럼)다. 해석하지 못하면 없고 gap이 실린다. */
  readonly resolved?: Readonly<{ relation: string; column?: string }>;
  readonly decls: readonly PairEndpoint[];
  /** route 선택에서 핸들러부터의 정방향 도달 근거다. */
  readonly reachedFrom: readonly TraceReach[];
}

/** relation-decl VertexId 하나와 schemagraph 의존자다. */
export interface TraceDatabaseHop {
  readonly vertex: string;
  readonly dependents: readonly TraceAffected[];
}

/** 선택 하나의 체인이다. */
export interface TraceChain {
  readonly selector: TraceSelector;
  readonly routes: readonly TraceRouteHop[];
  readonly handlers: readonly TraceHandlerHop[];
  readonly relationUses: readonly TraceRelationUseHop[];
  readonly database: readonly TraceDatabaseHop[];
}

/** 체인이 끊긴 곳이다. 없음의 증거가 아니라 확인하지 못한 공백이다. */
export interface TraceGap {
  readonly code: string;
  readonly detail: string;
  readonly selector?: TraceSelector;
  readonly route?: TraceRouteKey;
  readonly symbol?: Readonly<{ platform: string; usr: string }>;
  readonly analysis?: string;
  readonly evidence?: PairEndpoint;
}

/** 입력 분석의 출처 메타데이터다. */
export interface TraceAnalysisSummary {
  readonly id: string;
  readonly platform: TraversalPlatform;
  readonly role: TraceAnalysisRole;
  readonly source: string;
  readonly direction: string;
  readonly tool?: Readonly<{ name: string; version: string }>;
  readonly revision?: string;
  readonly graphRevision?: string;
  readonly truncated: boolean;
  readonly rootsTruncated: boolean;
  readonly rootProvenance: 'complete' | 'witness';
  readonly roots: number;
  readonly reached: number;
}

/** `isthmus-trace` v1 보고서다. */
export interface TraceReport {
  readonly format: 'isthmus-trace';
  readonly version: 1;
  readonly project: string;
  readonly revision?: string;
  readonly complete: false;
  readonly scope: Readonly<{ granularity: 'route'; fieldCompatibility: 'not-assessed'; queryAndHeaders: 'not-assessed' }>;
  readonly selection: TraceSelection;
  readonly chains: readonly TraceChain[];
  readonly gaps: readonly TraceGap[];
  readonly limitations: readonly JoinLimitation[];
  readonly analysisLimitations: ReadonlyArray<Readonly<{ analysis: string; message: string }>>;
  readonly analyses: readonly TraceAnalysisSummary[];
  readonly summary: Readonly<{
    chains: number; routes: number; handlers: number; relationUses: number; databaseVertices: number;
    databaseDependents: number; calls: number; clientSymbols: number; gaps: number;
  }>;
}

/** trace 입력 묶음이 계약을 어겼음을 나타낸다(project 불일치, bridge 문서, 출력 상한 등). */
export class TraceInputError extends Error {
  /** 입력 내용을 노출하지 않는 고정 문구만 보존한다. */
  constructor(message: string) {
    super(message);
    this.name = 'TraceInputError';
  }
}

/** 보고서가 실을 수 있는 hop·정점·gap 총상한이다. 넘으면 부분 결과 대신 실패한다. */
export const MAX_TRACE_OUTPUT_ITEMS = 1_000_000;

/** trace 보고서를 만든다. 같은 입력이면 항상 같은 바이트로 직렬화된다. */
export function createTraceReport(input: TraceInput): TraceReport {
  validateTraceDocuments(input);
  const joined = joinBridgeDocuments(input.documents, { composition: 'trace' });
  if (isBridgeJoinDeferred(joined)) {
    throw new TraceInputError('Trace cannot use documents with mixed bridge targets; split them by target.');
  }
  const builder = new TraceBuilder(input, joined);
  const chains = builder.buildChains();
  const gaps = builder.finishGaps();
  const analyses = [...input.analyses].sort((left, right) => compareStrings(left.id, right.id));
  return {
    format: 'isthmus-trace', version: 1, project: input.context.project,
    ...(input.context.revision === undefined ? {} : { revision: input.context.revision }),
    complete: false,
    scope: { granularity: 'route', fieldCompatibility: 'not-assessed', queryAndHeaders: 'not-assessed' },
    selection: input.context.selection,
    chains, gaps, limitations: joined.limitations,
    analysisLimitations: analyses.flatMap(({ id, graph }) => graph.limitations.map((message) => ({ analysis: id, message }))),
    analyses: analyses.map(summarizeAnalysis),
    summary: summarize(chains, gaps.length),
  };
}

/** `--strict`가 실패로 볼 공백이 있는지다. trace는 완전성을 주장하지 않으므로 gap만 본다. */
export function hasTraceGaps(report: TraceReport): boolean {
  return report.gaps.length > 0;
}

/** 문서가 context project와 같고 trace가 다루는 도메인(http·persistence)인지 확인한다. */
function validateTraceDocuments(input: TraceInput): void {
  for (const document of input.documents) {
    if (document.project !== input.context.project) {
      throw new TraceInputError('Every trace document must use the trace context project; regenerate it from that project root.');
    }
    // 사실 0건 문서(target null)는 아무 경계도 싣지 않으므로 받는다. bridge target 문서만 거부한다.
    if (document.target !== null && isBridgeDomainDocument(document)) {
      throw new TraceInputError('trace reads only http and persistence documents; remove bridge-target documents from the context.');
    }
  }
}

/** 한 relation-use 사실과 조인 해석이다. */
interface UseRecord {
  readonly platform: BridgePlatform;
  readonly fact: BridgeFact;
  readonly endpoint: PairEndpoint;
  readonly usr?: string;
  readonly match?: PersistenceMatch;
  /** dynamic 사실은 조인이 잇지 않으므로 이름 해석과 무관하게 항상 `dynamic`이다. */
  readonly outcome: 'resolved' | 'missing' | 'ambiguous' | 'column-missing' | 'dynamic';
  /** 모호한 비한정 사용의 후보 선언 이름이다. */
  readonly candidates?: readonly string[];
}

/** 역방향 선택의 시작 심볼이다. */
interface StartSymbol {
  readonly platform: BridgePlatform;
  readonly usr: string;
}

/** 분석 root 적중이다. */
interface RootHit {
  readonly analysis: TraceAnalysis;
  readonly rootIndex: number;
}

/** 체인과 gap을 모으는 작업 상태다. 입력 색인을 한 번만 만든다. */
class TraceBuilder {
  private readonly gaps = new Map<string, TraceGap>();
  private readonly resolver: RelationResolver;
  private readonly uses: UseRecord[] = [];
  private readonly usesBySymbol = new Map<string, UseRecord[]>();
  private readonly relationDecls = new Map<string, PairEndpoint[]>();
  private readonly scopes: readonly RouteScope[];
  private readonly declsByHandler = new Map<string, Array<{ scope: RouteScope; fact: RouteDeclarationFact }>>();
  private readonly roots = new Map<string, RootHit[]>();
  private readonly rowsByRoot = new Map<TraceAnalysis, Map<number, TraversalReached[]>>();
  private outputItems = 0;

  private readonly input: TraceInput;
  private readonly joined: BridgeJoinResult;

  constructor(input: TraceInput, joined: BridgeJoinResult) {
    this.input = input;
    this.joined = joined;
    this.resolver = createRelationResolver(input.documents);
    this.scopes = joined.routes?.scopes ?? [];
    this.indexRelations();
    this.indexHandlers();
    this.indexAnalyses();
  }

  /** 선택 종류별로 체인을 만든다. 선택은 context 파서가 이미 정렬했다. */
  buildChains(): TraceChain[] {
    this.addRevisionGaps();
    this.addCoverageGaps();
    const selection = this.input.context.selection;
    if ('routes' in selection) return selection.routes.flatMap((route) => this.routeChain({ route }));
    if ('relations' in selection) return selection.relations.flatMap((relation) => this.relationChain({ relation }));
    return selection.symbols.map((symbol) => this.symbolChain({ symbol }));
  }

  /** gap을 결정적 순서로 돌려준다. */
  finishGaps(): TraceGap[] {
    return [...this.gaps.entries()].sort(([left], [right]) => compareStrings(left, right)).map(([, gap]) => gap);
  }

  /** route 선택 하나의 체인이다. 선언 측 키가 없으면 체인 없이 gap만 남긴다. */
  private routeChain(selector: { route: TraceRouteSelection }): TraceChain[] {
    const { method, template, scope } = selector.route;
    const scopes = this.scopes.filter((candidate) => scope === undefined || candidate.scope === scope);
    const found = scopes.flatMap((candidate) => {
      const hop = this.routeHop(selector, candidate, method, template);
      return hop === undefined ? [] : [{ scope: candidate, ...hop }];
    });
    if (found.length === 0) {
      this.gap({ code: 'route-without-decl', selector,
        detail: 'No route-decl or route-contract fact has exactly this method and template in the selected scope.' });
      return [];
    }
    const handlers = new Map<string, TraceHandlerHop>();
    const uses = new Map<string, MutableUse>();
    for (const { scope: routeScope, declFacts } of found) {
      const key = routeKey(routeScope.scope, method, template);
      for (const fact of declFacts) {
        const usr = fact.endpoint.symbol?.usr;
        if (usr === undefined) {
          this.gap({ code: 'handler-without-symbol', selector, route: key, evidence: toPairEndpoint(fact.endpoint),
            detail: 'The route declaration carries no symbol.usr, so its handler cannot be followed into the language graph.' });
          continue;
        }
        addHandler(handlers, fact.endpoint.platform, usr, fact.endpoint.symbol?.qualifiedName, key, undefined);
        this.forwardUses(selector, fact.endpoint.platform, usr, uses);
      }
      // 테스트 소스 decl만 있는 경우는 test-source-omitted가 이미 밝힌다. 계약만 있는 route만 여기서 남긴다.
      // found의 scope에는 decl이나 contract가 있으므로 decl이 없으면 계약만 있는 route다.
      if (!this.hasDecl(routeScope, method, template)) {
        this.gap({ code: 'route-contract-only', selector, route: key,
          detail: 'The route is declared only by a contract (no route-decl), so there is no handler to follow.' });
      }
    }
    const relationUses = finishUses(uses);
    return [this.count({
      selector,
      routes: found.map(({ hop }) => hop),
      handlers: sortHandlers(handlers),
      relationUses,
      database: this.database(selector, relationUses),
    })];
  }

  /** scope에 이 키의 route-decl(테스트 소스 포함)이 하나라도 있는지다. */
  private hasDecl(scope: RouteScope, method: RouteMethod, template: string): boolean {
    return scope.decls.some(({ declaration }) => declaration.method === method && declaration.template === template);
  }

  /** relation 선택 하나의 체인이다. */
  private relationChain(selector: { relation: string }): TraceChain[] {
    const outcome = this.resolver.resolveUse(selector.relation);
    if (outcome.status === 'ambiguous') {
      this.gap({ code: 'relation-selection-ambiguous', selector,
        detail: `The relation name matches several declarations (${outcome.candidates.join(', ')}); select a qualified name.` });
      return [];
    }
    const target = outcome.status === 'resolved'
      ? this.resolver.declKey(outcome.channel) : this.resolver.useKey(selector.relation);
    const uses = this.uses.filter((use) => use.outcome !== 'dynamic' && this.resolver.useKey(use.fact.channel!) === target);
    if (outcome.status === 'resolved') {
      for (const use of this.uses) {
        if (use.candidates?.includes(outcome.channel) === true) {
          this.gap({ code: 'relation-use-ambiguous', selector, evidence: use.endpoint,
            detail: 'This unqualified relation use may refer to the selected relation among other candidates; it is not followed.' });
        }
      }
    }
    // dynamic 사용은 원문 식이 이름이 아니라 어느 relation을 가리키는지 모른다. hop으로 싣지 않고 모두 gap으로 밝힌다.
    const dynamicUses = this.uses.filter((use) => use.outcome === 'dynamic');
    for (const use of dynamicUses) this.useOutcomeGap(selector, use);
    if (outcome.status === 'missing') {
      this.gap({ code: 'relation-without-decl', selector,
        detail: 'No relation-decl matches this name, so no schema vertex or database dependents can be followed.' });
      if (uses.length === 0) return [];
    } else if (uses.length === 0) {
      this.gap({ code: 'relation-without-use', selector,
        detail: dynamicUses.length === 0
          ? 'No relation-use of this relation was observed in the scanned code; this is not evidence that no code uses it.'
          : `No literal relation-use of this relation was observed; ${dynamicUses.length} relation use(s) with a `
            + 'non-literal name may refer to it.' });
    }
    const hops = new Map<string, MutableUse>();
    const starts: StartSymbol[] = [];
    for (const use of uses) {
      addUse(hops, use, undefined);
      if (use.usr === undefined) {
        this.gap({ code: 'relation-use-without-symbol', selector, evidence: use.endpoint,
          detail: 'The relation use carries no symbol.usr, so it cannot be followed into the language graph.' });
      } else {
        starts.push({ platform: use.platform, usr: use.usr });
      }
      this.useOutcomeGap(selector, use);
    }
    const relationUses = finishUses(hops);
    const declared = outcome.status === 'resolved' ? this.relationDecls.get(target) ?? [] : [];
    const reverse = this.reverseRoutes(selector, uniqueStarts(starts));
    return [this.count({ selector, ...reverse, relationUses, database: this.database(selector, relationUses, declared) })];
  }

  /** 심볼 선택 하나의 체인이다. */
  private symbolChain(selector: { symbol: TraceSymbolSelection }): TraceChain {
    return this.count({ selector, ...this.reverseRoutes(selector, [selector.symbol]), relationUses: [], database: [] });
  }

  /**
   * 시작 심볼들에서 역방향 순회로 route 핸들러를 찾고 그 route의 클라이언트 hop을 만든다.
   * 핸들러에 닿지 못한 시작점은 `non-http-entry`로 남긴다.
   */
  private reverseRoutes(selector: TraceSelector, starts: readonly StartSymbol[]): Pick<TraceChain, 'routes' | 'handlers'> {
    const handlers = new Map<string, TraceHandlerHop>();
    const routes = new Map<string, TraceRouteKey>();
    for (const start of starts) {
      const reach = new Map<string, TraceReach>([[start.usr, { from: start.usr, depth: 0, path: [start.usr] }]]);
      for (const { analysis, rows } of this.rootedRows(selector, 'reverse', start.platform, start.usr)) {
        for (const row of rows) keepNearest(reach, row.symbol.usr, reachOf(start.usr, analysis, row));
      }
      let found = false;
      for (const [usr, via] of [...reach.entries()].sort(([left], [right]) => compareStrings(left, right))) {
        for (const { scope, fact } of this.declsByHandler.get(symbolKey(start.platform, usr)) ?? []) {
          found = true;
          const key = routeKey(scope.scope, fact.declaration.method, fact.declaration.template);
          routes.set(JSON.stringify([key.scope, key.template, key.method]), key);
          addHandler(handlers, start.platform, usr, fact.endpoint.symbol?.qualifiedName, key, via);
        }
      }
      if (!found) {
        this.gap({ code: 'non-http-entry', selector, symbol: { platform: start.platform, usr: start.usr },
          detail: 'No route-decl handler was reached from this symbol; it may be reached only from non-http entry points '
            + '(scheduled jobs, queues, CLIs) or the reverse traversal is incomplete.' });
      }
    }
    const hops = [...routes.values()].sort(compareRouteKeys).flatMap((key) => {
      const scope = this.scopes.find((candidate) => candidate.scope === key.scope)!;
      return [this.routeHop(selector, scope, key.method, key.template)!.hop];
    });
    return { routes: hops, handlers: sortHandlers(handlers) };
  }

  /**
   * 한 scope에서 route 키 하나의 선언 측 증거와 클라이언트 hop을 만든다.
   * 선언 측 사실이 없으면 undefined다. 테스트 소스 사실은 기본으로 뺀다.
   */
  private routeHop(selector: TraceSelector, scope: RouteScope, method: RouteMethod, template: string):
    { hop: TraceRouteHop; declFacts: RouteDeclarationFact[] } | undefined {
    const key = routeKey(scope.scope, method, template);
    const pick = (facts: readonly RouteDeclarationFact[]) => facts.filter(({ declaration }) =>
      declaration.method === method && declaration.template === template);
    const declAll = pick(scope.decls);
    const contractAll = pick(scope.contracts);
    if (declAll.length === 0 && contractAll.length === 0) return undefined;
    const declFacts = declAll.filter(({ testSource }) => !testSource);
    let testSources = declAll.length - declFacts.length;
    const declIds = new Set(declFacts.map(({ declaration }) => declaration.id));
    const contractIds = new Set(contractAll.map(({ declaration }) => declaration.id));
    const calls: TraceCallHop[] = [];
    for (const call of scope.calls) {
      const matched = (['decl', 'contract'] as const).flatMap((side) => {
        const outcome = call[side];
        return outcome?.status === 'matched' &&
          outcome.targets.some(({ id }) => (side === 'decl' ? declIds : contractIds).has(id))
          ? [{ side, quality: outcome.quality }] : [];
      })[0];
      const ambiguous = (['decl', 'contract'] as const).some((side) => {
        const outcome = call[side];
        return outcome?.status === 'ambiguous' &&
          outcome.targets.some(({ id }) => (side === 'decl' ? declIds : contractIds).has(id));
      });
      if (matched === undefined) {
        if (ambiguous && !call.testSource) {
          this.gap({ code: 'ambiguous-route-call', selector, route: key, evidence: toPairEndpoint(call.endpoint),
            detail: 'This attributed call is ambiguous between this route and another declaration; it is not followed.' });
        }
        continue;
      }
      if (call.testSource) {
        testSources += 1;
        continue;
      }
      calls.push({
        call: toPairEndpoint(call.endpoint), side: matched.side, quality: matched.quality,
        affected: this.callAffected(selector, key, call.endpoint),
      });
    }
    if (testSources > 0) {
      this.gap({ code: 'test-source-omitted', selector, route: key,
        detail: `${testSources} test-source route fact(s) matching this route are excluded from the chain.` });
    }
    if (scope.clientDocuments === 0) {
      this.gap({ code: 'http-clients-unscanned', selector, route: key,
        detail: 'No client-role http document can reach this scope, so callers of this route were not scanned.' });
    }
    if (scope.unboundCalls > 0) {
      this.gap({ code: 'unattributed-calls-omitted', selector, route: key,
        detail: `${scope.unboundCalls} route call(s) could not be attributed to a declaration side and may call this `
          + 'scope; their paths and hosts are not reported.' });
    }
    if (scope.dynamicCalls > 0) {
      this.gap({ code: 'dynamic-route-calls', selector, route: key,
        detail: `${scope.dynamicCalls} attributed route call(s) in this scope have a non-literal template and were not matched.` });
    }
    return {
      hop: {
        ...key,
        declarations: declFacts.map(({ endpoint }) => toPairEndpoint(endpoint)).sort(compareEndpoints),
        contracts: contractAll.map(({ endpoint }) => toPairEndpoint(endpoint)).sort(compareEndpoints),
        calls: calls.sort((left, right) => compareEndpoints(left.call, right.call) || compareStrings(left.side, right.side)),
      },
      declFacts,
    };
  }

  /** 호출을 감싼 심볼의 클라이언트 역방향 영향이다. */
  private callAffected(selector: TraceSelector, route: TraceRouteKey, endpoint: BridgeEndpoint): TraceAffected[] {
    const usr = endpoint.symbol?.usr;
    if (usr === undefined) {
      this.gap({ code: 'call-without-symbol', selector, route, evidence: toPairEndpoint(endpoint),
        detail: 'The route call carries no symbol.usr, so affected client code cannot be followed.' });
      return [];
    }
    return affectedRows(this.rootedRows(selector, 'reverse', endpoint.platform, usr));
  }

  /** 핸들러에서 정방향으로 닿은 relation-use를 모은다. 핸들러 자신의 사실도 포함한다. */
  private forwardUses(selector: TraceSelector, platform: BridgePlatform, handler: string, uses: Map<string, MutableUse>): void {
    const reach = new Map<string, TraceReach>([[handler, { from: handler, depth: 0, path: [handler] }]]);
    for (const { analysis, rows } of this.rootedRows(selector, 'forward', platform, handler)) {
      for (const row of rows) keepNearest(reach, row.symbol.usr, reachOf(handler, analysis, row));
    }
    for (const [usr, via] of reach) {
      for (const use of this.usesBySymbol.get(symbolKey(platform, usr)) ?? []) {
        // dynamic 사용의 원문 식은 관계 이름이 아니므로 hop으로 싣지 않고 gap 증거로만 남긴다.
        if (use.outcome !== 'dynamic') addUse(uses, use, via);
        this.useOutcomeGap(selector, use);
      }
    }
  }

  /** 조인하지 못한 relation-use를 gap으로 남긴다. */
  private useOutcomeGap(selector: TraceSelector, use: UseRecord): void {
    const gap = {
      resolved: undefined,
      missing: ['relation-use-without-decl', 'The relation use has no matching relation-decl, so no schema vertex can be followed.'],
      ambiguous: ['relation-use-ambiguous', 'The unqualified relation use matches several declarations; no schema vertex is guessed.'],
      'column-missing': ['column-use-without-decl',
        'The column use has no matching column declaration, so no column vertex can be followed.'],
      dynamic: ['dynamic-relation-use', 'The relation use has a non-literal name and was not joined.'],
    }[use.outcome];
    if (gap !== undefined) this.gap({ code: gap[0]!, selector, evidence: use.endpoint, detail: gap[1]! });
  }

  /** relation-decl VertexId별 schemagraph 의존자다. */
  private database(selector: TraceSelector, uses: readonly TraceRelationUseHop[], extra: readonly PairEndpoint[] = []):
    TraceDatabaseHop[] {
    const vertices = new Set<string>();
    for (const decl of [...extra, ...uses.flatMap(({ decls }) => decls)]) {
      const usr = decl.symbol?.usr;
      if (usr === undefined) {
        this.gap({ code: 'relation-decl-without-symbol', selector, evidence: decl,
          detail: 'The relation declaration carries no symbol.usr (schemagraph VertexId), so database dependents cannot be followed.' });
      } else {
        vertices.add(usr);
      }
    }
    return [...vertices].sort(compareStrings).map((vertex) => ({
      vertex,
      dependents: affectedRows(this.rootedRows(selector, 'db-dependents', 'sql', vertex)),
    }));
  }

  /**
   * 역할·플랫폼·root id로 분석을 찾아 그 root에서 닿은 정점을 돌려준다.
   * 분석이 없으면 `analysis-missing`, 잘렸거나 root 귀속이 부분적이면 해당 gap을 남긴다.
   */
  private rootedRows(selector: TraceSelector, role: TraceAnalysisRole, platform: BridgePlatform | 'sql', id: string):
    Array<{ analysis: TraceAnalysis; root: string; rows: TraversalReached[] }> {
    const hits = this.roots.get(JSON.stringify([role, platform, id])) ?? [];
    if (hits.length === 0) {
      this.gap({ code: 'analysis-missing', selector, symbol: { platform, usr: id },
        detail: `No ${role} analysis is rooted at this ${platform} id, so this hop cannot be followed.` });
    }
    return hits.map(({ analysis, rootIndex }) => {
      const { graph } = analysis;
      if (graph.truncated) {
        this.gap({ code: 'analysis-truncated', selector, analysis: analysis.id,
          detail: `The producer truncated this traversal${graph.truncationReasons.length === 0 ? ''
            : ` (${graph.truncationReasons.join(', ')})`}; reached symbols may be missing.` });
      }
      // 잘린 목록은 가장 작은 인덱스 64개를 싣는다. 마지막 인덱스보다 큰 root만 빠졌을 수 있다.
      if (graph.rootsTruncated && graph.reached.some(({ roots }) =>
        roots.length === MAX_ROOTS_PER_REACHED && rootIndex > roots[roots.length - 1]!)) {
        this.gap({ code: 'analysis-truncated', selector, analysis: analysis.id,
          detail: 'Root attribution was capped at 64 roots per symbol; some symbols reached from this root may be missing.' });
      }
      if (graph.rootProvenance === 'witness') {
        this.gap({ code: 'roots-provenance-partial', selector, analysis: analysis.id,
          detail: 'This multi-root analysis records only one witness root per symbol; symbols also reached from this root '
            + 'through another root may be missing. Emit language-traversal v1 to preserve every root.' });
      }
      return { analysis, root: id, rows: this.rowsByRoot.get(analysis)!.get(rootIndex) ?? [] };
    });
  }

  /** 분석 revision이 context나 서로와 다르면 stale gap을 남긴다. */
  private addRevisionGaps(): void {
    const { revision } = this.input.context;
    const analyses = this.input.analyses;
    const revisions = new Set(analyses.flatMap(({ graph }) => graph.revision === undefined ? [] : [graph.revision]));
    for (const { id, graph } of analyses) {
      if (revision !== undefined && graph.revision === undefined) {
        this.gap({ code: 'analysis-revision-unknown', analysis: id,
          detail: 'The trace context declares a revision but this analysis carries none, so its freshness is unverified.' });
      } else if (revision === undefined && graph.revision === undefined && revisions.size > 0) {
        this.gap({ code: 'analysis-revision-unknown', analysis: id,
          detail: 'Other analyses carry a revision but this one has none, so they cannot be checked against each other.' });
      } else if (graph.revision !== undefined && (revision === undefined ? revisions.size > 1 : graph.revision !== revision)) {
        this.gap({ code: 'stale-analysis', analysis: id,
          detail: 'This analysis revision differs from the trace context revision or from other analyses.' });
      }
    }
    for (const platform of new Set(analyses.map(({ platform: value }) => value))) {
      const same = analyses.filter((analysis) => analysis.platform === platform && analysis.graph.graphRevision !== undefined);
      if (new Set(same.map(({ graph }) => graph.graphRevision)).size <= 1) continue;
      for (const { id } of same) {
        this.gap({ code: 'stale-analysis', analysis: id,
          detail: 'Analyses of this platform were computed from different graph revisions.' });
      }
    }
  }

  /** 입력에 없는 측(http 선언·persistence 문서)과 usr 없는 사용을 전역 gap으로 남긴다. */
  private addCoverageGaps(): void {
    const documents = this.input.documents;
    const selection = this.input.context.selection;
    const hasPersistenceCaller = documents.some(({ target, platform }) => target === 'persistence' && platform !== 'sql');
    const hasSql = documents.some(({ platform, target }) => platform === 'sql' && target === 'persistence');
    if (!('symbols' in selection) && (!hasPersistenceCaller || !hasSql)) {
      this.gap({ code: 'persistence-unscanned',
        detail: 'The context lacks a persistence caller document or a sql declaration document, so database hops are incomplete.' });
    }
    if (!('routes' in selection) && this.scopes.every(({ declScanned }) => !declScanned)) {
      this.gap({ code: 'http-server-unscanned',
        detail: 'No server-role http document scanned route declarations, so handlers cannot be matched to routes.' });
    }
    if ('routes' in selection) {
      const counts = new Map<string, number>();
      for (const use of this.uses) {
        if (use.usr === undefined) counts.set(use.platform, (counts.get(use.platform) ?? 0) + 1);
      }
      for (const [platform, count] of counts) {
        this.gap({ code: 'relation-use-without-symbol',
          detail: `${count} ${platform} relation use(s) carry no symbol.usr and cannot be attributed to any handler.` });
      }
    }
  }

  /** persistence 문서의 relation-use를 조인 해석과 함께 색인한다. 매칭 규칙은 조인 해석기를 재사용한다. */
  private indexRelations(): void {
    const matches = createPersistenceMatches(this.joined);
    const byKey = new Map(matches.map((match) => [relationDeclKey(match.key.relation, match.key.column), match]));
    for (const match of matches) {
      if (match.key.column === undefined) this.relationDecls.set(relationDeclKey(match.key.relation), [...match.decls]);
    }
    for (const unused of this.joined.relationDeclsWithoutUses) {
      this.relationDecls.set(relationDeclKey(unused.channel), unused.decls.map(toPairEndpoint));
    }
    for (const document of this.input.documents) {
      if (document.target !== 'persistence' || document.platform === 'sql') continue;
      for (const fact of document.facts) {
        if (fact.kind !== 'relation-use' || fact.channel === null) continue;
        const endpoint = toPairEndpoint({ platform: document.platform,
          ...(fact.location === undefined ? {} : { location: fact.location }),
          ...(fact.symbol === undefined ? {} : { symbol: fact.symbol }) });
        // dynamic 원문 식은 관계 이름이 아니다. 우연히 선언 이름과 같아도 해석하지 않는다(조인과 같다).
        const resolution = fact.dynamic ? undefined : this.resolver.resolveUse(fact.channel);
        const match = resolution?.status === 'resolved' ? byKey.get(this.resolver.useKey(fact.channel, fact.method)) : undefined;
        const outcome = resolution === undefined ? 'dynamic'
          : resolution.status !== 'resolved' ? resolution.status : match === undefined ? 'column-missing' : 'resolved';
        const record: UseRecord = { platform: document.platform, fact, endpoint,
          ...(fact.symbol?.usr === undefined ? {} : { usr: fact.symbol.usr }),
          ...(match === undefined ? {} : { match }), outcome,
          ...(resolution?.status === 'ambiguous' ? { candidates: resolution.candidates } : {}) };
        this.uses.push(record);
        if (record.usr !== undefined) {
          const key = symbolKey(record.platform, record.usr);
          this.usesBySymbol.set(key, [...(this.usesBySymbol.get(key) ?? []), record]);
        }
      }
    }
  }

  /** route-decl 핸들러 usr별 선언 사실 색인이다. 테스트 소스 decl은 역방향 체인에서 뺀다. */
  private indexHandlers(): void {
    for (const scope of this.scopes) {
      for (const fact of scope.decls) {
        const usr = fact.endpoint.symbol?.usr;
        if (usr === undefined || fact.testSource) continue;
        const key = symbolKey(fact.endpoint.platform, usr);
        this.declsByHandler.set(key, [...(this.declsByHandler.get(key) ?? []), { scope, fact }]);
      }
    }
  }

  /** 분석의 (역할, 플랫폼, root id) 색인과 root별 도달 정점 목록을 만든다. */
  private indexAnalyses(): void {
    for (const analysis of [...this.input.analyses].sort((left, right) => compareStrings(left.id, right.id))) {
      const byRoot = new Map<number, TraversalReached[]>();
      for (const row of analysis.graph.reached) {
        for (const index of row.roots) byRoot.set(index, [...(byRoot.get(index) ?? []), row]);
      }
      this.rowsByRoot.set(analysis, byRoot);
      analysis.graph.roots.forEach(({ id, symbol }, rootIndex) => {
        // 심볼이 아닌 root(파일 선택, 생산자가 해석하지 못한 요청)는 생산자 id 조인 대상이 아니다.
        if (symbol === undefined) return;
        const key = JSON.stringify([analysis.role, analysis.platform, id]);
        this.roots.set(key, [...(this.roots.get(key) ?? []), { analysis, rootIndex }]);
      });
    }
  }

  /** gap을 신원(직렬화)으로 중복 없이 담는다. */
  private gap(gap: TraceGap): void {
    const cleaned = Object.fromEntries(Object.entries(gap).filter(([, value]) => value !== undefined)) as unknown as TraceGap;
    const key = encodeSortedJson(cleaned, true);
    if (!this.gaps.has(key)) this.bump(1);
    this.gaps.set(key, cleaned);
  }

  /** 체인이 싣는 항목 수를 세고 상한을 넘으면 실패한다. */
  private count(chain: TraceChain): TraceChain {
    this.witnessGaps(chain);
    const affected = (rows: readonly { affected: readonly unknown[] }[]) => rows.reduce((sum, row) => sum + row.affected.length, 0);
    this.bump(chain.routes.reduce((sum, route) => sum + 1 + route.declarations.length + route.contracts.length +
      route.calls.length + affected(route.calls), 0) + chain.handlers.length + chain.relationUses.length +
      chain.database.reduce((sum, hop) => sum + 1 + hop.dependents.length, 0));
    return chain;
  }

  /** 목격 경로가 부분적인 정점마다 gap을 남긴다. 경로를 지어내지 않았다는 표시다. */
  private witnessGaps(chain: TraceChain): void {
    const partial = (analysis: string | undefined, platform: string, usr: string) => this.gap({
      code: 'witness-partial', selector: chain.selector, ...(analysis === undefined ? {} : { analysis }), symbol: { platform, usr },
      detail: 'The producer witness for this root entry leads back to the root itself (a cycle); the depth is authoritative '
        + 'but the path from the other root is unknown and not reconstructed.' });
    const affected = [...chain.routes.flatMap(({ calls }) => calls.flatMap((call) => call.affected)),
      ...chain.database.flatMap(({ dependents }) => dependents)];
    for (const row of affected) if (row.witnessPartial) partial(row.analysis, row.platform, row.usr);
    for (const handler of chain.handlers) {
      for (const reach of handler.reachedFrom) if (reach.witnessPartial) partial(reach.analysis, handler.platform, handler.usr);
    }
    for (const use of chain.relationUses) {
      // 도달 근거의 경로 끝은 그 사용을 감싼 심볼의 생산자 id다. 사실의 symbol 필드에 기대지 않는다.
      for (const reach of use.reachedFrom) {
        if (reach.witnessPartial) partial(reach.analysis, use.use.platform, reach.path[reach.path.length - 1]!);
      }
    }
  }

  private bump(items: number): void {
    this.outputItems += items;
    if (this.outputItems > MAX_TRACE_OUTPUT_ITEMS) {
      throw new TraceInputError(`Trace output exceeds ${MAX_TRACE_OUTPUT_ITEMS} items; narrow the selection and retry. `
        + 'No partial trace is emitted.');
    }
  }
}

/** 조립 중인 relation-use hop이다. */
interface MutableUse {
  readonly record: UseRecord;
  readonly reach: Map<string, TraceReach>;
}

/** relation-use hop을 사실 신원으로 합치고 핸들러별 가장 가까운 도달만 남긴다. */
function addUse(uses: Map<string, MutableUse>, record: UseRecord, reach: TraceReach | undefined): void {
  const key = encodeSortedJson([record.endpoint, record.fact.channel, record.fact.method ?? null], true);
  const entry = uses.get(key) ?? { record, reach: new Map<string, TraceReach>() };
  if (reach !== undefined) keepNearest(entry.reach, reach.from, reach);
  uses.set(key, entry);
}

/** 조립한 relation-use hop을 결정적 순서로 확정한다. */
function finishUses(uses: ReadonlyMap<string, MutableUse>): TraceRelationUseHop[] {
  return [...uses.entries()].sort(([left], [right]) => compareStrings(left, right)).map(([, { record, reach }]) => {
    const match = record.match;
    return {
      use: record.endpoint,
      relation: record.fact.channel!,
      ...(record.fact.method === undefined ? {} : { column: record.fact.method }),
      ...(match === undefined ? {} : {
        resolved: { relation: match.key.relation, ...(match.key.column === undefined ? {} : { column: match.key.column }) },
      }),
      decls: match?.decls ?? [],
      reachedFrom: [...reach.values()].sort((left, right) => compareStrings(left.from, right.from)),
    };
  });
}

/** 핸들러 hop을 합친다. route 키와 도달 근거는 중복 없이 모은다. */
function addHandler(handlers: Map<string, TraceHandlerHop>, platform: BridgePlatform, usr: string,
  qualifiedName: string | undefined, route: TraceRouteKey, reach: TraceReach | undefined): void {
  const key = symbolKey(platform, usr);
  const existing = handlers.get(key);
  const routes = new Map((existing?.routes ?? []).map((item) => [JSON.stringify(item), item]));
  routes.set(JSON.stringify(route), route);
  const reached = new Map((existing?.reachedFrom ?? []).map((item) => [item.from, item]));
  if (reach !== undefined) keepNearest(reached, reach.from, reach);
  const name = existing?.qualifiedName ?? qualifiedName;
  handlers.set(key, {
    platform, usr,
    ...(name === undefined ? {} : { qualifiedName: name }),
    routes: [...routes.values()].sort(compareRouteKeys),
    reachedFrom: [...reached.values()].sort((left, right) => compareStrings(left.from, right.from)),
  });
}

/** 핸들러 hop을 (플랫폼, usr) 순으로 정렬한다. */
function sortHandlers(handlers: ReadonlyMap<string, TraceHandlerHop>): TraceHandlerHop[] {
  return [...handlers.entries()].sort(([left], [right]) => compareStrings(left, right)).map(([, hop]) => hop);
}

/** 같은 정점에 여러 도달이 있으면 (depth, analysis) 최솟값 하나만 남긴다. */
function keepNearest(target: Map<string, TraceReach>, key: string, reach: TraceReach): void {
  const current = target.get(key);
  if (current === undefined || compareNearness(reach, current) < 0) target.set(key, reach);
}

/**
 * 도달 근거의 우선순위다. 시작점 자신의 경로(`witnessRoot` 없음)가 다른 root의 목격보다 앞서고,
 * 그다음 depth, 분석 id 순이다.
 */
function compareNearness(left: NearnessKey, right: NearnessKey): number {
  const indirect = (reach: NearnessKey) => Number(reach.witnessRoot !== undefined || reach.witnessPartial === true);
  return indirect(left) - indirect(right) || left.depth - right.depth ||
    compareStrings(left.analysis ?? '', right.analysis ?? '');
}

/** 도달 근거 비교에 쓰는 필드다. */
type NearnessKey = Pick<TraceReach, 'depth' | 'analysis' | 'witnessRoot' | 'witnessPartial'>;

/**
 * 생산자 via 목격으로 도달 근거를 만든다.
 *
 * 목격 경로의 첫 원소가 이 hop의 시작 root와 다르면 `witnessRoot`를 싣는다. 그때 depth·path는
 * 그 root 기준이며, 시작 root에서의 거리는 depth보다 짧지 않다는 것만 알 수 있다(경로를 지어내지 않는다).
 */
function reachOf(from: string, analysis: TraceAnalysis, row: TraversalReached): TraceReach {
  const { path, partial } = traversalWitness(analysis.graph, row.symbol.usr);
  return { from, analysis: analysis.id, depth: row.depth, path,
    ...(partial ? { witnessPartial: true as const } : path[0] === from ? {} : { witnessRoot: path[0]! }) };
}

/** 적중한 분석들의 도달 정점을 (플랫폼, usr)별 가장 가까운 것 하나로 줄인다. */
function affectedRows(hits: ReadonlyArray<{ analysis: TraceAnalysis; root: string; rows: readonly TraversalReached[] }>):
  TraceAffected[] {
  const best = new Map<string, TraceAffected>();
  for (const { analysis, root, rows } of hits) {
    for (const row of rows) {
      const { path, witnessRoot, witnessPartial } = reachOf(root, analysis, row);
      const candidate: TraceAffected = {
        platform: analysis.platform, usr: row.symbol.usr,
        ...(row.symbol.qualifiedName === undefined ? {} : { qualifiedName: row.symbol.qualifiedName }),
        ...(row.symbol.kind === undefined ? {} : { kind: row.symbol.kind }),
        ...(row.symbol.location === undefined ? {} : { location: row.symbol.location }),
        ...(row.relationships === undefined ? {} : { relationships: row.relationships }),
        analysis: analysis.id, depth: row.depth, path, ...(witnessRoot === undefined ? {} : { witnessRoot }),
        ...(witnessPartial === undefined ? {} : { witnessPartial }),
      };
      const current = best.get(row.symbol.usr);
      if (current === undefined || compareNearness(candidate, current) < 0) best.set(row.symbol.usr, candidate);
    }
  }
  return [...best.values()].sort((left, right) => left.depth - right.depth || compareStrings(left.usr, right.usr));
}

/** 시작 심볼 중복을 제거하고 정렬한다. */
function uniqueStarts(starts: readonly StartSymbol[]): StartSymbol[] {
  const unique = new Map(starts.map((start) => [symbolKey(start.platform, start.usr), start]));
  return [...unique.entries()].sort(([left], [right]) => compareStrings(left, right)).map(([, start]) => start);
}

function routeKey(scope: string, method: RouteMethod, template: string): TraceRouteKey {
  return { scope, method, template };
}

function compareRouteKeys(left: TraceRouteKey, right: TraceRouteKey): number {
  return compareStrings(left.scope, right.scope) || compareStrings(left.template, right.template) ||
    compareStrings(left.method, right.method);
}

/** 체인 키 `[platform, id]`의 직렬화다. 생산자별 id 네임스페이스를 섞지 않는다. */
function symbolKey(platform: string, usr: string): string {
  return JSON.stringify([platform, usr]);
}

function summarizeAnalysis({ id, platform, role, graph }: TraceAnalysis): TraceAnalysisSummary {
  return {
    id, platform, role, source: graph.source, direction: graph.direction,
    ...(graph.tool === undefined ? {} : { tool: graph.tool }),
    ...(graph.revision === undefined ? {} : { revision: graph.revision }),
    ...(graph.graphRevision === undefined ? {} : { graphRevision: graph.graphRevision }),
    truncated: graph.truncated, rootsTruncated: graph.rootsTruncated, rootProvenance: graph.rootProvenance,
    roots: graph.roots.length, reached: graph.reached.length,
  };
}

function summarize(chains: readonly TraceChain[], gaps: number): TraceReport['summary'] {
  const sum = (pick: (chain: TraceChain) => number) => chains.reduce((total, chain) => total + pick(chain), 0);
  return {
    chains: chains.length,
    routes: sum(({ routes }) => routes.length),
    handlers: sum(({ handlers }) => handlers.length),
    relationUses: sum(({ relationUses }) => relationUses.length),
    databaseVertices: sum(({ database }) => database.length),
    databaseDependents: sum(({ database }) => database.reduce((total, hop) => total + hop.dependents.length, 0)),
    calls: sum(({ routes }) => routes.reduce((total, route) => total + route.calls.length, 0)),
    clientSymbols: sum(({ routes }) => routes.reduce((total, route) =>
      total + route.calls.reduce((count, call) => count + call.affected.length, 0), 0)),
    gaps,
  };
}
