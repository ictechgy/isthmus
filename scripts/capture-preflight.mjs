import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseImpactSelection } from '../dist/exchange/impact-selection.js';
import { isProjectRelativePath, isSafeNonEmptyString, parseBridgeFactsDocument } from '../dist/exchange/parse.js';
import { parsePreflightContext } from '../dist/exchange/preflight-context.js';
import { parseMessageBridgeDocument } from '../dist/exchange/messages.js';
import { adaptCartographImpact, adaptDartographImpact } from '../dist/exchange/producer-impact.js';
import { createPreflightReport, hasPreflightBlockers } from '../dist/report/preflight.js';
import { encodeSortedJson } from '../dist/report/sorted-json.js';
import { writeTextAtomically } from '../dist/cli/atomic-write.js';
import { runChild } from './run-child.mjs';

/** workflow 실패는 자식 출력·입력 경로를 오류 본문에 싣지 않는다. */
class CaptureError extends Error {}

/** 명시한 소스·설정·도구 입력이 같은 동안 수집한 producer 결과만 캐시한다. */
export async function capturePreflight(config, { execute = runChild } = {}) {
  const started = performance.now();
  const project = await realpath(config.project);
  validateConfig(config, project);
  const output = resolve(project, config.output);
  const cachePath = resolve(project, config.cache);
  const selection = {};
  for (const platform of Object.keys(config.selection ?? {})) {
    if (platform !== 'dart' && platform !== 'swift') throw new CaptureError('Unsupported selection platform.');
    selection[platform] = parseImpactSelection({ format: 'isthmus-changes', version: 1, ...config.selection[platform] });
  }
  const timings = [];
  async function run(command, args, step, accepted = [0]) {
    const start = performance.now();
    const result = await execute(command[0], [...command.slice(1), ...args], {
      cwd: project, timeout: 300_000, maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, CI: 'true', DART_SUPPRESS_ANALYTICS: 'true', FLUTTER_SUPPRESS_ANALYTICS: 'true' },
    });
    timings.push({ step, milliseconds: Math.round(performance.now() - start) });
    if (result.error || result.signal || !accepted.includes(result.status)) throw new CaptureError(`Preflight producer step failed: ${step}.`);
    return result.stdout;
  }
  async function json(command, args, step, accepted) {
    const text = await run(command, args, step, accepted);
    try { return JSON.parse(text); }
    catch { throw new CaptureError(`Preflight producer did not return JSON: ${step}.`); }
  }
  const limitations = [];
  let selectionBase = null;
  if (config.since !== undefined) {
    selectionBase = (await run(['git'], ['rev-parse', '--verify', '--end-of-options', `${config.since}^{commit}`], 'git-base')).trim();
    if (!/^[a-f0-9]{40,64}$/.test(selectionBase)) throw new CaptureError('Git did not resolve a commit for the selection.');
    const diff = await run(['git'], ['diff', '--name-status', '-z', '--find-renames', selectionBase, '--'], 'git-changes');
    const untracked = await run(['git'], ['ls-files', '--others', '--exclude-standard', '-z'], 'git-untracked');
    const paths = gitChangePaths(diff);
    for (const path of nulFields(untracked)) if (/\.(dart|swift|m|mm)$/.test(path)) paths.add(path);
    const files = { dart: [], swift: [] };
    let outsideModel = 0;
    for (const path of paths) {
      if (!isProjectRelativePath(path)) throw new CaptureError('Git returned an unsupported source path.');
      if (path.endsWith('.dart')) files.dart.push(path);
      else if (/\.(swift|m|mm)$/.test(path)) files.swift.push(path);
      else outsideModel++;
    }
    for (const platform of ['dart', 'swift']) if (files[platform].length) {
      selection[platform] = parseImpactSelection({ format: 'isthmus-changes', version: 1, files: files[platform], symbols: [] });
    }
    if (outsideModel) limitations.push(`unmodeled-changes: ${outsideModel} tracked configuration/resource change(s) require separate review`);
  }
  const tools = {};
  for (const name of ['dartograph', 'cartograph']) {
    const value = (await run(config[name], ['--version'], `${name}-version`)).trim();
    const version = name === 'dartograph' ? value.replace(/^dartograph /, '') : value;
    if (!/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(version)) throw new CaptureError('Unsupported producer version response.');
    tools[name] = { name, version };
  }
  const messageCommands = config.messages === undefined ? undefined : Object.fromEntries(['dartograph', 'cartograph']
    .map((name) => [name, config.messages === true ? config[name] : config.messages[name] ?? config[name]]));
  if (messageCommands) for (const name of ['dartograph', 'cartograph']) {
    if (JSON.stringify(messageCommands[name]) === JSON.stringify(config[name])) continue;
    const value = (await run(messageCommands[name], ['--version'], `${name}-messages-version`)).trim();
    const version = name === 'dartograph' ? value.replace(/^dartograph /, '') : value;
    if (!/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(version)) throw new CaptureError('Unsupported message producer version response.');
    tools[`${name}Messages`] = { name, version };
  }
  const keyConfig = { project, inputs: config.inputs, toolInputs: config.toolInputs, prepare: config.prepare,
    dartograph: config.dartograph, cartograph: config.cartograph, selection, selectionBase, limitations,
    indexStore: config.indexStore ?? null, messageCommands: messageCommands ?? null, tools,
    host: { node: process.version, platform: process.platform, arch: process.arch },
    toolchainEnvironment: digest(Object.fromEntries(['PATH', 'SDKROOT', 'DEVELOPER_DIR', 'FLUTTER_ROOT', 'DART_SDK', 'SWIFT_EXEC']
      .map((name) => [name, process.env[name] ?? null]))) };
  async function fingerprint() {
    const entries = [];
    let bytes = 0;
    async function visit(path, label) {
      if (entries.length >= 100_000) throw new CaptureError('Fingerprint inputs exceed the capture budget.');
      let stat;
      try { stat = await lstat(path); }
      catch (error) {
        if (error.code === 'ENOENT') { entries.push([label, 'missing']); return; }
        throw new CaptureError('Unable to read a declared fingerprint input.');
      }
      if (stat.isSymbolicLink()) throw new CaptureError('Fingerprint inputs must not contain symbolic links.');
      if (stat.isDirectory()) {
        entries.push([label, 'directory']);
        for (const name of (await readdir(path)).sort()) await visit(join(path, name), `${label}/${name}`);
      } else if (stat.isFile()) {
        bytes += stat.size;
        if (bytes > 512 * 1024 * 1024 || entries.length >= 100_000) throw new CaptureError('Fingerprint inputs exceed the capture budget.');
        const hash = createHash('sha256');
        for await (const data of createReadStream(path)) hash.update(data);
        entries.push([label, hash.digest('hex')]);
      } else throw new CaptureError('Fingerprint input is not a regular file or directory.');
    }
    for (const path of [...config.inputs].sort()) await visit(resolve(project, path), `source:${path}`);
    for (const path of [...config.toolInputs].sort()) await visit(resolve(project, path), `tool:${path}`);
    // 같은 버전 문자열의 개발 빌드도 adapter·수집 정책이 바뀌면 다시 수집한다.
    await visit(fileURLToPath(new URL('../dist', import.meta.url)), 'isthmus:dist');
    await visit(fileURLToPath(import.meta.url), 'isthmus:capture');
    await visit(fileURLToPath(new URL('./run-child.mjs', import.meta.url)), 'isthmus:runner');
    return { key: digest({ config: keyConfig, entries }), entries };
  }
  let state = await fingerprint();
  let cached;
  try { cached = JSON.parse(await readFile(cachePath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw new CaptureError('Unable to read preflight cache.'); }
  if (cached?.format === 'isthmus-preflight-cache' && cached.version === 1 && cached.key === state.key &&
    cached.contextHash === digest(cached.context) && cached.evidence?.revision === cached.context.revision &&
    cached.evidenceHash === digest(cached.evidence)) {
    try {
      const context = parsePreflightContext(cached.context);
      if (context.project === project && context.revision === `sha256:${state.key}`) {
        const confirmed = await fingerprint();
        if (confirmed.key !== state.key) throw new CaptureError('Declared inputs changed during capture.');
        await publish(`${output}.sources.json`, cached.evidence);
        await publish(output, context);
        return { cached: true, fingerprintScope: 'declared-inputs', context, report: createPreflightReport(context),
          timings, milliseconds: Math.round(performance.now() - started) };
      }
    } catch (error) { if (error instanceof CaptureError) throw error; }
  }
  for (const [index, command] of config.prepare.entries()) await run(command, [], `prepare-${index + 1}`);
  state = await fingerprint();
  const scratch = await mkdtemp(join(tmpdir(), 'isthmus-preflight-input-'));
  try {
    const nativeArgs = ['--project', project, ...(config.indexStore === undefined ? [] : ['--index-store', resolve(project, config.indexStore)])];
    const bridges = [
      parseBridgeFactsDocument(await json(config.dartograph, ['bridges', '--format', 'json', '--project', project, project], 'dart-bridges')),
      parseBridgeFactsDocument(await json(config.cartograph, ['bridges', '--target', 'flutter', '--format', 'json', ...nativeArgs], 'swift-bridges')),
    ];
    const messages = messageCommands === undefined ? undefined : [
      parseMessageBridgeDocument(await json(messageCommands.dartograph, ['bridges', '--messages', '--format', 'json', '--project', project, project], 'dart-messages')),
      parseMessageBridgeDocument(await json(messageCommands.cartograph, ['bridges', '--messages', '--target', 'flutter', '--format', 'json', ...nativeArgs], 'swift-messages')),
    ];
    const analyses = [];
    const artifacts = {};
    const metadata = (platform, requested, trigger) => ({ id: `${platform}-${analyses.length}`, project, requested,
      tool: tools[platform === 'dart' ? 'dartograph' : 'cartograph'], ...(trigger === undefined ? {} : { trigger }) });
    async function dartImpact(requested, trigger) {
      if (analyses.length >= 256) throw new CaptureError('Preflight analysis count exceeds its budget.');
      let flags;
      if (requested.files.length > 0) {
        const path = join(scratch, 'changed.json');
        await writeFile(path, JSON.stringify(requested.files), { mode: 0o600 });
        flags = ['--changed', path];
      } else flags = ['--symbol', requested.symbols[0]];
      const raw = await json(config.dartograph, ['impact', ...flags, '--format', 'json', '--limit', '50000', project], 'dart-impact');
      const meta = metadata('dart', requested, trigger);
      artifacts[meta.id] = raw;
      analyses.push(adaptDartographImpact(raw, meta));
    }
    if (selection.swift) {
      // Cartograph는 파일·심볼 선택을 한 번에 혼용하지 않으므로 각각 요청한다.
      const selections = [
        ...(selection.swift.files.length ? [{ files: selection.swift.files, symbols: [] }] : []),
        ...(selection.swift.symbols.length ? [{ files: [], symbols: selection.swift.symbols }] : []),
      ];
      for (const requested of selections) {
        const raw = await json(config.cartograph, ['impact', ...nativeArgs, '--format', 'json', '--limit', '10000',
          ...requested.files.flatMap((path) => ['--file', resolve(project, path)]),
          ...(requested.symbols.length ? ['--', ...requested.symbols] : [])], 'swift-impact');
        const meta = metadata('swift', requested);
        artifacts[meta.id] = raw;
        analyses.push(adaptCartographImpact(raw, meta));
      }
    }
    if (selection.dart) {
      if (selection.dart.files.length > 0) await dartImpact({ files: selection.dart.files, symbols: [] });
      for (const symbol of selection.dart.symbols) await dartImpact({ files: [], symbols: [symbol] });
    }
    const dartFacts = [...bridges[0].facts, ...(messages?.[0].facts ?? [])];
    const names = [...new Set(dartFacts.flatMap((fact) => fact.symbol ? [fact.symbol.qualifiedName] : []))].sort();
    const subjects = new Map();
    for (let offset = 0; offset < names.length; offset += 1000) {
      const requests = names.slice(offset, offset + 1000);
      const path = join(scratch, 'queries.json');
      await writeFile(path, JSON.stringify(requests), { mode: 0o600 });
      const document = await json(config.dartograph, ['query', '--batch', path, '--depth', '1', '--limit', '1', project], 'dart-bindings', [0, 64]);
      if (document.format !== 'symbol-query-batch' || document.version !== 1 || !Array.isArray(document.results) ||
        document.results.length !== requests.length || document.results.some((row, index) => row.requested !== requests[index])) {
        throw new CaptureError('Dart caller query responses do not match the requests.');
      }
      artifacts[`bindings-${offset}`] = document;
      for (const result of document.results) {
        if (result.status !== 'found') continue;
        const subject = result.result?.subject;
        const location = subject?.location;
        const source = location?.path?.startsWith('project:') ? location.path.slice(8) : undefined;
        if (!isSafeNonEmptyString(subject?.usr) || !isSafeNonEmptyString(subject?.qualifiedName) ||
          !isProjectRelativePath(source) || !Number.isSafeInteger(location.line) || location.line < 1 ||
          !Number.isSafeInteger(location.column) || location.column < 1) continue;
        subjects.set(result.requested, { id: subject.usr, qualifiedName: subject.qualifiedName,
          location: { path: source, line: location.line, column: location.column } });
      }
    }
    const bindings = dartFacts.flatMap((fact) => {
      const symbol = subjects.get(fact.symbol?.qualifiedName);
      return symbol?.location.path === fact.location.path
        ? [{ platform: 'dart', location: fact.location, requested: fact.symbol.qualifiedName, symbol }] : [];
    });
    const makeContext = () => parsePreflightContext({ format: 'isthmus-preflight-context', version: 1, project,
      revision: `sha256:${state.key}`, selection, bridges, ...(messages === undefined ? {} : { messages }), bindings, analyses, limitations });
    const initial = createPreflightReport(makeContext());
    const reached = new Set([...initial.roots, ...initial.affected.map(({ subject }) => subject)]
      .filter((subject) => subject.kind === 'symbol' && subject.platform === 'dart').map(({ symbol }) => symbol.id));
    const supplied = new Set(analyses.filter(({ platform }) => platform === 'dart').flatMap(({ roots }) => roots.map(({ id }) => id)));
    for (const id of [...new Set(bindings.map(({ symbol }) => symbol.id))].sort()) {
      if (reached.has(id) && !supplied.has(id)) await dartImpact({ files: [], symbols: [id] }, id);
    }
    const context = makeContext();
    const report = createPreflightReport(context);
    const confirmed = await fingerprint();
    if (confirmed.key !== state.key) throw new CaptureError('Declared inputs changed during capture.');
    const evidence = { format: 'isthmus-capture-evidence', version: 1, revision: context.revision,
      fingerprintScope: 'declared-inputs', inputs: state.entries, tools, artifacts, timings };
    await publish(`${output}.sources.json`, evidence);
    await publish(cachePath, { format: 'isthmus-preflight-cache', version: 1, key: state.key, context, contextHash: digest(context),
      evidence, evidenceHash: digest(evidence) });
    await publish(output, context);
    return { cached: false, fingerprintScope: 'declared-inputs', context, report, timings, milliseconds: Math.round(performance.now() - started) };
  } finally { await rm(scratch, { recursive: true, force: true }); }
}

function digest(value) { return createHash('sha256').update(encodeSortedJson(value, true)).digest('hex'); }

function nulFields(text) {
  if (text === '') return [];
  if (!text.endsWith('\0')) throw new CaptureError('Git returned an incomplete path list.');
  return text.slice(0, -1).split('\0');
}

/** rename·copy는 두 경로를 모두 보존하며 이름에 공백이 있어도 재분할하지 않는다. */
function gitChangePaths(text) {
  const fields = nulFields(text);
  const paths = new Set();
  for (let index = 0; index < fields.length;) {
    const status = fields[index++];
    if (!/^(?:[AMDUTX]|[RC]\d{1,3})$/.test(status)) throw new CaptureError('Git returned an unsupported change status.');
    const count = /^[RC]/.test(status) ? 2 : 1;
    for (let cursor = 0; cursor < count; cursor++) {
      if (index >= fields.length) throw new CaptureError('Git returned an incomplete change.');
      paths.add(fields[index++]);
    }
  }
  return paths;
}

async function publish(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeTextAtomically(path, encodeSortedJson(value, true));
}

/** 입력 범위와 실행할 명령은 사용자가 작성한 workflow 설정에서 명시한다. */
function validateConfig(config, project) {
  const command = (value) => Array.isArray(value) && value.length > 0 && value.every(isSafeNonEmptyString);
  if (!command(config.dartograph) || !command(config.cartograph) || !Array.isArray(config.prepare) ||
    config.prepare.length === 0 || !config.prepare.every(command)) throw new CaptureError('Configure producer commands and a native index preparation command.');
  if (config.messages !== undefined && config.messages !== true && (config.messages === null || typeof config.messages !== 'object' ||
    Array.isArray(config.messages) || Object.entries(config.messages).some(([name, value]) =>
      (name !== 'dartograph' && name !== 'cartograph') || !command(value)))) throw new CaptureError('Invalid message producer configuration.');
  if (!Array.isArray(config.inputs) || config.inputs.length === 0 || !config.inputs.every(isProjectRelativePath) ||
    !Array.isArray(config.toolInputs) || config.toolInputs.length === 0 || !config.toolInputs.every(isSafeNonEmptyString)) {
    throw new CaptureError('Declare source/config inputs and producer implementation files for fingerprinting.');
  }
  const explicit = config.selection !== undefined;
  const since = config.since !== undefined;
  if (explicit === since || (explicit && (!config.selection || typeof config.selection !== 'object' || Array.isArray(config.selection))) ||
    (since && !isSafeNonEmptyString(config.since)) || !isSafeNonEmptyString(config.output) || !isSafeNonEmptyString(config.cache)) {
    throw new CaptureError('Configure exactly one selection or since revision, plus output and cache paths.');
  }
  for (const output of [config.output, `${config.output}.sources.json`, config.cache]) {
    const target = resolve(project, output);
    for (const input of [...config.inputs, ...config.toolInputs]) {
      const part = relative(resolve(project, input), target);
      if (part === '' || (!part.startsWith('..') && !isAbsolute(part))) throw new CaptureError('Keep output and cache outside fingerprint input trees.');
    }
  }
  if (resolve(project, config.output) === resolve(project, config.cache)) throw new CaptureError('Output and cache paths must differ.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw new CaptureError('Usage: node scripts/capture-preflight.mjs <capture.json>');
    const config = JSON.parse(await readFile(process.argv[2], 'utf8'));
    const result = await capturePreflight(config);
    process.stdout.write(encodeSortedJson({ cached: result.cached, revision: result.context.revision,
      fingerprintScope: result.fingerprintScope, summary: result.report.summary, timings: result.timings, milliseconds: result.milliseconds }, true));
    process.exitCode = hasPreflightBlockers(result.report) ? 1 : 0;
  } catch (error) {
    process.stderr.write(`${error instanceof CaptureError ? error.message : 'Preflight capture failed; check configuration and producer compatibility.'}\n`);
    process.exitCode = 2;
  }
}
