import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMessageBridgeDocument } from '../exchange/messages.ts';
import { joinMessageBridges } from './messages.ts';

const document = (platform: 'dart' | 'swift', channel: string, prefix?: string) => parseMessageBridgeDocument({
  format: 'bridge-facts', version: 2, transport: 'basic-message-channel', project: '/app', platform, target: 'flutter',
  generatedAt: '2026-09-14T00:00:00Z', tool: { name: platform, version: 'dev' }, limitations: [], facts: [{
    kind: platform === 'dart' ? 'message-send' : 'message-handle', channel, dynamic: prefix !== undefined,
    ...(prefix === undefined ? {} : { channelPrefix: prefix }), location: { path: platform === 'dart' ? 'lib/api.dart' : 'ios/Api.swift', line: 1, column: 1 },
  }],
});

test('literal과 겹치는 prefix는 후보 경계로 연결한다', () => {
  const joined = joinMessageBridges([document('dart', 'camera.main'), document('swift', 'name', 'camera.')], '/app');
  const prefix = joined.routes.find(({ matching }) => matching === 'prefix');
  assert.equal(prefix?.senders.length, 1);
  assert.equal(prefix?.handlers.length, 1);
  assert.equal(prefix?.channel, 'camera.');
});

test('겹치는 접두사의 교집합만 연결하고 무관한 literal을 끌어오지 않는다', () => {
  const joined = joinMessageBridges([
    document('dart', 'senderName', 'camera.'), document('swift', 'handlerName', 'camera.front.'),
    document('dart', 'camera.back.read'),
  ], '/app');
  const front = joined.routes.find(({ channel }) => channel === 'camera.front.');
  assert.equal(front?.senders.length, 1);
  assert.equal(front?.handlers.length, 1);
  assert.equal(front?.senders[0]?.channelExpression, 'senderName');
});

test('같은 위치의 서로 다른 동적 표현식은 prefix와 미해석 근거에서 모두 보존한다', () => {
  const first = document('dart', 'firstExpression', 'camera.');
  const second = document('dart', 'secondExpression', 'camera.');
  const native = document('swift', 'camera.read');
  const joined = joinMessageBridges([first, second, native], '/app');
  assert.deepEqual(joined.routes.find(({ matching }) => matching === 'prefix')?.senders.map(({ channelExpression }) => channelExpression),
    ['firstExpression', 'secondExpression']);
  const unknown = [first, second].map((doc) => parseMessageBridgeDocument({ ...doc,
    facts: doc.facts.map((fact) => ({ ...fact, channelPrefix: undefined })) }));
  assert.equal(joinMessageBridges([...unknown, native], '/app').unresolved.length, 2);
  assert.deepEqual(joined, joinMessageBridges([native, second, first], '/app'));
});
