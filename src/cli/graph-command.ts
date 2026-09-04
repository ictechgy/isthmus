import { parseBridgeFactsDocument } from '../exchange/parse.ts';
import { joinBridgeDocuments } from '../join/join.ts';
import { createBridgeGraph, renderBridgeGraph } from '../report/graph.ts';
import type { CommandResult, ReadTextFile } from './check-command.ts';

/** graph 인자를 실행해 경계 그래프와 종료 코드를 반환한다. */
export async function runGraphCommand(
  arguments_: readonly string[],
  readTextFile: ReadTextFile,
): Promise<CommandResult> {
  const options = parseGraphArguments(arguments_);
  if (options === undefined) return graphUsageError();
  try {
    const texts = await Promise.all(options.inputPaths.map(readTextFile));
    const documents = texts.map((text) =>
      parseBridgeFactsDocument(JSON.parse(text)),
    );
    const graph = createBridgeGraph(joinBridgeDocuments(documents));
    return {
      standardOutput: renderBridgeGraph(graph, options.format),
      standardError: '',
      exitCode: 0,
    };
  } catch {
    return graphInputError();
  }
}

/** graph의 입력 파일과 선택 출력 형식을 검증한다. */
function parseGraphArguments(arguments_: readonly string[]): GraphOptions | undefined {
  if (arguments_[0] !== 'graph') return undefined;
  const formatIndex = arguments_.indexOf('--format');
  const inputPaths = arguments_.slice(1, formatIndex < 0 ? undefined : formatIndex);
  if (inputPaths.length < 2 || inputPaths.some((path) => path.startsWith('-'))) {
    return undefined;
  }
  if (formatIndex < 0) return { inputPaths, format: 'json' };
  if (formatIndex !== arguments_.length - 2) return undefined;
  const format = arguments_[formatIndex + 1];
  return isGraphFormat(format) ? { inputPaths, format } : undefined;
}

/** 지원하는 그래프 형식인지 확인한다. */
function isGraphFormat(value: string | undefined): value is GraphFormat {
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

/** graph 입력 실패를 경로 없는 코드 2로 바꾼다. */
function graphInputError(): CommandResult {
  return {
    standardOutput: '',
    standardError:
      'Unable to read or validate bridge facts; check the input files.\n',
    exitCode: 2,
  };
}

/** 검증된 graph 명령 옵션이다. */
interface GraphOptions {
  readonly inputPaths: readonly string[];
  readonly format: GraphFormat;
}

type GraphFormat = 'json' | 'dot' | 'mermaid';

const graphUsage =
  'Usage: isthmus graph <bridge-facts.json> <bridge-facts.json> '
  + '[more...] [--format json|dot|mermaid]';
