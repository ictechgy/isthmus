import assert from 'node:assert/strict';
import test from 'node:test';

import { parseMessageBridgeDocument } from '../exchange/messages.ts';
import type { BridgeMessageDocument, BridgeMessageTransport } from '../exchange/messages.ts';
import { emptyBridgeJoinResult } from '../join/join.ts';
import { joinMessageBridges } from '../join/messages.ts';
import {
  createCartographRetentionsDocument,
  RetentionValidationError,
  validateCartographRetentionInputs,
} from './retentions.ts';

/** v2 문서를 만든다. */
function document(
  transport: BridgeMessageTransport,
  platform: 'dart' | 'swift',
  facts: readonly Record<string, unknown>[],
): BridgeMessageDocument {
  return parseMessageBridgeDocument({
    format: 'bridge-facts', version: 2, transport, platform,
    target: facts.length > 0 ? 'flutter' : null, project: '/app',
    generatedAt: '2026-09-19T00:00:00Z',
    tool: { name: platform === 'dart' ? 'dartograph' : 'cartograph', version: 'test' },
    facts, limitations: [],
  });
}

const at = (path: string, line: number) => ({ path, line, column: 1 });

function retentionFor(messages: readonly BridgeMessageDocument[]) {
  const join = joinMessageBridges(messages, '/app');
  return createCartographRetentionsDocument(emptyBridgeJoinResult(), '2026-09-19T00:00:00Z', '0.7.0', join);
}

test('literal v2 Basic 경계의 Swift 핸들러를 method 없이 보존한다', () => {
  const report = retentionFor([
    document('basic-message-channel', 'dart', [
      { kind: 'message-send', channel: 'camera/basic', dynamic: false, location: at('lib/api.dart', 5) },
    ]),
    document('basic-message-channel', 'swift', [
      { kind: 'message-handle', channel: 'camera/basic', dynamic: false, location: at('macos/Setup.swift', 9),
        symbol: { qualifiedName: 'HapticsModule.handle', usr: 's:handler' } },
    ]),
  ]);

  assert.equal(report.retentions.length, 1);
  assert.deepEqual(report.retentions[0]?.symbol, { qualifiedName: 'HapticsModule.handle', usr: 's:handler' });
  assert.equal(report.retentions[0]?.evidence.channel, 'camera/basic');
  assert.equal('method' in (report.retentions[0]?.evidence ?? {}), false);
  assert.equal(report.retentions[0]?.evidence.caller.path, 'lib/api.dart');
});

test('Event stream 경계도 stream-handle을 보존한다', () => {
  const report = retentionFor([
    document('event-channel', 'dart', [
      { kind: 'stream-listen', channel: 'dev.example/charging', dynamic: false, location: at('lib/stream.dart', 3) },
    ]),
    document('event-channel', 'swift', [
      { kind: 'stream-handle', channel: 'dev.example/charging', dynamic: false, location: at('macos/Stream.swift', 7),
        symbol: { qualifiedName: 'StreamHandler.onListen', usr: 's:stream' } },
    ]),
  ]);

  assert.equal(report.retentions.length, 1);
  assert.equal(report.retentions[0]?.evidence.channel, 'dev.example/charging');
});

test('symbol 없는 Swift v2 핸들러에 호출자가 있으면 보존을 거부한다', () => {
  const messages = [
    document('basic-message-channel', 'dart', [
      { kind: 'message-send', channel: 'camera/basic', dynamic: false, location: at('lib/api.dart', 5) },
    ]),
    document('basic-message-channel', 'swift', [
      { kind: 'message-handle', channel: 'camera/basic', dynamic: false, location: at('macos/Setup.swift', 9) },
    ]),
  ];
  assert.throws(() => retentionFor(messages), RetentionValidationError);
});

test('ObjC v2 핸들러는 보존하지 않고 omittedObjectiveCHandlers로 센다', () => {
  const report = retentionFor([
    document('event-channel', 'dart', [
      { kind: 'stream-listen', channel: 'dev.example/charging', dynamic: false, location: at('lib/stream.dart', 3) },
    ]),
    document('event-channel', 'swift', [
      { kind: 'stream-handle', channel: 'dev.example/charging', dynamic: false,
        sourceLanguage: 'objective-c', location: at('ios/Handler.m', 4),
        symbol: { qualifiedName: 'Handler.onListen', usr: 'c:handler' } },
    ]),
  ]);

  assert.equal(report.retentions.length, 0);
  assert.equal(report.omittedObjectiveCHandlers, 1);
});

test('literal로 확정되지 않은 prefix 후보는 보존하지 않는다', () => {
  const report = retentionFor([
    document('basic-message-channel', 'dart', [
      { kind: 'message-send', channel: 'pigeonName', dynamic: true, channelPrefix: 'dev.flutter.pigeon.Api',
        location: at('lib/api.dart', 5) },
    ]),
    document('basic-message-channel', 'swift', [
      { kind: 'message-handle', channel: 'dev.flutter.pigeon.Api.read', dynamic: false, location: at('macos/Setup.swift', 9),
        symbol: { qualifiedName: 'Api.read', usr: 's:read' } },
    ]),
  ]);

  assert.equal(report.retentions.length, 0);
});

test('swift v2 문서가 있으면 보존 입력 검증을 통과한다', () => {
  validateCartographRetentionInputs([], [document('basic-message-channel', 'swift', [])]);
  assert.throws(() => validateCartographRetentionInputs([], [document('basic-message-channel', 'dart', [])]),
    RetentionValidationError);
});