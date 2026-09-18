import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runChild } from '../../scripts/run-child.mjs';

// React Native 호출 측 extract-js 코퍼스 실행기: 고정 npm tarball을 sha256 검증·해제한 뒤
// 드된 isthmus extract-js로 JS/TS 사실을 만들고 manifest의 수동 기대와 계수한다.
// 수신 측(cartograph Swift Expo DSL·kartograph Kotlin)은 cartograph의 `--target react-native`
// 스캔 문서가 필요하므로 이 케이스의 범위 밖이다 — 호출 측 정밀도만 재현한다.

const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(await readFile(join(here, 'manifest.json'), 'utf8'));
const [cliArgument] = process.argv.slice(2);
if (cliArgument === undefined || process.argv.length > 3) {
  process.stderr.write('Usage: node experiments/real-corpus/run-rn-js.mjs <isthmus-cli-main.js>\n');
  process.exit(64);
}

let cli;
try {
  cli = await realpath(cliArgument);
} catch {
  process.stderr.write('The isthmus CLI entry does not exist; run npm run build first.\n');
  process.exit(2);
}

const work = await realpath(await mkdtemp(join(tmpdir(), 'isthmus-rn-js-corpus-')));
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
  const list = runChild('tar', ['-tzf', tarball], { timeout: 60_000 });
  assert.equal(list.status, 0, 'archive listing failed');
  for (const member of list.stdout.split('\n')) {
    assert.ok(!member.startsWith('/') && !member.split('/').includes('..'), `unsafe archive member: ${member}`);
  }
  await mkdir(target, { recursive: true });
  const extract = runChild('tar', ['-xzf', tarball, '-C', target], { timeout: 120_000 });
  assert.equal(extract.status, 0, 'archive extract failed');
  return join(target, 'package');
}

const rows = [];
for (const [id, definition] of Object.entries(manifest.rn)) {
  const packageRoot = await fetchArchive(definition);
  const invokes = runChild(process.execPath, [cli, 'extract-js', join(packageRoot, definition.source), '--project', packageRoot], { timeout: 120_000 });
  assert.equal(invokes.status, 0, `extract-js failed: ${id}`);
  const document = JSON.parse(invokes.stdout);
  assert.equal(document.platform, 'js', 'extract-js platform');
  assert.equal(document.target, 'react-native', 'extract-js target');

  const predictedImports = new Set(document.facts.filter((fact) => fact.kind === 'module-import')
    .map((fact) => JSON.stringify([fact.channel, fact.mechanism ?? 'core', fact.optional === true])));
  const predictedInvokes = new Set(document.facts.filter((fact) => fact.kind === 'method-invoke')
    .map((fact) => `${fact.channel}/${fact.method}`));
  const expectedImports = new Set(definition.expectedModuleImports
    .map((fact) => JSON.stringify([fact.channel, fact.mechanism ?? 'core', fact.optional === true])));
  const expectedInvokes = new Set(definition.expectedMethodInvokes);
  const matched = {
    imports: [...expectedImports].filter((key) => predictedImports.has(key)).length,
    invokes: [...expectedInvokes].filter((key) => predictedInvokes.has(key)).length,
  };
  const truePositives = matched.imports + matched.invokes;
  const falseNegatives = (expectedImports.size + expectedInvokes.size) - truePositives;
  const falsePositives = [...predictedImports].filter((key) => !expectedImports.has(key)).length
    + [...predictedInvokes].filter((key) => !expectedInvokes.has(key)).length;
  rows.push({
    id,
    package: definition.package,
    version: definition.version,
    sha256: definition.sha256,
    license: definition.license,
    predicted: { moduleImports: [...predictedImports].sort(), methodInvokes: [...predictedInvokes].sort() },
    expected: { moduleImports: [...expectedImports].sort(), methodInvokes: [...expectedInvokes].sort() },
    truePositives,
    falseNegatives,
    falsePositives,
    limitations: document.limitations,
  });
}

const totals = rows.reduce((accumulator, row) => ({
  tp: accumulator.tp + row.truePositives,
  fn: accumulator.fn + row.falseNegatives,
  fp: accumulator.fp + row.falsePositives,
}), { tp: 0, fn: 0, fp: 0 });
const document = {
  format: 'isthmus-rn-js-corpus-results',
  version: 1,
  scope: 'caller-side extract-js only; receiver Expo DSL scan is out of scope',
  tools: { isthmus: runChild(process.execPath, [cli, '--version'], { timeout: 30_000 }).stdout.trim() },
  totals,
  cases: rows,
};
await writeFile(join(resultsDir, 'rn-js-results.json'), `${JSON.stringify(document, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ totals, cases: rows.map(({ id, truePositives, falseNegatives, falsePositives, limitations }) =>
  ({ id, tp: truePositives, fn: falseNegatives, fp: falsePositives, limitations: limitations.length })) }, null, 2)}\n`);
if (totals.fn !== 0 || totals.fp !== 0) process.exitCode = 1;