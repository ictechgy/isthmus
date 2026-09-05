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
    return inputFailureResult(error) ?? internalError();
  }
}

/** 입력을 순서대로 읽어 파일 수·메모리 상한 안에서 교환 문서로 파싱한다. */
export async function readBridgeDocuments(
  inputPaths: readonly string[],
  readTextFile: ReadTextFile,
): Promise<BridgeFactsDocument[]> {
  const documents: BridgeFactsDocument[] = [];
  let totalTextLength = 0;
  for (const [index, path] of inputPaths.entries()) {
    const inputPosition = index + 1;
    let text: string;
    try {
      text = await readTextFile(path);
    } catch {
      throw new BridgeInputReadError(inputPosition);
    }
    totalTextLength += text.length;
    if (
      text.length > MAX_INPUT_TEXT_LENGTH ||
      totalTextLength > MAX_TOTAL_INPUT_TEXT_LENGTH
    ) {
      throw new BridgeInputLimitError(inputPosition);
    }
    try {
      documents.push(parseBridgeFactsDocument(JSON.parse(text)));
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new BridgeInputJsonError(inputPosition);
      }
      if (error instanceof BridgeFactsValidationError) {
        throw new BridgeInputContractError(inputPosition, error.message);
      }
      throw error;
    }
  }
  return documents;
}

/** 실패한 입력의 1부터 시작하는 순서를 보존하는 입력 오류다. */
class BridgeInputError extends Error {
  readonly inputPosition: number;

  constructor(name: string, inputPosition: number) {
    super(`${name} at input ${inputPosition}`);
    this.name = name;
    this.inputPosition = inputPosition;
  }
}

/** 입력 파일을 읽지 못한 경우를 구분한다. */
class BridgeInputReadError extends BridgeInputError {
  constructor(inputPosition: number) {
    super('BridgeInputReadError', inputPosition);
  }
}

/** 입력 텍스트가 JSON이 아닌 경우를 구분한다. */
class BridgeInputJsonError extends BridgeInputError {
  constructor(inputPosition: number) {
    super('BridgeInputJsonError', inputPosition);
  }
}

/** 입력 문서가 교환 계약을 어긴 경우와 그 이유를 구분한다. */
class BridgeInputContractError extends BridgeInputError {
  readonly reason: string;

  constructor(inputPosition: number, reason: string) {
    super('BridgeInputContractError', inputPosition);
    this.reason = reason;
  }
}

/** 입력 텍스트의 크기만 계약을 넘은 경우를 구분한다. */
class BridgeInputLimitError extends BridgeInputError {
  constructor(inputPosition: number) {
    super('BridgeInputLimitError', inputPosition);
  }
}

/** 알려진 입력·조인 실패를 원인별 해결 방향을 담은 코드 2 결과로 바꾼다. */
export function inputFailureResult(error: unknown): CommandResult | undefined {
  if (error instanceof BridgeInputReadError) {
    return inputFailure(
      `Unable to read bridge facts input ${error.inputPosition}; `
      + 'check that the file exists and is readable.\n',
    );
  }
  if (error instanceof BridgeInputJsonError) {
    return inputFailure(
      `Bridge facts input ${error.inputPosition} is not valid JSON; `
      + 'regenerate it with a bridge-facts producer.\n',
    );
  }
  if (error instanceof BridgeInputContractError) {
    return inputFailure(
      `Bridge facts input ${error.inputPosition} violates the bridge-facts `
      + `contract: ${error.reason}\n`,
    );
  }
  if (error instanceof BridgeInputLimitError) {
    return inputFailure(
      `Bridge facts input ${error.inputPosition} exceeds the input size limits; `
      + 'split the extraction into smaller documents.\n',
    );
  }
  if (error instanceof BridgeJoinValidationError) {
    return inputFailure(`${error.message}\n`);
  }
  return undefined;
}

/** 원인 메시지만 stdout 없이 코드 2로 내보낸다. */
function inputFailure(standardError: string): CommandResult {
  return { standardOutput: '', standardError, exitCode: 2 };
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
