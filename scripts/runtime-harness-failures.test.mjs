import assert from 'node:assert/strict';
import test from 'node:test';
import { describeBuildFailure, matchesBuildInvocation, throwHarnessFailures } from './runtime-harness-failures.mjs';

test('an old APK result cannot complete the first run even with a passed status and matching checkpoint', () => {
  const stale = { invocation: 'previous-apk', runId: 'previous-process', status: 'passed', checks: Array(31).fill('old-check') };
  const checkpoint = { invocation: 'previous-apk', runId: stale.runId, phase: 'awaiting-background' };
  assert.equal(matchesBuildInvocation(stale, 'current-apk'), false);
  assert.equal(matchesBuildInvocation(checkpoint, 'current-apk'), false);
  assert.equal(matchesBuildInvocation({ invocation: 'current-apk', status: 'failed' }, 'current-apk'), true);
  assert.equal(matchesBuildInvocation({}, undefined), false);
  assert.equal(matchesBuildInvocation({ invocation: '' }, ''), false);
  assert.equal(matchesBuildInvocation(null, 'current-apk'), false);
});

test('failed verification remains visible when cleanup also fails', () => {
  const verification = new Error('Native response mismatch');
  const cleanup = new Error('Owned app removal failed');
  assert.throws(() => throwHarnessFailures(verification, [cleanup]), (error) =>
    error instanceof AggregateError && error.errors[0] === verification && error.errors[1] === cleanup);
  assert.throws(() => throwHarnessFailures(verification, []), (error) => error === verification);
  assert.throws(() => throwHarnessFailures(undefined, [cleanup]), (error) => error === cleanup);
  throwHarnessFailures(undefined, []);
});

test('signing failure evidence contains a useful category without the signing identity or original output', () => {
  const result = describeBuildFailure('Build iPhone fixture', { status: 1,
    stdout: 'Code signing certificate: Fixture Identity (fixture@example.invalid) TEAM123456',
    stderr: 'Provisioning profile /private/fixture/mobileprovision was rejected' });
  assert.deepEqual(result, { label: 'Build iPhone fixture', exit: 1, category: 'code-signing' });
  assert.ok(!JSON.stringify(result).includes('fixture@example') && !JSON.stringify(result).includes('mobileprovision'));
  assert.equal(describeBuildFailure('Build', { status: null, error: { code: 'ETIMEDOUT' } }).category, 'timeout');
});
