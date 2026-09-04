import assert from 'node:assert/strict';
import test from 'node:test';

import { runChild } from '../scripts/run-child.mjs';

test('검증 자식 프로세스가 제한시간을 넘으면 종료한다', () => {
  const result = runChild(
    process.execPath,
    ['-e', 'setInterval(() => undefined, 1000)'],
    { timeout: 50 },
  );

  assert.equal(result.status, null);
  assert.equal(result.error?.code, 'ETIMEDOUT');
});

test('검증 자식 프로세스가 1MiB보다 큰 정상 출력을 수집한다', () => {
  const outputLength = 2 * 1024 * 1024;
  const result = runChild(
    process.execPath,
    ['-e', `process.stdout.write('x'.repeat(${outputLength}))`],
  );

  assert.equal(result.status, 0);
  assert.equal(result.error, undefined);
  assert.equal(result.stdout.length, outputLength);
});
