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
      'Usage: isthmus query <channel-or-method|relation:<name>> <bridge-facts.json> '
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

test('query 입력 실패는 경로를 숨기고 원인과 입력 순서를 보고한다', async () => {
  const result = await runQueryCommand(
    ['query', 'takePhoto', 'private-dart.json', 'private-swift.json'],
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

test('호출 측 문서만 받은 query는 구성 거부 이유로 실패한다', async () => {
  const result = await runQueryCommand(
    ['query', 'takePhoto', dartPath, dartPath],
    (path) => readFile(path, 'utf8'),
  );

  assert.equal(result.exitCode, 2);
  assert.equal(result.standardOutput, '');
  assert.equal(
    result.standardError.startsWith('Bridge documents must include'),
    true,
  );
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
  assert.equal(
    result.standardError,
    'No bridge channel or method matches the requested name; '
    + 'query a channel or method name that the inputs observed.\n',
  );
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
  assert.equal(
    result.standardError,
    'The requested name matches 2 bridge keys; '
    + 'repeat the query with a qualifiedName from candidates.\n',
  );
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
      'Bridge facts could not be joined; split mixed bridge targets and retry. '
      + 'The inputs observed 10 facts across 2 documents.\n',
    exitCode: 2,
  });
});

/** persistence 관계 질의용 고정 입력이다. */
const relationFixture = new URL('../../fixtures/domain-composition/', import.meta.url);
const readRelationFixture = (path: string): Promise<string> => readFile(new URL(path, relationFixture), 'utf8');
const relationInputs = ['kotlin-persistence.json', 'go-persistence.json', 'sql.json'];

test('relation 주체는 persistence 조인 규칙으로 찾아 사용·선언·진단을 싣는다', async () => {
  const result = await runQueryCommand(['query', 'relation:USERS', ...relationInputs], readRelationFixture);
  assert.equal(result.exitCode, 0);
  assert.equal(result.standardError, '');
  const document = JSON.parse(result.standardOutput);
  assert.equal(document.level, 'persistence');
  assert.deepEqual(document.result.subject, { name: 'USERS', qualifiedName: 'relation:public.users', kind: 'relation' });
  // 비한정 kotlin 사용과 한정 go 사용이 같은 선언으로 모인다.
  assert.deepEqual(document.result.usedBy.map(({ platform }: { platform: string }) => platform), ['go', 'kotlin']);
  assert.deepEqual(document.result.columns.map(({ column }: { column: string }) => column), ['email', 'nickname']);
  assert.deepEqual(document.result.issues.map(({ code }: { code: string }) => code), ['column-use-without-decl']);
  // qualifiedName을 그대로 다시 물으면 같은 관계다.
  const again = await runQueryCommand(['query', document.result.subject.qualifiedName, ...relationInputs], readRelationFixture);
  assert.deepEqual(JSON.parse(again.standardOutput).result.subject.qualifiedName, 'relation:public.users');
});

test('relation 주체의 미발견·모호·빈 이름은 기존 64 의미와 원인 문구를 따른다', async () => {
  const missing = await runQueryCommand(['query', 'relation:payments', ...relationInputs], readRelationFixture);
  assert.equal(missing.exitCode, 64);
  assert.equal(JSON.parse(missing.standardOutput).status, 'notFound');
  assert.match(missing.standardError, /^No persistence relation matches the requested name;/);

  const ambiguousCatalog = JSON.stringify({
    format: 'bridge-facts', version: 1, tool: { name: 'schemagraph', version: '0.1.0' },
    generatedAt: '2026-09-26T00:00:00Z', platform: 'sql', target: 'persistence', project: '/fixture',
    facts: ['public.users', 'audit.users'].map((channel) => ({
      kind: 'relation-decl', channel, dynamic: false, symbol: { qualifiedName: channel },
    })),
    limitations: [],
  });
  const read = (path: string) => path === 'sql.json' ? Promise.resolve(ambiguousCatalog) : readRelationFixture(path);
  const ambiguous = await runQueryCommand(['query', 'relation:users', ...relationInputs], read);
  assert.equal(ambiguous.exitCode, 64);
  assert.deepEqual(JSON.parse(ambiguous.standardOutput).candidates,
    [{ qualifiedName: 'relation:audit.users' }, { qualifiedName: 'relation:public.users' }]);
  assert.match(ambiguous.standardError, /^The requested relation name matches 2 declarations;/);

  for (const requested of ['relation:', 'relation:  ']) {
    const usage = await runQueryCommand(['query', requested, ...relationInputs], async () => assert.fail('must not read'));
    assert.equal(usage.exitCode, 64);
    assert.match(usage.standardError, /^Usage: isthmus query /);
  }
});

test('relation 접두사가 없는 이름은 bridge 질의 그대로다', async () => {
  const result = await runQueryCommand(['query', 'users', ...relationInputs], readRelationFixture);
  assert.equal(result.exitCode, 64);
  const document = JSON.parse(result.standardOutput);
  assert.equal(document.level, 'bridge');
  assert.match(result.standardError, /^No bridge channel or method matches/);
});
