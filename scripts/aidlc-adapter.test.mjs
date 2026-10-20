import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { buildAidlcPlugin } from './build-aidlc-plugin.mjs';

const root = await mkdtemp(join(tmpdir(), 'isthmus-aidlc-test-'));
const plugin = await buildAidlcPlugin(join(root, 'isthmus-evidence'));
const workerPath = join(plugin, 'tools/aidlc-sensor-isthmus-task.ts');
const worker = await import(pathToFileURL(workerPath));
const task = execFileSync(process.execPath, ['dist/cli/main.js', 'task', 'fixtures/trace/context-relation.json', '--limit', '1', '--compact'], { encoding: 'utf8' });
const output = join(root, 'plan.md'), sidecar = `${output}.isthmus-task.json`;
const args = ['--stage', 'delivery-planning', '--output-path', output];

test.after(async () => {
  assert.ok(resolve(root).startsWith(resolve(tmpdir())));
  await rm(root, { recursive: true, force: true });
});

test('assembled plugin reuses exact compiled adapter and existing bounded reader', async () => {
  for (const name of ['report/aidlc-task', 'cli/bounded-text-file']) {
    assert.deepEqual(await readFile(join(plugin, 'tools', `${name.split('/').pop()}.js`)), await readFile(`dist/${name}.js`));
  }
  await assert.rejects(buildAidlcPlugin(plugin));
});

test('actual Node worker emits a non-pass sensor JSON with the original task and byte digest', async () => {
  await writeFile(sidecar, task);
  const result = JSON.parse(execFileSync(process.execPath, [workerPath, ...args], { encoding: 'utf8' }));
  assert.equal(result.pass, false);
  assert.deepEqual(result.task, JSON.parse(task));
  assert.equal(result.sourceSha256, createHash('sha256').update(task).digest('hex'));
  assert.ok(result.states.includes('truncated'));
  assert.equal(result.findings_count, result.states.length);
});

test('missing, invalid UTF-8/JSON, directory and oversized input remain distinct non-passes', async () => {
  await rm(sidecar);
  assert.deepEqual((await worker.evaluate(args)).states, ['unavailable']);
  for (const bytes of [Buffer.from([0xff]), Buffer.from('{')]) {
    await writeFile(sidecar, bytes);
    assert.deepEqual((await worker.evaluate(args)).states, ['malformed']);
  }
  await writeFile(sidecar, Buffer.alloc(worker.MAX_TASK_BYTES + 1));
  assert.deepEqual((await worker.evaluate(args)).states, ['truncated']);
  await rm(sidecar); await mkdir(sidecar);
  assert.deepEqual((await worker.evaluate(args)).states, ['unavailable']);
  await rm(sidecar, { recursive: true });
});

test('invalid flags, custom reader bounds and upstream timeout never silently pass', async () => {
  for (const value of [[], [...args, '--stage', 'build-and-test'], ['--stage', 'other', '--output-path', output],
    [...args, '--unknown', 'x'], ['--stage'], ['--stage', 'delivery-planning']]) {
    assert.deepEqual((await worker.evaluate(value)).states, ['malformed']);
  }
  const timeout = Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
  assert.deepEqual((await worker.evaluate(args, async () => { throw timeout; })).states, ['timeout']);
  assert.deepEqual((await worker.evaluate(args, async () => 'x'.repeat(worker.MAX_TASK_BYTES + 1))).states, ['truncated']);
  assert.deepEqual((await worker.evaluate(args, async () => undefined)).states, ['truncated']);
});
