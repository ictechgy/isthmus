import type { RouteParamConstraint, RoutePathAnchor } from '../exchange/parse.ts';
import type { HttpMethod, RouteMethod, RouteSegment } from '../exchange/route-template.ts';
import { formatRouteTemplate } from '../exchange/route-template.ts';

/**
 * http 도메인의 세그먼트 매처다.
 *
 * 선언 측(route-decl·route-contract) 템플릿을 세그먼트 trie에 넣고 호출 템플릿을 세그먼트
 * 단위로 맞춘다. trie는 후보를 빨리 좁히는 용도이고, 최종 판정(경로 제약·구체성·품질·증명
 * 가능성)은 후보마다 `evaluateSegments`가 다시 계산한다 — 제약은 decl마다 달라 trie 노드에
 * 둘 수 없기 때문이다. 규칙의 정본은 GRAPH-EXCHANGE의 "조인 규칙 (http)" 절이다.
 */

/** 매칭에 쓰는 선언 측 사실 하나다. 조인이 정적 사실만 넘긴다. */
export interface RouteDeclaration {
  /** 호출자가 원래 사실을 되찾는 번호다. */
  readonly id: number;
  readonly template: string;
  readonly segments: readonly RouteSegment[];
  readonly method: RouteMethod;
  readonly anchor: RoutePathAnchor;
  readonly trailingSlash?: 'strict' | 'optional';
  readonly caseInsensitive: boolean;
  readonly catchAllPrefix: boolean;
  /** 세그먼트 인덱스별 제약 종류다. */
  readonly constraints: ReadonlyMap<number, RouteParamConstraint['kind']>;
}

/** 매칭할 호출 하나다. method가 없으면 동사가 동적인 호출이다. */
export interface RouteProbe {
  readonly segments: readonly RouteSegment[];
  readonly method?: HttpMethod;
  readonly anchor: RoutePathAnchor;
}

/**
 * 매칭 품질이다. `check --pairs`와 query에만 싣는다. info 심각도는 새로 만들지 않는다.
 *
 * `declared-base`·`declared-wrapper`는 workspace 매니페스트가 있어야 생기므로 이 버전은 내지
 * 않는다. `prefix-candidate`는 query의 dynamic 호출 후보에만 쓴다.
 */
export type RouteMatchQuality =
  | 'exact' | 'suffix' | 'any-method' | 'head-as-get' | 'options-any' | 'catch-all'
  | 'param-to-literal' | 'param-to-literal-constrained' | 'prefix-candidate';

/** 한 선언이 호출 경로와 맞은 방식이다. */
export interface RouteCandidate {
  readonly declaration: RouteDeclaration;
  /** 왼쪽 세그먼트부터의 구체성 순위다. 클수록 구체적이다. */
  readonly ranks: readonly number[];
  /** 호출 파라미터가 decl 리터럴(또는 부분 세그먼트)에 기대어 맞았다. */
  readonly paramToLiteral: boolean;
  /**
   * 증명할 수 없는 후보다(정규식 제약, 호출 부분 세그먼트↔decl 리터럴, 빈 끝 세그먼트↔`{**}`).
   * 구체성 비교에서 빼고 error 근거로 쓰지 않는다.
   */
  readonly unprovable: boolean;
  /** 정규식 제약 때문에 증명하지 못했다. 품질이 `param-to-literal-constrained`다. */
  readonly regexConstrained: boolean;
  readonly catchAll: boolean;
  /** suffix 후보(앵커 한쪽이 base)다. 품질은 항상 `suffix`이고 error 근거가 아니다. */
  readonly suffix: boolean;
}

/** 한 호출이 선언 측 한쪽(decl 또는 contract)에서 얻은 결과다. */
export type RouteSideOutcome =
  | {
    readonly status: 'matched';
    readonly quality: RouteMatchQuality;
    readonly targets: readonly RouteDeclaration[];
  }
  | {
    readonly status: 'ambiguous';
    readonly targets: readonly RouteDeclaration[];
    /** suffix 후보가 호출당 상한을 넘었다. */
    readonly capped: boolean;
  }
  | {
    readonly status: 'method-mismatch';
    readonly candidates: readonly RouteDeclaration[];
    /** 모든 경로 후보가 증명 가능하고 suffix가 아니다 — error 근거가 될 수 있다. */
    readonly provable: boolean;
  }
  | {
    readonly status: 'near-miss';
    readonly reason: 'trailing-slash' | 'case';
    readonly candidates: readonly RouteDeclaration[];
  }
  | { readonly status: 'missing' };

/** suffix 후보의 호출당 상한이다. 넘으면 모호함으로 본다. */
export const MAX_ROUTE_SUFFIX_CANDIDATES = 64;

/**
 * 한 조인에서 suffix 후보 계산이 비교할 수 있는 (호출, 선언, 오프셋) 조합의 상한이다.
 * 넘으면 부분 결과 대신 실패한다 — 상한 없는 Cartesian 곱을 피한다.
 */
export const MAX_ROUTE_SUFFIX_COMPARISONS = 5_000_000;

/** suffix 비교 예산을 넘었음을 나타낸다. 조인 층이 입력 오류로 바꾼다. */
export class RouteSuffixBudgetError extends Error {
  /** 입력 내용을 담지 않는 고정 문구만 보존한다. */
  constructor() {
    super('RouteSuffixBudgetError');
    this.name = 'RouteSuffixBudgetError';
  }
}

/**
 * 한 선언 측 집합(한 scope의 decl들 또는 contract들)의 매칭 색인이다.
 *
 * root 선언은 정확·접은(case) trie에, base 선언은 목록에 둔다. 끝 슬래시가 `optional`인
 * 선언은 슬래시를 토글한 변형도 trie에 넣는다.
 */
export class RouteIndex {
  readonly #exact = createNode();
  readonly #folded = createNode();
  readonly #rootByLastLiteral = new Map<string, RouteDeclaration[]>();
  readonly #rootOther: RouteDeclaration[] = [];
  /**
   * 대소문자 무시 root 선언이다. 마지막 리터럴 색인은 대소문자를 구분하므로 suffix 후보
   * 계산에서 이 선언은 항상 후보 풀에 넣는다.
   */
  readonly #rootCaseInsensitive: RouteDeclaration[] = [];
  readonly #base: RouteDeclaration[] = [];
  readonly #budget: { remaining: number };

  /** 선언을 색인한다. 예산은 같은 조인의 모든 색인이 공유한다. */
  constructor(declarations: readonly RouteDeclaration[], budget: { remaining: number }) {
    this.#budget = budget;
    for (const declaration of declarations) {
      if (declaration.anchor === 'base') {
        this.#base.push(declaration);
        continue;
      }
      for (const segments of trailingVariants(declaration)) {
        insert(this.#exact, segments, declaration, false);
        insert(this.#folded, segments, declaration, true);
      }
      const last = declaration.segments.at(-1)!;
      if (declaration.caseInsensitive) {
        this.#rootCaseInsensitive.push(declaration);
      } else if (last.kind === 'literal') {
        const bucket = this.#rootByLastLiteral.get(last.value) ?? [];
        bucket.push(declaration);
        this.#rootByLastLiteral.set(last.value, bucket);
      } else {
        this.#rootOther.push(declaration);
      }
    }
  }

  /**
   * 호출 하나를 이 선언 측과 맞춘다.
   *
   * root 호출은 root 선언과 정확 매칭하고, 경로 후보가 없을 때만 base 선언의 suffix 후보를
   * 찾는다. base 호출은 root 선언의 suffix 후보만 찾는다(base↔base는 잇지 않는다).
   */
  match(probe: RouteProbe): RouteSideOutcome {
    if (probe.anchor === 'base') {
      return decideSuffix(probe, this.#suffixOfRootCandidates(probe));
    }
    const candidates = this.#rootCandidates(probe.segments);
    if (candidates.length > 0) return decideExact(probe, candidates);
    const suffix = this.#baseSuffixCandidates(probe);
    if (suffix.candidates.length > 0 || suffix.capped) return decideSuffix(probe, suffix);
    return this.#nearMiss(probe) ?? { status: 'missing' };
  }

  /** root 선언 중 호출 경로와 맞는 후보를 찾는다. 대소문자 무시 선언은 접어서 맞춘다. */
  #rootCandidates(segments: readonly RouteSegment[]): RouteCandidate[] {
    const found = new Map<RouteDeclaration, RouteCandidate>();
    for (const [declaration, declSegments] of walk(this.#exact, segments)) {
      const candidate = evaluateSegments(declaration, declSegments, segments, false);
      if (candidate !== undefined) keepBetter(found, candidate);
    }
    for (const [declaration, declSegments] of walk(this.#folded, foldSegments(segments))) {
      if (!declaration.caseInsensitive) continue;
      const candidate = evaluateSegments(declaration, declSegments, segments, true);
      if (candidate !== undefined) keepBetter(found, candidate);
    }
    return [...found.values()];
  }

  /**
   * 후보가 전혀 없을 때만 끝 슬래시·대소문자만 다른 선언을 찾는다.
   *
   * 차이가 그것뿐이면 "선언 없음"으로 단정하지 않고 불일치 warning으로 내린다. 프레임워크의
   * 끝 슬래시·대소문자 기본값은 버전마다 다르다.
   */
  #nearMiss(probe: RouteProbe): RouteSideOutcome | undefined {
    const toggled = toggleTrailingSlash(probe.segments);
    if (toggled !== undefined) {
      // 증명 불가 후보도 근거로 남긴다. near-miss는 미매치 error를 대신하는 warning이라, 거르면
      // 증명하지 못한 근거 위에서 error로 올라간다(거짓 error 방향).
      const slash = preferCompatible(probe, this.#rootCandidates(toggled).map(({ declaration }) => declaration));
      if (slash.length > 0) return { status: 'near-miss', reason: 'trailing-slash', candidates: slash };
    }
    const cased = new Set<RouteDeclaration>();
    for (const [declaration, declSegments] of walk(this.#folded, foldSegments(probe.segments))) {
      if (evaluateSegments(declaration, declSegments, probe.segments, true) !== undefined) cased.add(declaration);
    }
    const candidates = preferCompatible(probe, [...cased]);
    return candidates.length > 0 ? { status: 'near-miss', reason: 'case', candidates } : undefined;
  }

  /**
   * base 호출 ↔ root 선언: 호출 템플릿이 선언 템플릿의 세그먼트 경계 suffix인 후보다.
   * 호출에 비어 있지 않은 리터럴 세그먼트가 하나 이상 있어야 한다.
   */
  #suffixOfRootCandidates(probe: RouteProbe): SuffixCollection {
    const collection: SuffixCollection = { candidates: [], capped: false };
    if (!hasLiteral(probe.segments)) return collection;
    const last = probe.segments.at(-1)!;
    const pool = [
      ...(last.kind === 'literal' ? this.#rootByLastLiteral.get(last.value) ?? [] : allValues(this.#rootByLastLiteral)),
      ...this.#rootOther,
      ...this.#rootCaseInsensitive,
    ];
    for (const declaration of pool) {
      for (let offset = 0; offset < declaration.segments.length; offset++) {
        this.#spend();
        const candidate = evaluateSegments(declaration, declaration.segments.slice(offset), probe.segments,
          declaration.caseInsensitive, offset);
        if (candidate !== undefined) {
          addSuffix(collection, { ...candidate, suffix: true });
          break;
        }
      }
      if (collection.capped) break;
    }
    return collection;
  }

  /**
   * root 호출 ↔ base 선언: 선언 템플릿이 호출 템플릿의 세그먼트 경계 suffix인 후보다.
   * 선언에 비어 있지 않은 리터럴 세그먼트가 하나 이상 있어야 한다.
   */
  #baseSuffixCandidates(probe: RouteProbe): SuffixCollection {
    const collection: SuffixCollection = { candidates: [], capped: false };
    for (const declaration of this.#base) {
      if (!hasLiteral(declaration.segments)) continue;
      for (let offset = 0; offset < probe.segments.length; offset++) {
        this.#spend();
        const candidate = evaluateSegments(declaration, declaration.segments, probe.segments.slice(offset),
          declaration.caseInsensitive);
        if (candidate !== undefined) {
          // 호출 세그먼트에 맞춰 비교하도록, 알 수 없는 base가 차지한 앞자리를 가장 낮은 순위로 채운다.
          const ranks = [...Array.from({ length: offset }, () => RANK_UNKNOWN_BASE), ...candidate.ranks];
          addSuffix(collection, { ...candidate, ranks, suffix: true });
          break;
        }
      }
      if (collection.capped) break;
    }
    return collection;
  }

  /** 공유 비교 예산을 하나 쓴다. 다 쓰면 실패한다. */
  #spend(): void {
    this.#budget.remaining -= 1;
    if (this.#budget.remaining < 0) throw new RouteSuffixBudgetError();
  }
}

/** method가 맞는 선언이 있으면 그것만, 없으면 전부를 증거로 남긴다. */
function preferCompatible(probe: RouteProbe, declarations: readonly RouteDeclaration[]): RouteDeclaration[] {
  const compatible = declarations.filter(({ method }) => methodQuality(probe.method, method) !== undefined);
  return compatible.length > 0 ? compatible : [...declarations];
}

/** suffix 후보 수집 결과다. */
interface SuffixCollection {
  readonly candidates: RouteCandidate[];
  capped: boolean;
}

/** 후보를 추가하고 서로 다른 선언이 상한을 넘으면 표시한다. */
function addSuffix(collection: SuffixCollection, candidate: RouteCandidate): void {
  if (collection.candidates.length >= MAX_ROUTE_SUFFIX_CANDIDATES) {
    collection.capped = true;
    return;
  }
  collection.candidates.push(candidate);
}

/** 같은 선언이 두 경로(정확·접은)로 찾아지면 하나만 남긴다. */
function keepBetter(found: Map<RouteDeclaration, RouteCandidate>, candidate: RouteCandidate): void {
  if (!found.has(candidate.declaration)) found.set(candidate.declaration, candidate);
}

/**
 * root↔root 후보에서 match·모호·method 불일치를 가린다.
 *
 * 먼저 method가 맞는 후보만 남긴다(프레임워크마다 경로 우선·method 우선이 달라, method를
 * 먼저 거르는 쪽이 거짓 error가 적다). 증명 가능한 후보 중 호출 파라미터를 decl 리터럴에
 * 기대지 않은 후보가 있으면 그것들만, 없으면 param-to-literal 후보로 구체성 최상위를 고른다.
 * 최상위가 서로 다른 템플릿으로 동률이면 모호하다. 같은 템플릿(narrowed·제약만 다름)은
 * 모두 match 대상이다. 증명 불가 후보만 남으면 후보로 잇되 모호함으로 보지 않는다.
 */
function decideExact(probe: RouteProbe, candidates: readonly RouteCandidate[]): RouteSideOutcome {
  const compatible = candidates.filter(({ declaration }) => methodQuality(probe.method, declaration.method) !== undefined);
  if (compatible.length === 0) {
    return {
      status: 'method-mismatch',
      candidates: uniqueDeclarations(candidates.map(({ declaration }) => declaration)),
      provable: candidates.every(({ unprovable }) => !unprovable),
    };
  }
  const provable = compatible.filter(({ unprovable }) => !unprovable);
  const direct = provable.filter(({ paramToLiteral }) => !paramToLiteral);
  const tier = direct.length > 0 ? direct : provable;
  if (tier.length === 0) {
    return {
      status: 'matched',
      quality: compatible.some(({ regexConstrained }) => regexConstrained)
        ? 'param-to-literal-constrained'
        : 'param-to-literal',
      targets: uniqueDeclarations(compatible.map(({ declaration }) => declaration)),
    };
  }
  const best = topRanked(tier);
  const templates = new Set(best.map(({ declaration }) => declaration.template));
  if (templates.size > 1) {
    return { status: 'ambiguous', targets: uniqueDeclarations(best.map(({ declaration }) => declaration)), capped: false };
  }
  // narrowed·경로 제약만 다른 같은 템플릿의 decl은 순위가 낮아도 모두 match 대상이다.
  return {
    status: 'matched',
    quality: candidateQuality(probe, best[0]!),
    // catch-all 접두사 decl은 같은 템플릿의 명시적 decl이 이기면 match 대상이 아니다.
    targets: uniqueDeclarations(tier.filter(({ declaration }) => templates.has(declaration.template) &&
      (!declaration.catchAllPrefix || best.some((candidate) => candidate.declaration.catchAllPrefix)))
      .map(({ declaration }) => declaration)),
  };
}

/**
 * suffix 후보에서 결과를 정한다.
 *
 * 한 색인은 한 scope·한 선언 측(decl 또는 contract)이라 후보는 같은 디스패치 모델(구체성)을
 * 따른다. 그래서 root↔root와 같은 규칙으로 구체성 최상위를 고른다: method가 맞는 후보 중
 * 증명 가능한 후보, 그중 호출 파라미터를 decl 리터럴에 기대지 않은 후보를 먼저 보고, 순위는
 * 호출 세그먼트에 맞춰 비교한다. 최상위가 한 템플릿일 때만 `suffix` match이고 동률이면 모호하다.
 * 증명 불가 후보만 남으면 템플릿이 하나일 때만 match다. 상한을 넘으면 모호하다. suffix 위의
 * method 불일치는 error 근거가 아니다.
 */
function decideSuffix(probe: RouteProbe, collection: SuffixCollection): RouteSideOutcome {
  const compatible = collection.candidates.filter(({ declaration }) =>
    methodQuality(probe.method, declaration.method) !== undefined);
  if (collection.capped) {
    return { status: 'ambiguous', targets: uniqueDeclarations(compatible.map(({ declaration }) => declaration)), capped: true };
  }
  if (collection.candidates.length === 0) return { status: 'missing' };
  if (compatible.length === 0) {
    return {
      status: 'method-mismatch',
      candidates: uniqueDeclarations(collection.candidates.map(({ declaration }) => declaration)),
      provable: false,
    };
  }
  const provable = compatible.filter(({ unprovable }) => !unprovable);
  const direct = provable.filter(({ paramToLiteral }) => !paramToLiteral);
  const tier = direct.length > 0 ? direct : provable;
  const best = tier.length > 0 ? topRanked(tier) : compatible;
  const templates = new Set(best.map(({ declaration }) => declaration.template));
  const targets = uniqueDeclarations((tier.length > 0 ? tier : compatible)
    .filter(({ declaration }) => templates.has(declaration.template)).map(({ declaration }) => declaration));
  if (templates.size > 1) return { status: 'ambiguous', targets, capped: false };
  return { status: 'matched', quality: 'suffix', targets };
}

/** 구체성 순위가 가장 높은 후보들을 고른다. */
function topRanked(candidates: readonly RouteCandidate[]): RouteCandidate[] {
  let best: RouteCandidate[] = [];
  for (const candidate of candidates) {
    const order = best.length === 0 ? 1 : compareRanks(candidate.ranks, best[0]!.ranks);
    if (order > 0) best = [candidate];
    else if (order === 0) best.push(candidate);
  }
  return best;
}

/**
 * 구체성 순위를 왼쪽 세그먼트부터 비교한다(양수면 왼쪽이 더 구체적).
 *
 * 공통 부분이 모두 같고 길이만 다르면 짧은 쪽이 이긴다. 길이가 다른 경우는 catch-all 접두사
 * decl(원본 `{**}`의 순위를 물려받아 끝에 가상의 catch-all 순위를 가짐)과 같은 경로의 명시적
 * decl뿐이며, 계약은 명시적 decl이 항상 match라고 정한다.
 */
export function compareRanks(left: readonly number[], right: readonly number[]): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index++) {
    const difference = left[index]! - right[index]!;
    if (difference !== 0) return difference;
  }
  return right.length - left.length;
}

/** 경로·method 결과를 품질 하나로 줄인다. 주의가 더 필요한 품질이 앞선다. */
function candidateQuality(probe: RouteProbe, candidate: RouteCandidate): RouteMatchQuality {
  if (candidate.paramToLiteral) return 'param-to-literal';
  if (candidate.catchAll) return 'catch-all';
  return methodQuality(probe.method, candidate.declaration.method) ?? 'exact';
}

/**
 * 호출 method와 선언 method의 호환성이다. 맞지 않으면 undefined다.
 *
 * 예외는 decl `ANY`, 호출 HEAD ↔ decl GET, 호출 OPTIONS ↔ 같은 경로의 모든 decl이다. 동사가
 * 동적인 호출은 경로만으로 잇는다.
 */
export function methodQuality(call: HttpMethod | undefined, declaration: RouteMethod): RouteMatchQuality | undefined {
  if (call === undefined || call === declaration) return 'exact';
  if (declaration === 'ANY') return 'any-method';
  if (call === 'HEAD' && declaration === 'GET') return 'head-as-get';
  if (call === 'OPTIONS') return 'options-any';
  return undefined;
}

/** 입력 순서를 보존하며 같은 선언을 한 번만 남긴다. */
function uniqueDeclarations(declarations: readonly RouteDeclaration[]): RouteDeclaration[] {
  return [...new Set(declarations)];
}

/** 구체성 순위: 리터럴 > 부분 세그먼트 > 닫힌 제약의 `{}` > `{}` > `{**}`. */
const RANK_LITERAL = 4;
const RANK_PARTIAL = 3;
const RANK_CONSTRAINED = 2;
const RANK_PARAM = 1;
const RANK_CATCH_ALL = 0;
/** root 호출↔base 선언 suffix에서 알 수 없는 base가 차지한 호출 세그먼트의 순위다. */
const RANK_UNKNOWN_BASE = -1;

/** 한 세그먼트 쌍의 매칭 결과다. */
interface SegmentResult {
  readonly rank: number;
  readonly paramToLiteral: boolean;
  readonly unprovable: boolean;
  readonly regexConstrained: boolean;
}

/**
 * 선언 세그먼트와 호출 세그먼트를 처음부터 맞춘다. 맞지 않으면 undefined다.
 *
 * `{**}`는 마지막 세그먼트로 호출의 남은 세그먼트 1개 이상을 흡수한다. 남은 것이 빈 끝
 * 세그먼트 하나뿐이면(`/files/` ↔ `/files/{**}`) 프레임워크마다 달라 증명 불가 후보로 둔다.
 * catch-all 접두사 decl은 원본 `{**}`와 같은 순위가 되도록 끝에 catch-all 순위를 덧붙인다.
 * `offset`은 `declSegments`가 선언 템플릿의 몇 번째 세그먼트부터인지다(suffix 후보). 경로
 * 제약의 세그먼트 인덱스를 원래 템플릿 기준으로 되돌리는 데 쓴다.
 */
export function evaluateSegments(
  declaration: RouteDeclaration,
  declSegments: readonly RouteSegment[],
  callSegments: readonly RouteSegment[],
  fold: boolean,
  offset = 0,
): RouteCandidate | undefined {
  const ranks: number[] = [];
  let paramToLiteral = false;
  let unprovable = false;
  let regexConstrained = false;
  let catchAll = declaration.catchAllPrefix;
  let callIndex = 0;
  for (const [index, declSegment] of declSegments.entries()) {
    if (declSegment.kind === 'catch-all') {
      const remaining = callSegments.slice(callIndex);
      if (remaining.length === 0) return undefined;
      const onlyEmpty = remaining.length === 1 && remaining[0]!.kind === 'literal' && remaining[0]!.value === '';
      unprovable ||= onlyEmpty;
      ranks.push(RANK_CATCH_ALL);
      catchAll = true;
      callIndex = callSegments.length;
      break;
    }
    const callSegment = callSegments[callIndex];
    if (callSegment === undefined) return undefined;
    const result = matchSegment(declSegment, callSegment, declaration.constraints.get(index + offset), fold);
    if (result === undefined) return undefined;
    ranks.push(result.rank);
    paramToLiteral ||= result.paramToLiteral;
    unprovable ||= result.unprovable;
    regexConstrained ||= result.regexConstrained;
    callIndex += 1;
  }
  if (callIndex !== callSegments.length) return undefined;
  if (declaration.catchAllPrefix) ranks.push(RANK_CATCH_ALL);
  return {
    declaration, ranks, paramToLiteral, unprovable: unprovable || regexConstrained,
    regexConstrained, catchAll, suffix: false,
  };
}

/**
 * 세그먼트 한 쌍을 맞춘다.
 *
 * 호출 리터럴은 decl 쪽 구체성 순위로 잰다. 호출 `{}`(마스킹 포함)는 decl `{}`와 정확
 * 매칭이고 decl 리터럴·부분 세그먼트와는 param-to-literal이다. 호출 부분 세그먼트는 같은
 * 골격·decl `{}`와 맞고, decl 리터럴이나 다른 골격과는 증명할 수 없는 후보다.
 */
function matchSegment(
  declSegment: Exclude<RouteSegment, { kind: 'catch-all' }>,
  callSegment: RouteSegment,
  constraint: RouteParamConstraint['kind'] | undefined,
  fold: boolean,
): SegmentResult | undefined {
  const same = (left: string, right: string): boolean =>
    fold ? left.toLowerCase() === right.toLowerCase() : left === right;
  if (callSegment.kind === 'literal') {
    const value = callSegment.value;
    if (declSegment.kind === 'literal') return same(declSegment.value, value) ? plain(RANK_LITERAL) : undefined;
    if (declSegment.kind === 'param') return value === '' ? undefined : constrained(value, constraint, RANK_PARAM);
    if (!fitsPartial(value, declSegment.prefix, declSegment.suffix, same)) return undefined;
    const middle = value.slice(declSegment.prefix.length, value.length - declSegment.suffix.length);
    const result = constrained(middle, constraint, RANK_PARTIAL);
    return result === undefined ? undefined : { ...result, paramToLiteral: true };
  }
  if (callSegment.kind === 'param') {
    if (declSegment.kind === 'literal') {
      return declSegment.value === '' ? undefined : { ...plain(RANK_LITERAL), paramToLiteral: true };
    }
    if (declSegment.kind === 'param') return plain(isClosedKind(constraint) ? RANK_CONSTRAINED : RANK_PARAM);
    return { ...plain(RANK_PARTIAL), paramToLiteral: true };
  }
  if (callSegment.kind === 'partial') {
    if (declSegment.kind === 'param') return plain(isClosedKind(constraint) ? RANK_CONSTRAINED : RANK_PARAM);
    if (declSegment.kind === 'partial' && same(declSegment.prefix, callSegment.prefix) &&
      same(declSegment.suffix, callSegment.suffix)) {
      return plain(RANK_PARTIAL);
    }
    const compatible = declSegment.kind === 'literal'
      ? fitsPartial(declSegment.value, callSegment.prefix, callSegment.suffix, same)
      : skeletonsOverlap(declSegment, callSegment, fold);
    if (!compatible) return undefined;
    return { rank: declSegment.kind === 'literal' ? RANK_LITERAL : RANK_PARTIAL, paramToLiteral: true, unprovable: true, regexConstrained: false };
  }
  return undefined;
}

/** 증명 가능한 결과다. */
function plain(rank: number): SegmentResult {
  return { rank, paramToLiteral: false, unprovable: false, regexConstrained: false };
}

/**
 * 파라미터 자리에 온 리터럴 값에 경로 제약을 적용한다.
 *
 * 닫힌 종류는 값이 명백히 어길 때만 후보에서 뺀다(퍼센트 인코딩이 있으면 해석하지 않고
 * 남긴다). 정규식은 평가하지 않고 증명 불가 후보로 둔다.
 */
function constrained(value: string, constraint: RouteParamConstraint['kind'] | undefined, baseRank: number): SegmentResult | undefined {
  if (constraint === 'regex') return { rank: baseRank, paramToLiteral: false, unprovable: true, regexConstrained: true };
  if (!isClosedKind(constraint)) return plain(baseRank);
  if (!value.includes('%') && clearlyViolates(value, constraint)) return undefined;
  return plain(baseRank === RANK_PARAM ? RANK_CONSTRAINED : baseRank);
}

/** 닫힌 제약 종류(int·uuid·slug)인지 확인한다. `path`는 제약으로 치지 않는다. */
function isClosedKind(constraint: RouteParamConstraint['kind'] | undefined): constraint is 'int' | 'uuid' | 'slug' {
  return constraint === 'int' || constraint === 'uuid' || constraint === 'slug';
}

/**
 * 리터럴 값이 닫힌 제약을 명백히 어기는지 판정한다. 프레임워크마다 정의가 조금씩 다르므로
 * 가장 넓은 정의로도 어길 때만 참이다(부호 있는 정수, 하이픈 유무의 UUID, ASCII slug).
 */
export function clearlyViolates(value: string, constraint: 'int' | 'uuid' | 'slug'): boolean {
  if (constraint === 'int') return !/^[+-]?[0-9]+$/u.test(value);
  if (constraint === 'uuid') {
    return !/^(?:[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}|[0-9A-Fa-f]{32})$/u.test(value);
  }
  return !/^[-A-Za-z0-9_]+$/u.test(value);
}

/** 값이 `prefix` + (비어 있지 않은 가운데) + `suffix` 모양인지 확인한다. */
function fitsPartial(value: string, prefix: string, suffix: string, same: (left: string, right: string) => boolean): boolean {
  return value.length > prefix.length + suffix.length &&
    same(value.slice(0, prefix.length), prefix) &&
    same(value.slice(value.length - suffix.length), suffix);
}

/** 서로 다른 두 부분 세그먼트 골격이 같은 값을 받을 수 있는지 보수적으로 판정한다. */
function skeletonsOverlap(
  left: { readonly prefix: string; readonly suffix: string },
  right: { readonly prefix: string; readonly suffix: string },
  fold: boolean,
): boolean {
  const normalize = (value: string): string => (fold ? value.toLowerCase() : value);
  const [leftPrefix, rightPrefix] = [normalize(left.prefix), normalize(right.prefix)];
  const [leftSuffix, rightSuffix] = [normalize(left.suffix), normalize(right.suffix)];
  return (leftPrefix.startsWith(rightPrefix) || rightPrefix.startsWith(leftPrefix)) &&
    (leftSuffix.endsWith(rightSuffix) || rightSuffix.endsWith(leftSuffix));
}

/** 비어 있지 않은 리터럴 세그먼트가 하나 이상 있는지 확인한다. */
function hasLiteral(segments: readonly RouteSegment[]): boolean {
  return segments.some((segment) => segment.kind === 'literal' && segment.value !== '');
}

/** 끝 슬래시를 토글한 세그먼트다. 루트(`/`)처럼 토글할 수 없으면 undefined다. */
function toggleTrailingSlash(segments: readonly RouteSegment[]): RouteSegment[] | undefined {
  const last = segments.at(-1)!;
  if (last.kind === 'literal' && last.value === '') {
    return segments.length > 1 ? segments.slice(0, -1) : undefined;
  }
  if (last.kind === 'catch-all') return undefined;
  return [...segments, { kind: 'literal', value: '' }];
}

/** 끝 슬래시가 optional인 선언은 토글한 변형도 같은 선언으로 색인한다. */
function trailingVariants(declaration: RouteDeclaration): Array<readonly RouteSegment[]> {
  if (declaration.trailingSlash !== 'optional') return [declaration.segments];
  const toggled = toggleTrailingSlash(declaration.segments);
  return toggled === undefined ? [declaration.segments] : [declaration.segments, toggled];
}

/** 리터럴과 부분 세그먼트 골격을 소문자로 접는다. */
function foldSegments(segments: readonly RouteSegment[]): RouteSegment[] {
  return segments.map((segment) => {
    if (segment.kind === 'literal') return { kind: 'literal', value: segment.value.toLowerCase() };
    if (segment.kind === 'partial') {
      return { kind: 'partial', prefix: segment.prefix.toLowerCase(), suffix: segment.suffix.toLowerCase() };
    }
    return segment;
  });
}

/** Map 값 목록을 하나로 편다. */
function allValues<T>(map: ReadonlyMap<string, readonly T[]>): T[] {
  return [...map.values()].flat();
}

/** 세그먼트 trie 노드다. */
interface TrieNode {
  readonly literal: Map<string, TrieNode>;
  param: TrieNode | undefined;
  readonly partial: Map<string, { readonly prefix: string; readonly suffix: string; readonly node: TrieNode }>;
  /** 이 노드에서 `{**}`로 끝나는 선언과 그 세그먼트다. */
  readonly catchAll: Array<readonly [RouteDeclaration, readonly RouteSegment[]]>;
  /** 이 노드에서 끝나는 선언과 그 세그먼트다. */
  readonly terminal: Array<readonly [RouteDeclaration, readonly RouteSegment[]]>;
}

/** 빈 trie 노드를 만든다. */
function createNode(): TrieNode {
  return { literal: new Map(), param: undefined, partial: new Map(), catchAll: [], terminal: [] };
}

/** 선언 세그먼트를 trie에 넣는다. 접은 trie는 리터럴과 골격을 소문자로 둔다. */
function insert(root: TrieNode, segments: readonly RouteSegment[], declaration: RouteDeclaration, fold: boolean): void {
  let node = root;
  const keyed = fold ? foldSegments(segments) : segments;
  for (const segment of keyed) {
    if (segment.kind === 'catch-all') {
      node.catchAll.push([declaration, segments]);
      return;
    }
    node = childFor(node, segment);
  }
  node.terminal.push([declaration, segments]);
}

/** 세그먼트 종류에 맞는 자식 노드를 찾거나 만든다. */
function childFor(node: TrieNode, segment: Exclude<RouteSegment, { kind: 'catch-all' }>): TrieNode {
  if (segment.kind === 'literal') {
    const child = node.literal.get(segment.value) ?? createNode();
    node.literal.set(segment.value, child);
    return child;
  }
  if (segment.kind === 'param') {
    node.param ??= createNode();
    return node.param;
  }
  const key = formatRouteTemplate([segment]);
  const entry = node.partial.get(key) ?? { prefix: segment.prefix, suffix: segment.suffix, node: createNode() };
  node.partial.set(key, entry);
  return entry.node;
}

/**
 * 호출 세그먼트로 trie를 걸어 경로가 맞을 수 있는 선언을 모은다(과대 근사).
 *
 * 호출 파라미터는 모든 리터럴 자식으로 퍼진다. 최종 판정은 `evaluateSegments`가 한다.
 */
function walk(root: TrieNode, segments: readonly RouteSegment[]): Array<readonly [RouteDeclaration, readonly RouteSegment[]]> {
  const found: Array<readonly [RouteDeclaration, readonly RouteSegment[]]> = [];
  const visit = (node: TrieNode, index: number): void => {
    if (index < segments.length) found.push(...node.catchAll);
    if (index === segments.length) {
      found.push(...node.terminal);
      return;
    }
    const segment = segments[index]!;
    if (segment.kind === 'literal') {
      const child = node.literal.get(segment.value);
      if (child !== undefined) visit(child, index + 1);
    } else {
      for (const child of node.literal.values()) visit(child, index + 1);
    }
    if (node.param !== undefined) visit(node.param, index + 1);
    for (const { node: child } of node.partial.values()) visit(child, index + 1);
  };
  visit(root, 0);
  return found;
}
