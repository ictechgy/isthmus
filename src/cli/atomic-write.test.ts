import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { writeTextAtomically } from './atomic-write.ts';

test('원자 쓰기는 대상을 교체하고 임시 파일을 남기지 않는다', async () => {
  const root = await mkdtemp(join(tmpdir(), 'isthmus-atomic-write-'));
  try {
    const target = join(root, 'baseline.json');
    await writeTextAtomically(target, 'first');
    await writeTextAtomically(target, 'second');

    assert.equal(await readFile(target, 'utf8'), 'second');
    assert.deepEqual(await readdir(root), ['baseline.json']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('교체에 실패하면 임시 파일만 정리한다', async () => {
  const root = await mkdtemp(join(tmpdir(), 'isthmus-atomic-write-'));
  try {
    // 대상을 비우지 않은 디렉터리로 만들어 rename이 실패하게 한다.
    const target = join(root, 'baseline.json');
    await mkdir(target);
    await writeFile(join(target, 'occupant'), 'x', { encoding: 'utf8' });

    await assert.rejects(
      () => writeTextAtomically(target, 'contents'),
    );
    assert.deepEqual(await readdir(root), ['baseline.json']);
    assert.deepEqual(await readdir(target), ['occupant']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('미리 놓인 임시 파일이 있으면 배타 생성이 실패하고 그 파일을 건드리지 않는다', async () => {
  const root = await mkdtemp(join(tmpdir(), 'isthmus-atomic-write-'));
  try {
    const target = join(root, 'baseline.json');
    const temporary = join(root, 'predicted.tmp');
    await writeFile(temporary, 'attacker', { encoding: 'utf8' });

    await assert.rejects(() =>
      writeTextAtomically(target, 'contents', () => temporary)
    );
    assert.equal(await readFile(temporary, 'utf8'), 'attacker');
    assert.deepEqual(await readdir(root), ['predicted.tmp']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('임시 이름에 심링크가 놓여 있으면 대상 파일을 덮어쓰지 않는다', async () => {
  const root = await mkdtemp(join(tmpdir(), 'isthmus-atomic-write-'));
  try {
    const victim = join(root, 'victim');
    await writeFile(victim, 'original', { encoding: 'utf8' });
    const target = join(root, 'baseline.json');
    const temporary = join(root, 'predicted.tmp');
    await symlink(victim, temporary);

    await assert.rejects(() =>
      writeTextAtomically(target, 'contents', () => temporary)
    );
    assert.equal(await readFile(victim, 'utf8'), 'original');
    // 배타 생성이 거부된 심링크는 우리 것이 아니므로 그대로 둔다.
    assert.equal(
      (await readdir(root)).includes('predicted.tmp'),
      true,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
