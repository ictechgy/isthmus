/**
 * `isthmus extract-js` — React Native 호출 측 bridge-facts 생산자다.
 *
 * JS/TS 파일(또는 그 파일을 담은 디렉터리)을 토큰 스캔해 정적 모듈·컴포넌트
 * 이름과 바인딩 해석이 끝난 메서드 호출을 bridge-facts v1 문서로 낸다.
 * 해석이 멈춘 곳은 limitations로만 보고한다 — 문서를 거짓으로 완전하게
 * 만들지 않는다.
 */

import { sep } from 'node:path';
import {
  createJsFactsDocument,
  JS_SOURCE_EXTENSIONS,
} from '../extract/js-document.ts';
import { encodeSortedJson } from '../report/sorted-json.ts';
import {
  inputFailure,
  MAX_INPUT_TEXT_LENGTH,
  MAX_TOTAL_INPUT_TEXT_LENGTH,
  type Clock,
  type CommandResult,
  type ReadTextFile,
} from './command-support.ts';
import { parseCommandArguments } from './parse-arguments.ts';
import { createJsEventFactsDocument } from '../extract/js-events.ts';

/** 디렉터리 항목 — 워커가 경로 종류를 다시 질의하지 않게 타입을 함께 준다. */
export interface JsDirectoryEntry {
  readonly name: string;
  readonly isFile: boolean;
  readonly isDirectory: boolean;
}

/** extract-js가 필요로 하는 최소 파일시스템 표면이다. */
export interface ExtractJsFileSystem {
  /** 경로 종류를 돌려준다 — 없으면 'missing'. */
  readonly statPath: (path: string) => Promise<'file' | 'directory' | 'missing'>;
  /** 디렉터리의 바로 아래 항목들을 나열한다. */
  readonly listDirectory: (path: string) => Promise<readonly JsDirectoryEntry[]>;
  /** 심볼릭 링크·`..`를 풀어 절대 경로로 만든다. */
  readonly realPath: (path: string) => Promise<string>;
}

/** 스캔 대상 확장자 집합이다. */
const jsExtensions = new Set<string>(JS_SOURCE_EXTENSIONS);

/** 워크에서 건너뛸 디렉터리다 — 종속성·빌드 산출물·VCS 내부다. */
const SKIPPED_DIRECTORIES = new Set([
  'node_modules', 'dist', 'build', 'coverage', 'out',
  '.git', '.svn', '.hg', '.expo', '.next', '.turbo',
]);

/** 한 번의 호출이 받을 수 있는 입력 경로 수 상한이다. */
const MAX_INPUT_PATHS = 256;
/** 스캔 대상 파일 수 상한이다. */
const MAX_SCANNED_FILES = 10_000;

/**
 * extract-js 인자를 실행해 프로세스에 독립적인 결과를 반환한다.
 *
 * 성공 시 정렬된 bridge-facts JSON을 stdout에 쓴다. 입력 실패는 원인 종류와
 * 해결 방향을 담은 코드 2, 잘못된 호출은 사용법과 코드 64다.
 */
export async function runExtractJsCommand(
  arguments_: readonly string[],
  fileSystem: ExtractJsFileSystem,
  readSource: ReadTextFile,
  now: Clock = () => new Date(),
  version?: string,
): Promise<CommandResult> {
  if (arguments_[0] !== 'extract-js') return usageError();
  const options = parseCommandArguments(arguments_.slice(1), ['--project'], ['--events']);
  if (options === undefined) return usageError();
  const { positionals, valueFlags } = options;
  if (positionals.length === 0 || positionals.length > MAX_INPUT_PATHS) {
    return usageError();
  }

  const roots = await Promise.all(
    positionals.map((input) => safeRealPath(fileSystem, input)),
  );
  const missingIndex = roots.findIndex((path) => path === undefined);
  if (missingIndex !== -1) {
    return inputFailure(
      `Unable to read extract-js input ${missingIndex + 1}; `
      + 'check that the file or directory exists and is readable.\n',
    );
  }

  const projectFlag = valueFlags.get('--project');
  let projectRoot: string;
  if (projectFlag !== undefined) {
    const root = await safeRealPath(fileSystem, projectFlag);
    if (root === undefined || await fileSystem.statPath(root) !== 'directory') {
      return inputFailure(
        'extract-js --project does not name a readable directory; '
        + 'pass the project root that contains the inputs.\n',
      );
    }
    projectRoot = normalizeSeparators(root);
  } else {
    projectRoot = await commonAncestor(roots as string[], fileSystem);
  }

  const discovered: { path: string; text: string }[] = [];
  for (const [index, absolute] of (roots as string[]).entries()) {
    const kind = await fileSystem.statPath(absolute);
    if (kind === 'missing') {
      return inputFailure(
        `Unable to read extract-js input ${index + 1}; `
        + 'check that the file or directory exists and is readable.\n',
      );
    }
    let candidates: string[];
    try {
      candidates = kind === 'directory'
        ? await walkDirectory(
          fileSystem, absolute, MAX_SCANNED_FILES - discovered.length)
        : [absolute];
    } catch {
      return inputFailure(
        `Unable to list extract-js input ${index + 1}; `
        + 'check that the directory is readable.\n',
      );
    }
    for (const candidate of candidates) {
      if (!isJsSource(candidate)) {
        if (kind === 'file') {
          return inputFailure(
            `extract-js input ${index + 1} is not a JS/TS source file; `
            + 'pass .js/.ts/.jsx/.tsx sources or a directory containing them.\n',
          );
        }
        continue;
      }
      const relative = relativize(candidate, projectRoot);
      if (relative === undefined || relative === '') {
        return inputFailure(
          `extract-js input ${index + 1} escapes the project root; `
          + 'pass --project that contains every input.\n',
        );
      }
      discovered.push({ path: relative, text: '' });
      if (discovered.length > MAX_SCANNED_FILES) {
        return inputFailure(
          `extract-js input set exceeds ${MAX_SCANNED_FILES} files; `
          + 'narrow the scanned directories.\n',
        );
      }
    }
  }

  // 같은 파일이 여러 입력에서 발견돼도 한 번만 스캔한다.
  const ordered = [...new Map(discovered.map((f) => [f.path, f])).values()]
    .sort((left, right) => left.path.localeCompare(right.path));
  let totalLength = 0;
  for (const file of ordered) {
    let text: string;
    try {
      text = await readSource(`${projectRoot}/${file.path}`);
    } catch {
      return inputFailure(
        `Unable to read extract-js source ${file.path}; `
        + 'check that the file exists and is readable.\n',
      );
    }
    totalLength += text.length;
    if (
      text.length > MAX_INPUT_TEXT_LENGTH ||
      totalLength > MAX_TOTAL_INPUT_TEXT_LENGTH
    ) {
      return inputFailure(
        'extract-js input set exceeds the source size limits; '
        + 'narrow the scanned directories.\n',
      );
    }
    file.text = text;
  }

  if (version === undefined) {
    return {
      standardOutput: '',
      standardError: 'Unable to read package metadata.\n',
      exitCode: 2,
    };
  }
  const document = (options.booleanFlags.has('--events') ? createJsEventFactsDocument : createJsFactsDocument)(
    ordered, version, now().toISOString(), projectRoot,
  );
  return { standardOutput: encodeSortedJson(document), standardError: '', exitCode: 0 };
}

/**
 * 디렉터리 아래 JS/TS 파일을 재귀로 모은다. 실패는 빈 목록이 아니라 던진다.
 *
 * `budget`은 아직 받을 수 있는 파일 수다 — 거대한 트리 전체를 열거한 뒤에야
 * 상한 오류를 내지 않도록 예산을 넘으면 즉시 멈추고 호출자가 상한을 보고한다.
 */
async function walkDirectory(
  fileSystem: ExtractJsFileSystem,
  directory: string,
  budget: number,
): Promise<string[]> {
  const found: string[] = [];
  const pending = [directory];
  while (pending.length > 0 && found.length <= budget) {
    const current = pending.pop()!;
    let entries: readonly JsDirectoryEntry[];
    try {
      entries = await fileSystem.listDirectory(current);
    } catch (error) {
      throw new Error(`listDirectory failed: ${current}`, { cause: error });
    }
    for (const entry of [...entries]
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const child = `${current}/${entry.name}`;
      if (entry.isDirectory) {
        if (SKIPPED_DIRECTORIES.has(entry.name) || entry.name.startsWith('.')) {
          continue;
        }
        pending.push(child);
      } else if (entry.isFile && isJsSource(entry.name)) {
        found.push(child);
      }
    }
  }
  return found;
}

/**
 * `--project` 없이 입력들의 공통 조상 디렉터리를 찾는다.
 *
 * 파일 입력은 디렉터리로 접고, 모든 입력을 포함하는 가장 깊은 공통
 * 디렉터리를 고른다. 프로젝트 밖 경로가 facts의 상대 경로를 깨지 않게 한다.
 */
async function commonAncestor(
  absolutePaths: readonly string[],
  fileSystem: ExtractJsFileSystem,
): Promise<string> {
  const roots: string[] = [];
  for (const absolute of absolutePaths) {
    const normalized = normalizeSeparators(absolute);
    const isFile = await fileSystem.statPath(absolute) === 'file';
    roots.push(isFile ? normalized.slice(0, normalized.lastIndexOf('/')) : normalized);
  }
  let common = roots[0] ?? '/';
  for (const candidate of roots.slice(1)) {
    while (candidate !== common && !candidate.startsWith(`${common}/`)) {
      const parent = common.slice(0, common.lastIndexOf('/'));
      if (parent === '' || parent === common) {
        common = '/';
        break;
      }
      common = parent;
    }
  }
  return common;
}

/** 절대 경로를 프로젝트 상대 POSIX 경로로 바꾼다. 루트 밖이면 undefined다. */
function relativize(absolute: string, projectRoot: string): string | undefined {
  const normalized = normalizeSeparators(absolute);
  const root = normalizeSeparators(projectRoot);
  if (root === '/') return normalized.replace(/^\/+/, '');
  if (normalized === root) return '';
  if (!normalized.startsWith(`${root}/`)) return undefined;
  return normalized.slice(root.length + 1);
}

/** 스캔 대상 확장자 여부다. */
function isJsSource(path: string): boolean {
  const dot = path.lastIndexOf('.');
  return dot !== -1 && jsExtensions.has(path.slice(dot + 1));
}

/**
 * OS 경로 구분자를 계약이 요구하는 `/`로 통일한다.
 *
 * `\`는 POSIX에서 유효한 파일명 문자이므로 구분자가 `\`인 플랫폼에서만
 * 바꾼다 — 무조건 치환하면 `a\b.ts` 같은 합법 파일명이 깨진다.
 */
function normalizeSeparators(path: string): string {
  return sep === '\\' ? path.replace(/\\/g, '/') : path;
}

/** realpath가 던지는 입력을 경로 없는 undefined로 정규화한다. */
async function safeRealPath(
  fileSystem: ExtractJsFileSystem,
  path: string,
): Promise<string | undefined> {
  try {
    return await fileSystem.realPath(path);
  } catch {
    return undefined;
  }
}

/** 잘못된 CLI 호출을 경로 없는 사용법과 코드 64로 바꾼다. */
function usageError(): CommandResult {
  return {
    standardOutput: '',
    standardError: `${extractJsUsage}\n`,
    exitCode: 64,
  };
}

/** extract-js 명령의 한 줄 사용법이다. */
export const extractJsUsage =
  'Usage: isthmus extract-js <file-or-dir> [more...] [--project <dir>] [--events]';
