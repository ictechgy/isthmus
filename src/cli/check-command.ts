import { createHash } from 'node:crypto';

import {
  isBridgeJoinDeferred,
  joinBridgeDocuments,
  MAX_DOCUMENTS_PER_JOIN,
} from '../join/join.ts';
import {
  applyBaseline,
  baselineEntryKey,
  BridgeBaselineValidationError,
  createBaselineDocument,
  encodeBaselineDocument,
  MAX_BASELINE_ENTRIES,
  parseBaselineDocument,
  type BaselineDocument,
} from '../report/baseline.ts';
import type { CheckIssue } from '../report/check-report.ts';
import { createCheckReport, encodeCheckReport } from '../report/check-report.ts';
import {
  createSarifLog,
  encodeSarifLog,
} from '../report/sarif.ts';
import {
  bridgeJoinDeferredError,
  inputFailure,
  inputFailureResult,
  internalError,
  MAX_INPUT_TEXT_LENGTH,
  readBridgeDocuments,
  type Clock,
  type CommandResult,
  type ReadTextFile,
  type WriteTextFile,
} from './command-support.ts';
import { parseCommandArguments } from './parse-arguments.ts';

export type { Clock, CommandResult, ReadTextFile, WriteTextFile };

/** check가 내는 보고서 형식이다. SARIF는 isthmus 소유의 additive 출력이다. */
export type CheckOutputFormat = 'json' | 'sarif';

/** check 인자를 실행해 프로세스에 독립적인 결과를 반환한다. */
export async function runCheckCommand(
  arguments_: readonly string[],
  readTextFile: ReadTextFile,
  writeTextFile?: WriteTextFile,
  now: Clock = () => new Date(),
  producerVersion?: string,
): Promise<CommandResult> {
  if (arguments_[0] !== 'check') return usageError();
  const options = parseCheckOptions(arguments_.slice(1));
  if (options === undefined) return usageError();
  const { strict, format, baselinePath, updateBaselinePath, inputPaths } = options;
  if (inputPaths.length < 2 || inputPaths.length > MAX_DOCUMENTS_PER_JOIN) {
    return usageError();
  }
  if (updateBaselinePath !== undefined && writeTextFile === undefined) {
    return internalError();
  }
  try {
    const documents = await readBridgeDocuments(inputPaths, readTextFile);
    const joined = joinBridgeDocuments(documents);
    if (isBridgeJoinDeferred(joined)) {
      return bridgeJoinDeferredError(joined.observedFacts, documents.length);
    }
    let report = createCheckReport(joined);
    if (baselinePath !== undefined) {
      const baseline = await readBaselineDocument(baselinePath, readTextFile);
      report = applyBaseline(report, baseline.entries);
    }
    const standardOutput = format === 'sarif'
      ? encodeSarifLog(createSarifLog(report, producerVersion, issueFingerprint))
      : encodeCheckReport(report);
    if (updateBaselinePath !== undefined && writeTextFile !== undefined) {
      await writeBaselineDocument(
        updateBaselinePath,
        report.issues,
        now(),
        writeTextFile,
      );
    }
    return {
      standardOutput,
      standardError: '',
      exitCode: strict && report.summary.errors > 0 ? 1 : 0,
    };
  } catch (error) {
    return inputFailureResult(error) ?? baselineFailureResult(error)
      ?? internalError();
  }
}

/** check 플래그와 값·입력 경로를 분리한다. 잘못되면 undefined다. */
function parseCheckOptions(
  rest: readonly string[],
): {
  strict: boolean;
  format: CheckOutputFormat;
  baselinePath: string | undefined;
  updateBaselinePath: string | undefined;
  inputPaths: string[];
} | undefined {
  const parsed = parseCommandArguments(
    rest,
    ['--format', '--baseline', '--update-baseline'],
    ['--strict'],
  );
  if (parsed === undefined) return undefined;
  const format = parsed.valueFlags.get('--format');
  if (format !== undefined && format !== 'json' && format !== 'sarif') {
    return undefined;
  }
  const baselinePath = parsed.valueFlags.get('--baseline');
  const updateBaselinePath = parsed.valueFlags.get('--update-baseline');
  if (baselinePath !== undefined && updateBaselinePath !== undefined) {
    return undefined;
  }
  return {
    strict: parsed.booleanFlags.has('--strict'),
    format: format ?? 'json',
    baselinePath,
    updateBaselinePath,
    inputPaths: [...parsed.positionals],
  };
}

/** 베이스라인 파일을 읽고 크기 상한 안에서 검증된 문서로 파싱한다. */
async function readBaselineDocument(
  path: string,
  readTextFile: ReadTextFile,
): Promise<BaselineDocument> {
  let text: string;
  try {
    text = await readTextFile(path);
  } catch {
    throw new BridgeBaselineReadError();
  }
  if (text.length > MAX_INPUT_TEXT_LENGTH) {
    throw new BridgeBaselineLimitError();
  }
  // JSON 구문 오류와 문서 검증 실패를 같은 try로 감싸면 검증기의 예외가
  // 구문 오류로 오분류된다. 파싱과 검증을 나눠 분류 경계를 지킨다.
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    if (isJsonParseFailure(error)) throw new BridgeBaselineJsonError();
    throw error;
  }
  return parseBaselineDocument(parsed);
}

/**
 * 사용자 입력 JSON 파싱 실패인지 확인한다.
 *
 * 깊은 중첩은 SyntaxError가 아니라 RangeError(스택 초과)로 실패한다.
 * 둘 다 입력 탓이라 내부 오류 메시지로 오분류하지 않는다.
 */
function isJsonParseFailure(error: unknown): boolean {
  return error instanceof SyntaxError || error instanceof RangeError;
}

/** 현재 이슈 전체를 결정적 베이스라인 문서로 써서 해결된 항목을 정리한다. */
async function writeBaselineDocument(
  path: string,
  issues: readonly CheckIssue[],
  generatedAt: Date,
  writeTextFile: WriteTextFile,
): Promise<void> {
  let document: BaselineDocument;
  try {
    document = createBaselineDocument(issues, generatedAt.toISOString());
  } catch (error) {
    // 만들 수 없는 문서는 쓰지 않는다. 상한 초과 산출물은 다음 실행이
    // 소비할 수 없어 부분 성공보다 실패가 안전하다.
    if (error instanceof BridgeBaselineValidationError) {
      throw new BridgeBaselineWriteLimitError();
    }
    throw error;
  }
  // 인코딩 결함은 쓰기 실패가 아니라 내부 오류로 분류되어야 한다.
  const encoded = encodeBaselineDocument(document);
  try {
    await writeTextFile(path, encoded);
  } catch {
    throw new BridgeBaselineWriteError();
  }
}

/** 베이스라인 파일을 읽지 못한 경우를 구분한다. */
class BridgeBaselineReadError extends Error {
  constructor() {
    super('BridgeBaselineReadError');
    this.name = 'BridgeBaselineReadError';
  }
}

/** 베이스라인 파일이 JSON이 아닌 경우를 구분한다. */
class BridgeBaselineJsonError extends Error {
  constructor() {
    super('BridgeBaselineJsonError');
    this.name = 'BridgeBaselineJsonError';
  }
}

/** 베이스라인 파일이 크기 상한을 넘은 경우를 구분한다. */
class BridgeBaselineLimitError extends Error {
  constructor() {
    super('BridgeBaselineLimitError');
    this.name = 'BridgeBaselineLimitError';
  }
}

/** 베이스라인 파일을 쓰지 못한 경우를 구분한다. */
class BridgeBaselineWriteError extends Error {
  constructor() {
    super('BridgeBaselineWriteError');
    this.name = 'BridgeBaselineWriteError';
  }
}

/** 쓸 베이스라인이 항목 상한을 넘는 경우를 구분한다. */
class BridgeBaselineWriteLimitError extends Error {
  constructor() {
    super('BridgeBaselineWriteLimitError');
    this.name = 'BridgeBaselineWriteLimitError';
  }
}

/** check 고유의 baseline 실패를 원인별 해결 방향을 담은 코드 2로 바꾼다. */
function baselineFailureResult(error: unknown): CommandResult | undefined {
  if (error instanceof BridgeBaselineReadError) {
    return inputFailure(
      'Unable to read the baseline file; check that it exists and is readable.\n',
    );
  }
  if (error instanceof BridgeBaselineJsonError) {
    return inputFailure(
      'The baseline file is not valid JSON; regenerate it with '
      + 'check --update-baseline.\n',
    );
  }
  if (error instanceof BridgeBaselineLimitError) {
    return inputFailure(
      'The baseline file exceeds the input size limits; regenerate it with '
      + 'check --update-baseline.\n',
    );
  }
  if (error instanceof BridgeBaselineWriteError) {
    return inputFailure(
      'Unable to write the baseline file; check that the path is writable.\n',
    );
  }
  if (error instanceof BridgeBaselineWriteLimitError) {
    return inputFailure(
      `Cannot write a baseline with more than ${MAX_BASELINE_ENTRIES} entries; `
      + 'narrow the join inputs.\n',
    );
  }
  if (error instanceof BridgeBaselineValidationError) {
    return inputFailure(
      `The baseline file is not a valid isthmus-baseline document: `
      + `${error.message}\n`,
    );
  }
  return undefined;
}

/** 잘못된 CLI 호출을 경로 없는 사용법과 코드 64로 바꾼다. */
function usageError(): CommandResult {
  return {
    standardOutput: '',
    standardError: `${checkUsage}\n`,
    exitCode: 64,
  };
}

/** check 명령의 한 줄 사용법이다. */
export const checkUsage =
  'Usage: isthmus check <bridge-facts.json> <bridge-facts.json> '
  + '[more...] [--strict] [--format json|sarif] '
  + '[--baseline <isthmus-baseline.json>] '
  + '[--update-baseline <isthmus-baseline.json>]';

/** 논리 이슈 키의 SHA-256 지문이다. SARIF partialFingerprints에 쓴다. */
function issueFingerprint(issue: {
  readonly code: string;
  readonly target: string;
  readonly channel: string;
  readonly method?: string;
}): string {
  return createHash('sha256').update(baselineEntryKey(issue)).digest('hex');
}
