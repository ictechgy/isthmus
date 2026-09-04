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
