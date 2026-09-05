import {
  isBridgeJoinDeferred,
  joinBridgeDocuments,
  MAX_DOCUMENTS_PER_JOIN,
} from '../join/join.ts';
import { createBridgeQuery, encodeBridgeQuery } from '../report/query.ts';
import {
  bridgeJoinDeferredError,
  internalError,
  inputFailureResult,
  readBridgeDocuments,
  type CommandResult,
  type ReadTextFile,
} from './check-command.ts';

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
    inputPaths.length > MAX_DOCUMENTS_PER_JOIN ||
    inputPaths.some((path) => path.startsWith('-'))
  ) {
    return queryUsageError();
  }
  try {
    const documents = await readBridgeDocuments(inputPaths, readTextFile);
    const joined = joinBridgeDocuments(documents);
    if (isBridgeJoinDeferred(joined)) return bridgeJoinDeferredError();
    const query = createBridgeQuery(joined, requested);
    return {
      standardOutput: encodeBridgeQuery(query),
      standardError: '',
      exitCode: query.status === 'found' ? 0 : 64,
    };
  } catch (error) {
    return inputFailureResult(error) ?? internalError();
  }
}

/** 잘못된 query 호출을 사용법과 코드 64로 바꾼다. */
function queryUsageError(): CommandResult {
  return {
    standardOutput: '',
    standardError: `${queryUsage}\n`,
    exitCode: 64,
  };
}

/** query 명령의 한 줄 사용법이다. */
export const queryUsage =
  'Usage: isthmus query <channel-or-method> <bridge-facts.json> '
  + '<bridge-facts.json> [more...]';
