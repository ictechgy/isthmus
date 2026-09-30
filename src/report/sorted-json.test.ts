import assert from 'node:assert/strict';
import test from 'node:test';

import { canonicalJsonKey, encodeSortedJson, uniqueByCanonicalJson, valuesSortedByKey } from './sorted-json.ts';

test('정렬 JSON 신원은 객체 키 순서와 무관하고 배열 순서는 구분한다', () => {
  assert.equal(canonicalJsonKey({ b: 1, a: [2, 1] }), '{"a":[2,1],"b":1}\n');
  assert.equal(canonicalJsonKey({ a: [2, 1], b: 1 }), canonicalJsonKey({ b: 1, a: [2, 1] }));
  assert.notEqual(canonicalJsonKey({ a: [1, 2] }), canonicalJsonKey({ a: [2, 1] }));
  assert.equal(encodeSortedJson({ b: 1, a: 2 }), '{\n  "a": 2,\n  "b": 1\n}\n');
});

test('신원이 같은 항목은 뒤의 것 하나만 남기고 신원 순으로 나열한다', () => {
  const first = { code: 'z', detail: 'first' };
  const later = { detail: 'first', code: 'z' };
  const other = { code: 'a', detail: 'other' };
  const unique = uniqueByCanonicalJson([first, other, later]);
  assert.deepEqual(unique, [other, later]);
  assert.equal(unique[1], later);
  assert.deepEqual(valuesSortedByKey(new Map([['b', 2], ['a', 1], ['B', 3]])), [3, 1, 2]);
});
