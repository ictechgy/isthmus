import { compareStrings } from '../compare.ts';
import type { BridgeFact, BridgeFactsDocument } from '../exchange/parse.ts';
import { isBridgeDomainDocument } from '../exchange/parse.ts';
import type { ImportedHttpSurface } from '../exchange/http-surface.ts';
import type { TraceContext, TraceLink, TraceLinkContract, TraceLinkMatch, TraceMember } from '../exchange/trace-context.ts';
import {
  compareLimitations,
  createRelationResolver,
  isBridgeJoinDeferred,
  joinBridgeDocuments,
  type BridgeJoinResult,
  type JoinLimitation,
  type RelationResolver,
} from '../join/join.ts';
import {
  isClientDocument,
  isDeclarationDocument,
  type RouteDeclarationFact,
  type RouteLinkRule,
  type RouteScope,
} from '../join/route-join.ts';

/**
 * trace 입력을 member·link 단위 조인으로 준비한다.
 *
 * 단일 project context는 member 하나(내부 키 `''`)로, workspace context는 member마다 persistence 조인과
 * link마다 http 조인으로 나눈다. persistence는 member 밖으로 나가지 않고(클라이언트 로컬 DB와 서버 DB가
 * 섞이지 않게), http는 link에 선언된 쌍에서만 잇는다 — GRAPH-EXCHANGE의 workspace 매니페스트 예외 그대로다.
 */

/** trace 입력 묶음이 계약을 어겼음을 나타낸다(project 불일치, bridge 문서, 출력 상한 등). */
export class TraceInputError extends Error {
  /** 입력 내용을 노출하지 않는 고정 문구만 보존한다. */
  constructor(message: string) {
    super(message);
    this.name = 'TraceInputError';
  }
}

/** member 하나의 문서와 persistence 조인이다. 단일 project면 키가 `''`이고 `member`가 없다. */
export interface TraceMemberInput {
  readonly key: string;
  readonly member?: TraceMember;
  /** surface member면 가져온 artifact다. 그 선언 측 문서가 `documents`다. */
  readonly surface?: ImportedHttpSurface;
  readonly documents: readonly BridgeFactsDocument[];
  /** 단일 project면 http를 포함한 전체 조인, workspace면 http 문서를 뺀 member 안 조인이다. */
  readonly joined: BridgeJoinResult;
  readonly resolver: RelationResolver;
}

/** route scope 하나와 그 선언 측·호출 측·계약 측 member 키다. */
export interface TraceLinkedScope {
  readonly scope: RouteScope;
  readonly server: string;
  readonly client: string;
  readonly contract: string;
}

/** 출처(member 조인 또는 link 조인)를 붙인 조인 한계다. 단일 project면 출처 필드가 없다. */
export type TraceLimitation = JoinLimitation & { readonly member?: string; readonly link?: string };

/** link의 서비스 범위를 정하지 못해 선언 일부(또는 전부)를 잇지 않은 곳이다. 보고 층이 gap으로 바꾼다. */
export interface TraceLinkServiceIssue {
  readonly link: string;
  readonly server: string;
  readonly detail: string;
}

/** 어떤 link에도 그 역할로 들지 않은 member의 http 문서 수다. 보고 층이 `http-member-unlinked`로 바꾼다. */
export interface TraceUnlinkedDocuments {
  readonly member: string;
  readonly side: 'client' | 'server';
  readonly count: number;
}

/**
 * 어떤 link도 server로 잇지 않은 member 자신의 route-decl 하나다(문서 member만, 테스트 소스·usr 없는 decl 제외).
 *
 * link 조인에 들지 않으므로 호출과 이어지지 않지만, 핸들러 usr는 같은 member의 순회 id와 정확히 같다. 보고 층이
 * 이것으로 client member 호출의 역방향 도달이 그 member 자신의 route 핸들러에 닿았는지(upstream route)와, 역방향·route
 * 선택이 link 없는 route에서 멈췄는지(`route-decl-unlinked`)를 판정한다.
 */
export interface TraceUnlinkedRoute {
  readonly member: string;
  readonly fact: RouteDeclarationFact;
}

/** 준비된 trace 입력이다. */
export interface PreparedTrace {
  readonly workspace: boolean;
  readonly members: readonly TraceMemberInput[];
  readonly scopes: readonly TraceLinkedScope[];
  readonly limitations: readonly TraceLimitation[];
  readonly linkServiceIssues: readonly TraceLinkServiceIssue[];
  readonly unlinkedDocuments: readonly TraceUnlinkedDocuments[];
  /** link가 server로 잇지 않은 문서 member 자신의 route-decl이다. 단일 project면 비어 있다(모든 선언이 scope에 든다). */
  readonly unlinkedRoutes: readonly TraceUnlinkedRoute[];
}

/** surface member 이름 → 가져온 artifact다. CLI가 파일 sha256을 대조하고 검증해 넘긴다. */
export type TraceSurfaces = ReadonlyMap<string, ImportedHttpSurface>;

/**
 * context와 읽은 문서로 member·scope·한계를 준비한다.
 *
 * workspace면 `documents`는 context의 member 문서 순서(`context.documents`)를 그대로 따라야 하고, surface member마다
 * `surfaces`에 가져온 artifact가 있어야 한다.
 */
export function prepareTraceInputs(context: TraceContext, documents: readonly BridgeFactsDocument[],
  surfaces: TraceSurfaces = new Map()): PreparedTrace {
  return context.workspace === undefined ? prepareSingle(context.project!, documents)
    : prepareWorkspace(context, documents, surfaces);
}

/** 단일 project 입력이다. 기존 출력 바이트를 바꾸지 않도록 조인 하나를 그대로 쓴다. */
function prepareSingle(project: string, documents: readonly BridgeFactsDocument[]): PreparedTrace {
  for (const document of documents) {
    if (document.project !== project) {
      throw new TraceInputError('Every trace document must use the trace context project; regenerate it from that project root.');
    }
    rejectBridgeDocument(document);
  }
  const joined = joinTrace(documents);
  return {
    workspace: false,
    members: [{ key: '', documents, joined, resolver: createRelationResolver(documents) }],
    scopes: (joined.routes?.scopes ?? []).map((scope) => ({ scope, server: '', client: '', contract: '' })),
    limitations: joined.limitations,
    linkServiceIssues: [],
    unlinkedDocuments: [],
    unlinkedRoutes: [],
  };
}

/** workspace 입력이다. member마다 persistence 조인, link마다 http 조인을 한다. */
function prepareWorkspace(context: TraceContext, documents: readonly BridgeFactsDocument[], surfaces: TraceSurfaces): PreparedTrace {
  const { members, links } = context.workspace!;
  if (documents.length !== context.documents.length) {
    throw new TraceInputError('Workspace trace documents must follow the context member document order.');
  }
  const byPath = new Map(context.documents.map((path, index) => [path, documents[index]!]));
  const states = members.map((member) => member.surface === undefined
    ? memberInput(member, member.documents.map((path) => byPath.get(path)!))
    : surfaceInput(member, surfaces.get(member.name)));
  const byName = new Map(states.map((state) => [state.key, state]));
  const scopes: TraceLinkedScope[] = [];
  const linkServiceIssues: TraceLinkServiceIssue[] = [];
  const covered = { server: new Set<BridgeFactsDocument>(), client: new Set<BridgeFactsDocument>() };
  const limitations: TraceLimitation[] = states.flatMap(({ key, joined }) =>
    joined.limitations.map((limitation) => ({ ...limitation, member: key })));
  for (const link of links) {
    const joined = joinLink(link, byName, byPath, linkServiceIssues, covered);
    const scope = joined.routes?.scopes[0];
    if (scope !== undefined) {
      scopes.push({ scope, server: link.server, client: link.client, contract: link.contract?.member ?? link.server });
    }
    limitations.push(...joined.limitations.map((limitation) => ({ ...limitation, link: link.name })));
  }
  return { workspace: true, members: states, scopes, limitations: limitations.sort(compareTraceLimitations), linkServiceIssues,
    unlinkedDocuments: unlinkedDocuments(states, covered), unlinkedRoutes: states.flatMap((state) => unlinkedRoutes(state, covered.server)) };
}

/**
 * link에 그 역할로 들지 않은 http 문서를 member·측별로 센다. member 단위가 아니라 문서 단위로 본다 — link가
 * contract 문서를 골라 쓰면 같은 member의 다른 openapi 문서나 server의 openapi 문서가 조용히 빠질 수 있기 때문이다.
 *
 * server 측은 문서 member에서 **체인이 쓸 수 없는 선언**을 담은 문서만 센다(contract, usr 없는·dynamic route-decl).
 * 핸들러 usr가 있는 정적 route-decl은 `unlinkedRoutes`로 넘어가, 체인이 그 route에 닿는 곳마다 upstream route나
 * `route-decl-unlinked`로 route 단위 공백을 밝히기 때문이다. surface member는 호출도 순회도 없어 그런 체인이 생기지
 * 않으므로 이전처럼 선언 문서를 모두 센다.
 */
function unlinkedDocuments(states: readonly TraceMemberInput[],
  covered: { server: ReadonlySet<BridgeFactsDocument>; client: ReadonlySet<BridgeFactsDocument> }): TraceUnlinkedDocuments[] {
  return states.flatMap(({ key, documents, surface }) => {
    const http = documents.filter(({ target }) => target === 'http');
    const client = http.filter((document) => isClientDocument(document) && !covered.client.has(document)).length;
    const server = http.filter((document) => isDeclarationDocument(document) && !covered.server.has(document) &&
      (surface !== undefined || document.facts.some(isUnfollowableDeclaration))).length;
    return [
      ...(client === 0 ? [] : [{ member: key, side: 'client' as const, count: client }]),
      ...(server === 0 ? [] : [{ member: key, side: 'server' as const, count: server }]),
    ];
  });
}

/**
 * link 없는 선언 문서에서 upstream route·`route-decl-unlinked`로 따라갈 수 없는 선언인지다. contract는 핸들러가 없고,
 * usr 없는·dynamic route-decl은 순회 id나 정규 템플릿으로 이을 수 없다. 테스트 소스 decl은 체인에서 늘 빠지므로 세지 않는다.
 */
function isUnfollowableDeclaration(fact: BridgeFact): boolean {
  if (fact.kind === 'route-contract') return true;
  if (fact.kind !== 'route-decl' || fact.testSource === true) return false;
  return fact.dynamic || fact.channel === null || fact.symbol?.usr === undefined;
}

/**
 * 문서 member의 link 없는 선언 문서(어떤 link도 server로 잇지 않은 문서)의 route-decl을 선언 측만으로 조인해 모은다.
 *
 * 호출 없이 선언만 조인하므로 서비스 범위는 가리지 않는다(route 키가 아니라 핸들러 usr로만 쓰인다). 테스트 소스와 usr 없는
 * decl은 뺀다 — 체인이 핸들러 usr로만 이 선언을 찾기 때문이다.
 */
function unlinkedRoutes(state: TraceMemberInput, coveredServers: ReadonlySet<BridgeFactsDocument>): TraceUnlinkedRoute[] {
  if (state.surface !== undefined) return [];
  const documents = state.documents.filter((document) => document.target === 'http' && document.platform !== 'openapi' &&
    isDeclarationDocument(document) && !coveredServers.has(document));
  if (documents.length === 0) return [];
  const own = new Set(documents);
  const joined = joinTrace(documents, { scope: state.key, isServerDocument: (document) => own.has(document),
    isClientDocument: () => false, attributes: () => false, includesDeclaration: () => true });
  return (joined.routes?.scopes[0]?.decls ?? [])
    .filter(({ testSource, endpoint }) => !testSource && endpoint.symbol?.usr !== undefined)
    .map((fact) => ({ member: state.key, fact }));
}

/**
 * surface member의 입력이다. 문서는 artifact가 준 선언 측 http 문서뿐이라 member 안 조인(persistence)은 비어 있다.
 * artifact 문서의 project는 isthmus가 만든 내부 값이라 member project 검사를 하지 않는다.
 */
function surfaceInput(member: TraceMember, surface: ImportedHttpSurface | undefined): TraceMemberInput {
  if (surface === undefined) throw new TraceInputError('Every surface member needs its imported http surface.');
  return { key: member.name, member, surface, documents: surface.documents, joined: joinTrace([]),
    resolver: createRelationResolver([]) };
}

/**
 * workspace member 문서의 공통 검사다: 문서 project가 member project와 같고 bridge target 문서가 없어야 한다.
 * trace와 `diff --http`의 workspace 모드가 같은 규칙을 쓴다.
 */
export function checkMemberDocuments(member: TraceMember, documents: readonly BridgeFactsDocument[]): void {
  for (const document of documents) {
    if (document.project !== member.project) {
      throw new TraceInputError('Every document of a workspace member must use that member project; '
        + 'regenerate it from the member root or move it to the member it describes.');
    }
    rejectBridgeDocument(document);
  }
}

/** member 하나를 검증하고 http 문서를 뺀 문서로 member 안 조인을 한다. */
function memberInput(member: TraceMember, documents: readonly BridgeFactsDocument[]): TraceMemberInput {
  checkMemberDocuments(member, documents);
  return {
    key: member.name, member, documents,
    joined: joinTrace(documents.filter(({ target }) => target !== 'http')),
    resolver: createRelationResolver(documents),
  };
}

/**
 * link 하나의 http 문서를 조인한다.
 *
 * 선언 측은 server member의 http 문서(link에 `contract`가 있으면 server의 openapi 문서는 빼고 계약 문서를
 * 쓴다 — 계약 끝점의 member가 하나로 정해지게 하기 위해서다), 호출 측은 client member의 http 문서다.
 */
function joinLink(link: TraceLink, members: ReadonlyMap<string, TraceMemberInput>,
  byPath: ReadonlyMap<string, BridgeFactsDocument>, issues: TraceLinkServiceIssue[],
  covered: { server: Set<BridgeFactsDocument>; client: Set<BridgeFactsDocument> }): BridgeJoinResult {
  const contracts = linkContractDocuments(link.contract, (name) => members.get(name)!.documents, (path) => byPath.get(path)!);
  const servers = linkServerDocuments(link, members.get(link.server)!.documents);
  const clients = members.get(link.client)!.documents.filter(({ target }) => target === 'http');
  for (const document of [...servers, ...contracts]) covered.server.add(document);
  for (const document of clients) covered.client.add(document);
  const { joined, serviceIssue } = joinWorkspaceLink(link, servers, contracts, clients);
  if (serviceIssue !== undefined) issues.push({ link: link.name, server: link.server, detail: serviceIssue });
  return joined;
}

/**
 * link의 선언 측에 드는 server member 문서다. http 문서만 쓰고, link에 `contract`가 있으면 server의 openapi 문서는
 * 빼고 계약 문서를 쓴다 — 계약 끝점의 member가 하나로 정해지게 하기 위해서다.
 */
export function linkServerDocuments(link: TraceLink, documents: readonly BridgeFactsDocument[]): BridgeFactsDocument[] {
  return documents.filter((document) =>
    document.target === 'http' && (link.contract === undefined || document.platform !== 'openapi'));
}

/**
 * link 계약 측 문서다. 문서 member는 link가 고른 문서 경로, surface member는 그 surface의 openapi 문서 전체다.
 * surface에 openapi 문서가 없으면 계약을 선언한 link가 빈 계약을 쓰게 되므로 입력 오류다.
 */
export function linkContractDocuments(contract: TraceLinkContract | undefined,
  memberDocuments: (name: string) => readonly BridgeFactsDocument[],
  documentAt: (path: string) => BridgeFactsDocument): BridgeFactsDocument[] {
  if (contract === undefined) return [];
  if (contract.documents !== undefined) return contract.documents.map(documentAt);
  const documents = memberDocuments(contract.member).filter(({ platform }) => platform === 'openapi');
  if (documents.length === 0) {
    throw new TraceInputError('A link contract names a surface member whose http surface carries no openapi document; '
      + 'remove the contract or ask the publisher to include the spec.');
  }
  return documents;
}

/** link 하나를 조인한 결과와, 서비스 범위를 정하지 못했을 때의 설명이다. */
export interface WorkspaceLinkJoin {
  readonly joined: BridgeJoinResult;
  readonly serviceIssue?: string;
}

/**
 * workspace link 하나의 http 조인이다. 선언 측은 `servers`와 `contracts`, 호출 측은 `clients` 문서다(문서 신원으로 정한다).
 *
 * trace와 `diff --http`가 같은 귀속(`match`)·서비스 범위 규칙을 쓰도록 한 곳에 둔다. diff는 base·head 선언 측을 같은
 * 호출 측과 따로 조인해 결합 결과를 비교한다.
 */
export function joinWorkspaceLink(link: TraceLink, servers: readonly BridgeFactsDocument[],
  contracts: readonly BridgeFactsDocument[], clients: readonly BridgeFactsDocument[]): WorkspaceLinkJoin {
  if (contracts.some(({ platform }) => platform !== 'openapi')) {
    throw new TraceInputError('Workspace link contract documents must be openapi documents; list other documents in a member.');
  }
  const serverSet = new Set([...servers, ...contracts]);
  const clientSet = new Set(clients);
  const scope = linkServiceScope(link, [...serverSet]);
  const attributed = linkAttribution(link.match);
  const rule: RouteLinkRule = {
    scope: link.name,
    isServerDocument: (document) => serverSet.has(document),
    isClientDocument: (document) => clientSet.has(document),
    attributes: (document, fact) => attributed(document, fact) && scope.admitsCall(fact.service ?? document.service),
    includesDeclaration: scope.includes,
  };
  const joined = joinTrace([...new Set([...servers, ...contracts, ...clients])], rule);
  return { joined, ...(scope.issue === undefined ? {} : { serviceIssue: scope.issue }) };
}

/**
 * link가 잇는 선언 측 서비스 범위다.
 *
 * 선언 측(server·contract 문서)의 선언 사실마다 유효 service(사실 값, 없으면 문서 값)를 모은다.
 * - `match.services`가 있으면 그 서비스의 선언만 잇는다. 선언 측이 서비스를 하나도 밝히지 않았으면(단일 서비스)
 *   이름 없는 선언도 잇는다. 이름 있는 선언과 섞인 이름 없는 선언은 어느 서비스인지 모르므로 빼고 issue를 남긴다.
 * - `match.services`가 없는데 선언 측 서비스 신원(이름 없는 것 포함)이 둘 이상이면 어느 서비스를 부르는지 모르므로
 *   선언을 하나도 잇지 않고 issue를 남긴다. 다른 서비스의 선언에 조용히 잇지 않기 위해서다.
 */
function linkServiceScope(link: TraceLink, servers: readonly BridgeFactsDocument[]): LinkServiceScope {
  const named = new Set<string>();
  let unnamed = 0;
  for (const document of servers) {
    for (const fact of document.facts) {
      if (fact.kind !== 'route-decl' && fact.kind !== 'route-contract') continue;
      const service = fact.service ?? document.service;
      if (service === undefined) unnamed += 1;
      else named.add(service);
    }
  }
  const narrowed = link.match.services === undefined ? undefined : new Set(link.match.services);
  if (narrowed !== undefined) return narrowedScope(narrowed, named, unnamed);
  if (named.size + (unnamed > 0 ? 1 : 0) < 2) return { includes: () => true, admitsCall: () => true };
  const identities = [...named].sort(compareStrings).concat(unnamed > 0 ? ['(no service)'] : []);
  return { includes: () => false, admitsCall: () => true,
    issue: `The server side of this link declares several services (${identities.join(', ')}) and the link match does `
      + 'not narrow them, so no declaration was joined; add match.services to select the service this client calls.' };
}

/** link의 서비스 범위: 잇는 선언, 받는 호출 service, 범위를 정하지 못한 곳의 설명이다. */
interface LinkServiceScope {
  readonly includes: (document: BridgeFactsDocument, fact: BridgeFact) => boolean;
  /** 호출의 유효 service(없으면 undefined)가 이 link 호출일 수 있는지다. */
  readonly admitsCall: (service: string | undefined) => boolean;
  readonly issue?: string;
}

/**
 * `match.services`로 좁힌 link의 서비스 범위다.
 *
 * 다른 서비스로 확정된 호출은 host·baseRef가 맞아도 받지 않는다. service 없는 호출은 선언 측에 좁힌 범위 밖의 서비스가
 * 없을 때만 받는다 — 그런 서비스가 있으면 어느 쪽을 부르는지 모르므로 추측해 잇지 않는다(선언 측의 이름 없는 선언과 같은 규칙).
 */
function narrowedScope(narrowed: ReadonlySet<string>, named: ReadonlySet<string>, unnamed: number): LinkServiceScope {
  const outside = [...named].filter((service) => !narrowed.has(service)).sort(compareStrings);
  const includes = (document: BridgeFactsDocument, fact: BridgeFact) => {
    const service = fact.service ?? document.service;
    return service === undefined ? named.size === 0 : narrowed.has(service);
  };
  const admitsCall = (service: string | undefined) => service === undefined ? outside.length === 0 : narrowed.has(service);
  const issues = [
    ...(named.size > 0 && unnamed > 0 ? [`${unnamed} server-side declaration(s) or contract(s) without a service were `
      + 'excluded because other declarations of this link name services; set service on every route-decl and '
      + 'route-contract of the link server side (server member and contract documents).'] : []),
    ...(outside.length > 0 ? [`The server side also declares services outside match.services (${outside.join(', ')}), so `
      + 'route calls without a service were not attributed to this link; set service on those calls or narrow by host.'] : []),
  ];
  return { includes, admitsCall, ...(issues.length === 0 ? {} : { issue: issues.join(' ') }) };
}

/**
 * link `match`의 귀속 판정이다. authority ∈ hosts, baseRef ∈ baseRefs[].ref, 유효 service ∈ services 중
 * 하나라도 맞으면 귀속한다. host 휴리스틱(접미사·와일드카드)은 쓰지 않는다.
 */
function linkAttribution(match: TraceLinkMatch): (document: BridgeFactsDocument, fact: BridgeFact) => boolean {
  const hosts = new Set(match.hosts ?? []);
  const services = new Set(match.services ?? []);
  const refs = new Set((match.baseRefs ?? []).map(({ ref }) => ref));
  return (document, fact) => {
    const service = fact.service ?? document.service;
    return (fact.authority !== undefined && hosts.has(fact.authority)) ||
      (fact.baseRef !== undefined && refs.has(fact.baseRef)) ||
      (service !== undefined && services.has(service));
  };
}

/** trace 구성으로 조인한다. mixed-targets 보류는 부분 결과 대신 입력 오류다. */
function joinTrace(documents: readonly BridgeFactsDocument[], link?: RouteLinkRule): BridgeJoinResult {
  const joined = joinBridgeDocuments(documents, { composition: 'trace', ...(link === undefined ? {} : { link }) });
  if (isBridgeJoinDeferred(joined)) {
    throw new TraceInputError('Trace cannot use documents with mixed bridge targets; split them by target.');
  }
  return joined;
}

/** 사실 0건 문서(target null)는 아무 경계도 싣지 않으므로 받는다. bridge target 문서만 거부한다. */
function rejectBridgeDocument(document: BridgeFactsDocument): void {
  if (document.target !== null && isBridgeDomainDocument(document)) {
    throw new TraceInputError('trace reads only http and persistence documents; remove bridge-target documents from the context.');
  }
}

/** 출처(member, link) 다음 조인 한계 순서로 정렬한다. */
function compareTraceLimitations(left: TraceLimitation, right: TraceLimitation): number {
  return compareStrings(left.member ?? '', right.member ?? '') || compareStrings(left.link ?? '', right.link ?? '') ||
    compareLimitations(left, right);
}
