import assert from 'node:assert/strict';
import test from 'node:test';
import { describeBuildFailure, throwHarnessFailures } from './runtime-harness-failures.mjs';

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
