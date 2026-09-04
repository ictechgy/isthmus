import assert from 'node:assert/strict';
import test from 'node:test';

import { compareStrings } from './compare.ts';

test('문자열 정렬이 locale과 무관한 UTF-16 코드 단위 순서를 따른다', () => {
  const values = ['a', 'Z', 'ä', 'B'];

  assert.deepEqual(values.sort(compareStrings), ['B', 'Z', 'a', 'ä']);
  assert.equal(compareStrings('same', 'same'), 0);
});
