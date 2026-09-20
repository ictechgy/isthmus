import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { runChild } from '../../scripts/run-child.mjs';
import { fetchPinnedPackage } from './public-archive.mjs';

async function archiveFixture(context, withLink = false) {
  const root = await mkdtemp(join(tmpdir(), 'isthmus-public-archive-test-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'source');
  await mkdir(join(source, 'package'), { recursive: true });
  await writeFile(join(source, 'package', 'source.ts'), 'export const sample = 1;\n');
  if (withLink) await symlink('../../outside.txt', join(source, 'package', 'escape'));
  const archive = join(root, 'fixture.tgz');
  const result = runChild('tar', ['-czf', archive, '-C', source, 'package'], { timeout: 30_000 });
  assert.equal(result.status, 0);
  const work = join(root, 'work');
  await mkdir(work);
  return { work, definition: {
    package: 'fixture', version: '1.0.0', archiveUrl: pathToFileURL(archive).href,
    sha256: createHash('sha256').update(await readFile(archive)).digest('hex'),
  } };
}

test('a pinned ordinary archive preserves source bytes', async (context) => {
  const { work, definition } = await archiveFixture(context);
  const root = await fetchPinnedPackage(definition, work);
  assert.equal(await readFile(join(root, 'source.ts'), 'utf8'), 'export const sample = 1;\n');
});

test('a digest mismatch prevents source extraction', async (context) => {
  const { work, definition } = await archiveFixture(context);
  await assert.rejects(fetchPinnedPackage({ ...definition, sha256: '0'.repeat(64) }, work), /sha256 mismatch/);
  await assert.rejects(readFile(join(work, 'fixture-1.0.0/package/source.ts')), { code: 'ENOENT' });
});

test('even a pinned archive cannot introduce a symlink', async (context) => {
  const { work, definition } = await archiveFixture(context, true);
  const outside = join(work, 'outside.txt');
  await writeFile(outside, 'preserved');
  await assert.rejects(fetchPinnedPackage(definition, work), /ordinary files and directories/);
  assert.equal(await readFile(outside, 'utf8'), 'preserved');
  await assert.rejects(readFile(join(work, 'fixture-1.0.0/package/source.ts')), { code: 'ENOENT' });
});
