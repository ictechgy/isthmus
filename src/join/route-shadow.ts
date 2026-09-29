import type { RouteParamConstraint } from '../exchange/parse.ts';
import type { RouteSegment } from '../exchange/route-template.ts';
import type { RouteDeclaration } from './route-index.ts';

/**
 * registration-order decl의 가림(shadowing) 판정이다.
 *
 * 같은 문서·같은 `order.group`에서 먼저 등록한 decl E가 뒤의 decl D가 받을 수 있는 **모든 경로**를 받으면 D는 가려졌다.
 * - `full`: E가 D의 method까지 받는다(E가 `ANY`이거나 같은 method). method를 먼저 거르는 isthmus 매처에서도, 경로를
 *   먼저 고르는 프레임워크(Django)와 method를 보고 다음 등록으로 넘어가는 라우터(Express) 어디서도 D는 호출을 받지 않는다.
 * - `path`: 경로는 모두 받지만 method가 다르다. 경로 우선 프레임워크에서는 D에 닿는 요청이 E에서 405로 끝나고, method를
 *   보는 라우터에서는 D가 다른 method로 여전히 닿는다. 계약이 이 차이를 싣지 않으므로 따로 보고한다.
 *
 * 판정은 건전(sound)하게만 한다 — "가렸다"고 말할 수 있을 때만 참이고, 증명할 수 없으면 가리지 않았다고 본다.
 * 그래서 E의 정규식·닫힌 제약, 대소문자 무시, narrowed·테스트 소스, base 앵커, 끝 슬래시 정책이 미상인 쪽은 넓게
 * 받아 준다고 가정하지 않는다. 규칙의 정본은 GRAPH-EXCHANGE의 "디스패치 모델" 절이다.
 */

/** 가림 판정의 대상이 되는 선언과 판정에 필요한 증거 속성이다. */
export interface ShadowCandidate {
  readonly declaration: RouteDeclaration;
  readonly narrowed: boolean;
  readonly testSource: boolean;
}

/** decl 하나의 가림 결과다. `by`는 가린 decl 중 가장 먼저 등록한 것의 id다. */
export interface RouteShadow {
  readonly kind: 'full' | 'path';
  readonly by: number;
}

/**
 * 한 조인에서 가림 판정이 방문할 수 있는 trie 노드·비교 수의 상한이다. 넘으면 부분 결과 대신 실패한다 — 다른 경로
 * 비교 예산과 같은 이유(상한 없는 비교를 피하고, 일부만 판정한 결과를 완전한 결과로 내지 않기 위해서)다.
 */
export const MAX_ROUTE_SHADOW_COMPARISONS = 5_000_000;

/** 가림 판정 예산을 넘었음을 나타낸다. 조인 층이 입력 오류로 바꾼다. */
export class RouteShadowBudgetError extends Error {
  /** 입력 내용을 담지 않는 고정 문구만 보존한다. */
  constructor() {
    super('RouteShadowBudgetError');
    this.name = 'RouteShadowBudgetError';
  }
}

/**
 * 선언 목록에서 가려진 registration-order decl을 찾는다.
 *
 * 가려지는 쪽(D)은 순서가 있는 root 앵커의 명시적(catch-all 접두사 펼침이 아닌)·비테스트 decl이다. 가리는 쪽(E)은
 * 같은 group에서 index가 더 작은 root 앵커의 비테스트·비 narrowed decl이다. 같은 index는 같은 등록이라 서로 가리지
 * 않는다. 결과는 D의 id별 가림이다.
 */
export function findRouteShadows(
  candidates: readonly ShadowCandidate[],
  budget: { remaining: number },
): Map<number, RouteShadow> {
  const groups = new Map<string, ShadowCandidate[]>();
  for (const candidate of candidates) {
    const group = candidate.declaration.registration?.group;
    if (group === undefined || candidate.declaration.registration?.index === undefined) continue;
    groups.set(group, [...(groups.get(group) ?? []), candidate]);
  }
  const shadows = new Map<number, RouteShadow>();
  for (const members of groups.values()) {
    const trie = createNode();
    for (const { declaration, narrowed, testSource } of members) {
      if (isShadowing(declaration, narrowed, testSource)) insert(trie, declaration);
    }
    for (const { declaration, testSource } of members) {
      if (!isShadowable(declaration, testSource)) continue;
      const shadow = shadowOf(declaration, walk(trie, declaration.segments, budget), budget);
      if (shadow !== undefined) shadows.set(declaration.id, shadow);
    }
  }
  return shadows;
}

/** 가리는 쪽이 될 수 있는 decl이다. narrowed decl은 조건에 맞는 요청만 받으므로 경로 전체를 받는다고 볼 수 없다. */
function isShadowing(declaration: RouteDeclaration, narrowed: boolean, testSource: boolean): boolean {
  return !narrowed && !testSource && declaration.anchor === 'root' && !declaration.caseInsensitive;
}

/** 가려지는 쪽이 될 수 있는 decl이다. catch-all 접두사 decl은 원본 `{**}` decl이 대표한다. */
function isShadowable(declaration: RouteDeclaration, testSource: boolean): boolean {
  return !testSource && !declaration.catchAllPrefix && declaration.anchor === 'root' && !declaration.caseInsensitive;
}

/** 후보 E 중 D보다 먼저 등록했고 D의 경로를 모두 받는 것에서 가림 결과를 만든다. method까지 받으면 `full`이 앞선다. */
function shadowOf(
  later: RouteDeclaration,
  earlierCandidates: readonly RouteDeclaration[],
  budget: { remaining: number },
): RouteShadow | undefined {
  const index = later.registration!.index!;
  let full: RouteDeclaration | undefined;
  let path: RouteDeclaration | undefined;
  for (const earlier of earlierCandidates) {
    spend(budget);
    if (earlier.registration!.index! >= index || !pathCovers(earlier, later)) continue;
    const methodCovered = earlier.method === 'ANY' || earlier.method === later.method;
    if (methodCovered && (full === undefined || isEarlier(earlier, full))) full = earlier;
    if (!methodCovered && (path === undefined || isEarlier(earlier, path))) path = earlier;
  }
  if (full !== undefined) return { kind: 'full', by: full.id };
  return path === undefined ? undefined : { kind: 'path', by: path.id };
}

/** 등록 순서(index, 같으면 id)로 앞서는지 비교한다. 같은 입력이면 같은 가린 decl을 고르기 위해서다. */
function isEarlier(left: RouteDeclaration, right: RouteDeclaration): boolean {
  const difference = left.registration!.index! - right.registration!.index!;
  return difference < 0 || (difference === 0 && left.id < right.id);
}

/**
 * 먼저 등록한 decl E가 뒤 decl D의 모든 경로를 받는지 건전하게 판정한다(method는 보지 않는다).
 *
 * 둘 다 root 앵커이고 대소문자를 구분해야 한다. 세그먼트마다 E가 D를 덮어야 하고, E의 끝 `{**}`는 D의 남은
 * 세그먼트(1개 이상, 빈 세그먼트 없음)를 덮는다. 끝 슬래시는 D가 strict이거나 D가 `{**}`로 끝나면 비교할 필요가
 * 없고, 그 밖(optional·미상)에는 E가 optional이어야 D의 토글 변형까지 덮는다.
 */
export function pathCovers(earlier: RouteDeclaration, later: RouteDeclaration): boolean {
  if (earlier.anchor !== 'root' || later.anchor !== 'root' || earlier.caseInsensitive || later.caseInsensitive) return false;
  const laterEndsWithCatchAll = later.segments.at(-1)?.kind === 'catch-all';
  for (const [position, segment] of earlier.segments.entries()) {
    const constraint = earlier.constraints.get(position);
    if (segment.kind === 'catch-all') {
      const rest = later.segments.slice(position);
      return isUnconstrained(constraint) && rest.length > 0 && rest.every((item) => !isEmptyLiteral(item)) &&
        (laterEndsWithCatchAll || later.trailingSlash === 'strict');
    }
    const other = later.segments[position];
    if (other === undefined || !segmentCovers(segment, constraint, other, later.constraints.get(position))) return false;
  }
  // 여기 오면 E는 `{**}`로 끝나지 않고 D와 길이가 같다. D의 `{**}`는 E의 어떤 세그먼트도 덮지 못하므로 D도 `{**}`로
  // 끝나지 않는다.
  if (earlier.segments.length !== later.segments.length) return false;
  return later.trailingSlash === 'strict' || earlier.trailingSlash === 'optional';
}

/**
 * E의 세그먼트 하나가 D의 세그먼트 하나가 받는 모든 값을 받는지다.
 *
 * - E 리터럴은 같은 D 리터럴만 덮는다.
 * - 제약 없는 E `{}`(계약상 비어 있지 않은 단일 세그먼트 전부)는 비어 있지 않은 D 리터럴·D `{}`·D 부분 세그먼트를 덮는다.
 * - 닫힌 제약(int·uuid·slug)의 E `{}`는 같은 제약의 D `{}`만 덮는다. 프레임워크마다 정의가 조금씩 달라 리터럴 값이
 *   제약을 통과하는지 확정할 수 없기 때문이다. 정규식 제약은 평가하지 않으므로 아무것도 덮지 않는다(같은 패턴이라도
 *   변환기가 다를 수 있다).
 * - 제약 없는 E 부분 세그먼트 `p{}s`는 골격에 맞는 D 리터럴과, 골격을 넓힌 D 부분 세그먼트를 덮는다.
 */
function segmentCovers(
  earlier: Exclude<RouteSegment, { kind: 'catch-all' }>,
  earlierConstraint: RouteParamConstraint['kind'] | undefined,
  later: RouteSegment,
  laterConstraint: RouteParamConstraint['kind'] | undefined,
): boolean {
  if (earlier.kind === 'literal') return later.kind === 'literal' && later.value === earlier.value;
  if (earlier.kind === 'param') {
    if (isUnconstrained(earlierConstraint)) {
      return (later.kind === 'literal' && later.value !== '') || later.kind === 'param' || later.kind === 'partial';
    }
    const closed = earlierConstraint === 'int' || earlierConstraint === 'uuid' || earlierConstraint === 'slug';
    return closed && later.kind === 'param' && laterConstraint === earlierConstraint;
  }
  if (!isUnconstrained(earlierConstraint)) return false;
  if (later.kind === 'literal') {
    return later.value.length > earlier.prefix.length + earlier.suffix.length &&
      later.value.startsWith(earlier.prefix) && later.value.endsWith(earlier.suffix);
  }
  return later.kind === 'partial' && later.prefix.startsWith(earlier.prefix) && later.suffix.endsWith(earlier.suffix);
}

/** 매칭에서 제약으로 치지 않는 종류(없음·`path`)인지다. */
function isUnconstrained(constraint: RouteParamConstraint['kind'] | undefined): boolean {
  return constraint === undefined || constraint === 'path';
}

/** 빈 리터럴 세그먼트(끝 슬래시·중복 슬래시)인지다. */
function isEmptyLiteral(segment: RouteSegment): boolean {
  return segment.kind === 'literal' && segment.value === '';
}

/** 공유 예산을 하나 쓴다. 다 쓰면 실패한다. */
function spend(budget: { remaining: number }): void {
  budget.remaining -= 1;
  if (budget.remaining < 0) throw new RouteShadowBudgetError();
}

/** 가리는 쪽 decl의 세그먼트 trie 노드다. 최종 판정은 `pathCovers`가 다시 한다(과대 근사 필터). */
interface ShadowNode {
  readonly literal: Map<string, ShadowNode>;
  param: ShadowNode | undefined;
  readonly partial: Array<{ readonly prefix: string; readonly suffix: string; readonly node: ShadowNode }>;
  /** 이 노드에서 `{**}`로 끝나는 decl이다. */
  readonly catchAll: RouteDeclaration[];
  /** 이 노드에서 끝나는 decl이다. */
  readonly terminal: RouteDeclaration[];
}

/** 빈 노드를 만든다. */
function createNode(): ShadowNode {
  return { literal: new Map(), param: undefined, partial: [], catchAll: [], terminal: [] };
}

/** 가리는 쪽 decl을 trie에 넣는다. */
function insert(root: ShadowNode, declaration: RouteDeclaration): void {
  let node = root;
  for (const segment of declaration.segments) {
    if (segment.kind === 'catch-all') {
      node.catchAll.push(declaration);
      return;
    }
    node = childFor(node, segment);
  }
  node.terminal.push(declaration);
}

/** 세그먼트에 맞는 자식 노드를 찾거나 만든다. 부분 세그먼트는 같은 골격이면 한 노드를 쓴다. */
function childFor(node: ShadowNode, segment: Exclude<RouteSegment, { kind: 'catch-all' }>): ShadowNode {
  if (segment.kind === 'literal') {
    const child = node.literal.get(segment.value) ?? createNode();
    node.literal.set(segment.value, child);
    return child;
  }
  if (segment.kind === 'param') {
    node.param ??= createNode();
    return node.param;
  }
  const existing = node.partial.find(({ prefix, suffix }) => prefix === segment.prefix && suffix === segment.suffix);
  if (existing !== undefined) return existing.node;
  const created = { prefix: segment.prefix, suffix: segment.suffix, node: createNode() };
  node.partial.push(created);
  return created.node;
}

/**
 * D의 세그먼트로 trie를 걸어 D를 덮을 수 있는 E를 모은다. 노드 방문마다 예산을 쓴다.
 *
 * D 리터럴은 같은 리터럴·`{}`·골격이 맞는 부분 세그먼트 자식으로, D `{}`는 `{}` 자식으로, D 부분 세그먼트는 `{}`와
 * 골격을 좁힌 부분 세그먼트 자식으로 간다. 각 노드의 `{**}` decl은 남은 D 세그먼트 전체의 후보다.
 */
function walk(root: ShadowNode, segments: readonly RouteSegment[], budget: { remaining: number }): RouteDeclaration[] {
  const found: RouteDeclaration[] = [];
  const visit = (node: ShadowNode, position: number): void => {
    spend(budget);
    if (position < segments.length) found.push(...node.catchAll);
    if (position === segments.length) {
      found.push(...node.terminal);
      return;
    }
    const segment = segments[position]!;
    if (segment.kind === 'catch-all') return;
    if (segment.kind === 'literal') {
      const child = node.literal.get(segment.value);
      if (child !== undefined) visit(child, position + 1);
      if (segment.value === '') return;
    }
    if (node.param !== undefined) visit(node.param, position + 1);
    for (const { prefix, suffix, node: child } of node.partial) {
      const fits = segment.kind === 'literal'
        ? segment.value.length > prefix.length + suffix.length && segment.value.startsWith(prefix) && segment.value.endsWith(suffix)
        : segment.kind === 'partial' && segment.prefix.startsWith(prefix) && segment.suffix.endsWith(suffix);
      if (fits) visit(child, position + 1);
    }
  };
  visit(root, 0);
  return found;
}
