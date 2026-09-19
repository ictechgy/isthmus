import assert from 'node:assert/strict';
import test from 'node:test';

import type { CaptureFileSystem } from './command-support.ts';
import { runInitCommand } from './init-command.ts';

/** project만 정규화하고 나머지 경로는 없는 것으로 보는 가짜 파일시스템이다. */
function fileSystem(existing: readonly string[] = []): CaptureFileSystem {
  const known = new Set(existing);
  return {
    statPath: async (path) => (known.has(path) ? 'file' : 'missing'),
    realPath: async (path) => path,
  };
}

const toolchain = JSON.stringify({
  format: 'isthmus-built-toolchain',
  version: 1,
  destination: '/toolchain',
  commands: {
    isthmus: ['/toolchain/bin/isthmus'],
    dartograph: ['/toolchain/bin/dartograph'],
    cartograph: ['/toolchain/bin/cartograph'],
  },
});

test('기본 scaffold를 project와 자리표시자로 쓴다', async () => {
  let written = '';
  const result = await runInitCommand(
    ['init'],
    async () => { throw new Error('unused'); },
    async (_path, text) => { written = text; },
    fileSystem(),
    '/app',
  );

  assert.equal(result.exitCode, 0);
  assert.equal(JSON.parse(result.standardOutput).format, 'isthmus-init');
  const scaffold = JSON.parse(written);
  assert.equal(scaffold.project, '/app');
  assert.deepEqual(scaffold.dartograph, ['dartograph']);
  assert.deepEqual(scaffold.prepare, [['replace-with-native-index-build']]);
  assert.deepEqual(scaffold.inputs, ['lib']);
  assert.equal(scaffold.output, '.isthmus/context.json');
});

test('--toolchain이 실제 producer 명령을 채운다', async () => {
  let written = '';
  const result = await runInitCommand(
    ['init', 'capture.json', '--toolchain', 'toolchain.json'],
    async (path) => {
      assert.equal(path, '/app/toolchain.json');
      return toolchain;
    },
    async (_path, text) => { written = text; },
    fileSystem(),
    '/app',
  );

  assert.equal(result.exitCode, 0);
  const scaffold = JSON.parse(written);
  assert.deepEqual(scaffold.dartograph, ['/toolchain/bin/dartograph']);
  assert.deepEqual(scaffold.cartograph, ['/toolchain/bin/cartograph']);
  assert.deepEqual(scaffold.toolInputs, ['/app/toolchain.json']);
});

test('기존 파일은 --force 없이는 덮어쓰지 않는다', async () => {
  const existing = '/app/capture.json';
  const blocked = await runInitCommand(
    ['init'],
    async () => '',
    async () => { throw new Error('should not write'); },
    fileSystem([existing]),
    '/app',
  );
  assert.equal(blocked.exitCode, 2);
  assert.match(blocked.standardError, /already exists/u);

  let wrote = false;
  const forced = await runInitCommand(
    ['init', '--force'],
    async () => '',
    async () => { wrote = true; },
    fileSystem([existing]),
    '/app',
  );
  assert.equal(forced.exitCode, 0);
  assert.equal(wrote, true);
});

test('잘못된 toolchain과 사용법을 구분한다', async () => {
  const invalid = await runInitCommand(
    ['init', '--toolchain', 'toolchain.json'],
    async () => JSON.stringify({ format: 'other', version: 1, commands: {} }),
    async () => { throw new Error('should not write'); },
    fileSystem(),
    '/app',
  );
  assert.equal(invalid.exitCode, 2);
  assert.match(invalid.standardError, /toolchain manifest/u);

  assert.equal(
    (await runInitCommand(['init', 'a.json', 'b.json'], async () => '', async () => {}, fileSystem(), '/app')).exitCode,
    64,
  );
  assert.equal(
    (await runInitCommand(['init', '--unknown'], async () => '', async () => {}, fileSystem(), '/app')).exitCode,
    64,
  );
});