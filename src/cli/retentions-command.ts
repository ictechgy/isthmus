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
  internalError,
  inputFailureResult,
  readBridgeDocuments,
  type CommandResult,
  type ReadTextFile,
} from './check-command.ts';

/** 생성 시각을 테스트 가능하게 주입하는 시계다. */
export type Clock = () => Date;

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
    if (isBridgeJoinDeferred(joined)) return bridgeJoinDeferredError();
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
  const forIndex = arguments_.indexOf('--for');
  if (arguments_[0] !== 'retentions' || forIndex < 3) return undefined;
  if (forIndex !== arguments_.length - 2) return undefined;
  if (arguments_[forIndex + 1] !== 'cartograph') return undefined;
  const paths = arguments_.slice(1, forIndex);
  return paths.length > MAX_DOCUMENTS_PER_JOIN ||
    paths.some((path) => path.startsWith('-'))
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
