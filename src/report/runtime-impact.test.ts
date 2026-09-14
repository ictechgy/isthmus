import assert from 'node:assert/strict';
import test from 'node:test';
import { parseBridgeFactsDocument } from '../exchange/parse.ts';
import { parseBridgeRuntime } from '../exchange/runtime.ts';
import { createBridgeImpact, hasImpactBlockers } from './impact.ts';

const location = { path: 'lib/dynamic.dart', line: 3, column: 1 };
const dart = parseBridgeFactsDocument({ format: 'bridge-facts', version: 1, project: '/app',
  tool: { name: 'dartograph', version: '1' }, generatedAt: '2026-09-14T00:00:00Z', platform: 'dart',
  target: 'flutter', limitations: [], facts: [{ kind: 'method-invoke', channel: 'runtimeName',
    method: 'runtimeMethod', dynamic: true, location }] });
const swift = parseBridgeFactsDocument({ format: 'bridge-facts', version: 1, project: '/app',
  tool: { name: 'cartograph', version: '1' }, generatedAt: '2026-09-14T00:00:00Z', platform: 'swift',
  target: 'flutter', limitations: [], facts: [{ kind: 'method-handle', channel: 'camera', method: 'photo',
    dynamic: false, location: { path: 'ios/Camera.swift', line: 20, column: 1 },
    symbol: { qualifiedName: 'Camera.handle', usr: 's:Camera' } }] });
const raw = { format: 'bridge-runtime', version: 1, project: '/app', revision: 'current',
  tool: { name: 'recorder', version: '1' }, run: { id: 'run', scenario: 'photo', platform: 'ios',
    status: 'completed', startedAt: '2026-09-14T00:00:00Z', finishedAt: '2026-09-14T00:00:01Z' },
  droppedEvents: 0, events: [{ sequence: 1, instance: 'main', transport: 'method-channel',
    channel: 'camera', method: 'photo', outcome: 'success', caller: location }] };
const runtime = (value: unknown = raw) => ({ document: parseBridgeRuntime(value), revision: 'current' });

test('정적으로 동적인 호출의 실제 관찰 주소에서 Swift 후보와 검토 파일을 찾는다', () => {
  const report = createBridgeImpact([dart, swift], { files: ['lib/dynamic.dart'], symbols: [] }, runtime());
  assert.equal(report.methods[0]?.method, 'photo');
  assert.equal(report.methods[0]?.reason, 'runtime-observation');
  assert.equal(report.methods[0]?.handlers[0]?.symbol?.usr, 's:Camera');
  assert.deepEqual(report.methods[0]?.invocations, []);
  assert.equal(report.runtime?.routes[0]?.staticStatus, 'candidates');
  assert.equal(report.runtime?.selectedEvents, 1);
  assert.ok(report.reviewFiles.includes('ios/Camera.swift'));
  assert.equal(report.summary.unresolvedSelectedFacts, 1);
  assert.equal(report.complete, false);
});

test('Swift 심볼 변경은 런타임에만 나타난 Dart 호출 위치도 검토 목록에 추가한다', () => {
  const report = createBridgeImpact([dart, swift], { files: [], symbols: ['s:Camera'] }, runtime());
  assert.equal(report.runtime?.selectedEvents, 1);
  assert.ok(report.reviewFiles.includes('lib/dynamic.dart'));
});

test('Android runtime-only 호출은 같은 이름의 Swift 구현과 섞이지 않고 Kotlin 후보를 찾는다', () => {
  const kotlin = parseBridgeFactsDocument({ ...swift, platform: 'kotlin', tool: { name: 'kartograph', version: '1' },
    facts: swift.facts.map((fact) => ({ ...fact, location: { ...fact.location, path: 'android/Camera.kt' },
      symbol: { qualifiedName: 'Camera.handle', usr: 'method:Camera#handle' } })) });
  const report = createBridgeImpact([dart, swift, kotlin], { files: ['lib/dynamic.dart'], symbols: [] },
    runtime({ ...raw, run: { ...raw.run, platform: 'android' } }));
  assert.equal(report.runtime?.routes[0]?.staticStatus, 'candidates');
  assert.equal(report.methods[0]?.reason, 'runtime-observation');
  assert.deepEqual(report.methods[0]?.handlers.map(({ platform }) => platform), ['kotlin']);
  assert.ok(report.reviewFiles.includes('android/Camera.kt'));
  assert.ok(!report.reviewFiles.includes('ios/Camera.swift'));
});

test('다른 revision은 정적 후보 연결에 사용하지 않으며 다른 프로젝트는 거부한다', () => {
  const report = createBridgeImpact([dart, swift], { files: ['lib/dynamic.dart'], symbols: [] },
    runtime({ ...raw, revision: 'old' }));
  assert.equal(report.runtime?.stale, true);
  assert.equal(report.runtime?.selectedEvents, 0);
  assert.deepEqual(report.methods, []);
  assert.equal(hasImpactBlockers(report), true);
  assert.throws(() => createBridgeImpact([dart, swift], { files: ['lib/dynamic.dart'], symbols: [] },
    runtime({ ...raw, project: '/other' })), /same project/);
});

test('Android 기록이나 Basic 메시지를 Swift MethodChannel 핸들러로 추측해 잇지 않는다', () => {
  for (const input of [{ ...raw, run: { ...raw.run, platform: 'android' } },
    { ...raw, events: [{ ...raw.events[0], transport: 'basic-message-channel', method: undefined }] }]) {
    const report = createBridgeImpact([dart, swift], { files: ['lib/dynamic.dart'], symbols: [] }, runtime(input));
    assert.deepEqual(report.methods, []);
    assert.equal(report.runtime?.routes[0]?.staticStatus, 'unsupported');
  }
});

test('근거 없는 라우팅·실패·중단·유실은 런타임 영향 공백으로 남는다', () => {
  const report = createBridgeImpact([dart, swift], { files: ['lib/dynamic.dart'], symbols: [] }, runtime({
    ...raw, droppedEvents: 1, run: { ...raw.run, status: 'incomplete' },
    events: [{ ...raw.events[0], channel: 'other', outcome: 'error' }],
  }));
  assert.equal(report.runtime?.routes[0]?.staticStatus, 'unobserved');
  assert.equal(report.runtime?.failedCalls, 1);
  assert.equal(report.runtime?.droppedEvents, 1);
  assert.equal(report.runtime?.incomplete, true);
  assert.equal(hasImpactBlockers(report), true);
});

test('호출이 반복되어도 인스턴스별 주소로 묶고 양쪽 근거를 증폭하지 않는다', () => {
  const report = createBridgeImpact([dart, swift], { files: ['lib/dynamic.dart'], symbols: [] }, runtime({
    ...raw, events: Array.from({ length: 30 }, (_, index) => ({ ...raw.events[0],
      sequence: index + 1, instance: index < 20 ? 'main' : 'background' })),
  }));
  assert.equal(report.runtime?.routes.length, 2);
  assert.equal(report.runtime?.selectedEvents, 30);
  assert.equal(report.methods.length, 1);
  assert.equal(report.runtime?.routes.find(({ instance }) => instance === 'main')?.observedCalls, 20);
});

test('다른 파일의 무관한 런타임 호출과 이름이 같은 다른 채널은 섞지 않는다', () => {
  const report = createBridgeImpact([dart, swift], { files: [], symbols: ['s:Camera'] }, runtime({
    ...raw, events: [{ ...raw.events[0], channel: 'other', caller: { ...location, path: 'lib/other.dart' } }],
  }));
  assert.equal(report.runtime?.selectedEvents, 0);
});

test('런타임 호출 위치의 표시 상한이 검토해야 할 파일을 누락시키지 않는다', () => {
  const report = createBridgeImpact([dart, swift], { files: [], symbols: ['s:Camera'] }, runtime({
    ...raw, events: Array.from({ length: 30 }, (_, index) => ({ ...raw.events[0], sequence: index + 1,
      caller: { ...location, path: `lib/caller_${index}.dart` } })),
  }));
  assert.equal(report.runtime?.routes[0]?.callers.length, 20);
  assert.equal(report.runtime?.routes[0]?.callersOmitted, 10);
  assert.equal(report.runtime?.reviewFiles.length, 30);
  assert.ok(report.reviewFiles.includes('lib/caller_29.dart'));
});
