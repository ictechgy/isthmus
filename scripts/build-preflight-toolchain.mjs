import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChild } from './run-child.mjs';

const names = ['isthmus', 'cartograph', 'dartograph', 'kartograph'];

/** 변경 중인 작업 트리 대신 명시한 immutable commit의 소스만 구축한다. */
export function parseToolchainManifest(input) {
  if (!record(input) || input.format !== 'isthmus-toolchain-build' || input.version !== 1 ||
    !text(input.destination) || !record(input.repositories) ||
    Object.keys(input.repositories).some((name) => !names.includes(name))) throw new Error('Invalid toolchain build manifest.');
  if (input.repositories.cartograph === undefined && input.repositories.kartograph === undefined) {
    throw new Error('Configure at least one native producer repository.');
  }
  const repositories = {};
  for (const name of names) {
    const entry = input.repositories[name];
    if ((name === 'cartograph' || name === 'kartograph') && entry === undefined) continue;
    if (!record(entry) || !text(entry.path) || typeof entry.revision !== 'string' || !/^[a-f0-9]{40}$/u.test(entry.revision)) {
      throw new Error('Each toolchain repository requires a local path and full commit id.');
    }
    repositories[name] = { path: entry.path, revision: entry.revision };
  }
  return { format: input.format, version: 1, destination: input.destination, repositories };
}

/** 새 디렉터리에 source archive·실행 파일·설치된 CLI와 재사용할 명령 목록을 만든다. */
export async function buildToolchain(input, base = process.cwd(), onStep = () => {}) {
  const config = parseToolchainManifest(input);
  const selectedNames = names.filter((name) => config.repositories[name] !== undefined);
  const destination = resolve(base, config.destination);
  if (await exists(destination)) throw new Error('Toolchain destination already exists; choose a new directory.');
  const repositories = {};
  // source commit 오류를 발견했을 때 SDK 준비나 destination 쓰기를 시작하지 않는다.
  for (const name of selectedNames) {
    const path = await realpath(resolve(base, config.repositories[name].path));
    const revision = config.repositories[name].revision;
    const result = runChild('git', ['-c', 'core.fsmonitor=false', '-C', path, 'rev-parse', '--verify', `${revision}^{commit}`]);
    if (result.status !== 0 || result.stdout.trim() !== revision) throw new Error(`Unable to resolve ${name} commit.`);
    repositories[name] = { path, revision };
  }
  const evidence = await mkdtemp(join(tmpdir(), 'isthmus-toolchain-build-evidence-'));
  const steps = [];
  const started = performance.now();
  let created = false;
  const environment = { ...process.env, CI: 'true', FLUTTER_SUPPRESS_ANALYTICS: 'true',
    GIT_TERMINAL_PROMPT: '0', LLVM_PROFILE_FILE: join(evidence, 'profile-%p.profraw') };
  async function command(label, executable, args, cwd = destination, timeout = 600_000) {
    onStep(label);
    const began = performance.now();
    const result = runChild(executable, args, { cwd, timeout, env: environment, maxBuffer: 32 * 1024 * 1024 });
    const log = join(evidence, `${steps.length}-${label}.log`);
    await writeFile(log, `${result.stdout ?? ''}\n${result.stderr ?? ''}`, { mode: 0o600 });
    steps.push({ label, milliseconds: Math.round(performance.now() - began), exitCode: result.status });
    if (result.status !== 0 || result.error) throw new Error(`Toolchain step failed: ${label}; see ${log}`);
    return result.stdout.trim();
  }
  try {
    await mkdir(destination, { mode: 0o700 }); created = true;
    for (const name of selectedNames) {
      const source = join(destination, 'sources', name);
      const archive = join(evidence, `${name}.tar`);
      await mkdir(source, { recursive: true });
      await command(`${name}-archive`, 'git', ['-c', 'core.fsmonitor=false', '-C', repositories[name].path,
        'archive', '--format=tar', '--output', archive, repositories[name].revision]);
      await command(`${name}-extract`, 'tar', ['-xf', archive, '-C', source]);
      repositories[name].checkout = source;
    }
    const commands = {};
    const nativeFiles = [];
    const artifacts = {};
    let swiftVersion;
    let javaVersion;
    const dartVersion = await command('dart-version', 'dart', ['--version']);
    if (repositories.cartograph !== undefined) {
      swiftVersion = await command('swift-version', 'swift', ['--version']);
      const native = repositories.cartograph.checkout;
      await command('cartograph-build', 'swift', ['build', '--package-path', native, '--configuration', 'debug', '--skip-update']);
      const reported = await command('cartograph-bin-path', 'swift', ['build', '--package-path', native, '--configuration', 'debug', '--show-bin-path']);
      const candidates = [join(native, '.build/out/Products/Debug/cartograph'), join(reported, 'cartograph')];
      const binaries = [...new Set(await Promise.all(candidates.map(async (path) => {
        try { return await realpath(path); } catch { return undefined; }
      })))].filter(Boolean);
      if (binaries.length !== 1) throw new Error('Swift build did not identify one cartograph executable.');
      const cartograph = binaries[0];
      await command('cartograph-impact-help', cartograph, ['impact', '--help']);
      const messageHelp = await command('cartograph-messages-help', cartograph, ['bridges', '--help']);
      if (!messageHelp.includes('--messages')) throw new Error('The cartograph commit does not support message facts.');
      commands.cartograph = [cartograph];
      nativeFiles.push(['cartograph', cartograph]);
    }
    if (repositories.kartograph !== undefined) {
      javaVersion = await command('java-version', process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin/java') : 'java', ['--version']);
      const kotlinRoot = repositories.kartograph.checkout;
      await command('kartograph-build', join(kotlinRoot, 'gradlew'), ['--no-daemon', ':cli:installDist'], kotlinRoot);
      const kartograph = join(kotlinRoot, 'cli/build/install/kartograph/bin/kartograph');
      const libraryRoot = join(kotlinRoot, 'cli/build/install/kartograph/lib');
      await command('kartograph-impact-help', kartograph, ['impact', '--help']);
      const bridgeHelp = await command('kartograph-messages-help', kartograph, ['bridges', '--help']);
      if (!bridgeHelp.includes('--messages') || !bridgeHelp.includes('--graph-file')) {
        throw new Error('The kartograph commit does not support indexed message facts.');
      }
      commands.kartograph = [kartograph];
      nativeFiles.push(['kartograph', kartograph]);
      artifacts.kartographInputs = [kartograph, libraryRoot];
    }
    const dartRoot = repositories.dartograph.checkout;
    await command('dartograph-dependencies', 'dart', ['pub', 'get'], dartRoot);
    await mkdir(join(destination, 'bin'));
    const dartograph = join(destination, 'bin/dartograph');
    await command('dartograph-build', 'dart', ['compile', 'exe', 'bin/dartograph.dart', '-o', dartograph], dartRoot);
    const dartHelp = await command('dartograph-messages-help', dartograph, ['--help']);
    if (!dartHelp.includes('--messages')) throw new Error('The dartograph commit does not support message facts.');
    const nodeRoot = repositories.isthmus.checkout;
    await command('isthmus-dependencies', 'npm', ['ci'], nodeRoot);
    await command('isthmus-build', 'npm', ['run', 'build'], nodeRoot);
    const packed = JSON.parse(await command('isthmus-pack', 'npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', destination], nodeRoot));
    if (packed.length !== 1 || packed[0].name !== 'isthmus-cli') throw new Error('Unexpected isthmus package artifact.');
    const install = join(destination, 'installed');
    await command('isthmus-install', 'npm', ['install', '--prefix', install, '--offline', '--ignore-scripts', '--no-audit', '--no-fund', join(destination, packed[0].filename)]);
    const isthmus = join(install, 'node_modules/isthmus-cli/dist/cli/main.js');
    const help = await command('isthmus-preflight-help', process.execPath, [isthmus, 'preflight', '--help']);
    if (!help.includes('--summary') || !help.includes('--explain')) throw new Error('The isthmus commit does not support bounded preflight views.');
    if (repositories.kartograph !== undefined) {
      const context = join(evidence, 'android-context.json');
      await writeFile(context, JSON.stringify({ format: 'isthmus-preflight-context', version: 1,
        project: destination, revision: 'toolchain-capability', selection: {}, bindings: [], analyses: [], limitations: [],
        bridges: ['dart', 'kotlin'].map((platform) => ({ format: 'bridge-facts', version: 1, platform, target: null,
          project: destination, generatedAt: '1970-01-01T00:00:00Z', tool: { name: platform, version: 'capability' },
          facts: [], limitations: [] })) }), { mode: 0o600 });
      const report = JSON.parse(await command('isthmus-kotlin-preflight', process.execPath, [isthmus, 'preflight', context, '--summary']));
      if (report.format !== 'isthmus-preflight-summary') throw new Error('The isthmus commit does not support Kotlin preflight inputs.');
    }
    commands.isthmus = [process.execPath, isthmus];
    commands.dartograph = [dartograph];
    const hashes = {};
    for (const [name, path] of [...nativeFiles, ['dartograph', dartograph], ['isthmusPackage', join(destination, packed[0].filename)]]) {
      hashes[name] = createHash('sha256').update(await readFile(path)).digest('hex');
    }
    if (artifacts.kartographInputs) {
      const libraries = artifacts.kartographInputs[1];
      const hash = createHash('sha256');
      const jars = (await readdir(libraries)).filter((name) => name.endsWith('.jar')).sort();
      if (jars.length === 0) throw new Error('Kartograph distribution has no runtime libraries.');
      for (const name of jars) hash.update(name).update('\0').update(createHash('sha256').update(await readFile(join(libraries, name))).digest());
      hashes.kartographLibraries = hash.digest('hex');
    }
    const result = { format: 'isthmus-built-toolchain', version: 1, destination, repositories, commands, hashes,
      ...(Object.keys(artifacts).length === 0 ? {} : { artifacts }),
      environment: { node: process.version, platform: process.platform, arch: process.arch,
        ...(swiftVersion === undefined ? {} : { swift: swiftVersion }), ...(javaVersion === undefined ? {} : { java: javaVersion }), dart: dartVersion },
      scope: 'committed-source-build-and-cli-capabilities', milliseconds: Math.round(performance.now() - started), evidence, steps };
    await writeFile(join(destination, 'toolchain.json'), JSON.stringify(result, null, 2), { mode: 0o600 });
    return result;
  } catch (error) {
    await writeFile(join(evidence, 'failure.json'), JSON.stringify({ steps, failed: true }, null, 2), { mode: 0o600 });
    if (created) await rm(destination, { recursive: true, force: true });
    throw error;
  }
}

function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function text(value) { return typeof value === 'string' && value.length > 0 && !/[\u0000-\u001f]/u.test(value); }
async function exists(path) {
  try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) {
    process.stderr.write('Usage: build-preflight-toolchain.mjs <build-manifest.json>\n'); process.exitCode = 64;
  } else {
    try {
      const path = resolve(process.argv[2]);
      const result = await buildToolchain(JSON.parse(await readFile(path, 'utf8')), dirname(path),
        (step) => process.stderr.write(`Toolchain: ${step}\n`));
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } catch (error) {
      const message = error instanceof SyntaxError ? 'Build manifest or package metadata is not valid JSON.'
        : typeof error.code === 'string' ? 'Unable to access a required toolchain file or process.' : error.message;
      process.stderr.write(`Toolchain build failed: ${message}\n`); process.exitCode = 1;
    }
  }
}
