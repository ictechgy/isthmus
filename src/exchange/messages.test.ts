import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMessageBridgeDocument } from './messages.ts';

const fact = { kind: 'message-send', channel: 'camera', dynamic: false,
  location: { path: 'lib/api.dart', line: 1, column: 1 }, symbol: { qualifiedName: 'Api.send' } };
const document = { format: 'bridge-facts', version: 2, transport: 'basic-message-channel', platform: 'dart', target: 'flutter',
  project: '/app', generatedAt: '2026-09-14T00:00:00Z', tool: { name: 'dartograph', version: 'dev' }, facts: [fact], limitations: [] };

test('Basic v2는 method를 만들지 않고 literal과 증명된 prefix를 보존한다', () => {
  const parsed = parseMessageBridgeDocument({ ...document, facts: [{ ...fact, extra: 'discard' },
    { ...fact, channel: 'pigeonName', dynamic: true, channelPrefix: 'dev.flutter.pigeon.Api.read' }] });
  assert.equal(parsed.version, 2);
  assert.equal(parsed.facts[0]?.kind, 'message-send');
  assert.equal('method' in parsed.facts[0]!, false);
  assert.equal('extra' in parsed.facts[0]!, false);
  assert.equal(parsed.facts[1]?.channelPrefix, 'dev.flutter.pigeon.Api.read');
});

test('transport·platform·literal/prefix·path·미귀속 계약 위반을 거부한다', () => {
  for (const value of [
    { ...document, version: 1 }, { ...document, transport: 'method-channel' },
    { ...document, platform: 'kotlin' }, { ...document, facts: [{ ...fact, method: 'invented' }] },
    { ...document, facts: [{ ...fact, channelPrefix: 'not-dynamic' }] },
    { ...document, facts: [{ ...fact, channel: null }] },
    { ...document, facts: [{ ...fact, location: { ...fact.location, path: '../secret' } }] },
    { ...document, platform: 'swift', facts: [{ ...fact, kind: 'message-handle', channel: null }] },
  ]) assert.throws(() => parseMessageBridgeDocument(value));
  const native = parseMessageBridgeDocument({ ...document, platform: 'swift', facts: [{ ...fact, kind: 'message-handle', channel: null }],
    limitations: ['unattributed-message-handles: 1'] });
  assert.equal(native.facts[0]?.channel, null);
});

const nativeFact = { ...fact, kind: 'message-handle', symbol: { qualifiedName: 'Setup.register', usr: 's:setup' },
  location: { path: 'macos/Setup.swift', line: 9, column: 1 },
  handlerScope: { start: { path: 'macos/Setup.swift', line: 10, column: 1 },
    end: { path: 'macos/Setup.swift', line: 20, column: 1 }, complete: true },
  dependencies: [{ kind: 'call', scope: 'handler', location: { path: 'macos/Setup.swift', line: 12, column: 4 },
    symbol: { qualifiedName: 'Api.launch', usr: 's:requirement' },
    dispatchTargets: [{ qualifiedName: 'Plugin.launch', usr: 's:implementation' }] }] };

test('handler 범위와 실제 참조·dispatch 후보를 보존하며 임의 추가 필드를 제거한다', () => {
  const parsed = parseMessageBridgeDocument({ ...document, platform: 'swift', facts: [{ ...nativeFact,
    handlerScope: { ...nativeFact.handlerScope, extra: true },
    dependencies: [{ ...nativeFact.dependencies[0], extra: true }] }] });
  assert.deepEqual(parsed.facts[0]?.handlerScope, nativeFact.handlerScope);
  assert.deepEqual(parsed.facts[0]?.dependencies, nativeFact.dependencies);
  const incomplete = parseMessageBridgeDocument({ ...document, platform: 'swift', facts: [{ ...nativeFact,
    symbol: undefined, handlerScope: { ...nativeFact.handlerScope, complete: false }, dependencies: [] }] });
  assert.equal(incomplete.facts[0]?.handlerScope?.complete, false);
});

test('handler 의존 근거의 역할·범위·신원·크기 위반을 거부한다', () => {
  const dep = nativeFact.dependencies[0]!;
  for (const invalid of [
    { ...nativeFact, handlerScope: undefined }, { ...nativeFact, dependencies: undefined },
    { ...nativeFact, symbol: undefined },
    { ...nativeFact, handlerScope: { ...nativeFact.handlerScope, complete: 'yes' } },
    { ...nativeFact, handlerScope: { ...nativeFact.handlerScope, end: { ...nativeFact.handlerScope.start, line: 1 } } },
    { ...nativeFact, dependencies: [{ ...dep, kind: 'guessed' }] },
    { ...nativeFact, dependencies: [{ ...dep, scope: 'guessed' }] },
    { ...nativeFact, dependencies: [{ ...dep, symbol: { qualifiedName: 'NoUSR' } }] },
    { ...nativeFact, dependencies: [{ ...dep, location: { ...dep.location, path: 'macos/Other.swift' } }] },
    { ...nativeFact, dependencies: [{ ...dep, location: { ...dep.location, line: 21 } }] },
    { ...nativeFact, dependencies: [{ ...dep, scope: 'registration' }] },
    { ...nativeFact, dependencies: [{ ...dep, dispatchTargets: [{ qualifiedName: 'NoUSR' }] }] },
    { ...nativeFact, dependencies: Array(10_001).fill(dep) },
    { ...nativeFact, dependencies: [{ ...dep, dispatchTargets: Array(10_001).fill(dep.symbol) }] },
  ]) assert.throws(() => parseMessageBridgeDocument({ ...document, platform: 'swift', facts: [invalid] }));
  assert.throws(() => parseMessageBridgeDocument({ ...document, facts: [{ ...nativeFact, kind: 'message-send' }] }));
  const large = { ...nativeFact, dependencies: Array(100).fill({ ...dep, dispatchTargets: Array(10_000).fill(dep.symbol) }) };
  assert.throws(() => parseMessageBridgeDocument({ ...document, platform: 'swift', facts: [large] }));
});
