import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChild } from './run-child.mjs';

const names = ['isthmus', 'cartograph', 'dartograph'];

/** 변경 중인 작업 트리 대신 명시한 immutable commit의 소스만 구축한다. */
export function parseToolchainManifest(input) {
  if (!record(input) || input.format !== 'isthmus-toolchain-build' || input.version !== 1 ||
    !text(input.destination) || !record(input.repositories) ||
    Object.keys(input.repositories).some((name) => !names.includes(name))) throw new Error('Invalid toolchain build manifest.');
  const repositories = {};
  for (const name of names) {
    const entry = input.repositories[name];
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
  const destination = resolve(base, config.destination);
  if (await exists(destination)) throw new Error('Toolchain destination already exists; choose a new directory.');
  const repositories = {};
  // source commit 오류를 발견했을 때 SDK 준비나 destination 쓰기를 시작하지 않는다.
  for (const name of names) {
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
    for (const name of names) {
      const source = join(destination, 'sources', name);
      const archive = join(evidence, `${name}.tar`);
      await mkdir(source, { recursive: true });
      await command(`${name}-archive`, 'git', ['-c', 'core.fsmonitor=false', '-C', repositories[name].path,
        'archive', '--format=tar', '--output', archive, repositories[name].revision]);
      await command(`${name}-extract`, 'tar', ['-xf', archive, '-C', source]);
      repositories[name].checkout = source;
    }
    const swiftVersion = await command('swift-version', 'swift', ['--version']);
    const dartVersion = await command('dart-version', 'dart', ['--version']);
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
    const commands = { isthmus: [process.execPath, isthmus], cartograph: [cartograph], dartograph: [dartograph] };
    const hashes = {};
    for (const [name, path] of [['cartograph', cartograph], ['dartograph', dartograph], ['isthmusPackage', join(destination, packed[0].filename)]]) {
      hashes[name] = createHash('sha256').update(await readFile(path)).digest('hex');
    }
    const result = { format: 'isthmus-built-toolchain', version: 1, destination, repositories, commands, hashes,
      environment: { node: process.version, platform: process.platform, arch: process.arch, swift: swiftVersion, dart: dartVersion },
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
