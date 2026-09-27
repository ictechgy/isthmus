import { compareStrings } from '../compare.ts';
import { isBridgeTimestamp, isJsonObject, isProjectRelativePath, isRouteAuthority, isSafeNonEmptyString } from './parse.ts';
import { adaptKartographImpact } from './kartograph-impact.ts';
import { adaptCartographImpact, adaptDartographImpact } from './producer-impact.ts';
import type { ProducerImpactMetadata } from './producer-impact.ts';
import {
  isTraversalPlatform,
  parseLanguageTraversal,
  traversalGraphFromDocument,
  traversalGraphFromImpact,
  TraversalValidationError,
  type TraversalGraph,
  type TraversalPlatform,
} from './language-traversal.ts';
import { adaptSchemagraphImpact } from './schemagraph-impact.ts';
import { httpMethods, isCanonicalRouteTemplate, type RouteMethod } from './route-template.ts';
import { PreflightValidationError } from './preflight-context.ts';

/**
 * `isthmus-trace-context` v1 — trace 한 번의 입력 목록과 선택이다.
 *
 * 문서·분석은 경로로만 가리키고 이 모듈은 파일을 읽지 않는다(경로 해석과 읽기는 CLI 층).
 * 두 모양을 받는다. 단일 project(`project`·`documents`·`analyses`)와, 저장소가 나뉜 workspace
 * (`members`·`links` — GRAPH-EXCHANGE의 `isthmus-workspace` member·link 모양에 member별 `analyses`를 더한
 * 것)다. 둘은 서로 배타적인 **추가 필드**라 v1을 유지한다: 옛 isthmus는 모르는 필드를 거부하므로
 * workspace context를 조용히 단일 project로 오독하지 않는다.
 */

/** 분석이 trace 체인에서 맡는 역할이다. */
export type TraceAnalysisRole = 'forward' | 'reverse' | 'db-dependents';

/**
 * 다른 곳(예: 클라이언트 macOS CI)에서 미리 계산해 내려받은 분석 artifact의 신원이다.
 *
 * `sha256`은 파일 바이트의 소문자 hex SHA-256이며 CLI가 읽은 내용과 대조한다(다르면 입력 오류).
 * `revision`은 artifact를 만든 쪽이 증언한 소스 revision이다. 분석 문서가 revision을 싣지 않는 옛 형식이면
 * 이 증언이 revision 검사에 쓰이고(출력에 `revisionSource: "attested"`), 문서가 revision을 싣는데 증언과
 * 다르면 입력 오류다. `generatedAt`은 정보용으로만 출력에 되싣는다.
 */
export interface TracePrecomputed {
  readonly sha256: string;
  readonly revision: string;
  readonly generatedAt?: string;
}

/** context가 가리키는 분석 하나다. workspace면 `member`에 속한다. */
export interface TraceAnalysisReference {
  readonly id: string;
  readonly platform: TraversalPlatform;
  readonly role: TraceAnalysisRole;
  readonly path: string;
  readonly member?: string;
  readonly precomputed?: TracePrecomputed;
}

/** 선택한 route 키다. 템플릿은 정규 문법, method는 동사 또는 `ANY`다. */
export interface TraceRouteSelection {
  readonly method: RouteMethod;
  readonly template: string;
  readonly scope?: string;
}

/** 선택한 언어 심볼이다. `usr`는 그 플랫폼 생산자의 id다. workspace면 `member`가 필수다. */
export interface TraceSymbolSelection {
  readonly platform: Exclude<TraversalPlatform, 'sql'>;
  readonly usr: string;
  readonly member?: string;
}

/** workspace의 relation 선택이다. persistence는 member 밖으로 잇지 않으므로 member를 밝힌다. */
export interface TraceMemberRelationSelection {
  readonly member: string;
  readonly name: string;
}

/** relation 선택 하나다. 단일 project는 이름 문자열, workspace는 member와 이름이다. */
export type TraceRelationSelection = string | TraceMemberRelationSelection;

/** workspace의 파일 선택이다. */
export interface TraceMemberFileSelection {
  readonly member: string;
  readonly path: string;
}

/** 파일 선택 하나다. 경로는 사실 위치와 같은 project 상대 경로다. 단일 project는 문자열이다. */
export type TraceFileSelection = string | TraceMemberFileSelection;

/** 정확히 한 종류의 선택이다. */
export type TraceSelection =
  | { readonly routes: readonly TraceRouteSelection[] }
  | { readonly relations: readonly TraceRelationSelection[] }
  | { readonly symbols: readonly TraceSymbolSelection[] }
  | { readonly files: readonly TraceFileSelection[] };

/**
 * 파일 선택 하나에 생산자 심볼 목록이 놓은 심볼이다(`fileSymbols`, 선택 필드).
 *
 * capture가 생산자 목록(tsograph `graph`·kartograph `snapshot`·cartograph `graph`)에서 선택한 파일의 심볼을 찾아
 * 싣는다. 순회 root의 위치를 싣지 않는 생산자(tsograph)나 어떤 순회도 닿지 않은 심볼은 분석 위치만으로는 이 파일에
 * 있다는 것을 알 수 없어, 없으면 trace가 사실 위치 fallback으로만 대신한다. trace는 이 목록을 분석 위치와 같은
 * 근거로 쓰며 목록이 완전한지는 검증하지 않는다.
 */
export interface TraceFileSymbols {
  /** workspace member 이름이다. 단일 project면 없다. */
  readonly member?: string;
  readonly path: string;
  readonly platform: TraversalPlatform;
  readonly usrs: readonly string[];
}

/** member의 DB 카탈로그 기록이다. `graphSha`가 있으면 그 member의 sql 분석 graphRevision과 대조한다. */
export interface TraceCatalog {
  readonly graphSha?: string;
  readonly source?: string;
}

/** workspace member 하나다. 문서·분석 경로는 context 전체에서 유일하다. */
export interface TraceMember {
  readonly name: string;
  readonly project: string;
  readonly revision: string;
  readonly documents: readonly string[];
  readonly catalog?: TraceCatalog;
}

/** link `match`의 baseRef 항목이다. `pathPrefix`(declared-base 승격)는 아직 받지 않는다. */
export interface TraceBaseRef {
  readonly ref: string;
}

/** link의 귀속 조건이다. 하나라도 맞으면 그 호출은 link에 귀속된다. */
export interface TraceLinkMatch {
  readonly hosts?: readonly string[];
  readonly services?: readonly string[];
  readonly baseRefs?: readonly TraceBaseRef[];
}

/** link의 계약 측이다. `documents`는 `member`의 문서 중 openapi 문서다. */
export interface TraceLinkContract {
  readonly member: string;
  readonly documents: readonly string[];
  readonly authoritative?: boolean;
}

/** client member의 호출을 server member의 선언(과 계약)에 잇는 link다. */
export interface TraceLink {
  readonly name: string;
  readonly client: string;
  readonly server: string;
  readonly match: TraceLinkMatch;
  readonly contract?: TraceLinkContract;
}

/** workspace 입력이다. */
export interface TraceWorkspace {
  readonly members: readonly TraceMember[];
  readonly links: readonly TraceLink[];
}

/**
 * 검증된 trace context다.
 *
 * 단일 project면 `project`(와 선택 `revision`)가 있고 `workspace`가 없다. workspace면 반대이며,
 * `documents`는 member 순서대로 이어 붙인 경로, `analyses`는 `member`가 채워진 전체 목록이다.
 */
export interface TraceContext {
  readonly format: 'isthmus-trace-context';
  readonly version: 1;
  readonly project?: string;
  readonly revision?: string;
  readonly workspace?: TraceWorkspace;
  readonly documents: readonly string[];
  readonly analyses: readonly TraceAnalysisReference[];
  readonly selection: TraceSelection;
  /** 선택한 파일에 생산자 목록이 놓은 심볼이다. 파일 선택에서만 받는다. */
  readonly fileSymbols?: readonly TraceFileSymbols[];
}

/** 역할·플랫폼이 확인된 분석과 정규화된 순회 숲이다. */
export interface TraceAnalysis {
  readonly id: string;
  readonly platform: TraversalPlatform;
  readonly role: TraceAnalysisRole;
  readonly graph: TraversalGraph;
  /** workspace member 이름이다. 단일 project면 없다. */
  readonly member?: string;
  /** revision 검사에 쓰는 값이다. 문서 값, 없으면 사전 계산 artifact의 증언 값이다. */
  readonly revision?: string;
  /** revision이 문서가 아니라 사전 계산 artifact의 증언에서 왔다. */
  readonly revisionAttested?: true;
  readonly precomputed?: TracePrecomputed;
}

/** trace context 입력 오류다. 원문 값을 메시지에 넣지 않는다. */
export class TraceContextValidationError extends Error {
  /** 입력 내용을 노출하지 않는 고정 문구만 보존한다. */
  constructor(message: string) {
    super(message);
    this.name = 'TraceContextValidationError';
  }
}

/** context 하나가 가리킬 수 있는 문서 수 상한이다. 조인 문서 상한과 같다. */
export const MAX_TRACE_DOCUMENTS = 256;
/** context 하나가 가리킬 수 있는 분석 수 상한이다. */
export const MAX_TRACE_ANALYSES = 256;
/** 한 선택 목록의 항목 상한이다. */
export const MAX_TRACE_SELECTIONS = 1_000;
/** workspace member 수 상한이다. */
export const MAX_TRACE_MEMBERS = 64;
/** workspace link 수 상한이다. */
export const MAX_TRACE_LINKS = 256;
/** link `match` 목록 하나의 항목 상한이다. */
export const MAX_LINK_MATCH_ITEMS = 1_000;
/** `fileSymbols` 항목 하나의 usr 상한이다 — `language-traversal` v1 root 상한과 같다. */
export const MAX_FILE_SYMBOL_USRS = 10_000;
/** `fileSymbols` 전체의 usr 상한이다. 파일 선택 1,000개가 저마다 큰 목록을 실어도 입력이 끝없이 커지지 않게 한다. */
export const MAX_FILE_SYMBOL_TOTAL = 100_000;

const roles = new Set<string>(['forward', 'reverse', 'db-dependents']);
const routeMethods = new Set<string>([...httpMethods, 'ANY']);
const singleKeys = new Set(['format', 'version', 'project', 'revision', 'documents', 'analyses', 'selection', 'fileSymbols']);
const workspaceKeys = new Set(['format', 'version', 'members', 'links', 'selection', 'fileSymbols']);
const sha256Pattern = /^[0-9a-f]{64}$/u;

/** 신뢰하지 않는 JSON을 검증된 trace context로 바꾼다. */
export function parseTraceContext(input: unknown): TraceContext {
  if (!isJsonObject(input)) fail('Trace context must be a JSON object.');
  if (input.format === 'isthmus-workspace') {
    fail('trace reads an isthmus-trace-context, not a bare isthmus-workspace manifest. Copy the manifest members '
      + 'and links into the context, add members[].analyses and a selection (see docs/TRACE.md).');
  }
  if (input.format !== 'isthmus-trace-context' || input.version !== 1) fail('Expected isthmus-trace-context version 1.');
  return input.members === undefined ? parseSingleContext(input) : parseWorkspaceContext(input);
}

/** 단일 project context다. */
function parseSingleContext(input: Record<string, unknown>): TraceContext {
  if (Object.keys(input).some((key) => !singleKeys.has(key))) fail('Trace context has an unknown field.');
  const project = safe(input.project, 'Invalid trace context project.');
  const revision = input.revision === undefined ? undefined : safe(input.revision, 'Invalid trace context revision.');
  const documents = uniquePaths(input.documents, MAX_TRACE_DOCUMENTS, 'Invalid trace context documents.');
  if (documents.length === 0) fail('Trace context requires at least one bridge-facts document.');
  const analyses = parseAnalysisReferences(input.analyses, undefined, new Set());
  const selection = parseSelection(input.selection, undefined);
  const fileSymbols = parseFileSymbols(input.fileSymbols, selection, undefined);
  return {
    format: 'isthmus-trace-context', version: 1, project, ...(revision === undefined ? {} : { revision }),
    documents, analyses, selection, ...(fileSymbols === undefined ? {} : { fileSymbols }),
  };
}

/**
 * workspace context다. member·link 모양은 GRAPH-EXCHANGE의 `isthmus-workspace` 초안을 그대로 쓰고,
 * member에 `analyses`를 더한다. 단일 project 필드(`project`·`revision`·`documents`·`analyses`)와 섞을 수 없다.
 */
function parseWorkspaceContext(input: Record<string, unknown>): TraceContext {
  if (Object.keys(input).some((key) => !workspaceKeys.has(key))) {
    fail('A workspace trace context takes members, links and selection; move project, revision, documents and '
      + 'analyses into members.');
  }
  if (!Array.isArray(input.members) || input.members.length === 0 || input.members.length > MAX_TRACE_MEMBERS) {
    fail(`Workspace members must be a list of 1 to ${MAX_TRACE_MEMBERS} entries.`);
  }
  const analysisIds = new Set<string>();
  const parsed = input.members.map((member) => parseMember(member, analysisIds));
  const members = parsed.map(({ member }) => member);
  const names = new Set(members.map(({ name }) => name));
  if (names.size !== members.length) fail('Workspace member names must be unique.');
  const documents = members.flatMap((member) => member.documents);
  if (documents.length > MAX_TRACE_DOCUMENTS || new Set(documents).size !== documents.length) {
    fail(`Workspace documents must be unique across members and at most ${MAX_TRACE_DOCUMENTS} in total.`);
  }
  const analyses = parsed.flatMap(({ analyses: entries }) => entries);
  if (analyses.length > MAX_TRACE_ANALYSES || new Set(analyses.map(({ path }) => path)).size !== analyses.length) {
    fail(`Workspace analyses must have unique paths and be at most ${MAX_TRACE_ANALYSES} in total.`);
  }
  const links = parseLinks(input.links, members);
  const selection = parseSelection(input.selection, names);
  const fileSymbols = parseFileSymbols(input.fileSymbols, selection, names);
  return {
    format: 'isthmus-trace-context', version: 1, workspace: { members, links }, documents, analyses,
    selection, ...(fileSymbols === undefined ? {} : { fileSymbols }),
  };
}

/** `isthmus-workspace` 매니페스트의 최상위 키다. */
const manifestKeys = new Set(['format', 'version', 'members', 'links']);

/**
 * 맨 `isthmus-workspace` v1 매니페스트(GRAPH-EXCHANGE)를 검증한다. `diff --http`의 workspace 모드가 쓴다.
 *
 * member·link 규칙은 trace workspace context와 **같은 코드**다(member `revision` 필수, 구현하지 않은 match 필드 거부,
 * 계약 문서 소속 검사). 매니페스트에는 순회가 없으므로 member `analyses`는 받지 않는다 — 받으면 읽지 않는 필드를
 * 조용히 버리게 된다. 반환 모양은 trace의 `TraceWorkspace`이고 문서 경로는 member 순서대로 이어 붙인다.
 */
export function parseWorkspaceManifest(input: unknown): TraceWorkspace & { readonly documents: readonly string[] } {
  if (!isJsonObject(input) || input.format !== 'isthmus-workspace' || input.version !== 1) {
    fail('Expected an isthmus-workspace version 1 manifest.');
  }
  if (Object.keys(input).some((key) => !manifestKeys.has(key))) fail('Workspace manifest has an unknown field.');
  if (!Array.isArray(input.members) || input.members.length === 0 || input.members.length > MAX_TRACE_MEMBERS) {
    fail(`Workspace members must be a list of 1 to ${MAX_TRACE_MEMBERS} entries.`);
  }
  if (input.members.some((member) => isJsonObject(member) && member.analyses !== undefined)) {
    fail('Workspace manifest members do not take analyses; analyses belong to a trace context.');
  }
  const members = input.members.map((member) => parseMember(member, new Set()).member);
  if (new Set(members.map(({ name }) => name)).size !== members.length) fail('Workspace member names must be unique.');
  const documents = members.flatMap((member) => member.documents);
  if (documents.length > MAX_TRACE_DOCUMENTS || new Set(documents).size !== documents.length) {
    fail(`Workspace documents must be unique across members and at most ${MAX_TRACE_DOCUMENTS} in total.`);
  }
  return { members, links: parseLinks(input.links, members), documents };
}

/** member 하나와 그 분석 참조를 검증한다. */
function parseMember(input: unknown, analysisIds: Set<string>): { member: TraceMember; analyses: TraceAnalysisReference[] } {
  const keys = ['name', 'project', 'revision', 'documents', 'analyses', 'catalog'];
  if (!isJsonObject(input) || Object.keys(input).some((key) => !keys.includes(key))) fail('Invalid workspace member entry.');
  const name = safe(input.name, 'Invalid workspace member name.');
  const project = safe(input.project, 'Invalid workspace member project.');
  // member 사이에는 context revision이 없다. 분석 신선도를 member마다 검사하려면 revision이 반드시 있어야 한다.
  const revision = safe(input.revision, 'Every workspace member needs a revision (for example its git commit sha).');
  const documents = uniquePaths(input.documents, MAX_TRACE_DOCUMENTS, 'Invalid workspace member documents.');
  if (documents.length === 0) fail('Every workspace member needs at least one bridge-facts document.');
  const catalog = input.catalog === undefined ? undefined : parseCatalog(input.catalog);
  const analyses = parseAnalysisReferences(input.analyses ?? [], name, analysisIds);
  return { member: { name, project, revision, documents, ...(catalog === undefined ? {} : { catalog }) }, analyses };
}

/** member의 DB 카탈로그 기록을 검증한다. 비어 있는 기록은 아무것도 말하지 않으므로 거부한다. */
function parseCatalog(input: unknown): TraceCatalog {
  if (!isJsonObject(input) || Object.keys(input).length === 0 ||
    Object.keys(input).some((key) => key !== 'graphSha' && key !== 'source')) {
    fail('Invalid workspace member catalog; use graphSha and/or source.');
  }
  return {
    ...(input.graphSha === undefined ? {} : { graphSha: safe(input.graphSha, 'Invalid catalog graphSha.') }),
    ...(input.source === undefined ? {} : { source: safe(input.source, 'Invalid catalog source.') }),
  };
}

/** link 목록을 검증한다. member 참조와 계약 문서의 소속을 확인한다. */
function parseLinks(input: unknown, members: readonly TraceMember[]): TraceLink[] {
  if (!Array.isArray(input) || input.length > MAX_TRACE_LINKS) fail(`Workspace links must be a list of at most ${MAX_TRACE_LINKS} entries.`);
  const byName = new Map(members.map((member) => [member.name, member]));
  const links = input.map((item) => parseLink(item, byName));
  if (new Set(links.map(({ name }) => name)).size !== links.length) fail('Workspace link names must be unique.');
  return links;
}

/** link 하나를 검증한다. */
function parseLink(input: unknown, members: ReadonlyMap<string, TraceMember>): TraceLink {
  if (!isJsonObject(input) || Object.keys(input).some((key) => !['name', 'client', 'server', 'match', 'contract'].includes(key))) {
    fail('Invalid workspace link entry.');
  }
  const name = safe(input.name, 'Invalid workspace link name.');
  const client = safe(input.client, 'Invalid workspace link client.');
  const server = safe(input.server, 'Invalid workspace link server.');
  if (!members.has(client) || !members.has(server)) fail('Workspace link client and server must name members.');
  const contract = input.contract === undefined ? undefined : parseLinkContract(input.contract, members);
  return { name, client, server, match: parseLinkMatch(input.match), ...(contract === undefined ? {} : { contract }) };
}

/**
 * link `match`를 검증한다. 초안의 네 조건 중 `hosts`·`services`·`baseRefs[].ref`만 구현했다.
 * `interfaces`와 `baseRefs[].pathPrefix`(declared-base 승격)는 조용히 무시하지 않고 거부한다.
 */
function parseLinkMatch(input: unknown): TraceLinkMatch {
  if (!isJsonObject(input)) fail('Every workspace link needs a match object (hosts, services or baseRefs).');
  if (input.interfaces !== undefined) {
    fail('link match.interfaces is not implemented yet; attribute calls with hosts, services or baseRefs.');
  }
  if (Object.keys(input).some((key) => !['hosts', 'services', 'baseRefs'].includes(key))) fail('Invalid workspace link match field.');
  const hosts = input.hosts === undefined ? undefined : matchList(input.hosts, (value) => {
    if (!isRouteAuthority(value)) fail('link match.hosts entries must be lowercase host[:port] authorities.');
    return value;
  });
  const services = input.services === undefined ? undefined
    : matchList(input.services, (value) => safe(value, 'Invalid link match service.'));
  const baseRefs = input.baseRefs === undefined ? undefined : matchList(input.baseRefs, parseBaseRef);
  if ((hosts?.length ?? 0) + (services?.length ?? 0) + (baseRefs?.length ?? 0) === 0) {
    fail('A workspace link match needs at least one host, service or baseRef; calls are never attributed by guesswork.');
  }
  return { ...(hosts === undefined ? {} : { hosts }), ...(services === undefined ? {} : { services }),
    ...(baseRefs === undefined ? {} : { baseRefs }) };
}

/** baseRef 항목 하나다. */
function parseBaseRef(input: unknown): TraceBaseRef {
  if (!isJsonObject(input)) fail('Invalid link match baseRef.');
  if (input.pathPrefix !== undefined) {
    fail('link match.baseRefs[].pathPrefix (declared-base promotion) is not implemented yet; remove it to attribute by ref only.');
  }
  if (Object.keys(input).some((key) => key !== 'ref')) fail('Invalid link match baseRef field.');
  return { ref: safe(input.ref, 'Invalid link match baseRef ref.') };
}

/** 중복 없는 match 목록을 입력 순서 그대로 검증한다(순서는 의미가 없고 출력은 그대로 되싣는다). */
function matchList<T>(input: unknown, parse: (value: unknown) => T): T[] {
  if (!Array.isArray(input) || input.length > MAX_LINK_MATCH_ITEMS) fail('Invalid workspace link match list.');
  const values = input.map(parse);
  if (new Set(values.map((value) => JSON.stringify(value))).size !== values.length) fail('Workspace link match lists must not repeat entries.');
  return values;
}

/** link 계약 측을 검증한다. 계약 문서는 계약 member가 가진 문서여야 한다. */
function parseLinkContract(input: unknown, members: ReadonlyMap<string, TraceMember>): TraceLinkContract {
  if (!isJsonObject(input) || Object.keys(input).some((key) => !['member', 'documents', 'authoritative'].includes(key))) {
    fail('Invalid workspace link contract.');
  }
  const member = members.get(safe(input.member, 'Invalid workspace link contract member.'));
  if (member === undefined) fail('Workspace link contract member must name a member.');
  const documents = uniquePaths(input.documents, MAX_TRACE_DOCUMENTS, 'Invalid workspace link contract documents.');
  if (documents.length === 0 || documents.some((path) => !member.documents.includes(path))) {
    fail('Workspace link contract documents must be non-empty and listed in the contract member documents.');
  }
  if (input.authoritative !== undefined && typeof input.authoritative !== 'boolean') fail('Invalid workspace link contract authoritative flag.');
  return { member: member.name, documents,
    ...(input.authoritative === undefined ? {} : { authoritative: input.authoritative }) };
}

/** 분석 참조의 project다. 단일 project면 context project, workspace면 그 member의 project다. */
export function analysisProject(context: TraceContext, reference: TraceAnalysisReference): string {
  if (context.workspace === undefined) return context.project!;
  return context.workspace.members.find(({ name }) => name === reference.member)!.project;
}

/**
 * 분석 원문을 형식에 맞는 파서·어댑터로 정규화하고 context 선언(플랫폼·역할)과 대조한다.
 *
 * - `language-traversal` v1: 모든 역할. 방향은 forward=dependencies, 나머지=dependents.
 * - `schemagraph-impact` v1 또는 sql traversal: `db-dependents`(platform sql) 전용.
 * - `kartograph-impact` v1(kotlin)·`change-impact` v1(swift)·dartograph impact v1(dart): `reverse` 전용.
 *   preflight와 같은 어댑터를 공유한다.
 */
export function normalizeTraceAnalysis(raw: unknown, reference: TraceAnalysisReference, project: string): TraceAnalysis {
  const graph = adaptAnalysis(raw, reference, project);
  if (graph.platform !== reference.platform) fail('Analysis platform differs from its trace context entry.');
  const expected = reference.role === 'forward' ? 'dependencies' : 'dependents';
  if (graph.direction !== expected) fail(`A ${reference.role} analysis must be a ${expected} traversal.`);
  if ((reference.role === 'db-dependents') !== (reference.platform === 'sql')) {
    fail('db-dependents analyses must be sql traversals, and sql traversals must use the db-dependents role.');
  }
  const { precomputed, member } = reference;
  if (precomputed !== undefined && graph.revision !== undefined && graph.revision !== precomputed.revision) {
    fail('Analysis revision contradicts its precomputed revision attestation; fix the context or re-download the artifact.');
  }
  const revision = graph.revision ?? precomputed?.revision;
  return {
    id: reference.id, platform: reference.platform, role: reference.role, graph,
    ...(member === undefined ? {} : { member }),
    ...(revision === undefined ? {} : { revision }),
    ...(graph.revision === undefined && precomputed !== undefined ? { revisionAttested: true as const } : {}),
    ...(precomputed === undefined ? {} : { precomputed }),
  };
}

/** 형식 표식으로 파서·어댑터를 고른다. 모르는 형식은 거부한다. */
function adaptAnalysis(raw: unknown, reference: TraceAnalysisReference, project: string): TraversalGraph {
  if (!isJsonObject(raw)) fail('Analysis must be a JSON object.');
  if (reference.role === 'db-dependents') {
    const graph = adaptSchemagraphImpact(raw);
    // 옛 schemagraph-impact에는 project가 없다. 새 형식만 project 일치를 확인할 수 있다.
    if (graph.source === 'language-traversal' && raw.project !== project) {
      fail('Analysis project differs from the trace context project.');
    }
    return graph;
  }
  if (raw.format === 'language-traversal') {
    const document = parseLanguageTraversal(raw);
    if (document.project !== project) fail('Analysis project differs from the trace context project.');
    return traversalGraphFromDocument(document);
  }
  // preflight 어댑터는 수집 문맥(선택·도구)을 요구한다. 옛 역방향 형식에는 도구 버전이 없고 trace는
  // 선택을 분석 root로 대신하므로, 둘 다 어댑터 검증용 자리값이며 출력에 싣지 않는다.
  const metadata: ProducerImpactMetadata = {
    id: reference.id, project, requested: { files: [], symbols: [reference.id] },
    tool: { name: reference.platform, version: 'unreported' },
  };
  try {
    if (raw.format === 'kartograph-impact') return traversalGraphFromImpact(adaptKartographImpact(raw, metadata), 'kartograph-impact');
    if (raw.format === 'change-impact') return traversalGraphFromImpact(adaptCartographImpact(raw, metadata), 'change-impact');
    if (raw.format === undefined && raw.version === 1 && isJsonObject(raw.changed)) {
      return traversalGraphFromImpact(adaptDartographImpact(raw, metadata), 'dartograph-impact');
    }
  } catch (error) {
    if (error instanceof PreflightValidationError) fail(`Invalid producer impact analysis: ${error.message}`);
    throw error;
  }
  return fail('Unsupported analysis format; expected language-traversal v1, kartograph-impact v1, '
    + 'change-impact v1, dartograph impact v1, or (for db-dependents) schemagraph-impact v1.');
}

/** 분석 참조 목록을 검증한다. id는 context 전체(workspace면 모든 member)에서 유일해야 한다. */
function parseAnalysisReferences(input: unknown, member: string | undefined, ids: Set<string>): TraceAnalysisReference[] {
  if (!Array.isArray(input) || input.length > MAX_TRACE_ANALYSES) fail('Invalid trace context analyses.');
  return input.map((item) => {
    if (!isJsonObject(item) || Object.keys(item).some((key) => !['id', 'platform', 'role', 'path', 'precomputed'].includes(key))) {
      fail('Invalid trace context analysis entry.');
    }
    const id = safe(item.id, 'Invalid trace context analysis id.');
    if (ids.has(id)) fail('Trace context analysis ids must be unique.');
    ids.add(id);
    if (!isTraversalPlatform(item.platform)) fail('Unsupported trace context analysis platform.');
    if (typeof item.role !== 'string' || !roles.has(item.role)) fail('Invalid trace context analysis role.');
    const precomputed = item.precomputed === undefined ? undefined : parsePrecomputed(item.precomputed);
    return { id, platform: item.platform, role: item.role as TraceAnalysisRole,
      path: safe(item.path, 'Invalid trace context analysis path.'),
      ...(member === undefined ? {} : { member }), ...(precomputed === undefined ? {} : { precomputed }) };
  });
}

/** 사전 계산 artifact 신원을 검증한다. sha256 없는 증언은 파일과 묶이지 않으므로 받지 않는다. */
function parsePrecomputed(input: unknown): TracePrecomputed {
  if (!isJsonObject(input) || Object.keys(input).some((key) => !['sha256', 'revision', 'generatedAt'].includes(key))) {
    fail('Invalid precomputed analysis entry; use sha256, revision and optional generatedAt.');
  }
  if (typeof input.sha256 !== 'string' || !sha256Pattern.test(input.sha256)) {
    fail('Precomputed analyses need the lowercase hex sha256 of the artifact file.');
  }
  const revision = safe(input.revision, 'Precomputed analyses need the source revision the artifact was computed from.');
  if (input.generatedAt !== undefined && !isBridgeTimestamp(input.generatedAt)) fail('Invalid precomputed generatedAt timestamp.');
  return { sha256: input.sha256, revision, ...(input.generatedAt === undefined ? {} : { generatedAt: input.generatedAt }) };
}

/**
 * 선택을 검증한다. 정확히 한 종류, 비어 있지 않고 중복 없는 목록이어야 한다.
 * `members`가 있으면(workspace) relation·symbol·file 선택은 member를 밝혀야 한다.
 */
function parseSelection(input: unknown, members: ReadonlySet<string> | undefined): TraceSelection {
  if (!isJsonObject(input)) fail('Trace selection must be a JSON object.');
  const keys = Object.keys(input);
  if (keys.length !== 1 || !['routes', 'relations', 'symbols', 'files'].includes(keys[0]!)) {
    fail('Trace selection must contain exactly one of routes, relations, symbols or files.');
  }
  const list = input[keys[0]!];
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_TRACE_SELECTIONS) fail('Invalid trace selection list.');
  if (keys[0] === 'relations') {
    return { relations: sortedUnique(list.map((item) => parseRelationSelection(item, members)), selectionKey) };
  }
  if (keys[0] === 'symbols') {
    return { symbols: sortedUnique(list.map((item) => parseSymbolSelection(item, members)),
      (value) => JSON.stringify([value.member ?? '', value.platform, value.usr])) };
  }
  if (keys[0] === 'files') {
    return { files: sortedUnique(list.map((item) => parseFileSelection(item, members)), selectionKey) };
  }
  return { routes: sortedUnique(list.map(parseRouteSelection), (value) => JSON.stringify([value.scope ?? '', value.template, value.method])) };
}

/** relation·file 선택의 정렬 키다. 단일 project는 문자열 그대로라 기존 순서와 같다. */
function selectionKey(value: string | TraceMemberRelationSelection | TraceMemberFileSelection): string {
  if (typeof value === 'string') return value;
  return JSON.stringify([value.member, 'name' in value ? value.name : value.path]);
}

/** workspace 선택의 member를 검증한다. 단일 project에서는 member를 받지 않는다. */
function selectionMember(input: Record<string, unknown>, members: ReadonlySet<string> | undefined): { member?: string } {
  if (members === undefined) {
    if (input.member !== undefined) fail('Only workspace trace contexts accept a selection member.');
    return {};
  }
  const member = safe(input.member, 'Workspace selections of relations, symbols and files need a member.');
  if (!members.has(member)) fail('Selection member must name a workspace member.');
  return { member };
}

/** relation 선택 하나다. 단일 project는 이름 문자열, workspace는 `{member, name}`이다. */
function parseRelationSelection(input: unknown, members: ReadonlySet<string> | undefined): TraceRelationSelection {
  if (members === undefined) return safe(input, 'Invalid relation selection.');
  if (!isJsonObject(input) || Object.keys(input).some((key) => key !== 'member' && key !== 'name')) {
    fail('Workspace relation selections must be {member, name} objects.');
  }
  return { member: selectionMember(input, members).member!, name: safe(input.name, 'Invalid relation selection.') };
}

/** 파일 선택 하나다. 경로는 사실 위치와 같은 project 상대 경로여야 한다. */
function parseFileSelection(input: unknown, members: ReadonlySet<string> | undefined): TraceFileSelection {
  const path = (value: unknown) => {
    if (!isProjectRelativePath(value)) fail('File selections must be project-relative paths without "..".');
    return value;
  };
  if (members === undefined) return path(input);
  if (!isJsonObject(input) || Object.keys(input).some((key) => key !== 'member' && key !== 'path')) {
    fail('Workspace file selections must be {member, path} objects.');
  }
  return { member: selectionMember(input, members).member!, path: path(input.path) };
}

/** route 선택 하나를 검증한다. 템플릿이 정규 문법이 아니면 거부한다(다시 정규화하지 않는다). */
function parseRouteSelection(input: unknown): TraceRouteSelection {
  if (!isJsonObject(input) || Object.keys(input).some((key) => !['method', 'template', 'scope'].includes(key))) {
    fail('Invalid route selection.');
  }
  if (typeof input.method !== 'string' || !routeMethods.has(input.method)) fail('Invalid route selection method.');
  if (typeof input.template !== 'string' || !isCanonicalRouteTemplate(input.template)) {
    fail('Route selection templates must use the canonical route template grammar.');
  }
  const scope = input.scope === undefined ? undefined : safe(input.scope, 'Invalid route selection scope.');
  return { method: input.method as RouteMethod, template: input.template, ...(scope === undefined ? {} : { scope }) };
}

/** 심볼 선택 하나를 검증한다. sql 정점은 relations 선택으로 묻는다. */
function parseSymbolSelection(input: unknown, members: ReadonlySet<string> | undefined): TraceSymbolSelection {
  if (!isJsonObject(input) || Object.keys(input).some((key) => !['platform', 'usr', 'member'].includes(key))) {
    fail('Invalid symbol selection.');
  }
  if (!isTraversalPlatform(input.platform) || input.platform === 'sql') fail('Unsupported symbol selection platform.');
  return { platform: input.platform, usr: safe(input.usr, 'Invalid symbol selection usr.'), ...selectionMember(input, members) };
}

/**
 * `fileSymbols`를 검증한다. 파일 선택에서만 받고, 항목마다 선택한 파일(workspace면 같은 member)을 가리켜야 한다 —
 * 선택하지 않은 파일의 목록은 쓰이지 않으므로 다른 선택용 context를 잘못 붙인 것으로 보고 거부한다(fail-closed).
 * (member, path, platform)은 유일하고, usr는 항목 안에서 중복 없이 1~{@link MAX_FILE_SYMBOL_USRS}개다.
 */
function parseFileSymbols(input: unknown, selection: TraceSelection,
  members: ReadonlySet<string> | undefined): TraceFileSymbols[] | undefined {
  if (input === undefined) return undefined;
  if (!('files' in selection)) fail('fileSymbols is accepted only with a files selection.');
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_TRACE_SELECTIONS * 8) fail('Invalid fileSymbols list.');
  const selected = new Set(selection.files.map((file) => selectionKey(file)));
  let total = 0;
  const entries = input.map((item): TraceFileSymbols => {
    if (!isJsonObject(item) || Object.keys(item).some((key) => !['member', 'path', 'platform', 'usrs'].includes(key))) {
      fail('Each fileSymbols entry takes path, platform, usrs and (in a workspace) member.');
    }
    const { member } = selectionMember(item, members);
    if (!isProjectRelativePath(item.path)) fail('fileSymbols paths must be project-relative paths without "..".');
    const key = member === undefined ? item.path : selectionKey({ member, path: item.path });
    if (!selected.has(key)) fail('A fileSymbols entry names a file that the files selection does not select.');
    if (!isTraversalPlatform(item.platform) || item.platform === 'sql') fail('Unsupported fileSymbols platform.');
    if (!Array.isArray(item.usrs) || item.usrs.length === 0 || item.usrs.length > MAX_FILE_SYMBOL_USRS ||
      !item.usrs.every(isSafeNonEmptyString) || new Set(item.usrs).size !== item.usrs.length) {
      fail(`fileSymbols usrs must be 1 to ${MAX_FILE_SYMBOL_USRS} distinct non-empty strings without control characters.`);
    }
    total += item.usrs.length;
    return { ...(member === undefined ? {} : { member }), path: item.path, platform: item.platform,
      usrs: [...(item.usrs as string[])].sort(compareStrings) };
  });
  if (total > MAX_FILE_SYMBOL_TOTAL) fail(`fileSymbols may list at most ${MAX_FILE_SYMBOL_TOTAL} usrs in total.`);
  const keyed = entries.map((entry) => [JSON.stringify([entry.member ?? '', entry.path, entry.platform]), entry] as const)
    .sort(([left], [right]) => compareStrings(left, right));
  if (keyed.some(([identity], index) => index > 0 && keyed[index - 1]![0] === identity)) {
    fail('fileSymbols entries must be unique per member, path and platform.');
  }
  return keyed.map(([, entry]) => entry);
}

/** 중복을 거부하고 결정적 순서로 정렬한다. */
function sortedUnique<T>(values: readonly T[], key: (value: T) => string): T[] {
  const keyed = values.map((value) => [key(value), value] as const).sort(([left], [right]) => compareStrings(left, right));
  if (keyed.some(([identity], index) => index > 0 && keyed[index - 1]![0] === identity)) fail('Trace selection has duplicates.');
  return keyed.map(([, value]) => value);
}

/** 경로 목록을 검증한다. 중복 경로는 같은 문서를 두 번 조인하므로 거부한다. */
function uniquePaths(input: unknown, maximum: number, message: string): string[] {
  if (!Array.isArray(input) || input.length > maximum || !input.every(isSafeNonEmptyString) ||
    new Set(input).size !== input.length) fail(message);
  return [...input] as string[];
}

function safe(input: unknown, message: string): string {
  if (!isSafeNonEmptyString(input)) fail(message);
  return input;
}

function fail(message: string): never {
  throw new TraceContextValidationError(message);
}

export { TraversalValidationError };
