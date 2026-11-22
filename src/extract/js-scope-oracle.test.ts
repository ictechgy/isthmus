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

/** 생성한 프로그램과 줄마다의 기준 판정이다. 줄 번호는 import 줄을 포함한 문서 줄 번호다. */
interface OracleProgram {
  /** import 줄 뒤의 본문 줄이다. */
  readonly lines: readonly string[];
  /** 호출 `M.go()` 줄마다 JS 정적 스코프로 정한 모듈(없으면 null)이다. */
  readonly calls: ReadonlyMap<number, string | null>;
  /** 줄마다 나와야 하는 module-import 이름이다. */
  readonly modules: ReadonlyMap<number, readonly string[]>;
  /** 문법 오류(같은 범위 재선언 등)라 판정에서 뺄 프로그램인지다. */
  readonly invalid: boolean;
}

/** 본문 줄로 문서 원문을 만든다. */
function programText(lines: readonly string[]): string {
  return `import { NativeModules } from 'react-native';\n${lines.join('\n')}\n`;
}

/**
 * 무작위 중첩 프로그램을 만든다 — 블록(제어문·`case` 절·라벨·`}`와 ASI 줄 뒤의 맨 블록)·함수(제네릭·기본값 있는
 * 제네릭·반환 타입·조건 반환 타입·화살표·단일 매개변수 화살표·함수식·삼항 갈래의 화살표·함수식(호출·연산자 뒤 괄호
 * 갈래, 중첩 삼항과 그 거울, 함수식 호출 뒤 갈래 포함)·이름 있는 함수식·콜백·다음 줄 `{`)·클래스 메서드(이름 있는
 * 클래스식, 상속절 호출, 세미콜론 없는 오버로드·추상 시그니처, 선택 속성·선택 메서드, `catch` 메서드, 다음 줄 `{` 포함)·
 * for-of(블록 본문과 문장 본문)·매개변수·구조 분해(레지스트리·모듈 멤버 원천 포함)·재대입(복합 대입·증감·구조 분해 대입과
 * 그 중첩, 제어문 머리·`case` 절 뒤 배열 대입, 괄호 대상, 선언 초기값·선언 패턴 기본값·계산 키 안, enum 초기값 안, for-of
 * 대상)과 선언자가 아닌 `const`·`let` 낱말을 섞는다. 호출 `M.go()`마다 JS 규칙(블록 범위
 * let/const, 함수 범위 var, 매개변수, 재대입되면 값을 모름, 매개변수를 다시 선언한 var는 인자일 수 있음)으로 기준
 * 모듈을 정한다.
 */
function generateProgram(random: () => number): OracleProgram {
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
  const lines: string[] = [];
  const calls: { readonly line: number; readonly scope: OracleScope }[] = [];
  const modules = new Map<number, string[]>();
  const assignments: OracleScope[] = [];
  let invalid = false;
  let functions = 0;
  const scope = (parent: OracleScope | undefined, isFunction: boolean, parameter = false): OracleScope =>
    ({ parent, isFunction, declarations: undefined, parameter, varThrough: false });
  const emit = (text: string, depth: number): number => lines.push(`${'  '.repeat(depth)}${text}`);
  const imports = (line: number, name: string): void => {
    modules.set(line + 1, [...(modules.get(line + 1) ?? []), name]);
  };
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
  /**
   * 블록 안 첫 문장으로 var를 낼지 정해 낸다. 종류를 정하기 어려운 블록(라벨·맨 블록·`case` 절)의 var가 블록 뒤
   * 쓰임과 만나도록 자주 낸다.
   */
  const leadingVar = (inner: OracleScope, depth: number): void => {
    if (random() >= 0.5) return;
    const value = random() < 0.5 ? pick(['A', 'B', 'C']) : null;
    const line = emit(`var M = ${value === null ? 'makeFake()' : `NativeModules.${value}`};`, depth);
    if (value !== null) imports(line, value);
    declare(inner, 'var', value);
  };
  /** 블록 스코프 하나를 여는 줄들을 내고 본문을 채운 뒤 닫는다. */
  const blockStatement = (current: OracleScope, depth: number, budget: number): void => {
    const form = random();
    const inner = scope(current, false);
    if (form < 0.3) {
      emit(pick(['{', 'if (cond) {', 'try {', 'while (x) {']), depth);
    } else if (form < 0.45) {
      emit(`l${functions++}: {`, depth);
      leadingVar(inner, depth + 1);
    } else if (form < 0.6) {
      // `}` 뒤·ASI로 끝난 줄 뒤의 맨 블록이다(호출 뒤 다음 줄 블록은 그 인자가 매개변수처럼 보인다).
      emit(pick(['if (c) { noop(); }', 'x = 1', 'noop()', 'wrap(M)']), depth);
      emit('{', depth);
      leadingVar(inner, depth + 1);
    } else if (form < 0.8) {
      // `case` 절의 블록 — 괄호로 끝나는 절 식은 반환 타입 주석처럼 보인다.
      const clause = scope(inner, false);
      emit('switch (k) {', depth);
      emit(`${pick(["case 'a'", 'case (1)', 'case kind()', 'default'])}: {`, depth + 1);
      leadingVar(clause, depth + 2);
      block(clause, depth + 2, budget);
      emit('}', depth + 1);
      emit('}', depth);
      return;
    } else {
      emit('{', depth);
    }
    block(inner, depth + 1, budget);
    emit('}', depth);
  };
  /** 바깥 모듈 바인딩과 안쪽 매개변수·상속절이 만나도록 함수·클래스 앞에 가끔 모듈 `M`을 선언한다. */
  const outerModule = (current: OracleScope, depth: number): void => {
    if (random() >= 0.3) return;
    const value = pick(['A', 'B', 'C']);
    imports(emit(`let M = NativeModules.${value};`, depth), value);
    declare(current, 'let', value);
  };
  const functionStatement = (current: OracleScope, depth: number, budget: number): void => {
    outerModule(current, depth);
    const parameter = random() < 0.3;
    const name = parameter ? 'M' : 'x';
    const id = functions++;
    const [head, close] = pick<readonly [string, string]>([
      [`function f${id}(${name}) {`, '}'],
      [`function f${id}<T>(${name}: T): void {`, '}'],
      [`function f${id}<T>(${name}: T): T extends string ? A : B {`, '}'],
      [`const f${id} = (${name}) => {`, '};'],
      [`const f${id} = (${name}): number => {`, '};'],
      [`const f${id} = function (${name}) {`, '};'],
      [`const f${id} = ${name} => {`, '};'],
      [`items.forEach(${name} => {`, '});'],
      [`const f${id} = busy ? wrap(${pick(['y', 'M'])}) : ${name} => {`, '};'],
      [`const f${id} = busy ? wrap(${pick(['y', 'M'])}) : function (${name}) {`, '};'],
      [`function f${id}(${name})\n${'  '.repeat(depth)}{`, '}'],
      [`function f${id}<T = {}>(${name}: T) {`, '}'],
      // 연산자 뒤 괄호 갈래 — `(p) : NAME =>`는 반환 타입이 아니라 삼항의 `:`와 단일 매개변수 화살표다.
      [`const f${id} = c ? ${pick(['!(p)', 'base + (o)', 'typeof (q)'])} : ${name} => {`, '};'],
      // 중첩 삼항·함수식 호출 뒤 갈래 — JS에서 `(x) : NAME =>`의 NAME은 단일 매개변수다.
      [`const f${id} = a ? b ? c : (y) : ${name} => {`, '};'],
      [`const f${id} = a ? function () {}(y) : ${name} => {`, '};'],
      // 제어문 머리 뒤의 화살표 식 문장 — 매개변수가 확실하다(TS).
      [`if (c) (${name}): number => {`, '};'],
    ]);
    emit(head, depth);
    block(scope(current, true, parameter), depth + 1, budget);
    emit(close, depth);
  };
  /**
   * 매개변수가 `M`이 아닌 함수 형태다 — 중첩 삼항의 거울(`a ? b ? c : (M) : T => {`, JS에서 매개변수는 T이고 괄호 안 M은 바깥
   * 값), 이름 있는 함수식(`function M(…) {` — 본문 안 M은 함수 자신, 바깥과 본문 사이의 이름 범위로 둔다).
   */
  const namedFunctionStatement = (current: OracleScope, depth: number, budget: number): void => {
    outerModule(current, depth);
    const parameter = random() < 0.3;
    const id = functions++;
    const form = random();
    if (form < 0.4) {
      emit(`const f${id} = a ? b ? c : (${pick(['M', 'y'])}) : T => {`, depth);
      block(scope(current, true), depth + 1, budget);
      emit('};', depth);
      return;
    }
    const named = scope(current, false);
    named.declarations = [{ kind: 'let', value: null }];
    const [head, close] = form < 0.7
      ? [`const f${id} = function M(${parameter ? 'M' : 'x'}) {`, '};']
      : [`(function M(${parameter ? 'M' : 'x'}) {`, '})();'];
    emit(head, depth);
    block(scope(named, true, parameter), depth + 1, budget);
    emit(close, depth);
  };
  const statement = (current: OracleScope, depth: number, budget: number): void => {
    const choice = random();
    if (choice < 0.2) {
      const kind = pick(['const', 'let', 'var'] as const);
      const form = random();
      const module = pick(['A', 'B', 'C']);
      if (form < 0.12) {
        emit(pick([`${kind} { M } = props;`, `${kind} [M] = arr;`, `${kind} { x: { M } } = props;`,
          `${kind} { M = 1 }: { M?: number } = props;`]), depth);
        declare(current, kind, null);
      } else if (form < 0.2) {
        // 모듈의 멤버를 꺼낸 이름은 모듈이 아니다(모듈 사실은 멤버 접근이 낸다).
        imports(emit(pick([`${kind} { M } = NativeModules.${module};`, `${kind} { take: M } = NativeModules.${module};`]),
          depth), module);
        declare(current, kind, null);
      } else if (form < 0.28) {
        // 레지스트리 구조 분해는 키 이름이 모듈이다.
        const key = pick(['M', module]);
        imports(emit(`${kind} { ${key === 'M' ? 'M' : `${key}: M`} } = NativeModules;`, depth), key);
        declare(current, kind, key);
      } else if (form < 0.36) {
        emit(pick(["register('x' as const, M);", 'const enum E { M }', 'enum F { M = 1 }',
          'render(<Text>let M know {name}</Text>);', '({ var: 1, M });', 'const { M: alias } = props;']), depth);
      } else {
        const value = random() < 0.75 ? module : null;
        const line = emit(`${kind} M = ${value === null ? 'makeFake()' : `NativeModules.${value}`};`, depth);
        if (value !== null) imports(line, value);
        declare(current, kind, value);
      }
    } else if (choice < 0.38) {
      calls.push({ line: emit('M.go();', depth), scope: current });
    } else if (choice < 0.44) {
      // 재대입 형태 — 중첩 구조 분해 대입, 제어문 머리·`case` 절 뒤의 배열 대입, 괄호 대상, 선언 초기값 안의 대입 포함.
      const form = random();
      if (form < 0.12) {
        emit('switch (k) {', depth);
        emit("case 'm': [M] = arr; break;", depth + 1);
        emit('}', depth);
      } else {
        emit(pick(['M = other();', 'M &&= other();', 'M += 1;', 'M++;', '({ M } = mocks);', '[M] = arr;',
          'for (M of xs) noop();', '[[M] = x] = y;', '({ a: [M] = x } = y);', 'if (c) [M] = arr;', '(M) = other();',
          `const r${functions++} = (M = other());`, `const s${functions++} = [M] = arr;`,
          `const t${functions++} = c ? fn({ M } = d) : other => { other.x(); };`,
          `const [a${functions++} = (M = other())] = arr;`, `const { b${functions++} = M++ } = o;`,
          `let { [M = 'k']: v${functions++} } = o;`, `enum G${functions++} { A = M++ }`]), depth);
      }
      assignments.push(current);
    } else if (budget > 0 && choice < 0.54) {
      blockStatement(current, depth, budget);
    } else if (budget > 0 && choice < 0.68) {
      if (random() < 0.2) namedFunctionStatement(current, depth, budget);
      else functionStatement(current, depth, budget);
    } else if (budget > 0 && choice < 0.75) {
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
    } else if (budget > 0 && choice < 0.82) {
      // 메서드 본문 — 다음 줄 `{`의 메서드는 호출 뒤 블록과 구분되지 않는다. 상속절 호출(`extends mixin(M)`)·세미콜론
      // 없는 오버로드·추상 시그니처·선택 속성(`label?`)·선택 메서드·`catch` 메서드를 섞는다.
      outerModule(current, depth);
      const parameter = random() < 0.3;
      const list = parameter ? 'M' : '';
      const abstract = random() < 0.15;
      const heritage = random() < 0.25 ? ` extends mixin(${pick(['M', 'y'])})` : '';
      // 이름 있는 클래스식(`class M {`)의 이름은 본문 안에서 클래스 자신이다.
      const expression = !abstract && random() < 0.2;
      const owner = expression ? scope(current, false) : current;
      if (expression) owner.declarations = [{ kind: 'let', value: null }];
      emit(expression ? `const K${functions++} = class M${heritage} {` : `${abstract ? 'abstract ' : ''}class K${heritage} {`, depth);
      const member = random();
      if (member < 0.2) emit(`open(${pick(['M', 'x'])}): void`, depth + 1);
      else if (member < 0.3 && abstract) emit(`abstract open(${pick(['M', 'x'])}): void`, depth + 1);
      else if (member < 0.4) emit('label?', depth + 1);
      const form = random();
      if (form < 0.4) {
        emit(`run(${list}): void {`, depth + 1);
      } else if (form < 0.6) {
        emit(`run(${list})`, depth + 1);
        emit('{', depth + 1);
      } else if (form < 0.8) {
        emit(`run?(${list}): void {`, depth + 1);
      } else {
        emit(`catch(${list}) {`, depth + 1);
      }
      block(scope(owner, true, parameter), depth + 2, budget);
      emit('}', depth + 1);
      emit(expression ? '};' : '}', depth);
    } else {
      emit('noop();', depth);
    }
  };
  const program = scope(undefined, true);
  block(program, 0, 7);
  /** 위치 스코프에서 `M`이 가리키는 선언 묶음과, 그 묶음이 매개변수와 같은 함수 스코프인지(var가 매개변수를 다시 선언)다. */
  const resolve = (from: OracleScope): { readonly declarations?: OracleDeclaration[]; readonly parameter: boolean } => {
    for (let cursor: OracleScope | undefined = from; cursor !== undefined; cursor = cursor.parent) {
      if (cursor.declarations !== undefined) return { declarations: cursor.declarations, parameter: cursor.parameter };
      if (cursor.parameter) return { parameter: true };
    }
    return { parameter: false };
  };
  const reassigned = new Set<OracleDeclaration[]>();
  for (const assigned of assignments) {
    const { declarations } = resolve(assigned);
    if (declarations !== undefined) reassigned.add(declarations);
  }
  const expected = new Map<number, string | null>();
  for (const call of calls) {
    const { declarations, parameter } = resolve(call.scope);
    const values = declarations !== undefined && !reassigned.has(declarations)
      ? new Set([...declarations.map(({ value }) => value), ...(parameter ? [null] : [])])
      : undefined;
    // 줄 번호는 앞의 import 줄 하나만큼 밀린다.
    expected.set(call.line + 1, values?.size === 1 ? [...values][0]! : null);
  }
  // 한 줄로 낸 머리(`function f(x)\n{`)는 두 줄이다 — 줄 번호를 실제 줄로 다시 센다.
  const text = lines.join('\n').split('\n');
  return text.length === lines.length
    ? { lines, calls: expected, modules, invalid }
    : remapLines(lines, expected, modules, invalid);
}

/** 여러 줄을 한 항목으로 낸 프로그램의 줄 번호를 실제 줄 번호로 바꾼다. */
function remapLines(
  lines: readonly string[],
  calls: ReadonlyMap<number, string | null>,
  modules: ReadonlyMap<number, readonly string[]>,
  invalid: boolean,
): OracleProgram {
  const actual: number[] = [];
  let line = 2;
  for (const entry of lines) {
    actual.push(line);
    line += entry.split('\n').length;
  }
  const remap = (at: number): number => actual[at - 2]!;
  return {
    lines: lines.join('\n').split('\n'),
    calls: new Map([...calls].map(([at, value]) => [remap(at), value])),
    modules: new Map([...modules].map(([at, value]) => [remap(at), value])),
    invalid,
  };
}

/** 문서의 js-binding-scope 계수다(없으면 0). */
function bindingScopeCount(text: string): number {
  const document = createJsFactsDocument([{ path: 'a.tsx', text }], '0', '2026-01-01T00:00:00.000Z', 'p');
  const line = document.limitations.find((entry) => entry.startsWith('js-binding-scope: '));
  return line === undefined ? 0 : Number(line.split(' ')[1]);
}

/** 한 프로그램을 판정한다 — 어긋남을 문장으로 돌려준다(없으면 빈 배열). */
function checkProgram(program: OracleProgram): { readonly problems: string[]; readonly attributed: number; readonly counted: number } {
  const text = programText(program.lines);
  const document = createJsFactsDocument([{ path: 'a.tsx', text }], '0', '2026-01-01T00:00:00.000Z', 'p');
  const problems: string[] = [];
  let attributed = 0;
  let counted = 0;
  const invoked = new Map<number, string>();
  const imported = new Map<number, string[]>();
  for (const fact of document.facts) {
    const line = fact.location!.line;
    const channel = fact.channel ?? '';
    if (fact.kind === 'method-invoke') {
      invoked.set(line, channel);
      if (!program.calls.has(line) || program.calls.get(line) !== fact.channel || fact.dynamic) {
        problems.push(`false method-invoke ${fact.channel}.${fact.method} at line ${line} (expected ${program.calls.get(line)})`);
      } else {
        attributed++;
      }
    } else if (fact.kind === 'module-import') {
      imported.set(line, [...(imported.get(line) ?? []), channel]);
    }
  }
  // module-import는 줄마다 기준과 같아야 한다(거짓도 누락도 없다).
  for (const line of new Set([...imported.keys(), ...program.modules.keys()])) {
    const actual = [...(imported.get(line) ?? [])].sort().join(',');
    const expected = [...(program.modules.get(line) ?? [])].sort().join(',');
    if (actual !== expected) problems.push(`module-import at line ${line}: ${actual} (expected ${expected})`);
  }
  // 기준이 모듈인 호출을 귀속하지 않았으면 그 호출 자체가 js-binding-scope로 세어져야 한다 — 그 줄을 지우면 계수가
  // 준다(조용히 사라지지 않는다).
  const total = bindingScopeCount(text);
  for (const [line, module] of program.calls) {
    if (module === null || invoked.get(line) === module) continue;
    const without = program.lines.map((entry, index) => (index + 2 === line ? entry.replace('M.go();', 'noop();') : entry));
    if (bindingScopeCount(programText(without)) >= total) {
      problems.push(`call at line ${line} (expected ${module}) is neither attributed nor counted`);
    } else {
      counted++;
    }
  }
  return { problems, attributed, counted };
}

/**
 * 시드마다 `ORACLE_ROUNDS`개 프로그램을 판정한다. 고친 결함을 하나씩 되돌린 변형마다 시드를 1,500회씩 돌려, 오라클이 볼 수
 * 있는 변형마다 실패하는 시드가 하나 이상 들도록 골랐다(생성기를 바꿀 때마다 다시 고른다 — 4차 리뷰 반영 때 마지막으로
 * 골랐다): 중첩 삼항·`case` 앞 반환 타입 화살표(2·33·57·71·84), 제어문 머리 뒤 화살표(2·14·…), enum 초기값 안 증감(84), 선언
 * 패턴 기본값 안 대입(2·14·…), 이름 있는 함수식(전부)·클래스식(2·18·…, 확실 가림으로 되돌리면 14·18·33), 추론한 메서드 머리를
 * 확실하다고 본 변형(5), 괄호 대상(57), 줄 끝 `?`(18), `catch` 메서드(33), 호출 인자 대입(60), 기본값 있는 제네릭(2·57·71·84),
 * `case (1): {`를 함수 본문으로 읽은 변형(5·71), 삼항 갈래(14·…), 단일 매개변수 화살표(33·60·135), 사이 묶음 표시(2·57·84),
 * 매개변수 재선언 var(2·…), 잠정 가림 대체 해석(2·…), var 가둠·구조 분해 원천·대입·복합 대입·동결 때 무효 초기화·정하지 못한
 * 묶음 계수·`case` 절 뒤 배열 대입·초기값 안 대입·enum 초기값·선택 메서드(전부). 넓은 실행(시드 1~250 × 3,000회)은 이 테스트
 * 밖에서 했다.
 */
const ORACLE_SEEDS = [2, 5, 14, 18, 33, 57, 60, 71, 84, 135];
const ORACLE_ROUNDS = 1_500;

test('생성한 중첩 프로그램에서 거짓 사실이 없고 기준이 모듈인 호출은 귀속하거나 하나씩 센다', () => {
  // 형제 범위의 같은 이름, 안쪽 대역·구조 분해·for-of 변수의 가림, 함수 범위 var(종류를 정하지 못한 블록 포함),
  // 매개변수(삼항 갈래·단일 매개변수 화살표·다음 줄 `{` 포함), 재대입, 제네릭·반환 타입 함수, 선언자가 아닌 낱말을
  // 섞는다. 귀속한 호출은 모두 기준 모듈과 같아야 하고, 놓친 호출은 그 호출이 계수에 들어가야 한다.
  let checked = 0;
  let attributed = 0;
  let counted = 0;
  for (const seed of ORACLE_SEEDS) {
    const random = seededRandom(seed);
    for (let round = 0; round < ORACLE_ROUNDS; round++) {
      const program = generateProgram(random);
      if (program.invalid) continue;
      checked++;
      const result = checkProgram(program);
      assert.deepEqual(result.problems, [], `seed ${seed} round ${round}\n${programText(program.lines)}`);
      attributed += result.attributed;
      counted += result.counted;
    }
  }
  // 생성기가 판정할 만한 프로그램과 귀속·계수 호출을 충분히 만들었는지 확인한다.
  assert.ok(checked > 10_500 && attributed > 1_500 && counted > 150, `checked ${checked}, attributed ${attributed}, counted ${counted}`);
});
