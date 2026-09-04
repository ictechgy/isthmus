import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const mainPath = fileURLToPath(new URL('./main.ts', import.meta.url));
const dartPath = fileURLToPath(
  new URL('../../experiments/phase-0/expected/dart.json', import.meta.url),
);
const swiftPath = fileURLToPath(
  new URL('../../experiments/phase-0/expected/swift.json', import.meta.url),
);
const checkPath = fileURLToPath(
  new URL('../../experiments/phase-0/expected/check.json', import.meta.url),
);
const queryPath = fileURLToPath(
  new URL('../../experiments/phase-0/expected/query.json', import.meta.url),
);

test('실제 CLI 프로세스가 check JSON을 stdout으로 출력한다', async () => {
  const { stdout, stderr } = await execFileAsync(process.execPath, [
    mainPath,
    'check',
    dartPath,
    swiftPath,
  ]);

  assert.equal(stderr, '');
  assert.equal(JSON.parse(stdout).format, 'isthmus-check');
  assert.equal(stdout, await readFile(checkPath, 'utf8'));
});

test('실제 CLI 프로세스가 cartograph 보존 JSON을 출력한다', async () => {
  const { stdout, stderr } = await execFileAsync(process.execPath, [
    mainPath,
    'retentions',
    dartPath,
    swiftPath,
    '--for',
    'cartograph',
  ]);

  assert.equal(stderr, '');
  const document = JSON.parse(stdout);
  assert.equal(document.format, 'external-retentions');
  assert.equal(document.retentions.length, 1);
});

test('실제 CLI 프로세스가 bridge query JSON을 출력한다', async () => {
  const { stdout, stderr } = await execFileAsync(process.execPath, [
    mainPath,
    'query',
    'takePhoto',
    dartPath,
    swiftPath,
  ]);

  assert.equal(stderr, '');
  const document = JSON.parse(stdout);
  assert.equal(document.status, 'found');
  assert.equal(document.result.subject.kind, 'method');
  assert.equal(stdout, await readFile(queryPath, 'utf8'));
});

test('실제 CLI 프로세스가 Mermaid 경계 그래프를 출력한다', async () => {
  const { stdout, stderr } = await execFileAsync(process.execPath, [
    mainPath,
    'graph',
    dartPath,
    swiftPath,
    '--format',
    'mermaid',
  ]);

  assert.equal(stderr, '');
  assert.equal(stdout.startsWith('flowchart LR\n'), true);
  assert.equal(stdout.includes('method dev.isthmus/camera#takePhoto'), true);
});
