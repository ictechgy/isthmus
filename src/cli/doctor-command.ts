import { isAbsolute, join, resolve } from 'node:path';

import { CaptureConfigValidationError, validateCaptureConfig } from '../exchange/capture-config.ts';
import { isJsonObject, isSafeNonEmptyString } from '../exchange/parse.ts';
import { encodeSortedJson } from '../report/sorted-json.ts';
import {
  inputFailure,
  isJsonParseFailure,
  MAX_INPUT_TEXT_LENGTH,
  type CaptureFileSystem,
  type CommandResult,
  type ReadTextFile,
} from './command-support.ts';

/** doctor가 확인한 명령 하나의 결과다. */
interface DoctorCheck {
  readonly name: string;
  readonly status: 'ok' | 'missing';
  readonly command: readonly string[];
  readonly resolved?: string;
}

/** doctor가 내는 기계 판독 보고서다. */
interface DoctorReport {
  readonly format: 'isthmus-doctor';
  readonly version: 1;
  readonly status: 'ok' | 'incomplete';
  readonly project: string;
  readonly checks: readonly DoctorCheck[];
}

/**
 * capture 설정 JSON을 검증하고 참조한 실행 파일이 실제로 있는지 확인한다.
 *
 * producer를 실행하거나 버전을 묻지 않는다 — 제품은 JSON만 읽는다. 여기서
 * 확인하는 것은 `scripts/capture-preflight.mjs`가 실행할 명령의 첫 토큰이
 * 존재하는 파일(또는 PATH 위의 실행 파일)인지뿐이다.
 */
export async function runDoctorCommand(
  arguments_: readonly string[],
  readTextFile: ReadTextFile,
  fileSystem: CaptureFileSystem,
  cwd: string,
  pathValue: string = '',
): Promise<CommandResult> {
  if (arguments_[0] !== 'doctor') return usageError();
  const rest = arguments_.slice(1);
  if (rest.length !== 1 || rest[0]!.startsWith('--')) return usageError();
  const configPath = rest[0]!;

  let text: string;
  try {
    text = await readTextFile(configPath);
  } catch {
    return inputFailure(
      'Unable to read the capture config; check that the file exists and is readable.\n',
    );
  }
  if (text.length > MAX_INPUT_TEXT_LENGTH) {
    return inputFailure('The capture config exceeds the input size limits.\n');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    if (isJsonParseFailure(error)) {
      return inputFailure(
        'The capture config is not valid JSON; regenerate it with isthmus init.\n',
      );
    }
    throw error;
  }
  if (!isJsonObject(parsed) || !isSafeNonEmptyString(parsed.project)) {
    return inputFailure('The capture config must be a JSON object with a project path.\n');
  }
  let project: string;
  try {
    project = await fileSystem.realPath(parsed.project);
  } catch {
    return inputFailure(
      'The capture config project path does not exist; point it at the app root.\n',
    );
  }
  try {
    validateCaptureConfig(parsed, project);
  } catch (error) {
    if (error instanceof CaptureConfigValidationError) {
      return inputFailure(`The capture config violates the workflow contract: ${error.message}\n`);
    }
    throw error;
  }

  const pathEntries = pathValue.split(':').filter((entry) => entry.length > 0);
  const checks: DoctorCheck[] = [];
  const names = [
    ...producerNames(parsed),
    ...objectCommands(parsed.messages, parsed),
    ...objectCommands(parsed.events, parsed),
    ...(parsed.prepare as readonly (readonly string[])[]).map((command, index) => ({
      name: `prepare-${index + 1}`,
      command,
    })),
  ];
  for (const { name, command } of names) {
    const resolved = await resolveExecutable(command[0]!, project, fileSystem, pathEntries);
    checks.push({
      name,
      status: resolved === undefined ? 'missing' : 'ok',
      command,
      ...(resolved === undefined ? {} : { resolved }),
    });
  }
  const report: DoctorReport = {
    format: 'isthmus-doctor',
    version: 1,
    status: checks.every(({ status }) => status === 'ok') ? 'ok' : 'incomplete',
    project,
    checks,
  };
  return {
    standardOutput: encodeSortedJson(report),
    standardError: '',
    exitCode: report.status === 'ok' ? 0 : 1,
  };
}

/** 설정에 선언된 기본 producer 명령과 이름을 순서대로 모은다. */
function producerNames(
  config: Record<string, unknown>,
): ReadonlyArray<{ name: string; command: readonly string[] }> {
  return [
    { name: 'dartograph', command: config.dartograph as readonly string[] },
    ...(['cartograph', 'kartograph'] as const)
      .filter((name) => config[name] !== undefined)
      .map((name) => ({ name, command: config[name] as readonly string[] })),
  ];
}

/** messages·events의 사용자 지정 명령만 검사한다. `true`는 기본 명령 재사용이다. */
function objectCommands(
  value: unknown,
  config: Record<string, unknown>,
): ReadonlyArray<{ name: string; command: readonly string[] }> {
  if (value === undefined || value === true || !isJsonObject(value)) return [];
  return Object.entries(value)
    .filter(([name, command]) => config[name] !== undefined && Array.isArray(command))
    .map(([name, command]) => ({ name, command: command as readonly string[] }));
}

/** 첫 토큰이 존재하는 파일이거나 PATH 위의 실행 파일인지 확인한다. */
async function resolveExecutable(
  token: string,
  project: string,
  fileSystem: CaptureFileSystem,
  pathEntries: readonly string[],
): Promise<string | undefined> {
  if (token.includes('/') || token.includes('\\')) {
    const candidate = isAbsolute(token) ? token : resolve(project, token);
    return (await fileSystem.statPath(candidate)) === 'file' ? candidate : undefined;
  }
  for (const entry of pathEntries) {
    const candidate = join(entry, token);
    if ((await fileSystem.statPath(candidate)) === 'file') return candidate;
  }
  return undefined;
}

/** 잘못된 CLI 호출을 경로 없는 사용법과 코드 64로 바꾼다. */
function usageError(): CommandResult {
  return { standardOutput: '', standardError: `${doctorUsage}\n`, exitCode: 64 };
}

/** doctor 명령의 한 줄 사용법이다. */
export const doctorUsage =
  'Usage: isthmus doctor <capture.json>';