import { compareStrings } from '../compare.ts';
import type { RoutePathAnchor } from '../exchange/parse.ts';
import type { BridgeEndpoint } from '../join/join.ts';
import { compareEndpoints } from '../join/join.ts';
import type { RouteDeclaration, RouteMatchQuality, RouteSideOutcome } from '../join/route-index.ts';
import type { RouteCallResult, RouteDeclarationFact, RouteScope } from '../join/route-join.ts';
import { clientRouteGapPrefixes, contractRouteGapPrefixes, serverRouteGapPrefixes } from './route-issues.ts';

/**
 * `diff --http`의 finding 정책이다.
 *
 * 같은 호출 집합을 base 선언 측과 head 선언 측에 따로 조인한 두 `RouteScope`(교차 평가)를 받아 route 표면
 * 차이(surface), base에서 결합하던 호출이 head에서 결합하지 않는 곳(impact), 판단을 막는 공백(incompleteness)을
 * finding으로 만든다. 매칭·귀속은 조인 층(check와 같은 코드)이 이미 했고 이 모듈은 결과만 비교한다. 규칙의 정본은
 * docs/HTTP-DIFF.md다.
 */

/** 비교하는 선언 측이다. route-decl은 `decl`, route-contract는 `contract`다. */
export type HttpDiffSide = 'decl' | 'contract';

/** route 신원에서 scope·측을 뺀 부분이다. */
export interface HttpRouteKey {
  readonly method: string;
  readonly template: string;
  readonly pathAnchor: RoutePathAnchor;
}

/** finding 심각도다. info는 표면 추가에만 쓴다. */
export type HttpDiffSeverity = 'error' | 'warning' | 'info';

/** finding 분류다. `--fail-on incomplete`가 incompleteness 전체를 고른다. */
export type HttpDiffCategory = 'surface' | 'impact' | 'incompleteness';

/** finding 코드별 심각도·분류의 닫힌 목록이다. 문서 표와 테스트가 이 목록과 대조한다. */
export const HTTP_DIFF_CODES = {
  'route-added': { severity: 'info', category: 'surface' },
  'route-removed': { severity: 'warning', category: 'surface' },
  'route-param-constraints-changed': { severity: 'warning', category: 'surface' },
  'route-trailing-slash-changed': { severity: 'warning', category: 'surface' },
  'route-catch-all-changed': { severity: 'warning', category: 'surface' },
  'route-case-sensitivity-changed': { severity: 'warning', category: 'surface' },
  'removed-bound-route': { severity: 'error', category: 'impact' },
  'removed-bound-route-unverified': { severity: 'warning', category: 'impact' },
  'changed-bound-route': { severity: 'error', category: 'impact' },
  'changed-bound-route-unverified': { severity: 'warning', category: 'impact' },
  'rebound-route-calls': { severity: 'warning', category: 'impact' },
  'clients-unscanned': { severity: 'warning', category: 'incompleteness' },
  'calls-unattributed': { severity: 'warning', category: 'incompleteness' },
  'calls-dynamic': { severity: 'warning', category: 'incompleteness' },
  'client-coverage-gap': { severity: 'warning', category: 'incompleteness' },
  'declaration-coverage-gap': { severity: 'warning', category: 'incompleteness' },
  'declarations-dynamic': { severity: 'warning', category: 'incompleteness' },
  'link-service-ambiguous': { severity: 'warning', category: 'incompleteness' },
  'http-member-unlinked': { severity: 'warning', category: 'incompleteness' },
} as const satisfies Record<string, { severity: HttpDiffSeverity; category: HttpDiffCategory }>;

/** finding 코드다. */
export type HttpDiffCode = keyof typeof HTTP_DIFF_CODES;

/** 호출 하나가 한 시점의 한 측에서 얻은 결과다. */
export interface HttpDiffCallOutcome {
  readonly status: 'matched' | 'ambiguous' | 'missing' | 'method-mismatch' | 'trailing-slash-mismatch'
    | 'case-mismatch' | 'unattributed' | 'not-evaluated';
  readonly quality?: RouteMatchQuality;
  readonly routes?: readonly HttpRouteKey[];
}

/** impact finding에 싣는 호출이다. `reasons`는 `-unverified` finding에서 증명하지 못한 error 전제다. */
export interface HttpDiffCall {
  readonly call: BridgeEndpoint;
  readonly before: HttpDiffCallOutcome;
  readonly after: HttpDiffCallOutcome;
  readonly reasons?: readonly HttpDiffReason[];
}

/** error 전제 중 증명하지 못한 것이다(docs/HTTP-DIFF.md의 error 전제 표). */
export type HttpDiffReason =
  | 'before-binding-unproven' | 'base-anchored-call' | 'method-dynamic' | 'test-source' | 'masked-call'
  | 'after-unattributed' | 'after-not-evaluated' | 'after-outcome-unproven' | 'after-declaration-gap'
  | 'contract-not-authoritative';

/** finding 하나다. 코드에 해당하는 필드만 싣는다. */
export interface HttpDiffFinding {
  readonly code: HttpDiffCode;
  readonly severity: HttpDiffSeverity;
  readonly category: HttpDiffCategory;
  readonly scope?: string;
  readonly side?: HttpDiffSide;
  readonly route?: HttpRouteKey;
  readonly member?: string;
  readonly snapshot?: 'before' | 'after';
  readonly change?: { readonly before: readonly string[]; readonly after: readonly string[] };
  readonly evidence?: { readonly before?: readonly BridgeEndpoint[]; readonly after?: readonly BridgeEndpoint[] };
  readonly calls?: readonly HttpDiffCall[];
  readonly counts?: { readonly before?: number; readonly after?: number };
  readonly detail?: string;
}

/**
 * 비교할 scope 한 쌍이다. `before`는 base 선언 측 + 평가 호출의 조인, `after`는 head 선언 측 + 같은 호출의 조인에서
 * 이 이름의 scope다. 한 시점에 scope가 없으면(서비스 이름 변경 등) 그쪽이 undefined다.
 */
export interface HttpDiffScopePair {
  readonly scope: string;
  readonly before?: RouteScope;
  readonly after?: RouteScope;
  /** contract 측 깨짐을 error로 올릴 수 있는지다(workspace link `contract.authoritative`). */
  readonly contractAuthoritative: boolean;
  /** 서비스 범위를 정하지 못한 시점별 설명이다(workspace link). */
  readonly serviceIssues?: { readonly before?: string; readonly after?: string };
}

/** 증명된 결합으로 보는 base 매칭 품질이다. suffix·param-to-literal 계열은 증명된 결합이 아니다. */
const provenQualities = new Set<RouteMatchQuality>(['exact', 'any-method', 'head-as-get', 'options-any', 'catch-all']);

/** 두 측을 같은 순서로 돈다. */
const sides: readonly HttpDiffSide[] = ['decl', 'contract'];

/** scope 쌍 목록에서 모든 finding을 결정적 순서로 만든다. */
export function createHttpDiffFindings(pairs: readonly HttpDiffScopePair[]): HttpDiffFinding[] {
  return pairs.flatMap(pairFindings).sort(compareFindings);
}

/** scope 한 쌍의 surface·impact·incompleteness finding이다. */
function pairFindings(pair: HttpDiffScopePair): HttpDiffFinding[] {
  const surface = sides.flatMap((side) => surfaceFindings(pair, side));
  const impact = sides.flatMap((side) => impactFindings(pair, side));
  const clientGaps = surface.length > 0 ? clientIncompleteness(pair) : [];
  return [...surface, ...impact, ...clientGaps, ...declarationIncompleteness(pair)];
}

/** finding 코드에 심각도·분류를 붙인다. */
export function finding(code: HttpDiffCode, fields: Omit<HttpDiffFinding, 'code' | 'severity' | 'category'>): HttpDiffFinding {
  return { code, ...HTTP_DIFF_CODES[code], ...fields };
}

/* ───────────── surface ───────────── */

/** 한 측의 선언 사실 목록이다. */
function sideFacts(scope: RouteScope | undefined, side: HttpDiffSide): readonly RouteDeclarationFact[] {
  if (scope === undefined) return [];
  return side === 'decl' ? scope.decls : scope.contracts;
}

/** 선언 하나의 route 키다. */
function declarationKey(declaration: RouteDeclaration): HttpRouteKey {
  return { method: declaration.method, template: declaration.template, pathAnchor: declaration.anchor };
}

/** route 키의 결정적 직렬화다. */
function keyString(key: HttpRouteKey): string {
  return JSON.stringify([key.pathAnchor, key.method, key.template]);
}

/** 한 측의 정적 선언 사실을 route 키로 묶는다. */
function groupByKey(facts: readonly RouteDeclarationFact[]): Map<string, RouteDeclarationFact[]> {
  const groups = new Map<string, RouteDeclarationFact[]>();
  for (const fact of facts) {
    const key = keyString(declarationKey(fact.declaration));
    groups.set(key, [...(groups.get(key) ?? []), fact]);
  }
  return groups;
}

/** 한 측의 route 추가·삭제·속성 변화다. */
function surfaceFindings(pair: HttpDiffScopePair, side: HttpDiffSide): HttpDiffFinding[] {
  const before = groupByKey(sideFacts(pair.before, side));
  const after = groupByKey(sideFacts(pair.after, side));
  const keys = [...new Set([...before.keys(), ...after.keys()])];
  return keys.flatMap((key) => keyFindings(pair.scope, side, before.get(key), after.get(key)));
}

/** route 키 하나의 surface finding이다. */
function keyFindings(scope: string, side: HttpDiffSide, before: RouteDeclarationFact[] | undefined,
  after: RouteDeclarationFact[] | undefined): HttpDiffFinding[] {
  const route = declarationKey((before ?? after)![0]!.declaration);
  if (before === undefined) return [finding('route-added', { scope, side, route, evidence: { after: endpoints(after!) } })];
  if (after === undefined) return [finding('route-removed', { scope, side, route, evidence: { before: endpoints(before) } })];
  const evidence = { before: endpoints(before), after: endpoints(after) };
  return attributeReaders.flatMap(({ code, read }) => {
    const change = { before: valueSet(before, read), after: valueSet(after, read) };
    return JSON.stringify(change.before) === JSON.stringify(change.after)
      ? [] : [finding(code, { scope, side, route, change, evidence })];
  });
}

/** 같은 키에서 비교하는 속성과 그 finding 코드다. 값은 사람이 읽을 수 있는 정규 문자열이다. */
const attributeReaders: ReadonlyArray<{ code: HttpDiffCode; read: (fact: RouteDeclarationFact) => string }> = [
  { code: 'route-param-constraints-changed', read: (fact) => constraintsValue(fact.constraintsKey) },
  { code: 'route-trailing-slash-changed', read: (fact) => fact.declaration.trailingSlash ?? 'unknown' },
  { code: 'route-catch-all-changed', read: (fact) => (fact.declaration.catchAllPrefix ? 'catch-all-prefix' : 'explicit') },
  { code: 'route-case-sensitivity-changed', read: (fact) => (fact.declaration.caseInsensitive ? 'case-insensitive' : 'case-sensitive') },
];

/**
 * 경로 제약 목록의 정규 문자열이다(`세그먼트:종류[=패턴]`을 세그먼트 순으로 쉼표로 잇고, 없으면 `none`).
 * 생산자 JSON의 키 순서와 무관하게 같은 제약이 같은 문자열이 되게 한다.
 */
function constraintsValue(constraintsKey: string): string {
  const constraints = JSON.parse(constraintsKey) as Array<{ segment: number; kind: string; pattern?: string }>;
  if (constraints.length === 0) return 'none';
  return [...constraints].sort((left, right) => left.segment - right.segment)
    .map(({ segment, kind, pattern }) => `${segment}:${kind}${pattern === undefined ? '' : `=${pattern}`}`).join(',');
}

/** 사실들의 속성 값 집합을 정렬해 돌려준다. */
function valueSet(facts: readonly RouteDeclarationFact[], read: (fact: RouteDeclarationFact) => string): string[] {
  return [...new Set(facts.map(read))].sort(compareStrings);
}

/** 선언 사실들의 끝점을 조인 순서로 정렬하고 중복을 없앤다. */
function endpoints(facts: readonly RouteDeclarationFact[]): BridgeEndpoint[] {
  return uniqueEndpoints(facts.map(({ endpoint }) => endpoint));
}

/** 끝점을 조인 비교기로 정렬하고 중복을 없앤다. */
function uniqueEndpoints(values: readonly BridgeEndpoint[]): BridgeEndpoint[] {
  const sorted = [...values].sort(compareEndpoints);
  return sorted.filter((value, index) => index === 0 || compareEndpoints(sorted[index - 1]!, value) !== 0);
}

/* ───────────── impact ───────────── */

/** 조립 중인 impact finding이다. 같은 신원의 호출을 모은다. */
interface ImpactGroup {
  readonly code: HttpDiffCode;
  readonly route: HttpRouteKey;
  readonly calls: HttpDiffCall[];
}

/** 한 측에서 base에 결합하던 호출이 head에서 결합하지 않거나 다른 route에 결합하는 곳이다. */
function impactFindings(pair: HttpDiffScopePair, side: HttpDiffSide): HttpDiffFinding[] {
  if (pair.before === undefined) return [];
  const afterKeys = new Set(sideFacts(pair.after, side).map(({ declaration }) => keyString(declarationKey(declaration))));
  const afterCalls = new Map((pair.after?.calls ?? []).map((call) => [callIdentity(call), call]));
  const groups = new Map<string, ImpactGroup>();
  for (const call of pair.before.calls) {
    const bound = boundRoutes(call[side]);
    if (bound === undefined) continue;
    const afterCall = afterCalls.get(callIdentity(call));
    const verdict = judgeCall(pair, side, call, bound, afterCall);
    if (verdict !== undefined) addImpact(groups, verdict, bound.routes, afterKeys);
  }
  return [...groups.values()].map(({ code, route, calls }) => finding(code, {
    scope: pair.scope, side, route, calls: calls.sort((left, right) => compareEndpoints(left.call, right.call)),
  }));
}

/** 호출 결과의 비교 신원이다. 두 조인이 같은 호출 문서를 쓰므로 끝점 직렬화가 같다. */
function callIdentity(call: RouteCallResult): string {
  return JSON.stringify([call.endpoint, call.masked]);
}

/** base 결과가 결합이면 그 route 키와 증명 여부를, 아니면 undefined를 돌려준다. */
function boundRoutes(outcome: RouteSideOutcome | undefined): { routes: HttpRouteKey[]; outcome: HttpDiffCallOutcome } | undefined {
  if (outcome === undefined || (outcome.status !== 'matched' && outcome.status !== 'ambiguous')) return undefined;
  const routes = uniqueKeys(outcome.targets);
  return {
    routes,
    outcome: { status: outcome.status, ...(outcome.status === 'matched' ? { quality: outcome.quality } : {}), routes },
  };
}

/** 선언 목록의 route 키를 중복 없이 정렬한다. */
function uniqueKeys(declarations: readonly RouteDeclaration[]): HttpRouteKey[] {
  const keys = new Map(declarations.map((declaration) => [keyString(declarationKey(declaration)), declarationKey(declaration)]));
  return [...keys.entries()].sort(([left], [right]) => compareStrings(left, right)).map(([, key]) => key);
}

/** 결합하던 호출 하나의 판정이다. 여전히 같은 route에 결합하면 undefined다. */
interface CallVerdict {
  readonly kind: 'broken' | 'rebound';
  readonly call: HttpDiffCall;
  /** rebound면 head에서 결합한 키, 아니면 비어 있다. */
  readonly afterRoutes: readonly HttpRouteKey[];
}

/** base에 결합하던 호출이 head에서 어떻게 되었는지 판정한다. */
function judgeCall(pair: HttpDiffScopePair, side: HttpDiffSide, call: RouteCallResult,
  bound: { routes: HttpRouteKey[]; outcome: HttpDiffCallOutcome }, afterCall: RouteCallResult | undefined): CallVerdict | undefined {
  const after = afterOutcome(afterCall, side);
  if (after.status === 'matched') {
    const beforeKeys = new Set(bound.routes.map(keyString));
    if (after.routes!.some((key) => beforeKeys.has(keyString(key)))) return undefined;
    return { kind: 'rebound', call: { call: call.endpoint, before: bound.outcome, after }, afterRoutes: after.routes! };
  }
  const reasons = unprovenPremises(pair, side, call, bound.outcome, afterCall);
  return {
    kind: 'broken',
    call: { call: call.endpoint, before: bound.outcome, after, ...(reasons.length === 0 ? {} : { reasons }) },
    afterRoutes: [],
  };
}

/** head 결과를 보고용 모양으로 바꾼다. */
function afterOutcome(afterCall: RouteCallResult | undefined, side: HttpDiffSide): HttpDiffCallOutcome {
  if (afterCall === undefined) return { status: 'unattributed' };
  const outcome = afterCall[side];
  if (outcome === undefined) return { status: 'not-evaluated' };
  switch (outcome.status) {
    case 'matched':
      return { status: 'matched', quality: outcome.quality, routes: uniqueKeys(outcome.targets) };
    case 'ambiguous':
      return { status: 'ambiguous', routes: uniqueKeys(outcome.targets) };
    case 'method-mismatch':
      return { status: 'method-mismatch', routes: uniqueKeys(outcome.candidates) };
    case 'near-miss':
      return { status: outcome.reason === 'case' ? 'case-mismatch' : 'trailing-slash-mismatch',
        routes: uniqueKeys(outcome.candidates) };
    default:
      return { status: 'missing' };
  }
}

/**
 * 깨진 호출의 error 전제 중 증명하지 못한 것들이다. 비어 있으면 error다.
 *
 * check의 error 전제를 diff에 옮겼다: base 결합이 증명됐고, 호출이 root·확정 동사·비테스트·비마스킹이며, head에서도
 * 같은 scope에 귀속돼 그 측을 스캔한 선언 측과 비교했고, 결과가 증명된 미결합이며, head 그 측에 공백이 없다.
 * contract 측은 계약이 authoritative일 때만 error다 — 스펙에서 빠져도 서버가 받을 수 있다.
 */
function unprovenPremises(pair: HttpDiffScopePair, side: HttpDiffSide, call: RouteCallResult,
  before: HttpDiffCallOutcome, afterCall: RouteCallResult | undefined): HttpDiffReason[] {
  const outcome = afterCall?.[side];
  const checks: ReadonlyArray<[HttpDiffReason, boolean]> = [
    ['before-binding-unproven', before.status !== 'matched' || !provenQualities.has(before.quality!)],
    ['base-anchored-call', call.anchor !== 'root'],
    ['method-dynamic', call.method === undefined],
    ['test-source', call.testSource],
    ['masked-call', call.masked],
    ['after-unattributed', afterCall === undefined],
    ['after-not-evaluated', afterCall !== undefined && outcome === undefined],
    ['after-outcome-unproven', outcome !== undefined && !provenUnbound(outcome)],
    ['after-declaration-gap', pair.after !== undefined && sideGap(pair.after, side)],
    ['contract-not-authoritative', side === 'contract' && !pair.contractAuthoritative],
  ];
  return checks.filter(([, failed]) => failed).map(([reason]) => reason);
}

/** head 결과가 증명된 미결합인지다: 선언 없음, 또는 모든 경로 후보가 증명 가능한 method 불일치. */
function provenUnbound(outcome: RouteSideOutcome): boolean {
  return outcome.status === 'missing' || (outcome.status === 'method-mismatch' && outcome.provable);
}

/** 한 scope의 한 측에 공백(공백 접두사 한계나 dynamic 선언)이 있는지다. */
function sideGap(scope: RouteScope, side: HttpDiffSide): boolean {
  return sideGapPrefixes(scope, side).length > 0 || (side === 'decl' ? scope.dynamicDecls : scope.dynamicContracts) > 0;
}

/** 한 측의 공백 접두사 중 서버 측 문서가 신고한 것들이다. */
function sideGapPrefixes(scope: RouteScope, side: HttpDiffSide): string[] {
  const prefixes: readonly string[] = side === 'decl' ? serverRouteGapPrefixes : contractRouteGapPrefixes;
  return matchedPrefixes(scope.serverLimitations, prefixes);
}

/** 한계 문구들이 쓴 접두사를 정렬해 돌려준다. */
function matchedPrefixes(messages: readonly string[], prefixes: readonly string[]): string[] {
  return prefixes.filter((prefix) => messages.some((message) => message.startsWith(prefix))).sort(compareStrings);
}

/**
 * 판정을 finding 묶음에 넣는다. base에서 결합하던 route 키마다 한 finding이며, 깨짐은 키가 head에 남았는지(changed)
 * 사라졌는지(removed)와 전제 증명 여부(error / `-unverified`)로 코드를 고른다. rebound는 head에서 결합한 키가 아닌
 * base 키에만 붙인다.
 */
function addImpact(groups: Map<string, ImpactGroup>, verdict: CallVerdict, routes: readonly HttpRouteKey[],
  afterKeys: ReadonlySet<string>): void {
  for (const route of routes) {
    const code = impactCode(verdict, afterKeys.has(keyString(route)));
    const id = JSON.stringify([code, keyString(route)]);
    const group = groups.get(id) ?? { code, route, calls: [] };
    group.calls.push(verdict.call);
    groups.set(id, group);
  }
}

/** 판정 하나의 impact 코드다. */
function impactCode(verdict: CallVerdict, keptAtHead: boolean): HttpDiffCode {
  if (verdict.kind === 'rebound') return 'rebound-route-calls';
  const base = keptAtHead ? 'changed-bound-route' : 'removed-bound-route';
  return verdict.call.reasons === undefined ? base : `${base}-unverified`;
}

/* ───────────── incompleteness ───────────── */

/**
 * 표면이 바뀐 scope의 호출 측 공백이다. 평가한 호출 측 문서가 없거나, 귀속되지 않았거나 dynamic인 호출이 있거나,
 * 호출 측이 공백 접두사를 신고했으면 "깨지는 호출 없음"으로 읽히지 않게 명시한다.
 */
function clientIncompleteness(pair: HttpDiffScopePair): HttpDiffFinding[] {
  const scope = pair.scope;
  const current = pair.after ?? pair.before!;
  const counts = (read: (value: RouteScope) => number) => ({
    ...(pair.before === undefined ? {} : { before: read(pair.before) }),
    ...(pair.after === undefined ? {} : { after: read(pair.after) }),
  });
  const prefixes = [...new Set([pair.before, pair.after].flatMap((value) =>
    value === undefined ? [] : matchedPrefixes(value.clientLimitations, clientRouteGapPrefixes)))].sort(compareStrings);
  return [
    ...(current.clientDocuments === 0 ? [finding('clients-unscanned', { scope })] : []),
    ...countFinding('calls-unattributed', scope, counts(({ unboundCalls }) => unboundCalls)),
    ...countFinding('calls-dynamic', scope, counts(({ dynamicCalls }) => dynamicCalls)),
    ...(prefixes.length === 0 ? [] : [finding('client-coverage-gap', { scope, detail: prefixes.join(', ') })]),
  ];
}

/** 시점별 개수 중 하나라도 0보다 크면 finding 하나를 만든다. */
function countFinding(code: HttpDiffCode, scope: string, counts: { before?: number; after?: number },
  side?: HttpDiffSide): HttpDiffFinding[] {
  if ((counts.before ?? 0) === 0 && (counts.after ?? 0) === 0) return [];
  return [finding(code, { scope, ...(side === undefined ? {} : { side }), counts })];
}

/**
 * 선언 측 공백이다. 표면 변화와 무관하게 낸다 — 공백 접두사나 dynamic 선언 뒤의 변화는 보이지 않기 때문이다.
 */
function declarationIncompleteness(pair: HttpDiffScopePair): HttpDiffFinding[] {
  const snapshots = [['before', pair.before], ['after', pair.after]] as const;
  const gaps = snapshots.flatMap(([snapshot, scope]) => scope === undefined ? [] : sides.flatMap((side) => {
    const prefixes = sideGapPrefixes(scope, side);
    return prefixes.length === 0 ? []
      : [finding('declaration-coverage-gap', { scope: pair.scope, side, snapshot, detail: prefixes.join(', ') })];
  }));
  const dynamic = sides.flatMap((side) => countFinding('declarations-dynamic', pair.scope, {
    ...(pair.before === undefined ? {} : { before: dynamicCount(pair.before, side) }),
    ...(pair.after === undefined ? {} : { after: dynamicCount(pair.after, side) }),
  }, side));
  const services = snapshots.flatMap(([snapshot]) => {
    const detail = pair.serviceIssues?.[snapshot];
    return detail === undefined ? [] : [finding('link-service-ambiguous', { scope: pair.scope, snapshot, detail })];
  });
  return [...gaps, ...dynamic, ...services];
}

/** 한 측의 dynamic 선언 수다. */
function dynamicCount(scope: RouteScope, side: HttpDiffSide): number {
  return side === 'decl' ? scope.dynamicDecls : scope.dynamicContracts;
}

/* ───────────── 정렬 ───────────── */

/** finding을 scope·측·템플릿·method·앵커·코드·시점·member 순으로 고정한다. */
export function compareFindings(left: HttpDiffFinding, right: HttpDiffFinding): number {
  return compareStrings(findingOrder(left), findingOrder(right));
}

/** finding 정렬 키다. */
function findingOrder(value: HttpDiffFinding): string {
  return JSON.stringify([value.scope ?? '', value.side ?? '', value.route?.template ?? '', value.route?.method ?? '',
    value.route?.pathAnchor ?? '', value.code, value.snapshot ?? '', value.member ?? '']);
}
