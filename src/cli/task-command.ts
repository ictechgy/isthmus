import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';

import { parseBridgeFactsDocument } from '../exchange/parse.ts';
import { parseTraceContext } from '../exchange/trace-context.ts';
import { parseEvidenceManifest, parseTaskValidation, TaskEvidenceError } from '../exchange/task-evidence.ts';
import type { EvidenceArtifact, EvidenceManifest, EvidenceRole } from '../exchange/task-evidence.ts';
import { isBridgeJoinDeferred, joinBridgeDocuments } from '../join/join.ts';
import { createCheckReport } from '../report/check-report.ts';
import { compareTaskEvidence } from '../report/task-evidence.ts';
import type { EvidenceObservation } from '../report/task-evidence.ts';
import { createTaskReport } from '../report/task.ts';
import type { TaskValidationInput } from '../report/task.ts';
import type { TraceReport } from '../report/trace.ts';
import { encodeSortedJson } from '../report/sorted-json.ts';
import { inputFailure, internalError, isJsonParseFailure, MAX_INPUT_TEXT_LENGTH, MAX_TOTAL_INPUT_TEXT_LENGTH, readContextInput } from './command-support.ts';
import type { CommandResult, ReadTextFile } from './command-support.ts';
import { parseCommandArguments } from './parse-arguments.ts';
import { runTraceCommand } from './trace-command.ts';

/** 선택적 manifest와 기존 trace/check를 조립하는 읽기 전용 단일 project 인터페이스다. */
export async function runTaskCommand(arguments_: readonly string[], readTextFile: ReadTextFile): Promise<CommandResult> {
  const options = parseCommandArguments(arguments_.slice(1), ['--evidence', '--limit'], ['--strict', '--compact']);
  const limitText = options?.valueFlags.get('--limit');
  const limit = limitText === undefined ? 20 : Number(limitText);
  if (arguments_[0] !== 'task' || options === undefined || options.positionals.length !== 1 ||
    (limitText !== undefined && !/^[0-9]+$/u.test(limitText)) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    return { standardOutput: '', standardError: `${taskUsage}\n`, exitCode: 64 };
  }
  const contextPath = resolve(options.positionals[0]!);
  const cache = new Map<string, string>();
  let total = 0;
  const read: ReadTextFile = async (path, maximum = MAX_INPUT_TEXT_LENGTH) => {
    const key = pathKey(path);
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const text = await readTextFile(resolve(path), Math.min(maximum, MAX_INPUT_TEXT_LENGTH));
    total += text.length;
    if (text.length > Math.min(maximum, MAX_INPUT_TEXT_LENGTH) || total > MAX_TOTAL_INPUT_TEXT_LENGTH) {
      throw new TaskEvidenceError('Task inputs exceed the size limits; split the capture.');
    }
    cache.set(key, text);
    return text;
  };
  const traceResult = await runTraceCommand(['trace', contextPath, '--compact'], read);
  if (traceResult.exitCode !== 0) return traceResult;
  try {
    // trace가 이미 검증한 같은 바이트만 사용한다. 별도 판독으로 입력 경합을 만들지 않는다.
    const context = parseTraceContext(JSON.parse(cache.get(pathKey(contextPath))!));
    if (context.workspace !== undefined) return inputFailure('Task v1 supports single-project trace contexts; use trace for workspace inputs.\n');
    const descriptions: Array<{ path: string; role: EvidenceRole }> = [
      { path: contextPath, role: 'trace-context' },
      ...context.documents.map((path) => ({ path: resolve(dirname(contextPath), path), role: 'bridge-facts' as const })),
      ...context.analyses.map(({ path }) => ({ path: resolve(dirname(contextPath), path), role: 'traversal' as const })),
    ];
    const evidencePath = options.valueFlags.get('--evidence');
    let manifest: EvidenceManifest | undefined;
    const entries = new Map<string, EvidenceArtifact>();
    const validations: TaskValidationInput[] = [];
    if (evidencePath !== undefined) {
      const input = await readContextInput(evidencePath, read, MAX_INPUT_TEXT_LENGTH, {
        unreadable: 'Unable to read task evidence; check that the manifest exists and is readable.\n',
        invalidJson: 'Task evidence is not valid JSON.\n', tooLarge: 'Task evidence exceeds the size limits.\n',
      });
      if ('failure' in input) return input.failure;
      manifest = parseEvidenceManifest(input.value);
      for (const entry of manifest.artifacts) {
        const path = resolve(dirname(resolve(evidencePath)), entry.path);
        const key = pathKey(path);
        if (entries.has(key)) throw new TaskEvidenceError('Evidence artifact paths must be unique after path resolution.');
        entries.set(key, entry);
        if (entry.role === 'validation') {
          let text: string;
          try { text = await read(path, MAX_INPUT_TEXT_LENGTH); }
          catch (error) {
            if (error instanceof TaskEvidenceError) throw error;
            throw new TaskEvidenceError('Unable to read a validation input; check the selected artifact.');
          }
          const value: unknown = JSON.parse(text);
          validations.push({ artifact: `artifact:${entry.id}`, validation: parseTaskValidation(value) });
          descriptions.push({ path, role: 'validation' });
        }
      }
    }
    const observed = new Set<string>();
    const observations: EvidenceObservation[] = descriptions.map(({ path, role }, index) => {
      const key = pathKey(path);
      observed.add(key);
      const text = cache.get(key)!;
      const raw = JSON.parse(text);
      const artifact = entries.get(key);
      return { id: artifact === undefined ? `input:${index + 1}` : `artifact:${artifact.id}`, role,
        sha256: createHash('sha256').update(text, 'utf8').digest('hex'),
        ...(artifact === undefined ? {} : { artifact }),
        ...(raw.tool === undefined ? {} : { producer: raw.tool }),
        ...(typeof raw.revision !== 'string' ? {} : { revision: raw.revision }) };
    });
    const evidence = compareTaskEvidence(manifest, observations,
      [...entries].filter(([path]) => !observed.has(path)).map(([, entry]) => entry));
    const documents = context.documents.map((path) =>
      parseBridgeFactsDocument(JSON.parse(cache.get(pathKey(resolve(dirname(contextPath), path)))!)));
    const joined = joinBridgeDocuments(documents);
    if (isBridgeJoinDeferred(joined)) return inputFailure('Task bridge facts could not be joined; split mixed targets and retry.\n');
    const report = createTaskReport(JSON.parse(traceResult.standardOutput) as TraceReport, createCheckReport(joined), evidence,
      validations, limit);
    const blocked = options.booleanFlags.has('--strict') && report.requiresReview;
    return { standardOutput: encodeSortedJson(report, options.booleanFlags.has('--compact')),
      standardError: blocked ? 'Task evidence requires review; inspect unknowns and recorded outcomes.\n' : '', exitCode: blocked ? 1 : 0 };
  } catch (error) {
    if (error instanceof TaskEvidenceError) return inputFailure(`Task evidence violates its contract: ${error.message}\n`);
    if (isJsonParseFailure(error)) return inputFailure('Task validation is not valid JSON; regenerate the selected validation input.\n');
    return internalError();
  }
}

function pathKey(path: string): string {
  const absolute = resolve(path);
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
}

/** 기존 명령과 독립적인 실험적 v1 사용법이다. */
export const taskUsage = 'Usage: isthmus task <trace-context.json> [--evidence <manifest.json>] [--limit <1..100>] [--strict] [--compact]';
