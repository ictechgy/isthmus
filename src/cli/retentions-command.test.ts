import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { runRetentionsCommand } from './retentions-command.ts';

const dartPath = fileURLToPath(
  new URL('../../experiments/phase-0/expected/dart.json', import.meta.url),
);
const swiftPath = fileURLToPath(
  new URL('../../experiments/phase-0/expected/swift.json', import.meta.url),
);
const retentionsPath = fileURLToPath(
  new URL('../../experiments/phase-0/expected/retentions.json', import.meta.url),
);

test('retentions가 cartograph 외부 보존 JSON을 출력한다', async () => {
  const result = await runRetentionsCommand(
    ['retentions', dartPath, swiftPath, '--for', 'cartograph'],
    (path) => readFile(path, 'utf8'),
    () => new Date('2026-09-04T13:00:00Z'),
    '0.1.0',
  );

  assert.equal(result.exitCode, 0);
  assert.equal(result.standardError, '');
  const document = JSON.parse(result.standardOutput);
  assert.equal(document.format, 'external-retentions');
  assert.equal(document.generatedAt, '2026-09-04T13:00:00.000Z');
  assert.equal(document.retentions.length, 1);
  assert.equal(document.retentions[0].symbol.qualifiedName, 'CameraPlugin.register');
  assert.equal(result.standardOutput, await readFile(retentionsPath, 'utf8'));
});

test('지원하지 않는 retention 대상은 I/O 전에 종료 코드 64로 거부한다', async () => {
  let didReadFile = false;
  const result = await runRetentionsCommand(
    ['retentions', 'dart.json', 'swift.json', '--for', 'kartograph'],
    async () => {
      didReadFile = true;
      return '';
    },
    () => new Date('2026-09-04T13:00:00Z'),
    '0.1.0',
  );

  assert.equal(result.exitCode, 64);
  assert.equal(didReadFile, false);
  assert.equal(
    result.standardError,
    'Usage: isthmus retentions <bridge-facts.json> <bridge-facts.json> '
      + '[more...] --for cartograph\n',
  );
});

test('retentions 입력 실패는 경로를 숨기고 종료 코드 2를 반환한다', async () => {
  const result = await runRetentionsCommand(
    ['retentions', 'private-dart.json', 'private-swift.json', '--for', 'cartograph'],
    async () => {
      throw new Error('private-dart.json could not be read');
    },
    () => new Date('2026-09-04T13:00:00Z'),
    '0.1.0',
  );

  assert.deepEqual(result, {
    standardOutput: '',
    standardError:
      'Unable to read or validate bridge facts; check the input files.\n',
    exitCode: 2,
  });
});
