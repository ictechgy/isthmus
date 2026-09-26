import {
  createRelationResolver,
  emptyBridgeJoinResult,
  isBridgeJoinDeferred,
  joinBridgeDocuments,
  MAX_DOCUMENTS_PER_JOIN,
} from '../join/join.ts';
import { joinMessageBridges } from '../join/messages.ts';
import {
  createBridgeQuery,
  createRelationPrefixedQuery,
  encodeBridgeQuery,
  RELATION_SUBJECT_PREFIX,
} from '../report/query.ts';
import type { BridgeQueryDocument } from '../report/query.ts';
import {
  bridgeJoinDeferredError,
  inputFailureResult,
  internalError,
  readBridgeInputs,
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
  const relationRequested = requested?.startsWith(RELATION_SUBJECT_PREFIX) ?? false;
  if (
    requested === undefined ||
    requested.trim().length === 0 ||
    // 접두사만 있고 관계 이름이 비면 질의할 이름이 없는 호출 오류다.
    (relationRequested && requested.slice(RELATION_SUBJECT_PREFIX.length).trim().length === 0) ||
    inputPaths.length < 2 ||
    inputPaths.length > MAX_DOCUMENTS_PER_JOIN
  ) {
    return queryUsageError();
  }
  try {
    const { bridges, messages } = await readBridgeInputs(inputPaths, readTextFile);
    const project = bridges[0]?.project ?? messages[0]!.project;
    const joined = bridges.length > 0
      ? joinBridgeDocuments(bridges)
      : emptyBridgeJoinResult();
    if (isBridgeJoinDeferred(joined)) {
      return bridgeJoinDeferredError(joined.observedFacts, bridges.length);
    }
    const messageJoin = messages.length > 0
      ? joinMessageBridges(messages, project)
      : undefined;
    // relation 주체는 persistence 조인 규칙으로 해석한다. 같은 이름의 관계가 없으면 이전처럼
    // 요청 문자열 그대로의 bridge 키를 찾으므로 메시지 조인도 함께 넘긴다.
    const query = relationRequested
      ? createRelationPrefixedQuery(joined, createRelationResolver(bridges), requested, messageJoin)
      : createBridgeQuery(joined, requested, messageJoin);
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
  if (query.level === 'persistence') {
    return query.status === 'ambiguous'
      ? `The requested relation name matches ${query.candidates?.length ?? 0} declarations; `
        + 'repeat the query with a qualifiedName from candidates.\n'
      : 'No persistence relation matches the requested name; query a relation that the '
        + 'inputs declare or use, for example relation:schema.table.\n';
  }
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
  'Usage: isthmus query <channel-or-method|relation:<name>> <bridge-facts.json> '
  + '<bridge-facts.json> [more...]';
