import type { BridgeFactsDocument, RoutePathAnchor } from '../exchange/parse.ts';
import { isChannelLimitationScope } from '../exchange/parse.ts';
import type { RouteLimitationRange } from '../exchange/route-limitation-scope.ts';
import { parseRouteTemplate, type HttpMethod, type RouteMethod, type RouteSegment } from '../exchange/route-template.ts';

/**
 * http limitation 스코프의 경로 비교다.
 *
 * 스코프는 한계가 가릴 수 있는 요청(method, 경로) 집합의 보수적 상한이다. 한계가 호출(서버·계약 측 한계) 또는
 * 선언(호출 측 한계)에 "적용되는지"는 두 경로 집합이 **겹칠 수 있는지**로 정한다. 비교는 항상 넓게 근사한다 —
 * 겹친다고 잘못 보면 error 하나가 `-unverified`로 내려갈 뿐이지만, 겹치지 않는다고 잘못 보면 거짓 error가 된다.
 *
 * 근사 규칙(계약 GRAPH-EXCHANGE "http limitation 스코프"):
 * - 리터럴은 ASCII 대소문자를 접어 비교한다. 끝 슬래시 하나(빈 끝 세그먼트)는 있어도 없어도 같다고 본다.
 * - `{}`와 부분 세그먼트의 파라미터는 빈 값도 받는다고 본다. `{**}`는 0개 이상의 세그먼트다.
 * - 접두사 P는 P와 그 아래 전체, 접미사 S는 알 수 없는 0개 이상 세그먼트 뒤의 S, base 앵커 사실은 알 수 없는
 *   앞부분 뒤의 템플릿이다.
 */

/** 서버(수신) 측 공백 접두사다. `route-call-without-decl`·`route-method-mismatch`를 완화한다. */
export const serverRouteGapPrefixes = [
  'route-coverage:',
  'unresolved-route-prefix:',
  'route-framework-version-unknown:',
  'framework-provided-routes:',
  'route-dispatch-order-unknown:',
  'route-template-expansion-capped:',
] as const;

/** 계약 측 공백 접두사다. `route-call-without-contract`를 완화한다. */
export const contractRouteGapPrefixes = [
  'unresolved-contract-servers:',
  'contract-coverage:',
] as const;

/** 호출 측 공백 접두사다. `route-decl-without-call`·`route-contract-without-call`을 완화한다. */
export const clientRouteGapPrefixes = [
  'route-call-coverage:',
  'unresolved-base-url:',
  'url-rewrite-interceptors:',
  'ambiguous-base-join:',
  'http-wrapper-undeclared:',
  'http-wrapper-unresolved:',
  'generated-client-unscanned:',
  'unbound-route-calls-omitted:',
] as const;

/**
 * 스코프 원소를 출력에 그대로 실어도 되는 한계인지다. 서버·계약 측 공백의 스코프는 선언 측 경로(이미 증거로
 * 나가는 정보)를 적지만, 호출 측이나 모르는 접두사의 스코프는 귀속되지 않은 호출의 경로를 담을 수 있다 — 그런
 * 경로는 어떤 출력에도 싣지 않는다는 보안 규칙 때문에 원소 수만 싣는다.
 */
export function isDeclarationSideGap(message: string): boolean {
  return [...serverRouteGapPrefixes, ...contractRouteGapPrefixes].some((prefix) => message.startsWith(prefix));
}

/** scope에 전달하는 한계 하나다. `scoped`면 문서 전체가 아니라 스코프 안의 요청에만 적용된다. */
export interface RouteScopeLimitation {
  readonly message: string;
  readonly scoped: boolean;
}

/** 한 조인에서 스코프 비교가 방문할 수 있는 비교 칸 수의 상한이다. 넘으면 부분 결과 대신 실패한다. */
export const MAX_ROUTE_SCOPE_COMPARISONS = 5_000_000;

/** 스코프 비교 예산을 넘었음을 나타낸다. 조인 층이 입력 오류로 바꾼다. */
export class RouteScopeBudgetError extends Error {
  /** 입력 내용을 담지 않는 고정 문구만 보존한다. */
  constructor() {
    super('RouteScopeBudgetError');
    this.name = 'RouteScopeBudgetError';
  }
}

/** 비교용 경로 토큰이다. `star`는 0개 이상 세그먼트, `any`는 빈 값을 포함한 세그먼트 하나다. */
type Token =
  | { readonly kind: 'literal'; readonly value: string }
  | { readonly kind: 'any' }
  | { readonly kind: 'partial'; readonly prefix: string; readonly suffix: string }
  | { readonly kind: 'star' };

/** 0개 이상 세그먼트 토큰이다. */
const star: Token = { kind: 'star' };

/** 스코프가 있는 한계 하나의 비교 형태다. */
interface CompiledScope {
  /** 스코프를 붙인 한계 문구다. 같은 문구가 여럿이면 항목마다 따로 둔다. */
  readonly message: string;
  readonly methods?: ReadonlySet<HttpMethod>;
  /** 첫 토큰이 리터럴인 원소(정확 템플릿·접두사)를 그 값으로 묶은 것이다. `*` 키는 그 밖의 원소다. */
  readonly byHead: ReadonlyMap<string, readonly (readonly Token[])[]>;
  /** 접미사 원소를 마지막 토큰으로 묶은 것이다. `*` 키는 그 밖의 원소다. */
  readonly bySuffixTail: ReadonlyMap<string, readonly (readonly Token[])[]>;
}

/** 스코프 비교에 넣는 요청 측 경로(호출) 또는 선언 측 경로(decl·contract)다. */
export interface RouteScopeProbe {
  readonly segments: readonly RouteSegment[];
  readonly anchor: RoutePathAnchor;
  /**
   * 호출이면 호출 동사(없으면 동적 동사), 선언이면 선언 method다. `side`가 해석을 정한다.
   */
  readonly method?: RouteMethod;
  readonly side: 'call' | 'declaration';
}

/**
 * 한 측(서버 측 문서들 또는 호출 측 문서들)의 한계와 스코프 색인이다.
 *
 * 스코프 없는 한계는 모든 요청에 적용되고(기존 문서 전체 효과), 스코프 있는 한계는 비교가 겹칠 때만 적용된다.
 */
export class RouteLimitationScopeIndex {
  /** 이 측 문서들의 모든 한계다. 문서 순서·문서 안 순서를 유지한다. */
  readonly limitations: readonly RouteScopeLimitation[];
  /** 모든 한계 문구다. 스코프가 없으면 어느 요청에나 이 목록이 적용된다. */
  readonly messages: readonly string[];
  readonly #unscoped: readonly string[];
  readonly #scoped: readonly CompiledScope[];
  readonly #budget: { remaining: number };

  /** 문서들의 한계를 색인한다. 예산은 같은 조인의 모든 색인이 공유한다. */
  constructor(documents: readonly BridgeFactsDocument[], budget: { remaining: number }) {
    this.#budget = budget;
    const limitations: RouteScopeLimitation[] = [];
    const unscoped: string[] = [];
    const scoped: CompiledScope[] = [];
    for (const document of documents) {
      const ranges = routeRanges(document);
      document.limitations.forEach((message, index) => {
        const range = ranges.get(index);
        limitations.push({ message, scoped: range !== undefined });
        if (range === undefined) unscoped.push(message);
        else scoped.push(compileScope(message, range));
      });
    }
    this.limitations = limitations;
    this.messages = limitations.map(({ message }) => message);
    this.#unscoped = unscoped;
    this.#scoped = scoped;
  }

  /** 스코프 있는 한계가 하나라도 있는지다. 없으면 모든 요청에 `messages`가 적용된다. */
  get hasScopes(): boolean {
    return this.#scoped.length > 0;
  }

  /**
   * 요청·선언 하나에 적용되는 한계 문구다: 스코프 없는 한계 전부와, 스코프가 겹치는 한계.
   * 스코프가 없는 색인은 공유 배열을 그대로 돌려준다.
   */
  applicable(probe: RouteScopeProbe): readonly string[] {
    if (this.#scoped.length === 0) return this.messages;
    const variants = probeVariants(probe);
    const matched = this.#scoped.filter((scope) =>
      methodApplies(scope.methods, probe) && variants.some((tokens) => this.#covers(scope, tokens)));
    return matched.length === 0 ? this.#unscoped : [...this.#unscoped, ...matched.map(({ message }) => message)];
  }

  /** 스코프 원소 중 하나라도 이 경로와 겹치는지 본다. 첫·끝 리터럴 색인으로 비교 대상을 줄인다. */
  #covers(scope: CompiledScope, tokens: readonly Token[]): boolean {
    const candidates = [
      ...bucket(scope.byHead, tokens[0]),
      ...bucket(scope.bySuffixTail, lastMeaningful(tokens)),
    ];
    return candidates.some((element) => overlaps(element, tokens, this.#budget));
  }
}

/** 문서의 경로 스코프를 인덱스별로 모은다. http 문서가 아니면 비어 있다. */
function routeRanges(document: BridgeFactsDocument): Map<number, RouteLimitationRange> {
  const ranges = new Map<number, RouteLimitationRange>();
  if (document.target !== 'http') return ranges;
  for (const scope of document.limitationScopes ?? []) {
    if (!isChannelLimitationScope(scope)) ranges.set(scope.limitationIndex, scope);
  }
  return ranges;
}

/** 스코프 하나를 비교 형태로 바꾼다. */
function compileScope(message: string, range: RouteLimitationRange): CompiledScope {
  const byHead = new Map<string, Token[][]>();
  const bySuffixTail = new Map<string, Token[][]>();
  const add = (map: Map<string, Token[][]>, key: string, tokens: Token[]): void => {
    map.set(key, [...(map.get(key) ?? []), tokens]);
  };
  for (const template of range.templates ?? []) {
    const tokens = templateTokens(template);
    add(byHead, keyOf(tokens[0]), tokens);
  }
  for (const prefix of range.templatePrefixes ?? []) {
    const tokens = [...templateTokens(prefix), star];
    add(byHead, keyOf(tokens[0]), tokens);
  }
  for (const suffix of range.templateSuffixes ?? []) {
    const tokens = [star, ...templateTokens(suffix)];
    add(bySuffixTail, keyOf(lastMeaningful(tokens)), tokens);
  }
  return {
    message,
    ...(range.methods === undefined ? {} : { methods: new Set(range.methods) }),
    byHead,
    bySuffixTail,
  };
}

/** 검증된 템플릿을 토큰으로 바꾼다. 빈 끝 세그먼트 하나는 떼어 낸다(끝 슬래시 무관 비교). */
function templateTokens(template: string): Token[] {
  const parsed = parseRouteTemplate(template);
  // 파서가 이미 검증한 템플릿이라 실패하면 내부 불변 위반이다.
  if (!parsed.ok) throw new Error('Validated scope template failed to parse.');
  return trimTrailingEmpty(parsed.segments.map(segmentToken));
}

/** 세그먼트 하나의 토큰이다. 리터럴은 ASCII 소문자로 접는다. */
function segmentToken(segment: RouteSegment): Token {
  switch (segment.kind) {
    case 'literal': return { kind: 'literal', value: foldCase(segment.value) };
    case 'param': return { kind: 'any' };
    case 'partial': return { kind: 'partial', prefix: foldCase(segment.prefix), suffix: foldCase(segment.suffix) };
    case 'catch-all': return star;
  }
}

/** ASCII 대소문자만 접는다. 정규 템플릿은 ASCII와 `%XX`만 담는다. */
function foldCase(value: string): string {
  return value.replace(/[A-Z]/gu, (character) => character.toLowerCase());
}

/** 끝의 빈 리터럴 세그먼트 하나를 뗀다. */
function trimTrailingEmpty(tokens: Token[]): Token[] {
  const last = tokens.at(-1);
  return last?.kind === 'literal' && last.value === '' ? tokens.slice(0, -1) : tokens;
}

/**
 * 요청·선언 경로의 비교 변형이다. 끝 슬래시 하나를 뗀 형태와 붙인 형태를 모두 비교해 끝 슬래시 차이로 겹침을
 * 놓치지 않는다. base 앵커는 알 수 없는 앞부분을 0개 이상 세그먼트로 둔다.
 */
function probeVariants(probe: RouteScopeProbe): Token[][] {
  const trimmed = trimTrailingEmpty(probe.segments.map(segmentToken));
  const lead = probe.anchor === 'base' ? [star] : [];
  const base = [...lead, ...trimmed];
  if (base.at(-1)?.kind === 'star') return [base];
  return [base, [...base, { kind: 'literal', value: '' }]];
}

/**
 * 스코프의 method 조건이 요청·선언에 맞는지다.
 *
 * 호출: 동사가 동적이면 항상 맞는다. HEAD는 GET도, OPTIONS는 경로만 맞으면 된다(조인의 head-as-get·options-any와
 * 같은 방향). 선언: `ANY`는 항상, GET 선언은 HEAD 호출로도, 모든 선언은 OPTIONS 호출로도 닿을 수 있다.
 */
function methodApplies(methods: ReadonlySet<HttpMethod> | undefined, probe: RouteScopeProbe): boolean {
  if (methods === undefined || probe.method === undefined || probe.method === 'ANY') return true;
  const method = probe.method;
  if (methods.has(method)) return true;
  if (probe.side === 'call') return method === 'OPTIONS' || (method === 'HEAD' && methods.has('GET'));
  return methods.has('OPTIONS') || (method === 'GET' && methods.has('HEAD'));
}

/** 색인 키다. 리터럴이면 그 값, 아니면 `*`다. */
function keyOf(token: Token | undefined): string {
  return token?.kind === 'literal' ? `=${token.value}` : '*';
}

/** 접미사 색인에 쓰는 마지막 토큰이다. 빈 리터럴 변형은 건너뛴다. */
function lastMeaningful(tokens: readonly Token[]): Token | undefined {
  const last = tokens.at(-1);
  return last?.kind === 'literal' && last.value === '' ? tokens.at(-2) : last;
}

/** 경로 토큰의 첫(또는 끝) 토큰으로 비교할 원소 묶음을 고른다. 리터럴이 아니면 전체다. */
function bucket(map: ReadonlyMap<string, readonly (readonly Token[])[]>, token: Token | undefined): readonly (readonly Token[])[] {
  if (token?.kind !== 'literal') return [...map.values()].flat();
  return [...(map.get(`=${token.value}`) ?? []), ...(map.get('*') ?? [])];
}

/**
 * 두 토큰열이 같은 구체 경로를 하나라도 가질 수 있는지다(교집합이 비어 있지 않은지).
 *
 * `star`는 양쪽 어디에나 올 수 있는 0개 이상 세그먼트다. 칸마다 한 번만 계산하고(메모), 방문한 칸 수를 예산에서
 * 뺀다. 재귀 깊이는 두 토큰열 길이의 합(템플릿 상한 2,048자 → 약 2,050) 이하다.
 */
function overlaps(left: readonly Token[], right: readonly Token[], budget: { remaining: number }): boolean {
  const width = right.length + 1;
  const memo = new Uint8Array((left.length + 1) * width);
  const visit = (i: number, j: number): boolean => {
    const cell = i * width + j;
    if (memo[cell] !== 0) return memo[cell] === 1;
    budget.remaining -= 1;
    if (budget.remaining < 0) throw new RouteScopeBudgetError();
    const result = step(i, j);
    memo[cell] = result ? 1 : 2;
    return result;
  };
  const step = (i: number, j: number): boolean => {
    if (i < left.length && left[i]!.kind === 'star') return visit(i + 1, j) || (j < right.length && visit(i, j + 1));
    if (j < right.length && right[j]!.kind === 'star') return visit(i, j + 1) || (i < left.length && visit(i + 1, j));
    if (i === left.length || j === right.length) return i === left.length && j === right.length;
    return segmentsOverlap(left[i]!, right[j]!) && visit(i + 1, j + 1);
  };
  return visit(0, 0);
}

/** 세그먼트 토큰 둘이 같은 값을 가질 수 있는지다. 부분 세그먼트끼리는 항상 겹친다고 본다. */
function segmentsOverlap(left: Token, right: Token): boolean {
  if (left.kind === 'any' || right.kind === 'any') return true;
  if (left.kind === 'literal' && right.kind === 'literal') return left.value === right.value;
  if (left.kind === 'literal' && right.kind === 'partial') return partialAccepts(right, left.value);
  if (left.kind === 'partial' && right.kind === 'literal') return partialAccepts(left, right.value);
  return true;
}

/** 부분 세그먼트가 리터럴 값을 받을 수 있는지다. 가운데 빈 값도 받는다고 본다. */
function partialAccepts(partial: Extract<Token, { kind: 'partial' }>, value: string): boolean {
  return value.length >= partial.prefix.length + partial.suffix.length &&
    value.startsWith(partial.prefix) && value.endsWith(partial.suffix);
}
