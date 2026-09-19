import assert from 'node:assert/strict';
import test from 'node:test';
import { runRetentionsCommand } from './retentions-command.ts';

const location = { path: 'android/Camera.kt', line: 8, column: 1 };
const symbol = { qualifiedName: 'Camera.handle', usr: 'method:example/Camera#handle()V' };

function document(platform: string, facts: unknown[], version = 1) {
  return JSON.stringify({
    format: 'bridge-facts', version, platform, target: 'flutter', project: '/app',
    ...(version === 2 ? { transport: 'event-channel' } : {}),
    tool: { name: platform === 'dart' ? 'dartograph' : 'kartograph', version: 'test' },
    generatedAt: '2026-09-19T00:00:00.000Z', limitations: [], facts,
  });
}

async function run(receiver: string, version = 1, target = 'kartograph') {
  const caller = document('dart', [{
    kind: version === 1 ? 'method-invoke' : 'stream-listen', channel: 'camera',
    ...(version === 1 ? { method: 'capture' } : {}), dynamic: false,
    location: { path: 'lib/camera.dart', line: 3, column: 1 },
  }], version);
  return runRetentionsCommand(
    ['retentions', 'caller.json', 'receiver.json', '--for', target],
    async (path) => path === 'caller.json' ? caller : receiver,
    () => new Date('2026-09-19T00:00:00.000Z'), 'test',
  );
}

test('kartograph 보존은 Kotlin JVM 식별자와 원본 Dart 호출 근거를 보존한다', async () => {
  const result = await run(document('kotlin', [{
    kind: 'method-handle', channel: 'camera', method: 'capture', dynamic: false, location, symbol,
  }]));
  assert.equal(result.exitCode, 0, result.standardError);
  assert.deepEqual(JSON.parse(result.standardOutput).retentions, [{
    symbol, reason: 'bridge', evidence: {
      channel: 'camera', method: 'capture', caller: { platform: 'dart', path: 'lib/camera.dart', line: 3 },
    },
  }]);
});

test('kartograph 보존은 v2 스트림도 메서드 없는 근거로 내보낸다', async () => {
  const result = await run(document('kotlin', [{
    kind: 'stream-handle', channel: 'camera', dynamic: false, location, symbol,
  }], 2), 2);
  assert.equal(result.exitCode, 0, result.standardError);
  const retention = JSON.parse(result.standardOutput).retentions[0];
  assert.deepEqual(retention.symbol, symbol);
  assert.equal('method' in retention.evidence, false);
});

test('kartograph 대상에 Swift 문서만 주면 부분·빈 보존 문서를 만들지 않는다', async () => {
  const result = await run(document('swift', [{
    kind: 'method-handle', channel: 'camera', method: 'capture', dynamic: false,
    location: { ...location, path: 'ios/Camera.swift' }, symbol,
  }]));
  assert.equal(result.exitCode, 2);
  assert.equal(result.standardOutput, '');
  assert.match(result.standardError, /require at least one kotlin/u);
});

test('JVM 식별자가 없는 Kotlin 핸들러는 이름으로 추측해 보존하지 않는다', async () => {
  for (const missing of [undefined, { qualifiedName: 'Camera.handle' }]) {
    const result = await run(document('kotlin', [{
      kind: 'method-handle', channel: 'camera', method: 'capture', dynamic: false, location,
      ...(missing === undefined ? {} : { symbol: missing }),
    }]));
    assert.equal(result.exitCode, 2);
    assert.equal(result.standardOutput, '');
    assert.match(result.standardError, /matched kotlin handlers/u);
  }
});
