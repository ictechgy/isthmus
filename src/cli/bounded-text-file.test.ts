import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  type BoundedFileSystem,
  type BoundedReadHandle,
  BoundedTextReadError,
  nodeBoundedFileSystem,
  readBoundedTextFile,
  readRegularFileBytes,
  readRegularTextFile,
} from './bounded-text-file.ts';

/** 거부 원인이 기대한 분류인지 보는 assert.rejects 판정기다. */
const rejectsWith = (reason: BoundedTextReadError['reason']) =>
  (error: unknown) => error instanceof BoundedTextReadError && error.reason === reason;

/** 실제 파일시스템을 쓰되 열기·읽기 호출을 기록하는 경계다. 열기 전 거부와 읽지 않은 거부를 확인한다. */
function recordingFileSystem() {
  const opened: string[] = [];
  let reads = 0;
  const fileSystem: BoundedFileSystem = {
    stat: (path) => nodeBoundedFileSystem.stat(path),
    open: async (path) => {
      opened.push(path);
      const handle = await nodeBoundedFileSystem.open(path);
      return {
        stat: () => handle.stat(),
        read: (buffer, offset, length, position) => { reads += 1; return handle.read(buffer, offset, length, position); },
        close: () => handle.close(),
      };
    },
  };
  return { fileSystem, opened, reads: () => reads };
}

/**
 * fstat 크기보다 많은 바이트를 주는 가짜 핸들이다. 읽는 중 커지는 파일을 시간에 기대지 않고 흉내 낸다.
 *
 * @param statSize fstat이 알리는 크기다.
 * @param contentBytes 실제로 읽어 줄 바이트 수다('a').
 */
function growingFile(statSize: number, contentBytes: number) {
  let position = 0;
  const requested: number[] = [];
  let closed = false;
  const handle: BoundedReadHandle = {
    stat: async () => ({ isFile: () => true, size: statSize }),
    read: async (buffer, offset, length) => {
      requested.push(length);
      const count = Math.min(length, contentBytes - position);
      buffer.fill(0x61, offset, offset + count);
      position += count;
      return { bytesRead: count };
    },
    close: async () => { closed = true; },
  };
  const fileSystem: BoundedFileSystem = { stat: async () => ({ isFile: () => true }), open: async () => handle };
  return { fileSystem, requested, closed: () => closed };
}

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
      assert.equal(await readRegularTextFile(file, 1024), await readFile(file, 'utf8'));
    }
    const fifo = join(root, 'pipe.json');
    assert.equal(spawnSync('mkfifo', [fifo]).status, 0);
    for (const path of [fifo, '/dev/null', root, join(root, 'missing')]) {
      await assert.rejects(readRegularTextFile(path, 1024), (error) => error instanceof BoundedTextReadError && error.reason === 'read');
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
    // 디스크를 쓰지 않는 희소 파일로 문서 상한(UTF-16 16Mi)의 3배를 1바이트 넘긴다. 내용을 읽지 않고 거부한다.
    const sparse = join(root, 'sparse.json');
    await writeFile(sparse, '');
    await truncate(sparse, 3 * 16 * 1024 * 1024 + 1);
    await assert.rejects(readRegularTextFile(sparse, 16 * 1024 * 1024), isLimit);
    const recorded = recordingFileSystem();
    await assert.rejects(readRegularFileBytes(sparse, 3 * 16 * 1024 * 1024, recorded.fileSystem), isLimit);
    assert.equal(recorded.reads(), 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('regular file reads equal readFile utf8 across both readers\' chunk boundaries and malformed bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'isthmus-regular-decode-'));
  try {
    const file = join(root, 'input.json');
    const ascii = (count: number) => Buffer.alloc(count, 0x61);
    // 경계 리더는 64 KiB 청크로, readFile(path, 'utf8')은 512 KiB 청크로 읽는다. 두 경계를 걸치는 다중 바이트 문자,
    // 경계에서 잘린 순서, 경계 앞뒤의 BOM·잘못된 바이트가 모두 같은 문자열로 디코딩되어야 한다(다 모은 뒤 한 번 디코딩).
    const cases = [
      Buffer.concat([ascii(64 * 1024 - 1), Buffer.from('가나'), ascii(3)]),
      Buffer.concat([ascii(64 * 1024 - 2), Buffer.from('😀'), ascii(3)]),
      Buffer.concat([ascii(64 * 1024 - 1), Buffer.from([0xe3, 0x81, 0x22, 0xf0, 0x90])]),
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), ascii(512 * 1024 - 4), Buffer.from('가'), ascii(2)]),
      Buffer.concat([ascii(512 * 1024 - 1), Buffer.from([0xf0, 0x90, 0x80, 0x22, 0xed, 0xa0, 0x80, 0xc0, 0xaf])]),
      malformedBytes(1024 * 1024 + 4099),
    ];
    for (const [index, bytes] of cases.entries()) {
      await writeFile(file, bytes);
      assert.equal(await readRegularTextFile(file, bytes.length), await readFile(file, 'utf8'), `case ${index}`);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('the shared reader refuses non-regular paths before opening them and follows links to regular files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'isthmus-regular-open-'));
  try {
    const fifo = join(root, 'pipe.json');
    assert.equal(spawnSync('mkfifo', [fifo]).status, 0);
    const file = join(root, 'input.json');
    await writeFile(file, '{"a":1}');
    const fileLink = join(root, 'file-link.json');
    const fifoLink = join(root, 'fifo-link.json');
    await symlink(file, fileLink);
    await symlink(fifo, fifoLink);
    // FIFO 열기는 반대쪽을 기다릴 수 있고 장치는 열기만으로 부작용이 있을 수 있다 — 일반 파일이 아니면 열지 않는다.
    for (const path of [fifo, fifoLink, '/dev/null', '/dev/zero', root, join(root, 'missing')]) {
      const recorded = recordingFileSystem();
      await assert.rejects(readRegularFileBytes(path, 1024, recorded.fileSystem), rejectsWith('read'), path);
      assert.deepEqual(recorded.opened, [], path);
    }
    const recorded = recordingFileSystem();
    assert.equal((await readRegularFileBytes(fileLink, 1024, recorded.fileSystem)).toString('utf8'), '{"a":1}');
    assert.deepEqual(recorded.opened, [fileLink]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('the shared reader stops at cap+1 bytes when the file grows after fstat and still closes the handle', async () => {
  // fstat은 빈 파일이라 했지만 읽으면 1 MiB가 나온다. 상한 200 KiB면 정확히 상한+1 바이트까지만 요청하고 limit이다.
  const maximumBytes = 200 * 1024;
  const grown = growingFile(0, 1024 * 1024);
  await assert.rejects(readRegularFileBytes('/virtual/grown.json', maximumBytes, grown.fileSystem), rejectsWith('limit'));
  assert.equal(grown.requested.reduce((sum, length) => sum + length, 0), maximumBytes + 1);
  assert.ok(grown.requested.every((length) => length <= 64 * 1024));
  assert.equal(grown.closed(), true);
  // 상한과 같은 바이트까지만 커졌으면 끝(0바이트 읽기)을 확인하고 그대로 돌려준다.
  const exact = growingFile(0, maximumBytes);
  assert.equal((await readRegularFileBytes('/virtual/exact.json', maximumBytes, exact.fileSystem)).length, maximumBytes);
  assert.equal(exact.closed(), true);
  // fstat 크기가 이미 상한을 넘으면 한 바이트도 읽지 않는다.
  const large = growingFile(maximumBytes + 1, maximumBytes + 1);
  await assert.rejects(readRegularFileBytes('/virtual/large.json', maximumBytes, large.fileSystem), rejectsWith('limit'));
  assert.deepEqual(large.requested, []);
  assert.equal(large.closed(), true);
  // 연 핸들이 일반 파일이 아니면(stat과 열기 사이에 바뀐 경로) 읽지 않고 read다.
  const swapped: BoundedReadHandle = { stat: async () => ({ isFile: () => false, size: 0 }),
    read: async () => { throw new Error('must not read'); }, close: async () => {} };
  await assert.rejects(readRegularFileBytes('/virtual/swapped.json', maximumBytes,
    { stat: async () => ({ isFile: () => true }), open: async () => swapped }), rejectsWith('read'));
});

test('the shared reader reports open and read errors as read failures without their messages and closes the handle', async () => {
  const regular = async () => ({ isFile: () => true });
  // 권한 같은 열기 실패와 읽는 중 I/O 오류는 원문(경로가 들 수 있다) 대신 read로만 알린다.
  await assert.rejects(readRegularFileBytes('/virtual/denied.json', 1024,
    { stat: regular, open: async () => { throw new Error('EACCES: /virtual/denied.json'); } }), rejectsWith('read'));
  let closed = false;
  const failing: BoundedReadHandle = { stat: async () => ({ isFile: () => true, size: 10 }),
    read: async () => { throw new Error('EIO: /virtual/broken.json'); }, close: async () => { closed = true; } };
  await assert.rejects(readRegularFileBytes('/virtual/broken.json', 1024, { stat: regular, open: async () => failing }),
    (error) => rejectsWith('read')(error) && !String(error).includes('/virtual/'));
  assert.equal(closed, true);
});

test('both text readers share the bounded read and differ only in decoding', async () => {
  const root = await mkdtemp(join(tmpdir(), 'isthmus-readers-'));
  try {
    const fifo = join(root, 'pipe.json');
    assert.equal(spawnSync('mkfifo', [fifo]).status, 0);
    const file = join(root, 'input.json');
    // CLI 리더의 상한은 UTF-16 길이, navigation 리더의 상한은 바이트다. 같은 바이트 상한(3×길이)이면 같게 판정한다.
    const maximumLength = 8;
    const maximumBytes = 3 * maximumLength;
    const outcome = async (read: () => Promise<string>) => {
      try { return { text: await read() }; } catch (error) {
        assert.ok(error instanceof BoundedTextReadError);
        return { reason: error.reason };
      }
    };
    const inputs: Array<[string, Buffer | undefined]> = [
      ['valid', Buffer.from('﻿{"가":"😀"}')], ['exact', Buffer.alloc(maximumBytes, 0x20)],
      ['over', Buffer.alloc(maximumBytes + 1, 0x20)], ['fifo', undefined], ['device', undefined], ['directory', undefined],
    ];
    for (const [name, bytes] of inputs) {
      const path = name === 'fifo' ? fifo : name === 'device' ? '/dev/null' : name === 'directory' ? root : file;
      if (bytes !== undefined) await writeFile(file, bytes);
      assert.deepEqual(await outcome(() => readRegularTextFile(path, maximumLength)),
        await outcome(() => readBoundedTextFile(path, maximumBytes)), name);
    }
    // 디코딩만 다르다: CLI 리더는 readFile처럼 U+FFFD로 바꾸고, navigation 리더는 잘못된 UTF-8을 encoding으로 거부한다.
    await writeFile(file, Buffer.from([0x22, 0xff, 0x22]));
    assert.deepEqual(await outcome(() => readRegularTextFile(file, maximumLength)), { text: '"�"' });
    assert.deepEqual(await outcome(() => readBoundedTextFile(file, maximumBytes)), { reason: 'encoding' });
  } finally { await rm(root, { recursive: true, force: true }); }
});

/**
 * UTF-8 선두·연속 바이트와 ASCII가 섞인 결정적 바이트열이다. 잘못된·잘린 순서가 청크 경계 곳곳에 걸리게 한다.
 *
 * @param length 만들 바이트 수다.
 */
function malformedBytes(length: number): Buffer {
  const alphabet = [0x22, 0x41, 0x7f, 0x80, 0x8f, 0x90, 0xa0, 0xbf, 0xc0, 0xc2, 0xdf, 0xe0, 0xe3, 0xed, 0xef, 0xf0, 0xf4, 0xf5, 0xff, 0xbb];
  const bytes = Buffer.alloc(length);
  let seed = 20261020;
  for (let index = 0; index < length; index += 1) {
    seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
    bytes[index] = alphabet[seed % alphabet.length]!;
  }
  return bytes;
}
