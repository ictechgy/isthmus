import assert from 'node:assert/strict';
import test from 'node:test';
import { createJsFactsDocument } from './js-document.ts';

/** 시드가 같으면 같은 수열을 내는 의사 난수다. */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2 ** 31;
    return state / 2 ** 31;
  };
}

/** 오라클이 기억하는 `M` 선언 하나다. 값이 null이면 모듈이 아니다. */
interface OracleDeclaration {
  readonly kind: 'const' | 'let' | 'var';
  readonly value: string | null;
}

/** 오라클의 스코프다 — 함수 스코프(프로그램·함수 본문)와 블록 스코프를 JS 규칙대로 구분한다. */
interface OracleScope {
  readonly parent: OracleScope | undefined;
  readonly isFunction: boolean;
  /** 이 스코프가 묶은 `M` 선언이다(var는 함수 스코프에 모인다). */
  declarations: OracleDeclaration[] | undefined;
  /** 매개변수 `M`이 있는 함수 스코프인지다. */
  readonly parameter: boolean;
  /** 안쪽에서 끌어올린 var가 지나간 블록인지다(같은 이름 let/const와 겹치면 문법 오류). */
  varThrough: boolean;
}

/** 생성한 프로그램과 호출 줄마다 JS 정적 스코프로 정한 모듈(없으면 null)이다. */
interface OracleProgram {
  readonly text: string;
  readonly expected: ReadonlyMap<number, string | null>;
  /** 문법 오류(같은 범위 재선언 등)라 판정에서 뺄 프로그램인지다. */
  readonly invalid: boolean;
}

/**
 * 무작위 중첩 프로그램을 만든다 — 블록·함수(제네릭·반환 타입·화살표·함수식·클래스 메서드)·for-of(블록 본문과 문장
 * 본문)·매개변수·구조 분해·재대입과 선언자가 아닌 `const`·`let` 낱말을 섞는다. 호출 `M.go()`마다 JS 규칙(블록 범위
 * let/const, 함수 범위 var, 매개변수, 재대입되면 값을 모름)으로 기준 모듈을 정한다.
 */
function generateProgram(random: () => number): OracleProgram {
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
  const lines: string[] = [];
  const calls: { readonly line: number; readonly scope: OracleScope }[] = [];
  const assignments: OracleScope[] = [];
  let invalid = false;
  let functions = 0;
  const scope = (parent: OracleScope | undefined, isFunction: boolean, parameter = false): OracleScope =>
    ({ parent, isFunction, declarations: undefined, parameter, varThrough: false });
  const emit = (text: string, depth: number): number => lines.push(`${'  '.repeat(depth)}${text}`);
  const functionOf = (inner: OracleScope): OracleScope => {
    let cursor = inner;
    while (!cursor.isFunction) cursor = cursor.parent!;
    return cursor;
  };
  const declare = (current: OracleScope, kind: OracleDeclaration['kind'], value: string | null): void => {
    const target = kind === 'var' ? functionOf(current) : current;
    const prior = target.declarations;
    if (prior !== undefined && (kind !== 'var' || prior.some((entry) => entry.kind !== 'var'))) invalid = true;
    if (kind !== 'var' && (target.parameter || current.varThrough)) invalid = true;
    if (kind === 'var') {
      for (let cursor = current; cursor !== target; cursor = cursor.parent!) {
        if (cursor.declarations?.some((entry) => entry.kind !== 'var')) invalid = true;
        cursor.varThrough = true;
      }
    }
    target.declarations = [...(prior ?? []), { kind, value }];
  };
  const block = (current: OracleScope, depth: number, budget: number): void => {
    const count = 1 + Math.floor(random() * 3);
    for (let index = 0; index < count && budget > 0; index++) statement(current, depth, budget - 1);
  };
  const statement = (current: OracleScope, depth: number, budget: number): void => {
    const choice = random();
    if (choice < 0.22) {
      const kind = pick(['const', 'let', 'var'] as const);
      const form = random();
      if (form < 0.15) {
        emit(pick([`${kind} { M } = props;`, `${kind} [M] = arr;`, `${kind} { x: { M } } = props;`,
          `${kind} { M = 1 }: { M?: number } = props;`]), depth);
        declare(current, kind, null);
      } else if (form < 0.25) {
        emit(pick(["register('x' as const, M);", 'const enum E { M }', 'render(<Text>let M know {name}</Text>);',
          '({ var: 1, M });', 'const { M: alias } = props;']), depth);
      } else {
        const value = random() < 0.75 ? pick(['A', 'B', 'C']) : null;
        emit(`${kind} M = ${value === null ? 'makeFake()' : `NativeModules.${value}`};`, depth);
        declare(current, kind, value);
      }
    } else if (choice < 0.42) {
      calls.push({ line: emit('M.go();', depth), scope: current });
    } else if (choice < 0.47) {
      emit('M = other();', depth);
      assignments.push(current);
    } else if (budget > 0 && choice < 0.57) {
      emit(pick(['{', 'if (cond) {', 'try {', 'while (x) {']), depth);
      block(scope(current, false), depth + 1, budget);
      emit('}', depth);
    } else if (budget > 0 && choice < 0.72) {
      const parameter = random() < 0.3;
      const name = parameter ? 'M' : 'x';
      const head = pick([`function f${functions++}(${name})`, `function f${functions++}<T>(${name}: T): void`,
        `const f${functions++} = (${name}) =>`, `const f${functions++} = (${name}): number =>`,
        `const f${functions++} = function (${name})`]);
      emit(`${head} {`, depth);
      block(scope(current, true, parameter), depth + 1, budget);
      emit(head.startsWith('const') ? '};' : '}', depth);
    } else if (budget > 0 && choice < 0.8) {
      // for-of의 루프 변수는 for 문 범위의 모듈 아닌 선언이다.
      const loop = scope(current, false);
      loop.declarations = [{ kind: 'let', value: null }];
      if (random() < 0.5) {
        emit('for (const M of xs) {', depth);
        block(scope(loop, false), depth + 1, budget);
        emit('}', depth);
      } else {
        emit('for (const M of xs)', depth);
        calls.push({ line: emit('M.go();', depth + 1), scope: loop });
      }
    } else if (budget > 0 && choice < 0.86) {
      emit('class K {', depth);
      emit('run(): void {', depth + 1);
      block(scope(current, true), depth + 2, budget);
      emit('}', depth + 1);
      emit('}', depth);
    } else {
      emit('noop();', depth);
    }
  };
  const program = scope(undefined, true);
  block(program, 0, 7);
  /** 위치 스코프에서 `M`이 가리키는 선언 묶음이다(매개변수면 'parameter', 없으면 전역). */
  const resolve = (from: OracleScope): OracleDeclaration[] | 'parameter' | undefined => {
    for (let cursor: OracleScope | undefined = from; cursor !== undefined; cursor = cursor.parent) {
      if (cursor.declarations !== undefined) return cursor.declarations;
      if (cursor.parameter) return 'parameter';
    }
    return undefined;
  };
  const reassigned = new Set<OracleDeclaration[]>();
  for (const assigned of assignments) {
    const target = resolve(assigned);
    if (Array.isArray(target)) reassigned.add(target);
  }
  const expected = new Map<number, string | null>();
  for (const call of calls) {
    const target = resolve(call.scope);
    const values = Array.isArray(target) && !reassigned.has(target) ? new Set(target.map(({ value }) => value)) : undefined;
    // 줄 번호는 앞의 import 줄 하나만큼 밀린다.
    expected.set(call.line + 1, values?.size === 1 ? [...values][0]! : null);
  }
  return { text: `import { NativeModules } from 'react-native';\n${lines.join('\n')}\n`, expected, invalid };
}

test('생성한 중첩 프로그램에서 JS 정적 스코프 기준 판정과 다른 method-invoke를 내지 않는다', () => {
  // 형제 범위의 같은 이름, 안쪽 대역·구조 분해·for-of 변수의 가림, 함수 범위 var, 매개변수, 재대입, 제네릭·반환 타입
  // 함수, 선언자가 아닌 낱말을 섞는다. 귀속한 호출은 모두 기준 모듈과 같아야 한다(놓친 호출은 허용 — 한계로 센다).
  // main은 같은 생성기에서 귀속한 호출의 절반 이상이 거짓이었다.
  const random = seededRandom(20261122);
  let checked = 0;
  let attributed = 0;
  for (let round = 0; round < 3_000; round++) {
    const program = generateProgram(random);
    if (program.invalid) continue;
    checked++;
    const document = createJsFactsDocument([{ path: 'a.tsx', text: program.text }], '0', '2026-01-01T00:00:00.000Z', 'p');
    for (const fact of document.facts) {
      if (fact.kind !== 'method-invoke') continue;
      attributed++;
      assert.equal(fact.channel, program.expected.get(fact.location!.line), `line ${fact.location!.line}\n${program.text}`);
    }
    // 기준 판정이 모듈인 호출을 놓치면 그 문서에는 범위 밖 참조 한계가 있어야 한다(조용히 사라지지 않는다).
    const missed = [...program.expected].some(([line, module]) => module !== null &&
      !document.facts.some((fact) => fact.kind === 'method-invoke' && fact.location!.line === line));
    if (missed) {
      assert.ok(document.limitations.some((line) => line.startsWith('js-binding-scope:')), program.text);
    }
  }
  // 생성기가 판정할 만한 프로그램과 귀속 호출을 충분히 만들었는지 확인한다.
  assert.ok(checked > 2_000 && attributed > 350, `checked ${checked}, attributed ${attributed}`);
});
