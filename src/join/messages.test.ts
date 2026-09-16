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

const eventDocument = (platform: 'dart' | 'swift', channel: string, prefix?: string) => parseMessageBridgeDocument({
  format: 'bridge-facts', version: 2, transport: 'event-channel', project: '/app', platform, target: 'flutter',
  generatedAt: '2026-09-14T00:00:00Z', tool: { name: platform, version: 'dev' }, limitations: [], facts: [{
    kind: platform === 'dart' ? 'stream-listen' : 'stream-handle', channel, dynamic: prefix !== undefined,
    ...(prefix === undefined ? {} : { channelPrefix: prefix }),
    location: { path: platform === 'dart' ? 'lib/api.dart' : 'ios/Api.swift', line: 1, column: 1 },
  }],
});

test('EventChannel 사실은 별도 transport 경로로 조인한다', () => {
  const joined = joinMessageBridges([eventDocument('dart', 'charging'), eventDocument('swift', 'charging')], '/app');
  const route = joined.routes.find(({ transport }) => transport === 'event-channel');
  assert.equal(route?.channel, 'charging');
  assert.equal(route?.senders.length, 1);
  assert.equal(route?.handlers.length, 1);
});

test('같은 주소라도 transport가 다르면 경계와 prefix 후보를 섞지 않는다', () => {
  const joined = joinMessageBridges([
    document('dart', 'shared'), eventDocument('swift', 'shared'),
    document('swift', 'dynamic', 'shared'), eventDocument('dart', 'dynamicExpr', 'shared'),
  ], '/app');
  // basic literal 'shared'는 dart sender만, event literal 'shared'는 swift handler만 가진다.
  const literal = joined.routes.filter((route) => route.matching === 'literal');
  assert.equal(literal.length, 2);
  const basicRoute = literal.find((route) => route.transport === 'basic-message-channel');
  assert.equal(basicRoute?.senders.length, 1);
  assert.equal(basicRoute?.handlers.length, 0);
  const eventRoute = literal.find((route) => route.transport === 'event-channel');
  assert.equal(eventRoute?.senders.length, 0);
  assert.equal(eventRoute?.handlers.length, 1);
  // literal 증거는 같은 transport의 prefix 후보로만 투영된다.
  const basicPrefix = joined.routes.find((route) => route.transport === 'basic-message-channel' && route.matching === 'prefix');
  assert.equal(basicPrefix?.senders.length, 1);
  assert.equal(basicPrefix?.senders[0]?.channelExpression, undefined);
  assert.equal(basicPrefix?.handlers.length, 1);
  assert.equal(basicPrefix?.handlers[0]?.channelExpression, 'dynamic');
  const eventPrefix = joined.routes.find((route) => route.transport === 'event-channel' && route.matching === 'prefix');
  assert.equal(eventPrefix?.senders.length, 1);
  assert.equal(eventPrefix?.senders[0]?.channelExpression, 'dynamicExpr');
  assert.equal(eventPrefix?.handlers.length, 1);
  assert.equal(eventPrefix?.handlers[0]?.channelExpression, undefined);
});
