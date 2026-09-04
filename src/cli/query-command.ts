import { parseBridgeFactsDocument } from '../exchange/parse.ts';
import { joinBridgeDocuments } from '../join/join.ts';
import { createBridgeQuery, encodeBridgeQuery } from '../report/query.ts';
import type { CommandResult, ReadTextFile } from './check-command.ts';

/** query 인자를 실행해 bridge 질의 JSON과 종료 코드를 반환한다. */
export async function runQueryCommand(
  arguments_: readonly string[],
  readTextFile: ReadTextFile,
): Promise<CommandResult> {
  const requested = arguments_[1];
  const inputPaths = arguments_.slice(2);
  if (
    arguments_[0] !== 'query' ||
    requested === undefined ||
    requested.trim().length === 0 ||
    inputPaths.length < 2 ||
    inputPaths.some((path) => path.startsWith('-'))
  ) {
    return queryUsageError();
  }
  try {
    const texts = await Promise.all(inputPaths.map(readTextFile));
    const documents = texts.map((text) =>
      parseBridgeFactsDocument(JSON.parse(text)),
    );
    const query = createBridgeQuery(joinBridgeDocuments(documents), requested);
    return {
      standardOutput: encodeBridgeQuery(query),
      standardError: '',
      exitCode: query.status === 'found' ? 0 : 64,
    };
  } catch {
    return queryInputError();
  }
}

/** 입력 실패를 경로 없는 도구 실패 2로 바꾼다. */
function queryInputError(): CommandResult {
  return {
    standardOutput: '',
    standardError:
      'Unable to read or validate bridge facts; check the input files.\n',
    exitCode: 2,
  };
}

/** 잘못된 query 호출을 사용법과 코드 64로 바꾼다. */
function queryUsageError(): CommandResult {
  return {
    standardOutput: '',
    standardError: `${queryUsage}\n`,
    exitCode: 64,
  };
}

const queryUsage =
  'Usage: isthmus query <channel-or-method> <bridge-facts.json> '
  + '<bridge-facts.json> [more...]';
