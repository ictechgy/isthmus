import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import test from 'node:test';
import { runTaskCommand } from '../cli/task-command.ts';
import { adaptAidlcTask, aidlcFailure } from './aidlc-task.ts';
import { parseKartographReceipt } from '../exchange/kartograph-receipt.ts';
import { compareKartographReceipt } from './kartograph-receipt.ts';

const generated = await runTaskCommand(['task', 'fixtures/trace/context-relation.json', '--limit', '1'],
  path => readFile(path, 'utf8'));
assert.equal(generated.exitCode, 0, generated.standardError);
const task = JSON.parse(generated.standardOutput);

test('real task result reaches planning and validation without elevating historical evidence', () => {
  for (const stage of ['delivery-planning', 'build-and-test']) {
    const result = adaptAidlcTask(task, stage, 'a'.repeat(64));
    assert.equal(result.pass, false);
    assert.equal(result.currentCheckout, 'unverified');
    assert.equal(result.sourceSha256, 'a'.repeat(64));
    assert.deepEqual(result.task, task);
    assert.ok(result.states.includes('unverified'));
    assert.ok(result.states.includes('unknown'));
    assert.ok(result.states.includes('truncated'));
    assert.equal(result.findings_count, result.states.length);
    assert.equal(result.phase, stage === 'delivery-planning' ? 'planning' : 'validation');
  }
});

test('stale and missing remain simultaneous with unknown and output truncation', () => {
  const input = structuredClone(task);
  input.evidence.alignment = 'stale';
  input.evidence.summary.stale = 1;
  input.evidence.summary.missing--;
  const result = adaptAidlcTask(input, 'build-and-test');
  assert.ok(result.states.includes('stale'));
  assert.ok(result.states.includes('missing'));
  assert.deepEqual(result.task?.unknown, input.unknown);
  assert.equal(result.pass, false);
});

test('native capture-time matched cannot verify the current checkout', () => {
  const input = structuredClone(task);
  input.evidence.kartograph = { nativeAtCapture: 'matched', currentVerification: 'unverified', integrity: 'matched',
    nativeBefore: { status: 'matched', reasons: { total: 0, items: [], omitted: 0 } },
    nativeAfter: { status: 'matched', reasons: { total: 0, items: [], omitted: 0 } },
    artifacts: { total: 0, items: [], omitted: 0 }, reasons: { total: 0, items: [], omitted: 0 } };
  assert.equal(adaptAidlcTask(input, 'build-and-test').pass, false);
  input.evidence.kartograph.nativeAfter.status = 'stale';
  assert.ok(adaptAidlcTask(input, 'build-and-test').states.includes('stale'));
});

test('malformed, forged clean and coerced statuses never become a valid pass', () => {
  const changes = [
    (r: any) => { r.complete = true; },
    (r: any) => { r.requiresReview = false; },
    (r: any) => { r.evidence.verification = 'verified'; },
    (r: any) => { r.evidence.alignment = ['stale']; },
    (r: any) => { r.evidence.summary.missing = -1; },
    (r: any) => { r.unknown.omitted++; },
    (r: any) => { r.unknown.items = null; },
    (r: any) => { r.rules.status = ['observed']; },
    (r: any) => { r.tests.observedSummary.passed++; },
    (r: any) => { r.trace.format = 'other'; },
  ];
  for (const change of changes) {
    const input = structuredClone(task); change(input);
    const result = adaptAidlcTask(input, 'delivery-planning');
    assert.deepEqual(result.states, ['malformed']);
    assert.equal(result.pass, false);
    assert.equal(result.task, undefined);
  }
  for (const input of [null, [], {}, { ...task, version: 2 }]) {
    assert.deepEqual(adaptAidlcTask(input, 'build-and-test').states, ['malformed']);
  }
});

test('upstream execution gaps are explicit observations and never sensor passes', () => {
  for (const status of ['timeout', 'unavailable', 'malformed', 'truncated']) {
    const result = adaptAidlcTask({ format: 'isthmus-aidlc-input', version: 1, status,
      reason: 'upstream did not complete' }, 'build-and-test');
    assert.deepEqual(result.states, [status]);
    assert.equal(result.pass, false);
    assert.equal(result.findings_count, 1);
  }
  for (const status of [['timeout'], 'passed', null, 0]) {
    assert.deepEqual(adaptAidlcTask({ format: 'isthmus-aidlc-input', version: 1, status,
      reason: 'gap' }, 'build-and-test').states, ['malformed']);
  }
  assert.deepEqual(aidlcFailure('unavailable', 'delivery-planning').states, ['unavailable']);
});

test('actual receipt comparison preserves stale and missing current artifact bindings despite matched capture', async () => {
  const freshness = { format: 'kartograph-freshness', version: 1, status: 'matched', reasons: [] };
  const rawReceipt = { format: 'isthmus-kartograph-receipt', version: 1,
    producer: { name: 'kartograph', version: '0.25.0' }, scope: '::jvm', witnessCount: 2,
    snapshotSha256: 'a'.repeat(64), producerSha256: 'b'.repeat(64), before: freshness, after: freshness,
    stableSnapshot: true, stableProducer: true, limitations: [], artifacts: [
      { id: 'facts', role: 'bridge-facts', sha256: 'c'.repeat(64) },
      { id: 'reverse', role: 'traversal', sha256: 'd'.repeat(64) }] };
  const receipt = parseKartographReceipt(rawReceipt);
  const compared = compareKartographReceipt(receipt, true, [{ id: 'artifact:facts', role: 'bridge-facts',
    sha256: 'e'.repeat(64), producer: receipt.producer }]);
  assert.equal(compared.nativeAtCapture, 'matched');
  assert.deepEqual(compared.artifacts.map(row => row.alignment), ['stale', 'missing']);
  const fixture = new URL('../../fixtures/trace/', import.meta.url), commit = 'a'.repeat(40);
  const context = JSON.parse((await readFile(new URL('context-relation.json', fixture), 'utf8')).replaceAll('"rev-1"', JSON.stringify(commit)));
  const files = new Map<string, string>([['context.json', JSON.stringify(context)]]);
  for (const name of [...context.documents, ...context.analyses.map((row: any) => row.path)]) {
    files.set(name, (await readFile(new URL(name, fixture), 'utf8')).replaceAll('"rev-1"', JSON.stringify(commit)));
  }
  const sha = (value: string) => createHash('sha256').update(value).digest('hex');
  const expected = { captureId: 'receipt-current-binding', repository: 'https://github.com/example/app', commit,
    dirty: true, sourceDigest: 'a'.repeat(64), sourceDigestScheme: 'fixture-files-v1',
    toolchainDigest: 'b'.repeat(64), buildConfigurationDigest: 'c'.repeat(64) };
  const artifacts = [...files].map(([path, value], index) => ({ id: path === context.documents[0] ? 'facts' : `fixture-${index}`,
    path, sha256: sha(value), input: expected,
    role: path === 'context.json' ? 'trace-context' : context.documents.includes(path) ? 'bridge-facts' : 'traversal',
    ...(JSON.parse(value).tool === undefined ? {} : { producer: JSON.parse(value).tool }) }));
  files.set('receipt.json', JSON.stringify(rawReceipt));
  files.set('manifest.json', JSON.stringify({ format: 'isthmus-evidence-manifest', version: 1, expected, artifacts,
    kartographReceipt: { path: 'receipt.json', sha256: sha(files.get('receipt.json')!) } }));
  const command = await runTaskCommand(['task', resolve('receipt-fixture/context.json'), '--evidence', resolve('receipt-fixture/manifest.json')],
    async path => { const found = files.get(basename(path)); assert.notEqual(found, undefined); return found!; });
  assert.equal(command.exitCode, 0, command.standardError);
  const input = JSON.parse(command.standardOutput);
  assert.equal(input.evidence.alignment, 'matched');
  assert.equal(input.evidence.kartograph.nativeAtCapture, 'matched');
  assert.deepEqual(input.evidence.kartograph.artifacts.items.map((row: any) => row.alignment), ['stale', 'missing']);
  const result = adaptAidlcTask(input, 'build-and-test');
  assert.ok(result.states.includes('stale'));
  assert.ok(result.states.includes('missing'));
  assert.equal(result.pass, false);
  input.evidence.kartograph.artifacts.items[0].alignment = ['stale'];
  assert.deepEqual(adaptAidlcTask(input, 'build-and-test').states, ['malformed']);
});
