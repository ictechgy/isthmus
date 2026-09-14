import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { buildToolchain, parseToolchainManifest } from './build-preflight-toolchain.mjs';

const manifest = (root) => ({ format: 'isthmus-toolchain-build', version: 1, destination: join(root, 'built'),
  repositories: Object.fromEntries(['isthmus', 'cartograph', 'dartograph'].map((name) => [name,
    { path: root, revision: 'a'.repeat(40) }])) });

test('도구 구축은 세 저장소의 고정 commit과 별도 출력 경로를 요구한다', () => {
  const value = parseToolchainManifest(manifest('/test'));
  assert.equal(value.repositories.cartograph.revision, 'a'.repeat(40));
  for (const input of [null, { ...manifest('/test'), version: 2 },
    { ...manifest('/test'), destination: '' },
    { ...manifest('/test'), repositories: { ...manifest('/test').repositories, cartograph: { path: '/test', revision: 'main' } } },
    { ...manifest('/test'), repositories: { isthmus: manifest('/test').repositories.isthmus } },
  ]) assert.throws(() => parseToolchainManifest(input));
});

test('Android 도구 구축은 Swift 저장소 없이 Kotlin producer를 선택할 수 있다', () => {
  const original = manifest('/test');
  const { cartograph, ...required } = original.repositories;
  const android = parseToolchainManifest({ ...original, repositories: { ...required, kartograph: cartograph } });
  assert.equal(android.repositories.cartograph, undefined);
  assert.equal(android.repositories.kartograph.revision, 'a'.repeat(40));
  assert.throws(() => parseToolchainManifest({ ...original, repositories: required }), /native|producer/i);
  const both = parseToolchainManifest({ ...original, repositories: { ...original.repositories, kartograph: cartograph } });
  assert.ok(both.repositories.cartograph && both.repositories.kartograph);
});

test('기존 destination을 덮어쓰거나 실패 정리로 지우지 않는다', async () => {
  const root = await mkdtemp(join(tmpdir(), 'isthmus-toolchain-existing-'));
  try {
    const sentinel = join(root, 'keep.txt');
    await writeFile(sentinel, 'existing content');
    await assert.rejects(() => buildToolchain({ ...manifest(root), destination: root }), /already exists/u);
    assert.equal(await readFile(sentinel, 'utf8'), 'existing content');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('존재하지 않는 commit은 SDK 빌드 전에 거부하고 원본을 수정하지 않는다', async () => {
  const root = await mkdtemp(join(tmpdir(), 'isthmus-toolchain-ref-'));
  try {
    execFileSync('git', ['-c', 'core.hooksPath=/dev/null', 'init', '-q', root]);
    const sentinel = join(root, 'uncommitted.txt');
    await writeFile(sentinel, 'must not enter a committed build');
    await assert.rejects(() => buildToolchain(manifest(root)), /commit/u);
    assert.equal(await readFile(sentinel, 'utf8'), 'must not enter a committed build');
    assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(), '?? uncommitted.txt');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('잘못된 JSON 오류는 manifest 원문을 노출하지 않는다', async () => {
  const root = await mkdtemp(join(tmpdir(), 'isthmus-toolchain-json-'));
  try {
    const path = join(root, 'invalid.json');
    await writeFile(path, 'PRIVATE');
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./build-preflight-toolchain.mjs', import.meta.url)), path], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.ok(!result.stderr.includes('PRIVATE'));
    assert.match(result.stderr, /not valid JSON/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});
