import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parsePreflightContext } from '../exchange/preflight-context.ts';
import { parseBridgeRuntime, parseRuntimeExpectations } from '../exchange/runtime.ts';
import { createPreflightReport, hasPreflightBlockers } from './preflight.ts';
import { attachPreflightRuntime } from './preflight-runtime.ts';

const raw = JSON.parse(await readFile(new URL('../../fixtures/preflight/context.json', import.meta.url), 'utf8'));
const context = parsePreflightContext(raw);
const report = createPreflightReport(context);
const check = { id: 'photo', scenario: 'capture', platform: 'macos', transport: 'method-channel', channel: 'camera', method: 'photo' };
const expected = (checks = [check], revision = context.revision) => parseRuntimeExpectations({
  format: 'bridge-expectations', version: 1, project: context.project, revision, checks,
});
const event = { sequence: 1, instance: 'main', transport: 'method-channel', channel: 'camera', method: 'photo', outcome: 'success',
  caller: { path: 'lib/bridge.dart', line: 4, column: 1 } };
const observed = (changes: Record<string, unknown> = {}) => parseBridgeRuntime({
  format: 'bridge-runtime', version: 1, project: context.project, revision: context.revision,
  tool: { name: 'recorder', version: '1' }, run: { id: 'capture', scenario: 'capture', platform: 'macos', status: 'completed',
    startedAt: '2026-09-14T00:00:00Z', finishedAt: '2026-09-14T00:00:01Z' }, droppedEvents: 0, events: [event], ...changes,
});

test('같은 revision의 실행을 전이 경계에 연결하되 native 실행 심볼로 확정하지 않는다', () => {
  const result = attachPreflightRuntime(context, report, expected(), [observed()]);
  assert.equal(result.runtime?.aligned, true);
  assert.equal(result.runtime?.verification.status, 'passed');
  assert.equal(hasPreflightBlockers(result), false);
  assert.equal(result.runtime?.routes[0]?.staticStatus, 'candidates');
  assert.ok(result.runtime?.routes[0]?.boundaryKeys.includes(JSON.stringify(['bridge', 'flutter', 'camera', 'photo'])));
  assert.equal(result.complete, false);
  assert.deepEqual(result.affected, report.affected, 'runtime address matches must not replace source dependency edges');
});

test('관련 없는 시나리오만 성공해도 선택된 native 경계는 미검증이다', () => {
  const unrelated = { ...check, channel: 'unrelated' };
  const result = attachPreflightRuntime(context, report, expected([unrelated]), [observed({
    events: [{ ...event, channel: 'unrelated' }],
  })]);
  assert.equal(result.runtime?.verification.status, 'passed');
  assert.ok(result.runtime!.unobservedBoundaries.length > 0);
  assert.ok(result.runtime!.uncoveredBoundaries.length > 0);
  assert.equal(result.runtime?.routes.length, 1);
  assert.deepEqual(result.runtime?.routes[0]?.selectionReasons, ['caller-file']);
  assert.equal(hasPreflightBlockers(result), true);
});

test('같은 주소라도 다른 시나리오 실행은 독립적으로 요구한 시나리오를 검증하지 않는다', () => {
  const result = attachPreflightRuntime(context, report, expected(), [observed({
    run: { ...observed().run, scenario: 'another-feature' },
  })]);
  assert.equal(result.runtime?.verification.summary.unobservedChecks, 1);
  assert.equal(result.runtime?.verification.status, 'incomplete');
  assert.equal(hasPreflightBlockers(result), true);
});

test('Objective-C native 후보의 출처를 보존하고 Swift 그래프 신원으로 바꾸지 않는다', () => {
  const value = structuredClone(raw);
  value.bridges[1].facts[1] = { ...value.bridges[1].facts[1], sourceLanguage: 'objective-c',
    symbol: { qualifiedName: 'Native.handle:', usr: 'c:objc-handler' },
    location: { path: 'ios/Native.m', line: 4, column: 1 } };
  const mixed = parsePreflightContext(value);
  const result = attachPreflightRuntime(mixed, createPreflightReport(mixed), expected(), [observed()]);
  assert.equal(result.runtime?.candidates[0]?.handlers[0]?.sourceLanguage, 'objective-c');
  assert.equal(result.affected.some(({ subject }) => subject.kind === 'symbol' && subject.symbol.id === 'c:objc-handler'), false);
  assert.ok(result.limitations.some(({ code }) => code === 'unresolved-bridge-binding'));
  assert.equal(hasPreflightBlockers(result), true);
});

test('오래된 기대와 기록이 서로 통과해도 현재 정적 분석의 실행 근거가 되지 않는다', () => {
  const result = attachPreflightRuntime(context, report, expected([check], 'old'), [observed({ revision: 'old' })]);
  assert.equal(result.runtime?.verification.status, 'passed');
  assert.equal(result.runtime?.aligned, false);
  assert.equal(result.runtime?.routes.length, 0);
  assert.equal(hasPreflightBlockers(result), true);
});

test('관찰 부재·pending·실패·유실은 전이 검증에서도 strict 실패로 남는다', () => {
  for (const documents of [[], [observed({ events: [] })], [observed({ events: [{ ...event, outcome: 'error' }] })],
    [observed({ events: [{ ...event, outcome: 'pending' }] })], [observed({ droppedEvents: 1 })], [observed({ revision: 'old' })]]) {
    const result = attachPreflightRuntime(context, report, expected(), documents);
    assert.equal(hasPreflightBlockers(result), true);
  }
});

test('명시한 실패 결과는 검증되며 실패를 성공으로 바꿔 기록하지 않는다', () => {
  const expectations = parseRuntimeExpectations({ format: 'bridge-expectations', version: 1,
    project: context.project, revision: context.revision, checks: [{ ...check, allowedOutcomes: ['error'] }] });
  const result = attachPreflightRuntime(context, report, expectations, [observed({ events: [{ ...event, outcome: 'error' }] })]);
  assert.equal(result.runtime?.verification.status, 'passed');
  assert.equal(result.runtime?.verification.summary.expectedFailedCalls, 1);
  assert.equal(result.runtime?.routes[0]?.outcomes.error, 1);
  assert.equal(hasPreflightBlockers(result), false);
});

test('Basic과 Android 주소를 Swift MethodChannel 정적 경계로 연결하지 않는다', () => {
  for (const changes of [
    { events: [{ ...event, transport: 'basic-message-channel', method: undefined }] },
    { run: { ...observed().run, platform: 'android' } },
  ]) {
    const result = attachPreflightRuntime(context, report, expected(), [observed(changes)]);
    assert.equal(result.runtime?.routes[0]?.staticStatus, 'unsupported');
    assert.deepEqual(result.runtime?.routes[0]?.boundaryKeys, []);
    assert.ok(result.runtime!.unobservedBoundaries.length > 0);
    assert.equal(hasPreflightBlockers(result), true);
  }
});

test('동적 정적 공백은 실행 성공 후에도 남으며 새 호출 파일은 검토 대상이 된다', () => {
  const value = structuredClone(raw);
  value.bridges[0].facts[1].method = 'dynamicMethod';
  value.bridges[0].facts[1].dynamic = true;
  const dynamic = parsePreflightContext(value);
  const before = createPreflightReport(dynamic);
  const result = attachPreflightRuntime(dynamic, before, expected(), [observed({ events: [{ ...event,
    caller: { path: 'lib/runtime_caller.dart', line: 1, column: 1 } }] })]);
  assert.equal(result.runtime?.verification.status, 'passed');
  assert.ok(result.limitations.some(({ code }) => code === 'unresolved-dynamic-boundary'));
  assert.ok(result.reviewFiles.includes('lib/runtime_caller.dart'));
  assert.equal(hasPreflightBlockers(result), true);
});

test('다른 project의 기대·기록은 함께 평가하지 않는다', () => {
  assert.throws(() => attachPreflightRuntime(context, report, { ...expected(), project: '/other' }, [observed()]));
  assert.throws(() => attachPreflightRuntime(context, report, expected(), [observed({ project: '/other' })]));
});

test('정적으로 못 이은 동적 Dart 호출의 native 후보 위치도 검토 대상으로 제공한다', () => {
  const value = structuredClone(raw);
  value.selection = { dart: { files: ['lib/bridge.dart'], symbols: [] } };
  const { trigger: _trigger, ...analysis } = value.analyses[1];
  value.analyses = [{ ...analysis, requested: value.selection.dart }];
  for (const fact of value.bridges[0].facts) { fact.channel = 'dynamicChannel'; fact.dynamic = true; }
  const originalHandler = value.bridges[1].facts[1];
  for (let index = 0; index < 25; index++) value.bridges[1].facts.push({ ...originalHandler,
    location: { path: `ios/zz-handler-${index}.swift`, line: 1, column: 1 },
    symbol: { qualifiedName: `Extra${index}.handle`, usr: `s:extra${index}` } });
  value.bridges[1].facts.push(structuredClone(originalHandler));
  const dynamic = parsePreflightContext(value);
  const before = createPreflightReport(dynamic);
  assert.equal(before.reviewFiles.includes('ios/Handler.swift'), false);
  const result = attachPreflightRuntime(dynamic, before, expected(), [observed({
    events: [event, { ...event, sequence: 2, instance: 'background' }, { ...event, sequence: 3 }],
  })]);
  assert.ok(result.reviewFiles.includes('ios/Handler.swift'));
  assert.equal(result.runtime?.candidates[0]?.handlers[0]?.symbol?.usr, 's:handler');
  assert.equal(result.runtime?.routes[0]?.candidateKey, result.runtime?.candidates[0]?.key);
  assert.equal(result.runtime?.candidates.length, 1, 'instances share one candidate set');
  assert.equal(result.runtime?.candidates[0]?.handlers.length, 20);
  assert.equal(result.runtime?.candidates[0]?.handlersOmitted, 6);
  assert.ok(result.reviewFiles.includes('ios/zz-handler-24.swift'));
  assert.deepEqual(result.runtime?.routes.map(({ observedCalls }) => observedCalls).sort(), [1, 2]);
  assert.deepEqual(result.runtime?.routes[0]?.boundaryKeys, []);
  assert.equal(hasPreflightBlockers(result), true, 'runtime candidates do not erase static uncertainty');
});
