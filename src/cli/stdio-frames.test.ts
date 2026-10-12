import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { Writable } from 'node:stream';
import test from 'node:test';

import { runServeCommand } from './serve-command.ts';
import { readStdioFrames, writeStdioLine } from './stdio-frames.ts';

/** chunk 분할이 JSON·UTF-8 경계와 다를 때도 실제 스트림과 같은 입력을 만든다. */
async function* chunks(...values: Uint8Array[]): AsyncIterable<Uint8Array> {
  yield* values;
}

/** 비동기 프레임을 테스트 기대값과 비교할 배열로 모은다. */
async function collect<T>(input: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const value of input) result.push(value);
  return result;
}

test('bounded frames handle split UTF-8, CRLF, empty and final unterminated lines', async () => {
  const bytes = Buffer.from('가\r\n\nlast');
  assert.deepEqual(await collect(readStdioFrames(chunks(...Array.from(bytes, (b) => Buffer.from([b]))), 8)), ['가\r', '', 'last']);
  assert.deepEqual(await collect(readStdioFrames(chunks())), []);
});

test('frame cap includes raw bytes and recovers at LF without retaining oversized input', async () => {
  assert.deepEqual(await collect(readStdioFrames(chunks(Buffer.from('1234\n12345'), Buffer.alloc(10000, 120), Buffer.from('\nok\nend')), 4)), ['1234', { error: 'too-large' }, 'ok', 'end']);
  assert.deepEqual(await collect(readStdioFrames(chunks(Buffer.from('12345')), 4)), [{ error: 'too-large' }]);
  for (const budget of [0, -1, Infinity, 1.5]) {
    await assert.rejects(collect(readStdioFrames(chunks(), budget)), RangeError);
  }
});

test('malformed UTF-8 produces a safe error and does not damage the next frame', async () => {
  assert.deepEqual(await collect(readStdioFrames(chunks(Buffer.from([0xff, 10, 0xe3]), Buffer.from('\nok\n')))), [{ error: 'invalid-utf8' }, { error: 'invalid-utf8' }, 'ok']);
});

test('serve awaits output and returns safe frame errors before subsequent ping', async () => {
  const written: string[] = [];
  let active = false;
  const ping = '{"jsonrpc":"2.0","id":1,"method":"ping"}\n';
  await runServeCommand(['serve'], async () => '', undefined, undefined, {
    lines: readStdioFrames(chunks(Buffer.alloc(100, 120), Buffer.from('\n'), Buffer.from([0xff, 10]), Buffer.from(ping)), 80),
    writeLine: async (line) => {
      assert.equal(active, false);
      active = true;
      await new Promise((resolve) => setTimeout(resolve, 2));
      written.push(line);
      active = false;
    },
  });
  assert.deepEqual(written.map((line) => JSON.parse(line).id), [null, null, 1]);
  assert.equal(JSON.parse(written[0]!).error.code, -32700);
  assert.match(JSON.parse(written[1]!).error.message, /UTF-8/);
  assert.deepEqual(JSON.parse(written[2]!).result, {});
});

test('output waits for a slow writer and propagates write errors', async () => {
  let done = false;
  const output = new Writable({ highWaterMark: 1, write(_chunk, _encoding, callback) {
    setTimeout(() => { done = true; callback(); }, 5);
  } });
  await writeStdioLine(output, 'response');
  assert.equal(done, true);
  const failing = new Writable({ write(_chunk, _encoding, callback) { callback(new Error('sink failed')); } });
  failing.on('error', () => {});
  await assert.rejects(writeStdioLine(failing, 'response'), /sink failed/);
});

test('actual CLI survives an 80 MiB newline-free frame with a 64 MiB heap and serves next ping', { timeout: 30000 }, async () => {
  const child = spawn(process.execPath, ['--max-old-space-size=64', 'src/cli/main.ts', 'serve'], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += String(chunk); });
  child.stderr.on('data', (chunk) => { stderr += String(chunk); });
  const exited = once(child, 'exit');
  try {
    const block = Buffer.alloc(64 * 1024, 120);
    for (let i = 0; i < 1280; i++) {
      if (!child.stdin.write(block)) await once(child.stdin, 'drain');
    }
    child.stdin.end('\n{"jsonrpc":"2.0","id":9,"method":"ping"}\n');
    const [code, signal] = await exited;
    assert.equal(code, 0, stderr);
    assert.equal(signal, null);
    const responses = stdout.trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(responses[0].error.code, -32700);
    assert.deepEqual(responses[1], { jsonrpc: '2.0', id: 9, result: {} });
  } finally { child.kill(); }
});
