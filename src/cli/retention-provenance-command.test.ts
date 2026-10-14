import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { runRetentionsCommand } from './retentions-command.ts';

const dart = JSON.parse(await readFile(new URL('../../fixtures/bridge/dart.json', import.meta.url), 'utf8'));
const swift = JSON.parse(await readFile(new URL('../../fixtures/bridge/swift.json', import.meta.url), 'utf8'));
const staleWarning = 'index-freshness: source changed after index capture';
const now = () => new Date('2026-10-14T00:00:00.000Z');

async function run(documents: readonly unknown[], target = 'cartograph') {
  const files = new Map(documents.map((document, index) => [`input-${index}.json`, JSON.stringify(document)]));
  return runRetentionsCommand(['retentions', ...files.keys(), '--for', target],
    async (path) => { assert.ok(files.has(path)); return files.get(path)!; }, now, 'test');
}

for (const target of ['cartograph', 'kartograph']) {
  test(`CLI ${target}는 실제 입력 헤더·오래된 한계·기존 호출 근거를 함께 내보낸다`, async () => {
    const platform = target === 'cartograph' ? 'swift' : 'kotlin';
    const usr = target === 'cartograph' ? 's:handler' : 'method:sample/Camera#handle()V';
    const receiver = {
      ...swift, platform, tool: { name: `fixture-${platform}`, version: '1' },
      sourceModifiedAt: '2026-09-14T00:00:00.123456789Z', limitations: [staleWarning],
      facts: swift.facts.map((fact: Record<string, unknown>) => ({ ...fact,
        symbol: { qualifiedName: 'Handler.handle', usr } })),
    };
    const result = await run([dart, receiver], target);
    assert.equal(result.exitCode, 0, result.standardError);
    assert.equal(result.standardError, '');
    const document = JSON.parse(result.standardOutput);
    assert.deepEqual(document.retentions, [{
      symbol: { qualifiedName: 'Handler.handle', usr }, reason: 'bridge',
      evidence: { channel: 'camera', method: 'photo',
        caller: { platform: 'dart', path: 'lib/bridge.dart', line: 4 } },
    }]);
    assert.deepEqual(document.provenance, {
      version: 1,
      sources: [
        { format: 'bridge-facts', version: 1, project: '/fixture', platform: 'dart', target: 'flutter',
          generatedAt: '2026-09-14T00:00:00Z', tool: { name: 'fixture-dart', version: '1' } },
        { format: 'bridge-facts', version: 1, project: '/fixture', platform, target: 'flutter',
          generatedAt: '2026-09-14T00:00:00Z', sourceModifiedAt: receiver.sourceModifiedAt,
          tool: { name: `fixture-${platform}`, version: '1' } },
      ],
      limitations: [{ platform, target: 'flutter', tool: `fixture-${platform}`, message: staleWarning }],
    });
    const zero = await run([{ ...dart,
      facts: dart.facts.filter((fact: { kind: string }) => fact.kind !== 'method-invoke') }, receiver], target);
    assert.equal(zero.exitCode, 0, zero.standardError);
    const zeroDocument = JSON.parse(zero.standardOutput);
    assert.deepEqual(zeroDocument.retentions, []);
    assert.deepEqual(zeroDocument.provenance, document.provenance);
  });
}

test('CLI v2 전용 입력도 transport와 조인 한계를 원본 source 헤더와 함께 보존한다', async () => {
  const message = (platform: 'dart' | 'swift') => ({
    format: 'bridge-facts', version: 2, transport: 'event-channel', platform, target: 'flutter',
    project: '/fixture', generatedAt: '2026-09-14T00:00:00Z',
    tool: { name: `message-${platform}`, version: '2' },
    limitations: platform === 'swift' ? [staleWarning] : [],
    facts: [{ kind: platform === 'dart' ? 'stream-listen' : 'stream-handle',
      channel: 'camera/events', dynamic: false,
      location: { path: platform === 'dart' ? 'lib/events.dart' : 'ios/Events.swift', line: 9, column: 1 },
      ...(platform === 'swift' ? { symbol: { qualifiedName: 'Events.listen', usr: 's:events' } } : {}) }],
  });
  const result = await run([message('dart'), message('swift')]);
  assert.equal(result.exitCode, 0, result.standardError);
  const document = JSON.parse(result.standardOutput);
  assert.deepEqual(document.retentions, [{ symbol: { qualifiedName: 'Events.listen', usr: 's:events' }, reason: 'bridge',
    evidence: { channel: 'camera/events', caller: { platform: 'dart', path: 'lib/events.dart', line: 9 } } }]);
  assert.deepEqual(document.provenance.sources.map((source: Record<string, unknown>) => source.transport),
    ['event-channel', 'event-channel']);
  assert.deepEqual(document.provenance.limitations,
    [{ platform: 'swift', target: 'flutter', tool: 'message-swift', message: staleWarning }]);
});

test('CLI는 한계 개수·canonical 바이트·Unicode 거부 시 일부 root나 JSON을 출력하지 않는다', async () => {
  const variants = [
    { ...swift, limitations: Array(4097).fill(staleWarning) },
    { ...swift, limitations: ['x'.repeat(1_048_576)] },
    { ...swift, limitations: ['private-marker-\ud800'] },
  ];
  for (const receiver of variants) {
    const result = await run([dart, receiver]);
    assert.equal(result.exitCode, 2);
    assert.equal(result.standardOutput, '');
    assert.match(result.standardError, /provenance|retention/iu);
    assert.equal(result.standardError.includes('private-marker'), false);
  }
});

test('CLI는 잘못된 입력 timestamp를 부분 보존 결과로 바꾸지 않는다', async () => {
  for (const sourceModifiedAt of ['2026-02-30T00:00:00Z', '2026-01-01T00:00:60Z']) {
    const result = await run([dart, { ...swift, sourceModifiedAt }]);
    assert.equal(result.exitCode, 2);
    assert.equal(result.standardOutput, '');
    assert.match(result.standardError, /timestamp/iu);
  }
});
