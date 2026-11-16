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

/** 모듈 부재를 허용하는 호출 측 API다 — 부재 시 던지지 않고 `null`을 돌려준다. */
const optionalModuleCalls = new Set(['requireOptionalNativeModule']);

/** TurboModuleRegistry의 이름 인자를 받는 조회 메서드다. */
const turboRegistryMethods = new Set(['get', 'getEnforcing', 'getNullable']);

/** 부재 시 `null`을 돌려주는 레지스트리 조회다 — `getEnforcing`만 던진다. */
const optionalRegistryMethods = new Set(['get', 'getNullable']);

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
  /**
   * 이 파일의 바인딩·상대 import 이름별로 값이 바인딩 추적을 벗어난 사용 횟수다. 그 이름이 모듈인지는
   * 다른 파일의 export를 봐야 알 수 있어 문서 단계가 판정한다.
   */
  readonly identifierEscapes: ReadonlyMap<string, number>;
}

/** 스캔이 세는 한계 분류다. */
export interface JsScanCounts {
  readonly dynamicModuleNames: number;
  readonly dynamicComponentNames: number;
  readonly dynamicMethodNames: number;
  /**
   * 브리지 API로 읽지 않은 접근 수다 — 다른 모듈(배럴 재수출·대역)에서 가져온 `NativeModules`의 멤버 접근과,
   * 그 API를 내보내는 모듈(react-native·Expo)로 추적되지 않는 객체의 속성으로 쓴 브리지 API 이름이다.
   */
  readonly untracedApiAccesses: number;
  /**
   * 인식한 모듈 식(`NativeModules.X`·조회 호출·레지스트리·조회 API 값)이 귀속 호출·추적 바인딩·export·원시값
   * 소비가 아닌 위치에 쓰여 스캔이 따라가지 않는 바인딩으로 넘어간 수다.
   */
  readonly escapedModuleReferences: number;
  /**
   * 출처를 스캔이 따라가지 못하는 값의 입구 수다 — 네임스페이스 import, 값을 쓰는 `require()` 호출,
   * 동적 `import()` 호출. ES default·named import는 해석이 필요해 문서 단계가 센다.
   */
  readonly untracedBindings: number;
}

/** 위치 정보가 붙기 전의 사실 골격이다. */
export interface ScannedFact {
  readonly kind: BridgeFact['kind'];
  readonly channel: string;
  readonly method?: string;
  readonly mechanism?: BridgeMechanism;
  /** 호출 API가 모듈 부재를 허용한다(`null` 반환)는 module-import 증거다. */
  readonly optional?: boolean;
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

/** 식별자 하나에서 구조 분해한 로컬 이름의 원천이다. */
interface DestructuredSource {
  /** 구조 분해한 속성 이름이다(`{ NativeModules: NM }`의 NativeModules). */
  readonly property: string;
  /** 원천 식별자다(`= RN`의 RN). */
  readonly source: string;
  /** 원천 식별자 토큰의 위치다. 매개변수 가림은 이 위치에서 판정한다. */
  readonly sourceIndex: number;
}

interface ScanContext {
  readonly source: string;
  readonly tokens: readonly JsToken[];
  readonly facts: ScannedFact[];
  readonly memberCalls: ScannedMemberCall[];
  readonly bindings: Map<string, BoundName>;
  readonly constStrings: Map<string, string>;
  readonly imports: ScannedImport[];
  /**
   * `imports`를 로컬 이름별로 나눈 색인이다(각 목록은 수집 순서). 식별자마다 import
   * 전체를 훑지 않게 recordImport가 `imports`와 함께 채운다 — 바인딩 수집 중의
   * 조회도 그때까지 수집된 import만 본다.
   */
  readonly importsByLocalName: Map<string, ScannedImport[]>;
  readonly namedExports: Map<string, BoundName>;
  readonly reexports: Map<string, {
    specifier: string;
    exportedName: string | 'default';
  }>;
  readonly counts: {
    dynamicModuleNames: number;
    dynamicComponentNames: number;
    dynamicMethodNames: number;
    untracedApiAccesses: number;
    escapedModuleReferences: number;
    untracedBindings: number;
  };
  /**
   * 바인딩·export가 값을 따라가는 식의 시작 토큰 위치다. 선언 초기값은 수집이 끝난 뒤 바인딩이 살아 있을
   * 때만 넣는다 — 재대입·같은 이름의 다른 선언으로 바뀐 바인딩은 그 초기값을 따라가지 않는다.
   */
  readonly trackedValueStarts: Set<number>;
  /** 선언 초기값으로 바인딩한 기록(초기값 시작 위치·이름·값)이다. */
  readonly initializers: { readonly start: number; readonly name: string; readonly value: BoundName }[];
  /** 선언문이 묶은 선언자 이름 토큰 위치다. 값 사용이 아니다. */
  readonly declaratorNames: Set<number>;
  /** `const { A } = NativeModules`로 이름별 바인딩을 만든 레지스트리 토큰 위치다. */
  readonly destructuredRegistrySources: Set<number>;
  /** 괄호 그룹(여는 위치)의 값이 원시값으로 소비되는지 기억한다. */
  readonly consumedGroups: Map<number, boolean>;
  /** 괄호 그룹(여는 위치) 깊이 0에 값을 다른 바인딩으로 넘기는 연산이 있는지 기억한다. */
  readonly divertingGroups: Map<number, boolean>;
  /** 바인딩·상대 import 이름별로 값이 추적을 벗어난 사용 횟수다(JsFileScan.identifierEscapes). */
  readonly identifierEscapes: Map<string, number>;
  /**
   * 매개변수가 가리는 토큰 구간의 이름별 색인이다. `function f(M) {…}`·`f(M) {…}`·
   * `(M) => {…}` 형태의 `{…}` 본문 구간과 매개변수 이름을 담는다 — 파일
   * 전역 바인딩 지도는 스코프를 모르기 때문에 이 구간 안에서는 같은 이름의
   * 바인딩을 적용하지 않는다.
   */
  readonly paramShadows: ParamShadowIndex;
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
  /** `const X = require('spec')`처럼 초기값이 require 호출 하나인 이름의 specifier다(모듈 객체 판정용). */
  readonly requireModules: Map<string, string>;
  /**
   * Babel·TS 기본 import 변환(`X = _interopRequireDefault(require('spec'))`)의 이름 → specifier다. `X.default`가
   * 그 모듈의 기본 export다.
   */
  readonly interopDefaultModules: Map<string, string>;
  /**
   * `const { P: local } = SOURCE`처럼 식별자 하나에서 구조 분해한 로컬 이름의 원천이다(속성 이름·원천 식별자·원천
   * 토큰 위치). `const { NativeModules } = RN`의 RN이 react-native 모듈 객체인지는 import가 뒤에 와도 알 수 있도록
   * 사용 시점에 판정한다.
   */
  readonly destructuredSources: Map<string, DestructuredSource>;
  /** 네임스페이스 import의 이름 → specifier다(`import * as NAME`·`import X, * as NAME`). */
  readonly namespaceImports: ReadonlyMap<string, string>;
  /** `import * as NAME from 'react-native'`의 NAME 목록이다. */
  readonly reactNativeNamespaces: ReadonlySet<string>;
  readonly unstableAliasNames: ReadonlySet<string>;
  defaultExport?: BoundName;
}

/** 매개변수 이름이 가리는 토큰 구간(토큰 인덱스, 끝은 배타적)이다. */
export interface ParamShadow {
  readonly from: number;
  readonly to: number;
  readonly names: ReadonlySet<string>;
}

/**
 * 매개변수 가림 구간을 이름별로 모은 색인이다.
 *
 * 식별자마다 파일의 모든 가림 구간을 훑으면 함수가 많은 생성 코드에서 스캔이
 * 이차가 된다. 이름별 구간을 from 오름차순으로 두고 to의 앞쪽 최댓값을 함께
 * 저장해, "from ≤ index < to인 구간이 하나라도 있는가"를 이분 탐색 한 번으로
 * 답한다 — 구간 목록 전체를 훑는 판정과 결과가 같고 구간의 중첩 여부를 가정하지 않는다.
 */
export class ParamShadowIndex {
  readonly #byName = new Map<string, { readonly froms: number[]; readonly prefixMaxTo: number[] }>();

  constructor(shadows: Iterable<ParamShadow>) {
    const rangesByName = new Map<string, { from: number; to: number }[]>();
    for (const shadow of shadows) {
      for (const name of shadow.names) {
        let ranges = rangesByName.get(name);
        if (ranges === undefined) {
          ranges = [];
          rangesByName.set(name, ranges);
        }
        ranges.push({ from: shadow.from, to: shadow.to });
      }
    }
    for (const [name, ranges] of rangesByName) {
      ranges.sort((left, right) => left.from - right.from);
      const froms: number[] = [];
      const prefixMaxTo: number[] = [];
      for (const { from, to } of ranges) {
        froms.push(from);
        prefixMaxTo.push(Math.max(to, prefixMaxTo.at(-1) ?? to));
      }
      this.#byName.set(name, { froms, prefixMaxTo });
    }
  }

  /** 위치 `index`의 `name`이 어떤 매개변수 구간에 가려졌는지 판정한다. */
  has(name: string, index: number): boolean {
    const ranges = this.#byName.get(name);
    if (ranges === undefined) return false;
    // from ≤ index인 구간 수를 찾는다 — 그 구간들의 to 최댓값이 index보다 커야 가려진다.
    let low = 0;
    let high = ranges.froms.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (ranges.froms[middle]! <= index) low = middle + 1;
      else high = middle;
    }
    return low > 0 && ranges.prefixMaxTo[low - 1]! > index;
  }
}

/** 한 소스 텍스트를 스캔해 사실 후보·바인딩·계수를 모은다. */
function createBoundContext(source: string): ScanContext {
  const tokens = tokenizeJsSource(source);
  const namespaceImports = namespaceImportSpecifiers(tokens);
  const context: ScanContext = {
    source,
    tokens,
    facts: [],
    memberCalls: [],
    bindings: new Map(),
    constStrings: new Map(),
    imports: [],
    importsByLocalName: new Map(),
    namedExports: new Map(),
    reexports: new Map(),
    counts: {
      dynamicModuleNames: 0,
      dynamicComponentNames: 0,
      dynamicMethodNames: 0,
      untracedApiAccesses: 0,
      escapedModuleReferences: 0,
      untracedBindings: 0,
    },
    trackedValueStarts: new Set(),
    initializers: [],
    declaratorNames: new Set(),
    destructuredRegistrySources: new Set(),
    consumedGroups: new Map(),
    divertingGroups: new Map(),
    identifierEscapes: new Map(),
    paramShadows: new ParamShadowIndex(collectParamShadows(tokens)),
    localNames: new Set(),
    requireSpecifiers: new Map(),
    requireModules: new Map(),
    interopDefaultModules: new Map(),
    destructuredSources: new Map(),
    namespaceImports,
    reactNativeNamespaces: new Set([...namespaceImports].flatMap(([name, specifier]) =>
      specifier === 'react-native' ? [name] : [])),
    unstableAliasNames: new Set(tokens.filter((token, index) =>
      token.kind === 'identifier' && tokens[index - 1]?.text !== 'as' &&
      (!['(', '<'].includes(tokens[index + 1]?.text ?? '') ||
        ['function', '*'].includes(tokens[index - 1]?.text ?? '')))
      .map((token) => token.text)),
  };
  collectBindings(context);
  for (const { start, name, value } of context.initializers) {
    if (sameBoundName(context.bindings.get(name), value)) context.trackedValueStarts.add(start);
  }
  return context;
}

/** 한 소스 텍스트를 스캔해 사실 후보·바인딩·계수를 모은다. */
export function scanJsSource(source: string): JsFileScan {
  const context = createBoundContext(source);
  const importPositions = importStatementPositions(context.tokens);
  collectCalls(context, importPositions);
  collectIdentifierEscapes(context, importPositions);
  countUntracedEntries(context, importPositions);
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
    identifierEscapes: context.identifierEscapes,
  };
}

/** RN 전역 이벤트 구독의 이름과 실제 호출 토큰이다. */
export interface ScannedJsEvent {
  readonly channel: string;
  readonly dynamic: boolean;
  readonly token: JsToken;
}

/** 확인된 RN import와 직접 생성한 emitter에서만 구독을 읽는다. */
export function scanJsEvents(source: string): { facts: ScannedJsEvent[]; unsupported: number } {
  const context = createBoundContext(source);
  const { tokens } = context;
  const references = new Map<string, number[]>();
  tokens.forEach((token, index) => {
    if (token.kind !== 'identifier' && token.kind !== 'keyword') return;
    const positions = references.get(token.text) ?? [];
    positions.push(index);
    references.set(token.text, positions);
  });
  const declarations = eventDeclarations(tokens);
  const imports = context.imports.filter(({ specifier, exportedName }) => specifier === 'react-native' &&
    (exportedName === 'DeviceEventEmitter' || exportedName === 'NativeEventEmitter'));
  const importPositions = new Set<number>();
  for (let index = 0; index < tokens.length; index++) {
    const end = tokens[index]?.text === 'import' ? importStatementEnd(tokens, index) : undefined;
    if (end === undefined) continue;
    for (let cursor = index; cursor <= end; cursor++) importPositions.add(cursor);
    index = end;
  }
  // 선언·재대입·매개변수·다른 함수로 전달된 이름은 파일 범위에서 보수적으로 제외한다.
  const stable = (name: string, declaration = -1, constructor = false) => (references.get(name) ?? []).every((index) => {
    if (importPositions.has(index) || index === declaration ||
      ['.', '?.'].includes(tokens[index - 1]?.text ?? '')) return true;
    if (constructor && tokens[index - 1]?.text === 'new' && tokens[index + 1]?.text === '(') return true;
    return ['.', '?.'].includes(tokens[index + 1]?.text ?? '') &&
      tokens[index + 3]?.text === '(';
  });
  const constructors = new Set(imports.filter((entry) => entry.exportedName === 'NativeEventEmitter' &&
    !context.localNames.has(entry.localName) && stable(entry.localName, -1, true)).map(({ localName }) => localName));
  const receivers = new Map(imports.filter((entry) => entry.exportedName === 'DeviceEventEmitter' &&
    !context.localNames.has(entry.localName) && stable(entry.localName))
    .map(({ localName }) => [localName, { from: 0, to: tokens.length }]));
  let unsupported = imports.length - constructors.size - receivers.size;
  const namespaces = new Map<string, number>();
  const namespaceStable = (name: string, declaration: number) => (references.get(name) ?? []).every((index) => {
    if (index === declaration || importPositions.has(index) || ['.', '?.'].includes(tokens[index - 1]?.text ?? '')) return true;
    if (!['.', '?.'].includes(tokens[index + 1]?.text ?? '') ||
      ['delete', '++', '--'].includes(tokens[index - 1]?.text ?? '')) return false;
    const member = tokens[index + 2]?.text;
    if (member === 'NativeEventEmitter') return tokens[index - 1]?.text === 'new' && tokens[index + 3]?.text === '(';
    if (member === 'DeviceEventEmitter') return ['.', '?.'].includes(tokens[index + 3]?.text ?? '') && tokens[index + 5]?.text === '(';
    let end = index;
    while (['.', '?.'].includes(tokens[end + 1]?.text ?? '') && tokens[end + 2]?.kind === 'identifier') end += 2;
    // Namespace의 다른 export를 읽는 것은 허용하지만 멤버 대입·삭제는 제외한다.
    return !['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '??=', '&&=', '||=', '++', '--', '[']
      .includes(tokens[end + 1]?.text ?? '') &&
      !(['&&', '||', '??', '<<', '>>', '**'].includes(tokens[end + 1]?.text ?? '') && tokens[end + 2]?.text === '=');
  });
  const namespace = (name: string, declaration: number, from = 0) => {
    if (namespaceStable(name, declaration)) namespaces.set(name, from);
    else unsupported++;
  };
  for (const declaration of declarations) {
    const { nameIndex, valueIndex } = declaration;
    if (!declaration.fileScope || context.localNames.has('require') ||
      isShadowed(context, 'require', valueIndex) || readRequireSpecifier(tokens, valueIndex) !== 'react-native' ||
      !endsExpression(tokens, valueIndex + 3)) continue;
    namespace(tokens[nameIndex]!.text, nameIndex, valueIndex + 4);
  }
  for (let index = 0; index < tokens.length; index++) {
    if (tokens[index]?.text === 'import' && tokens[index + 1]?.text === '*' && tokens[index + 2]?.text === 'as' &&
      tokens[index + 3]?.kind === 'identifier' && tokens[index + 4]?.text === 'from' && tokens[index + 5]?.value === 'react-native') {
      namespace(tokens[index + 3]!.text, -1);
    }
  }
  const constructorOpen = (start: number): number | undefined => {
    if (tokens[start]?.text !== 'new' || ['.', '?.'].includes(tokens[start - 1]?.text ?? '')) return undefined;
    const name = tokens[start + 1]?.text ?? '';
    if (isShadowed(context, name, start + 1)) return undefined;
    if (constructors.has(name) && tokens[start + 2]?.text === '(') return start + 2;
    if (namespaces.has(name) && start >= namespaces.get(name)! && tokens[start + 2]?.text === '.' && tokens[start + 3]?.text === 'NativeEventEmitter' &&
      tokens[start + 4]?.text === '(') return start + 4;
    return undefined;
  };
  const handledConstructors = new Set<number>();
  for (const declaration of declarations) {
    const open = constructorOpen(declaration.valueIndex);
    if (open === undefined) continue;
    handledConstructors.add(open);
    const name = tokens[declaration.nameIndex]!;
    const end = findMatching(tokens, open, '(', ')');
    if (end === undefined || !endsExpression(tokens, end) || !stable(name.text, declaration.nameIndex) ||
      declaration.to === undefined || declaration.inForHeader ||
      (declaration.keyword !== 'const' && !declaration.fileScope)) {
      unsupported++; continue;
    }
    receivers.set(name.text, { from: end + 1, to: declaration.to });
  }
  const facts: ScannedJsEvent[] = [];
  const add = (methodIndex: number) => {
    const call = readNamedCall(context, methodIndex + 1);
    if (call === undefined) { unsupported++; return; }
    facts.push({ channel: boundChannel(call.value), dynamic: !('name' in call.value), token: tokens[methodIndex]! });
  };
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!;
    const receiver = receivers.get(token.text);
    if (receiver !== undefined &&
      !['.', '?.'].includes(tokens[index - 1]?.text ?? '') &&
      ['.', '?.'].includes(tokens[index + 1]?.text ?? '') && tokens[index + 2]?.text === 'addListener' &&
      tokens[index + 3]?.text === '(') {
      if (index >= receiver.from && index < receiver.to && !isShadowed(context, token.text, index)) add(index + 2);
      else unsupported++;
    }
    if (namespaces.has(token.text) && index >= namespaces.get(token.text)! && !['.', '?.'].includes(tokens[index - 1]?.text ?? '') &&
      !isShadowed(context, token.text, index) && tokens[index + 1]?.text === '.' && tokens[index + 2]?.text === 'DeviceEventEmitter' &&
      ['.', '?.'].includes(tokens[index + 3]?.text ?? '') && tokens[index + 4]?.text === 'addListener' && tokens[index + 5]?.text === '(') add(index + 4);
    const open = constructorOpen(index);
    if (open !== undefined) {
      const end = findMatching(tokens, open, '(', ')');
      if (end !== undefined && tokens[end + 1]?.text === '.' && tokens[end + 2]?.text === 'addListener' &&
        tokens[end + 3]?.text === '(') add(end + 2);
      else if (!handledConstructors.has(open)) unsupported++;
    }
  }
  return { facts, unsupported };
}

/** 직접 선언의 초기화 위치·lexical 경계를 모아 파일 밖/초기화 전으로 바인딩을 퍼뜨리지 않는다. */
function eventDeclarations(tokens: readonly JsToken[]) {
  const braces: number[] = [];
  const parentheses: number[] = [];
  const ends = new Map<number, number>();
  const controlEnds = new Set<number>();
  const declarations: Array<{ keyword: string; nameIndex: number; valueIndex: number; scope: number | undefined; fileScope: boolean; inForHeader: boolean }> = [];
  tokens.forEach((token, index) => {
    if (['const', 'let', 'var'].includes(token.text) && tokens[index + 1]?.kind === 'identifier' && tokens[index + 2]?.text === '=') {
      declarations.push({ keyword: token.text, nameIndex: index + 1, valueIndex: index + 3,
        scope: braces.at(-1), fileScope: braces.length === 0 && parentheses.length === 0 &&
          !controlEnds.has(index - 1) && !['else', 'do', ':'].includes(tokens[index - 1]?.text ?? ''),
        inForHeader: parentheses.some((open) => tokens[open - 1]?.text === 'for' ||
          (tokens[open - 1]?.text === 'await' && tokens[open - 2]?.text === 'for')) });
    }
    if (token.text === '{') braces.push(index);
    else if (token.text === '}') { const open = braces.pop(); if (open !== undefined) ends.set(open, index); }
    else if (token.text === '(') parentheses.push(index);
    else if (token.text === ')') {
      const open = parentheses.pop();
      if (open !== undefined && !['.', '?.'].includes(tokens[open - 2]?.text ?? '') &&
        (['if', 'for', 'while', 'with'].includes(tokens[open - 1]?.text ?? '') ||
        (tokens[open - 1]?.text === 'await' && tokens[open - 2]?.text === 'for'))) controlEnds.add(index);
    }
  });
  return declarations.map((declaration) => ({ ...declaration,
    to: declaration.scope === undefined ? tokens.length : ends.get(declaration.scope) }));
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
        context.trackedValueStarts.add(index + 4);
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
        context.trackedValueStarts.add(index + 4);
        index = bound.endIndex;
      }
    }
  }
}

/** `import ... from 'spec'` 절의 로컬 바인딩을 기록한다. */
function collectImport(context: ScanContext, start: number): number {
  const { tokens } = context;
  const end = importStatementEnd(tokens, start);
  // import 문이 아닌 `import`(import.meta, 객체 키, JSX 낱말)는 문자열까지 읽어 뒤 코드를 삼키지 않는다.
  if (end === undefined) return start;
  // TS `import X = require('spec')`는 X 하나의 default import다.
  if (tokens[start + 2]?.text === '=') {
    return recordImport(context, [{ name: tokens[start + 1]!.text, exported: 'default' }], tokens[end - 1]!, end);
  }
  let index = start + 1;
  const clause: { name: string; exported: string | 'default' }[] = [];
  const inBraceClause = createBraceClauseTracker(tokens, start + 1);
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
    if (token.text === 'type' && inBraceClause(index)) {
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
      // `* as NS`의 네임스페이스는 import 목록에 넣지 않는다 — `import X, * as NS`에서 앞 default 이름 X를
      // NS로 바꾸면 X가 사라지고 NS가 default로 기록된다.
      if (tokens[index - 1]?.text !== '*' && last !== undefined &&
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
        exported: inBraceClause(index) ? token.text : 'default',
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
    const scanned: ScannedImport = {
      localName: entry.name,
      specifier: specifier.value ?? specifier.text,
      exportedName: entry.exported,
      token: specifier,
    };
    context.imports.push(scanned);
    const sameName = context.importsByLocalName.get(entry.name);
    if (sameName === undefined) context.importsByLocalName.set(entry.name, [scanned]);
    else sameName.push(scanned);
  }
  return endIndex;
}

/**
 * import 절의 위치가 `{` 절 안(named import)인지 답하는 판정을 만든다.
 *
 * `from`부터 위치 `to` 앞까지의 `{`·`}` 깊이가 양수면 안이다. 판정할 위치는 줄지
 * 않아야 한다 — 이전 위치까지 센 깊이를 이어 쓰므로 한 절의 판정 전체가 절 길이에
 * 선형이다. 위치마다 처음부터 다시 세면 긴 절(`import a a a …`)에서 이차 시간이 든다.
 */
export function createBraceClauseTracker(
  tokens: readonly JsToken[],
  from: number,
): (to: number) => boolean {
  let next = from;
  let depth = 0;
  return (to) => {
    for (; next < to; next++) {
      const text = tokens[next]!.text;
      if (text === '{') depth++;
      if (text === '}') depth--;
    }
    return depth > 0;
  };
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
      context.trackedValueStarts.add(start + 2);
      return bound.endIndex;
    }
    // `export default M` — 로컬 바인딩을 거치는 형태다.
    const ident = tokens[start + 2];
    if (ident?.kind === 'identifier') {
      const resolved = context.bindings.get(ident.text);
      if (resolved !== undefined) {
        context.defaultExport = resolved;
        context.trackedValueStarts.add(start + 2);
      }
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
 * 선언자로 오인돼 바인딩이 파일 전역으로 새어 나간다. 같은 이유로 `{`는 선언자의
 * 대상 구간(초기값 `=` 앞)에서만 구조 분해 패턴이다 — 초기값 안의 객체 리터럴·함수
 * 본문 이름을 로컬 선언으로 기록하면 그 이름(`NativeModules` 등)의 해석이 파일 전체에서 바뀐다.
 */
function collectDeclaration(context: ScanContext, start: number): number {
  const { tokens } = context;
  let index = start + 1;
  // 선언자의 `,`는 깊이 0에만 온다 — `f(x, y = z)` 인자 안의 `,`는 무관하다.
  let depth = 0;
  // 지금 위치가 선언자의 대상(이름·패턴) 구간인지다. 깊이 0의 `=`·`of`·`in`에서 끝나고 `,`에서 다시 시작한다.
  let target = true;
  while (index < tokens.length) {
    const token = tokens[index]!;
    if (token.text === ';' && depth === 0) return index;
    // 감싼 괄호·블록을 닫는 토큰(for 머리의 `)`, 세미콜론 없는 블록의 `}`)과 ASI로 끝난 줄에서도 선언이 끝난다.
    // 선언 안의 `{`는 모두 짝까지 건너뛰므로 여기서 만나는 `}`는 감싼 블록의 것이다. 끝 바로 앞 위치를
    // 돌려줘 호출자가 경계 토큰부터 다시 읽게 한다.
    if (token.text === '}' || (depth === 0 && (token.text === ')' || token.text === ']')) ||
      endsByLineBreak(tokens, start, index, depth)) {
      return index - 1;
    }
    if (depth === 0 && (token.text === '=' ||
      (token.kind === 'keyword' && (token.text === 'of' || token.text === 'in')))) {
      target = false;
      index++;
      continue;
    }
    if (depth === 0 && token.text === ',') {
      target = true;
      index++;
      continue;
    }
    // 초기값 안의 제네릭 호출·화살표 타입 인수(`useMemo<Record<string, unknown>>(…)`, `<T,>(x) => …`)는 한 덩어리로
    // 건너뛴다 — 그 안의 `,`를 선언자 구분으로 읽으면 대상 구간이 다시 열려 뒤 객체 리터럴이 패턴이 된다.
    if (!target && token.text === '<') {
      const close = skipTypeArguments(tokens, index, true);
      if (close !== undefined && tokens[close + 1]?.text === '(') {
        index = close + 1;
        continue;
      }
    }
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
      if (declarator) {
        context.localNames.add(token.text);
        context.declaratorNames.add(index);
      }
      let cursor = index + 1;
      // `const M: TurboModule = …`의 타입 주석은 건너뛰고 `=`를 찾는다.
      if (declarator && tokens[cursor]?.text === ':') {
        cursor = skipTypeAnnotation(tokens, cursor + 1);
        // 주석이 ASI 줄바꿈에서 끝났으면 선언문도 끝났다 — 다음 줄 선언의 `=`를 이 이름의 초기값으로 읽지 않는다.
        if (endsTypeByLineBreak(tokens, cursor)) return cursor - 1;
      }
      if (declarator && tokens[cursor]?.text === '=') {
        // `const X = require('spec')…`의 specifier를 기록한다.
        const required = readRequireSpecifier(tokens, cursor + 1);
        if (required !== undefined) {
          context.requireSpecifiers.set(token.text, required);
          if (endsExpression(tokens, cursor + 4) && !isShadowed(context, 'require', cursor + 1)) {
            context.requireModules.set(token.text, required);
          }
        }
        recordInteropRequire(context, token.text, cursor + 1);
        const bound = readModuleExpression(context, cursor + 1);
        if (bound !== undefined && endsExpression(tokens, bound.endIndex)) {
          context.bindings.set(token.text, bound.value);
          context.initializers.push({ start: cursor + 1, name: token.text, value: bound.value });
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
      // 타입 주석은 이름 자리가 아니다 — 그 안의 `{`·`,`를 패턴·선언자로 읽지 않게 주석 뒤로 건너뛴다.
      index = declarator && cursor > index + 1 ? cursor : index + 1;
      continue;
    }
    if (token.text === '{') {
      const close = findMatching(tokens, index, '{', '}');
      if (close === undefined) return index;
      if (!target) {
        // 초기값 안의 객체 리터럴·함수 본문이다. 구조 분해 패턴이 아니므로 이름을 기록하지 않는다.
        index = close + 1;
        continue;
      }
      // `const { A, ... } = NativeModules`인지 확인한다.
      const source = tokens[close + 2];
      const isNativeModules = tokens[close + 1]?.text === '=' &&
        source?.kind === 'identifier' && source.text === 'NativeModules';
      if (isNativeModules) {
        collectDestructuredBindings(context, index, close);
        context.destructuredRegistrySources.add(close + 2);
        index = close + 1;
        continue;
      }
      // 그 외 원천의 구조 분해도 로컬 이름을 선언한다 — `require('spec')`
      // 원천이면 이름별 specifier까지 남겨 mechanism 판정에 쓴다.
      const required = tokens[close + 1]?.text === '='
        ? readRequireSpecifier(tokens, close + 2)
        : undefined;
      // `const { … } = SOURCE;`처럼 식별자 하나가 원천이면 그 식별자를 남긴다(모듈 객체 판정용).
      const sourceToken = tokens[close + 2];
      const sourceIndex = tokens[close + 1]?.text === '=' && sourceToken?.kind === 'identifier' &&
        endsExpression(tokens, close + 2) ? close + 2 : undefined;
      recordDestructuredLocals(context, index, close, required, sourceIndex);
      index = close + 1;
      continue;
    }
    index++;
  }
  return index;
}

/**
 * 선언문이 `index` 앞의 줄바꿈에서 ASI로 끝났는지 본다. 깊이 0에서 앞 줄이 피연산자(식별자·리터럴·닫는
 * 괄호·후위 증감)로 끝나고 이 줄이 식이나 선언 목록을 잇는 토큰으로 시작하지 않으면 새 문장이다.
 */
function endsByLineBreak(tokens: readonly JsToken[], start: number, index: number, depth: number): boolean {
  const previous = tokens[index - 1];
  if (depth !== 0 || index <= start + 1 || previous === undefined || tokens[index]!.line === previous.line) {
    return false;
  }
  // 피연산자 뒤의 `!`는 TS non-null 후위 연산이고, `as const`의 `const`는 단언의 끝이다.
  const operandEnd = isOperandEnd(previous) || ['}', '++', '--'].includes(previous.text) ||
    (previous.text === '!' && isOperandEnd(tokens[index - 2])) ||
    (previous.text === 'const' && tokens[index - 2]?.text === 'as');
  return operandEnd && tokens[index]!.text !== ',' && !expressionContinuations.has(tokens[index]!.text);
}

/** Babel·TS의 CommonJS import 변환 도우미와 그 결과의 모양(기본 export를 감싼 객체, 네임스페이스)이다. */
const interopHelpers: ReadonlyMap<string, 'default' | 'namespace'> = new Map([
  ['_interopRequireDefault', 'default'], ['__importDefault', 'default'],
  ['_interopRequireWildcard', 'namespace'], ['__importStar', 'namespace'],
]);

/**
 * `NAME = HELPER(require('spec'))`(위치 `start`가 HELPER)를 모듈 객체로 기록한다. 네임스페이스 변환은 NAME이 모듈
 * 객체이고, 기본 변환은 `NAME.default`가 기본 export다 — react-native의 기본 export는 모듈 객체다(`import RN`과 같다).
 */
function recordInteropRequire(context: ScanContext, name: string, start: number): void {
  const { tokens } = context;
  const shape = interopHelpers.get(tokens[start]?.text ?? '');
  const specifier = readRequireSpecifier(tokens, start + 2);
  if (shape === undefined || tokens[start]!.kind !== 'identifier' || tokens[start + 1]?.text !== '(' ||
    specifier === undefined || tokens[start + 6]?.text !== ')' || !endsExpression(tokens, start + 6) ||
    isShadowed(context, 'require', start + 2)) {
    return;
  }
  (shape === 'namespace' ? context.requireModules : context.interopDefaultModules).set(name, specifier);
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
 * 타입 주석 구간을 건너뛰어 주석 다음 위치를 돌려준다 — 깊이 0의 `=`·`,`·`;`, 감싼 괄호를 닫는 토큰, 또는
 * ASI로 문장이 끝난 줄의 첫 토큰.
 *
 * 타입 안의 `=`(예: 제네릭 기본값 `<T = X>`)는 괄호 깊이 안에 있으므로 깊이 0에서만 멈춘다. 렉서는 `>>`·`>>>`를
 * 한 토큰으로 내므로 중첩 제네릭을 닫을 때 그만큼 깊이를 줄인다 — 줄이지 않으면 주석이 파일 끝까지 이어진다.
 * 초기값 없는 선언(`let timer: Timer`) 뒤 줄의 선언으로 넘어가지 않도록 깊이 0의 ASI 줄바꿈에서도 멈춘다.
 */
function skipTypeAnnotation(
  tokens: readonly JsToken[],
  start: number,
): number {
  let depth = 0;
  for (let index = start; index < tokens.length; index++) {
    const text = tokens[index]!.text;
    if (depth === 0 && index > start && endsTypeByLineBreak(tokens, index)) return index;
    if (text === '(' || text === '[' || text === '{' || text === '<') {
      depth++;
    } else if (typeClosers.has(text)) {
      depth -= typeClosers.get(text)!;
      if (depth < 0) return index;
    } else if (depth === 0 &&
      (text === '=' || text === ',' || text === ';')) {
      return index;
    }
  }
  return tokens.length;
}

/** 타입 깊이를 닫는 토큰과 닫는 단계 수다. `>>`·`>>>`는 중첩 제네릭 두세 단계를 한 번에 닫는다. */
const typeClosers: ReadonlyMap<string, number> = new Map([
  [')', 1], [']', 1], ['}', 1], ['>', 1], ['>>', 2], ['>>>', 3],
]);

/** 줄이 바뀌어도 앞 타입을 잇는 토큰이다(유니온·교차·멤버·인수·함수 타입·조건 타입·선언 목록). */
const typeContinuations = new Set([...expressionContinuations, ',', ';', 'extends']);

/**
 * 타입 주석이 `index` 앞 줄바꿈에서 ASI로 끝났는지 본다. 앞 줄이 타입의 끝(이름·리터럴·닫는 괄호·제네릭의 `>`·
 * `void`)으로 끝나고 이 줄이 타입을 잇는 토큰으로 시작하지 않으면 새 문장이다.
 */
function endsTypeByLineBreak(tokens: readonly JsToken[], index: number): boolean {
  const token = tokens[index];
  const previous = tokens[index - 1];
  if (token === undefined || previous === undefined || token.line === previous.line) return false;
  const typeEnd = isOperandEnd(previous) || typeClosers.has(previous.text) || previous.text === 'void';
  return typeEnd && !typeContinuations.has(token.text);
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
  sourceIndex?: number,
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
    if (sourceIndex !== undefined) {
      context.destructuredSources.set(localName,
        { property: token.text, source: tokens[sourceIndex]!.text, sourceIndex });
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
  const isExpoModuleAlias = token.kind === 'identifier' &&
    !isShadowed(context, token.text, start) &&
    !context.unstableAliasNames.has(token.text) &&
    (context.importsByLocalName.get(token.text) ?? []).some((entry) =>
      moduleImportCalls.has(entry.exportedName) &&
      expoSpecifierPattern.test(entry.specifier));
  if (moduleImportCalls.has(token.text) || componentRequireCalls.has(token.text) ||
    isExpoModuleAlias) {
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

/** 타입 인수 구간을 찾을 때 읽는 토큰 수 상한이다. 넘으면 타입 인수로 보지 않는다(그 호출은 이탈로 센다). */
const TYPE_ARGUMENTS_TOKEN_LIMIT = 512;

/**
 * 안쪽 괄호 밖(타입 인수 깊이 0의 괄호 바깥)에 있으면 타입 인수일 수 없는 토큰이다 — 논리·대입·산술·비교 연산과
 * 문장 끝. `>>`·`>>>`는 이 판정에서 중첩 제네릭으로 읽지 않는다(이전 판정과 같은 결과를 유지한다).
 */
const typeArgumentStops = new Set([
  ';', '&&', '||', '??', '==', '===', '!=', '!==', '<=', '>=', '!', '+', '*', '/', '%', '**', '++', '--',
  '<<', '>>', '>>>', '?.', ...assignmentOperatorTexts(),
]);

/**
 * `<...>` 타입 인수 구간을 건너뛰어 닫는 `>`의 인덱스를 돌려준다. `nestedShifts`가 없으면 `>>`·`>>>`에서 멈춘다
 * (호출 사실 판정은 중첩 제네릭 인수를 읽지 않던 이전 결과를 유지한다).
 *
 * 비교 연산의 `<`(`M.x < 1 && M.y < 2`)를 타입 인수로 잘못 열면 짝 `>`를 찾아 파일 끝까지 훑어, `<`가 많은
 * 입력에서 이차 시간이 들었다. 타입 인수에 올 수 없는 토큰(안쪽 괄호 밖의 연산자·`;`, 짝 없는 닫는 괄호)이나
 * 상한에서 멈춘다. 타입 인수로 올 수 있는 구간의 판정은 바뀌지 않는다.
 */
export function skipTypeArguments(
  tokens: readonly JsToken[],
  start: number,
  nestedShifts = false,
): number | undefined {
  let depth = 0;
  const brackets: string[] = [];
  const limit = Math.min(tokens.length, start + TYPE_ARGUMENTS_TOKEN_LIMIT);
  for (let index = start; index < limit; index++) {
    const text = tokens[index]!.text;
    if (text === '<') depth++;
    else if (text === '>' || (nestedShifts && (text === '>>' || text === '>>>'))) {
      // `nestedShifts`면 한 토큰인 `>>`·`>>>`가 중첩 제네릭을 두세 단계 닫는다.
      depth -= text.length;
      if (depth === 0) return index;
      if (depth < 0) return undefined;
    } else if (depth === 0) {
      return undefined;
    } else if (bracketPairs.has(text)) {
      brackets.push(bracketPairs.get(text)!);
    } else if (text === ')' || text === ']' || text === '}') {
      if (brackets.pop() !== text) return undefined;
    } else if (brackets.length === 0 && typeArgumentStops.has(text)) {
      return undefined;
    }
  }
  return undefined;
}

/** 대입 연산자 원문이다. 선언 순서상 아래 범위 계수 절의 집합보다 먼저 쓰이므로 함수로 둔다. */
function assignmentOperatorTexts(): string[] {
  return ['=', '+=', '-=', '*=', '/=', '%=', '**=', '<<=', '>>=', '>>>=', '&=', '|=', '^=', '&&=', '||=', '??='];
}

/** 두 번째 순회: 브리지 API 호출·멤버 호출을 사실로 모은다. */
function collectCalls(context: ScanContext, importPositions: ReadonlySet<number>): void {
  const { tokens } = context;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (token.kind !== 'identifier') continue;
    const property = ['.', '?.'].includes(tokens[index - 1]?.text ?? '');
    // 속성 자리(`OBJ.NAME`)의 브리지 API 이름은 OBJ가 그 API를 내보내는 모듈일 때만 읽는다.
    if (property && propertyApiNames.has(token.text)) {
      index = collectPropertyApi(context, index);
      continue;
    }
    if (!property && (token.text === 'NativeModules' || nativeModulesAlias(context, token.text) ||
      context.destructuredSources.get(token.text)?.property === 'NativeModules')) {
      // 레지스트리를 가져오는 import 절·구조 분해의 이름은 값 사용이 아니고, react-native 출처가 아닌 같은 이름은
      // RN 레지스트리가 아니다(로컬 shim·다른 모듈·매개변수).
      if (importPositions.has(index) || isPatternDeclarator(tokens, index)) continue;
      if (isNativeModulesRegistry(context, token.text, index)) {
        index = collectNativeModulesAccess(context, index);
        continue;
      }
      // 다른 모듈에서 가져온 이름(배럴 재수출·대역)은 레지스트리로 단정하지 않는다. 그래도 조용히 버리지 않고 멤버
      // 접근을 세어 문서 한계로 낸다 — 빈 결과가 청정으로 읽히지 않게.
      if (importedFromOtherModule(context, token.text, index) &&
        ['.', '?.', '['].includes(tokens[index + 1]?.text ?? '')) {
        context.counts.untracedApiAccesses++;
      }
      continue;
    }
    if (token.text === 'TurboModuleRegistry') {
      const next = collectRegistryCall(context, index);
      // 조회 호출이 아닌 레지스트리 값(`const registry = TurboModuleRegistry`)은 스캔이 따라가지 않는다.
      if (next === index && !isNameOnlyPosition(context, index, importPositions)) {
        noteModuleValue(context, index, index);
      }
      index = next;
      continue;
    }
    // `function NAME(...)`·`function* NAME(...)`의 선언부는 호출이 아니다 —
    // 이름 기반 탐지가 선언 자리를 경계 호출로 오인하지 않게 뺀다.
    const declarationSite = tokens[index - 1]?.text === 'function' ||
      (tokens[index - 1]?.text === '*' &&
        tokens[index - 2]?.text === 'function');
    if (declarationSite) continue;
    if (moduleImportCalls.has(token.text)) {
      // 호출하지 않고 값으로 넘긴 조회 API(`const load = requireNativeModule`)의 결과는 스캔이 따라가지 않는다.
      if (!boundaryCallOpens(context, index)) {
        if (!isNameOnlyPosition(context, index, importPositions)) noteModuleValue(context, index, index);
        continue;
      }
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
    // 별칭은 로컬 import 이름이다 — 속성 자리(`obj.load`)의 같은 이름은 별칭이 아니다.
    const aliasedApi = property || isShadowed(context, token.text, index)
      ? undefined
      : boundaryAliasOf(context, token.text);
    if (aliasedApi !== undefined && boundaryCallOpens(context, index)) {
      index = collectBoundaryCall(
        context, index,
        moduleImportCalls.has(aliasedApi) ? 'module-import' : 'component-require',
        aliasedApi);
      continue;
    }
    // 별칭으로 가져온 조회 API를 값으로 넘기는 것도 같다. 멤버 호출 후보 수집은 그대로 이어 간다.
    if (aliasedApi !== undefined && moduleImportCalls.has(aliasedApi) && !property &&
      !isNameOnlyPosition(context, index, importPositions)) {
      noteModuleValue(context, index, index);
    }
    const next = tokens[index + 1];
    if (next?.text === '.' || next?.text === '?.' || next?.text === '[') {
      index = collectBoundMemberCall(context, index);
    }
  }
}

/**
 * 식별자가 react-native에서 다른 이름으로 가져온 `NativeModules`(`import { NativeModules as NM }`)인지 본다.
 */
function nativeModulesAlias(context: ScanContext, name: string): boolean {
  return (context.importsByLocalName.get(name) ?? []).some(({ specifier, exportedName }) =>
    specifier === 'react-native' && exportedName === 'NativeModules');
}

/**
 * 값 위치의 `NativeModules`(또는 별칭)가 react-native 레지스트리를 가리키는지 본다.
 *
 * 같은 이름의 매개변수가 가리면, 다른 모듈에서 가져왔으면, react-native가 아닌 값으로 선언했으면(테스트 shim 등)
 * 레지스트리가 아니다. 이 파일에 import도 선언도 없으면 기존처럼 전역 레지스트리로 읽는다. 스코프는 구분하지 않고
 * 파일 단위로 판정한다 — 로컬 선언이 하나라도 있으면 그 이름은 레지스트리로 읽지 않는다.
 */
function isNativeModulesRegistry(context: ScanContext, name: string, index: number): boolean {
  if (isShadowed(context, name, index)) return false;
  const imports = context.importsByLocalName.get(name) ?? [];
  if (imports.length > 0) return nativeModulesAlias(context, name);
  if (destructuredFromReactNative(context, name)) return true;
  if (name !== 'NativeModules') return false;
  if (context.localNames.has(name)) return context.requireSpecifiers.get(name) === 'react-native';
  return true;
}

/** 이름이 react-native가 아닌 모듈에서 가져온 import 바인딩인지 본다. 매개변수가 가리면 아니다. */
function importedFromOtherModule(context: ScanContext, name: string, index: number): boolean {
  if (isShadowed(context, name, index)) return false;
  const imports = context.importsByLocalName.get(name) ?? [];
  return imports.length > 0 && imports.every(({ specifier }) => specifier !== 'react-native');
}

/**
 * 로컬 이름이 react-native 모듈 객체에서 구조 분해한 `NativeModules`(`const { NativeModules: NM } = RN`)인지 본다.
 * 원천 식별자는 구조 분해 위치에서 판정한다.
 */
function destructuredFromReactNative(context: ScanContext, name: string): boolean {
  const origin = context.destructuredSources.get(name);
  return origin !== undefined && origin.property === 'NativeModules' &&
    isReactNativeNamespace(context, context.reactNativeNamespaces, origin.source, origin.sourceIndex);
}

/**
 * 식별자가 react-native 모듈 객체(`import * as RN`·`import RN`·`const RN = require('react-native')`)인지 본다.
 * 같은 이름의 매개변수가 가리면 아니다.
 */
function isReactNativeNamespace(
  context: ScanContext,
  namespaceImports: ReadonlySet<string>,
  name: string,
  index: number,
): boolean {
  if (isShadowed(context, name, index)) return false;
  if (namespaceImports.has(name)) return true;
  const imports = context.importsByLocalName.get(name) ?? [];
  if (imports.length > 0) {
    return imports.some(({ specifier, exportedName }) => specifier === 'react-native' && exportedName === 'default');
  }
  return context.requireSpecifiers.get(name) === 'react-native';
}

/**
 * 네임스페이스 import(`import * as NAME from 'spec'`·`import X, * as NAME from 'spec'`)의 이름 → specifier다.
 * 이 형태는 import 목록에 기록되지 않아 토큰으로 찾는다.
 */
function namespaceImportSpecifiers(tokens: readonly JsToken[]): Map<string, string> {
  const specifiers = new Map<string, string>();
  for (let index = 0; index < tokens.length; index++) {
    if (tokens[index]!.text !== 'import' || ['.', '?.'].includes(tokens[index - 1]?.text ?? '')) continue;
    const name = namespaceImportName(tokens, index);
    if (name === undefined) continue;
    // 이름 뒤는 `from 'spec'`이어야 한다 — 이름 위치는 namespaceImportName이 고정 위치에서 찾았다.
    const nameIndex = tokens[index + 1]?.text === '*' ? index + 3 : index + 5;
    const specifier = tokens[nameIndex + 2];
    if (tokens[nameIndex + 1]?.text === 'from' && specifier?.kind === 'string' && specifier.value !== undefined) {
      specifiers.set(name, specifier.value);
    }
  }
  return specifiers;
}

/** 토큰 열마다 한 번 만든 import 절 종결 표다(위치 → 그 위치부터 처음 만나는 문자열·절 밖 토큰). */
const importStopTables = new WeakMap<readonly JsToken[], Int32Array>();

/**
 * `import` 토큰(위치 `start`)이 정적 import 문이면 그 문의 마지막 토큰(specifier 문자열, `import X =
 * require('spec')`의 `)`) 위치를, 아니면 undefined를 돌려준다.
 *
 * 절에는 이름·키워드와 `{`·`}`·`,`·`*`만 올 수 있다. 문자열 전에 다른 토큰을 만나면 import 문이 아니다 —
 * `import.meta`·동적 `import(…)`·객체 키 `{ import: X }`·JSX 낱말을 문자열이 나올 때까지 import 문으로 읽으면
 * 그 사이 코드(NativeModules 접근 등)가 바인딩·사실 수집에서 빠졌다. 종결 위치는 뒤에서 한 번 계산한 표로
 * 찾아, import 낱말이 많은 입력에서도 문마다 다시 훑지 않는다.
 */
export function importStatementEnd(tokens: readonly JsToken[], start: number): number | undefined {
  if (tokens[start]?.text !== 'import' || ['.', '?.'].includes(tokens[start - 1]?.text ?? '') ||
    ['(', '.', ':'].includes(tokens[start + 1]?.text ?? '')) {
    return undefined;
  }
  if (tokens[start + 2]?.text === '=') {
    return readRequireSpecifier(tokens, start + 3) === undefined ? undefined : start + 6;
  }
  let table = importStopTables.get(tokens);
  if (table === undefined) {
    table = new Int32Array(tokens.length + 1).fill(-1);
    for (let index = tokens.length - 1; index >= 0; index--) {
      const token = tokens[index]!;
      const name = token.kind === 'identifier' || token.kind === 'keyword' || ['{', '}', ',', '*'].includes(token.text);
      table[index] = name && token.kind !== 'string' ? table[index + 1]! : index;
    }
    importStopTables.set(tokens, table);
  }
  const stop = table[start + 1] ?? -1;
  return stop !== -1 && tokens[stop]!.kind === 'string' ? stop : undefined;
}

/** 정적 `import … from '…'` 문(동적 `import(…)` 제외)과 재수출 절(`export { … } from`·`export * from`)이 차지한 토큰 위치다. */
function importStatementPositions(tokens: readonly JsToken[]): Set<number> {
  const positions = new Set<number>();
  for (let index = 0; index < tokens.length; index++) {
    if (['.', '?.'].includes(tokens[index - 1]?.text ?? '')) continue;
    let end: number | undefined;
    if (tokens[index]?.text === 'import') {
      end = importStatementEnd(tokens, index);
    } else if (tokens[index]?.text === 'export') {
      end = reexportClauseEnd(tokens, index);
    }
    if (end === undefined) continue;
    for (let cursor = index; cursor <= end; cursor++) positions.add(cursor);
    index = end;
  }
  return positions;
}

/**
 * `export { … } [from 'spec']`·`export * [as ns] from 'spec'` 절의 마지막 토큰 위치다. 그 밖의 export면 undefined다.
 *
 * 재수출 절의 이름(`export { NativeModules } from 'react-native'`)은 값 사용이 아니다. 세미콜론 없는
 * `export { a }` 뒤의 코드를 먹지 않도록 `{`의 짝과 `from` 문자열까지만 본다.
 */
function reexportClauseEnd(tokens: readonly JsToken[], index: number): number | undefined {
  const next = tokens[index + 1];
  if (next?.text === '{') {
    const close = findMatching(tokens, index + 1, '{', '}');
    if (close === undefined) return undefined;
    return tokens[close + 1]?.text === 'from' && tokens[close + 2]?.kind === 'string' ? close + 2 : close;
  }
  if (next?.text !== '*') return undefined;
  let end = index + 2;
  while (end < tokens.length && tokens[end]?.kind !== 'string' && tokens[end]?.text !== ';') end++;
  return end;
}

/** 선언 구조 분해 패턴이 감싸는 이름을 찾을 때 거슬러 오르는 토큰 수 상한이다. 긴 입력에서 이차 시간을 막는다. */
const MAX_PATTERN_LOOKBEHIND = 256;

/**
 * 토큰이 `const|let|var { … }` 선언 구조 분해 패턴 안의 이름인지 본다(`const { NativeModules } = require(…)`).
 *
 * 객체 리터럴의 단축 속성(`pass({ NativeModules })`)은 값 사용이라 선언 키워드가 앞에 없으면 패턴이 아니다.
 */
function isPatternDeclarator(tokens: readonly JsToken[], index: number): boolean {
  let depth = 0;
  for (let cursor = index - 1; cursor >= 0 && index - cursor <= MAX_PATTERN_LOOKBEHIND; cursor--) {
    const text = tokens[cursor]!.text;
    if (text === '}') depth++;
    else if (text === '{') {
      if (depth === 0) return ['const', 'let', 'var'].includes(tokens[cursor - 1]?.text ?? '');
      depth--;
    } else if (depth === 0 && [';', '(', ')', '=', '=>'].includes(text)) return false;
  }
  return false;
}

/** 속성 자리(`OBJ.NAME`)에서 읽는 브리지 API 이름이다. */
const propertyApiNames = new Set([
  'NativeModules', 'TurboModuleRegistry', ...moduleImportCalls, ...componentRequireCalls,
]);

/**
 * 속성 자리(`OBJ.NAME`)의 브리지 API 이름을 읽는다.
 *
 * OBJ가 그 API를 내보내는 모듈 객체일 때만 API로 읽는다 — Expo 조회 API(`requireNativeModule` 계열·
 * `requireNativeViewManager`)는 Expo 패키지, 나머지(`NativeModules`·`TurboModuleRegistry`·코어 컴포넌트 API)는
 * react-native. 그 밖의 객체(출처 모름·다른 모듈·매개변수)의 같은 이름은 API로 단정하지 않고 사실 없이 센다.
 */
function collectPropertyApi(context: ScanContext, index: number): number {
  const { tokens } = context;
  const name = tokens[index]!.text;
  const specifier = propertyBaseSpecifier(context, index);
  const traced = specifier !== undefined &&
    (expoApiCalls.has(name) ? expoSpecifierPattern.test(specifier) : specifier === 'react-native');
  // 속성 자리(`.` 뒤)는 선언·패턴·키 이름이 될 수 없다 — 이름 자리는 대입·증감 대상뿐이다.
  const after = tokens[index + 1]?.text ?? '';
  const valueUse = !assignmentOperators.has(after) && !['++', '--'].includes(after) &&
    !['++', '--'].includes(tokens[index - 3]?.text ?? '');
  if (!traced) {
    if (valueUse) context.counts.untracedApiAccesses++;
    return index;
  }
  if (name === 'NativeModules') return collectNativeModulesAccess(context, index);
  if (name === 'TurboModuleRegistry') {
    const next = collectRegistryCall(context, index);
    if (next === index && valueUse) noteModuleValue(context, index, index);
    return next;
  }
  const kind = moduleImportCalls.has(name) ? 'module-import' : 'component-require';
  if (!boundaryCallOpens(context, index)) {
    if (kind === 'module-import' && valueUse) noteModuleValue(context, index, index);
    return index;
  }
  return collectBoundaryCall(context, index, kind, name, true);
}

/**
 * 속성 자리 토큰 앞 객체가 가리키는 모듈의 specifier다. 객체가 식별자 하나(react-native 모듈 객체, 네임스페이스
 * import, `const X = require('spec')`, 네임스페이스 import 변환), 기본 import 변환 결과의 `X.default`, 인라인
 * `require('spec')`일 때만 알고, 그 밖(더 긴 체인, 다른 호출의 결과, 매개변수가 가린 이름)은 undefined다.
 */
function propertyBaseSpecifier(context: ScanContext, index: number): string | undefined {
  const { tokens } = context;
  const base = tokens[index - 2];
  const requireIsLocal = context.localNames.has('require');
  if (base?.text === ')') {
    const open = openingOf(tokens, index - 2);
    const callee = open === undefined ? undefined : open - 1;
    if (callee === undefined || tokens[callee]?.kind !== 'identifier' || tokens[callee]!.text !== 'require' ||
      ['.', '?.'].includes(tokens[callee - 1]?.text ?? '') || requireIsLocal ||
      isShadowed(context, 'require', callee)) {
      return undefined;
    }
    return readRequireSpecifier(tokens, callee);
  }
  // `X.default.NAME` — X가 기본 import 변환 결과면 `X.default`는 그 모듈의 기본 export다.
  if (base?.text === 'default' && ['.', '?.'].includes(tokens[index - 3]?.text ?? '')) {
    const object = tokens[index - 4];
    if (object?.kind !== 'identifier' || ['.', '?.'].includes(tokens[index - 5]?.text ?? '') ||
      isShadowed(context, object.text, index - 4) || requireIsLocal) {
      return undefined;
    }
    return context.interopDefaultModules.get(object.text);
  }
  if (base?.kind !== 'identifier' || ['.', '?.'].includes(tokens[index - 3]?.text ?? '') ||
    isShadowed(context, base.text, index - 2)) {
    return undefined;
  }
  if (isReactNativeNamespace(context, context.reactNativeNamespaces, base.text, index - 2)) return 'react-native';
  return context.namespaceImports.get(base.text) ??
    (requireIsLocal ? undefined : context.requireModules.get(base.text));
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
    if (name?.kind !== 'identifier' && name?.kind !== 'keyword') {
      // `NativeModules?.['X']`처럼 읽지 않는 접근도 레지스트리의 모듈을 꺼낸다 — 사실 없이 추적을 벗어난다.
      noteModuleValue(context, start, start);
      return start;
    }
    context.facts.push({
      kind: 'module-import',
      channel: name.text,
      dynamic: false,
      token: name,
    });
    noteModuleValue(context, start, start + 2);
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
    if (close === undefined) {
      // 식의 끝을 찾지 못하면 쓰임을 판정할 수 없다 — 추적한다고 단정하지 않는다.
      context.counts.escapedModuleReferences++;
      return arg.endIndex;
    }
    noteModuleValue(context, start, close);
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
  } else if (!context.destructuredRegistrySources.has(start)) {
    // 동적 사실로 세지 않은 레지스트리 값(`RN.NativeModules`, 이름별 바인딩을 만들지 못한 구조 분해 원천)은
    // 스캔이 따라가지 않는 곳으로 넘어간다. 동적 사실로 센 베어 접근은 dynamic-module-names가 이미 센다.
    noteModuleValue(context, start, start);
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
    ...(optionalRegistryMethods.has(method.text) ? { optional: true } : {}),
    dynamic,
    token: method,
  });
  const close = findMatching(tokens, open, '(', ')');
  if (close === undefined) {
    context.counts.escapedModuleReferences++;
    return arg.endIndex;
  }
  noteModuleValue(context, start, close);
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
  for (const entry of context.importsByLocalName.get(localName) ?? []) {
    if (moduleImportCalls.has(entry.exportedName) ||
      componentRequireCalls.has(entry.exportedName)) {
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
  viaModuleObject = false,
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
  // 그 API를 내보내는 모듈 객체를 거친 호출(`Core.requireNativeModule`)은 해석 경로가 객체로 정해진다.
  const mechanism = viaModuleObject
    ? (expoApiCalls.has(apiName) ? 'expo' : undefined)
    : mechanismOf(context, apiName, tokens[start]!.text, start);
  context.facts.push({
    kind,
    channel: boundChannel(bound),
    ...(mechanism === undefined ? {} : { mechanism }),
    ...(optionalModuleCalls.has(apiName) ? { optional: true } : {}),
    dynamic,
    token: tokens[start]!,
  });
  if (kind !== 'module-import') return arg.endIndex;
  const close = findMatching(tokens, open, '(', ')');
  if (close === undefined) {
    context.counts.escapedModuleReferences++;
    return arg.endIndex;
  }
  noteModuleValue(context, start, close);
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
  const specifiers = (context.importsByLocalName.get(localName) ?? [])
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
 * 로컬 바인딩이나 import 바인딩이 없는 식별자는 모듈 근거가 없어 건너뛴다. 속성 자리(`obj.M`)의
 * 이름은 바인딩 M이 아니다.
 *
 * `.` 뒤의 멤버 이름은 건너뛰지 않고 다음 순회가 읽게 한다 — 건너뛰면 `a.b.c` 체인의 이름이 링크 수의 홀짝에
 * 따라 읽히거나 빠져, 속성 자리의 브리지 API 판정이 체인 길이에 좌우된다.
 */
function collectBoundMemberCall(context: ScanContext, start: number): number {
  const { tokens } = context;
  const token = tokens[start]!;
  const bound = !['.', '?.'].includes(tokens[start - 1]?.text ?? '') &&
    !isShadowed(context, token.text, start) &&
    (context.bindings.has(token.text) ||
      context.importsByLocalName.has(token.text));
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
    // 브리지 API 이름 멤버(`RN.requireNativeComponent(…)`)는 속성 자리 판정이 사실로 읽거나 출처 모름으로 센다 —
    // 패키지 멤버 호출 후보로 또 남기면 같은 호출을 두 한계에 겹쳐 센다.
    if (bound && isCallAt(tokens, start + 3) && !propertyApiNames.has(method.text)) {
      context.memberCalls.push({
        ident: token.text,
        method: method.text,
        dynamicMethod: false,
        token: method,
      });
    }
    return start + 1;
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
        // 매개변수 자신의 위치부터 가린다 — 그 이름 토큰은 바깥 바인딩의 값 사용이 아니다.
        shadows.push({
          from: index,
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
    const names = parameterBindingNames(tokens, index, close);
    // 매개변수 목록부터 가린다 — 매개변수 이름 토큰과 뒤 매개변수의 기본값 식은 바깥 바인딩을 보지 않는다.
    shadows.push({ from: index, to: bodyClose + 1, names });
    index = close;
  }
  return shadows;
}

/**
 * 매개변수 목록 `(`…`)`이 묶는 이름이다.
 *
 * 기본값 식(`=` 뒤부터 같은 괄호 깊이의 `,`나 그 깊이를 닫는 괄호까지)의 식별자는 매개변수 이름이 아니다 —
 * `(native = NativeModules.Camera)`의 `NativeModules`는 바깥 바인딩을 읽는다. 구조 분해 패턴의 속성 이름과 타입
 * 주석은 구분하지 않고 이름으로 센다(가림을 넓게 잡는 쪽).
 */
function parameterBindingNames(tokens: readonly JsToken[], open: number, close: number): Set<string> {
  const names = new Set<string>();
  let depth = 0;
  // 기본값 식을 연 깊이다. 그 깊이의 `,`나 그 깊이를 닫는 괄호에서 기본값이 끝난다.
  let defaultDepth: number | undefined;
  for (let cursor = open + 1; cursor < close; cursor++) {
    const token = tokens[cursor]!;
    if (token.text === '(' || token.text === '[' || token.text === '{') {
      depth++;
      continue;
    }
    if (token.text === ')' || token.text === ']' || token.text === '}') {
      if (defaultDepth === depth) defaultDepth = undefined;
      depth--;
      continue;
    }
    if (defaultDepth !== undefined) {
      if (token.text === ',' && depth === defaultDepth) defaultDepth = undefined;
      continue;
    }
    if (token.text === '=') {
      defaultDepth = depth;
      continue;
    }
    if (token.kind === 'identifier' || token.kind === 'keyword') names.add(token.text);
  }
  return names;
}

/** 위치 `index`의 `name`이 매개변수에 가려졌는지 판정한다. */
function isShadowed(
  context: ScanContext,
  name: string,
  index: number,
): boolean {
  return context.paramShadows.has(name, index);
}

// ── 범위 밖 바인딩 계수(js-binding-scope) ──────────────────────────────────────
//
// 스캔은 모듈 값을 같은 파일의 선언·상대 import·export까지만 따라간다. 그 밖의 바인딩(함수 결과, 인스턴스
// 상태, 인자, 재대입·구조 분해한 이름, 다른 값의 속성)으로 넘어간 값 위의 멤버 호출은 귀속되지 않는다.
// 아래 판정은 인식한 모듈 값의 쓰임을 허용 목록으로 분류한다 — 귀속 호출·추적 바인딩·export·원시값 소비가
// 아니면 추적을 벗어난 것으로 센다. 판정할 수 없는 위치도 벗어난 것으로 센다(과소 계수보다 과다 계수 쪽).

/** 모듈 값 한 번의 쓰임이다. */
type ModuleValueUse = 'call' | 'tracked' | 'consumed' | 'escape';

/** 대입 연산자다. 뒤에 오면 앞 식은 대입 대상이고, 괄호 안 깊이 0에 있으면 값이 다른 바인딩으로 넘어간다. */
const assignmentOperators = new Set(assignmentOperatorTexts());

/** 앞에 오면 값을 원시값으로 바꿔 소비하는 연산자다. `!`는 단항일 때만이다(피연산자 뒤면 TS non-null). */
const consumingPrefixes = new Set(['!', 'typeof', 'void', 'delete', 'in', '==', '===', '!=', '!==']);

/**
 * 뒤에 오면 값을 소비하는 연산자다. `&&`의 왼쪽은 거짓 값일 때만 결과로 넘어가고 거짓 값은 모듈 객체가
 * 아니다. `?`는 삼항의 검사 위치다. 대입 연산자 앞의 식은 값이 아니라 대입 대상이다.
 */
const consumingSuffixes = new Set(['==', '===', '!=', '!==', '&&', '?', 'instanceof', ...assignmentOperators]);

/** 괄호 깊이 0에 있으면 피연산자 값이 괄호 결과가 아닌 다른 곳(대입 대상·함수 본문·생성기 밖)으로 가는 토큰이다. */
const divertingTokens = new Set([...assignmentOperators, '=>', 'yield']);

/**
 * 뒤에 `(`가 와도 호출이 아닌 키워드다(조건·연산·선언). 그 밖의 키워드(`get`·`from`·`async` 같은 문맥
 * 키워드, 동적 `import`)는 호출 대상일 수 있어 호출로 본다.
 */
const nonCallKeywords = new Set([
  'if', 'while', 'for', 'switch', 'catch', 'with', 'return', 'typeof', 'void', 'delete', 'await', 'yield',
  'in', 'of', 'instanceof', 'new', 'case', 'throw', 'else', 'do', 'function', 'class', 'extends', 'export',
  'default', 'const', 'let', 'var', 'try', 'finally', 'break', 'continue', 'debugger',
]);


/** 같은 모듈을 가리키는 바인딩 값인지 본다. */
function sameBoundName(left: BoundName | undefined, right: BoundName): boolean {
  if (left === undefined) return false;
  if ('name' in left) return 'name' in right && left.name === right.name;
  return 'dynamicExpression' in right && left.dynamicExpression === right.dynamicExpression;
}

/** 인식한 모듈 식의 쓰임을 분류해 추적을 벗어나면 센다. `anchor`는 식의 첫 인식 토큰, `end`는 식의 끝이다. */
function noteModuleValue(context: ScanContext, anchor: number, end: number): void {
  const start = chainStart(context.tokens, anchor);
  if (start === undefined || classifyModuleValue(context, start, end, false) === 'escape') {
    context.counts.escapedModuleReferences++;
  }
}

/**
 * 모듈 값이 `start`..`end` 구간에 쓰인 방식을 분류한다.
 *
 * 멤버 호출은 스캐너가 귀속하는 형태와 같게 본다 — `bracketCall`은 식 바로 뒤의 `[k](…)`를 귀속하는지
 * (바인딩 식별자는 귀속하고, `NativeModules.X` 같은 모듈 식은 귀속하지 않는다)를 나타낸다. 호출 없는 멤버
 * 읽기는 메서드 값인지 상수인지 구분하지 않고, 원시값으로 소비되지 않으면 추적을 벗어난 것으로 센다.
 */
function classifyModuleValue(
  context: ScanContext,
  start: number,
  end: number,
  bracketCall: boolean,
): ModuleValueUse {
  const { tokens } = context;
  const after = tokens[end + 1]?.text;
  if (after === '.' || after === '?.') {
    const member = tokens[end + 2];
    if (member?.kind === 'identifier' || member?.kind === 'keyword') {
      if (isCallAt(tokens, end + 3)) return 'call';
      return isValueConsumed(context, start, end + 2) ? 'consumed' : 'escape';
    }
    if (after === '?.' && member?.text === '[') {
      return classifyBracketMember(context, start, end + 2, true);
    }
    return 'escape';
  }
  if (after === '[') return classifyBracketMember(context, start, end + 1, bracketCall);
  if (context.trackedValueStarts.has(start)) return 'tracked';
  return isValueConsumed(context, start, end) ? 'consumed' : 'escape';
}

/**
 * 위치 `start`에서 호출·색인 인자가 시작하는지 본다 — `readArgument(…) !== undefined`와 같은 판정을 상수 시간에
 * 한다. readArgument는 인자 전체를 훑고 원문을 잘라 정리하므로, 중첩된 `M[M[…]]`의 이름마다 부르면 이차 시간이
 * 든다.
 */
function hasArgument(tokens: readonly JsToken[], start: number): boolean {
  const token = tokens[start];
  return token !== undefined && ![')', ',', ']', '}'].includes(token.text);
}

/** `value[k]` 접근(여는 `[` 위치 `open`)을 호출·소비·이탈로 분류한다. */
function classifyBracketMember(
  context: ScanContext,
  start: number,
  open: number,
  callAttributed: boolean,
): ModuleValueUse {
  const close = findMatching(context.tokens, open, '[', ']');
  if (close === undefined) return 'escape';
  if (isCallAt(context.tokens, close + 1)) {
    return callAttributed && hasArgument(context.tokens, open + 1) ? 'call' : 'escape';
  }
  return isValueConsumed(context, start, close) ? 'consumed' : 'escape';
}

/**
 * `start`..`end` 식의 값이 원시값으로 소비되는지 본다.
 *
 * 앞뒤 연산자로 바로 정해지지 않으면 감싼 괄호 그룹으로 올라간다. 그룹 깊이 0에 대입·화살표·yield가 없으면
 * 피연산자 값은 소비되거나 그룹 결과로만 가므로, 그룹이 if/while 조건이거나 그룹 자체가 소비되면 소비다.
 * 호출 괄호의 인자는 소비가 아니다. 재귀 대신 반복으로 올라가고 그룹별 결과를 기억해 깊은 중첩에서도
 * 스택을 쓰지 않고 그룹마다 한 번만 판정한다.
 */
function isValueConsumed(context: ScanContext, start: number, end: number): boolean {
  const { tokens } = context;
  const visited: number[] = [];
  let currentStart = start;
  let currentEnd = end;
  let consumed: boolean;
  for (;;) {
    // 뒤에 멤버 접근·호출·non-null이 이어지면 값은 객체·호출 대상으로 쓰인다 — 그 위의 호출은 귀속되지 않는다.
    if (continuesAsOperand(tokens, currentEnd)) {
      consumed = false;
      break;
    }
    if (isDirectlyConsumed(tokens, currentStart, currentEnd)) {
      consumed = true;
      break;
    }
    const open = enclosingOpen(tokens, currentStart);
    const close = open === undefined || tokens[open]!.text !== '('
      ? undefined
      : findMatching(tokens, open, '(', ')');
    if (open === undefined || close === undefined || close <= currentEnd ||
      groupDiverts(context, open, close) || isCallParen(tokens, open)) {
      consumed = false;
      break;
    }
    if (isConditionGroup(tokens, open)) {
      consumed = true;
      break;
    }
    const known = context.consumedGroups.get(open);
    if (known !== undefined) {
      consumed = known;
      break;
    }
    visited.push(open);
    currentStart = open;
    currentEnd = close;
  }
  for (const open of visited) context.consumedGroups.set(open, consumed);
  return consumed;
}

/**
 * `start`..`end` 식이 문장 하나 전체인지(값을 버리는 식 문장, `requireNativeModule('Y');`) 본다. 문장 시작은 파일
 * 처음·`;`·`}`·블록을 여는 `{` 뒤이거나 ASI로 앞 줄이 끝난 자리, 끝은 `;`·`}`·파일 끝이거나 식을 잇지 않는 줄바꿈이다.
 * 객체 리터럴의 `{`(`= { M }`)는 블록이 아니다.
 */
function isDiscardedStatement(tokens: readonly JsToken[], start: number, end: number): boolean {
  const before = tokens[start - 1];
  const after = tokens[end + 1];
  const startsStatement = before === undefined || before.text === ';' || before.text === '}' ||
    (before.text === '{' && opensBlock(tokens, start - 1)) ||
    (before.line < tokens[start]!.line && (isOperandEnd(before) || ['++', '--'].includes(before.text)));
  const endsStatement = after === undefined || after.text === ';' || after.text === '}' ||
    (after.line > tokens[end]!.line && !expressionContinuations.has(after.text));
  return startsStatement && endsStatement;
}

/** 위치 `open`의 `{`가 블록(함수·제어문 본문, 블록 문)을 여는지 본다. 앞 토큰으로만 판정한다. */
function opensBlock(tokens: readonly JsToken[], open: number): boolean {
  const before = tokens[open - 1];
  return before === undefined || [')', ';', '{', '}', '=>', 'else', 'do', 'try', 'finally'].includes(before.text);
}

/** `end` 뒤에 멤버 접근·호출·TS non-null·태그 템플릿이 이어져 식이 더 큰 피연산자의 일부인지 본다. */
function continuesAsOperand(tokens: readonly JsToken[], end: number): boolean {
  const after = tokens[end + 1];
  return after !== undefined &&
    (['.', '?.', '[', '(', '!'].includes(after.text) || after.kind === 'template');
}

/** 앞뒤 연산자만으로 값이 소비되는지 본다. 문장 단독으로 버려지는 값도 어디로도 넘어가지 않는다. */
function isDirectlyConsumed(tokens: readonly JsToken[], start: number, end: number): boolean {
  if (isDiscardedStatement(tokens, start, end)) return true;
  const before = tokens[start - 1];
  if (before !== undefined && consumingPrefixes.has(before.text) &&
    (before.text !== '!' || !isOperandEnd(tokens[start - 2]))) {
    return true;
  }
  return consumingSuffixes.has(tokens[end + 1]?.text ?? '');
}

/** 괄호 그룹 깊이 0에 값을 다른 곳으로 넘기는 토큰이 있는지 본다. 짝 없는 안쪽 괄호도 넘기는 것으로 본다. */
function groupDiverts(context: ScanContext, open: number, close: number): boolean {
  const known = context.divertingGroups.get(open);
  if (known !== undefined) return known;
  const { tokens } = context;
  let diverts = false;
  for (let cursor = open + 1; cursor < close; cursor++) {
    const text = tokens[cursor]!.text;
    if (text === '(' || text === '[' || text === '{') {
      const inner = findMatching(tokens, cursor, text, bracketPairs.get(text)!);
      if (inner === undefined || inner >= close) {
        diverts = true;
        break;
      }
      cursor = inner;
      continue;
    }
    if (divertingTokens.has(text)) {
      diverts = true;
      break;
    }
  }
  context.divertingGroups.set(open, diverts);
  return diverts;
}

/** 여는 `(`가 호출 인자 목록인지 본다. 판정이 애매한 `>`(제네릭 호출)·`}`도 호출로 본다(소비로 단정하지 않는다). */
function isCallParen(tokens: readonly JsToken[], open: number): boolean {
  const before = tokens[open - 1];
  if (before === undefined) return false;
  if (before.kind === 'keyword') {
    return !nonCallKeywords.has(before.text) || ['.', '?.'].includes(tokens[open - 2]?.text ?? '');
  }
  return isOperandEnd(before) || ['>', '?.', '}'].includes(before.text);
}

/** 여는 `(`가 `if`·`while` 조건 괄호인지 본다. */
function isConditionGroup(tokens: readonly JsToken[], open: number): boolean {
  const before = tokens[open - 1];
  return before?.kind === 'keyword' && (before.text === 'if' || before.text === 'while') &&
    !['.', '?.'].includes(tokens[open - 2]?.text ?? '');
}

/** 피연산자의 끝이 될 수 있는 토큰인지 본다 — 뒤의 `(`는 호출, `!`는 TS non-null이다. */
function isOperandEnd(token: JsToken | undefined): boolean {
  if (token === undefined) return false;
  return token.kind === 'identifier' || token.kind === 'number' || token.kind === 'string' ||
    token.kind === 'template' || token.text === ')' || token.text === ']';
}

/**
 * 인식한 모듈 식의 첫 토큰 위치다(앞뒤 문맥 판정은 식 전체를 기준으로 한다). 속성 자리 식은 앞 객체부터
 * 시작한다 — collectPropertyApi는 객체가 식별자 하나, 기본 import 변환의 `X.default`, 인라인 `require('spec')`일
 * 때만 API로 읽으므로 그 세 형태만 거슬러 오르면 된다. 짝을 찾지 못하면 undefined다.
 */
function chainStart(tokens: readonly JsToken[], index: number): number | undefined {
  if (!['.', '?.'].includes(tokens[index - 1]?.text ?? '')) return index;
  // `X.default.NAME`(기본 import 변환 결과)은 X부터 시작한다.
  if (tokens[index - 2]?.text === 'default' && ['.', '?.'].includes(tokens[index - 3]?.text ?? '')) return index - 4;
  if (tokens[index - 2]?.text !== ')') return index - 2;
  const open = openingOf(tokens, index - 2);
  return open === undefined ? undefined : open - 1;
}

/**
 * 식별자가 값이 아니라 이름 자리에 있는지 본다 — import·재수출 절, 선언자·함수·클래스 이름, 구조 분해 선언
 * 패턴, 객체 키, 대입 대상, 식 본문 화살표의 매개변수. 속성 자리(`.` 뒤)는 호출자가 따로 판정한다.
 */
function isNameOnlyPosition(
  context: ScanContext,
  index: number,
  importPositions: ReadonlySet<number>,
): boolean {
  const { tokens } = context;
  const before = tokens[index - 1]?.text ?? '';
  const after = tokens[index + 1]?.text ?? '';
  if (importPositions.has(index) || context.declaratorNames.has(index)) return true;
  if (['const', 'let', 'var', 'function', 'class'].includes(before) ||
    (before === '*' && tokens[index - 2]?.text === 'function')) {
    return true;
  }
  if (assignmentOperators.has(after) || ['++', '--'].includes(after) || ['++', '--'].includes(before)) return true;
  if (after === ':' && (before === '{' || before === ',')) return true;
  if (after === '=>' || isArrowParameter(tokens, index)) return true;
  return isPatternDeclarator(tokens, index);
}

/** `(a, M) => …`처럼 화살표 매개변수 목록의 이름 자리인지 본다. 기본값 식(`= …` 뒤)은 값이다. */
function isArrowParameter(tokens: readonly JsToken[], index: number): boolean {
  if (!['(', ',', '...'].includes(tokens[index - 1]?.text ?? '') ||
    ![',', ')', '=', ':', '?'].includes(tokens[index + 1]?.text ?? '')) {
    return false;
  }
  const open = enclosingOpen(tokens, index);
  if (open === undefined || tokens[open]!.text !== '(') return false;
  const close = findMatching(tokens, open, '(', ')');
  return close !== undefined && tokens[close + 1]?.text === '=>';
}

/**
 * 바인딩·상대 import 이름의 값 사용을 분류해 추적을 벗어난 횟수를 이름별로 센다.
 *
 * 패키지 import는 스캔 집합 안에서 해석될 수 없어 후보가 아니다(문서 단계가 출처 모름으로 센다).
 */
function collectIdentifierEscapes(context: ScanContext, importPositions: ReadonlySet<number>): void {
  const { tokens } = context;
  const candidates = new Set(context.bindings.keys());
  for (const entry of context.imports) {
    if (entry.specifier.startsWith('.')) candidates.add(entry.localName);
  }
  if (candidates.size === 0) return;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (token.kind !== 'identifier' || !candidates.has(token.text)) continue;
    if (['.', '?.'].includes(tokens[index - 1]?.text ?? '')) continue;
    if (isShadowed(context, token.text, index) || isNameOnlyPosition(context, index, importPositions)) continue;
    if (classifyModuleValue(context, index, index, true) === 'escape') {
      context.identifierEscapes.set(token.text, (context.identifierEscapes.get(token.text) ?? 0) + 1);
    }
  }
}

/** 보간(`${…}`) 뒤에 브리지 API 이름이 나오는 템플릿 원문이다. 보간 본문과 뒤 리터럴을 가르지 않는다(넓게 센다). */
const bridgeApiInInterpolation =
  /\$\{[\s\S]*\b(?:NativeModules|TurboModuleRegistry|requireNativeModule|requireOptionalNativeModule|requireNativeViewManager|requireNativeComponent|codegenNativeComponent)\b/u;

/**
 * 출처를 스캔이 따라가지 못하는 값의 입구를 센다 — 네임스페이스 import, 값을 쓰는 `require()` 호출,
 * 동적 `import()` 호출, 문자열에 닿지 못한 `import` 낱말, 브리지 API를 언급하는 템플릿 보간. 이 값·코드가
 * 네이티브 모듈을 담는지는 토큰 스캔으로 알 수 없다.
 */
function countUntracedEntries(context: ScanContext, importPositions: ReadonlySet<number>): void {
  const { tokens } = context;
  const requireIsLocal = context.localNames.has('require');
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (['.', '?.'].includes(tokens[index - 1]?.text ?? '')) continue;
    if (token.kind === 'template' && token.value === undefined && bridgeApiInInterpolation.test(token.text)) {
      // 템플릿 보간은 토큰으로 나누지 않아 읽지 않는다 — 브리지 API를 언급하면 놓친 참조가 있을 수 있다.
      context.counts.untracedBindings++;
      continue;
    }
    if (token.kind === 'keyword' && token.text === 'import') {
      if (tokens[index + 1]?.text === '(') {
        context.counts.untracedBindings++;
        continue;
      }
      // 문자열에 닿지 못한 `import`(JSX 낱말, 깨진 문)는 무엇인지 알 수 없다 — import.meta·객체 키가 아니면 센다.
      if (!['.', ':'].includes(tokens[index + 1]?.text ?? '') && importStatementEnd(tokens, index) === undefined) {
        context.counts.untracedBindings++;
        continue;
      }
      // 네임스페이스 이름은 import 목록에 없어 여기서 센다. `import X, * as NS`의 X는 목록에 있어 문서 단계가 센다.
      if (namespaceImportName(tokens, index) !== undefined) context.counts.untracedBindings++;
      continue;
    }
    if (token.kind === 'identifier' && token.text === 'require' && tokens[index + 1]?.text === '(' &&
      !requireIsLocal && !importPositions.has(index) && !isShadowed(context, 'require', index)) {
      context.counts.untracedBindings += requireEntryCount(tokens, index);
    }
  }
}

/**
 * `import * as NS`·`import X, * as NS`의 네임스페이스 이름 NS다. 네임스페이스 절은 이 두 자리에만 올 수 있어
 * 고정 위치만 본다 — `import` 토큰마다 앞으로 훑으면 `import.meta`가 많은 입력에서 이차 시간이 든다. 타입 전용
 * import(`import type * as T`)는 값이 아니다.
 */
function namespaceImportName(tokens: readonly JsToken[], index: number): string | undefined {
  const star = tokens[index + 1]?.text === '*'
    ? index + 1
    : tokens[index + 2]?.text === ',' && tokens[index + 3]?.text === '*' ? index + 3 : undefined;
  if (star === undefined || tokens[star + 1]?.text !== 'as') return undefined;
  const name = tokens[star + 2];
  return name?.kind === 'identifier' || name?.kind === 'keyword' ? name.text : undefined;
}

/**
 * `require(…)` 호출 하나가 출처 모를 값을 들이는지(1) 아닌지(0)다.
 *
 * 문장 단독 호출(부작용 전용), `require('…').NativeModules` 레지스트리 접근, 스캔이 이름으로 읽는 API만
 * 구조 분해한 호출은 값의 출처를 안다. 그 밖은 결과가 스캔이 따라가지 않는 값이다.
 */
function requireEntryCount(tokens: readonly JsToken[], index: number): number {
  const close = findMatching(tokens, index + 1, '(', ')');
  if (close === undefined) return 1;
  const after = tokens[close + 1]?.text;
  if ((after === '.' || after === '?.') && tokens[close + 2]?.text === 'NativeModules') return 0;
  const before = tokens[index - 1];
  // 문장 시작 — 문장 경계 토큰 뒤이거나, 앞 줄이 피연산자로 끝나 ASI가 문장을 나눈 자리다.
  const statementStart = before === undefined || [';', '{', '}'].includes(before.text) ||
    (before.line < tokens[index]!.line && isOperandEnd(before));
  if (statementStart && endsExpression(tokens, close)) return 0;
  if (before?.text === '=' && tokens[index - 2]?.text === '}') {
    const open = openingOf(tokens, index - 2);
    if (open !== undefined &&
      destructuresOnlyScannedApis(tokens, open, index - 2, readRequireSpecifier(tokens, index))) {
      return 0;
    }
  }
  return 1;
}

/**
 * `{ … }` 구조 분해 패턴의 이름이 모두 스캔이 이름 그대로 읽는 API인지 본다. 별칭·기본값·중첩·나머지
 * 패턴이 있으면 아니다 — CJS 구조 분해의 별칭은 스캔이 API로 읽지 않는다.
 */
function destructuresOnlyScannedApis(
  tokens: readonly JsToken[],
  open: number,
  close: number,
  specifier: string | undefined,
): boolean {
  let names = 0;
  for (let cursor = open + 1; cursor < close; cursor++) {
    const token = tokens[cursor]!;
    if (token.text === ',') continue;
    if (token.kind !== 'identifier' && token.kind !== 'keyword') return false;
    if (tokens[cursor + 1]?.text !== ',' && cursor + 1 !== close) return false;
    if (!isScannedApiName(token.text, token.text, specifier)) return false;
    names++;
  }
  return names > 0;
}

/**
 * import·require로 들인 이름을 스캔이 이름 그대로 읽는 API인지 본다 — 조회·컴포넌트 API(별칭 포함, 출처
 * 무관), 이름으로 읽는 `TurboModuleRegistry`, react-native의 `NativeModules`(별칭 포함).
 */
function isScannedApiName(localName: string, exportedName: string, specifier: string | undefined): boolean {
  return moduleImportCalls.has(exportedName) || componentRequireCalls.has(exportedName) ||
    moduleImportCalls.has(localName) || componentRequireCalls.has(localName) ||
    localName === 'TurboModuleRegistry' ||
    (exportedName === 'NativeModules' && specifier === 'react-native');
}

/**
 * import 바인딩이 스캔이 이름으로 읽는 API인지 본다. 해석되지 않아도 출처를 아는 값이라 범위 밖 바인딩
 * 하한 근거로 세지 않는다.
 */
export function isScannedApiImport(entry: ScannedImport): boolean {
  return isScannedApiName(entry.localName, entry.exportedName, entry.specifier);
}

/** 토큰 열마다 한 번 만든 감싼 괄호 표다(위치 → 가장 안쪽 여는 괄호, 없으면 -1). */
const enclosingTables = new WeakMap<readonly JsToken[], Int32Array>();

/** 토큰 열마다 한 번 만든 닫는 괄호 → 여는 괄호 표다(짝이 없으면 -1). */
const openingTables = new WeakMap<readonly JsToken[], Int32Array>();

/**
 * 위치 `index`를 감싼 가장 안쪽 여는 괄호 위치다. 짝 표로 한 번에 만든다 — 위치마다 거슬러 오르면 긴
 * 괄호 그룹 안의 참조가 많은 입력에서 이차 시간이 든다. 짝 없는 여는 괄호는 감싸는 것으로 보지 않는다.
 */
function enclosingOpen(tokens: readonly JsToken[], index: number): number | undefined {
  let table = enclosingTables.get(tokens);
  if (table === undefined) {
    const matches = matchingTable(tokens);
    table = new Int32Array(tokens.length).fill(-1);
    const stack: number[] = [];
    for (let cursor = 0; cursor < tokens.length; cursor++) {
      while (stack.length > 0 && matches[stack.at(-1)!]! < cursor) stack.pop();
      table[cursor] = stack.at(-1) ?? -1;
      if (bracketPairs.has(tokens[cursor]!.text) && matches[cursor]! !== -1) stack.push(cursor);
    }
    enclosingTables.set(tokens, table);
  }
  const open = table[index] ?? -1;
  return open === -1 ? undefined : open;
}

/** 닫는 괄호 위치 `close`의 여는 괄호 위치다. */
function openingOf(tokens: readonly JsToken[], close: number): number | undefined {
  let table = openingTables.get(tokens);
  if (table === undefined) {
    const matches = matchingTable(tokens);
    table = new Int32Array(tokens.length).fill(-1);
    for (let open = 0; open < tokens.length; open++) {
      const match = matches[open]!;
      if (match !== -1) table[match] = open;
    }
    openingTables.set(tokens, table);
  }
  const open = table[close] ?? -1;
  return open === -1 ? undefined : open;
}

/** 짝 표로 답하는 괄호 종류다 — 여는 텍스트 → 닫는 텍스트. */
const bracketPairs: ReadonlyMap<string, string> = new Map([['(', ')'], ['[', ']'], ['{', '}']]);

/** 토큰 열마다 한 번 만든 괄호 짝 표다(여는 위치 → 닫는 위치, 짝이 없으면 -1). */
const matchingTables = new WeakMap<readonly JsToken[], Int32Array>();

/**
 * 토큰 열의 괄호 짝 표를 한 번만 만든다.
 *
 * 종류별 스택이 같은 종류의 괄호만 세므로, 여는 위치에서 같은 종류만 세어 깊이가
 * 0이 되는 첫 닫는 괄호를 찾는 선형 탐색과 짝이 같다. 짝 없는 닫는 괄호는 무시한다.
 */
function matchingTable(tokens: readonly JsToken[]): Int32Array {
  let table = matchingTables.get(tokens);
  if (table === undefined) {
    table = new Int32Array(tokens.length).fill(-1);
    // 여는 텍스트와 그 닫는 텍스트가 같은 스택을 가리킨다.
    const parentheses: number[] = [];
    const brackets: number[] = [];
    const braces: number[] = [];
    const opens = new Map([['(', parentheses], ['[', brackets], ['{', braces]]);
    const closes = new Map([[')', parentheses], [']', brackets], ['}', braces]]);
    for (let index = 0; index < tokens.length; index++) {
      const text = tokens[index]!.text;
      const stack = opens.get(text);
      if (stack !== undefined) {
        stack.push(index);
        continue;
      }
      const open = closes.get(text)?.pop();
      if (open !== undefined) table[open] = index;
    }
    matchingTables.set(tokens, table);
  }
  return table;
}

/**
 * 짝 맞는 괄호 토큰을 찾는다.
 *
 * `open`이 `(`·`[`·`{` 토큰이면 토큰 열마다 한 번 만든 짝 표를 조회한다 — 여는
 * 괄호마다 끝까지 훑으면 닫히지 않은 괄호가 많은 파일에서 이차 시간이 든다. 그 밖의
 * 짝이나 시작점은 `open`부터 같은 종류만 세는 선형 탐색이다.
 */
export function findMatching(
  tokens: readonly JsToken[],
  open: number,
  openText: string,
  closeText: string,
): number | undefined {
  if (tokens[open]?.text === openText && bracketPairs.get(openText) === closeText) {
    const close = matchingTable(tokens)[open]!;
    return close === -1 ? undefined : close;
  }
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
