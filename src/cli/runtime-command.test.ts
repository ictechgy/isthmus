import assert from 'node:assert/strict';
import test from 'node:test';
import { runRuntimeCommand } from './runtime-command.ts';

const expectations = { format: 'bridge-expectations', version: 1, project: '/app', revision: 'a',
  checks: [{ id: 'photo', scenario: 'photo', platform: 'ios', transport: 'method-channel',
    channel: 'camera', method: 'photo' }] };
const runtime = { format: 'bridge-runtime', version: 1, project: '/app', revision: 'a',
  tool: { name: 'recorder', version: '1' },
  run: { id: 'first', scenario: 'photo', platform: 'ios', status: 'completed',
    startedAt: '2026-09-14T00:00:00Z', finishedAt: '2026-09-14T00:00:01Z' },
  droppedEvents: 0, events: [{ sequence: 1, instance: 'main', transport: 'method-channel',
    channel: 'camera', method: 'photo', outcome: 'success' }] };
const args = ['verify-runtime', '--expectations', 'expect.json', 'runtime.json'];
const read = async (path: string) => JSON.stringify(path === 'expect.json' ? expectations : runtime);

test('선언한 런타임 검증 통과와 컴팩트 출력은 실제 JSON으로 제공한다', async () => {
  const result = await runRuntimeCommand([...args, '--compact', '--strict'], read);
  assert.equal(result.exitCode, 0);
  assert.equal(JSON.parse(result.standardOutput).status, 'passed');
  assert.equal(result.standardOutput.trim().split('\n').length, 1);
  assert.equal(result.standardError, '');
});

test('관찰되지 않은 호출은 기본 보고서 0, strict 실패 1로 구분한다', async () => {
  const readEmpty = async (path: string) => JSON.stringify(path === 'expect.json' ? expectations : { ...runtime, events: [] });
  const report = await runRuntimeCommand(args, readEmpty);
  assert.equal(report.exitCode, 0);
  assert.equal(JSON.parse(report.standardOutput).status, 'incomplete');
  assert.equal((await runRuntimeCommand([...args, '--strict'], readEmpty)).exitCode, 1);
});

test('필수 인수·입력 수·알 수 없는 플래그는 읽기 전에 거부한다', async () => {
  for (const input of [[], ['--expectations', 'x'], ['x.json'], ['--unknown', 'x'],
    ['--expectations', 'x', ...Array(257).fill('x')]]) {
    let reads = 0;
    const result = await runRuntimeCommand(['verify-runtime', ...input], async () => { reads++; return ''; });
    assert.equal(result.exitCode, 64);
    assert.equal(reads, 0);
  }
});

test('읽기·구문·계약 실패가 민감정보를 출력하지 않는다', async () => {
  for (const reader of [async () => { throw new Error('private-token'); },
    async () => 'private-token', async () => '{}']) {
    const result = await runRuntimeCommand(args, reader);
    assert.equal(result.exitCode, 2);
    assert.equal(result.standardOutput, '');
    assert.equal(result.standardError.includes('private-token'), false);
  }
});
