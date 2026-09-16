import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { runServeCommand } from './serve-command.ts';

const dartPath = fileURLToPath(
  new URL('../../experiments/phase-0/expected/dart.json', import.meta.url),
);
const swiftPath = fileURLToPath(
  new URL('../../experiments/phase-0/expected/swift.json', import.meta.url),
);

async function* linesOf(lines: readonly string[]): AsyncIterable<string> {
  for (const line of lines) yield line;
}

test('serve는 줄 단위 세션을 돌리고 입력이 닫히면 0으로 끝난다', async () => {
  const written: string[] = [];
  const result = await runServeCommand(
    ['serve'],
    (path) => readFile(path, 'utf8'),
    undefined,
    '0.0.0-test',
    {
      lines: linesOf([
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}',
        '',
        '   ',
        '{"jsonrpc":"2.0","method":"notifications/initialized"}',
        '{"jsonrpc":"2.0","id":2,"method":"ping"}',
        JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: {
            name: 'query',
            arguments: {
              name: 'dev.isthmus/camera',
              documents: [dartPath, swiftPath],
            },
          },
        }),
      ]),
      writeLine: (line) => written.push(line),
    },
  );

  assert.deepEqual(result, {
    standardOutput: '',
    standardError: '',
    exitCode: 0,
  });
  // 빈 줄·알림은 응답하지 않는다 — 요청 세 건만 응답한다.
  assert.equal(written.length, 3);
  const initialize = JSON.parse(written[0]!);
  assert.equal(initialize.result.serverInfo.name, 'isthmus');
  const query = JSON.parse(written[2]!);
  assert.equal(
    JSON.parse(query.result.content[0].text).status,
    'found',
  );
});

test('serve에 인자가 붙으면 사용법과 종료 코드 64를 반환한다', async () => {
  const result = await runServeCommand(
    ['serve', '--verbose'],
    async () => '',
  );

  assert.deepEqual(result, {
    standardOutput: '',
    standardError: 'Usage: isthmus serve\n',
    exitCode: 64,
  });
});
