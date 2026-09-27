import { compareStrings } from '../compare.ts';
import type { BridgeFact, BridgeFactsDocument, BridgePlatform } from '../exchange/parse.ts';
import {
  MAX_ROOTS_PER_REACHED,
  reachedEvidence,
  traversalWitness,
  type TraversalEvidenceQuality,
  type TraversalLocation,
  type TraversalPlatform,
  type TraversalReached,
} from '../exchange/language-traversal.ts';
import type {
  TraceAnalysis,
  TraceAnalysisRole,
  TraceContext,
  TraceLinkMatch,
  TracePrecomputed,
  TraceRouteSelection,
  TraceSelection,
  TraceSymbolSelection,
} from '../exchange/trace-context.ts';
import type { RouteMethod } from '../exchange/route-template.ts';
import { compareEndpoints, relationDeclKey, type BridgeEndpoint } from '../join/join.ts';
import { isClientDocument, isDeclarationDocument, type RouteDeclarationFact } from '../join/route-join.ts';
import type { RouteMatchQuality } from '../join/route-index.ts';
import { createPersistenceMatches, toPairEndpoint, type PairEndpoint, type PersistenceMatch } from './pairs.ts';
import { encodeSortedJson } from './sorted-json.ts';
import {
  prepareTraceInputs,
  TraceInputError,
  type PreparedTrace,
  type TraceLimitation,
  type TraceLinkedScope,
  type TraceMemberInput,
} from './trace-inputs.ts';

export { TraceInputError };
export type { TraceLimitation };

/**
 * `isthmus trace` 보고서 — route 단위 영향 후보를 생산자 id 정확 일치로만 잇는다.
 *
 * 한 project(또는 workspace의 여러 member)의 bridge-facts(http·persistence)와 생산자 순회 숲을 받아 잇는다.
 *
 * - route 선택: route-decl → 핸들러 usr → 정방향 순회 → relation-use → persistence 조인 →
 *   relation-decl VertexId → schemagraph 의존자, 그리고 route → 귀속된 route-call → 클라이언트
 *   역방향 순회.
 * - relation·심볼·파일 선택: relation-use(또는 심볼, 파일에 놓인 심볼) → 역방향 순회 → route-decl 핸들러 →
 *   route → 클라이언트.
 *
 * workspace에서는 체인 키가 `[member, platform, id]`다. persistence·언어 순회는 member 안에서만, http는
 * link에 선언된 쌍에서만 잇는다. 결과는 항상 `complete: false`다. 끊긴 곳은 gap으로만 보고하고
 * "닿지 않는다"를 주장하지 않는다. 출력의 모든 id는 생산자가 준 문자열이며, 귀속되지 않은 호출의
 * 경로·host는 싣지 않는다.
 */

/**
 * trace 입력 묶음이다. CLI가 경로를 읽어 검증한 뒤 넘긴다.
 *
 * workspace context면 `documents`는 `context.documents`(member 순서대로 이어 붙인 경로)와 같은 순서여야 한다.
 */
export interface TraceInput {
  readonly context: TraceContext;
  readonly documents: readonly BridgeFactsDocument[];
  readonly analyses: readonly TraceAnalysis[];
}

/** 체인의 시작 선택 하나다. workspace면 relation·파일 선택에 `member`가 붙는다. */
export type TraceSelector =
  | { readonly route: TraceRouteSelection }
  | { readonly relation: string; readonly member?: string }
  | { readonly symbol: TraceSymbolSelection }
  | { readonly file: string; readonly member?: string };

/** route 키다. scope는 check 진단 신원과 같은 규칙(service 또는 `default`, workspace면 link 이름)이다. */
export interface TraceRouteKey {
  readonly scope: string;
  readonly method: RouteMethod;
  readonly template: string;
}

/** 끝점이다. `check --pairs`와 같은 투영에, workspace면 그 사실을 낸 member를 더한다. */
export type TraceEndpoint = PairEndpoint & { readonly member?: string };

/**
 * hop의 근거 등급이다(`direct`·`bound`·`candidate`, 생산자가 분류하지 않았으면 `unassessed`).
 * 도달 정점의 등급이며 목격 경로에서 가장 약한 등급과 같다. `candidate`는 `candidate-dispatch` gap을 동반한다.
 */
export type TraceEvidence = TraversalEvidenceQuality;

/** 순회가 닿은 정점이다. `path`는 생산자 via 목격을 따른 root부터 이 정점까지의 id다. */
export interface TraceAffected {
  readonly platform: TraversalPlatform;
  readonly usr: string;
  /** workspace면 이 정점을 순회한 분석의 member다. */
  readonly member?: string;
  readonly qualifiedName?: string;
  readonly kind?: string;
  readonly location?: TraversalLocation;
  readonly relationships?: readonly string[];
  readonly analysis: string;
  readonly depth: number;
  readonly path: readonly string[];
  readonly evidence: TraceEvidence;
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
  /** 시작점 자신(depth 0)은 간선이 없으므로 `direct`다. */
  readonly evidence: TraceEvidence;
  readonly witnessRoot?: string;
  readonly witnessPartial?: true;
}

/** route에 match된 귀속 호출 하나와 그 호출을 감싼 심볼의 클라이언트 영향이다. */
export interface TraceCallHop {
  readonly call: TraceEndpoint;
  readonly side: 'decl' | 'contract';
  readonly quality: RouteMatchQuality;
  readonly affected: readonly TraceAffected[];
}

/** route 하나의 선언 측 증거와 클라이언트 hop이다. */
export interface TraceRouteHop extends TraceRouteKey {
  readonly declarations: readonly TraceEndpoint[];
  readonly contracts: readonly TraceEndpoint[];
  readonly calls: readonly TraceCallHop[];
}

/** route-decl 핸들러다. 역방향 선택이면 시작점에서의 도달 근거가 실린다. */
export interface TraceHandlerHop {
  readonly platform: BridgePlatform;
  readonly usr: string;
  /** workspace면 핸들러를 선언한 server member다. */
  readonly member?: string;
  readonly qualifiedName?: string;
  readonly routes: readonly TraceRouteKey[];
  readonly reachedFrom: readonly TraceReach[];
}

/** relation-use 사실 하나와 persistence 조인이 해석한 선언이다. */
export interface TraceRelationUseHop {
  readonly use: TraceEndpoint;
  readonly relation: string;
  readonly column?: string;
  /** 조인이 해석한 선언 측 관계(와 컬럼)다. 해석하지 못하면 없고 gap이 실린다. */
  readonly resolved?: Readonly<{ relation: string; column?: string }>;
  readonly decls: readonly TraceEndpoint[];
  /** route 선택에서 핸들러부터의 정방향 도달 근거다. */
  readonly reachedFrom: readonly TraceReach[];
}

/** relation-decl VertexId 하나와 schemagraph 의존자다. */
export interface TraceDatabaseHop {
  readonly vertex: string;
  /** workspace면 그 선언(카탈로그)을 가진 member다. */
  readonly member?: string;
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
  /** workspace면 공백이 난 member다. */
  readonly member?: string;
  readonly route?: TraceRouteKey;
  readonly symbol?: Readonly<{ platform: string; usr: string }>;
  readonly analysis?: string;
  readonly evidence?: TraceEndpoint;
}

/** 입력 분석의 출처 메타데이터다. */
export interface TraceAnalysisSummary {
  readonly id: string;
  readonly platform: TraversalPlatform;
  readonly role: TraceAnalysisRole;
  readonly member?: string;
  readonly source: string;
  readonly direction: string;
  readonly tool?: Readonly<{ name: string; version: string }>;
  readonly revision?: string;
  /** revision이 분석 문서가 아니라 사전 계산 artifact의 증언에서 왔다. */
  readonly revisionSource?: 'attested';
  readonly precomputed?: TracePrecomputed;
  readonly graphRevision?: string;
  readonly dispatch?: string;
  readonly truncated: boolean;
  readonly rootsTruncated: boolean;
  readonly rootProvenance: 'complete' | 'witness';
  /** 분석이 근거 등급을 분류하는지다. 거짓이면 언어 hop은 `unassessed`(sql은 `direct`)다. */
  readonly evidenceReported: boolean;
  /** 분석이 잇지 못한 호출 수를 신고하는지다. 거짓인 정방향 분석은 `reach-completeness-unknown`이다. */
  readonly unresolvedCallsReported: boolean;
  readonly roots: number;
  readonly reached: number;
}

/** 등급별 도달 근거 수다. */
export type TraceEvidenceCounts = Readonly<Record<TraceEvidence, number>>;

/** workspace 출력의 입력 요약이다. 문서 경로는 싣지 않는다. */
export interface TraceWorkspaceSummary {
  readonly members: ReadonlyArray<Readonly<{
    name: string; project: string; revision: string; catalog?: Readonly<{ graphSha?: string; source?: string }>;
  }>>;
  readonly links: ReadonlyArray<Readonly<{
    name: string; client: string; server: string; match: TraceLinkMatch;
    contract?: Readonly<{ member: string; authoritative?: boolean }>;
  }>>;
}

/** `isthmus-trace` v1 보고서다. 단일 project면 `project`, workspace면 `workspace`가 실린다. */
export interface TraceReport {
  readonly format: 'isthmus-trace';
  readonly version: 1;
  readonly project?: string;
  readonly revision?: string;
  readonly workspace?: TraceWorkspaceSummary;
  readonly complete: false;
  readonly scope: Readonly<{ granularity: 'route'; fieldCompatibility: 'not-assessed'; queryAndHeaders: 'not-assessed' }>;
  readonly selection: TraceSelection;
  readonly chains: readonly TraceChain[];
  readonly gaps: readonly TraceGap[];
  readonly limitations: readonly TraceLimitation[];
  readonly analysisLimitations: ReadonlyArray<Readonly<{ analysis: string; message: string }>>;
  readonly analyses: readonly TraceAnalysisSummary[];
  readonly summary: Readonly<{
    chains: number; routes: number; handlers: number; relationUses: number; databaseVertices: number;
    databaseDependents: number; calls: number; clientSymbols: number; gaps: number;
    /** 보고서의 모든 도달 근거(relation-use·핸들러 reachedFrom, 클라이언트 affected, DB dependents)의 등급별 수다. */
    evidence: TraceEvidenceCounts;
  }>;
}

/** 보고서가 실을 수 있는 hop·정점·gap 총상한이다. 넘으면 부분 결과 대신 실패한다. */
export const MAX_TRACE_OUTPUT_ITEMS = 1_000_000;

/** 개수를 싣는 gap이 문구에 함께 드는 예시 id 수 상한이다. 문구가 무한정 길어지지 않게 한다. */
export const MAX_GAP_EXAMPLES = 5;

/** trace 보고서를 만든다. 같은 입력이면 항상 같은 바이트로 직렬화된다. */
export function createTraceReport(input: TraceInput): TraceReport {
  validateAnalysisMembers(input);
  const prepared = prepareTraceInputs(input.context, input.documents);
  const builder = new TraceBuilder(input, prepared);
  const chains = builder.buildChains();
  const gaps = builder.finishGaps();
  const analyses = [...input.analyses].sort((left, right) => compareStrings(left.id, right.id));
  const { context } = input;
  return {
    format: 'isthmus-trace', version: 1,
    ...(context.project === undefined ? {} : { project: context.project }),
    ...(context.revision === undefined ? {} : { revision: context.revision }),
    ...(context.workspace === undefined ? {} : { workspace: summarizeWorkspace(context) }),
    complete: false,
    scope: { granularity: 'route', fieldCompatibility: 'not-assessed', queryAndHeaders: 'not-assessed' },
    selection: context.selection,
    chains, gaps, limitations: prepared.limitations,
    analysisLimitations: analyses.flatMap(({ id, graph }) => graph.limitations.map((message) => ({ analysis: id, message }))),
    analyses: analyses.map(summarizeAnalysis),
    summary: summarize(chains, gaps.length),
  };
}

/** `--strict`가 실패로 볼 공백이 있는지다. trace는 완전성을 주장하지 않으므로 gap만 본다. */
export function hasTraceGaps(report: TraceReport): boolean {
  return report.gaps.length > 0;
}

/** workspace 분석은 member에 속해야 하고, 단일 project 분석은 member가 없어야 한다. */
function validateAnalysisMembers({ context, analyses }: TraceInput): void {
  const members = new Set(context.workspace?.members.map(({ name }) => name) ?? []);
  for (const analysis of analyses) {
    const valid = context.workspace === undefined ? analysis.member === undefined
      : analysis.member !== undefined && members.has(analysis.member);
    if (!valid) throw new TraceInputError('Every workspace analysis must belong to a member, and single-project analyses must not.');
  }
}

/** 한 relation-use 사실과 조인 해석이다. */
interface UseRecord {
  readonly member: string;
  readonly platform: BridgePlatform;
  readonly fact: BridgeFact;
  readonly endpoint: TraceEndpoint;
  readonly usr?: string;
  readonly match?: PersistenceMatch;
  /** 조인이 해석한 선언 끝점(member 포함)이다. */
  readonly decls: readonly TraceEndpoint[];
  /** dynamic 사실은 조인이 잇지 않으므로 이름 해석과 무관하게 항상 `dynamic`이다. */
  readonly outcome: 'resolved' | 'missing' | 'ambiguous' | 'column-missing' | 'dynamic';
  /** 모호한 비한정 사용의 후보 선언 이름이다. */
  readonly candidates?: readonly string[];
}

/** 역방향 선택의 시작 심볼이다. */
interface StartSymbol {
  readonly member: string;
  readonly platform: BridgePlatform;
  readonly usr: string;
}

/** 분석 root 적중이다. */
interface RootHit {
  readonly analysis: TraceAnalysis;
  readonly rootIndex: number;
}

/** DB hop을 만들 선언 끝점 묶음이다. */
interface DeclGroup {
  readonly member: string;
  readonly decls: readonly TraceEndpoint[];
}

/** 체인과 gap을 모으는 작업 상태다. 입력 색인을 한 번만 만든다. */
class TraceBuilder {
  private readonly gaps = new Map<string, TraceGap>();
  private readonly uses: UseRecord[] = [];
  private readonly usesBySymbol = new Map<string, UseRecord[]>();
  private readonly relationDecls = new Map<string, TraceEndpoint[]>();
  private readonly members: ReadonlyMap<string, TraceMemberInput>;
  private readonly scopes: readonly TraceLinkedScope[];
  private readonly declsByHandler = new Map<string, Array<{ scope: TraceLinkedScope; fact: RouteDeclarationFact }>>();
  private readonly roots = new Map<string, RootHit[]>();
  private readonly rowsByRoot = new Map<TraceAnalysis, Map<number, TraversalReached[]>>();
  private readonly workspace: boolean;
  private outputItems = 0;

  private readonly input: TraceInput;
  private readonly prepared: PreparedTrace;

  constructor(input: TraceInput, prepared: PreparedTrace) {
    this.input = input;
    this.prepared = prepared;
    this.workspace = prepared.workspace;
    this.members = new Map(prepared.members.map((member) => [member.key, member]));
    this.scopes = prepared.scopes;
    for (const member of prepared.members) this.indexRelations(member);
    this.indexHandlers();
    this.indexAnalyses();
  }

  /** 선택 종류별로 체인을 만든다. 선택은 context 파서가 이미 정렬했다. */
  buildChains(): TraceChain[] {
    this.addRevisionGaps();
    this.addCoverageGaps();
    const selection = this.input.context.selection;
    if ('routes' in selection) return selection.routes.flatMap((route) => this.routeChain({ route }));
    if ('relations' in selection) {
      return selection.relations.flatMap((item) => this.relationChain(typeof item === 'string'
        ? { relation: item } : { relation: item.name, member: item.member }));
    }
    if ('files' in selection) {
      return selection.files.flatMap((item) => this.fileChain(typeof item === 'string'
        ? { file: item } : { file: item.path, member: item.member }));
    }
    return selection.symbols.map((symbol) => this.symbolChain({ symbol }));
  }

  /** gap을 결정적 순서로 돌려준다. */
  finishGaps(): TraceGap[] {
    return [...this.gaps.entries()].sort(([left], [right]) => compareStrings(left, right)).map(([, gap]) => gap);
  }

  /** route 선택 하나의 체인이다. 선언 측 키가 없으면 체인 없이 gap만 남긴다. */
  private routeChain(selector: { route: TraceRouteSelection }): TraceChain[] {
    const { method, template, scope } = selector.route;
    const scopes = this.scopes.filter((candidate) => scope === undefined || candidate.scope.scope === scope);
    const found = scopes.flatMap((candidate) => {
      const hop = this.routeHop(selector, candidate, method, template);
      return hop === undefined ? [] : [{ linked: candidate, ...hop }];
    });
    if (found.length === 0) {
      this.gap({ code: 'route-without-decl', selector,
        detail: 'No route-decl or route-contract fact has exactly this method and template in the selected scope.' });
      return [];
    }
    const handlers = new Map<string, TraceHandlerHop>();
    const uses = new Map<string, MutableUse>();
    for (const { linked, declFacts } of found) {
      const key = routeKey(linked.scope.scope, method, template);
      for (const fact of declFacts) {
        const usr = fact.endpoint.symbol?.usr;
        if (usr === undefined) {
          this.gap({ code: 'handler-without-symbol', selector, route: key, evidence: this.endpoint(linked.server, fact.endpoint),
            detail: 'The route declaration carries no symbol.usr, so its handler cannot be followed into the language graph.' });
          continue;
        }
        this.addHandler(handlers, linked.server, fact.endpoint.platform, usr, fact.endpoint.symbol?.qualifiedName, key, undefined);
        this.forwardUses(selector, linked.server, fact.endpoint.platform, usr, uses);
      }
      // 테스트 소스 decl만 있는 경우는 test-source-omitted가 이미 밝힌다. 계약만 있는 route만 여기서 남긴다.
      // found의 scope에는 decl이나 contract가 있으므로 decl이 없으면 계약만 있는 route다.
      if (!linked.scope.decls.some(({ declaration }) => declaration.method === method && declaration.template === template)) {
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
      database: this.database(selector, declGroups(uses)),
    })];
  }

  /** relation 선택 하나의 체인이다. persistence는 member 밖으로 나가지 않으므로 그 member 안에서만 찾는다. */
  private relationChain(selector: { relation: string; member?: string }): TraceChain[] {
    const member = selector.member ?? '';
    const { resolver } = this.members.get(member)!;
    const memberUses = this.uses.filter((use) => use.member === member);
    const outcome = resolver.resolveUse(selector.relation);
    if (outcome.status === 'ambiguous') {
      this.gap({ code: 'relation-selection-ambiguous', selector, ...this.memberField(member),
        detail: `The relation name matches several declarations (${outcome.candidates.join(', ')}); select a qualified name.` });
      return [];
    }
    const target = outcome.status === 'resolved' ? resolver.declKey(outcome.channel) : resolver.useKey(selector.relation);
    const uses = memberUses.filter((use) => use.outcome !== 'dynamic' && resolver.useKey(use.fact.channel!) === target);
    if (outcome.status === 'resolved') {
      for (const use of memberUses) {
        if (use.candidates?.includes(outcome.channel) === true) {
          this.gap({ code: 'relation-use-ambiguous', selector, evidence: use.endpoint,
            detail: 'This unqualified relation use may refer to the selected relation among other candidates; it is not followed.' });
        }
      }
    }
    // dynamic 사용은 원문 식이 이름이 아니라 어느 relation을 가리키는지 모른다. hop으로 싣지 않고 모두 gap으로 밝힌다.
    const dynamicUses = memberUses.filter((use) => use.outcome === 'dynamic');
    for (const use of dynamicUses) this.useOutcomeGap(selector, use);
    if (outcome.status === 'missing') {
      this.gap({ code: 'relation-without-decl', selector, ...this.memberField(member),
        detail: 'No relation-decl matches this name, so no schema vertex or database dependents can be followed.' });
      if (uses.length === 0) return [];
    } else if (uses.length === 0) {
      this.gap({ code: 'relation-without-use', selector, ...this.memberField(member),
        detail: dynamicUses.length === 0
          ? 'No relation-use of this relation was observed in the scanned code; this is not evidence that no code uses it.'
          : `No literal relation-use of this relation was observed; ${dynamicUses.length} relation use(s) with a `
            + 'non-literal name may refer to it.' });
    }
    const { hops, starts } = this.useHops(selector, uses);
    const declared = outcome.status === 'resolved' ? this.relationDecls.get(memberKey(member, target)) ?? [] : [];
    const reverse = this.reverseRoutes(selector, uniqueStarts(starts));
    return [this.count({ selector, ...reverse, relationUses: finishUses(hops),
      database: this.database(selector, [{ member, decls: declared }, ...declGroups(hops)]) })];
  }

  /** relation-use 사실들을 hop으로 모으고, usr가 있는 사용을 역방향 시작 심볼로 돌려준다. */
  private useHops(selector: TraceSelector, uses: readonly UseRecord[]): { hops: Map<string, MutableUse>; starts: StartSymbol[] } {
    const hops = new Map<string, MutableUse>();
    const starts: StartSymbol[] = [];
    for (const use of uses) {
      addUse(hops, use, undefined);
      if (use.usr === undefined) {
        this.gap({ code: 'relation-use-without-symbol', selector, evidence: use.endpoint,
          detail: 'The relation use carries no symbol.usr, so it cannot be followed into the language graph.' });
      } else {
        starts.push({ member: use.member, platform: use.platform, usr: use.usr });
      }
      this.useOutcomeGap(selector, use);
    }
    return { hops, starts };
  }

  /** 심볼 선택 하나의 체인이다. */
  private symbolChain(selector: { symbol: TraceSymbolSelection }): TraceChain {
    const { member, platform, usr } = selector.symbol;
    return this.count({ selector, ...this.reverseRoutes(selector, [{ member: member ?? '', platform, usr }]),
      relationUses: [], database: [] });
  }

  /**
   * 파일 선택 하나의 체인이다 — 파일 단위 과대 근사다.
   *
   * 그 member의 분석이 이 파일에 위치시킨 심볼(root·도달 정점)과, 이 파일에 위치한 사실(route-decl·route-call·
   * relation-use)의 `symbol.usr`(사실 위치 fallback)를 모두 바뀐 것으로 보고 역방향으로 route·클라이언트를 찾는다.
   * 이 파일에 위치한 relation-use는 hop과 DB 의존자로 싣는다. 바뀐 줄을 모르므로 항상 `file-selection-coarse`를
   * 남기고, 아무것도 찾지 못하면 없음이 아니라 `file-without-symbols`다.
   */
  private fileChain(selector: { file: string; member?: string }): TraceChain[] {
    const member = selector.member ?? '';
    const located = this.locatedAnalysisSymbols(member, selector.file);
    const facts = this.locatedFactSymbols(member, selector.file).filter((start) =>
      !located.some((other) => other.platform === start.platform && other.usr === start.usr));
    const uses = this.uses.filter((use) => use.member === member && use.fact.location?.path === selector.file);
    if (located.length === 0 && facts.length === 0 && uses.length === 0) {
      this.gap({ code: 'file-without-symbols', selector, ...this.memberField(member),
        detail: 'No analysis symbol or bridge fact is located in this file, so nothing was followed; this is not evidence '
          + 'that the file affects no route (producers may not report locations, or the file is outside their scan).' });
      return [];
    }
    this.gap({ code: 'file-selection-coarse', selector, ...this.memberField(member),
      detail: `File selection is a file-level over-approximation: ${located.length} symbol(s) located by analyses and `
        + `${facts.length} more located by bridge facts are all treated as changed, so routes reached only through `
        + 'unchanged symbols of this file may be reported.' + (located.length > 0 ? ''
        : ' No analysis locates a symbol in this file, so only fact locations were used (fact-location fallback); '
          + 'symbols of this file without facts are missing.') });
    // dynamic 사용의 원문 식은 관계 이름이 아니므로 hop으로 싣지 않고 gap 증거로만 남긴다.
    for (const use of uses) if (use.outcome === 'dynamic') this.useOutcomeGap(selector, use);
    const { hops } = this.useHops(selector, uses.filter(({ outcome }) => outcome !== 'dynamic'));
    const reverse = this.reverseRoutes(selector, uniqueStarts([...located, ...facts]));
    return [this.count({ selector, ...reverse, relationUses: finishUses(hops), database: this.database(selector, declGroups(hops)) })];
  }

  /** member의 언어 분석(sql 제외)이 이 파일에 위치시킨 root·도달 심볼이다. */
  private locatedAnalysisSymbols(member: string, path: string): StartSymbol[] {
    const found: StartSymbol[] = [];
    for (const analysis of this.input.analyses) {
      if ((analysis.member ?? '') !== member || analysis.platform === 'sql') continue;
      const symbols = [...analysis.graph.roots.flatMap(({ symbol }) => symbol === undefined ? [] : [symbol]),
        ...analysis.graph.reached.map(({ symbol }) => symbol)];
      for (const symbol of symbols) {
        if (symbol.location?.path === path) found.push({ member, platform: analysis.platform, usr: symbol.usr });
      }
    }
    return uniqueStarts(found);
  }

  /** member 문서에서 이 파일에 위치한 사실의 `symbol.usr`다(sql·openapi 제외). */
  private locatedFactSymbols(member: string, path: string): StartSymbol[] {
    const found: StartSymbol[] = [];
    for (const document of this.members.get(member)!.documents) {
      if (document.platform === 'sql' || document.platform === 'openapi') continue;
      for (const fact of document.facts) {
        const usr = fact.symbol?.usr;
        if (usr !== undefined && fact.location?.path === path) found.push({ member, platform: document.platform, usr });
      }
    }
    return uniqueStarts(found);
  }

  /**
   * 시작 심볼들에서 역방향 순회로 route 핸들러를 찾고 그 route의 클라이언트 hop을 만든다.
   * 핸들러에 닿지 못한 시작점은 `non-http-entry`로 남긴다. 순회와 핸들러는 시작 심볼의 member 안에서만 찾는다.
   */
  private reverseRoutes(selector: TraceSelector, starts: readonly StartSymbol[]): Pick<TraceChain, 'routes' | 'handlers'> {
    const handlers = new Map<string, TraceHandlerHop>();
    const routes = new Map<string, TraceRouteKey>();
    for (const start of starts) {
      const reach = new Map<string, TraceReach>([[start.usr, selfReach(start.usr)]]);
      for (const { analysis, rows } of this.rootedRows(selector, start.member, 'reverse', start.platform, start.usr)) {
        for (const row of rows) keepNearest(reach, row.symbol.usr, reachOf(start.usr, analysis, row));
      }
      let found = false;
      for (const [usr, via] of [...reach.entries()].sort(([left], [right]) => compareStrings(left, right))) {
        for (const { scope, fact } of this.declsByHandler.get(memberSymbolKey(start.member, start.platform, usr)) ?? []) {
          found = true;
          const key = routeKey(scope.scope.scope, fact.declaration.method, fact.declaration.template);
          routes.set(JSON.stringify([key.scope, key.template, key.method]), key);
          this.addHandler(handlers, start.member, start.platform, usr, fact.endpoint.symbol?.qualifiedName, key, via);
        }
      }
      if (!found) {
        this.gap({ code: 'non-http-entry', selector, ...this.memberField(start.member), symbol: { platform: start.platform, usr: start.usr },
          detail: 'No route-decl handler was reached from this symbol; it may be reached only from non-http entry points '
            + '(scheduled jobs, queues, CLIs) or the reverse traversal is incomplete.' });
      }
    }
    const hops = [...routes.values()].sort(compareRouteKeys).flatMap((key) => {
      const linked = this.scopes.find((candidate) => candidate.scope.scope === key.scope)!;
      return [this.routeHop(selector, linked, key.method, key.template)!.hop];
    });
    return { routes: hops, handlers: sortHandlers(handlers) };
  }

  /**
   * 한 scope에서 route 키 하나의 선언 측 증거와 클라이언트 hop을 만든다.
   * 선언 측 사실이 없으면 undefined다. 테스트 소스 사실은 기본으로 뺀다.
   */
  private routeHop(selector: TraceSelector, linked: TraceLinkedScope, method: RouteMethod, template: string):
    { hop: TraceRouteHop; declFacts: RouteDeclarationFact[] } | undefined {
    const { scope } = linked;
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
          this.gap({ code: 'ambiguous-route-call', selector, route: key, evidence: this.endpoint(linked.client, call.endpoint),
            detail: 'This attributed call is ambiguous between this route and another declaration; it is not followed.' });
        }
        continue;
      }
      if (call.testSource) {
        testSources += 1;
        continue;
      }
      calls.push({
        call: this.endpoint(linked.client, call.endpoint), side: matched.side, quality: matched.quality,
        affected: this.callAffected(selector, key, linked.client, call.endpoint),
      });
    }
    this.routeScopeGaps(selector, key, linked, testSources);
    return {
      hop: {
        ...key,
        declarations: declFacts.map(({ endpoint }) => this.endpoint(linked.server, endpoint)).sort(compareEndpoints),
        contracts: contractAll.map(({ endpoint }) => this.endpoint(linked.contract, endpoint)).sort(compareEndpoints),
        calls: calls.sort((left, right) => compareEndpoints(left.call, right.call) || compareStrings(left.side, right.side)),
      },
      declFacts,
    };
  }

  /** route hop 하나에 딸린 scope 수준 공백(테스트 소스, 호출 측 미스캔, 미귀속·동적 호출)이다. */
  private routeScopeGaps(selector: TraceSelector, key: TraceRouteKey, { scope }: TraceLinkedScope, testSources: number): void {
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
  }

  /** 호출을 감싼 심볼의 클라이언트 역방향 영향이다. client member의 분석만 쓴다. */
  private callAffected(selector: TraceSelector, route: TraceRouteKey, member: string, endpoint: BridgeEndpoint): TraceAffected[] {
    const usr = endpoint.symbol?.usr;
    if (usr === undefined) {
      this.gap({ code: 'call-without-symbol', selector, route, evidence: this.endpoint(member, endpoint),
        detail: 'The route call carries no symbol.usr, so affected client code cannot be followed.' });
      return [];
    }
    return affectedRows(this.rootedRows(selector, member, 'reverse', endpoint.platform, usr));
  }

  /** 핸들러에서 정방향으로 닿은 relation-use를 모은다. 핸들러 자신의 사실도 포함한다. */
  private forwardUses(selector: TraceSelector, member: string, platform: BridgePlatform, handler: string,
    uses: Map<string, MutableUse>): void {
    const reach = new Map<string, TraceReach>([[handler, selfReach(handler)]]);
    for (const { analysis, rootIndex, rows } of this.rootedRows(selector, member, 'forward', platform, handler)) {
      for (const row of rows) keepNearest(reach, row.symbol.usr, reachOf(handler, analysis, row));
      this.completenessGap(selector, member, platform, handler, analysis, rootIndex, rows);
    }
    for (const [usr, via] of reach) {
      for (const use of this.usesBySymbol.get(memberSymbolKey(member, platform, usr)) ?? []) {
        // dynamic 사용의 원문 식은 관계 이름이 아니므로 hop으로 싣지 않고 gap 증거로만 남긴다.
        if (use.outcome !== 'dynamic') addUse(uses, use, via);
        this.useOutcomeGap(selector, use);
      }
    }
  }

  /**
   * 핸들러에서 시작한 정방향 도달이 끊겼을 수 있는지 밝힌다.
   *
   * 핸들러 자신이나 핸들러에서 닿은 정점에 생산자가 잇지 못한 호출이 있으면 그 너머의 relation-use가 빠졌을 수
   * 있다(`reach-possibly-incomplete`). 분석이 잇지 못한 호출을 아예 신고하지 않으면 0인지 모르므로 거친 변형
   * (`reach-completeness-unknown`)을 남긴다 — 어느 쪽이든 완전성을 주장하지 않는다.
   */
  private completenessGap(selector: TraceSelector, member: string, platform: BridgePlatform, handler: string,
    analysis: TraceAnalysis, rootIndex: number, rows: readonly TraversalReached[]): void {
    const { graph } = analysis;
    if (!graph.unresolvedCallsReported) {
      this.gap({ code: 'reach-completeness-unknown', selector, analysis: analysis.id,
        detail: 'This forward analysis does not report unresolved call sites, so relation uses behind unlinked calls '
          + '(dynamic dispatch, callbacks, unresolved imports) may be missing without any signal.' });
      return;
    }
    const cut = [{ usr: handler, count: graph.roots[rootIndex]!.unresolvedCalls ?? 0 },
      ...rows.map((row) => ({ usr: row.symbol.usr, count: row.unresolvedCalls ?? 0 }))].filter(({ count }) => count > 0);
    if (cut.length === 0) return;
    const total = cut.reduce((sum, { count }) => sum + count, 0);
    this.gap({ code: 'reach-possibly-incomplete', selector, analysis: analysis.id, ...this.memberField(member),
      symbol: { platform, usr: handler },
      detail: `${total} outgoing call site(s) in ${cut.length} symbol(s) reachable from this handler could not be linked `
        + `by the producer, so relation uses behind them may be missing (e.g. ${examples(cut.map(({ usr }) => usr))}).` });
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

  /** relation-decl VertexId별 schemagraph 의존자다. 카탈로그는 member마다 따로라 (member, VertexId)로 묶는다. */
  private database(selector: TraceSelector, groups: readonly DeclGroup[]): TraceDatabaseHop[] {
    const vertices = new Map<string, { member: string; vertex: string }>();
    for (const { member, decls } of groups) {
      for (const decl of decls) {
        const usr = decl.symbol?.usr;
        if (usr === undefined) {
          this.gap({ code: 'relation-decl-without-symbol', selector, evidence: decl,
            detail: 'The relation declaration carries no symbol.usr (schemagraph VertexId), so database dependents cannot be followed.' });
        } else {
          vertices.set(memberKey(member, usr), { member, vertex: usr });
        }
      }
    }
    return [...vertices.values()]
      .sort((left, right) => compareStrings(left.member, right.member) || compareStrings(left.vertex, right.vertex))
      .map(({ member, vertex }) => ({
        vertex, ...this.memberField(member),
        dependents: affectedRows(this.rootedRows(selector, member, 'db-dependents', 'sql', vertex)),
      }));
  }

  /**
   * member·역할·플랫폼·root id로 분석을 찾아 그 root에서 닿은 정점을 돌려준다.
   * 분석이 없으면 `analysis-missing`, 잘렸거나 root 귀속이 부분적이면 해당 gap을 남긴다.
   */
  private rootedRows(selector: TraceSelector, member: string, role: TraceAnalysisRole, platform: BridgePlatform | 'sql',
    id: string): Array<{ analysis: TraceAnalysis; root: string; rootIndex: number; rows: TraversalReached[] }> {
    const hits = this.roots.get(JSON.stringify([member, role, platform, id])) ?? [];
    if (hits.length === 0) {
      this.gap({ code: 'analysis-missing', selector, ...this.memberField(member), symbol: { platform, usr: id },
        detail: `No ${role} analysis is rooted at this ${platform} id${this.workspace ? ' in this member' : ''}, `
          + 'so this hop cannot be followed.' });
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
      return { analysis, root: id, rootIndex, rows: this.rowsByRoot.get(analysis)!.get(rootIndex) ?? [] };
    });
  }

  /**
   * 분석 revision이 기준과 다르면 stale gap을 남긴다. 기준은 단일 project면 context revision(없으면 분석끼리),
   * workspace면 member revision이다 — 저장소가 다르면 revision도 다르므로 member 사이에서는 비교하지 않는다.
   */
  private addRevisionGaps(): void {
    const { context, analyses } = this.input;
    if (context.workspace === undefined) {
      this.revisionGroupGaps({ member: '', analyses, ...(context.revision === undefined ? {} : { expected: context.revision }) });
      return;
    }
    for (const { name, revision, catalog } of context.workspace.members) {
      const graphSha = catalog?.graphSha;
      this.revisionGroupGaps({ member: name, expected: revision, analyses: analyses.filter((analysis) => analysis.member === name),
        ...(graphSha === undefined ? {} : { graphSha }) });
    }
  }

  /**
   * revision 비교 단위(단일 project 전체 또는 member 하나)의 stale·unknown gap이다.
   * member 카탈로그가 `graphSha`를 선언하면 그 member의 sql 분석은 소스 revision 대신 graphRevision을 그 값과 비교한다.
   */
  private revisionGroupGaps(group: RevisionGroup): void {
    const { member, expected, graphSha, analyses } = group;
    const bySource = analyses.filter((analysis) => graphSha === undefined || analysis.platform !== 'sql');
    const revisions = new Set(bySource.flatMap(({ revision }) => revision === undefined ? [] : [revision]));
    const subject = this.workspace ? 'The workspace member' : 'The trace context';
    for (const { id, revision } of bySource) {
      if (expected !== undefined && revision === undefined) {
        this.gap({ code: 'analysis-revision-unknown', analysis: id, ...this.memberField(member),
          detail: `${subject} declares a revision but this analysis carries none, so its freshness is unverified.` });
      } else if (expected === undefined && revision === undefined && revisions.size > 0) {
        this.gap({ code: 'analysis-revision-unknown', analysis: id,
          detail: 'Other analyses carry a revision but this one has none, so they cannot be checked against each other.' });
      } else if (revision !== undefined && (expected === undefined ? revisions.size > 1 : revision !== expected)) {
        this.gap({ code: 'stale-analysis', analysis: id, ...this.memberField(member),
          detail: this.workspace ? 'This analysis revision differs from its workspace member revision.'
            : 'This analysis revision differs from the trace context revision or from other analyses.' });
      }
    }
    if (graphSha !== undefined) this.catalogGaps(member, graphSha, analyses.filter(({ platform }) => platform === 'sql'));
    for (const platform of new Set(analyses.map(({ platform: value }) => value))) {
      const same = analyses.filter((analysis) => analysis.platform === platform && analysis.graph.graphRevision !== undefined);
      if (new Set(same.map(({ graph }) => graph.graphRevision)).size <= 1) continue;
      for (const { id } of same) {
        this.gap({ code: 'stale-analysis', analysis: id, ...this.memberField(member),
          detail: 'Analyses of this platform were computed from different graph revisions.' });
      }
    }
  }

  /** member 카탈로그 `graphSha`와 sql 분석 graphRevision을 대조한다. */
  private catalogGaps(member: string, graphSha: string, analyses: readonly TraceAnalysis[]): void {
    for (const { id, graph } of analyses) {
      if (graph.graphRevision === undefined) {
        this.gap({ code: 'analysis-revision-unknown', analysis: id, member,
          detail: 'The member catalog declares a graphSha but this sql analysis carries no graphRevision, so it may '
            + 'describe another catalog.' });
      } else if (graph.graphRevision !== graphSha) {
        this.gap({ code: 'stale-analysis', analysis: id, member,
          detail: 'This sql analysis graphRevision differs from the member catalog graphSha.' });
      }
    }
  }

  /** 입력에 없는 측(http 선언·persistence 문서), usr 없는 사용, link에 속하지 않은 http 문서를 전역 gap으로 남긴다. */
  private addCoverageGaps(): void {
    const selection = this.input.context.selection;
    if (!('symbols' in selection)) {
      for (const member of this.persistenceMembers()) {
        const hasCaller = member.documents.some(({ target, platform }) => target === 'persistence' && platform !== 'sql');
        const hasSql = member.documents.some(({ platform, target }) => platform === 'sql' && target === 'persistence');
        if (hasCaller && hasSql) continue;
        this.gap({ code: 'persistence-unscanned', ...this.memberField(member.key),
          detail: `The ${this.workspace ? 'member' : 'context'} lacks a persistence caller document or a sql declaration `
            + 'document, so database hops are incomplete.' });
      }
    }
    if (!('routes' in selection) && this.scopes.every(({ scope }) => !scope.declScanned)) {
      this.gap({ code: 'http-server-unscanned',
        detail: 'No server-role http document scanned route declarations, so handlers cannot be matched to routes.' });
    }
    if ('routes' in selection) this.unsymbolizedUseGaps();
    this.unlinkedMemberGaps();
  }

  /** route 선택에서 usr 없는 relation-use를 member·플랫폼별 개수로 남긴다. */
  private unsymbolizedUseGaps(): void {
    const counts = new Map<string, { member: string; platform: string; count: number }>();
    for (const use of this.uses) {
      if (use.usr !== undefined) continue;
      const key = memberKey(use.member, use.platform);
      const entry = counts.get(key) ?? { member: use.member, platform: use.platform, count: 0 };
      counts.set(key, { ...entry, count: entry.count + 1 });
    }
    for (const { member, platform, count } of counts.values()) {
      this.gap({ code: 'relation-use-without-symbol', ...this.memberField(member),
        detail: `${count} ${platform} relation use(s) carry no symbol.usr and cannot be attributed to any handler.` });
    }
  }

  /**
   * persistence 공백을 볼 member다. 단일 project면 그 하나, workspace면 persistence 문서가 있거나 link의 server인
   * member다 — DB를 쓰지 않는 클라이언트 member에 거짓 공백을 만들지 않기 위해서다.
   */
  private persistenceMembers(): TraceMemberInput[] {
    if (!this.workspace) return [...this.members.values()];
    const servers = new Set(this.input.context.workspace!.links.map(({ server }) => server));
    return [...this.members.values()].filter((member) => servers.has(member.key) ||
      member.documents.some(({ target }) => target === 'persistence'));
  }

  /** workspace에서 어떤 link에도 해당 역할로 속하지 않은 member의 http 문서를 gap으로 밝힌다. */
  private unlinkedMemberGaps(): void {
    const links = this.input.context.workspace?.links;
    if (links === undefined) return;
    for (const member of this.members.values()) {
      const http = member.documents.filter(({ target }) => target === 'http');
      if (http.some(isClientDocument) && !links.some(({ client }) => client === member.key)) {
        this.gap({ code: 'http-member-unlinked', member: member.key,
          detail: 'This member has client-role http documents but no workspace link uses it as a client, so its calls '
            + 'are not matched to any server.' });
      }
      if (http.some(isDeclarationDocument) &&
        !links.some(({ server, contract }) => server === member.key || contract?.member === member.key)) {
        this.gap({ code: 'http-member-unlinked', member: member.key,
          detail: 'This member has server-role http documents but no workspace link uses it as a server or contract, '
            + 'so its routes are not matched to any caller or handler chain.' });
      }
    }
  }

  /** member의 persistence 문서 relation-use를 조인 해석과 함께 색인한다. 매칭 규칙은 조인 해석기를 재사용한다. */
  private indexRelations(member: TraceMemberInput): void {
    const matches = createPersistenceMatches(member.joined);
    const byKey = new Map(matches.map((match) => [relationDeclKey(match.key.relation, match.key.column), match]));
    for (const match of matches) {
      if (match.key.column === undefined) {
        this.relationDecls.set(memberKey(member.key, relationDeclKey(match.key.relation)),
          match.decls.map((decl) => this.endpoint(member.key, decl)));
      }
    }
    for (const unused of member.joined.relationDeclsWithoutUses) {
      this.relationDecls.set(memberKey(member.key, relationDeclKey(unused.channel)),
        unused.decls.map((decl) => this.endpoint(member.key, decl)));
    }
    for (const document of member.documents) {
      if (document.target !== 'persistence' || document.platform === 'sql') continue;
      for (const fact of document.facts) {
        if (fact.kind === 'relation-use' && fact.channel !== null) this.indexUse(member, document, fact, byKey);
      }
    }
  }

  /** relation-use 사실 하나를 색인한다. dynamic 원문 식은 관계 이름이 아니므로 해석하지 않는다(조인과 같다). */
  private indexUse(member: TraceMemberInput, document: BridgeFactsDocument, fact: BridgeFact,
    byKey: ReadonlyMap<string, PersistenceMatch>): void {
    const endpoint = this.endpoint(member.key, { platform: document.platform,
      ...(fact.location === undefined ? {} : { location: fact.location }),
      ...(fact.symbol === undefined ? {} : { symbol: fact.symbol }) });
    const resolution = fact.dynamic ? undefined : member.resolver.resolveUse(fact.channel!);
    const match = resolution?.status === 'resolved' ? byKey.get(member.resolver.useKey(fact.channel!, fact.method)) : undefined;
    const outcome = resolution === undefined ? 'dynamic'
      : resolution.status !== 'resolved' ? resolution.status : match === undefined ? 'column-missing' : 'resolved';
    const record: UseRecord = { member: member.key, platform: document.platform, fact, endpoint,
      ...(fact.symbol?.usr === undefined ? {} : { usr: fact.symbol.usr }),
      ...(match === undefined ? {} : { match }),
      decls: (match?.decls ?? []).map((decl) => this.endpoint(member.key, decl)), outcome,
      ...(resolution?.status === 'ambiguous' ? { candidates: resolution.candidates } : {}) };
    this.uses.push(record);
    if (record.usr !== undefined) {
      const key = memberSymbolKey(record.member, record.platform, record.usr);
      this.usesBySymbol.set(key, [...(this.usesBySymbol.get(key) ?? []), record]);
    }
  }

  /** route-decl 핸들러 (server member, usr)별 선언 사실 색인이다. 테스트 소스 decl은 역방향 체인에서 뺀다. */
  private indexHandlers(): void {
    for (const linked of this.scopes) {
      for (const fact of linked.scope.decls) {
        const usr = fact.endpoint.symbol?.usr;
        if (usr === undefined || fact.testSource) continue;
        const key = memberSymbolKey(linked.server, fact.endpoint.platform, usr);
        this.declsByHandler.set(key, [...(this.declsByHandler.get(key) ?? []), { scope: linked, fact }]);
      }
    }
  }

  /** 분석의 (member, 역할, 플랫폼, root id) 색인과 root별 도달 정점 목록을 만든다. */
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
        const key = JSON.stringify([analysis.member ?? '', analysis.role, analysis.platform, id]);
        this.roots.set(key, [...(this.roots.get(key) ?? []), { analysis, rootIndex }]);
      });
    }
  }

  /** 핸들러 hop을 합친다. route 키와 도달 근거는 중복 없이 모은다. */
  private addHandler(handlers: Map<string, TraceHandlerHop>, member: string, platform: BridgePlatform, usr: string,
    qualifiedName: string | undefined, route: TraceRouteKey, reach: TraceReach | undefined): void {
    const key = memberSymbolKey(member, platform, usr);
    const existing = handlers.get(key);
    const routes = new Map((existing?.routes ?? []).map((item) => [JSON.stringify(item), item]));
    routes.set(JSON.stringify(route), route);
    const reached = new Map((existing?.reachedFrom ?? []).map((item) => [item.from, item]));
    if (reach !== undefined) keepNearest(reached, reach.from, reach);
    const name = existing?.qualifiedName ?? qualifiedName;
    handlers.set(key, {
      platform, usr, ...this.memberField(member),
      ...(name === undefined ? {} : { qualifiedName: name }),
      routes: [...routes.values()].sort(compareRouteKeys),
      reachedFrom: [...reached.values()].sort((left, right) => compareStrings(left.from, right.from)),
    });
  }

  /** 조인 끝점을 출력 끝점으로 바꾼다. workspace면 member를 붙인다. */
  private endpoint(member: string, endpoint: BridgeEndpoint | PairEndpoint): TraceEndpoint {
    return { ...toPairEndpoint(endpoint), ...this.memberField(member) };
  }

  /** workspace면 `{member}`, 단일 project면 빈 객체다 — 단일 project 출력 바이트를 그대로 둔다. */
  private memberField(member: string): { member?: string } {
    return this.workspace ? { member } : {};
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
    this.candidateGaps(chain);
    const affected = (rows: readonly { affected: readonly unknown[] }[]) => rows.reduce((sum, row) => sum + row.affected.length, 0);
    this.bump(chain.routes.reduce((sum, route) => sum + 1 + route.declarations.length + route.contracts.length +
      route.calls.length + affected(route.calls), 0) + chain.handlers.length + chain.relationUses.length +
      chain.database.reduce((sum, hop) => sum + 1 + hop.dependents.length, 0));
    return chain;
  }

  /** 목격 경로가 부분적인 정점마다 gap을 남긴다. 경로를 지어내지 않았다는 표시다. */
  private witnessGaps(chain: TraceChain): void {
    const partial = (analysis: string | undefined, member: string | undefined, platform: string, usr: string) => this.gap({
      code: 'witness-partial', selector: chain.selector, ...(analysis === undefined ? {} : { analysis }),
      ...optionalMember(member), symbol: { platform, usr },
      detail: 'The producer witness for this root entry leads back to the root itself (a cycle); the depth is authoritative '
        + 'but the path from the other root is unknown and not reconstructed.' });
    const affected = [...chain.routes.flatMap(({ calls }) => calls.flatMap((call) => call.affected)),
      ...chain.database.flatMap(({ dependents }) => dependents)];
    for (const row of affected) if (row.witnessPartial) partial(row.analysis, row.member, row.platform, row.usr);
    for (const handler of chain.handlers) {
      for (const reach of handler.reachedFrom) {
        if (reach.witnessPartial) partial(reach.analysis, handler.member, handler.platform, handler.usr);
      }
    }
    for (const use of chain.relationUses) {
      // 도달 근거의 경로 끝은 그 사용을 감싼 심볼의 생산자 id다. 사실의 symbol 필드에 기대지 않는다.
      for (const reach of use.reachedFrom) {
        if (reach.witnessPartial) partial(reach.analysis, use.use.member, use.use.platform, reach.path[reach.path.length - 1]!);
      }
    }
  }

  /**
   * 가능성만 있는 구현 간선(`candidate`)으로만 뒷받침되는 hop마다 gap을 남긴다. hop은 그대로 싣고 등급을 표시한다.
   * relation-use·핸들러 도달은 hop마다, 클라이언트·DB 영향 목록은 시작 심볼과 분석별로 개수와 예시를 묶는다.
   * `bound`는 품질로만 보이고 gap을 만들지 않는다.
   */
  private candidateGaps(chain: TraceChain): void {
    const { selector } = chain;
    for (const use of chain.relationUses) {
      for (const reach of use.reachedFrom) {
        if (reach.evidence !== 'candidate') continue;
        this.gap({ code: 'candidate-dispatch', selector, ...optionalAnalysis(reach.analysis), ...optionalMember(use.use.member),
          symbol: { platform: use.use.platform, usr: reach.from }, evidence: use.use,
          detail: 'This relation use is reached from the handler only through possible-implementation dispatch edges '
            + '(candidate evidence); the handler may not actually reach it.' });
      }
    }
    for (const handler of chain.handlers) {
      for (const reach of handler.reachedFrom) {
        if (reach.evidence !== 'candidate') continue;
        this.gap({ code: 'candidate-dispatch', selector, ...optionalAnalysis(reach.analysis), ...optionalMember(handler.member),
          symbol: { platform: handler.platform, usr: handler.usr },
          detail: `This handler is reached from ${reach.from} only through possible-implementation dispatch edges `
            + '(candidate evidence); the route may not actually be affected.' });
      }
    }
    for (const route of chain.routes) {
      const key = routeKey(route.scope, route.method, route.template);
      for (const call of route.calls) {
        const usr = call.call.symbol?.usr;
        if (usr === undefined) continue;
        this.candidateListGaps(call.affected, (analysis, detail) => this.gap({ code: 'candidate-dispatch', selector,
          route: key, analysis, ...optionalMember(call.call.member), symbol: { platform: call.call.platform, usr },
          evidence: call.call, detail }), 'client');
      }
    }
    for (const hop of chain.database) {
      this.candidateListGaps(hop.dependents, (analysis, detail) => this.gap({ code: 'candidate-dispatch', selector,
        analysis, ...optionalMember(hop.member), symbol: { platform: 'sql', usr: hop.vertex }, detail }), 'database');
    }
  }

  /** 영향 목록의 candidate 정점을 분석별로 묶어 개수와 예시를 싣는다. */
  private candidateListGaps(rows: readonly TraceAffected[], emit: (analysis: string, detail: string) => void,
    noun: 'client' | 'database'): void {
    const byAnalysis = new Map<string, string[]>();
    for (const row of rows) {
      if (row.evidence === 'candidate') byAnalysis.set(row.analysis, [...(byAnalysis.get(row.analysis) ?? []), row.usr]);
    }
    for (const [analysis, usrs] of [...byAnalysis.entries()].sort(([left], [right]) => compareStrings(left, right))) {
      emit(analysis, `${usrs.length} ${noun} symbol(s) are reached from this root only through possible-implementation `
        + `dispatch edges (candidate evidence) and may not actually be affected (e.g. ${examples(usrs)}).`);
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

/** revision 비교 단위다. */
interface RevisionGroup {
  readonly member: string;
  readonly expected?: string;
  readonly graphSha?: string;
  readonly analyses: readonly TraceAnalysis[];
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

/** 조립한 relation-use hop의 선언 끝점을 member별로 돌려준다(DB hop 입력). */
function declGroups(uses: ReadonlyMap<string, MutableUse>): DeclGroup[] {
  return [...uses.values()].map(({ record }) => ({ member: record.member, decls: record.decls }));
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
      decls: record.decls,
      reachedFrom: [...reach.values()].sort((left, right) => compareStrings(left.from, right.from)),
    };
  });
}

/** 핸들러 hop을 (member, 플랫폼, usr) 순으로 정렬한다. */
function sortHandlers(handlers: ReadonlyMap<string, TraceHandlerHop>): TraceHandlerHop[] {
  return [...handlers.entries()].sort(([left], [right]) => compareStrings(left, right)).map(([, hop]) => hop);
}

/** 같은 정점에 여러 도달이 있으면 (depth, analysis) 최솟값 하나만 남긴다. */
function keepNearest(target: Map<string, TraceReach>, key: string, reach: TraceReach): void {
  const current = target.get(key);
  if (current === undefined || compareNearness(reach, current) < 0) target.set(key, reach);
}

/**
 * 도달 근거의 우선순위다. 더 강한 근거 등급(direct, bound, candidate, unassessed 순)이 먼저다 — 한 분석이라도
 * 더 강한 근거로 닿으면 그 hop은 약한 근거에만 기대지 않기 때문이다. 그다음 시작점 자신의 경로(`witnessRoot`
 * 없음)가 다른 root의 목격보다 앞서고, depth, 분석 id 순이다.
 */
function compareNearness(left: NearnessKey, right: NearnessKey): number {
  const indirect = (reach: NearnessKey) => Number(reach.witnessRoot !== undefined || reach.witnessPartial === true);
  return evidenceRank[left.evidence] - evidenceRank[right.evidence] || indirect(left) - indirect(right) ||
    left.depth - right.depth || compareStrings(left.analysis ?? '', right.analysis ?? '');
}

/** 근거 등급의 강한 순서다. `unassessed`는 분류되지 않았으므로 알려진 등급 뒤에 둔다. */
const evidenceRank: Readonly<Record<TraceEvidence, number>> = { direct: 0, bound: 1, candidate: 2, unassessed: 3 };

/** 도달 근거 비교에 쓰는 필드다. */
type NearnessKey = Pick<TraceReach, 'depth' | 'analysis' | 'witnessRoot' | 'witnessPartial' | 'evidence'>;

/** 체인 시작점 자신의 도달 근거다. 간선이 없으므로 depth 0, `direct`다. */
function selfReach(usr: string): TraceReach {
  return { from: usr, depth: 0, path: [usr], evidence: 'direct' };
}

/** gap 문구에 싣는 예시 id 목록이다. 상한을 넘으면 나머지 수를 덧붙인다. */
function examples(usrs: readonly string[]): string {
  const shown = usrs.slice(0, MAX_GAP_EXAMPLES).join(', ');
  return usrs.length > MAX_GAP_EXAMPLES ? `${shown}, and ${usrs.length - MAX_GAP_EXAMPLES} more` : shown;
}

/** 분석 id가 있을 때만 gap 필드로 싣는다. */
function optionalAnalysis(analysis: string | undefined): { analysis?: string } {
  return analysis === undefined ? {} : { analysis };
}

/** member가 있을 때만(workspace) gap 필드로 싣는다. */
function optionalMember(member: string | undefined): { member?: string } {
  return member === undefined ? {} : { member };
}

/**
 * 생산자 via 목격으로 도달 근거를 만든다.
 *
 * 목격 경로의 첫 원소가 이 hop의 시작 root와 다르면 `witnessRoot`를 싣는다. 그때 depth·path는
 * 그 root 기준이며, 시작 root에서의 거리는 depth보다 짧지 않다는 것만 알 수 있다(경로를 지어내지 않는다).
 */
function reachOf(from: string, analysis: TraceAnalysis, row: TraversalReached): TraceReach {
  const { path, partial } = traversalWitness(analysis.graph, row.symbol.usr);
  return { from, analysis: analysis.id, depth: row.depth, path, evidence: reachedEvidence(analysis.graph, row),
    ...(partial ? { witnessPartial: true as const } : path[0] === from ? {} : { witnessRoot: path[0]! }) };
}

/** 적중한 분석들의 도달 정점을 (플랫폼, usr)별 가장 가까운 것 하나로 줄인다. 한 호출의 적중은 한 member 안이다. */
function affectedRows(hits: ReadonlyArray<{ analysis: TraceAnalysis; root: string; rows: readonly TraversalReached[] }>):
  TraceAffected[] {
  const best = new Map<string, TraceAffected>();
  for (const { analysis, root, rows } of hits) {
    for (const row of rows) {
      const { path, evidence, witnessRoot, witnessPartial } = reachOf(root, analysis, row);
      const candidate: TraceAffected = {
        platform: analysis.platform, usr: row.symbol.usr, ...optionalMember(analysis.member),
        ...(row.symbol.qualifiedName === undefined ? {} : { qualifiedName: row.symbol.qualifiedName }),
        ...(row.symbol.kind === undefined ? {} : { kind: row.symbol.kind }),
        ...(row.symbol.location === undefined ? {} : { location: row.symbol.location }),
        ...(row.relationships === undefined ? {} : { relationships: row.relationships }),
        analysis: analysis.id, depth: row.depth, path, evidence, ...(witnessRoot === undefined ? {} : { witnessRoot }),
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
  const unique = new Map(starts.map((start) => [memberSymbolKey(start.member, start.platform, start.usr), start]));
  return [...unique.entries()].sort(([left], [right]) => compareStrings(left, right)).map(([, start]) => start);
}

function routeKey(scope: string, method: RouteMethod, template: string): TraceRouteKey {
  return { scope, method, template };
}

function compareRouteKeys(left: TraceRouteKey, right: TraceRouteKey): number {
  return compareStrings(left.scope, right.scope) || compareStrings(left.template, right.template) ||
    compareStrings(left.method, right.method);
}

/**
 * 체인 키 `[member, platform, id]`의 직렬화다. 생산자별·member별 id 네임스페이스를 섞지 않는다.
 * 단일 project의 member는 `''`라 접두사가 같고, 그래서 정렬 순서가 옛 `[platform, id]` 키와 같다.
 */
function memberSymbolKey(member: string, platform: string, usr: string): string {
  return JSON.stringify([member, platform, usr]);
}

/** member 안 이름 키의 직렬화다. */
function memberKey(member: string, key: string): string {
  return JSON.stringify([member, key]);
}

/** workspace 입력 요약이다. 경로는 싣지 않고 member·link 신원과 귀속 선언만 되싣는다. */
function summarizeWorkspace(context: TraceContext): TraceWorkspaceSummary {
  const { members, links } = context.workspace!;
  return {
    members: members.map(({ name, project, revision, catalog }) => ({ name, project, revision,
      ...(catalog === undefined ? {} : { catalog }) })),
    links: links.map(({ name, client, server, match, contract }) => ({ name, client, server, match,
      ...(contract === undefined ? {} : { contract: { member: contract.member,
        ...(contract.authoritative === undefined ? {} : { authoritative: contract.authoritative }) } }) })),
  };
}

function summarizeAnalysis(analysis: TraceAnalysis): TraceAnalysisSummary {
  const { id, platform, role, graph, member, revision, revisionAttested, precomputed } = analysis;
  return {
    id, platform, role, ...optionalMember(member), source: graph.source, direction: graph.direction,
    ...(graph.tool === undefined ? {} : { tool: graph.tool }),
    ...(revision === undefined ? {} : { revision }),
    ...(revisionAttested === true ? { revisionSource: 'attested' as const } : {}),
    ...(precomputed === undefined ? {} : { precomputed }),
    ...(graph.graphRevision === undefined ? {} : { graphRevision: graph.graphRevision }),
    ...(graph.dispatch === undefined ? {} : { dispatch: graph.dispatch }),
    truncated: graph.truncated, rootsTruncated: graph.rootsTruncated, rootProvenance: graph.rootProvenance,
    evidenceReported: graph.evidenceReported, unresolvedCallsReported: graph.unresolvedCallsReported,
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
    evidence: countEvidence(chains),
  };
}

/** 보고서의 모든 도달 근거를 등급별로 센다. 시작점 자신(depth 0)의 relation-use 도달도 `direct`로 센다. */
function countEvidence(chains: readonly TraceChain[]): TraceEvidenceCounts {
  const counts: Record<TraceEvidence, number> = { direct: 0, bound: 0, candidate: 0, unassessed: 0 };
  for (const chain of chains) {
    const reaches: ReadonlyArray<{ evidence: TraceEvidence }> = [
      ...chain.relationUses.flatMap(({ reachedFrom }) => reachedFrom),
      ...chain.handlers.flatMap(({ reachedFrom }) => reachedFrom),
      ...chain.routes.flatMap(({ calls }) => calls.flatMap(({ affected }) => affected)),
      ...chain.database.flatMap(({ dependents }) => dependents),
    ];
    for (const { evidence } of reaches) counts[evidence] += 1;
  }
  return counts;
}
