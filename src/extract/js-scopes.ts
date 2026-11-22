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
 * 블록 밖) 역시 모듈이 아니다. 가림 구간은 중첩되거나 서로 떨어져 있다(괄호 짝 표의 구간이다). 정하지 못하는
 * 위치는 귀속하지 않고 호출자가 범위 밖 참조로 세도록 표시한다.
 *
 * 비용: 선언·재대입·조회는 같은 이름의 선언 수에 비례해 훑지 않는다. 묶음마다 값·무효·불확실 요약을 들고, 값 적용
 * 구간은 시작 위치 순 색인(앞쪽 끝 최댓값)으로, 감싼 묶음은 건너뛰기 포인터로 찾는다.
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
 *
 * 값이 없는 해석 중 위치가 가림 구간 안이지만 값이 적용되는 구간 밖이면 동결한 뒤의 조회가 두 표시를 계산한다.
 * `hidesModule`은 스캔이 정하지 못한 모듈 바인딩이 있다는 표시다 — 블록 밖의 `var`가 모듈 값이거나, 범위가 넓게
 * 잡힌 선언이 바깥 모듈 바인딩을 가렸다. `hidesOuter`는 넓게 잡힌 선언 너머에 이 파일의 선언이 없어 위치의 이름이
 * import·전역일 수 있다는 표시다. 어느 쪽이든 그 쓰임은 귀속하지 않고 범위 밖 참조로 센다. `parameter`는 이 파일의
 * 선언이 아니라 호출자가 알려 준 매개변수가 그 위치의 이름을 차지했다는 표시다.
 */
export type ScopedResolution =
  | { readonly claimed: false }
  | {
    readonly claimed: true;
    readonly value?: BoundName;
    readonly literal?: string;
    readonly hidesModule?: true;
    readonly hidesOuter?: true;
    readonly parameter?: true;
  };

/** 같은 가림 구간을 차지한 선언 묶음과 그 요약이다. */
interface Group extends TokenRange {
  /** 재대입으로 무효가 됐는지다. 무효는 그때까지의 선언 전체에 적용되므로 묶음 단위로 둔다. */
  invalidated: boolean;
  /** 모듈 값 요약이다 — 아직 없으면 undefined, 값 없는 선언이나 서로 다른 모듈이 있으면 null이다. */
  module: BoundName | null | undefined;
  /** 문자열 상수 요약이다(모듈 값과 같은 규칙). */
  literal: string | null | undefined;
  /** 모든 선언의 범위가 넓게 잡혔는지(`uncertainExtent`)다. */
  allUncertain: boolean;
  /** 값 적용 구간(중복 없음)이다. 구간이 많아지면 중복 판정용 키 집합을 함께 둔다. */
  readonly binds: TokenRange[];
  bindKeys?: Set<string>;
  /** 값 적용 구간의 가장 앞 시작·가장 뒤 끝이다. */
  minBindFrom: number;
  maxBindTo: number;
  /** 동결 뒤 값 적용 구간이 둘 이상이면 시작 위치 순 시작·앞쪽 끝 최댓값 배열이다. */
  frozenBinds?: { readonly froms: Int32Array; readonly prefixMaxTo: Int32Array };
}

/** 표 안의 선언이다. 속한 이름·묶음을 함께 기억한다. */
interface Declaration extends ScopedDeclarationInput {
  readonly entry: NameEntry;
  readonly group: Group;
}

/** 동결한 이름별 색인이다 — 가림 구간을 시작 위치 순으로 두고 감싼 묶음·건너뛰기 포인터를 함께 저장한다. */
interface FrozenGroups {
  readonly groups: readonly Group[];
  readonly parents: Int32Array;
  /** 감싼 묶음 사슬의 건너뛰기 포인터다(사향 이진 점프). 끝 위치가 위로 갈수록 커지는 사슬을 로그 단계로 오른다. */
  readonly jumps: Int32Array;
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
  /** 가림 구간이 중첩·분리를 어기거나 정할 수 없으면 이 이름의 바인딩을 쓰지 않는다. */
  broken: boolean;
  frozen?: FrozenGroups;
}

/** 넓게 잡힌 묶음을 따라 오르는 단계 상한이다. 넘으면 정하지 못한 것으로 보고 귀속하지 않는다(센다). */
const MAX_UNCERTAIN_WALK = 64;

/** 어떤 선언도 이름을 차지하지 않은 해석이다. */
const unclaimed: ScopedResolution = { claimed: false };

/** 이름을 차지했지만 모듈·문자열 값이 없는 해석이다. */
const claimedWithoutValue: ScopedResolution = { claimed: true };

/** 값이 적용되는 구간 밖이라 모듈 바인딩을 정하지 못한 해석이다. */
const claimedHidingModule: ScopedResolution = { claimed: true, hidesModule: true };

/** 넓게 잡힌 선언 너머의 import·전역 이름일 수 있는 해석이다. */
const claimedHidingOuter: ScopedResolution = { claimed: true, hidesOuter: true };

/** 매개변수가 이름을 차지한 해석이다. */
const claimedByParameter: ScopedResolution = { claimed: true, parameter: true };

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
 * `freeze`가 이름별로 정렬해 이후 조회(호출 후보·이탈 계수 — 식별자마다 한 번)를 이분 탐색과 건너뛰기 포인터로
 * 답한다. 묶음 값은 선언을 넣을 때 요약해 두므로 같은 범위에 같은 이름 선언이 많아도 조회가 선언을 훑지 않는다.
 */
export class ScopedBindingTable {
  readonly #byName = new Map<string, NameEntry>();
  /** 선언 순서다. 이름별 대표 값과 추적 초기값을 원문 순서로 낸다. */
  readonly #declarations: Declaration[] = [];
  /** 수집 중 반영한 재대입 위치다. 동결할 때 모든 선언을 본 해석으로 한 번 더 반영한다. */
  readonly #assignments: { readonly name: string; readonly index: number }[] = [];
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
      group = {
        from: input.shadow.from, to: input.shadow.to, invalidated: false, module: undefined, literal: undefined,
        allUncertain: true, binds: [], minBindFrom: Infinity, maxBindTo: -Infinity,
      };
      entry.groups.set(key, group);
      insertIntoChain(entry, group);
    }
    summarize(group, input);
    const declaration: Declaration = { ...input, entry, group };
    this.#declarations.push(declaration);
  }

  /**
   * 위치 `index`의 `name = …` 재대입을 반영한다 — 그 위치에서 이름을 차지한 묶음을 무효로 한다. 위치가 넓게 잡힌
   * 선언(본문 끝을 모르는 for 머리)의 값 적용 구간 밖이면 그 대입이 바깥 선언의 것일 수 있어 바깥 묶음도 무효로
   * 한다. 차지한 선언이 없으면(전역·다른 함수의 이름) 아무것도 바꾸지 않는다.
   *
   * 수집 중에는 그때까지의 선언으로 바로 반영해 뒤 별칭·export 해석이 대입 뒤 값을 따라가지 않게 하고, 동결할 때
   * 모든 선언을 본 해석으로 다시 반영한다 — 앞에 선언된 함수 본문의 대입(`function reset() { M = x; }` 뒤의
   * `let M = …`)도 그 바인딩을 지운다.
   */
  invalidate(name: string, index: number): void {
    if (!this.#frozen) this.#assignments.push({ name, index });
    const entry = this.#byName.get(name);
    if (entry !== undefined && !entry.broken) invalidateAt(entry, index);
  }

  /**
   * 위치 `index`의 이름 `name`을 해석한다. `floor`는 그 위치를 가린 매개변수 목록의 시작 위치다 — 그보다 안쪽에서
   * 시작한 범위의 선언만 매개변수보다 안쪽이라 이기고, 그렇지 않으면 매개변수가 이름을 차지한다(값 없음).
   */
  resolve(name: string, index: number, floor = -Infinity): ScopedResolution {
    const entry = this.#byName.get(name);
    const parameter = floor > -Infinity;
    if (entry === undefined) return parameter ? claimedByParameter : unclaimed;
    if (entry.broken) return claimedWithoutValue;
    const group = innermost(entry, index);
    if (group === undefined || group.from <= floor) return parameter ? claimedByParameter : unclaimed;
    if (!coversBinding(group, index, entry)) {
      if (entry.frozen === undefined) return claimedWithoutValue;
      const hidden = hiddenBinding(entry, index, floor);
      return hidden === 'module' ? claimedHidingModule : hidden === 'outer' ? claimedHidingOuter : claimedWithoutValue;
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
      if (frozen === undefined) {
        entry.broken = true;
        continue;
      }
      entry.frozen = frozen;
      for (const group of frozen.groups) freezeBinds(group);
    }
    for (const { name, index } of this.#assignments) {
      const entry = this.#byName.get(name);
      if (entry !== undefined && !entry.broken) invalidateAt(entry, index);
    }
  }

  /**
   * 이름마다 실효 모듈 값을 가진 선언의 값이다 — 키는 그런 선언이 처음 나온 순서, 값은 마지막 선언의 값이다.
   * 위치별 해석이 아니라 이 파일에 그 이름의 모듈 바인딩이 있다는 요약이다. 호출 귀속에는 `resolve`를 쓴다.
   */
  moduleBindings(): Map<string, BoundName> {
    const bindings = new Map<string, BoundName>();
    for (const declaration of this.#declarations) {
      const value = declaration.entry.broken ? undefined : groupValue(declaration.group);
      if (value !== undefined) bindings.set(declaration.name, value);
    }
    return bindings;
  }

  /** 이름마다 실효 문자열 상수 값이다(`moduleBindings`와 같은 요약). */
  literalBindings(): Map<string, string> {
    const literals = new Map<string, string>();
    for (const declaration of this.#declarations) {
      const literal = declaration.entry.broken ? undefined : groupLiteral(declaration.group);
      if (literal !== undefined) literals.set(declaration.name, literal);
    }
    return literals;
  }

  /** 수집이 끝난 뒤에도 자기 값을 그대로 가진 선언의 초기값 시작 위치다 — 그 초기값은 바인딩이 따라간다. */
  trackedInitializerStarts(): number[] {
    return this.#declarations.flatMap((declaration) => {
      const value = declaration.entry.broken ? undefined : groupValue(declaration.group);
      return declaration.initializerStart !== undefined && value !== undefined &&
        declaration.value !== undefined && sameBoundName(value, declaration.value)
        ? [declaration.initializerStart]
        : [];
    });
  }
}

/**
 * 위치의 재대입이 닿는 묶음을 무효로 한다 — 덮는 묶음을 안쪽부터, 값이 위치를 덮거나 범위가 확실한 묶음까지.
 * 넓게 잡힌 묶음이 상한보다 깊게 겹쳐 대입의 대상을 정하지 못하면 이 이름을 쓰지 않는다.
 */
function invalidateAt(entry: NameEntry, index: number): void {
  let steps = 0;
  for (const group of containingGroups(entry, index)) {
    group.invalidated = true;
    if (coversBinding(group, index, entry) || !group.allUncertain) return;
    if (++steps > MAX_UNCERTAIN_WALK) {
      entry.broken = true;
      return;
    }
  }
}

/** 가림 구간의 묶음 키다. */
function rangeKey(range: TokenRange): string {
  return `${range.from}:${range.to}`;
}

/** 선언 하나를 묶음 요약에 더한다. */
function summarize(group: Group, input: ScopedDeclarationInput): void {
  if (input.value === undefined) group.module = null;
  else if (group.module === undefined) group.module = input.value;
  else if (group.module !== null && !sameBoundName(group.module, input.value)) group.module = null;
  if (input.literal === undefined) group.literal = null;
  else if (group.literal === undefined) group.literal = input.literal;
  else if (group.literal !== input.literal) group.literal = null;
  if (input.uncertainExtent !== true) group.allUncertain = false;
  if (hasBind(group, input.bind)) return;
  group.binds.push(input.bind);
  group.minBindFrom = Math.min(group.minBindFrom, input.bind.from);
  group.maxBindTo = Math.max(group.maxBindTo, input.bind.to);
}

/** 묶음 구간 수 이하면 키 집합 없이 훑어 중복을 판정한다(대부분 묶음은 구간이 하나다). */
const BIND_SCAN_LIMIT = 8;

/** 같은 값 적용 구간이 이미 있는지 본다. 구간이 많아지면 키 집합으로 판정한다. */
function hasBind(group: Group, bind: TokenRange): boolean {
  if (group.binds.length < BIND_SCAN_LIMIT) {
    return group.binds.some(({ from, to }) => from === bind.from && to === bind.to);
  }
  group.bindKeys ??= new Set(group.binds.map(rangeKey));
  const key = rangeKey(bind);
  if (group.bindKeys.has(key)) return true;
  group.bindKeys.add(key);
  return false;
}

/** 묶음이 무효가 아니고 모든 선언이 같은 모듈이면 그 값이다. */
function groupValue(group: Group): BoundName | undefined {
  return group.invalidated || group.module === null ? undefined : group.module;
}

/** 묶음이 무효가 아니고 모든 선언이 같은 문자열 상수면 그 값이다. */
function groupLiteral(group: Group): string | undefined {
  return group.invalidated || group.literal === null ? undefined : group.literal;
}

/**
 * 위치가 묶음의 어느 값 적용 구간 안인지 본다. 동결 뒤에는 시작 위치 순 색인으로, 수집 중 사슬 조회에서는 그때까지
 * 넣은 구간이 모두 위치보다 앞에서 시작하므로 가장 뒤 끝으로 답한다. 그 밖(앞 위치 재조회)은 구간을 훑는다.
 */
function coversBinding(group: Group, index: number, entry: NameEntry): boolean {
  if (index < group.minBindFrom || index > group.maxBindTo) return false;
  if (group.binds.length === 1) return true;
  if (group.frozenBinds !== undefined) {
    const { froms, prefixMaxTo } = group.frozenBinds;
    let low = 0;
    let high = froms.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (froms[middle]! <= index) low = middle + 1;
      else high = middle;
    }
    return low > 0 && prefixMaxTo[low - 1]! >= index;
  }
  if (entry.frozen === undefined && index >= entry.position) return true;
  return group.binds.some(({ from, to }) => from <= index && index <= to);
}

/** 동결할 때 값 적용 구간이 둘 이상인 묶음의 색인을 만든다. */
function freezeBinds(group: Group): void {
  if (group.binds.length < 2) return;
  const sorted = [...group.binds].sort((left, right) => left.from - right.from);
  const froms = new Int32Array(sorted.length);
  const prefixMaxTo = new Int32Array(sorted.length);
  sorted.forEach(({ from, to }, index) => {
    froms[index] = from;
    prefixMaxTo[index] = Math.max(to, index === 0 ? to : prefixMaxTo[index - 1]!);
  });
  group.frozenBinds = { froms, prefixMaxTo };
}

/**
 * 값 적용 구간 밖 위치에서 정하지 못한 바인딩을 찾는다. 위치를 덮는 묶음을 안쪽부터 본다 — 값이 위치를 덮는
 * 묶음이면 그 값이 모듈일 때 'module'이고, 덮지 못하는 묶음 자체가 모듈 값이면(블록 밖의 `var`) 'module'이다.
 * 덮지 못하는 묶음이 실제 범위가 확실한 선언이면(`var`의 함수 본문) 바깥 바인딩은 확실히 가려져 없다. 범위가 넓게
 * 잡힌 선언일 때만 바깥 묶음으로 올라가고, 더 바깥에 이 파일의 선언이 없으면 'outer'(import·전역일 수 있다)다.
 * `floor`의 매개변수 목록에 닿으면 매개변수가 확실히 가린다. 상한을 넘게 오르면 정하지 못한 모듈로 본다.
 */
function hiddenBinding(entry: NameEntry, index: number, floor: number): 'module' | 'outer' | undefined {
  let steps = 0;
  for (const group of containingGroups(entry, index)) {
    if (group.from <= floor) return undefined;
    if (coversBinding(group, index, entry)) return groupValue(group) === undefined ? undefined : 'module';
    if (groupValue(group) !== undefined) return 'module';
    if (!group.allUncertain) return undefined;
    if (++steps > MAX_UNCERTAIN_WALK) return 'module';
  }
  return floor > -Infinity ? undefined : 'outer';
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
  if (advanceChain(entry, index)) return entry.chain.at(-1);
  return containingByScan(entry, index)[0];
}

/**
 * 수집 중 사슬을 위치까지 나아가게 한다. 위치가 사슬이 답할 수 있는 범위면 지나간 묶음을 버리고 참이다 — 그때
 * 사슬의 묶음은 모두 위치를 덮고 맨 위가 가장 안쪽이다.
 */
function advanceChain(entry: NameEntry, index: number): boolean {
  if (index < entry.position) return false;
  entry.position = index;
  const { chain } = entry;
  while (chain.length > 0 && chain.at(-1)!.to < index) chain.pop();
  return chain.length === 0 || chain.at(-1)!.from <= index;
}

/** 앞 위치를 다시 묻는 조회(지금 수집 순회에는 없다)는 묶음 전체를 훑어 덮는 묶음을 안쪽부터 낸다. */
function containingByScan(entry: NameEntry, index: number): Group[] {
  return [...entry.groups.values()]
    .filter((group) => group.from <= index && index <= group.to)
    .sort((left, right) => right.from - left.from || left.to - right.to);
}

/** 위치를 덮는 묶음을 안쪽부터 바깥으로 낸다. */
function* containingGroups(entry: NameEntry, index: number): Generator<Group> {
  if (entry.frozen !== undefined) {
    const { groups, parents } = entry.frozen;
    for (let cursor = innermostFrozenIndex(entry.frozen, index); cursor !== -1; cursor = parents[cursor]!) {
      yield groups[cursor]!;
    }
    return;
  }
  if (advanceChain(entry, index)) {
    for (let cursor = entry.chain.length - 1; cursor >= 0; cursor--) yield entry.chain[cursor]!;
    return;
  }
  yield* containingByScan(entry, index);
}

/**
 * 묶음을 시작 위치 오름차순(같으면 바깥 먼저)으로 정렬하고 가장 가까운 감싼 묶음과 건너뛰기 포인터를 만든다. 구간이
 * 겹치기만 하고 감싸지 않는 쌍이 있으면 undefined다.
 */
function freezeGroups(unsorted: Group[]): FrozenGroups | undefined {
  const groups = unsorted.sort((left, right) => left.from - right.from || right.to - left.to);
  const parents = new Int32Array(groups.length).fill(-1);
  const depths = new Int32Array(groups.length);
  const jumps = new Int32Array(groups.length);
  const stack: number[] = [];
  for (const [index, group] of groups.entries()) {
    while (stack.length > 0 && groups[stack.at(-1)!]!.to < group.from) stack.pop();
    const parent = stack.at(-1);
    if (parent === undefined) {
      jumps[index] = index;
    } else {
      if (groups[parent]!.to < group.to) return undefined;
      parents[index] = parent;
      depths[index] = depths[parent]! + 1;
      // 사향 이진 점프 포인터: 부모의 점프 두 칸이 같은 길이면 합쳐 더 멀리, 아니면 부모로 둔다.
      const jump = jumps[parent]!;
      jumps[index] = depths[parent]! - depths[jump]! === depths[jump]! - depths[jumps[jump]!]! ? jumps[jump]! : parent;
    }
    stack.push(index);
  }
  return { groups, parents, jumps };
}

/**
 * 중첩·분리 구간에서 위치를 덮는 가장 안쪽 묶음의 순번이다(없으면 -1). 시작이 위치 이하인 마지막 묶음에서 감싼
 * 묶음을 따라 오르면 처음 만나는 덮는 묶음이 가장 안쪽이다. 감싼 묶음은 위로 갈수록 끝이 뒤라, 점프 대상도 위치에
 * 못 미치면 건너뛰어 사슬 길이의 로그 단계로 찾는다.
 */
function innermostFrozenIndex(frozen: FrozenGroups, index: number): number {
  const { groups, parents, jumps } = frozen;
  let low = 0;
  let high = groups.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (groups[middle]!.from <= index) low = middle + 1;
    else high = middle;
  }
  let cursor = low - 1;
  while (cursor !== -1 && groups[cursor]!.to < index) {
    const jump = jumps[cursor]!;
    cursor = jump !== cursor && groups[jump]!.to < index ? jump : parents[cursor]!;
  }
  return cursor;
}

/** 위치를 덮는 가장 안쪽 묶음이다. */
function innermostFrozen(frozen: FrozenGroups, index: number): Group | undefined {
  const cursor = innermostFrozenIndex(frozen, index);
  return cursor === -1 ? undefined : frozen.groups[cursor];
}
