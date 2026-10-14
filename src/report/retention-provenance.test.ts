import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { parseBridgeFactsDocument, type BridgeFactsDocument } from '../exchange/parse.ts';
import { parseMessageBridgeDocument, type BridgeMessageDocument } from '../exchange/messages.ts';
import { emptyBridgeJoinResult, joinBridgeDocuments, type JoinLimitation } from '../join/join.ts';
import { joinMessageBridges } from '../join/messages.ts';
import { createRetentionsDocument, encodeRetentionsDocument, RetentionValidationError } from './retentions.ts';

const dart = parseBridgeFactsDocument(JSON.parse(await readFile(
  new URL('../../fixtures/bridge/dart.json', import.meta.url), 'utf8')));
const swift = parseBridgeFactsDocument(JSON.parse(await readFile(
  new URL('../../fixtures/bridge/swift.json', import.meta.url), 'utf8')));
const convertedAt = '2026-10-14T00:00:00.000Z';
const staleWarning = 'index-freshness: source changed after index capture';
const maximumBytes = 1_048_576;

function context(document: ReturnType<typeof createRetentionsDocument>): Record<string, unknown> {
  return JSON.parse(encodeRetentionsDocument(document)).provenance as Record<string, unknown>;
}

function fromLimitations(limitations: readonly JoinLimitation[],
  sources?: readonly (BridgeFactsDocument | BridgeMessageDocument)[]) {
  return createRetentionsDocument({ ...emptyBridgeJoinResult(), limitations }, convertedAt, 'test',
    undefined, 'cartograph', sources);
}

function warning(message: string): JoinLimitation {
  return { platform: 'swift', target: 'flutter', tool: 'fixture-swift', message };
}

function header(platform: 'dart' | 'swift' | 'kotlin') {
  return {
    format: 'bridge-facts', version: 1, project: '/fixture', platform, target: 'flutter',
    generatedAt: '2026-09-14T00:00:00Z', tool: { name: `fixture-${platform}`, version: '1' },
  };
}

for (const target of ['cartograph', 'kartograph'] as const) {
  test(`${target}는 오래된 문맥을 붙여도 원래 root와 Dart 호출 근거를 바꾸지 않는다`, () => {
    const platform = target === 'cartograph' ? 'swift' : 'kotlin';
    const usr = target === 'cartograph' ? 's:handler' : 'method:sample/Camera#handle()V';
    const receiver = parseBridgeFactsDocument({
      ...swift, platform, tool: { name: `fixture-${platform}`, version: '1' },
      facts: swift.facts.map((fact) => ({ ...fact, symbol: { qualifiedName: 'Handler.handle', usr } })),
    });
    const stale = { ...receiver, limitations: [staleWarning] };
    const baseline = createRetentionsDocument(joinBridgeDocuments([dart, receiver]), convertedAt, 'test',
      undefined, target, [dart, receiver]);
    const changed = createRetentionsDocument(joinBridgeDocuments([dart, stale]), convertedAt, 'test',
      undefined, target, [dart, stale]);
    assert.deepEqual(changed.retentions, baseline.retentions);
    assert.deepEqual(changed.retentions, [{
      symbol: { qualifiedName: 'Handler.handle', usr }, reason: 'bridge',
      evidence: { channel: 'camera', method: 'photo',
        caller: { platform: 'dart', path: 'lib/bridge.dart', line: 4 } },
    }]);
    assert.deepEqual(context(changed), {
      version: 1, sources: [header('dart'), header(platform)],
      limitations: [{ platform, target: 'flutter', tool: `fixture-${platform}`, message: staleWarning }],
    });
    const emptyCaller = { ...dart, facts: dart.facts.filter((fact) => fact.kind !== 'method-invoke') };
    const zero = createRetentionsDocument(joinBridgeDocuments([emptyCaller, stale]), convertedAt, 'test',
      undefined, target, [emptyCaller, stale]);
    assert.deepEqual(zero.retentions, []);
    assert.deepEqual(context(zero), context(changed));
  });
}

test('옛 직접 API는 알려진 한계를 유지하되 없는 원본 캡처를 지어내지 않는다', () => {
  const limitation = warning(staleWarning);
  const withoutSources = fromLimitations([limitation]);
  assert.deepEqual(context(withoutSources), { version: 1, limitations: [limitation] });
  assert.equal(Object.hasOwn(context(withoutSources), 'sources'), false);
  assert.deepEqual(context(fromLimitations([], [])), { version: 1, sources: [], limitations: [] });
  assert.deepEqual(withoutSources.retentions, []);
});

test('변환 시각은 원본 캡처·소스 수정 시각의 철자와 한계를 갱신하지 않는다', () => {
  const sourceModifiedAt = '2026-02-28t01:02:03.12345678901234567890+23:59';
  const original = { ...swift, generatedAt: '2024-02-29t01:02:03.987654321z', sourceModifiedAt,
    privateNote: 'not part of the source header' };
  const joined = { ...emptyBridgeJoinResult(), limitations: [warning(staleWarning)] };
  const first = createRetentionsDocument(joined, convertedAt, 'test', undefined, 'cartograph', [original]);
  const later = createRetentionsDocument(joined, '2027-01-01T00:00:00Z', 'test', undefined, 'cartograph', [original]);
  assert.deepEqual(context(first), context(later));
  assert.deepEqual(context(first).sources, [{ ...header('swift'),
    generatedAt: original.generatedAt, sourceModifiedAt }]);
  for (const source of context(first).sources as Record<string, unknown>[]) {
    assert.equal(Object.hasOwn(source, 'privateNote'), false);
    assert.equal(Object.hasOwn(source, 'facts'), false);
  }
});

function messageDocument(platform: 'dart' | 'swift'): BridgeMessageDocument {
  return parseMessageBridgeDocument({
    format: 'bridge-facts', version: 2, transport: 'basic-message-channel', platform,
    target: 'flutter', project: '/fixture', generatedAt: '2026-09-14T00:00:00Z',
    tool: { name: `message-${platform}`, version: '2' },
    limitations: platform === 'swift' ? ['message-capture: receiver context'] : [],
    facts: [{ kind: platform === 'dart' ? 'message-send' : 'message-handle', channel: 'camera/basic',
      dynamic: false, location: { path: platform === 'dart' ? 'lib/basic.dart' : 'ios/Basic.swift', line: 7, column: 1 },
      ...(platform === 'swift' ? { symbol: { qualifiedName: 'Basic.handle', usr: 's:basic' } } : {}) }],
  });
}

test('혼합 v1·v2의 모든 입력 헤더와 양쪽 조인 한계를 원래 순서로 보존한다', () => {
  const stale = { ...swift, limitations: [staleWarning] };
  const messages = [messageDocument('dart'), messageDocument('swift')];
  const joined = joinBridgeDocuments([dart, stale]);
  const messageJoin = joinMessageBridges(messages, '/fixture');
  const sources = [messages[1]!, dart, messages[0]!, stale];
  const document = createRetentionsDocument(joined, convertedAt, 'test', messageJoin, 'cartograph', sources);
  assert.deepEqual(document.retentions.map(({ symbol }) => symbol.usr), ['s:handler', 's:basic']);
  assert.deepEqual(context(document).limitations, [
    warning(staleWarning),
    { platform: 'swift', target: 'flutter', tool: 'message-swift', message: 'message-capture: receiver context' },
  ]);
  assert.deepEqual(context(document).sources, [
    { ...header('swift'), version: 2, transport: 'basic-message-channel', tool: { name: 'message-swift', version: '2' } },
    header('dart'),
    { ...header('dart'), version: 2, transport: 'basic-message-channel', tool: { name: 'message-dart', version: '2' } },
    header('swift'),
  ]);
  assert.equal('method' in document.retentions[1]!.evidence, false);
});

test('문서 한계의 origin·채널·routeScope와 Unicode 철자는 손실 없이 복사한다', () => {
  const limitation: JoinLimitation = {
    platform: 'cross-platform', target: null, tool: 'isthmus', message: 'é e\u0301 \n\u001b',
    origin: 'consumer', channels: ['z', 'a', 'a'],
    routeScope: { templates: ['/b', '/a'], templatePrefixes: ['/start'], templateSuffixes: ['/end'],
      methods: ['POST', 'GET'], withheldElements: 9_007_199_254_740_991 },
  };
  const document = fromLimitations([limitation, limitation]);
  assert.deepEqual(context(document).limitations, [limitation, limitation]);
  const before = encodeRetentionsDocument(document);
  (limitation.channels as string[]).push('changed after capture');
  (limitation.routeScope!.templates as string[]).push('/changed');
  assert.equal(encodeRetentionsDocument(document), before);
});

test('원본 헤더도 호출자 객체와 배열의 후속 변경으로 바뀌지 않는다', () => {
  const source = { ...swift, tool: { name: 'fixture-swift', version: '1' } };
  const sources = [source];
  const document = fromLimitations([], sources);
  source.tool.name = 'changed';
  sources.push(dart);
  assert.deepEqual(context(document).sources, [header('swift')]);
});

test('source와 limitation 개수의 정확한 상한을 중복 제거 없이 적용한다', () => {
  assert.equal((context(fromLimitations([], Array(256).fill(swift))).sources as unknown[]).length, 256);
  assert.throws(() => fromLimitations([], Array(257).fill(swift)), RetentionValidationError);
  assert.equal((context(fromLimitations(Array(4096).fill(warning('same')))).limitations as unknown[]).length, 4096);
  assert.throws(() => fromLimitations(Array(4097).fill(warning('same'))), RetentionValidationError);
});

test('v1과 v2 한계는 하나의 문서 개수 예산을 공유한다', () => {
  const joined = { ...emptyBridgeJoinResult(), limitations: Array(4095).fill(warning('v1')) };
  const messageJoin = { routes: [], unresolved: [], observedFacts: 0, limitations: [warning('v2')] };
  const exact = createRetentionsDocument(joined, convertedAt, 'test', messageJoin);
  assert.equal((context(exact).limitations as unknown[]).length, 4096);
  assert.throws(() => createRetentionsDocument(joined, convertedAt, 'test', {
    ...messageJoin, limitations: [warning('v2'), warning('v2')],
  }), RetentionValidationError);
});

test('미래 한계 메타데이터도 깊이 64에서 허용하고 65에서 거부한다', () => {
  function nested(count: number): unknown {
    let value: unknown = null;
    for (let index = 0; index < count; index++) value = { next: value };
    return value;
  }
  // envelope·limitations 배열·limitation 객체가 먼저 세 깊이를 차지한다.
  const exact = { ...warning('future'), future: nested(61) };
  assert.deepEqual(context(fromLimitations([exact])).limitations, [exact]);
  assert.throws(() => fromLimitations([{ ...warning('future'), future: nested(62) } as JoinLimitation]),
    RetentionValidationError);
});

test('1MiB 상한은 pretty 공백이 아닌 escape·다중 바이트를 포함한 canonical UTF8에 적용한다', () => {
  const marker = 'é\n"\\';
  const empty = { version: 1, limitations: [warning(marker)] };
  const padding = maximumBytes - Buffer.byteLength(JSON.stringify(empty), 'utf8');
  const exact = fromLimitations([warning(marker + 'x'.repeat(padding))]);
  assert.equal(Buffer.byteLength(JSON.stringify(context(exact)), 'utf8'), maximumBytes);
  assert.ok(Buffer.byteLength(encodeRetentionsDocument(exact), 'utf8') > maximumBytes);
  assert.throws(() => fromLimitations([warning(marker + 'x'.repeat(padding + 1))]), RetentionValidationError);
});

for (const value of [-1, -0, 0.5, Number.NaN, Number.POSITIVE_INFINITY, 9_007_199_254_740_992]) {
  test(`routeScope의 잘못된 withheldElements ${String(value)}를 조용히 정규화하지 않는다`, () => {
    assert.throws(() => fromLimitations([{ ...warning('scope'), routeScope: { withheldElements: value } }]),
      RetentionValidationError);
  });
}

test('typed API의 잘못된 알려진 source 헤더는 부분 출처 대신 거부한다', () => {
  const malformed: unknown[] = [
    { ...swift, format: 'other' }, { ...swift, version: 3 }, { ...swift, version: 1, transport: 'event-channel' },
    { ...swift, version: 2 }, { ...swift, version: 2, transport: 'unknown' },
    { ...swift, tool: { name: 'fixture-swift', version: 1 } }, { ...swift, project: null },
    { ...swift, target: undefined }, { ...swift, platform: 1 },
    { ...swift, sourceModifiedAt: null },
    Object.assign([], swift), { ...swift, tool: Object.assign([], swift.tool) },
  ];
  for (const value of malformed) {
    assert.throws(() => fromLimitations([], [value as BridgeFactsDocument]), RetentionValidationError);
  }
});

test('portable timestamp는 잘못된 달력·시계·offset을 거부한다', () => {
  for (const timestamp of [
    '2026-02-29T00:00:00Z', '2026-02-30T00:00:00Z', '2026-13-01T00:00:00Z',
    '2026-01-01T24:00:00Z', '2026-01-01T00:60:00Z', '2026-01-01T00:00:60Z',
    '2026-01-01T00:00:00+24:00', '2026-01-01T00:00:00+00:60', '2026-01-01',
  ]) {
    for (const key of ['generatedAt', 'sourceModifiedAt']) {
      assert.throws(() => fromLimitations([], [{ ...swift, [key]: timestamp }]), RetentionValidationError,
        `${key}: ${timestamp}`);
    }
  }
});

test('출처 모든 문자열의 lone surrogate와 잘못된 한계 필드를 거부한다', () => {
  for (const value of ['\ud800', '\udc00']) {
    assert.throws(() => fromLimitations([warning(value)]), RetentionValidationError);
    assert.throws(() => fromLimitations([], [{ ...swift, project: value }]), RetentionValidationError);
    assert.throws(() => fromLimitations([], [{ ...swift, tool: { name: value, version: '1' } }]), RetentionValidationError);
  }
  for (const limitation of [
    { ...warning('bad'), origin: 1 }, { ...warning('bad'), channels: ['ok', 1] },
    { ...warning('bad'), routeScope: { templates: 'bad' } }, { ...warning('bad'), target: undefined },
  ]) {
    assert.throws(() => fromLimitations([limitation as unknown as JoinLimitation]), RetentionValidationError);
  }
});

function encodeSuppliedProvenance(provenance: unknown): string {
  return encodeRetentionsDocument({
    format: 'external-retentions', version: 0, producedBy: { name: 'isthmus', version: 'test' },
    generatedAt: convertedAt, retentions: [], provenance,
  } as unknown as ReturnType<typeof createRetentionsDocument>);
}

test('encoder는 출처가 없는 옛 직접 문서를 그대로 허용한다', () => {
  const legacy = {
    format: 'external-retentions' as const, version: 0 as const,
    producedBy: { name: 'isthmus' as const, version: 'test' }, generatedAt: convertedAt, retentions: [],
  };
  assert.deepEqual(JSON.parse(encodeRetentionsDocument(legacy)), legacy);
});

test('encoder는 직접 주거나 생성 뒤 변조한 version·필수 배열·source 모양을 거부한다', () => {
  const malformed = [
    null, [], { version: '1', limitations: [] }, { version: 0, limitations: [] },
    { version: 2, limitations: [] }, { version: 1 }, { version: 1, limitations: null },
    { version: 1, limitations: [], sources: null },
    { version: 1, limitations: [], sources: [{ ...header('swift'), tool: null }] },
    { version: 1, limitations: [], sources: [{ ...header('swift'), target: undefined }] },
    { version: 1, limitations: [], sources: [{ ...header('swift'), version: 2 }] },
  ];
  for (const provenance of malformed) {
    assert.throws(() => encodeSuppliedProvenance(provenance), RetentionValidationError);
  }
  const created = fromLimitations([warning('valid')], [swift]);
  (created.provenance as unknown as { version: number }).version = 2;
  assert.throws(() => encodeRetentionsDocument(created), RetentionValidationError);
});

test('encoder도 사후 확장된 source·limitation 개수와 canonical 바이트 상한을 다시 검사한다', () => {
  const sources = Array(256).fill(header('swift'));
  assert.equal(JSON.parse(encodeSuppliedProvenance({ version: 1, limitations: [], sources })).provenance.sources.length,
    256);
  sources.push(header('swift'));
  assert.throws(() => encodeSuppliedProvenance({ version: 1, limitations: [], sources }), RetentionValidationError);
  const limitations = Array(4096).fill(warning('same'));
  assert.equal(JSON.parse(encodeSuppliedProvenance({ version: 1, limitations })).provenance.limitations.length, 4096);
  limitations.push(warning('same'));
  assert.throws(() => encodeSuppliedProvenance({ version: 1, limitations }), RetentionValidationError);
  const metadata = { version: 1, limitations: [], note: '' };
  metadata.note = 'x'.repeat(maximumBytes - Buffer.byteLength(JSON.stringify(metadata), 'utf8'));
  const exact = JSON.parse(encodeSuppliedProvenance(metadata)).provenance;
  assert.equal(Buffer.byteLength(JSON.stringify(exact), 'utf8'), maximumBytes);
  metadata.note += 'x';
  assert.throws(() => encodeSuppliedProvenance(metadata), RetentionValidationError);
});

test('encoder의 중첩 원문 문맥도 깊이 64와 65를 구분한다', () => {
  let nested: unknown = null;
  for (let index = 0; index < 63; index++) nested = { next: nested };
  const exact = { version: 1, limitations: [], future: nested };
  assert.deepEqual(JSON.parse(encodeSuppliedProvenance(exact)).provenance, exact);
  assert.throws(() => encodeSuppliedProvenance({ ...exact, future: { next: nested } }), RetentionValidationError);
});

test('encoder는 미래 중첩 필드의 안전한 scalar와 정규화가 다른 Unicode 키를 보존한다', () => {
  const provenance = { version: 1, limitations: [], future: {
    é: 'composed', 'e\u0301': 'decomposed', values: [null, true, false, -9_007_199_254_740_991,
      9_007_199_254_740_991, 0, '😀\n\t\u0001'],
  } };
  assert.deepEqual(JSON.parse(encodeSuppliedProvenance(provenance)).provenance, provenance);
});

test('encoder는 미래 중첩 필드의 잘못된 숫자와 Unicode를 JSON 정규화 전에 거부한다', () => {
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, -0, 0.5,
    9_007_199_254_740_992, -9_007_199_254_740_992, '\ud800', '\udc00',
    { ['bad\ud800']: 'value' }]) {
    assert.throws(() => encodeSuppliedProvenance({ version: 1, limitations: [], future: { values: [value] } }),
      RetentionValidationError);
  }
});

test('encoder는 올바른 속성을 붙인 배열을 envelope·source·tool 객체로 받아들이지 않는다', () => {
  const envelope = Object.assign([], { version: 1, limitations: [] });
  assert.throws(() => encodeSuppliedProvenance(envelope), RetentionValidationError);
  const sourceArray = Object.assign([], header('swift'));
  const toolArray = Object.assign([], { name: 'fixture-swift', version: '1' });
  for (const source of [sourceArray, { ...header('swift'), tool: toolArray }]) {
    assert.throws(() => encodeSuppliedProvenance({ version: 1, limitations: [], sources: [source] }),
      RetentionValidationError);
  }
});
