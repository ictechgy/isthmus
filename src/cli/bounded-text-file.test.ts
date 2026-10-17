import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readBoundedTextFile, readRegularTextFile, BoundedTextReadError } from './bounded-text-file.ts';

test('bounded UTF-8 file reads accept exact cap and reject cap+1, malformed bytes and directories', async () => {
  const root = await mkdtemp(join(tmpdir(), 'isthmus-text-'));
  try {
    const file = join(root, 'input.json');
    await writeFile(file, 'abcd');
    assert.equal(await readBoundedTextFile(file, 4), 'abcd');
    await assert.rejects(readBoundedTextFile(file, 3), (error) => error instanceof BoundedTextReadError && error.reason === 'limit');
    await writeFile(file, Buffer.from([0xef, 0xbb, 0xbf, 0x61]));
    assert.equal(Buffer.byteLength(await readBoundedTextFile(file, 4), 'utf8'), 4);
    await writeFile(file, Buffer.from([0xff]));
    await assert.rejects(readBoundedTextFile(file, 4), (error) => error instanceof BoundedTextReadError && error.reason === 'encoding');
    await assert.rejects(readBoundedTextFile(root, 4), (error) => error instanceof BoundedTextReadError && error.reason === 'read');
    await assert.rejects(readBoundedTextFile(join(root, 'missing'), 4), (error) => error instanceof BoundedTextReadError && error.reason === 'read');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('regular file reads decode like readFile utf8 and reject FIFOs, devices and directories without blocking', async () => {
  const root = await mkdtemp(join(tmpdir(), 'isthmus-regular-text-'));
  try {
    const file = join(root, 'input.json');
    // readFile(path, 'utf8')와 같은 디코딩이어야 문서·sha256이 CLI와 같다: BOM 보존, 잘못된·잘린 바이트는 U+FFFD.
    for (const bytes of [Buffer.from('{"a":"가"}'), Buffer.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d]),
      Buffer.from([0x22, 0xff, 0x22]), Buffer.from([0x22, 0xe3, 0x81, 0x22]), Buffer.alloc(0)]) {
      await writeFile(file, bytes);
      assert.equal(await readRegularTextFile(file), await readFile(file, 'utf8'));
    }
    const fifo = join(root, 'pipe.json');
    assert.equal(spawnSync('mkfifo', [fifo]).status, 0);
    for (const path of [fifo, '/dev/null', root, join(root, 'missing')]) {
      await assert.rejects(readRegularTextFile(path), (error) => error instanceof BoundedTextReadError && error.reason === 'read');
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
