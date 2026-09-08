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
      'Usage: isthmus check <bridge-facts.json> <bridge-facts.json> '
      + '[more...] [--strict] [--baseline <isthmus-baseline.json>] '
      + '[--update-baseline <isthmus-baseline.json>]\n',
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

test('contract 위반 메시지는 어떤 검증 분기에서도 입력 값을 담지 않는다', async () => {
  const base = {
    format: 'bridge-facts',
    version: 1,
    tool: { name: 'marker-tool', version: 'MARKER-VERSION' },
    generatedAt: '2026-09-05T00:00:00.000Z',
    platform: 'dart',
    target: 'flutter',
    project: '/marker-fixture',
    facts: [],
    limitations: [],
  };
  const markerFact = {
    kind: 'channel-create',
    channel: 'MARKER-CHANNEL',
    dynamic: false,
    location: { path: 'lib/marker.dart', line: 1, column: 1 },
  };
  const cases: ReadonlyArray<readonly [unknown, string]> = [
    ['null', 'Bridge facts must be a JSON object.'],
    [{ ...base, format: 'other' }, 'Expected format "bridge-facts".'],
    [
      { ...base, version: 2 },
      'Unsupported bridge-facts version; expected version 1.',
    ],
    [{ ...base, tool: { name: '', version: 'MARKER' } }, 'Invalid tool metadata.'],
    [{ ...base, generatedAt: 'MARKER-TIMESTAMP' }, 'Invalid generatedAt timestamp.'],
    [{ ...base, platform: 'MARKER-PLATFORM' }, 'Unsupported bridge platform.'],
    [{ ...base, target: 'MARKER-TARGET' }, 'Unsupported bridge target.'],
    [{ ...base, project: 'MARKER\u0000PROJECT' }, 'Invalid project path.'],
    [{ ...base, facts: {} }, 'Facts must be an array.'],
    [
      { ...base, target: null, limitations: [1] },
      'Limitations must be strings.',
    ],
    [
      { ...base, target: null, facts: [markerFact] },
      'Target must be set exactly when facts are present.',
    ],
    [
      { ...base, facts: [{ ...markerFact, kind: 'MARKER-KIND' }] },
      'Invalid fact kind at index 0.',
    ],
    [
      { ...base, facts: [{ ...markerFact, kind: 'channel-register' }] },
      'Fact kind is not valid for platform at index 0.',
    ],
    [
      { ...base, facts: [{ ...markerFact, kind: 'module-import' }] },
      'Fact kind is reserved but not supported in isthmus 0.1 at index 0.',
    ],
    [
      { ...base, facts: [{ ...markerFact, method: 'MARKER-METHOD' }] },
      'Unexpected method at index 0.',
    ],
    [
      { ...base, facts: [{ ...markerFact, channel: '' }] },
      'Invalid fact channel at index 0.',
    ],
    [
      { ...base, facts: [{ ...markerFact, kind: 'method-invoke' }] },
      'Method fact at index 0 requires a method name.',
    ],
    [
      { ...base, facts: [{ ...markerFact, dynamic: 'MARKER' }] },
      'Invalid dynamic flag at index 0.',
    ],
    [
      {
        ...base,
        facts: [
          {
            ...markerFact,
            location: { path: '/secret/MARKER/path.dart', line: 1, column: 1 },
          },
        ],
      },
      'Invalid fact location at index 0.',
    ],
    [
      {
        ...base,
        facts: [
          {
            ...markerFact,
            kind: 'method-invoke',
            method: 'MARKER-METHOD',
            symbol: { qualifiedName: 'MARKER-SYMBOL', usr: '' },
          },
        ],
      },
      'Invalid fact symbol at index 0.',
    ],
  ];

  for (const [invalidDocument, reason] of cases) {
    const text = typeof invalidDocument === 'string'
      ? invalidDocument
      : JSON.stringify(invalidDocument);
    const result = await runCheckCommand(
      ['check', 'invalid.json', swiftPath],
      (path) =>
        path === 'invalid.json'
          ? Promise.resolve(text)
          : readFile(path, 'utf8'),
    );

    assert.deepEqual(
      result,
      {
        standardOutput: '',
        standardError:
          'Bridge facts input 1 violates the bridge-facts contract: '
          + `${reason}\n`,
        exitCode: 2,
      },
      reason,
    );
  }
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

/** 베이스라인 파일을 실제 교환 파일과 함께 제공하는 메모리 reader다. */
function readerWithBaseline(baselineText: string | undefined) {
  return async (path: string): Promise<string> => {
    if (path === 'baseline.json') {
      if (baselineText === undefined) throw new Error('missing');
      return baselineText;
    }
    return readFile(path, 'utf8');
  };
}

/** phase-0의 unhandled-invocation 하나를 억제하는 유효한 베이스라인이다. */
const validBaseline = JSON.stringify({
  format: 'isthmus-baseline',
  version: 1,
  generatedAt: '2026-09-08T00:00:00.000Z',
  entries: [
    {
      code: 'unhandled-invocation',
      target: 'flutter',
      channel: 'dev.isthmus/camera',
      method: 'takePhotos',
    },
  ],
});

test('check --baseline은 맞은 이슈를 억제하되 사실과 증거를 보존한다', async () => {
  const result = await runCheckCommand(
    ['check', dartPath, swiftPath, '--baseline', 'baseline.json'],
    readerWithBaseline(validBaseline),
  );

  assert.equal(result.exitCode, 0);
  const report = JSON.parse(result.standardOutput);
  assert.deepEqual(report.summary, {
    errors: 0,
    warnings: 2,
    suppressed: 1,
    staleBaselineEntries: 0,
    matchedChannels: 1,
    matchedMethods: 1,
  });
  const suppressed = report.issues.find(
    (issue: { suppressed?: boolean }) => issue.suppressed === true,
  );
  assert.equal(suppressed.code, 'unhandled-invocation');
  assert.equal(suppressed.severity, 'error');
  assert.equal(suppressed.evidence.length, 1);
});

test('억제된 오류는 --strict를 실패시키지 않는다', async () => {
  const result = await runCheckCommand(
    ['check', dartPath, swiftPath, '--strict', '--baseline', 'baseline.json'],
    readerWithBaseline(validBaseline),
  );

  assert.equal(result.exitCode, 0);
  assert.equal(JSON.parse(result.standardOutput).summary.errors, 0);
});

test('어느 이슈와도 맞지 않는 항목은 stale로 세고 아무것도 억제하지 않는다', async () => {
  const staleBaseline = JSON.stringify({
    format: 'isthmus-baseline',
    version: 1,
    generatedAt: '2026-09-08T00:00:00.000Z',
    entries: [
      {
        code: 'unhandled-invocation',
        target: 'flutter',
        channel: 'dev.isthmus/gone',
        method: 'removed',
      },
    ],
  });

  const result = await runCheckCommand(
    ['check', dartPath, swiftPath, '--baseline', 'baseline.json'],
    readerWithBaseline(staleBaseline),
  );

  assert.equal(result.exitCode, 0);
  const report = JSON.parse(result.standardOutput);
  assert.equal(report.summary.errors, 1);
  assert.equal(report.summary.suppressed, 0);
  assert.equal(report.summary.staleBaselineEntries, 1);
  assert.equal(
    report.issues.some(
      (issue: { suppressed?: boolean }) => issue.suppressed !== undefined,
    ),
    false,
  );
});

test('check --update-baseline은 현재 이슈를 결정적 파일로 기록한다', async () => {
  const written = new Map<string, string>();
  const result = await runCheckCommand(
    ['check', dartPath, swiftPath, '--update-baseline', 'baseline-out.json'],
    (path) => readFile(path, 'utf8'),
    async (path, text) => {
      written.set(path, text);
    },
    () => new Date('2026-09-08T01:02:03.000Z'),
  );

  assert.equal(result.exitCode, 0);
  assert.equal(JSON.parse(result.standardOutput).summary.errors, 1);
  const text = written.get('baseline-out.json');
  assert.notEqual(text, undefined);
  assert.equal(text?.endsWith('\n'), true);
  const document = JSON.parse(text ?? '');
  assert.equal(document.format, 'isthmus-baseline');
  assert.equal(document.version, 1);
  assert.equal(document.generatedAt, '2026-09-08T01:02:03.000Z');
  assert.deepEqual(document.entries, [
    {
      code: 'handler-without-invocation',
      target: 'flutter',
      channel: 'dev.isthmus/camera',
      method: 'captureStill',
    },
    {
      code: 'handler-without-invocation',
      target: 'flutter',
      channel: 'dev.isthmus/camera',
      method: 'recordVideo',
    },
    {
      code: 'unhandled-invocation',
      target: 'flutter',
      channel: 'dev.isthmus/camera',
      method: 'takePhotos',
    },
  ]);
  assert.equal(
    (text ?? '').indexOf('"channel"') < (text ?? '').indexOf('"code"'),
    true,
  );
});

test('--update-baseline 산출물은 --baseline으로 그대로 돌아온다', async () => {
  const written = new Map<string, string>();
  await runCheckCommand(
    ['check', dartPath, swiftPath, '--update-baseline', 'baseline.json'],
    (path) => readFile(path, 'utf8'),
    async (path, text) => {
      written.set(path, text);
    },
    () => new Date('2026-09-08T01:02:03.000Z'),
  );

  const roundtrip = await runCheckCommand(
    ['check', dartPath, swiftPath, '--strict', '--baseline', 'baseline.json'],
    async (path) =>
      path === 'baseline.json' ? (written.get(path) ?? '') : readFile(path, 'utf8'),
  );

  assert.equal(roundtrip.exitCode, 0);
  const report = JSON.parse(roundtrip.standardOutput);
  assert.deepEqual(
    [report.summary.errors, report.summary.suppressed, report.summary.staleBaselineEntries],
    [0, 3, 0],
  );
});

test('읽지 못한 베이스라인 파일은 경로 없이 원인으로 보고한다', async () => {
  const result = await runCheckCommand(
    ['check', dartPath, swiftPath, '--baseline', 'missing.json'],
    readerWithBaseline(undefined),
  );

  assert.equal(result.exitCode, 2);
  assert.equal(result.standardOutput, '');
  assert.equal(
    result.standardError,
    'Unable to read the baseline file; check that it exists and is readable.\n',
  );
  assert.equal(result.standardError.includes('missing.json'), false);
});

test('잘못된 베이스라인 파일은 정적 원인으로 코드 2 거부한다', async () => {
  const cases: Array<[string, string]> = [
    [
      '{not json',
      'The baseline file is not valid JSON; regenerate it with '
      + 'check --update-baseline.\n',
    ],
    [
      JSON.stringify({
        format: 'other',
        version: 1,
        generatedAt: '2026-09-08T00:00:00.000Z',
        entries: [],
      }),
      'The baseline file is not a valid isthmus-baseline document: '
      + 'Expected format "isthmus-baseline".\n',
    ],
    [
      JSON.stringify({
        format: 'isthmus-baseline',
        version: 2,
        generatedAt: '2026-09-08T00:00:00.000Z',
        entries: [],
      }),
      'The baseline file is not a valid isthmus-baseline document: '
      + 'Unsupported isthmus-baseline version; expected version 1.\n',
    ],
    [
      JSON.stringify({
        format: 'isthmus-baseline',
        version: 1,
        generatedAt: '2026-09-08T00:00:00.000Z',
        entries: [{ code: 'made-up-code', target: 'flutter', channel: 'c' }],
      }),
      'The baseline file is not a valid isthmus-baseline document: '
      + 'Unknown issue code in baseline entry at index 0.\n',
    ],
  ];

  for (const [text, expected] of cases) {
    const result = await runCheckCommand(
      ['check', dartPath, swiftPath, '--baseline', 'baseline.json'],
      readerWithBaseline(text),
    );
    assert.equal(result.exitCode, 2, text);
    assert.equal(result.standardOutput, '');
    assert.equal(result.standardError, expected);
  }
});

test('베이스라인 플래그 오용은 파일을 읽기 전에 64로 거부한다', async () => {
  for (const args of [
    ['check', dartPath, swiftPath, '--baseline'],
    ['check', dartPath, swiftPath, '--baseline', '-x'],
    ['check', dartPath, swiftPath, '--baseline=a.json'],
    ['check', dartPath, swiftPath, '--baseline', 'a.json', '--baseline', 'b.json'],
    [
      'check', dartPath, swiftPath,
      '--baseline', 'a.json', '--update-baseline', 'b.json',
    ],
  ]) {
    let didRead = false;
    const result = await runCheckCommand(args, async () => {
      didRead = true;
      return '';
    });
    assert.equal(result.exitCode, 64, args.join(' '));
    assert.equal(didRead, false, args.join(' '));
  }
});

test('쓰기 경계 없이 갱신을 시도하면 입력 탓이 아닌 내부 오류로 보고한다', async () => {
  const result = await runCheckCommand(
    ['check', dartPath, swiftPath, '--update-baseline', 'out.json'],
    (path) => readFile(path, 'utf8'),
  );

  assert.equal(result.exitCode, 2);
  assert.equal(
    result.standardError,
    'Internal isthmus error; retry with a current version.\n',
  );
});

test('베이스라인 쓰기 실패는 읽기 오류와 구분해 보고한다', async () => {
  const result = await runCheckCommand(
    ['check', dartPath, swiftPath, '--update-baseline', 'out.json'],
    (path) => readFile(path, 'utf8'),
    async () => {
      throw new Error('EPERM');
    },
    () => new Date('2026-09-08T01:02:03.000Z'),
  );

  assert.equal(result.exitCode, 2);
  assert.equal(
    result.standardError,
    'Unable to write the baseline file; check that the path is writable.\n',
  );
});

test('--update-baseline 중복 플래그도 64로 거부한다', async () => {
  const result = await runCheckCommand(
    [
      'check', dartPath, swiftPath,
      '--update-baseline', 'a.json', '--update-baseline', 'b.json',
    ],
    async () => '',
  );

  assert.equal(result.exitCode, 64);
});

test('--update-baseline은 --strict와 함께면 파일을 쓰고 error 종료 코드를 유지한다', async () => {
  const written = new Map<string, string>();
  const result = await runCheckCommand(
    ['check', dartPath, swiftPath, '--strict', '--update-baseline', 'out.json'],
    (path) => readFile(path, 'utf8'),
    async (path, text) => {
      written.set(path, text);
    },
    () => new Date('2026-09-08T01:02:03.000Z'),
  );

  assert.equal(result.exitCode, 1);
  assert.equal(JSON.parse(result.standardOutput).summary.errors, 1);
  assert.equal(written.has('out.json'), true);
});

test('입력 실패는 베이스라인 파일을 쓰지 않는다', async () => {
  let didWrite = false;
  const result = await runCheckCommand(
    ['check', 'broken.json', swiftPath, '--update-baseline', 'out.json'],
    async (path) => (path === 'broken.json' ? '{invalid' : readFile(path, 'utf8')),
    async () => {
      didWrite = true;
    },
    () => new Date('2026-09-08T01:02:03.000Z'),
  );

  assert.equal(result.exitCode, 2);
  assert.equal(didWrite, false);
});

test('객체가 아닌 베이스라인 JSON은 계약 위반 원인으로 거부한다', async () => {
  const result = await runCheckCommand(
    ['check', dartPath, swiftPath, '--baseline', 'baseline.json'],
    readerWithBaseline('[]'),
  );

  assert.equal(result.exitCode, 2);
  assert.equal(
    result.standardError,
    'The baseline file is not a valid isthmus-baseline document: '
    + 'Baseline must be a JSON object.\n',
  );
});

test('깊게 중첩된 베이스라인 JSON도 입력 탓 JSON 오류로 분류한다', async () => {
  const result = await runCheckCommand(
    ['check', dartPath, swiftPath, '--baseline', 'baseline.json'],
    readerWithBaseline('['.repeat(100_000)),
  );

  assert.equal(result.exitCode, 2);
  assert.equal(
    result.standardError,
    'The baseline file is not valid JSON; regenerate it with '
    + 'check --update-baseline.\n',
  );
});

test('항목 상한을 넘는 베이스라인은 쓰지 않고 실패한다', async () => {
  const base = {
    format: 'bridge-facts',
    version: 1,
    tool: { name: 'test-tool', version: '1.0.0' },
    generatedAt: '2026-09-08T00:00:00.000Z',
    project: '/fixture',
    limitations: [],
  };
  const inputs = new Map([
    ['many.json', JSON.stringify({
      ...base,
      platform: 'dart',
      target: 'flutter',
      facts: Array.from({ length: 10_001 }, (_, index) => ({
        kind: 'channel-create',
        channel: `dev.isthmus/c${index}`,
        dynamic: false,
        location: { path: 'lib/many.dart', line: index + 1, column: 1 },
      })),
    })],
    ['empty-swift.json', JSON.stringify({
      ...base,
      platform: 'swift',
      target: null,
      facts: [],
    })],
  ]);
  let didWrite = false;
  const result = await runCheckCommand(
    ['check', 'many.json', 'empty-swift.json', '--update-baseline', 'out.json'],
    async (path) => {
      const text = inputs.get(path);
      if (text === undefined) throw new Error('missing');
      return text;
    },
    async () => {
      didWrite = true;
    },
    () => new Date('2026-09-08T01:02:03.000Z'),
  );

  assert.equal(result.exitCode, 2);
  assert.equal(result.standardOutput, '');
  assert.equal(
    result.standardError,
    'Cannot write a baseline with more than 10000 entries; '
    + 'narrow the join inputs.\n',
  );
  assert.equal(didWrite, false);
});
