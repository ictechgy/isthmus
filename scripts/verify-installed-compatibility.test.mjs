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