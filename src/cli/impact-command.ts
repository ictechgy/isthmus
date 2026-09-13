import { ImpactSelectionValidationError, parseImpactSelection } from '../exchange/impact-selection.ts';
import type { ImpactSelection } from '../exchange/impact-selection.ts';
import { isSafeNonEmptyString } from '../exchange/parse.ts';
import { parseBridgeRuntime, RuntimeValidationError } from '../exchange/runtime.ts';
import { MAX_DOCUMENTS_PER_JOIN } from '../join/join.ts';
import { createBridgeImpact, encodeBridgeImpact, hasImpactBlockers } from '../report/impact.ts';
import type { ImpactRuntimeInput } from '../report/runtime-impact.ts';
import {
  inputFailure, inputFailureResult, internalError, isJsonParseFailure,
  MAX_INPUT_TEXT_LENGTH, readBridgeDocuments,
} from './command-support.ts';
import type { CommandResult, ReadTextFile } from './command-support.ts';
import { parseCommandArguments } from './parse-arguments.ts';

/** 파일·심볼·CI 변경 목록을 브리지 영향 보고서로 바꾸는 CLI 경계다. */
export async function runImpactCommand(
  arguments_: readonly string[], readTextFile: ReadTextFile,
): Promise<CommandResult> {
  const parsed = parseCommandArguments(arguments_.slice(1),
    ['--file', '--symbol', '--changes', '--runtime', '--revision'], ['--strict', '--compact']);
  if (parsed === undefined || ['--file', '--symbol', '--changes'].filter((flag) => parsed.valueFlags.has(flag)).length !== 1 ||
    parsed.positionals.length < 2 || parsed.positionals.length > MAX_DOCUMENTS_PER_JOIN) {
    return usageError();
  }
  const runtimePath = parsed.valueFlags.get('--runtime');
  const revision = parsed.valueFlags.get('--revision');
  if ((runtimePath === undefined) !== (revision === undefined) ||
    (revision !== undefined && !isSafeNonEmptyString(revision))) return usageError();
  try {
    let selection: ImpactSelection;
    let supplementalTextLength = 0;
    const changesPath = parsed.valueFlags.get('--changes');
    if (changesPath !== undefined) {
      const loaded = await readSupplemental(changesPath, readTextFile, 'changes', parseImpactSelection);
      if ('exitCode' in loaded) return loaded;
      selection = loaded.document;
      supplementalTextLength += loaded.textLength;
    } else {
      const file = parsed.valueFlags.get('--file');
      const symbol = parsed.valueFlags.get('--symbol');
      try {
        selection = parseImpactSelection({ format: 'isthmus-changes', version: 1,
          files: file === undefined ? [] : [file], symbols: symbol === undefined ? [] : [symbol] });
      } catch (error) {
        if (error instanceof ImpactSelectionValidationError) return usageError();
        throw error;
      }
    }
    let runtime: ImpactRuntimeInput | undefined;
    if (runtimePath !== undefined && revision !== undefined) {
      const loaded = await readSupplemental(runtimePath, readTextFile, 'runtime', parseBridgeRuntime);
      if ('exitCode' in loaded) return loaded;
      supplementalTextLength += loaded.textLength;
      runtime = { document: loaded.document, revision };
    }
    const documents = await readBridgeDocuments(parsed.positionals, readTextFile, supplementalTextLength);
    const report = createBridgeImpact(documents, selection, runtime);
    const blocked = parsed.booleanFlags.has('--strict') && hasImpactBlockers(report);
    return {
      standardOutput: encodeBridgeImpact(report, parsed.booleanFlags.has('--compact')),
      standardError: blocked
        ? 'Change preflight requires review: related errors, analysis gaps, or unobserved selectors remain.\n'
        : report.status === 'unobserved'
          ? 'No selected bridge facts were observed; inspect source coverage and use a pre-change snapshot for deleted code.\n'
          : '',
      exitCode: blocked ? 1 : 0,
    };
  } catch (error) {
    if (error instanceof RuntimeValidationError) return inputFailure(`${error.message}\n`);
    return inputFailureResult(error) ?? internalError();
  }
}

/** 변경 파일도 브리지 입력과 같은 읽기·구문·계약 실패 경계를 지킨다. */
async function readSupplemental<T>(
  path: string, readTextFile: ReadTextFile, kind: 'changes' | 'runtime', parse: (value: unknown) => T,
): Promise<
  { document: T; textLength: number } | CommandResult
> {
  const label = kind === 'changes' ? 'Changes' : 'Runtime';
  const format = kind === 'changes' ? 'isthmus-changes' : 'bridge-runtime';
  let text: string;
  try { text = await readTextFile(path); }
  catch { return inputFailure(`Unable to read ${kind} input; check that the file exists and is readable.\n`); }
  if (text.length > MAX_INPUT_TEXT_LENGTH) return inputFailure(`${label} input exceeds the input size limit.\n`);
  let value: unknown;
  try { value = JSON.parse(text); }
  catch (error) {
    if (isJsonParseFailure(error)) return inputFailure(`${label} input is not valid JSON.\n`);
    throw error;
  }
  try { return { document: parse(value), textLength: text.length }; }
  catch (error) {
    if (error instanceof ImpactSelectionValidationError || error instanceof RuntimeValidationError) {
      return inputFailure(`${label} input violates the ${format} contract: ${error.message}\n`);
    }
    throw error;
  }
}

/** 잘못된 인수는 입력을 읽기 전에 코드 64로 거부한다. */
function usageError(): CommandResult {
  return { standardOutput: '', standardError: `${impactUsage}\n`, exitCode: 64 };
}

/** impact 명령의 독립적인 선택 방식과 CI 실패 옵션이다. */
export const impactUsage = 'Usage: isthmus impact (--file <relative-path> | --symbol <name-or-usr> '
  + '| --changes <changes.json>) <bridge-facts.json> <bridge-facts.json> [more...] '
  + '[--runtime <runtime.json> --revision <revision>] [--strict] [--compact]';
