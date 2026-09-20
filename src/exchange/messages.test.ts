import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMessageBridgeDocument } from './messages.ts';

const fact = { kind: 'message-send', channel: 'camera', dynamic: false,
  location: { path: 'lib/api.dart', line: 1, column: 1 }, symbol: { qualifiedName: 'Api.send' } };
const document = { format: 'bridge-facts', version: 2, transport: 'basic-message-channel', platform: 'dart', target: 'flutter',
  project: '/app', generatedAt: '2026-09-14T00:00:00Z', tool: { name: 'dartograph', version: 'dev' }, facts: [fact], limitations: [] };

test('v2 source mtime은 선택적 관찰값으로 보존하고 잘못된 시각은 거부한다', () => {
  assert.equal('sourceModifiedAt' in parseMessageBridgeDocument(document), false);
  for (const sourceModifiedAt of ['1985-10-26T08:15:00.000Z', '2030-01-01T00:00:00Z']) {
    assert.equal(parseMessageBridgeDocument({ ...document, sourceModifiedAt }).sourceModifiedAt, sourceModifiedAt);
  }
  for (const sourceModifiedAt of [null, 0, '', '2026-02-31T00:00:00Z', '2026-01-01T00:00:00']) {
    assert.throws(() => parseMessageBridgeDocument({ ...document, sourceModifiedAt }), /Invalid sourceModifiedAt/);
  }
});

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
    { ...document, platform: 'js' }, { ...document, facts: [{ ...fact, method: 'invented' }] },
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

const eventDocument = { ...document, transport: 'event-channel' };
const listen = { ...fact, kind: 'stream-listen' };
const streamHandle = { ...nativeFact, kind: 'stream-handle' };

test('EventChannel v2는 stream 사실을 transport 구분과 함께 보존한다', () => {
  const dart = parseMessageBridgeDocument({ ...eventDocument, facts: [listen] });
  assert.equal(dart.transport, 'event-channel');
  assert.equal(dart.facts[0]?.kind, 'stream-listen');
  const swift = parseMessageBridgeDocument({ ...eventDocument, platform: 'swift', facts: [streamHandle] });
  assert.equal(swift.facts[0]?.kind, 'stream-handle');
  assert.deepEqual(swift.facts[0]?.handlerScope, nativeFact.handlerScope);
  assert.deepEqual(swift.facts[0]?.dependencies, nativeFact.dependencies);
});

test('EventChannel 문서의 transport·사실 종류·미귀속 한계 규칙을 강제한다', () => {
  for (const value of [
    // transport마다 허용된 사실 종류가 다르다.
    { ...eventDocument, facts: [{ ...listen, kind: 'message-send' }] },
    { ...eventDocument, platform: 'swift', facts: [{ ...streamHandle, kind: 'message-handle' }] },
    { ...document, facts: [{ ...fact, kind: 'stream-listen' }] },
    // method 필드는 여전히 합성할 수 없다.
    { ...eventDocument, facts: [{ ...listen, method: 'invented' }] },
    // 미귀속 스트림 핸들러는 전용 limitation이 없으면 거부한다.
    { ...eventDocument, platform: 'swift', facts: [{ ...streamHandle, channel: null }] },
    { ...eventDocument, platform: 'swift', facts: [{ ...streamHandle, channel: null }],
      limitations: ['unattributed-message-handles: 1'] },
    // Dart 사실은 분기 근거를 가질 수 없다.
    { ...eventDocument, facts: [{ ...listen, handlerScope: streamHandle.handlerScope, dependencies: streamHandle.dependencies }] },
    // ObjC 사실은 분기 근거를 가질 수 없다.
    { ...eventDocument, platform: 'swift', facts: [{ ...streamHandle, sourceLanguage: 'objective-c',
      location: { path: 'ios/Setup.m', line: 9, column: 1 }, symbol: { qualifiedName: 'Setup.register' } }] },
  ]) assert.throws(() => parseMessageBridgeDocument(value));
  const native = parseMessageBridgeDocument({ ...eventDocument, platform: 'swift',
    facts: [{ ...streamHandle, channel: null }], limitations: ['unattributed-stream-handles: 1'] });
  assert.equal(native.facts[0]?.channel, null);
});
