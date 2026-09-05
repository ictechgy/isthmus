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

test('입력 읽기 실패는 경로를 숨기고 원인과 입력 순서를 보고한다', async () => {
  const result = await runCheckCommand(
    ['check', 'private-dart.json', 'private-swift.json'],
    async () => {
      throw new Error('private-dart.json could not be read');
    },
  );

  assert.deepEqual(result, {
    standardOutput: '',
    standardError:
      'Unable to read bridge facts input 1; check that the file exists and is readable.\n',
    exitCode: 2,
  });
});

test('JSON이 아닌 입력은 파싱 오류 본문 없이 원인과 순서를 보고한다', async () => {
  const result = await runCheckCommand(
    ['check', 'broken.json', 'later.json'],
    async () => '{not json',
  );

  assert.deepEqual(result, {
    standardOutput: '',
    standardError:
      'Bridge facts input 1 is not valid JSON; regenerate it with a bridge-facts producer.\n',
    exitCode: 2,
  });
});

test('교환 계약 위반은 위반 이유를 입력 본문 없이 보고한다', async () => {
  const result = await runCheckCommand(
    ['check', dartPath, 'invalid.json'],
    (path) =>
      path === 'invalid.json'
        ? Promise.resolve(JSON.stringify({ format: 'other' }))
        : readFile(path, 'utf8'),
  );

  assert.deepEqual(result, {
    standardOutput: '',
    standardError:
      'Bridge facts input 2 violates the bridge-facts contract: '
      + 'Expected format "bridge-facts".\n',
    exitCode: 2,
  });
});

test('project 불일치는 일반 입력 오류와 다른 원인 메시지를 낸다', async () => {
  const swiftDocument = JSON.parse(await readFile(swiftPath, 'utf8'));
  const otherProject = JSON.stringify({
    ...swiftDocument,
    project: '/another-project',
  });
  const result = await runCheckCommand(
    ['check', dartPath, swiftPath],
    (path) =>
      path === swiftPath
        ? Promise.resolve(otherProject)
        : readFile(path, 'utf8'),
  );

  assert.deepEqual(result, {
    standardOutput: '',
    standardError:
      'Bridge documents must describe the same project; regenerate them from one project root.\n',
    exitCode: 2,
  });
});

test('호출 측 문서만 받은 check는 한쪽 관찰을 오류로 보고하지 않는다', async () => {
  const result = await runCheckCommand(
    ['check', dartPath, dartPath, '--strict'],
    (path) => readFile(path, 'utf8'),
  );

  assert.equal(result.exitCode, 2);
  assert.equal(result.standardOutput, '');
  assert.equal(
    result.standardError,
    'Bridge documents must include at least one caller platform (dart, js) document '
    + 'and one receiver platform (swift, kotlin) document; run a producer for the missing side.\n',
  );
});

test('수신 측 문서만 받은 check도 같은 이유로 거부한다', async () => {
  const result = await runCheckCommand(
    ['check', swiftPath, swiftPath],
    (path) => readFile(path, 'utf8'),
  );

  assert.equal(result.exitCode, 2);
  assert.equal(
    result.standardError.startsWith('Bridge documents must include'),
    true,
  );
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
  assert.equal(
    result.standardError,
    'Bridge facts input 1 exceeds the input size limits; '
    + 'split the extraction into smaller documents.\n',
  );
});

test('전체 입력 합계가 안전 상한을 넘으면 마지막 파일 파싱 전에 거부한다', async () => {
  const document = JSON.parse(await readFile(dartPath, 'utf8'));
  const largeDocument = JSON.stringify({
    ...document,
    padding: 'x'.repeat(13 * 1024 * 1024),
  });
  const paths = ['1.json', '2.json', '3.json', '4.json', '5.json'];
  const reads: string[] = [];

  const result = await runCheckCommand(
    ['check', ...paths],
    async (path) => {
      reads.push(path);
      return largeDocument;
    },
  );

  assert.equal(result.exitCode, 2);
  assert.deepEqual(reads, paths);
  assert.equal(
    result.standardError,
    'Bridge facts input 5 exceeds the input size limits; '
    + 'split the extraction into smaller documents.\n',
  );
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

test('예약된 RN fact 문서는 clean report 대신 입력 오류를 반환한다', async () => {
  const base = {
    format: 'bridge-facts',
    version: 1,
    tool: { name: 'test-tool', version: '1.0.0' },
    generatedAt: '2026-09-04T12:00:00Z',
    target: 'react-native',
    project: '/fixture',
    limitations: [],
  };
  const inputs = new Map([
    ['caller.json', JSON.stringify({
      ...base,
      platform: 'js',
      facts: [
        {
          kind: 'module-import',
          channel: 'CameraModule',
          dynamic: false,
          location: { path: 'src/camera.ts', line: 1, column: 1 },
        },
      ],
    })],
    ['receiver.json', JSON.stringify({
      ...base,
      platform: 'swift',
      facts: [
        {
          kind: 'module-export',
          channel: 'CameraModule',
          dynamic: false,
          location: { path: 'ios/Camera.swift', line: 1, column: 1 },
        },
      ],
    })],
  ]);

  const result = await runCheckCommand(
    ['check', 'caller.json', 'receiver.json', '--strict'],
    async (path) => inputs.get(path) ?? '',
  );

  assert.deepEqual(result, {
    standardOutput: '',
    standardError:
      'Bridge facts input 1 violates the bridge-facts contract: '
      + 'Fact kind is reserved but not supported in isthmus 0.1 at index 0.\n',
    exitCode: 2,
  });
});

test('두 번째 입력의 예약 RN fact도 기본 모드에서 입력 오류로 거부한다', async () => {
  const receiver = JSON.stringify({
    format: 'bridge-facts',
    version: 1,
    tool: { name: 'test-tool', version: '1.0.0' },
    generatedAt: '2026-09-04T12:00:00Z',
    platform: 'swift',
    target: 'react-native',
    project: '/fixture',
    facts: [
      {
        kind: 'module-export',
        channel: 'CameraModule',
        dynamic: false,
        location: { path: 'ios/Camera.swift', line: 1, column: 1 },
      },
    ],
    limitations: [],
  });

  const result = await runCheckCommand(
    ['check', dartPath, 'receiver.json'],
    (path) =>
      path === 'receiver.json'
        ? Promise.resolve(receiver)
        : readFile(path, 'utf8'),
  );

  assert.deepEqual(result, {
    standardOutput: '',
    standardError:
      'Bridge facts input 2 violates the bridge-facts contract: '
      + 'Fact kind is reserved but not supported in isthmus 0.1 at index 0.\n',
    exitCode: 2,
  });
});
