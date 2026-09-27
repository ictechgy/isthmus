import {
  httpMethods,
  MAX_ROUTE_TEMPLATE_LENGTH,
  parseRouteTemplate,
  type RouteMethod,
  type RouteSegment,
} from './route-template.ts';

/**
 * bridge-facts 생산 플랫폼이다. sql은 스키마 카탈로그를 읽는 수신 측이고,
 * openapi는 스펙 문서의 operation을 `route-contract`로만 내는 http 계약 측이다.
 */
export type BridgePlatform =
  | 'dart' | 'swift' | 'kotlin' | 'js' | 'go' | 'rust' | 'sql' | 'openapi';

/**
 * 언어 경계를 잇는 메커니즘이다. persistence는 코드↔스키마, http는 REST 호출↔라우트 경계다.
 */
export type BridgeTarget = 'flutter' | 'react-native' | 'capacitor' | 'persistence' | 'http';

/** http 문서가 스캔한 역할이다. 사실이 0건이어도 "스캔했으나 없음"을 표현한다. */
export type RouteDocumentRole = 'server' | 'client';

/** route-decl 문서의 디스패치 모델이다. 이 버전은 `specificity`만 받는다. */
export type RouteDispatch = 'specificity';

/** 서버 경로 앵커다. `base`는 정적으로 알 수 없는 base 경로 뒤에 붙는다는 뜻이다. */
export type RoutePathAnchor = 'root' | 'base';

/** route-decl의 경로 제약 하나다. 닫힌 종류(int·uuid·slug)만 매칭에서 평가한다. */
export interface RouteParamConstraint {
  /** 템플릿 세그먼트의 0부터 시작하는 인덱스다. 파라미터가 있는 세그먼트여야 한다. */
  readonly segment: number;
  readonly kind: 'int' | 'uuid' | 'slug' | 'path' | 'regex';
  /** `regex` 전용 정보 필드다. 방언 차이와 ReDoS 위험 때문에 평가하지 않는다. */
  readonly pattern?: string;
}

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
  | 'component-require'
  | 'relation-use'
  | 'relation-decl'
  | 'route-decl'
  | 'route-call'
  | 'route-contract';

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
  /**
   * `relation-decl`은 live catalog 선언이라 소스 위치가 없어 생략할 수 있다.
   * 그 외 kind는 계약상 필수다.
   */
  readonly location?: BridgeLocation;
  readonly symbol?: BridgeSymbol;
  readonly sourceLanguage?: BridgeSourceLanguage;
  readonly handlerScope?: BridgeHandlerScope;
  readonly dependencies?: readonly BridgeHandlerDependency[];
  /**
   * route-call의 동사가 리터럴이 아니라는 표시다. 이때 `method`는 없다.
   * 경로만으로 잇되 check error 근거가 되지 않는다.
   */
  readonly methodDynamic?: true;
  /** route 사실 전용 필수 필드다. 조인의 네 앵커 조합을 정한다. */
  readonly pathAnchor?: RoutePathAnchor;
  /** route-call 전용: userinfo를 뗀 소문자 리터럴 host다. 귀속 입력이며 조인 키가 아니다. */
  readonly authority?: string;
  /** route-call 전용: base URL 식의 생산자 id다. */
  readonly baseRef?: string;
  /** route 사실의 서비스 신원이다. 문서 값과 다르면 입력 오류다. */
  readonly service?: string;
  /** route-decl 전용: 끝 슬래시 정책이다. 생략은 미상이다. */
  readonly trailingSlash?: 'strict' | 'optional';
  /** route-decl 전용: 대소문자 무시를 증명한 경우만 싣는다. */
  readonly caseInsensitive?: true;
  /** route-decl 전용: params·headers 등 조건으로 같은 키를 나눈 핸들러다. */
  readonly narrowed?: true;
  readonly paramConstraints?: readonly RouteParamConstraint[];
  /** route-decl 전용: 템플릿이 재정의 없는 설정 기본값에 기댄다는 증거다. */
  readonly configDefault?: true;
  /** route-decl 전용: 0세그먼트 catch-all을 펼친 접두사 decl이다. */
  readonly catchAllPrefix?: true;
  /** route-call 전용: 끝 보간이 query임을 증명하고 떼어 냈다는 증거다. */
  readonly queryTailStripped?: true;
  /** dynamic route-call 전용: 증명된 리터럴 접두사 템플릿이다. 판정에 쓰지 않는다. */
  readonly channelPrefix?: string;
  /** route-call 전용: 마스킹한 세그먼트 수다. 마스킹된 호출은 error 근거가 아니다. */
  readonly maskedSegments?: number;
  /** route-contract·route-call 증거: 스펙 operationId다. */
  readonly operationId?: string;
  /** 테스트 소스에서 낸 route 사실이다. check error 근거가 되지 않는다. */
  readonly testSource?: true;
}

/** http 문서가 테스트 소스 세트를 스캔했는지 선언한다. */
export interface RouteSourceSets {
  readonly tests: 'excluded' | 'included';
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
  /** target `http` 문서에 필수다. 사실 0건 http 문서가 target을 유지하는 근거다. */
  readonly roles?: readonly RouteDocumentRole[];
  /** route-decl을 담은 http 문서에 필수다. */
  readonly dispatch?: RouteDispatch;
  readonly sourceSets?: RouteSourceSets;
  /** http 문서의 기본 서비스 신원이다. 사실의 `service`가 없으면 이 값이 유효 service다. */
  readonly service?: string;
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
  // workspace 매니페스트는 계약 초안에만 있다. 일반 문구 대신 원인을 밝혀, 매니페스트 없이
  // 조인하면 귀속 규칙이 달라진다는 사실을 조용히 넘기지 않는다.
  if (input.format === 'isthmus-workspace') {
    throw new BridgeFactsValidationError(
      'isthmus-workspace manifests are not supported yet; pass the http documents of one '
      + 'project directly and use service strings for attribution.',
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
    ...(document.roles === undefined ? {} : { roles: [...document.roles] }),
    ...(document.dispatch === undefined ? {} : { dispatch: document.dispatch }),
    ...(document.sourceSets === undefined ? {} : { sourceSets: { tests: document.sourceSets.tests } }),
    ...(document.service === undefined ? {} : { service: document.service }),
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
    ...(fact.location === undefined ? {} : {
      location: {
        path: fact.location.path,
        line: fact.location.line,
        column: fact.location.column,
      },
    }),
    ...symbol,
    ...(fact.sourceLanguage === undefined ? {} : { sourceLanguage: fact.sourceLanguage }),
    ...(fact.handlerScope === undefined ? {} : normalizeScopeEvidence(fact.handlerScope, fact.dependencies ?? [])),
    ...normalizeRouteFields(fact),
  };
}

/**
 * route 사실의 선택 필드를 계약 필드만 남긴 사본으로 만든다.
 *
 * 검증을 통과한 값만 오므로 존재 여부만 보고 복사한다. 제약 목록은 세그먼트 순으로
 * 고정해 입력 순서가 출력에 새지 않게 한다.
 */
function normalizeRouteFields(fact: BridgeFact): Partial<BridgeFact> {
  // 다른 kind의 사실에 남은 같은 이름의 필드(`channelPrefix` 등)는 정의되지 않은 필드라 버린다.
  if (!routeFactKinds.has(fact.kind)) return {};
  const copy: Record<string, unknown> = {};
  for (const field of routeScalarFields) {
    if (fact[field] !== undefined) copy[field] = fact[field];
  }
  if (fact.paramConstraints !== undefined) {
    copy.paramConstraints = fact.paramConstraints
      .map((constraint) => ({
        segment: constraint.segment,
        kind: constraint.kind,
        ...(constraint.pattern === undefined ? {} : { pattern: constraint.pattern }),
      }))
      .sort((left, right) => left.segment - right.segment);
  }
  return copy as Partial<BridgeFact>;
}

/** 원시값이라 그대로 복사할 수 있는 route 사실 필드다. */
const routeScalarFields = [
  'methodDynamic', 'pathAnchor', 'authority', 'baseRef', 'service', 'trailingSlash',
  'caseInsensitive', 'narrowed', 'configDefault', 'catchAllPrefix', 'queryTailStripped',
  'channelPrefix', 'maskedSegments', 'operationId', 'testSource',
] as const satisfies readonly (keyof BridgeFact)[];

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
  // go·rust 문서가 가질 수 있는 비null target은 persistence뿐이다 — bridge
  // 도메인의 go는 cgo·gomobile, rust는 PyO3·cbindgen 같은 심볼 경계
  // interop이 정적 채널 키로 귀속되지 않아 사실을 내지 않는다.
  // sql 문서도 같은 이유로 null 또는 persistence 외 target을 가질 수 없다.
  if ((document.platform === 'go' || document.platform === 'rust') &&
    document.target !== null && document.target !== 'persistence') {
    fail('Go/Rust documents may only carry a null or persistence target.');
  }
  if (document.platform === 'sql' && document.target !== null &&
    document.target !== 'persistence') {
    fail('Sql documents may only carry a null or persistence target.');
  }
  // openapi 문서는 스펙 operation만 기술한다 — bridge·persistence 경계가 없다.
  if (document.platform === 'openapi' && document.target !== null && document.target !== 'http') {
    fail('Openapi documents may only carry a null or http target.');
  }
  if (document.target === 'http' && !httpPlatforms.has(document.platform)) {
    fail('The http target accepts only kotlin, swift, dart, js, and openapi documents.');
  }
  validateRouteDocumentFields(document);
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
    validateFact(fact, index, document, consumeScopeDependencies),
  );
  // http 한정 예외: roles가 있는 http 문서는 사실이 0건이어도 target을 유지한다. 호출 0건
  // 클라이언트를 "스캔 안 함"과 구분하고, 0건 kotlin·swift 라우트 문서가 null target으로
  // bridge 수신 요건을 채우는 누수를 막는다. roles 필수는 위 문서 필드 검증이 강제한다.
  if (document.target !== 'http' &&
    (document.target === null) !== (document.facts.length === 0)) {
    fail('Target must be set exactly when facts are present.');
  }
  // 사실 검증을 모두 통과한 뒤라 문서 전체 규칙은 검증된 형태로 읽는다.
  if (document.target === 'http') validateRouteDocumentFacts(document as unknown as BridgeFactsDocument);
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
function validateFact(value: unknown, index: number, document: Record<string, unknown>,
  consumeScopeDependencies: (count: number) => void): void {
  const { platform, target } = document;
  if (!isJsonObject(value)) fail(`Fact at index ${index} must be a JSON object.`);
  if (!bridgeFactKinds.has(value.kind)) fail(`Invalid fact kind at index ${index}.`);
  if (!isFactKindForPlatformTarget(platform, target, value.kind)) {
    fail(`Fact kind is not valid for platform at index ${index}.`);
  }
  if (routeFactKinds.has(value.kind)) {
    validateRouteFact(value, index, document);
    return;
  }
  // 잘못 놓인 route 필드는 모르는 필드로 버리지 않는다 — 다른 target 문서에 실린
  // route 필드를 조용히 지우면 생산자의 의도가 사라진다.
  const misplaced = routeFieldNames.find((field) => value[field] !== undefined);
  if (misplaced !== undefined) {
    fail(`Route field "${misplaced}" is only valid on route facts of an http document at index ${index}.`);
  }
  if (
    !methodFactKinds.has(value.kind) &&
    !optionalMethodFactKinds.has(value.kind) &&
    value.method !== undefined
  ) {
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
  if (optionalMethodFactKinds.has(value.kind) && value.method !== undefined &&
    !isSafeNonEmptyString(value.method)) {
    fail(`Invalid column name at index ${index}.`);
  }
  // 카탈로그 선언은 소스 위치가 없고 이름이 항상 리터럴이다 — dynamic이거나
  // 객체만 가리키는 symbol 없는 relation-decl은 소비자가 진단을 못 가리키게
  // 하므로 거부한다. 선언 이름은 계약상 항상 `schema.name` 한정 형태다 —
  // 비한정 선언은 조인 의미가 정의되지 않아 거부한다.
  if (value.kind === 'relation-decl') {
    if (value.dynamic === true || !isJsonObject(value.symbol)) {
      fail(`Relation declarations require a symbol and must be literal at index ${index}.`);
    }
    const segments = typeof value.channel === 'string'
      ? value.channel.split('.')
      : [];
    if (segments.length < 2 || segments.some((segment) => segment.length === 0)) {
      fail(`Relation declarations require a qualified schema.name channel at index ${index}.`);
    }
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
  if (value.location === undefined) {
    // live catalog 선언만 소스 위치 없이 올 수 있다.
    if (value.kind !== 'relation-decl') {
      fail(`Fact at index ${index} requires a location.`);
    }
  } else {
    validateLocation(value.location, index);
  }
  validateSymbol(value.symbol, index);
  if (value.location === undefined && value.sourceLanguage !== undefined) {
    fail(`Invalid source language at index ${index}.`);
  }
  validateSourceLanguage(value.sourceLanguage, platform, value.location as BridgeLocation | undefined, value.symbol as BridgeSymbol | undefined, index);
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

/**
 * http 문서 수준 필드(`roles`·`dispatch`·`sourceSets`·`service`)를 검증한다.
 *
 * 다른 target 문서에 실린 http 필드는 버리지 않고 거부한다. 계약 초안이 나중 단계로 미룬
 * 값(`registration-order`, http `limitationScopes`)도 조용히 무시하지 않고 원인을 밝혀 거부한다 —
 * 무시하면 생산자가 선언한 디스패치·스코프와 다른 판정이 나온다.
 */
function validateRouteDocumentFields(document: Record<string, unknown>): void {
  if (document.target !== 'http') {
    const misplaced = routeDocumentFieldNames.find((field) => document[field] !== undefined);
    if (misplaced !== undefined) fail(`Document field "${misplaced}" requires the http target.`);
    return;
  }
  const roles = document.roles;
  if (!isCanonicalRoles(roles)) {
    fail('Http documents require roles ["server"], ["client"], or ["server", "client"].');
  }
  if (document.platform === 'openapi' && (roles.length !== 1 || roles[0] !== 'server')) {
    fail('Openapi documents must declare roles ["server"].');
  }
  if (document.limitationScopes !== undefined) {
    fail('Limitation scopes are not supported on http documents yet; omit limitationScopes '
      + 'so each limitation applies to the whole document.');
  }
  validateRouteDispatch(document.dispatch, roles, document.platform);
  if (document.sourceSets !== undefined && (!isJsonObject(document.sourceSets) ||
    Object.keys(document.sourceSets).some((key) => key !== 'tests') ||
    (document.sourceSets.tests !== 'excluded' && document.sourceSets.tests !== 'included'))) {
    fail('Http sourceSets must be {"tests": "excluded" | "included"}.');
  }
  if (document.service !== undefined && !isSafeNonEmptyString(document.service)) {
    fail('Invalid http document service.');
  }
}

/** roles가 계약의 세 정규 형태 중 하나인지 확인한다. 순서가 다른 표기도 거부한다. */
function isCanonicalRoles(value: unknown): value is readonly RouteDocumentRole[] {
  return Array.isArray(value) && (
    (value.length === 1 && (value[0] === 'server' || value[0] === 'client')) ||
    (value.length === 2 && value[0] === 'server' && value[1] === 'client'));
}

/** dispatch 값과 그 값을 가질 수 있는 문서인지 검증한다. */
function validateRouteDispatch(value: unknown, roles: readonly RouteDocumentRole[], platform: unknown): void {
  if (value === undefined) return;
  if (value === 'registration-order') {
    fail('Dispatch "registration-order" is not supported yet; this isthmus version joins only '
      + 'specificity route declarations.');
  }
  if (value !== 'specificity') fail('Invalid http dispatch.');
  if (!roles.includes('server') || platform === 'openapi') {
    fail('Dispatch requires a non-openapi http document with the server role.');
  }
}

/**
 * route 사실 하나를 검증한다. 역할은 kind로 정하고, kind 전용 필드가 다른 kind에 실리면
 * 모르는 필드로 버리지 않고 거부한다.
 */
function validateRouteFact(value: Record<string, unknown>, index: number, document: Record<string, unknown>): void {
  const kind = value.kind as RouteFactKind;
  const foreign = nonRouteFieldNames.find((field) => value[field] !== undefined);
  if (foreign !== undefined) fail(`Field "${foreign}" is not valid on route facts at index ${index}.`);
  if (value.order !== undefined) {
    fail(`Route field "order" requires registration-order dispatch, which is not supported yet, at index ${index}.`);
  }
  for (const [field, kinds] of routeFieldKinds) {
    if (value[field] !== undefined && !kinds.has(kind)) {
      fail(`Route field "${field}" is not valid on ${kind} facts at index ${index}.`);
    }
  }
  const roles = document.roles as readonly RouteDocumentRole[];
  if ((kind === 'route-decl' && !roles.includes('server')) ||
    (kind === 'route-call' && !roles.includes('client'))) {
    fail(`Fact kind requires the matching document role at index ${index}.`);
  }
  const segments = validateRouteChannel(value, index, kind);
  validateRouteMethod(value, index, kind);
  if (value.pathAnchor !== 'root' && value.pathAnchor !== 'base') {
    fail(`Route facts require pathAnchor "root" or "base" at index ${index}.`);
  }
  if (value.location === undefined) fail(`Fact at index ${index} requires a location.`);
  validateLocation(value.location, index);
  validateSymbol(value.symbol, index);
  if (document.platform === 'openapi' && isJsonObject(value.symbol) && value.symbol.usr !== undefined) {
    fail(`Openapi route contracts carry the operationId as symbol.qualifiedName without usr at index ${index}.`);
  }
  validateRouteEvidence(value, index, document, segments);
}

/**
 * route 사실의 channel을 검증하고, 정적 템플릿이면 세그먼트를 돌려준다.
 *
 * dynamic 사실은 원문(또는 null)을 길이 상한 안에서만 받는다. 정적 템플릿은 문법을
 * 어기면 다시 정규화하지 않고 거부한다. 호출 템플릿에는 `{**}`가 올 수 없다.
 */
function validateRouteChannel(
  value: Record<string, unknown>,
  index: number,
  kind: RouteFactKind,
): readonly RouteSegment[] | undefined {
  if (typeof value.dynamic !== 'boolean') fail(`Invalid dynamic flag at index ${index}.`);
  if (value.dynamic) {
    if (value.channel !== null && (!isSafeNonEmptyString(value.channel) ||
      value.channel.length > MAX_ROUTE_TEMPLATE_LENGTH)) {
      fail(`Invalid dynamic route channel at index ${index}.`);
    }
    return undefined;
  }
  if (typeof value.channel !== 'string') fail(`Route facts require a path template channel at index ${index}.`);
  const parsed = parseRouteTemplate(value.channel);
  if (!parsed.ok) {
    fail(`Route channel is not a canonical path template (${parsed.reason}) at index ${index}.`);
  }
  if (kind === 'route-call' && parsed.segments.some((segment) => segment.kind === 'catch-all')) {
    fail(`Route call templates cannot contain {**} at index ${index}.`);
  }
  return parsed.segments;
}

/**
 * route 사실의 method를 kind별 규칙으로 검증한다.
 *
 * `ANY`는 route-decl 전용이다. route-call의 동사가 리터럴이 아니면 method를 생략하고
 * `methodDynamic: true`를 단다 — 둘을 함께 싣거나 둘 다 빠지면 거부한다.
 */
function validateRouteMethod(value: Record<string, unknown>, index: number, kind: RouteFactKind): void {
  if (kind === 'route-call' && value.methodDynamic !== undefined) {
    if (value.methodDynamic !== true || value.method !== undefined) {
      fail(`A dynamic route method must omit method and set methodDynamic true at index ${index}.`);
    }
    return;
  }
  const allowed = kind === 'route-decl' ? routeDeclMethods : routeMethods;
  if (!allowed.has(value.method)) fail(`Invalid route method at index ${index}.`);
}

/** route 사실의 선택 증거 필드를 검증한다. */
function validateRouteEvidence(
  value: Record<string, unknown>,
  index: number,
  document: Record<string, unknown>,
  segments: readonly RouteSegment[] | undefined,
): void {
  for (const field of routeStringFields) {
    if (value[field] !== undefined && !isSafeNonEmptyString(value[field])) {
      fail(`Invalid route field "${field}" at index ${index}.`);
    }
  }
  if (value.authority !== undefined && !authorityPattern.test(value.authority as string)) {
    fail(`Route authority must be a lowercase host[:port] without userinfo at index ${index}.`);
  }
  if (value.service !== undefined && document.service !== undefined && value.service !== document.service) {
    fail(`Route fact service differs from the document service at index ${index}.`);
  }
  for (const field of routeTrueFlags) {
    if (value[field] !== undefined && value[field] !== true) {
      fail(`Route field "${field}" may only be true at index ${index}.`);
    }
  }
  if (value.trailingSlash !== undefined && value.trailingSlash !== 'strict' && value.trailingSlash !== 'optional') {
    fail(`Invalid route trailingSlash at index ${index}.`);
  }
  validateMaskedSegments(value.maskedSegments, segments, index);
  validateChannelPrefix(value, index);
  if (value.paramConstraints !== undefined) validateParamConstraints(value.paramConstraints, segments, index);
  if (value.testSource === true && (!isJsonObject(document.sourceSets) || document.sourceSets.tests !== 'included')) {
    fail(`Test source route facts require sourceSets {"tests": "included"} at index ${index}.`);
  }
  if (value.catchAllPrefix === true && (segments === undefined ||
    segments.some((segment) => segment.kind === 'catch-all') ||
    !isJsonObject(value.symbol) || value.symbol.usr === undefined)) {
    fail(`A catch-all prefix declaration must be a static template without {**} and carry symbol.usr at index ${index}.`);
  }
}

/** 마스킹 수는 양의 정수이고, 정적 템플릿이면 `{}` 세그먼트 수를 넘지 않는다. */
function validateMaskedSegments(value: unknown, segments: readonly RouteSegment[] | undefined, index: number): void {
  if (value === undefined) return;
  const parameters = segments?.filter((segment) => segment.kind === 'param').length;
  if (!isPositiveInteger(value) || (parameters !== undefined && value > parameters)) {
    fail(`Invalid route maskedSegments at index ${index}.`);
  }
}

/** channelPrefix는 dynamic 호출에서만, `{**}` 없는 정규 템플릿으로만 온다. */
function validateChannelPrefix(value: Record<string, unknown>, index: number): void {
  if (value.channelPrefix === undefined) return;
  const parsed = typeof value.channelPrefix === 'string' ? parseRouteTemplate(value.channelPrefix) : undefined;
  if (value.dynamic !== true || parsed === undefined || !parsed.ok ||
    parsed.segments.some((segment) => segment.kind === 'catch-all')) {
    fail(`A route channelPrefix must be a canonical template on a dynamic call at index ${index}.`);
  }
}

/**
 * 경로 제약을 검증한다. 정적 템플릿의 파라미터 세그먼트만 가리킬 수 있고 세그먼트는
 * 중복되지 않는다. `pattern`은 regex 전용 정보 필드다.
 */
function validateParamConstraints(value: unknown, segments: readonly RouteSegment[] | undefined, index: number): void {
  if (!Array.isArray(value) || value.length === 0 || segments === undefined) {
    fail(`Route paramConstraints require a non-empty array on a static template at index ${index}.`);
  }
  const seen = new Set<number>();
  for (const entry of value) {
    const segment = isJsonObject(entry) ? entry.segment : undefined;
    const target = typeof segment === 'number' ? segments[segment] : undefined;
    if (!isJsonObject(entry) || !Number.isSafeInteger(segment) || target === undefined ||
      target.kind === 'literal' || seen.has(segment as number) ||
      !paramConstraintKinds.has(entry.kind) ||
      (entry.pattern !== undefined && (entry.kind !== 'regex' || !isSafeNonEmptyString(entry.pattern)))) {
      fail(`Invalid route paramConstraints at index ${index}.`);
    }
    seen.add(segment as number);
  }
}

/**
 * 문서 전체를 봐야 하는 http 규칙을 검증한다.
 *
 * route-decl을 담은 문서는 dispatch를 선언해야 한다. catch-all 접두사 decl은 같은 문서에
 * 원본 `{**}` decl(같은 method·symbol.usr, 접두사 + `/{**}` 템플릿)이 있어야 한다 — 원본 없는
 * 접두사 decl은 생산자가 지어낸 선언이라 거짓 match를 만든다.
 */
function validateRouteDocumentFacts(document: BridgeFactsDocument): void {
  if (document.dispatch === undefined && document.facts.some(({ kind }) => kind === 'route-decl')) {
    fail('Http documents with route-decl facts require dispatch.');
  }
  const originals = new Set(document.facts
    .filter((fact) => fact.kind === 'route-decl' && !fact.dynamic && fact.catchAllPrefix === undefined)
    .map((fact) => JSON.stringify([fact.method, fact.symbol?.usr ?? null, fact.channel])));
  document.facts.forEach((fact, index) => {
    if (fact.catchAllPrefix !== true) return;
    const channel = fact.channel as string;
    const original = channel === '/' ? '/{**}' : `${channel}/{**}`;
    if (!originals.has(JSON.stringify([fact.method, fact.symbol!.usr!, original]))) {
      fail(`A catch-all prefix declaration has no matching {**} declaration at index ${index}.`);
    }
  });
}

/** 호출 측과 수신 측 플랫폼이 주어진 target 안에서 생산할 수 있는 fact 종류인지 확인한다. */
function isFactKindForPlatformTarget(
  platform: unknown,
  target: unknown,
  kind: unknown,
): boolean {
  // http 도메인은 역할을 platform이 아니라 kind로 정한다. kotlin·js는 서버와 클라이언트를
  // 겸할 수 있으므로 (kind, platform) 조합표만 허용한다.
  if (target === 'http') {
    return routeKindPlatforms.get(kind)?.has(platform) ?? false;
  }
  if (routeFactKinds.has(kind)) return false;
  // persistence 도메인에서는 sql이 유일한 수신 측이고 나머지 플랫폼은 모두
  // 코드 쪽 관계 참조를 내는 호출 측이다.
  if (target === 'persistence') {
    return platform === 'sql'
      ? kind === 'relation-decl'
      : kind === 'relation-use';
  }
  // bridge target의 go는 호출·수신 어느 쪽 종류도 허용하지 않는다 — cgo/
  // gomobile 같은 심볼 경계 interop은 정적 채널 키로 귀속할 수 없어
  // unscanned-ffi-interop limitation으로만 신고한다. sql은 bridge 도메인에
  // 없다.
  if (platform === 'sql' || platform === 'openapi') return false;
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

/**
 * bridge 도메인 판정에 필요한 문서(또는 그 문서가 낸 한계)의 두 필드다.
 * `JoinLimitation`처럼 문서에서 파생된 값도 같은 규칙으로 판정할 수 있게 구조 타입으로 둔다.
 */
export interface BridgeDomainCandidate {
  readonly platform: string;
  readonly target: BridgeTarget | null;
}

/**
 * 문서가 bridge 도메인(Flutter·React Native·Capacitor 경계)에 속하는지 판정한다.
 *
 * 규칙: target이 bridge target(flutter·react-native·capacitor)이거나, target이 null이고
 * platform이 bridge 플랫폼(dart·js·swift·kotlin)인 문서다. 사실이 없는 문서는 target을
 * 가질 수 없으므로(`target null ⟺ facts 빈`) 그 플랫폼을 분석했다는 근거로 인정하던
 * 기존 규칙을 보존한다. persistence target 문서(과 앞으로 추가될 다른 도메인 문서)는
 * platform이 같아도 bridge 호출·수신 어느 쪽 요건도 채우지 못한다 — kotlin·swift·dart는
 * 여러 도메인의 생산자라서 platform만으로 역할을 정하면 다른 도메인 문서가 bridge 근거로 샌다.
 * 역할 판정은 모두 이 함수와 아래 두 파생 함수를 거쳐야 한다.
 */
export function isBridgeDomainDocument(document: BridgeDomainCandidate): boolean {
  if (document.target !== null) return bridgeDomainTargets.has(document.target);
  return isCallerPlatform(document.platform) || isReceiverPlatform(document.platform);
}

/** bridge 도메인 문서이면서 호출 측(dart·js) 플랫폼인지 확인한다. */
export function isBridgeCallerDocument(document: BridgeDomainCandidate): boolean {
  return isBridgeDomainDocument(document) && isCallerPlatform(document.platform);
}

/** bridge 도메인 문서이면서 수신 측(swift·kotlin) 플랫폼인지 확인한다. */
export function isBridgeReceiverDocument(document: BridgeDomainCandidate): boolean {
  return isBridgeDomainDocument(document) && isReceiverPlatform(document.platform);
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
export function validateSourceLanguage(value: unknown, platform: unknown, location: BridgeLocation | undefined,
  symbol: BridgeSymbol | undefined, index: number): void {
  if (value !== undefined && (value !== 'objective-c' || platform !== 'swift' ||
    location === undefined || !/\.(?:m|mm)$/u.test(location.path) ||
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
const bridgePlatforms = new Set<unknown>([
  'dart', 'swift', 'kotlin', 'js', 'go', 'rust', 'sql', 'openapi',
]);

/** 지원하는 경계 메커니즘 집합이다. */
const bridgeTargets = new Set<unknown>([
  'flutter',
  'react-native',
  'capacitor',
  'persistence',
  'http',
]);

/** bridge 도메인에 속하는 target이다. persistence는 코드↔스키마라 여기에 없다. */
const bridgeDomainTargets = new Set<BridgeTarget>([
  'flutter',
  'react-native',
  'capacitor',
]);

/** http target 문서를 낼 수 있는 플랫폼이다. go·rust·sql의 http 사실은 아직 합의 전이다. */
const httpPlatforms = new Set<unknown>(['kotlin', 'swift', 'dart', 'js', 'openapi']);

/** http 도메인의 사실 종류다. */
type RouteFactKind = 'route-decl' | 'route-call' | 'route-contract';

/** http 도메인의 사실 종류 집합이다. */
const routeFactKinds = new Set<unknown>(['route-decl', 'route-call', 'route-contract']);

/**
 * (kind, platform) 허용 조합이다. 역할은 kind로 정한다. swift route-decl(Vapor 등)과
 * python은 생산자가 생길 때 합의하므로 아직 없다.
 */
const routeKindPlatforms = new Map<unknown, ReadonlySet<unknown>>([
  ['route-decl', new Set(['kotlin', 'js'])],
  ['route-call', new Set(['kotlin', 'swift', 'dart', 'js'])],
  ['route-contract', new Set(['openapi'])],
]);

/** http 문서에만 올 수 있는 문서 수준 필드다. */
const routeDocumentFieldNames = ['roles', 'dispatch', 'sourceSets', 'service'] as const;

/** route 사실의 선택 필드와 그 필드를 가질 수 있는 kind다. */
const routeFieldKinds: ReadonlyArray<readonly [string, ReadonlySet<RouteFactKind>]> = [
  ['methodDynamic', new Set(['route-call'])],
  ['authority', new Set(['route-call'])],
  ['baseRef', new Set(['route-call'])],
  ['queryTailStripped', new Set(['route-call'])],
  ['channelPrefix', new Set(['route-call'])],
  ['maskedSegments', new Set(['route-call'])],
  ['trailingSlash', new Set(['route-decl'])],
  ['caseInsensitive', new Set(['route-decl'])],
  ['narrowed', new Set(['route-decl'])],
  ['paramConstraints', new Set(['route-decl'])],
  ['configDefault', new Set(['route-decl'])],
  ['catchAllPrefix', new Set(['route-decl'])],
  ['operationId', new Set(['route-contract', 'route-call'])],
  ['testSource', new Set(['route-decl', 'route-call'])],
];

/**
 * route 사실이 아닌 사실에 실리면 거부하는 route 필드 이름이다(`order` 포함).
 *
 * `channelPrefix`는 빠진다. v2 메시지 계약이 같은 이름을 정의하고, 기존 v1 persistence
 * 생산자가 이미 모르는 필드로 싣고 있어(v1은 정의되지 않은 필드를 버린다) 거부하면
 * 배포된 생산자 문서가 깨진다.
 */
const routeFieldNames = [
  'pathAnchor', 'service', 'order',
  ...routeFieldKinds.map(([field]) => field).filter((field) => field !== 'channelPrefix'),
];

/** route 사실에 올 수 없는 다른 kind 전용 필드다. */
const nonRouteFieldNames = ['mechanism', 'optional', 'sourceLanguage', 'handlerScope', 'dependencies'] as const;

/** 비어 있지 않은 안전 문자열이어야 하는 route 필드다. */
const routeStringFields = ['authority', 'baseRef', 'service', 'operationId'] as const;

/** 존재 자체가 증거라 `true`만 허용하는 route 필드다. */
const routeTrueFlags = [
  'caseInsensitive', 'narrowed', 'configDefault', 'catchAllPrefix', 'queryTailStripped', 'testSource',
] as const;

/** route-call·route-contract가 쓸 수 있는 HTTP 동사다. */
const routeMethods = new Set<unknown>(httpMethods);

/** route-decl이 쓸 수 있는 동사다. `ANY`는 method 없는 서버 매핑이다. */
const routeDeclMethods = new Set<unknown>([...httpMethods, 'ANY' satisfies RouteMethod]);

/** 경로 제약 종류다. 닫힌 종류(int·uuid·slug)만 매칭에서 평가한다. */
const paramConstraintKinds = new Set<unknown>(['int', 'uuid', 'slug', 'path', 'regex']);

/**
 * route-call authority 형식이다. userinfo·scheme·경로 없이 소문자 host와 선택 포트만 받는다.
 * 대소문자를 접어 주지 않고 거부해 생산자 사이의 정규화 차이가 귀속을 가르지 않게 한다.
 */
const authorityPattern = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*|\[[0-9a-f:.]+\])(?::[0-9]{1,5})?$/u;

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
  'relation-use',
  'relation-decl',
  'route-decl',
  'route-call',
  'route-contract',
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

/** method 필드가 선택인 사실 종류다 — persistence 도메인에서는 컬럼 이름이다. */
const optionalMethodFactKinds = new Set<unknown>([
  'relation-use',
  'relation-decl',
]);

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
