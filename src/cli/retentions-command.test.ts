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
    'test-version',
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

test('retentions 입력 파일이 안전 상한을 넘으면 읽기 전에 거부한다', async () => {
  let didReadFile = false;
  const result = await runRetentionsCommand(
    [
      'retentions',
      ...Array.from({ length: 257 }, (_, index) => `${index}.json`),
      '--for',
      'cartograph',
    ],
    async () => {
      didReadFile = true;
      return '';
    },
    () => new Date('2026-09-04T13:00:00Z'),
    '0.1.1',
  );

  assert.equal(result.exitCode, 64);
  assert.equal(didReadFile, false);
});

test('retentions 입력 실패는 경로를 숨기고 원인과 입력 순서를 보고한다', async () => {
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
      'Unable to read bridge facts input 1; check that the file exists and is readable.\n',
    exitCode: 2,
  });
});

test('retentions 내부 오류를 입력 오류와 구분한다', async () => {
  const result = await runRetentionsCommand(
    ['retentions', 'first.json', 'second.json', '--for', 'cartograph'],
    async () => undefined as unknown as string,
    () => new Date('2026-09-04T13:00:00Z'),
    '0.1.1',
  );

  assert.equal(result.exitCode, 2);
  assert.equal(
    result.standardError,
    'Internal isthmus error; retry with a current version.\n',
  );
});

test('retentions도 너무 큰 입력 뒤의 파일을 읽지 않는다', async () => {
  const reads: string[] = [];
  const result = await runRetentionsCommand(
    ['retentions', 'large.json', 'later.json', '--for', 'cartograph'],
    async (path) => {
      reads.push(path);
      return path === 'large.json'
        ? ' '.repeat(16 * 1024 * 1024 + 1)
        : '{}';
    },
    () => new Date('2026-09-04T13:00:00Z'),
    '0.1.1',
  );

  assert.equal(result.exitCode, 2);
  assert.deepEqual(reads, ['large.json']);
});

test('호출 측 문서만 받은 retentions는 빈 보존 문서를 조용히 내지 않는다', async () => {
  const result = await runRetentionsCommand(
    ['retentions', dartPath, dartPath, '--for', 'cartograph'],
    (path) => readFile(path, 'utf8'),
    () => new Date('2026-09-04T13:00:00Z'),
    '0.1.1',
  );

  assert.equal(result.exitCode, 2);
  assert.equal(result.standardOutput, '');
  assert.equal(
    result.standardError,
    'Bridge documents must include at least one caller platform (dart, js) document '
    + 'and one receiver platform (swift, kotlin) document; run a producer for the missing side.\n',
  );
});

test('mixed-targets로 전체 조인이 보류되면 retentions를 만들지 않는다', async () => {
  const swiftDocument = JSON.parse(await readFile(swiftPath, 'utf8'));
  const mixedSwift = JSON.stringify({
    ...swiftDocument,
    limitations: [
      ...swiftDocument.limitations,
      'mixed-targets: facts come from multiple bridge mechanisms',
    ],
  });
  const result = await runRetentionsCommand(
    ['retentions', dartPath, swiftPath, '--for', 'cartograph'],
    (path) => path === swiftPath ? Promise.resolve(mixedSwift) : readFile(path, 'utf8'),
    () => new Date('2026-09-04T13:00:00Z'),
    '0.1.0',
  );

  assert.deepEqual(result, {
    standardOutput: '',
    standardError:
      'Bridge facts could not be joined; split mixed bridge targets and retry.\n',
    exitCode: 2,
  });
});
