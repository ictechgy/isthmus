import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_IMPACT_DEPTH,
  parseImpactLocation,
  parseImpactSymbol,
  PreflightValidationError,
  validateLanguageImpact,
} from './language-impact.ts';
import { MAX_TRAVERSAL_DEPTH, MAX_TRAVERSAL_RELATIONSHIPS } from './language-traversal.ts';

/** 한 root와 depth 1 영향 하나를 가진 Kotlin 영향이다. 계약 위반 변형의 기준이다. */
function impact(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'kotlin-initial', platform: 'kotlin', tool: { name: 'kartograph', version: '0.13.0' },
    requested: { symbols: ['Api.load'] },
    roots: [{ id: 'Api.load', qualifiedName: 'Api.load', location: { path: 'src/Api.kt' } }],
    affected: [{ symbol: { id: 'Screen.show', qualifiedName: 'Screen.show', location: { path: 'src/Screen.kt', line: 3 } },
      via: 'Api.load', depth: 1, relationships: ['call'] }],
    limitations: [''], truncated: false, ...overrides,
  };
}

/** 공유 오류 클래스와 고정 문구로 거부되는지 확인한다. */
function rejects(input: unknown, message: string): void {
  assert.throws(() => validateLanguageImpact(input), (error: unknown) =>
    error instanceof PreflightValidationError && error.name === 'PreflightValidationError' && error.message === message);
}

test('Kotlin 영향은 줄·열 없는 부분 위치를 채우지 않고 그대로 보존한다', () => {
  const parsed = validateLanguageImpact(impact());
  assert.deepEqual(parsed.roots[0]!.location, { path: 'src/Api.kt' });
  assert.deepEqual(parsed.affected[0]!.symbol.location, { path: 'src/Screen.kt', line: 3 });
  assert.deepEqual(parsed.requested, { files: [], symbols: ['Api.load'] });
  assert.deepEqual(parsed.limitations, ['']);
});

test('영향 계약 위반은 입력 값 없이 원인별 문구로 거부한다', () => {
  rejects([], 'Language impact must be a JSON object.');
  rejects(impact({ platform: 'js' }), 'Unsupported language impact platform.');
  rejects(impact({ requested: [] }), 'Invalid language impact selection.');
  rejects(impact({ requested: { symbols: [] } }), 'Invalid language impact selection.');
  rejects(impact({ trigger: '' }), 'Invalid language impact trigger.');
  rejects(impact({ truncated: 'no' }), 'Invalid language impact truncation flag.');
  rejects(impact({ trigger: 'Api.load' }), 'Continuation impact must be a Dart analysis rooted at its trigger symbol.');
  rejects(impact({ affected: [{ ...(impact().affected as object[])[0], depth: MAX_IMPACT_DEPTH + 1 }] }),
    'Affected symbol depth must be between 1 and 128.');
  rejects(impact({ affected: [{ ...(impact().affected as object[])[0], depth: 2 }] }),
    'Affected symbol depth does not match its observed parent.');
  rejects(impact({ affected: [{ ...(impact().affected as object[])[0], relationships: Array.from({ length: 33 }, (_, i) => `r${i}`) }] }),
    'Affected symbol relationships exceed their limit.');
});

test('Dart·Swift 심볼은 줄·열이 모두 있는 위치만 받고 Kotlin 위치는 열만 있는 좌표를 거부한다', () => {
  assert.throws(() => parseImpactSymbol({ id: 'a', qualifiedName: 'a', location: { path: 'lib/a.dart' } }),
    { message: 'Invalid impact symbol location.' });
  assert.throws(() => parseImpactSymbol({ id: 'a', qualifiedName: 'a', location: { path: 'A.kt', column: 2 } }, true),
    { message: 'Invalid Kotlin symbol location.' });
  assert.deepEqual(parseImpactLocation({ path: 'lib/a.dart', line: 1, column: 2 }, 'bad'), { path: 'lib/a.dart', line: 1, column: 2 });
  assert.throws(() => parseImpactLocation({ path: '/abs.dart', line: 1, column: 2 }, 'bad caller location'),
    { message: 'bad caller location' });
});

test('language-traversal의 depth·관계 상한은 영향 계약의 값과 같다', () => {
  assert.equal(MAX_TRAVERSAL_DEPTH, 128);
  assert.equal(MAX_TRAVERSAL_RELATIONSHIPS, 32);
});
