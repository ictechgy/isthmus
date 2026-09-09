import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const verifier = fileURLToPath(
  new URL('../scripts/verify-limitation-scopes.mjs', import.meta.url),
);

test('limitationScopes 검증은 필수 도구가 없으면 사용법 오류를 낸다', () => {
  const result = spawnSync(process.execPath, [verifier], { encoding: 'utf8' });

  assert.equal(result.status, 64);
  assert.equal(
    result.stderr,
    'Usage: verify-limitation-scopes.mjs '
      + '<cartograph-bin> <dartograph-bin> [isthmus-js]\n',
  );
});

test('limitationScopes dogfood는 스코프를 모르는 cartograph 버전을 거부한다', async () => {
  const root = await mkdtemp(join(tmpdir(), 'isthmus-limitation-scopes-test-'));
  try {
    const cartograph = join(root, 'cartograph.mjs');
    const dartograph = join(root, 'dartograph.mjs');
    const isthmus = join(root, 'isthmus.mjs');
    await Promise.all([
      writeExecutable(
        cartograph,
        "#!/usr/bin/env node\nprocess.stdout.write('0.8.2');\n",
      ),
      writeExecutable(
        dartograph,
        "#!/usr/bin/env node\nprocess.stdout.write('dartograph 0.1.1');\n",
      ),
      writeFile(
        isthmus,
        "if (process.argv[2] === '--version') process.stdout.write('0.2.0');\n",
      ),
    ]);

    const result = spawnSync(
      process.execPath,
      [verifier, cartograph, dartograph, isthmus],
      { encoding: 'utf8' },
    );

    assert.equal(result.status, 1);
    assert.equal(result.stderr.includes('cartograph version'), true);
    assert.equal(result.stderr.includes(root), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function writeExecutable(path: string, source: string) {
  await writeFile(path, source, { mode: 0o700 });
  await chmod(path, 0o700);
}
