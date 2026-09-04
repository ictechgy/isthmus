import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const verifier = fileURLToPath(
  new URL('../scripts/verify-public-flutter-plugin.mjs', import.meta.url),
);

test('공개 Flutter 플러그인 검증은 필수 도구가 없으면 사용법 오류를 낸다', () => {
  const result = spawnSync(process.execPath, [verifier], { encoding: 'utf8' });

  assert.equal(result.status, 64);
  assert.equal(
    result.stderr,
    'Usage: verify-public-flutter-plugin.mjs '
      + '<cartograph-bin> <dartograph-bin> [isthmus-js]\n',
  );
});

test('공개 dogfood는 모호한 cartograph 버전 출력을 네트워크 전에 거부한다', async () => {
  const root = await mkdtemp(join(tmpdir(), 'isthmus-public-dogfood-test-'));
  try {
    const cartograph = join(root, 'cartograph.mjs');
    const dartograph = join(root, 'dartograph.mjs');
    const isthmus = join(root, 'isthmus.mjs');
    await Promise.all([
      writeExecutable(
        cartograph,
        "#!/usr/bin/env node\nprocess.stdout.write('Java 17.0.2; 0.5.2');\n",
      ),
      writeExecutable(
        dartograph,
        "#!/usr/bin/env node\nprocess.stdout.write('dartograph 0.1.0');\n",
      ),
      writeFile(
        isthmus,
        "if (process.argv[2] === '--version') process.stdout.write('0.1.3');\n",
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
