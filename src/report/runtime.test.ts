import assert from 'node:assert/strict';
import test from 'node:test';
import { parseBridgeRuntime, parseRuntimeExpectations } from '../exchange/runtime.ts';
import { verifyRuntimeEvidence } from './runtime.ts';

const call = { sequence: 1, instance: 'main', transport: 'method-channel',
  channel: 'camera', method: 'takePhoto', outcome: 'success' };
const rawTrace = { format: 'bridge-runtime', version: 1, project: '/app', revision: 'a',
  tool: { name: 'recorder', version: '1' },
  run: { id: 'run-1', scenario: 'photo', platform: 'ios', status: 'completed',
    startedAt: '2026-09-14T00:00:00Z', finishedAt: '2026-09-14T00:00:01Z' },
  droppedEvents: 0, events: [call] };
const rawExpected = { format: 'bridge-expectations', version: 1, project: '/app', revision: 'a',
  checks: [{ id: 'photo', scenario: 'photo', platform: 'ios',
    transport: 'method-channel', channel: 'camera', method: 'takePhoto', instance: 'main' }] };
const expected = parseRuntimeExpectations(rawExpected);

test('시나리오·플랫폼·revision·인스턴스·호출 성공이 맞아야 선언된 검증이 통과한다', () => {
  const report = verifyRuntimeEvidence(expected, [parseBridgeRuntime(rawTrace)]);
  assert.equal(report.status, 'passed');
  assert.equal(report.project, '/app');
  assert.equal(report.complete, false);
  assert.equal(report.scope, 'declared-scenarios');
  assert.equal(report.checks[0]?.status, 'passed');
  assert.equal(report.checks[0]?.evidence[0]?.runId, 'run-1');
  assert.equal(report.summary.passedChecks, 1);
});

test('실행되지 않은 시나리오·다른 플랫폼·다른 엔진은 관찰 없음으로 보고한다', () => {
  for (const trace of [{ ...rawTrace, run: { ...rawTrace.run, scenario: 'other' } },
    { ...rawTrace, run: { ...rawTrace.run, platform: 'macos' } },
    { ...rawTrace, events: [{ ...call, instance: 'background' }] },
    { ...rawTrace, events: [] }]) {
    const report = verifyRuntimeEvidence(expected, [parseBridgeRuntime(trace)]);
    assert.equal(report.status, 'incomplete');
    assert.equal(report.checks[0]?.status, 'unobserved');
  }
});

test('같은 호출이 한 번 성공해도 실패·timeout·미구현이 함께 있으면 통과하지 않는다', () => {
  for (const outcome of ['error', 'timeout', 'missing-handler']) {
    const report = verifyRuntimeEvidence(expected, [parseBridgeRuntime({ ...rawTrace,
      events: [call, { ...call, sequence: 2, outcome }] })]);
    assert.equal(report.status, 'failed');
    assert.equal(report.checks[0]?.status, 'failed');
    assert.equal(report.summary.failedCalls, 1);
  }
});

test('허용한 error·missing-handler 결과는 기대를 통과시키고 실패 집계를 보존한다', () => {
  for (const outcome of ['error', 'missing-handler']) {
    const expectations = parseRuntimeExpectations({ ...rawExpected,
      checks: [{ ...rawExpected.checks[0], allowedOutcomes: [outcome] }] });
    const report = verifyRuntimeEvidence(expectations, [parseBridgeRuntime({ ...rawTrace,
      events: [{ ...call, outcome }] })]);
    assert.equal(report.status, 'passed');
    assert.equal(report.checks[0]?.status, 'passed');
    assert.equal(report.summary.failedCalls, 1);
    assert.equal(report.summary.expectedFailedCalls, 1);
    assert.equal(report.summary.unexpectedFailedCalls, 0);
  }
});

test('성공만 허용하지 않는 기대는 예기치 않은 성공으로 실패한다', () => {
  const expectations = parseRuntimeExpectations({ ...rawExpected,
    checks: [{ ...rawExpected.checks[0], allowedOutcomes: ['error'] }] });
  const report = verifyRuntimeEvidence(expectations, [parseBridgeRuntime(rawTrace)]);
  assert.equal(report.status, 'failed');
  assert.equal(report.checks[0]?.status, 'failed');
  assert.equal(report.summary.failedCalls, 0);
  assert.equal(report.summary.expectedFailedCalls, 0);
  assert.equal(report.summary.unexpectedFailedCalls, 0);
});

test('겹치는 전체·특정 인스턴스 기대는 각 허용 목록을 모두 적용한다', () => {
  const expectations = parseRuntimeExpectations({ ...rawExpected, checks: [
    { ...rawExpected.checks[0], id: 'any', instance: undefined, allowedOutcomes: ['error'] },
    { ...rawExpected.checks[0], id: 'main', instance: 'main', allowedOutcomes: ['success'] },
  ] });
  const report = verifyRuntimeEvidence(expectations, [parseBridgeRuntime({ ...rawTrace,
    events: [{ ...call, outcome: 'error' }] })]);
  assert.equal(report.status, 'failed');
  assert.equal(report.checks.find(({ expected }) => expected.id === 'any')?.status, 'passed');
  assert.equal(report.checks.find(({ expected }) => expected.id === 'main')?.status, 'failed');
  assert.equal(report.summary.expectedFailedCalls, 0);
  assert.equal(report.summary.unexpectedFailedCalls, 1);
});

test('허용된 실패라도 관찰 부재·pending·미완료 실행은 통과하지 않는다', () => {
  const expectations = parseRuntimeExpectations({ ...rawExpected,
    checks: [{ ...rawExpected.checks[0], allowedOutcomes: ['error'] }] });
  const absent = verifyRuntimeEvidence(expectations, [parseBridgeRuntime({ ...rawTrace, events: [] })]);
  assert.equal(absent.status, 'incomplete');
  assert.equal(absent.checks[0]?.status, 'unobserved');
  for (const trace of [
    { ...rawTrace, run: { ...rawTrace.run, status: 'incomplete' as const }, events: [{ ...call, outcome: 'error' }] },
    { ...rawTrace, events: [{ ...call, outcome: 'error' }, { ...call, sequence: 2, outcome: 'pending' as const }] },
  ]) {
    const report = verifyRuntimeEvidence(expectations, [parseBridgeRuntime(trace)]);
    assert.equal(report.status, 'incomplete');
    assert.equal(report.checks[0]?.status, 'incomplete');
  }
});

test('실행 중단·이벤트 유실·응답 대기는 성공 관찰이 있어도 미완료다', () => {
  for (const trace of [{ ...rawTrace, run: { ...rawTrace.run, status: 'incomplete' } },
    { ...rawTrace, droppedEvents: 2 },
    { ...rawTrace, events: [call, { ...call, sequence: 2, outcome: 'pending' }] }]) {
    const report = verifyRuntimeEvidence(expected, [parseBridgeRuntime(trace)]);
    assert.equal(report.status, 'incomplete');
    assert.equal(report.checks[0]?.status, 'incomplete');
  }
});

test('다른 revision의 실행 성공은 최신 코드의 검증 근거가 될 수 없다', () => {
  const report = verifyRuntimeEvidence(expected, [parseBridgeRuntime({ ...rawTrace, revision: 'old' })]);
  assert.equal(report.status, 'incomplete');
  assert.equal(report.summary.staleRuns, 1);
  assert.equal(report.checks[0]?.status, 'unobserved');
  assert.deepEqual(report.checks[0]?.evidence, []);
});

test('기대 목록 밖의 런타임 실패도 전체 검증에서 숨기지 않는다', () => {
  const report = verifyRuntimeEvidence(expected, [parseBridgeRuntime({ ...rawTrace,
    events: [call, { ...call, sequence: 2, channel: 'other', outcome: 'error' }] })]);
  assert.equal(report.status, 'failed');
  assert.equal(report.checks[0]?.status, 'passed');
  assert.equal(report.failures[0]?.event.channel, 'other');
});

test('서로 다른 project·중복 run 입력을 조용히 합치지 않는다', () => {
  const trace = parseBridgeRuntime(rawTrace);
  assert.throws(() => verifyRuntimeEvidence(expected, [{ ...trace, project: '/other' }]), /same project/);
  assert.throws(() => verifyRuntimeEvidence(expected, [trace, trace]), /Duplicate runtime run/);
});

test('이름에 구분자가 있어도 라우팅 키가 충돌하지 않고 Basic 메시지도 검증한다', () => {
  const check = { ...rawExpected.checks[0], channel: 'camera#takePhoto',
    method: undefined, transport: 'basic-message-channel', instance: undefined };
  const expectations = parseRuntimeExpectations({ ...rawExpected, checks: [check] });
  assert.equal(verifyRuntimeEvidence(expectations, [parseBridgeRuntime(rawTrace)]).status, 'incomplete');
  const trace = parseBridgeRuntime({ ...rawTrace, events: [{ ...call,
    transport: 'basic-message-channel', channel: 'camera#takePhoto', method: undefined }] });
  assert.equal(verifyRuntimeEvidence(expectations, [trace]).status, 'passed');
});

test('빈 런타임 입력과 스냅샷 순서 변경의 의미가 결정적이다', () => {
  assert.equal(verifyRuntimeEvidence(expected, []).status, 'incomplete');
  const first = parseBridgeRuntime(rawTrace);
  const second = parseBridgeRuntime({ ...rawTrace, run: { ...rawTrace.run, id: 'run-2' } });
  assert.deepEqual(verifyRuntimeEvidence(expected, [first, second]),
    verifyRuntimeEvidence(expected, [second, first]));
});

test('표시 상한 밖의 실패도 평가하며 출력 생략을 수집 유실과 구분한다', () => {
  const events = Array.from({ length: 30 }, (_, index) => ({ ...call, sequence: index + 1,
    outcome: index === 29 ? 'error' : 'success' }));
  const report = verifyRuntimeEvidence(expected, [parseBridgeRuntime({ ...rawTrace, events })]);
  assert.equal(report.status, 'failed');
  assert.equal(report.checks[0]?.observedCalls, 30);
  assert.equal(report.checks[0]?.evidence.length, 20);
  assert.equal(report.checks[0]?.evidenceOmitted, 10);
  assert.equal(report.summary.droppedEvents, 0);
  assert.equal(report.failures[0]?.event.sequence, 30);
});

test('입력 문서와 유실 수의 합계 상한을 넘으면 실패한다', () => {
  assert.throws(() => verifyRuntimeEvidence(expected, Array(257).fill(parseBridgeRuntime(rawTrace))), /Too many/);
  const trace = parseBridgeRuntime({ ...rawTrace, droppedEvents: Number.MAX_SAFE_INTEGER });
  assert.throws(() => verifyRuntimeEvidence(expected, [trace, { ...trace, run: { ...trace.run, id: 'second' } }]),
    /integer limit/);
});
