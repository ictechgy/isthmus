import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runImpactCommand } from './impact-command.ts';
import { MAX_INPUT_TEXT_LENGTH } from './command-support.ts';

const dart = await readFile(new URL('../../experiments/phase-0/expected/dart.json', import.meta.url), 'utf8');
const swift = await readFile(new URL('../../experiments/phase-0/expected/swift.json', import.meta.url), 'utf8');
const inputs = new Map([
  ['dart.json', dart], ['swift.json', swift],
  ['changes.json', JSON.stringify({ format: 'isthmus-changes', version: 1,
    files: ['ios/Runner/CameraPlugin.swift'] })],
  ['runtime.json', JSON.stringify({ format: 'bridge-runtime', version: 1,
    project: JSON.parse(dart).project, revision: 'current', tool: { name: 'recorder', version: '1' },
    run: { id: 'run', scenario: 'photo', platform: 'ios', status: 'completed',
      startedAt: '2026-09-14T00:00:00Z', finishedAt: '2026-09-14T00:00:01Z' }, droppedEvents: 0,
    events: [{ sequence: 1, instance: 'main', transport: 'method-channel', channel: 'dev.isthmus/camera',
      method: 'takePhoto', outcome: 'success', caller: { path: 'lib/caller.dart', line: 1, column: 1 } }],
  })],
]);
const read = async (path: string) => {
  const text = inputs.get(path);
  if (text === undefined) throw new Error('private path');
  return text;
};

test('파일·심볼·변경 JSON 선택이 같은 실행 경계로 동작한다', async () => {
  for (const args of [
    ['--file', 'ios/Runner/CameraPlugin.swift'], ['--changes', 'changes.json'],
    ['--symbol', 'unknown'],
  ]) {
    const result = await runImpactCommand(['impact', 'dart.json', ...args, 'swift.json'], read);
    assert.equal(result.exitCode, 0);
    assert.equal(JSON.parse(result.standardOutput).format, 'isthmus-impact');
  }
});

test('strict는 알려진 분석 공백과 미관찰 선택에서 실패한다', async () => {
  for (const file of ['ios/Runner/CameraPlugin.swift', 'deleted.dart']) {
    const result = await runImpactCommand(['impact', '--file', file, '--strict', 'dart.json', 'swift.json'], read);
    assert.equal(result.exitCode, 1);
    assert.ok(result.standardError.includes('review'));
    assert.equal(JSON.parse(result.standardOutput).complete, false);
  }
});

test('strict도 분석 공백·관련 오류가 없는 관찰은 실행 성공으로 보고한다', async () => {
  const readClean = async (path: string) => {
    const document = JSON.parse(await read(path));
    document.limitations = [];
    document.facts = document.facts.filter((fact: { dynamic: boolean; channel: string | null; method?: string }) =>
      !fact.dynamic && fact.channel !== null && (fact.method === undefined || fact.method === 'takePhoto'));
    return JSON.stringify(document);
  };
  const result = await runImpactCommand(['impact', '--file', 'ios/Runner/CameraPlugin.swift',
    '--strict', '--compact', 'dart.json', 'swift.json'], readClean);
  assert.equal(result.exitCode, 0);
  assert.equal(result.standardOutput.trim().split('\n').length, 1);
  assert.equal(result.standardError, '');
});

test('인수 오류는 파일을 읽기 전에 거부한다', async () => {
  for (const args of [[], ['--file', 'x'], ['--file', '../private', 'a', 'b'],
    ['--symbol', '', 'a', 'b'], ['--file', 'x', '--symbol', 'X', 'a', 'b'],
    ['--changes', 'c', '--file', 'x', 'a', 'b'], ['--unknown', 'a', 'b'],
    ['--file', 'x', ...Array(257).fill('a')]]) {
    let reads = 0;
    const result = await runImpactCommand(['impact', ...args], async () => { reads++; return ''; });
    assert.equal(result.exitCode, 64);
    assert.equal(reads, 0);
  }
});

test('변경 파일 읽기·JSON·스키마·크기 실패가 경로·내용 없이 구분된다', async () => {
  for (const [text, expected] of [[undefined, 'read changes'], ['private invalid JSON', 'valid JSON'],
    ['{}', 'contract'], [' '.repeat(MAX_INPUT_TEXT_LENGTH + 1), 'size limit']] as const) {
    const result = await runImpactCommand(['impact', '--changes', 'private.json', 'dart.json', 'swift.json'],
      async () => { if (text === undefined) throw new Error('private.json'); return text; });
    assert.equal(result.exitCode, 2);
    assert.ok(result.standardError.includes(expected));
    assert.equal(result.standardError.includes('private'), false);
    assert.equal(result.standardOutput, '');
  }
});

test('브리지 파일 실패와 조인 보류가 부분 영향 결과를 출력하지 않는다', async () => {
  const readMixed = async (path: string) => {
    const document = JSON.parse(await read(path));
    document.limitations.push('mixed-targets: Flutter and RN');
    return JSON.stringify(document);
  };
  for (const reader of [async () => { throw new Error('private'); }, readMixed]) {
    const result = await runImpactCommand(['impact', '--file', 'x.dart', 'dart.json', 'swift.json'], reader);
    assert.equal(result.exitCode, 2);
    assert.equal(result.standardOutput, '');
    assert.equal(result.standardError.includes('private'), false);
  }
});

test('런타임 보조 입력은 명시된 분석 revision과 함께 영향 보고서에 연결된다', async () => {
  const args = ['impact', '--file', 'ios/Runner/CameraPlugin.swift', '--runtime', 'runtime.json',
    '--revision', 'current', 'dart.json', 'swift.json'];
  const result = await runImpactCommand(args, read);
  assert.equal(result.exitCode, 0);
  const report = JSON.parse(result.standardOutput);
  assert.equal(report.runtime.selectedEvents, 1);
  assert.ok(report.reviewFiles.includes('lib/caller.dart'));
  const stale = await runImpactCommand(args.map((arg) => arg === 'current' ? 'newer' : arg), read);
  assert.equal(JSON.parse(stale.standardOutput).runtime.stale, true);
});

test('런타임·revision은 함께 지정해야 하며 잘못된 보조 입력은 코드 2다', async () => {
  for (const flags of [['--runtime', 'runtime.json'], ['--revision', 'current'],
    ['--runtime', 'runtime.json', '--revision', 'bad\nrevision']]) {
    let reads = 0;
    const result = await runImpactCommand(['impact', '--file', 'a.dart', ...flags, 'dart.json', 'swift.json'],
      async () => { reads++; return ''; });
    assert.equal(result.exitCode, 64);
    assert.equal(reads, 0);
  }
  const result = await runImpactCommand(['impact', '--file', 'a.dart', '--runtime', 'dart.json',
    '--revision', 'current', 'dart.json', 'swift.json'], read);
  assert.equal(result.exitCode, 2);
  assert.equal(result.standardOutput, '');
});
