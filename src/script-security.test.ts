import assert from 'node:assert/strict';
import { access, chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const verifier = fileURLToPath(
  new URL('../scripts/verify-cartograph-roundtrip.mjs', import.meta.url),
);

test('왕복 검증은 두 실제 producer 출력을 isthmus와 cartograph에 전달한다', async () => {
  const fixture = await makeFixture();
  try {
    const result = runVerifier(fixture, '0.5.3');

    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      result.stdout,
      'Cartograph and dartograph retention roundtrip verified.\n',
    );
    await access(join(fixture.root, 'cartograph-bridges.called'));
    await access(join(fixture.root, 'dartograph-bridges.called'));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('필수 기능 이전 cartograph 바이너리는 경로 노출 없이 거부한다', async () => {
  const fixture = await makeFixture();
  try {
    const result = runVerifier(fixture, '0.5.2');

    assert.equal(result.status, 1);
    assert.equal(
      result.stderr.includes('Cartograph roundtrip failed: cartograph version'),
      true,
    );
    assert.equal(result.stderr.includes(fixture.root), false);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

function runVerifier(
  fixture: Awaited<ReturnType<typeof makeFixture>>,
  cartographVersion: string,
) {
  return spawnSync(
    process.execPath,
    [
      verifier,
      fixture.cartograph,
      fixture.dartograph,
      fixture.root,
      fixture.isthmus,
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        FAKE_CARTOGRAPH_VERSION: cartographVersion,
        FAKE_MARKER_DIRECTORY: fixture.root,
      },
    },
  );
}

async function makeFixture() {
  const root = await mkdtemp(join(tmpdir(), 'isthmus-producer-roundtrip-'));
  const cartograph = join(root, 'cartograph.mjs');
  const dartograph = join(root, 'dartograph.mjs');
  const isthmus = join(root, 'isthmus.mjs');
  await Promise.all([
    writeExecutable(cartograph, fakeCartograph),
    writeExecutable(dartograph, fakeDartograph),
    writeFile(isthmus, fakeIsthmus, { mode: 0o600 }),
  ]);
  return { root, cartograph, dartograph, isthmus };
}

async function writeExecutable(path: string, source: string) {
  await writeFile(path, source, { mode: 0o700 });
  await chmod(path, 0o700);
}

const fakeCartograph = `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
const args = process.argv.slice(2);
if (args[0] === '--version') {
  process.stdout.write(process.env.FAKE_CARTOGRAPH_VERSION ?? '0.5.3');
} else if (args[0] === 'bridges') {
  writeFileSync(join(process.env.FAKE_MARKER_DIRECTORY, 'cartograph-bridges.called'), '');
  const project = args[args.indexOf('--project') + 1];
  process.stdout.write(JSON.stringify({
    format: 'bridge-facts', version: 1,
    tool: { name: 'cartograph', version: '0.5.3' },
    generatedAt: '2026-09-05T00:00:00.000Z', platform: 'swift', target: 'flutter', project,
    facts: [
      { kind: 'channel-register', channel: 'com.example/camera', dynamic: false,
        location: { path: 'Sources/Camera.swift', line: 3, column: 1 } },
      { kind: 'method-handle', channel: 'com.example/camera', method: 'takePhoto', dynamic: false,
        location: { path: 'Sources/Camera.swift', line: 5, column: 1 },
        symbol: { qualifiedName: 'Camera.handle', usr: 's:Camera.handle' } }
    ], limitations: []
  }));
} else if (args[0] === 'dead' && args.includes('--explain')) {
  process.stdout.write("evidence: dart lib/camera.dart:5 invokes 'takePhoto' on channel 'com.example/camera'\\n");
} else if (args[0] === 'dead') {
  const retained = args.includes('--external-retentions');
  process.stdout.write(JSON.stringify({ diagnostics: retained ? [] : [
    { ruleIdentifier: 'unused-symbol', message: "class 'Corpus.CameraBridge' is never used" }
  ] }));
} else {
  process.exitCode = 64;
}
`;

const fakeDartograph = `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
const args = process.argv.slice(2);
if (args[0] === '--version') {
  process.stdout.write('0.1.0');
} else if (args[0] === 'bridges') {
  writeFileSync(join(process.env.FAKE_MARKER_DIRECTORY, 'dartograph-bridges.called'), '');
  const project = args.at(-1);
  process.stdout.write(JSON.stringify({
    format: 'bridge-facts', version: 1,
    tool: { name: 'dartograph', version: '0.1.0' },
    generatedAt: '2026-09-05T00:00:00.000Z', platform: 'dart', target: 'flutter', project,
    facts: [
      { kind: 'channel-create', channel: 'com.example/camera', dynamic: false,
        location: { path: 'lib/camera.dart', line: 3, column: 1 } },
      { kind: 'method-invoke', channel: 'com.example/camera', method: 'takePhoto', dynamic: false,
        location: { path: 'lib/camera.dart', line: 5, column: 1 } }
    ], limitations: []
  }));
} else {
  process.exitCode = 64;
}
`;

const fakeIsthmus = `import { readFileSync } from 'node:fs';
const args = process.argv.slice(2);
const caller = JSON.parse(readFileSync(args[1], 'utf8'));
const receiver = JSON.parse(readFileSync(args[2], 'utf8'));
if (args[0] !== 'retentions' || caller.project !== receiver.project) process.exit(2);
process.stdout.write(JSON.stringify({
  format: 'external-retentions', version: 0,
  producedBy: { name: 'isthmus', version: 'test' }, generatedAt: '2026-09-05T00:00:01.000Z',
  retentions: [{ symbol: receiver.facts[1].symbol, reason: 'bridge', evidence: {
    channel: 'com.example/camera', method: 'takePhoto',
    caller: { platform: 'dart', path: 'lib/camera.dart', line: 5 }
  }}]
}));
`;
