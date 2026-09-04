#!/usr/bin/env node

import { readFile } from 'node:fs/promises';

import {
  checkUsage,
  runCheckCommand,
  type CommandResult,
} from './check-command.ts';
import { graphUsage, runGraphCommand } from './graph-command.ts';
import { queryUsage, runQueryCommand } from './query-command.ts';
import {
  retentionUsage,
  runRetentionsCommand,
} from './retentions-command.ts';

const commandUsages = new Map([
  ['check', checkUsage],
  ['graph', graphUsage],
  ['query', queryUsage],
  ['retentions', retentionUsage],
]);

const rootHelp = `Usage: isthmus <command> [options]

Commands:
  check        Report unmatched bridge calls and handlers
  query        Find both sides of a channel or method
  graph        Render matched boundary edges
  retentions   Produce external retention evidence

Options:
  -h, --help   Show help
  --version    Show version
`;

const arguments_ = process.argv.slice(2);
const readTextFile = (path: string) => readFile(path, 'utf8');
const informationalResult = await runInformationalCommand(arguments_);
const result = informationalResult ?? await dispatchCommand(arguments_);

process.stdout.write(result.standardOutput);
process.stderr.write(result.standardError);
process.exitCode = result.exitCode;

/** 도움말과 버전처럼 입력 문서가 필요 없는 명령을 실행한다. */
async function runInformationalCommand(
  commandArguments: readonly string[],
): Promise<CommandResult | undefined> {
  const first = commandArguments[0];
  if (
    commandArguments.length === 1 &&
    (first === '--help' || first === '-h')
  ) {
    return successfulText(rootHelp);
  }
  if (commandArguments.length === 1 && first === '--version') {
    return readVersion();
  }
  if (
    commandArguments.length === 2 &&
    (commandArguments[1] === '--help' || commandArguments[1] === '-h')
  ) {
    const usage = first === undefined ? undefined : commandUsages.get(first);
    if (usage !== undefined) return successfulText(`${usage}\n`);
  }
  return undefined;
}

/** 알려진 분석 하위 명령으로만 라우팅한다. */
async function dispatchCommand(
  commandArguments: readonly string[],
): Promise<CommandResult> {
  switch (commandArguments[0]) {
    case 'check':
      return runCheckCommand(commandArguments, readTextFile);
    case 'graph':
      return runGraphCommand(commandArguments, readTextFile);
    case 'query':
      return runQueryCommand(commandArguments, readTextFile);
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
