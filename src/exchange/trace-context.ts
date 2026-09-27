import { compareStrings } from '../compare.ts';
import { isJsonObject, isSafeNonEmptyString } from './parse.ts';
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
 * 단일 project만 받는다 — workspace(여러 저장소) trace는 계획의 Phase 3이라 원인을 밝혀 거부한다.
 */

/** 분석이 trace 체인에서 맡는 역할이다. */
export type TraceAnalysisRole = 'forward' | 'reverse' | 'db-dependents';

/** context가 가리키는 분석 하나다. */
export interface TraceAnalysisReference {
  readonly id: string;
  readonly platform: TraversalPlatform;
  readonly role: TraceAnalysisRole;
  readonly path: string;
}

/** 선택한 route 키다. 템플릿은 정규 문법, method는 동사 또는 `ANY`다. */
export interface TraceRouteSelection {
  readonly method: RouteMethod;
  readonly template: string;
  readonly scope?: string;
}

/** 선택한 언어 심볼이다. `usr`는 그 플랫폼 생산자의 id다. */
export interface TraceSymbolSelection {
  readonly platform: Exclude<TraversalPlatform, 'sql'>;
  readonly usr: string;
}

/** 정확히 한 종류의 선택이다. */
export type TraceSelection =
  | { readonly routes: readonly TraceRouteSelection[] }
  | { readonly relations: readonly string[] }
  | { readonly symbols: readonly TraceSymbolSelection[] };

/** 검증된 trace context다. */
export interface TraceContext {
  readonly format: 'isthmus-trace-context';
  readonly version: 1;
  readonly project: string;
  readonly revision?: string;
  readonly documents: readonly string[];
  readonly analyses: readonly TraceAnalysisReference[];
  readonly selection: TraceSelection;
}

/** 역할·플랫폼이 확인된 분석과 정규화된 순회 숲이다. */
export interface TraceAnalysis {
  readonly id: string;
  readonly platform: TraversalPlatform;
  readonly role: TraceAnalysisRole;
  readonly graph: TraversalGraph;
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

const roles = new Set<string>(['forward', 'reverse', 'db-dependents']);
const routeMethods = new Set<string>([...httpMethods, 'ANY']);
const contextKeys = new Set(['format', 'version', 'project', 'revision', 'documents', 'analyses', 'selection']);

/** 신뢰하지 않는 JSON을 검증된 trace context로 바꾼다. */
export function parseTraceContext(input: unknown): TraceContext {
  if (!isJsonObject(input)) fail('Trace context must be a JSON object.');
  if (input.format === 'isthmus-workspace') {
    fail('trace does not accept isthmus-workspace manifests yet; multi-project trace is planned for Phase 3. '
      + 'Pass the documents and analyses of one project in an isthmus-trace-context file.');
  }
  if (input.format !== 'isthmus-trace-context' || input.version !== 1) fail('Expected isthmus-trace-context version 1.');
  if (Object.keys(input).some((key) => !contextKeys.has(key))) fail('Trace context has an unknown field.');
  const project = safe(input.project, 'Invalid trace context project.');
  const revision = input.revision === undefined ? undefined : safe(input.revision, 'Invalid trace context revision.');
  const documents = uniquePaths(input.documents, MAX_TRACE_DOCUMENTS, 'Invalid trace context documents.');
  if (documents.length === 0) fail('Trace context requires at least one bridge-facts document.');
  const analyses = parseAnalysisReferences(input.analyses);
  return {
    format: 'isthmus-trace-context', version: 1, project, ...(revision === undefined ? {} : { revision }),
    documents, analyses, selection: parseSelection(input.selection),
  };
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
  return { id: reference.id, platform: reference.platform, role: reference.role, graph };
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

/** 분석 참조 목록을 검증한다. id는 유일해야 한다. */
function parseAnalysisReferences(input: unknown): TraceAnalysisReference[] {
  if (!Array.isArray(input) || input.length > MAX_TRACE_ANALYSES) fail('Invalid trace context analyses.');
  const ids = new Set<string>();
  return input.map((item) => {
    if (!isJsonObject(item) || Object.keys(item).some((key) => !['id', 'platform', 'role', 'path'].includes(key))) {
      fail('Invalid trace context analysis entry.');
    }
    const id = safe(item.id, 'Invalid trace context analysis id.');
    if (ids.has(id)) fail('Trace context analysis ids must be unique.');
    ids.add(id);
    if (!isTraversalPlatform(item.platform)) fail('Unsupported trace context analysis platform.');
    if (typeof item.role !== 'string' || !roles.has(item.role)) fail('Invalid trace context analysis role.');
    return { id, platform: item.platform, role: item.role as TraceAnalysisRole,
      path: safe(item.path, 'Invalid trace context analysis path.') };
  });
}

/** 선택을 검증한다. 정확히 한 종류, 비어 있지 않고 중복 없는 목록이어야 한다. */
function parseSelection(input: unknown): TraceSelection {
  if (!isJsonObject(input)) fail('Trace selection must be a JSON object.');
  const keys = Object.keys(input);
  if (keys.length !== 1 || !['routes', 'relations', 'symbols'].includes(keys[0]!)) {
    fail('Trace selection must contain exactly one of routes, relations or symbols.');
  }
  const list = input[keys[0]!];
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_TRACE_SELECTIONS) fail('Invalid trace selection list.');
  if (keys[0] === 'relations') {
    return { relations: sortedUnique(list.map((item) => safe(item, 'Invalid relation selection.')), (value) => value) };
  }
  if (keys[0] === 'symbols') {
    return { symbols: sortedUnique(list.map(parseSymbolSelection), (value) => JSON.stringify([value.platform, value.usr])) };
  }
  return { routes: sortedUnique(list.map(parseRouteSelection), (value) => JSON.stringify([value.scope ?? '', value.template, value.method])) };
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
function parseSymbolSelection(input: unknown): TraceSymbolSelection {
  if (!isJsonObject(input) || Object.keys(input).some((key) => key !== 'platform' && key !== 'usr')) {
    fail('Invalid symbol selection.');
  }
  if (!isTraversalPlatform(input.platform) || input.platform === 'sql') fail('Unsupported symbol selection platform.');
  return { platform: input.platform, usr: safe(input.usr, 'Invalid symbol selection usr.') };
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
