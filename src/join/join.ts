import type {
  BridgeFact,
  BridgeFactsDocument,
  BridgeHandlerDependency,
  BridgeHandlerScope,
  BridgeLocation,
  BridgeMechanism,
  BridgePlatform,
  BridgeSymbol,
  BridgeSourceLanguage,
  BridgeTarget,
} from '../exchange/parse.ts';
import { compareStrings } from '../compare.ts';
import {
  isBridgeCallerDocument,
  isBridgeDomainDocument,
  isBridgeReceiverDocument,
} from '../exchange/parse.ts';

/** 한 언어 문서가 제공한 브리지 증거 위치다. */
export interface BridgeEndpoint {
  readonly platform: BridgePlatform;
  /** `relation-decl` 증거는 live catalog 객체라 소스 위치가 없을 수 있다. */
  readonly location?: BridgeLocation;
  readonly symbol?: BridgeSymbol;
  readonly sourceLanguage?: BridgeSourceLanguage;
  /**
   * 이름 경계 증거가 속한 해석 경로다. `react-native` 사실만 가질 수 있고
   * 생략은 `core`다. mechanism이 다른 호출·수신 쌍의 불일치 판정 근거다.
   */
  readonly mechanism?: BridgeMechanism;
  /**
   * 호출 API가 모듈 부재를 허용한다는 호출 측 증거다.
   * `module-import`에만 온다 — 부재 시 크래시가 아니라 `null` 반환이다.
   */
  readonly optional?: boolean;
  /** method-handle 분기 근거다. v2 handler 사실과 같은 형태를 공유한다. */
  readonly handlerScope?: BridgeHandlerScope;
  readonly dependencies?: readonly BridgeHandlerDependency[];
}

/** 논리 채널 하나에 모인 양쪽 생성·등록 증거다. */
export interface MatchedChannel {
  readonly target: BridgeTarget;
  readonly channel: string;
  readonly creations: readonly BridgeEndpoint[];
  readonly registrations: readonly BridgeEndpoint[];
}

/** 등록을 찾지 못한 논리 채널과 모든 생성 증거다. */
export interface UnregisteredChannelCreation {
  readonly target: BridgeTarget;
  readonly channel: string;
  readonly creations: readonly BridgeEndpoint[];
}

/** 생성을 찾지 못한 논리 채널과 모든 등록 증거다. */
export interface RegistrationWithoutCreation {
  readonly target: BridgeTarget;
  readonly channel: string;
  readonly registrations: readonly BridgeEndpoint[];
}

/** 논리 메서드 하나에 모인 양쪽 호출·핸들러 증거다. */
export interface MatchedMethod {
  readonly target: BridgeTarget;
  readonly channel: string;
  readonly method: string;
  readonly invocations: readonly BridgeEndpoint[];
  readonly handlers: readonly BridgeEndpoint[];
}

/** 핸들러를 찾지 못한 논리 호출과 모든 호출 증거다. */
export interface UnhandledInvocation {
  readonly target: BridgeTarget;
  readonly channel: string;
  readonly method: string;
  readonly invocations: readonly BridgeEndpoint[];
}

/** 호출자를 찾지 못한 논리 핸들러와 모든 네이티브 증거다. */
export interface HandlerWithoutInvocation {
  readonly target: BridgeTarget;
  readonly channel: string;
  readonly method: string;
  readonly handlers: readonly BridgeEndpoint[];
}

/**
 * 논리 모듈·컴포넌트 이름 하나에 모인 호출 측·수신 측 증거다.
 *
 * 호출 측은 `module-import`·`component-require`, 수신 측은 `module-export`·
 * `component-export` 사실이다. `channel` 필드에는 RN 모듈·컴포넌트 이름이 든다.
 */
export interface MatchedBoundaryName {
  readonly target: BridgeTarget;
  readonly channel: string;
  readonly callers: readonly BridgeEndpoint[];
  readonly receivers: readonly BridgeEndpoint[];
}

/**
 * 수신 측 export를 찾지 못한 논리 이름과 모든 호출 측 증거다.
 *
 * `incompatibleReceivers`는 같은 이름으로 관찰됐지만 mechanism이 달라
 * 이 호출들에게 도달할 수 없는 수신 측 증거다. 이름이 아예 없는 경우와
 * 구분해 보고 층이 불일치 경고로 내린다.
 */
export interface UnexportedBoundaryName {
  readonly target: BridgeTarget;
  readonly channel: string;
  readonly callers: readonly BridgeEndpoint[];
  readonly incompatibleReceivers?: readonly BridgeEndpoint[];
}

/**
 * 호출 측 import·require를 찾지 못한 논리 이름과 모든 수신 측 증거다.
 *
 * `incompatibleCallers`는 같은 이름으로 관찰됐지만 mechanism이 달라
 * 이 수신들에게 도달할 수 없는 호출 측 증거다. 호출이 아예 없는 경우와
 * 구분해 보고 층이 불일치 경고로 내린다.
 */
export interface UnrequiredBoundaryName {
  readonly target: BridgeTarget;
  readonly channel: string;
  readonly receivers: readonly BridgeEndpoint[];
  readonly incompatibleCallers?: readonly BridgeEndpoint[];
}

/**
 * 생산 문서가 밝힌 분석 한계와 출처다.
 *
 * `target`은 이 한계를 신고한 문서의 브리지 메커니즘이다. 사실은 target별로만
 * 조인되므로, 보고서는 이 값으로 한계를 해당 target의 진단에만 귀속시킨다.
 * 사실이 없는 문서의 한계, 선언한 target을 신뢰할 수 없는 mixed-targets 문서의
 * 한계, 교차 입력 한계는 어느 target이 가려졌는지 특정할 수 없어 `null`이다.
 */
export interface JoinLimitation {
  readonly platform: BridgePlatform | 'cross-platform';
  readonly target: BridgeTarget | null;
  readonly tool: string;
  readonly message: string;
  readonly channels?: readonly string[];
  /** 소비자가 직접 센 한계에만 부여하며 생산 문서에서는 복사하지 않는다. */
  readonly origin?: 'consumer';
}

/** 논리 관계 이름 하나에 모인 코드 참조·스키마 선언 증거다. channel은 선언 측 한정 이름이다. */
export interface MatchedRelation {
  readonly target: BridgeTarget;
  readonly channel: string;
  readonly uses: readonly BridgeEndpoint[];
  readonly decls: readonly BridgeEndpoint[];
}

/** 선언을 찾지 못한 논리 관계 이름과 모든 코드 참조 증거다. */
export interface RelationUseWithoutDecl {
  readonly target: BridgeTarget;
  readonly channel: string;
  readonly uses: readonly BridgeEndpoint[];
}

/** 코드 참조를 찾지 못한 논리 관계 이름과 모든 선언 증거다. */
export interface RelationDeclWithoutUse {
  readonly target: BridgeTarget;
  readonly channel: string;
  readonly decls: readonly BridgeEndpoint[];
}

/**
 * 비한정 이름이 여러 스키마의 선언과 동시에 맞아 어느 객체인지 추측하지 못한
 * 사용이다. match도 missing도 아니며 후보 한정 이름을 함께 낸다.
 */
export interface AmbiguousRelationUse {
  readonly target: BridgeTarget;
  readonly channel: string;
  readonly uses: readonly BridgeEndpoint[];
  readonly candidates: readonly string[];
}

/** 논리 (관계, 컬럼) 하나에 모인 참조·선언 증거다. channel은 선언 측 한정 관계다. */
export interface MatchedColumn {
  readonly target: BridgeTarget;
  readonly channel: string;
  readonly column: string;
  readonly uses: readonly BridgeEndpoint[];
  readonly decls: readonly BridgeEndpoint[];
}

/** 관계는 맞았지만 그 안에 컬럼 선언이 없는 참조다. */
export interface ColumnUseWithoutDecl {
  readonly target: BridgeTarget;
  readonly channel: string;
  readonly column: string;
  readonly uses: readonly BridgeEndpoint[];
}

/** 검증된 교환 문서들의 논리 조인 결과다. */
export interface BridgeJoinResult {
  readonly deferred: boolean;
  /** 입력 문서 전체가 관찰한 fact 수다. 조인 여부와 무관한 관찰량이다. */
  readonly observedFacts: number;
  readonly matchedChannels: readonly MatchedChannel[];
  readonly unregisteredChannelCreations: readonly UnregisteredChannelCreation[];
  readonly registrationsWithoutCreations: readonly RegistrationWithoutCreation[];
  readonly matchedMethods: readonly MatchedMethod[];
  readonly unhandledInvocations: readonly UnhandledInvocation[];
  readonly handlersWithoutInvocations: readonly HandlerWithoutInvocation[];
  readonly matchedModules: readonly MatchedBoundaryName[];
  readonly moduleImportsWithoutExports: readonly UnexportedBoundaryName[];
  readonly moduleExportsWithoutImports: readonly UnrequiredBoundaryName[];
  readonly matchedComponents: readonly MatchedBoundaryName[];
  readonly componentRequiresWithoutExports: readonly UnexportedBoundaryName[];
  readonly componentExportsWithoutRequires: readonly UnrequiredBoundaryName[];
  readonly matchedRelations: readonly MatchedRelation[];
  readonly relationUsesWithoutDecls: readonly RelationUseWithoutDecl[];
  readonly ambiguousRelationUses: readonly AmbiguousRelationUse[];
  readonly relationDeclsWithoutUses: readonly RelationDeclWithoutUse[];
  readonly matchedColumns: readonly MatchedColumn[];
  readonly columnUsesWithoutDecls: readonly ColumnUseWithoutDecl[];
  readonly limitations: readonly JoinLimitation[];
}

/** 한 번의 조인에서 허용하는 최대 생산 문서 수다. */
export const MAX_DOCUMENTS_PER_JOIN = 256;

/** 함께 조인할 입력 문서 집합이 논리 계약을 위반했음을 나타낸다. */
export class BridgeJoinValidationError extends Error {
  /** 입력 경로를 노출하지 않는 안전한 메시지를 보존한다. */
  constructor(message: string) {
    super(message);
    this.name = 'BridgeJoinValidationError';
  }
}

/** 위치가 아니라 문자열 키로 검증된 교환 문서를 조인한다. */
export function joinBridgeDocuments(
  documents: readonly BridgeFactsDocument[],
): BridgeJoinResult {
  if (documents.length > MAX_DOCUMENTS_PER_JOIN) {
    throw new BridgeJoinValidationError(
      `Bridge join exceeds the ${MAX_DOCUMENTS_PER_JOIN} document limit.`,
    );
  }
  validateProjects(documents);
  validatePlatformComposition(documents);
  const limitations = collectLimitations(documents);
  const observedFacts = documents.reduce(
    (total, document) => total + document.facts.length,
    0,
  );
  if (documents.some(hasMixedTargets)) {
    return emptyJoinResult(limitations, observedFacts);
  }
  const groups = collectChannelGroups(documents);
  const matchedChannels = [...groups.values()]
    .filter((group) => group.creations.length > 0 && group.registrations.length > 0)
    .sort(compareChannels);
  const unregisteredChannelCreations = [...groups.values()]
    .filter((group) => group.creations.length > 0 && group.registrations.length === 0)
    .map(({ target, channel, creations }) => ({ target, channel, creations }))
    .sort(compareChannels);
  const registrationsWithoutCreations = [...groups.values()]
    .filter((group) => group.registrations.length > 0 && group.creations.length === 0)
    .map(({ target, channel, registrations }) => ({
      target,
      channel,
      registrations,
    }))
    .sort(compareChannels);
  const methodGroups = collectMethodGroups(documents);
  const matchedMethods = [...methodGroups.values()]
    .filter((group) => group.invocations.length > 0 && group.handlers.length > 0)
    .sort(compareMethodKeys);
  const unhandledInvocations = [...methodGroups.values()]
    .filter((group) => group.invocations.length > 0 && group.handlers.length === 0)
    .map(({ target, channel, method, invocations }) => ({
      target,
      channel,
      method,
      invocations,
    }))
    .sort(compareMethodKeys);
  const handlersWithoutInvocations = [...methodGroups.values()]
    .filter((group) => group.handlers.length > 0 && group.invocations.length === 0)
    .map(({ target, channel, method, handlers }) => ({
      target,
      channel,
      method,
      handlers,
    }))
    .sort(compareMethodKeys);
  const moduleGroups = collectNameGroups(documents, 'module-import', 'module-export');
  const componentGroups = collectNameGroups(documents, 'component-require', 'component-export');
  const moduleNames = classifyNameGroups(moduleGroups, 'module-import');
  const componentNames = classifyNameGroups(componentGroups, 'component-require');
  const relations = joinRelationFacts(documents);
  return {
    deferred: false,
    observedFacts,
    matchedChannels,
    unregisteredChannelCreations,
    registrationsWithoutCreations,
    matchedMethods,
    unhandledInvocations,
    handlersWithoutInvocations,
    matchedModules: moduleNames.matched,
    moduleImportsWithoutExports: moduleNames.unexported,
    moduleExportsWithoutImports: moduleNames.unrequired,
    matchedComponents: componentNames.matched,
    componentRequiresWithoutExports: componentNames.unexported,
    componentExportsWithoutRequires: componentNames.unrequired,
    matchedRelations: relations.matchedRelations,
    relationUsesWithoutDecls: relations.relationUsesWithoutDecls,
    ambiguousRelationUses: relations.ambiguousRelationUses,
    relationDeclsWithoutUses: relations.relationDeclsWithoutUses,
    matchedColumns: relations.matchedColumns,
    columnUsesWithoutDecls: relations.columnUsesWithoutDecls,
    limitations,
  };
}

/** 입력 한계 때문에 조인 전체가 보류된 결과인지 확인한다. */
export function isBridgeJoinDeferred(joined: BridgeJoinResult): boolean {
  return joined.deferred;
}

/** 한 번의 조인 입력이 정확히 하나의 project를 기술하는지 검증한다. */
function validateProjects(documents: readonly BridgeFactsDocument[]): void {
  if (new Set(documents.map(({ project }) => project)).size > 1) {
    throw new BridgeJoinValidationError(
      'Bridge documents must describe the same project; regenerate them from one project root.',
    );
  }
}

/** 호출 측·수신 측 문서가 모두 있어야 경계 사실로 조인할 수 있다 — 도메인별로 검사한다. */
function validatePlatformComposition(
  documents: readonly BridgeFactsDocument[],
): void {
  // 사실이 없는 sql 문서(target null)는 persistence 도메인을 만들지 않는다 —
  // 선언이 없는 카탈로그가 bridge-only 조인을 막는 일이 없게 한다. 파싱이
  // `target null ⟺ facts 빈`을 강제하므로(`parse.ts`의 target 검사) target만
  // 보면 되고, 사실 있는 null-target 문서는 여기 도달하기 전에 거절된다.
  const hasPersistenceDomain = documents.some(
    (document) => document.target === 'persistence',
  );
  // bridge 역할은 platform이 아니라 명시 규칙(`isBridgeDomainDocument`)으로 정한다 —
  // kotlin·swift·dart persistence 문서가 bridge 호출·수신 요건을 채우지 못하게 한다.
  const bridgeDocuments = documents.filter(isBridgeDomainDocument);
  // persistence 도메인이 없으면(도메인이 하나도 성립하지 않는 입력 포함) bridge 구성
  // 규칙을 그대로 적용하고, 혼합 입력이면 bridge 문서가 있을 때만 적용한다.
  if (!hasPersistenceDomain || bridgeDocuments.length > 0) {
    validateBridgeComposition(bridgeDocuments, hasPersistenceDomain);
  }
  if (!hasPersistenceDomain) return;
  // persistence 도메인: sql 선언 문서 하나와, 이 경계를 실제로 스캔한
  // (target이 persistence인) 비sql 호출 측 문서 하나를 요구한다. target이
  // null인 문서는 이 도메인의 호출 측으로 세지 않는다 — 스키마 경계를
  // 보지 않은 문서를 "참조 없음"으로 읽으면 모든 선언이 거짓 미사용이 된다.
  const hasSqlDecls = documents.some(({ platform }) => platform === 'sql');
  const hasPersistenceCaller = documents.some(
    (document) => document.target === 'persistence' && document.platform !== 'sql',
  );
  if (!hasSqlDecls || !hasPersistenceCaller) {
    throw new BridgeJoinValidationError(
      'Persistence documents must include at least one sql declaration document '
      + 'and one non-sql caller document with the persistence target; run a producer for the missing side.',
    );
  }
}

/**
 * bridge 도메인 문서에 호출 측과 수신 측이 각각 하나 이상 있는지 검사한다.
 *
 * persistence 입력과 섞였는데 bridge 문서가 모두 사실 0건(target null)이면, 대개
 * kartograph·cartograph·dartograph `schema`가 관계 사용을 하나도 찾지 못한 문서다.
 * 사실이 없으면 target을 실을 수 없어 bridge 문서와 구분되지 않으므로, 일반 문구
 * 대신 그 원인을 알려 빈 문서를 빼거나 빠진 bridge 쪽을 생산하게 한다.
 */
function validateBridgeComposition(
  bridgeDocuments: readonly BridgeFactsDocument[],
  hasPersistenceDomain: boolean,
): void {
  const hasCaller = bridgeDocuments.some(isBridgeCallerDocument);
  const hasReceiver = bridgeDocuments.some(isBridgeReceiverDocument);
  if (hasCaller && hasReceiver) return;
  const requirement = 'Bridge documents must include at least one caller platform (dart, js) document '
    + 'and one receiver platform (swift, kotlin) document; ';
  if (hasPersistenceDomain && bridgeDocuments.every(({ target }) => target === null)) {
    throw new BridgeJoinValidationError(
      `${requirement}every bridge-platform document here has no facts, and a document without facts `
      + 'carries a null target that counts as a bridge document even when a persistence producer wrote it. '
      + 'Remove the empty document or run a producer for the missing bridge side.',
    );
  }
  throw new BridgeJoinValidationError(`${requirement}run a producer for the missing side.`);
}

/** 사실별 target이 없는 혼합 문서인지 확인한다. */
function hasMixedTargets(document: BridgeFactsDocument): boolean {
  // 단어 경계로 판정한다. 낱말 안에 붙은 표기("non-mixed-targets workspaces",
  // "mixed-targets-like")는 문구 변형이 아니라 다른 낱말이라 보류의 근거가 못 된다.
  // 앞 공백·대소문자·콜론 누락 변형은 계속 보수적으로 인정한다.
  return document.limitations.some((message) =>
    mixedTargetToken.test(message),
  );
}

/** 문구 변형을 인정하는 mixed-targets 토큰 경계다. */
const mixedTargetToken = /(?<![\w-])mixed-targets(?![\w-])/i;

/**
 * 한계를 귀속시킬 target을 결정한다.
 *
 * mixed-targets 문서의 선언 target은 대표값일 뿐 사실별 메커니즘을 복원할 수
 * 없으므로, 그 문서의 한계와 조인 제외 사실 계수는 귀속 없이(null) 남긴다.
 * 귀속을 잃어도 관찰 자체는 보존해야 한다.
 */
function limitationTarget(document: BridgeFactsDocument): BridgeTarget | null {
  return hasMixedTargets(document) ? null : document.target;
}

/**
 * v1 사실이 없는 입력에서 v2 전용 보고를 만들 때 쓰는 빈 결과다.
 *
 * 조인을 보류하지 않는다 — 사실이 아예 없었을 뿐이므로 보류와 구분한다.
 */
export function emptyBridgeJoinResult(): BridgeJoinResult {
  return {
    deferred: false,
    observedFacts: 0,
    matchedChannels: [],
    unregisteredChannelCreations: [],
    registrationsWithoutCreations: [],
    matchedMethods: [],
    unhandledInvocations: [],
    handlersWithoutInvocations: [],
    matchedModules: [],
    moduleImportsWithoutExports: [],
    moduleExportsWithoutImports: [],
    matchedComponents: [],
    componentRequiresWithoutExports: [],
    componentExportsWithoutRequires: [],
    matchedRelations: [],
    relationUsesWithoutDecls: [],
    ambiguousRelationUses: [],
    relationDeclsWithoutUses: [],
    matchedColumns: [],
    columnUsesWithoutDecls: [],
    limitations: [],
  };
}

/** 안전하게 조인을 보류하면서 입력 한계만 전달한다. 관찰량은 보존한다. */
function emptyJoinResult(
  limitations: readonly JoinLimitation[],
  observedFacts: number,
): BridgeJoinResult {
  return {
    deferred: true,
    observedFacts,
    matchedChannels: [],
    unregisteredChannelCreations: [],
    registrationsWithoutCreations: [],
    matchedMethods: [],
    unhandledInvocations: [],
    handlersWithoutInvocations: [],
    matchedModules: [],
    moduleImportsWithoutExports: [],
    moduleExportsWithoutImports: [],
    matchedComponents: [],
    componentRequiresWithoutExports: [],
    componentExportsWithoutRequires: [],
    matchedRelations: [],
    relationUsesWithoutDecls: [],
    ambiguousRelationUses: [],
    relationDeclsWithoutUses: [],
    matchedColumns: [],
    columnUsesWithoutDecls: [],
    limitations,
  };
}

/** 입력 limitation에 생산 플랫폼과 도구 이름을 붙이고 조인하지 못한 사실을 함께 센다. */
function collectLimitations(
  documents: readonly BridgeFactsDocument[],
): JoinLimitation[] {
  const limitations: JoinLimitation[] = documents.flatMap((document) => {
    const scopes = new Map(document.limitationScopes?.map((scope) => [scope.limitationIndex, scope.channels]));
    return document.limitations.map((message, index) => {
      const channels = scopes.get(index);
      return {
        platform: document.platform,
        target: limitationTarget(document),
        tool: document.tool.name,
        message,
        ...(channels === undefined ? {} : { channels }),
      };
    });
  });
  limitations.push(...unjoinedFactLimitations(documents));
  const freshness = freshnessLimitation(documents);
  if (freshness !== undefined) limitations.push(freshness);
  return limitations.sort(compareLimitations);
}

/**
 * 조인에서 제외한 사실을 isthmus 자신의 관찰 한계로 남긴다.
 *
 * 생산자가 같은 사실을 limitation으로 신고하지 않아도, 또는 신고한 개수가 실제와
 * 달라도 관찰 공백이 보고서에서 사라지지 않아야 한다. 교환 계약은 이 사실들을
 * 세도록 요구하지만 문서의 limitation 문자열은 생산자의 자발적인 신고라
 * 소비자가 신뢰의 근거로 삼을 수 없다.
 */
function unjoinedFactLimitations(
  documents: readonly BridgeFactsDocument[],
): JoinLimitation[] {
  return [
    ...unjoinedLimitations(
      documents,
      isUnjoinedDynamicChannel,
      'unjoined-dynamic-channels',
      'channel facts with a non-literal name',
    ),
    ...unjoinedLimitations(
      documents,
      isUnjoinedDynamicMethod,
      'unjoined-dynamic-methods',
      'method facts with a non-literal name',
    ),
    ...unjoinedLimitations(
      documents,
      isUnattributedHandler,
      'unjoined-unattributed-handlers',
      'method handler facts without a channel',
    ),
    ...unjoinedLimitations(
      documents,
      isUnjoinedDynamicImport,
      'unjoined-dynamic-imports',
      'module import or component require facts with a non-literal name',
    ),
    ...unjoinedLimitations(
      documents,
      isUnjoinedDynamicRelation,
      'unjoined-dynamic-relations',
      'relation use facts with a non-literal name',
    ),
    ...unjoinedLimitations(
      documents,
      isUnjoinedDynamicExport,
      'unjoined-dynamic-exports',
      'module or component export facts with a non-literal name',
    ),
  ];
}

/** 조건에 맞는 사실 수를 플랫폼·target별로 세어 한계 문장으로 바꾼다. */
function unjoinedLimitations(
  documents: readonly BridgeFactsDocument[],
  matchesFact: (fact: BridgeFact) => boolean,
  prefix: string,
  subject: string,
): JoinLimitation[] {
  return countFactsByPlatformTarget(documents, matchesFact).map(
    ({ platform, target, count }) => ({
      platform,
      target,
      tool: 'isthmus',
      origin: 'consumer',
      message: `${prefix}: ${count} ${subject} were not joined`,
    }),
  );
}

/**
 * 주어진 조건의 서로 다른 사실 수를 생산 플랫폼·target별로 모은다.
 *
 * 사실은 target별로만 조인되므로 다른 target의 사실을 한 한계로 합산하면
 * 관찰 공백의 귀속이 사라진다. mixed-targets 문서의 사실은 귀속 없이(null)
 * 센다. 사실이 없는 문서는 교환 계약상 target이 null이고 사실도 없으므로
 * 여기에서 자연스럽게 제외된다.
 */
function countFactsByPlatformTarget(
  documents: readonly BridgeFactsDocument[],
  matchesFact: (fact: BridgeFact) => boolean,
): Array<{
  platform: BridgePlatform;
  target: BridgeTarget | null;
  count: number;
}> {
  const distinctFacts = new Map<
    string,
    {
      platform: BridgePlatform;
      target: BridgeTarget | null;
      keys: Set<string>;
    }
  >();
  for (const document of documents) {
    const target = limitationTarget(document);
    // BridgeTarget은 닫힌 어휘라 문자열화된 null과 충돌하지 않는다.
    const groupKey = `${document.platform}\u0000${target}`;
    for (const fact of document.facts) {
      if (!matchesFact(fact)) continue;
      const group = distinctFacts.get(groupKey) ?? {
        platform: document.platform,
        target,
        keys: new Set<string>(),
      };
      group.keys.add(unjoinedFactKey(fact));
      distinctFacts.set(groupKey, group);
    }
  }
  return [...distinctFacts.values()].map(({ platform, target, keys }) => ({
    platform,
    target,
    count: keys.size,
  }));
}

/**
 * 같은 위치의 중복 사실을 한 번만 세는 키를 만든다.
 *
 * 위치 기준은 증거 dedup과 같지만 symbol은 비교하지 않아, 같은 위치의 서로
 * 다른 symbol은 하나로 센다. `channel`은 null일 수 있어 구분자 결합 대신
 * JSON으로 만든다. 그래야 미귀속 핸들러와 이름이 `null`인 채널의 사실이
 * 같은 키로 합쳐지지 않는다.
 */
function unjoinedFactKey(fact: BridgeFact): string {
  const location = fact.location;
  return JSON.stringify([
    fact.kind,
    fact.channel,
    fact.method ?? null,
    location?.path ?? null,
    location?.line ?? null,
    location?.column ?? null,
  ]);
}

/** 이름이 리터럴이 아니어서 조인하지 못한 채널 사실인지 확인한다. */
function isUnjoinedDynamicChannel(fact: BridgeFact): boolean {
  return (
    fact.dynamic &&
    (fact.kind === 'channel-create' || fact.kind === 'channel-register')
  );
}

/** 이름이 리터럴이 아니어서 조인하지 못한 메서드 사실인지 확인한다. */
function isUnjoinedDynamicMethod(fact: BridgeFact): boolean {
  return (
    fact.dynamic &&
    (fact.kind === 'method-invoke' || fact.kind === 'method-handle')
  );
}

/**
 * 어느 채널에 속하는지 몰라 조인하지 못한 핸들러 사실인지 확인한다.
 *
 * dynamic 사실은 위에서 이미 세므로 여기서 다시 세지 않는다.
 */
function isUnattributedHandler(fact: BridgeFact): boolean {
  return fact.kind === 'method-handle' && fact.channel === null && !fact.dynamic;
}

/** 이름이 리터럴이 아니어서 조인하지 못한 모듈 import·컴포넌트 require 사실인지 확인한다. */
function isUnjoinedDynamicImport(fact: BridgeFact): boolean {
  return (
    fact.dynamic &&
    (fact.kind === 'module-import' || fact.kind === 'component-require')
  );
}

/** 이름이 리터럴이 아니어서 조인하지 못한 모듈·컴포넌트 export 사실인지 확인한다. */
function isUnjoinedDynamicExport(fact: BridgeFact): boolean {
  return (
    fact.dynamic &&
    (fact.kind === 'module-export' || fact.kind === 'component-export')
  );
}

/** 관계 이름이 리터럴이 아니어서 조인하지 못한 코드 참조 사실인지 확인한다. */
function isUnjoinedDynamicRelation(fact: BridgeFact): boolean {
  return fact.dynamic && fact.kind === 'relation-use';
}

/** 생성 시각 차이가 하루를 넘을 때 교차 입력 한계를 만든다. */
function freshnessLimitation(
  documents: readonly BridgeFactsDocument[],
): JoinLimitation | undefined {
  if (documents.length < 2) return undefined;
  let earliest = Number.POSITIVE_INFINITY;
  let latest = Number.NEGATIVE_INFINITY;
  for (const document of documents) {
    const timestamp = Date.parse(document.generatedAt);
    earliest = Math.min(earliest, timestamp);
    latest = Math.max(latest, timestamp);
  }
  const difference = latest - earliest;
  if (difference <= millisecondsPerDay) return undefined;
  const hours = Math.round(difference / millisecondsPerHour);
  return {
    platform: 'cross-platform',
    target: null,
    tool: 'isthmus',
    origin: 'consumer',
    message: `input-freshness: bridge documents differ by ${hours} hours`,
  };
}

/** limitation을 플랫폼·target·도구·문장 순으로 고정한다. */
export function compareLimitations(left: JoinLimitation, right: JoinLimitation): number {
  return (
    compareStrings(left.platform, right.platform) ||
    compareTargets(left.target, right.target) ||
    compareStrings(left.tool, right.tool) ||
    compareStrings(left.message, right.message) ||
    compareOptionalStrings(left.origin, right.origin) ||
    compareStrings(JSON.stringify(left.channels ?? null), JSON.stringify(right.channels ?? null))
  );
}

/** target을 문자열 순으로 고정하고 귀속이 없는(null) 한계를 뒤에 둔다. */
function compareTargets(
  left: BridgeTarget | null,
  right: BridgeTarget | null,
): number {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return compareStrings(left, right);
}

/** 메서드 키별로 호출과 핸들러 증거를 모은다. */
function collectMethodGroups(
  documents: readonly BridgeFactsDocument[],
): Map<string, MutableMethodGroup> {
  const groups = new Map<string, MutableMethodGroup>();
  for (const document of documents) collectDocumentMethods(document, groups);
  for (const group of groups.values()) {
    sortUniqueEndpoints(group.invocations);
    sortUniqueEndpoints(group.handlers);
  }
  return groups;
}

/** 증거 위치와 심볼을 정렬하고 같은 증거를 한 번만 남긴다. */
function sortUniqueEndpoints(endpoints: BridgeEndpoint[]): void {
  endpoints.sort(compareEndpoints);
  if (endpoints.length < 2) return;
  let writeIndex = 1;
  for (let readIndex = 1; readIndex < endpoints.length; readIndex++) {
    const previous = endpoints[writeIndex - 1];
    const current = endpoints[readIndex];
    if (
      previous !== undefined &&
      current !== undefined &&
      compareEndpoints(previous, current) !== 0
    ) {
      endpoints[writeIndex] = current;
      writeIndex++;
    }
  }
  endpoints.length = writeIndex;
}

/**
 * 증거 위치와 선택 심볼을 완전한 결정 순서로 비교한다.
 * 보고 층이 조인 결과를 다시 묶을 때(`check --pairs`)도 같은 순서를 쓰도록 노출한다.
 */
export function compareEndpoints(left: BridgeEndpoint, right: BridgeEndpoint): number {
  const platformOrder = compareStrings(left.platform, right.platform);
  if (platformOrder !== 0) return platformOrder;
  // 카탈로그 선언처럼 위치가 없는 증거는 있는 증거 뒤에 두고, 둘 다 없으면
  // 심볼 비교로 내려간다.
  const locationOrder = left.location === undefined
    ? right.location === undefined ? 0 : 1
    : right.location === undefined
      ? -1
      : compareStrings(left.location.path, right.location.path) ||
        left.location.line - right.location.line ||
        left.location.column - right.location.column;
  if (locationOrder !== 0) return locationOrder;
  const languageOrder = compareOptionalStrings(left.sourceLanguage, right.sourceLanguage);
  if (languageOrder !== 0) return languageOrder;
  if (left.symbol === undefined) return right.symbol === undefined ? 0 : 1;
  if (right.symbol === undefined) return -1;
  return (
    compareStrings(left.symbol.qualifiedName, right.symbol.qualifiedName) ||
    compareOptionalStrings(left.symbol.usr, right.symbol.usr)
  );
}

/** 존재하는 선택 문자열을 없는 값보다 먼저 두고 비교한다. */
function compareOptionalStrings(
  left: string | undefined,
  right: string | undefined,
): number {
  if (left === undefined) return right === undefined ? 0 : 1;
  if (right === undefined) return -1;
  return compareStrings(left, right);
}

/** 문서 하나의 정적 메서드 사실을 그룹에 추가한다. */
function collectDocumentMethods(
  document: BridgeFactsDocument,
  groups: Map<string, MutableMethodGroup>,
): void {
  if (document.target === null) return;
  for (const fact of document.facts) {
    if (!isStaticMethodFact(fact)) continue;
    const key = `${document.target}\u0000${fact.channel}\u0000${fact.method}`;
    const group = groups.get(key) ?? createMethodGroup(document.target, fact.channel, fact.method);
    const endpoints = fact.kind === 'method-invoke' ? group.invocations : group.handlers;
    endpoints.push(toEndpoint(document.platform, fact));
    groups.set(key, group);
  }
}

/** 조인 가능한 정적 메서드 호출·핸들러 사실인지 확인한다. */
function isStaticMethodFact(
  fact: BridgeFactsDocument['facts'][number],
): fact is BridgeFactsDocument['facts'][number] & {
  channel: string;
  method: string;
} {
  return (
    (fact.kind === 'method-invoke' || fact.kind === 'method-handle') &&
    !fact.dynamic &&
    fact.channel !== null &&
    fact.method !== undefined
  );
}

/** 빈 메서드 그룹을 만든다. */
function createMethodGroup(
  target: BridgeTarget,
  channel: string,
  method: string,
): MutableMethodGroup {
  return { target, channel, method, invocations: [], handlers: [] };
}

/** 채널 키별로 생성과 등록 증거를 모은다. */
function collectChannelGroups(
  documents: readonly BridgeFactsDocument[],
): Map<string, MutableChannelGroup> {
  const groups = new Map<string, MutableChannelGroup>();
  for (const document of documents) collectDocumentChannels(document, groups);
  for (const group of groups.values()) {
    sortUniqueEndpoints(group.creations);
    sortUniqueEndpoints(group.registrations);
  }
  return groups;
}

/** 문서 하나의 정적 채널 사실을 그룹에 추가한다. */
function collectDocumentChannels(
  document: BridgeFactsDocument,
  groups: Map<string, MutableChannelGroup>,
): void {
  if (document.target === null) return;
  for (const fact of document.facts) {
    if (!isStaticChannelFact(fact)) continue;
    const key = `${document.target}\u0000${fact.channel}`;
    const group = groups.get(key) ?? createChannelGroup(document.target, fact.channel);
    const endpoints = fact.kind === 'channel-create' ? group.creations : group.registrations;
    endpoints.push(toEndpoint(document.platform, fact));
    groups.set(key, group);
  }
}

/** 조인 가능한 정적 채널 생성·등록 사실인지 확인한다. */
function isStaticChannelFact(
  fact: BridgeFactsDocument['facts'][number],
): fact is BridgeFactsDocument['facts'][number] & { channel: string } {
  return (
    (fact.kind === 'channel-create' || fact.kind === 'channel-register') &&
    !fact.dynamic &&
    fact.channel !== null
  );
}

/** 빈 채널 그룹을 만든다. */
function createChannelGroup(
  target: BridgeTarget,
  channel: string,
): MutableChannelGroup {
  return { target, channel, creations: [], registrations: [] };
}

/**
 * 모듈·컴포넌트 이름 키별로 호출 측·수신 측 증거를 모은다.
 *
 * RN의 `module-import`↔`module-export`와 `component-require`↔`component-export`는
 * 같은 (target, channel=모듈·컴포넌트 이름) 조인 규칙을 공유하므로 수집기를
 * 재사용한다. dynamic 사실은 조인하지 않고 소비자 계수 한계로 넘긴다.
 */
function collectNameGroups(
  documents: readonly BridgeFactsDocument[],
  callerKind: BridgeFact['kind'],
  receiverKind: BridgeFact['kind'],
): Map<string, MutableNameGroup> {
  const groups = new Map<string, MutableNameGroup>();
  for (const document of documents) {
    if (document.target === null) continue;
    for (const fact of document.facts) {
      if (fact.dynamic || fact.channel === null) continue;
      if (fact.kind !== callerKind && fact.kind !== receiverKind) continue;
      const key = `${document.target}\u0000${fact.channel}`;
      const group = groups.get(key) ?? {
        target: document.target,
        channel: fact.channel,
        callers: [],
        receivers: [],
      };
      const endpoints = fact.kind === callerKind ? group.callers : group.receivers;
      endpoints.push(toEndpoint(document.platform, fact));
      groups.set(key, group);
    }
  }
  for (const group of groups.values()) {
    sortUniqueEndpoints(group.callers);
    sortUniqueEndpoints(group.receivers);
  }
  return groups;
}

/** 이름 그룹 하나의 mechanism-aware 분류 결과다. */
interface NameClassification {
  readonly matched: MatchedBoundaryName[];
  readonly unexported: UnexportedBoundaryName[];
  readonly unrequired: UnrequiredBoundaryName[];
}

/**
 * 이름 그룹을 mechanism 규칙으로 매치·미수출·미호출로 나눈다.
 *
 * 한 이름 아래 호출자·수신자가 mechanism이 섞여 있을 수 있으므로 그룹
 * 전체가 아니라 증거 쌍 단위로 판정한다. 만족한 호출자·도달한 수신자만
 * 매치로 고정하고, 나머지는 각각 미수출·미호출 증거로 남긴다 — 한 이름이
 * 두 컬렉션에 동시에 나타날 수 있다.
 */
function classifyNameGroups(
  groups: Map<string, MutableNameGroup>,
  callerKind: 'module-import' | 'component-require',
): NameClassification {
  const compatible = (caller: BridgeEndpoint, receiver: BridgeEndpoint) =>
    boundaryCompatible(callerKind, caller, receiver);
  const matched: MatchedBoundaryName[] = [];
  const unexported: UnexportedBoundaryName[] = [];
  const unrequired: UnrequiredBoundaryName[] = [];
  for (const group of groups.values()) {
    const satisfied = group.callers.filter((caller) =>
      group.receivers.some((receiver) => compatible(caller, receiver)));
    const unsatisfied = group.callers.filter((caller) =>
      !group.receivers.some((receiver) => compatible(caller, receiver)));
    const reached = group.receivers.filter((receiver) =>
      group.callers.some((caller) => compatible(caller, receiver)));
    const unreached = group.receivers.filter((receiver) =>
      !group.callers.some((caller) => compatible(caller, receiver)));
    // 만족한 호출자가 있으면 그와 호환되는 수신자가 존재하므로 도달한
    // 수신자도 비어 있지 않다.
    if (satisfied.length > 0) {
      matched.push({
        target: group.target,
        channel: group.channel,
        callers: satisfied,
        receivers: reached,
      });
    }
    if (unsatisfied.length > 0) {
      // unsatisfied 호출자에게는 이 그룹의 수신자가 모두 도달 불가다 —
      // 호환되는 수신자가 하나라도 있었다면 그 호출자는 만족했을 것이다.
      // mechanism이 두 값뿐이라 미만족 호출자는 항상 한 mechanism으로
      // 모인다(비어 있지 않은 수신자가 한 mechanism이면 그 mechanism의
      // 호출자는 만족한다) — 호출자 mechanism 구성은 엔트리 증거에 남고
      // 보고 층이 Expo의 폴백 없는 require(error)와 코어 require의 미해결
      // 상호운용(warning)을 구분한다.
      unexported.push({
        target: group.target,
        channel: group.channel,
        callers: unsatisfied,
        ...(group.receivers.length === 0
          ? {}
          : { incompatibleReceivers: group.receivers }),
      });
    }
    if (unreached.length > 0) {
      // 도달 못한 수신자에게는 모든 호출자가 비호환이다 — 호환 호출자가
      // 있었다면 도달했을 것이다. 호출자가 있으면 mechanism 불일치 증거다.
      unrequired.push({
        target: group.target,
        channel: group.channel,
        receivers: unreached,
        ...(group.callers.length === 0
          ? {}
          : { incompatibleCallers: group.callers }),
      });
    }
  }
  matched.sort(compareChannels);
  unexported.sort(compareChannels);
  unrequired.sort(compareChannels);
  return { matched, unexported, unrequired };
}

/**
 * mechanism이 다른 호출·수신 쌍이 실제로 연결되는지 판정한다.
 *
 * `module-import`: Expo의 `requireNativeModule`·`requireOptionalNativeModule`은
 * `TurboModuleRegistry` 폴백이 있어 `expo` 호출자는 어느 mechanism의 export도
 * 만족시킨다. 코어 호출자는 코어 export만 도달한다.
 * `component-require`: `requireNativeViewManager`에는 그런 폴백이 없어
 * 같은 mechanism끼리만 잇는다. 생략된 mechanism은 `core`로 읽는다.
 */
function boundaryCompatible(
  callerKind: 'module-import' | 'component-require',
  caller: BridgeEndpoint,
  receiver: BridgeEndpoint,
): boolean {
  const callerMechanism = caller.mechanism ?? 'core';
  const receiverMechanism = receiver.mechanism ?? 'core';
  if (callerKind === 'module-import') {
    return callerMechanism === 'expo' || receiverMechanism === 'core';
  }
  return callerMechanism === receiverMechanism;
}

/** 사실을 플랫폼이 포함된 증거 위치로 바꾼다. */
function toEndpoint(
  platform: BridgePlatform,
  fact: BridgeFactsDocument['facts'][number],
): BridgeEndpoint {
  return {
    platform,
    ...(fact.location === undefined ? {} : { location: fact.location }),
    ...(fact.symbol === undefined ? {} : { symbol: fact.symbol }),
    ...(fact.mechanism === undefined ? {} : { mechanism: fact.mechanism }),
    ...(fact.optional === undefined ? {} : { optional: fact.optional }),
    ...(fact.sourceLanguage === undefined ? {} : { sourceLanguage: fact.sourceLanguage }),
    ...(fact.handlerScope === undefined ? {} : { handlerScope: fact.handlerScope, dependencies: fact.dependencies! }),
  };
}

/** 채널 결과를 target과 이름 순으로 고정한다. */
function compareChannels(left: ChannelKey, right: ChannelKey): number {
  return (
    compareStrings(left.target, right.target) ||
    compareStrings(left.channel, right.channel)
  );
}

/** 결정적 정렬에 필요한 논리 채널 키다. */
type ChannelKey = Pick<MatchedChannel, 'target' | 'channel'>;

/** 메서드 결과를 target·채널·메서드 순으로 고정한다. */
function compareMethodKeys(left: MethodKey, right: MethodKey): number {
  return (
    compareStrings(left.target, right.target) ||
    compareStrings(left.channel, right.channel) ||
    compareStrings(left.method, right.method)
  );
}

/** 결정적 정렬에 필요한 논리 메서드 키다. */
type MethodKey = Pick<MatchedMethod, 'target' | 'channel' | 'method'>;

/** 조립 중인 채널 증거 그룹이다. */
interface MutableChannelGroup extends MatchedChannel {
  readonly creations: BridgeEndpoint[];
  readonly registrations: BridgeEndpoint[];
}

/** 조립 중인 메서드 증거 그룹이다. */
interface MutableMethodGroup extends MatchedMethod {
  readonly invocations: BridgeEndpoint[];
  readonly handlers: BridgeEndpoint[];
}

/** 조립 중인 모듈·컴포넌트 이름 증거 그룹이다. */
interface MutableNameGroup extends MatchedBoundaryName {
  readonly callers: BridgeEndpoint[];
  readonly receivers: BridgeEndpoint[];
}

const millisecondsPerHour = 60 * 60 * 1_000;
const millisecondsPerDay = 24 * millisecondsPerHour;

/** persistence 도메인 조인의 분류 결과다. */
interface RelationJoinResult {
  readonly matchedRelations: MatchedRelation[];
  readonly relationUsesWithoutDecls: RelationUseWithoutDecl[];
  readonly ambiguousRelationUses: AmbiguousRelationUse[];
  readonly relationDeclsWithoutUses: RelationDeclWithoutUse[];
  readonly matchedColumns: MatchedColumn[];
  readonly columnUsesWithoutDecls: ColumnUseWithoutDecl[];
}

/**
 * `target: "persistence"` 문서의 관계·컬럼 사실을 이름 키로 조인한다.
 *
 * 선언 측(sql)은 항상 `schema.name` 한정 이름을 내고 사용 측은 코드에 쓰인
 * 그대로 낸다. 비한정 사용은 마지막 세그먼트로 선언을 찾되 후보가 둘 이상이면
 * 어느 쪽인지 추측하지 않고 모호함으로 보고한다. 컬럼 사용은 관계가 유일하게
 * 해석된 뒤에만 (관계, 컬럼) 쌍으로 판정한다. 선언 인덱스와 해석 규칙은
 * `createRelationResolver`와 공유한다.
 */
function joinRelationFacts(
  documents: readonly BridgeFactsDocument[],
): RelationJoinResult {
  const declIndex = collectRelationDecls(documents);
  const { objectDecls, columnDecls } = declIndex;
  // 사용 측은 버킷 키(한정 여부 + 정규화 키) 아래 원문 채널과 끝점을 모은다 —
  // 보고는 생산자가 쓴 원문 이름으로 해야 한다.
  const relationUses = new Map<string, { channel: string; uses: BridgeEndpoint[] }>();
  // 컬럼 버킷은 관계 채널 철자도 함께 담는다 — 컬럼만 관측된 관계의 진단이
  // 생산자 원문 이름을 필요로 한다.
  const columnUses = new Map<string, { channel: string; column: string; uses: BridgeEndpoint[] }>();
  for (const document of documents) {
    if (document.target !== 'persistence') continue;
    for (const fact of document.facts) {
      if (fact.kind !== 'relation-use' || fact.dynamic || typeof fact.channel !== 'string') continue;
      const endpoint = toEndpoint(document.platform, fact);
      const bucketKey = relationUseBucketKey(fact.channel);
      if (fact.method === undefined) {
        const entry = relationUses.get(bucketKey) ?? { channel: fact.channel, uses: [] };
        // 대소문자가 다른 철자는 같은 키로 묶인다 — 보고 채널은 최소 철자로
        // 고정해 입력 순서와 무관한 출력을 보장한다.
        if (compareStrings(fact.channel, entry.channel) < 0) {
          entry.channel = fact.channel;
        }
        entry.uses.push(endpoint);
        relationUses.set(bucketKey, entry);
      } else {
        const column = normalizeIdentifier(fact.method);
        const key = `${bucketKey}${COLUMN_KEY_SEPARATOR}${column}`;
        const entry = columnUses.get(key) ??
          { channel: fact.channel, column: fact.method, uses: [] };
        if (compareStrings(fact.channel, entry.channel) < 0) {
          entry.channel = fact.channel;
        }
        if (compareStrings(fact.method, entry.column) < 0) {
          entry.column = fact.method;
        }
        entry.uses.push(endpoint);
        columnUses.set(key, entry);
      }
    }
  }

  // 사용 버킷 하나가 어느 선언에 닿는지 한 번만 해석한다 — 컬럼 수준 판정도
  // 같은 해석을 재사용한다.
  const resolution = new Map<string, RelationBucketOutcome>();
  const resolveUse = (bucketKey: string): RelationBucketOutcome => {
    const cached = resolution.get(bucketKey);
    if (cached !== undefined) return cached;
    const outcome = resolveRelationBucket(declIndex, bucketKey);
    resolution.set(bucketKey, outcome);
    return outcome;
  };

  const matchedRelations: MatchedRelation[] = [];
  const relationUsesWithoutDecls: RelationUseWithoutDecl[] = [];
  const ambiguousRelationUses: AmbiguousRelationUse[] = [];
  const usedDeclKeys = new Set<string>();
  for (const [bucketKey, { channel, uses }] of relationUses) {
    sortUniqueEndpoints(uses);
    const outcome = resolveUse(bucketKey);
    if (outcome.status === 'missing') {
      relationUsesWithoutDecls.push({ target: 'persistence', channel, uses });
    } else if (outcome.status === 'ambiguous') {
      ambiguousRelationUses.push({
        target: 'persistence',
        channel,
        uses,
        candidates: outcome.candidates,
      });
    } else {
      usedDeclKeys.add(outcome.key);
      const group = objectDecls.get(outcome.key)!;
      matchedRelations.push({
        target: 'persistence',
        channel: group.channel,
        uses,
        decls: group.decls,
      });
    }
  }

  const relationDeclsWithoutUses: RelationDeclWithoutUse[] = [...objectDecls.entries()]
    .filter(([key]) => !usedDeclKeys.has(key))
    .map(([, group]) => ({
      target: 'persistence' as const,
      channel: group.channel,
      decls: group.decls,
    }));

  const matchedColumns: MatchedColumn[] = [];
  const columnUsesWithoutDecls: ColumnUseWithoutDecl[] = [];
  // 관계 수준 사용이 없는 버킷(컬럼 참조만 관측)이 미해석·모호로 끝나면
  // 관계 진단이 아무것도 없어 사실이 조용히 사라진다 — 컬럼 증거로 관계
  // 수준 진단을 채운다.
  const columnOnlyUses = new Map<string, { channel: string; uses: BridgeEndpoint[] }>();
  for (const [columnKey, { channel, column, uses }] of columnUses) {
    sortUniqueEndpoints(uses);
    const separator = columnKey.lastIndexOf(COLUMN_KEY_SEPARATOR);
    const bucketKey = columnKey.slice(0, separator);
    const normalizedColumn = columnKey.slice(separator + COLUMN_KEY_SEPARATOR.length);
    const outcome = resolveUse(bucketKey);
    if (outcome.status !== 'resolved') {
      if (!relationUses.has(bucketKey)) {
        const entry = columnOnlyUses.get(bucketKey) ?? { channel, uses: [] };
        if (compareStrings(channel, entry.channel) < 0) {
          entry.channel = channel;
        }
        entry.uses.push(...uses);
        columnOnlyUses.set(bucketKey, entry);
      }
      continue;
    }
    const declChannel = objectDecls.get(outcome.key)!.channel;
    const decls = columnDecls.get(
      `${outcome.key}${COLUMN_KEY_SEPARATOR}${normalizedColumn}`,
    ) ?? [];
    if (decls.length > 0) {
      matchedColumns.push({
        target: 'persistence', channel: declChannel, column, uses, decls,
      });
    } else {
      columnUsesWithoutDecls.push({
        target: 'persistence', channel: declChannel, column, uses,
      });
    }
  }
  for (const [bucketKey, { channel, uses }] of columnOnlyUses) {
    sortUniqueEndpoints(uses);
    const outcome = resolveUse(bucketKey);
    if (outcome.status === 'missing') {
      relationUsesWithoutDecls.push({ target: 'persistence', channel, uses });
    } else if (outcome.status === 'ambiguous') {
      ambiguousRelationUses.push({
        target: 'persistence',
        channel,
        uses,
        candidates: outcome.candidates,
      });
    }
  }

  return {
    matchedRelations: matchedRelations.sort(compareRelationKeys),
    relationUsesWithoutDecls: relationUsesWithoutDecls.sort(compareRelationKeys),
    ambiguousRelationUses: ambiguousRelationUses.sort(compareRelationKeys),
    relationDeclsWithoutUses: relationDeclsWithoutUses.sort(compareRelationKeys),
    matchedColumns: matchedColumns.sort(compareColumnKeys),
    columnUsesWithoutDecls: columnUsesWithoutDecls.sort(compareColumnKeys),
  };
}

/** persistence 관계 이름 하나를 조인과 같은 규칙으로 해석한 결과다. channel은 선언 측 철자다. */
export type RelationResolution =
  | { readonly status: 'resolved'; readonly channel: string }
  | { readonly status: 'missing' }
  | { readonly status: 'ambiguous'; readonly candidates: readonly string[] };

/**
 * persistence 입력의 선언 인덱스로 관계 이름을 조인과 같은 규칙으로 해석한다.
 *
 * 조인 결과는 보고용 철자만 남기므로, 선택한 사실(impact)이나 질의한 이름을 조인
 * 진단과 대조하려면 같은 정규화·해석 규칙이 필요하다. 규칙을 복제하면 두 경로가
 * 어긋나므로 조인이 쓰는 선언 인덱스와 버킷 해석 함수를 그대로 재사용한다.
 */
export interface RelationResolver {
  /**
   * 사용 측 이름을 해석한다. 한정 이름은 정확히, 비한정 이름은 마지막 세그먼트로
   * 찾으며 후보가 여럿이면 추측하지 않고 모호함을 돌려준다.
   */
  resolveUse(channel: string): RelationResolution;
  /**
   * 사용 측 이름(과 선택적 컬럼)의 논리 관계 키다. 유일하게 해석되면 그 선언의
   * `declKey`와 같고, 미해석·모호하면 같은 사용 버킷(한정 여부 + 정규화 이름)끼리만 같다.
   */
  useKey(channel: string, column?: string): string;
  /** 선언 측 한정 이름(과 선택적 컬럼)의 논리 관계 키다. */
  declKey(channel: string, column?: string): string;
}

/** 입력 문서의 persistence 선언으로 관계 해석기를 만든다. 선언이 없으면 모든 사용이 missing이다. */
export function createRelationResolver(
  documents: readonly BridgeFactsDocument[],
): RelationResolver {
  const index = collectRelationDecls(documents);
  const cache = new Map<string, RelationBucketOutcome>();
  const resolveBucket = (bucketKey: string): RelationBucketOutcome => {
    const cached = cache.get(bucketKey) ?? resolveRelationBucket(index, bucketKey);
    cache.set(bucketKey, cached);
    return cached;
  };
  const useRelationKey = (bucketKey: string, column: string | undefined): string =>
    JSON.stringify(column === undefined ? ['use', bucketKey] : ['use', bucketKey, normalizeIdentifier(column)]);
  return {
    resolveUse: (channel) => {
      const outcome = resolveBucket(relationUseBucketKey(channel));
      return outcome.status === 'resolved'
        ? { status: 'resolved', channel: index.objectDecls.get(outcome.key)!.channel }
        : outcome;
    },
    useKey: (channel, column) => {
      const bucketKey = relationUseBucketKey(channel);
      const outcome = resolveBucket(bucketKey);
      // 유일하게 해석된 사용은 그 선언과 같은 키를 받는다 — 선언 키의 정규화는
      // 버킷 키의 정규화와 같은 함수(`normalizeRelationKey`)라 문자열이 일치한다.
      return outcome.status === 'resolved'
        ? relationDeclKey(index.objectDecls.get(outcome.key)!.channel, column)
        : useRelationKey(bucketKey, column);
    },
    declKey: relationDeclKey,
  };
}

/**
 * 선언 측 한정 이름(과 선택적 컬럼)의 논리 관계 키다. `RelationResolver.declKey`와 같다.
 *
 * 선언 이름은 해석이 필요 없으므로 입력 문서 없이 계산한다 — 조인 결과의 같은 선언을
 * 가리키는 항목(대소문자만 다른 컬럼 철자 포함)을 다시 합칠 때 쓴다.
 */
export function relationDeclKey(channel: string, column?: string): string {
  const identity = ['decl', normalizeRelationKey(channel)];
  return JSON.stringify(column === undefined ? identity : [...identity, normalizeIdentifier(column)]);
}

/** persistence 선언 측 인덱스다 — 조인과 관계 해석기가 같은 규칙을 공유한다. */
interface RelationDeclIndex {
  /** 정규화된 한정 키별 관계 수준 선언 그룹이다. */
  readonly objectDecls: Map<string, MutableRelationDeclGroup>;
  /** 정규화된 (관계 키, 컬럼) 키별 컬럼 선언 증거다. */
  readonly columnDecls: Map<string, BridgeEndpoint[]>;
  /** 마지막 세그먼트별로 그 세그먼트로 끝나는 한정 키 집합이다 — 비한정 사용이 여기로 잇는다. */
  readonly lastSegmentIndex: Map<string, Set<string>>;
}

/**
 * 사용 버킷 하나를 선언으로 해석한 내부 결과다.
 * 문자열 표식 대신 판별 유니온을 써서 'missing' 같은 이름의 관계와 충돌하지 않게 한다.
 */
type RelationBucketOutcome =
  | { readonly status: 'resolved'; readonly key: string }
  | { readonly status: 'missing' }
  | { readonly status: 'ambiguous'; readonly candidates: readonly string[] };

/** persistence 문서의 정적 선언을 관계·컬럼 인덱스로 모으고 증거를 정렬·중복 제거한다. */
function collectRelationDecls(documents: readonly BridgeFactsDocument[]): RelationDeclIndex {
  const index: RelationDeclIndex = {
    objectDecls: new Map(), columnDecls: new Map(), lastSegmentIndex: new Map(),
  };
  for (const document of documents) {
    if (document.target !== 'persistence') continue;
    for (const fact of document.facts) {
      if (fact.kind !== 'relation-decl' || fact.dynamic || typeof fact.channel !== 'string') continue;
      collectRelationDecl(fact, toEndpoint(document.platform, fact), index.objectDecls,
        index.columnDecls, index.lastSegmentIndex);
    }
  }
  // 선언 증거도 사용 증거와 같이 정렬·중복 제거한다 — 입력 문서 순서가
  // evidence 배열에 새면 같은 입력이 다른 보고서를 만든다.
  for (const group of index.objectDecls.values()) sortUniqueEndpoints(group.decls);
  for (const list of index.columnDecls.values()) sortUniqueEndpoints(list);
  return index;
}

/**
 * 사용 측 이름의 버킷 키다. 앞 한 글자가 한정 여부, 나머지가 정규화 키다.
 * 한정 여부는 원문의 escape되지 않은 `.`로 판정한다 — `%2E`는 한정자가 아니라
 * 식별자 안의 점이라 정규화 키가 이를 보존하지 않는다.
 */
function relationUseBucketKey(channel: string): string {
  return `${channel.includes('.') ? '1' : '0'}${normalizeRelationKey(channel)}`;
}

/** 사용 버킷 하나가 어느 선언에 닿는지 조인 규칙대로 해석한다. */
function resolveRelationBucket(index: RelationDeclIndex, bucketKey: string): RelationBucketOutcome {
  const useKey = bucketKey.slice(1);
  if (bucketKey[0] === '1') {
    return index.objectDecls.has(useKey) ? { status: 'resolved', key: useKey } : { status: 'missing' };
  }
  const candidates = [...(index.lastSegmentIndex.get(useKey) ?? [])].sort(compareStrings);
  if (candidates.length === 1) return { status: 'resolved', key: candidates[0]! };
  if (candidates.length === 0) return { status: 'missing' };
  // 후보 보고는 정규화 키가 아니라 생산자가 쓴 한정 이름으로 한다.
  // 키 순과 철자 순이 어긋날 수 있으므로 매핑 뒤에 다시 정렬한다.
  return {
    status: 'ambiguous',
    candidates: candidates.map((key) => index.objectDecls.get(key)!.channel).sort(compareStrings),
  };
}

/** 조립 중인 선언 그룹 — channel은 관측된 철자 중 최솟값으로 고정한다. */
interface MutableRelationDeclGroup {
  channel: string;
  readonly decls: BridgeEndpoint[];
}

/** 선언 사실을 관계 수준·컬럼 수준 인덱스에 나눠 담는다. */
function collectRelationDecl(
  fact: BridgeFactsDocument['facts'][number],
  endpoint: BridgeEndpoint,
  objectDecls: Map<string, MutableRelationDeclGroup>,
  columnDecls: Map<string, BridgeEndpoint[]>,
  lastSegmentIndex: Map<string, Set<string>>,
): void {
  const qualifiedKey = normalizeRelationKey(fact.channel as string);
  if (fact.method === undefined) {
    const group = objectDecls.get(qualifiedKey) ??
      { channel: fact.channel as string, decls: [] };
    // 대소문자가 다른 선언 철자는 같은 키로 묶인다 — 보고 이름은 최소 철자로
    // 고정해 입력 순서와 무관한 출력을 보장한다.
    if (compareStrings(fact.channel as string, group.channel) < 0) {
      group.channel = fact.channel as string;
    }
    group.decls.push(endpoint);
    objectDecls.set(qualifiedKey, group);
    const segment = lastRelationSegment(qualifiedKey);
    const keys = lastSegmentIndex.get(segment) ?? new Set<string>();
    keys.add(qualifiedKey);
    lastSegmentIndex.set(segment, keys);
    return;
  }
  const key = `${qualifiedKey}${COLUMN_KEY_SEPARATOR}${normalizeIdentifier(fact.method)}`;
  const list = columnDecls.get(key) ?? [];
  list.push(endpoint);
  columnDecls.set(key, list);
}

/**
 * 관계 이름을 조인 키로 정규화한다.
 *
 * `.`는 한정 구분자이고 `%XX` escape 안의 문자는 구분자로 세지 않는다 —
 * `a%2Eb`처럼 이름 자체에 점이 있는 객체는 escape된 세그먼트로 남는다.
 * 세그먼트는 escape가 풀린 뒤 다시 점을 담을 수 있으므로 결합에는 식별자에
 * 올 수 없는 제어 문자를 쓴다. 비교는 방언별 대소문자 규칙 차이를 흡수하는
 * 기본 소문자 접기다.
 */
function normalizeRelationKey(channel: string): string {
  return channel
    .split('.')
    .map(normalizeIdentifier)
    .join(SEGMENT_SEPARATOR);
}

/** 한 식별자 세그먼트의 escape를 풀고 소문자로 접는다. 컬럼 이름도 같게 접는다. */
function normalizeIdentifier(segment: string): string {
  return unescapeIdentifier(segment).toLowerCase();
}

/** 생산자가 `%XX`로 escape한 식별자 세그먼트를 원래 문자로 되돌린다. */
function unescapeIdentifier(segment: string): string {
  return segment.replace(/%([0-9A-Fa-f]{2})/g, (_, hex: string) => {
    const code = Number.parseInt(hex, 16);
    // %00·%01은 디코딩하면 조인 키의 구조 구분자(SEGMENT/COLUMN)와 같은
    // 문자가 되어 키 경계를 오염시킨다 — 식별자가 담을 수 없는 문자라
    // escape 그대로 둔다.
    if (code <= 1) return `%${hex}`;
    return String.fromCharCode(code);
  });
}

/** 정규화된 한정 키의 마지막 세그먼트다 — 비한정 사용이 여기로 잇는다. */
function lastRelationSegment(key: string): string {
  const index = key.lastIndexOf(SEGMENT_SEPARATOR);
  return index < 0 ? key : key.slice(index + SEGMENT_SEPARATOR.length);
}

/** 관계 결과를 target·채널 순으로 고정한다. */
function compareRelationKeys(
  left: Pick<MatchedRelation, 'target' | 'channel'>,
  right: Pick<MatchedRelation, 'target' | 'channel'>,
): number {
  return (
    compareStrings(left.target, right.target) ||
    compareStrings(left.channel, right.channel)
  );
}

/** 컬럼 결과를 target·채널·컬럼 순으로 고정한다. */
function compareColumnKeys(
  left: Pick<MatchedColumn, 'target' | 'channel' | 'column'>,
  right: Pick<MatchedColumn, 'target' | 'channel' | 'column'>,
): number {
  return (
    compareStrings(left.target, right.target) ||
    compareStrings(left.channel, right.channel) ||
    compareStrings(left.column, right.column)
  );
}

/**
 * 정규화된 관계 키 안에서 한정 세그먼트를 가르는 구분자다.
 * 식별자가 이 문자를 담을 수 없어 `%2E`가 풀린 세그먼트 안의 점과
 * 섞이지 않는다.
 */
const SEGMENT_SEPARATOR = '\u0000';

/** 컬럼 인덱스 키에서 관계와 컬럼을 가르는 구분자다. */
const COLUMN_KEY_SEPARATOR = '\u0001';
