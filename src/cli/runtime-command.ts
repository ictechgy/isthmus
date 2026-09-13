import { parseBridgeRuntime, parseRuntimeExpectations, RuntimeValidationError } from '../exchange/runtime.ts';
import { MAX_DOCUMENTS_PER_JOIN } from '../join/join.ts';
import { verifyRuntimeEvidence } from '../report/runtime.ts';
import { encodeSortedJson } from '../report/sorted-json.ts';
import {
  inputFailure, internalError, isJsonParseFailure, MAX_INPUT_TEXT_LENGTH, MAX_TOTAL_INPUT_TEXT_LENGTH,
} from './command-support.ts';
import type { CommandResult, ReadTextFile } from './command-support.ts';
import { parseCommandArguments } from './parse-arguments.ts';

/** 시나리오별 실행 기대를 런타임 관찰 JSON과 대조하는 CLI다. */
export async function runRuntimeCommand(
  arguments_: readonly string[], readTextFile: ReadTextFile,
): Promise<CommandResult> {
  const parsed = parseCommandArguments(arguments_.slice(1), ['--expectations'], ['--strict', '--compact']);
  const expectedPath = parsed?.valueFlags.get('--expectations');
  if (parsed === undefined || expectedPath === undefined || parsed.positionals.length === 0 ||
    parsed.positionals.length > MAX_DOCUMENTS_PER_JOIN) {
    return { standardOutput: '', standardError: `${runtimeUsage}\n`, exitCode: 64 };
  }
  try {
    const reader = new RuntimeJsonReader(readTextFile);
    const expectations = parseRuntimeExpectations(await reader.read(expectedPath));
    const documents = [];
    for (const path of parsed.positionals) documents.push(parseBridgeRuntime(await reader.read(path)));
    const report = verifyRuntimeEvidence(expectations, documents);
    const failed = parsed.booleanFlags.has('--strict') && report.status !== 'passed';
    return {
      standardOutput: encodeSortedJson(report, parsed.booleanFlags.has('--compact')),
      standardError: failed
        ? 'Runtime verification requires review: failed calls, missing scenarios, stale runs, or incomplete evidence remain.\n'
        : '',
      exitCode: failed ? 1 : 0,
    };
  } catch (error) {
    if (error instanceof RuntimeValidationError || error instanceof RuntimeInputError) {
      return inputFailure(`${error.message}\n`);
    }
    return internalError();
  }
}

/** 기대·실행 파일 전체에 같은 예산과 입력 순서를 적용한다. */
class RuntimeJsonReader {
  private readonly readTextFile: ReadTextFile;
  private totalLength = 0;
  private position = 0;

  constructor(readTextFile: ReadTextFile) { this.readTextFile = readTextFile; }

  async read(path: string): Promise<unknown> {
    this.position++;
    let text: string;
    try { text = await this.readTextFile(path); }
    catch { throw new RuntimeInputError(`Unable to read runtime input ${this.position}; check the file exists and is readable.`); }
    this.totalLength += text.length;
    if (text.length > MAX_INPUT_TEXT_LENGTH || this.totalLength > MAX_TOTAL_INPUT_TEXT_LENGTH) {
      throw new RuntimeInputError(`Runtime input ${this.position} exceeds the input size limits.`);
    }
    try { return JSON.parse(text); }
    catch (error) {
      if (isJsonParseFailure(error)) throw new RuntimeInputError(`Runtime input ${this.position} is not valid JSON.`);
      throw error;
    }
  }
}

/** 입력 I/O·JSON 오류를 내부 결함과 구분한다. */
class RuntimeInputError extends Error {}

/** 런타임 기대 파일과 하나 이상의 실행 로그가 필요하다. */
export const runtimeUsage = 'Usage: isthmus verify-runtime --expectations <expectations.json> '
  + '<runtime.json> [more...] [--strict] [--compact]';
