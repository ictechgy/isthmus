import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createMcpSession } from './mcp-server.ts';

const dartPath = fileURLToPath(
  new URL('../../experiments/phase-0/expected/dart.json', import.meta.url),
);
const swiftPath = fileURLToPath(
  new URL('../../experiments/phase-0/expected/swift.json', import.meta.url),
);

const session = createMcpSession({
  readTextFile: (path) => readFile(path, 'utf8'),
  producerVersion: '0.0.0-test',
});

function request(id: number, method: string, params?: unknown): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id,
    method,
    ...(params === undefined ? {} : { params }),
  });
}

test('initialize는 지원하는 프로토콜 버전을 그대로 협상한다', async () => {
  const response = JSON.parse(
    (await session.handleLine(
      request(1, 'initialize', {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0' },
      }),
    ))!,
  );

  assert.equal(response.id, 1);
  assert.equal(response.result.protocolVersion, '2025-03-26');
  assert.equal(response.result.serverInfo.name, 'isthmus');
  assert.equal(response.result.serverInfo.version, '0.0.0-test');
  assert.deepEqual(response.result.capabilities, { tools: {} });
});

test('initialize는 모르는 프로토콜 버전에 최신 지원 버전을 제안한다', async () => {
  const response = JSON.parse(
    (await session.handleLine(
      request(2, 'initialize', { protocolVersion: '1999-01-01' }),
    ))!,
  );

  assert.equal(response.result.protocolVersion, '2025-06-18');
});

test('알림은 응답을 만들지 않는다', async () => {
  const response = await session.handleLine(
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    }),
  );

  assert.equal(response, undefined);
});

test('JSON 파싱 실패는 -32700을 돌려준다', async () => {
  const response = JSON.parse((await session.handleLine('{not json'))!);

  assert.equal(response.id, null);
  assert.equal(response.error.code, -32700);
});

test('배치 요청은 -32600으로 거부한다', async () => {
  const response = JSON.parse(
    (await session.handleLine(JSON.stringify([request(1, 'ping')])))!,
  );

  assert.equal(response.error.code, -32600);
});

test('모르는 메서드는 -32601을 돌려준다', async () => {
  const response = JSON.parse(
    (await session.handleLine(request(3, 'resources/list')))!,
  );

  assert.equal(response.id, 3);
  assert.equal(response.error.code, -32601);
});

test('tools/list는 모든 도구와 입력 스키마를 나열한다', async () => {
  const response = JSON.parse(
    (await session.handleLine(request(4, 'tools/list')))!,
  );

  const names = response.result.tools.map(
    (tool: { name: string }) => tool.name,
  );
  assert.deepEqual(names, [
    'check',
    'query',
    'graph',
    'diff',
    'impact',
    'preflight',
    'retentions',
    'trace',
  ]);
  for (const tool of response.result.tools) {
    assert.equal(tool.inputSchema.type, 'object');
    assert.equal(tool.inputSchema.additionalProperties, false);
  }
});

test('tools/call check는 실제 문서의 보고서를 텍스트로 돌려준다', async () => {
  const response = JSON.parse(
    (await session.handleLine(
      request(5, 'tools/call', {
        name: 'check',
        arguments: { documents: [dartPath, swiftPath] },
      }),
    ))!,
  );

  assert.equal(response.id, 5);
  assert.equal(response.result.isError, false);
  const report = JSON.parse(response.result.content[0].text);
  assert.equal(report.format, 'isthmus-check');
  assert.equal(report.summary.matchedChannels, 1);
});

test('tools/call query의 notFound는 문서를 실은 정상 응답이다', async () => {
  const response = JSON.parse(
    (await session.handleLine(
      request(6, 'tools/call', {
        name: 'query',
        arguments: {
          name: 'no/such/channel',
          documents: [dartPath, swiftPath],
        },
      }),
    ))!,
  );

  assert.equal(response.result.isError, false);
  const query = JSON.parse(response.result.content[0].text);
  assert.equal(query.status, 'notFound');
});

test('tools/call query는 relation:<name>을 CLI와 같은 persistence 관계 질의로 답한다', async () => {
  const fixture = (name: string) =>
    fileURLToPath(new URL(`../../fixtures/domain-composition/${name}`, import.meta.url));
  const response = JSON.parse(
    (await session.handleLine(
      request(61, 'tools/call', {
        name: 'query',
        arguments: {
          name: 'relation:users',
          documents: [fixture('kotlin-persistence.json'), fixture('sql.json')],
        },
      }),
    ))!,
  );

  assert.equal(response.result.isError, false);
  const query = JSON.parse(response.result.content[0].text);
  assert.deepEqual([query.status, query.level, query.result.subject.qualifiedName],
    ['found', 'persistence', 'relation:public.users']);
});

test('tools/call의 잘못된 인자는 -32602를 돌려준다', async () => {
  const response = JSON.parse(
    (await session.handleLine(
      request(7, 'tools/call', {
        name: 'check',
        arguments: { documents: [dartPath] },
      }),
    ))!,
  );

  assert.equal(response.error.code, -32602);
});

test('모르는 도구는 -32602를 돌려준다', async () => {
  const response = JSON.parse(
    (await session.handleLine(
      request(8, 'tools/call', { name: 'explode', arguments: {} }),
    ))!,
  );

  assert.equal(response.error.code, -32602);
});

test('impact는 selector가 정확히 하나일 때만 argv를 만든다', async () => {
  const noSelector = JSON.parse(
    (await session.handleLine(
      request(9, 'tools/call', {
        name: 'impact',
        arguments: { documents: [dartPath, swiftPath] },
      }),
    ))!,
  );
  assert.equal(noSelector.error.code, -32602);

  const twoSelectors = JSON.parse(
    (await session.handleLine(
      request(10, 'tools/call', {
        name: 'impact',
        arguments: {
          documents: [dartPath, swiftPath],
          file: 'lib/a.dart',
          symbol: 'Foo.bar',
        },
      }),
    ))!,
  );
  assert.equal(twoSelectors.error.code, -32602);
});

test('tools/call의 명령 실패는 문서 없이 isError로 표시한다', async () => {
  const response = JSON.parse(
    (await session.handleLine(
      request(11, 'tools/call', {
        name: 'check',
        arguments: { documents: [dartPath, '/nonexistent/missing.json'] },
      }),
    ))!,
  );

  assert.equal(response.result.isError, true);
  assert.equal(response.result.content.length >= 1, true);
});

test('MCP의 kartograph 선택은 Swift 대상에 고정되지 않고 Kotlin 입력을 요구한다', async () => {
  const response = JSON.parse((await session.handleLine(request(112, 'tools/call', {
    name: 'retentions', arguments: { documents: [dartPath, swiftPath], producer: 'kartograph' },
  })))!);
  assert.equal(response.error, undefined);
  assert.equal(response.result.isError, true);
  assert.match(response.result.content[0].text, /require at least one kotlin/u);
});

const preflightContextPath = fileURLToPath(
  new URL('../../fixtures/preflight/context.json', import.meta.url),
);

test('tools/call의 나머지 도구도 실제 명령 경로로 실행된다', async () => {
  const cases: [number, string, Record<string, unknown>, (r: any) => void][] = [
    [20, 'graph', { documents: [dartPath, swiftPath], format: 'mermaid' },
      (result) => assert.match(result.content[0].text, /graph|bridge/)],
    [21, 'diff', { before: [dartPath, swiftPath], after: [dartPath, swiftPath] },
      (result) => assert.equal(JSON.parse(result.content[0].text).format, 'isthmus-diff')],
    [22, 'impact', { documents: [dartPath, swiftPath], file: 'lib/screen.dart' },
      (result) => assert.equal(JSON.parse(result.content[0].text).format, 'isthmus-impact')],
    [23, 'preflight', { context: preflightContextPath },
      (result) => assert.equal(JSON.parse(result.content[0].text).format, 'isthmus-preflight')],
    [24, 'retentions', { documents: [dartPath, swiftPath], producer: 'cartograph' },
      (result) => assert.equal(JSON.parse(result.content[0].text).format, 'external-retentions')],
  ];
  for (const [id, name, args, verify] of cases) {
    const response = JSON.parse(
      (await session.handleLine(request(id, 'tools/call', { name, arguments: args })))!,
    );
    assert.equal(response.error, undefined, `${name} failed: ${JSON.stringify(response)}`);
    assert.equal(response.result.isError, false, `${name} marked as error`);
    verify(response.result);
  }
});

test('광고된 스키마 밖의 인자는 -32602로 거부한다', async () => {
  const invalidCases: [number, string, Record<string, unknown>][] = [
    // 미지 키 — additionalProperties: false
    [30, 'check', { documents: [dartPath, swiftPath], out: 'x.json' }],
    // enum 밖 값 — 조용히 기본값으로 떨어지지 않아야 한다
    [31, 'graph', { documents: [dartPath, swiftPath], format: 'png' }],
    // 정수 범위 밖
    [32, 'preflight', { context: 'context.json', limit: 0 }],
    [33, 'preflight', { context: 'context.json', limit: 101 }],
    [34, 'preflight', { context: 'context.json', limit: 1.5 }],
    // 타입 위반
    [35, 'check', { documents: [dartPath, swiftPath], strict: 'yes' }],
    [36, 'query', { name: 'x', documents: [dartPath] }],
    // 필수 인자 누락
    [37, 'query', { documents: [dartPath, swiftPath] }],
    [38, 'retentions', { documents: [dartPath, swiftPath] }],
    [39, 'trace', {}],
    [42, 'trace', { context: 'context.json', maxRows: 0 }],
    [43, 'trace', { context: 'context.json', maxChains: 1001 }],
    [44, 'trace', { context: '' }],
    [45, 'trace', { context: 'context.json', pairs: true }],
    [46, 'trace', { context: 'context.json', upstreamDepth: 9 }],
    [47, 'trace', { context: 'context.json', upstreamDepth: 1.5 }],
  ];
  for (const [id, name, args] of invalidCases) {
    const response = JSON.parse(
      (await session.handleLine(request(id, 'tools/call', { name, arguments: args })))!,
    );
    assert.equal(response.error?.code, -32602, `${name} ${JSON.stringify(args)}`);
    assert.equal(response.id, id);
  }
});

test('명령 실행의 내부 예외는 -32603으로 돌려주고 세션을 유지한다', async () => {
  // 명령은 자체 오류를 CommandResult로 변환하므로, 이 경계는 보고서 계층이나
  // 의존성 배선의 예상 밖 예외를 잡는다 — 던지는 getter로 그 경로를 검증한다.
  const failing = createMcpSession({
    get readTextFile(): never {
      throw new Error('dependency wiring exploded');
    },
    producerVersion: '0.0.0-test',
  } as never);
  const failed = JSON.parse(
    (await failing.handleLine(
      request(40, 'tools/call', {
        name: 'check',
        arguments: { documents: [dartPath, swiftPath] },
      }),
    ))!,
  );
  assert.equal(failed.error.code, -32603);
  assert.equal(failed.id, 40);

  const alive = JSON.parse((await failing.handleLine(request(41, 'ping')))!);
  assert.equal(alive.id, 41);
  assert.deepEqual(alive.result, {});
});

test('거절 응답은 검출 가능한 스칼라 id를 에코한다', async () => {
  const echoed = JSON.parse(
    (await session.handleLine(
      JSON.stringify({ jsonrpc: '2.0', id: 77, params: {} }),
    ))!,
  );
  assert.equal(echoed.error.code, -32600);
  assert.equal(echoed.id, 77);

  const nonScalar = JSON.parse(
    (await session.handleLine(
      JSON.stringify({ jsonrpc: '2.0', id: { bad: true }, method: 'ping' }),
    ))!,
  );
  assert.equal(nonScalar.error.code, -32600);
  assert.equal(nonScalar.id, null);
});

test('도구의 경로 인자가 `-`로 시작해도 경로로만 읽고 스키마에 없는 CLI 플래그를 열지 않는다', async () => {
  // 읽은 경로를 기록해 플래그로 소비됐는지 가린다. MCP에는 쓰기 도구가 없으므로 주입된 writer는 불리면 안 된다.
  const fixtures = new Map([
    [dartPath, await readFile(dartPath, 'utf8')],
    [swiftPath, await readFile(swiftPath, 'utf8')],
  ]);
  const reads: string[] = [];
  const writes: string[] = [];
  const guarded = createMcpSession({
    readTextFile: async (path) => {
      reads.push(path);
      const text = fixtures.get(path);
      if (text === undefined) throw new Error('missing fixture');
      return text;
    },
    writeTextFile: async (path) => { writes.push(path); },
    producerVersion: '0.0.0-test',
  });
  const bridgeInput = (position: number) => new RegExp(`^Unable to read bridge facts input ${position};`, 'u');
  const cases: [string, Record<string, unknown>, string, RegExp][] = [
    ['check', { documents: ['--update-baseline', 'baseline.json', dartPath, swiftPath] }, '--update-baseline', bridgeInput(1)],
    ['check', { documents: [dartPath, swiftPath, '--update-baseline', 'baseline.json'] }, '--update-baseline', bridgeInput(3)],
    ['check', { documents: ['--baseline', 'baseline.json', dartPath, swiftPath] }, '--baseline', bridgeInput(1)],
    ['check', { documents: ['--format', 'sarif', dartPath, swiftPath] }, '--format', bridgeInput(1)],
    ['check', { documents: ['--pairs', dartPath, swiftPath] }, '--pairs', bridgeInput(1)],
    ['check', { documents: ['--', dartPath, swiftPath] }, '--', bridgeInput(1)],
    ['graph', { documents: ['--format', 'dot', dartPath, swiftPath] }, '--format', bridgeInput(1)],
    ['impact', { documents: ['--runtime', 'runtime.json', dartPath, swiftPath], file: 'lib/a.dart' }, '--runtime',
      bridgeInput(1)],
    ['retentions', { documents: ['--for', 'kartograph', dartPath, swiftPath], producer: 'cartograph' }, '--for',
      bridgeInput(1)],
    ['preflight', { context: '--strict' }, '--strict', /^Unable to read preflight context;/u],
    ['trace', { context: '--compact' }, '--compact', /^Unable to read the trace context;/u],
  ];
  for (const [index, [name, args, flag, message]] of cases.entries()) {
    reads.length = 0;
    const response = JSON.parse(
      (await guarded.handleLine(request(200 + index, 'tools/call', { name, arguments: args })))!,
    );
    const label = `${name} ${JSON.stringify(args)}`;
    assert.equal(response.result?.isError, true, label);
    assert.ok(reads.includes(flag), `${label} reads ${flag} as a path`);
    assert.match(response.result.content[0].text, message, label);
  }
  assert.deepEqual(writes, []);

  // query 이름도 위치 인수다. `-`로 시작하는 이름은 사용법 오류가 아니라 찾지 못한 이름으로 답한다.
  const query = JSON.parse((await guarded.handleLine(request(250, 'tools/call', {
    name: 'query', arguments: { name: '--strict', documents: [dartPath, swiftPath] },
  })))!);
  assert.equal(query.result.isError, false);
  assert.equal(JSON.parse(query.result.content[0].text).status, 'notFound');
});

test('tools/call diff는 before·after에 합계 상한 하나와 전체 입력 순번을 적용해 isError로 알린다', async () => {
  // 파일마다 파일 상한(16Mi)과 같은 길이다. 합계 64Mi는 after의 세 번째, 전체 다섯 번째 입력에서 넘는다.
  const [dart, swift] = (await Promise.all([readFile(dartPath, 'utf8'), readFile(swiftPath, 'utf8')]))
    .map((text) => text.padEnd(16 * 1024 * 1024, ' '));
  const contents = new Map([['b1', dart!], ['b2', swift!], ['a1', dart!], ['a2', swift!], ['a3', dart!], ['broken', '{']]);
  const diffSession = createMcpSession({
    readTextFile: async (path) => contents.get(path)!,
    producerVersion: '0.0.0-test',
  });
  const call = async (id: number, after: readonly string[]) => JSON.parse((await diffSession.handleLine(
    request(id, 'tools/call', { name: 'diff', arguments: { before: ['b1', 'b2'], after } }),
  ))!);
  const overBudget = await call(260, ['a1', 'a2', 'a3']);
  assert.equal(overBudget.result.isError, true);
  assert.match(overBudget.result.content[0].text, /^Bridge facts input 5 exceeds the input size limits;/u);
  const broken = await call(261, ['broken', 'a2']);
  assert.equal(broken.result.isError, true);
  assert.match(broken.result.content[0].text, /^Bridge facts input 3 is not valid JSON;/u);
});

test('tools/call trace는 기본 출력 상한을 적용하고 CLI와 같은 문서를 돌려준다', async () => {
  const contextPath = fileURLToPath(new URL('../../fixtures/trace/context.json', import.meta.url));
  const call = async (id: number, args: Record<string, unknown>) => JSON.parse(
    (await session.handleLine(request(id, 'tools/call', { name: 'trace', arguments: args })))!,
  );
  const defaults = await call(50, { context: contextPath });
  assert.equal(defaults.result.isError, false);
  const report = JSON.parse(defaults.result.content[0].text);
  assert.equal(report.format, 'isthmus-trace');
  assert.deepEqual([report.truncation.maxChains, report.truncation.maxRows], [10, 25]);
  const narrow = await call(51, { context: contextPath, maxRows: 1, maxChains: 1, strict: true, compact: true });
  const narrowed = JSON.parse(narrow.result.content[0].text);
  assert.equal(narrow.result.content[0].text.trim().split('\n').length, 1);
  assert.equal(narrowed.truncation.truncated, true);
  assert.deepEqual(narrowed.summary, report.summary);
  const missing = await call(52, { context: '/nonexistent/context.json' });
  assert.equal(missing.result.isError, true);
  // upstreamDepth는 CLI --upstream-depth로 넘어가 보고서에 깊이가 실린다.
  const deeper = JSON.parse((await call(53, { context: contextPath, upstreamDepth: 3 })).result.content[0].text);
  assert.equal(deeper.upstreamDepth, 3);
});
