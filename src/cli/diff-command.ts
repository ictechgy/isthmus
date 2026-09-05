import { MAX_DOCUMENTS_PER_JOIN } from '../join/join.ts';
import { createBridgeDiff } from '../report/diff.ts';
import { encodeSortedJson } from '../report/sorted-json.ts';
import {
  internalError,
  inputFailureResult,
  readBridgeDocuments,
  type CommandResult,
  type ReadTextFile,
} from './check-command.ts';

/** 전후 교환 파일을 하나의 입력 예산으로 읽어 새 경계 오류만 CI 실패로 표시한다. */
export async function runDiffCommand(
  arguments_: readonly string[],
  readTextFile: ReadTextFile,
): Promise<CommandResult> {
  const strictFlags = arguments_.filter((argument) => argument === '--strict');
  const args = arguments_.filter((argument) => argument !== '--strict');
  const separator = args.indexOf('--after');
  const beforePaths = args.slice(2, separator);
  const afterPaths = args.slice(separator + 1);
  const paths = [...beforePaths, ...afterPaths];
  if (
    args[0] !== 'diff' ||
    args[1] !== '--before' ||
    strictFlags.length > 1 ||
    separator < 4 ||
    beforePaths.length < 2 ||
    afterPaths.length < 2 ||
    paths.length > MAX_DOCUMENTS_PER_JOIN ||
    paths.some((path) => path.trim().length === 0 || path.startsWith('-'))
  ) {
    return { standardOutput: '', standardError: `${diffUsage}\n`, exitCode: 64 };
  }
  try {
    const documents = await readBridgeDocuments(paths, readTextFile);
    const report = createBridgeDiff(
      documents.slice(0, beforePaths.length),
      documents.slice(beforePaths.length),
    );
    return {
      standardOutput: encodeSortedJson(report),
      standardError: '',
      exitCode: strictFlags.length === 1 && report.summary.introducedErrors > 0 ? 1 : 0,
    };
  } catch (error) {
    return inputFailureResult(error) ?? internalError();
  }
}

/** 각 snapshot은 caller와 receiver 문서를 함께 제공해야 한다. */
export const diffUsage =
  'Usage: isthmus diff --before <dart.json> <swift.json> [more...] '
  + '--after <dart.json> <swift.json> [more...] [--strict]';
