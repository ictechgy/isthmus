import {
  isBridgeJoinDeferred,
  joinBridgeDocuments,
  MAX_DOCUMENTS_PER_JOIN,
} from '../join/join.ts';
import {
  BridgeGraphLimitError,
  BridgeGraphValidationError,
  createBridgeGraph,
  renderBridgeGraph,
} from '../report/graph.ts';
import {
  bridgeJoinDeferredError,
  inputFailureResult,
  internalError,
  readBridgeDocuments,
  type CommandResult,
  type ReadTextFile,
} from './command-support.ts';
import { parseCommandArguments } from './parse-arguments.ts';

/** graph 인자를 실행해 경계 그래프와 종료 코드를 반환한다. */
export async function runGraphCommand(
  arguments_: readonly string[],
  readTextFile: ReadTextFile,
): Promise<CommandResult> {
  const options = parseGraphArguments(arguments_);
  if (options === undefined) return graphUsageError();
  try {
    const documents = await readBridgeDocuments(options.inputPaths, readTextFile);
    const joined = joinBridgeDocuments(documents);
    if (isBridgeJoinDeferred(joined)) {
      return bridgeJoinDeferredError(joined.observedFacts, documents.length);
    }
    const graph = createBridgeGraph(joined);
    return {
      standardOutput: renderBridgeGraph(graph, options.format),
      standardError: '',
      exitCode: 0,
    };
  } catch (error) {
    if (
      error instanceof BridgeGraphLimitError ||
      error instanceof BridgeGraphValidationError
    ) {
      return {
        standardOutput: '',
        standardError: `${error.message}\n`,
        exitCode: 2,
      };
    }
    return inputFailureResult(error) ?? internalError();
  }
}

/** graph의 입력 파일과 선택 출력 형식을 검증한다. 플래그는 어디에 와도 된다. */
function parseGraphArguments(arguments_: readonly string[]): GraphOptions | undefined {
  if (arguments_[0] !== 'graph') return undefined;
  const parsed = parseCommandArguments(arguments_.slice(1), ['--format'], []);
  if (parsed === undefined) return undefined;
  const format = parsed.valueFlags.get('--format');
  if (format !== undefined && !isGraphFormat(format)) return undefined;
  const inputPaths = [...parsed.positionals];
  if (
    inputPaths.length < 2 ||
    inputPaths.length > MAX_DOCUMENTS_PER_JOIN
  ) {
    return undefined;
  }
  return { inputPaths, format: format ?? 'json' };
}

/** 지원하는 그래프 형식인지 확인한다. */
function isGraphFormat(value: string): value is GraphFormat {
  return value === 'json' || value === 'dot' || value === 'mermaid';
}

/** graph 사용 오류를 경로 없는 코드 64로 바꾼다. */
function graphUsageError(): CommandResult {
  return {
    standardOutput: '',
    standardError: `${graphUsage}\n`,
    exitCode: 64,
  };
}

/** 검증된 graph 명령 옵션이다. */
interface GraphOptions {
  readonly inputPaths: readonly string[];
  readonly format: GraphFormat;
}

type GraphFormat = 'json' | 'dot' | 'mermaid';

/** graph 명령의 한 줄 사용법이다. */
export const graphUsage =
  'Usage: isthmus graph <bridge-facts.json> <bridge-facts.json> '
  + '[more...] [--format json|dot|mermaid]';
