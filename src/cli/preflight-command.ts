import { isSafeNonEmptyString } from '../exchange/parse.ts';
import { parsePreflightContext, PreflightValidationError } from '../exchange/preflight-context.ts';
import { createPreflightReport, hasPreflightBlockers, PreflightGraphError } from '../report/preflight.ts';
import { encodeSortedJson } from '../report/sorted-json.ts';
import { inputFailure, inputFailureResult, internalError, isJsonParseFailure, MAX_TOTAL_INPUT_TEXT_LENGTH } from './command-support.ts';
import type { CommandResult, ReadTextFile } from './command-support.ts';
import { parseCommandArguments } from './parse-arguments.ts';

/** 같은 실행 문맥의 언어별 영향 결과를 연결해 사람이거나 AI인 소비자에게 전달한다. */
export async function runPreflightCommand(arguments_: readonly string[], readTextFile: ReadTextFile): Promise<CommandResult> {
  const parsed = parseCommandArguments(arguments_.slice(1), ['--revision'], ['--strict', '--compact']);
  const revision = parsed?.valueFlags.get('--revision');
  if (parsed === undefined || parsed.positionals.length !== 1 ||
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
    const report = createPreflightReport(revision === undefined || revision === context.revision ? context : {
      ...context, limitations: [...context.limitations, 'stale-preflight-context: capture revision differs from the requested revision'],
    });
    const blocked = parsed.booleanFlags.has('--strict') && hasPreflightBlockers(report);
    return { standardOutput: encodeSortedJson(report, parsed.booleanFlags.has('--compact')),
      standardError: blocked ? 'Cross-language preflight requires review: errors, evidence gaps, or unobserved selections remain.\n' : '',
      exitCode: blocked ? 1 : 0 };
  } catch (error) {
    if (error instanceof PreflightValidationError || error instanceof PreflightGraphError) {
      return inputFailure(`Preflight context violates its contract: ${error.message}\n`);
    }
    return inputFailureResult(error) ?? internalError();
  }
}

/** 입력 생성은 producer workflow가 맡으며 CLI는 JSON만 읽는다. */
export const preflightUsage = 'Usage: isthmus preflight <context.json> [--revision <revision>] [--strict] [--compact]';
