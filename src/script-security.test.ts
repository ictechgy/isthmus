import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('cartograph 왕복 검증은 예측 불가능한 전용 임시 디렉터리를 쓴다', async () => {
  const source = await readFile(
    new URL('../scripts/verify-cartograph-roundtrip.mjs', import.meta.url),
    'utf8',
  );

  assert.equal(source.includes('mkdtemp('), true);
  assert.equal(source.includes("flag: 'wx'"), true);
  assert.equal(source.includes('process.pid'), false);
});
