import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readBoundedTextFile, BoundedTextReadError } from './bounded-text-file.ts';

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
