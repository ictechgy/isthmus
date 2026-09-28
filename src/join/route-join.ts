import type {
  BridgeFact,
  BridgeFactsDocument,
  BridgePlatform,
  RouteParamConstraint,
  RoutePathAnchor,
} from '../exchange/parse.ts';
import { compareStrings } from '../compare.ts';
import type { HttpMethod, RouteMethod } from '../exchange/route-template.ts';
import { parseRouteTemplate } from '../exchange/route-template.ts';
import type { BridgeEndpoint, JoinLimitation, RouteEndpointInfo } from './join.ts';
import {
  RouteIndex,
  RouteSuffixBudgetError,
  MAX_ROUTE_SUFFIX_COMPARISONS,
  type RouteDeclaration,
  type RouteSideOutcome,
} from './route-index.ts';
import {
  RouteLimitationScopeIndex,
  RouteScopeBudgetError,
  MAX_ROUTE_SCOPE_COMPARISONS,
  type RouteScopeLimitation,
} from './route-limitation-scope.ts';

/**
 * http 도메인의 귀속 게이트와 scope별 route 조인이다.
 *
 * 매니페스트가 없는 입력은 유효 service가 선언 측 service와 정확히 같거나, 선언 측이 service를 전혀
 * 선언하지 않은 단일 서비스 입력에서 호출에도 service가 없을 때만 귀속한다. workspace link 하나를 조인할
 * 때(`joinLinkRouteFacts`, 현재 trace 전용)는 link의 `match`가 귀속을 정한다. 귀속되지 않은 호출은
 * 개수만 센다 — 그 경로·host는 이 모듈 밖으로 나가지 않는다. 심각도 정책은 보고 층이 정한다.
 */

/** 선언 측 사실(decl 또는 contract) 하나와 보고용 증거다. */
export interface RouteDeclarationFact {
  readonly kind: 'route-decl' | 'route-contract';
  readonly declaration: RouteDeclaration;
  readonly endpoint: BridgeEndpoint;
  readonly narrowed: boolean;
  readonly testSource: boolean;
  /** 경로 제약의 결정적 직렬화다. 제약만 다른 decl은 충돌이 아니다. */
  readonly constraintsKey: string;
  /** 이 scope에 귀속된 호출 중 method가 맞게 이 사실에 닿은(match·모호 후보) 호출이 있다. */
  readonly called: boolean;
  /**
   * 이 선언에 적용되는 호출 측 한계 문구다(스코프 없는 한계 전부 + 스코프가 이 선언과 겹치는 한계).
   * 미호출 진단 대상(호출되지 않은 root 앵커의 명시적·비테스트 선언)만 스코프로 좁히고, 나머지는 호출 측 문서의
   * 모든 한계 문구다.
   */
  readonly clientLimitations: readonly string[];
}

/** 귀속된 정적 호출 하나의 양쪽 결과다. */
export interface RouteCallResult {
  readonly endpoint: BridgeEndpoint;
  readonly method?: HttpMethod;
  readonly template: string;
  readonly anchor: RoutePathAnchor;
  readonly testSource: boolean;
  readonly masked: boolean;
  /** scope에 route-decl을 스캔한 문서가 있을 때만 있다. */
  readonly decl?: RouteSideOutcome;
  /** scope에 contract 문서가 있을 때만 있다. */
  readonly contract?: RouteSideOutcome;
  /**
   * 이 호출에 적용되는 서버 측(선언 측) 한계 문구다(스코프 없는 한계 전부 + 스코프가 이 호출과 겹치는 한계).
   * 어느 측 결과가 match가 아닌 호출만 스코프로 좁힌다 — match된 호출은 한계가 심각도를 바꾸지 않으므로 서버 측
   * 문서의 모든 한계 문구를 싣는다.
   */
  readonly serverLimitations: readonly string[];
}

/** 귀속된 dynamic 호출 중 증명된 리터럴 접두사가 있는 것이다. query 후보로만 쓴다. */
export interface RoutePrefixCall {
  readonly endpoint: BridgeEndpoint;
  readonly method?: HttpMethod;
  readonly channelPrefix: string;
}

/**
 * 귀속 게이트가 고른 한 scope(매니페스트가 없으면 service, 단일 서비스 입력이면 `default`)다.
 *
 * 한계 문구는 측별 원문 목록으로만 전달하고 접두사 해석은 보고 층이 한다. 스코프가 있는 한계는 호출
 * (`RouteCallResult.serverLimitations`)·선언(`RouteDeclarationFact.clientLimitations`)마다 적용 여부를 이 층이
 * 계산해 둔다 — 경로 비교 예산 초과를 조인의 입력 오류로 바꾸기 위해서다.
 */
export interface RouteScope {
  readonly scope: string;
  /** (f): platform이 openapi가 아니고 roles에 server가 있는 http 문서가 있다. */
  readonly declScanned: boolean;
  readonly contractDocuments: number;
  /** 이 scope에 귀속될 수 있는 client roles 문서 수다. */
  readonly clientDocuments: number;
  /** 서버 측(선언 측) 문서가 신고한 한계다. `scoped`면 스코프 안의 호출에만 적용된다. */
  readonly serverLimitations: readonly RouteScopeLimitation[];
  /** 이 scope에 귀속될 수 있는 호출 측 문서가 신고한 한계다. `scoped`면 스코프와 겹치는 선언에만 적용된다. */
  readonly clientLimitations: readonly RouteScopeLimitation[];
  readonly dynamicDecls: number;
  readonly dynamicContracts: number;
  readonly dynamicCalls: number;
  /** 귀속되지 않았지만 이 scope를 불렀을 수 있는 호출 수다. */
  readonly unboundCalls: number;
  readonly decls: readonly RouteDeclarationFact[];
  readonly contracts: readonly RouteDeclarationFact[];
  readonly calls: readonly RouteCallResult[];
  readonly prefixCalls: readonly RoutePrefixCall[];
}

/** http 조인 결과다. */
export interface RouteJoinResult {
  /** client roles 문서가 하나도 없는 decl↔contract 드리프트 입력이다. */
  readonly driftOnly: boolean;
  readonly scopes: readonly RouteScope[];
  /** 소비자가 직접 센 http 한계다. */
  readonly limitations: readonly JoinLimitation[];
}

/** http 입력이 귀속 규칙을 만족하지 못함을 나타낸다. 조인 층이 입력 오류로 바꾼다. */
export class RouteJoinInputError extends Error {
  /** 입력 내용을 담지 않는 고정 문구만 보존한다. */
  constructor(message: string) {
    super(message);
    this.name = 'RouteJoinInputError';
  }
}

/** 단일 서비스 입력의 scope 이름이다. */
export const DEFAULT_ROUTE_SCOPE = 'default';

/** 끝점 정렬 비교기다. 조인 층의 비교기를 주입받아 순환 의존을 피한다. */
type CompareEndpoints = (left: BridgeEndpoint, right: BridgeEndpoint) => number;

/**
 * target `http` 문서들을 scope별로 조인한다.
 *
 * 선언 측 문서는 route-decl·route-contract 사실이 있거나 roles에 server가 있는 문서, 호출 측
 * 문서는 roles에 client가 있는 문서다. 선언 측이 service를 선언한 문서·사실과 선언하지 않은
 * 것이 섞이면 scope를 정할 수 없어 입력 오류다.
 */
export function joinRouteFacts(
  documents: readonly BridgeFactsDocument[],
  compareEndpoints: CompareEndpoints,
): RouteJoinResult {
  const http = documents.filter(({ target }) => target === 'http');
  const services = declarationServices(http);
  const scopeNames = services === undefined ? [DEFAULT_ROUTE_SCOPE] : [...services].sort(compareStrings);
  const budget = { remaining: MAX_ROUTE_SUFFIX_COMPARISONS };
  const scopeBudget = { remaining: MAX_ROUTE_SCOPE_COMPARISONS };
  const unattributed = collectUnattributedCalls(http, services);
  const scopes = scopeNames.map((scope) =>
    buildScope(http, services, scope, unattributed, budget, scopeBudget, compareEndpoints));
  return {
    driftOnly: !http.some(isClientDocument),
    scopes,
    limitations: routeConsumerLimitations(http, {
      countsDeclarations: () => true,
      countsCalls: () => true,
      isAttributed: (document, fact) => attributedScope(effectiveService(document, fact), services) !== undefined,
    }),
  };
}

/**
 * workspace link 하나의 조인 규칙이다.
 *
 * link는 member 사이 http 조인을 허용하는 유일한 예외다. 선언 측은 server member(와 contract member)의
 * 문서, 호출 측은 client member의 문서로 **문서 신원**으로 정한다 — 한 문서가 server·client roles를
 * 겸해도 다른 member의 호출이 섞이지 않게 하기 위해서다. link 하나가 scope 하나이고 이름이 link 이름이며,
 * 선언 측 사실 중 어느 것을 이 link의 선언으로 볼지(서비스 범위)는 `includesDeclaration`이 정한다.
 */
export interface RouteLinkRule {
  /** 진단 신원·trace route 키의 scope가 되는 link 이름이다. */
  readonly scope: string;
  /** 선언 측(server member 또는 contract) 문서인지다. */
  readonly isServerDocument: (document: BridgeFactsDocument) => boolean;
  /** 호출 측(client member) 문서인지다. */
  readonly isClientDocument: (document: BridgeFactsDocument) => boolean;
  /** 호출 하나가 link `match`에 걸리는지다. 걸리지 않으면 개수만 센다. */
  readonly attributes: (document: BridgeFactsDocument, fact: BridgeFact) => boolean;
  /**
   * 선언 측 사실(route-decl·route-contract) 하나가 이 link의 선언인지다. 선언 측 member가 여러 서비스를 낼 때
   * link가 좁힌 서비스의 선언만 잇기 위해서다 — 다른 서비스의 선언에 호출을 잇지 않는다.
   */
  readonly includesDeclaration: (document: BridgeFactsDocument, fact: BridgeFact) => boolean;
}

/**
 * workspace link 하나의 http 사실을 scope 하나로 조인한다.
 *
 * 입력 문서의 project가 서로 달라도 된다(member 단위 project 검사는 호출자가 한다). 매칭·구체성·
 * 끝점 규칙은 매니페스트 없는 조인과 같고, 귀속만 `rule.attributes`가 정한다. client member의
 * 귀속되지 않은 호출은 모두 이 link를 불렀을 수 있으므로 `unboundCalls`로 센다.
 */
export function joinLinkRouteFacts(
  documents: readonly BridgeFactsDocument[],
  rule: RouteLinkRule,
  compareEndpoints: CompareEndpoints,
): RouteJoinResult {
  const http = documents.filter(({ target }) => target === 'http');
  const servers = http.filter((document) => rule.isServerDocument(document) && isDeclarationDocument(document));
  const clients = http.filter((document) => rule.isClientDocument(document) && isClientDocument(document));
  const attributed = (document: BridgeFactsDocument, fact: BridgeFact) =>
    clients.includes(document) && rule.attributes(document, fact);
  const scope = buildLinkScope(servers, clients, rule, attributed, compareEndpoints);
  return {
    driftOnly: clients.length === 0,
    scopes: [scope],
    limitations: routeConsumerLimitations(http, {
      countsDeclarations: (document, fact) => servers.includes(document) && rule.includesDeclaration(document, fact),
      countsCalls: (document) => clients.includes(document),
      isAttributed: attributed,
    }),
  };
}

/** link 하나의 scope를 만든다. 선언 측은 server 문서 전체, 호출은 client 문서의 귀속된 호출이다. */
function buildLinkScope(
  servers: readonly BridgeFactsDocument[],
  clients: readonly BridgeFactsDocument[],
  rule: RouteLinkRule,
  attributed: (document: BridgeFactsDocument, fact: BridgeFact) => boolean,
  compareEndpoints: CompareEndpoints,
): RouteScope {
  const included = rule.includesDeclaration;
  const decls = collectDeclarations(servers, 'route-decl', included, compareEndpoints);
  const contracts = collectDeclarations(servers, 'route-contract', included, compareEndpoints);
  const declScanned = servers.some((document) =>
    document.platform !== 'openapi' && (document.roles?.includes('server') ?? false));
  const contractDocuments = servers.filter(({ platform }) => platform === 'openapi').length;
  const budget = { remaining: MAX_ROUTE_SUFFIX_COMPARISONS };
  const declIndex = new RouteIndex(decls.map(({ declaration }) => declaration), budget);
  const contractIndex = new RouteIndex(contracts.map(({ declaration }) => declaration), budget);
  const scopeBudget = { remaining: MAX_ROUTE_SCOPE_COMPARISONS };
  const serverScopes = new RouteLimitationScopeIndex(servers, scopeBudget);
  const clientScopes = new RouteLimitationScopeIndex(clients, scopeBudget);
  const calls: RouteCallResult[] = [];
  const prefixCalls: RoutePrefixCall[] = [];
  let dynamicCalls = 0;
  let unboundCalls = 0;
  for (const document of clients) {
    for (const fact of document.facts) {
      if (fact.kind !== 'route-call') continue;
      if (!attributed(document, fact)) {
        unboundCalls += 1;
        continue;
      }
      const endpoint = routeEndpoint(document.platform, fact);
      if (fact.dynamic || fact.channel === null) {
        dynamicCalls += 1;
        if (fact.channelPrefix !== undefined) {
          prefixCalls.push({ endpoint, channelPrefix: fact.channelPrefix, ...methodField(fact) });
        }
        continue;
      }
      calls.push(matchCall(fact, endpoint, declScanned ? declIndex : undefined,
        contractDocuments > 0 ? contractIndex : undefined, serverScopes));
    }
  }
  return {
    scope: rule.scope,
    declScanned,
    contractDocuments,
    clientDocuments: clients.length,
    serverLimitations: serverScopes.limitations,
    clientLimitations: clientScopes.limitations,
    dynamicDecls: countDynamic(servers, 'route-decl', included),
    dynamicContracts: countDynamic(servers, 'route-contract', included),
    dynamicCalls,
    unboundCalls,
    decls: markCalled(decls, calls, 'decl', clientScopes),
    contracts: markCalled(contracts, calls, 'contract', clientScopes),
    calls: uniqueCalls(calls, compareEndpoints),
    prefixCalls: prefixCalls.sort((left, right) => compareEndpoints(left.endpoint, right.endpoint)),
  };
}

/** roles에 client가 있는 문서인지 확인한다. */
export function isClientDocument(document: BridgeFactsDocument): boolean {
  return document.roles?.includes('client') ?? false;
}

/** 선언 측 문서인지 확인한다. */
export function isDeclarationDocument(document: BridgeFactsDocument): boolean {
  return (document.roles?.includes('server') ?? false) ||
    document.facts.some(({ kind }) => kind === 'route-decl' || kind === 'route-contract');
}

/** 사실의 유효 service다. 사실 값이 있으면 그 값, 없으면 문서 값이다. */
function effectiveService(document: BridgeFactsDocument, fact: BridgeFact): string | undefined {
  return fact.service ?? document.service;
}

/** 선언 측 사실인지 확인한다. */
function isDeclarationFact(fact: BridgeFact): boolean {
  return fact.kind === 'route-decl' || fact.kind === 'route-contract';
}

/**
 * 선언 측 service 집합이다. 하나도 없으면 단일 서비스 입력(undefined)이다.
 *
 * 선언 측 문서·사실 중 일부만 service를 가지면 이름 없는 선언을 어느 scope에 둘지 정할 수
 * 없다. 추측하지 않고 입력 오류로 거부한다.
 */
function declarationServices(documents: readonly BridgeFactsDocument[]): Set<string> | undefined {
  const declared = new Set<string>();
  let undeclared = false;
  for (const document of documents.filter(isDeclarationDocument)) {
    const facts = document.facts.filter(isDeclarationFact);
    if (facts.length === 0) {
      if (document.service === undefined) undeclared = true;
      else declared.add(document.service);
    }
    for (const fact of facts) {
      const service = effectiveService(document, fact);
      if (service === undefined) undeclared = true;
      else declared.add(service);
    }
  }
  if (declared.size > 0 && undeclared) {
    throw new RouteJoinInputError(
      'Http declaration documents must either all declare a service or none of them; '
      + 'set service on every route-decl/route-contract document (or fact) or remove it from all.',
    );
  }
  return declared.size === 0 ? undefined : declared;
}

/** 호출 하나가 귀속되는 scope 이름이다. 귀속되지 않으면 undefined다. */
function attributedScope(service: string | undefined, services: Set<string> | undefined): string | undefined {
  if (services === undefined) return service === undefined ? DEFAULT_ROUTE_SCOPE : undefined;
  return service !== undefined && services.has(service) ? service : undefined;
}

/**
 * 한 문서·호출이 scope에 닿을 수 있는지다. 둘 다 service가 있고 다를 때만 닿지 않는다.
 *
 * 귀속되지 않은 호출이 어느 scope의 호출 측 공백이 되는지, 호출 측 문서의 한계가 어느
 * scope에 적용되는지를 같은 규칙으로 정한다.
 */
function mayReach(service: string | undefined, scopeService: string | undefined): boolean {
  return service === undefined || scopeService === undefined || service === scopeService;
}

/** 귀속되지 않은 호출(dynamic 포함)의 유효 service 목록이다. */
function collectUnattributedCalls(
  documents: readonly BridgeFactsDocument[],
  services: Set<string> | undefined,
): Array<string | undefined> {
  const found: Array<string | undefined> = [];
  for (const document of documents) {
    for (const fact of document.facts) {
      if (fact.kind !== 'route-call') continue;
      const service = effectiveService(document, fact);
      if (attributedScope(service, services) === undefined) found.push(service);
    }
  }
  return found;
}

/** 한 scope의 선언·호출을 모으고 호출마다 양쪽 결과를 계산한다. */
function buildScope(
  documents: readonly BridgeFactsDocument[],
  services: Set<string> | undefined,
  scope: string,
  unattributed: ReadonlyArray<string | undefined>,
  budget: { remaining: number },
  scopeBudget: { remaining: number },
  compareEndpoints: CompareEndpoints,
): RouteScope {
  const scopeService = services === undefined ? undefined : scope;
  // 서버 측 문서: 유효 service가 이 scope인 선언 측 사실을 담았거나, 선언 측 사실이 없고 문서
  // service가 이 scope인 문서다. 파서가 문서·사실 service 불일치를 거부하므로 둘은 겹치지 않는다.
  const serverDocuments = documents.filter((document) => {
    if (!isDeclarationDocument(document)) return false;
    if (scopeService === undefined) return true;
    const facts = document.facts.filter(isDeclarationFact);
    return facts.length === 0
      ? document.service === scopeService
      : facts.some((fact) => effectiveService(document, fact) === scopeService);
  });
  const clientDocuments = documents.filter((document) => isClientDocument(document) &&
    (mayReach(document.service, scopeService) || document.facts.some((fact) =>
      fact.kind === 'route-call' && effectiveService(document, fact) === scopeService)));
  const inScope = (document: BridgeFactsDocument, fact: BridgeFact): boolean =>
    scopeService === undefined || effectiveService(document, fact) === scopeService;
  const decls = collectDeclarations(documents, 'route-decl', inScope, compareEndpoints);
  const contracts = collectDeclarations(documents, 'route-contract', inScope, compareEndpoints);
  // (f): platform이 openapi가 아니고 roles에 server가 있는 문서다. 파서가 server 역할 없는
  // route-decl을 거부하지만, 계약 문장을 그대로 검사해 판정이 파서 규칙에 기대지 않게 한다.
  const declScanned = serverDocuments.some((document) =>
    document.platform !== 'openapi' && (document.roles?.includes('server') ?? false));
  const contractDocuments = serverDocuments.filter(({ platform }) => platform === 'openapi').length;
  const declIndex = new RouteIndex(decls.map(({ declaration }) => declaration), budget);
  const contractIndex = new RouteIndex(contracts.map(({ declaration }) => declaration), budget);
  const serverScopes = new RouteLimitationScopeIndex(serverDocuments, scopeBudget);
  const clientScopes = new RouteLimitationScopeIndex(clientDocuments, scopeBudget);
  const calls: RouteCallResult[] = [];
  const prefixCalls: RoutePrefixCall[] = [];
  let dynamicCalls = 0;
  for (const document of documents) {
    for (const fact of document.facts) {
      if (fact.kind !== 'route-call' || attributedScope(effectiveService(document, fact), services) !== scope) continue;
      const endpoint = routeEndpoint(document.platform, fact);
      if (fact.dynamic || fact.channel === null) {
        dynamicCalls += 1;
        if (fact.channelPrefix !== undefined) {
          prefixCalls.push({ endpoint, channelPrefix: fact.channelPrefix, ...methodField(fact) });
        }
        continue;
      }
      calls.push(matchCall(fact, endpoint, declScanned ? declIndex : undefined,
        contractDocuments > 0 ? contractIndex : undefined, serverScopes));
    }
  }
  return {
    scope,
    declScanned,
    contractDocuments,
    clientDocuments: clientDocuments.length,
    serverLimitations: serverScopes.limitations,
    clientLimitations: clientScopes.limitations,
    dynamicDecls: countDynamic(documents, 'route-decl', inScope),
    dynamicContracts: countDynamic(documents, 'route-contract', inScope),
    dynamicCalls,
    unboundCalls: unattributed.filter((service) => mayReach(service, scopeService)).length,
    decls: markCalled(decls, calls, 'decl', clientScopes),
    contracts: markCalled(contracts, calls, 'contract', clientScopes),
    calls: uniqueCalls(calls, compareEndpoints),
    prefixCalls: prefixCalls.sort((left, right) => compareEndpoints(left.endpoint, right.endpoint)),
  };
}

/**
 * 호출 하나를 양쪽 색인과 맞춘다. 색인이 없는 쪽은 평가하지 않는다. 어느 측이 match가 아니면 그 호출에
 * 적용되는 서버 측 한계를 스코프로 좁혀 둔다.
 */
function matchCall(
  fact: BridgeFact,
  endpoint: BridgeEndpoint,
  declIndex: RouteIndex | undefined,
  contractIndex: RouteIndex | undefined,
  serverScopes: RouteLimitationScopeIndex,
): RouteCallResult {
  const parsed = parseRouteTemplate(fact.channel as string);
  // 파서가 이미 검증한 템플릿이라 실패하면 내부 불변 위반이다.
  if (!parsed.ok) throw new Error('Validated route template failed to parse.');
  const probe = {
    segments: parsed.segments,
    anchor: fact.pathAnchor!,
    ...(fact.method === undefined ? {} : { method: fact.method as HttpMethod }),
  };
  const decl = declIndex?.match(probe);
  const contract = contractIndex?.match(probe);
  // match되지 않은 측이 있으면 좁힌다. error 판정(missing·method-mismatch)뿐 아니라 diff가 증명하지 못한 전제를
  // reason으로 나열할 때(모호·끝 슬래시·대소문자)도 호출 단위의 공백을 쓰기 위해서다.
  const unbound = [decl, contract].some((outcome) => outcome !== undefined && outcome.status !== 'matched');
  return {
    endpoint,
    ...methodField(fact),
    template: fact.channel as string,
    anchor: fact.pathAnchor!,
    testSource: fact.testSource === true,
    masked: (fact.maskedSegments ?? 0) > 0,
    ...(decl === undefined ? {} : { decl }),
    ...(contract === undefined ? {} : { contract }),
    serverLimitations: unbound ? serverScopes.applicable({ ...probe, side: 'call' }) : serverScopes.messages,
  };
}

/** method가 확정된 사실이면 method 필드를 만든다. */
function methodField(fact: BridgeFact): { method?: HttpMethod } {
  return fact.method === undefined ? {} : { method: fact.method as HttpMethod };
}

/** scope의 정적 선언 측 사실을 모아 매칭용 선언과 증거로 만든다. 중복 증거는 하나로 합친다. */
function collectDeclarations(
  documents: readonly BridgeFactsDocument[],
  kind: 'route-decl' | 'route-contract',
  inScope: (document: BridgeFactsDocument, fact: BridgeFact) => boolean,
  compareEndpoints: CompareEndpoints,
): Array<Omit<RouteDeclarationFact, 'called' | 'clientLimitations'>> {
  const collected = new Map<string, Omit<RouteDeclarationFact, 'called' | 'clientLimitations' | 'declaration'> & {
    readonly declaration: Omit<RouteDeclaration, 'id'>;
  }>();
  for (const document of documents) {
    for (const fact of document.facts) {
      if (fact.kind !== kind || fact.dynamic || fact.channel === null || !inScope(document, fact)) continue;
      const parsed = parseRouteTemplate(fact.channel);
      if (!parsed.ok) throw new Error('Validated route template failed to parse.');
      const endpoint = routeEndpoint(document.platform, fact);
      const constraints = new Map<number, RouteParamConstraint['kind']>(
        (fact.paramConstraints ?? []).map(({ segment, kind: constraintKind }) => [segment, constraintKind]));
      const entry = {
        kind,
        declaration: {
          template: fact.channel,
          segments: parsed.segments,
          method: fact.method as RouteMethod,
          anchor: fact.pathAnchor!,
          ...(fact.trailingSlash === undefined ? {} : { trailingSlash: fact.trailingSlash }),
          caseInsensitive: fact.caseInsensitive === true,
          catchAllPrefix: fact.catchAllPrefix === true,
          constraints,
        },
        endpoint,
        narrowed: fact.narrowed === true,
        testSource: fact.testSource === true,
        constraintsKey: JSON.stringify(fact.paramConstraints ?? []),
      };
      // 같은 위치·심볼·route 정보의 사실은 증거 하나다. 매칭 속성까지 같아야 합친다.
      collected.set(JSON.stringify([endpointKey(endpoint), entry.declaration.trailingSlash ?? null,
        entry.declaration.caseInsensitive, entry.narrowed, entry.constraintsKey]), entry);
    }
  }
  return [...collected.values()]
    .sort((left, right) => compareEndpoints(left.endpoint, right.endpoint) ||
      compareStrings(JSON.stringify([left.narrowed, left.constraintsKey, left.declaration.trailingSlash ?? null,
        left.declaration.caseInsensitive]), JSON.stringify([right.narrowed, right.constraintsKey,
        right.declaration.trailingSlash ?? null, right.declaration.caseInsensitive])))
    .map((entry, id) => ({ ...entry, declaration: { ...entry.declaration, id } }));
}

/**
 * 호출 결과에서 method가 맞게 닿은 선언을 표시한다. 모호 후보도 닿았을 수 있는 선언이다. 미호출 진단 대상인
 * 선언(호출되지 않은 root 앵커의 명시적·비테스트 선언)에는 적용되는 호출 측 한계를 스코프로 좁혀 둔다.
 */
function markCalled(
  facts: ReadonlyArray<Omit<RouteDeclarationFact, 'called' | 'clientLimitations'>>,
  calls: readonly RouteCallResult[],
  side: 'decl' | 'contract',
  clientScopes: RouteLimitationScopeIndex,
): RouteDeclarationFact[] {
  const called = new Set<number>();
  for (const call of calls) {
    const outcome = call[side];
    if (outcome?.status === 'matched' || outcome?.status === 'ambiguous') {
      for (const target of outcome.targets) called.add(target.id);
    }
  }
  // catch-all 접두사 decl은 원본 `{**}` decl을 펼친 것이다 — 접두사로 닿은 호출은 같은
  // 핸들러를 부르므로 원본도 호출된 것으로 본다. 원본 키는 파서가 검증한 규칙과 같다.
  const originals = new Map<string, number[]>();
  for (const { declaration, endpoint } of facts) {
    if (declaration.catchAllPrefix) continue;
    const key = JSON.stringify([declaration.method, endpoint.symbol?.usr ?? null, declaration.template]);
    originals.set(key, [...(originals.get(key) ?? []), declaration.id]);
  }
  for (const { declaration, endpoint } of facts) {
    if (!declaration.catchAllPrefix || !called.has(declaration.id)) continue;
    const template = declaration.template === '/' ? '/{**}' : `${declaration.template}/{**}`;
    const key = JSON.stringify([declaration.method, endpoint.symbol?.usr ?? null, template]);
    for (const id of originals.get(key) ?? []) called.add(id);
  }
  return facts.map((fact) => {
    const isCalled = called.has(fact.declaration.id);
    const { declaration } = fact;
    const reported = !isCalled && !declaration.catchAllPrefix && !fact.testSource && declaration.anchor === 'root';
    return {
      ...fact,
      called: isCalled,
      clientLimitations: reported
        ? clientScopes.applicable({
          segments: declaration.segments, anchor: declaration.anchor, method: declaration.method, side: 'declaration',
        })
        : clientScopes.messages,
    };
  });
}

/** 같은 호출 증거(위치·심볼·route 정보)를 하나로 합치고 결정적으로 정렬한다. */
function uniqueCalls(calls: readonly RouteCallResult[], compareEndpoints: CompareEndpoints): RouteCallResult[] {
  const unique = new Map<string, RouteCallResult>();
  for (const call of calls) unique.set(JSON.stringify([endpointKey(call.endpoint), call.masked]), call);
  return [...unique.values()].sort((left, right) =>
    compareEndpoints(left.endpoint, right.endpoint) || Number(left.masked) - Number(right.masked));
}

/** scope에 속한 dynamic 선언 측 사실 수다. 같은 위치의 중복은 한 번만 센다. */
function countDynamic(
  documents: readonly BridgeFactsDocument[],
  kind: 'route-decl' | 'route-contract',
  inScope: (document: BridgeFactsDocument, fact: BridgeFact) => boolean,
): number {
  const keys = new Set<string>();
  for (const document of documents) {
    for (const fact of document.facts) {
      if (fact.kind === kind && (fact.dynamic || fact.channel === null) && inScope(document, fact)) {
        keys.add(factKey(document.platform, fact));
      }
    }
  }
  return keys.size;
}

/** route 사실을 보고용 끝점으로 바꾼다. authority·baseRef는 싣지 않는다. */
export function routeEndpoint(platform: BridgePlatform, fact: BridgeFact): BridgeEndpoint {
  const route: RouteEndpointInfo = {
    kind: fact.kind as RouteEndpointInfo['kind'],
    ...(fact.method === undefined ? {} : { method: fact.method }),
    ...(fact.dynamic || fact.channel === null ? {} : { template: fact.channel }),
    pathAnchor: fact.pathAnchor!,
    ...(fact.testSource === undefined ? {} : { testSource: fact.testSource }),
  };
  return {
    platform,
    ...(fact.location === undefined ? {} : { location: fact.location }),
    ...(fact.symbol === undefined ? {} : { symbol: fact.symbol }),
    route,
  };
}

/** 끝점의 결정적 직렬화 키다. */
function endpointKey(endpoint: BridgeEndpoint): string {
  return JSON.stringify([endpoint.platform, endpoint.location ?? null, endpoint.symbol ?? null, endpoint.route ?? null]);
}

/** 계수용 사실 키다. 같은 위치의 같은 사실은 한 번만 센다. */
function factKey(platform: BridgePlatform, fact: BridgeFact): string {
  return JSON.stringify([platform, fact.kind, fact.channel, fact.method ?? null,
    fact.location?.path ?? null, fact.location?.line ?? null, fact.location?.column ?? null]);
}

/** 소비자 계수가 어느 문서의 어떤 사실을 세는지다. 매니페스트 없는 조인과 link 조인이 같은 계수기를 쓴다. */
interface ConsumerCountRule {
  /** 이 문서의 이 dynamic 선언 측 사실을 센다(link 조인은 그 link의 서비스 범위 밖 선언을 세지 않는다). */
  readonly countsDeclarations: (document: BridgeFactsDocument, fact: BridgeFact) => boolean;
  /** 이 문서의 호출(dynamic·미귀속)을 센다. */
  readonly countsCalls: (document: BridgeFactsDocument) => boolean;
  /** 호출이 선언 측에 귀속됐는지다. */
  readonly isAttributed: (document: BridgeFactsDocument, fact: BridgeFact) => boolean;
}

/**
 * 소비자가 직접 센 http 한계다. 플랫폼별로 dynamic 선언 측 사실, dynamic 호출, 귀속되지
 * 않은 정적 호출을 센다. 문구에는 개수만 싣는다 — 귀속되지 않은 호출의 경로·host는
 * 어떤 출력에도 싣지 않는다.
 */
function routeConsumerLimitations(
  documents: readonly BridgeFactsDocument[],
  rule: ConsumerCountRule,
): JoinLimitation[] {
  const counts = new Map<string, { platform: BridgePlatform; prefix: string; subject: string; keys: Set<string> }>();
  const add = (platform: BridgePlatform, prefix: string, subject: string, fact: BridgeFact): void => {
    const groupKey = `${platform}\u0000${prefix}`;
    const group = counts.get(groupKey) ?? { platform, prefix, subject, keys: new Set<string>() };
    group.keys.add(factKey(platform, fact));
    counts.set(groupKey, group);
  };
  for (const document of documents) {
    for (const fact of document.facts) {
      const dynamic = fact.dynamic || fact.channel === null;
      if (isDeclarationFact(fact)) {
        if (dynamic && rule.countsDeclarations(document, fact)) {
          add(document.platform, 'unjoined-dynamic-routes', 'route declaration or contract facts with a non-literal template', fact);
        }
      } else if (fact.kind !== 'route-call' || !rule.countsCalls(document)) {
        continue;
      } else if (dynamic) {
        add(document.platform, 'unjoined-dynamic-route-calls', 'route call facts with a non-literal template', fact);
      } else if (!rule.isAttributed(document, fact)) {
        add(document.platform, 'unjoined-unbound-route-calls',
          'route call facts without an attributed declaration side (paths and hosts are not reported)', fact);
      }
    }
  }
  return [...counts.values()].map(({ platform, prefix, subject, keys }) => ({
    platform,
    target: 'http',
    tool: 'isthmus',
    origin: 'consumer',
    message: `${prefix}: ${keys.size} ${subject} were not joined`,
  }));
}

export { RouteSuffixBudgetError, RouteScopeBudgetError };
