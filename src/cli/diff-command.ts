import { MAX_DOCUMENTS_PER_JOIN } from '../join/join.ts';
import { createBridgeDiff } from '../report/diff.ts';
import { encodeSortedJson } from '../report/sorted-json.ts';
import {
  inputFailureResult,
  internalError,
  readBridgeInputs,
  type CommandResult,
  type ReadTextFile,
} from './command-support.ts';
import { httpDiffUsage, runHttpDiffCommand } from './http-diff-command.ts';

/**
 * 전후 교환 파일을 하나의 입력 예산으로 읽어 새 경계 오류만 CI 실패로 표시한다.
 *
 * `diff` 바로 다음 인수가 `--http`면 http route 표면 비교(`runHttpDiffCommand`)로 넘긴다. 위치를 고정해 경로 목록
 * 안의 문자열이 모드를 바꾸지 못하게 한다(MCP `diff`는 `--before`부터 넘기므로 항상 bridge 비교다).
 */
export async function runDiffCommand(
  arguments_: readonly string[],
  readTextFile: ReadTextFile,
): Promise<CommandResult> {
  if (arguments_[1] === '--http') return runHttpDiffCommand(arguments_, readTextFile);
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
    const before = await readBridgeInputs(beforePaths, readTextFile);
    const after = await readBridgeInputs(afterPaths, readTextFile);
    const report = createBridgeDiff(
      before.bridges,
      after.bridges,
      before.messages.length > 0 ? before.messages : undefined,
      after.messages.length > 0 ? after.messages : undefined,
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

/** 각 bridge snapshot은 caller와 receiver 문서를 함께 제공해야 한다. http 비교는 둘째 줄이다. */
export const diffUsage =
  'Usage: isthmus diff --before <dart.json> <swift.json> [more...] '
  + '--after <dart.json> <swift.json> [more...] [--strict]\n'
  + httpDiffUsage.replace('Usage: ', '       ');
