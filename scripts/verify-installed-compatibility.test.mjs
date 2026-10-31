import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { runChild } from './run-child.mjs';

const compatibility = JSON.parse(readFileSync('compatibility.json', 'utf8'));

test('설치 버전이 정본과 같으면 통과하고 다르면 실패한다', () => {
  const directory = mkdtempSync(join(tmpdir(), 'isthmus-version-check-'));
  try {
    const matching = join(directory, 'matching');
    const outdated = join(directory, 'outdated');
    writeFileSync(matching, `#!/bin/sh\necho "isthmus ${compatibility.isthmus}"\n`);
    writeFileSync(outdated, '#!/bin/sh\necho "isthmus 0.0.0"\n');
    chmodSync(matching, 0o755);
    chmodSync(outdated, 0o755);

    const pass = runChild(process.execPath,
      ['scripts/verify-installed-compatibility.mjs', `isthmus=${matching}`]);
    assert.equal(pass.status, 0);
    assert.match(pass.stdout, /match compatibility\.json/u);

    const fail = runChild(process.execPath,
      ['scripts/verify-installed-compatibility.mjs', `isthmus=${outdated}`]);
    assert.equal(fail.status, 1);
    assert.match(fail.stderr, /does not match compatible/u);

    const usage = runChild(process.execPath, ['scripts/verify-installed-compatibility.mjs']);
    assert.equal(usage.status, 64);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('발행 세트 선택은 소스 후보와 분리되고 불일치를 계속 거부한다', () => {
  const released = JSON.parse(readFileSync('compatibility.released.json', 'utf8'));
  const directory = mkdtempSync(join(tmpdir(), 'isthmus-released-check-'));
  try {
    const executable = join(directory, 'isthmus');
    writeFileSync(executable, `#!/bin/sh\necho "isthmus ${released.isthmus}"\n`);
    chmodSync(executable, 0o755);
    const pass = runChild(process.execPath, ['scripts/verify-installed-compatibility.mjs', '--released', `isthmus=${executable}`]);
    assert.equal(pass.status, 0, pass.stderr);
    assert.match(pass.stdout, /compatibility\.released\.json/u);
    if (released.isthmus !== compatibility.isthmus) {
      const candidate = runChild(process.execPath, ['scripts/verify-installed-compatibility.mjs', `isthmus=${executable}`]);
      assert.equal(candidate.status, 1);
    }
    writeFileSync(executable, '#!/bin/sh\necho "isthmus 0.0.0"\n');
    const wrong = runChild(process.execPath, ['scripts/verify-installed-compatibility.mjs', '--released', `isthmus=${executable}`]);
    assert.equal(wrong.status, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
