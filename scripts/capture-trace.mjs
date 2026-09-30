import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  analysisSymbolsInFiles,
  buildCaptureContext,
  captureDocumentTool,
  capturedAnalysisPath,
  capturedDocumentPath,
  capturedSurfacePath,
  chunkCaptureRoots,
  expandCaptureArgument,
  isSurfaceLabel,
  listedSymbolsInFiles,
  MAX_ROOT_ARGUMENT_BYTES,
  orderCapturedMembers,
  pairsDocumentIndexes,
  parseLibraryPublicSymbols,
  parseLibrarySymbolMap,
  parseSymbolListing,
  parseTraceCaptureConfig,
  planCaptureRoots,
  planLibraryRoots,
  provisionalSurface,
  resolveCaptureLibrary,
  ROOT_NOT_FOUND_EXIT_CODE,
  rootArguments,
  selectedCaptureFiles,
  selectedSymbols,
  surfaceDocumentIndexes,
  TraceCaptureValidationError,
  unresolvedTraversalRoots,
} from '../dist/report/trace-capture.js';
import { HttpSurfaceValidationError, importHttpSurface } from '../dist/exchange/http-surface.js';
import { parseBridgeFactsDocument } from '../dist/exchange/parse.js';
import {
  analysisProject, MAX_FILE_SYMBOL_TOTAL, MAX_FILE_SYMBOL_USRS, normalizeTraceAnalysis, parseTraceContext,
} from '../dist/exchange/trace-context.js';
import { encodeSortedJson } from '../dist/report/sorted-json.js';
import { runChild } from './run-child.mjs';

/**
 * `isthmus trace` 입력 수집기다(`scripts/capture-trace.mjs <capture.json>`).
 *
 * 제품(`isthmus`)은 JSON만 읽고 생산자를 실행하지 않는다. 그래서 생산자 실행은 capture-preflight와 같이
 * 이 스크립트가 맡는다. 단계는 (a) 생산자 사실 명령 → (b) `isthmus check --pairs`로 조인 검증과 root 추출 →
 * (c) 그 root로 생산자 순회 명령 → (d) trace context·artifact·manifest 기록 → (e) 선택적으로 `isthmus trace`다.
 * 파일 선택이면 (c)를 두 단계로 나눈다: 역방향이 아닌 순회와 생산자 심볼 목록을 먼저 모으고, 선택한 파일에 놓인
 * 심볼을 찾아 역방향 순회의 root에 더한 뒤 역방향을 실행한다({@link collectFileSymbols}).
 * surface member는 (a) 뒤에 가져오거나(sha256 대조 후 복사) 문서 member에서 `isthmus surface export`로 만든다
 * ({@link captureSurface}). library consumer의 역방향 순회는 모든 다른 순회 뒤로 미룬다 — 그 root가 provider 역방향
 * 순회의 도달에서 나오기 때문이다({@link planLibraries}).
 * 모든 자식은 인자 배열로 셸 없이 실행하고, 단계마다 시간 제한을 둔다.
 */

/** 실패한 단계 이름을 싣는 오류다. 자식 출력·입력 원문은 싣지 않는다(stderr는 logs/에 저장한다). */
export class CaptureTraceError extends Error {
  /** 실패한 단계와 원인 문구를 보존한다. */
  constructor(step, message) {
    super(`Capture step ${step} failed: ${message}`);
    this.name = 'CaptureTraceError';
    this.step = step;
  }
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const isthmusMain = join(scriptDirectory, '..', 'dist', 'cli', 'main.js');
/** 자식 stdout 상한이다. trace 입력 상한(파일당 16Mi 문자)의 UTF-8 최악값보다 넉넉하다. */
const MAX_CHILD_OUTPUT_BYTES = 64 * 1024 * 1024;
/** 사전 계산 파일 읽기 상한이다. */
const MAX_PRECOMPUTED_BYTES = 64 * 1024 * 1024;
/** isthmus 자신(check·trace)의 시간 제한이다. */
const ISTHMUS_TIMEOUT_SECONDS = 600;
/** git 조회의 시간 제한이다. */
const GIT_TIMEOUT_SECONDS = 60;

/**
 * capture 설정 하나를 실행한다.
 *
 * `execute`는 테스트 주입용이다(기본 `runChild` — spawnSync 인자 배열, 셸 없음).
 * 반환값은 출력 디렉터리·context·manifest 경로와 trace 요약이다.
 */
export async function captureTrace(input, { execute = runChild, now = () => new Date() } = {}) {
  let config;
  try { config = parseTraceCaptureConfig(input); }
  catch (error) {
    if (error instanceof TraceCaptureValidationError) throw new CaptureTraceError('config', error.message);
    throw error;
  }
  const started = now();
  const generatedAt = config.generatedAt ?? started.toISOString();
  const roots = await resolveRoots(config.roots);
  const output = await prepareOutput(config.output, roots);
  const manifest = {
    format: 'isthmus-trace-capture-manifest', version: 1, status: 'running', generatedAt,
    isthmus: { version: await isthmusVersion() },
    host: { node: process.version, platform: process.platform, arch: process.arch },
    tools: {}, members: [], steps: [], artifacts: [],
  };
  const consumers = new Set(config.libraries.map(({ consumer }) => consumer));
  const session = { config, roots, output, manifest, execute, generatedAt, consumers };
  try {
    await recordTools(session);
    const libraries = await resolveLibraries(session);
    const members = [];
    for (const member of config.members) members.push(await captureFacts(session, member));
    // 모든 사실이 모인 뒤 선택을 해석한다 — 심볼 선택의 usr는 역방향 root에 더해야 하기 때문이다.
    const capturedMembers = () => members.map(({ captured }) => captured);
    let provisional;
    try {
      provisional = parseTraceContext(buildCaptureContext(config,
        orderCapturedMembers(config, capturedMembers(), config.surfaces.map(provisionalSurface)), [], libraries));
    } catch (error) { throw new CaptureTraceError('context', error.message); }
    // surface는 긴 순회 전에 모은다 — sha256이 어긋난 artifact로 순회 시간을 쓰지 않기 위해서다.
    const surfaces = [];
    for (const surface of config.surfaces) surfaces.push(await captureSurface(session, surface, members));
    for (const member of members) await capturePairs(session, member);
    // 파일 선택이면 역방향 순회를 뒤로 미룬다. 그 root에 파일의 심볼을 더하려면 먼저 목록·정방향 순회가 있어야 한다.
    const files = 'files' in provisional.selection;
    for (const member of members) await captureAnalyses(session, member, provisional, files ? 'stage1' : 'all');
    const fileSymbols = [];
    if (files) {
      manifest.fileSelection = [];
      for (const member of members) fileSymbols.push(...await collectFileSymbols(session, member, provisional));
      for (const member of members) await captureAnalyses(session, member, provisional, 'stage2');
    } else {
      for (const member of members) skipListings(session, member);
    }
    if (libraries.length > 0) {
      planLibraries(session, members, libraries);
      for (const member of members) await captureAnalyses(session, member, provisional, 'library');
    }
    // context의 분석 순서는 실행 순서가 아니라 설정 순서다(나눈 묶음은 실행 순서를 지킨다).
    for (const { captured } of members) captured.analyses.sort((left, right) => left.order - right.order);
    const context = buildCaptureContext(config, orderCapturedMembers(config, capturedMembers(), surfaces), fileSymbols, libraries);
    try { parseTraceContext(context); }
    catch (error) { throw new CaptureTraceError('context', error.message); }
    await writeOutput(output, 'trace-context.json', encodeSortedJson(context));
    if (config.trace) manifest.trace = await runTrace(session);
    manifest.status = 'complete';
    return { output, context: join(output, 'trace-context.json'), manifest: join(output, 'capture-manifest.json'),
      ...(manifest.trace === undefined ? {} : { trace: manifest.trace }),
      ...(manifest.warnings === undefined ? {} : { warnings: manifest.warnings }) };
  } catch (error) {
    manifest.status = 'failed';
    manifest.failure = error instanceof CaptureTraceError
      ? { step: error.step, message: error.message }
      : { step: 'internal', message: 'Unexpected capture failure; rerun with a smaller config to isolate the step.' };
    throw error;
  } finally {
    await writeOutput(output, 'capture-manifest.json', encodeSortedJson(manifest), true);
  }
}

/** 선언한 root를 realpath로 고정하고 디렉터리인지 확인한다. */
async function resolveRoots(declared) {
  const roots = {};
  for (const [name, path] of Object.entries(declared)) {
    let real;
    try { real = await realpath(path); }
    catch { throw new CaptureTraceError('roots', `root ${name} does not exist or is unreadable.`); }
    if (!(await stat(real)).isDirectory()) throw new CaptureTraceError('roots', `root ${name} is not a directory.`);
    roots[name] = real;
  }
  return roots;
}

/** realpath가 root 안(또는 root 자신)인지 본다. 심링크로 root 밖을 가리키는 경로를 막는다. */
function isInside(root, path) {
  return path === root || path.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
}

/** 존재하는 입력 경로 참조를 root 안의 realpath로 바꾼다. */
async function resolveExisting(reference, roots, step) {
  const root = roots[reference.root];
  const lexical = reference.path === undefined ? root : resolve(root, reference.path);
  if (!isInside(root, lexical)) throw new CaptureTraceError(step, `a path escapes root ${reference.root}.`);
  let real;
  try { real = await realpath(lexical); }
  catch { throw new CaptureTraceError(step, `a path under root ${reference.root} does not exist or is unreadable.`); }
  if (!isInside(root, real)) throw new CaptureTraceError(step, `a path under root ${reference.root} resolves outside it through a symbolic link.`);
  return real;
}

/**
 * 출력 디렉터리를 준비한다. 없거나 비어 있어야 한다 — 이전 수집의 artifact와 섞이지 않게 하고, capture가
 * 무엇도 지우지 않게 하기 위해서다. 가장 가까운 기존 조상의 realpath가 root 안인지 먼저 확인한다.
 */
async function prepareOutput(reference, roots) {
  const root = roots[reference.root];
  const lexical = resolve(root, reference.path);
  if (!isInside(root, lexical) || lexical === root) throw new CaptureTraceError('output', `the output escapes root ${reference.root}.`);
  let ancestor = lexical;
  for (;;) {
    try { await lstat(ancestor); break; }
    catch { ancestor = dirname(ancestor); }
  }
  // 끊긴 심링크는 lstat은 되지만 realpath가 실패한다 — 원인 없는 내부 오류 대신 단계 오류로 알린다.
  const realOrFail = async (path) => {
    try { return await realpath(path); }
    catch { throw new CaptureTraceError('output', `the output path under root ${reference.root} contains a dangling symbolic link.`); }
  };
  if (!isInside(root, await realOrFail(ancestor))) {
    throw new CaptureTraceError('output', `the output resolves outside root ${reference.root} through a symbolic link.`);
  }
  if (ancestor === lexical) {
    const real = await realOrFail(lexical);
    if (!isInside(root, real) || !(await stat(real)).isDirectory() || (await readdir(real)).length > 0) {
      throw new CaptureTraceError('output', 'the output directory must not exist or must be empty; choose a new directory.');
    }
    return real;
  }
  await mkdir(lexical, { recursive: true, mode: 0o700 });
  const real = await realpath(lexical);
  if (!isInside(root, real)) throw new CaptureTraceError('output', `the output resolves outside root ${reference.root}.`);
  return real;
}

/** 출력 디렉터리 안에 파일을 배타 생성한다(기존 파일·심링크를 따라가지 않는다). */
async function writeOutput(output, relative, content, replace = false) {
  const path = join(output, relative);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  // 준비 뒤 디렉터리가 심링크로 바뀌었으면 출력 밖에 쓰지 않는다(쓰기마다 부모의 realpath를 다시 본다).
  if (!isInside(output, await realpath(dirname(path)))) {
    throw new CaptureTraceError('output', 'an output subdirectory was replaced by a symbolic link during capture.');
  }
  await writeFile(path, content, { mode: 0o600, flag: replace ? 'w' : 'wx' });
  return path;
}

/** isthmus 패키지 버전이다. manifest에 소비자 버전을 남긴다. */
async function isthmusVersion() {
  const text = await readFile(join(scriptDirectory, '..', 'package.json'), 'utf8');
  return JSON.parse(text).version;
}

/**
 * 자식 하나를 실행하고 결과를 manifest에 기록한다.
 *
 * 실패 문구는 단계와 명령(도구 이름·하위 명령)만 싣는다. stderr는 입력 경로나 비밀을 담을 수 있어 터미널에
 * 옮기지 않고 출력 디렉터리의 logs/에 저장한다 — 원인은 거기서 본다.
 */
async function run(session, { step, label, command, args, timeoutSeconds, acceptExitCodes = [0], partialExitCodes = [], cwd }) {
  const begin = performance.now();
  const result = await session.execute(command[0], [...command.slice(1), ...args], {
    // SIGTERM을 무시하는 자식이 있어도 시간 제한이 지켜지도록 SIGKILL로 끝낸다.
    cwd: cwd ?? session.output, timeout: timeoutSeconds * 1000, killSignal: 'SIGKILL', maxBuffer: MAX_CHILD_OUTPUT_BYTES,
    env: { ...process.env, CI: 'true', GIT_OPTIONAL_LOCKS: '0' },
  });
  const milliseconds = Math.round(performance.now() - begin);
  const entry = { step, command: [...command, ...args], exitCode: result.status ?? null, milliseconds };
  session.manifest.steps.push(entry);
  let logHint = '';
  if (typeof result.stderr === 'string' && result.stderr.length > 0) {
    // 단계 순번을 앞에 붙여 이름을 치환한 뒤에도 서로 다른 단계의 로그가 겹치지 않게 한다.
    const ordinal = String(session.manifest.steps.length).padStart(3, '0');
    const log = `logs/${ordinal}-${step.replace(/[^A-Za-z0-9._-]/gu, '_')}.stderr.txt`;
    await writeOutput(session.output, log, result.stderr, true);
    entry.stderr = log;
    logHint = `; stderr saved to ${log}`;
  }
  if (result.error?.code === 'ETIMEDOUT') throw new CaptureTraceError(step, `${label} timed out after ${timeoutSeconds}s${logHint}.`);
  if (result.error?.code === 'ENOBUFS') throw new CaptureTraceError(step, `${label} wrote more than 64 MiB to stdout${logHint}.`);
  if (result.error) throw new CaptureTraceError(step, `${label} could not be started (${result.error.code ?? 'spawn error'}); check the tool command.`);
  if (result.status === null) throw new CaptureTraceError(step, `${label} was terminated by signal ${result.signal ?? 'unknown'}${logHint}.`);
  const partial = !acceptExitCodes.includes(result.status);
  if (partial && !partialExitCodes.includes(result.status)) {
    throw new CaptureTraceError(step, `${label} exited with status ${result.status}${logHint}.`);
  }
  // partialExitCodes의 종료 코드는 호출자가 출력을 보고 받을지 정한다(받지 않으면 같은 문구로 실패시킨다).
  return { stdout: result.stdout ?? '', entry, ...(partial ? { partial: { status: result.status, logHint } } : {}) };
}

/** manifest `warnings`에 경고 하나를 더한다(없으면 필드를 만든다 — 경고 없는 manifest는 이전과 같다). */
function warn(session, warning) {
  (session.manifest.warnings ??= []).push(warning);
}

/** stdout을 JSON으로 읽는다. */
function parseJson(text, step, label) {
  try { return JSON.parse(text); }
  catch { throw new CaptureTraceError(step, `${label} did not print a JSON document.`); }
}

/** 도구 이름과 하위 명령(첫 인자)으로 된 짧은 명령 표시다. 경로는 싣지 않는다. */
function commandLabel(tool, args) {
  const subcommand = typeof args[0] === 'string' && /^[A-Za-z][A-Za-z0-9-]{0,31}$/u.test(args[0]) ? ` ${args[0]}` : '';
  return `${tool}${subcommand}`;
}

/** 제어 문자를 지운 한 줄 버전 문자열이다. */
function oneLine(text) {
  return text.split(/\r?\n/u)[0].replace(/[\u0000-\u001f\u007f-\u009f]/gu, '').trim().slice(0, 200);
}

/** git 조회(revision·dirty)다. index를 고치지 않도록 optional lock을 끄고 fsmonitor를 쓰지 않는다. */
async function gitState(session, directory, step) {
  const head = await run(session, { step, label: 'git rev-parse', command: ['git'],
    args: ['-C', directory, 'rev-parse', '--verify', 'HEAD'], timeoutSeconds: GIT_TIMEOUT_SECONDS });
  const revision = head.stdout.trim();
  if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(revision)) throw new CaptureTraceError(step, 'git did not return a commit hash.');
  const status = await run(session, { step: `${step}:status`, label: 'git status', command: ['git'],
    args: ['-C', directory, '-c', 'core.fsmonitor=false', 'status', '--porcelain', '-z', '--untracked-files=normal'],
    timeoutSeconds: GIT_TIMEOUT_SECONDS });
  return { revision, dirty: status.stdout.length > 0 };
}

/** 쓰는 도구마다 `--version`과(선언했으면) 소스 checkout revision을 기록한다. */
async function recordTools(session) {
  const listing = listingMembers(session.config);
  const used = new Set(session.config.members.flatMap((member) => [
    ...member.documents.flatMap(({ step }) => (step ? [step.tool] : [])),
    ...member.analyses.flatMap(({ step }) => (step ? [step.tool] : [])),
    ...(listing.has(member.name) ? member.listings.flatMap(({ step }) => (step ? [step.tool] : [])) : []),
  ]));
  for (const name of [...used].sort()) {
    const tool = session.config.tools[name];
    const { stdout } = await run(session, { step: `version:${name}`, label: `${name} --version`, command: tool.command,
      args: ['--version'], timeoutSeconds: 60 });
    const record = { command: tool.command, version: oneLine(stdout) };
    if (record.version === '') throw new CaptureTraceError(`version:${name}`, `${name} --version printed nothing.`);
    if (tool.source !== undefined) {
      const source = await resolveExisting(tool.source, session.roots, `version:${name}`);
      record.source = await gitState(session, source, `source:${name}`);
    }
    session.manifest.tools[name] = record;
  }
}

/**
 * 심볼 목록을 실제로 실행할 member 이름이다 — 파일 선택이 그 member의 파일을 하나라도 고른 member.
 * 단일 project의 파일 선택(문자열)은 유일한 member를 고른다. 선택은 설정 검증에서 이미 trace 규칙으로 확인했다.
 */
function listingMembers(config) {
  const files = config.selection?.files;
  if (!Array.isArray(files)) return new Set();
  return new Set(files.map((file) => (typeof file === 'string' ? config.members[0].name : file.member)));
}

/** 파일 바이트의 SHA-256(소문자 hex)이다. */
function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

/** artifact를 manifest에 기록한다. */
function recordArtifact(session, path, content, source, extra = {}) {
  session.manifest.artifacts.push({ path, sha256: sha256(content), bytes: Buffer.byteLength(content), source, ...extra });
}

/** 사전 계산 파일을 root 안에서 읽는다. 크기 상한을 넘으면 읽지 않는다. */
async function readPrecomputed(reference, session, step) {
  const path = await resolveExisting(reference, session.roots, step);
  // 한 번 연 핸들로 종류·크기를 확인하고 그 핸들에서만 읽는다. 확인과 읽기 사이에 파일이 FIFO나 커지는
  // 파일로 바뀌어도 막히거나 상한을 넘겨 읽지 않는다(O_NONBLOCK은 FIFO 열기가 막히지 않게 한다).
  const handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new CaptureTraceError(step, 'the precomputed path is not a regular file.');
    if (info.size > MAX_PRECOMPUTED_BYTES) throw new CaptureTraceError(step, 'the precomputed file exceeds 64 MiB.');
    const buffer = Buffer.alloc(info.size + 1);
    let length = 0;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
      if (length > info.size) throw new CaptureTraceError(step, 'the precomputed file changed while it was read.');
    }
    return buffer.subarray(0, length);
  } finally { await handle.close(); }
}

/** 문서의 도구 신원(있으면)을 manifest용으로 뽑는다. */
function documentTool(value) {
  return captureDocumentTool(value);
}

/**
 * (a) member의 project·revision·catalog를 정하고 사실 문서를 모은다.
 * 생산자 문서는 bridge-facts 계약으로 즉시 검증해 잘못된 출력을 그 단계 이름으로 알린다.
 */
async function captureFacts(session, member) {
  const project = await resolveExisting(member.project, session.roots, `project:${member.name}`);
  let revision = typeof member.revision === 'string' ? member.revision : undefined;
  const record = { name: member.name, project };
  if (member.revision !== undefined && typeof member.revision !== 'string') {
    const state = await gitState(session, project, `revision:${member.name}`);
    revision = state.revision;
    Object.assign(record, { revisionSource: 'git', dirty: state.dirty });
  } else if (revision !== undefined) record.revisionSource = 'config';
  if (revision !== undefined) record.revision = revision;
  if (session.config.workspace && revision === undefined) {
    throw new CaptureTraceError(`revision:${member.name}`, 'a workspace member needs a revision (a string or {"git": true}).');
  }
  let catalog;
  if (member.catalog !== undefined) {
    const bytes = await readPrecomputed(member.catalog.graph, session, `catalog:${member.name}`);
    catalog = { graphSha: sha256(bytes), ...(member.catalog.source === undefined ? {} : { source: member.catalog.source }) };
    record.catalog = catalog;
  }
  session.manifest.members.push(record);
  const values = { project, revision, generatedAt: session.generatedAt };
  const documents = [];
  const parsed = [];
  for (const document of member.documents) {
    const step = `fact:${member.name}/${document.name}`;
    const path = capturedDocumentPath(member.name, document.name);
    let content;
    let source;
    if (document.precomputed !== undefined) {
      content = await readPrecomputed(document.precomputed, session, step);
      source = 'precomputed';
    } else {
      const args = await expandArguments(document.step.args, values, session, step);
      const label = commandLabel(document.step.tool, args);
      ({ stdout: content } = await run(session, { step, label, command: session.config.tools[document.step.tool].command, args,
        timeoutSeconds: document.step.timeoutSeconds, acceptExitCodes: document.step.acceptExitCodes }));
      source = 'captured';
    }
    const value = parseJson(content.toString('utf8'), step, document.name);
    let facts;
    try { facts = parseBridgeFactsDocument(value); }
    catch (error) { throw new CaptureTraceError(step, `${document.name} violates the bridge-facts contract: ${error.message}`); }
    if (facts.project !== project) {
      throw new CaptureTraceError(step, `${document.name} was produced for a different project than member ${member.name}; pass the member project to the producer.`);
    }
    await writeOutput(session.output, path, content);
    recordArtifact(session, path, content, source, documentTool(value));
    documents.push({ name: document.name, path });
    parsed.push(facts);
  }
  return { config: member, values, parsed, normalized: [], fileRoots: new Map(), libraryRoots: new Map(), graphNodes: new Map(),
    captured: { name: member.name, project,
    ...(revision === undefined ? {} : { revision }), ...(catalog === undefined ? {} : { catalog }), documents, analyses: [] } };
}

/**
 * library 선언의 목록 파일(`publicSymbols`·`symbolMap`이 `{root, path}`일 때)을 root 안에서 읽어 검증하고 선언을 푼다.
 * 목록 원문은 context에 실리므로 artifact로 복사하지 않고, 읽은 파일의 sha256과 항목 수를 manifest `libraries`에 남긴다.
 */
async function resolveLibraries(session) {
  const resolved = [];
  if (session.config.libraries.length > 0) session.manifest.libraries = [];
  for (const library of session.config.libraries) {
    const step = `library:${library.name}`;
    const loaded = {};
    const inputs = {};
    for (const [field, parse] of [['publicSymbols', parseLibraryPublicSymbols], ['symbolMap', parseLibrarySymbolMap]]) {
      const value = library[field];
      if (value === undefined) continue;
      if (Array.isArray(value)) {
        inputs[field] = { source: 'config', entries: value.length };
        continue;
      }
      const content = await readPrecomputed(value, session, step);
      try { loaded[field] = parse(parseJson(content.toString('utf8'), step, `the library ${field} file`)); }
      catch (error) {
        if (error instanceof TraceCaptureValidationError) throw new CaptureTraceError(step, error.message);
        throw error;
      }
      inputs[field] = { source: 'file', sha256: sha256(content), entries: loaded[field].length };
    }
    session.manifest.libraries.push({ name: library.name, consumer: library.consumer, provider: library.provider,
      ids: library.ids, inputs, platforms: [] });
    resolved.push(resolveCaptureLibrary(library, loaded));
  }
  return resolved;
}

/**
 * surface member 하나를 모은다. 가져오기는 파일 sha256을 설정의 고정 값과 대조하고(다르면 이 단계의 오류 — 다른 릴리스이거나
 * 받다가 깨졌다) 계약·digest를 검증한 뒤 복사한다. 내보내기는 원본 문서 member의 선언 측 http·openapi 문서로
 * `isthmus surface export`를 실행한다. 돌려주는 값은 context surface member다.
 */
async function captureSurface(session, member, members) {
  const step = `surface:${member.name}`;
  const path = capturedSurfacePath(member.name);
  let content;
  let source;
  if (member.surface.kind === 'import') {
    content = await readPrecomputed(member.surface.path, session, step);
    if (sha256(content) !== member.surface.sha256) {
      throw new CaptureTraceError(step, 'the http surface file does not match its pinned sha256; download the surface release '
        + 'the config names again, or update the pin after reviewing the new release.');
    }
    source = 'precomputed';
  } else {
    content = await exportSurface(session, member, members, step);
    source = 'isthmus';
  }
  const { surface } = validateSurface(content, step);
  await writeOutput(session.output, path, content);
  const digest = sha256(content);
  const identity = { name: surface.name, revision: surface.revision, privacy: surface.privacy };
  recordArtifact(session, path, content, source, { surface: identity });
  session.manifest.members.push({ name: member.name, surface: { source: member.surface.kind === 'import' ? 'imported' : 'exported',
    ...(member.surface.kind === 'export' ? { member: member.surface.member } : {}), sha256: digest, ...identity } });
  return { name: member.name, surface: { path, sha256: digest } };
}

/**
 * `isthmus surface export`를 실행해 surface 원문을 돌려준다. 문서는 capture가 이미 검증해 출력에 복사한 원본 member의
 * 선언 측 문서만 넘긴다({@link surfaceDocumentIndexes}). 공개 수준 플래그는 설정 그대로 옮긴다.
 */
async function exportSurface(session, member, members, step) {
  const { surface } = member;
  const origin = members.find(({ config }) => config.name === surface.member);
  const indexes = surfaceDocumentIndexes(origin.parsed);
  if (indexes.length === 0) {
    throw new CaptureTraceError(step, `member ${surface.member} has no http server or openapi document to publish.`);
  }
  const revision = surface.revision ?? origin.captured.revision;
  if (!isSurfaceLabel(revision)) {
    throw new CaptureTraceError(step, `member ${surface.member} revision cannot be a surface revision (at most 256 characters, `
      + 'no surrounding spaces, no leading "-"); set export.revision.');
  }
  const args = ['surface', 'export', '--name', surface.name ?? member.name, '--revision', revision,
    ...(surface.includeHandlerUsrs ? ['--include-handler-usrs'] : []),
    ...(surface.includeLimitationText ? ['--include-limitation-text'] : []),
    '--', ...indexes.map((index) => join(session.output, origin.captured.documents[index].path))];
  const { stdout } = await run(session, { step, label: 'isthmus surface export', command: [process.execPath, isthmusMain], args,
    timeoutSeconds: ISTHMUS_TIMEOUT_SECONDS });
  return stdout;
}

/** surface 원문을 trace와 같은 파서로 검증한다(계약·digest). */
function validateSurface(content, step) {
  const value = parseJson(content.toString('utf8'), step, 'the http surface');
  try { return importHttpSurface(value); }
  catch (error) {
    if (error instanceof HttpSurfaceValidationError) {
      throw new CaptureTraceError(step, `the http surface violates the isthmus-http-surface contract: ${error.message}`);
    }
    throw error;
  }
}

/**
 * library마다 consumer 역방향 root를 계산해 `member.libraryRoots`에 두고 manifest `libraries[].platforms`에 적는다.
 *
 * root는 provider의 route-call 심볼과 provider 역방향 순회가 그 호출부에서 닿은 SDK 심볼을 library 선언(`shared`·
 * `symbol-map`)대로 옮긴 것이다({@link planLibraryRoots}). 조용히 비는 곳은 모두 경고로 드러낸다.
 * - `library-no-roots`: provider에 호출부 심볼이 없거나 옮긴 id가 하나도 없다 — consumer는 그 library에서 root를 받지 못하고
 *   trace가 `library-ids-unmatched`를 남긴다.
 * - `library-map-entry-missing`: `symbol-map`에서 capture 전용 `publicSymbols`의 SDK id가 호출에서 닿았는데 대응표에 없다.
 * - `library-roots-undelivered`: 옮긴 root가 있는데 consumer에 그 platform의 생산자 명령 역방향 분석이 없고, 사전 계산 분석도
 *   그 root를 갖지 않는다 — trace가 `library-continuation-unrooted`를 남긴다.
 */
function planLibraries(session, members, libraries) {
  const byName = new Map(members.map((member) => [member.config.name, member]));
  for (const [index, library] of libraries.entries()) {
    const step = `library:${library.name}`;
    const provider = byName.get(library.provider);
    const consumer = byName.get(library.consumer);
    const record = session.manifest.libraries[index];
    const plans = planLibraryRoots(library, provider.parsed, provider.normalized);
    if (plans.length === 0) {
      warn(session, { step, code: 'library-no-roots', roots: 0,
        detail: `Provider ${library.provider} carries no route-call symbol, so consumer ${library.consumer} gets no roots from `
          + 'this library and trace reports library-ids-unmatched.' });
    }
    for (const plan of plans) record.platforms.push(libraryPlatformRecord(session, step, library, consumer, plan));
  }
}

/** library 하나·platform 하나의 계획을 consumer에 전달하고 manifest 항목을 만든다(경고 포함). */
function libraryPlatformRecord(session, step, library, consumer, plan) {
  const { platform, roots, missingMapEntries } = plan;
  const entry = { platform, callSites: plan.callSites, candidates: plan.candidates, roots: roots.length, notPublic: plan.notPublic,
    providerAnalyses: plan.providerAnalyses };
  if (plan.providerAnalyses === 0) {
    entry.notes = [`No reverse ${platform} analysis of the provider: only the call-site symbols are candidates, so public SDK `
      + 'functions that wrap them are not rooted in the consumer.'];
  }
  if (missingMapEntries.length > 0) {
    entry.missingMapEntries = missingMapEntries;
    warn(session, { step, code: 'library-map-entry-missing', roots: missingMapEntries.length,
      detail: `${missingMapEntries.length} public ${platform} SDK id(s) reached by the provider's call sites have no symbolMap `
        + `entry (listed in libraries[].platforms[].missingMapEntries), so consumer ${library.consumer} is not rooted at them `
        + 'and trace counts them only as notPublic; add the entries.' });
  }
  if (roots.length === 0) {
    warn(session, { step, code: 'library-no-roots', roots: 0,
      detail: `None of the ${plan.candidates} ${platform} SDK id(s) known from the provider's call sites translate to a consumer `
        + `id through the library declaration (${plan.notPublic} outside the declared public API), so consumer `
        + `${library.consumer} gets no roots from this library and trace reports library-ids-unmatched.` });
    return entry;
  }
  const delivered = consumer.config.analyses.some((analysis) => analysis.platform === platform && isDeferred(analysis));
  entry.delivered = delivered;
  if (delivered) {
    consumer.libraryRoots.set(platform, [...new Set([...consumer.libraryRoots.get(platform) ?? [], ...roots])]);
    return entry;
  }
  // 생산자 명령이 없으면 root를 넘길 수 없다. 이미 모은 사전 계산 역방향 분석이 root로 가진 id는 trace가 잇으므로 뺀다.
  const covered = new Set(consumer.normalized.filter((analysis) => analysis.role === 'reverse' && analysis.platform === platform)
    .flatMap(({ graph }) => graph.roots.map(({ id }) => id)));
  const uncovered = roots.filter((root) => !covered.has(root));
  if (uncovered.length > 0) {
    entry.undelivered = uncovered.length;
    warn(session, { step, code: 'library-roots-undelivered', roots: uncovered.length,
      detail: `Consumer ${library.consumer} has no reverse ${platform} analysis with a producer command, so ${uncovered.length} `
        + 'library root(s) that no precomputed analysis covers were not passed to a traversal and trace reports '
        + 'library-continuation-unrooted for them.' });
  }
  return entry;
}

/** 인자 목록의 자리표시자와 경로 참조를 푼다. 경로 참조는 존재해야 하고 root 안이어야 한다. */
async function expandArguments(args, values, session, step) {
  const resolved = new Map();
  for (const argument of args) {
    if (typeof argument !== 'string') resolved.set(argument, await resolveExisting(argument, session.roots, step));
  }
  try { return args.map((argument) => expandCaptureArgument(argument, values, (reference) => resolved.get(reference))); }
  catch (error) {
    if (error instanceof TraceCaptureValidationError) throw new CaptureTraceError(step, error.message);
    throw error;
  }
}

/**
 * (b) member 문서로 `isthmus check --pairs`를 실행한다.
 *
 * 조인이 계약대로 서는지 순회 전에 확인하고, 쌍을 `pairs/<member>.json`에 남겨 수동 왕복과 대조할 수 있게 한다.
 * 양쪽 측이 모두 있는 도메인의 문서만 넘긴다({@link pairsDocumentIndexes}). root 자체는 같은 사실 문서에서
 * 뽑는다({@link planCaptureRoots}) — 쌍은 호출이 없는 핸들러, 사용이 없는 relation, member 사이 호출을
 * 싣지 않으므로 root 원천으로는 부분 집합이기 때문이다.
 */
async function capturePairs(session, member) {
  const step = `pairs:${member.config.name}`;
  const indexes = pairsDocumentIndexes(member.parsed);
  if (indexes.length === 0) {
    session.manifest.steps.push({ step, skipped: 'no domain in this member has both sides (check --pairs would reject it)' });
    return;
  }
  const args = ['check', '--pairs', ...indexes.map((index) => join(session.output, member.captured.documents[index].path))];
  const { stdout, entry } = await run(session, { step, label: 'isthmus check --pairs', command: [process.execPath, isthmusMain], args,
    timeoutSeconds: ISTHMUS_TIMEOUT_SECONDS });
  const report = parseJson(stdout, step, 'isthmus check --pairs');
  const path = `pairs/${member.config.name}.json`;
  await writeOutput(session.output, path, stdout);
  recordArtifact(session, path, stdout, 'isthmus');
  const matches = Array.isArray(report.matches) ? report.matches : [];
  entry.pairs = {
    http: matches.filter(({ domain }) => domain === 'http').length,
    persistence: matches.filter(({ domain }) => domain === 'persistence').length,
  };
}

/** 파일 선택의 2단계로 미루는 분석이다 — 생산자 명령으로 실행하는 역방향 순회. */
function isDeferred(analysis) {
  return analysis.role === 'reverse' && analysis.step !== undefined;
}

/**
 * 이 단계(`phase`)에서 실행할 분석인지 본다. library consumer의 미루는 역방향 순회는 언제나 마지막 `library` 단계에서만
 * 실행한다 — 그 root가 provider 역방향 순회(파일 선택이면 2단계일 수 있다)의 도달에서 나오기 때문이다.
 */
function runsInPhase(phase, analysis, consumer) {
  const library = consumer && isDeferred(analysis);
  if (phase === 'all') return !library;
  if (phase === 'stage1') return !isDeferred(analysis);
  if (phase === 'stage2') return isDeferred(analysis) && !library;
  return library;
}

/**
 * (c) member의 순회 분석을 모은다. 생산자 명령은 사실 문서에서 뽑은 root로 실행하고, root가 많으면 나눠
 * 여러 분석으로 기록한다(trace가 같은 역할·플랫폼·member 분석을 합친다). 사전 계산 artifact는 복사하고
 * sha256을 `precomputed`에 싣는다.
 *
 * `phase`: `all`은 library consumer의 역방향을 뺀 전부, `stage1`은 미룬 역방향을 뺀 나머지, `stage2`는 미룬 역방향 중
 * library consumer의 것을 뺀 나머지, `library`는 library consumer의 미룬 역방향만 실행한다({@link runsInPhase}).
 * `stage2`의 root에는 {@link collectFileSymbols}가 찾은 파일 심볼(`member.fileRoots`)을, `library`의 root에는 그것과
 * {@link planLibraries}가 provider에서 옮긴 SDK id(`member.libraryRoots`)를 더한다.
 */
async function captureAnalyses(session, member, provisional, phase) {
  const memberName = session.config.workspace ? member.config.name : undefined;
  const ids = new Set(session.config.members.flatMap(({ analyses }) => analyses.map(({ id }) => id)));
  const consumer = session.consumers.has(member.config.name);
  for (const [order, analysis] of member.config.analyses.entries()) {
    if (!runsInPhase(phase, analysis, consumer)) continue;
    const step = `analysis:${analysis.id}`;
    if (analysis.precomputed !== undefined) {
      await capturePrecomputedAnalysis(session, member, analysis, provisional, step, order);
      continue;
    }
    const extra = phase === 'stage2' || phase === 'library' ? [...member.fileRoots.get(analysis.platform) ?? [],
      ...(phase === 'library' ? member.libraryRoots.get(analysis.platform) ?? [] : [])] : [];
    const plan = planCaptureRoots(member.parsed, analysis.role, analysis.platform,
      [...selectedSymbols(provisional, memberName, analysis.platform), ...extra], member.graphNodes.get(analysis.platform));
    recordRootFilter(session, memberName, analysis, plan);
    const { roots } = plan;
    if (roots.length === 0) {
      // library consumer는 provider에서 받은 root가 없다는 경고(library-no-roots 등)가 따로 남는다.
      session.manifest.steps.push({ step, skipped: phase === 'library'
        ? 'no roots: neither the member documents nor its library providers give a traversable symbol for this role and platform (see warnings)'
        : 'no roots: the member documents carry no traversable symbol for this role and platform' });
      continue;
    }
    const delivery = analysis.step.roots;
    let chunks;
    // root id는 생산자 출력에서 온 신뢰하지 않는 값이다. 인자 상한을 넘는 id는 이 단계의 오류로 알린다.
    try {
      chunks = chunkCaptureRoots(roots, analysis.step.maxRootsPerRun,
        delivery === 'roots-from' ? Number.MAX_SAFE_INTEGER : MAX_ROOT_ARGUMENT_BYTES);
    } catch (error) {
      if (error instanceof TraceCaptureValidationError) throw new CaptureTraceError(step, `${error.message} Use roots "roots-from".`);
      throw error;
    }
    for (const [index, chunk] of chunks.entries()) {
      const id = chunks.length === 1 ? analysis.id : `${analysis.id}.${index + 1}`;
      if (id !== analysis.id) {
        if (ids.has(id)) throw new CaptureTraceError(step, `split analysis id ${id} collides with another analysis id.`);
        ids.add(id);
      }
      await runTraversal(session, member, analysis, id, chunk, provisional, order);
    }
  }
}

/**
 * root 위생({@link planCaptureRoots})이 뺀 id를 manifest `rootFilters`에 남긴다. 뺀 것이 없으면 쓰지 않는다.
 *
 * 선언 이름공간 id는 생산자가 노드가 아니라고 밝힌 것이라 수만 싣는다. 목록에 없는 id는 생산자 사실과 그래프가 어긋난
 * 것이라 id 전체를 싣고 경고로도 알린다 — 조용히 빼지 않는다. trace가 그 id를 따라가야 하면 `analysis-missing`이 남는다.
 */
function recordRootFilter(session, memberName, analysis, plan) {
  const { declarationNamespace, notInListing } = plan;
  if (declarationNamespace.length === 0 && notInListing.length === 0) return;
  const record = { analysis: analysis.id, ...(memberName === undefined ? {} : { member: memberName }),
    platform: analysis.platform, role: analysis.role, declarationNamespace: declarationNamespace.length,
    ...(notInListing.length === 0 ? {} : { notInListing }) };
  (session.manifest.rootFilters ??= []).push(record);
  if (notInListing.length > 0) {
    warn(session, { step: `analysis:${analysis.id}`, code: 'roots-not-in-listing', roots: notInListing.length,
      detail: `${notInListing.length} fact symbol(s) are not nodes of the ${analysis.platform} symbol listing and were not `
        + 'passed as roots (see rootFilters); trace reports analysis-missing where a chain needs them.' });
  }
}

/** 파일 선택이 아닐 때 선언된 심볼 목록은 실행하지 않고 이유를 manifest에 남긴다. */
function skipListings(session, member) {
  for (const { platform } of member.config.listings) {
    session.manifest.steps.push({ step: `listing:${member.config.name}/${platform}`,
      skipped: 'symbol listings are used only by a files selection' });
  }
}

/**
 * 파일 선택의 2단계 준비: 선택한 파일에 놓인 심볼을 platform마다 찾고, 역방향 root에 더할 것을 `member.fileRoots`에
 * 둔다. 돌려주는 값은 context `fileSymbols` 항목이다.
 *
 * - 목록이 있는 platform: 생산자 목록이 파일에 둔 심볼 전부(완전). context `fileSymbols`에 싣는다 — tsograph처럼 순회
 *   root에 위치를 싣지 않는 생산자는 분석만으로 trace가 그 심볼이 파일에 있다는 것을 알 수 없기 때문이다.
 * - 목록이 없는 platform: 1단계 순회(정방향·사전 계산)가 파일에 위치시킨 심볼(부분). 이미 분석 위치로 trace에 보이므로
 *   `fileSymbols`에 싣지 않고 root에만 더한다. 닿지 않은 심볼은 여전히 빠질 수 있어 manifest에 그렇게 적는다.
 * 파일 심볼을 정방향 root에는 더하지 않는다 — trace의 파일 체인은 파일 심볼의 역방향 도달만 쓴다.
 */
async function collectFileSymbols(session, member, provisional) {
  const memberName = session.config.workspace ? member.config.name : undefined;
  const files = selectedCaptureFiles(provisional, memberName);
  if (files.length === 0) {
    for (const { platform } of member.config.listings) {
      session.manifest.steps.push({ step: `listing:${member.config.name}/${platform}`,
        skipped: 'the files selection selects no file of this member' });
    }
    return [];
  }
  const platforms = new Set([...member.config.listings.map(({ platform }) => platform),
    ...member.config.analyses.filter(({ platform }) => platform !== 'sql').map(({ platform }) => platform)]);
  const entries = [];
  for (const platform of [...platforms].sort()) {
    const listing = member.config.listings.find((entry) => entry.platform === platform);
    const record = { ...(memberName === undefined ? {} : { member: memberName }), platform, files: files.length, notes: [] };
    let byFile;
    if (listing === undefined) {
      byFile = analysisSymbolsInFiles(member.normalized.filter((analysis) => analysis.platform === platform), files);
      Object.assign(record, { source: 'traversal', complete: false });
      record.notes.push('No symbol listing for this platform: only symbols that stage-1 traversals located in the selected '
        + 'files are rooted, so file symbols they did not reach can still leave trace with a fact-location fallback.');
    } else {
      const parsed = await captureListing(session, member, listing);
      member.graphNodes.set(platform, new Set(parsed.ids));
      byFile = listedSymbolsInFiles(parsed, files);
      requireFileSymbolBudget(byFile, entries, `listing:${member.config.name}/${platform}`);
      Object.assign(record, { source: 'listing', listing: parsed.format, complete: true, skipped: parsed.skipped });
      for (const [path, usrs] of byFile) entries.push({ ...(memberName === undefined ? {} : { member: memberName }), path, platform, usrs });
    }
    const symbols = [...new Set([...byFile.values()].flat())].sort();
    const existing = new Set(planCaptureRoots(member.parsed, 'reverse', platform, selectedSymbols(provisional, memberName, platform),
      member.graphNodes.get(platform)).roots);
    const added = symbols.filter((usr) => !existing.has(usr));
    const rerooted = member.config.analyses.some((analysis) => analysis.platform === platform && isDeferred(analysis));
    if (rerooted) member.fileRoots.set(platform, added);
    else if (added.length > 0) {
      record.notes.push('No reverse analysis with a producer command for this platform: the file symbols are not rooted, '
        + 'so trace reports analysis-missing for them.');
    }
    Object.assign(record, { symbols: symbols.length, reverseRoots: rerooted ? added.length : 0 });
    if (record.notes.length === 0) delete record.notes;
    session.manifest.fileSelection.push(record);
  }
  return entries;
}

/**
 * 목록이 찾은 파일 심볼이 context `fileSymbols` 상한 안인지 역방향 순회 전에 확인한다. 넘으면 순회를 돌린 뒤 context
 * 검증에서야 실패하지 않도록 이 목록 단계의 오류로 알린다. 잘라 싣지 않는다 — 자른 목록은 완전하다는 주장이 거짓이 된다.
 */
function requireFileSymbolBudget(byFile, entries, step) {
  const largest = Math.max(0, ...[...byFile.values()].map((usrs) => usrs.length));
  if (largest > MAX_FILE_SYMBOL_USRS) {
    throw new CaptureTraceError(step, `a selected file has ${largest} listed symbols, above the fileSymbols limit of `
      + `${MAX_FILE_SYMBOL_USRS} per file; select smaller files.`);
  }
  const total = entries.reduce((sum, { usrs }) => sum + usrs.length, 0) + [...byFile.values()].reduce((sum, usrs) => sum + usrs.length, 0);
  if (total > MAX_FILE_SYMBOL_TOTAL) {
    throw new CaptureTraceError(step, `the selected files have ${total} listed symbols, above the fileSymbols limit of `
      + `${MAX_FILE_SYMBOL_TOTAL}; select fewer files.`);
  }
}

/** 생산자 심볼 목록 하나를 실행(또는 복사)하고 검증해 artifact로 남긴다. */
async function captureListing(session, member, listing) {
  const step = `listing:${member.config.name}/${listing.platform}`;
  let content;
  let source;
  if (listing.precomputed !== undefined) {
    content = await readPrecomputed(listing.precomputed, session, step);
    source = 'precomputed';
  } else {
    const args = await expandArguments(listing.step.args, member.values, session, step);
    ({ stdout: content } = await run(session, { step, label: commandLabel(listing.step.tool, args),
      command: session.config.tools[listing.step.tool].command, args,
      timeoutSeconds: listing.step.timeoutSeconds, acceptExitCodes: listing.step.acceptExitCodes }));
    source = 'captured';
  }
  const value = parseJson(content.toString('utf8'), step, `the ${listing.platform} symbol listing`);
  let parsed;
  try { parsed = parseSymbolListing(value, listing.platform, member.values.project); }
  catch (error) {
    if (error instanceof TraceCaptureValidationError) throw new CaptureTraceError(step, error.message);
    throw error;
  }
  const path = `${member.config.name}/listings/${listing.platform}.json`;
  if (listing.artifact === 'digest-only') {
    session.manifest.listingInputs ??= [];
    session.manifest.listingInputs.push({ member: member.config.name, platform: listing.platform,
      source, sha256: sha256(content), bytes: Buffer.byteLength(content), ...documentTool(value) });
    return parsed;
  }
  await writeOutput(session.output, path, content);
  recordArtifact(session, path, content, source, documentTool(value));
  return parsed;
}

/** 한 묶음의 root로 생산자 순회 명령을 실행하고 결과를 검증해 기록한다. */
async function runTraversal(session, member, analysis, id, roots, provisional, order) {
  const step = `analysis:${id}`;
  let rootsFile;
  if (analysis.step.roots === 'roots-from') {
    const relative = `${member.config.name}/roots/${id}.json`;
    rootsFile = await writeOutput(session.output, relative, `${JSON.stringify(roots)}\n`);
  }
  const base = await expandArguments(analysis.step.args, member.values, session, step);
  let args;
  try { args = [...base, ...rootArguments(analysis.step.roots, roots, rootsFile)]; }
  catch (error) {
    if (error instanceof TraceCaptureValidationError) throw new CaptureTraceError(step, error.message);
    throw error;
  }
  const label = commandLabel(analysis.step.tool, base);
  const { acceptExitCodes } = analysis.step;
  const { stdout, entry, partial } = await run(session, { step, label, command: session.config.tools[analysis.step.tool].command,
    args, timeoutSeconds: analysis.step.timeoutSeconds, acceptExitCodes,
    partialExitCodes: acceptExitCodes.includes(ROOT_NOT_FOUND_EXIT_CODE) ? [] : [ROOT_NOT_FOUND_EXIT_CODE] });
  entry.roots = roots.length;
  const path = capturedAnalysisPath(member.config.name, id);
  const reference = { id, platform: analysis.platform, role: analysis.role, path,
    ...(session.config.workspace ? { member: member.config.name } : {}) };
  // 받지 않은 종료 코드(64)는 root-not-found를 기록한 유효한 순회 문서일 때만 부분 성공으로 받는다. 아니면 이전과 같은
  // 문구로 실패한다 — 문서 없는 사용법 오류(빈 stdout)를 부분 성공으로 읽지 않기 위해서다.
  const refuse = (why) => new CaptureTraceError(step, `${label} exited with status ${partial.status}${partial.logHint}; ${why}.`);
  let value;
  let normalized;
  if (partial === undefined) {
    value = parseJson(stdout, step, label);
    normalized = validateAnalysis(value, reference, provisional, step, label);
  } else {
    try { value = JSON.parse(stdout); }
    catch { throw refuse('it printed no traversal document'); }
    try { normalized = normalizeTraceAnalysis(value, reference, analysisProject(provisional, reference)); }
    catch (error) { throw refuse(`its output violates the traversal contract: ${error.message}`); }
  }
  const unresolved = unresolvedTraversalRoots(normalized.graph, roots);
  if (partial !== undefined && unresolved.unrequested.length > 0) {
    throw refuse(`its document reports ${unresolved.unrequested.length} root-not-found id(s) that were never passed as roots `
      + '(a traversal contract violation)');
  }
  if (partial !== undefined && unresolved.roots.length === 0) {
    throw refuse('its document records no root-not-found root among the roots it was given');
  }
  if (unresolved.roots.length > 0 || unresolved.unrequested.length > 0) {
    recordRootsNotFound(session, entry, step, unresolved, partial !== undefined);
  }
  member.normalized.push(normalized);
  await writeOutput(session.output, path, stdout);
  recordArtifact(session, path, stdout, 'captured', documentTool(value));
  member.captured.analyses.push({ id, platform: analysis.platform, role: analysis.role, path, order });
}

/**
 * 생산자가 root-not-found로 돌려준 root를 manifest 단계 항목(`rootsNotFound`)과 `warnings`에 남긴다.
 *
 * 순회 문서는 그대로 싣는다 — 다른 root의 도달은 온전하고, trace가 문서의 `root-not-found:` limitation을
 * `analysisLimitations`로 싣고, 그 root를 따라가야 하는 hop만 `analysis-root-not-found` gap으로 드러낸다(찾은 root의 hop에는
 * 잘림 gap이 붙지 않는다 — root 단위 판정). `accepted`는 설정의 acceptExitCodes 밖의 64를 이 규칙으로 받았다는 표시다.
 */
function recordRootsNotFound(session, entry, step, { roots, unrequested }, accepted) {
  if (roots.length > 0) entry.rootsNotFound = roots;
  // 종료 코드 64에서는 거부한다. 그 밖에서는 문서를 받되, 넘기지 않은 id를 못 찾았다는 계약 위반을 경고로 드러낸다.
  if (unrequested.length > 0) entry.rootsNotFoundUnrequested = unrequested;
  if (accepted) entry.acceptedPartial = 'root-not-found';
  const extra = unrequested.length === 0 ? ''
    : ` It also reports ${unrequested.length} id(s) that were never passed as roots (rootsNotFoundUnrequested; a traversal contract violation).`;
  warn(session, { step, code: 'root-not-found', roots: roots.length,
    detail: `The producer could not resolve ${roots.length} root(s) (listed in the step's rootsNotFound); the traversal `
      + `of the other roots was kept, and trace reports the gap where a chain needs the missing roots.${extra}` });
}

/** 사전 계산 순회를 복사하고 증언(sha256·revision)을 붙인다. */
async function capturePrecomputedAnalysis(session, member, analysis, provisional, step, order) {
  const content = await readPrecomputed(analysis.precomputed.path, session, step);
  const value = parseJson(content.toString('utf8'), step, `precomputed ${analysis.id}`);
  // 증언 revision: 설정이 밝힌 값, 없으면 문서가 싣는 revision. 둘 다 없으면 묶을 revision이 없어 받지 않는다.
  const revision = analysis.precomputed.revision ?? (typeof value?.revision === 'string' ? value.revision : undefined);
  if (revision === undefined) {
    throw new CaptureTraceError(step, `precomputed analysis ${analysis.id} carries no revision; add precomputed.revision (the source revision it was built from).`);
  }
  const path = capturedAnalysisPath(member.config.name, analysis.id);
  const precomputed = { sha256: sha256(content), revision,
    ...(analysis.precomputed.generatedAt === undefined ? {} : { generatedAt: analysis.precomputed.generatedAt }) };
  const reference = { id: analysis.id, platform: analysis.platform, role: analysis.role, path, precomputed,
    ...(session.config.workspace ? { member: member.config.name } : {}) };
  member.normalized.push(validateAnalysis(value, reference, provisional, step, `precomputed ${analysis.id}`));
  await writeOutput(session.output, path, content);
  recordArtifact(session, path, content, 'precomputed', documentTool(value));
  member.captured.analyses.push({ id: analysis.id, platform: analysis.platform, role: analysis.role, path, precomputed, order });
}

/** trace와 같은 파서·어댑터로 순회를 검증한다(형식·방향·플랫폼·project·revision 증언). */
function validateAnalysis(value, reference, provisional, step, label) {
  try { return normalizeTraceAnalysis(value, reference, analysisProject(provisional, reference)); }
  catch (error) { throw new CaptureTraceError(step, `${label} output violates the traversal contract: ${error.message}`); }
}

/** (e) 수집한 context로 `isthmus trace`를 실행하고 요약을 돌려준다. */
async function runTrace(session) {
  const step = 'trace';
  const { stdout } = await run(session, { step, label: 'isthmus trace', command: [process.execPath, isthmusMain],
    args: ['trace', join(session.output, 'trace-context.json')], timeoutSeconds: ISTHMUS_TIMEOUT_SECONDS });
  const report = parseJson(stdout, step, 'isthmus trace');
  await writeOutput(session.output, 'trace.json', stdout);
  recordArtifact(session, 'trace.json', stdout, 'isthmus');
  const gapCodes = {};
  for (const { code } of report.gaps ?? []) gapCodes[code] = (gapCodes[code] ?? 0) + 1;
  return { path: 'trace.json', summary: report.summary, gapCodes };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw new CaptureTraceError('usage', 'Usage: node scripts/capture-trace.mjs <capture.json>');
    let text;
    try { text = await readFile(process.argv[2], 'utf8'); }
    catch { throw new CaptureTraceError('config', 'the capture config could not be read.'); }
    const result = await captureTrace(parseJson(text, 'config', 'the capture config'));
    // 경고는 결과 JSON(stdout)과 manifest에 싣고, 사람이 놓치지 않게 stderr에도 한 줄씩 알린다.
    for (const { step, code, detail } of result.warnings ?? []) process.stderr.write(`Capture warning (${step}, ${code}): ${detail}\n`);
    process.stdout.write(encodeSortedJson(result));
  } catch (error) {
    process.stderr.write(`${error instanceof CaptureTraceError ? error.message
      : 'Trace capture failed unexpectedly; check the configuration and producer compatibility.'}\n`);
    process.exitCode = 2;
  }
}
