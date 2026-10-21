import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runTaskCommand } from '../cli/task-command.ts';
import { adaptAidlcTask, aidlcFailure } from './aidlc-task.ts';
import { encodeAidlcVerdict, MAX_SENSOR_OUTPUT_BYTES } from './aidlc-output.ts';

const generated = await runTaskCommand(['task', 'fixtures/trace/context-relation.json', '--limit', '1'], path => readFile(path, 'utf8'));
assert.equal(generated.exitCode, 0);
const task = JSON.parse(generated.standardOutput);

test('ordinary sensor output retains its exact task and one JSON line', () => {
  const verdict = adaptAidlcTask(task, 'delivery-planning', 'a'.repeat(64));
  assert.equal(encodeAidlcVerdict(verdict), JSON.stringify(verdict) + '\n');
});

test('byte budget preserves states and original unknown/limitation counts with explicit additional omissions', () => {
  const source = structuredClone(task);
  source.trace.limitations = Array.from({ length: 100 }, () => ({ message: '\u0000"한🙂'.repeat(3000) }));
  source.trace.analysisLimitations = [{ analysis: 'reverse', message: '한🙂'.repeat(30000) }];
  source.unknown = { total: 120, omitted: 20, items: Array.from({ length: 100 }, () => ({ code: 'gap', detail: '\u0000"'.repeat(1500) })) };
  const verdict = adaptAidlcTask(source, 'build-and-test', 'a'.repeat(64));
  const text = encodeAidlcVerdict(verdict), output = JSON.parse(text);
  assert.ok(Buffer.byteLength(text) <= MAX_SENSOR_OUTPUT_BYTES);
  assert.equal(output.pass, false); assert.equal(output.task, undefined);
  assert.ok(output.states.includes('unknown')); assert.ok(output.states.includes('unverified')); assert.ok(output.states.includes('truncated'));
  assert.equal(output.taskSummary.unknown.total, 120);
  assert.equal(output.taskSummary.unknown.sourceOmitted, 20);
  assert.equal(output.taskSummary.unknown.omitted, 112);
  assert.equal(output.taskSummary.limitations.trace.reportedTotal, 100);
  assert.equal(output.taskSummary.limitations.trace.omittedByAdapter, 92);
  assert.equal(output.taskSummary.limitations.trace.items[0].detailTruncated, true);
  assert.ok(!output.taskSummary.limitations.analysis.items[0].detail.includes('\ufffd'));
  assert.equal(output.sourceSha256, 'a'.repeat(64));
});

test('compaction retains native capture/current distinction and artifact gaps', () => {
  const source = structuredClone(task), empty = { total: 0, items: [], omitted: 0 };
  source.trace.limitations = [{ message: '한🙂'.repeat(100000) }];
  source.evidence.kartograph = { nativeAtCapture: 'matched', currentVerification: 'unverified', integrity: 'matched',
    nativeBefore: { status: 'matched', reasons: empty }, nativeAfter: { status: 'matched', reasons: empty },
    reasons: { total: 1, items: ['missing-external-input'], omitted: 0 },
    artifacts: { total: 2, items: [{ id: 'facts', alignment: 'stale' }, { id: 'reverse', alignment: 'missing' }], omitted: 0 } };
  const result = JSON.parse(encodeAidlcVerdict(adaptAidlcTask(source, 'build-and-test')));
  assert.equal(result.taskSummary.evidence.kartograph.nativeAtCapture, 'matched');
  assert.equal(result.taskSummary.evidence.kartograph.currentVerification, 'unverified');
  assert.deepEqual(result.taskSummary.evidence.kartograph.artifacts.items.map((row: any) => row.alignment), ['stale', 'missing']);
  assert.equal(result.taskSummary.evidence.kartograph.reasons.items[0].detail, 'missing-external-input');
  assert.ok(result.states.includes('stale')); assert.ok(result.states.includes('missing'));
});

test('defensive output fallback stays bounded even if a future caller supplies an oversized reason', () => {
  const result = JSON.parse(encodeAidlcVerdict({ ...aidlcFailure('unavailable', 'delivery-planning'),
    upstreamReason: 'x'.repeat(MAX_SENSOR_OUTPUT_BYTES * 2) }));
  assert.ok(Buffer.byteLength(JSON.stringify(result)) < MAX_SENSOR_OUTPUT_BYTES);
  assert.equal(result.pass, false);
  assert.ok(result.states.includes('unavailable')); assert.ok(result.states.includes('truncated'));
});
