import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChild } from '../../scripts/run-child.mjs';
import { fetchPinnedPackage } from './public-archive.mjs';

// 공개 패키지 원본의 구독·방출을 검증한다. JS 미지원 형태도 정답의 누락으로 기록한다.
const arguments_ = process.argv.slice(2);
const published = arguments_.at(-1) === '--published';
if (published) arguments_.pop();
const [cliArgument, kartographArgument, outputArgument, ...extra] = arguments_;
if (!cliArgument || !kartographArgument || extra.length || outputArgument?.startsWith('--')) {
  process.stderr.write('Usage: node experiments/real-corpus/run-rn-events.mjs <isthmus-cli-main.js> <kartograph-bin> [output-json] [--published]\n');
  process.exit(64);
}
const cli = await realpath(cliArgument);
const kartograph = await realpath(kartographArgument);
const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(await readFile(join(here, 'manifest.json'), 'utf8'));
const work = await realpath(await mkdtemp(join(tmpdir(), 'isthmus-public-rn-events-')));
const resultsDir = join(here, 'results');
await mkdir(resultsDir, { recursive: true });

function execute(command, args, expectedStatus = 0) {
  const result = runChild(command, args, { timeout: 120_000 });
  assert.equal(result.status, expectedStatus, 'public RN corpus command exit status');
  return result.stdout;
}
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const rows = [];
for (const [id, definition] of Object.entries(manifest.rnEvents)) {
  const expectedCallerFacts = published ? definition.publishedCallerFacts : definition.expectedCallerFacts;
  assert.deepEqual(definition.groundTruthCounts, { caller: 1, native: 1 }, 'each case describes one listener/emission pair');
  const root = await fetchPinnedPackage(definition, work);
  const callerText = execute(process.execPath, [cli, 'extract-js', join(root, definition.source), '--project', root, '--events']);
  const nativeText = execute(kartograph, ['bridges', '--project', root, '--rn-events']);
  const caller = JSON.parse(callerText);
  const native = JSON.parse(nativeText);
  for (const document of [caller, native]) {
    assert.equal(document.version, 2);
    assert.equal(document.transport, 'react-native-event');
    assert.ok(document.limitations.some((limit) => limit.startsWith('rn-event-scan-scope:')));
  }
  assert.equal(caller.facts.length, expectedCallerFacts, `caller scan scope: ${id}`);
  assert.deepEqual(caller.facts.map(({ kind, channel, dynamic, location }) =>
    [kind, channel, dynamic, location.path, location.line]), expectedCallerFacts ?
    [['event-listen', definition.event, false, definition.source, definition.callerLine]] : []);
  assert.deepEqual(native.facts.map(({ kind, channel, dynamic, location }) =>
    [kind, channel, dynamic, location.path, location.line]),
  [['event-emit', definition.event, false, definition.nativeSource, definition.nativeLine]]);
  assert.ok(native.limitations.includes('missing-event-usrs: 1 native event emissions lack JVM identities'));
  const callerPath = join(work, `${definition.version}-caller.json`);
  const nativePath = join(work, `${definition.version}-native.json`);
  await writeFile(callerPath, callerText);
  await writeFile(nativePath, nativeText);
  const inputs = [callerPath, nativePath];
  const report = JSON.parse(execute(process.execPath, [cli, 'check', ...inputs, '--strict']));
  assert.equal(report.summary.matchedEvents, expectedCallerFacts);
  assert.equal(report.summary.errors, 0);
  assert.deepEqual(report.issues.map(({ code, severity }) => [code, severity]), expectedCallerFacts ? [] :
    [['event-emit-without-listen', 'warning']]);
  if (expectedCallerFacts) {
    const query = JSON.parse(execute(process.execPath, [cli, 'query', `react-native:event:${definition.event}`, ...inputs]));
    assert.equal(query.result.dependsOn.length, 1, 'one observed native receiver');
    // 소스만 스캔한 native 사실로 JVM ID를 추측하거나 부분 보존에 성공해서는 안 된다.
    execute(process.execPath, [cli, 'retentions', ...inputs, '--for', 'kartograph'], 2);
  }
  const truth = definition.groundTruthCounts;
  let license;
  try { license = await readFile(join(root, 'LICENSE')); }
  catch { throw new Error(`Pinned event package is missing its required readable LICENSE: ${id}`); }
  rows.push({
    id, package: definition.package, version: definition.version, sha256: definition.sha256,
    license: definition.license,
    licenseSha256: sha256(license),
    sourceHashes: Object.fromEntries(await Promise.all([definition.source, definition.nativeSource]
      .map(async (path) => [path, sha256(await readFile(join(root, path)))]))),
    groundTruth: { event: definition.event, callerFacts: truth.caller, nativeFacts: truth.native, explanation: definition.groundTruth },
    observed: { callerFacts: caller.facts.length, nativeFacts: native.facts.length, matchedEvents: report.summary.matchedEvents },
    truePositives: caller.facts.length + native.facts.length,
    falseNegatives: truth.caller + truth.native - caller.facts.length - native.facts.length,
    falsePositives: 0,
    expectedScopeMatches: caller.facts.length === expectedCallerFacts && native.facts.length === truth.native,
    missingJvmIdsRejectRetention: expectedCallerFacts ? true : null,
    limitations: { caller: caller.limitations, native: native.limitations, consumer: report.limitations },
    issues: report.issues.map(({ code, severity }) => ({ code, severity })),
  });
}
assert.ok(rows.length > 0, 'public event cases must not be empty');
const totals = rows.reduce((sum, row) => ({
  tp: sum.tp + row.truePositives, fn: sum.fn + row.falseNegatives, fp: sum.fp + row.falsePositives,
}), { tp: 0, fn: 0, fp: 0 });
const document = {
  format: 'isthmus-public-rn-event-results', version: 1,
  inputProfile: published ? 'published-isthmus-0.8.0' : 'development',
  metricUnit: 'source facts: each case has one caller subscription and one native emission; matchedEvents counts joined event names separately',
  scope: 'Original npm source; global JS event subscriptions joined with Kotlin/Java emissions. No native compilation, JVM identity, retention success, RN engine or app runtime validation.',
  tools: { isthmus: execute(process.execPath, [cli, '--version']).trim(), kartograph: execute(kartograph, ['--version']).trim() },
  totals, cases: rows,
};
await writeFile(outputArgument ?? join(resultsDir, published ? 'rn-event-results.json' : 'rn-event-development-results.json'), JSON.stringify(document, null, 2) + '\n');
process.stdout.write(JSON.stringify({ totals, cases: rows.map(({ id, observed, falseNegatives, expectedScopeMatches }) =>
  ({ id, observed, falseNegatives, expectedScopeMatches })) }, null, 2) + '\n');
