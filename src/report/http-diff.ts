import { compareStrings } from '../compare.ts';
import type { BridgeFactsDocument } from '../exchange/parse.ts';
import type { TraceLink, TraceLinkMatch, TraceMember, TraceWorkspace } from '../exchange/trace-context.ts';
import {
  BridgeJoinValidationError,
  compareLimitations,
  isBridgeJoinDeferred,
  joinBridgeDocuments,
  type BridgeJoinResult,
  type JoinLimitation,
} from '../join/join.ts';
import { isClientDocument, isDeclarationDocument, type RouteScope } from '../join/route-join.ts';
import type { DiffProducerVersion } from './diff.ts';
import {
  createHttpDiffFindings,
  finding,
  compareFindings,
  HTTP_DIFF_CODES,
  type HttpDiffCode,
  type HttpDiffFinding,
  type HttpDiffScopePair,
} from './http-diff-findings.ts';
import { checkMemberDocuments, joinWorkspaceLink, linkServerDocuments } from './trace-inputs.ts';

/**
 * `diff --http`의 입력 검증·조인·문서 조립이다.
 *
 * 두 모드를 받는다. surface는 한 project의 base·head 선언 측 문서와 고정한 호출 측 문서(`--clients`), workspace는
 * base·head `isthmus-workspace` 매니페스트다. 어느 모드든 같은 호출 집합을 base 선언 측과 head 선언 측에 따로
 * 조인하고(교차 평가) finding 정책(`http-diff-findings.ts`)에 넘긴다. 입력 구성 차이(project·선언 측 인벤토리·link
 * 정의)는 관찰 차이가 아니므로 입력 오류다.
 */

/** http diff 입력이 계약을 어겼음을 나타낸다. 입력 내용을 노출하지 않는 고정 문구만 싣는다. */
export class HttpDiffInputError extends Error {
  /** 원인과 해결 방향을 담은 고정 문구를 보존한다. */
  constructor(message: string) {
    super(message);
    this.name = 'HttpDiffInputError';
  }
}

/** 출력에 싣는 호출 끝점 합계 상한이다. 넘으면 부분 결과 대신 입력 오류다(pairs 끝점 상한과 같다). */
export const MAX_HTTP_DIFF_CALLS = 100_000;

/** `isthmus-http-diff` v1 문서다. 필드 설명은 docs/HTTP-DIFF.md에 있다. */
export interface HttpDiffDocument {
  readonly format: 'isthmus-http-diff';
  readonly version: 1;
  readonly mode: 'surface' | 'workspace';
  readonly project?: string;
  readonly workspace?: HttpDiffWorkspaceSummary;
  readonly scope: { readonly granularity: 'route'; readonly fieldCompatibility: 'not-assessed'; readonly queryAndHeaders: 'not-assessed' };
  readonly findings: readonly HttpDiffFinding[];
  readonly limitations: { readonly before: readonly HttpDiffLimitation[]; readonly after: readonly HttpDiffLimitation[] };
  readonly producers: {
    readonly before: readonly DiffProducerVersion[];
    readonly after: readonly DiffProducerVersion[];
    readonly clients: readonly DiffProducerVersion[];
  };
  readonly summary: HttpDiffSummary;
}

/** 조인 한계다. workspace면 어느 link 조인의 한계인지 `link`를 단다. */
export type HttpDiffLimitation = JoinLimitation & { readonly link?: string };

/** workspace 출력의 입력 요약이다. 문서 경로는 싣지 않는다. */
export interface HttpDiffWorkspaceSummary {
  readonly links: ReadonlyArray<{ name: string; client: string; server: string; match: TraceLinkMatch;
    contract?: { member: string; authoritative?: boolean } }>;
  readonly before: { readonly members: ReadonlyArray<{ name: string; project: string; revision: string }> };
  readonly after: { readonly members: ReadonlyArray<{ name: string; project: string; revision: string }> };
}

/** 요약이다. `callImpact`는 완전성 주장이 아니다 — `incompleteness`와 함께 읽는다. */
export interface HttpDiffSummary {
  readonly findings: number;
  readonly errors: number;
  readonly warnings: number;
  readonly info: number;
  readonly routesAdded: number;
  readonly routesRemoved: number;
  readonly routesChanged: number;
  /** 깨짐 finding(`-unverified` 포함)의 호출 수다. */
  readonly brokenCalls: number;
  /** 그중 error 전제가 모두 증명된 호출 수다. */
  readonly provenBrokenCalls: number;
  readonly reboundCalls: number;
  readonly incompleteness: number;
  readonly callImpact: 'breaks-found' | 'no-breaks-observed' | 'not-assessed';
}

/** surface 모드 입력이다. */
export interface HttpSurfaceInputs {
  readonly before: readonly BridgeFactsDocument[];
  readonly after: readonly BridgeFactsDocument[];
  readonly clients: readonly BridgeFactsDocument[];
}

/** workspace 모드의 한 시점이다. `documents`는 읽은 문서만 담은 경로 → 문서 대응이다. */
export interface HttpWorkspaceSnapshot {
  readonly workspace: TraceWorkspace;
  readonly documents: ReadonlyMap<string, BridgeFactsDocument>;
}

/** 두 시점 조인 한 쌍과 그 scope 쌍이다. */
interface JoinedPairs {
  readonly pairs: HttpDiffScopePair[];
  readonly before: HttpDiffLimitation[];
  readonly after: HttpDiffLimitation[];
}

/* ───────────── surface ───────────── */

/**
 * surface 모드 diff다. 선언 측 문서는 선언 측으로, `clients` 문서는 호출 측으로만 투영해 조인한다 — 서버와
 * 클라이언트를 겸하는 문서(BFF)의 호출이 시점마다 달라 교차 평가를 흐리지 않게 하기 위해서다.
 */
export function createHttpSurfaceDiff(inputs: HttpSurfaceInputs): HttpDiffDocument {
  validateSurface(inputs);
  const clients = inputs.clients.map(asClientDocument);
  const beforeJoin = joinHttp([...inputs.before.map(asDeclarationDocument), ...clients]);
  const afterJoin = joinHttp([...inputs.after.map(asDeclarationDocument), ...clients]);
  const joined: JoinedPairs = {
    pairs: pairScopes(beforeJoin.routes?.scopes ?? [], afterJoin.routes?.scopes ?? []),
    before: [...beforeJoin.limitations],
    after: [...afterJoin.limitations],
  };
  return assemble('surface', joined, [], {
    before: producerVersions(inputs.before), after: producerVersions(inputs.after), clients: producerVersions(inputs.clients),
  }, { project: inputs.before[0]!.project }, inputs.clients.length > 0);
}

/** surface 입력 구성을 검사한다. 어긋나면 관찰 차이가 아니라 입력 구성 차이다. */
function validateSurface(inputs: HttpSurfaceInputs): void {
  if (inputs.before.length === 0 || inputs.after.length === 0) {
    throw new HttpDiffInputError('Each diff --http snapshot needs at least one server or spec document.');
  }
  const all = [...inputs.before, ...inputs.after, ...inputs.clients];
  if (all.some((document) => !isHttpDiffDocument(document))) {
    throw new HttpDiffInputError('diff --http reads only http-target and openapi documents; remove bridge, persistence '
      + 'and sql documents from the inputs.');
  }
  if (new Set(all.map(({ project }) => project)).size !== 1) {
    throw new HttpDiffInputError('diff --http surface inputs must describe one project; produce the before, after and '
      + 'client documents from the same checkout path, or compare separate repositories with workspace manifests.');
  }
  for (const snapshot of [inputs.before, inputs.after]) validateDeclarationSnapshot(snapshot);
  if (inventory(inputs.before) !== inventory(inputs.after)) {
    throw new HttpDiffInputError('The before and after declaration documents must come from the same producers '
      + '(platform and tool per document); a partial extraction compared with a full one reports false removals.');
  }
  if (inputs.clients.some((document) => !isClientDocument(document))) {
    throw new HttpDiffInputError('Every --clients document must have the client role; pass server and spec documents '
      + 'with --before and --after.');
  }
}

/** 한 시점의 선언 측 문서 목록을 검사한다. 선언 측이 하나 이상이고 클라이언트 전용 문서가 없어야 한다. */
function validateDeclarationSnapshot(snapshot: readonly BridgeFactsDocument[]): void {
  if (snapshot.some((document) => !isDeclarationSide(document))) {
    throw new HttpDiffInputError('--before and --after take server and spec documents only; pass client-only documents '
      + 'with --clients so both snapshots are evaluated against the same calls.');
  }
}

/** http diff가 읽는 문서인지다: target http이거나 사실 0건 openapi 문서(target null)다. */
function isHttpDiffDocument(document: BridgeFactsDocument): boolean {
  return document.target === 'http' || (document.target === null && document.platform === 'openapi');
}

/** 선언 측 문서인지다. 사실 0건 openapi 문서도 스펙 문서로 받는다. */
function isDeclarationSide(document: BridgeFactsDocument): boolean {
  return isDeclarationDocument(document) || document.platform === 'openapi';
}

/**
 * 선언 측 문서 인벤토리(platform·도구 이름·테스트 소스 스캔 설정별 문서 수)의 결정적 직렬화다. 도구 버전 변화는
 * 허용한다. 테스트 소스 포함 여부가 시점마다 다르면 테스트 소스 선언만큼 거짓 추가·삭제가 보이므로 설정 차이로 거부한다.
 */
function inventory(documents: readonly BridgeFactsDocument[]): string {
  return JSON.stringify(documents.map((document) =>
    JSON.stringify([document.platform, document.tool.name, document.sourceSets?.tests ?? null])).sort(compareStrings));
}

/** 서버·클라이언트를 겸하는 문서를 선언 측으로만 투영한다. 순수 선언 문서는 그대로다. */
function asDeclarationDocument(document: BridgeFactsDocument): BridgeFactsDocument {
  if (!isClientDocument(document)) return document;
  return { ...document, roles: ['server'], facts: document.facts.filter(({ kind }) => kind !== 'route-call') };
}

/** 서버를 겸하는 호출 측 문서를 호출 측으로만 투영한다. 순수 호출 문서는 그대로다. */
function asClientDocument(document: BridgeFactsDocument): BridgeFactsDocument {
  if (!isDeclarationDocument(document)) return document;
  const { dispatch: _dispatch, ...rest } = document;
  return { ...rest, roles: ['client'], facts: document.facts.filter(({ kind }) => kind === 'route-call') };
}

/** http 문서를 trace 구성(한쪽 측만 있어도 조인)으로 조인한다. mixed-targets 보류는 입력 오류다. */
function joinHttp(documents: readonly BridgeFactsDocument[]): BridgeJoinResult {
  const joined = joinBridgeDocuments(documents, { composition: 'trace' });
  if (isBridgeJoinDeferred(joined)) {
    throw new BridgeJoinValidationError('diff --http cannot compare documents with mixed targets; split them by target.');
  }
  return joined;
}

/** base·head 조인의 scope를 이름으로 짝짓는다(매니페스트 없는 scope는 service 이름). */
function pairScopes(before: readonly RouteScope[], after: readonly RouteScope[]): HttpDiffScopePair[] {
  const names = [...new Set([...before, ...after].map(({ scope }) => scope))].sort(compareStrings);
  return names.map((scope) => ({
    scope,
    ...optional('before', before.find((entry) => entry.scope === scope)),
    ...optional('after', after.find((entry) => entry.scope === scope)),
    contractAuthoritative: false,
  }));
}

/** 값이 있을 때만 필드를 만든다. */
function optional<K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}

/* ───────────── workspace ───────────── */

/**
 * workspace 모드 diff다. link마다 base 매니페스트의 server·contract 문서와 head 매니페스트의 client 문서를 조인하고,
 * head의 server·contract 문서와 같은 client 문서를 조인해 비교한다.
 */
export function createHttpWorkspaceDiff(before: HttpWorkspaceSnapshot, after: HttpWorkspaceSnapshot): HttpDiffDocument {
  validateLinks(before.workspace, after.workspace);
  const used = { before: new Set<BridgeFactsDocument>(), after: new Set<BridgeFactsDocument>(), clients: new Set<BridgeFactsDocument>() };
  const joined: JoinedPairs = { pairs: [], before: [], after: [] };
  for (const link of after.workspace.links) joinWorkspacePair(link, before, after, joined, used);
  const extra = unlinkedClientFindings(after);
  return assemble('workspace', joined, extra, {
    before: producerVersions([...used.before]), after: producerVersions([...used.after]), clients: producerVersions([...used.clients]),
  }, { workspace: workspaceSummary(before.workspace, after.workspace) }, used.clients.size > 0);
}

/** link 하나를 두 시점으로 조인해 scope 쌍과 한계를 더한다. */
function joinWorkspacePair(link: TraceLink, before: HttpWorkspaceSnapshot, after: HttpWorkspaceSnapshot,
  joined: JoinedPairs, used: { before: Set<BridgeFactsDocument>; after: Set<BridgeFactsDocument>; clients: Set<BridgeFactsDocument> }): void {
  const clients = memberDocuments(after, link.client).filter(({ target }) => target === 'http');
  const base = linkDeclarations(before, link);
  const head = linkDeclarations(after, link);
  if (inventory([...base.servers, ...base.contracts]) !== inventory([...head.servers, ...head.contracts])) {
    throw new HttpDiffInputError('The before and after server and contract documents of a workspace link must come from the '
      + 'same producers (platform and tool per document); regenerate both snapshots with the same settings.');
  }
  const beforeJoin = joinWorkspaceLink(link, base.servers, base.contracts, clients);
  const afterJoin = joinWorkspaceLink(link, head.servers, head.contracts, clients);
  joined.pairs.push({
    scope: link.name,
    ...optional('before', beforeJoin.joined.routes?.scopes[0]),
    ...optional('after', afterJoin.joined.routes?.scopes[0]),
    contractAuthoritative: link.contract?.authoritative === true,
    serviceIssues: { ...optional('before', beforeJoin.serviceIssue), ...optional('after', afterJoin.serviceIssue) },
  });
  joined.before.push(...beforeJoin.joined.limitations.map((limitation) => ({ ...limitation, link: link.name })));
  joined.after.push(...afterJoin.joined.limitations.map((limitation) => ({ ...limitation, link: link.name })));
  for (const document of [...base.servers, ...base.contracts]) used.before.add(document);
  for (const document of [...head.servers, ...head.contracts]) used.after.add(document);
  for (const document of clients) used.clients.add(document);
}

/** link의 선언 측(server member의 http 문서와 계약 문서)을 한 시점에서 모은다. */
function linkDeclarations(snapshot: HttpWorkspaceSnapshot, link: TraceLink): {
  servers: BridgeFactsDocument[]; contracts: BridgeFactsDocument[];
} {
  const contractLink = snapshot.workspace.links.find(({ name }) => name === link.name)!.contract;
  const contracts = (contractLink?.documents ?? []).map((path) => readDocument(snapshot, path));
  return { servers: linkServerDocuments(link, memberDocuments(snapshot, link.server)), contracts };
}

/** member의 문서를 검사해 돌려준다. persistence·sql 문서는 받되 http 비교에 쓰지 않는다(호출자가 거른다). */
function memberDocuments(snapshot: HttpWorkspaceSnapshot, name: string): BridgeFactsDocument[] {
  const member = findMember(snapshot.workspace, name);
  const documents = member.documents.map((path) => readDocument(snapshot, path));
  checkMemberDocuments(member, documents);
  return documents;
}

/** 이름으로 member를 찾는다. 파서가 link의 member 참조를 검증했으므로 없으면 내부 불변 위반이다. */
function findMember(workspace: TraceWorkspace, name: string): TraceMember {
  const member = workspace.members.find((entry) => entry.name === name);
  if (member === undefined) throw new Error('Validated workspace member is missing.');
  return member;
}

/** 읽은 문서를 경로로 찾는다. CLI가 이 모드에 필요한 문서를 모두 읽었으므로 없으면 내부 불변 위반이다. */
function readDocument(snapshot: HttpWorkspaceSnapshot, path: string): BridgeFactsDocument {
  const document = snapshot.documents.get(path);
  if (document === undefined) throw new Error('Workspace document was not read.');
  return document;
}

/**
 * 두 매니페스트의 link 정의가 같은지 검사한다. link를 바꾸면 귀속이 바뀌어 선언 측 변화와 섞인다. link의
 * server·contract member는 두 시점 모두 같은 project여야 한다 — revision과 문서 목록만 달라도 된다.
 */
function validateLinks(before: TraceWorkspace, after: TraceWorkspace): void {
  if (linkDefinitions(before) !== linkDefinitions(after)) {
    throw new HttpDiffInputError('The before and after workspace manifests must declare the same links (name, client, '
      + 'server, match, contract member and authoritative flag); change links in a separate comparison.');
  }
  for (const link of after.links) {
    for (const name of [link.server, ...(link.contract === undefined ? [] : [link.contract.member])]) {
      if (findMember(before, name).project !== findMember(after, name).project) {
        throw new HttpDiffInputError('A workspace link server or contract member must keep its project across the before and '
          + 'after manifests; produce both snapshots from the same checkout path.');
      }
    }
  }
}

/** link 정의(계약 문서 경로 제외)의 결정적 직렬화다. */
function linkDefinitions(workspace: TraceWorkspace): string {
  return JSON.stringify(workspace.links.map(linkIdentity).sort((left, right) => compareStrings(left.name, right.name)));
}

/** 출력·비교용 link 모양이다. 계약 문서 경로는 시점마다 달라도 되므로 뺀다. */
function linkIdentity(link: TraceLink): HttpDiffWorkspaceSummary['links'][number] {
  return {
    name: link.name, client: link.client, server: link.server, match: normalizeMatch(link.match),
    ...(link.contract === undefined ? {} : { contract: {
      member: link.contract.member, ...optional('authoritative', link.contract.authoritative) } }),
  };
}

/** match 목록을 정렬해 순서만 다른 두 매니페스트를 같게 본다. */
function normalizeMatch(match: TraceLinkMatch): TraceLinkMatch {
  return {
    ...optional('hosts', match.hosts === undefined ? undefined : [...match.hosts].sort(compareStrings)),
    ...optional('services', match.services === undefined ? undefined : [...match.services].sort(compareStrings)),
    ...optional('baseRefs', match.baseRefs === undefined ? undefined
      : [...match.baseRefs].sort((left, right) => compareStrings(left.ref, right.ref))),
  };
}

/** head 매니페스트에서 어느 link에도 client로 들지 않은 member의 client http 문서다. 그 호출은 평가하지 않았다. */
function unlinkedClientFindings(after: HttpWorkspaceSnapshot): HttpDiffFinding[] {
  const clients = new Set(after.workspace.links.map(({ client }) => client));
  return after.workspace.members.flatMap((member) => {
    if (clients.has(member.name)) return [];
    const count = memberDocuments(after, member.name)
      .filter((document) => document.target === 'http' && isClientDocument(document)).length;
    return count === 0 ? [] : [finding('http-member-unlinked', { member: member.name, counts: { after: count } })];
  });
}

/** workspace 출력의 입력 요약이다. */
function workspaceSummary(before: TraceWorkspace, after: TraceWorkspace): HttpDiffWorkspaceSummary {
  const members = (workspace: TraceWorkspace) => workspace.members
    .map(({ name, project, revision }) => ({ name, project, revision }))
    .sort((left, right) => compareStrings(left.name, right.name));
  return {
    links: after.links.map(linkIdentity).sort((left, right) => compareStrings(left.name, right.name)),
    before: { members: members(before) },
    after: { members: members(after) },
  };
}

/* ───────────── 조립 ───────────── */

/** finding·한계·생산자 버전을 문서로 조립한다. */
function assemble(mode: 'surface' | 'workspace', joined: JoinedPairs, extra: readonly HttpDiffFinding[],
  producers: HttpDiffDocument['producers'], identity: { project?: string; workspace?: HttpDiffWorkspaceSummary },
  hasClients: boolean): HttpDiffDocument {
  const findings = [...createHttpDiffFindings(joined.pairs), ...extra].sort(compareFindings);
  if (findings.reduce((total, { calls }) => total + (calls?.length ?? 0), 0) > MAX_HTTP_DIFF_CALLS) {
    throw new HttpDiffInputError(`diff --http would list more than ${MAX_HTTP_DIFF_CALLS} call endpoints; narrow the inputs `
      + '(fewer client documents or one service per comparison). No partial result is emitted.');
  }
  return {
    format: 'isthmus-http-diff', version: 1, mode, ...identity,
    scope: { granularity: 'route', fieldCompatibility: 'not-assessed', queryAndHeaders: 'not-assessed' },
    findings,
    limitations: { before: sortLimitations(joined.before), after: sortLimitations(joined.after) },
    producers,
    summary: summarize(findings, hasClients),
  };
}

/** 한계를 출처(link) 다음 조인 한계 순서로 정렬하고 중복을 없앤다. */
function sortLimitations(limitations: readonly HttpDiffLimitation[]): HttpDiffLimitation[] {
  const unique = new Map(limitations.map((limitation) => [JSON.stringify(limitation), limitation]));
  return [...unique.values()].sort((left, right) =>
    compareStrings(left.link ?? '', right.link ?? '') || compareLimitations(left, right));
}

/** 요약을 센다. 깨짐·rebound 호출은 끝점 신원으로 한 번씩 센다. */
function summarize(findings: readonly HttpDiffFinding[], hasClients: boolean): HttpDiffSummary {
  const count = (predicate: (value: HttpDiffFinding) => boolean) => findings.filter(predicate).length;
  const calls = (codes: readonly HttpDiffCode[]) => new Set(findings.filter(({ code }) => codes.includes(code))
    .flatMap(({ calls: entries }) => (entries ?? []).map(({ call }) => JSON.stringify(call)))).size;
  const brokenCalls = calls(brokenCodes);
  return {
    findings: findings.length,
    errors: count(({ severity }) => severity === 'error'),
    warnings: count(({ severity }) => severity === 'warning'),
    info: count(({ severity }) => severity === 'info'),
    routesAdded: count(({ code }) => code === 'route-added'),
    routesRemoved: count(({ code }) => code === 'route-removed'),
    routesChanged: new Set(findings.filter(({ code }) => changedCodes.includes(code))
      .map(({ scope, side, route }) => JSON.stringify([scope, side, route]))).size,
    brokenCalls,
    provenBrokenCalls: calls(['removed-bound-route', 'changed-bound-route']),
    reboundCalls: calls(['rebound-route-calls']),
    incompleteness: count(({ category }) => category === 'incompleteness'),
    callImpact: brokenCalls > 0 ? 'breaks-found' : hasClients ? 'no-breaks-observed' : 'not-assessed',
  };
}

/** 깨짐 finding 코드다. */
const brokenCodes: readonly HttpDiffCode[] = [
  'removed-bound-route', 'removed-bound-route-unverified', 'changed-bound-route', 'changed-bound-route-unverified',
];

/** 속성 변화 finding 코드다. */
const changedCodes: readonly HttpDiffCode[] = (Object.keys(HTTP_DIFF_CODES) as HttpDiffCode[])
  .filter((code) => code.startsWith('route-') && code.endsWith('-changed'));

/** 추출기 업그레이드가 차이의 원인인지 검토할 생산자 버전 근거다(bridge diff와 같은 모양). */
function producerVersions(documents: readonly BridgeFactsDocument[]): DiffProducerVersion[] {
  return documents.map((document) => ({ platform: document.platform, ...document.tool, generatedAt: document.generatedAt,
    ...optional('sourceModifiedAt', document.sourceModifiedAt) }))
    .sort((left, right) => compareStrings(JSON.stringify(left), JSON.stringify(right)));
}
