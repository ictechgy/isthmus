import assert from 'node:assert/strict';
import test from 'node:test';

import { runDiffCommand } from './diff-command.ts';
import { runGraphCommand } from './graph-command.ts';
import { runQueryCommand } from './query-command.ts';

/** bridge-facts v2 문서 스트를 만든다. */
function message(
  transport: string,
  platform: string,
  facts: readonly Record<string, unknown>[],
): string {
  return JSON.stringify({
    format: 'bridge-facts', version: 2, transport, platform,
    target: facts.length > 0 ? 'flutter' : null, project: '/app',
    generatedAt: '2026-09-18T00:00:00Z',
    tool: { name: platform === 'dart' ? 'dartograph' : 'cartograph', version: 'test' },
    facts, limitations: [],
  });
}

/** bridge-facts v1 문서 텍스트를 만든다. */
function methodFacts(platform: string, kind: string, channel: string, path: string): string {
  return JSON.stringify({
    format: 'bridge-facts', version: 1,
    tool: { name: platform === 'dart' ? 'dartograph' : 'cartograph', version: '1.0.0' },
    generatedAt: '2026-09-18T00:00:00Z', platform, target: 'flutter', project: '/app',
    facts: [{ kind, channel, dynamic: false, location: { path, line: 1, column: 1 } }],
    limitations: [],
  });
}

const basicSend = { kind: 'message-send', channel: 'example/basic', dynamic: false,
  location: { path: 'lib/api.dart', line: 5, column: 1 } };
const basicHandle = { kind: 'message-handle', channel: 'example/basic', dynamic: false,
  location: { path: 'macos/Setup.swift', line: 9, column: 1 } };

test('query가 v2 입력만으로 메시지 경계를 찾는다', async () => {
  const inputs = new Map<string, string>([
    ['dart.json', message('basic-message-channel', 'dart', [basicSend])],
    ['swift.json', message('basic-message-channel', 'swift', [basicHandle])],
  ]);
  const result = await runQueryCommand(['query', 'example/basic', 'dart.json', 'swift.json'],
    async (path) => inputs.get(path)!);

  assert.equal(result.exitCode, 0);
  const document = JSON.parse(result.standardOutput);
  assert.equal(document.status, 'found');
  assert.equal(document.result.subject.kind, 'message');
});

test('graph가 v2 입력만으로 message 간선을 낸다', async () => {
  const inputs = new Map<string, string>([
    ['dart.json', message('basic-message-channel', 'dart', [basicSend])],
    ['swift.json', message('basic-message-channel', 'swift', [basicHandle])],
  ]);
  const result = await runGraphCommand(['graph', 'dart.json', 'swift.json'],
    async (path) => inputs.get(path)!);

  assert.equal(result.exitCode, 0);
  const document = JSON.parse(result.standardOutput);
  assert.deepEqual(document.edges.map(({ kind }: { kind: string }) => kind), ['message']);
});

test('diff가 v2 입력의 새 매치를 추가 경계로 보고한다', async () => {
  const inputs = new Map<string, string>([
    ['before-dart.json', methodFacts('dart', 'channel-create', 'c', 'lib/a.dart')],
    ['before-swift.json', methodFacts('swift', 'channel-register', 'c', 'ios/A.swift')],
    ['before-msg-dart.json', message('basic-message-channel', 'dart', [basicSend])],
    ['before-msg-swift.json', message('basic-message-channel', 'swift', [])],
    ['after-dart.json', methodFacts('dart', 'channel-create', 'c', 'lib/a.dart')],
    ['after-swift.json', methodFacts('swift', 'channel-register', 'c', 'ios/A.swift')],
    ['after-msg-dart.json', message('basic-message-channel', 'dart', [basicSend])],
    ['after-msg-swift.json', message('basic-message-channel', 'swift', [basicHandle])],
  ]);
  const result = await runDiffCommand([
    'diff', '--before',
    'before-dart.json', 'before-swift.json', 'before-msg-dart.json', 'before-msg-swift.json',
    '--after',
    'after-dart.json', 'after-swift.json', 'after-msg-dart.json', 'after-msg-swift.json',
  ], async (path) => inputs.get(path)!);

  assert.equal(result.exitCode, 0);
  const document = JSON.parse(result.standardOutput);
  assert.equal(document.summary.addedMessageBoundaries, 1);
  assert.equal(document.resolvedIssues[0].code, 'unhandled-message-send');
});