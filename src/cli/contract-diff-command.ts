import { createHash } from 'node:crypto';
import { createContractDiff } from '../report/contract-diff.ts';
import { encodeSortedJson } from '../report/sorted-json.ts';
import { inputFailureResult, internalError, readBridgeDocuments, type CommandResult, type ReadTextFile } from './command-support.ts';
import { parseHttpDiffArguments } from './http-diff-command.ts';

/** 기존 bridge/http diff의 의미를 바꾸지 않는 명시 계약 비교 모드다. */
export const contractDiffUsage = 'Usage: isthmus diff --contracts --before <declarations.json...> --after <declarations.json...> '
  + '[--clients <clients.json...>] [--limit <1..1000>] [--strict] [--compact]';

/** CLI/MCP가 같은 입력 예산과 내용 신원, 한계, 출력 상한을 사용한다. */
export async function runContractDiffCommand(args: readonly string[], readTextFile: ReadTextFile): Promise<CommandResult> {
  const values = [...args];
  const limitIndex = values.indexOf('--limit');
  const rawLimit = limitIndex < 0 ? '100' : values[limitIndex + 1];
  const limit = rawLimit !== undefined && /^[1-9]\d{0,3}$/.test(rawLimit) ? Number(rawLimit) : 0;
  if (limitIndex >= 0) values.splice(limitIndex, 2);
  const parsed = values[1] !== '--contracts' || values.includes('--fail-on') || limit < 1 || limit > 1000 ? undefined
    : parseHttpDiffArguments(['diff', '--http', ...values.slice(2)]);
  if (parsed === undefined) return { standardOutput: '', standardError: `${contractDiffUsage}\n`, exitCode: 64 };
  try {
    const paths = [...parsed.before, ...parsed.after, ...(parsed.clients ?? [])];
    const inputTextSha256: string[] = [];
    const documents = await readBridgeDocuments(paths, async (path, maximum) => {
      const text = await readTextFile(path, maximum);
      inputTextSha256.push(createHash('sha256').update(text, 'utf8').digest('hex'));
      return text;
    });
    const split = parsed.before.length + parsed.after.length;
    const report = createContractDiff(documents.slice(0, parsed.before.length), documents.slice(parsed.before.length, split),
      documents.slice(split), limit);
    return { standardOutput: encodeSortedJson({ ...report, provenance: { inputTextSha256,
      order: 'before-then-after-then-clients', sourceBuildAlignment: 'unknown' } }, parsed.compact), standardError: '',
    exitCode: values.includes('--strict') && (report.summary.total > 0 || report.limitations.contracts.length > 0 ||
      report.scope.unresolvedCallerBindings.before + report.scope.unresolvedCallerBindings.after > 0 ||
      report.limitations.before.length + report.limitations.after.length + report.limitations.clients.length +
      report.limitations.joins.before.length + report.limitations.joins.after.length > 0) ? 1 : 0 };
  } catch (error) { return inputFailureResult(error) ?? internalError(); }
}
