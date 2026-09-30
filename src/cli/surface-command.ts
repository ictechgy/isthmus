import { dirname, isAbsolute, resolve } from 'node:path';

import { HttpSurfaceValidationError } from '../exchange/http-surface.ts';
import type { BridgeFactsDocument } from '../exchange/parse.ts';
import { parseWorkspaceManifest, TraceContextValidationError, type TraceMember } from '../exchange/trace-context.ts';
import { isDeclarationDocument } from '../join/route-join.ts';
import { createHttpSurface, HttpSurfaceExportError } from '../report/http-surface-export.ts';
import { encodeSortedJson } from '../report/sorted-json.ts';
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
import { parseCommandArguments } from './parse-arguments.ts';

/**
 * `isthmus surface export` — 서버의 선언 측 http 문서로 조직 밖에 건넬 `isthmus-http-surface` v1을 만든다
 * (docs/HTTP-SURFACE.md). 입력은 서버·스펙 문서 목록이나 workspace 매니페스트의 member 하나다. 결과는 stdout이다.
 *
 * 기본은 가장 좁은 공개다: 핸들러는 불투명 토큰, 한계는 접두사와 고정 문구만. `--include-handler-usrs`·
 * `--include-limitation-text`로 게시자가 넓힌다(핸들러 이름·위치는 어떤 선택으로도 싣지 않는다).
 */
export async function runSurfaceCommand(arguments_: readonly string[], readTextFile: ReadTextFile,
  version: string | undefined): Promise<CommandResult> {
  const parsed = arguments_[1] === 'export' ? parseCommandArguments(arguments_.slice(2),
    ['--name', '--revision', '--workspace', '--member'], ['--include-handler-usrs', '--include-limitation-text', '--compact'])
    : undefined;
  const workspace = parsed?.valueFlags.get('--workspace');
  const member = parsed?.valueFlags.get('--member');
  const invalid = parsed === undefined || (workspace === undefined) !== (member === undefined) ||
    (workspace === undefined ? parsed.positionals.length === 0 || !parsed.valueFlags.has('--name') ||
      !parsed.valueFlags.has('--revision') : parsed.positionals.length > 0);
  if (invalid) return { standardOutput: '', standardError: `${surfaceUsage}\n`, exitCode: 64 };
  if (version === undefined) return inputFailure('Unable to read package metadata.\n');
  try {
    const source = workspace === undefined
      ? { documents: await readBridgeDocuments(parsed.positionals, readTextFile) }
      : await readWorkspaceMember(workspace, member!, readTextFile);
    const surface = createHttpSurface(source.documents, {
      name: parsed.valueFlags.get('--name') ?? source.name!,
      revision: parsed.valueFlags.get('--revision') ?? source.revision!,
      exporterVersion: version,
      includeHandlerUsrs: parsed.booleanFlags.has('--include-handler-usrs'),
      includeLimitationText: parsed.booleanFlags.has('--include-limitation-text'),
    });
    return { standardOutput: encodeSortedJson(surface, parsed.booleanFlags.has('--compact')), standardError: '', exitCode: 0 };
  } catch (error) {
    if (error instanceof HttpSurfaceExportError || error instanceof HttpSurfaceValidationError ||
      error instanceof TraceContextValidationError) {
      return inputFailure(`Surface export input violates its contract: ${error.message}\n`);
    }
    return inputFailureResult(error) ?? internalError();
  }
}

/** 내보낼 문서와(매니페스트면) member의 기본 이름·revision이다. */
interface ExportSource {
  readonly documents: readonly BridgeFactsDocument[];
  readonly name?: string;
  readonly revision?: string;
}

/**
 * workspace 매니페스트의 문서 member 하나에서 선언 측 http 문서(route-decl 문서와 openapi 문서)를 모은다. persistence·
 * sql·호출 측 전용 문서는 표면이 아니므로 건너뛴다. 상대 경로는 매니페스트 디렉터리 기준이다.
 */
async function readWorkspaceMember(path: string, name: string, readTextFile: ReadTextFile): Promise<ExportSource> {
  let text: string;
  try {
    text = await readTextFile(path);
  } catch {
    throw new HttpSurfaceExportError('Unable to read the workspace manifest; check that the file exists and is readable.');
  }
  if (text.length > MAX_INPUT_TEXT_LENGTH) throw new HttpSurfaceExportError('The workspace manifest exceeds the input size limit.');
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    if (isJsonParseFailure(error)) throw new HttpSurfaceExportError('The workspace manifest is not valid JSON.');
    throw error;
  }
  const manifest = parseWorkspaceManifest(value);
  const member: TraceMember | undefined = manifest.members.find((entry) => entry.name === name);
  if (member === undefined || member.surface !== undefined) {
    throw new HttpSurfaceExportError('--member must name a document member of the workspace manifest (not a surface member).');
  }
  const locate = (document: string) => (isAbsolute(document) ? document : resolve(dirname(path), document));
  const all = await readBridgeDocuments(member.documents.map(locate), readTextFile, text.length);
  if (all.some((document) => document.project !== member.project)) {
    throw new HttpSurfaceExportError('Every document of the workspace member must use that member project; regenerate it '
      + 'from the member root.');
  }
  const documents = all.filter((document) =>
    document.platform === 'openapi' || (document.target === 'http' && isDeclarationDocument(document)));
  if (documents.length === 0) {
    throw new HttpSurfaceExportError('The workspace member has no http server or openapi document to publish.');
  }
  return { documents, name: member.name, revision: member.revision! };
}

/** `surface` 사용법이다. */
export const surfaceUsage = 'Usage: isthmus surface export (--name <surface> --revision <revision> <server/spec.json...> | '
  + '--workspace <workspace.json> --member <name> [--name <surface>] [--revision <revision>]) '
  + '[--include-handler-usrs] [--include-limitation-text] [--compact]';
