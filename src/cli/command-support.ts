import type { BridgeFactsDocument } from '../exchange/parse.ts';
import {
  BridgeFactsValidationError,
  parseBridgeFactsDocument,
} from '../exchange/parse.ts';
import { BridgeJoinValidationError } from '../join/join.ts';

/**
 * 모든 분석 하위 명령이 공유하는 CLI 인프라다.
 *
 * 입력 문서 읽기·예산, 입력 실패의 분류와 메시지, 프로세스 경계 결과 형태를
 * 한 곳에 모아 check-command의 편중을 떼어낸다. baseline 같은 명령 고유
 * 오류는 각 명령이 자신의 실패 매퍼를 덧붙이는 방식으로 확장한다.
 */

/** 파일 경로를 받아 UTF-8 텍스트를 읽는 주입 경계다. */
export type ReadTextFile = (path: string) => Promise<string>;

/** 파일 경로에 UTF-8 텍스트를 쓰는 주입 경계다. */
export type WriteTextFile = (path: string, text: string) => Promise<void>;

/** 생성 시각을 테스트 가능하게 주입하는 시계다. */
export type Clock = () => Date;

/** CLI가 프로세스 경계에 쓸 출력과 종료 코드다. */
export interface CommandResult {
  readonly standardOutput: string;
  readonly standardError: string;
  readonly exitCode: 0 | 1 | 2 | 64;
}

/** 한 입력 파일에서 허용하는 최대 UTF-16 문자열 길이다. */
export const MAX_INPUT_TEXT_LENGTH = 16 * 1024 * 1024;

/** 한 명령에서 허용하는 전체 UTF-16 입력 문자열 길이다. */
export const MAX_TOTAL_INPUT_TEXT_LENGTH = 64 * 1024 * 1024;

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
    // JSON 구문 오류와 문서 검증 실패를 같은 try로 감싸면 검증기의 예외가
    // 구문 오류로 오분류된다. 파싱과 검증을 나눠 분류 경계를 지킨다.
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      if (isJsonParseFailure(error)) {
        throw new BridgeInputJsonError(inputPosition);
      }
      throw error;
    }
    try {
      documents.push(parseBridgeFactsDocument(parsed));
    } catch (error) {
      if (error instanceof BridgeFactsValidationError) {
        throw new BridgeInputContractError(inputPosition, error.message);
      }
      throw error;
    }
  }
  return documents;
}

/**
 * 사용자 입력 JSON 파싱 실패인지 확인한다.
 *
 * 깊은 중첩은 SyntaxError가 아니라 RangeError(스택 초과)로 실패한다.
 * 둘 다 입력 탓이라 내부 오류 메시지로 오분류하지 않는다.
 */
export function isJsonParseFailure(error: unknown): boolean {
  return error instanceof SyntaxError || error instanceof RangeError;
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

/** 알려진 입력·조인 실패를 원인별 해결 방향을 담은 코드 2 결과로 바꾼다.

명령 고유의 입력(baseline 등)은 각 명령이 자신의 매퍼를 이 뒤에 붙인다. */
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
export function inputFailure(standardError: string): CommandResult {
  return { standardOutput: '', standardError, exitCode: 2 };
}

/**
 * 전체 조인 보류를 깨끗한 결과와 구분하는 코드 2 결과로 바꾼다.
 *
 * 관찰량을 숫자 보간으로 함께 알린다. 보류된 조인은 문서를 출력하지 않으므로,
 * 이 숫자가 "몇 개를 봤는데 못 조인했는지"가 도달하는 유일한 경로다.
 */
export function bridgeJoinDeferredError(
  observedFacts: number,
  documentCount: number,
): CommandResult {
  return {
    standardOutput: '',
    standardError:
      'Bridge facts could not be joined; split mixed bridge targets and retry. '
      + `The inputs observed ${observedFacts} facts across ${documentCount} documents.\n`,
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
