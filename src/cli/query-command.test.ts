import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { runQueryCommand } from './query-command.ts';

const dartPath = fileURLToPath(
  new URL('../../experiments/phase-0/expected/dart.json', import.meta.url),
);
const swiftPath = fileURLToPath(
  new URL('../../experiments/phase-0/expected/swift.json', import.meta.url),
);

test('query가 실제 교환 파일에서 메서드를 찾아 JSON으로 답한다', async () => {
  const result = await runQueryCommand(
    ['query', 'takePhoto', dartPath, swiftPath],
    (path) => readFile(path, 'utf8'),
  );

  assert.equal(result.exitCode, 0);
  assert.equal(result.standardError, '');
  const document = JSON.parse(result.standardOutput);
  assert.equal(document.status, 'found');
  assert.equal(document.result.subject.kind, 'method');
});

test('query 입력 파일이 두 개보다 적으면 사용법과 64를 반환한다', async () => {
  const result = await runQueryCommand(
    ['query', 'takePhoto', dartPath],
    (path) => readFile(path, 'utf8'),
  );

  assert.deepEqual(result, {
    standardOutput: '',
    standardError:
      'Usage: isthmus query <channel-or-method> <bridge-facts.json> '
      + '<bridge-facts.json> [more...]\n',
    exitCode: 64,
  });
});

test('query 입력 실패는 경로를 숨기고 종료 코드 2를 반환한다', async () => {
  const result = await runQueryCommand(
    ['query', 'takePhoto', 'private-dart.json', 'private-swift.json'],
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

test('없는 subject는 notFound JSON과 종료 코드 64를 반환한다', async () => {
  const result = await runQueryCommand(
    ['query', 'missingMethod', dartPath, swiftPath],
    (path) => readFile(path, 'utf8'),
  );

  assert.equal(result.exitCode, 64);
  assert.equal(result.standardError, '');
  assert.equal(JSON.parse(result.standardOutput).status, 'notFound');
});
