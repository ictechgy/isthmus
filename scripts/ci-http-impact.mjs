#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderPrComment } from './render-pr-comment.mjs';
import { runChild } from './run-child.mjs';

/**
 * GitHub Action(`action.yml`)의 분석 단계 오케스트레이터다.
 *
 * 흐름: isthmus 설치(npm 또는 로컬 경로) → 입력 준비(capture 설정으로 base·head를 같은 checkout 경로에서 차례로
 * 수집하거나, 미리 만든 문서를 그대로 쓴다) → `isthmus diff --http` → non-info finding이 있는 route만 골라
 * `isthmus trace` → Markdown 렌더링 → job summary·`GITHUB_OUTPUT`·artifact 디렉터리 기록.
 *
 * 제품(`isthmus`)은 JSON만 읽고 생산자를 실행하지 않는다. 생산자 실행은 배포 스크립트 `capture-trace.mjs`가 맡고,
 * 이 스크립트는 그것을 base·head에 한 번씩 부르는 CI 절차일 뿐이다(생산자 설치는 사용자 workflow의 책임이다).
 * PR 코드(생산자)가 도는 단계이므로 토큰을 받지 않는다. 댓글 게시는 별도 단계(`post-pr-comment.mjs`)다.
 */

/** capture 출력 root 이름이다. 사용자 설정의 root와 겹치면 거부한다. */
export const OUTPUT_ROOT_NAME = 'isthmusCiOutput';
/** trace 선택 상한(`isthmus trace` selection 목록 상한과 같다). */
export const MAX_TRACE_ROUTES = 1000;
/** capture 단계에서 쓰는 자리표시자 선택이다. route 선택은 순회 root를 바꾸지 않는다(TRACE.md capture 절). */
const PLACEHOLDER_SELECTION = { routes: [{ method: 'GET', template: '/' }] };
/** isthmus 최소 Node 버전(`package.json#engines`). */
const MINIMUM_NODE = [22, 18, 0];
/** 자식 stdout 상한이다(isthmus 보고서 최대 크기보다 넉넉하다). */
const MAX_CHILD_BUFFER = 256 * 1024 * 1024;
/** capture 한 번의 전체 시간 제한(ms)이다. 단계별 제한은 capture 설정이 정한다. */
const CAPTURE_TIMEOUT_MS = 6 * 60 * 60 * 1000;
/** isthmus diff·trace의 시간 제한(ms)이다. */
const ISTHMUS_TIMEOUT_MS = 30 * 60 * 1000;
/** 생산자에게 넘기지 않는 환경 변수다. 후속 단계 조작(GITHUB_ENV 등)과 토큰 노출을 줄인다. */
const WITHHELD_ENV_PATTERN = /^(GITHUB_(ENV|OUTPUT|PATH|STATE|STEP_SUMMARY|TOKEN)|ACTIONS_(RUNTIME|ID_TOKEN|CACHE|RESULTS)_\w*|ACTIONS_RUNTIME_\w*|INPUT_\w*|ISTHMUS_CI_\w*)$/u;
/** 정확한 npm 버전 문자열이다(범위·태그는 받지 않는다 — 재현 가능한 설치를 위해). */
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
/** git commit id다. */
const SHA_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
/** fail-on 토큰 목록 문법(검증은 CLI가 한다 — 여기서는 인자 모양만 본다). */
const FAIL_ON_PATTERN = /^[a-z-]+(?:,[a-z-]+)*$/u;

/** 단계 이름을 싣는 CI 오류다. 입력 원문·토큰은 싣지 않는다. */
export class CiStepError extends Error {
  /** 실패한 단계와 원인·해결 방향 문구를 보존한다. */
  constructor(step, message) {
    super(message);
    this.name = 'CiStepError';
    this.step = step;
  }
}

// ── 입력 ───────────────────────────────────────────────────────────────────────

/** 여러 줄·공백으로 나눈 경로 목록을 배열로 바꾼다. */
export function splitList(value) {
  return typeof value === 'string' ? value.split(/\s+/u).filter((entry) => entry.length > 0) : [];
}

/** `true`/`false` 입력을 읽는다. */
function readBoolean(value, fallback, name) {
  if (value === undefined || value === '') return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new CiStepError('inputs', `Input ${name} must be true or false.`);
}

/** 범위가 있는 정수 입력을 읽는다. */
function readInteger(value, fallback, minimum, maximum, name) {
  if (value === undefined || value === '') return fallback;
  if (!/^\d+$/u.test(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new CiStepError('inputs', `Input ${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  return Number(value);
}

/** 저장소 상대 경로(`..`·절대 경로·역슬래시·제어 문자 없음)인지 확인한다. */
function requireRelativePath(value, name) {
  if (value.startsWith('/') || value.includes('\\') || /[\u0000-\u001f]/u.test(value) || value.split('/').includes('..')) {
    throw new CiStepError('inputs', `Input ${name} must be a path relative to the repository, without .. segments.`);
  }
  return value;
}

/** 선택 SHA 입력을 검증한다. */
function readSha(value, name) {
  if (value === undefined || value === '') return undefined;
  if (!SHA_PATTERN.test(value)) throw new CiStepError('inputs', `Input ${name} must be a full lowercase commit SHA.`);
  return value;
}

/** fail-on 입력을 정규화한다. 빈 값·`none`은 정책 없음이다. */
function readFailOn(value) {
  const trimmed = (value ?? '').replace(/\s+/gu, '');
  if (trimmed === '' || trimmed === 'none') return '';
  if (!FAIL_ON_PATTERN.test(trimmed)) {
    throw new CiStepError('inputs', 'Input fail-on must be a comma-separated list of finding codes, error, warning or incomplete.');
  }
  return trimmed;
}

/** 파일 선택은 JSON으로 받아 공백 있는 이름을 보존하고 셸·절대 경로를 통한 범위 확장을 막는다. */
function readTraceFiles(value) {
  if (value === undefined || value === '') return undefined;
  let files;
  try { files = JSON.parse(value); }
  catch { throw new CiStepError('inputs', 'Input trace-files must be a JSON array of relative paths or {member,path} selections.'); }
  if (!Array.isArray(files) || files.length > MAX_TRACE_ROUTES) {
    throw new CiStepError('inputs', `Input trace-files must contain at most ${MAX_TRACE_ROUTES} file selections.`);
  }
  for (const file of files) {
    const path = typeof file === 'string' ? file : file?.path;
    const object = file !== null && typeof file === 'object' && !Array.isArray(file);
    if (typeof path !== 'string' || path.length === 0 || path.length > 4096 ||
      (typeof file !== 'string' && (!object || Object.keys(file).some((key) => key !== 'member' && key !== 'path') ||
        typeof file.member !== 'string' || file.member.length === 0 || file.member.length > 128 || /[\u0000-\u001f]/u.test(file.member)))) {
      throw new CiStepError('inputs', 'Input trace-files contains an invalid file selection.');
    }
    requireRelativePath(path, 'trace-files');
  }
  return files.length === 0 ? undefined : files;
}

/**
 * Action 입력(환경 변수 `ISTHMUS_CI_*`)을 읽고 검증한다. action.yml은 입력을 `run` 스크립트에 끼워 넣지 않고
 * 환경 변수로만 넘긴다(식 주입 방지). 모드는 capture 설정 또는 미리 만든 문서 중 정확히 하나다.
 */
export function parseInputs(env) {
  const workspace = resolve(env.GITHUB_WORKSPACE ?? process.cwd());
  const captureConfig = env.ISTHMUS_CI_CAPTURE_CONFIG ? requireRelativePath(env.ISTHMUS_CI_CAPTURE_CONFIG, 'capture-config') : undefined;
  const before = splitList(env.ISTHMUS_CI_BEFORE);
  const after = splitList(env.ISTHMUS_CI_AFTER);
  if ((captureConfig === undefined) === (before.length === 0 && after.length === 0)) {
    throw new CiStepError('inputs', 'Give either capture-config, or precomputed before and after documents (not both).');
  }
  if (captureConfig === undefined && (before.length === 0 || after.length === 0)) {
    throw new CiStepError('inputs', 'Precomputed mode needs both before and after documents.');
  }
  const traceSide = env.ISTHMUS_CI_TRACE_SIDE || 'base';
  if (traceSide !== 'base' && traceSide !== 'head') throw new CiStepError('inputs', 'Input trace-side must be base or head.');
  const version = env.ISTHMUS_CI_ISTHMUS_VERSION || undefined;
  if (version !== undefined && !VERSION_PATTERN.test(version)) {
    throw new CiStepError('inputs', 'Input isthmus-version must be an exact version such as 0.10.0 (no ranges or tags).');
  }
  return {
    workspace, captureConfig, before, after, clients: splitList(env.ISTHMUS_CI_CLIENTS),
    traceContext: env.ISTHMUS_CI_TRACE_CONTEXT || undefined,
    trace: readBoolean(env.ISTHMUS_CI_TRACE, true, 'trace'), traceSide,
    traceFiles: readTraceFiles(env.ISTHMUS_CI_TRACE_FILES),
    failOn: readFailOn(env.ISTHMUS_CI_FAIL_ON),
    maxRows: readInteger(env.ISTHMUS_CI_MAX_ROWS, 20, 1, 1000, 'max-rows'),
    maxChains: readInteger(env.ISTHMUS_CI_MAX_CHAINS, 50, 1, 1000, 'max-chains'),
    commentKey: env.ISTHMUS_CI_COMMENT_KEY || 'default',
    isthmusVersion: version, isthmusPath: env.ISTHMUS_CI_ISTHMUS_PATH || undefined,
    repositoryPath: resolve(workspace, env.ISTHMUS_CI_REPOSITORY_PATH || '.'),
    baseSha: readSha(env.ISTHMUS_CI_BASE_SHA, 'base-sha'), headSha: readSha(env.ISTHMUS_CI_HEAD_SHA, 'head-sha'),
    eventBaseSha: readSha(env.ISTHMUS_CI_EVENT_BASE_SHA, 'event base sha'),
    outputDir: resolve(workspace, env.ISTHMUS_CI_OUTPUT_DIR || join(env.RUNNER_TEMP ?? workspace, 'isthmus-ci')),
    pullRequest: readPullRequest(env),
  };
}

/** PR 번호·head SHA(이벤트 값)다. workflow_run 댓글 단계가 대조에 쓴다. */
function readPullRequest(env) {
  const number = /^\d{1,10}$/u.test(env.ISTHMUS_CI_PR_NUMBER ?? '') ? Number(env.ISTHMUS_CI_PR_NUMBER) : undefined;
  const headSha = SHA_PATTERN.test(env.ISTHMUS_CI_PR_HEAD_SHA ?? '') ? env.ISTHMUS_CI_PR_HEAD_SHA : undefined;
  return number === undefined ? undefined : { number, ...(headSha === undefined ? {} : { headSha }) };
}

// ── 자식 실행 ──────────────────────────────────────────────────────────────────

/** 생산자·isthmus 자식에게 넘길 환경이다. 워크플로 파일 명령 경로와 토큰류를 뺀다. */
export function childEnvironment(env) {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !WITHHELD_ENV_PATTERN.test(key)));
}

/**
 * 자식 종료 상태를 사람이 읽는 문구로 바꾼다. spawnSync는 시간 초과·실행 실패·출력 상한 초과에서 던지지 않고
 * `status: null`과 `error`를 돌려주므로 그 원인을 밝힌다.
 */
export function describeExit(result) {
  if (result.status !== null && result.status !== undefined) return `status ${result.status}`;
  const code = result.error?.code;
  if (code === 'ETIMEDOUT') return 'no status (timed out)';
  if (code === 'ENOBUFS') return 'no status (output exceeded the buffer limit)';
  if (code === 'ENOENT') return 'no status (the command was not found)';
  return `no status (${result.signal ?? code ?? 'unknown'})`;
}

/** 자식 stderr의 첫 줄을 짧게 돌려준다(오류 문구용). 줄바꿈·제어 문자는 지운다. */
function firstLine(value) {
  const line = String(value ?? '').split(/\r?\n/u).find((entry) => entry.trim().length > 0) ?? '';
  return line.replace(/[\u0000-\u001f\u007f]/gu, ' ').slice(0, 500);
}

/**
 * 신뢰하지 않는 텍스트(생산자·capture 경고)를 로그에 싣는다. `::stop-commands::`로 감싸 줄 머리의 `::`가
 * 워크플로 명령(`::add-mask::`, `::error::` 등)으로 해석되지 않게 한다.
 */
export function logUntrusted(write, label, value) {
  const content = String(value ?? '').trimEnd();
  if (content.length === 0) return;
  const token = randomBytes(16).toString('hex');
  write(`${label}\n::stop-commands::${token}\n${content}\n::${token}::\n`);
}

/** 기본 자식 실행기다(인자 배열, 셸 없음). 테스트에서 바꿔 끼운다. */
function defaultExecute(command, args, options) {
  return runChild(command, args, { maxBuffer: MAX_CHILD_BUFFER, ...options });
}

// ── isthmus 준비 ───────────────────────────────────────────────────────────────

/** 현재 Node가 isthmus 최소 버전 이상인지 확인한다. */
export function requireNodeVersion(version = process.versions.node) {
  const parts = version.split('.').map(Number);
  for (let index = 0; index < MINIMUM_NODE.length; index += 1) {
    if (parts[index] > MINIMUM_NODE[index]) return;
    if (parts[index] < MINIMUM_NODE[index]) {
      throw new CiStepError('node', `isthmus needs Node ${MINIMUM_NODE.join('.')} or newer; add actions/setup-node before this action.`);
    }
  }
}

/** Action 자신의 package.json 버전이다(isthmus-version 기본값 — Action ref와 CLI 버전을 맞춘다). */
export function actionPackageVersion() {
  const document = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  return document.version;
}

/**
 * isthmus 실행 파일을 준비한다. `isthmusPath`(빌드된 checkout)가 있으면 그것을, 없으면 정확한 버전을 npm에서
 * 설치한다(`--ignore-scripts` — 설치 스크립트를 돌리지 않는다). 반환값은 CLI·capture 스크립트 경로와 버전이다.
 */
export function prepareIsthmus(options, { execute = defaultExecute, env = process.env } = {}) {
  if (options.isthmusPath !== undefined) return localIsthmus(resolve(options.workspace, options.isthmusPath));
  const version = options.isthmusVersion ?? actionPackageVersion();
  const home = join(dirname(options.outputDir), `isthmus-cli-${version}`);
  mkdirSync(home, { recursive: true });
  const result = execute('npm', ['install', '--prefix', home, '--no-save', '--no-audit', '--no-fund', '--no-package-lock',
    '--ignore-scripts', `isthmus-cli@${version}`], { env: childEnvironment(env), timeout: 10 * 60 * 1000 });
  if (result.status !== 0) {
    throw new CiStepError('install', `npm could not install isthmus-cli@${version} (${describeExit(result)}); check the version `
      + 'and npm registry access, or set isthmus-path to a built checkout.');
  }
  return localIsthmus(join(home, 'node_modules', 'isthmus-cli'));
}

/** 빌드된 isthmus 디렉터리에서 실행 파일 경로를 찾는다. */
function localIsthmus(root) {
  const cli = join(root, 'dist', 'cli', 'main.js');
  if (!existsSync(cli)) {
    throw new CiStepError('install', 'The isthmus directory has no dist/cli/main.js; run npm ci and npm run build there first.');
  }
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  return { cli, capture: join(root, 'scripts', 'capture-trace.mjs'), version: typeof version === 'string' ? version : undefined };
}

// ── capture ────────────────────────────────────────────────────────────────────

/**
 * 사용자 capture 설정을 한 시점용으로 바꾼다.
 * - 상대 경로 root는 checkout 경로 기준 절대 경로로 바꾼다(설정에 러너 경로를 적지 않아도 되게).
 * - `output`·`trace`·`selection`은 Action이 정하므로 설정에서 생략해도 된다.
 * - 출력은 Action이 정한 디렉터리(`<outputRoot>/<side>`), `trace: false`(trace는 diff 뒤에 바뀐 route로 돈다),
 *   선택은 자리표시자 route다 — route 선택은 순회 root를 바꾸지 않으므로(선택과 무관한 상위 집합) 같은 수집물로
 *   나중에 어떤 route든 trace할 수 있다.
 */
export function rewriteCaptureConfig(config, { repositoryPath, outputRoot, side, files }) {
  if (config === null || typeof config !== 'object' || Array.isArray(config) || config.format !== 'isthmus-trace-capture') {
    throw new CiStepError('capture-config', 'The capture config is not an isthmus-trace-capture document (docs/TRACE.md).');
  }
  if (config.roots === null || typeof config.roots !== 'object' || Array.isArray(config.roots)) {
    throw new CiStepError('capture-config', 'The capture config must declare roots.');
  }
  if (Object.hasOwn(config.roots, OUTPUT_ROOT_NAME)) {
    throw new CiStepError('capture-config', `The root name ${OUTPUT_ROOT_NAME} is reserved for the action output; rename it.`);
  }
  const roots = Object.fromEntries(Object.entries(config.roots).map(([name, value]) => [name, resolveRoot(value, repositoryPath)]));
  return { ...config, roots: { ...roots, [OUTPUT_ROOT_NAME]: outputRoot }, output: { root: OUTPUT_ROOT_NAME, path: side },
    trace: false, selection: files === undefined ? PLACEHOLDER_SELECTION : { files } };
}

/**
 * root 값 하나를 절대 경로로 바꾼다. 상대 경로는 checkout 경로 기준으로 정규화한다(`../client-app`처럼 옆에 꺼낸 다른
 * 저장소도 가리킬 수 있다). 절대 경로는 그대로 두고, 존재·realpath 검사는 capture가 한다. root를 넓게 잡는 것은
 * 설정 작성자의 선택이다 — 설정은 head commit에서 읽고, 같은 PR 코드가 생산자로 이미 실행되므로 권한이 늘지 않는다.
 */
function resolveRoot(value, repositoryPath) {
  if (typeof value !== 'string' || value.startsWith('/')) return value;
  if (value.includes('\\') || /[\u0000-\u001f]/u.test(value)) {
    throw new CiStepError('capture-config', 'Relative capture roots must be POSIX paths without backslashes or control characters.');
  }
  return resolve(repositoryPath, value);
}

/** commit 객체의 부모 id 목록이다. 얕은 clone에서도 객체 원문(`cat-file -p`)에는 부모 줄이 남는다. */
function commitParents(execute, repositoryPath, sha) {
  const raw = git(execute, repositoryPath, ['cat-file', '-p', sha], 'checkout', 'Could not read the head commit object.');
  const header = raw.split('\n\n')[0] ?? '';
  return header.split('\n').filter((line) => line.startsWith('parent ')).map((line) => line.slice('parent '.length).trim());
}

/**
 * base commit을 정한다. 입력이 있으면 그것을 쓴다. 없으면 head가 PR 병합 commit(`refs/pull/N/merge`, 부모 둘이고
 * 둘째 부모가 PR head)일 때 첫째 부모 — 병합이 base에 더하는 변화만 비교하게 한다. 그 밖에는 이벤트의 base SHA다.
 * 이벤트 base SHA만 쓰면 base 브랜치가 앞서 나간 경우 PR에 없는 변화가 거꾸로(삭제로) 보일 수 있다.
 */
export function resolveBaseSha(execute, options) {
  if (options.baseSha !== undefined) return options.baseSha;
  const parents = commitParents(execute, options.repositoryPath, options.headSha);
  const prHead = options.pullRequest?.headSha;
  if (parents.length === 2 && prHead !== undefined && parents[1] === prHead && SHA_PATTERN.test(parents[0])) return parents[0];
  if (options.eventBaseSha !== undefined) return options.eventBaseSha;
  throw new CiStepError('inputs', 'Could not determine the base commit; set base-sha.');
}

/** git을 인자 배열로 실행한다. 실패하면 단계 오류다. */
function git(execute, repositoryPath, args, step, message) {
  const result = execute('git', ['-C', repositoryPath, '-c', 'advice.detachedHead=false', ...args], { timeout: 5 * 60 * 1000 });
  if (result.status !== 0) throw new CiStepError(step, message);
  return result.stdout ?? '';
}

/** commit이 로컬에 없으면 origin에서 그 commit만 가져온다(얕은 checkout 대비). */
function ensureCommit(execute, repositoryPath, sha, label) {
  const present = execute('git', ['-C', repositoryPath, 'cat-file', '-e', `${sha}^{commit}`], { timeout: 60 * 1000 });
  if (present.status === 0) return;
  git(execute, repositoryPath, ['fetch', '--no-tags', '--depth=1', 'origin', sha], 'checkout',
    `The ${label} commit is not available and could not be fetched; use actions/checkout with fetch-depth: 0.`);
}

/** 원래 checkout(브랜치 이름이 있으면 그 이름, 아니면 commit)이다. 끝나고 같은 상태로 되돌리기 위해 기록한다. */
function originalCheckout(execute, repositoryPath) {
  const sha = git(execute, repositoryPath, ['rev-parse', 'HEAD'], 'checkout', 'git rev-parse failed.').trim();
  const branch = execute('git', ['-C', repositoryPath, 'symbolic-ref', '-q', '--short', 'HEAD'], { timeout: 60 * 1000 });
  const name = branch.status === 0 ? String(branch.stdout ?? '').trim() : '';
  return { sha, branch: name.length > 0 ? name : undefined };
}

/**
 * 원래 checkout으로 되돌린다. 브랜치였으면 브랜치로(detached HEAD로 남기지 않는다), 아니면 그 commit으로.
 * 앞선 단계가 이미 실패했으면 복원 실패가 원래 원인을 가리지 않게 원래 오류 문구에 덧붙인다.
 */
function restoreCheckout(execute, repositoryPath, original, failure) {
  const target = original.branch === undefined ? ['checkout', '--quiet', '--detach', original.sha] : ['checkout', '--quiet', original.branch];
  try {
    git(execute, repositoryPath, target, 'checkout', 'Could not restore the original checkout.');
  } catch (error) {
    if (failure === undefined) throw error;
    failure.message = `${failure.message} Restoring the original checkout also failed.`;
  }
}

/** 작업 트리에 추적 파일 변경이 없는지 확인한다(revision을 바꾸면 변경을 잃거나 섞는다). */
function requireCleanTree(execute, repositoryPath) {
  const status = git(execute, repositoryPath, ['status', '--porcelain', '--untracked-files=no'], 'checkout',
    'git status failed; repository-path must be a git checkout.');
  if (status.trim().length > 0) {
    throw new CiStepError('checkout', 'The checkout has modified tracked files; run the action before steps that change them.');
  }
}

/** head commit에서 capture 설정을 읽는다. 두 시점이 같은 설정을 쓰게 한다(설정 차이는 인벤토리 차이를 만든다). */
function readConfigAtHead(execute, options, headSha) {
  const text = git(execute, options.repositoryPath, ['show', `${headSha}:${options.captureConfig}`], 'capture-config',
    'The capture config does not exist at the head commit; check capture-config.');
  try { return JSON.parse(text); }
  catch { throw new CiStepError('capture-config', 'The capture config is not valid JSON.'); }
}

/** capture-trace 한 번을 실행한다. 실패 문구는 capture가 정한 단계 문구(경로·비밀 없음)를 쓴다. */
function runCapture(execute, isthmus, configPath, side, env, log) {
  const result = execute(process.execPath, [isthmus.capture, configPath], { env: childEnvironment(env), timeout: CAPTURE_TIMEOUT_MS });
  logUntrusted(log, `capture (${side}) messages:`, result.stderr);
  if (result.status !== 0) {
    throw new CiStepError(`capture:${side}`, firstLine(result.stderr) || `capture-trace exited with ${describeExit(result)}.`);
  }
}

/**
 * base와 head를 **같은 checkout 경로**에서 차례로 수집한다(`project`가 checkout 경로라 worktree를 둘 쓰면 diff가
 * project 불일치로 거부한다 — HTTP-DIFF base..head CI 절차). 끝나면 원래 commit으로 되돌린다.
 */
export function captureBothSides(options, isthmus, { execute = defaultExecute, env = process.env, log = () => {} } = {}) {
  const { repositoryPath, headSha } = options;
  if (headSha === undefined) throw new CiStepError('inputs', 'Capture mode needs head-sha (the default is the checked-out commit).');
  requireCleanTree(execute, repositoryPath);
  ensureCommit(execute, repositoryPath, headSha, 'head');
  const baseSha = resolveBaseSha(execute, options);
  ensureCommit(execute, repositoryPath, baseSha, 'base');
  const original = originalCheckout(execute, repositoryPath);
  const config = readConfigAtHead(execute, options, headSha);
  const captureRoot = join(options.outputDir, 'capture');
  mkdirSync(captureRoot, { recursive: true });
  let failure;
  try {
    for (const [side, sha] of [['base', baseSha], ['head', headSha]]) {
      git(execute, repositoryPath, ['checkout', '--quiet', '--detach', sha], 'checkout', `Could not check out the ${side} commit.`);
      const configPath = join(options.outputDir, `capture-config.${side}.json`);
      writeFileSync(configPath, `${JSON.stringify(rewriteCaptureConfig(config, { repositoryPath, outputRoot: captureRoot, side,
        files: options.traceFiles }), null, 2)}\n`);
      runCapture(execute, isthmus, configPath, side, env, log);
    }
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    restoreCheckout(execute, repositoryPath, original, failure);
  }
  return { base: join(captureRoot, 'base', 'trace-context.json'), head: join(captureRoot, 'head', 'trace-context.json'),
    revisions: { base: baseSha, head: headSha } };
}

// ── diff 입력 ──────────────────────────────────────────────────────────────────

/** JSON 파일을 읽는다. */
function readJson(path, step) {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch { throw new CiStepError(step, 'A JSON input could not be read or parsed.'); }
}

/** http diff가 읽는 문서인지다(`isthmus diff --http`의 규칙과 같다: target http 또는 사실 0건 openapi). */
export function isHttpDiffDocument(document) {
  return document?.target === 'http' || (document?.target === null && document?.platform === 'openapi');
}

/** 선언 측 문서인지다: server 역할, route-decl·route-contract 사실, 또는 openapi. */
export function isDeclarationSide(document) {
  return (Array.isArray(document.roles) && document.roles.includes('server')) || document.platform === 'openapi'
    || (Array.isArray(document.facts) && document.facts.some(({ kind } = {}) => kind === 'route-decl' || kind === 'route-contract'));
}

/** 호출 측 문서인지다: client 역할. */
export function isClientSide(document) {
  return Array.isArray(document.roles) && document.roles.includes('client');
}

/**
 * 단일 project context의 문서를 diff surface 입력으로 나눈다. persistence·sql·bridge 문서는 뺀다.
 * 서버·클라이언트를 겸하는 문서(BFF)는 선언 측과 호출 측 양쪽에 들어간다(CLI가 역할별로 투영한다).
 */
export function classifyContextDocuments(contextPath) {
  const context = readJson(contextPath, 'inputs');
  const directory = dirname(contextPath);
  const declarations = [];
  const clients = [];
  for (const entry of Array.isArray(context.documents) ? context.documents : []) {
    const path = resolve(directory, entry);
    const document = readJson(path, 'inputs');
    if (!isHttpDiffDocument(document)) continue;
    if (isDeclarationSide(document)) declarations.push(path);
    if (isClientSide(document)) clients.push(path);
  }
  return { declarations, clients };
}

/** trace workspace context에서 `isthmus-workspace` 매니페스트를 만든다(분석·catalog·선택을 뺀다). */
export function workspaceManifestFromContext(context) {
  const members = context.members.map((member) => (member.surface !== undefined
    ? { name: member.name, surface: member.surface }
    : { name: member.name, project: member.project, revision: member.revision, documents: member.documents }));
  return { format: 'isthmus-workspace', version: 1, members, links: context.links ?? [],
    ...(context.libraries === undefined ? {} : { libraries: context.libraries }) };
}

/** 두 capture context에서 diff 입력을 만든다. workspace면 매니페스트 두 개, 아니면 surface 문서 목록이다. */
export function diffInputsFromCaptures(contexts) {
  const base = readJson(contexts.base, 'inputs');
  if (Array.isArray(base.members)) {
    const write = (side, context) => {
      const path = join(dirname(contexts[side]), 'ci.workspace.json');
      writeFileSync(path, `${JSON.stringify(workspaceManifestFromContext(context), null, 2)}\n`);
      return path;
    };
    return { before: [write('base', base)], after: [write('head', readJson(contexts.head, 'inputs'))], clients: [] };
  }
  const before = classifyContextDocuments(contexts.base);
  const after = classifyContextDocuments(contexts.head);
  if (before.declarations.length === 0 || after.declarations.length === 0) {
    throw new CiStepError('inputs', 'The capture produced no server or spec http document for base or head; add a route producer '
      + '(routes --role server or an openapi document) to the capture config.');
  }
  return { before: before.declarations, after: after.declarations, clients: after.clients };
}

// ── diff·trace ─────────────────────────────────────────────────────────────────

/** `isthmus diff --http`를 실행한다. 0·1은 보고서, 2·64는 단계 오류다. */
export function runDiff(isthmus, inputs, failOn, { execute = defaultExecute, env = process.env } = {}) {
  const args = ['diff', '--http', '--before', ...inputs.before, '--after', ...inputs.after,
    ...(inputs.clients.length === 0 ? [] : ['--clients', ...inputs.clients]), ...(failOn === '' ? [] : ['--fail-on', failOn])];
  const result = execute(process.execPath, [isthmus.cli, ...args], { env: childEnvironment(env), timeout: ISTHMUS_TIMEOUT_MS });
  if (result.status !== 0 && result.status !== 1) {
    const hint = result.status === 64 ? ' (usage error: check fail-on tokens and that the installed isthmus supports diff --http)' : '';
    throw new CiStepError('diff', `isthmus diff --http exited with ${describeExit(result)}${hint}: ${firstLine(result.stderr)}`);
  }
  return { exitCode: result.status, stdout: result.stdout };
}

/**
 * trace할 route 선택을 만든다: severity가 info가 아닌 finding의 route(중복 제거, diff 순서). 모든 non-info route는
 * base에 있다(삭제·속성 변경·결합 변화 모두 base route 기준이고, head에만 있는 추가 route는 info다).
 * `includeScope`는 diff scope와 trace scope가 같은 이름 공간일 때만(둘 다 workspace이거나 둘 다 단일 project) 참이다.
 */
export function changedRouteSelection(diff, includeScope) {
  const routes = [];
  const seen = new Set();
  for (const finding of Array.isArray(diff.findings) ? diff.findings : []) {
    const { route } = finding;
    if (finding.severity === 'info' || typeof route?.method !== 'string' || typeof route.template !== 'string') continue;
    const entry = { method: route.method, template: route.template,
      ...(includeScope && typeof finding.scope === 'string' ? { scope: finding.scope } : {}) };
    const key = JSON.stringify([entry.scope ?? null, entry.method, entry.template]);
    if (seen.has(key)) continue;
    seen.add(key);
    routes.push(entry);
  }
  return { routes: routes.slice(0, MAX_TRACE_ROUTES), omitted: Math.max(0, routes.length - MAX_TRACE_ROUTES) };
}

/** 경로 문자열 목록을 context 디렉터리 기준 절대 경로로 바꾼다. */
function absoluteList(values, directory) {
  return Array.isArray(values) ? values.map((value) => (typeof value === 'string' ? resolve(directory, value) : value)) : values;
}

/** 분석 목록의 path를 절대 경로로 바꾼다. */
function absoluteAnalyses(analyses, directory) {
  return Array.isArray(analyses)
    ? analyses.map((analysis) => (typeof analysis?.path === 'string' ? { ...analysis, path: resolve(directory, analysis.path) } : analysis))
    : analyses;
}

/** member 하나의 경로를 절대 경로로 바꾼다(문서·분석·surface). */
function absoluteMember(member, directory) {
  if (typeof member?.surface?.path === 'string') return { ...member, surface: { ...member.surface, path: resolve(directory, member.surface.path) } };
  return { ...member, documents: absoluteList(member.documents, directory), analyses: absoluteAnalyses(member.analyses, directory) };
}

/**
 * trace context를 다른 디렉터리에 쓸 수 있게 모든 상대 경로를 절대 경로로 바꾸고 선택을 바꾼다.
 * `fileSymbols`는 파일 선택 전용이라 route 선택 context에 남기면 입력 오류이므로 뺀다.
 */
export function retargetTraceContext(context, directory, routes, files) {
  const { fileSymbols: _fileSymbols, ...rest } = context;
  const retargeted = { ...(files === undefined ? rest : context), selection: files === undefined ? { routes } : { files } };
  if (Array.isArray(context.members)) {
    retargeted.members = context.members.map((member) => absoluteMember(member, directory));
    retargeted.links = Array.isArray(context.links) ? context.links.map((link) => (link?.contract === undefined ? link
      : { ...link, contract: { ...link.contract, documents: absoluteList(link.contract.documents, directory) } })) : context.links;
  } else {
    retargeted.documents = absoluteList(context.documents, directory);
    retargeted.analyses = absoluteAnalyses(context.analyses, directory);
  }
  return Object.fromEntries(Object.entries(retargeted).filter(([, value]) => value !== undefined));
}

/** trace를 실행하고 meta의 trace 상태를 돌려준다. 오류는 상태로 싣고 호출자가 errors에 더한다. */
export function runTrace(isthmus, diff, contextPath, options, { execute = defaultExecute, env = process.env } = {}) {
  const context = readJson(contextPath, 'trace');
  const includeScope = (diff.mode === 'workspace') === Array.isArray(context.members);
  const { routes, omitted } = changedRouteSelection(diff, includeScope);
  const files = options.traceFiles;
  if (routes.length === 0 && files === undefined) return { status: 'skipped-no-routes' };
  const path = join(options.outputDir, 'trace-context.json');
  writeFileSync(path, `${JSON.stringify(retargetTraceContext(context, dirname(contextPath), routes, files), null, 2)}\n`);
  const result = execute(process.execPath, [isthmus.cli, 'trace', path, '--max-chains', String(options.maxChains),
    '--max-rows', String(options.maxRows)], { env: childEnvironment(env), timeout: ISTHMUS_TIMEOUT_MS });
  if (result.status !== 0) {
    return { status: 'error', exitCode: result.status, message: firstLine(result.stderr) || `isthmus trace exited with ${describeExit(result)}.`,
      ...(files === undefined ? { selected: routes.length, omittedRoutes: omitted } : { mode: 'files', selected: files.length }) };
  }
  writeFileSync(join(options.outputDir, 'trace.json'), result.stdout);
  return files === undefined ? { status: 'ran', selected: routes.length, omittedRoutes: omitted }
    : { status: 'ran', mode: 'files', selected: files.length };
}

// ── 기록 ───────────────────────────────────────────────────────────────────────

/** 출력 디렉터리를 만든다. 이전 실행의 파일과 섞이지 않게 비어 있어야 한다. */
function prepareOutputDirectory(path) {
  if (existsSync(path) && (!statSync(path).isDirectory() || readdirSync(path).length > 0)) {
    throw new CiStepError('output', 'output-dir must not exist or must be empty; choose a new directory.');
  }
  mkdirSync(path, { recursive: true });
}

/** `GITHUB_OUTPUT`에 출력 값을 쓴다. 값에 줄바꿈이 있으면 쓰지 않는다(파일 명령 주입 방지). */
export function writeActionOutputs(file, outputs) {
  if (!file) return;
  const lines = Object.entries(outputs).filter(([, value]) => value !== undefined && !/[\r\n]/u.test(String(value)))
    .map(([key, value]) => `${key}=${value}`);
  appendFileSync(file, `${lines.join('\n')}\n`);
}

/** 분석 실행 결과의 출력 값이다. */
function actionOutputs(options, meta, diff) {
  const summary = diff?.summary ?? {};
  const number = (value) => (Number.isSafeInteger(value) ? value : undefined);
  return {
    failed: String(meta.errors.length > 0 || meta.diff?.exitCode === 1), 'diff-exit-code': meta.diff?.exitCode,
    'broken-calls': number(summary.brokenCalls), 'proven-broken-calls': number(summary.provenBrokenCalls),
    incompleteness: number(summary.incompleteness),
    'call-impact': ['breaks-found', 'no-breaks-observed', 'not-assessed'].includes(summary.callImpact) ? summary.callImpact : undefined,
    'output-dir': options.outputDir, 'comment-file': join(options.outputDir, 'comment.md'),
    'diff-json': diff === undefined ? undefined : join(options.outputDir, 'diff.json'),
    'trace-json': existsSync(join(options.outputDir, 'trace.json')) ? join(options.outputDir, 'trace.json') : undefined,
  };
}

/** diff·trace·meta를 읽어 댓글을 렌더링하고 파일·job summary에 쓴다. */
function renderOutputs(options, meta, env) {
  const diffPath = join(options.outputDir, 'diff.json');
  const tracePath = join(options.outputDir, 'trace.json');
  const diff = existsSync(diffPath) ? readJson(diffPath, 'render') : undefined;
  const trace = existsSync(tracePath) ? readJson(tracePath, 'render') : undefined;
  const body = renderPrComment({ diff, trace, meta }, { maxRows: options.maxRows, key: options.commentKey });
  writeFileSync(join(options.outputDir, 'comment.md'), body);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, body);
  return diff;
}

/** 입력 모드별로 diff 입력과 trace context 경로를 준비한다. */
function prepareInputs(options, isthmus, dependencies) {
  if (options.captureConfig !== undefined) {
    const contexts = captureBothSides(options, isthmus, dependencies);
    return { inputs: diffInputsFromCaptures(contexts), traceContext: contexts[options.traceSide], revisions: contexts.revisions };
  }
  const absolute = (paths) => paths.map((path) => resolve(options.workspace, path));
  return {
    inputs: { before: absolute(options.before), after: absolute(options.after), clients: absolute(options.clients) },
    traceContext: options.traceContext === undefined ? undefined : resolve(options.workspace, options.traceContext),
  };
}

/** 분석 본체다: 설치 → 입력 → diff → trace. 단계 오류는 meta.errors에 싣고 멈춘다. */
function analyze(options, meta, dependencies) {
  requireNodeVersion();
  const isthmus = prepareIsthmus(options, dependencies);
  meta.isthmusVersion = isthmus.version;
  const { inputs, traceContext, revisions } = prepareInputs(options, isthmus, dependencies);
  if (revisions !== undefined) meta.revisions = revisions;
  const diffResult = runDiff(isthmus, inputs, options.failOn, dependencies);
  meta.diff = { exitCode: diffResult.exitCode };
  writeFileSync(join(options.outputDir, 'diff.json'), diffResult.stdout);
  if (!options.trace) { meta.trace = { status: 'disabled' }; return; }
  if (traceContext === undefined) { meta.trace = { status: 'no-context' }; return; }
  let diff;
  try { diff = JSON.parse(diffResult.stdout); }
  catch { throw new CiStepError('diff', 'isthmus diff --http printed no JSON report; rerun it locally with the same inputs.'); }
  meta.trace = { ...runTrace(isthmus, diff, traceContext, options, dependencies),
    ...(options.captureConfig === undefined ? {} : { side: options.traceSide }) };
  if (meta.trace.status === 'error') meta.errors.push({ step: 'trace', message: meta.trace.message });
}

/**
 * Action 분석 단계 진입점이다. 어떤 단계가 실패해도 meta·댓글·출력을 남긴다(실패도 댓글로 보이게).
 * 반환값은 종료 코드가 아니라 결과이며, 종료 판정은 action.yml 마지막 단계가 `failed` 출력으로 한다 —
 * 그래야 댓글 게시·artifact 업로드 단계가 실패 뒤에도 돈다.
 */
export function runCiHttpImpact(env = process.env, dependencies = {}) {
  const log = dependencies.log ?? ((line) => process.stdout.write(line));
  let options;
  const meta = { format: 'isthmus-ci-meta', version: 1, errors: [] };
  try {
    options = parseInputs(env);
    prepareOutputDirectory(options.outputDir);
  } catch (error) {
    if (!(error instanceof CiStepError)) throw error;
    // 입력·출력 디렉터리 오류는 댓글을 쓸 곳이 없으므로 고정 문구만 로그에 남기고 실패한다.
    log(`isthmus: ${error.step}: ${error.message}\n`);
    return { failed: true, meta: { ...meta, errors: [{ step: error.step, message: error.message }] } };
  }
  meta.failOn = options.failOn;
  if (options.pullRequest !== undefined) meta.pullRequest = options.pullRequest;
  try {
    analyze(options, meta, { ...dependencies, env, log });
  } catch (error) {
    // 예상하지 못한 예외도 댓글·artifact·출력을 남기도록 기록한다. 상세(경로가 섞일 수 있음)는 로그에만 감싸 싣는다.
    if (error instanceof CiStepError) meta.errors.push({ step: error.step, message: error.message });
    else {
      meta.errors.push({ step: 'internal', message: 'Unexpected failure in the action; see the step log.' });
      logUntrusted(log, 'isthmus: unexpected failure:', error?.stack ?? String(error));
    }
  }
  writeFileSync(join(options.outputDir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
  const diff = renderOutputs(options, meta, env);
  const outputs = actionOutputs(options, meta, diff);
  writeActionOutputs(env.GITHUB_OUTPUT, outputs);
  for (const error of meta.errors) log(`isthmus: step ${error.step} failed (details in the job summary and meta.json).\n`);
  return { failed: outputs.failed === 'true', meta, outputs };
}

/** 이 파일이 직접 실행됐는지다. */
function isMainModule() {
  if (process.argv[1] === undefined) return false;
  try { return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); }
  catch { return false; }
}

if (isMainModule()) {
  // 분석 단계는 결과와 무관하게 0으로 끝난다. 실패 판정은 action.yml의 마지막 단계가 한다.
  // 단, 입력 오류로 출력조차 만들지 못했으면 이 단계에서 실패시킨다.
  const result = runCiHttpImpact();
  if (result.outputs === undefined) process.exitCode = 1;
}
