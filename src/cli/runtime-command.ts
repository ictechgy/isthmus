import { parseBridgeRuntime, parseRuntimeExpectations, RuntimeValidationError } from '../exchange/runtime.ts';
import { MAX_DOCUMENTS_PER_JOIN } from '../join/join.ts';
import { verifyRuntimeEvidence } from '../report/runtime.ts';
import { encodeSortedJson } from '../report/sorted-json.ts';
import { inputFailure, internalError } from './command-support.ts';
import type { CommandResult, ReadTextFile } from './command-support.ts';
import { parseCommandArguments } from './parse-arguments.ts';
import { RuntimeInputError, RuntimeJsonReader } from './runtime-json-reader.ts';

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

/** 런타임 기대 파일과 하나 이상의 실행 로그가 필요하다. */
export const runtimeUsage = 'Usage: isthmus verify-runtime --expectations <expectations.json> '
  + '<runtime.json> [more...] [--strict] [--compact]';
