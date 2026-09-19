import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMessageBridgeDocument } from '../exchange/messages.ts';
import { emptyBridgeJoinResult } from '../join/join.ts';
import { joinMessageBridges } from '../join/messages.ts';
import { createCheckReport } from './check-report.ts';
import { createBridgeQuery } from './query.ts';
import { createBridgeGraph } from './graph.ts';

function document(platform: 'js' | 'swift', names: string[], dynamic = false) {
  return parseMessageBridgeDocument({
    format: 'bridge-facts', version: 2, transport: 'react-native-event', platform,
    target: names.length ? 'react-native' : null, project: '/app', generatedAt: '2026-09-19T00:00:00Z',
    tool: { name: platform === 'js' ? 'isthmus' : 'cartograph', version: 'test' }, limitations: [],
    facts: names.map((channel, index) => ({
      kind: platform === 'js' ? 'event-listen' : 'event-emit', channel, dynamic,
      location: { path: platform === 'js' ? 'events.ts' : 'Events.swift', line: index + 1, column: 1 },
    })),
  });
}

test('RN 이벤트 이름을 양쪽 위치로 연결하고 query·graph에 RN target과 event 종류를 보존한다', () => {
  const events = joinMessageBridges([document('js', ['ready']), document('swift', ['ready'])], '/app');
  const report = createCheckReport(emptyBridgeJoinResult(), events);
  assert.equal(report.summary.matchedEvents, 1);
  assert.deepEqual(report.issues, []);
  const query = createBridgeQuery(emptyBridgeJoinResult(), 'react-native:event:ready', events);
  assert.equal(query.result?.subject.kind, 'event');
  assert.equal(query.result?.usedBy[0]?.platform, 'js');
  assert.equal(query.result?.dependsOn[0]?.platform, 'swift');
  const graph = createBridgeGraph(emptyBridgeJoinResult(), events);
  assert.equal(graph.edges[0]?.kind, 'event');
  assert.equal(graph.edges[0]?.target, 'react-native');
});

test('구독·방출의 미대응은 경고이며 동적 방출은 미검증 근거로 남긴다', () => {
  const joined = joinMessageBridges([document('js', ['missing']), document('swift', ['unused'])], '/app');
  const report = createCheckReport(emptyBridgeJoinResult(), joined);
  assert.equal(report.summary.errors, 0);
  assert.deepEqual(new Set(report.issues.map(({ code }) => code)), new Set([
    'event-listen-without-emit', 'event-emit-without-listen',
  ]));
  const dynamic = joinMessageBridges([document('js', ['missing']), document('swift', ['name'], true)], '/app');
  const uncertain = createCheckReport(emptyBridgeJoinResult(), dynamic);
  assert.equal(uncertain.issues[0]?.code, 'event-listen-without-emit-unverified');
  assert.ok(uncertain.limitations.some(({ target }) => target === 'react-native'));
});

test('RN의 잘못된 플랫폼·target·prefix는 입력 단계에서 거부한다', () => {
  const valid = document('js', ['ready']);
  for (const change of [{ platform: 'dart' }, { target: 'flutter' },
    { facts: [{ ...valid.facts[0], dynamic: true, channelPrefix: 'ready' }] }]) {
    assert.throws(() => parseMessageBridgeDocument({ ...valid, ...change }));
  }
  assert.throws(() => joinMessageBridges([document('js', ['ready'])], '/app'));
});

test('빈 Flutter v2 문서의 공백이 RN 이벤트 경고로 전파되지 않는다', () => {
  const flutter = (platform: 'dart' | 'swift') => parseMessageBridgeDocument({
    ...document('swift', []), platform, transport: 'event-channel',
    limitations: platform === 'swift' ? ['unreadable-sources: a Flutter source was not read'] : [],
  });
  const joined = joinMessageBridges([
    document('js', ['ready']), document('swift', []), flutter('dart'), flutter('swift'),
  ], '/app');
  assert.equal(createCheckReport(emptyBridgeJoinResult(), joined).issues[0]?.code, 'event-listen-without-emit');
  assert.equal(joined.limitations[0]?.target, 'flutter');
});
