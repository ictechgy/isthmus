import assert from 'node:assert/strict';
import test from 'node:test';

import { parseBridgeFactsDocument } from '../exchange/parse.ts';
import { parseTraceContext } from '../exchange/trace-context.ts';
import {
  buildCaptureContext,
  chunkCaptureRoots,
  collectCaptureRoots,
  DEFAULT_MAX_ROOTS_PER_RUN,
  DEFAULT_STEP_TIMEOUT_SECONDS,
  expandCaptureArgument,
  pairsDocumentIndexes,
  parseTraceCaptureConfig,
  rootArguments,
  selectedSymbols,
  TraceCaptureValidationError,
  type CapturedMember,
} from './trace-capture.ts';

/** 최소 단일 project 설정이다. 각 테스트가 복사해 한 곳만 바꾼다. */
function baseConfig(): Record<string, any> {
  return {
    format: 'isthmus-trace-capture', version: 1,
    roots: { work: '/work', tools: '/opt/tools' },
    output: { root: 'work', path: 'out' },
    tools: { tsograph: { command: ['tsograph'], source: { root: 'tools', path: 'tsograph' } } },
    members: [{
      name: 'app', project: { root: 'work', path: 'app' }, revision: 'rev-1',
      documents: [
        { name: 'routes.json', tool: 'tsograph', args: ['routes', '--role', 'server', '--project', '{project}'] },
        { name: 'contract.json', precomputed: { root: 'work', path: 'ci/contract.json' } },
      ],
      analyses: [
        { id: 'forward', platform: 'js', role: 'forward', tool: 'tsograph', args: ['reach', '--project', '{project}'], roots: 'arguments' },
        { id: 'ios', platform: 'swift', role: 'reverse', precomputed: { path: { root: 'work', path: 'ci/ios.json' }, revision: 'r', generatedAt: '2026-09-27T00:00:00Z' } },
      ],
    }],
    selection: { routes: [{ method: 'GET', template: '/api/users/{}' }] },
  };
}

/** 한 곳을 바꾼 설정이 원하는 문구로 거부되는지 본다. */
function rejects(mutate: (config: Record<string, any>) => void, pattern: RegExp): void {
  const config = baseConfig();
  mutate(config);
  assert.throws(() => parseTraceCaptureConfig(config), (error: unknown) => {
    assert.ok(error instanceof TraceCaptureValidationError);
    assert.match(error.message, pattern);
    return true;
  });
}

test('단일 project 설정을 기본값과 함께 정규화한다', () => {
  const config = parseTraceCaptureConfig(baseConfig());
  assert.equal(config.workspace, false);
  assert.equal(config.trace, true);
  assert.deepEqual(config.members[0]!.documents[0]!.step, {
    tool: 'tsograph', args: ['routes', '--role', 'server', '--project', '{project}'],
    timeoutSeconds: DEFAULT_STEP_TIMEOUT_SECONDS, acceptExitCodes: [0],
  });
  assert.equal(config.members[0]!.analyses[0]!.step!.maxRootsPerRun, DEFAULT_MAX_ROOTS_PER_RUN);
  assert.deepEqual(config.members[0]!.analyses[1]!.precomputed,
    { path: { root: 'work', path: 'ci/ios.json' }, revision: 'r', generatedAt: '2026-09-27T00:00:00Z' });
  assert.deepEqual(config.tools.tsograph, { command: ['tsograph'], source: { root: 'tools', path: 'tsograph' } });
});

test('선택 필드(generatedAt·trace·git revision·catalog·timeouts)를 받는다', () => {
  const input = baseConfig();
  Object.assign(input, { generatedAt: '2026-09-27T00:00:00Z', trace: false });
  input.members[0].revision = { git: true };
  Object.assign(input.members[0].analyses[0], { timeoutSeconds: 30, acceptExitCodes: [0, 64], maxRootsPerRun: 5, roots: 'roots-from' });
  input.members[0].documents[0].args.push({ root: 'work', path: 'wrappers.json' }, '');
  input.members.push({ name: 'client', project: { root: 'work' }, revision: 'c', catalog: { graph: { root: 'work', path: 'graph.json' }, source: 'db' },
    documents: [{ name: 'client.json', tool: 'tsograph', args: [] }] });
  input.links = [{ name: 'mobile', client: 'client', server: 'app', match: { services: ['api'] } }];
  const config = parseTraceCaptureConfig(input);
  assert.equal(config.workspace, true);
  assert.equal(config.trace, false);
  assert.equal(config.generatedAt, '2026-09-27T00:00:00Z');
  assert.deepEqual(config.members[0]!.revision, { git: true });
  assert.deepEqual(config.members[1]!.catalog, { graph: { root: 'work', path: 'graph.json' }, source: 'db' });
  assert.deepEqual(config.members[1]!.project, { root: 'work' });
  const { step } = config.members[0]!.analyses[0]!;
  assert.deepEqual([step!.timeoutSeconds, step!.acceptExitCodes, step!.maxRootsPerRun, step!.roots], [30, [0, 64], 5, 'roots-from']);
});

test('형식·root·경로 참조 위반을 거부한다', () => {
  assert.throws(() => parseTraceCaptureConfig([]), /JSON object/u);
  rejects((config) => { config.version = 2; }, /version 1/u);
  rejects((config) => { config.extra = true; }, /unknown field/u);
  rejects((config) => { config.roots = {}; }, /1 to 16/u);
  rejects((config) => { config.roots = []; }, /map root names/u);
  rejects((config) => { config.roots = { '1bad': '/x' }; }, /start with a letter/u);
  rejects((config) => { config.roots = { work: '/a/../b' }; }, /absolute POSIX/u);
  rejects((config) => { config.output = { root: 'work' }; }, /subdirectory of its root/u);
  rejects((config) => { config.output = { root: 'work', path: 'out', extra: 1 }; }, /Invalid output path reference/u);
  rejects((config) => { config.output = { root: 'nope', path: 'out' }; }, /undeclared root/u);
  rejects((config) => { config.output = { root: 'work', path: '../out' }; }, /without \.\./u);
  rejects((config) => { config.output = { root: 'work', path: 'a\\b' }; }, /backslashes/u);
  for (const secret of ['.env', '.env.local', 'repo/.git/config', '.kube/config', 'keys/id_rsa', 'x/server.pem', '.aws/credentials', 'a/.npmrc']) {
    rejects((config) => { config.members[0].documents[1].precomputed = { root: 'work', path: secret }; }, /secret-like/u);
  }
  rejects((config) => { config.generatedAt = 'yesterday'; }, /generatedAt/u);
});

test('도구·member·문서·분석 위반을 거부한다', () => {
  rejects((config) => { config.tools = []; }, /map tool names/u);
  rejects((config) => { config.tools = { 'bad name': { command: ['x'] } }; }, /tool names/u);
  rejects((config) => { config.tools = { t: 'x' }; }, /must be an object/u);
  rejects((config) => { config.tools = { t: { command: ['x'], shell: true } }; }, /unknown field/u);
  rejects((config) => { config.tools = { t: { command: [] } }; }, /non-empty array/u);
  rejects((config) => { config.tools = { t: { command: ['a\nb'] } }; }, /non-empty array/u);
  rejects((config) => { config.members = []; }, /1 to 64/u);
  rejects((config) => { config.members = ['x']; }, /member 1 must be an object/u);
  rejects((config) => { config.members[0].extra = 1; }, /member 1 has an unknown field/u);
  rejects((config) => { config.members[0].name = '../x'; }, /needs a name/u);
  for (const name of ['logs', 'pairs', 'trace.json']) {
    rejects((config) => { config.members[0].name = name; }, /collides with a capture output entry/u);
  }
  rejects((config) => { config.members[0].revision = 7; }, /revision must be a string/u);
  rejects((config) => { config.members[0].catalog = { graph: { root: 'work', path: 'g.json' }, extra: 1 }; }, /catalog takes graph/u);
  rejects((config) => { config.members[0].catalog = { graph: { root: 'work', path: 'g.json' } }; }, /workspace trace context/u);
  rejects((config) => { config.members[0].documents = []; }, /1 to 256 documents/u);
  rejects((config) => { config.members[0].documents.push({ ...config.members[0].documents[0] }); }, /document names must be unique/u);
  rejects((config) => { config.members[0].analyses = {}; }, /analyses must be a list/u);
  rejects((config) => { config.members.push({ ...config.members[0] }); }, /member names must be unique/u);
  rejects((config) => {
    config.members.push({ ...config.members[0], name: 'other' });
  }, /analysis ids must be unique/u);
  rejects((config) => { config.members[0].documents[0] = 'x'; }, /must be an object/u);
  rejects((config) => { config.members[0].documents[0].stdout = 'x'; }, /has an unknown field/u);
  rejects((config) => { config.members[0].documents[0].name = 'routes.txt'; }, /ending in \.json/u);
  rejects((config) => { config.members[0].documents[0].precomputed = { root: 'work', path: 'a.json' }; }, /exactly one of tool/u);
  rejects((config) => { config.members[0].documents[1].args = []; }, /takes no command fields/u);
  rejects((config) => { config.members[0].documents[0].tool = 'unknown'; }, /undeclared tool/u);
  rejects((config) => { config.members[0].documents[0].args = 'routes'; }, /args must be a list/u);
  rejects((config) => { config.members[0].documents[0].args = ['a\u0000b']; }, /control characters/u);
  rejects((config) => { config.members[0].documents[0].timeoutSeconds = 0; }, /timeoutSeconds/u);
  rejects((config) => { config.members[0].documents[0].acceptExitCodes = [0, 0]; }, /acceptExitCodes/u);
  rejects((config) => { config.members[0].documents[0].acceptExitCodes = [256]; }, /acceptExitCodes/u);
  rejects((config) => { config.members[0].analyses[0] = 'x'; }, /must be an object/u);
  rejects((config) => { config.members[0].analyses[0].extra = 1; }, /has an unknown field/u);
  rejects((config) => { config.members[0].analyses[0].id = ''; }, /Analysis ids/u);
  rejects((config) => { config.members[0].analyses[0].platform = 'openapi'; }, /unsupported platform/u);
  rejects((config) => { config.members[0].analyses[0].role = 'sideways'; }, /forward, reverse or db-dependents/u);
  rejects((config) => { config.members[0].analyses[0].role = 'db-dependents'; }, /sql role/u);
  rejects((config) => { delete config.members[0].analyses[0].tool; }, /exactly one of tool/u);
  rejects((config) => { config.members[0].analyses[1].roots = 'arguments'; }, /takes no command fields/u);
  rejects((config) => { config.members[0].analyses[0].roots = 'stdin'; }, /roots must be/u);
  rejects((config) => { config.members[0].analyses[0].maxRootsPerRun = 10_001; }, /maxRootsPerRun/u);
  rejects((config) => { config.members[0].analyses[1].precomputed = { path: { root: 'work', path: 'a' }, sha256: 'x' }; }, /takes path/u);
  rejects((config) => { config.members[0].analyses[1].precomputed.revision = ''; }, /invalid revision/u);
  rejects((config) => { config.members[0].analyses[1].precomputed.generatedAt = 'now'; }, /generatedAt/u);
  rejects((config) => { config.links = {}; }, /links must be a list/u);
  rejects((config) => { config.trace = 'yes'; }, /trace must be a boolean/u);
});

test('selection·links는 trace context 규칙으로 미리 검증한다', () => {
  rejects((config) => { config.selection = { routes: [] }; }, /violate the trace context contract/u);
  rejects((config) => { config.selection = { symbols: [{ platform: 'js', usr: 'a', member: 'app' }] }; }, /violate the trace context contract/u);
  rejects((config) => {
    config.links = [{ name: 'l', client: 'app', server: 'app', match: { services: ['s'] },
      contract: { member: 'app', documents: ['missing.json'] } }];
  }, /does not capture/u);
  rejects((config) => {
    config.links = [{ name: 'l', client: 'nobody', server: 'app', match: { services: ['s'] } }];
  }, /violate the trace context contract/u);
});

/** 합성 사실 문서다. */
function facts(platform: string, target: string | null, entries: Record<string, unknown>[], extra: Record<string, unknown> = {}) {
  return parseBridgeFactsDocument({
    format: 'bridge-facts', version: 1, tool: { name: 'synthetic', version: '0.0.0' }, generatedAt: '2026-09-27T00:00:00Z',
    platform, target, project: '/work/app', facts: entries, limitations: [], ...extra,
  });
}

const at = { location: { path: 'src/a.ts', line: 1, column: 1 } };
const decl = (usr: string | undefined, extra: Record<string, unknown> = {}) => ({
  kind: 'route-decl', channel: '/a', method: 'GET', dynamic: false, pathAnchor: 'root', ...at,
  ...(usr === undefined ? {} : { symbol: { qualifiedName: usr, usr } }), ...extra,
});

test('root는 역할별 사실 usr의 정렬된 상위 집합이고 테스트 소스는 뺀다', () => {
  const server = facts('js', 'http', [decl('b'), decl('a'), decl(undefined), decl('t', { testSource: true })],
    { roles: ['server'], dispatch: 'specificity', sourceSets: { tests: 'included' } });
  const persistence = facts('js', 'persistence', [
    { kind: 'relation-use', channel: 'users', dynamic: false, ...at, symbol: { qualifiedName: 'r', usr: 'r' } },
  ]);
  const client = facts('kotlin', 'http', [
    { kind: 'route-call', channel: '/a', method: 'GET', dynamic: false, pathAnchor: 'root', ...at, symbol: { qualifiedName: 'k', usr: 'k' } },
  ], { roles: ['client'] });
  const sql = facts('sql', 'persistence', [
    { kind: 'relation-decl', channel: 'main.users', dynamic: false, symbol: { qualifiedName: 'main.users', usr: 'main.users' } },
    { kind: 'relation-decl', channel: 'main.users', method: 'email', dynamic: false,
      symbol: { qualifiedName: 'main.users.email', usr: 'main.users.email' } },
  ]);
  const documents = [server, persistence, client, sql];
  assert.deepEqual(collectCaptureRoots(documents, 'forward', 'js'), ['a', 'b']);
  assert.deepEqual(collectCaptureRoots(documents, 'reverse', 'js', ['z', 'r']), ['r', 'z']);
  assert.deepEqual(collectCaptureRoots(documents, 'reverse', 'kotlin'), ['k']);
  assert.deepEqual(collectCaptureRoots(documents, 'db-dependents', 'sql'), ['main.users', 'main.users.email']);
  assert.deepEqual(collectCaptureRoots(documents, 'forward', 'kotlin'), []);

  assert.deepEqual(pairsDocumentIndexes(documents), [0, 1, 2, 3]);
  assert.deepEqual(pairsDocumentIndexes([server, persistence, sql]), [1, 2]);
  assert.deepEqual(pairsDocumentIndexes([server, client]), [0, 1]);
  assert.deepEqual(pairsDocumentIndexes([server, persistence]), []);
});

test('심볼 선택은 member·platform이 맞는 usr만 역방향 root에 더한다', () => {
  const single = parseTraceContext({ format: 'isthmus-trace-context', version: 1, project: '/p', documents: ['a.json'],
    analyses: [], selection: { symbols: [{ platform: 'js', usr: 'a' }, { platform: 'kotlin', usr: 'b' }] } });
  assert.deepEqual(selectedSymbols(single, undefined, 'js'), ['a']);
  const workspace = parseTraceContext({ format: 'isthmus-trace-context', version: 1,
    members: [{ name: 'm', project: '/p', revision: 'r', documents: ['a.json'] }, { name: 'n', project: '/q', revision: 'r', documents: ['b.json'] }],
    links: [], selection: { symbols: [{ member: 'm', platform: 'js', usr: 'a' }, { member: 'n', platform: 'js', usr: 'b' }] } });
  assert.deepEqual(selectedSymbols(workspace, 'n', 'js'), ['b']);
  const routes = parseTraceContext({ format: 'isthmus-trace-context', version: 1, project: '/p', documents: ['a.json'], analyses: [],
    selection: { routes: [{ method: 'GET', template: '/a' }] } });
  assert.deepEqual(selectedSymbols(routes, undefined, 'js'), []);
});

test('root 묶음은 개수와 바이트 상한을 함께 지킨다', () => {
  assert.deepEqual(chunkCaptureRoots(['a', 'b', 'c'], 2), [['a', 'b'], ['c']]);
  assert.deepEqual(chunkCaptureRoots(['aaaa', 'bbbb', 'c'], 10, 10), [['aaaa', 'bbbb'], ['c']]);
  assert.deepEqual(chunkCaptureRoots([], 5), []);
  assert.throws(() => chunkCaptureRoots(['x'.repeat(20)], 5, 10), /per-run argument budget/u);
});

test('자리표시자와 경로 참조를 풀고 root 전달 방식을 지킨다', () => {
  const values = { project: '/work/app', revision: 'abc', generatedAt: '2026-09-27T00:00:00Z' };
  const resolve = () => '/work/wrappers.json';
  assert.equal(expandCaptureArgument('--project={project}', values, resolve), '--project=/work/app');
  assert.equal(expandCaptureArgument('{revision}@{generatedAt}', values, resolve), 'abc@2026-09-27T00:00:00Z');
  assert.equal(expandCaptureArgument('/api/users/{}/{name}', values, resolve), '/api/users/{}/{name}');
  assert.equal(expandCaptureArgument({ root: 'work', path: 'wrappers.json' }, values, resolve), '/work/wrappers.json');
  assert.throws(() => expandCaptureArgument('{revision}', { project: '/p', generatedAt: 'x' }, resolve), /declares no revision/u);

  assert.deepEqual(rootArguments('arguments', ['a', 'b']), ['a', 'b']);
  assert.deepEqual(rootArguments('separator', ['-a']), ['--', '-a']);
  assert.deepEqual(rootArguments('roots-from', ['a'], '/out/roots.json'), ['--roots-from', '/out/roots.json']);
  assert.throws(() => rootArguments('roots-from', ['a']), /needs a roots file/u);
  assert.throws(() => rootArguments('arguments', ['-rf']), /producer flag/u);
});

test('수집 결과로 단일 project·workspace context를 조립한다', () => {
  const member: CapturedMember = {
    name: 'app', project: '/work/app', revision: 'rev-1',
    documents: [{ name: 'routes.json', path: 'app/documents/routes.json' }],
    analyses: [{ id: 'f', platform: 'js', role: 'forward', path: 'app/analyses/f.json',
      precomputed: { sha256: 'a'.repeat(64), revision: 'rev-1' } }],
  };
  const single = buildCaptureContext(parseTraceCaptureConfig(baseConfig()), [member]);
  assert.deepEqual(single, {
    format: 'isthmus-trace-context', version: 1, project: '/work/app', revision: 'rev-1',
    documents: ['app/documents/routes.json'],
    analyses: [{ id: 'f', platform: 'js', role: 'forward', path: 'app/analyses/f.json', precomputed: { sha256: 'a'.repeat(64), revision: 'rev-1' } }],
    selection: { routes: [{ method: 'GET', template: '/api/users/{}' }] },
  });
  const { revision: _revision, ...withoutRevision } = member;
  const unrevised = buildCaptureContext(parseTraceCaptureConfig(baseConfig()), [{ ...withoutRevision, analyses: [] }]);
  assert.equal('revision' in unrevised, false);

  const input = baseConfig();
  input.members.push({ name: 'spec', project: { root: 'work', path: 'app' }, revision: 'rev-1',
    documents: [{ name: 'api.json', tool: 'tsograph', args: [] }] });
  input.links = [
    { name: 'l', client: 'app', server: 'app', match: { services: ['s'] }, contract: { member: 'spec', documents: ['api.json'] } },
    { name: 'm', client: 'app', server: 'app', match: { services: ['t'] } },
    { name: 'n', client: 'app', server: 'app', match: { services: ['u'] }, contract: { member: 'ghost', documents: ['x'] } },
  ];
  const spec: CapturedMember = { name: 'spec', project: '/work/app', revision: 'rev-1', catalog: { graphSha: 'b'.repeat(64) },
    documents: [{ name: 'api.json', path: 'spec/documents/api.json' }], analyses: [] };
  const workspace = buildCaptureContext({ ...parseTraceCaptureConfig({ ...input, links: input.links.slice(0, 2) }), links: input.links }, [member, spec]);
  assert.deepEqual((workspace.links as any[]).map((link) => link.contract?.documents), [['spec/documents/api.json'], undefined, ['x']]);
  assert.deepEqual((workspace.members as any[])[1], { name: 'spec', project: '/work/app', revision: 'rev-1',
    catalog: { graphSha: 'b'.repeat(64) }, documents: ['spec/documents/api.json'] });
});
