import {
  isBridgeJoinDeferred,
  joinBridgeDocuments,
  MAX_DOCUMENTS_PER_JOIN,
} from '../join/join.ts';
import { createBridgeQuery, encodeBridgeQuery } from '../report/query.ts';
import type { BridgeQueryDocument } from '../report/query.ts';
import {
  bridgeJoinDeferredError,
  inputFailureResult,
  internalError,
  readBridgeDocuments,
  type CommandResult,
  type ReadTextFile,
} from './command-support.ts';
import { parseCommandArguments } from './parse-arguments.ts';

/** query 인자를 실행해 bridge 질의 JSON과 종료 코드를 반환한다. */
export async function runQueryCommand(
  arguments_: readonly string[],
  readTextFile: ReadTextFile,
): Promise<CommandResult> {
  const parsed = parseCommandArguments(arguments_.slice(1), [], []);
  if (parsed === undefined) return queryUsageError();
  const requested = parsed.positionals[0];
  const inputPaths = parsed.positionals.slice(1);
  if (
    requested === undefined ||
    requested.trim().length === 0 ||
    inputPaths.length < 2 ||
    inputPaths.length > MAX_DOCUMENTS_PER_JOIN
  ) {
    return queryUsageError();
  }
  try {
    const documents = await readBridgeDocuments(inputPaths, readTextFile);
    const joined = joinBridgeDocuments(documents);
    if (isBridgeJoinDeferred(joined)) {
      return bridgeJoinDeferredError(joined.observedFacts, documents.length);
    }
    const query = createBridgeQuery(joined, requested);
    return {
      standardOutput: encodeBridgeQuery(query),
      standardError: queryStatusHint(query),
      exitCode: query.status === 'found' ? 0 : 64,
    };
  } catch (error) {
    return inputFailureResult(error) ?? internalError();
  }
}

/**
 * 찾지 못한 질의에 원인을 한 줄로 알린다.
 *
 * 문서 자체는 stdout JSON이 이미 다 담고 있으므로, 사람이 종료 코드만 봐도
 * "인수가 잘못됐는지"와 "이름이 없는지"를 구분할 수 있게 하는 보조 문구다.
 * 정적 문자열과 숫자만 보간한다.
 */
function queryStatusHint(query: BridgeQueryDocument): string {
  if (query.status === 'found') return '';
  if (query.status === 'ambiguous') {
    return `The requested name matches ${query.candidates?.length ?? 0} bridge keys; `
      + 'repeat the query with a qualifiedName from candidates.\n';
  }
  return 'No bridge channel or method matches the requested name; '
    + 'query a channel or method name that the inputs observed.\n';
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
