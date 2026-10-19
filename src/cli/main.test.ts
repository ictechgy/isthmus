import assert from 'node:assert/strict';
import { execFile, spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

test('실제 impact 프로세스가 파일 선택으로 호출 근거를 컴팩트하게 출력한다', async () => {
  const { stdout, stderr } = await execFileAsync(process.execPath, [mainPath,
    'impact', '--file', 'ios/Runner/CameraPlugin.swift', dartPath, swiftPath, '--compact']);
  const report = JSON.parse(stdout);
  assert.equal(report.status, 'observed');
  assert.ok(report.methods.some((item: { method: string }) => item.method === 'takePhoto'));
  assert.ok(report.reviewFiles.includes('lib/camera_bridge.dart'));
  assert.equal(report.complete, false);
  assert.equal(stdout.trim().split('\n').length, 1);
  assert.equal(stderr, '');
});

test('실제 런타임 CLI가 합성 기록의 선언된 기대를 검증한다', async () => {
  const fixture = (name: string) => fileURLToPath(new URL(`../../fixtures/runtime/${name}.json`, import.meta.url));
  const { stdout, stderr } = await execFileAsync(process.execPath, [mainPath, 'verify-runtime',
    '--expectations', fixture('expectations'), fixture('success'), '--strict']);
  assert.equal(JSON.parse(stdout).status, 'passed');
  assert.equal(JSON.parse(stdout).complete, false);
  assert.equal(stderr, '');
});

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

test('긴 호출 끝의 -h도 입력을 읽기 전에 명령 사용법을 출력한다', async () => {
  const { stdout, stderr } = await execFileAsync(process.execPath, [
    mainPath,
    'graph',
    dartPath,
    swiftPath,
    '--help',
  ]);

  assert.equal(stderr, '');
  assert.equal(stdout.startsWith('Usage: isthmus graph'), true);
});

test('help 명령이 명령별 사용법을 출력한다', async () => {
  const { stdout, stderr } = await execFileAsync(process.execPath, [
    mainPath,
    'help',
    'retentions',
  ]);

  assert.equal(stderr, '');
  assert.equal(stdout.startsWith('Usage: isthmus retentions'), true);
});

test('help 명령만 있으면 루트 도움말을 출력한다', async () => {
  const { stdout, stderr } = await execFileAsync(process.execPath, [
    mainPath,
    'help',
  ]);

  assert.equal(stderr, '');
  assert.equal(stdout.startsWith('Usage: isthmus <command> [options]\n'), true);
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

test('실제 CLI 프로세스가 check SARIF 로그를 stdout으로 출력한다', async () => {
  const packageDocument = JSON.parse(await readFile(packagePath, 'utf8'));
  const { stdout, stderr } = await execFileAsync(process.execPath, [
    mainPath,
    'check',
    dartPath,
    swiftPath,
    '--format',
    'sarif',
  ]);

  assert.equal(stderr, '');
  const log = JSON.parse(stdout);
  assert.equal(log.version, '2.1.0');
  assert.equal(log.runs.length, 1);
  assert.equal(log.runs[0].tool.driver.name, 'isthmus');
  assert.equal(log.runs[0].tool.driver.version, packageDocument.version);
  assert.equal(log.runs[0].results.length, 3);
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

/**
 * 실제 CLI를 마감 안에서 실행해 종료 코드와 두 스트림을 모은다. 마감을 넘기면 'blocked'다.
 *
 * FIFO 열기에 막힌 자식은 threadpool의 open()에서 멈춰 입력이 닫혀도 끝나지 않으므로, 끝나면 항상 SIGKILL로 정리한다.
 */
async function runWithDeadline(nodeArguments: readonly string[], milliseconds: number) {
  const child = spawn(process.execPath, nodeArguments, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += String(chunk); });
  child.stderr.on('data', (chunk) => { stderr += String(chunk); });
  let timer: NodeJS.Timeout | undefined;
  try {
    const deadline = new Promise<'blocked'>((resolve) => { timer = setTimeout(resolve, milliseconds, 'blocked'); });
    const outcome = await Promise.race([once(child, 'close').then(([code]) => code as number | null), deadline]);
    return outcome === 'blocked' ? outcome : { exitCode: outcome, stdout, stderr };
  } finally {
    clearTimeout(timer);
    child.kill('SIGKILL');
  }
}

test('실제 CLI는 FIFO·장치 입력을 열어 기다리지 않고 읽기 실패 2로 끝낸다', { timeout: 60_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'isthmus-cli-special-'));
  try {
    const fifo = join(root, 'pipe.json');
    assert.equal(spawnSync('mkfifo', [fifo]).status, 0);
    // 힙을 줄여 /dev/zero를 끝까지 읽던 회귀가 읽기 실패 대신 메모리 부족으로 드러나게 한다.
    for (const input of [fifo, '/dev/zero', root]) {
      assert.deepEqual(await runWithDeadline(['--max-old-space-size=32', mainPath, 'check', input, swiftPath], 15_000), {
        exitCode: 2,
        stdout: '',
        stderr: 'Unable to read bridge facts input 1; check that the file exists and is readable.\n',
      }, input);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('실제 CLI는 상한의 3배 바이트를 넘는 일반 파일을 읽지 않고 그 입력의 크기 상한 문구 2로 끝낸다', { timeout: 60_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'isthmus-cli-large-'));
  try {
    // 디스크를 쓰지 않는 희소 파일이다. 문서 하나의 상한(UTF-16 16Mi)의 3배를 1바이트 넘어 다 읽어도 상한에 걸린다.
    // 32 MiB 힙에서 통째로 읽으면 메모리 부족(134)으로 죽으므로, 읽지 않고 거부했는지가 종료 코드로 드러난다.
    const large = join(root, 'large.json');
    await writeFile(large, '');
    await truncate(large, 3 * 16 * 1024 * 1024 + 1);
    assert.deepEqual(await runWithDeadline(['--max-old-space-size=32', mainPath, 'check', large, swiftPath], 15_000), {
      exitCode: 2,
      stdout: '',
      stderr: 'Bridge facts input 1 exceeds the input size limits; split the extraction into smaller documents.\n',
    });
    assert.deepEqual(await runWithDeadline(['--max-old-space-size=32', mainPath, 'check', dartPath, swiftPath,
      '--baseline', large], 15_000), {
      exitCode: 2,
      stdout: '',
      stderr: 'The baseline file exceeds the input size limits; regenerate it with check --update-baseline.\n',
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
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
