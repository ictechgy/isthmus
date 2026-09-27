import { compareStrings } from '../compare.ts';
import type { TraversalPlatform } from '../exchange/language-traversal.ts';
import type { BridgeFactsDocument } from '../exchange/parse.ts';
import { isBridgeTimestamp, isJsonObject, isProjectRelativePath, isSafeNonEmptyString } from '../exchange/parse.ts';
import {
  parseTraceContext, TraceContextValidationError, type TraceAnalysis, type TraceAnalysisRole, type TraceContext,
  type TraceFileSymbols,
} from '../exchange/trace-context.ts';
import { isClientDocument, isDeclarationDocument } from '../join/route-join.ts';

/**
 * `scripts/capture-trace.mjs` 설정(`isthmus-trace-capture` v1)의 검증과 순수 계산이다.
 *
 * 제품은 생산자를 실행하지 않는다. 이 모듈은 설정을 검증하고, 사실 문서에서 순회 root를 뽑고,
 * trace context를 조립하는 **입출력 없는** 함수만 담는다. 프로세스 실행·파일 쓰기·realpath 확인은
 * 스크립트가 맡는다. 검증 규칙을 여기 두어 타입 검사와 커버리지 게이트 안에서 고정한다.
 */

/** capture 설정이 계약을 어겼음을 나타낸다. 메시지에는 입력 원문을 싣지 않는다. */
export class TraceCaptureValidationError extends Error {
  /** 입력 내용을 노출하지 않는 고정 문구만 보존한다. */
  constructor(message: string) {
    super(message);
    this.name = 'TraceCaptureValidationError';
  }
}

/** 선언한 root 디렉터리 하나 아래의 경로다. `path`가 없으면 root 자신이다. */
export interface CapturePathRef {
  readonly root: string;
  readonly path?: string;
}

/** 생산자 인자 하나다. 문자열은 자리표시자를 치환하고, 경로 참조는 root 안의 절대 경로로 바꾼다. */
export type CaptureArgument = string | CapturePathRef;

/** 생산자 명령 한 번의 실행 설정이다. */
export interface CaptureCommandStep {
  readonly tool: string;
  readonly args: readonly CaptureArgument[];
  readonly timeoutSeconds: number;
  readonly acceptExitCodes: readonly number[];
}

/**
 * 순회 root를 생산자에 넘기는 방법이다.
 * - `arguments`: 인자 끝에 id를 그대로 붙인다(`-`로 시작하는 id는 거부 — 플래그로 읽힐 수 있다).
 * - `separator`: `--` 뒤에 붙인다(`--`를 옵션 끝 표시로 받는 생산자).
 * - `roots-from`: JSON 문자열 배열 파일을 쓰고 `--roots-from <file>`를 붙인다(argv 길이 상한을 피한다).
 */
export type CaptureRootsDelivery = 'arguments' | 'separator' | 'roots-from';

/** 사실 문서 하나다. 생산자 명령의 stdout이거나 미리 만든 파일이다. */
export interface CaptureDocument {
  readonly name: string;
  readonly step?: CaptureCommandStep;
  readonly precomputed?: CapturePathRef;
}

/** 미리 계산한 순회 artifact의 출처와 증언이다. */
export interface CapturePrecomputedAnalysis {
  readonly path: CapturePathRef;
  readonly revision?: string;
  readonly generatedAt?: string;
}

/** 순회 분석 하나다. 생산자 명령을 root와 함께 실행하거나 미리 만든 artifact를 쓴다. */
export interface CaptureAnalysis {
  readonly id: string;
  readonly platform: TraversalPlatform;
  readonly role: TraceAnalysisRole;
  readonly step?: CaptureCommandStep & { readonly roots: CaptureRootsDelivery; readonly maxRootsPerRun: number };
  readonly precomputed?: CapturePrecomputedAnalysis;
}

/**
 * 생산자 심볼 목록 하나다(파일 선택의 2단계 수집용). 생산자 명령의 stdout이거나 미리 만든 파일이다.
 * 받는 형식은 {@link parseSymbolListing}이 정한다.
 */
export interface CaptureListing {
  readonly platform: TraversalPlatform;
  readonly step?: CaptureCommandStep;
  readonly precomputed?: CapturePathRef;
}

/** member revision이다. 문자열은 그대로, `{git: true}`는 project의 `git rev-parse HEAD`다. */
export type CaptureRevision = string | { readonly git: true };

/** 수집 대상 저장소(또는 한 저장소의 한 관점) 하나다. */
export interface CaptureMember {
  readonly name: string;
  readonly project: CapturePathRef;
  readonly revision?: CaptureRevision;
  readonly catalog?: { readonly graph: CapturePathRef; readonly source?: string };
  readonly documents: readonly CaptureDocument[];
  readonly analyses: readonly CaptureAnalysis[];
  /** 파일 선택일 때만 실행하는 생산자 심볼 목록이다. 플랫폼마다 하나다. */
  readonly listings: readonly CaptureListing[];
}

/** 생산자 실행 파일과(선택) 버전 기록용 소스 checkout이다. */
export interface CaptureTool {
  readonly command: readonly string[];
  readonly source?: CapturePathRef;
}

/** 검증된 capture 설정이다. */
export interface TraceCaptureConfig {
  readonly roots: Readonly<Record<string, string>>;
  readonly output: CapturePathRef;
  readonly generatedAt?: string;
  readonly tools: Readonly<Record<string, CaptureTool>>;
  readonly members: readonly CaptureMember[];
  readonly links?: readonly Record<string, unknown>[];
  readonly selection: unknown;
  readonly trace: boolean;
  /** member가 하나이고 links가 없으면 단일 project context, 아니면 workspace context다. */
  readonly workspace: boolean;
}

/** 단계 시간 제한 기본값(초)이다. 네이티브 인덱스 없이 순회만 하는 생산자에 넉넉한 값이다. */
export const DEFAULT_STEP_TIMEOUT_SECONDS = 600;
/** 단계 시간 제한 상한(초)이다. */
export const MAX_STEP_TIMEOUT_SECONDS = 7_200;
/** 한 번의 생산자 실행에 넘기는 root 수 기본값이다. `language-traversal` root 상한(10,000)보다 작다. */
export const DEFAULT_MAX_ROOTS_PER_RUN = 2_000;
/** 한 번의 실행에 넘기는 root 수 상한 — `language-traversal` v1의 root 상한이다. */
export const MAX_ROOTS_PER_RUN = 10_000;
/** 인자로 넘기는 root의 한 실행당 바이트 상한이다. 흔한 argv 상한(macOS 1MiB)보다 훨씬 작게 잡는다. */
export const MAX_ROOT_ARGUMENT_BYTES = 128 * 1024;

const configKeys = new Set(['format', 'version', 'roots', 'output', 'generatedAt', 'tools', 'members', 'links', 'selection', 'trace']);
const toolKeys = new Set(['command', 'source']);
const memberKeys = new Set(['name', 'project', 'revision', 'catalog', 'documents', 'analyses', 'listings']);
const stepKeys = ['tool', 'args', 'timeoutSeconds', 'acceptExitCodes'];
const documentKeys = new Set(['name', 'precomputed', ...stepKeys]);
const analysisKeys = new Set(['id', 'platform', 'role', 'precomputed', 'roots', 'maxRootsPerRun', ...stepKeys]);
const listingKeys = new Set(['platform', 'precomputed', ...stepKeys]);
const platforms = new Set<TraversalPlatform>(['dart', 'swift', 'kotlin', 'js', 'go', 'rust', 'sql']);
const roles = new Set<TraceAnalysisRole>(['forward', 'reverse', 'db-dependents']);
const deliveries = new Set<CaptureRootsDelivery>(['arguments', 'separator', 'roots-from']);
/** 출력 파일 이름으로도 쓰이므로 경로 구분자·점 두 개로 시작하는 이름을 막는다. */
const namePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const documentNamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,122}\.json$/u;
const reservedMemberNames = new Set(['logs', 'pairs']);
const rootNamePattern = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/u;
/**
 * 비밀이 흔히 놓이는 경로 조각이다. capture는 이런 파일을 읽지도, 생산자 인자로 넘기지도 않는다.
 * `.git`은 원격 URL에 토큰이 박힌 `.git/config`가 흔해서 막는다. 목록은 보수적 거부용이며 비밀 탐지를 보장하지 않는다.
 */
const secretSegmentPattern = /^(?:\.env(?:\..*)?|\.npmrc|\.netrc|\.pgpass|\.git|\.git-credentials|\.ssh|\.aws|\.gnupg|\.docker|\.kube|\.azure|\.gcloud|id_(?:rsa|dsa|ecdsa|ed25519)(?:\..*)?|.*\.(?:pem|key|p12|pfx|keystore|jks))$/iu;

/**
 * 신뢰하지 않는 JSON을 검증된 capture 설정으로 바꾼다.
 *
 * 모르는 필드는 거부한다(fail-closed). 경로는 선언한 root 이름과 root 상대 경로로만 받으며, 여기서는
 * 문법(`..` 없음, 제어 문자 없음, 비밀 경로 조각 없음)만 본다 — 실제 realpath가 root 안에 있는지는
 * 파일 시스템을 보는 스크립트가 확인한다. selection·links는 이 설정으로 만든 임시 trace context를
 * `parseTraceContext`에 넣어 trace와 같은 규칙으로 미리 검증한다 — 생산자를 오래 돌린 뒤에야 설정
 * 오류를 알게 되지 않도록 하기 위해서다.
 */
export function parseTraceCaptureConfig(input: unknown): TraceCaptureConfig {
  if (!isJsonObject(input)) fail('Capture config must be a JSON object.');
  if (input.format !== 'isthmus-trace-capture' || input.version !== 1) fail('Expected isthmus-trace-capture version 1.');
  rejectUnknownKeys(input, configKeys, 'Capture config has an unknown field.');
  const roots = parseRoots(input.roots);
  const output = parsePathRef(input.output, roots, 'output');
  if (output.path === undefined) fail('The output directory must be a subdirectory of its root, not the root itself.');
  if (input.generatedAt !== undefined && !isBridgeTimestamp(input.generatedAt)) fail('Invalid capture generatedAt timestamp.');
  const tools = parseTools(input.tools, roots);
  if (!Array.isArray(input.members) || input.members.length === 0 || input.members.length > 64) {
    fail('Capture members must be a list of 1 to 64 entries.');
  }
  const members = input.members.map((member, index) => parseMember(member, index + 1, roots, tools));
  unique(members.map(({ name }) => name), 'Capture member names must be unique.');
  unique(members.flatMap(({ analyses }) => analyses.map(({ id }) => id)), 'Capture analysis ids must be unique across members.');
  if (input.links !== undefined && (!Array.isArray(input.links) || !input.links.every(isJsonObject))) {
    fail('Capture links must be a list of link objects (the trace context link shape).');
  }
  if (input.trace !== undefined && typeof input.trace !== 'boolean') fail('Capture trace must be a boolean.');
  const workspace = members.length > 1 || input.links !== undefined;
  if (!workspace && members[0]!.catalog !== undefined) {
    fail('A member catalog is recorded only in a workspace trace context; declare links to capture a workspace.');
  }
  const config: TraceCaptureConfig = {
    roots, output, ...(input.generatedAt === undefined ? {} : { generatedAt: input.generatedAt as string }), tools, members,
    ...(input.links === undefined ? {} : { links: input.links as Record<string, unknown>[] }),
    selection: input.selection, trace: input.trace !== false, workspace,
  };
  validateProvisionalContext(config);
  return config;
}

/** root 이름 → 절대 경로 표다. 실제 디렉터리 확인은 스크립트가 한다. */
function parseRoots(value: unknown): Record<string, string> {
  if (!isJsonObject(value)) fail('Capture roots must map root names to absolute directory paths.');
  const entries = Object.entries(value);
  if (entries.length === 0 || entries.length > 16) fail('Capture roots must declare 1 to 16 directories.');
  const roots: Record<string, string> = {};
  for (const [name, path] of entries) {
    if (!rootNamePattern.test(name)) fail('Capture root names must start with a letter and use letters, digits, - or _.');
    if (!isSafeNonEmptyString(path) || !path.startsWith('/') || path.split('/').includes('..')) {
      fail('Capture roots must be absolute POSIX paths without .. segments or control characters.');
    }
    roots[name] = path;
  }
  return roots;
}

/**
 * `{root, path?}` 경로 참조를 검증한다. path는 root 상대 POSIX 경로이고 `..`·절대 경로·역슬래시·
 * 비밀 경로 조각을 받지 않는다.
 */
function parsePathRef(value: unknown, roots: Record<string, string>, label: string): CapturePathRef {
  if (!isJsonObject(value) || Object.keys(value).some((key) => key !== 'root' && key !== 'path')) {
    fail(`Invalid ${label} path reference; use {"root": "<declared root>", "path": "<relative path>"}.`);
  }
  if (typeof value.root !== 'string' || !Object.hasOwn(roots, value.root)) {
    fail(`The ${label} path reference names an undeclared root.`);
  }
  if (value.path === undefined) return { root: value.root };
  if (!isProjectRelativePath(value.path) || value.path.includes('\\')) {
    fail(`The ${label} path must be relative to its root, without .., backslashes or control characters.`);
  }
  if (value.path.split('/').some((segment) => secretSegmentPattern.test(segment))) {
    fail(`The ${label} path points at a secret-like file (.env, keys, credentials); capture never reads or passes those.`);
  }
  return { root: value.root, path: value.path };
}

/** 생산자 표다. 명령은 인자 배열이며 셸을 거치지 않는다. */
function parseTools(value: unknown, roots: Record<string, string>): Record<string, CaptureTool> {
  if (!isJsonObject(value)) fail('Capture tools must map tool names to {command, source?}.');
  const tools: Record<string, CaptureTool> = {};
  for (const [name, tool] of Object.entries(value)) {
    if (!namePattern.test(name)) fail('Capture tool names must use letters, digits, ., - or _.');
    if (!isJsonObject(tool)) fail('Each capture tool must be an object with a command array.');
    rejectUnknownKeys(tool, toolKeys, 'A capture tool has an unknown field.');
    if (!Array.isArray(tool.command) || tool.command.length === 0 || tool.command.length > 32 ||
      !tool.command.every(isSafeNonEmptyString)) {
      fail('A capture tool command must be a non-empty array of strings without control characters.');
    }
    tools[name] = {
      command: tool.command as string[],
      ...(tool.source === undefined ? {} : { source: parsePathRef(tool.source, roots, 'tool source') }),
    };
  }
  return tools;
}

/** member 하나를 검증한다. */
function parseMember(value: unknown, position: number, roots: Record<string, string>,
  tools: Record<string, CaptureTool>): CaptureMember {
  if (!isJsonObject(value)) fail(`Capture member ${position} must be an object.`);
  rejectUnknownKeys(value, memberKeys, `Capture member ${position} has an unknown field.`);
  if (typeof value.name !== 'string' || !namePattern.test(value.name)) {
    fail(`Capture member ${position} needs a name of letters, digits, ., - or _ (at most 64).`);
  }
  // member 이름은 출력 디렉터리 이름이 된다. capture가 쓰는 최상위 파일·디렉터리와 겹치지 않게 한다.
  if (reservedMemberNames.has(value.name) || value.name.endsWith('.json')) {
    fail(`Capture member ${position} name collides with a capture output entry (logs, pairs, *.json).`);
  }
  const project = parsePathRef(value.project, roots, 'member project');
  const revision = parseRevision(value.revision, position);
  let catalog: CaptureMember['catalog'];
  if (value.catalog !== undefined) {
    if (!isJsonObject(value.catalog) || Object.keys(value.catalog).some((key) => key !== 'graph' && key !== 'source') ||
      (value.catalog.source !== undefined && !isSafeNonEmptyString(value.catalog.source))) {
      fail(`Capture member ${position} catalog takes graph (a path reference) and an optional source string.`);
    }
    catalog = { graph: parsePathRef(value.catalog.graph, roots, 'catalog graph'),
      ...(value.catalog.source === undefined ? {} : { source: value.catalog.source as string }) };
  }
  if (!Array.isArray(value.documents) || value.documents.length === 0 || value.documents.length > 256) {
    fail(`Capture member ${position} needs 1 to 256 documents.`);
  }
  const documents = value.documents.map((document) => parseDocument(document, position, roots, tools));
  unique(documents.map(({ name }) => name), `Capture member ${position} document names must be unique.`);
  if (value.analyses !== undefined && (!Array.isArray(value.analyses) || value.analyses.length > 256)) {
    fail(`Capture member ${position} analyses must be a list of at most 256 entries.`);
  }
  const analyses = ((value.analyses ?? []) as unknown[]).map((analysis) => parseAnalysis(analysis, position, roots, tools));
  if (value.listings !== undefined && (!Array.isArray(value.listings) || value.listings.length > 8)) {
    fail(`Capture member ${position} listings must be a list of at most 8 entries.`);
  }
  const listings = ((value.listings ?? []) as unknown[]).map((listing) => parseListing(listing, position, roots, tools));
  unique(listings.map(({ platform }) => platform), `Capture member ${position} declares more than one listing for a platform.`);
  return { name: value.name, project, ...(revision === undefined ? {} : { revision }),
    ...(catalog === undefined ? {} : { catalog }), documents, analyses, listings };
}

/** 심볼 목록 하나: 언어 platform(sql 제외)과, 생산자 명령 또는 사전 계산 파일 중 정확히 하나. */
function parseListing(value: unknown, member: number, roots: Record<string, string>,
  tools: Record<string, CaptureTool>): CaptureListing {
  if (!isJsonObject(value)) fail(`A listing of capture member ${member} must be an object.`);
  rejectUnknownKeys(value, listingKeys, `A listing of capture member ${member} has an unknown field.`);
  if (!platforms.has(value.platform as TraversalPlatform) || value.platform === 'sql') {
    fail(`A listing of capture member ${member} needs a language platform (sql vertices have no source file).`);
  }
  const platform = value.platform as TraversalPlatform;
  if ((value.precomputed === undefined) === (value.tool === undefined)) {
    fail(`The ${platform} listing of capture member ${member} needs exactly one of tool (with args) or precomputed.`);
  }
  if (value.precomputed !== undefined) {
    if (['args', 'timeoutSeconds', 'acceptExitCodes'].some((key) => value[key] !== undefined)) {
      fail(`The precomputed ${platform} listing of capture member ${member} takes no command fields.`);
    }
    return { platform, precomputed: parsePathRef(value.precomputed, roots, 'precomputed listing') };
  }
  return { platform, step: parseStep(value, `${platform} listing of capture member ${member}`, roots, tools) };
}

/** member revision 선언을 검증한다. */
function parseRevision(value: unknown, position: number): CaptureRevision | undefined {
  if (value === undefined) return undefined;
  if (isSafeNonEmptyString(value)) return value;
  if (isJsonObject(value) && value.git === true && Object.keys(value).length === 1) return { git: true };
  return fail(`Capture member ${position} revision must be a string or {"git": true}.`);
}

/** 사실 문서 하나: 이름과, 생산자 명령 또는 사전 계산 파일 중 정확히 하나. */
function parseDocument(value: unknown, member: number, roots: Record<string, string>,
  tools: Record<string, CaptureTool>): CaptureDocument {
  if (!isJsonObject(value)) fail(`A document of capture member ${member} must be an object.`);
  rejectUnknownKeys(value, documentKeys, `A document of capture member ${member} has an unknown field.`);
  if (typeof value.name !== 'string' || !documentNamePattern.test(value.name)) {
    fail(`Document names of capture member ${member} must be file names ending in .json.`);
  }
  if ((value.precomputed === undefined) === (value.tool === undefined)) {
    fail(`Document ${value.name} of capture member ${member} needs exactly one of tool (with args) or precomputed.`);
  }
  if (value.precomputed !== undefined) {
    if (['args', 'timeoutSeconds', 'acceptExitCodes'].some((key) => value[key] !== undefined)) {
      fail(`Precomputed document ${value.name} takes no command fields.`);
    }
    return { name: value.name, precomputed: parsePathRef(value.precomputed, roots, 'precomputed document') };
  }
  return { name: value.name, step: parseStep(value, `document ${value.name}`, roots, tools) };
}

/** 순회 분석 하나: id·platform·role과, 생산자 명령 또는 사전 계산 artifact 중 정확히 하나. */
function parseAnalysis(value: unknown, member: number, roots: Record<string, string>,
  tools: Record<string, CaptureTool>): CaptureAnalysis {
  if (!isJsonObject(value)) fail(`An analysis of capture member ${member} must be an object.`);
  rejectUnknownKeys(value, analysisKeys, `An analysis of capture member ${member} has an unknown field.`);
  if (typeof value.id !== 'string' || !namePattern.test(value.id)) {
    fail(`Analysis ids of capture member ${member} must use letters, digits, ., - or _ (at most 64).`);
  }
  const { id } = value;
  if (!platforms.has(value.platform as TraversalPlatform)) fail(`Analysis ${id} has an unsupported platform.`);
  if (!roles.has(value.role as TraceAnalysisRole)) fail(`Analysis ${id} role must be forward, reverse or db-dependents.`);
  const platform = value.platform as TraversalPlatform;
  const role = value.role as TraceAnalysisRole;
  if ((role === 'db-dependents') !== (platform === 'sql')) fail(`Analysis ${id}: db-dependents is the sql role, and sql takes only db-dependents.`);
  if ((value.precomputed === undefined) === (value.tool === undefined)) {
    fail(`Analysis ${id} needs exactly one of tool (with args and roots) or precomputed.`);
  }
  if (value.precomputed !== undefined) {
    if (['args', 'timeoutSeconds', 'acceptExitCodes', 'roots', 'maxRootsPerRun'].some((key) => value[key] !== undefined)) {
      fail(`Precomputed analysis ${id} takes no command fields.`);
    }
    return { id, platform, role, precomputed: parsePrecomputed(value.precomputed, id, roots) };
  }
  if (!deliveries.has(value.roots as CaptureRootsDelivery)) {
    fail(`Analysis ${id} roots must be arguments, separator or roots-from.`);
  }
  const maxRootsPerRun = value.maxRootsPerRun ?? DEFAULT_MAX_ROOTS_PER_RUN;
  if (!Number.isSafeInteger(maxRootsPerRun) || (maxRootsPerRun as number) < 1 || (maxRootsPerRun as number) > MAX_ROOTS_PER_RUN) {
    fail(`Analysis ${id} maxRootsPerRun must be an integer from 1 to ${MAX_ROOTS_PER_RUN}.`);
  }
  return { id, platform, role, step: { ...parseStep(value, `analysis ${id}`, roots, tools),
    roots: value.roots as CaptureRootsDelivery, maxRootsPerRun: maxRootsPerRun as number } };
}

/** 사전 계산 artifact의 경로와 증언이다. */
function parsePrecomputed(value: unknown, id: string, roots: Record<string, string>): CapturePrecomputedAnalysis {
  if (!isJsonObject(value) || Object.keys(value).some((key) => !['path', 'revision', 'generatedAt'].includes(key))) {
    fail(`Precomputed analysis ${id} takes path, optional revision and optional generatedAt.`);
  }
  if (value.revision !== undefined && !isSafeNonEmptyString(value.revision)) fail(`Precomputed analysis ${id} has an invalid revision.`);
  if (value.generatedAt !== undefined && !isBridgeTimestamp(value.generatedAt)) {
    fail(`Precomputed analysis ${id} has an invalid generatedAt timestamp.`);
  }
  return { path: parsePathRef(value.path, roots, 'precomputed analysis'),
    ...(value.revision === undefined ? {} : { revision: value.revision as string }),
    ...(value.generatedAt === undefined ? {} : { generatedAt: value.generatedAt as string }) };
}

/** 생산자 명령 필드(tool·args·timeoutSeconds·acceptExitCodes)를 검증한다. */
function parseStep(value: Record<string, unknown>, label: string, roots: Record<string, string>,
  tools: Record<string, CaptureTool>): CaptureCommandStep {
  if (typeof value.tool !== 'string' || !Object.hasOwn(tools, value.tool)) fail(`The ${label} names an undeclared tool.`);
  if (!Array.isArray(value.args) || value.args.length > 256) fail(`The ${label} args must be a list of at most 256 arguments.`);
  const args = value.args.map((argument): CaptureArgument => {
    if (typeof argument === 'string') {
      // 빈 문자열은 받는다(생산자가 빈 값을 뜻 있게 받을 수 있다). 제어 문자만 막는다.
      if (argument !== '' && !isSafeNonEmptyString(argument)) fail(`The ${label} has an argument with control characters.`);
      return argument;
    }
    return parsePathRef(argument, roots, `${label} argument`);
  });
  const timeoutSeconds = value.timeoutSeconds ?? DEFAULT_STEP_TIMEOUT_SECONDS;
  if (!Number.isSafeInteger(timeoutSeconds) || (timeoutSeconds as number) < 1 || (timeoutSeconds as number) > MAX_STEP_TIMEOUT_SECONDS) {
    fail(`The ${label} timeoutSeconds must be an integer from 1 to ${MAX_STEP_TIMEOUT_SECONDS}.`);
  }
  const acceptExitCodes = value.acceptExitCodes ?? [0];
  if (!Array.isArray(acceptExitCodes) || acceptExitCodes.length === 0 || acceptExitCodes.length > 8 ||
    !acceptExitCodes.every((code) => Number.isSafeInteger(code) && code >= 0 && code <= 255) ||
    new Set(acceptExitCodes).size !== acceptExitCodes.length) {
    fail(`The ${label} acceptExitCodes must be 1 to 8 distinct exit codes from 0 to 255.`);
  }
  return { tool: value.tool, args, timeoutSeconds: timeoutSeconds as number, acceptExitCodes: acceptExitCodes as number[] };
}

/**
 * 설정만으로 만든 임시 trace context를 trace 규칙으로 검증한다.
 *
 * 경로·project는 자리값이다. 실제 context는 수집이 끝난 뒤 {@link buildCaptureContext}로 다시 만들고
 * 스크립트가 한 번 더 검증한다. 여기서는 selection·links·member 참조처럼 설정이 결정하는 부분만 본다.
 */
function validateProvisionalContext(config: TraceCaptureConfig): void {
  const members: CapturedMember[] = config.members.map((member) => ({
    name: member.name,
    project: `/capture/${member.project.root}/${member.project.path ?? ''}`,
    ...(config.workspace ? { revision: 'capture' } : {}),
    documents: member.documents.map(({ name }) => ({ name, path: capturedDocumentPath(member.name, name) })),
    analyses: member.analyses.map(({ id, platform, role }) => ({ id, platform, role, path: capturedAnalysisPath(member.name, id) })),
  }));
  try {
    parseTraceContext(buildCaptureContext(config, members));
  } catch (error) {
    if (error instanceof TraceContextValidationError) fail(`Capture selection or links violate the trace context contract: ${error.message}`);
    throw error;
  }
}

/** 수집이 끝난 member 하나다. 경로는 출력 디렉터리(= context 위치) 기준 상대 경로다. */
export interface CapturedMember {
  readonly name: string;
  readonly project: string;
  readonly revision?: string;
  readonly catalog?: { readonly graphSha: string; readonly source?: string };
  readonly documents: readonly { readonly name: string; readonly path: string }[];
  readonly analyses: readonly {
    readonly id: string; readonly platform: TraversalPlatform; readonly role: TraceAnalysisRole; readonly path: string;
    readonly precomputed?: { readonly sha256: string; readonly revision: string; readonly generatedAt?: string };
  }[];
}

/** 사실 문서의 출력 상대 경로다. member마다 디렉터리를 나눠 이름이 겹쳐도 섞이지 않는다. */
export function capturedDocumentPath(member: string, name: string): string {
  return `${member}/documents/${name}`;
}

/** 순회 분석의 출력 상대 경로다. */
export function capturedAnalysisPath(member: string, id: string): string {
  return `${member}/analyses/${id}.json`;
}

/**
 * 수집 결과로 `isthmus-trace-context` v1을 조립한다.
 *
 * 단일 project(member 하나, links 없음)면 최상위 `project`·`revision`·`documents`·`analyses`를,
 * 아니면 `members`·`links`를 쓴다. link `contract.documents`는 설정에서 contract member의 **문서 이름**으로
 * 받아 출력 경로로 바꾼다 — 설정 작성자가 capture 출력 배치를 알 필요가 없게 하기 위해서다.
 */
export function buildCaptureContext(config: TraceCaptureConfig, members: readonly CapturedMember[],
  fileSymbols: readonly TraceFileSymbols[] = []): Record<string, unknown> {
  // 목록이 아무 심볼도 싣지 않으면 필드를 쓰지 않는다 — 옛 context와 바이트가 같다.
  const listed = fileSymbols.length === 0 ? {} : { fileSymbols };
  const analysisEntry = (analysis: CapturedMember['analyses'][number]) => ({
    id: analysis.id, platform: analysis.platform, role: analysis.role, path: analysis.path,
    ...(analysis.precomputed === undefined ? {} : { precomputed: analysis.precomputed }),
  });
  if (!config.workspace) {
    const [member] = members;
    return {
      format: 'isthmus-trace-context', version: 1, project: member!.project,
      ...(member!.revision === undefined ? {} : { revision: member!.revision }),
      documents: member!.documents.map(({ path }) => path), analyses: member!.analyses.map(analysisEntry),
      selection: config.selection, ...listed,
    };
  }
  const byName = new Map(members.map((member) => [member.name, member]));
  const links = (config.links ?? []).map((link) => rewriteLinkContract(link, byName));
  return {
    format: 'isthmus-trace-context', version: 1,
    members: members.map((member) => ({
      name: member.name, project: member.project, revision: member.revision,
      ...(member.catalog === undefined ? {} : { catalog: member.catalog }),
      documents: member.documents.map(({ path }) => path),
      ...(member.analyses.length === 0 ? {} : { analyses: member.analyses.map(analysisEntry) }),
    })),
    links, selection: config.selection, ...listed,
  };
}

/** link의 contract 문서 이름을 출력 경로로 바꾼다. 모르는 member·이름은 trace가 거부하도록 그대로 둔다. */
function rewriteLinkContract(link: Record<string, unknown>, members: ReadonlyMap<string, CapturedMember>): Record<string, unknown> {
  const { contract } = link;
  if (!isJsonObject(contract) || typeof contract.member !== 'string' || !Array.isArray(contract.documents)) return link;
  const member = members.get(contract.member);
  if (member === undefined) return link;
  const documents = contract.documents.map((name) => {
    const found = member.documents.find((document) => document.name === name);
    if (found === undefined) fail('A link contract names a document that its contract member does not capture.');
    return found.path;
  });
  return { ...link, contract: { ...contract, documents } };
}

/**
 * member 사실 문서에서 한 분석의 root id를 뽑는다(정렬·중복 제거).
 *
 * root는 **선택과 무관한 상위 집합**이다. `language-traversal` 생산자 지침대로 핸들러 전체(정방향),
 * 호출·사용을 감싼 심볼 전체(역방향), 선언된 VertexId 전체(DB 의존자)를 한 번에 넣는다. 선택만으로 좁히려면
 * 정방향 도달이 끝나야 어떤 relation이 닿는지 알 수 있고(순서 의존), link 귀속·파일 선택 규칙을 스크립트에
 * 다시 구현해야 한다. 상위 집합은 한 번의 다중 root 순회라 비용이 작고, 같은 artifact로 다른 선택도 trace할 수 있다.
 * trace는 필요한 root만 쓴다. 테스트 소스 사실은 trace가 체인에서 빼므로 root에도 넣지 않는다.
 *
 * - forward: 이 platform의 route-decl `symbol.usr`.
 * - reverse: 이 platform의 route-call·relation-use `symbol.usr`와, 선택한 심볼(`selectedSymbols`).
 * - db-dependents: platform sql의 relation-decl `symbol.usr`(VertexId — 테이블과 컬럼).
 */
export function collectCaptureRoots(documents: readonly BridgeFactsDocument[], role: TraceAnalysisRole,
  platform: TraversalPlatform, selectedSymbols: readonly string[] = []): string[] {
  const kinds = role === 'forward' ? ['route-decl'] : role === 'reverse' ? ['route-call', 'relation-use'] : ['relation-decl'];
  const roots = new Set<string>(role === 'reverse' ? selectedSymbols : []);
  for (const document of documents) {
    if (document.platform !== platform) continue;
    for (const fact of document.facts) {
      if (fact.testSource === true || !kinds.includes(fact.kind) || fact.symbol?.usr === undefined) continue;
      roots.add(fact.symbol.usr);
    }
  }
  return [...roots].sort(compareStrings);
}

/**
 * `check --pairs`에 넘길 member 문서의 인덱스를 고른다.
 *
 * check는 도메인마다 양쪽 측을 요구한다(http: 선언 측과 호출 측, persistence: sql 선언과 비sql 사용). workspace의
 * 서버 member처럼 한쪽 측만 가진 도메인은 check가 입력 오류로 거부하므로, 양쪽 측이 모두 있는 도메인의 문서만
 * 넘긴다. 한 도메인도 성립하지 않거나 문서가 둘 미만이면 빈 목록이다(스크립트가 건너뛴 이유를 manifest에 남긴다).
 * 한쪽 측 도메인을 빼도 root는 잃지 않는다 — root는 {@link collectCaptureRoots}가 사실 문서 전체에서 뽑는다.
 */
export function pairsDocumentIndexes(documents: readonly BridgeFactsDocument[]): number[] {
  const http = documents.flatMap((document, index) => (document.target === 'http' ? [index] : []));
  const httpJoinable = http.some((index) => isDeclarationDocument(documents[index]!)) &&
    http.some((index) => isClientDocument(documents[index]!));
  const persistence = documents.flatMap((document, index) => (document.target === 'persistence' ? [index] : []));
  const persistenceJoinable = persistence.some((index) => documents[index]!.platform === 'sql') &&
    persistence.some((index) => documents[index]!.platform !== 'sql');
  const indexes = [...(httpJoinable ? http : []), ...(persistenceJoinable ? persistence : [])].sort((left, right) => left - right);
  return indexes.length >= 2 ? indexes : [];
}

/**
 * 선택한 심볼 중 이 member·platform의 usr를 돌려준다. 단일 project면 member를 보지 않는다.
 * 파일 선택은 파일에 놓인 사실의 usr가 이미 상위 집합에 들어 있어 따로 더하지 않는다.
 */
export function selectedSymbols(context: TraceContext, member: string | undefined, platform: TraversalPlatform): string[] {
  const { selection } = context;
  if (!('symbols' in selection)) return [];
  return selection.symbols
    .filter((symbol) => symbol.platform === platform && (member === undefined || symbol.member === member))
    .map(({ usr }) => usr);
}

/**
 * root를 한 번의 생산자 실행 단위로 나눈다. 개수 상한과, 인자로 넘길 때의 바이트 상한을 함께 지킨다.
 * 같은 역할·플랫폼·member의 분석 여럿은 trace가 합치므로 나눠도 결과는 같다.
 */
export function chunkCaptureRoots(roots: readonly string[], maxRoots: number, maxBytes = MAX_ROOT_ARGUMENT_BYTES): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let bytes = 0;
  for (const root of roots) {
    const size = Buffer.byteLength(root, 'utf8') + 1;
    if (size > maxBytes) fail('A root id exceeds the per-run argument budget.');
    if (current.length > 0 && (current.length >= maxRoots || bytes + size > maxBytes)) {
      chunks.push(current);
      current = [];
      bytes = 0;
    }
    current.push(root);
    bytes += size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/** 생산자 심볼 목록에서 읽은 심볼 하나와 그 project 상대 파일이다. */
export interface ListedSymbol {
  readonly usr: string;
  readonly path: string;
}

/** 읽은 심볼 목록이다. `skipped`는 project 상대 파일로 확정하지 못해 뺀 심볼 수다. */
export interface SymbolListing {
  readonly format: 'tsograph-graph' | 'kartograph-query-snapshot' | 'cartograph-graph';
  readonly symbols: readonly ListedSymbol[];
  readonly skipped: number;
}

/** 목록 형식마다 그 형식이 나올 수 있는 platform이다. 설정의 platform과 어긋나면 잘못 붙인 목록이다. */
const listingPlatforms: Readonly<Record<SymbolListing['format'], TraversalPlatform>> = {
  'tsograph-graph': 'js', 'kartograph-query-snapshot': 'kotlin', 'cartograph-graph': 'swift',
};

/**
 * 생산자 심볼 목록(신뢰하지 않는 JSON)을 심볼 → project 상대 파일 목록으로 읽는다.
 *
 * 각 생산자의 origin/main README가 밝힌 출력만 받는다. 모르는 형식은 추측하지 않고 거부한다.
 * - tsograph `graph`(`tsograph-graph` v1): `nodes[].id`가 routes·schema 사실과 순회의 `symbol.usr`이고
 *   `location.path`는 `--project` 상대 경로다. 문서 `project`가 member project와 같아야 한다.
 * - kartograph `snapshot --include-paths`(`kartograph-query-snapshot` v1, compact v2): `graph.nodes[].usr`와
 *   `location.path`. v2는 `graph.stringTable` 색인으로 푼다(노드 행의 0번이 usr, 5번이 `[path, line, column]`).
 *   `/`가 없는 경로는 소스 파일 이름만 남은 것이라(project 경로를 확정하지 못함) 뺀다 — kartograph 순회와 같은 규칙이다.
 *   snapshot은 project를 싣지 않아 project 대조는 하지 못한다.
 * - cartograph `graph --level symbol --format json`: `nodes[].usr`와 절대 경로 `location.path`. member project
 *   (realpath) 아래 경로만 상대 경로로 바꾸고, 밖의 경로와 외부 심볼(`isExternal`)은 뺀다.
 */
export function parseSymbolListing(value: unknown, platform: TraversalPlatform, project: string): SymbolListing {
  if (!isJsonObject(value)) fail('The symbol listing is not a JSON object.');
  const listing = value.format === 'tsograph-graph' ? tsographListing(value, project)
    : value.format === 'kartograph-query-snapshot' ? kartographListing(value)
      : value.tool === 'cartograph' && value.level === 'symbol' ? cartographListing(value, project)
        : fail('Unsupported symbol listing; use tsograph graph, kartograph snapshot --include-paths, or cartograph graph '
          + '--level symbol --format json.');
  if (listingPlatforms[listing.format] !== platform) fail(`A ${listing.format} listing cannot describe platform ${platform}.`);
  return listing;
}

/** tsograph `graph` 출력이다. */
function tsographListing(value: Record<string, unknown>, project: string): SymbolListing {
  if (value.version !== 1 || !Array.isArray(value.nodes)) fail('Expected tsograph-graph version 1 with a nodes list.');
  if (value.project !== project) fail('The tsograph graph was produced for a different project than its member.');
  return collectListed('tsograph-graph', value.nodes, (node) => (isJsonObject(node)
    ? { usr: node.id, path: isJsonObject(node.location) ? node.location.path : undefined } : {}));
}

/** kartograph query snapshot이다. v2(compact)는 문자열 사전으로 푼다. */
function kartographListing(value: Record<string, unknown>): SymbolListing {
  const graph = value.graph;
  if ((value.version !== 1 && value.version !== 2) || !isJsonObject(graph) || !Array.isArray(graph.nodes)) {
    fail('Expected kartograph-query-snapshot version 1 or 2 with graph.nodes.');
  }
  const kept = (path: unknown) => (typeof path === 'string' && path.includes('/') ? path : undefined);
  if (value.version === 1) {
    return collectListed('kartograph-query-snapshot', graph.nodes, (node) => (isJsonObject(node)
      ? { usr: node.usr, path: isJsonObject(node.location) ? kept(node.location.path) : undefined } : {}));
  }
  const table = graph.stringTable;
  if (!Array.isArray(table)) fail('A compact kartograph snapshot needs graph.stringTable.');
  const text = (index: unknown) => (Number.isSafeInteger(index) && (index as number) >= 0 ? table[index as number] : undefined);
  return collectListed('kartograph-query-snapshot', graph.nodes, (node) => {
    if (!Array.isArray(node)) return {};
    return { usr: text(node[0]), path: Array.isArray(node[5]) ? kept(text(node[5][0])) : undefined };
  });
}

/** cartograph `graph --level symbol --format json` 출력이다. 절대 경로를 member project 기준으로 바꾼다. */
function cartographListing(value: Record<string, unknown>, project: string): SymbolListing {
  if (!Array.isArray(value.nodes)) fail('Expected a cartograph symbol graph with a nodes list.');
  const prefix = project.endsWith('/') ? project : `${project}/`;
  return collectListed('cartograph-graph', value.nodes, (node) => {
    if (!isJsonObject(node) || node.isExternal === true) return {};
    const path = isJsonObject(node.location) ? node.location.path : undefined;
    // symbol 수준에서는 id와 usr가 같은 인덱스 USR이다. usr가 비면 id를 쓴다.
    return { usr: node.usr ?? node.id,
      path: typeof path === 'string' && path.startsWith(prefix) ? path.slice(prefix.length) : undefined };
  });
}

/** 목록 행에서 (usr, 상대 경로)를 모은다. 위치를 확정하지 못한 행은 센다. usr가 문자열이 아니면 형식 위반이다. */
function collectListed(format: SymbolListing['format'], nodes: readonly unknown[],
  read: (node: unknown) => { usr?: unknown; path?: unknown }): SymbolListing {
  const symbols: ListedSymbol[] = [];
  let skipped = 0;
  for (const node of nodes) {
    const { usr, path } = read(node);
    if (usr === undefined && path === undefined) { skipped += 1; continue; }
    if (!isSafeNonEmptyString(usr)) fail(`A ${format} listing entry has no valid symbol id.`);
    if (isProjectRelativePath(path) && !path.includes('\\')) symbols.push({ usr, path });
    else skipped += 1;
  }
  return { format, symbols, skipped };
}

/** 파일 선택에서 이 member(단일 project면 undefined)가 고른 파일이다. 파일 선택이 아니면 빈 목록이다. */
export function selectedCaptureFiles(context: TraceContext, member: string | undefined): string[] {
  const { selection } = context;
  if (!('files' in selection)) return [];
  return selection.files.flatMap((file) => {
    if (typeof file === 'string') return member === undefined ? [file] : [];
    return file.member === member ? [file.path] : [];
  });
}

/** 목록에서 고른 파일에 놓인 심볼을 파일별로 모은다(정렬·중복 제거). */
export function listedSymbolsInFiles(listing: SymbolListing, files: readonly string[]): Map<string, string[]> {
  return groupByFile(listing.symbols, files);
}

/** 순회 분석들이 고른 파일에 위치시킨 root·도달 심볼을 파일별로 모은다. 목록이 없는 platform의 대안이다. */
export function analysisSymbolsInFiles(analyses: readonly TraceAnalysis[], files: readonly string[]): Map<string, string[]> {
  const located = analyses.flatMap(({ graph }) => [
    ...graph.roots.flatMap(({ symbol }) => (symbol?.location === undefined ? [] : [symbol])),
    ...graph.reached.map(({ symbol }) => symbol),
  ]).flatMap((symbol) => (symbol.location === undefined ? [] : [{ usr: symbol.usr, path: symbol.location.path }]));
  return groupByFile(located, files);
}

/** (usr, path) 목록을 고른 파일로 거르고 파일별로 묶는다. 결과는 파일·usr 모두 정렬한다. */
function groupByFile(symbols: readonly ListedSymbol[], files: readonly string[]): Map<string, string[]> {
  const wanted = new Set(files);
  const byFile = new Map<string, Set<string>>();
  for (const { usr, path } of symbols) {
    if (!wanted.has(path)) continue;
    const set = byFile.get(path) ?? new Set<string>();
    set.add(usr);
    byFile.set(path, set);
  }
  return new Map([...byFile.entries()].sort(([left], [right]) => compareStrings(left, right))
    .map(([path, usrs]) => [path, [...usrs].sort(compareStrings)]));
}

/** 자리표시자 치환에 쓰는 값이다. revision은 모를 수 있다. */
export interface CaptureArgumentValues {
  readonly project: string;
  readonly revision?: string;
  readonly generatedAt: string;
}

/**
 * 인자 하나를 실제 문자열로 바꾼다. `{project}`·`{revision}`·`{generatedAt}`만 자리표시자다 — route 템플릿의
 * `{}`처럼 다른 중괄호는 그대로 둔다. 경로 참조는 `resolvePath`(스크립트의 root 포함 확인)로 바꾼다.
 */
export function expandCaptureArgument(argument: CaptureArgument, values: CaptureArgumentValues,
  resolvePath: (reference: CapturePathRef) => string): string {
  if (typeof argument !== 'string') return resolvePath(argument);
  return argument.replace(/\{(project|revision|generatedAt)\}/gu, (_, name: string) => {
    if (name === 'project') return values.project;
    if (name === 'generatedAt') return values.generatedAt;
    if (values.revision === undefined) fail('An argument uses {revision}, but the member declares no revision.');
    return values.revision;
  });
}

/**
 * root를 생산자 인자로 붙인다. `arguments`는 `-`로 시작하는 id를 거부한다 — 생산자가 플래그로 읽으면
 * 다른 옵션을 주입하게 되기 때문이다. 그런 id가 있으면 `separator`나 `roots-from`을 쓴다.
 */
export function rootArguments(delivery: CaptureRootsDelivery, roots: readonly string[], rootsFile?: string): string[] {
  if (delivery === 'roots-from') {
    if (rootsFile === undefined) fail('roots-from delivery needs a roots file.');
    return ['--roots-from', rootsFile];
  }
  if (delivery === 'separator') return ['--', ...roots];
  if (roots.some((root) => root.startsWith('-'))) {
    fail('A root id starts with "-" and could be read as a producer flag; use roots "separator" or "roots-from".');
  }
  return [...roots];
}

/** 알 수 없는 키가 있으면 거부한다. */
function rejectUnknownKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, message: string): void {
  if (Object.keys(value).some((key) => !allowed.has(key))) fail(message);
}

/** 목록에 중복이 있으면 거부한다. */
function unique(values: readonly string[], message: string): void {
  if (new Set(values).size !== values.length) fail(message);
}

/** 입력 값을 포함하지 않는 검증 오류를 던진다. */
function fail(message: string): never {
  throw new TraceCaptureValidationError(message);
}
