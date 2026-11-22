import assert from 'node:assert/strict';
import test from 'node:test';
import type { BoundName } from './js-scan.ts';
import type { ScopedDeclarationInput, ScopedResolution, TokenRange } from './js-scopes.ts';
import { ScopedBindingTable } from './js-scopes.ts';

/** 시드가 같으면 같은 수열을 내는 의사 난수다. */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2 ** 31;
    return state / 2 ** 31;
  };
}

/** 구간 하나를 짧게 만든다. */
function range(from: number, to: number): TokenRange {
  return { from, to };
}

test('위치마다 가장 안쪽 범위의 선언으로 해석하고 범위 밖은 차지하지 않는다', () => {
  const table = new ScopedBindingTable();
  // 파일 범위의 M = Outer, 함수 A 본문의 M = A, 함수 B 본문의 M(모듈이 아님).
  table.declare({ name: 'M', shadow: range(-1, 100), bind: range(-1, 100), value: { name: 'Outer' } });
  table.declare({ name: 'M', shadow: range(10, 20), bind: range(10, 20), value: { name: 'A' } });
  table.declare({ name: 'M', shadow: range(30, 40), bind: range(30, 40) });
  table.declare({ name: 'N', shadow: range(30, 40), bind: range(30, 40), literal: 'lit' });
  table.freeze();
  assert.deepEqual(table.resolve('M', 15), { claimed: true, value: { name: 'A' } });
  assert.deepEqual(table.resolve('M', 35), { claimed: true });
  assert.deepEqual(table.resolve('M', 50), { claimed: true, value: { name: 'Outer' } });
  assert.deepEqual(table.resolve('N', 35), { claimed: true, literal: 'lit' });
  assert.deepEqual(table.resolve('N', 50), { claimed: false });
  assert.deepEqual(table.resolve('Unknown', 15), { claimed: false });
  assert.deepEqual([...table.moduleBindings()], [['M', { name: 'A' }]]);
  assert.deepEqual([...table.literalBindings()], [['N', 'lit']]);
});

test('같은 범위의 선언이 다르거나 재대입되면 그 범위의 이름은 모듈이 아니고 초기값을 추적하지 않는다', () => {
  const table = new ScopedBindingTable();
  // 같은 함수의 var 두 개(같은 가림 구간)가 서로 다른 모듈을 묶는다.
  table.declare({ name: 'M', shadow: range(0, 50), bind: range(0, 50), value: { name: 'A' }, initializerStart: 3 });
  table.declare({ name: 'M', shadow: range(0, 50), bind: range(10, 20), value: { name: 'B' }, initializerStart: 13 });
  // 같은 모듈이면 그대로 쓴다.
  table.declare({ name: 'S', shadow: range(0, 50), bind: range(0, 50), value: { name: 'Same' }, initializerStart: 23 });
  table.declare({ name: 'S', shadow: range(0, 50), bind: range(30, 40), value: { name: 'Same' }, initializerStart: 33 });
  // 재대입은 그 위치를 차지한 범위만 무효로 한다 — 다른 범위의 같은 이름은 그대로다.
  table.declare({ name: 'R', shadow: range(60, 70), bind: range(60, 70), value: { name: 'R1' }, initializerStart: 61 });
  table.invalidate('R', 65);
  table.declare({ name: 'R', shadow: range(80, 90), bind: range(80, 90), value: { name: 'R2' }, initializerStart: 81 });
  table.invalidate('R', 95);
  table.freeze();
  assert.deepEqual(table.resolve('M', 5), { claimed: true });
  assert.deepEqual(table.resolve('S', 5), { claimed: true, value: { name: 'Same' } });
  assert.deepEqual(table.resolve('R', 65), { claimed: true });
  assert.deepEqual(table.resolve('R', 85), { claimed: true, value: { name: 'R2' } });
  assert.deepEqual(table.trackedInitializerStarts(), [23, 33, 81]);
  assert.deepEqual([...table.moduleBindings().keys()], ['S', 'R']);
});

test('값 적용 구간 밖이 모듈 바인딩을 가리면 동결한 뒤 그 사실을 표시한다', () => {
  const table = new ScopedBindingTable();
  // 함수 본문(0..50)의 var M = A는 블록(10..20)에만 값을 적용한다.
  table.declare({ name: 'M', shadow: range(0, 50), bind: range(10, 20), value: { name: 'A' } });
  // 바깥의 L = Outer를 본문이 블록이 아닌 for 머리 선언(60..65 머리, 가림은 60..90)이 가린다.
  table.declare({ name: 'L', shadow: range(-1, 100), bind: range(-1, 100), value: { name: 'Outer' } });
  table.declare({ name: 'L', shadow: range(60, 90), bind: range(60, 65), uncertainExtent: true });
  // 넓게 잡힌 가림 너머에 이 파일의 선언이 없으면 import·전역일 수 있다고 표시한다.
  table.declare({ name: 'P', shadow: range(60, 90), bind: range(60, 65), uncertainExtent: true });
  // 넓게 잡힌 가림 너머의 바깥 이름이 모듈이 아니면 표시하지 않는다.
  table.declare({ name: 'R', shadow: range(-1, 100), bind: range(-1, 100) });
  table.declare({ name: 'R', shadow: range(60, 90), bind: range(60, 65), uncertainExtent: true });
  // 범위가 확실한 선언(함수 본문의 모듈 아닌 var)은 바깥 모듈 바인딩을 확실히 가린다.
  table.declare({ name: 'Q', shadow: range(-1, 100), bind: range(-1, 100), value: { name: 'Outer' } });
  table.declare({ name: 'Q', shadow: range(0, 50), bind: range(10, 20) });
  // 수집 중에는 계산하지 않는다.
  assert.deepEqual(table.resolve('M', 30), { claimed: true });
  table.freeze();
  assert.deepEqual(table.resolve('M', 30), { claimed: true, hidesModule: true });
  assert.deepEqual(table.resolve('M', 15), { claimed: true, value: { name: 'A' } });
  assert.deepEqual(table.resolve('L', 80), { claimed: true, hidesModule: true });
  assert.deepEqual(table.resolve('L', 62), { claimed: true });
  assert.deepEqual(table.resolve('L', 95), { claimed: true, value: { name: 'Outer' } });
  assert.deepEqual(table.resolve('P', 80), { claimed: true, hidesOuter: true });
  assert.deepEqual(table.resolve('R', 80), { claimed: true });
  assert.deepEqual(table.resolve('Q', 30), { claimed: true });
  assert.deepEqual(table.resolve('Q', 60), { claimed: true, value: { name: 'Outer' } });
});

test('겹치기만 하는 범위가 있는 이름은 쓰지 않고 동결 뒤에는 선언을 받지 않는다', () => {
  const table = new ScopedBindingTable();
  table.declare({ name: 'M', shadow: range(0, 20), bind: range(0, 20), value: { name: 'A' } });
  table.declare({ name: 'M', shadow: range(10, 30), bind: range(10, 30), value: { name: 'A' } });
  table.declare({ name: 'Late', shadow: range(0, 5), bind: range(0, 5), value: { name: 'X' } });
  table.declare({ name: 'Late', shadow: range(40, 50), bind: range(40, 50), value: { name: 'Y' } });
  table.declare({ name: 'Late', shadow: range(42, 60), bind: range(42, 60), value: { name: 'Y' } });
  assert.deepEqual(table.resolve('M', 5), { claimed: true });
  table.invalidate('M', 5);
  table.declare({ name: 'Plain', shadow: range(0, 20), bind: range(0, 20) });
  table.declare({ name: 'Plain', shadow: range(10, 30), bind: range(10, 30) });
  table.freeze();
  // 사슬에 넣을 때 겹침을 알아챈 이름과, 사슬에서 버린 뒤라 동결할 때 알아챈 이름 둘 다다. 모듈 값 선언이 있는 이름의
  // 쓰임은 정하지 못한 모듈 바인딩으로 센다(전에는 표시 없이 버려 조용히 사라졌다).
  assert.deepEqual(table.resolve('M', 5), { claimed: true, hidesModule: true });
  assert.deepEqual(table.resolve('Late', 2), { claimed: true, hidesModule: true });
  assert.deepEqual(table.resolve('Plain', 2), { claimed: true });
  assert.deepEqual([...table.moduleBindings()], []);
  assert.deepEqual(table.trackedInitializerStarts(), []);
  assert.throws(() => table.declare({ name: 'X', shadow: range(0, 1), bind: range(0, 1) }), /frozen/u);
});

/** 무작위 중첩·분리 구간 묶음이다. */
function laminarRanges(random: () => number, size: number): TokenRange[] {
  const ranges: TokenRange[] = [range(-1, size)];
  const split = (from: number, to: number, depth: number) => {
    let cursor = from + 1;
    while (depth < 4 && cursor < to - 2 && random() < 0.7) {
      const start = cursor + Math.floor(random() * 3);
      const end = Math.min(to - 1, start + 2 + Math.floor(random() * (to - start) * 0.6));
      if (end <= start) break;
      ranges.push(range(start, end));
      split(start, end, depth + 1);
      cursor = end + 1;
    }
  };
  split(-1, size, 0);
  return ranges;
}

/** 기준 모델이 기억하는 선언이다. 무효 표시는 그 선언이 속한 묶음 전체에 함께 붙는다. */
type RecordedDeclaration = ScopedDeclarationInput & { invalidated: boolean; invalidatedUncertainly: boolean };

/** 위치를 덮는 같은 이름 가림 구간을 안쪽부터 낸다(같은 구간은 한 번). */
function referenceShadows(declarations: readonly RecordedDeclaration[], name: string, index: number): TokenRange[] {
  return [...new Set(declarations
    .filter(({ name: other, shadow }) => other === name && shadow.from <= index && index <= shadow.to)
    .map(({ shadow }) => `${shadow.from}:${shadow.to}`))]
    .map((key) => key.split(':').map(Number) as [number, number])
    .sort((left, right) => right[0] - left[0] || left[1] - right[1])
    .map(([from, to]) => range(from, to));
}

/** 같은 이름·같은 가림 구간의 선언(묶음)이다. */
function referenceMembers(declarations: readonly RecordedDeclaration[], name: string, shadow: TokenRange) {
  return declarations.filter(({ name: other, shadow: own }) => other === name && own.from === shadow.from && own.to === shadow.to);
}

/** 기준 판정의 묶음 값이다(모두 유효하고 같은 값일 때만). */
function referenceValue<T>(group: readonly RecordedDeclaration[], read: (entry: RecordedDeclaration) => T | undefined) {
  const values = group.map((entry) => (entry.invalidated ? undefined : read(entry)));
  if (values.some((value) => value === undefined)) return undefined;
  const first = JSON.stringify(values[0]);
  return values.every((value) => JSON.stringify(value) === first) ? values[0] : undefined;
}

/**
 * 기준 사이 묶음 판정 — 범위를 정하지 못한 선언의 위치를 덮고 그 선언의 가림 구간보다 안쪽인 묶음이다(동결한 뒤만).
 * 값은 그런 선언 묶음 중 모듈 값 선언이 있는 것이 있는지다. 없으면 사이 묶음이 아니다.
 */
function referenceIntermediate(declarations: readonly RecordedDeclaration[], name: string, shadow: TokenRange) {
  const owners = declarations.filter(({ name: other, undecidedAt, shadow: own }) => other === name &&
    undecidedAt !== undefined && shadow.from <= undecidedAt && undecidedAt <= shadow.to &&
    own.from <= shadow.from && shadow.to <= own.to && (own.from !== shadow.from || own.to !== shadow.to));
  if (owners.length === 0) return undefined;
  return owners.some(({ shadow: own }) => referenceMembers(declarations, name, own).some(({ value }) => value !== undefined));
}

/** 기준 묶음 요약이다. `frozen`이면 사이 묶음을 계산한다. */
function referenceGroup(declarations: readonly RecordedDeclaration[], name: string, shadow: TokenRange, frozen: boolean) {
  const members = referenceMembers(declarations, name, shadow);
  const intermediate = frozen ? referenceIntermediate(declarations, name, shadow) : undefined;
  const hasModule = members.some(({ value }) => value !== undefined);
  const value = referenceValue(members, (entry) => entry.value);
  return {
    members,
    value,
    literal: referenceValue(members, (entry) => entry.literal),
    intermediate: intermediate !== undefined,
    allUncertain: members.every(({ uncertainExtent }) => uncertainExtent === true),
    undecidedModule: intermediate === true || (hasModule && (intermediate !== undefined ||
      members.some(({ undecidedAt, invalidatedUncertainly }) => undecidedAt !== undefined || invalidatedUncertainly))),
    covers: (index: number) => members.some(({ bind }) => bind !== undefined && bind.from <= index && index <= bind.to),
  };
}

/** 기준 해석이다. `frozen`은 동결한 뒤의 조회(값 적용 구간 밖 표시·사이 묶음 계산)인지다. */
function referenceResolve(
  declarations: readonly RecordedDeclaration[],
  name: string,
  index: number,
  frozen: boolean,
  floor = -Infinity,
): ScopedResolution {
  const shadows = referenceShadows(declarations, name, index);
  const parameter = floor > -Infinity;
  if (shadows.length === 0 || shadows[0]!.from <= floor) return parameter ? { claimed: true, parameter: true } : { claimed: false };
  const undecidedSoFar = declarations.some(({ name: other, undecidedAt }) => other === name && undecidedAt !== undefined);
  if (!frozen && undecidedSoFar) return { claimed: true };
  const hidden = (): 'module' | 'outer' | undefined => {
    for (const shadow of shadows) {
      if (shadow.from <= floor) return undefined;
      const group = referenceGroup(declarations, name, shadow, frozen);
      const module = group.value !== undefined || group.undecidedModule;
      if (group.covers(index)) return module ? 'module' : undefined;
      if (module) return 'module';
      if (!group.allUncertain) return undefined;
    }
    return parameter ? undefined : 'outer';
  };
  const group = referenceGroup(declarations, name, shadows[0]!, frozen);
  if (group.intermediate) {
    const outcome = group.covers(index) ? (group.value === undefined ? undefined : 'module') : hidden();
    if (outcome === 'module' || group.undecidedModule) return { claimed: true, hidesModule: true };
    return outcome === 'outer' ? { claimed: true, hidesOuter: true } : { claimed: true };
  }
  if (!group.covers(index)) {
    if (!frozen) return { claimed: true };
    const outcome = hidden();
    return outcome === 'module' ? { claimed: true, hidesModule: true } : outcome === 'outer' ? { claimed: true, hidesOuter: true } : { claimed: true };
  }
  const value = group.value as BoundName | undefined;
  if (value === undefined && frozen && group.undecidedModule) return { claimed: true, hidesModule: true };
  const literal = group.literal as string | undefined;
  return {
    claimed: true,
    ...(value === undefined ? {} : { value }),
    ...(literal === undefined ? {} : { literal }),
  };
}

/**
 * 기준 재대입 — 위치를 덮는 묶음을 안쪽부터 무효로 하고, 값이 위치를 덮거나 범위가 확실한 묶음에서 멈춘다(넓게 잡힌
 * 묶음의 값 적용 구간 밖 대입은 바깥 선언의 것일 수 있다). 사이 묶음은 지나친다. 확실한 매개변수 목록 바깥에서
 * 멈추고, 첫 묶음 너머·정하지 못한 매개변수 목록 바깥은 대상이 확실하지 않다고 표시한다.
 */
function referenceInvalidate(
  declarations: readonly RecordedDeclaration[],
  name: string,
  index: number,
  frozen: boolean,
  floor = -Infinity,
  certainFloor = -Infinity,
): void {
  let uncertain = false;
  for (const shadow of referenceShadows(declarations, name, index)) {
    if (shadow.from <= certainFloor) return;
    if (shadow.from <= floor) uncertain = true;
    const group = referenceGroup(declarations, name, shadow, frozen);
    for (const entry of group.members) {
      entry.invalidated = true;
      if (uncertain) entry.invalidatedUncertainly = true;
    }
    if (!group.intermediate && (group.covers(index) || !group.allUncertain)) return;
    uncertain = true;
  }
}

test('수집 중의 사슬 조회와 동결한 뒤의 정렬 조회는 선언 전체를 훑는 기준 판정과 같다', () => {
  const random = seededRandom(23);
  const names = ['M', 'N', 'P'];
  for (let round = 0; round < 160; round++) {
    const size = 60;
    const ranges = laminarRanges(random, size);
    // 함수 본문 구실을 하는 구간이다 — 범위를 정하지 못한 선언의 가림 구간은 그 위치를 감싼 가장 안쪽 함수 구간이다.
    const functions = ranges.filter((candidate, index) => index === 0 || random() < 0.3);
    const ownerOf = (position: number) => functions
      .filter(({ from, to }) => from <= position && position <= to)
      .reduce((best, next) => (next.from > best.from ? next : best));
    // 선언 위치(키워드)는 값 적용 구간 안이고, 값 적용 구간은 가림 구간 안이다.
    const planned = Array.from({ length: 8 }, () => {
      const shadow = ranges[Math.floor(random() * ranges.length)]!;
      const inner = ranges.filter((candidate) => candidate.from >= shadow.from && candidate.to <= shadow.to);
      const bind = random() < 0.6 ? shadow : inner[Math.floor(random() * inner.length)]!;
      const roll = random();
      const position = Math.max(0, bind.from) + Math.floor(random() * (Math.min(size, bind.to) - Math.max(0, bind.from) + 1));
      const undecided = random() < 0.15;
      return {
        name: names[Math.floor(random() * names.length)]!,
        shadow: undecided ? ownerOf(position) : shadow,
        ...(undecided ? { uncertainExtent: true as const, undecidedAt: position } : { bind }),
        ...(!undecided && bind !== shadow && random() < 0.5 ? { uncertainExtent: true as const } : {}),
        position,
        ...(roll < 0.5 ? { value: { name: `V${Math.floor(random() * 2)}` } } : {}),
        ...(roll >= 0.5 && roll < 0.7 ? { literal: `L${Math.floor(random() * 2)}` } : {}),
      };
    });
    const invalidations = Array.from({ length: 3 }, () => {
      const position = Math.floor(random() * size);
      const floors = ranges.filter(({ from, to }) => from >= 0 && from <= position && position <= to);
      const floor = random() < 0.3 && floors.length > 0 ? floors[Math.floor(random() * floors.length)]!.from : -Infinity;
      return {
        name: names[Math.floor(random() * names.length)]!,
        position,
        floor,
        certainFloor: floor > -Infinity && random() < 0.5 ? floor : -Infinity,
      };
    });
    const table = new ScopedBindingTable();
    const recorded: RecordedDeclaration[] = [];
    for (let position = 0; position <= size; position++) {
      for (const { position: at, ...declaration } of planned) {
        if (at !== position) continue;
        table.declare(declaration);
        recorded.push({ ...declaration, invalidated: false, invalidatedUncertainly: false });
      }
      for (const name of names) {
        assert.deepEqual(table.resolve(name, position), referenceResolve(recorded, name, position, false),
          `round ${round} collect ${name}@${position}`);
      }
      for (const { name, position: at, floor, certainFloor } of invalidations) {
        if (at !== position) continue;
        table.invalidate(name, position, floor, certainFloor);
        referenceInvalidate(recorded, name, position, false, floor, certainFloor);
      }
    }
    table.freeze();
    // 동결은 수집 중의 무효를 지우고 모든 선언을 본 해석으로 재대입을 다시 반영한다(앞에 선언된 함수 본문의 대입이 뒤
    // 선언을 지우고, 대입 뒤에 선언된 끌어올린 var가 차지한 대입은 바깥을 지우지 않는다).
    for (const entry of recorded) {
      entry.invalidated = false;
      entry.invalidatedUncertainly = false;
    }
    for (const { name, position, floor, certainFloor } of invalidations) {
      referenceInvalidate(recorded, name, position, true, floor, certainFloor);
    }
    // 동결한 뒤에는 위치 순서와 무관하게 같은 답이다(매개변수 목록이 위치를 가린 조회 포함).
    for (let position = size; position >= -1; position--) {
      for (const name of names) {
        assert.deepEqual(table.resolve(name, position), referenceResolve(recorded, name, position, true),
          `round ${round} frozen ${name}@${position}`);
        const floor = Math.max(0, position - 3);
        assert.deepEqual(table.resolve(name, position, floor), referenceResolve(recorded, name, position, true, floor),
          `round ${round} frozen ${name}@${position} floor ${floor}`);
      }
    }
  }
});

test('수집 중 앞 위치를 다시 묻는 조회도 같은 답을 낸다', () => {
  const table = new ScopedBindingTable();
  table.declare({ name: 'M', shadow: range(-1, 100), bind: range(-1, 100), value: { name: 'Outer' } });
  table.declare({ name: 'M', shadow: range(10, 20), bind: range(10, 20), value: { name: 'A' } });
  table.declare({ name: 'M', shadow: range(30, 40), bind: range(30, 40), value: { name: 'B' } });
  assert.deepEqual(table.resolve('M', 35), { claimed: true, value: { name: 'B' } });
  // 사슬은 지나간 범위(10..20)를 버렸다 — 앞 위치는 묶음 전체를 훑어 답한다.
  assert.deepEqual(table.resolve('M', 15), { claimed: true, value: { name: 'A' } });
  assert.deepEqual(table.resolve('M', 25), { claimed: true, value: { name: 'Outer' } });
  assert.deepEqual(table.resolve('M', 38), { claimed: true, value: { name: 'B' } });
  // 값 적용 구간이 둘인 묶음(같은 함수의 두 블록 var)과 앞 위치 재대입도 묶음 전체를 훑어 같은 답을 낸다.
  table.declare({ name: 'V', shadow: range(50, 90), bind: range(55, 60), value: { name: 'C' } });
  table.declare({ name: 'V', shadow: range(50, 90), bind: range(70, 80), value: { name: 'C' } });
  assert.deepEqual(table.resolve('V', 85), { claimed: true });
  assert.deepEqual(table.resolve('V', 57), { claimed: true, value: { name: 'C' } });
  assert.deepEqual(table.resolve('V', 65), { claimed: true });
  table.invalidate('V', 58);
  assert.deepEqual(table.resolve('V', 75), { claimed: true });
  // 사슬이 지나간 묶음과 뒤에 넣은 묶음이 겹치기만 하면 동결할 때 알아채 그 이름을 쓰지 않는다.
  table.declare({ name: 'Late', shadow: range(40, 50), bind: range(40, 50), value: { name: 'X' } });
  assert.deepEqual(table.resolve('Late', 95), { claimed: false });
  table.declare({ name: 'Late', shadow: range(45, 100), bind: range(96, 100), value: { name: 'X' } });
  table.freeze();
  assert.deepEqual(table.resolve('Late', 97), { claimed: true, hidesModule: true });
});

test('넓게 잡힌 선언의 값 적용 구간 밖 재대입은 바깥 선언도 무효로 한다', () => {
  // `let M = A; function f() { M.go(); } for (const M of xs) foo(M); M = B;` — for 머리 선언이 블록 끝까지 넓게
  // 잡혀 마지막 대입을 가렸다. 대입이 바깥 M의 것일 수 있으므로 바깥 선언도 무효다(전에는 거짓 A.go가 남았다).
  const table = new ScopedBindingTable();
  table.declare({ name: 'M', shadow: range(-1, 100), bind: range(-1, 100), value: { name: 'A' } });
  table.declare({ name: 'M', shadow: range(40, 100), bind: range(40, 45), uncertainExtent: true });
  table.invalidate('M', 60);
  // 값 적용 구간 안의 대입(루프 머리)이나 범위가 확실한 묶음의 대입은 바깥으로 번지지 않는다.
  table.declare({ name: 'N', shadow: range(-1, 100), bind: range(-1, 100), value: { name: 'A' } });
  table.declare({ name: 'N', shadow: range(40, 100), bind: range(40, 45), uncertainExtent: true });
  table.invalidate('N', 42);
  table.declare({ name: 'V', shadow: range(-1, 100), bind: range(-1, 100), value: { name: 'A' } });
  table.declare({ name: 'V', shadow: range(40, 60), bind: range(45, 50) });
  table.invalidate('V', 55);
  table.freeze();
  // 바깥 묶음은 대입의 대상인지 확실하지 않아 무효로 하되 그 모듈 쓰임을 센다(귀속하지 않고, 조용히 버리지도 않는다).
  assert.deepEqual(table.resolve('M', 20), { claimed: true, hidesModule: true });
  assert.deepEqual(table.resolve('N', 20), { claimed: true, value: { name: 'A' } });
  assert.deepEqual(table.resolve('V', 20), { claimed: true, value: { name: 'A' } });
});

test('매개변수 목록이 더 안쪽이면 이름을 차지하고 그보다 안쪽 범위의 선언은 매개변수를 이긴다', () => {
  const table = new ScopedBindingTable();
  table.declare({ name: 'M', shadow: range(-1, 100), bind: range(-1, 100), value: { name: 'Outer' } });
  table.declare({ name: 'M', shadow: range(30, 40), bind: range(30, 40), value: { name: 'Inner' } });
  table.declare({ name: 'L', shadow: range(-1, 100), bind: range(-1, 100) });
  table.declare({ name: 'L', shadow: range(30, 60), bind: range(30, 35), uncertainExtent: true });
  table.freeze();
  // 매개변수 목록(20부터)이 파일 범위 선언보다 안쪽이다.
  assert.deepEqual(table.resolve('M', 25, 20), { claimed: true, parameter: true });
  assert.deepEqual(table.resolve('Unknown', 25, 20), { claimed: true, parameter: true });
  // 매개변수 함수 안쪽 블록(30부터)의 선언이 이긴다.
  assert.deepEqual(table.resolve('M', 35, 20), { claimed: true, value: { name: 'Inner' } });
  // 넓게 잡힌 선언 너머가 매개변수면 매개변수가 확실히 가린다(import·전역 표시 없음).
  assert.deepEqual(table.resolve('L', 50, 20), { claimed: true });
});

test('범위를 정하지 못한 var는 값을 적용하지 않고 그 묶음과 사이 묶음의 모듈 쓰임을 세게 한다', () => {
  const table = new ScopedBindingTable();
  // 파일의 const M = A. 함수 본문(0..90) 안 블록(10..60)의 let M = B, 그 안 종류를 정하지 못한 블록 안(25)의
  // var M = C는 함수 본문까지 끌어올렸다 — 그 블록이 함수 본문이면 블록 안에서는 var가 let을 이긴다.
  table.declare({ name: 'M', shadow: range(-1, 100), bind: range(-1, 100), value: { name: 'A' } });
  table.declare({ name: 'M', shadow: range(10, 60), bind: range(10, 60), value: { name: 'B' } });
  table.declare({ name: 'M', shadow: range(0, 90), uncertainExtent: true, undecidedAt: 25, value: { name: 'C' } });
  // 바깥 바인딩이 없는 모듈 아닌 정하지 못한 var는 import·전역일 수 있는 쓰임을 표시한다.
  table.declare({ name: 'N', shadow: range(0, 90), uncertainExtent: true, undecidedAt: 25 });
  // 수집 중에는 사이 묶음을 모르므로 값을 주지 않는다.
  assert.deepEqual(table.resolve('M', 50), { claimed: true });
  // 매개변수 목록(40) 바깥 묶음의 대입은 대상이 확실하지 않고, 확실한 매개변수 목록 바깥에는 닿지 않는다.
  table.declare({ name: 'P', shadow: range(-1, 100), bind: range(-1, 100), value: { name: 'P1' } });
  table.declare({ name: 'Q', shadow: range(-1, 100), bind: range(-1, 100), value: { name: 'Q1' } });
  table.invalidate('P', 50, 40);
  table.invalidate('Q', 50, 40, 40);
  table.freeze();
  assert.deepEqual(table.resolve('M', 50), { claimed: true, hidesModule: true });
  assert.deepEqual(table.resolve('M', 70), { claimed: true, hidesModule: true });
  assert.deepEqual(table.resolve('M', 95), { claimed: true, value: { name: 'A' } });
  assert.deepEqual(table.resolve('N', 70), { claimed: true, hidesOuter: true });
  assert.deepEqual(table.resolve('P', 95), { claimed: true, hidesModule: true });
  assert.deepEqual(table.resolve('Q', 95), { claimed: true, value: { name: 'Q1' } });
  assert.deepEqual([...table.moduleDeclarationNames()].sort(), ['M', 'P', 'Q']);
});

test('동결은 수집 중의 무효를 지우고 모든 선언을 본 해석으로 다시 반영한다', () => {
  // `const M = A; function f() { if (x) { M = other(); } var M = makeFake(); }` — 수집 중 대입(30)은 아직 보지 못한 var
  // 대신 파일의 M을 지웠다. 동결 뒤에는 끌어올린 var(함수 본문 20..50)가 대입을 차지해 파일의 M은 그대로다.
  const table = new ScopedBindingTable();
  table.declare({ name: 'M', shadow: range(-1, 100), bind: range(-1, 100), value: { name: 'A' }, initializerStart: 3 });
  table.invalidate('M', 30);
  assert.deepEqual(table.resolve('M', 31), { claimed: true });
  table.declare({ name: 'M', shadow: range(20, 50), bind: range(20, 50) });
  table.freeze();
  assert.deepEqual(table.resolve('M', 80), { claimed: true, value: { name: 'A' } });
  assert.deepEqual(table.trackedInitializerStarts(), [3]);
});

test('넓게 잡힌 묶음이 상한보다 깊게 겹치면 정하지 못한 것으로 보고 귀속하지 않는다', () => {
  const table = new ScopedBindingTable();
  table.declare({ name: 'M', shadow: range(-1, 1000), bind: range(-1, 1000), value: { name: 'A' } });
  for (let level = 0; level < 70; level++) {
    table.declare({ name: 'M', shadow: range(level * 2, 1000 - level), bind: range(level * 2, level * 2), uncertainExtent: true });
  }
  table.declare({ name: 'N', shadow: range(-1, 1000), bind: range(-1, 1000), value: { name: 'A' } });
  for (let level = 0; level < 70; level++) {
    table.declare({ name: 'N', shadow: range(level * 2, 1000 - level), bind: range(level * 2, level * 2), uncertainExtent: true });
  }
  table.invalidate('N', 500);
  table.freeze();
  // 상한을 넘게 오르면 모듈을 가렸다고 본다(세는 쪽). 재대입의 대상을 정하지 못한 이름은 쓰지 않고 쓰임을 센다.
  assert.deepEqual(table.resolve('M', 500), { claimed: true, hidesModule: true });
  assert.deepEqual(table.resolve('N', 2000), { claimed: true, hidesModule: true });
  assert.deepEqual([...table.moduleBindings().keys()], ['M']);
});

test('같은 범위의 같은 이름 선언·값 적용 구간이 많아도 조회가 선언을 훑지 않는다', () => {
  // 한 함수 안 `var M = NativeModules.A;` k번 뒤 `M.go();` k번(리뷰 재현: 3만 2천 개에 38초), 같은 함수의 형제 블록마다
  // `var M`(값 적용 구간 k개), 동결 전후 조회. 묶음 요약·구간 색인은 k에 선형이다. 시간 상한은 이차 구현(수십 초)과
  // 넉넉히 가르는 값이다.
  const count = 100_000;
  const started = performance.now();
  const same = new ScopedBindingTable();
  for (let index = 0; index < count; index++) {
    same.declare({ name: 'M', shadow: range(0, 10 * count), bind: range(0, 10 * count), value: { name: 'A' }, initializerStart: index });
  }
  for (let index = 0; index < count; index++) same.resolve('M', index);
  same.freeze();
  for (let index = 0; index < count; index++) same.resolve('M', count + index);
  assert.equal(same.trackedInitializerStarts().length, count);
  assert.deepEqual([...same.moduleBindings()], [['M', { name: 'A' }]]);
  const blocks = new ScopedBindingTable();
  for (let index = 0; index < count; index++) {
    blocks.declare({ name: 'V', shadow: range(0, 10 * count), bind: range(10 * index + 1, 10 * index + 5), value: { name: 'A' } });
    blocks.resolve('V', 10 * index + 2);
  }
  blocks.freeze();
  for (let index = 0; index < count; index++) {
    const expected = { claimed: true, value: { name: 'A' } };
    if (index % 997 === 0) {
      assert.deepEqual(blocks.resolve('V', 10 * index + 3), expected);
      assert.deepEqual(blocks.resolve('V', 10 * index + 8), { claimed: true, hidesModule: true });
    } else {
      blocks.resolve('V', 10 * index + 3);
    }
  }
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 8_000, `elapsed ${elapsed.toFixed(0)} ms`);
});

test('끝난 같은 이름 중첩 범위가 깊어도 뒤 위치 조회가 깊이에 비례해 오르지 않는다', () => {
  // 같은 이름의 블록 6만 단계가 닫힌 뒤 위치 6만 곳을 묻는다. 감싼 묶음을 하나씩 오르면 위치마다 6만 단계(모두 36억
  // 단계)라 수 초 넘게 걸리고, 건너뛰기 포인터는 로그 단계라 0.1초 안팎이다.
  const depth = 60_000;
  const table = new ScopedBindingTable();
  table.declare({ name: 'M', shadow: range(-1, 10 * depth), bind: range(-1, 10 * depth), value: { name: 'Outer' } });
  for (let level = 0; level < depth; level++) {
    table.declare({ name: 'M', shadow: range(level, 2 * depth - level), bind: range(level, 2 * depth - level) });
  }
  table.freeze();
  const started = performance.now();
  for (let position = 2 * depth + 1; position < 3 * depth; position++) {
    assert.deepEqual(table.resolve('M', position), { claimed: true, value: { name: 'Outer' } });
  }
  assert.deepEqual(table.resolve('M', 2 * depth - 5), { claimed: true });
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 2_500, `elapsed ${elapsed.toFixed(0)} ms`);
});

test('같은 이름의 형제 범위가 많아도 수집 중·동결 뒤 조회가 범위 수에 비례해 훑지 않는다', () => {
  // 형제 범위 10만 개에 선언·재대입·조회를 한 번씩 한다. 이름의 범위 전체를 훑으면 조회마다 10만 번이라 수십 초가
  // 걸린다(같은 수의 앞 위치 재조회로 재면 2만 개에 1초 넘게). 사슬·정렬 색인은 1초 안팎이다 — 시간 상한은 그 차이를
  // 넉넉히 가르는 값이다.
  const count = 100_000;
  const table = new ScopedBindingTable();
  const started = performance.now();
  for (let scope = 0; scope < count; scope++) {
    const block = range(scope * 10, scope * 10 + 9);
    table.declare({ name: 'M', shadow: block, bind: block, value: { name: `M${scope}` } });
    if (scope % 2 === 0) table.invalidate('M', scope * 10 + 5);
    table.resolve('M', scope * 10 + 6);
  }
  table.freeze();
  for (let scope = 0; scope < count; scope++) {
    const expected = scope % 2 === 0 ? { claimed: true } : { claimed: true, value: { name: `M${scope}` } };
    if (scope % 997 === 0) assert.deepEqual(table.resolve('M', scope * 10 + 6), expected);
    else table.resolve('M', scope * 10 + 6);
  }
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 8_000, `elapsed ${elapsed.toFixed(0)} ms`);
});
