import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, truncate, writeFile } from 'node:fs/promises';
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

test('regular file reads reject before reading only files whose bytes must decode past the caller limit', async () => {
  const root = await mkdtemp(join(tmpdir(), 'isthmus-regular-limit-'));
  try {
    const file = join(root, 'input.json');
    const isLimit = (error: unknown) => error instanceof BoundedTextReadError && error.reason === 'limit';
    // 3바이트 문자 4개(12바이트)는 UTF-16 4단위다. 바이트가 상한의 3배와 같으면 디코딩해도 상한 안일 수 있으므로 읽는다.
    await writeFile(file, '가나다라');
    assert.equal(await readRegularTextFile(file, 4), '가나다라');
    // 잘린 다중 바이트 순서도 3바이트 안에서 U+FFFD 하나라 같은 경계다: 12바이트 → 4단위.
    await writeFile(file, Buffer.from([0xf0, 0x90, 0x80, 0xf0, 0x90, 0x80, 0xf0, 0x90, 0x80, 0xf0, 0x90, 0x80]));
    assert.equal(await readRegularTextFile(file, 4), '�'.repeat(4));
    // 한 바이트라도 더 많으면 어떻게 디코딩해도 4단위를 넘는다 — 읽지 않고 limit이다.
    await writeFile(file, '가나다라!');
    await assert.rejects(readRegularTextFile(file, 4), isLimit);
    // 상한을 주지 않으면 지금처럼 전부 읽는다. 크기 판정은 호출부의 길이 검사다.
    assert.equal(await readRegularTextFile(file), '가나다라!');
    // 디스크를 쓰지 않는 희소 파일로 문서 상한(UTF-16 16Mi)의 3배를 1바이트 넘긴다. 내용을 읽지 않고 거부한다.
    const sparse = join(root, 'sparse.json');
    await writeFile(sparse, '');
    await truncate(sparse, 3 * 16 * 1024 * 1024 + 1);
    await assert.rejects(readRegularTextFile(sparse, 16 * 1024 * 1024), isLimit);
  } finally { await rm(root, { recursive: true, force: true }); }
});
