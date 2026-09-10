import assert from 'node:assert/strict';
import test from 'node:test';

import { parseCommandArguments } from './parse-arguments.ts';

test('플래그를 위치 인수 뒤에서도 읽는다', () => {
  const parsed = parseCommandArguments(
    ['a.json', 'b.json', '--format', 'dot'],
    ['--format'],
    [],
  );

  assert.deepEqual(parsed, {
    valueFlags: new Map([['--format', 'dot']]),
    booleanFlags: new Set(),
    positionals: ['a.json', 'b.json'],
  });
});

test('플래그를 위치 인수 앞에 두고 값 플래그를 섞어도 읽는다', () => {
  const parsed = parseCommandArguments(
    ['--format', 'sarif', 'a.json', '--strict', 'b.json'],
    ['--format'],
    ['--strict'],
  );

  assert.deepEqual(parsed, {
    valueFlags: new Map([['--format', 'sarif']]),
    booleanFlags: new Set(['--strict']),
    positionals: ['a.json', 'b.json'],
  });
});

test('`--` 뒤는 `-`로 시작해도 모두 위치 인수다', () => {
  const parsed = parseCommandArguments(
    ['--', '-weird.json', '--format'],
    ['--format'],
    [],
  );

  assert.deepEqual(parsed, {
    valueFlags: new Map(),
    booleanFlags: new Set(),
    positionals: ['-weird.json', '--format'],
  });
});

test('값 플래그 뒤의 값이 비었거나 `-`로 시작하면 거부한다', () => {
  assert.equal(parseCommandArguments(['--for'], ['--for'], []), undefined);
  assert.equal(parseCommandArguments(['--for', ''], ['--for'], []), undefined);
  const parsed = parseCommandArguments(['--for', 'cartograph'], ['--for'], []);
  assert.equal(parsed?.valueFlags.get('--for'), 'cartograph');
  assert.equal(
    parseCommandArguments(['--baseline', '-x'], ['--baseline'], []),
    undefined,
  );
});

test('값 플래그를 두 번 주면 거부하고 값 없는 플래그 반복은 한 번과 같다', () => {
  assert.equal(
    parseCommandArguments(
      ['--format', 'json', '--format', 'sarif'],
      ['--format'],
      [],
    ),
    undefined,
  );
  const parsed = parseCommandArguments(
    ['--strict', '--strict'],
    [],
    ['--strict'],
  );

  assert.deepEqual(parsed?.booleanFlags, new Set(['--strict']));
});

test('모르는 플래그는 `--` 앞에서만 거부한다', () => {
  assert.equal(parseCommandArguments(['--unknown'], [], []), undefined);
  assert.equal(parseCommandArguments(['-x'], [], []), undefined);
  const parsed = parseCommandArguments(['a.json', '--', '--unknown'], [], []);

  assert.deepEqual(parsed?.positionals, ['a.json', '--unknown']);
});
