import assert from 'node:assert/strict';
import { mkdtemp, writeFile, cp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { writeEvidenceManifest, verifyEvidenceManifest } from './runtime-evidence-manifest.mjs';

test('evidence survives relocation while missing, changed and added raw files are rejected', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rn-evidence-test-'));
  const copy = root + '-copy';
  try {
    await writeFile(join(root, 'runtime.json'), '{"status":"passed"}');
    const expected = await writeEvidenceManifest(root);
    await cp(root, copy, { recursive: true });
    assert.deepEqual(await verifyEvidenceManifest(copy), expected);
    await writeFile(join(copy, 'verification.json'), '{"summary":"separate"}');
    assert.deepEqual(await verifyEvidenceManifest(copy), expected);
    await writeFile(join(copy, 'runtime.json'), '{"status":"failed"}');
    await assert.rejects(verifyEvidenceManifest(copy), /differs/);
    await rm(join(copy, 'runtime.json'));
    await assert.rejects(verifyEvidenceManifest(copy), /differs/);
    await writeFile(join(copy, 'runtime.json'), '{"status":"passed"}');
    await writeFile(join(copy, 'extra.log'), 'unexpected');
    await assert.rejects(verifyEvidenceManifest(copy), /differs/);
  } finally { await rm(root, { recursive: true, force: true }); await rm(copy, { recursive: true, force: true }); }
});

test('evidence manifest does not follow a link to unrelated files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rn-evidence-link-'));
  try {
    await writeFile(join(root, 'original'), 'original');
    await symlink('original', join(root, 'alias'));
    await assert.rejects(writeEvidenceManifest(root), /symbolic/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
