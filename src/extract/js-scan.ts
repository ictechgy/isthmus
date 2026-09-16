/**
 * extract-js의 파일 한 개 스캐너다.
 *
 * 토큰 열 위에서 코어 RN과 Expo Modules의 브리지 호출 형태를 찾는다.
 * 모듈·컴포넌트 이름 경계 사실은 즉시 확정하고, 멤버 호출(`M.foo()`)은
 * 바인딩 정보와 함께 문서 조립 단계로 넘겨 같은 파일·가져오기 해석을 거친다.
 *
 * 이 스캐너는 이름을 정적으로 확정할 수 있는 형태만 fact로 낸다. 비리터럴
 * 인자는 `dynamic: true`에 원문 표현식을 실어 한계 계수에 맡긴다.
 */

import type { BridgeFact, BridgeMechanism } from '../exchange/parse.ts';
import { isSafeNonEmptyString } from '../exchange/parse.ts';
import type { JsToken } from './lexer.ts';
import { tokenizeJsSource } from './lexer.ts';

/** `requireNativeModule` 계열 — 모듈을 부르는 호출 측 API 이름이다. */
const moduleImportCalls = new Set([
  'requireNativeModule',
  'requireOptionalNativeModule',
]);

/** TurboModuleRegistry의 이름 인자를 받는 조회 메서드다. */
const turboRegistryMethods = new Set(['get', 'getEnforcing', 'getNullable']);

/** 컴포넌트를 요구하는 호출 측 API 이름이다. */
const componentRequireCalls = new Set([
  'requireNativeComponent',
  'codegenNativeComponent',
  'requireNativeViewManager',
]);

/**
 * Expo SDK(`expo`·`expo-modules-core`)에만 있는 호출 측 API 이름이다.
 * 코어 RN에는 같은 이름의 진입점이 없어 이름 자체가 Expo 증거다.
 */
const expoApiCalls = new Set([
  'requireNativeModule',
  'requireOptionalNativeModule',
  'requireNativeViewManager',
]);

/** Expo API를 실어 나르는 패키지 specifier다. */
const expoSpecifierPattern = /^expo(?:-modules-core)?(?:\/|$)/u;

/** 스캔이 모은 한 파일의 결과다. */
export interface JsFileScan {
  /** 이미 확정된 경계·메서드 사실이다. location은 토큰 위치로 호출자가 채운다. */
  readonly facts: readonly ScannedFact[];
  /**
   * 베이스가 로컬·import 식별자인 멤버 호출 후보다. 문서 단계에서 바인딩을
   * 해석해 메서드 호출 사실로 바꾼다.
   */
  readonly memberCalls: readonly ScannedMemberCall[];
  /** 같은 파일에서 식별자가 가리키는 모듈·컴포넌트 이름이다. */
  readonly bindings: ReadonlyMap<string, BoundName>;
  /** 한 단계 문자열 상수(`const X = 'lit'` / 백틱)다. */
  readonly constStrings: ReadonlyMap<string, string>;
  /** `import X from 'spec'` 바인딩이다. 문서 단계에서 파일 해석을 거친다. */
  readonly imports: readonly ScannedImport[];
  /** 다른 파일이 이 파일의 export를 해석하는 데 쓰는 이름 지도다. */
  readonly exports: ScannedExports;
  /** 생산자 limitation에 쓰는 원시 계수다. */
  readonly counts: JsScanCounts;
}

/** 스캔이 세는 한계 분류다. */
export interface JsScanCounts {
  readonly dynamicModuleNames: number;
  readonly dynamicComponentNames: number;
  readonly dynamicMethodNames: number;
}

/** 위치 정보가 붙기 전의 사실 골격이다. */
export interface ScannedFact {
  readonly kind: BridgeFact['kind'];
  readonly channel: string;
  readonly method?: string;
  readonly mechanism?: BridgeMechanism;
  readonly dynamic: boolean;
  readonly token: JsToken;
}

/** 바인딩이 확정된 이름인지 원문 표현식인지 구분한다. */
export type BoundName =
  | { readonly name: string }
  | { readonly dynamicExpression: string };

/** `ident.method(...)` 또는 `ident[expr](...)` 호출 후보다. */
export interface ScannedMemberCall {
  /** 베이스 식별자다. */
  readonly ident: string;
  /** 리터럴이면 메서드명, 아니면 원문 표현식이다. */
  readonly method: string;
  readonly dynamicMethod: boolean;
  readonly token: JsToken;
}

/** 한 파일의 import 바인딩이다. */
export interface ScannedImport {
  readonly localName: string;
  readonly specifier: string;
  /** default export 해석인지 named export 해석인지 구분한다. */
  readonly exportedName: string | 'default';
  readonly token: JsToken;
}

/** 이 파일이 외부에보내는 모듈 바인딩이다. */
export interface ScannedExports {
  readonly defaultName?: BoundName;
  readonly named: ReadonlyMap<string, BoundName>;
  /**
   * `export { A as B } from 'spec'`·`export { default as X } from 'spec'`의
   * 배럴 재수출이다. 키는 이 파일이보내는 이름, 값은 원본 specifier다.
   */
  readonly reexported: ReadonlyMap<string, {
    readonly specifier: string;
    readonly exportedName: string | 'default';
  }>;
}

interface ScanContext {
  readonly source: string;
  readonly tokens: readonly JsToken[];
  readonly facts: ScannedFact[];
  readonly memberCalls: ScannedMemberCall[];
  readonly bindings: Map<string, BoundName>;
  readonly constStrings: Map<string, string>;
  readonly imports: ScannedImport[];
  readonly namedExports: Map<string, BoundName>;
  readonly reexports: Map<string, {
    specifier: string;
    exportedName: string | 'default';
  }>;
  readonly counts: {
    dynamicModuleNames: number;
    dynamicComponentNames: number;
    dynamicMethodNames: number;
  };
  /**
   * 매개변수가 가리는 토큰 구간이다. `function f(M) {…}`·`f(M) {…}`·
   * `(M) => {…}` 형태의 `{…}` 본문 구간과 매개변수 이름을 담는다 — 파일
   * 전역 바인딩 지도는 스코프를 모르기 때문에 이 구간 안에서는 같은 이름의
   * 바인딩을 적용하지 않는다.
   */
  readonly paramShadows: readonly ParamShadow[];
  /**
   * 이 파일이 선언한 로컬 이름이다(`function`·`class`·`const` 등).
   * Expo API와 동명인 이름이 로컬에 선언됐으면 그 호출은 Expo API가 아니므로
   * mechanism 표시를 억제한다 — 스코프를 구분하지 않고 넓게 억제한다.
   */
  readonly localNames: Set<string>;
  /**
   * `const X = require('spec')`·`const {X} = require('spec')`의 이름별
   * specifier다. CJS 구조 분해로 가져온 Expo API를 import와 같은 규칙으로
   * 판정한다.
   */
  readonly requireSpecifiers: Map<string, string>;
  defaultExport?: BoundName;
}

/** 매개변수 이름이 가리는 토큰 구간(토큰 인덱스, 끝은 배타적)이다. */
interface ParamShadow {
  readonly from: number;
  readonly to: number;
  readonly names: ReadonlySet<string>;
}

/** 한 소스 텍스트를 스캔해 사실 후보·바인딩·계수를 모은다. */
export function scanJsSource(source: string): JsFileScan {
  const tokens = tokenizeJsSource(source);
  const context: ScanContext = {
    source,
    tokens,
    facts: [],
    memberCalls: [],
    bindings: new Map(),
    constStrings: new Map(),
    imports: [],
    namedExports: new Map(),
    reexports: new Map(),
    counts: {
      dynamicModuleNames: 0,
      dynamicComponentNames: 0,
      dynamicMethodNames: 0,
    },
    paramShadows: collectParamShadows(tokens),
    localNames: new Set(),
    requireSpecifiers: new Map(),
  };
  collectBindings(context);
  collectCalls(context);
  return {
    facts: context.facts,
    memberCalls: context.memberCalls,
    bindings: context.bindings,
    constStrings: context.constStrings,
    imports: context.imports,
    exports: {
      ...(context.defaultExport === undefined
        ? {}
        : { defaultName: context.defaultExport }),
      named: context.namedExports,
      reexported: context.reexports,
    },
    counts: context.counts,
  };
}

/**
 * 첫 번째 순회: 바인딩·상수·import·export를 모은다.
 *
 * 호출 해석보다 선언 수집을 먼저 끝내야 선언보다 앞선 호출 위치도 같은
 * 바인딩으로 해석된다(TDZ 오류 코드는 실행 시 죽으므로 정적 탐지엔 무해하다).
 */
function collectBindings(context: ScanContext): void {
  const { tokens } = context;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (token.kind === 'keyword' && token.text === 'import') {
      index = collectImport(context, index);
      continue;
    }
    if (token.kind === 'keyword' && token.text === 'export') {
      index = collectExport(context, index);
      continue;
    }
    if (
      token.kind === 'keyword' &&
      (token.text === 'const' || token.text === 'let' || token.text === 'var')
    ) {
      index = collectDeclaration(context, index);
      continue;
    }
    // `function NAME`·`class NAME` 선언 — 본문도 계속 스캔한다.
    if (token.kind === 'keyword' &&
      (token.text === 'function' || token.text === 'class')) {
      let cursor = index + 1;
      if (tokens[cursor]?.text === '*') cursor++;
      const name = tokens[cursor];
      if (name !== undefined &&
        (name.kind === 'identifier' || name.kind === 'keyword')) {
        context.localNames.add(name.text);
      }
      continue;
    }
    // 모듈 객체의 재대입은 바인딩을 무효화한다 — 해석 이름이 바뀌었을 수 있다.
    // `obj.prop = v`의 prop은 로컬 바인딩이 아니라 속성명이므로 제외한다.
    if (token.kind === 'identifier' && tokens[index + 1]?.text === '=' &&
      tokens[index - 1]?.text !== '.' && tokens[index - 1]?.text !== '?.') {
      context.bindings.delete(token.text);
      context.constStrings.delete(token.text);
    }
    // CommonJS `module.exports = <expr>`는 default export와 같다.
    if (
      token.kind === 'identifier' && token.text === 'module' &&
      tokens[index + 1]?.text === '.' &&
      tokens[index + 2]?.text === 'exports' &&
      tokens[index + 3]?.text === '='
    ) {
      const bound = readModuleExpression(context, index + 4);
      if (bound !== undefined && endsExpression(tokens, bound.endIndex)) {
        context.defaultExport = bound.value;
        index = bound.endIndex;
      }
      continue;
    }
    // `exports.X = <expr>`는 named export다.
    if (
      token.kind === 'identifier' && token.text === 'exports' &&
      tokens[index + 1]?.text === '.' &&
      tokens[index + 2]?.kind === 'identifier' &&
      tokens[index + 3]?.text === '='
    ) {
      const bound = readModuleExpression(context, index + 4);
      if (bound !== undefined && endsExpression(tokens, bound.endIndex)) {
        context.namedExports.set(tokens[index + 2]!.text, bound.value);
        index = bound.endIndex;
      }
    }
  }
}

/** `import ... from 'spec'` 절의 로컬 바인딩을 기록한다. */
function collectImport(context: ScanContext, start: number): number {
  const { tokens } = context;
  let index = start + 1;
  const clause: { name: string; exported: string | 'default' }[] = [];
  while (index < tokens.length) {
    const token = tokens[index]!;
    // `import type ...`는 문 전체가 타입 전용 — 런타임 바인딩이 아니다.
    // 키워드만 건너뛰면 절 이름이 그대로 수집되므로 specifier까지 건너뛴다.
    if (token.text === 'type' && index === start + 1) {
      let cursor = index + 1;
      while (cursor < tokens.length &&
        tokens[cursor]!.kind !== 'string' && tokens[cursor]!.text !== ';') {
        cursor++;
      }
      return cursor;
    }
    // `import { type A, B }`의 인라인 타입 지정은 그 이름만 바인딩에서 뺀다.
    if (token.text === 'type' &&
      inBraceClause(tokens, start + 1, index)) {
      const after = tokens[index + 1];
      if ((after?.kind === 'identifier' || after?.kind === 'keyword') &&
        after.text !== 'as') {
        index += 2;
        continue;
      }
    }
    if (token.kind === 'string') {
      // `import 'spec'` 부작용 전용이거나 절 뒤의 specifier다.
      if (clause.length > 0) return recordImport(context, clause, token, index);
      return index;
    }
    if (token.text === 'from') {
      const specifier = tokens[index + 1];
      return specifier?.kind === 'string'
        ? recordImport(context, clause, specifier, index + 1)
        : index;
    }
    if (token.text === 'as') {
      const alias = tokens[index + 1];
      const last = clause.at(-1);
      if (last !== undefined &&
        (alias?.kind === 'identifier' || alias?.kind === 'keyword')) {
        clause[clause.length - 1] = { name: alias.text, exported: last.exported };
      }
      index += 2;
      continue;
    }
    if (token.kind === 'identifier' || token.kind === 'keyword') {
      // 중괄호 안이면 named export, 아니면 default다.
      clause.push({
        name: token.text,
        exported: inBraceClause(tokens, start + 1, index)
          ? token.text
          : 'default',
      });
      index++;
      continue;
    }
    index++;
  }
  return index;
}

/** 수집한 import 절을 specifier와 함께 기록한다. */
function recordImport(
  context: ScanContext,
  clause: readonly { name: string; exported: string | 'default' }[],
  specifier: JsToken,
  endIndex: number,
): number {
  for (const entry of clause) {
    context.imports.push({
      localName: entry.name,
      specifier: specifier.value ?? specifier.text,
      exportedName: entry.exported,
      token: specifier,
    });
  }
  return endIndex;
}

/** 토큰이 `{` 절 안에 있는지 판정한다(named import 구분용). */
function inBraceClause(
  tokens: readonly JsToken[],
  from: number,
  to: number,
): boolean {
  let depth = 0;
  for (let index = from; index < to; index++) {
    if (tokens[index]!.text === '{') depth++;
    if (tokens[index]!.text === '}') depth--;
  }
  return depth > 0;
}

/** `export` 뒤의 default·named 모듈 바인딩을 수집한다. */
function collectExport(context: ScanContext, start: number): number {
  const { tokens } = context;
  const next = tokens[start + 1];
  if (next === undefined) return start;
  if (next.kind === 'keyword' && next.text === 'default') {
    const bound = readModuleExpression(context, start + 2);
    if (bound !== undefined && endsExpression(tokens, bound.endIndex)) {
      context.defaultExport = bound.value;
      return bound.endIndex;
    }
    // `export default M` — 로컬 바인딩을 거치는 형태다.
    const ident = tokens[start + 2];
    if (ident?.kind === 'identifier') {
      const resolved = context.bindings.get(ident.text);
      if (resolved !== undefined) context.defaultExport = resolved;
      return start + 2;
    }
    return start + 1;
  }
  if (next.kind === 'keyword' &&
    (next.text === 'const' || next.text === 'let' || next.text === 'var')) {
    // `export const X = <moduleExpr>` — 이 선언이 새로 만든 바인딩만 named export다.
    const before = new Set(context.bindings.keys());
    const declEnd = collectDeclaration(context, start + 1);
    for (const name of context.bindings.keys()) {
      if (!before.has(name)) {
        context.namedExports.set(name, context.bindings.get(name)!);
      }
    }
    return declEnd;
  }
  if (next.text === '{') {
    // `export { A, B as C }`(로컬)와 `export { A as B } from 'spec'`(배럴) 둘 다다.
    const close = findMatching(tokens, start + 1, '{', '}');
    if (close === undefined) return start;
    const pairs: { source: string; exported: string }[] = [];
    for (let index = start + 2; index < close; index++) {
      const token = tokens[index]!;
      if (token.kind === 'identifier' || token.kind === 'keyword') {
        if (token.text === 'as') {
          const alias = tokens[index + 1];
          const last = pairs.at(-1);
          if (alias !== undefined &&
            (alias.kind === 'identifier' || alias.kind === 'keyword') &&
            last !== undefined) {
            pairs[pairs.length - 1] = { source: last.source, exported: alias.text };
            index++;
          }
          continue;
        }
        pairs.push({ source: token.text, exported: token.text });
      }
    }
    // `from 'spec'`이 뒤따르면 배럴 재수출이다.
    const from = tokens[close + 1];
    const specifier = tokens[close + 2];
    if (from?.text === 'from' && specifier?.kind === 'string') {
      for (const pair of pairs) {
        context.reexports.set(pair.exported, {
          specifier: specifier.value ?? specifier.text,
          exportedName: pair.source === 'default' ? 'default' : pair.source,
        });
      }
      return close + 2;
    }
    for (const pair of pairs) {
      const bound = context.bindings.get(pair.source);
      if (bound !== undefined) context.namedExports.set(pair.exported, bound);
    }
    return close;
  }
  return start;
}

/**
 * `const/let/var` 선언의 바인딩을 수집한다 — 식별자와 구조 분해 둘 다.
 *
 * 선언자는 선언 키워드 직후나 같은 깊이의 `,` 뒤에만 온다 — 이 조건이 없으면
 * 세미콜론 없는 코드에서 뒤 문장의 `state.handler = Cam` 같은 대입이
 * 선언자로 오인돼 바인딩이 파일 전역으로 새어 나간다.
 */
function collectDeclaration(context: ScanContext, start: number): number {
  const { tokens } = context;
  let index = start + 1;
  // 선언자의 `,`는 깊이 0에만 온다 — `f(x, y = z)` 인자 안의 `,`는 무관하다.
  let depth = 0;
  while (index < tokens.length) {
    const token = tokens[index]!;
    if (token.text === ';' && depth === 0) return index;
    if (token.text === '(' || token.text === '[') {
      depth++;
      index++;
      continue;
    }
    if (token.text === ')' || token.text === ']') {
      depth--;
      index++;
      continue;
    }
    if (token.kind === 'identifier') {
      const declarator = index === start + 1 ||
        (depth === 0 && tokens[index - 1]?.text === ',');
      // 바인딩이 풀리든 안 풀리든 선언된 이름이다 — Expo API와 동명인
      // 로컬 선언이면 그 호출은 Expo API가 아니므로 mechanism 표시를 뺀다.
      if (declarator) context.localNames.add(token.text);
      let cursor = index + 1;
      // `const M: TurboModule = …`의 타입 주석은 건너뛰고 `=`를 찾는다.
      if (declarator && tokens[cursor]?.text === ':') {
        cursor = skipTypeAnnotation(tokens, cursor + 1);
      }
      if (declarator && tokens[cursor]?.text === '=') {
        // `const X = require('spec')…`의 specifier를 기록한다.
        const required = readRequireSpecifier(tokens, cursor + 1);
        if (required !== undefined) {
          context.requireSpecifiers.set(token.text, required);
        }
        const bound = readModuleExpression(context, cursor + 1);
        if (bound !== undefined && endsExpression(tokens, bound.endIndex)) {
          context.bindings.set(token.text, bound.value);
          // 초기값 식 내부의 괄호는 depth에 반영되지 않았으니 마지막 토큰까지
          // 건너뛴다 — `)`를 다시 처리하면 depth가 음수로 내려간다.
          index = bound.endIndex + 1;
          continue;
        }
        const literal = readLiteralExpression(context, cursor + 1);
        if (literal !== undefined && endsExpression(tokens, literal.endIndex)) {
          context.constStrings.set(token.text, literal.value);
          index = literal.endIndex + 1;
          continue;
        }
      }
      index++;
      continue;
    }
    if (token.text === '{') {
      const close = findMatching(tokens, index, '{', '}');
      if (close === undefined) return index;
      // `const { A, ... } = NativeModules`인지 확인한다.
      const source = tokens[close + 2];
      const isNativeModules = tokens[close + 1]?.text === '=' &&
        source?.kind === 'identifier' && source.text === 'NativeModules';
      if (isNativeModules) {
        collectDestructuredBindings(context, index, close);
        index = close + 1;
        continue;
      }
      // 그 외 원천의 구조 분해도 로컬 이름을 선언한다 — `require('spec')`
      // 원천이면 이름별 specifier까지 남겨 mechanism 판정에 쓴다.
      const required = tokens[close + 1]?.text === '='
        ? readRequireSpecifier(tokens, close + 2)
        : undefined;
      recordDestructuredLocals(context, index, close, required);
      index = close + 1;
      continue;
    }
    index++;
  }
  return index;
}

/**
 * 초기값 식이 `endIndex`에서 끝나는지 확인한다.
 *
 * `'Hel' + 'lo'`처럼 리터럴 뒤에 식이 계속되면 첫 토큰만 바인딩해 잘못된
 * 정적 이름이 되므로, 같은 줄에서는 `,`·`;`·닫는 괄호만 끝으로 인정한다.
 * 줄이 바뀌면 ASI로 문장이 끝날 수 있지만 `[`·`(`·이항 연산자 등은 여전히
 * 식을 이으므로 계속 토큰 집합에 있으면 끝이 아니다.
 */
function endsExpression(
  tokens: readonly JsToken[],
  endIndex: number,
): boolean {
  const next = tokens[endIndex + 1];
  if (next === undefined) return true;
  const sameLineEnd = next.text === ',' || next.text === ';' ||
    next.text === ')' || next.text === ']' || next.text === '}';
  if (next.line === tokens[endIndex]!.line) return sameLineEnd;
  return !expressionContinuations.has(next.text);
}

/** 줄이 바뀌어도 앞 식을 잇는 토큰이다 — ASI로 끝나지 않는 연속부다. */
const expressionContinuations = new Set([
  '.', '?.', '(', '[', '`', '?', ':',
  '+', '-', '*', '/', '%', '**', '&', '|', '^', '<', '>', '=',
  '&&', '||', '??', '=>', '==', '===', '!=', '!==', '<=', '>=',
  'instanceof', 'in', 'as',
]);

/**
 * 타입 주석 구간을 건너뛰어 `=`·`,`·`;` 위치를 돌려준다.
 *
 * 타입 안의 `=`(예: 제네릭 기본값 `<T = X>`)는 괄호 깊이 안에 있으므로
 * 깊이 0의 `=`·`,`·`;`에서 멈춘다.
 */
function skipTypeAnnotation(
  tokens: readonly JsToken[],
  start: number,
): number {
  let depth = 0;
  let index = start;
  while (index < tokens.length) {
    const text = tokens[index]!.text;
    if (text === '(' || text === '[' || text === '{' || text === '<') {
      depth++;
    } else if (text === ')' || text === ']' || text === '}' || text === '>') {
      depth--;
      if (depth < 0) return index;
    } else if (depth === 0 &&
      (text === '=' || text === ',' || text === ';')) {
      return index;
    }
    index++;
  }
  return index;
}

/**
 * `NativeModules` 구조 분해의 각 속성을 module-import로 확정하고 바인딩한다.
 * `...rest`는 이름을 열거할 수 없어 원문을 실은 동적 사실로 남긴다.
 */
function collectDestructuredBindings(
  context: ScanContext,
  open: number,
  close: number,
): void {
  const { tokens } = context;
  for (let index = open + 1; index < close; index++) {
    const token = tokens[index]!;
    if (token.text === ',') continue;
    if (token.text === '...') {
      // open·close는 토큰 인덱스다 — 문자 오프셋으로 환산해 원문을 뗀다.
      const begin = tokens[open]!.offset;
      const end = tokens[close]!.offset + tokens[close]!.text.length;
      context.facts.push({
        kind: 'module-import',
        channel: sanitizeExpression(context.source.slice(begin, end)),
        dynamic: true,
        token,
      });
      context.counts.dynamicModuleNames++;
      break;
    }
    if (token.kind === 'identifier' || token.kind === 'keyword') {
      const name = token.text;
      let localName = name;
      let cursor = index;
      // `A: alias` 형태와 기본값 `A = expr`를 구분한다.
      if (tokens[index + 1]?.text === ':') {
        const alias = tokens[index + 2];
        if (alias?.kind === 'identifier' || alias?.kind === 'keyword') {
          localName = alias.text;
          cursor = index + 2;
        }
      }
      while (cursor < close && tokens[cursor]!.text !== ',') cursor++;
      index = cursor - 1;
      context.facts.push({
        kind: 'module-import',
        channel: name,
        dynamic: false,
        token,
      });
      context.bindings.set(localName, { name });
      context.localNames.add(localName);
    }
  }
}

/**
 * `require('spec')`의 specifier를 읽는다 — `require` 리터럴 호출만 본다.
 * `require('spec').member`처럼 뒤에 멤버 접근이 붙어도 specifier는 같다.
 */
function readRequireSpecifier(
  tokens: readonly JsToken[],
  start: number,
): string | undefined {
  if (tokens[start]?.kind !== 'identifier' ||
    tokens[start]!.text !== 'require' ||
    tokens[start + 1]?.text !== '(') {
    return undefined;
  }
  const specifier = tokens[start + 2];
  if (specifier?.kind !== 'string' || specifier.value === undefined ||
    tokens[start + 3]?.text !== ')') {
    return undefined;
  }
  return specifier.value;
}

/**
 * `const { A, B: alias, ...rest } = <expr>` 구조 분해의 로컬 이름을 기록한다.
 * 원천이 `require('spec')`이면 이름별 specifier도 남긴다 — CJS로 가져온
 * Expo API를 ES import와 같은 규칙으로 판정하기 위해서다.
 */
function recordDestructuredLocals(
  context: ScanContext,
  open: number,
  close: number,
  specifier: string | undefined,
): void {
  const { tokens } = context;
  for (let index = open + 1; index < close; index++) {
    const token = tokens[index]!;
    if (token.kind !== 'identifier' && token.kind !== 'keyword') continue;
    let localName = token.text;
    // `A: alias`의 로컬 이름은 alias다 — 속성명은 선언되지 않는다.
    if (tokens[index + 1]?.text === ':') {
      const alias = tokens[index + 2];
      if (alias?.kind === 'identifier' || alias?.kind === 'keyword') {
        localName = alias.text;
      }
    }
    context.localNames.add(localName);
    if (specifier !== undefined) {
      context.requireSpecifiers.set(localName, specifier);
    }
    // 기본값·중첩 패턴까지 포함해 다음 `,`까지 건너뛴다.
    let cursor = index + 1;
    while (cursor < close && tokens[cursor]!.text !== ',') cursor++;
    index = cursor - 1;
  }
}

/**
 * 위치 `start`에서 모듈 식(`NativeModules.N`, `TurboModuleRegistry.get*('N')`,
 * `requireNativeModule('N')` 등)을 읽어 이름·동적 표현식을 돌려준다.
 */
function readModuleExpression(
  context: ScanContext,
  start: number,
): { readonly value: BoundName; readonly endIndex: number } | undefined {
  const { tokens } = context;
  const token = tokens[start];
  if (token === undefined) return undefined;
  if (token.kind === 'identifier' && token.text === 'NativeModules') {
    const next = tokens[start + 1];
    if (next?.text === '.' || next?.text === '?.') {
      const name = tokens[start + 2];
      if (name?.kind === 'identifier' || name?.kind === 'keyword') {
        return { value: { name: name.text }, endIndex: start + 2 };
      }
      return undefined;
    }
    if (next?.text === '[') {
      const arg = readArgument(context, start + 2);
      if (arg === undefined) return undefined;
      // endIndex는 식 전체의 끝 — `NativeModules['X'].foo`의 `.foo`까지
      // 바인딩하면 속성값을 모듈로 오인한다.
      const close = findMatching(tokens, start + 1, '[', ']');
      return {
        value: arg.value === undefined
          ? { dynamicExpression: arg.expression }
          : { name: arg.value },
        endIndex: close ?? arg.endIndex,
      };
    }
    return undefined;
  }
  if (token.kind === 'identifier' && token.text === 'TurboModuleRegistry') {
    if (tokens[start + 1]?.text !== '.') return undefined;
    const method = tokens[start + 2];
    if (!turboRegistryMethods.has(method?.text ?? '')) return undefined;
    const call = readNamedCall(context, start + 3);
    return call === undefined
      ? undefined
      : { value: call.value, endIndex: call.endIndex };
  }
  if (moduleImportCalls.has(token.text) || componentRequireCalls.has(token.text)) {
    const call = readNamedCall(context, start + 1);
    return call === undefined
      ? undefined
      : { value: call.value, endIndex: call.endIndex };
  }
  // 바인딩된 식별자의 추적(`const N = M`)은 한 단계만 허용한다.
  // 같은 이름의 매개변수가 가리는 구간 안에서는 파일 바인딩을 적용하지 않는다.
  if (token.kind === 'identifier' && !isShadowed(context, token.text, start)) {
    const bound = context.bindings.get(token.text);
    return bound === undefined
      ? undefined
      : { value: bound, endIndex: start };
  }
  return undefined;
}

/**
 * 호출의 첫 인자 이름을 읽는다 — `ident(` 또는 `ident<T>(` 다음의 첫 인자.
 * 이름이 문자열 리터럴이거나 한 단계 상수면 값을, 아니면 원문 표현식을 돌려준다.
 */
function readNamedCall(
  context: ScanContext,
  start: number,
): { readonly value: BoundName; readonly endIndex: number } | undefined {
  const { tokens } = context;
  let index = start;
  if (tokens[index]?.text === '<') {
    const close = skipTypeArguments(tokens, index);
    if (close === undefined) return undefined;
    index = close + 1;
  }
  if (tokens[index]?.text !== '(') return undefined;
  const arg = readArgument(context, index + 1);
  if (arg === undefined) return undefined;
  // endIndex는 호출의 닫는 `)` — `f('A').x`를 `f('A')`까지만 읽은 것처럼
  // 끝내면 `.x` 속성 접근이 모듈 바인딩으로 오인된다.
  const close = findMatching(tokens, index, '(', ')');
  return {
    value: arg.value === undefined
      ? { dynamicExpression: arg.expression }
      : { name: arg.value },
    endIndex: close ?? arg.endIndex,
  };
}

/** 한 단계 문자열 리터럴(`'lit'`·보간 없는 백틱)만 읽는다. */
function readLiteralExpression(
  context: ScanContext,
  start: number,
): { readonly value: string; readonly endIndex: number } | undefined {
  const token = context.tokens[start];
  if ((token?.kind === 'string' || token?.kind === 'template') &&
    token.value !== undefined) {
    return { value: token.value, endIndex: start };
  }
  return undefined;
}

/** 호출 인자의 첫 표현식을 읽는다. */
function readArgument(
  context: ScanContext,
  start: number,
): {
  readonly value?: string;
  readonly expression: string;
  readonly endIndex: number;
} | undefined {
  const { tokens } = context;
  const token = tokens[start];
  if (token === undefined || token.text === ')' || token.text === ',') {
    return undefined;
  }
  const end = tokens[start + 1];
  // `]`는 `NativeModules['N']`·`M['m']()`의 인자 종결이다 — 빠뜨리면
  // 리터럴이 다토큰 표현식으로 읽혀 동적으로 오분류된다.
  const singleToken = end === undefined ||
    end.text === ',' || end.text === ')' || end.text === ']';
  // 한 단계 상수 추적 — `const X = 'lit'` 같은 파일 선언만 본다.
  if (token.kind === 'identifier' && singleToken) {
    const literal = isShadowed(context, token.text, start)
      ? undefined
      : context.constStrings.get(token.text);
    return literal === undefined || !isSafeNonEmptyString(literal)
      ? { expression: sanitizeExpression(token.text), endIndex: start }
      : { value: literal, expression: token.text, endIndex: start };
  }
  if (singleToken &&
    (token.kind === 'string' || token.kind === 'template') &&
    token.value !== undefined) {
    // 계약이 허용하지 않는 이름(빈 값·제어 문자·짝 없는 서러게이트)은 정적
    // 사실이 될 수 없다 — 원문을 실은 동적 사실로 내려 증거를 보존한다.
    return isSafeNonEmptyString(token.value)
      ? { value: token.value, expression: token.text, endIndex: start }
      : { expression: sanitizeExpression(token.text), endIndex: start };
  }
  // 그 외 표현식은 닫는 `)`나 같은 깊이의 `,`까지 원문을 보존한다.
  let depth = 0;
  let index = start;
  while (index < tokens.length) {
    const current = tokens[index]!;
    if (current.text === '(' || current.text === '[' || current.text === '{') {
      depth++;
    } else if (
      current.text === ')' || current.text === ']' || current.text === '}'
    ) {
      if (depth === 0) break;
      depth--;
    } else if (current.text === ',' && depth === 0) {
      break;
    }
    index++;
  }
  const last = tokens[index - 1];
  if (last === undefined || index === start) return undefined;
  return {
    expression: sanitizeExpression(
      context.source.slice(token.offset, last.offset + last.text.length),
    ),
    endIndex: index - 1,
  };
}

/** `<...>` 타입 인수 구간을 건너뛰어 닫는 `>`의 인덱스를 돌려준다. */
function skipTypeArguments(
  tokens: readonly JsToken[],
  start: number,
): number | undefined {
  let depth = 0;
  for (let index = start; index < tokens.length; index++) {
    const text = tokens[index]!.text;
    if (text === '<') depth++;
    else if (text === '>') {
      depth--;
      if (depth === 0) return index;
    } else if (depth === 0) {
      return undefined;
    }
  }
  return undefined;
}

/** 두 번째 순회: 브리지 API 호출·멤버 호출을 사실로 모은다. */
function collectCalls(context: ScanContext): void {
  const { tokens } = context;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (token.kind !== 'identifier') continue;
    if (token.text === 'NativeModules') {
      index = collectNativeModulesAccess(context, index);
      continue;
    }
    if (token.text === 'TurboModuleRegistry') {
      index = collectRegistryCall(context, index);
      continue;
    }
    // `function NAME(...)`·`function* NAME(...)`의 선언부는 호출이 아니다 —
    // 이름 기반 탐지가 선언 자리를 경계 호출로 오인하지 않게 뺀다.
    const declarationSite = tokens[index - 1]?.text === 'function' ||
      (tokens[index - 1]?.text === '*' &&
        tokens[index - 2]?.text === 'function');
    if (declarationSite) continue;
    if (moduleImportCalls.has(token.text)) {
      index = collectBoundaryCall(context, index, 'module-import', token.text);
      continue;
    }
    if (componentRequireCalls.has(token.text)) {
      index = collectBoundaryCall(context, index, 'component-require', token.text);
      continue;
    }
    // `import { api as alias }`로 들어온 경계 API — 사실의 mechanism 판정은
    // 로컬 별칭이 아니라 원본 export 이름을 기준으로 한다. 같은 이름의
    // 매개변수가 가리는 구간에서는 import 바인딩이 적용되지 않는다.
    const aliasedApi = isShadowed(context, token.text, index)
      ? undefined
      : boundaryAliasOf(context, token.text);
    if (aliasedApi !== undefined && boundaryCallOpens(context, index)) {
      index = collectBoundaryCall(
        context, index,
        moduleImportCalls.has(aliasedApi) ? 'module-import' : 'component-require',
        aliasedApi);
      continue;
    }
    const next = tokens[index + 1];
    if (next?.text === '.' || next?.text === '?.' || next?.text === '[') {
      index = collectBoundMemberCall(context, index);
    }
  }
}

/**
 * `NativeModules.N` 멤버 접근과 뒤따르는 메서드 호출을 처리한다.
 * 레지스트리 자체가 값으로 쓰이는 베어 `NativeModules`는 어느 모듈인지
 * 알 수 없어 원문을 실은 동적 사실로 남긴다.
 */
function collectNativeModulesAccess(
  context: ScanContext,
  start: number,
): number {
  const { tokens } = context;
  const member = tokens[start + 1];
  if (member?.text === '.' || member?.text === '?.') {
    const name = tokens[start + 2];
    if (name?.kind !== 'identifier' && name?.kind !== 'keyword') return start;
    context.facts.push({
      kind: 'module-import',
      channel: name.text,
      dynamic: false,
      token: name,
    });
    return collectChainedCall(context, { name: name.text }, start + 2)
      ?? start + 2;
  }
  if (member?.text === '[') {
    const arg = readArgument(context, start + 2);
    if (arg === undefined) return start;
    const bound: BoundName = arg.value === undefined
      ? { dynamicExpression: arg.expression }
      : { name: arg.value };
    const dynamic = arg.value === undefined;
    if (dynamic) context.counts.dynamicModuleNames++;
    context.facts.push({
      kind: 'module-import',
      channel: boundChannel(bound),
      dynamic,
      token: member,
    });
    const close = findMatching(tokens, start + 1, '[', ']');
    if (close === undefined) return arg.endIndex;
    return collectChainedCall(context, bound, close) ?? close;
  }
  // 앞 토큰이 `.`·키워드면 큰 식의 일부다 — 베어 접근만 세어 중복을 피한다.
  const previous = tokens[start - 1];
  // `const { A } = NativeModules`의 레지스트리는 구조 분해 원천이다 —
  // 각 이름이 이미 module-import를 냈으므로 베어 사실을 추가하지 않는다.
  const destructured = previous?.text === '=' &&
    tokens[start - 2]?.text === '}';
  if (previous !== undefined && previous.text !== '.' &&
    previous.text !== '?.' && !destructured) {
    context.facts.push({
      kind: 'module-import',
      channel: 'NativeModules',
      dynamic: true,
      token: tokens[start]!,
    });
    context.counts.dynamicModuleNames++;
  }
  return start;
}

/** `TurboModuleRegistry.get*('N')` 호출과 뒤따르는 메서드 호출을 처리한다. */
function collectRegistryCall(context: ScanContext, start: number): number {
  const { tokens } = context;
  if (tokens[start + 1]?.text !== '.') return start;
  const method = tokens[start + 2];
  if (method === undefined || !turboRegistryMethods.has(method.text)) {
    return start;
  }
  // skipTypeArguments는 닫는 `>`의 위치를 주므로 `(`는 그 다음 토큰이다.
  let open = start + 3;
  if (tokens[open]?.text === '<') {
    const closeAngle = skipTypeArguments(tokens, open);
    if (closeAngle === undefined) return start;
    open = closeAngle + 1;
  }
  if (tokens[open]?.text !== '(') return start;
  const arg = readArgument(context, open + 1);
  if (arg === undefined) return start;
  const dynamic = arg.value === undefined;
  if (dynamic) context.counts.dynamicModuleNames++;
  const bound: BoundName = dynamic
    ? { dynamicExpression: arg.expression }
    : { name: arg.value! };
  context.facts.push({
    kind: 'module-import',
    channel: boundChannel(bound),
    dynamic,
    token: method,
  });
  const close = findMatching(tokens, open, '(', ')');
  if (close === undefined) return arg.endIndex;
  return collectChainedCall(context, bound, close) ?? close;
}

/**
 * 식별자가 `import { api as local }`로 들어온 경계 API 별칭이면 원본 export
 * 이름을 돌려준다 — 별칭 호출의 mechanism은 원본 이름 기준으로 판정한다.
 */
function boundaryAliasOf(
  context: ScanContext,
  localName: string,
): string | undefined {
  for (const entry of context.imports) {
    if (entry.localName === localName &&
      (moduleImportCalls.has(entry.exportedName) ||
        componentRequireCalls.has(entry.exportedName))) {
      return entry.exportedName;
    }
  }
  return undefined;
}

/** 식별자 뒤가 호출(`(` 또는 타입 인수 뒤 `(`)인지 본다. */
function boundaryCallOpens(context: ScanContext, start: number): boolean {
  const { tokens } = context;
  let open = start + 1;
  if (tokens[open]?.text === '<') {
    const close = skipTypeArguments(tokens, open);
    if (close === undefined) return false;
    open = close + 1;
  }
  return tokens[open]?.text === '(';
}

/** `requireNativeModule('N')` 등 단독 호출의 경계 사실과 메서드 호출을 처리한다. */
function collectBoundaryCall(
  context: ScanContext,
  start: number,
  kind: 'module-import' | 'component-require',
  apiName: string,
): number {
  const { tokens } = context;
  let open = start + 1;
  if (tokens[open]?.text === '<') {
    const closeAngle = skipTypeArguments(tokens, open);
    if (closeAngle === undefined) return start;
    open = closeAngle + 1;
  }
  if (tokens[open]?.text !== '(') return start;
  const arg = readArgument(context, open + 1);
  if (arg === undefined) return start;
  const dynamic = arg.value === undefined;
  if (dynamic) {
    if (kind === 'module-import') context.counts.dynamicModuleNames++;
    else context.counts.dynamicComponentNames++;
  }
  const bound: BoundName = dynamic
    ? { dynamicExpression: arg.expression }
    : { name: arg.value! };
  const mechanism = mechanismOf(context, apiName, tokens[start]!.text, start);
  context.facts.push({
    kind,
    channel: boundChannel(bound),
    ...(mechanism === undefined ? {} : { mechanism }),
    dynamic,
    token: tokens[start]!,
  });
  if (kind !== 'module-import') return arg.endIndex;
  const close = findMatching(tokens, open, '(', ')');
  if (close === undefined) return arg.endIndex;
  return collectChainedCall(context, bound, close) ?? close;
}

/**
 * 단독 호출의 해석 경로(mechanism)를 정한다.
 *
 * `requireNativeModule`·`requireOptionalNativeModule`·`requireNativeViewManager`는
 * Expo SDK에만 있는 공개 API다 — Expo 패키지 import·CJS `require`로
 * 확인되거나 어떤 가져오기·로컬 선언도 없이 호출되면 `expo`로 표시한다.
 * 같은 이름이 로컬에 선언됐거나(같은 파일 래퍼·쉼) Expo가 아닌 specifier에서
 * 가져온 동명 래퍼면 어느 경로로 해석되는지 알 수 없어 mechanism을 생략해
 * 추측하지 않는다 — 틀린 `expo` 표시는 조인을 끊거나 거짓 매치를 만든다.
 */
function mechanismOf(
  context: ScanContext,
  apiName: string,
  localName: string,
  start: number,
): 'expo' | undefined {
  if (!expoApiCalls.has(apiName)) return undefined;
  // 같은 이름의 매개변수가 가리는 구간에서는 import·require·선언 해석이
  // 이 호출에 적용되지 않는다 — mechanism을 생략해 추측하지 않는다.
  if (isShadowed(context, localName, start)) return undefined;
  const specifiers = context.imports
    .filter((entry) => entry.localName === localName)
    .map((entry) => entry.specifier);
  if (specifiers.length > 0) {
    return specifiers.some((specifier) => expoSpecifierPattern.test(specifier))
      ? 'expo'
      : undefined;
  }
  const required = context.requireSpecifiers.get(localName);
  if (required !== undefined) {
    return expoSpecifierPattern.test(required) ? 'expo' : undefined;
  }
  if (context.localNames.has(localName)) return undefined;
  return 'expo';
}

/**
 * `<moduleExpr>.method(...)` 연속 호출을 method-invoke 사실로 기록한다.
 * 베이스는 이미 확정된 모듈 식이라 식별자 해석을 거치지 않는다.
 */
function collectChainedCall(
  context: ScanContext,
  bound: BoundName,
  endIndex: number,
): number | undefined {
  const { tokens } = context;
  const dot = tokens[endIndex + 1];
  if (dot?.text !== '.' && dot?.text !== '?.') return undefined;
  const method = tokens[endIndex + 2];
  if (method === undefined) return endIndex;
  if (method.kind === 'identifier' || method.kind === 'keyword') {
    // `NativeModules.N.m` 참조만 있고 호출이 없으면 사실이 아니다.
    return isCallAt(tokens, endIndex + 3)
      ? recordDirectMethodCall(context, bound, method, false, endIndex + 3)
      : endIndex + 2;
  }
  if (method.text === '[') {
    const arg = readArgument(context, endIndex + 3);
    if (arg === undefined) return endIndex + 2;
    const bracketClose = findMatching(tokens, endIndex + 2, '[', ']');
    if (bracketClose === undefined || !isCallAt(tokens, bracketClose + 1)) {
      return arg.endIndex;
    }
    const dynamicMethod = arg.value === undefined;
    if (dynamicMethod) context.counts.dynamicMethodNames++;
    return recordDirectMethodCall(
      context,
      bound,
      method,
      dynamicMethod,
      bracketClose + 1,
      dynamicMethod ? arg.expression : arg.value!,
    );
  }
  return endIndex;
}

/** 확정된 모듈 식 위의 메서드 호출을 사실로 기록한다. */
function recordDirectMethodCall(
  context: ScanContext,
  bound: BoundName,
  token: JsToken,
  dynamicMethod: boolean,
  callIndex: number,
  methodText?: string,
): number {
  const name = 'name' in bound ? bound.name : bound.dynamicExpression;
  const dynamic = !('name' in bound);
  context.facts.push({
    kind: 'method-invoke',
    channel: name,
    method: methodText ?? token.text,
    dynamic: dynamic || dynamicMethod,
    token,
  });
  return callIndex;
}

/**
 * 바인딩 식별자의 `M.foo()`·`M[expr]()` 멤버 호출을 후보로 기록한다.
 * 로컬 바인딩이나 import 바인딩이 없는 식별자는 모듈 근거가 없어 건너뛴다.
 */
function collectBoundMemberCall(context: ScanContext, start: number): number {
  const { tokens } = context;
  const token = tokens[start]!;
  const bound = !isShadowed(context, token.text, start) &&
    (context.bindings.has(token.text) ||
      context.imports.some((entry) => entry.localName === token.text));
  const accessor = tokens[start + 1];
  // `M[expr]()` — 대괄호 접근은 식별자 바로 뒤에 온다.
  if (accessor?.text === '[') {
    const arg = readArgument(context, start + 2);
    if (arg === undefined) return start;
    const bracketClose = findMatching(tokens, start + 1, '[', ']');
    const called = bracketClose !== undefined &&
      isCallAt(tokens, bracketClose + 1);
    if (bound && called) {
      const dynamicMethod = arg.value === undefined;
      if (dynamicMethod) context.counts.dynamicMethodNames++;
      context.memberCalls.push({
        ident: token.text,
        method: dynamicMethod ? arg.expression : arg.value!,
        dynamicMethod,
        token: accessor,
      });
    }
    return arg.endIndex;
  }
  // accessor는 `.`·`?.` — 뒤는 메서드 식별자 또는 `M?.[expr]`의 `[`다.
  const method = tokens[start + 2];
  if (method === undefined) return start;
  if (method.kind === 'identifier' || method.kind === 'keyword') {
    if (!isCallAt(tokens, start + 3)) return start + 2;
    if (bound) {
      context.memberCalls.push({
        ident: token.text,
        method: method.text,
        dynamicMethod: false,
        token: method,
      });
    }
    return start + 2;
  }
  if (method.text === '[') {
    const arg = readArgument(context, start + 3);
    if (arg === undefined) return start;
    const bracketClose = findMatching(tokens, start + 2, '[', ']');
    const called = bracketClose !== undefined && isCallAt(tokens, bracketClose + 1);
    if (bound && called) {
      const dynamicMethod = arg.value === undefined;
      if (dynamicMethod) context.counts.dynamicMethodNames++;
      context.memberCalls.push({
        ident: token.text,
        method: dynamicMethod ? arg.expression : arg.value!,
        dynamicMethod,
        token: method,
      });
    }
    return arg.endIndex;
  }
  return start;
}

/** `(` 또는 `<T>(`로 시작하는 호출인지 확인한다. */
function isCallAt(tokens: readonly JsToken[], start: number): boolean {
  const token = tokens[start];
  if (token?.text === '(') return true;
  if (token?.text !== '<') return false;
  const close = skipTypeArguments(tokens, start);
  return close !== undefined && tokens[close + 1]?.text === '(';
}

/** BoundName을 사실의 channel 문자열로 바꾼다. */
function boundChannel(bound: BoundName): string {
  return 'name' in bound ? bound.name : bound.dynamicExpression;
}

/**
 * 매개변수가 파일 전역 바인딩을 가리는 본문 구간을 모은다.
 *
 * 인식하는 형태는 `function f(M) {…}`·`f(M) {…}`(메서드 약칭)·`(M) => {…}`·
 * `M => {…}`다. `foo(x) {…}`처럼 호출 뒤 블록이 오는 문장도 매개변수 목록으로
 * 보이지만, 그 경우의 과도한 가림은 사실을 놓칠 뿐 거짓 사실을 만들지 않는다.
 * 본문이 `{`로 시작하지 않는 화살표(`M => M.x()`)는 끝을 알 수 없어 건너뛴다.
 */
function collectParamShadows(tokens: readonly JsToken[]): ParamShadow[] {
  const shadows: ParamShadow[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!;
    // `M => {…}` 단일 매개변수 화살표다.
    if ((token.kind === 'identifier' || token.kind === 'keyword') &&
      tokens[index + 1]?.text === '=>' && tokens[index + 2]?.text === '{') {
      const close = findMatching(tokens, index + 2, '{', '}');
      if (close !== undefined) {
        shadows.push({
          from: index + 2,
          to: close + 1,
          names: new Set([token.text]),
        });
        index = close;
      }
      continue;
    }
    if (token.text !== '(') continue;
    const previous = tokens[index - 1];
    // `function f(…)`·`function (…)`의 매개변수 목록이다.
    let isParams = previous?.text === 'function' ||
      (previous?.kind === 'identifier' &&
        tokens[index - 2]?.text === 'function');
    const close = findMatching(tokens, index, '(', ')');
    if (close === undefined) continue;
    if (!isParams) {
      const afterClose = tokens[close + 1];
      isParams = afterClose?.text === '=>' ||
        // `f(M) {…}` 메서드 약칭 — `(` 앞이 식별자일 때만 본다.
        // `if (M) {…}` 같은 키워드 조건절은 매개변수가 아니다.
        (previous?.kind === 'identifier' && afterClose?.text === '{');
    }
    if (!isParams) continue;
    let bodyIndex = close + 1;
    if (tokens[bodyIndex]?.text === '=>') bodyIndex++;
    if (tokens[bodyIndex]?.text !== '{') continue;
    const bodyClose = findMatching(tokens, bodyIndex, '{', '}');
    if (bodyClose === undefined) continue;
    const names = new Set<string>();
    for (let cursor = index + 1; cursor < close; cursor++) {
      const param = tokens[cursor]!;
      if (param.kind === 'identifier' || param.kind === 'keyword') {
        names.add(param.text);
      }
    }
    shadows.push({ from: bodyIndex, to: bodyClose + 1, names });
    index = close;
  }
  return shadows;
}

/** 위치 `index`의 `name`이 매개변수에 가려졌는지 판정한다. */
function isShadowed(
  context: ScanContext,
  name: string,
  index: number,
): boolean {
  return context.paramShadows.some(
    (shadow) =>
      index >= shadow.from && index < shadow.to && shadow.names.has(name),
  );
}

/** 짝 맞는 괄호 토큰을 찾는다. */
function findMatching(
  tokens: readonly JsToken[],
  open: number,
  openText: string,
  closeText: string,
): number | undefined {
  let depth = 0;
  for (let index = open; index < tokens.length; index++) {
    const text = tokens[index]!.text;
    if (text === openText) depth++;
    else if (text === closeText) {
      depth--;
      if (depth === 0) return index;
    }
  }
  return undefined;
}

/**
 * 동적 표현식의 원문을 계약 필드가 허용하는 안전한 문자열로 바꾼다.
 *
 * 제어 문자는 공백으로 접고 길이를 제한해 원문 표현이 키 파싱을 깨지 않게 한다.
 */
export function sanitizeExpression(expression: string): string {
  const cleaned = expression
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > 200 ? `${cleaned.slice(0, 197)}...` : cleaned;
}
