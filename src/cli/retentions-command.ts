import {
  isBridgeJoinDeferred,
  joinBridgeDocuments,
  MAX_DOCUMENTS_PER_JOIN,
} from '../join/join.ts';
import {
  createCartographRetentionsDocument,
  encodeCartographRetentionsDocument,
  RetentionValidationError,
  validateCartographRetentionInputs,
} from '../report/retentions.ts';
import {
  bridgeJoinDeferredError,
  inputFailureResult,
  internalError,
  readBridgeDocuments,
  type Clock,
  type CommandResult,
  type ReadTextFile,
} from './command-support.ts';
import { parseCommandArguments } from './parse-arguments.ts';

export type { Clock };

/** retentions 인자를 실행해 cartograph용 보존 문서를 반환한다. */
export async function runRetentionsCommand(
  arguments_: readonly string[],
  readTextFile: ReadTextFile,
  now: Clock,
  producerVersion: string,
): Promise<CommandResult> {
  const inputPaths = retentionInputPaths(arguments_);
  if (inputPaths === undefined) return retentionUsageError();
  try {
    const documents = await readBridgeDocuments(inputPaths, readTextFile);
    const joined = joinBridgeDocuments(documents);
    if (isBridgeJoinDeferred(joined)) {
      return bridgeJoinDeferredError(joined.observedFacts, documents.length);
    }
    validateCartographRetentionInputs(documents);
    const retentions = createCartographRetentionsDocument(
      joined,
      now().toISOString(),
      producerVersion,
    );
    return {
      standardOutput: encodeCartographRetentionsDocument(retentions),
      standardError: '',
      exitCode: 0,
    };
  } catch (error) {
    if (error instanceof RetentionValidationError) {
      return {
        standardOutput: '',
        standardError: `${error.message}\n`,
        exitCode: 2,
      };
    }
    return inputFailureResult(error) ?? internalError();
  }
}

/** 지원 대상과 최소 입력 수를 검증해 파일 경로만 돌려준다. */
function retentionInputPaths(arguments_: readonly string[]): string[] | undefined {
  if (arguments_[0] !== 'retentions') return undefined;
  const parsed = parseCommandArguments(arguments_.slice(1), ['--for'], []);
  if (parsed === undefined) return undefined;
  if (parsed.valueFlags.get('--for') !== 'cartograph') return undefined;
  const paths = [...parsed.positionals];
  return paths.length < 2 || paths.length > MAX_DOCUMENTS_PER_JOIN
    ? undefined
    : paths;
}

/** 잘못된 retentions 호출을 사용법과 코드 64로 바꾼다. */
function retentionUsageError(): CommandResult {
  return {
    standardOutput: '',
    standardError: `${retentionUsage}\n`,
    exitCode: 64,
  };
}

/** retentions 명령의 한 줄 사용법이다. */
export const retentionUsage =
  'Usage: isthmus retentions <bridge-facts.json> <bridge-facts.json> '
  + '[more...] --for cartograph';
