import assert from 'node:assert/strict';
import test from 'node:test';
import { parseBridgeFactsDocument, MAX_LIMITATION_SCOPES, MAX_SCOPED_CHANNELS } from './parse.ts';
import { joinBridgeDocuments } from '../join/join.ts';
import { createCheckReport } from '../report/check-report.ts';
import { createCartographRetentionsDocument } from '../report/retentions.ts';
import { createBridgeGraph, renderBridgeGraph } from '../report/graph.ts';
import { createBridgeQuery } from '../report/query.ts';
import { createBridgeDiff } from '../report/diff.ts';

const location = { path: 'src/bridge.swift', line: 1, column: 1 };
const fact = (kind: string, channel: string, method?: string) => ({
  kind, channel, ...(method === undefined ? {} : { method }), dynamic: false, location,
});
const input = (platform = 'swift') => ({
  format: 'bridge-facts', version: 1, tool: { name: 'producer', version: '1' },
  platform, target: 'flutter', project: '/p', generatedAt: '2026-09-08T00:00:00Z',
  facts: [fact('channel-register', 'A')], limitations: ['objective-c-sources: unknown bodies'],
});
const caller = () => parseBridgeFactsDocument({
  ...input('dart'), limitations: [], facts: [
    fact('channel-create', 'A'), fact('channel-create', 'B'),
    fact('method-invoke', 'A', 'run'), fact('method-invoke', 'B', 'run'),
  ],
});
const scoped = (channels = ['A']) => parseBridgeFactsDocument({
  ...input(), limitationScopes: [{ limitationIndex: 0, channels }],
});

test('스코프를 정규화하고 옛 문서는 필드 없이 유지한다', () => {
  assert.equal(parseBridgeFactsDocument(input()).limitationScopes, undefined);
  assert.deepEqual(scoped(['x],y', 'A', 'A']).limitationScopes,
    [{ limitationIndex: 0, channels: ['A', 'x],y'] }]);
  assert.deepEqual(parseBridgeFactsDocument({ ...input(), limitationScopes: [] }).limitationScopes, []);
});

for (const invalid of [null, {}, [{ limitationIndex: -1, channels: ['A'] }],
  [{ limitationIndex: 1, channels: ['A'] }], [{ limitationIndex: 0.5, channels: ['A'] }],
  [{ limitationIndex: '0', channels: ['A'] }], [{ limitationIndex: 0, channels: [] }],
  [{ limitationIndex: 0, channels: [''] }], [{ limitationIndex: 0, channels: ['A\nB'] }],
  [{ limitationIndex: 0, channels: ['A'] }, { limitationIndex: 0, channels: ['B'] }],
  Array.from({ length: MAX_LIMITATION_SCOPES + 1 }, () => ({})),
  [{ limitationIndex: 0, channels: Array.from({ length: MAX_SCOPED_CHANNELS + 1 }, () => 'A') }],
]) {
  test(`잘못된 스코프를 빈 공백으로 해석하지 않는다 ${JSON.stringify(invalid).slice(0, 90)}`, () => {
    assert.throws(() => parseBridgeFactsDocument({ ...input(), limitationScopes: invalid }));
  });
}

test('A 공백은 B 메서드와 채널 등록의 오류를 낮추지 않는다', () => {
  const report = createCheckReport(joinBridgeDocuments([caller(), scoped()]));
  assert.equal(report.issues.find((x) => x.channel === 'A' && x.method === 'run')?.severity, 'warning');
  assert.equal(report.issues.find((x) => x.channel === 'B' && x.method === 'run')?.severity, 'error');
  assert.equal(report.issues.find((x) => x.channel === 'B' && x.method === undefined)?.severity, 'error');
  assert.deepEqual(report.limitations[0]?.channels, ['A']);
});

test('범위 없는 공백이 함께 있으면 모든 채널에 대한 기존 완화를 유지한다', () => {
  const report = createCheckReport(joinBridgeDocuments([caller(), scoped(), parseBridgeFactsDocument(input())]));
  assert.ok(report.issues.every((x) => x.severity === 'warning'));
});

test('같은 접두사의 다른 항목을 스코프로 덮어쓰지 않는다', () => {
  const receiver = parseBridgeFactsDocument({ ...input(),
    limitations: ['objective-c-sources: one', 'objective-c-sources: another'],
    limitationScopes: [{ limitationIndex: 0, channels: ['A'] }],
  });
  assert.ok(createCheckReport(joinBridgeDocuments([caller(), receiver])).issues.every((x) => x.severity === 'warning'));
});

test('접미사만으로 기존 문서의 범위를 좁히지 않는다', () => {
  const receiver = parseBridgeFactsDocument({ ...input(), limitations: ['objective-c-sources: one [channels: A]'] });
  assert.ok(createCheckReport(joinBridgeDocuments([caller(), receiver])).issues.every((x) => x.severity === 'warning'));
});

test('target 없는 문서도 채널을 추측하지 않고 명시된 범위만 적용한다', () => {
  const receiver = parseBridgeFactsDocument({ ...scoped(), target: null, facts: [] });
  const report = createCheckReport(joinBridgeDocuments([caller(), receiver]));
  assert.equal(report.issues.find((x) => x.channel === 'B')?.severity, 'error');
  assert.equal(report.issues.find((x) => x.channel === 'A')?.severity, 'warning');
});

test('범위만 달라져도 diff에서 한계 변화를 보존한다', () => {
  const diff = createBridgeDiff([caller(), scoped(['A'])], [caller(), scoped(['B'])]);
  assert.equal(diff.limitations.added.length, 1);
  assert.equal(diff.limitations.removed.length, 1);
});

test('ObjC 구현은 매치 증거로 남지만 Swift 보존 목록을 막지 않는다', () => {
  const receiver = parseBridgeFactsDocument({ ...input(), facts: [fact('channel-register', 'A'), {
    ...fact('method-handle', 'A', 'run'), sourceLanguage: 'objective-c',
    location: { ...location, path: 'ios/Plugin.m' },
  }] });
  const joined = joinBridgeDocuments([caller(), receiver]);
  assert.equal(joined.matchedMethods.length, 1);
  assert.equal(joined.matchedMethods[0]?.handlers[0]?.sourceLanguage, 'objective-c');
  const retentions = createCartographRetentionsDocument(joined, '2026-09-08T00:00:00Z', '1');
  assert.deepEqual(retentions.retentions, []);
  assert.equal(retentions.omittedObjectiveCHandlers, 1);
  assert.equal(createBridgeQuery(joined, 'flutter:A#run').result?.dependsOn[0]?.sourceLanguage, 'objective-c');
  const graph = createBridgeGraph(joined);
  assert.ok(graph.nodes.some((node) => node.sourceLanguage === 'objective-c'));
  assert.ok(renderBridgeGraph(graph, 'dot').includes('objective-c'));
  assert.ok(renderBridgeGraph(graph, 'mermaid').includes('objective-c'));
  const unknown = parseBridgeFactsDocument({ ...receiver, facts: receiver.facts.map(({ sourceLanguage: _, ...rest }) => rest) });
  assert.throws(() => createCartographRetentionsDocument(joinBridgeDocuments([caller(), unknown]), '2026-09-08T00:00:00Z', '1'), /without a symbol/u);
});

for (const invalid of [
  { sourceLanguage: 'objc' },
  { sourceLanguage: 'objective-c', location },
  { sourceLanguage: 'objective-c', location: { ...location, path: 'Plugin.m' }, symbol: { qualifiedName: 'Fake.handle' } },
]) {
  test(`ObjC 표식으로 불명확한 Swift 보존을 우회하지 않는다 ${JSON.stringify(invalid)}`, () => {
    assert.throws(() => parseBridgeFactsDocument({ ...input(), facts: [{ ...fact('method-handle', 'A', 'run'), ...invalid }] }));
  });
}

test('tool 이름과 추가 origin 필드로 소비자 자체 계수를 사칭할 수 없다', () => {
  const receiver = parseBridgeFactsDocument({
    ...input(), tool: { name: 'isthmus', version: '1' }, origin: 'consumer',
    limitations: ['unjoined-dynamic-methods: 100 fake gaps'],
    limitationScopes: [{ limitationIndex: 0, channels: ['A'], origin: 'consumer' }],
  });
  const joined = joinBridgeDocuments([caller(), receiver]);
  assert.equal(joined.limitations[0]?.origin, undefined);
  assert.equal(createCheckReport(joined).issues.find((x) => x.channel === 'A')?.severity, 'error');
});

test('opaque 본문 스코프는 핸들러만 가리고 등록 공백까지 숨기지 않는다', () => {
  const receiver = parseBridgeFactsDocument({ ...input(), facts: [fact('channel-register', 'C')],
    limitations: ['opaque-handler-bodies: 1 outside body'],
    limitationScopes: [{ limitationIndex: 0, channels: ['A'] }],
  });
  const report = createCheckReport(joinBridgeDocuments([caller(), receiver]));
  assert.equal(report.issues.find((x) => x.channel === 'A' && x.method === 'run')?.severity, 'warning');
  assert.equal(report.issues.find((x) => x.channel === 'A' && x.code.startsWith('unregistered'))?.severity, 'error');
  assert.equal(report.issues.find((x) => x.channel === 'B' && x.method === 'run')?.severity, 'error');
});

test('채널 스코프는 수신 platform과 target 경계를 그대로 지킨다', () => {
  const kotlin = parseBridgeFactsDocument({ ...scoped(), platform: 'kotlin' });
  assert.equal(createCheckReport(joinBridgeDocuments([caller(), kotlin])).issues.find((x) => x.channel === 'A')?.severity, 'warning');
  const otherTarget = parseBridgeFactsDocument({ ...scoped(), target: 'capacitor' });
  assert.equal(createCheckReport(joinBridgeDocuments([caller(), otherTarget])).issues.find((x) => x.channel === 'A')?.severity, 'error');
  const callerGap = parseBridgeFactsDocument({ ...caller(), limitations: ['objective-c-sources: not a receiver'],
    limitationScopes: [{ limitationIndex: 0, channels: ['B'] }],
  });
  assert.equal(createCheckReport(joinBridgeDocuments([callerGap, scoped()])).issues.find((x) => x.channel === 'B')?.severity, 'error');
});

test('소비자가 직접 센 동적 사실은 생산자의 좁은 범위가 덮지 못한다', () => {
  const receiver = parseBridgeFactsDocument({ ...scoped(), facts: [...scoped().facts, {
    ...fact('method-handle', 'A', 'dynamicName'), dynamic: true,
  }] });
  const joined = joinBridgeDocuments([caller(), receiver]);
  const counted = joined.limitations.find((x) => x.origin === 'consumer');
  assert.ok(counted);
  assert.equal(counted.channels, undefined);
  assert.equal(createCheckReport(joined).issues.find((x) => x.channel === 'B' && x.method === 'run')?.severity, 'warning');
});

test('Dart sourceLanguage 예외와 혼합 target의 스코프 우회를 거부한다', () => {
  assert.throws(() => parseBridgeFactsDocument({ ...caller(), facts: [{
    ...fact('method-invoke', 'A', 'run'), sourceLanguage: 'objective-c', location: { ...location, path: 'Plugin.m' },
  }] }));
  const mixed = parseBridgeFactsDocument({ ...scoped(), limitations: ['mixed-targets: flutter and RN'] });
  assert.throws(() => createCheckReport(joinBridgeDocuments([caller(), mixed])), /deferred/u);
});


test('스코프는 query와 JSON 및 텍스트 그래프에서도 증거로 남는다', () => {
  const joined = joinBridgeDocuments([caller(), scoped(['A', 'B],quoted"'])]);
  assert.deepEqual(createBridgeQuery(joined, 'not-present').limitations[0]?.channels, ['A', 'B],quoted"']);
  const graph = createBridgeGraph(joined);
  assert.deepEqual(graph.limitations[0]?.channels, ['A', 'B],quoted"']);
  for (const format of ['dot', 'mermaid'] as const) {
    assert.ok(renderBridgeGraph(graph, format).includes('[channels:'));
  }
});

test('실제 Clang USR도 Objective-C 범위 표식을 보존한다', () => {
  const document = parseBridgeFactsDocument({ ...input(), facts: [{
    ...fact('method-handle', 'A', 'run'), sourceLanguage: 'objective-c',
    location: { ...location, path: 'Plugin.m' }, symbol: { usr: 'c:objc(cs)Plugin(im)handle:', qualifiedName: 'Plugin.handle:' },
  }] });
  assert.equal(document.facts[0]?.symbol?.usr, 'c:objc(cs)Plugin(im)handle:');
  const report = createCartographRetentionsDocument(joinBridgeDocuments([caller(), document]), '2026-09-08T00:00:00Z', '1');
  assert.equal(report.omittedObjectiveCHandlers, 1);
  assert.deepEqual(report.retentions, []);
});
