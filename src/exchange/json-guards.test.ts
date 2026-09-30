import assert from 'node:assert/strict';
import test from 'node:test';

import { createJsonGuards } from './json-guards.ts';

/** 호출 모듈의 오류 클래스를 흉내 낸다. 공유 도우미가 문구·종류를 바꾸지 않는지 본다. */
class SampleError extends Error {}
const guard = createJsonGuards((message) => { throw new SampleError(message); });

test('object는 배열·null·원시값을 호출 모듈의 오류와 문구로 거부한다', () => {
  const value = { a: 1 };
  assert.equal(guard.object(value, 'bad object'), value);
  for (const input of [null, [], 'x', 1, undefined]) {
    assert.throws(() => guard.object(input, 'bad object'), (error: unknown) =>
      error instanceof SampleError && error.message === 'bad object');
  }
});

test('array는 상한까지 입력 배열을 복사 없이 돌려준다', () => {
  const value = [1, 2];
  assert.equal(guard.array(value, 2, 'bad array'), value);
  assert.throws(() => guard.array([1, 2, 3], 2, 'bad array'), { message: 'bad array' });
  assert.throws(() => guard.array({ length: 0 }, 2, 'bad array'), SampleError);
});

test('textStrings는 빈 문자열을 허용하고 safeStrings는 안전한 비어 있지 않은 문자열만 받는다', () => {
  const texts = ['', 'free text'];
  const copied = guard.textStrings(texts, 10, 'bad texts');
  assert.deepEqual(copied, texts);
  assert.notEqual(copied, texts);
  assert.throws(() => guard.textStrings(['ok', 1], 10, 'bad texts'), { message: 'bad texts' });
  assert.throws(() => guard.textStrings(['a', 'b'], 1, 'bad texts'), { message: 'bad texts' });
  assert.deepEqual(guard.safeStrings(['id-1'], 10, 'bad ids'), ['id-1']);
  for (const input of [[''], ['a\u0000b'], ['\ud800'], 'id']) {
    assert.throws(() => guard.safeStrings(input, 10, 'bad ids'), { message: 'bad ids' });
  }
});

test('safe와 optionalSafe는 제어 문자·빈 문자열을 거부하고 없음만 undefined로 둔다', () => {
  assert.equal(guard.safe('name', 'bad name'), 'name');
  assert.throws(() => guard.safe('', 'bad name'), { message: 'bad name' });
  assert.throws(() => guard.safe(null, 'bad name'), SampleError);
  assert.equal(guard.optionalSafe(undefined, 'bad label'), undefined);
  assert.equal(guard.optionalSafe('label', 'bad label'), 'label');
  assert.throws(() => guard.optionalSafe(null, 'bad label'), { message: 'bad label' });
});
