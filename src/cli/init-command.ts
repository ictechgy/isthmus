import { resolve } from 'node:path';

import { isJsonObject, isSafeNonEmptyString } from '../exchange/parse.ts';
import { encodeSortedJson } from '../report/sorted-json.ts';
import { parseCommandArguments } from './parse-arguments.ts';
import {
  inputFailure,
  isJsonParseFailure,
  MAX_INPUT_TEXT_LENGTH,
  type CaptureFileSystem,
  type CommandResult,
  type ReadTextFile,
  type WriteTextFile,
} from './command-support.ts';

/** init이 쓰는 scaffold의 producer 명령 묶음이다. */
interface InitProducers {
  readonly dartograph: readonly string[];
  readonly cartograph?: readonly string[];
  readonly kartograph?: readonly string[];
}

/**
 * capture 설정 scaffold를 JSON으로 쓴다.
 *
 * producer를 실행하거나 탐지하지 않는다 — 기본 producer 명령은 PATH 이름이고,
 * `--toolchain`을 주면 이미 구축한 `isthmus-built-toolchain` JSON의 실제 명령을
 * 채운다. `prepare`는 앱마다 달라 자리표시자로 남긴다.
 */
export async function runInitCommand(
  arguments_: readonly string[],
  readTextFile: ReadTextFile,
  writeTextFile: WriteTextFile,
  fileSystem: CaptureFileSystem,
  cwd: string,
): Promise<CommandResult> {
  if (arguments_[0] !== 'init') return usageError();
  const parsed = parseCommandArguments(
    arguments_.slice(1),
    ['--project', '--toolchain'],
    ['--force'],
  );
  if (parsed === undefined || parsed.positionals.length > 1) return usageError();
  const outputPath = resolve(cwd, parsed.positionals[0] ?? 'capture.json');

  let project: string;
  try {
    project = await fileSystem.realPath(resolve(cwd, parsed.valueFlags.get('--project') ?? cwd));
  } catch {
    return inputFailure('The project path does not exist; pass --project at the app root.\n');
  }

  let producers: InitProducers = { dartograph: ['dartograph'], cartograph: ['cartograph'] };
  const toolchainPath = parsed.valueFlags.get('--toolchain');
  let toolchainAbsolute: string | undefined;
  if (toolchainPath !== undefined) {
    toolchainAbsolute = resolve(cwd, toolchainPath);
    const loaded = await readToolchain(toolchainAbsolute, readTextFile);
    if (loaded === undefined) {
      return inputFailure(
        'The toolchain manifest is missing or invalid; build one with '
        + 'scripts/build-preflight-toolchain.mjs first.\n',
      );
    }
    producers = loaded;
  }

  if (!parsed.booleanFlags.has('--force') &&
    (await fileSystem.statPath(outputPath)) !== 'missing') {
    return inputFailure(
      `The capture config already exists at ${outputPath}; pass --force to overwrite it.\n`,
    );
  }

  const scaffold = {
    project,
    ...producers,
    prepare: [['replace-with-native-index-build']],
    inputs: ['lib'],
    toolInputs: [toolchainAbsolute ?? 'toolchain.json'],
    selection: { dart: { files: [], symbols: [] } },
    output: '.isthmus/context.json',
    cache: '.isthmus/cache.json',
  };
  try {
    await writeTextFile(outputPath, `${encodeSortedJson(scaffold)}\n`);
  } catch {
    return inputFailure('Unable to write the capture config; check that the path is writable.\n');
  }
  return {
    standardOutput: encodeSortedJson({
      format: 'isthmus-init',
      version: 1,
      path: outputPath,
      project,
      wrote: true,
    }),
    standardError: '',
    exitCode: 0,
  };
}

/** `isthmus-built-toolchain` JSON에서 실제 producer 명령을 읽는다. */
async function readToolchain(
  path: string,
  readTextFile: ReadTextFile,
): Promise<InitProducers | undefined> {
  let text: string;
  try {
    text = await readTextFile(path);
  } catch {
    return undefined;
  }
  if (text.length > MAX_INPUT_TEXT_LENGTH) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    if (isJsonParseFailure(error)) return undefined;
    throw error;
  }
  if (!isJsonObject(value) || value.format !== 'isthmus-built-toolchain' ||
    value.version !== 1 || !isJsonObject(value.commands)) {
    return undefined;
  }
  const commands = value.commands;
  if (!isCommand(commands.dartograph)) return undefined;
  return {
    dartograph: commands.dartograph,
    ...(isCommand(commands.cartograph) ? { cartograph: commands.cartograph } : {}),
    ...(isCommand(commands.kartograph) ? { kartograph: commands.kartograph } : {}),
  };
}

/** 명령 배열은 비어 있지 않은 안전한 문자열의 비어 있지 않은 배열이다. */
function isCommand(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length > 0 && value.every(isSafeNonEmptyString);
}

/** 잘못된 CLI 호출을 경로 없는 사용법과 코드 64로 변환한다. */
function usageError(): CommandResult {
  return { standardOutput: '', standardError: `${initUsage}\n`, exitCode: 64 };
}

/** init 명령의 한 줄 사용법이다. */
export const initUsage =
  'Usage: isthmus init [capture.json] [--project <dir>] '
  + '[--toolchain <toolchain.json>] [--force]';