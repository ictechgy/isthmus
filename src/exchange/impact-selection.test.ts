import assert from 'node:assert/strict';
import test from 'node:test';
import { parseImpactSelection, ImpactSelectionValidationError } from './impact-selection.ts';

test('변경 파일과 심볼 목록은 정확한 문자열을 정렬·중복 제거한다', () => {
  assert.deepEqual(parseImpactSelection({ format: 'isthmus-changes', version: 1,
    files: ['b.dart', 'a.dart', 'b.dart'], symbols: ['s:A', 'A', 's:A'], extra: true }),
  { files: ['a.dart', 'b.dart'], symbols: ['A', 's:A'] });
});

test('한 종류만 지정할 수 있고 알 수 없는 필드는 선택 근거로 쓰지 않는다', () => {
  assert.deepEqual(parseImpactSelection({ format: 'isthmus-changes', version: 1, files: ['a.dart'] }),
    { files: ['a.dart'], symbols: [] });
  assert.deepEqual(parseImpactSelection({ format: 'isthmus-changes', version: 1, symbols: ['A'] }),
    { files: [], symbols: ['A'] });
});

test('빈 선택·잘못된 경로·형식·자원 초과는 값을 노출하지 않고 거부한다', () => {
  for (const value of [null, [], {}, { format: 'isthmus-changes', version: 2 },
    ...[{}, { files: [] }, { files: ['/private/secret'] }, { files: ['../secret'] },
      { files: ['C:\\secret'] }, { files: ['a\n.dart'] }, { files: [2] },
      { files: 'a.dart' }, { symbols: [''] }, { symbols: ['\ud800'] },
      { symbols: Array(10001).fill('same') }, { files: null }].map((data) =>
      ({ format: 'isthmus-changes', version: 1, ...data }))]) {
    assert.throws(() => parseImpactSelection(value), (error: unknown) => {
      assert.ok(error instanceof ImpactSelectionValidationError);
      assert.equal(error.message.includes('secret'), false);
      return true;
    });
  }
});
