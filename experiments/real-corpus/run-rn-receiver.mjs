import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runChild } from '../../scripts/run-child.mjs';
import { fetchPinnedPackage } from './public-archive.mjs';

// React Native 수신 측 코퍼스 실행기: 고정 npm tarball을 sha256 검증·해제한 뒤
// extract-js(호출 측)와 cartograph `bridges --target react-native`(Expo DSL 수신 측)를
// 만들고 isthmus check로 결합한다. cartograph가 필요하며 빈 index-store를 받아
// `--allow-empty-index`로 USR 없는 소스 스캔을 수행한다(런타임 실행 아님).
// iOS만 넣으면 Android 전용 performHapticsAsync가 미대응으로 남는 비대칭을 그대로 잰다.

const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(await readFile(join(here, 'manifest.json'), 'utf8'));
const [cliArgument, cartographArgument, ...extra] = process.argv.slice(2);
const indexStoreArgument = extra[0] && !extra[0].startsWith('--') ? extra.shift() : undefined;
const kartographArgument = extra[0] === '--kartograph' && extra.length === 2 ? extra[1] : undefined;
if (cliArgument === undefined || cartographArgument === undefined ||
  (extra.length !== 0 && (kartographArgument === undefined || kartographArgument.startsWith('--')))) {
  process.stderr.write('Usage: node experiments/real-corpus/run-rn-receiver.mjs '
    + '<isthmus-cli-main.js> <cartograph-bin> [index-store-dir] [--kartograph <kartograph-bin>]\n');
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
const kartograph = kartographArgument === undefined ? undefined
  : await resolveOrExit(kartographArgument, 'The kartograph binary does not exist.');

const work = await realpath(await mkdtemp(join(tmpdir(), 'isthmus-rn-receiver-corpus-')));
const sourceRoot = join(work, 'src');
const resultsDir = join(here, 'results');
await mkdir(sourceRoot, { recursive: true });
await mkdir(resultsDir, { recursive: true });

const indexStore = indexStoreArgument === undefined
  ? join(work, 'empty-index')
  : await realpath(indexStoreArgument);
await mkdir(indexStore, { recursive: true });

const rows = [];
for (const [id, definition] of Object.entries(manifest.rn)) {
  const packageRoot = await fetchPinnedPackage(definition, sourceRoot);

  const js = runChild(process.execPath, [cli, 'extract-js', join(packageRoot, definition.source), '--project', packageRoot], { timeout: 120_000 });
  assert.equal(js.status, 0, `extract-js failed: ${id}`);
  const jsPath = join(work, `${definition.package}.js.json`);
  await writeFile(jsPath, js.stdout);

  const swift = runChild(cartograph, ['bridges', '--target', 'react-native', '--allow-empty-index',
    '--index-store', indexStore, '--project', packageRoot, '--format', 'json'], { timeout: 180_000 });
  assert.equal(swift.status, 0, `cartograph bridges failed: ${id}`);
  const swiftDocument = JSON.parse(swift.stdout);
  const moduleKeys = (facts) => facts.filter((fact) => fact.kind === 'module-export')
    .map(({ channel, mechanism }) => JSON.stringify([channel, mechanism ?? 'core'])).sort();
  const expectedModules = definition.expectedModuleExports
    .map(({ channel, mechanism }) => JSON.stringify([channel, mechanism ?? 'core'])).sort();
  assert.deepEqual(moduleKeys(swiftDocument.facts), expectedModules, 'Swift module identities');
  assert.deepEqual(swiftDocument.facts.filter((fact) => fact.kind === 'method-handle')
    .map((fact) => `${fact.channel}/${fact.method}`).sort(), [...definition.expectedMethodHandles].sort(),
  'Swift method identities');
  const swiftPath = join(work, `${definition.package}.swift.json`);
  await writeFile(swiftPath, swift.stdout);
  const inputs = [jsPath, swiftPath];
  const kotlinMethods = [];
  if (kartograph) {
    const kotlin = runChild(kartograph, ['bridges', '--target', 'react-native', '--project', packageRoot], { timeout: 180_000 });
    assert.equal(kotlin.status, 0, `kartograph bridges failed: ${id}`);
    const document = JSON.parse(kotlin.stdout);
    assert.equal(document.platform, 'kotlin');
    assert.deepEqual(moduleKeys(document.facts), expectedModules, 'Kotlin module identities');
    kotlinMethods.push(...document.facts.filter((fact) => fact.kind === 'method-handle')
      .map((fact) => `${fact.channel}/${fact.method}`).sort());
    assert.deepEqual(kotlinMethods, [...definition.expectedKotlinMethodHandles].sort(), 'Kotlin method identities');
    const kotlinPath = join(work, `${definition.package}.kotlin.json`);
    await writeFile(kotlinPath, kotlin.stdout);
    inputs.push(kotlinPath);
  }

  const check = runChild(process.execPath, [cli, 'check', ...inputs], { timeout: 120_000 });
  assert.ok(check.status === 0 || check.status === 1, `isthmus check failed: ${id}`);
  const report = JSON.parse(check.stdout);
  const unhandled = report.issues
    .filter((issue) => issue.code === 'unhandled-invocation')
    .map((issue) => `${issue.channel}/${issue.method}`)
    .sort();
  const expectedMethods = new Set([...definition.expectedMethodHandles,
    ...(kartograph ? definition.expectedKotlinMethodHandles : [])]);
  const expectedUnhandled = definition.expectedMethodInvokes.filter((method) => !expectedMethods.has(method)).sort();
  const countsMatch = report.summary.matchedModules === definition.expectedModuleExports.length &&
    report.summary.matchedMethods === expectedMethods.size && report.summary.errors === expectedUnhandled.length &&
    JSON.stringify(unhandled) === JSON.stringify(expectedUnhandled);
  rows.push({
    id,
    package: definition.package,
    version: definition.version,
    sha256: definition.sha256,
    license: definition.license,
    ...(kartograph ? { kotlinMethodHandles: kotlinMethods } : {}),
    predicted: {
      matchedModules: report.summary.matchedModules,
      matchedMethods: report.summary.matchedMethods,
      unhandledInvocations: unhandled,
    },
    expected: {
      matchedModules: definition.expectedModuleExports.length,
      matchedMethods: expectedMethods.size,
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
    + (kartograph ? 'includes original Android Kotlin Expo DSL receiver source; no JVM IDs, retention or app runtime validation'
      : 'Android Kotlin receiver is out of scope, so the Android-only method stays unmatched'),
  tools: {
    isthmus: runChild(process.execPath, [cli, '--version'], { timeout: 30_000 }).stdout.trim(),
    cartograph: runChild(cartograph, ['--version'], { timeout: 30_000 }).stdout.trim(),
    ...(kartograph ? { kartograph: runChild(kartograph, ['--version'], { timeout: 30_000 }).stdout.trim() } : {}),
  },
  cases: rows,
  matched,
  total: rows.length,
};
const resultName = kartograph ? 'rn-kotlin-receiver-results.json' : 'rn-receiver-results.json';
await writeFile(join(resultsDir, resultName), `${JSON.stringify(document, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ matched, total: rows.length,
  cases: rows.map(({ id, countsMatch, predicted }) => ({ id, countsMatch, ...predicted })) }, null, 2)}\n`);
if (matched !== rows.length) process.exitCode = 1;
