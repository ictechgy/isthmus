/** 파일 경로를 받아 UTF-8 텍스트를 읽는 주입 경계다. */
export type ReadTextFile = (path: string) => Promise<string>;

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
  if (inputPaths.length < 2) return usageError();
  try {
    const texts = await Promise.all(inputPaths.map(readTextFile));
    const documents = texts.map((text) =>
      parseBridgeFactsDocument(JSON.parse(text)),
    );
    const report = createCheckReport(joinBridgeDocuments(documents));
    return {
      standardOutput: encodeCheckReport(report),
      standardError: '',
      exitCode: isStrict && report.summary.errors > 0 ? 1 : 0,
    };
  } catch {
    return inputError();
  }
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

/** 잘못된 CLI 호출을 경로 없는 사용법과 코드 64로 바꾼다. */
function usageError(): CommandResult {
  return {
    standardOutput: '',
    standardError: `${usage}\n`,
    exitCode: 64,
  };
}

const usage =
  'Usage: isthmus check <bridge-facts.json> <bridge-facts.json> '
  + '[more...] [--strict]';
import { parseBridgeFactsDocument } from '../exchange/parse.ts';
import { joinBridgeDocuments } from '../join/join.ts';
import { createCheckReport, encodeCheckReport } from '../report/check-report.ts';
