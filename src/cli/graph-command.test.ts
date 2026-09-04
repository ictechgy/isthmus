import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { runGraphCommand } from './graph-command.ts';

const dartPath = fileURLToPath(
  new URL('../../experiments/phase-0/expected/dart.json', import.meta.url),
);
const swiftPath = fileURLToPath(
  new URL('../../experiments/phase-0/expected/swift.json', import.meta.url),
);
const graphPath = fileURLToPath(
  new URL('../../experiments/phase-0/expected/graph.json', import.meta.url),
);

test('graph가 실제 교환 파일을 Mermaid 경계 그래프로 출력한다', async () => {
  const result = await runGraphCommand(
    ['graph', dartPath, swiftPath, '--format', 'mermaid'],
    (path) => readFile(path, 'utf8'),
  );

  assert.equal(result.exitCode, 0);
  assert.equal(result.standardError, '');
  assert.equal(result.standardOutput.startsWith('flowchart LR\n'), true);
  assert.equal(result.standardOutput.includes('channel dev.isthmus/camera'), true);
});

test('지원하지 않는 graph 형식은 I/O 전에 종료 코드 64로 거부한다', async () => {
  let didReadFile = false;
  const result = await runGraphCommand(
    ['graph', 'dart.json', 'swift.json', '--format', 'html'],
    async () => {
      didReadFile = true;
      return '';
    },
  );

  assert.equal(result.exitCode, 64);
  assert.equal(didReadFile, false);
  assert.equal(result.standardError.startsWith('Usage: isthmus graph'), true);
});

test('graph 입력 파일이 안전 상한을 넘으면 읽기 전에 거부한다', async () => {
  let didReadFile = false;
  const result = await runGraphCommand(
    ['graph', ...Array.from({ length: 257 }, (_, index) => `${index}.json`)],
    async () => {
      didReadFile = true;
      return '';
    },
  );

  assert.equal(result.exitCode, 64);
  assert.equal(didReadFile, false);
});

test('graph 형식을 생략하면 JSON을 출력한다', async () => {
  const result = await runGraphCommand(
    ['graph', dartPath, swiftPath],
    (path) => readFile(path, 'utf8'),
  );

  assert.equal(result.exitCode, 0);
  assert.equal(JSON.parse(result.standardOutput).format, 'isthmus-graph');
  assert.equal(result.standardOutput, await readFile(graphPath, 'utf8'));
});

test('graph 입력 실패는 경로를 숨기고 종료 코드 2를 반환한다', async () => {
  const result = await runGraphCommand(
    ['graph', 'private-dart.json', 'private-swift.json'],
    async () => {
      throw new Error('private path and contents');
    },
  );

  assert.deepEqual(result, {
    standardOutput: '',
    standardError:
      'Unable to read or validate bridge facts; check the input files.\n',
    exitCode: 2,
  });
});

test('graph 내부 오류를 입력 오류와 구분한다', async () => {
  const result = await runGraphCommand(
    ['graph', 'first.json', 'second.json'],
    async () => undefined as unknown as string,
  );

  assert.equal(result.exitCode, 2);
  assert.equal(
    result.standardError,
    'Internal isthmus error; retry with a current version.\n',
  );
});

test('graph도 너무 큰 입력 뒤의 파일을 읽지 않는다', async () => {
  const reads: string[] = [];
  const result = await runGraphCommand(
    ['graph', 'large.json', 'later.json'],
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

test('mixed-targets로 전체 조인이 보류되면 graph를 만들지 않는다', async () => {
  const swiftDocument = JSON.parse(await readFile(swiftPath, 'utf8'));
  const mixedSwift = JSON.stringify({
    ...swiftDocument,
    limitations: [
      ...swiftDocument.limitations,
      'mixed-targets: facts come from multiple bridge mechanisms',
    ],
  });
  const result = await runGraphCommand(
    ['graph', dartPath, swiftPath],
    (path) => path === swiftPath ? Promise.resolve(mixedSwift) : readFile(path, 'utf8'),
  );

  assert.deepEqual(result, {
    standardOutput: '',
    standardError:
      'Bridge facts could not be joined; split mixed bridge targets and retry.\n',
    exitCode: 2,
  });
});
