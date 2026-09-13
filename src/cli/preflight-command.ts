import { isSafeNonEmptyString } from '../exchange/parse.ts';
import { parsePreflightContext, PreflightValidationError } from '../exchange/preflight-context.ts';
import { parseBridgeRuntime, parseRuntimeExpectations, RuntimeValidationError } from '../exchange/runtime.ts';
import { MAX_DOCUMENTS_PER_JOIN } from '../join/join.ts';
import { createPreflightReport, hasPreflightBlockers, PreflightGraphError } from '../report/preflight.ts';
import { attachPreflightRuntime } from '../report/preflight-runtime.ts';
import { encodeSortedJson } from '../report/sorted-json.ts';
import { inputFailure, inputFailureResult, internalError, isJsonParseFailure, MAX_TOTAL_INPUT_TEXT_LENGTH } from './command-support.ts';
import type { CommandResult, ReadTextFile } from './command-support.ts';
import { parseCommandArguments } from './parse-arguments.ts';
import { RuntimeInputError, RuntimeJsonReader } from './runtime-json-reader.ts';

/** 같은 실행 문맥의 언어별 영향 결과를 연결해 사람이거나 AI인 소비자에게 전달한다. */
export async function runPreflightCommand(arguments_: readonly string[], readTextFile: ReadTextFile): Promise<CommandResult> {
  const parsed = parseCommandArguments(arguments_.slice(1), ['--revision', '--expectations'], ['--strict', '--compact']);
  const revision = parsed?.valueFlags.get('--revision');
  const expectedPath = parsed?.valueFlags.get('--expectations');
  if (parsed === undefined || parsed.positionals.length < 1 || parsed.positionals.length > MAX_DOCUMENTS_PER_JOIN + 1 ||
    (expectedPath === undefined && parsed.positionals.length !== 1) ||
    (revision !== undefined && !isSafeNonEmptyString(revision))) {
    return { standardOutput: '', standardError: `${preflightUsage}\n`, exitCode: 64 };
  }
  let text: string;
  try { text = await readTextFile(parsed.positionals[0]!); }
  catch { return inputFailure('Unable to read preflight context; check that the file exists and is readable.\n'); }
  if (text.length > MAX_TOTAL_INPUT_TEXT_LENGTH) return inputFailure('Preflight context exceeds the input size limit.\n');
  let value: unknown;
  try { value = JSON.parse(text); }
  catch (error) {
    return isJsonParseFailure(error) ? inputFailure('Preflight context is not valid JSON.\n') : internalError();
  }
  try {
    const context = parsePreflightContext(value);
    let report = createPreflightReport(revision === undefined || revision === context.revision ? context : {
      ...context, limitations: [...context.limitations, 'stale-preflight-context: capture revision differs from the requested revision'],
    });
    if (expectedPath !== undefined) {
      const reader = new RuntimeJsonReader(readTextFile, text.length);
      const expectations = parseRuntimeExpectations(await reader.read(expectedPath));
      const documents = [];
      for (const path of parsed.positionals.slice(1)) documents.push(parseBridgeRuntime(await reader.read(path)));
      report = attachPreflightRuntime(context, report, expectations, documents);
    }
    const blocked = parsed.booleanFlags.has('--strict') && hasPreflightBlockers(report);
    return { standardOutput: encodeSortedJson(report, parsed.booleanFlags.has('--compact')),
      standardError: blocked ? 'Cross-language preflight requires review: errors, evidence gaps, or unobserved selections remain.\n' : '',
      exitCode: blocked ? 1 : 0 };
  } catch (error) {
    if (error instanceof PreflightValidationError || error instanceof PreflightGraphError ||
      error instanceof RuntimeValidationError || error instanceof RuntimeInputError) {
      return inputFailure(`Preflight context violates its contract: ${error.message}\n`);
    }
    return inputFailureResult(error) ?? internalError();
  }
}

/** 입력 생성은 producer workflow가 맡으며 CLI는 JSON만 읽는다. */
export const preflightUsage = 'Usage: isthmus preflight <context.json> [<runtime.json> ...] '
  + '[--expectations <checks.json>] [--revision <revision>] [--strict] [--compact]';
