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
 */
export async function runTraceCommand(arguments_: readonly string[], readTextFile: ReadTextFile): Promise<CommandResult> {
  const parsed = parseCommandArguments(arguments_.slice(1), [], ['--strict', '--compact']);
  if (parsed === undefined || parsed.positionals.length !== 1) {
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
      standardOutput: encodeSortedJson(report, parsed.booleanFlags.has('--compact')),
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

/** trace 사용법이다. 입력 생성은 생산자 workflow가 맡는다. */
export const traceUsage = 'Usage: isthmus trace <trace-context.json> [--strict] [--compact]';
