import { createHash } from 'node:crypto';
import { dirname, isAbsolute, resolve } from 'node:path';

import { TraversalValidationError } from '../exchange/language-traversal.ts';
import {
  analysisProject,
  normalizeTraceAnalysis,
  parseTraceContext,
  TraceContextValidationError,
  type TraceAnalysis,
  type TraceAnalysisReference,
} from '../exchange/trace-context.ts';
import { HttpPairsLimitError, PersistencePairsLimitError } from '../report/pairs.ts';
import { createTraceReport, hasTraceGaps, TraceInputError } from '../report/trace.ts';
import { limitTraceReport, MAX_TRACE_VIEW_CHAINS, MAX_TRACE_VIEW_ROWS, type TraceLimits } from '../report/trace-view.ts';
import { encodeSortedJson } from '../report/sorted-json.ts';
import {
  inputFailure,
  inputFailureResult,
  internalError,
  isJsonParseFailure,
  MAX_INPUT_TEXT_LENGTH,
  MAX_TOTAL_INPUT_TEXT_LENGTH,
  readBridgeDocuments,
} from './command-support.ts';
import type { CommandResult, ReadTextFile } from './command-support.ts';
import { parseCommandArguments } from './parse-arguments.ts';

/**
 * `isthmus trace <trace-context.json>` — route 단위 영향 후보를 생산자 id 정확 일치로 잇는다.
 *
 * context가 가리키는 문서·분석 경로는 context 파일이 있는 디렉터리 기준으로 해석한다(절대 경로는
 * 그대로). 제품은 JSON만 읽고 생산자를 실행하지 않는다. `--strict`는 gap이 하나라도 있으면 1이다.
 * `--max-chains`·`--max-rows`는 출력 목록을 자르고 `truncation`에 자른 곳을 적는다(MCP 응답 상한용). 종료 코드와
 * `summary`는 자르기 전 보고서로 정한다.
 */
export async function runTraceCommand(arguments_: readonly string[], readTextFile: ReadTextFile): Promise<CommandResult> {
  const parsed = parseCommandArguments(arguments_.slice(1), ['--max-chains', '--max-rows'], ['--strict', '--compact']);
  const limits = parsed === undefined ? undefined : parseLimits(parsed.valueFlags);
  if (parsed === undefined || parsed.positionals.length !== 1 || limits === null) {
    return { standardOutput: '', standardError: `${traceUsage}\n`, exitCode: 64 };
  }
  const contextPath = parsed.positionals[0]!;
  let text: string;
  try {
    text = await readTextFile(contextPath);
  } catch {
    return inputFailure('Unable to read the trace context; check that the file exists and is readable.\n');
  }
  if (text.length > MAX_INPUT_TEXT_LENGTH) return inputFailure('Trace context exceeds the input size limit.\n');
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return isJsonParseFailure(error) ? inputFailure('Trace context is not valid JSON.\n') : internalError();
  }
  try {
    const context = parseTraceContext(value);
    const base = dirname(contextPath);
    const locate = (path: string) => (isAbsolute(path) ? path : resolve(base, path));
    const budget = { used: text.length };
    const analyses: TraceAnalysis[] = [];
    for (const [index, reference] of context.analyses.entries()) {
      const raw = await readAnalysis(locate(reference.path), index + 1, reference, readTextFile, budget);
      analyses.push(normalizeTraceAnalysis(raw, reference, analysisProject(context, reference)));
    }
    const documents = await readBridgeDocuments(context.documents.map(locate), readTextFile, budget.used);
    const report = createTraceReport({ context, documents, analyses });
    const blocked = parsed.booleanFlags.has('--strict') && hasTraceGaps(report);
    return {
      standardOutput: encodeSortedJson(limits === undefined ? report : limitTraceReport(report, limits),
        parsed.booleanFlags.has('--compact')),
      standardError: blocked ? 'Trace has gaps: some hops could not be followed; review gaps before relying on the chains.\n' : '',
      exitCode: blocked ? 1 : 0,
    };
  } catch (error) {
    if (error instanceof TraceContextValidationError || error instanceof TraversalValidationError ||
      error instanceof TraceInputError) {
      return inputFailure(`Trace input violates its contract: ${error.message}\n`);
    }
    if (error instanceof AnalysisReadError) return inputFailure(`${error.message}\n`);
    if (error instanceof PersistencePairsLimitError || error instanceof HttpPairsLimitError) {
      return inputFailure(`${error.message}\n`);
    }
    return inputFailureResult(error) ?? internalError();
  }
}

/** 분석 파일을 읽지 못했거나 JSON이 아니거나 크기 상한을 넘었다. 경로 대신 순번만 싣는다. */
class AnalysisReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnalysisReadError';
  }
}

/**
 * 분석 파일 하나를 크기 상한 안에서 JSON으로 읽는다.
 *
 * 사전 계산 artifact(`precomputed`)면 읽은 내용의 SHA-256을 선언과 대조한다. 다르면 다른 빌드의 artifact이거나
 * 내려받다 깨진 것이므로 부분 결과 없이 입력 오류다.
 */
async function readAnalysis(path: string, position: number, reference: TraceAnalysisReference, readTextFile: ReadTextFile,
  budget: { used: number }): Promise<unknown> {
  let text: string;
  try {
    text = await readTextFile(path);
  } catch {
    throw new AnalysisReadError(`Unable to read trace analysis ${position}; check that the file exists and is readable.`);
  }
  budget.used += text.length;
  if (text.length > MAX_INPUT_TEXT_LENGTH || budget.used > MAX_TOTAL_INPUT_TEXT_LENGTH) {
    throw new AnalysisReadError(`Trace analysis ${position} exceeds the input size limits.`);
  }
  if (reference.precomputed !== undefined &&
    createHash('sha256').update(text, 'utf8').digest('hex') !== reference.precomputed.sha256) {
    throw new AnalysisReadError(`Trace analysis ${position} does not match its precomputed sha256; `
      + 'download the artifact built for this revision again or update the context.');
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    if (isJsonParseFailure(error)) throw new AnalysisReadError(`Trace analysis ${position} is not valid JSON.`);
    throw error;
  }
}

/**
 * 출력 상한 플래그를 읽는다. 둘 다 없으면 undefined(자르지 않음), 범위 밖이면 null(사용 오류)이다.
 * 하나만 주면 다른 하나는 범위 상한을 쓴다.
 */
function parseLimits(values: ReadonlyMap<string, string>): TraceLimits | undefined | null {
  const chains = values.get('--max-chains');
  const rows = values.get('--max-rows');
  if (chains === undefined && rows === undefined) return undefined;
  const maxChains = chains === undefined ? MAX_TRACE_VIEW_CHAINS : Number(chains);
  const maxRows = rows === undefined ? MAX_TRACE_VIEW_ROWS : Number(rows);
  const inRange = (value: number, maximum: number) => Number.isSafeInteger(value) && value >= 1 && value <= maximum;
  if ((chains !== undefined && !/^[0-9]+$/u.test(chains)) || (rows !== undefined && !/^[0-9]+$/u.test(rows)) ||
    !inRange(maxChains, MAX_TRACE_VIEW_CHAINS) || !inRange(maxRows, MAX_TRACE_VIEW_ROWS)) return null;
  return { maxChains, maxRows };
}

/** trace 사용법이다. 입력 생성은 생산자 workflow가 맡는다. */
export const traceUsage = 'Usage: isthmus trace <trace-context.json> [--strict] [--compact] '
  + `[--max-chains <1..${MAX_TRACE_VIEW_CHAINS}>] [--max-rows <1..${MAX_TRACE_VIEW_ROWS}>]`;
