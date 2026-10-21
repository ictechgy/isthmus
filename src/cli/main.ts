#!/usr/bin/env node

import { readdir, readFile, realpath, stat } from 'node:fs/promises';

import { readBoundedTextFile, readRegularTextFile } from './bounded-text-file.ts';
import { writeTextAtomically } from './atomic-write.ts';
import { checkUsage, runCheckCommand } from './check-command.ts';
import type { CaptureFileSystem, CommandResult, ReadTextFile } from './command-support.ts';
import { MAX_INPUT_TEXT_LENGTH } from './command-support.ts';
import { doctorUsage, runDoctorCommand } from './doctor-command.ts';
import { initUsage, runInitCommand } from './init-command.ts';
import {
  extractJsUsage,
  type ExtractJsFileSystem,
  runExtractJsCommand,
} from './extract-js-command.ts';
import { graphUsage, runGraphCommand } from './graph-command.ts';
import { diffUsage, runDiffCommand } from './diff-command.ts';
import { queryUsage, runQueryCommand } from './query-command.ts';
import { impactUsage, runImpactCommand } from './impact-command.ts';
import { runtimeUsage, runRuntimeCommand } from './runtime-command.ts';
import { preflightUsage, runPreflightCommand } from './preflight-command.ts';
import { runTraceCommand, traceUsage } from './trace-command.ts';
import { runTaskCommand, taskUsage } from './task-command.ts';
import { navigationTraceUsage, runNavigationTraceCommand } from './navigation-trace-command.ts';
import {
  retentionUsage,
  runRetentionsCommand,
} from './retentions-command.ts';
import { runServeCommand, serveUsage } from './serve-command.ts';
import { runSurfaceCommand, surfaceUsage } from './surface-command.ts';

process.stdout.on('error', handleStreamError);
process.stderr.on('error', handleStreamError);

const commandUsages = new Map([
  ['check', checkUsage],
  ['graph', graphUsage],
  ['diff', diffUsage],
  ['query', queryUsage],
  ['impact', impactUsage],
  ['preflight', preflightUsage],
  ['trace', traceUsage],
  ['task', taskUsage],
  ['trace-navigation', navigationTraceUsage],
  ['surface', surfaceUsage],
  ['verify-runtime', runtimeUsage],
  ['retentions', retentionUsage],
  ['serve', serveUsage],
  ['extract-js', extractJsUsage],
  ['doctor', doctorUsage],
  ['init', initUsage],
]);

const rootHelp = `Usage: isthmus <command> [options]

Commands:
  check        Report unmatched bridge calls and handlers
  query        Find both sides of a channel, method, relation:<name>, or route:<template>
  impact       Inspect bridge dependencies before changing files or symbols
  preflight    Trace cross-language impact from producer analysis context
  trace        Follow a route, relation, symbol, or file to DB and client impact candidates
  task         Summarize one trace task with optional input evidence and recorded tests
  trace-navigation  Follow screen URL mappings through JS forward reach into HTTP calls
  surface      Export a server http surface for clients in another organization
  verify-runtime  Verify recorded calls against scenario expectations
  graph        Render matched boundary edges
  diff         Compare bridge observations (or --http route surfaces) before and after a change
  retentions   Produce external retention evidence
  extract-js   Extract React Native caller-side bridge facts from JS/TS
  doctor       Validate a capture config and its executable paths
  init         Write a capture config scaffold
  serve        Speak MCP over stdio for agent clients
  help         Show command help

Options:
  -h, --help   Show help; after a command it shows that command's usage
  --version    Show version
`;

const arguments_ = process.argv.slice(2);
/**
 * 모든 명령의 입력 읽기 경계다. MCP serve와 같은 일반 파일 리더를 쓴다.
 *
 * FIFO·장치·디렉터리(프로세스 치환 `<(...)`, 파이프에 연결된 `/dev/stdin` 포함)는 열지 않고 읽기 실패로, 호출부 상한의
 * 3배 바이트를 넘는 파일은 읽지 않고 크기 상한 실패로 끝낸다. 일반 파일은 readFile(path, 'utf8')과 같은 문자열이다.
 */
const readTextFile: ReadTextFile = readRegularTextFile;
const writeTextFile = (path: string, text: string) =>
  writeTextAtomically(path, text);

/** extract-js가 쓰는 실제 파일시스템 구현이다 — 테스트는 계약만 주입한다. */
const extractJsFileSystem: ExtractJsFileSystem = {
  statPath: async (path) => {
    try {
      const entry = await stat(path);
      return entry.isDirectory() ? 'directory' : 'file';
    } catch {
      return 'missing';
    }
  },
  listDirectory: async (path) =>
    (await readdir(path, { withFileTypes: true })).map((entry) => ({
      name: entry.name,
      isFile: entry.isFile(),
      isDirectory: entry.isDirectory(),
    })),
  realPath: (path) => realpath(path),
};
/** doctor·init이 쓰는 실제 파일시스템이다. producer는 실행하지 않는다. */
const captureFileSystem: CaptureFileSystem = {
  statPath: async (path) => {
    try {
      const entry = await stat(path);
      return entry.isDirectory() ? 'directory' : 'file';
    } catch {
      return 'missing';
    }
  },
  realPath: (path) => realpath(path),
};
const informationalResult = await runInformationalCommand(arguments_);
const result = informationalResult ?? await dispatchCommand(arguments_);

process.stdout.write(result.standardOutput);
process.stderr.write(result.standardError);
process.exitCode = result.exitCode;

/** 파이프 소비자가 먼저 닫힌 정상 상황만 조용히 종료한다. */
function handleStreamError(error: NodeJS.ErrnoException): void {
  if (error.code === 'EPIPE') {
    process.exitCode = 0;
    return;
  }
  throw error;
}

/** 도움말과 버전처럼 입력 문서가 필요 없는 명령을 실행한다. */
async function runInformationalCommand(
  commandArguments: readonly string[],
): Promise<CommandResult | undefined> {
  // 도움말 플래그는 어느 위치에 있든 이긴다. 긴 호출 끝에 붙여도 사용법을 본다.
  const helpFlagIndex = commandArguments.findIndex(
    (argument) => argument === '--help' || argument === '-h',
  );
  if (helpFlagIndex >= 0) return commandHelp(commandArguments[0]);
  if (commandArguments[0] === 'help') {
    return commandHelp(commandArguments[1]);
  }
  if (
    commandArguments.length === 1 &&
    commandArguments[0] === '--version'
  ) {
    return readVersion();
  }
  return undefined;
}

/** 명령 이름에 맞는 사용법을, 모르면 루트 도움말을 돌려준다. */
function commandHelp(command: string | undefined): CommandResult {
  if (command === undefined) return successfulText(rootHelp);
  const usage = commandUsages.get(command);
  return usage === undefined
    ? successfulText(rootHelp)
    : successfulText(`${usage}\n`);
}

/** 알려진 분석 하위 명령으로만 라우팅한다. */
async function dispatchCommand(
  commandArguments: readonly string[],
): Promise<CommandResult> {
  switch (commandArguments[0]) {
    case 'check':
      // SARIF driver에만 필요하므로 메타데이터 부재는 json 보고서를 막지 않는다.
      return runCheckCommand(
        commandArguments,
        readTextFile,
        writeTextFile,
        undefined,
        await readPackageVersion(),
      );
    case 'graph':
      return runGraphCommand(commandArguments, readTextFile);
    case 'diff':
      return runDiffCommand(commandArguments, readTextFile);
    case 'query':
      return runQueryCommand(commandArguments, readTextFile);
    case 'impact':
      return runImpactCommand(commandArguments, readTextFile);
    case 'preflight':
      return runPreflightCommand(commandArguments, readTextFile);
    case 'trace':
      return runTraceCommand(commandArguments, readTextFile);
    case 'task':
      return runTaskCommand(commandArguments, (path, maximum = MAX_INPUT_TEXT_LENGTH) => readBoundedTextFile(path, maximum));
    case 'trace-navigation':
      return runNavigationTraceCommand(commandArguments, readBoundedTextFile);
    case 'surface':
      return runSurfaceCommand(commandArguments, readTextFile, await readPackageVersion());
    case 'verify-runtime':
      return runRuntimeCommand(commandArguments, readTextFile);
    case 'extract-js':
      return runExtractJsCommand(
        commandArguments,
        extractJsFileSystem,
        readTextFile,
        () => new Date(),
        await readPackageVersion(),
      );
    case 'doctor':
      return runDoctorCommand(
        commandArguments,
        readTextFile,
        captureFileSystem,
        process.cwd(),
        process.env.PATH ?? '',
      );
    case 'init':
      return runInitCommand(
        commandArguments,
        readTextFile,
        writeTextFile,
        captureFileSystem,
        process.cwd(),
      );
    case 'serve':
      // 세션은 요청을 하나씩 처리한다. CLI와 같은 일반 파일 리더라 FIFO·장치 경로 하나가 이후 모든 요청을 막지 않는다.
      return runServeCommand(
        commandArguments,
        readTextFile,
        writeTextFile,
        await readPackageVersion(),
      );
    case 'retentions': {
      const version = await readPackageVersion();
      return version === undefined
        ? packageMetadataError()
        : runRetentionsCommand(
            commandArguments,
            readTextFile,
            () => new Date(),
            version,
          );
    }
    default:
      return {
        standardOutput: '',
        standardError: rootHelp,
        exitCode: 64,
      };
  }
}

/** 설치된 package.json을 단일 출처로 사용해 버전을 출력한다. */
async function readVersion(): Promise<CommandResult> {
  const version = await readPackageVersion();
  return version === undefined
    ? packageMetadataError()
    : successfulText(`${version}\n`);
}

/** 설치된 package.json에서 검증된 버전 문자열을 읽는다. */
async function readPackageVersion(): Promise<string | undefined> {
  try {
    const text = await readFile(new URL('../../package.json', import.meta.url), 'utf8');
    const document: unknown = JSON.parse(text);
    return isVersionDocument(document) ? document.version : undefined;
  } catch {
    return undefined;
  }
}

/** package metadata가 비어 있지 않은 버전을 제공하는지 확인한다. */
function isVersionDocument(value: unknown): value is { readonly version: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'version' in value &&
    typeof value.version === 'string' &&
    value.version.length > 0
  );
}

/** stdout 텍스트와 성공 종료 코드를 만든다. */
function successfulText(standardOutput: string): CommandResult {
  return { standardOutput, standardError: '', exitCode: 0 };
}

/** package metadata 실패를 민감정보 없는 코드 2로 바꾼다. */
function packageMetadataError(): CommandResult {
  return {
    standardOutput: '',
    standardError: 'Unable to read package metadata.\n',
    exitCode: 2,
  };
}
