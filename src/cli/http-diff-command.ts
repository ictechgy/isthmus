import { dirname, isAbsolute, resolve } from 'node:path';

import { compareStrings } from '../compare.ts';
import { isJsonObject, type BridgeFactsDocument } from '../exchange/parse.ts';
import { parseWorkspaceManifest, TraceContextValidationError, type TraceWorkspace } from '../exchange/trace-context.ts';
import { MAX_DOCUMENTS_PER_JOIN } from '../join/join.ts';
import {
  createHttpSurfaceDiff,
  createHttpWorkspaceDiff,
  HttpDiffInputError,
  type HttpDiffDocument,
  type HttpWorkspaceSnapshot,
} from '../report/http-diff.ts';
import { HTTP_DIFF_CODES, type HttpDiffCode, type HttpDiffFinding } from '../report/http-diff-findings.ts';
import { encodeSortedJson } from '../report/sorted-json.ts';
import { TraceInputError } from '../report/trace-inputs.ts';
import { HTTP_SURFACE_FORMAT, type ImportedHttpSurface } from '../exchange/http-surface.ts';
import { HttpSurfaceInputError, readHttpSurface } from './surface-input.ts';
import {
  inputFailure,
  inputFailureResult,
  internalError,
  isJsonParseFailure,
  MAX_INPUT_TEXT_LENGTH,
  readBridgeDocuments,
  type CommandResult,
  type ReadTextFile,
} from './command-support.ts';

/**
 * `isthmus diff --http` — 한 서버·스펙의 http route 표면을 두 시점에서 비교한다(docs/HTTP-DIFF.md).
 *
 * `--before`·`--after`가 각각 `isthmus-workspace` 매니페스트 하나면 workspace 모드, 각각 `isthmus-http-surface`
 * artifact 하나면 artifact를 선언 측으로 쓰는 surface 모드, 아니면 문서 목록의 surface 모드다. `--fail-on`·`--strict`에 걸린 finding이 있으면 1이다. 오타 난 토큰이 아무것도 막지 않는 CI가 되지 않게
 * 모르는 토큰은 사용 오류 64다.
 */
export async function runHttpDiffCommand(arguments_: readonly string[], readTextFile: ReadTextFile): Promise<CommandResult> {
  const parsed = parseHttpDiffArguments(arguments_);
  if (parsed === undefined) return { standardOutput: '', standardError: `${httpDiffUsage}\n`, exitCode: 64 };
  try {
    const report = await createReport(parsed, readTextFile);
    const matched = failOnMatches(report.findings, parsed.failOn);
    return {
      standardOutput: encodeSortedJson(report, parsed.compact),
      standardError: matched.length === 0 ? '' : `Http diff matched --fail-on: ${matched.join(', ')}.\n`,
      exitCode: matched.length === 0 ? 0 : 1,
    };
  } catch (error) {
    return httpDiffFailure(error);
  }
}

/** `diff --http`의 사용법이다. */
export const httpDiffUsage =
  'Usage: isthmus diff --http --before <server/spec.json...|base.surface.json|base.workspace.json> '
  + '--after <server/spec.json...|head.surface.json|head.workspace.json> [--clients <client.json...>] '
  + '[--fail-on <code|error|warning|incomplete>[,...]] [--strict] [--compact]';

/** `--fail-on` 토큰이다. finding 코드와 묶음 토큰 셋이다. */
type FailOnToken = HttpDiffCode | 'error' | 'warning' | 'incomplete';

/** 검증된 `diff --http` 인수다. */
interface HttpDiffArguments {
  readonly before: readonly string[];
  readonly after: readonly string[];
  readonly clients?: readonly string[];
  readonly failOn: ReadonlySet<FailOnToken>;
  readonly compact: boolean;
}

/** 목록 플래그다. 뒤따르는 `-`로 시작하지 않는 인수가 그 목록에 들어간다. */
const listFlags = new Set(['--before', '--after', '--clients']);

/**
 * `diff --http …` 인수를 검증한다. `--http`는 `diff` 바로 다음이어야 한다(경로 문자열이 모드를 바꾸지 못하게).
 * 목록 플래그와 `--fail-on`·`--strict`·`--compact`는 각각 한 번만 올 수 있다. 어긋나면 undefined(사용 오류)다.
 */
export function parseHttpDiffArguments(arguments_: readonly string[]): HttpDiffArguments | undefined {
  if (arguments_[0] !== 'diff' || arguments_[1] !== '--http') return undefined;
  const lists = new Map<string, string[]>();
  const flags = new Set<string>();
  let failOn: string | undefined;
  let current: string[] | undefined;
  for (let index = 2; index < arguments_.length; index++) {
    const argument = arguments_[index]!;
    if (listFlags.has(argument)) {
      if (lists.has(argument)) return undefined;
      current = [];
      lists.set(argument, current);
    } else if (argument === '--fail-on') {
      const value = arguments_[index + 1];
      if (failOn !== undefined || value === undefined || value.length === 0 || value.startsWith('-')) return undefined;
      failOn = value;
      index++;
      current = undefined;
    } else if (argument === '--strict' || argument === '--compact') {
      if (flags.has(argument)) return undefined;
      flags.add(argument);
      current = undefined;
    } else if (argument.startsWith('-') || current === undefined || argument.trim().length === 0) {
      return undefined;
    } else {
      current.push(argument);
    }
  }
  return validatedArguments(lists, failOn, flags);
}

/** 목록 개수·총 문서 수·`--fail-on` 토큰을 검증해 인수 묶음을 만든다. */
function validatedArguments(lists: ReadonlyMap<string, string[]>, failOn: string | undefined,
  flags: ReadonlySet<string>): HttpDiffArguments | undefined {
  const before = lists.get('--before') ?? [];
  const after = lists.get('--after') ?? [];
  const clients = lists.get('--clients');
  const total = before.length + after.length + (clients?.length ?? 0);
  if (before.length === 0 || after.length === 0 || clients?.length === 0 || total > MAX_DOCUMENTS_PER_JOIN) return undefined;
  const tokens = parseFailOn(failOn);
  if (tokens === undefined) return undefined;
  if (flags.has('--strict')) tokens.add('error');
  return { before, after, ...(clients === undefined ? {} : { clients }), failOn: tokens, compact: flags.has('--compact') };
}

/** 쉼표로 나눈 `--fail-on` 토큰을 닫힌 목록과 대조한다. 모르는 토큰이나 빈 토큰이 있으면 undefined다. */
function parseFailOn(value: string | undefined): Set<FailOnToken> | undefined {
  const tokens = new Set<FailOnToken>();
  if (value === undefined) return tokens;
  for (const token of value.split(',')) {
    if (!isFailOnToken(token)) return undefined;
    tokens.add(token);
  }
  return tokens;
}

/** `--fail-on` 토큰인지다. */
function isFailOnToken(token: string): token is FailOnToken {
  return token === 'error' || token === 'warning' || token === 'incomplete' || Object.hasOwn(HTTP_DIFF_CODES, token);
}

/** `--fail-on`에 걸린 finding 코드와 개수를 `code (n)` 목록으로 돌려준다. */
export function failOnMatches(findings: readonly HttpDiffFinding[], tokens: ReadonlySet<FailOnToken>): string[] {
  const counts = new Map<string, number>();
  for (const value of findings) {
    if (!matchesFailOn(value, tokens)) continue;
    counts.set(value.code, (counts.get(value.code) ?? 0) + 1);
  }
  return [...counts.entries()].sort(([left], [right]) => compareStrings(left, right))
    .map(([code, count]) => `${code} (${count})`);
}

/** finding 하나가 토큰 중 하나에 걸리는지다. `warning`은 warning 이상(error 포함)이다. */
function matchesFailOn(value: HttpDiffFinding, tokens: ReadonlySet<FailOnToken>): boolean {
  return tokens.has(value.code) ||
    (tokens.has('error') && value.severity === 'error') ||
    (tokens.has('warning') && value.severity !== 'info') ||
    (tokens.has('incomplete') && value.category === 'incompleteness');
}

/* ───────────── 입력 읽기 ───────────── */

/** 모드를 가려 입력을 읽고 보고서를 만든다. */
async function createReport(parsed: HttpDiffArguments, readTextFile: ReadTextFile): Promise<HttpDiffDocument> {
  const kind = await inputKind(parsed, readTextFile);
  if (kind.mode === 'documents') {
    const clients = parsed.clients ?? [];
    const documents = await readBridgeDocuments([...parsed.before, ...parsed.after, ...clients], readTextFile);
    return createHttpSurfaceDiff({
      before: documents.slice(0, parsed.before.length),
      after: documents.slice(parsed.before.length, parsed.before.length + parsed.after.length),
      clients: documents.slice(parsed.before.length + parsed.after.length),
    });
  }
  if (kind.mode === 'surfaces') return readSurfaceArtifactDiff(parsed, readTextFile);
  if (parsed.clients !== undefined) {
    throw new HttpDiffInputError('Workspace mode takes client documents from the after manifest; remove --clients.');
  }
  return readWorkspaceDiff(kind.manifests, parsed, readTextFile);
}

/** 읽은 매니페스트 두 개와 그 텍스트 길이다. */
interface ManifestPair {
  readonly before: TraceWorkspace;
  readonly after: TraceWorkspace;
  readonly textLength: number;
}

/** 입력 모양이다: 문서 목록, surface artifact 두 개, workspace 매니페스트 두 개. */
type InputKind =
  | { readonly mode: 'documents' }
  | { readonly mode: 'surfaces' }
  | { readonly mode: 'workspace'; readonly manifests: ManifestPair };

/**
 * `--before`·`--after`가 각각 경로 하나면 매니페스트·surface artifact인지 본다. 둘 다 같은 종류면 그 모드를, 둘 다
 * 문서면 문서 목록 모드를 돌려준다. 두 시점의 종류가 다르면 입력 구성 오류다.
 */
async function inputKind(parsed: HttpDiffArguments, readTextFile: ReadTextFile): Promise<InputKind> {
  if (parsed.before.length !== 1 || parsed.after.length !== 1) return { mode: 'documents' };
  const before = await readJsonFile(parsed.before[0]!, 'before', readTextFile);
  const after = await readJsonFile(parsed.after[0]!, 'after', readTextFile);
  const kindOf = (value: unknown) => !isJsonObject(value) ? 'documents'
    : value.format === 'isthmus-workspace' ? 'workspace' : value.format === HTTP_SURFACE_FORMAT ? 'surfaces' : 'documents';
  const mode = kindOf(before.value);
  if (mode !== kindOf(after.value)) {
    throw new HttpDiffInputError('Compare two workspace manifests, two http surfaces or two document lists; the before and '
      + 'after inputs are of different kinds.');
  }
  if (mode !== 'workspace') return { mode };
  return { mode, manifests: { before: parseManifest(before.value, 'before'), after: parseManifest(after.value, 'after'),
    textLength: before.length + after.length } };
}

/**
 * base·head가 같은 서버 표면의 두 릴리스 artifact인 surface 모드다. artifact의 선언 측 문서를 `--clients`의 호출과 교차
 * 평가한다. 파일은 명령줄로 직접 받으므로 고정할 sha256이 없고, 계산한 sha256을 출력 신원에 싣는다.
 */
async function readSurfaceArtifactDiff(parsed: HttpDiffArguments, readTextFile: ReadTextFile): Promise<HttpDiffDocument> {
  const budget = { used: 0 };
  const before = await readHttpSurface(parsed.before[0]!, 'the before http surface', undefined, readTextFile, budget);
  const after = await readHttpSurface(parsed.after[0]!, 'the after http surface', undefined, readTextFile, budget);
  const clients = await readBridgeDocuments(parsed.clients ?? [], readTextFile, budget.used);
  return createHttpSurfaceDiff({ before: before.imported.documents, after: after.imported.documents, clients,
    artifacts: { before, after } });
}

/** 매니페스트 하나를 검증한다. 원문 값 대신 시점 이름과 원인만 싣는다. */
function parseManifest(value: unknown, snapshot: 'before' | 'after'): TraceWorkspace {
  try {
    return parseWorkspaceManifest(value);
  } catch (error) {
    if (error instanceof TraceContextValidationError) {
      throw new HttpDiffInputError(`The ${snapshot} workspace manifest violates its contract: ${error.message}`);
    }
    throw error;
  }
}

/** JSON 파일 하나를 크기 상한 안에서 읽는다. 경로 대신 시점 이름만 오류에 싣는다. */
async function readJsonFile(path: string, snapshot: 'before' | 'after', readTextFile: ReadTextFile): Promise<{
  value: unknown; length: number;
}> {
  let text: string;
  try {
    text = await readTextFile(path);
  } catch {
    throw new HttpDiffInputError(`Unable to read the ${snapshot} input; check that the file exists and is readable.`);
  }
  if (text.length > MAX_INPUT_TEXT_LENGTH) throw new HttpDiffInputError(`The ${snapshot} input exceeds the input size limit.`);
  try {
    return { value: JSON.parse(text), length: text.length };
  } catch (error) {
    if (isJsonParseFailure(error)) throw new HttpDiffInputError(`The ${snapshot} input is not valid JSON.`);
    throw error;
  }
}

/**
 * workspace 모드의 문서를 읽는다. before는 link의 server·contract member 문서만, after는 모든 member 문서를 읽는다
 * (client member 호출 평가와 `http-member-unlinked`에 필요하다). 상대 경로는 각 매니페스트 디렉터리 기준이다.
 * 문서 순번은 before 목록 다음 after 목록 순서다.
 */
async function readWorkspaceDiff(manifests: ManifestPair, parsed: HttpDiffArguments,
  readTextFile: ReadTextFile): Promise<HttpDiffDocument> {
  const beforePaths = declarationPaths(manifests.before);
  const afterPaths = manifests.after.members.flatMap(({ documents }) => documents);
  const locate = (manifest: string) => (path: string) => (isAbsolute(path) ? path : resolve(dirname(manifest), path));
  const budget = { used: manifests.textLength };
  const beforeSurfaces = await readSurfaces(manifests.before, declarationMembers(manifests.before), locate(parsed.before[0]!),
    'before', readTextFile, budget);
  const afterSurfaces = await readSurfaces(manifests.after, new Set(manifests.after.members.map(({ name }) => name)),
    locate(parsed.after[0]!), 'after', readTextFile, budget);
  const documents = await readBridgeDocuments([...beforePaths.map(locate(parsed.before[0]!)),
    ...afterPaths.map(locate(parsed.after[0]!))], readTextFile, budget.used);
  return createHttpWorkspaceDiff(
    snapshot(manifests.before, beforePaths, documents.slice(0, beforePaths.length), beforeSurfaces),
    snapshot(manifests.after, afterPaths, documents.slice(beforePaths.length), afterSurfaces),
  );
}

/** link의 server·contract member 이름이다. */
function declarationMembers(workspace: TraceWorkspace): Set<string> {
  return new Set(workspace.links.flatMap(({ server, contract }) => [server, ...(contract === undefined ? [] : [contract.member])]));
}

/** link의 server·contract member가 가진 문서 경로다(member 순서, 중복 없음). */
function declarationPaths(workspace: TraceWorkspace): string[] {
  const names = declarationMembers(workspace);
  return workspace.members.filter(({ name }) => names.has(name)).flatMap(({ documents }) => documents);
}

/** 고른 member 중 surface member의 artifact를 매니페스트가 고정한 sha256과 대조해 읽는다. */
async function readSurfaces(workspace: TraceWorkspace, names: ReadonlySet<string>, locate: (path: string) => string,
  snapshotName: 'before' | 'after', readTextFile: ReadTextFile, budget: { used: number }): Promise<Map<string, ImportedHttpSurface>> {
  const surfaces = new Map<string, ImportedHttpSurface>();
  const members = workspace.members.filter(({ name, surface }) => surface !== undefined && names.has(name));
  for (const [index, member] of members.entries()) {
    const loaded = await readHttpSurface(locate(member.surface!.path), `${snapshotName} http surface ${index + 1}`,
      member.surface!.sha256, readTextFile, budget);
    surfaces.set(member.name, loaded.imported);
  }
  return surfaces;
}

/** 경로와 읽은 문서를 짝지어 한 시점을 만든다. */
function snapshot(workspace: TraceWorkspace, paths: readonly string[], documents: readonly BridgeFactsDocument[],
  surfaces: ReadonlyMap<string, ImportedHttpSurface>): HttpWorkspaceSnapshot {
  return { workspace, documents: new Map(paths.map((path, index) => [path, documents[index]!])), surfaces };
}

/** 알려진 입력 실패를 원인 문구의 코드 2로 바꾼다. */
function httpDiffFailure(error: unknown): CommandResult {
  if (error instanceof HttpDiffInputError || error instanceof TraceInputError || error instanceof HttpSurfaceInputError) {
    return inputFailure(`Http diff input violates its contract: ${error.message}\n`);
  }
  return inputFailureResult(error) ?? internalError();
}
