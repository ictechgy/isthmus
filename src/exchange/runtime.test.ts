import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseBridgeRuntime, parseRuntimeExpectations, RuntimeValidationError,
} from './runtime.ts';

const call = { sequence: 1, instance: 'main', transport: 'method-channel', channel: 'camera',
  method: 'takePhoto', outcome: 'success', caller: { path: 'lib/camera.dart', line: 4, column: 1 } };
const trace = { format: 'bridge-runtime', version: 1, project: '/app', revision: 'revision-a',
  tool: { name: 'isthmus-runtime', version: '0.1.0' },
  run: { id: 'run-1', scenario: 'take-photo', platform: 'ios', status: 'completed',
    startedAt: '2026-09-14T00:00:00Z', finishedAt: '2026-09-14T00:00:01Z' },
  droppedEvents: 0, events: [call] };
const expectations = { format: 'bridge-expectations', version: 1, project: '/app', revision: 'revision-a',
  checks: [{ id: 'photo', scenario: 'take-photo', platform: 'ios', transport: 'method-channel',
    channel: 'camera', method: 'takePhoto' }] };

test('런타임 관찰은 실제 라우팅과 호출 위치만 보존하고 payload·오류 본문은 제거한다', () => {
  const parsed = parseBridgeRuntime({ ...trace, events: [{ ...call,
    arguments: { token: 'never-emit' }, result: 'never-emit', error: 'never-emit' }] });
  assert.equal(parsed.events[0]?.method, 'takePhoto');
  assert.equal(JSON.stringify(parsed).includes('never-emit'), false);
  assert.deepEqual(parsed.events[0]?.caller, call.caller);
});

test('완료되지 않은 실행·진행 중 호출·유실 이벤트 수를 보존한다', () => {
  const parsed = parseBridgeRuntime({ ...trace,
    run: { ...trace.run, status: 'incomplete', finishedAt: undefined },
    droppedEvents: 7, events: [{ ...call, outcome: 'pending' }] });
  assert.equal(parsed.run.status, 'incomplete');
  assert.equal(parsed.droppedEvents, 7);
  assert.equal(parsed.events[0]?.outcome, 'pending');
});

test('BasicMessageChannel은 메서드 이름을 지어내지 않고 채널 라우팅으로 기록한다', () => {
  const parsed = parseBridgeRuntime({ ...trace,
    events: [{ ...call, method: undefined, transport: 'basic-message-channel', caller: undefined }] });
  assert.equal(parsed.events[0]?.method, undefined);
  assert.equal(parsed.events[0]?.caller, undefined);
});

test('인스턴스를 지정한 기대와 전체 인스턴스 기대를 구분한다', () => {
  assert.equal(parseRuntimeExpectations(expectations).checks[0]?.instance, undefined);
  const parsed = parseRuntimeExpectations({ ...expectations,
    checks: [{ ...expectations.checks[0], instance: 'background' }] });
  assert.equal(parsed.checks[0]?.instance, 'background');
});

test('기대 결과는 terminal outcome만 허용하고 생략 시 성공만 허용한다', () => {
  assert.deepEqual(parseRuntimeExpectations(expectations).checks[0]?.allowedOutcomes, ['success']);
  const parsed = parseRuntimeExpectations({ ...expectations,
    checks: [{ ...expectations.checks[0], allowedOutcomes: ['error', 'missing-handler'] }] });
  assert.deepEqual(parsed.checks[0]?.allowedOutcomes, ['error', 'missing-handler']);
});

test('런타임 스키마·시각·플랫폼·라우팅·중복·상한 오류는 값 노출 없이 거부한다', () => {
  const bad = [null, [], {}, { ...trace, version: 2 }, { ...trace, project: '' },
    { ...trace, revision: '' }, { ...trace, tool: {} }, { ...trace, events: null },
    { ...trace, events: Array(100001).fill(call) },
    { ...trace, events: [call, call] }, { ...trace, droppedEvents: -1 },
    { ...trace, run: {} }, { ...trace, run: { ...trace.run, finishedAt: undefined } },
    { ...trace, run: { ...trace.run, finishedAt: '2026-09-13T00:00:00Z' } },
    { ...trace, run: { ...trace.run, startedAt: 'invalid' } },
    { ...trace, run: { ...trace.run, status: 'passed' } },
    { ...trace, run: { ...trace.run, platform: 'guess' } },
    ...[{ sequence: 0 }, { sequence: 3 }, { instance: '' }, { channel: '' }, { transport: 'unknown' },
      { method: undefined }, { outcome: 'unknown' },
      { caller: { path: '/private/token', line: 1, column: 1 } },
      { caller: { path: 'a.dart', line: 0, column: 1 } },
      { transport: 'basic-message-channel', method: 'invented' }].map((change) =>
      ({ ...trace, events: [{ ...call, ...change }] }))];
  for (const input of bad) {
    assert.throws(() => parseBridgeRuntime(input), (error: unknown) => {
      assert.ok(error instanceof RuntimeValidationError);
      assert.equal(error.message.includes('/private'), false);
      return true;
    });
  }
});

test('검증 대상 없는 기대 문서와 중복 id는 빈 통과를 만들 수 없다', () => {
  for (const input of [null, [], {}, { ...expectations, version: 2 },
    { ...expectations, checks: [] }, { ...expectations, checks: {} },
    { ...expectations, checks: Array(10001).fill(expectations.checks[0]) },
    { ...expectations, checks: [expectations.checks[0], expectations.checks[0]] },
    { ...expectations, checks: [{ ...expectations.checks[0], instance: '' }] },
    { ...expectations, checks: [{ ...expectations.checks[0], allowedOutcomes: [] }] },
    { ...expectations, checks: [{ ...expectations.checks[0], allowedOutcomes: ['pending'] }] },
    { ...expectations, checks: [{ ...expectations.checks[0], allowedOutcomes: ['success', 'success'] }] },
    { ...expectations, checks: [{ ...expectations.checks[0], allowedOutcomes: ['success', 'error', 'missing-handler', 'timeout', 'success'] }] },
    { ...expectations, checks: [{ ...expectations.checks[0], allowedOutcomes: 'success' }] },
    { ...expectations, checks: [{ ...expectations.checks[0], allowedOutcomes: [1] }] }]) {
    assert.throws(() => parseRuntimeExpectations(input), RuntimeValidationError);
  }
});
