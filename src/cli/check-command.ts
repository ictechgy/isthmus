import {
  BridgeFactsValidationError,
  parseBridgeFactsDocument,
  type BridgeFactsDocument,
} from '../exchange/parse.ts';
import {
  BridgeJoinValidationError,
  isBridgeJoinDeferred,
  joinBridgeDocuments,
  MAX_DOCUMENTS_PER_JOIN,
} from '../join/join.ts';
import { createCheckReport, encodeCheckReport } from '../report/check-report.ts';

/** 파일 경로를 받아 UTF-8 텍스트를 읽는 주입 경계다. */
export type ReadTextFile = (path: string) => Promise<string>;

/** 한 입력 파일에서 허용하는 최대 UTF-16 문자열 길이다. */
export const MAX_INPUT_TEXT_LENGTH = 16 * 1024 * 1024;

/** 한 명령에서 허용하는 전체 UTF-16 입력 문자열 길이다. */
export const MAX_TOTAL_INPUT_TEXT_LENGTH = 64 * 1024 * 1024;

/** CLI가 프로세스 경계에 쓸 출력과 종료 코드다. */
export interface CommandResult {
  readonly standardOutput: string;
  readonly standardError: string;
  readonly exitCode: 0 | 1 | 2 | 64;
}

/** check 인자를 실행해 프로세스에 독립적인 결과를 반환한다. */
export async function runCheckCommand(
  arguments_: readonly string[],
  readTextFile: ReadTextFile,
): Promise<CommandResult> {
  if (arguments_[0] !== 'check') return usageError();
  const options = arguments_.slice(1).filter((argument) => argument.startsWith('-'));
  if (options.some((option) => option !== '--strict')) return usageError();
  const isStrict = arguments_.includes('--strict');
  const inputPaths = arguments_.slice(1).filter((argument) => argument !== '--strict');
  if (inputPaths.length < 2 || inputPaths.length > MAX_DOCUMENTS_PER_JOIN) {
    return usageError();
  }
  try {
    const documents = await readBridgeDocuments(inputPaths, readTextFile);
    const joined = joinBridgeDocuments(documents);
    if (isBridgeJoinDeferred(joined)) return bridgeJoinDeferredError();
    const report = createCheckReport(joined);
    return {
      standardOutput: encodeCheckReport(report),
      standardError: '',
      exitCode: isStrict && report.summary.errors > 0 ? 1 : 0,
    };
  } catch (error) {
    return isExpectedInputError(error) ? inputError() : internalError();
  }
}

/** 입력을 순서대로 읽어 파일 수·메모리 상한 안에서 교환 문서로 파싱한다. */
export async function readBridgeDocuments(
  inputPaths: readonly string[],
  readTextFile: ReadTextFile,
): Promise<BridgeFactsDocument[]> {
  const documents: BridgeFactsDocument[] = [];
  let totalTextLength = 0;
  for (const path of inputPaths) {
    let text: string;
    try {
      text = await readTextFile(path);
    } catch {
      throw new BridgeInputError();
    }
    totalTextLength += text.length;
    if (
      text.length > MAX_INPUT_TEXT_LENGTH ||
      totalTextLength > MAX_TOTAL_INPUT_TEXT_LENGTH
    ) {
      throw new BridgeInputLimitError();
    }
    try {
      documents.push(parseBridgeFactsDocument(JSON.parse(text)));
    } catch (error) {
      if (
        error instanceof SyntaxError ||
        error instanceof BridgeFactsValidationError
      ) {
        throw new BridgeInputError();
      }
      throw error;
    }
  }
  return documents;
}

/** 입력 텍스트가 CLI 메모리 예산을 넘었음을 나타낸다. */
class BridgeInputError extends Error {}

/** 입력 텍스트의 크기만 계약을 넘은 경우를 구분한다. */
class BridgeInputLimitError extends BridgeInputError {}

/** 외부 입력에서 기대하는 실패 종류인지 확인한다. */
export function isExpectedInputError(error: unknown): boolean {
  return error instanceof BridgeInputError || error instanceof BridgeJoinValidationError;
}

/** 전체 조인 보류를 깨끗한 결과와 구분하는 코드 2 결과로 바꾼다. */
export function bridgeJoinDeferredError(): CommandResult {
  return {
    standardOutput: '',
    standardError:
      'Bridge facts could not be joined; split mixed bridge targets and retry.\n',
    exitCode: 2,
  };
}

/** 파일·JSON·계약 오류를 민감정보 없는 코드 2 결과로 바꾼다. */
function inputError(): CommandResult {
  return {
    standardOutput: '',
    standardError:
      'Unable to read or validate bridge facts; check the input files.\n',
    exitCode: 2,
  };
}

/** 내부 결함을 입력 탓으로 돌리지 않는 경로 없는 코드 2 결과다. */
export function internalError(): CommandResult {
  return {
    standardOutput: '',
    standardError: 'Internal isthmus error; retry with a current version.\n',
    exitCode: 2,
  };
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
  + '[more...] [--strict]';
