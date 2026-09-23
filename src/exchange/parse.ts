/** bridge-facts 생산 플랫폼이다. */
export type BridgePlatform = 'dart' | 'swift' | 'kotlin' | 'js' | 'go';

/** 언어 경계를 잇는 메커니즘이다. */
export type BridgeTarget = 'flutter' | 'react-native' | 'capacitor';

/**
 * 같은 target 안에서 사실이 통과하는 구체적인 해석 경로다.
 *
 * `react-native` 문서 안에서 코어 RN 경로와 Expo Modules 경로가 공존한다.
 * 생략된 사실은 `core`로 읽는다 — v1 이전 문서가 모두 코어 RN만 기술했기
 * 때문이다. 이 필드는 이름 경계 사실 네 종류에만 허용된다.
 */
export type BridgeMechanism = 'core' | 'expo';

/** Swift 플랫폼 문서에 실린 Objective-C 구현을 Swift 보존 대상과 구분한다. */
export type BridgeSourceLanguage = 'objective-c';

/** 특정 한계 전체의 영향을 포함하는 채널 집합. 일부 발견 목록이 아니다. */
export interface BridgeLimitationScope {
  readonly limitationIndex: number;
  readonly channels: readonly string[];
}

/** 확장 메타데이터가 입력 자원 상한을 우회하지 못하게 한다. */
export const MAX_LIMITATION_SCOPES = 1_000;
export const MAX_SCOPED_CHANNELS = 10_000;

/** 교환 형식의 사실 종류다. */
export type BridgeFactKind =
  | 'channel-create'
  | 'channel-register'
  | 'method-invoke'
  | 'method-handle'
  | 'module-export'
  | 'module-import'
  | 'component-export'
  | 'component-require';

/** 한 생산 문서가 담을 수 있는 최대 사실 수다. */
export const MAX_FACTS_PER_DOCUMENT = 100_000;

/** 사실의 프로젝트 상대 소스 위치다. */
export interface BridgeLocation {
  readonly path: string;
  readonly line: number;
  readonly column: number;
}

/** 사실을 감싸는 언어별 선언 식별자다. */
export interface BridgeSymbol {
  readonly qualifiedName: string;
  readonly usr?: string;
}

/** producer가 관찰한 사용 관계를 귀속한 실제 native handler 분기 범위다. */
export interface BridgeHandlerScope {
  readonly start: BridgeLocation;
  readonly end: BridgeLocation;
  readonly complete: boolean;
}

/** 실제 참조 위치와 대상, index의 overrides로 확인한 dispatch 후보를 보존한다. */
export interface BridgeHandlerDependency {
  readonly kind: 'call' | 'reference';
  readonly scope: 'handler' | 'registration';
  readonly location: BridgeLocation;
  readonly symbol: BridgeSymbol & { readonly usr: string };
  readonly dispatchTargets?: readonly (BridgeSymbol & { readonly usr: string })[];
}

/** handler 분기 근거의 원시 상한이다. */
export const MAX_SCOPE_DEPENDENCIES_PER_FACT = 10_000;
export const MAX_SCOPE_DEPENDENCIES_PER_DOCUMENT = 1_000_000;

/** 생산 도구 하나가 관찰한 언어 경계 사실이다. */
export interface BridgeFact {
  readonly kind: BridgeFactKind;
  readonly channel: string | null;
  readonly method?: string;
  /**
   * `react-native` target의 이름 경계 사실이 속한 해석 경로다.
   *
   * 생략은 `core`다. Expo의 `requireNativeModule`은 TurboModule 폴백이
   * 있어 호출 측 `expo`가 양쪽 mechanism의 export와 조인되지만,
   * `requireNativeViewManager`에는 그런 폴백이 없다 — 조인 규칙은
   * GRAPH-EXCHANGE.md가 정한다.
   */
  readonly mechanism?: BridgeMechanism;
  /**
   * 호출 측 API가 모듈 부재를 허용한다는 증거다.
   *
   * `requireOptionalNativeModule`·`TurboModuleRegistry.get` 계열은 부재 시
   * 던지지 않고 `null`을 돌려주므로, 이 표시가 있는 `module-import`의 미수출은
   * 크래시가 아니라 호출자가 감당하는 관찰이다. `module-import`에만 올 수 있다.
   */
  readonly optional?: boolean;
  readonly dynamic: boolean;
  readonly location: BridgeLocation;
  readonly symbol?: BridgeSymbol;
  readonly sourceLanguage?: BridgeSourceLanguage;
  readonly handlerScope?: BridgeHandlerScope;
  readonly dependencies?: readonly BridgeHandlerDependency[];
}

/** bridge-facts 버전 1 문서다. */
export interface BridgeFactsDocument {
  readonly format: 'bridge-facts';
  readonly version: 1;
  readonly tool: Readonly<{ name: string; version: string }>;
  readonly generatedAt: string;
  /** 이번 추출에서 읽은 소스의 최신 mtime이며 compiler 신선도 증거가 아니다. */
  readonly sourceModifiedAt?: string;
  readonly platform: BridgePlatform;
  readonly target: BridgeTarget | null;
  readonly project: string;
  readonly facts: readonly BridgeFact[];
  readonly limitations: readonly string[];
  readonly limitationScopes?: readonly BridgeLimitationScope[];
}

/** 외부 교환 문서가 v1 계약을 어겼음을 나타낸다. */
export class BridgeFactsValidationError extends Error {
  /** 입력 내용을 노출하지 않는 안전한 메시지를 보존한다. */
  constructor(message: string) {
    super(message);
    this.name = 'BridgeFactsValidationError';
  }
}

/** 신뢰하지 않는 JSON 값을 검증된 bridge-facts v1 문서로 바꾼다. */
export function parseBridgeFactsDocument(input: unknown): BridgeFactsDocument {
  if (!isJsonObject(input)) {
    throw new BridgeFactsValidationError(
      'Bridge facts must be a JSON object.',
    );
  }
  if (input.format !== 'bridge-facts') {
    throw new BridgeFactsValidationError('Expected format "bridge-facts".');
  }
  if (input.version !== 1) {
    throw new BridgeFactsValidationError(
      'Unsupported bridge-facts version; expected version 1.',
    );
  }
  validateDocumentMetadata(input);
  return normalizeDocument(input);
}

/** 검증된 입력에서 v1 허용 필드만 복사해 신뢰 경계 밖 데이터를 제거한다. */
function normalizeDocument(document: BridgeFactsDocument): BridgeFactsDocument {
  return {
    format: 'bridge-facts',
    version: 1,
    tool: { name: document.tool.name, version: document.tool.version },
    generatedAt: document.generatedAt,
    ...(document.sourceModifiedAt === undefined ? {} : { sourceModifiedAt: document.sourceModifiedAt }),
    platform: document.platform,
    target: document.target,
    project: document.project,
    facts: document.facts.map(normalizeFact),
    limitations: [...document.limitations],
    ...(document.limitationScopes === undefined ? {} : {
      limitationScopes: document.limitationScopes.map((scope) => ({
        limitationIndex: scope.limitationIndex,
        channels: [...new Set(scope.channels)].sort(),
      })).sort((a, b) => a.limitationIndex - b.limitationIndex),
    }),
  };
}

/** 사실과 중첩 위치·심볼에서 계약 필드만 보존한다. */
function normalizeFact(fact: BridgeFact): BridgeFact {
  const symbol = fact.symbol === undefined
    ? {}
    : {
        symbol: {
          qualifiedName: fact.symbol.qualifiedName,
          ...(fact.symbol.usr === undefined ? {} : { usr: fact.symbol.usr }),
        },
      };
  return {
    kind: fact.kind,
    channel: fact.channel,
    ...(fact.method === undefined ? {} : { method: fact.method }),
    ...(fact.mechanism === undefined ? {} : { mechanism: fact.mechanism }),
    ...(fact.optional === undefined ? {} : { optional: fact.optional }),
    dynamic: fact.dynamic,
    location: {
      path: fact.location.path,
      line: fact.location.line,
      column: fact.location.column,
    },
    ...symbol,
    ...(fact.sourceLanguage === undefined ? {} : { sourceLanguage: fact.sourceLanguage }),
    ...(fact.handlerScope === undefined ? {} : normalizeScopeEvidence(fact.handlerScope, fact.dependencies ?? [])),
  };
}

/** 문서 수준 필드가 v1 타입과 허용값을 따르는지 검증한다. */
function validateDocumentMetadata(
  document: Record<string, unknown>,
): asserts document is Record<string, unknown> & BridgeFactsDocument {
  validateTool(document.tool);
  if (!isBridgeTimestamp(document.generatedAt)) fail('Invalid generatedAt timestamp.');
  if (document.sourceModifiedAt !== undefined && !isBridgeTimestamp(document.sourceModifiedAt)) fail('Invalid sourceModifiedAt timestamp.');
  if (!bridgePlatforms.has(document.platform)) fail('Unsupported bridge platform.');
  if (document.target !== null && !bridgeTargets.has(document.target)) {
    fail('Unsupported bridge target.');
  }
  // go 문서는 v1에서 사실을 담지 않으므로 브리지 메커니즘도 가질 수 없다.
  // 비null target을 허용하면 소비자가 go 문서를 어느 target의 근거로 읽을지
  // 갈리므로 입력 오류로 거부한다.
  if (document.platform === 'go' && document.target !== null) {
    fail('Go documents must carry a null target.');
  }
  if (!isSafeNonEmptyString(document.project)) fail('Invalid project path.');
  if (!Array.isArray(document.facts)) fail('Facts must be an array.');
  if (document.facts.length > MAX_FACTS_PER_DOCUMENT) {
    fail(`Facts exceed the ${MAX_FACTS_PER_DOCUMENT} item limit.`);
  }
  let scopeDependencies = 0;
  const consumeScopeDependencies = (count: number): void => {
    scopeDependencies += count;
    if (scopeDependencies > MAX_SCOPE_DEPENDENCIES_PER_DOCUMENT) {
      fail('Scope dependency budget exceeded.');
    }
  };
  document.facts.forEach((fact, index) =>
    validateFact(fact, index, document.platform, consumeScopeDependencies),
  );
  if ((document.target === null) !== (document.facts.length === 0)) {
    fail('Target must be set exactly when facts are present.');
  }
  const mechanismIndex = document.facts.findIndex(
    (fact) => isJsonObject(fact) && fact.mechanism !== undefined,
  );
  if (document.target !== 'react-native' && mechanismIndex >= 0) {
    fail(`Mechanism requires the react-native target at fact index ${mechanismIndex}.`);
  }
  if (!isStringArray(document.limitations)) fail('Limitations must be strings.');
  validateLimitationScopes(document.limitationScopes, document.limitations.length);
  const hasUnattributedHandler = document.facts.some(
    (fact) =>
      isJsonObject(fact) &&
      fact.kind === 'method-handle' &&
      fact.channel === null,
  );
  if (
    hasUnattributedHandler &&
    !document.limitations.some((message) =>
      message.startsWith('unattributed-method-handles:'))
  ) {
    fail('Unattributed method handles require a limitation.');
  }
}

/** 잘못된 범위를 무시하면 거짓 error가 생기므로 입력 단계에서 명시적으로 거부한다. */
function validateLimitationScopes(value: unknown, limitationCount: number): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length > MAX_LIMITATION_SCOPES) {
    fail('Invalid limitation scopes array.');
  }
  const indices = new Set<number>();
  let channelCount = 0;
  for (const entry of value) {
    if (!isJsonObject(entry) || !Number.isSafeInteger(entry.limitationIndex) ||
      typeof entry.limitationIndex !== 'number' || entry.limitationIndex < 0 ||
      entry.limitationIndex >= limitationCount || indices.has(entry.limitationIndex)) {
      fail('Invalid or duplicate limitation scope index.');
    }
    if (!Array.isArray(entry.channels) || entry.channels.length === 0 ||
      !entry.channels.every(isSafeNonEmptyString)) {
      fail('Limitation scope channels must be non-empty safe strings.');
    }
    channelCount += entry.channels.length;
    if (channelCount > MAX_SCOPED_CHANNELS) fail('Too many scoped channels.');
    indices.add(entry.limitationIndex);
  }
}

/** 사실 하나의 조인 키와 증거 필드를 검증한다. */
function validateFact(value: unknown, index: number, platform: unknown,
  consumeScopeDependencies: (count: number) => void): void {
  if (!isJsonObject(value)) fail(`Fact at index ${index} must be a JSON object.`);
  if (!bridgeFactKinds.has(value.kind)) fail(`Invalid fact kind at index ${index}.`);
  if (!isFactKindForPlatform(platform, value.kind)) {
    fail(`Fact kind is not valid for platform at index ${index}.`);
  }
  if (!methodFactKinds.has(value.kind) && value.method !== undefined) {
    fail(`Unexpected method at index ${index}.`);
  }
  if (
    value.channel === null
      ? value.kind !== 'method-handle'
      : !isSafeNonEmptyString(value.channel)
  ) {
    fail(`Invalid fact channel at index ${index}.`);
  }
  if (methodFactKinds.has(value.kind) && !isSafeNonEmptyString(value.method)) {
    fail(`Method fact at index ${index} requires a method name.`);
  }
  if (value.mechanism !== undefined &&
    (!mechanismFactKinds.has(value.kind) || !bridgeMechanisms.has(value.mechanism))) {
    fail(`Invalid fact mechanism at index ${index}.`);
  }
  // optional은 존재 자체가 증거인 표식이다 — `false`도 허용 값이 아니다.
  if (value.optional !== undefined &&
    (value.kind !== 'module-import' || value.optional !== true)) {
    fail(`Invalid fact optional flag at index ${index}.`);
  }
  if (typeof value.dynamic !== 'boolean') fail(`Invalid dynamic flag at index ${index}.`);
  validateLocation(value.location, index);
  validateSymbol(value.symbol, index);
  validateSourceLanguage(value.sourceLanguage, platform, value.location as BridgeLocation, value.symbol as BridgeSymbol | undefined, index);
  if (value.handlerScope !== undefined || value.dependencies !== undefined) {
    if (value.kind !== 'method-handle' || value.sourceLanguage !== undefined) {
      fail(`Scope evidence requires a native method handler at index ${index}.`);
    }
    validateScopeEvidence(value, value.location as BridgeLocation,
      value.symbol as BridgeSymbol | undefined, index, consumeScopeDependencies);
  }
}

/**
 * v1 `method-handle`과 v2 handler 사실이 공유하는 분기 근거 필드를 검증한다.
 *
 * `handlerScope`는 감싸는 핸들러 선언 안에서 이 사실로 귀속한 분기 범위고,
 * `dependencies`의 `scope`가 그 안(`handler`)인지 공유 부분(`registration`)인지
 * 구분한다. 두 필드는 함께만 올 수 있다.
 */
export function validateScopeEvidence(
  fact: Record<string, unknown>,
  location: BridgeLocation,
  symbol: BridgeSymbol | undefined,
  index: number,
  consumeScopeDependencies: (count: number) => void,
): void {
  if (!isJsonObject(fact.handlerScope)) fail(`Invalid handler scope at index ${index}.`);
  validateLocation(fact.handlerScope.start, index);
  validateLocation(fact.handlerScope.end, index);
  const start = fact.handlerScope.start as BridgeLocation;
  const end = fact.handlerScope.end as BridgeLocation;
  if (typeof fact.handlerScope.complete !== 'boolean' || start.path !== location.path ||
    end.path !== location.path || comparePositions(start, end) > 0 ||
    (fact.handlerScope.complete === true && symbol?.usr === undefined)) {
    fail(`Invalid handler scope at index ${index}.`);
  }
  if (!Array.isArray(fact.dependencies) || fact.dependencies.length > MAX_SCOPE_DEPENDENCIES_PER_FACT) {
    fail(`Invalid handler dependencies at index ${index}.`);
  }
  consumeScopeDependencies(fact.dependencies.length);
  for (const input of fact.dependencies) {
    if (!isJsonObject(input) ||
      (input.kind !== 'call' && input.kind !== 'reference') ||
      (input.scope !== 'handler' && input.scope !== 'registration')) {
      fail(`Invalid handler dependency at index ${index}.`);
    }
    validateLocation(input.location, index);
    const at = input.location as BridgeLocation;
    const inside = comparePositions(start, at) <= 0 && comparePositions(at, end) <= 0;
    if (at.path !== location.path || inside !== (input.scope === 'handler')) {
      fail(`Handler dependency is outside its declared scope at index ${index}.`);
    }
    validateIndexedSymbol(input.symbol, index);
    if (input.dispatchTargets !== undefined) {
      if (!Array.isArray(input.dispatchTargets) || input.dispatchTargets.length > MAX_SCOPE_DEPENDENCIES_PER_FACT) {
        fail(`Invalid handler dispatch targets at index ${index}.`);
      }
      consumeScopeDependencies(input.dispatchTargets.length);
      for (const target of input.dispatchTargets) validateIndexedSymbol(target, index);
    }
  }
}

/** 분기 근거 의존의 대상은 인덱스로 확인된 심볼이라 USR이 필수다. */
function validateIndexedSymbol(value: unknown, index: number): void {
  if (!isJsonObject(value) || !isSafeNonEmptyString(value.qualifiedName) || !isSafeNonEmptyString(value.usr)) {
    fail(`Invalid handler dependency symbol at index ${index}.`);
  }
}

/** 검증된 분기 근거를 계약 필드만 남긴 사본으로 만든다. */
export function normalizeScopeEvidence(
  handlerScope: BridgeHandlerScope,
  dependencies: readonly BridgeHandlerDependency[],
): { handlerScope: BridgeHandlerScope; dependencies: BridgeHandlerDependency[] } {
  const copy = (at: BridgeLocation): BridgeLocation => ({ path: at.path, line: at.line, column: at.column });
  return {
    handlerScope: { start: copy(handlerScope.start), end: copy(handlerScope.end), complete: handlerScope.complete },
    dependencies: dependencies.map((dependency) => ({
      kind: dependency.kind, scope: dependency.scope, location: copy(dependency.location),
      symbol: { qualifiedName: dependency.symbol.qualifiedName, usr: dependency.symbol.usr },
      ...(dependency.dispatchTargets === undefined ? {} : {
        dispatchTargets: dependency.dispatchTargets.map((target) => ({
          qualifiedName: target.qualifiedName, usr: target.usr,
        })),
      }),
    })),
  };
}

/** 같은 파일 안의 두 위치를 줄·열 순으로 비교한다. */
function comparePositions(left: BridgeLocation, right: BridgeLocation): number {
  return left.line - right.line || left.column - right.column;
}

/** 호출 측과 수신 측 플랫폼이 생산할 수 있는 fact 종류인지 확인한다. */
function isFactKindForPlatform(platform: unknown, kind: unknown): boolean {
  // go는 v1에서 사실을 내지 않는다 — cgo/gomobile 같은 심볼 경계 interop은
  // 정적 채널 키로 귀속할 수 없어 unscanned-ffi-interop limitation으로만
  // 신고한다. 호출·수신 어느 쪽 종류도 허용하지 않는다.
  if (isCallerPlatform(platform)) return callerFactKinds.has(kind);
  if (isReceiverPlatform(platform)) return receiverFactKinds.has(kind);
  return false;
}

/** 브리지 호출 측 사실을 생산하는 플랫폼인지 확인한다. go는 어느 쪽도 아니다. */
export function isCallerPlatform(platform: unknown): platform is 'dart' | 'js' {
  return platform === 'dart' || platform === 'js';
}

/** 브리지 수신 측 사실을 생산하는 플랫폼인지 확인한다. go는 어느 쪽도 아니다. */
export function isReceiverPlatform(
  platform: unknown,
): platform is 'swift' | 'kotlin' {
  return platform === 'swift' || platform === 'kotlin';
}

/** 값이 계약이 정한 브리지 메커니즘 이름인지 확인한다. */
export function isBridgeTarget(value: unknown): value is BridgeTarget {
  return bridgeTargets.has(value);
}

/** 조인 키를 깨뜨리는 제어 문자가 없는 비어 있지 않은 문자열인지 확인한다. */
export function isSafeNonEmptyString(value: unknown): value is string {
  return isNonEmptyString(value) && !controlCharacterPattern.test(value) &&
    !hasUnpairedSurrogate(value);
}

/** 유효한 UTF-16 문자열인지, 즉 짝 없는 서러게이트가 없는지 확인한다. */
function hasUnpairedSurrogate(value: string): boolean {
  // 아스트랄 문자(이모지 등)는 유효한 서러게이트 쌍이므로 그대로 통과한다.
  // 짝 없는 서러게이트는 어떤 인코딩의 파일에도 존재할 수 없어 JSON 이스케이프로만
  // 들어오며, URI 인코딩이 실패하는 등 소비 경로마다 깨진다.
  return value.toWellFormed() !== value;
}

/** 사실 위치가 상대 경로와 1부터 시작하는 줄·열을 갖는지 검증한다. */
export function validateLocation(value: unknown, index: number): void {
  if (
    !isJsonObject(value) ||
    !isProjectRelativePath(value.path) ||
    !isPositiveInteger(value.line) ||
    !isPositiveInteger(value.column)
  ) {
    fail(`Invalid fact location at index ${index}.`);
  }
}

/** 절대·상위 경로와 제어 문자를 제외한 프로젝트 상대 경로인지 확인한다. */
export function isProjectRelativePath(value: unknown): value is string {
  if (!isNonEmptyString(value)) return false;
  if (/^(?:[/\\]|[A-Za-z]:)/u.test(value)) return false;
  if (controlCharacterPattern.test(value) || hasUnpairedSurrogate(value)) {
    return false;
  }
  return !value.split(/[/\\]/u).includes('..');
}

/** 선택 symbol의 이름과 USR이 비어 있지 않은지 검증한다. */
export function validateSymbol(value: unknown, index: number): void {
  if (value === undefined) return;
  if (
    !isJsonObject(value) ||
    !isSafeNonEmptyString(value.qualifiedName) ||
    (value.usr !== undefined && !isSafeNonEmptyString(value.usr))
  ) {
    fail(`Invalid fact symbol at index ${index}.`);
  }
}

/** 교환 계약별 파서가 Objective-C 출처·경로·실제 Clang 신원 규칙을 공유한다. */
export function validateSourceLanguage(value: unknown, platform: unknown, location: BridgeLocation,
  symbol: BridgeSymbol | undefined, index: number): void {
  if (value !== undefined && (value !== 'objective-c' || platform !== 'swift' ||
    !/\.(?:m|mm)$/u.test(location.path) ||
    (symbol?.usr !== undefined && !symbol.usr.startsWith('c:')))) {
    fail(`Invalid source language at index ${index}.`);
  }
}

/** 생산 도구 이름과 버전이 비어 있지 않은지 검증한다. */
function validateTool(value: unknown): void {
  if (
    !isJsonObject(value) ||
    !isSafeNonEmptyString(value.name) ||
    !isSafeNonEmptyString(value.version)
  ) {
    fail('Invalid tool metadata.');
  }
}

/** ISO 계열 생성 시각으로 해석할 수 있는지 확인한다. */
export function isBridgeTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = timestampPattern.exec(value);
  if (match === null || Number.isNaN(Date.parse(value))) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth(year, month) &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59
  );
}

/** 윤년을 포함한 주어진 달의 실제 일수를 반환한다. */
function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return isLeapYear ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** 공백만 있지 않은 문자열인지 확인한다. */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** 모든 원소가 문자열인 배열인지 확인한다. */
function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** 1부터 시작하는 정수인지 확인한다. */
function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1;
}

/** 입력 값을 포함하지 않는 검증 오류를 던진다. */
function fail(message: string): never {
  throw new BridgeFactsValidationError(message);
}

/** 지원하는 생산 플랫폼 집합이다. */
const bridgePlatforms = new Set<unknown>(['dart', 'swift', 'kotlin', 'js', 'go']);

/** 지원하는 브리지 메커니즘 집합이다. */
const bridgeTargets = new Set<unknown>([
  'flutter',
  'react-native',
  'capacitor',
]);

/** 버전 1이 정의한 사실 종류 집합이다. */
const bridgeFactKinds = new Set<unknown>([
  'channel-create',
  'channel-register',
  'method-invoke',
  'method-handle',
  'module-export',
  'module-import',
  'component-export',
  'component-require',
]);

const callerFactKinds = new Set<unknown>([
  'channel-create',
  'method-invoke',
  'module-import',
  'component-require',
]);
const receiverFactKinds = new Set<unknown>([
  'channel-register',
  'method-handle',
  'module-export',
  'component-export',
]);

/** method 필드가 필수인 사실 종류다. */
const methodFactKinds = new Set<unknown>(['method-invoke', 'method-handle']);

/** mechanism 필드가 허용되는 이름 경계 사실 종류다. */
const mechanismFactKinds = new Set<unknown>([
  'module-import',
  'module-export',
  'component-require',
  'component-export',
]);

/** mechanism 필드의 허용 값이다. 생략은 `core`로 읽는다. */
const bridgeMechanisms = new Set<unknown>(['core', 'expo']);

const timestampPattern =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;
const controlCharacterPattern = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u;

/** 배열과 null을 제외한 JSON 객체인지 확인한다. isthmus 소유 문서 검증도 재사용한다. */
export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
