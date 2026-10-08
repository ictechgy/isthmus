import { dirname, isAbsolute, resolve } from 'node:path';
import { TraversalValidationError, parseLanguageTraversal } from '../exchange/language-traversal.ts';
import { NavigationValidationError, parseNavigationFactsDocument } from '../exchange/navigation.ts';
import { BridgeFactsValidationError, isJsonObject, isSafeNonEmptyString, parseBridgeFactsDocument } from '../exchange/parse.ts';
import { NavigationTraceInputError, createNavigationTrace } from '../report/navigation-trace.ts';
import { encodeSortedJson } from '../report/sorted-json.ts';
import { inputFailure, MAX_INPUT_TEXT_LENGTH, MAX_TOTAL_INPUT_TEXT_LENGTH, type CommandResult } from './command-support.ts';
import { BridgeJoinValidationError } from '../join/join.ts';
import { BoundedTextReadError } from './bounded-text-file.ts';
import { parseCommandArguments } from './parse-arguments.ts';

/** 파일을 읽기 전에 물리적 바이트 상한을 적용하는 주입 경계다. */
export type ReadNavigationTextFile = (path: string, maximumBytes: number) => Promise<string>;

/** 화면 URL은 HTTP namespace와 분리해 정확한 그래프 심볼로만 연결한다. */
export const navigationTraceUsage = 'Usage: isthmus trace-navigation <context.json> [--strict] [--compact]\n';

/** 별도 navigation context와 기존 HTTP/순회 JSON을 읽으며 생산자는 실행하지 않는다. */
export async function runNavigationTraceCommand(arguments_: readonly string[], readTextFile: ReadNavigationTextFile): Promise<CommandResult> {
  const parsed = parseCommandArguments(arguments_.slice(1), [], ['--strict', '--compact']);
  if (parsed === undefined || parsed.positionals.length !== 1) return { standardOutput: '', standardError: navigationTraceUsage, exitCode: 64 };
  const file = parsed.positionals[0]!;
  let used = 0;
  const read = async (path: string): Promise<unknown> => {
    let text: string;
    try { text = await readTextFile(path, Math.min(MAX_INPUT_TEXT_LENGTH, MAX_TOTAL_INPUT_TEXT_LENGTH - used)); }
    catch (error) {
      if (error instanceof BoundedTextReadError) throw error;
      throw new BoundedTextReadError('read');
    }
    const bytes = Buffer.byteLength(text, 'utf8');
    used += bytes;
    if (bytes > MAX_INPUT_TEXT_LENGTH || used > MAX_TOTAL_INPUT_TEXT_LENGTH) throw new BoundedTextReadError('limit');
    try { return JSON.parse(text) as unknown; }
    catch (error) {
      if (error instanceof SyntaxError || error instanceof RangeError) throw new NavigationJsonError();
      throw error;
    }
  };
  try {
    const context = await read(file);
    if (!isJsonObject(context) || context.format !== 'navigation-trace-context' || context.version !== 1
        || Object.keys(context).some((key) => !['format', 'version', 'navigation', 'documents', 'analyses'].includes(key))
        || !isSafeNonEmptyString(context.navigation) || !paths(context.documents) || !paths(context.analyses)) {
      return inputFailure('Navigation trace context violates its contract.');
    }
    const locate = (path: string) => isAbsolute(path) ? path : resolve(dirname(file), path);
    const navigation = parseNavigationFactsDocument(await read(locate(context.navigation)));
    const documents = [];
    for (const path of context.documents) documents.push(parseBridgeFactsDocument(await read(locate(path))));
    const analyses = [];
    for (const path of context.analyses) analyses.push(parseLanguageTraversal(await read(locate(path))));
    const report = createNavigationTrace(navigation, documents, analyses);
    const output = encodeSortedJson(report, parsed.booleanFlags.has('--compact'));
    if (output.length > MAX_INPUT_TEXT_LENGTH) return inputFailure('Navigation trace output exceeds its size limit; narrow the inputs.');
    const blocked = parsed.booleanFlags.has('--strict') && report.gaps.length > 0;
    return { standardOutput: output, standardError: blocked ? 'Navigation trace has gaps; review them before relying on the chains.\n' : '', exitCode: blocked ? 1 : 0 };
  } catch (error) {
    if (error instanceof BoundedTextReadError) return inputFailure(error.reason === 'limit'
      ? 'Navigation input exceeds its byte limit; split the documents.\n'
      : error.reason === 'encoding' ? 'Navigation input is not valid UTF-8; regenerate the document.\n'
      : 'Unable to read navigation input; check that it is a readable regular file.\n');
    if (error instanceof NavigationJsonError) return inputFailure('Navigation input is not valid JSON; regenerate the document.\n');
    if (error instanceof NavigationValidationError) return inputFailure('Navigation facts violate their contract; regenerate them with a navigation producer.\n');
    if (error instanceof BridgeFactsValidationError) return inputFailure('HTTP facts violate their bridge-facts contract; regenerate them with an HTTP producer.\n');
    if (error instanceof TraversalValidationError) return inputFailure('Navigation analysis violates its traversal contract; regenerate forward reach.\n');
    if (error instanceof NavigationTraceInputError || error instanceof BridgeJoinValidationError) return inputFailure(`${error.message}\n`);
    throw error;
  }
}

/** 문서 경로는 파일을 읽는 CLI에서만 해석하며 목록 상한을 유지한다. */
function paths(input: unknown): input is string[] {
  return Array.isArray(input) && input.length <= 256 && input.every(isSafeNonEmptyString);
}

/** JSON 구문 실패만 내부 결함과 분리한다. */
class NavigationJsonError extends Error {}
