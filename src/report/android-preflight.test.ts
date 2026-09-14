import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parsePreflightContext } from '../exchange/preflight-context.ts';
import { parseBridgeRuntime, parseRuntimeExpectations } from '../exchange/runtime.ts';
import { createPreflightReport } from './preflight.ts';
import { attachPreflightRuntime } from './preflight-runtime.ts';
import { createBridgeDiff } from './diff.ts';

const source = await readFile(new URL('../../fixtures/preflight/context.json', import.meta.url), 'utf8');
const apple = JSON.parse(source);
const android = () => JSON.parse(source.replaceAll('swift', 'kotlin').replaceAll('.kotlin', '.kt')
  .replaceAll('ios/', 'android/').replaceAll('s:', 'jvm:'));
const at = (path: string, line: number) => ({ path, line, column: 1 });
const runtime = (platform: 'macos' | 'android', basic = false) => parseBridgeRuntime({
  format: 'bridge-runtime', version: 1, project: '/fixture', revision: 'fixture-revision',
  tool: { name: 'recorder', version: '1' },
  run: { id: platform, scenario: 'capture', platform, status: 'completed',
    startedAt: '2026-09-14T00:00:00Z', finishedAt: '2026-09-14T00:00:01Z' },
  droppedEvents: 0, events: [{ sequence: 1, instance: 'main', channel: 'camera',
    transport: basic ? 'basic-message-channel' : 'method-channel', ...(basic ? {} : { method: 'photo' }),
    outcome: 'success', caller: at('lib/bridge.dart', 4) }],
});
const expectations = (platforms: readonly ('macos' | 'android')[], basic = false) => parseRuntimeExpectations({
  format: 'bridge-expectations', version: 1, project: '/fixture', revision: 'fixture-revision',
  checks: platforms.map((platform) => ({ id: platform, scenario: 'capture', platform, channel: 'camera',
    transport: basic ? 'basic-message-channel' : 'method-channel', ...(basic ? {} : { method: 'photo' }) })),
});

test('Kotlin 변경을 실제 producer ID로 Dart 소비자까지 연결한다', () => {
  const context = parsePreflightContext(android());
  const report = createPreflightReport(context);
  assert.equal(report.roots[0]?.kind === 'symbol' && report.roots[0].platform, 'kotlin');
  assert.ok(report.affected.some(({ subject }) => subject.kind === 'symbol' && subject.symbol.id === 'dart:screen'));
  assert.ok(report.affected.some(({ subject }) => subject.kind === 'bridge'));
  assert.ok(report.reviewFiles.includes('android/Handler.kt'));
});

test('Kotlin의 부분 위치는 보존하지만 잘못된 좌표나 불완전한 Dart binding은 거부한다', () => {
  const value = android();
  value.analyses[0].roots[0].location = { path: 'android/Helper.kt' };
  const context = parsePreflightContext(value);
  assert.deepEqual(context.analyses[0]?.roots[0]?.location, { path: 'android/Helper.kt' });
  assert.ok(createPreflightReport(context).reviewFiles.includes('android/Helper.kt'));
  for (const coordinate of [{ line: 0 }, { line: null }, { column: 2 }, { line: 1, column: 0 }]) {
    const invalid = structuredClone(value);
    invalid.analyses[0].roots[0].location = { path: 'android/Helper.kt', ...coordinate };
    assert.throws(() => parsePreflightContext(invalid));
  }
  value.bindings[0].symbol.location.column = undefined;
  assert.throws(() => parsePreflightContext(value));
});

test('동일 Kotlin 심볼의 일치하는 부분 좌표는 보강하고 모순되는 좌표는 거부한다', () => {
  const value = android();
  const additional = structuredClone(value.analyses[0]);
  additional.id = 'kotlin-additional';
  additional.roots[0].location.column = 9;
  value.analyses[0].roots[0].location.column = undefined;
  for (const analyses of [[value.analyses[0], additional], [additional, value.analyses[0]]]) {
    const report = createPreflightReport(parsePreflightContext({ ...value, analyses: [...analyses, value.analyses[1]] }));
    const helper = report.roots.find((subject) => subject.kind === 'symbol' && subject.symbol.id === 'jvm:helper');
    assert.ok(helper?.kind === 'symbol');
    assert.deepEqual(helper.symbol.location, { path: 'android/Helper.kt', line: 1, column: 9 });
  }
  additional.roots[0].location.line = 2;
  assert.throws(() => createPreflightReport(parsePreflightContext({ ...value,
    analyses: [...value.analyses, additional] })), /Conflicting symbol identities/);
});

test('Android snapshot 비교는 Kotlin handler 삭제를 찾고 native 구성 교체를 거부한다', () => {
  const before = parsePreflightContext(android()).bridges;
  const after = before.map((document) => document.platform === 'kotlin'
    ? { ...document, facts: document.facts.filter(({ kind }) => kind !== 'method-handle') } : document);
  const diff = createBridgeDiff(before, after);
  assert.equal(diff.removedMethods[0]?.method, 'photo');
  assert.ok(diff.introducedIssues.some(({ code }) => code === 'unhandled-invocation'));
  assert.throws(() => createBridgeDiff(before, parsePreflightContext(apple).bridges));
});

for (const basic of [false, true]) test(`Android ${basic ? 'Basic' : 'Method'} 실행은 Kotlin 후보만 연결한다`, () => {
  const value = android();
  if (basic) {
    value.bridges = [value.bridges[0], value.bridges[1]].map((document) => ({ ...document, target: null, facts: [] }));
    value.messages = ['dart', 'kotlin'].map((platform) => ({
      format: 'bridge-facts', version: 2, transport: 'basic-message-channel', target: 'flutter',
      project: '/fixture', platform, tool: { name: platform, version: '1' },
      generatedAt: '2026-09-14T00:00:00Z', limitations: [], facts: [{
        kind: platform === 'dart' ? 'message-send' : 'message-handle', channel: 'camera', dynamic: false,
        location: at(platform === 'dart' ? 'lib/bridge.dart' : 'android/Handler.kt', 4),
        symbol: platform === 'dart' ? { qualifiedName: 'Bridge.photo' } : { qualifiedName: 'Handler.handle', usr: 'jvm:handler' },
        ...(platform === 'dart' ? {} : {
          handlerScope: { start: at('android/Handler.kt', 4), end: at('android/Handler.kt', 10), complete: true },
          dependencies: [{ kind: 'call', scope: 'handler', location: at('android/Handler.kt', 6),
            symbol: { qualifiedName: 'Helper.read', usr: 'jvm:helper' } }],
        }),
      }],
    }));
    value.bindings = [value.bindings[1]];
  }
  const context = parsePreflightContext(value);
  const report = createPreflightReport(context);
  const result = attachPreflightRuntime(context, report, expectations(['android'], basic), [runtime('android', basic)]);
  assert.equal(result.runtime?.verification.status, 'passed');
  assert.equal(result.runtime?.routes[0]?.staticStatus, 'candidates');
  assert.equal(result.runtime?.candidates[0]?.handlers[0]?.platform, 'kotlin');
  assert.deepEqual(result.runtime?.unobservedBoundaries, []);
  assert.deepEqual(result.runtime?.uncoveredBoundaries, []);
  const wrong = attachPreflightRuntime(context, report, expectations(['macos'], basic), [runtime('macos', basic)]);
  assert.equal(wrong.runtime?.routes[0]?.staticStatus, 'unsupported');
  assert.ok(wrong.runtime!.unobservedBoundaries.length > 0);
});

test('같은 채널의 Swift 성공이 Android 경계까지 검증한 것으로 처리되지 않는다', () => {
  const value = { ...apple, bridges: [...apple.bridges, android().bridges[1]] };
  const context = parsePreflightContext(value);
  const report = createPreflightReport(context);
  const onlyApple = attachPreflightRuntime(context, report, expectations(['macos']), [runtime('macos')]);
  assert.ok(onlyApple.runtime!.uncoveredBoundaries.length > 0);
  assert.ok(onlyApple.runtime!.unobservedBoundaries.length > 0);
  assert.ok(onlyApple.runtime!.candidates.every(({ handlers }) => handlers.every(({ platform }) => platform === 'swift')));
  const both = attachPreflightRuntime(context, report, expectations(['macos', 'android']), [runtime('macos'), runtime('android')]);
  assert.deepEqual(both.runtime?.uncoveredBoundaries, []);
  assert.deepEqual(both.runtime?.unobservedBoundaries, []);
  assert.equal(both.runtime?.candidates.length, 2);
  assert.equal(new Set(both.runtime?.routes.map(({ candidateKey }) => candidateKey)).size, 2);
});
