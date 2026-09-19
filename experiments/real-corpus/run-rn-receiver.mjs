import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runChild } from '../../scripts/run-child.mjs';

// React Native 수신 측 코퍼스 실행기: 고정 npm tarball을 sha256 검증·해제한 뒤
// extract-js(호출 측)와 cartograph `bridges --target react-native`(Expo DSL 수신 측)를
// 만들고 isthmus check로 결합한다. cartograph가 필요하며 빈 index-store를 받아
// `--allow-empty-index`로 USR 없는 소스 스캔을 수행한다(런타임 실행 아님).
// iOS만 넣으면 Android 전용 performHapticsAsync가 미대응으로 남는 비대칭을 그대로 잰다.

const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(await readFile(join(here, 'manifest.json'), 'utf8'));
const [cliArgument, cartographArgument, indexStoreArgument] = process.argv.slice(2);
if (cliArgument === undefined || cartographArgument === undefined || process.argv.length > 5) {
  process.stderr.write('Usage: node experiments/real-corpus/run-rn-receiver.mjs '
    + '<isthmus-cli-main.js> <cartograph-bin> [index-store-dir]\n');
  process.exit(64);
}

async function resolveOrExit(path, message) {
  try {
    return await realpath(path);
  } catch {
    process.stderr.write(`${message}\n`);
    process.exit(2);
  }
}
const cli = await resolveOrExit(cliArgument, 'The isthmus CLI entry does not exist; run npm run build first.');
const cartograph = await resolveOrExit(cartographArgument, 'The cartograph binary does not exist.');

const work = await realpath(await mkdtemp(join(tmpdir(), 'isthmus-rn-receiver-corpus-')));
const sourceRoot = join(work, 'src');
const resultsDir = join(here, 'results');
await mkdir(sourceRoot, { recursive: true });
await mkdir(resultsDir, { recursive: true });

/** 고정 tarball을 받아 sha256을 확인하고 해제한다. */
async function fetchArchive(definition) {
  const target = join(sourceRoot, `${definition.package}-${definition.version}`);
  const tarball = join(work, `${definition.package}-${definition.version}.tgz`);
  const download = runChild('curl', ['-fsSL', '--retry', '3', definition.archiveUrl, '-o', tarball], { timeout: 120_000 });
  assert.equal(download.status, 0, 'archive download failed');
  const hash = createHash('sha256').update(await readFile(tarball)).digest('hex');
  assert.equal(hash, definition.sha256, 'archive sha256 mismatch');
  await mkdir(target, { recursive: true });
  const extract = runChild('tar', ['-xzf', tarball, '-C', target], { timeout: 120_000 });
  assert.equal(extract.status, 0, 'archive extract failed');
  return join(target, 'package');
}

const indexStore = indexStoreArgument === undefined
  ? join(work, 'empty-index')
  : await realpath(indexStoreArgument);
await mkdir(indexStore, { recursive: true });

const rows = [];
for (const [id, definition] of Object.entries(manifest.rn)) {
  const packageRoot = await fetchArchive(definition);

  const js = runChild(process.execPath, [cli, 'extract-js', join(packageRoot, definition.source), '--project', packageRoot], { timeout: 120_000 });
  assert.equal(js.status, 0, `extract-js failed: ${id}`);
  const jsPath = join(work, `${definition.package}.js.json`);
  await writeFile(jsPath, js.stdout);

  const swift = runChild(cartograph, ['bridges', '--target', 'react-native', '--allow-empty-index',
    '--index-store', indexStore, '--project', packageRoot, '--format', 'json'], { timeout: 180_000 });
  assert.equal(swift.status, 0, `cartograph bridges failed: ${id}`);
  const swiftPath = join(work, `${definition.package}.swift.json`);
  await writeFile(swiftPath, swift.stdout);

  const check = runChild(process.execPath, [cli, 'check', jsPath, swiftPath], { timeout: 120_000 });
  assert.ok(check.status === 0 || check.status === 1, `isthmus check failed: ${id}`);
  const report = JSON.parse(check.stdout);
  const unhandled = report.issues
    .filter((issue) => issue.code === 'unhandled-invocation')
    .map((issue) => `${issue.channel}/${issue.method}`)
    .sort();
  const expectedUnhandled = [...definition.expectedUnhandledMethods].sort();
  const countsMatch = report.summary.matchedModules === definition.expectedModuleExports.length &&
    report.summary.matchedMethods === definition.expectedMethodHandles.length &&
    JSON.stringify(unhandled) === JSON.stringify(expectedUnhandled);
  rows.push({
    id,
    package: definition.package,
    version: definition.version,
    sha256: definition.sha256,
    license: definition.license,
    predicted: {
      matchedModules: report.summary.matchedModules,
      matchedMethods: report.summary.matchedMethods,
      unhandledInvocations: unhandled,
    },
    expected: {
      matchedModules: definition.expectedModuleExports.length,
      matchedMethods: definition.expectedMethodHandles.length,
      unhandledInvocations: expectedUnhandled,
    },
    countsMatch,
    limitations: report.limitations.map((limit) => limit.message ?? limit.code),
  });
}

const matched = rows.filter(({ countsMatch }) => countsMatch).length;
const document = {
  format: 'isthmus-rn-receiver-corpus-results',
  version: 1,
  scope: 'extract-js (caller) + cartograph --target react-native (Expo DSL receiver) joined by isthmus check; '
    + 'Android Kotlin receiver is out of scope, so the Android-only method stays unmatched',
  tools: {
    isthmus: runChild(process.execPath, [cli, '--version'], { timeout: 30_000 }).stdout.trim(),
    cartograph: runChild(cartograph, ['--version'], { timeout: 30_000 }).stdout.trim(),
  },
  cases: rows,
  matched,
  total: rows.length,
};
await writeFile(join(resultsDir, 'rn-receiver-results.json'), `${JSON.stringify(document, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ matched, total: rows.length,
  cases: rows.map(({ id, countsMatch, predicted }) => ({ id, countsMatch, ...predicted })) }, null, 2)}\n`);
if (matched !== rows.length) process.exitCode = 1;