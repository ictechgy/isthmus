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

test('query 입력 파일이 안전 상한을 넘으면 읽기 전에 거부한다', async () => {
  let didReadFile = false;
  const result = await runQueryCommand(
    [
      'query',
      'takePhoto',
      ...Array.from({ length: 257 }, (_, index) => `${index}.json`),
    ],
    async () => {
      didReadFile = true;
      return '';
    },
  );

  assert.equal(result.exitCode, 64);
  assert.equal(didReadFile, false);
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

test('query 내부 오류를 입력 오류와 구분한다', async () => {
  const result = await runQueryCommand(
    ['query', 'takePhoto', 'first.json', 'second.json'],
    async () => undefined as unknown as string,
  );

  assert.equal(result.exitCode, 2);
  assert.equal(
    result.standardError,
    'Internal isthmus error; retry with a current version.\n',
  );
});

test('query도 너무 큰 입력 뒤의 파일을 읽지 않는다', async () => {
  const reads: string[] = [];
  const result = await runQueryCommand(
    ['query', 'takePhoto', 'large.json', 'later.json'],
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

test('없는 subject는 notFound JSON과 종료 코드 64를 반환한다', async () => {
  const result = await runQueryCommand(
    ['query', 'missingMethod', dartPath, swiftPath],
    (path) => readFile(path, 'utf8'),
  );

  assert.equal(result.exitCode, 64);
  assert.equal(result.standardError, '');
  assert.equal(JSON.parse(result.standardOutput).status, 'notFound');
});

test('모호한 subject는 후보 JSON과 종료 코드 64를 반환한다', async () => {
  const dartDocument = JSON.parse(await readFile(dartPath, 'utf8'));
  const swiftDocument = JSON.parse(await readFile(swiftPath, 'utf8'));
  const inputs = new Map([
    [dartPath, JSON.stringify({
      ...dartDocument,
      facts: [
        ...dartDocument.facts,
        {
          kind: 'method-invoke',
          channel: 'dev.isthmus/secondary',
          method: 'takePhoto',
          dynamic: false,
          location: { path: 'lib/secondary.dart', line: 8, column: 19 },
        },
      ],
    })],
    [swiftPath, JSON.stringify({
      ...swiftDocument,
      facts: [
        ...swiftDocument.facts,
        {
          kind: 'method-handle',
          channel: 'dev.isthmus/secondary',
          method: 'takePhoto',
          dynamic: false,
          location: { path: 'ios/SecondaryPlugin.swift', line: 12, column: 18 },
        },
      ],
    })],
  ]);

  const result = await runQueryCommand(
    ['query', 'takePhoto', dartPath, swiftPath],
    (path) => Promise.resolve(inputs.get(path) ?? ''),
  );

  assert.equal(result.exitCode, 64);
  assert.equal(result.standardError, '');
  assert.equal(JSON.parse(result.standardOutput).status, 'ambiguous');
});

test('mixed-targets로 전체 조인이 보류되면 query를 실행하지 않는다', async () => {
  const swiftDocument = JSON.parse(await readFile(swiftPath, 'utf8'));
  const mixedSwift = JSON.stringify({
    ...swiftDocument,
    limitations: [
      ...swiftDocument.limitations,
      'mixed-targets: facts come from multiple bridge mechanisms',
    ],
  });
  const result = await runQueryCommand(
    ['query', 'takePhoto', dartPath, swiftPath],
    (path) => path === swiftPath ? Promise.resolve(mixedSwift) : readFile(path, 'utf8'),
  );

  assert.deepEqual(result, {
    standardOutput: '',
    standardError:
      'Bridge facts could not be joined; split mixed bridge targets and retry.\n',
    exitCode: 2,
  });
});
