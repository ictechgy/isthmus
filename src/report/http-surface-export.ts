import { compareStrings } from '../compare.ts';
import {
  canonicalJson,
  computeSurfaceDigest,
  HTTP_SURFACE_FORMAT,
  importHttpSurface,
  SURFACE_LIMITATION_DETAIL,
  surfaceLimitationPrefixes,
  type HttpSurface,
  type HttpSurfaceDocument,
  type HttpSurfaceFact,
} from '../exchange/http-surface.ts';
import type { BridgeFact, BridgeFactsDocument, BridgeLimitationScope } from '../exchange/parse.ts';
import { isDeclarationDocument } from '../join/route-join.ts';

/**
 * 서버 문서에서 `isthmus-http-surface` v1을 만든다(`isthmus surface export`).
 *
 * 무엇을 빼는지가 이 모듈의 핵심이다. surface는 조직 밖으로 나가는 artifact라서 가져오는 쪽 조인(귀속·매칭·error
 * 전제)에 필요한 선언 측 사실만 남기고, 서버 내부를 드러내는 값은 모두 뺀다:
 *
 * - 위치(핸들러 소스 경로)·핸들러 이름·`sourceModifiedAt`·문서 `project`(절대 경로)
 * - 핸들러 usr — 게시자가 `includeHandlerUsrs`를 고르면 usr만 싣는다. 대신 불투명 토큰(`h1`…)으로 같은 핸들러를 묶는다.
 * - route-call 사실(서버가 부르는 다른 서비스), 테스트 소스 사실
 * - dynamic 선언의 원문 식(개수만 남게 channel을 null로)
 * - registration-order group 이름(`g1`… 불투명 토큰으로 — 순서 비교는 같은 문서·같은 group 안에서만 하므로 뜻이 같다)
 * - 한계 원문 — 기본은 서버·계약 측 공백 접두사와 고정 문구만. 호출 측·체인 전용·모르는 접두사의 한계는 가져오는 쪽
 *   판정에 쓰이지 않으므로 싣지 않는다.
 */

/** surface 내보내기 선택이다. */
export interface HttpSurfaceExportOptions {
  readonly name: string;
  readonly revision: string;
  readonly exporterVersion: string;
  /** 핸들러 usr를 싣는다(이름은 싣지 않는다). 기본은 불투명 토큰만이다. */
  readonly includeHandlerUsrs?: boolean;
  /** 서버·계약 측 한계의 원문을 싣는다. 기본은 접두사와 고정 문구만이다. */
  readonly includeLimitationText?: boolean;
}

/** 내보낼 수 없는 입력이다. 원문 값을 메시지에 넣지 않는다. */
export class HttpSurfaceExportError extends Error {
  /** 원인과 해결 방향을 담은 고정 문구만 보존한다. */
  constructor(message: string) {
    super(message);
    this.name = 'HttpSurfaceExportError';
  }
}

/**
 * 한 서버의 선언 측 http 문서(route-decl 문서와 openapi 문서)로 surface를 만든다.
 *
 * 만든 surface는 가져오는 쪽 파서({@link importHttpSurface})로 다시 검증한다 — 내보낸 artifact가 계약을 어기면
 * 게시 전에 실패한다.
 */
export function createHttpSurface(documents: readonly BridgeFactsDocument[], options: HttpSurfaceExportOptions): HttpSurface {
  validateExportInputs(documents);
  const handlerTokens = tokenize(documents.flatMap(({ facts }) =>
    facts.flatMap((fact) => fact.kind === 'route-decl' && fact.testSource !== true && fact.symbol?.usr !== undefined
      ? [fact.symbol.usr] : [])), 'h');
  const surfaceDocuments = documents.map((document) => exportDocument(document, handlerTokens, options))
    .map((document) => ({ document, key: canonicalJson(document) }))
    .sort((left, right) => compareStrings(left.key, right.key))
    .map(({ document }) => document);
  const content = {
    format: HTTP_SURFACE_FORMAT as typeof HTTP_SURFACE_FORMAT, version: 1 as const, name: options.name, revision: options.revision,
    exporter: { name: 'isthmus', version: options.exporterVersion },
    privacy: { handlers: options.includeHandlerUsrs === true ? 'usr' as const : 'opaque' as const,
      limitations: options.includeLimitationText === true ? 'full' as const : 'prefix-only' as const },
    continuation: 'opaque' as const,
    documents: surfaceDocuments,
  };
  const surface: HttpSurface = { ...content, digest: computeSurfaceDigest(content) };
  importHttpSurface(JSON.parse(JSON.stringify(surface)));
  return surface;
}

/**
 * 내보낼 문서 묶음을 검사한다: 선언 측 http 문서(사실 0건 openapi 포함)만, 한 project, `mixed-targets` 없음.
 * 클라이언트 전용 문서는 서버 표면이 아니므로 거부한다(서버·클라이언트를 겸하는 문서는 선언 측만 쓴다).
 */
function validateExportInputs(documents: readonly BridgeFactsDocument[]): void {
  if (documents.length === 0) throw new HttpSurfaceExportError('surface export needs at least one server or spec document.');
  for (const document of documents) {
    const spec = document.platform === 'openapi' && (document.target === 'http' || document.target === null);
    if (!spec && (document.target !== 'http' || !isDeclarationDocument(document))) {
      throw new HttpSurfaceExportError('surface export takes only http server documents (route-decl) and openapi documents; '
        + 'remove client-only, persistence, sql and bridge documents.');
    }
    if (document.limitations.some((message) => message.startsWith('mixed-targets'))) {
      throw new HttpSurfaceExportError('surface export cannot publish a document with a mixed-targets limitation; split it by target.');
    }
  }
  if (new Set(documents.map(({ project }) => project)).size !== 1) {
    throw new HttpSurfaceExportError('surface export describes one server; produce every document from the same project root.');
  }
}

/** 문서 하나를 surface 문서로 바꾼다. */
function exportDocument(document: BridgeFactsDocument, handlerTokens: ReadonlyMap<string, string>,
  options: HttpSurfaceExportOptions): HttpSurfaceDocument {
  const facts = document.facts.filter((fact) =>
    (fact.kind === 'route-decl' || fact.kind === 'route-contract') && fact.testSource !== true);
  const groupTokens = tokenize(facts.flatMap(({ order }) => order === undefined ? [] : [order.group]), 'g');
  const { limitations, limitationScopes } = exportLimitations(document, options.includeLimitationText === true);
  const openapi = document.platform === 'openapi';
  return {
    platform: document.platform,
    target: document.target === 'http' ? 'http' : null,
    tool: { name: document.tool.name, version: document.tool.version },
    generatedAt: document.generatedAt,
    ...(document.roles === undefined ? {} : { roles: ['server'] }),
    ...(document.dispatch === undefined ? {} : { dispatch: document.dispatch }),
    ...(document.sourceSets === undefined ? {} : { sourceSets: { tests: 'excluded' } }),
    ...(document.service === undefined ? {} : { service: document.service }),
    facts: facts.map((fact) => exportFact(fact, openapi, handlerTokens, groupTokens, options.includeHandlerUsrs === true)),
    limitations,
    ...(limitationScopes.length === 0 ? {} : { limitationScopes }),
  };
}

/** 사실 하나를 surface 사실로 바꾼다. 위치·이름·귀속 필드는 싣지 않는다. */
function exportFact(fact: BridgeFact, openapi: boolean, handlerTokens: ReadonlyMap<string, string>,
  groupTokens: ReadonlyMap<string, string>, includeUsr: boolean): HttpSurfaceFact {
  const dynamic = fact.dynamic || fact.channel === null;
  const usr = openapi ? undefined : fact.symbol?.usr;
  const handler = usr === undefined ? undefined : handlerTokens.get(usr);
  return {
    kind: fact.kind as HttpSurfaceFact['kind'],
    channel: dynamic ? null : fact.channel,
    method: fact.method,
    dynamic,
    pathAnchor: fact.pathAnchor,
    ...copyDefined(fact, ['service', 'trailingSlash', 'caseInsensitive', 'narrowed', 'configDefault', 'catchAllPrefix', 'operationId']),
    ...(fact.paramConstraints === undefined ? {} : { paramConstraints: fact.paramConstraints }),
    ...(fact.order === undefined ? {} : { order: { group: groupTokens.get(fact.order.group)!, index: fact.order.index } }),
    ...(handler === undefined ? {} : { handler }),
    ...(openapi && fact.symbol !== undefined ? { symbol: { qualifiedName: fact.symbol.qualifiedName } } : {}),
    ...(includeUsr && usr !== undefined ? { symbol: { usr } } : {}),
  };
}

/** 값이 있는 필드만 복사한다. */
function copyDefined(fact: BridgeFact, fields: readonly (keyof BridgeFact)[]): Record<string, unknown> {
  return Object.fromEntries(fields.flatMap((field) => fact[field] === undefined ? [] : [[field, fact[field]]]));
}

/**
 * 한계를 surface에 싣는다. 서버·계약 측 공백 접두사의 한계만 남기고(원문 또는 접두사 + 고정 문구), 그 스코프의
 * 인덱스를 남은 목록에 맞춰 다시 매긴다. 스코프 원소는 선언 측 경로라 그대로 싣는다.
 */
function exportLimitations(document: BridgeFactsDocument, includeText: boolean): {
  limitations: string[]; limitationScopes: BridgeLimitationScope[];
} {
  const kept: Array<{ from: number; message: string }> = [];
  document.limitations.forEach((message, index) => {
    const prefix = surfaceLimitationPrefixes.find((candidate) => message.startsWith(candidate));
    if (prefix !== undefined) kept.push({ from: index, message: includeText ? message : `${prefix} ${SURFACE_LIMITATION_DETAIL}` });
  });
  const remap = new Map(kept.map(({ from }, to) => [from, to]));
  const limitationScopes = (document.limitationScopes ?? []).flatMap((scope) => {
    const to = remap.get(scope.limitationIndex);
    return to === undefined ? [] : [{ ...scope, limitationIndex: to }];
  });
  return { limitations: kept.map(({ message }) => message), limitationScopes };
}

/** 값 목록을 정렬해 `<prefix>1`, `<prefix>2`, … 불투명 토큰에 대응시킨다. */
function tokenize(values: readonly string[], prefix: string): Map<string, string> {
  return new Map([...new Set(values)].sort(compareStrings).map((value, index) => [value, `${prefix}${index + 1}`]));
}
