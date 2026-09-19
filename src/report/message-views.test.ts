import assert from 'node:assert/strict';
import test from 'node:test';

import { parseBridgeFactsDocument } from '../exchange/parse.ts';
import { parseMessageBridgeDocument } from '../exchange/messages.ts';
import type { BridgeMessageDocument, BridgeMessageTransport } from '../exchange/messages.ts';
import { emptyBridgeJoinResult, joinBridgeDocuments } from '../join/join.ts';
import { joinMessageBridges } from '../join/messages.ts';
import { createBridgeDiff } from './diff.ts';
import { createBridgeGraph } from './graph.ts';
import { createBridgeQuery } from './query.ts';

/** v1 문서 하나를 만든다. */
function factDocument(platform: 'dart' | 'swift', kind: string, channel: string, path: string) {
  return parseBridgeFactsDocument({
    format: 'bridge-facts', version: 1,
    tool: { name: platform === 'dart' ? 'dartograph' : 'cartograph', version: '1.0.0' },
    generatedAt: '2026-09-18T00:00:00Z', platform, target: 'flutter', project: '/app',
    facts: [{ kind, channel, dynamic: false, location: { path, line: 1, column: 1 } }],
    limitations: ['merged-probe: test fixture'],
  });
}

/** v2 메시지 문서 하나를 만든다. */
function messageDocument(
  transport: BridgeMessageTransport,
  platform: 'dart' | 'swift',
  facts: readonly Record<string, unknown>[],
  limitations: readonly string[] = [],
): BridgeMessageDocument {
  return parseMessageBridgeDocument({
    format: 'bridge-facts', version: 2, transport, platform,
    target: facts.length > 0 ? 'flutter' : null, project: '/app',
    generatedAt: '2026-09-18T00:00:00Z',
    tool: { name: platform === 'dart' ? 'dartograph' : 'cartograph', version: 'test' },
    facts, limitations,
  });
}

const at = (path: string, line: number) => ({ path, line, column: 1 });

test('query가 v2 메시지·스트림 경계를 kind 세그먼트로 질의한다', () => {
  const messages = joinMessageBridges([
    messageDocument('basic-message-channel', 'dart', [
      { kind: 'message-send', channel: 'example/basic', dynamic: false, location: at('lib/api.dart', 5) },
    ]),
    messageDocument('basic-message-channel', 'swift', [
      { kind: 'message-handle', channel: 'example/basic', dynamic: false, location: at('macos/Setup.swift', 9) },
    ]),
    messageDocument('event-channel', 'dart', [
      { kind: 'stream-listen', channel: 'dev.example/charging', dynamic: false, location: at('lib/stream.dart', 3) },
    ]),
    messageDocument('event-channel', 'swift', []),
  ], '/app');

  const basic = createBridgeQuery(emptyBridgeJoinResult(), 'example/basic', messages);
  assert.equal(basic.status, 'found');
  assert.equal(basic.result?.subject.kind, 'message');
  assert.equal(basic.result?.subject.qualifiedName, 'flutter:message:example/basic');
  assert.equal(basic.result?.usedBy.length, 1);
  assert.equal(basic.result?.dependsOn.length, 1);

  const stream = createBridgeQuery(emptyBridgeJoinResult(), 'flutter:stream:dev.example/charging', messages);
  assert.equal(stream.status, 'found');
  assert.equal(stream.result?.subject.kind, 'stream');
});

test('query의 v1 채널과 v2 메시지는 같은 이름이라도 kind로 구분된다', () => {
  const joined = joinBridgeDocuments([
    factDocument('dart', 'channel-create', 'example/basic', 'lib/channel.dart'),
    factDocument('swift', 'channel-register', 'example/basic', 'ios/Channel.swift'),
  ]);
  const messages = joinMessageBridges([
    messageDocument('basic-message-channel', 'dart', [
      { kind: 'message-send', channel: 'example/basic', dynamic: false, location: at('lib/api.dart', 5) },
    ]),
    messageDocument('basic-message-channel', 'swift', []),
  ], '/app');

  const byName = createBridgeQuery(joined, 'example/basic', messages);
  assert.equal(byName.status, 'ambiguous');
  assert.deepEqual(byName.candidates?.map(({ qualifiedName }) => qualifiedName).sort(), [
    'flutter:example/basic',
    'flutter:message:example/basic',
  ]);
  const byKind = createBridgeQuery(joined, 'flutter:message:example/basic', messages);
  assert.equal(byKind.status, 'found');
  assert.equal(byKind.result?.subject.kind, 'message');
});

test('graph가 literal v2 경계만 message·stream 간선으로 만든다', () => {
  const messages = joinMessageBridges([
    messageDocument('basic-message-channel', 'dart', [
      { kind: 'message-send', channel: 'example/basic', dynamic: false, location: at('lib/api.dart', 5) },
      { kind: 'message-send', channel: 'dyn', dynamic: true, channelPrefix: 'pigeon', location: at('lib/dyn.dart', 6) },
    ]),
    messageDocument('basic-message-channel', 'swift', [
      { kind: 'message-handle', channel: 'example/basic', dynamic: false, location: at('macos/Setup.swift', 9) },
      { kind: 'message-handle', channel: 'pigeonLiteral', dynamic: false, location: at('macos/Dyn.swift', 10) },
    ]),
    messageDocument('event-channel', 'dart', [
      { kind: 'stream-listen', channel: 'dev.example/charging', dynamic: false, location: at('lib/stream.dart', 3) },
    ]),
    messageDocument('event-channel', 'swift', [
      { kind: 'stream-handle', channel: 'dev.example/charging', dynamic: false, location: at('macos/Stream.swift', 4) },
    ]),
  ], '/app');

  const graph = createBridgeGraph(emptyBridgeJoinResult(), messages);
  assert.deepEqual(graph.edges.map(({ kind, channel }) => [kind, channel]), [
    ['message', 'example/basic'],
    ['stream', 'dev.example/charging'],
  ]);
  // dynamic prefix 후보는 확정 매치가 아니므로 간선이 되지 않는다.
  assert.ok(graph.edges.every(({ channel }) => channel !== 'pigeon'));
});

test('diff가 v2 미대응에서 매치로 바뀐 경계를 추가·해결로 보고한다', () => {
  const beforeV1 = [
    factDocument('dart', 'channel-create', 'c', 'lib/a.dart'),
    factDocument('swift', 'channel-register', 'c', 'ios/A.swift'),
  ];
  const afterV1 = [
    factDocument('dart', 'channel-create', 'c', 'lib/a.dart'),
    factDocument('swift', 'channel-register', 'c', 'ios/A.swift'),
  ];
  const beforeMessages = [
    messageDocument('basic-message-channel', 'dart', [
      { kind: 'message-send', channel: 'example/basic', dynamic: false, location: at('lib/api.dart', 5) },
    ]),
    messageDocument('basic-message-channel', 'swift', []),
  ];
  const afterMessages = [
    messageDocument('basic-message-channel', 'dart', [
      { kind: 'message-send', channel: 'example/basic', dynamic: false, location: at('lib/api.dart', 5) },
    ]),
    messageDocument('basic-message-channel', 'swift', [
      { kind: 'message-handle', channel: 'example/basic', dynamic: false, location: at('macos/Setup.swift', 9) },
    ]),
  ];

  const report = createBridgeDiff(beforeV1, afterV1, beforeMessages, afterMessages);
  assert.equal(report.summary.addedMessageBoundaries, 1);
  assert.equal(report.summary.removedMessageBoundaries, 0);
  assert.equal(report.addedMessageBoundaries?.[0]?.channel, 'example/basic');
  assert.equal(report.resolvedIssues.filter(({ code }) => code === 'unhandled-message-send').length, 1);
  assert.equal(report.introducedIssues.length, 0);
});

test('diff는 v2 입력이 한쪽에만 있으면 입력 오류로 거부한다', () => {
  const beforeV1 = [
    factDocument('dart', 'channel-create', 'c', 'lib/a.dart'),
    factDocument('swift', 'channel-register', 'c', 'ios/A.swift'),
  ];
  assert.throws(() => createBridgeDiff(beforeV1, beforeV1, [
    messageDocument('basic-message-channel', 'dart', [
      { kind: 'message-send', channel: 'x', dynamic: false, location: at('lib/x.dart', 1) },
    ]),
    messageDocument('basic-message-channel', 'swift', []),
  ], undefined), /both snapshots/u);
});