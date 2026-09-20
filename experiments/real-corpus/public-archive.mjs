import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runChild } from '../../scripts/run-child.mjs';

/** 공개 RN 아카이브는 버전·해시를 고정하고 실행 코드 없이 소스만 해제한다. */
export async function fetchPinnedPackage(definition, work) {
  assert.match(definition.package, /^[a-z0-9][a-z0-9._-]*$/);
  assert.match(definition.version, /^\d+\.\d+\.\d+$/);
  const id = `${definition.package}-${definition.version}`;
  const archive = join(work, `${id}.tgz`);
  const target = join(work, id);
  const download = runChild('curl', ['-fsSL', '--retry', '3', '-o', archive, '--', definition.archiveUrl], { timeout: 120_000 });
  assert.equal(download.status, 0, `archive download failed: ${id}`);
  assert.equal(createHash('sha256').update(await readFile(archive)).digest('hex'), definition.sha256,
    `archive sha256 mismatch: ${id}`);
  const listing = runChild('tar', ['-tzf', archive], { timeout: 60_000 });
  assert.equal(listing.status, 0, `archive listing failed: ${id}`);
  for (const member of listing.stdout.split('\n').filter(Boolean)) {
    assert.ok(member.startsWith('package/') && !member.split('/').includes('..'), `unsafe archive member: ${id}`);
  }
  const types = runChild('tar', ['-tvzf', archive], { timeout: 60_000 });
  assert.equal(types.status, 0, `archive member types failed: ${id}`);
  const members = types.stdout.split('\n').filter(Boolean);
  assert.ok(members.length > 0 && members.every((line) => /^[d-]/.test(line)),
    `archive must contain only ordinary files and directories: ${id}`);
  await mkdir(target);
  const extracted = runChild('tar', ['-xzf', archive, '-C', target], { timeout: 120_000 });
  assert.equal(extracted.status, 0, `archive extract failed: ${id}`);
  return join(target, 'package');
}
