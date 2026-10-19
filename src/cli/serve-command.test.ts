import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
      writeLine: (line) => { written.push(line); },
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

test('실제 serve는 FIFO·장치 경로를 기다리지 않고 읽기 실패로 답한 뒤 다음 요청을 처리한다', { timeout: 30_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'isthmus-serve-fifo-'));
  const fifo = join(root, 'pipe.json');
  // 힙을 줄여 /dev/zero를 끝까지 읽던 회귀가 응답 대신 메모리 부족으로 드러나게 한다.
  const child = spawn(process.execPath, ['--max-old-space-size=64',
    fileURLToPath(new URL('./main.ts', import.meta.url)), 'serve'], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += String(chunk); });
  child.stderr.on('data', (chunk) => { stderr += String(chunk); });
  const exited = once(child, 'exit');
  let timer: NodeJS.Timeout | undefined;
  try {
    assert.equal(spawnSync('mkfifo', [fifo]).status, 0);
    const check = (id: number, documents: readonly string[]) =>
      JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'check', arguments: { documents } } });
    const ping = (id: number) => JSON.stringify({ jsonrpc: '2.0', id, method: 'ping' });
    child.stdin.end(`${[ping(1), check(2, [fifo, swiftPath]), check(3, ['/dev/zero', swiftPath]), ping(4),
      check(5, [dartPath, swiftPath])].join('\n')}\n`);
    // 막힌 세션은 입력이 닫혀도 끝나지 않는다. 넉넉한 마감 안에 끝났는지만 보고, 응답 순서로 판정한다.
    const deadline = new Promise<'blocked'>((resolve) => { timer = setTimeout(resolve, 15_000, 'blocked'); });
    const outcome = await Promise.race([exited.then(([code]) => code), deadline]);
    assert.equal(outcome, 0, stderr);
    const responses = stdout.trim().split('\n').map((line) => JSON.parse(line));
    assert.deepEqual(responses.map(({ id }) => id), [1, 2, 3, 4, 5]);
    for (const failed of [responses[1], responses[2]]) {
      assert.equal(failed.result.isError, true);
      assert.match(failed.result.content[0].text, /^Unable to read bridge facts input 1;/u);
    }
    assert.deepEqual(responses[3].result, {});
    assert.equal(responses[4].result.isError, false);
    assert.equal(JSON.parse(responses[4].result.content[0].text).format, 'isthmus-check');
  } finally {
    clearTimeout(timer);
    child.kill('SIGKILL');
    await rm(root, { recursive: true, force: true });
  }
});

test('실제 serve는 상한을 넘을 수밖에 없는 큰 일반 파일을 읽지 않고 크기 상한 오류로 답한 뒤 다음 요청을 처리한다', { timeout: 30_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'isthmus-serve-large-'));
  // 디스크를 쓰지 않는 희소 파일이다. 300 MiB는 문서 하나의 상한(UTF-16 16Mi)의 3배 바이트를 넘어 다 읽어도 상한에 걸린다.
  // 64 MiB 힙에서 통째로 읽으면 세션이 메모리 부족으로 죽어 뒤의 요청에도 답하지 못한다.
  const large = join(root, 'large.json');
  await writeFile(large, '');
  await truncate(large, 300 * 1024 * 1024);
  const child = spawn(process.execPath, ['--max-old-space-size=64',
    fileURLToPath(new URL('./main.ts', import.meta.url)), 'serve'], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += String(chunk); });
  child.stderr.on('data', (chunk) => { stderr += String(chunk); });
  const exited = once(child, 'exit');
  let timer: NodeJS.Timeout | undefined;
  try {
    const check = (id: number, documents: readonly string[]) =>
      JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'check', arguments: { documents } } });
    child.stdin.end(`${[check(1, [large, swiftPath]), JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' }),
      check(3, [dartPath, swiftPath])].join('\n')}\n`);
    const deadline = new Promise<'blocked'>((resolve) => { timer = setTimeout(resolve, 15_000, 'blocked'); });
    const outcome = await Promise.race([exited.then(([code]) => code), deadline]);
    assert.equal(outcome, 0, stderr);
    const responses = stdout.trim().split('\n').map((line) => JSON.parse(line));
    assert.deepEqual(responses.map(({ id }) => id), [1, 2, 3]);
    assert.equal(responses[0].result.isError, true);
    assert.match(responses[0].result.content[0].text, /^Bridge facts input 1 exceeds the input size limits;/u);
    assert.deepEqual(responses[1].result, {});
    assert.equal(responses[2].result.isError, false);
    assert.equal(JSON.parse(responses[2].result.content[0].text).format, 'isthmus-check');
  } finally {
    clearTimeout(timer);
    child.kill('SIGKILL');
    await rm(root, { recursive: true, force: true });
  }
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
