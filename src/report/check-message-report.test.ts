import assert from 'node:assert/strict';
import test from 'node:test';

import { parseMessageBridgeDocument } from '../exchange/messages.ts';
import type { BridgeMessageDocument, BridgeMessageTransport } from '../exchange/messages.ts';
import { emptyBridgeJoinResult } from '../join/join.ts';
import { joinMessageBridges } from '../join/messages.ts';
import { createCheckReport } from './check-report.ts';

/** transport·platform별 v2 문서를 만든다. project는 하나로 고정한다. */
function document(
  transport: BridgeMessageTransport,
  platform: 'dart' | 'swift' | 'kotlin',
  facts: readonly Record<string, unknown>[],
  limitations: readonly string[] = [],
): BridgeMessageDocument {
  return parseMessageBridgeDocument({
    format: 'bridge-facts',
    version: 2,
    transport,
    platform,
    target: facts.length > 0 ? 'flutter' : null,
    project: '/app',
    generatedAt: '2026-09-18T00:00:00Z',
    tool: { name: platform === 'dart' ? 'dartograph' : 'cartograph', version: 'test' },
    facts,
    limitations,
  });
}

/** 한 사실의 위치를 파일마다 다르게 만든다. */
function at(path: string, line: number): Record<string, unknown> {
  return { path, line, column: 1 };
}

/**
 * 입력에 반대편 platform 문서가 없으면 사실 없는 문서를 채워 composition을 만족시킨다.
 *
 * 실제 check는 dart와 native 문서를 모두 요구하므로, 한쪽만 관찰한 경우를
 * 재현하려면 반대편이 "아무것도 관찰하지 않은" 문서로 존재해야 한다.
 */
function createReport(messages: readonly BridgeMessageDocument[]) {
  const transport = messages[0]!.transport;
  const documents = [...messages];
  if (!documents.some(({ platform }) => platform === 'dart')) {
    documents.push(document(transport, 'dart', []));
  }
  if (!documents.some(({ platform }) => platform === 'swift' || platform === 'kotlin')) {
    documents.push(document(transport, 'swift', []));
  }
  const joined = joinMessageBridges(documents, '/app');
  return { joined, report: createCheckReport(emptyBridgeJoinResult(), joined) };
}

test('Basic literal send에 핸들러가 없으면 error로 보고한다', () => {
  const { report } = createReport([
    document('basic-message-channel', 'dart', [
      { kind: 'message-send', channel: 'example/basic', dynamic: false, location: at('lib/api.dart', 10) },
    ]),
  ]);

  assert.deepEqual(report.issues.map((issue) => [issue.code, issue.severity]), [
    ['unhandled-message-send', 'error'],
  ]);
  assert.equal(report.summary.matchedMessages, 0);
  assert.equal(report.summary.matchedStreams, 0);
  assert.equal(report.summary.errors, 1);
});

test('Basic handler에 sender가 없으면 warning으로 보고한다', () => {
  const { report } = createReport([
    document('basic-message-channel', 'swift', [
      { kind: 'message-handle', channel: 'example/basic', dynamic: false, location: at('macos/Setup.swift', 5) },
    ]),
  ]);

  assert.deepEqual(report.issues.map((issue) => [issue.code, issue.severity]), [
    ['message-handler-without-send', 'warning'],
  ]);
  assert.equal(report.summary.warnings, 1);
});

test('Basic 양쪽이 관찰된 경계는 matchedMessages로 세고 진단하지 않는다', () => {
  const { report } = createReport([
    document('basic-message-channel', 'dart', [
      { kind: 'message-send', channel: 'example/basic', dynamic: false, location: at('lib/api.dart', 10) },
    ]),
    document('basic-message-channel', 'swift', [
      { kind: 'message-handle', channel: 'example/basic', dynamic: false, location: at('macos/Setup.swift', 5) },
    ]),
  ]);

  assert.deepEqual(report.issues, []);
  assert.equal(report.summary.matchedMessages, 1);
  assert.equal(report.summary.observedFacts, 2);
});

test('Event listen에 핸들러가 없으면 전용 error 코드로 보고한다', () => {
  const { report } = createReport([
    document('event-channel', 'dart', [
      { kind: 'stream-listen', channel: 'dev.example/charging', dynamic: false, location: at('lib/battery.dart', 49) },
    ]),
  ]);

  assert.deepEqual(report.issues.map((issue) => [issue.code, issue.severity]), [
    ['unhandled-stream-listen', 'error'],
  ]);
});

test('Event 핸들러에 listener가 없으면 warning으로 보고한다', () => {
  const { report } = createReport([
    document('event-channel', 'kotlin', [
      { kind: 'stream-handle', channel: 'dev.example/charging', dynamic: false, location: at('android/Setup.kt', 9) },
    ]),
  ]);

  assert.deepEqual(report.issues.map((issue) => [issue.code, issue.severity]), [
    ['stream-handler-without-listen', 'warning'],
  ]);
});

test('Event 양쪽이 관찰된 스트림은 matchedStreams로 세고 진단하지 않는다', () => {
  const { report } = createReport([
    document('event-channel', 'dart', [
      { kind: 'stream-listen', channel: 'dev.example/charging', dynamic: false, location: at('lib/battery.dart', 49) },
    ]),
    document('event-channel', 'swift', [
      { kind: 'stream-handle', channel: 'dev.example/charging', dynamic: false, location: at('macos/Setup.swift', 12) },
    ]),
  ]);

  assert.deepEqual(report.issues, []);
  assert.equal(report.summary.matchedStreams, 1);
});

test('미귀속 handler 공백이 있으면 send 진단을 unverified warning으로 내린다', () => {
  const { report } = createReport([
    document('basic-message-channel', 'dart', [
      { kind: 'message-send', channel: 'example/basic', dynamic: false, location: at('lib/api.dart', 10) },
    ]),
    // native 문서가 handler 일부를 채널에 귀속하지 못했다고 신고한다.
    document('basic-message-channel', 'swift', [], ['unattributed-message-handles: 1']),
  ]);

  assert.deepEqual(report.issues.map((issue) => [issue.code, issue.severity]), [
    ['unhandled-message-send-unverified', 'warning'],
  ]);
});

test('event 미귀속 공백은 Basic send를 unverified로 만들지 않는다', () => {
  const { report } = createReport([
    document('basic-message-channel', 'dart', [
      { kind: 'message-send', channel: 'example/basic', dynamic: false, location: at('lib/api.dart', 10) },
    ]),
    document('event-channel', 'swift', [], ['unattributed-stream-handles: 1']),
  ]);

  assert.deepEqual(report.issues.map((issue) => [issue.code, issue.severity]), [
    ['unhandled-message-send', 'error'],
  ]);
});

test('prefix 후보만 있는 미대응 경계는 error 대신 소비자 한계로 남다', () => {
  const { report } = createReport([
    document('basic-message-channel', 'dart', [
      { kind: 'message-send', channel: 'pigeonName', dynamic: true, channelPrefix: 'dev.flutter.pigeon.Api',
        location: at('lib/api.dart', 10) },
    ]),
  ]);

  assert.deepEqual(report.issues, []);
  assert.ok(report.limitations.some(({ message, origin }) =>
    origin === 'consumer' && message.startsWith('unmatched-message-boundary:')));
});

test('prefix 후보가 literal handler를 덮으면 handler 미대응 진단을 내지 않는다', () => {
  const { report } = createReport([
    document('basic-message-channel', 'dart', [
      { kind: 'message-send', channel: 'pigeonName', dynamic: true, channelPrefix: 'dev.flutter.pigeon.Api',
        location: at('lib/api.dart', 10) },
    ]),
    document('basic-message-channel', 'swift', [
      { kind: 'message-handle', channel: 'dev.flutter.pigeon.Api.read', dynamic: false,
        location: at('macos/Setup.swift', 5) },
    ]),
  ]);

  assert.deepEqual(report.issues, []);
  // 후보 연결은 확정 매치가 아니므로 matchedMessages에 세지 않는다.
  assert.equal(report.summary.matchedMessages, 0);
  assert.ok(report.limitations.some(({ message }) =>
    message.startsWith('dynamic-message-address:')));
});

test('prefix 후보에 handler만 있으면 handler-without-send가 아니라 미대응 한계다', () => {
  const { report } = createReport([
    document('basic-message-channel', 'swift', [
      { kind: 'message-handle', channel: 'pigeonName', dynamic: true, channelPrefix: 'dev.flutter.pigeon.Api',
        location: at('macos/Setup.swift', 5) },
    ]),
  ]);

  assert.deepEqual(report.issues, []);
  assert.ok(report.limitations.some(({ message, origin }) =>
    origin === 'consumer' && message.startsWith('unmatched-message-boundary:')));
});

test('literal도 prefix도 없는 미해석 주소는 관찰 한계로 센다', () => {
  const { report } = createReport([
    document('basic-message-channel', 'dart', [
      { kind: 'message-send', channel: 'variableName', dynamic: true, location: at('lib/api.dart', 10) },
    ]),
  ]);

  assert.deepEqual(report.issues, []);
  assert.ok(report.limitations.some(({ message, origin }) =>
    origin === 'consumer' && message.startsWith('unresolved-message-addresses:')));
});

test('v1만 입력하면 v2 요약 필드를 싣지 않는다', () => {
  const report = createCheckReport(emptyBridgeJoinResult());

  assert.equal('matchedMessages' in report.summary, false);
  assert.equal('matchedStreams' in report.summary, false);
});