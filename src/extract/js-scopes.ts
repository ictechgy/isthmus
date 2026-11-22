/**
 * extract-js의 블록 범위 바인딩 표다.
 *
 * 파일 전역 지도는 서로 다른 함수 본문이 같은 이름을 다른 모듈에 묶으면 마지막 선언이 이겨, 앞 함수의 호출을
 * 거짓 모듈로 귀속했다. 이 표는 선언마다 이름을 차지하는 구간(가림)과 값이 적용되는 구간(묶임)을 두고, 위치
 * 하나의 이름을 그 위치를 덮는 가장 안쪽 가림 구간의 선언으로만 해석한다. 토큰을 읽지 않는 순수 자료 구조다 —
 * 구간 계산은 스캐너가 한다.
 *
 * 건전성 규칙: 같은 가림 구간의 선언 중 하나라도 모듈이 아니거나 재대입으로 무효가 됐거나 서로 다른 모듈이면
 * 그 구간의 이름은 아무 모듈도 아니다(호출은 미귀속). 위치가 어느 선언의 묶임 구간에도 없으면(함수 범위 `var`의
 * 블록 밖) 역시 모듈이 아니다. 가림 구간은 중첩되거나 서로 떨어져 있다(괄호 짝 표의 구간이다).
 */

import type { BoundName } from './js-scan.ts';

/** 토큰 위치 구간이다(양 끝 포함). */
export interface TokenRange {
  readonly from: number;
  readonly to: number;
}

/** 표에 넣는 선언 하나다. */
export interface ScopedDeclarationInput {
  readonly name: string;
  /** 이 선언이 이름을 차지해 바깥 선언을 가리는 구간이다. */
  readonly shadow: TokenRange;
  /** 이 선언의 값이 적용되는 구간이다. 가림 구간 안에 있다. */
  readonly bind: TokenRange;
  /**
   * 가림 구간 중 값 적용 구간 밖이 이 선언의 실제 범위인지 모르는 선언이다(본문이 블록이 아닌 for 머리 선언 — 본문
   * 문장의 끝을 찾지 않고 감싼 블록 끝까지 가린다). 그 밖 위치에서는 바깥 바인딩이 보일 수도 있다. 없으면 가림 구간
   * 전체가 이 선언의 범위다(`var`의 함수 본문).
   */
  readonly uncertainExtent?: true;
  /** 초기값이 인식한 모듈 식이면 그 값이다. 없으면 이름만 차지한다. */
  readonly value?: BoundName;
  /** 초기값이 한 단계 문자열 상수면 그 값이다. */
  readonly literal?: string;
  /** 모듈 값을 준 초기값 식의 시작 토큰 위치다(추적 바인딩 판정용). */
  readonly initializerStart?: number;
}

/**
 * 위치 하나에서 이름을 해석한 결과다. `claimed`가 거짓이면 이 파일의 어떤 선언도 그 위치의 이름을 차지하지 않는다.
 * `hidesModule`은 값이 없는 해석 중, 위치가 가림 구간 안이지만 값이 적용되는 구간 밖이라 스캔이 정하지 못한 모듈
 * 바인딩이 있다는 표시다 — 블록 밖의 `var`가 모듈 값이거나, 본문이 블록이 아닌 for 머리 선언의 넓힌 가림이 바깥
 * 모듈 바인딩을 가렸다. 그 쓰임은 귀속하지 않고 범위 밖 참조로 센다. 동결한 뒤의 조회만 이 표시를 계산한다.
 */
export type ScopedResolution =
  | { readonly claimed: false }
  | {
    readonly claimed: true;
    readonly value?: BoundName;
    readonly literal?: string;
    readonly hidesModule?: true;
  };

/** 표 안의 선언이다. 재대입을 만나면 무효로 표시한다. */
interface Declaration extends ScopedDeclarationInput {
  invalidated: boolean;
}

/** 같은 가림 구간을 차지한 선언 묶음이다. */
interface Group extends TokenRange {
  readonly declarations: Declaration[];
}

/** 동결한 이름별 색인이다 — 가림 구간을 시작 위치 순으로 두고 가장 가까운 감싼 묶음을 함께 저장한다. */
interface FrozenGroups {
  readonly groups: readonly Group[];
  readonly parents: Int32Array;
}

/** 이름 하나의 선언 묶음과 조회 색인이다. */
interface NameEntry {
  /** 가림 구간(`from:to`)별 묶음이다. */
  readonly groups: Map<string, Group>;
  /**
   * 수집 중 조회에 쓰는 활성 사슬이다(바깥 → 안쪽으로 서로 감싼 묶음). 수집 순회는 앞에서 뒤로 가므로 조회 위치가
   * 줄지 않는다 — 지나간 묶음을 안쪽부터 버리면 맨 위가 지금 위치를 덮는 가장 안쪽 묶음이다.
   */
  readonly chain: Group[];
  /** 사슬이 답할 수 있는 가장 앞 위치다. 이보다 앞 위치의 조회는 묶음 전체를 훑는다. */
  position: number;
  /** 가림 구간이 중첩·분리를 어기면(짝을 맞추지 못한 괄호) 이 이름의 바인딩을 쓰지 않는다. */
  broken: boolean;
  frozen?: FrozenGroups;
}

/** 어떤 선언도 이름을 차지하지 않은 해석이다. */
const unclaimed: ScopedResolution = { claimed: false };

/** 이름을 차지했지만 모듈·문자열 값이 없는 해석이다. */
const claimedWithoutValue: ScopedResolution = { claimed: true };

/** 값이 적용되는 구간 밖이라 모듈 바인딩을 정하지 못한 해석이다. */
const claimedHidingModule: ScopedResolution = { claimed: true, hidesModule: true };

/** 같은 모듈을 가리키는 바인딩 값인지 본다. */
export function sameBoundName(left: BoundName | undefined, right: BoundName): boolean {
  if (left === undefined) return false;
  if ('name' in left) return 'name' in right && left.name === right.name;
  return 'dynamicExpression' in right && left.dynamicExpression === right.dynamicExpression;
}

/**
 * 선언을 이름·가림 구간별로 모아 위치마다 해석하는 표다.
 *
 * 수집 중의 조회(선언 초기값·재대입·export)는 그때까지 넣은 선언만 보고 이름별 활성 사슬로 답한다. 수집이 끝나면
 * `freeze`가 이름별로 정렬해 이후 조회(호출 후보·이탈 계수 — 식별자마다 한 번)를 이분 탐색과 감싼 묶음 따라
 * 오르기로 답한다. 어느 쪽도 같은 이름의 선언 수에 비례해 훑지 않는다.
 */
export class ScopedBindingTable {
  readonly #byName = new Map<string, NameEntry>();
  /** 선언 순서다. 이름별 대표 값과 추적 초기값을 원문 순서로 낸다. */
  readonly #declarations: Declaration[] = [];
  #frozen = false;

  /** 선언 하나를 넣는다. 동결한 뒤에는 넣지 않는다. */
  declare(input: ScopedDeclarationInput): void {
    if (this.#frozen) throw new Error('scoped binding table is frozen');
    let entry = this.#byName.get(input.name);
    if (entry === undefined) {
      entry = { groups: new Map(), chain: [], position: -Infinity, broken: false };
      this.#byName.set(input.name, entry);
    }
    const key = rangeKey(input.shadow);
    let group = entry.groups.get(key);
    if (group === undefined) {
      group = { from: input.shadow.from, to: input.shadow.to, declarations: [] };
      entry.groups.set(key, group);
      insertIntoChain(entry, group);
    }
    const declaration: Declaration = { ...input, invalidated: false };
    group.declarations.push(declaration);
    this.#declarations.push(declaration);
  }

  /**
   * 위치 `index`의 `name = …` 재대입을 반영한다 — 그 위치에서 이름을 차지한 묶음의 선언을 모두 무효로 한다.
   * 차지한 선언이 없으면(전역·다른 함수의 이름) 아무것도 바꾸지 않는다.
   */
  invalidate(name: string, index: number): void {
    const entry = this.#byName.get(name);
    if (entry === undefined || entry.broken) return;
    const group = innermost(entry, index);
    if (group === undefined) return;
    for (const declaration of group.declarations) declaration.invalidated = true;
  }

  /** 위치 `index`의 이름 `name`을 해석한다. */
  resolve(name: string, index: number): ScopedResolution {
    const entry = this.#byName.get(name);
    if (entry === undefined) return unclaimed;
    if (entry.broken) return claimedWithoutValue;
    const group = innermost(entry, index);
    if (group === undefined) return unclaimed;
    if (!coversBinding(group, index)) {
      return entry.frozen !== undefined && hidesModule(entry.frozen, index) ? claimedHidingModule : claimedWithoutValue;
    }
    const value = groupValue(group);
    const literal = groupLiteral(group);
    return {
      claimed: true,
      ...(value === undefined ? {} : { value }),
      ...(literal === undefined ? {} : { literal }),
    };
  }

  /** 수집을 끝내고 이름별 정렬 색인을 만든다. 이후 조회는 이 색인을 쓴다. */
  freeze(): void {
    if (this.#frozen) return;
    this.#frozen = true;
    for (const entry of this.#byName.values()) {
      if (entry.broken) continue;
      const frozen = freezeGroups([...entry.groups.values()]);
      if (frozen === undefined) entry.broken = true;
      else entry.frozen = frozen;
    }
  }

  /**
   * 이름마다 실효 모듈 값을 가진 선언의 값이다 — 키는 그런 선언이 처음 나온 순서, 값은 마지막 선언의 값이다.
   * 위치별 해석이 아니라 이 파일에 그 이름의 모듈 바인딩이 있다는 요약이다. 호출 귀속에는 `resolve`를 쓴다.
   */
  moduleBindings(): Map<string, BoundName> {
    const bindings = new Map<string, BoundName>();
    for (const declaration of this.#declarations) {
      const value = this.#effectiveGroup(declaration, groupValue);
      if (value !== undefined) bindings.set(declaration.name, value);
    }
    return bindings;
  }

  /** 이름마다 실효 문자열 상수 값이다(`moduleBindings`와 같은 요약). */
  literalBindings(): Map<string, string> {
    const literals = new Map<string, string>();
    for (const declaration of this.#declarations) {
      const literal = this.#effectiveGroup(declaration, groupLiteral);
      if (literal !== undefined) literals.set(declaration.name, literal);
    }
    return literals;
  }

  /** 수집이 끝난 뒤에도 자기 값을 그대로 가진 선언의 초기값 시작 위치다 — 그 초기값은 바인딩이 따라간다. */
  trackedInitializerStarts(): number[] {
    return this.#declarations.flatMap((declaration) => {
      const value = this.#effectiveGroup(declaration, groupValue);
      return declaration.initializerStart !== undefined && value !== undefined &&
        declaration.value !== undefined && sameBoundName(value, declaration.value)
        ? [declaration.initializerStart]
        : [];
    });
  }

  /** 선언이 속한 묶음 전체로 정해지는 값이다. 바인딩을 쓰지 않는 이름이면 undefined다. */
  #effectiveGroup<T>(declaration: Declaration, read: (group: Group) => T | undefined): T | undefined {
    const entry = this.#byName.get(declaration.name);
    const group = entry === undefined || entry.broken ? undefined : entry.groups.get(rangeKey(declaration.shadow));
    return group === undefined ? undefined : read(group);
  }
}

/** 가림 구간의 묶음 키다. */
function rangeKey(range: TokenRange): string {
  return `${range.from}:${range.to}`;
}

/** 위치가 묶음의 어느 선언의 값 적용 구간 안인지 본다. */
function coversBinding(group: Group, index: number): boolean {
  return group.declarations.some(({ bind }) => bind.from <= index && index <= bind.to);
}

/**
 * 값 적용 구간 밖 위치에 스캔이 정하지 못한 모듈 바인딩이 있는지 본다. 위치를 덮는 묶음을 안쪽부터 본다 — 값이
 * 위치를 덮는 묶음이면 그 값이 모듈인지가 답이고, 덮지 못하는 묶음 자체가 모듈 값이면(블록 밖의 `var`) 참이다.
 * 덮지 못하는 묶음이 실제 범위가 확실한 선언이면(`var`의 함수 본문) 바깥 바인딩은 확실히 가려져 거짓이다. 범위가
 * 넓게 잡힌 선언(본문 끝을 모르는 for 머리)일 때만 바깥 묶음으로 올라간다.
 */
function hidesModule(frozen: FrozenGroups, index: number): boolean {
  for (const group of containingFrozen(frozen, index)) {
    if (coversBinding(group, index)) return groupValue(group) !== undefined;
    if (groupValue(group) !== undefined) return true;
    if (!group.declarations.every(({ uncertainExtent }) => uncertainExtent === true)) return false;
  }
  return false;
}

/** 구간 `outer`가 `inner`를 감싸는지(같아도 감싼다) 본다. */
function contains(outer: TokenRange, inner: TokenRange): boolean {
  return outer.from <= inner.from && inner.to <= outer.to;
}

/**
 * 새 묶음을 활성 사슬의 중첩 위치에 넣는다. 새 묶음보다 먼저 끝난 묶음은 버린다(수집 순회는 새 묶음의 선언
 * 위치보다 앞을 다시 조회하지 않는다). 사슬의 묶음과 감싸지도 감싸이지도 않고 겹치면 이름을 쓰지 않는다.
 */
function insertIntoChain(entry: NameEntry, group: Group): void {
  const { chain } = entry;
  while (chain.length > 0 && chain.at(-1)!.to < group.from) chain.pop();
  let at = chain.length;
  while (at > 0 && !contains(chain[at - 1]!, group)) {
    if (!contains(group, chain[at - 1]!)) {
      entry.broken = true;
      return;
    }
    at--;
  }
  chain.splice(at, 0, group);
  entry.position = Math.max(entry.position, group.from);
}

/** 위치를 덮는 가장 안쪽 가림 묶음이다. */
function innermost(entry: NameEntry, index: number): Group | undefined {
  if (entry.frozen !== undefined) return innermostFrozen(entry.frozen, index);
  if (index >= entry.position) {
    entry.position = index;
    const { chain } = entry;
    while (chain.length > 0 && chain.at(-1)!.to < index) chain.pop();
    const top = chain.at(-1);
    if (top === undefined || top.from <= index) return top;
  }
  // 앞 위치를 다시 묻는 조회(지금 수집 순회에는 없다)는 묶음 전체를 훑어 같은 답을 낸다.
  let best: Group | undefined;
  for (const group of entry.groups.values()) {
    if (group.from <= index && index <= group.to && (best === undefined || contains(best, group))) best = group;
  }
  return best;
}

/** 묶음의 모든 선언이 무효가 아니고 같은 모듈이면 그 값이다. */
function groupValue(group: Group): BoundName | undefined {
  let value: BoundName | undefined;
  for (const declaration of group.declarations) {
    if (declaration.invalidated || declaration.value === undefined) return undefined;
    if (value === undefined) value = declaration.value;
    else if (!sameBoundName(value, declaration.value)) return undefined;
  }
  return value;
}

/** 묶음의 모든 선언이 무효가 아니고 같은 문자열 상수면 그 값이다. */
function groupLiteral(group: Group): string | undefined {
  let literal: string | undefined;
  for (const declaration of group.declarations) {
    if (declaration.invalidated || declaration.literal === undefined) return undefined;
    if (literal === undefined) literal = declaration.literal;
    else if (literal !== declaration.literal) return undefined;
  }
  return literal;
}

/**
 * 묶음을 시작 위치 오름차순(같으면 바깥 먼저)으로 정렬하고 가장 가까운 감싼 묶음을 찾는다. 구간이 겹치기만 하고
 * 감싸지 않는 쌍이 있으면 undefined다.
 */
function freezeGroups(unsorted: Group[]): FrozenGroups | undefined {
  const groups = unsorted.sort((left, right) => left.from - right.from || right.to - left.to);
  const parents = new Int32Array(groups.length).fill(-1);
  const stack: number[] = [];
  for (const [index, group] of groups.entries()) {
    while (stack.length > 0 && groups[stack.at(-1)!]!.to < group.from) stack.pop();
    const parent = stack.at(-1);
    if (parent !== undefined) {
      if (groups[parent]!.to < group.to) return undefined;
      parents[index] = parent;
    }
    stack.push(index);
  }
  return { groups, parents };
}

/**
 * 중첩·분리 구간에서 위치를 덮는 가장 안쪽 묶음의 순번이다(없으면 -1). 시작이 위치 이하인 마지막 묶음에서 감싼
 * 묶음을 따라 오르면 처음 만나는 덮는 묶음이 가장 안쪽이다.
 */
function innermostFrozenIndex(frozen: FrozenGroups, index: number): number {
  const { groups, parents } = frozen;
  let low = 0;
  let high = groups.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (groups[middle]!.from <= index) low = middle + 1;
    else high = middle;
  }
  let cursor = low - 1;
  while (cursor !== -1 && groups[cursor]!.to < index) cursor = parents[cursor]!;
  return cursor;
}

/** 위치를 덮는 가장 안쪽 묶음이다. */
function innermostFrozen(frozen: FrozenGroups, index: number): Group | undefined {
  const cursor = innermostFrozenIndex(frozen, index);
  return cursor === -1 ? undefined : frozen.groups[cursor];
}

/** 위치를 덮는 묶음을 안쪽부터 바깥으로 낸다 — 가장 안쪽 묶음을 감싼 묶음은 모두 위치를 덮는다. */
function* containingFrozen(frozen: FrozenGroups, index: number): Generator<Group> {
  for (let cursor = innermostFrozenIndex(frozen, index); cursor !== -1; cursor = frozen.parents[cursor]!) {
    yield frozen.groups[cursor]!;
  }
}
