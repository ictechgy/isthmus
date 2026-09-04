import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { runCheckCommand } from './check-command.ts';

const dartPath = fileURLToPath(
  new URL('../../experiments/phase-0/expected/dart.json', import.meta.url),
);
const swiftPath = fileURLToPath(
  new URL('../../experiments/phase-0/expected/swift.json', import.meta.url),
);

test('check가 실제 교환 파일을 읽어 JSON 보고서를 출력한다', async () => {
  const result = await runCheckCommand(
    ['check', dartPath, swiftPath],
    (path) => readFile(path, 'utf8'),
  );

  assert.equal(result.exitCode, 0);
  assert.equal(result.standardError, '');
  const report = JSON.parse(result.standardOutput);
  assert.equal(report.format, 'isthmus-check');
  assert.deepEqual(report.summary, {
    errors: 1,
    matchedChannels: 1,
    matchedMethods: 1,
    warnings: 2,
  });
});

test('check --strict는 오류가 있으면 보고서를 내고 종료 코드 1을 반환한다', async () => {
  const result = await runCheckCommand(
    ['check', dartPath, swiftPath, '--strict'],
    (path) => readFile(path, 'utf8'),
  );

  assert.equal(result.exitCode, 1);
  assert.equal(result.standardError, '');
  assert.equal(JSON.parse(result.standardOutput).summary.errors, 1);
});

test('하위 명령이 없으면 사용법과 종료 코드 64를 반환한다', async () => {
  const result = await runCheckCommand([], async () => '');

  assert.deepEqual(result, {
    standardOutput: '',
    standardError:
      'Usage: isthmus check <bridge-facts.json> <bridge-facts.json> [more...] [--strict]\n',
    exitCode: 64,
  });
});

test('입력 파일이 두 개보다 적으면 종료 코드 64를 반환한다', async () => {
  const result = await runCheckCommand(['check', dartPath], (path) =>
    readFile(path, 'utf8'),
  );

  assert.equal(result.exitCode, 64);
  assert.equal(result.standardOutput, '');
  assert.equal(result.standardError.startsWith('Usage: isthmus check'), true);
});

test('입력 파일이 안전 상한을 넘으면 읽기 전에 종료 코드 64로 거부한다', async () => {
  let didReadFile = false;
  const result = await runCheckCommand(
    ['check', ...Array.from({ length: 257 }, (_, index) => `${index}.json`)],
    async () => {
      didReadFile = true;
      return '';
    },
  );

  assert.equal(result.exitCode, 64);
  assert.equal(didReadFile, false);
});

test('알 수 없는 옵션은 파일을 읽기 전에 종료 코드 64로 거부한다', async () => {
  let didReadFile = false;
  const result = await runCheckCommand(
    ['check', 'dart.json', 'swift.json', '--unknown'],
    async () => {
      didReadFile = true;
      return '';
    },
  );

  assert.equal(result.exitCode, 64);
  assert.equal(didReadFile, false);
});

test('입력 읽기 실패는 경로를 숨기고 종료 코드 2를 반환한다', async () => {
  const result = await runCheckCommand(
    ['check', 'private-dart.json', 'private-swift.json'],
    async () => {
      throw new Error('private-dart.json could not be read');
    },
  );

  assert.deepEqual(result, {
    standardOutput: '',
    standardError:
      'Unable to read or validate bridge facts; check the input files.\n',
    exitCode: 2,
  });
});

test('예상하지 못한 내부 오류는 입력 오류와 구분해 보고한다', async () => {
  const result = await runCheckCommand(
    ['check', 'first.json', 'second.json'],
    async () => undefined as unknown as string,
  );

  assert.deepEqual(result, {
    standardOutput: '',
    standardError: 'Internal isthmus error; retry with a current version.\n',
    exitCode: 2,
  });
});

test('너무 큰 입력은 다음 파일을 읽기 전에 종료 코드 2로 거부한다', async () => {
  const reads: string[] = [];
  const result = await runCheckCommand(
    ['check', 'large.json', 'later.json'],
    async (path) => {
      reads.push(path);
      return path === 'large.json'
        ? ' '.repeat(16 * 1024 * 1024 + 1)
        : '{}';
    },
  );

  assert.equal(result.exitCode, 2);
  assert.deepEqual(reads, ['large.json']);
});

test('mixed-targets로 전체 조인이 보류되면 성공으로 보고하지 않는다', async () => {
  const swiftDocument = JSON.parse(await readFile(swiftPath, 'utf8'));
  const mixedSwift = JSON.stringify({
    ...swiftDocument,
    limitations: [
      ...swiftDocument.limitations,
      'mixed-targets: facts come from multiple bridge mechanisms',
    ],
  });
  const result = await runCheckCommand(
    ['check', dartPath, swiftPath, '--strict'],
    (path) => path === swiftPath ? Promise.resolve(mixedSwift) : readFile(path, 'utf8'),
  );

  assert.deepEqual(result, {
    standardOutput: '',
    standardError:
      'Bridge facts could not be joined; split mixed bridge targets and retry.\n',
    exitCode: 2,
  });
});
