import { compareStrings } from '../compare.ts';
import type { BridgeFact, BridgeFactsDocument } from '../exchange/parse.ts';
import { isBridgeDomainDocument } from '../exchange/parse.ts';
import type { TraceContext, TraceLink, TraceLinkMatch, TraceMember } from '../exchange/trace-context.ts';
import {
  compareLimitations,
  createRelationResolver,
  isBridgeJoinDeferred,
  joinBridgeDocuments,
  type BridgeJoinResult,
  type JoinLimitation,
  type RelationResolver,
} from '../join/join.ts';
import type { RouteLinkRule, RouteScope } from '../join/route-join.ts';

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

/** 준비된 trace 입력이다. */
export interface PreparedTrace {
  readonly workspace: boolean;
  readonly members: readonly TraceMemberInput[];
  readonly scopes: readonly TraceLinkedScope[];
  readonly limitations: readonly TraceLimitation[];
}

/**
 * context와 읽은 문서로 member·scope·한계를 준비한다.
 *
 * workspace면 `documents`는 context의 member 문서 순서(`context.documents`)를 그대로 따라야 한다.
 */
export function prepareTraceInputs(context: TraceContext, documents: readonly BridgeFactsDocument[]): PreparedTrace {
  return context.workspace === undefined ? prepareSingle(context.project!, documents) : prepareWorkspace(context, documents);
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
  };
}

/** workspace 입력이다. member마다 persistence 조인, link마다 http 조인을 한다. */
function prepareWorkspace(context: TraceContext, documents: readonly BridgeFactsDocument[]): PreparedTrace {
  const { members, links } = context.workspace!;
  if (documents.length !== context.documents.length) {
    throw new TraceInputError('Workspace trace documents must follow the context member document order.');
  }
  const byPath = new Map(context.documents.map((path, index) => [path, documents[index]!]));
  const states = members.map((member) => memberInput(member, member.documents.map((path) => byPath.get(path)!)));
  const byName = new Map(states.map((state) => [state.key, state]));
  const scopes: TraceLinkedScope[] = [];
  const limitations: TraceLimitation[] = states.flatMap(({ key, joined }) =>
    joined.limitations.map((limitation) => ({ ...limitation, member: key })));
  for (const link of links) {
    const joined = joinLink(link, byName, byPath);
    const scope = joined.routes?.scopes[0];
    if (scope !== undefined) {
      scopes.push({ scope, server: link.server, client: link.client, contract: link.contract?.member ?? link.server });
    }
    limitations.push(...joined.limitations.map((limitation) => ({ ...limitation, link: link.name })));
  }
  return { workspace: true, members: states, scopes, limitations: limitations.sort(compareTraceLimitations) };
}

/** member 하나를 검증하고 http 문서를 뺀 문서로 member 안 조인을 한다. */
function memberInput(member: TraceMember, documents: readonly BridgeFactsDocument[]): TraceMemberInput {
  for (const document of documents) {
    if (document.project !== member.project) {
      throw new TraceInputError('Every document of a workspace member must use that member project; '
        + 'regenerate it from the member root or move it to the member it describes.');
    }
    rejectBridgeDocument(document);
  }
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
  byPath: ReadonlyMap<string, BridgeFactsDocument>): BridgeJoinResult {
  const contracts = (link.contract?.documents ?? []).map((path) => byPath.get(path)!);
  if (contracts.some(({ platform }) => platform !== 'openapi')) {
    throw new TraceInputError('Workspace link contract documents must be openapi documents; list other documents in a member.');
  }
  const servers = members.get(link.server)!.documents.filter((document) =>
    document.target === 'http' && (link.contract === undefined || document.platform !== 'openapi'));
  const clients = members.get(link.client)!.documents.filter(({ target }) => target === 'http');
  const serverSet = new Set([...servers, ...contracts]);
  const clientSet = new Set(clients);
  const rule: RouteLinkRule = {
    scope: link.name,
    isServerDocument: (document) => serverSet.has(document),
    isClientDocument: (document) => clientSet.has(document),
    attributes: linkAttribution(link.match),
  };
  return joinTrace([...new Set([...servers, ...contracts, ...clients])], rule);
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
