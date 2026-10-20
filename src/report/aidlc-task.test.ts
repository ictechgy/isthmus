import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runTaskCommand } from '../cli/task-command.ts';
import { adaptAidlcTask, aidlcFailure } from './aidlc-task.ts';

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
