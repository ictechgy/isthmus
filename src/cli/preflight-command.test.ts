import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runPreflightCommand } from './preflight-command.ts';
import { MAX_TOTAL_INPUT_TEXT_LENGTH } from './command-support.ts';

const input = await readFile(new URL('../../fixtures/preflight/context.json', import.meta.url), 'utf8');
const read = async () => input;

test('preflight는 Swift 변경에서 Dart 화면까지의 근거와 compact 결과를 제공한다', async () => {
  const normal = await runPreflightCommand(['preflight', 'context.json', '--strict'], read);
  const compact = await runPreflightCommand(['preflight', '--strict', '--compact', 'context.json'], read);
  assert.equal(normal.exitCode, 0);
  assert.equal(compact.exitCode, 0);
  assert.deepEqual(JSON.parse(compact.standardOutput), JSON.parse(normal.standardOutput));
  assert.equal(compact.standardOutput.trim().split('\n').length, 1);
  const report = JSON.parse(normal.standardOutput);
  assert.equal(report.scope, 'cross-language-impact');
  assert.equal(report.complete, false);
  assert.ok(report.reviewFiles.includes('lib/screen.dart'));
  assert.ok(report.affected.some(({ subject }: { subject: { symbol?: { id: string } } }) => subject.symbol?.id === 'dart:screen'));
});

test('strict는 누락된 후속 분석·producer 공백·미관찰 선택·다른 revision에 실패한다', async () => {
  for (const mutate of [
    (value: any) => { value.analyses.pop(); },
    (value: any) => { value.analyses[0].limitations.push('unresolved dispatch'); },
    (value: any) => { value.analyses[0].roots = []; value.analyses[0].affected = []; },
  ]) {
    const value = JSON.parse(input);
    mutate(value);
    const result = await runPreflightCommand(['preflight', 'context.json', '--strict'], async () => JSON.stringify(value));
    assert.equal(result.exitCode, 1);
    assert.equal(JSON.parse(result.standardOutput).complete, false);
  }
  const stale = await runPreflightCommand(['preflight', 'context.json', '--revision', 'new', '--strict'], read);
  assert.equal(stale.exitCode, 1);
  assert.ok(JSON.parse(stale.standardOutput).limitations.some(({ code }: { code: string }) => code === 'capture-limitation'));
});

test('선택 없는 입력은 noChanges로 구분한다', async () => {
  const value = JSON.parse(input);
  value.selection = {}; value.analyses = [];
  const result = await runPreflightCommand(['preflight', 'context.json', '--strict'], async () => JSON.stringify(value));
  assert.equal(result.exitCode, 0);
  assert.equal(JSON.parse(result.standardOutput).status, 'noChanges');
});

test('인수 실패는 읽기 전에 64, 입력 실패는 값 노출 없이 2다', async () => {
  for (const args of [[], ['a', 'b'], ['--unknown', 'a'], ['--revision', 'bad\nvalue', 'a']]) {
    const result = await runPreflightCommand(['preflight', ...args], async () => { assert.fail('must not read'); });
    assert.equal(result.exitCode, 64);
  }
  for (const value of [undefined, 'private invalid JSON', '{}', ' '.repeat(MAX_TOTAL_INPUT_TEXT_LENGTH + 1)]) {
    const result = await runPreflightCommand(['preflight', 'private-path'], async () => {
      if (value === undefined) throw new Error('private-path');
      return value;
    });
    assert.equal(result.exitCode, 2);
    assert.equal(result.standardOutput, '');
    assert.equal(result.standardError.includes('private'), false);
  }
});
