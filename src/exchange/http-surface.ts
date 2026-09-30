import { createHash } from 'node:crypto';

import { compareStrings } from '../compare.ts';
import { contractRouteGapPrefixes, serverRouteGapPrefixes } from '../join/route-limitation-scope.ts';
import {
  BridgeFactsValidationError,
  isJsonObject,
  isSafeNonEmptyString,
  parseBridgeFactsDocument,
  type BridgeFact,
  type BridgeFactsDocument,
  type BridgeSymbol,
} from './parse.ts';

/**
 * `isthmus-http-surface` v1 — 조직 경계를 넘어 건네는 서버 http 표면이다(docs/HTTP-SURFACE.md).
 *
 * 한 workspace 매니페스트가 서버와 클라이언트 저장소를 함께 가리킬 수 없는 조직(다른 회사·다른 팀 권한)을 위해,
 * 서버 쪽이 선언 측 사실(route-decl·route-contract)만 담은 자기 완결 artifact를 게시하고 클라이언트 쪽이 그것을
 * link의 server·contract member로 가져온다. 서버 내부(핸들러 소스 경로·심볼 usr·한계 원문·router group 이름·
 * 호출 사실·테스트 소스)는 싣지 않는다. 게시자가 고르면 핸들러 usr만 싣는다(이름은 싣지 않는다).
 *
 * 이 모듈은 신뢰하지 않는 JSON을 검증해 조인에 넣을 bridge-facts 문서로 바꾼다. 사실 문법·route 규칙은 bridge-facts
 * 파서를 그대로 재사용한다 — surface 문서를 (지어낸 위치·핸들러 토큰을 임시로 붙인) bridge-facts 문서로 만들어
 * 검증한 뒤, 임시 값을 다시 떼어 낸다. 임시 위치·토큰은 어떤 출력에도 나가지 않는다.
 */

/** surface 형식 이름이다. */
export const HTTP_SURFACE_FORMAT = 'isthmus-http-surface';

/** `privacy.limitations: "prefix-only"`일 때 한계 문구의 접두사 뒤에 붙는 고정 문구다. */
export const SURFACE_LIMITATION_DETAIL = 'detail withheld by the http surface publisher';

/** surface 하나가 담을 수 있는 문서 수 상한이다(조인 문서 상한과 같다). */
export const MAX_SURFACE_DOCUMENTS = 256;

/** 가져온 문서의 내부 project 문자열 접두사다. 출력에 싣지 않고 member 검사에도 쓰지 않는다. */
export const SURFACE_PROJECT_PREFIX = 'isthmus-http-surface:';

/** surface 이름·revision 길이 상한이다. */
export const MAX_SURFACE_LABEL_LENGTH = 256;

/** 핸들러 신원 공개 수준이다. `opaque`는 불투명 토큰만, `usr`는 게시자가 고른 핸들러 usr까지 싣는다. */
export type SurfaceHandlerPrivacy = 'opaque' | 'usr';

/** 한계 문구 공개 수준이다. `prefix-only`는 닫힌 접두사와 고정 문구만, `full`은 원문을 싣는다. */
export type SurfaceLimitationPrivacy = 'prefix-only' | 'full';

/** 게시자가 고른 공개 수준이다. 가져오는 쪽은 이 선언과 실린 필드가 맞는지 검증한다. */
export interface HttpSurfacePrivacy {
  readonly handlers: SurfaceHandlerPrivacy;
  readonly limitations: SurfaceLimitationPrivacy;
}

/** surface를 만든 도구다(isthmus와 그 버전). */
export interface HttpSurfaceExporter {
  readonly name: string;
  readonly version: string;
}

/**
 * surface 사실 하나다. bridge-facts route 사실에서 위치·심볼 이름·귀속 필드·테스트 표식을 뺀 모양이다.
 *
 * - `handler`: 같은 핸들러의 사실끼리 같은 불투명 토큰(`h1`, `h2`, …)이다. catch-all 접두사 decl과 원본을 짝짓고
 *   서로 다른 핸들러의 같은 키 선언을 한 증거로 합치지 않기 위해서다. 핸들러 usr가 없던 사실에는 없다.
 * - `symbol`: route-decl은 `privacy.handlers: "usr"`일 때만 `{usr}`, route-contract는 스펙 operationId인
 *   `{qualifiedName}`만 올 수 있다.
 */
export interface HttpSurfaceFact {
  readonly kind: 'route-decl' | 'route-contract';
  readonly [field: string]: unknown;
}

/** surface 문서 하나다. bridge-facts 문서에서 `format`·`version`·`project`·`sourceModifiedAt`을 뺀 모양이다. */
export interface HttpSurfaceDocument {
  readonly platform: string;
  readonly target: 'http' | null;
  readonly facts: readonly HttpSurfaceFact[];
  readonly [field: string]: unknown;
}

/** 검증된 `isthmus-http-surface` v1 문서다. */
export interface HttpSurface {
  readonly format: typeof HTTP_SURFACE_FORMAT;
  readonly version: 1;
  readonly name: string;
  readonly revision: string;
  readonly exporter: HttpSurfaceExporter;
  readonly privacy: HttpSurfacePrivacy;
  /** 핸들러 너머(정방향 도달·DB)는 싣지 않는다. v1은 `opaque`만 정의한다. */
  readonly continuation: 'opaque';
  readonly documents: readonly HttpSurfaceDocument[];
  /** `digest`를 뺀 문서의 정규 JSON(키 정렬·공백 없음) UTF-8 SHA-256 소문자 hex다. */
  readonly digest: string;
}

/** 가져온 surface다. `documents`는 조인에 그대로 넣을 수 있는 bridge-facts 문서다(위치 없음). */
export interface ImportedHttpSurface {
  readonly surface: HttpSurface;
  readonly documents: readonly BridgeFactsDocument[];
}

/** surface 입력 오류다. 원문 값을 메시지에 넣지 않는다. */
export class HttpSurfaceValidationError extends Error {
  /** 입력 내용을 노출하지 않는 고정 문구만 보존한다. */
  constructor(message: string) {
    super(message);
    this.name = 'HttpSurfaceValidationError';
  }
}

const surfaceKeys = new Set(['format', 'version', 'name', 'revision', 'exporter', 'privacy', 'continuation', 'documents', 'digest']);
const documentKeys = new Set(['platform', 'target', 'tool', 'generatedAt', 'roles', 'dispatch', 'sourceSets', 'service',
  'facts', 'limitations', 'limitationScopes']);
const factKeys = new Set(['kind', 'channel', 'method', 'dynamic', 'pathAnchor', 'service', 'trailingSlash', 'caseInsensitive',
  'narrowed', 'paramConstraints', 'configDefault', 'catchAllPrefix', 'order', 'operationId', 'handler', 'symbol']);
const tokenPattern = /^[1-9][0-9]{0,8}$/u;
const sha256Pattern = /^[0-9a-f]{64}$/u;

/** surface에 실을 수 있는 한계 접두사다: 서버·계약 측 공백만. 호출 측·체인 전용·모르는 접두사는 싣지 않는다. */
export const surfaceLimitationPrefixes: readonly string[] = [...serverRouteGapPrefixes, ...contractRouteGapPrefixes];

/**
 * 신뢰하지 않는 JSON을 검증해 surface와 조인용 bridge-facts 문서로 바꾼다.
 *
 * 내용 digest가 맞지 않으면(손으로 고친 뒤 digest를 갱신하지 않음, 다른 도구가 만든 흉내) 거부한다. digest는 서명이
 * 아니다 — 파일을 누가 만들었는지는 증명하지 않고, 가져오는 쪽이 매니페스트에 고정한 파일 sha256과 함께 "게시자가
 * 내보낸 그 내용"인지만 확인한다.
 */
export function importHttpSurface(input: unknown): ImportedHttpSurface {
  const surface = parseSurfaceShell(input);
  const tokens = new TokenLedger();
  const documents = surface.documents.map((document, index) => {
    try {
      return toBridgeDocument(surface, document, index, tokens);
    } catch (error) {
      if (error instanceof BridgeFactsValidationError) {
        fail(`Surface document ${index + 1} violates the bridge-facts contract: ${error.message}`);
      }
      throw error;
    }
  });
  return { surface, documents };
}

/** surface의 내용 digest를 계산한다. `digest` 필드는 계산에서 뺀다. */
export function computeSurfaceDigest(surface: Readonly<Record<string, unknown>>): string {
  const { digest: _digest, ...content } = surface;
  return createHash('sha256').update(canonicalJson(content), 'utf8').digest('hex');
}

/** 키를 모든 깊이에서 정렬하고 공백 없이 직렬화한다. digest 계산의 정규형이다. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

/** JSON 배열 순서는 보존하고 객체 키만 재귀 정렬한다. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!isJsonObject(value)) return value;
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => compareStrings(left, right))
    .map(([key, item]) => [key, sortKeys(item)]));
}

/** 최상위 필드를 검증하고 digest를 대조한다. 문서 안쪽은 {@link toBridgeDocument}가 본다. */
function parseSurfaceShell(input: unknown): HttpSurface {
  if (!isJsonObject(input) || input.format !== HTTP_SURFACE_FORMAT || input.version !== 1) {
    fail('Expected an isthmus-http-surface version 1 document.');
  }
  if (Object.keys(input).some((key) => !surfaceKeys.has(key))) fail('Http surface has an unknown field.');
  const name = label(input.name, 'Invalid http surface name.');
  const revision = label(input.revision, 'Invalid http surface revision; publish the release or commit the surface describes.');
  const exporter = parseExporter(input.exporter);
  const privacy = parsePrivacy(input.privacy);
  if (input.continuation !== 'opaque') {
    fail('Http surface v1 supports only continuation "opaque"; handler reach and database hops are not published.');
  }
  if (!Array.isArray(input.documents) || input.documents.length === 0 || input.documents.length > MAX_SURFACE_DOCUMENTS) {
    fail(`Http surface documents must be a list of 1 to ${MAX_SURFACE_DOCUMENTS} entries.`);
  }
  if (typeof input.digest !== 'string' || !sha256Pattern.test(input.digest)) {
    fail('Http surface digest must be a lowercase hex sha256.');
  }
  if (computeSurfaceDigest(input) !== input.digest) {
    fail('Http surface digest does not match its content; the file was edited after export. Export it again.');
  }
  const documents = input.documents.map((document, index) => shellDocument(document, index));
  return { format: HTTP_SURFACE_FORMAT, version: 1, name, revision, exporter, privacy, continuation: 'opaque', documents,
    digest: input.digest };
}

/** exporter 필드를 검증한다. */
function parseExporter(input: unknown): HttpSurfaceExporter {
  if (!isJsonObject(input) || Object.keys(input).some((key) => key !== 'name' && key !== 'version')) {
    fail('Invalid http surface exporter; use {name, version}.');
  }
  return { name: label(input.name, 'Invalid http surface exporter name.'),
    version: label(input.version, 'Invalid http surface exporter version.') };
}

/** privacy 필드를 검증한다. 모르는 수준은 가져오는 쪽이 지킬 수 없으므로 거부한다. */
function parsePrivacy(input: unknown): HttpSurfacePrivacy {
  if (!isJsonObject(input) || Object.keys(input).some((key) => key !== 'handlers' && key !== 'limitations')) {
    fail('Invalid http surface privacy; use {handlers, limitations}.');
  }
  if (input.handlers !== 'opaque' && input.handlers !== 'usr') fail('Http surface privacy.handlers must be "opaque" or "usr".');
  if (input.limitations !== 'prefix-only' && input.limitations !== 'full') {
    fail('Http surface privacy.limitations must be "prefix-only" or "full".');
  }
  return { handlers: input.handlers, limitations: input.limitations };
}

/** 문서 하나의 키와 사실 목록 모양만 본다. 값 검증은 bridge-facts 파서가 한다. */
function shellDocument(input: unknown, index: number): HttpSurfaceDocument {
  const position = index + 1;
  if (!isJsonObject(input) || Object.keys(input).some((key) => !documentKeys.has(key))) {
    fail(`Surface document ${position} has an unknown field (surfaces carry no project, location or source timestamp).`);
  }
  if (!Array.isArray(input.facts)) fail(`Surface document ${position} facts must be an array.`);
  for (const [factIndex, fact] of input.facts.entries()) {
    if (!isJsonObject(fact) || Object.keys(fact).some((key) => !factKeys.has(key))) {
      fail(`Surface document ${position} fact ${factIndex} has a field surfaces do not carry (location, calls, `
        + 'attribution and test-source fields are never published).');
    }
  }
  return input as unknown as HttpSurfaceDocument;
}

/**
 * surface 문서 하나를 bridge-facts 파서로 검증해 조인용 문서로 바꾼다.
 *
 * 파서는 route 사실마다 위치를, catch-all 접두사 decl에 symbol.usr를 요구한다. surface는 둘 다 싣지 않으므로
 * 임시 위치(등록 순서가 있으면 (group, index)마다 하나 — 한 등록 = 한 위치 규칙을 그대로 지키게)와 핸들러 토큰을
 * usr 자리에 붙여 검증하고, 검증이 끝나면 떼어 낸다.
 */
function toBridgeDocument(surface: HttpSurface, document: HttpSurfaceDocument, index: number,
  tokens: TokenLedger): BridgeFactsDocument {
  const position = index + 1;
  checkSurfaceDocument(surface, document, position, tokens);
  const candidate = {
    ...document, format: 'bridge-facts', version: 1, project: `${SURFACE_PROJECT_PREFIX}${surface.name}`,
    facts: document.facts.map((fact, factIndex) => validationFact(fact, factIndex)),
  };
  const parsed = parseBridgeFactsDocument(candidate);
  // 파서는 사실을 입력 순서 그대로 정규화한다. 공개 usr를 순번으로 되붙이므로, 그 불변식이 깨지면 다른 route에 usr가
  // 붙지 않도록 부분 결과 대신 내부 오류로 멈춘다.
  if (parsed.facts.length !== document.facts.length || parsed.facts.some((fact, factIndex) =>
    fact.kind !== document.facts[factIndex]!.kind || fact.channel !== document.facts[factIndex]!.channel ||
    fact.method !== document.facts[factIndex]!.method)) {
    throw new Error('Bridge-facts normalization changed the surface fact order.');
  }
  return { ...parsed, facts: parsed.facts.map((fact, factIndex) => importedFact(fact, document.facts[factIndex]!)) };
}

/** surface 전용 규칙(역할·kind·dynamic 원문·토큰·symbol·group·테스트 소스·한계 문구)을 검증한다. */
function checkSurfaceDocument(surface: HttpSurface, document: HttpSurfaceDocument, position: number,
  tokens: TokenLedger): void {
  const openapi = document.platform === 'openapi';
  if (!openapi && (document.target !== 'http' || !isServerOnlyRoles(document.roles))) {
    fail(`Surface document ${position} must be an http declaration document with roles ["server"].`);
  }
  if (isJsonObject(document.sourceSets) && document.sourceSets.tests !== 'excluded') {
    fail(`Surface document ${position} must exclude test sources (sourceSets.tests "excluded").`);
  }
  document.facts.forEach((fact, factIndex) => checkSurfaceFact(surface, fact, openapi, `${position} fact ${factIndex}`, tokens));
  checkLimitations(surface.privacy.limitations, document.limitations, position);
}

/** roles가 정확히 `["server"]`인지다. surface는 호출 측을 싣지 않는다. */
function isServerOnlyRoles(value: unknown): boolean {
  return Array.isArray(value) && value.length === 1 && value[0] === 'server';
}

/** 사실 하나의 surface 전용 규칙이다. */
function checkSurfaceFact(surface: HttpSurface, fact: HttpSurfaceFact, openapi: boolean, where: string,
  tokens: TokenLedger): void {
  if (fact.kind !== (openapi ? 'route-contract' : 'route-decl')) {
    fail(`Surface document ${where} must be a ${openapi ? 'route-contract' : 'route-decl'} fact.`);
  }
  // dynamic 선언의 원문 식은 서버 소스 조각이다. surface는 개수만 전하도록 channel을 null로 싣는다.
  if (fact.dynamic === true && fact.channel !== null) fail(`Surface document ${where} is dynamic and must carry a null channel.`);
  if (fact.order !== undefined) {
    const group = isJsonObject(fact.order) ? fact.order.group : undefined;
    if (typeof group !== 'string' || !group.startsWith('g') || !tokenPattern.test(group.slice(1))) {
      fail(`Surface document ${where} order group must be an opaque token such as "g1".`);
    }
  }
  if (fact.handler !== undefined && (openapi || typeof fact.handler !== 'string' || !fact.handler.startsWith('h') ||
    !tokenPattern.test(fact.handler.slice(1)))) {
    fail(`Surface document ${where} handler must be an opaque token such as "h1" on a route-decl fact.`);
  }
  if (openapi) {
    if (fact.symbol !== undefined && (!isJsonObject(fact.symbol) || Object.keys(fact.symbol).some((key) => key !== 'qualifiedName'))) {
      fail(`Surface document ${where} contract symbol may carry only the operationId as qualifiedName.`);
    }
    return;
  }
  checkHandlerSymbol(surface, fact, where, tokens);
}

/** route-decl의 symbol은 게시자가 usr 공개를 고른 경우에만 `{usr}`로 오고, 토큰과 1:1이어야 한다. */
function checkHandlerSymbol(surface: HttpSurface, fact: HttpSurfaceFact, where: string, tokens: TokenLedger): void {
  if (fact.symbol === undefined) {
    if (fact.handler !== undefined) tokens.record(fact.handler as string, undefined, where);
    return;
  }
  if (surface.privacy.handlers !== 'usr') {
    fail(`Surface document ${where} carries a handler symbol but privacy.handlers is "opaque".`);
  }
  if (!isJsonObject(fact.symbol) || Object.keys(fact.symbol).length !== 1 || !isSafeNonEmptyString(fact.symbol.usr)) {
    fail(`Surface document ${where} handler symbol must be exactly {usr}; handler names are never published.`);
  }
  if (fact.handler === undefined) fail(`Surface document ${where} publishes a handler usr without its handler token.`);
  tokens.record(fact.handler as string, fact.symbol.usr, where);
}

/**
 * 한계 문구를 검증한다. surface는 서버·계약 측 공백 접두사의 한계만 싣는다 — 나머지는 가져오는 쪽 판정에 쓰이지 않고
 * 서버 내부 사정만 드러낸다. `prefix-only`면 문구가 접두사와 고정 문구뿐이어야 한다.
 */
function checkLimitations(privacy: SurfaceLimitationPrivacy, limitations: unknown, position: number): void {
  if (!Array.isArray(limitations)) return;
  for (const message of limitations) {
    if (typeof message !== 'string') continue;
    const prefix = surfaceLimitationPrefixes.find((candidate) => message.startsWith(candidate));
    if (prefix === undefined) {
      fail(`Surface document ${position} carries a limitation outside the server and contract gap prefixes.`);
    }
    if (privacy === 'prefix-only' && message !== `${prefix} ${SURFACE_LIMITATION_DETAIL}`) {
      fail(`Surface document ${position} limitation text must be "<prefix> ${SURFACE_LIMITATION_DETAIL}" `
        + 'when privacy.limitations is "prefix-only".');
    }
  }
}

/**
 * 검증용 사실이다. 임시 위치와(토큰이 있으면) 토큰을 usr 자리에 둔 symbol을 붙인다. 등록 순서가 있으면 위치를
 * (group, index)에서 만든다 — 같은 등록의 사실은 같은 위치를 공유해야 한다는 파서 규칙이 그대로 성립한다.
 */
function validationFact(fact: HttpSurfaceFact, factIndex: number): Record<string, unknown> {
  const { handler, ...rest } = fact;
  const order = isJsonObject(fact.order) ? fact.order : undefined;
  const path = order === undefined ? `surface/fact/${factIndex}` : `surface/${String(order.group)}/${String(order.index)}`;
  const symbol = typeof handler === 'string' ? { qualifiedName: handler, usr: handler } : fact.symbol;
  return { ...rest, location: { path, line: 1, column: 1 }, ...(symbol === undefined ? {} : { symbol }) };
}

/** 검증을 통과한 사실에서 임시 위치·토큰을 떼어 조인용 사실로 만든다. 공개된 usr만 symbol로 남긴다. */
function importedFact(parsed: BridgeFact, original: HttpSurfaceFact): BridgeFact {
  const { location: _location, symbol: _symbol, ...rest } = parsed;
  const symbol = importedSymbol(original);
  return { ...rest, ...(symbol === undefined ? {} : { symbol }) };
}

/**
 * 조인용 symbol이다. 계약은 operationId 그대로, decl은 공개된 usr만 싣는다. 핸들러 이름은 공개하지 않으므로 decl의
 * `qualifiedName`도 usr 값이다(문서에 밝힌 규칙).
 */
function importedSymbol(original: HttpSurfaceFact): BridgeSymbol | undefined {
  const symbol = original.symbol;
  if (!isJsonObject(symbol)) return undefined;
  if (typeof symbol.usr === 'string') return { qualifiedName: symbol.usr, usr: symbol.usr };
  return { qualifiedName: symbol.qualifiedName as string };
}

/** 핸들러 토큰과 공개 usr의 1:1 대응을 surface 전체에서 확인한다. */
class TokenLedger {
  private readonly usrByToken = new Map<string, string | undefined>();
  private readonly tokenByUsr = new Map<string, string>();

  /** 토큰 하나의 관찰을 기록한다. 같은 토큰이 다른 usr(또는 공개·비공개)로 오거나 같은 usr가 다른 토큰이면 거부한다. */
  record(token: string, usr: string | undefined, where: string): void {
    if (this.usrByToken.has(token) && this.usrByToken.get(token) !== usr) {
      fail(`Surface document ${where} reuses handler token for a different handler.`);
    }
    if (usr !== undefined && this.tokenByUsr.has(usr) && this.tokenByUsr.get(usr) !== token) {
      fail(`Surface document ${where} gives one handler usr two handler tokens.`);
    }
    this.usrByToken.set(token, usr);
    if (usr !== undefined) this.tokenByUsr.set(usr, token);
  }
}

/** 길이 상한이 있는 안전한 라벨 문자열이다. */
function label(input: unknown, message: string): string {
  if (!isSafeNonEmptyString(input) || input.length > MAX_SURFACE_LABEL_LENGTH || input.trim() !== input) fail(message);
  return input;
}

function fail(message: string): never {
  throw new HttpSurfaceValidationError(message);
}
