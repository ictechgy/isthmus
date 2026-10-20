import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { captureKartographEvidence } from './capture-kartograph-evidence.mjs';

async function fixture(action, changes = {}) {
  const root = await mkdtemp(join(tmpdir(), 'isthmus-kartograph-double-'));
  try {
    const fake = join(root, 'fake.mjs'), source = join(root, 'source.txt'), snapshot = join(root, 'snapshot.json');
    await copyFile(new URL('./fixtures/kartograph-capture/fake-producer.mjs', import.meta.url), fake);
    await writeFile(source, 'source');
    await writeFile(snapshot, JSON.stringify({ toolVersion: '0.25.1', provenance: { witnesses: [{}] } }));
    const control = { project: root, source, snapshot, ...changes };
    await writeFile(join(root, 'control.json'), JSON.stringify(control));
    const config = { format: 'isthmus-kartograph-capture', version: 1, command: [process.execPath, fake, join(root, 'control.json')],
      runtimeFiles: [fake], project: root, snapshot, output: join(root, 'capture'), scope: 'fixture:main' };
    await action(config, control);
  } finally {
    assert.equal(dirname(root), resolve(tmpdir()));
    await rm(root, { recursive: true, force: true });
  }
}

test('double tests process/byte binding; it does not establish an actual compiler lifecycle', async () => {
  await fixture(async config => {
    const result = await captureKartographEvidence(config);
    assert.equal(result.nativeAtCapture, 'matched');
    assert.equal(result.receipt.artifacts.length, 2);
    assert.equal(result.receipt.stableSnapshot, true);
    assert.equal(JSON.parse(await readFile(join(result.output, 'receipt.json'), 'utf8')).producer.version, '0.25.1');
    await assert.rejects(captureKartographEvidence(config), /EEXIST/);
  });
});

test('native stale/unknown and snapshot replacement survive the capture wrapper', async () => {
  await fixture(async (config, control) => {
    await writeFile(control.source, 'change');
    const result = await captureKartographEvidence(config);
    assert.equal(result.nativeAtCapture, 'stale');
    assert.deepEqual(result.receipt.after.reasons, ['changed-sources']);
  });
  await fixture(async config => assert.equal((await captureKartographEvidence(config)).nativeAtCapture, 'unverified'), { unknown: true });
  await fixture(async config => assert.equal((await captureKartographEvidence(config)).nativeAtCapture, 'stale'), { mutateSnapshot: true });
});

test('failed native commands never write a completed receipt', async () => {
  await fixture(async config => {
    await assert.rejects(captureKartographEvidence(config), /verify-snapshot failed/);
    await assert.rejects(stat(join(config.output, 'receipt.json')));
  }, { failAt: 'verify-snapshot' });
});

test('capture config rejects implicit executables and malformed input without running the producer', async () => {
  for (const value of [null, {}, { format: 'isthmus-kartograph-capture', version: 2 }]) {
    await assert.rejects(captureKartographEvidence(value), /configuration/);
  }
  await fixture(async config => {
    await assert.rejects(captureKartographEvidence({ ...config, command: ['java'] }), /absolute/);
    await assert.rejects(captureKartographEvidence({ ...config, scope: '../bad' }), /configuration/);
  });
});
