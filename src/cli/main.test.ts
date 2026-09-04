import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
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
const packagePath = fileURLToPath(
  new URL('../../package.json', import.meta.url),
);

test('실제 CLI 프로세스가 루트 도움말을 출력한다', async () => {
  const { stdout, stderr } = await execFileAsync(process.execPath, [
    mainPath,
    '--help',
  ]);

  assert.equal(stderr, '');
  assert.equal(stdout.startsWith('Usage: isthmus <command> [options]\n'), true);
  assert.equal(stdout.includes('graph'), true);
  assert.equal(stdout.includes('retentions'), true);
});

test('실제 CLI 프로세스가 package 버전을 출력한다', async () => {
  const packageDocument = JSON.parse(await readFile(packagePath, 'utf8'));

  const { stdout, stderr } = await execFileAsync(process.execPath, [
    mainPath,
    '--version',
  ]);

  assert.equal(stderr, '');
  assert.equal(stdout, `${packageDocument.version}\n`);
});

test('실제 CLI 프로세스가 명령별 도움말을 출력한다', async () => {
  const { stdout, stderr } = await execFileAsync(process.execPath, [
    mainPath,
    'graph',
    '--help',
  ]);

  assert.equal(stderr, '');
  assert.equal(stdout.startsWith('Usage: isthmus graph'), true);
});

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

test('stdout 소비자가 먼저 닫혀도 EPIPE 스택을 출력하지 않는다', async () => {
  const child = spawn(process.execPath, [mainPath, '--help'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.destroy();
  let standardError = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    standardError += chunk;
  });

  const [exitCode, signal] = await once(child, 'close');

  assert.equal(signal, null);
  assert.equal(exitCode, 0);
  assert.equal(standardError.includes('EPIPE'), false);
});
