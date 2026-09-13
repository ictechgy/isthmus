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

test('preflight 프로세스 경계가 runtime 기대·기록·누락과 읽기 실패를 함께 평가한다', async () => {
  const context = JSON.parse(input);
  const expectations = { format: 'bridge-expectations', version: 1, project: context.project, revision: context.revision,
    checks: [{ id: 'capture', scenario: 'capture', platform: 'macos', transport: 'method-channel', channel: 'camera', method: 'photo' }] };
  const runtime = { format: 'bridge-runtime', version: 1, project: context.project, revision: context.revision,
    tool: { name: 'recorder', version: '1' }, run: { id: 'capture', scenario: 'capture', platform: 'macos', status: 'completed',
      startedAt: '2026-09-14T00:00:00Z', finishedAt: '2026-09-14T00:00:01Z' }, droppedEvents: 0,
    events: [{ sequence: 1, instance: 'main', transport: 'method-channel', channel: 'camera', method: 'photo', outcome: 'success' }] };
  const inputs = new Map([['context', input], ['expectations', JSON.stringify(expectations)], ['runtime', JSON.stringify(runtime)]]);
  const reader = async (path: string) => { const text = inputs.get(path); if (text === undefined) throw new Error('private'); return text; };
  const base = ['preflight', 'context', '--expectations', 'expectations', '--strict', '--compact'];
  const success = await runPreflightCommand([...base, 'runtime'], reader);
  assert.equal(success.exitCode, 0);
  assert.equal(JSON.parse(success.standardOutput).runtime.verification.status, 'passed');
  const missing = await runPreflightCommand(base, reader);
  assert.equal(missing.exitCode, 1);
  assert.equal(JSON.parse(missing.standardOutput).runtime.verification.summary.unobservedChecks, 1);
  const invalid = await runPreflightCommand([...base, 'private'], reader);
  assert.equal(invalid.exitCode, 2);
  assert.equal(invalid.standardOutput, '');
  assert.equal(invalid.standardError.includes('private'), false);
  inputs.set('expectations', '{}');
  assert.equal((await runPreflightCommand([...base, 'runtime'], reader)).exitCode, 2);
  let reads = 0;
  assert.equal((await runPreflightCommand(['preflight', 'context', 'runtime'], async () => { reads++; return ''; })).exitCode, 64);
  assert.equal(reads, 0);
});

test('preflight summary와 explain은 원본 strict 판정을 유지하면서 bounded 결과를 제공한다', async () => {
  const summary = await runPreflightCommand(['preflight', 'context.json', '--summary', '--limit', '1'], read);
  assert.equal(summary.exitCode, 0);
  const summaryDocument = JSON.parse(summary.standardOutput);
  assert.equal(summaryDocument.format, 'isthmus-preflight-summary');
  assert.equal(summaryDocument.affected.items.length, 1);
  assert.ok(summaryDocument.affected.omitted > 0);

  const explanation = await runPreflightCommand(['preflight', 'context.json', '--explain', 'dart:screen', '--strict'], read);
  assert.equal(explanation.exitCode, 0);
  assert.equal(JSON.parse(explanation.standardOutput).status, 'found');

  for (const args of [
    ['preflight', 'context.json', '--summary', '--explain', 'dart:screen'],
    ['preflight', 'context.json', '--limit', '1'],
    ['preflight', 'context.json', '--summary', '--limit', '0'],
    ['preflight', 'context.json', '--summary', '--limit', '101'],
  ]) {
    const invalid = await runPreflightCommand(args, async () => { assert.fail('invalid view arguments must not read'); });
    assert.equal(invalid.exitCode, 64);
    assert.equal(invalid.standardOutput, '');
  }
});

test('explain notFound와 ambiguous는 JSON과 64를 반환한다', async () => {
  const missing = await runPreflightCommand(['preflight', 'context.json', '--explain', 'missing-subject'], read);
  assert.equal(missing.exitCode, 64);
  assert.equal(JSON.parse(missing.standardOutput).status, 'notFound');
  assert.match(missing.standardError, /No preflight subject/);
});
