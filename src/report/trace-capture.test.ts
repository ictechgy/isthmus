import assert from 'node:assert/strict';
import test from 'node:test';

import { parseBridgeFactsDocument } from '../exchange/parse.ts';
import { parseTraceContext, type TraceAnalysis } from '../exchange/trace-context.ts';
import {
  analysisSymbolsInFiles,
  buildCaptureContext,
  chunkCaptureRoots,
  collectCaptureRoots,
  DEFAULT_MAX_ROOTS_PER_RUN,
  DEFAULT_STEP_TIMEOUT_SECONDS,
  expandCaptureArgument,
  isSurfaceLabel,
  listedSymbolsInFiles,
  orderCapturedMembers,
  pairsDocumentIndexes,
  parseLibraryPublicSymbols,
  parseLibrarySymbolMap,
  parseSymbolListing,
  parseTraceCaptureConfig,
  planCaptureRoots,
  planLibraryRoots,
  provisionalSurface,
  resolveCaptureLibrary,
  rootArguments,
  selectedCaptureFiles,
  selectedSymbols,
  surfaceDocumentIndexes,
  TraceCaptureValidationError,
  unresolvedTraversalRoots,
  type CapturedMember,
} from './trace-capture.ts';
import type { TraversalGraph } from '../exchange/language-traversal.ts';

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
  rejects((config) => { config.members[0].documents = 'routes.json'; }, /1 to 256 documents/u);
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

/** 합성 사실 문서다. `extra.tool`로 생산자 이름을 바꿀 수 있다. */
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
  assert.deepEqual(planCaptureRoots(documents, 'reverse', 'js'), { roots: ['r'], declarationNamespace: [], notInListing: [] });
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

test('심볼 목록은 파일 선택용 member 필드이고 platform마다 명령 또는 사전 계산 파일 하나다', () => {
  const input = baseConfig();
  input.members[0].listings = [
    { platform: 'js', tool: 'tsograph', args: ['graph', '--project', '{project}'] },
    { platform: 'kotlin', precomputed: { root: 'work', path: 'ci/snapshot.json' } },
    { platform: 'python', precomputed: { root: 'work', path: 'ci/pythograph-graph.json' } },
  ];
  const config = parseTraceCaptureConfig(input);
  assert.deepEqual(config.members[0]!.listings, [
    { platform: 'js', step: { tool: 'tsograph', args: ['graph', '--project', '{project}'], timeoutSeconds: DEFAULT_STEP_TIMEOUT_SECONDS, acceptExitCodes: [0] } },
    { platform: 'kotlin', precomputed: { root: 'work', path: 'ci/snapshot.json' } },
    { platform: 'python', precomputed: { root: 'work', path: 'ci/pythograph-graph.json' } },
  ]);
  assert.deepEqual(parseTraceCaptureConfig(baseConfig()).members[0]!.listings, []);
  const listing = { platform: 'js', tool: 'tsograph', args: [] };
  rejects((value) => { value.members[0].listings = {}; }, /listings must be a list/);
  rejects((value) => { value.members[0].listings = [listing, listing]; }, /more than one listing for a platform/);
  rejects((value) => { value.members[0].listings = [{ ...listing, platform: 'sql' }]; }, /language platform/);
  rejects((value) => { value.members[0].listings = [{ platform: 'js' }]; }, /exactly one of tool/);
  rejects((value) => { value.members[0].listings = [{ platform: 'js', precomputed: { root: 'work', path: 'a.json' }, args: [] }]; }, /no command fields/);
  rejects((value) => { value.members[0].listings = [{ ...listing, roots: 'arguments' }]; }, /listing of capture member 1 has an unknown field/);
  rejects((value) => { value.members[0].listings = [{ ...listing, tool: 'ghost' }]; }, /undeclared tool/);
  rejects((value) => { value.members[0].listings = ['x']; }, /must be an object/);
});

test('생산자 심볼 목록 세 형식을 project 상대 파일로 읽고 확정 못 한 위치는 센다', () => {
  const tsograph = parseSymbolListing({ format: 'tsograph-graph', version: 1, project: '/work/app', nodes: [
    { id: 'src/a.ts#f', location: { path: 'src/a.ts', line: 1, column: 1 } },
    { id: 'src/a.ts#<module>' },
  ] }, 'js', '/work/app');
  assert.deepEqual(tsograph, { format: 'tsograph-graph', symbols: [{ usr: 'src/a.ts#f', path: 'src/a.ts' }], skipped: 1,
    ids: ['src/a.ts#<module>', 'src/a.ts#f'] });
  const plain = parseSymbolListing({ format: 'kartograph-query-snapshot', version: 1, graph: { nodes: [
    { usr: 'method:A#f()V', location: { path: 'app/src/A.kt', line: 3 } },
    { usr: 'method:B#g()V', location: { path: 'B.kt', line: 1 } },
  ] } }, 'kotlin', '/work/app');
  assert.deepEqual(plain.symbols, [{ usr: 'method:A#f()V', path: 'app/src/A.kt' }]);
  assert.equal(plain.skipped, 1);
  assert.deepEqual(plain.ids, ['method:A#f()V', 'method:B#g()V']);
  const compact = parseSymbolListing({ format: 'kartograph-query-snapshot', version: 2, graph: {
    stringTable: ['method:A#f()V', 'f', 'app/src/A.kt', 'B.kt', 'method:B#g()V'],
    nodes: [[0, 1, null, null, null, [2, 3, 1], null, null, [], [], [], [], null, false],
      [4, 1, null, null, null, [3, 1, 1], null, null, [], [], [], [], null, false],
      [4, 1, null, null, null, null, null, null, [], [], [], [], null, false]] } }, 'kotlin', '/work/app');
  assert.deepEqual(compact.symbols, [{ usr: 'method:A#f()V', path: 'app/src/A.kt' }]);
  assert.equal(compact.skipped, 2);
  assert.deepEqual(compact.ids, ['method:A#f()V', 'method:B#g()V']);
  const cartograph = parseSymbolListing({ tool: 'cartograph', version: '0.22.0', level: 'symbol', nodes: [
    { id: 's:1A', usr: 's:1A', location: { path: '/work/app/Sources/A.swift', line: 1, column: 1 }, isExternal: false },
    { id: 's:1B', location: { path: '/work/app/Sources/B.swift', line: 1, column: 1 }, isExternal: false },
    { id: 's:ext', usr: 's:ext', location: { path: '/sdk/UIKit.swift', line: 1, column: 1 }, isExternal: true },
    { id: 's:out', usr: 's:out', location: { path: '/work/application/C.swift', line: 1, column: 1 }, isExternal: false },
    { id: 'bad\u0007id', isExternal: true },
  ] }, 'swift', '/work/app');
  assert.deepEqual(cartograph.symbols, [{ usr: 's:1A', path: 'Sources/A.swift' }, { usr: 's:1B', path: 'Sources/B.swift' }]);
  assert.equal(cartograph.skipped, 3);
  // 외부 심볼·project 밖 심볼도 그래프 노드라 ids에는 남는다(파일에 놓지 못할 뿐이다).
  assert.deepEqual(cartograph.ids, ['s:1A', 's:1B', 's:ext', 's:out']);
});

test('모르는 목록 형식·다른 project·어긋난 platform·잘못된 id는 거부한다', () => {
  const graph = { format: 'tsograph-graph', version: 1, project: '/work/app', nodes: [] };
  const cases: Array<[unknown, string, RegExp]> = [
    [[], 'js', /not a JSON object/],
    [{ format: 'code-graph', nodes: [] }, 'js', /Unsupported symbol listing/],
    [{ tool: 'cartograph', level: 'module', nodes: [] }, 'swift', /Unsupported symbol listing/],
    [{ ...graph, project: '/work/other' }, 'js', /different project/],
    [{ ...graph, version: 2 }, 'js', /tsograph-graph version 1/],
    [graph, 'kotlin', /cannot describe platform kotlin/],
    [{ ...graph, nodes: [{ id: 7, location: { path: 'a.ts' } }] }, 'js', /no valid symbol id/],
    [{ format: 'kartograph-query-snapshot', version: 3, graph: { nodes: [] } }, 'kotlin', /version 1 or 2/],
    [{ format: 'kartograph-query-snapshot', version: 2, graph: { nodes: [] } }, 'kotlin', /stringTable/],
    [{ tool: 'cartograph', level: 'symbol' }, 'swift', /nodes list/],
  ];
  for (const [value, platform, pattern] of cases) {
    assert.throws(() => parseSymbolListing(value, platform as never, '/work/app'), pattern);
  }
});

test('파일 선택의 member별 파일과, 목록·분석이 그 파일에 둔 심볼을 모은다', () => {
  const single = parseTraceContext({ format: 'isthmus-trace-context', version: 1, project: '/p', documents: ['a.json'],
    analyses: [], selection: { files: ['src/b.ts', 'src/a.ts'] } });
  assert.deepEqual(selectedCaptureFiles(single, undefined), ['src/a.ts', 'src/b.ts']);
  assert.deepEqual(selectedCaptureFiles(single, 'app'), []);
  const workspace = parseTraceContext({ format: 'isthmus-trace-context', version: 1, links: [], members: [
    { name: 'a', project: '/a', revision: 'r', documents: ['a.json'] }, { name: 'b', project: '/b', revision: 'r', documents: ['b.json'] }],
    selection: { files: [{ member: 'a', path: 'x.ts' }, { member: 'b', path: 'y.ts' }] } });
  assert.deepEqual(selectedCaptureFiles(workspace, 'b'), ['y.ts']);
  assert.deepEqual(selectedCaptureFiles({ ...single, selection: { routes: [{ method: 'GET', template: '/' }] } }, undefined), []);

  const listing = { format: 'tsograph-graph' as const, skipped: 0, ids: [], symbols: [
    { usr: 'b', path: 'src/a.ts' }, { usr: 'a', path: 'src/a.ts' }, { usr: 'a', path: 'src/a.ts' }, { usr: 'c', path: 'src/other.ts' }] };
  assert.deepEqual([...listedSymbolsInFiles(listing, ['src/a.ts', 'src/b.ts'])], [['src/a.ts', ['a', 'b']]]);
  const graph = (roots: unknown[], reached: unknown[]) => ({ graph: { roots, reached } }) as unknown as TraceAnalysis;
  const located = analysisSymbolsInFiles([
    graph([{ id: 'r', symbol: { usr: 'r', location: { path: 'src/a.ts' } } }, { id: 'n' }, { id: 'u', symbol: { usr: 'u' } }],
      [{ symbol: { usr: 'h', location: { path: 'src/a.ts' } } }, { symbol: { usr: 'z', location: { path: 'src/z.ts' } } }, { symbol: { usr: 'q' } }]),
  ], ['src/a.ts']);
  assert.deepEqual([...located], [['src/a.ts', ['h', 'r']]]);
});

test('목록이 찾은 파일 심볼은 context fileSymbols로 싣고, 없으면 필드를 쓰지 않는다', () => {
  const input = baseConfig();
  input.selection = { files: ['src/a.ts'] };
  const config = parseTraceCaptureConfig(input);
  const member: CapturedMember = { name: 'app', project: '/work/app', revision: 'rev-1',
    documents: [{ name: 'routes.json', path: 'app/documents/routes.json' }], analyses: [] };
  assert.equal('fileSymbols' in buildCaptureContext(config, [member]), false);
  const context = buildCaptureContext(config, [member], [{ path: 'src/a.ts', platform: 'js', usrs: ['a'] }]);
  assert.deepEqual(context.fileSymbols, [{ path: 'src/a.ts', platform: 'js', usrs: ['a'] }]);
  assert.deepEqual(parseTraceContext(context).fileSymbols, [{ path: 'src/a.ts', platform: 'js', usrs: ['a'] }]);
});

/** tsograph schema가 내는 모양의 persistence 문서다: 선언 쪽 relation-use(#model:·#typedsql:)와 코드의 사용. */
function schemaFacts(tool: string) {
  const use = (usr: string, path: string, extra: Record<string, unknown> = {}) => ({ kind: 'relation-use', channel: 'jobs',
    dynamic: false, location: { path, line: 1, column: 1 }, symbol: { qualifiedName: usr, usr }, ...extra });
  return facts('js', 'persistence', [
    use('prisma/schema.prisma#model:Job', 'prisma/schema.prisma'),
    use('prisma/schema.prisma#model:Job.title', 'prisma/schema.prisma', { method: 'title' }),
    use('prisma/sql/byTitle.sql#typedsql:byTitle', 'prisma/sql/byTitle.sql'),
    use('src/lib/jobs.ts#listJobs', 'src/lib/jobs.ts'),
    use('src/lib/jobs.ts#saveJob', 'src/lib/jobs.ts'),
  ], { tool: { name: tool, version: '0.1.0' } });
}

test('root 위생: 생산자가 밝힌 선언 이름공간 relation-use는 언어 순회 root에서 뺀다', () => {
  const documents = [schemaFacts('tsograph')];
  assert.deepEqual(planCaptureRoots(documents, 'reverse', 'js'), {
    roots: ['src/lib/jobs.ts#listJobs', 'src/lib/jobs.ts#saveJob'],
    declarationNamespace: ['prisma/schema.prisma#model:Job', 'prisma/schema.prisma#model:Job.title',
      'prisma/sql/byTitle.sql#typedsql:byTitle'],
    notInListing: [],
  });
  assert.deepEqual(collectCaptureRoots(documents, 'reverse', 'js'), ['src/lib/jobs.ts#listJobs', 'src/lib/jobs.ts#saveJob']);
  // 표식은 마지막 `#` 뒤에서만 본다 — 파일 경로에 표식 문자열이 든 소스 심볼은 빼지 않는다.
  const pathLike = facts('js', 'persistence', [{ kind: 'relation-use', channel: 'jobs', dynamic: false,
    location: { path: 'src/db#model:legacy.ts', line: 1, column: 1 },
    symbol: { qualifiedName: 'src/db#model:legacy.ts#query', usr: 'src/db#model:legacy.ts#query' } }],
  { tool: { name: 'tsograph', version: '0.1.0' } });
  assert.deepEqual(planCaptureRoots([pathLike], 'reverse', 'js'),
    { roots: ['src/db#model:legacy.ts#query'], declarationNamespace: [], notInListing: [] });
  // 표식은 그 생산자가 밝힌 것만 쓴다 — 다른 생산자의 같은 문자열은 추측해 빼지 않는다.
  assert.equal(planCaptureRoots([schemaFacts('synthetic')], 'reverse', 'js').roots.length, 5);
  // 사용자가 직접 고른 심볼은 거르지 않는다(노드가 아니면 생산자의 root-not-found로 드러나야 한다).
  const selected = planCaptureRoots(documents, 'reverse', 'js', ['prisma/schema.prisma#model:Job']);
  assert.ok(selected.roots.includes('prisma/schema.prisma#model:Job'));
  assert.equal(selected.declarationNamespace.includes('prisma/schema.prisma#model:Job'), false);
});

test('root 위생: 생산자 목록을 받았으면 목록에 없는 사실 usr를 빼고, 선택·sql은 거르지 않는다', () => {
  const documents = [schemaFacts('tsograph')];
  const nodes = new Set(['src/lib/jobs.ts#listJobs', 'src/lib/helper.ts#load']);
  assert.deepEqual(planCaptureRoots(documents, 'reverse', 'js', ['src/lib/helper.ts#load', 'src/lib/ghost.ts#x'], nodes), {
    roots: ['src/lib/ghost.ts#x', 'src/lib/helper.ts#load', 'src/lib/jobs.ts#listJobs'],
    declarationNamespace: ['prisma/schema.prisma#model:Job', 'prisma/schema.prisma#model:Job.title',
      'prisma/sql/byTitle.sql#typedsql:byTitle'],
    notInListing: ['src/lib/jobs.ts#saveJob'],
  });
  const sql = facts('sql', 'persistence', [
    { kind: 'relation-decl', channel: 'main.jobs', dynamic: false, symbol: { qualifiedName: 'main.jobs', usr: 'main.jobs' } },
  ]);
  assert.deepEqual(planCaptureRoots([sql], 'db-dependents', 'sql', [], new Set()).roots, ['main.jobs']);
});

test('root-not-found: symbol 없는 root와 truncationReasons가 모두 있고 넘긴 id일 때만 인정한다', () => {
  const graph = (roots: unknown[], reasons: string[], source = 'language-traversal') =>
    ({ source, roots, truncationReasons: reasons }) as unknown as TraversalGraph;
  const roots = [{ id: 'a', symbol: { usr: 'a' } }, { id: 'z' }, { id: 'b' }];
  const none = { roots: [], unrequested: [] };
  assert.deepEqual(unresolvedTraversalRoots(graph(roots, ['root-not-found']), ['a', 'b', 'z']), { roots: ['b', 'z'], unrequested: [] });
  assert.deepEqual(unresolvedTraversalRoots(graph(roots, ['depth']), ['a', 'b', 'z']), none);
  assert.deepEqual(unresolvedTraversalRoots(graph(roots, ['root-not-found'], 'kartograph-impact'), ['a', 'b', 'z']), none);
  assert.deepEqual(unresolvedTraversalRoots(graph(roots, ['root-not-found']), ['a', 'b']), { roots: ['b'], unrequested: ['z'] });
  assert.deepEqual(unresolvedTraversalRoots(graph([{ id: 'a', symbol: { usr: 'a' } }], ['root-not-found']), ['a']), none);
});

/** surface·library를 쓰는 workspace 설정이다(provider sdk, consumer app, 가져온 surface api). */
function libraryConfig(): Record<string, any> {
  const input = baseConfig();
  input.members[0].name = 'sdk';
  input.members.unshift({ name: 'api', surface: { path: { root: 'work', path: 'vendor/api.surface.json' }, sha256: 'a'.repeat(64) } });
  input.members.push({ name: 'app', project: { root: 'work', path: 'app' }, revision: 'a-1', documents: [],
    analyses: [{ id: 'app-reverse', platform: 'kotlin', role: 'reverse', tool: 'tsograph', args: ['impact'], roots: 'roots-from' }] });
  input.links = [{ name: 'sdk->api', client: 'sdk', server: 'api', match: { hosts: ['api.example.com'] }, contract: { member: 'api' } }];
  input.libraries = [{ name: 'app<-sdk', consumer: 'app', provider: 'sdk', ids: 'symbol-map',
    symbolMap: { root: 'work', path: 'maps/app.json' }, publicSymbols: ['p1'] }];
  input.selection = { routes: [{ method: 'GET', template: '/api/users/{}' }] };
  return input;
}

/** library 설정의 한 곳을 바꾼 결과가 원하는 문구로 거부되는지 본다. */
function rejectsLibrary(mutate: (config: Record<string, any>) => void, pattern: RegExp): void {
  const config = libraryConfig();
  mutate(config);
  assert.throws(() => parseTraceCaptureConfig(config), (error: unknown) => {
    assert.ok(error instanceof TraceCaptureValidationError);
    assert.match(error.message, pattern);
    return true;
  });
}

test('surface member(가져오기·내보내기)와 library를 설정 순서·파일 참조와 함께 받는다', () => {
  const input = libraryConfig();
  input.members.push({ name: 'published', surface: { export: { member: 'sdk', name: 'orders-api', includeHandlerUsrs: true } } });
  const config = parseTraceCaptureConfig(input);
  assert.equal(config.workspace, true);
  assert.deepEqual(config.memberOrder, ['api', 'sdk', 'app', 'published']);
  assert.deepEqual(config.members.map(({ name }) => name), ['sdk', 'app']);
  assert.deepEqual(config.surfaces, [
    { name: 'api', surface: { kind: 'import', path: { root: 'work', path: 'vendor/api.surface.json' }, sha256: 'a'.repeat(64) } },
    { name: 'published', surface: { kind: 'export', member: 'sdk', name: 'orders-api', includeHandlerUsrs: true, includeLimitationText: false } },
  ]);
  assert.deepEqual(config.libraries[0]!.symbolMap, { root: 'work', path: 'maps/app.json' });
  assert.deepEqual(config.libraries[0]!.publicSymbols, ['p1']);
  // library 하나만 있어도 workspace다(문서 member가 하나여도).
  const single = baseConfig();
  single.members.push({ name: 'app', project: { root: 'work', path: 'app' }, revision: 'a', documents: [] });
  single.libraries = [{ name: 'l', consumer: 'app', provider: 'app0', ids: 'shared' }];
  single.members[0].name = 'app0';
  assert.equal(parseTraceCaptureConfig(single).libraries[0]!.publicSymbols, undefined);
});

test('surface member와 library의 설정 위반을 거부한다', () => {
  rejectsLibrary((config) => { config.members[0].project = { root: 'work' }; }, /takes only name and surface/u);
  rejectsLibrary((config) => { config.members[0].name = 'logs'; }, /collides with a capture output entry/u);
  rejectsLibrary((config) => { config.members[0].surface = 'x'; }, /needs surface \{path, sha256\} or \{export\}/u);
  rejectsLibrary((config) => { config.members[0].surface.export = { member: 'sdk' }; }, /either \{path, sha256\} or \{export\}/u);
  rejectsLibrary((config) => { config.members[0].surface.extra = 1; }, /surface takes path and sha256/u);
  rejectsLibrary((config) => { config.members[0].surface.sha256 = 'A'.repeat(64); }, /lowercase hex sha256/u);
  rejectsLibrary((config) => { config.members[0].surface.path = { root: 'work', path: '.env' }; }, /secret-like/u);
  rejectsLibrary((config) => { config.members[0].surface.path = { root: 'work', path: '../x.json' }; }, /without \.\./u);
  rejectsLibrary((config) => { config.members[0].surface.path = { root: 'nope', path: 'x.json' }; }, /undeclared root/u);
  rejectsLibrary((config) => { config.members[0].surface = { export: 'sdk' }; }, /export must be an object/u);
  rejectsLibrary((config) => { config.members[0].surface = { export: { member: 'sdk', flags: [] } }; }, /export has an unknown field/u);
  rejectsLibrary((config) => { config.members[0].surface = { export: {} }; }, /export needs member/u);
  rejectsLibrary((config) => { config.members[0].surface = { export: { member: 'nobody' } }; }, /must name a document member/u);
  rejectsLibrary((config) => {
    config.members.push({ name: 'again', surface: { export: { member: 'api' } } });
  }, /must name a document member/u);
  for (const name of ['--include-handler-usrs', ' padded', 'a\nb', '', 'x'.repeat(257)]) {
    rejectsLibrary((config) => { config.members[0].surface = { export: { member: 'sdk', name } }; }, /export name must be/u);
  }
  rejectsLibrary((config) => { config.members[0].surface = { export: { member: 'sdk', revision: '-r' } }; }, /export revision must be/u);
  rejectsLibrary((config) => { config.members[0].surface = { export: { member: 'sdk', includeHandlerUsrs: 'yes' } }; }, /must be a boolean/u);
  rejectsLibrary((config) => { config.members = [config.members[0]]; }, /at least one document member/u);
  rejectsLibrary((config) => { config.members[1].name = 'api'; }, /member names must be unique/u);
  // 선택·link·library는 trace 규칙으로 미리 검증한다: surface는 link client나 선택 대상이 될 수 없다.
  rejectsLibrary((config) => { config.links[0].client = 'api'; config.links[0].server = 'sdk'; }, /violate the trace context contract/u);
  rejectsLibrary((config) => { config.selection = { symbols: [{ member: 'api', platform: 'js', usr: 'x' }] }; },
    /violate the trace context contract/u);

  rejectsLibrary((config) => { config.libraries = {}; }, /libraries must be a list/u);
  rejectsLibrary((config) => { config.libraries = ['x']; }, /library 1 must be an object/u);
  rejectsLibrary((config) => { config.libraries[0].extra = 1; }, /library 1 has an unknown field/u);
  rejectsLibrary((config) => { delete config.libraries[0].provider; }, /needs name, consumer and provider/u);
  rejectsLibrary((config) => { delete config.libraries[0].ids; }, /never lined up by guesswork/u);
  rejectsLibrary((config) => { config.libraries[0].ids = 'shared'; }, /"shared" takes no symbolMap/u);
  rejectsLibrary((config) => { delete config.libraries[0].symbolMap; }, /"symbol-map" needs a symbolMap/u);
  rejectsLibrary((config) => { config.libraries[0].symbolMap = { root: 'work', path: 'keys/id_rsa' }; }, /secret-like/u);
  rejectsLibrary((config) => { config.libraries[0].publicSymbols = { root: 'work', path: 'a\u0001.json' }; }, /control characters/u);
  rejectsLibrary((config) => { config.libraries[0].symbolMap = [{ provider: 'p' }]; }, /\{provider, consumer\} strings/u);
  rejectsLibrary((config) => { config.libraries[0].publicSymbols = ['a', 'a']; }, /distinct ids/u);
  rejectsLibrary((config) => { config.libraries[0].provider = 'api'; }, /violate the trace context contract/u);
  rejectsLibrary((config) => { config.libraries[0].consumer = 'sdk'; config.libraries[0].provider = 'app'; },
    /only a library consumer may have none/u);
});

test('library 목록 파서와 surface 이름 규칙', () => {
  assert.deepEqual(parseLibraryPublicSymbols(['b', 'a']), ['b', 'a']);
  for (const value of [[], 'a', [1], ['a\u0000'], ['a', 'a']]) assert.throws(() => parseLibraryPublicSymbols(value), /publicSymbols/u);
  assert.deepEqual(parseLibrarySymbolMap([{ provider: 'p', consumer: 'c' }]), [{ provider: 'p', consumer: 'c' }]);
  for (const value of [[], {}, [{ provider: 'p', consumer: 'c', extra: 1 }], [{ provider: 'p', consumer: 1 }]]) {
    assert.throws(() => parseLibrarySymbolMap(value), /symbolMap/u);
  }
  assert.throws(() => parseLibrarySymbolMap([{ provider: 'p', consumer: 'a' }, { provider: 'p', consumer: 'b' }]), /must be unique/u);
  assert.equal(isSurfaceLabel('v2.4'), true);
  for (const value of ['-v', ' v', 'v ', '', 7, undefined, 'x'.repeat(257)]) assert.equal(isSurfaceLabel(value), false);
});

test('library 목록 풀기, surface 자리값, 설정 순서 합치기와 context 조립', () => {
  const config = parseTraceCaptureConfig(libraryConfig());
  const library = resolveCaptureLibrary(config.libraries[0]!, { symbolMap: [{ provider: 'p1', consumer: 'c1' }] });
  assert.deepEqual(library, { name: 'app<-sdk', consumer: 'app', provider: 'sdk', ids: 'symbol-map', publicSymbols: ['p1'],
    symbolMap: [{ provider: 'p1', consumer: 'c1' }] });
  const shared = resolveCaptureLibrary({ name: 's', consumer: 'app', provider: 'sdk', ids: 'shared',
    publicSymbols: { root: 'work', path: 'p.json' } }, { publicSymbols: ['x'] });
  assert.deepEqual(shared.publicSymbols, ['x']);
  assert.equal(resolveCaptureLibrary({ name: 's', consumer: 'app', provider: 'sdk', ids: 'shared' }, {}).publicSymbols, undefined);
  assert.deepEqual(provisionalSurface({ name: 'api' }), { name: 'api', surface: { path: 'api/http-surface.json', sha256: '0'.repeat(64) } });

  const members: CapturedMember[] = config.members.map(({ name }) => ({ name, project: `/work/${name}`, revision: 'r',
    documents: name === 'sdk' ? [{ name: 'routes.json', path: 'sdk/documents/routes.json' }] : [], analyses: [] }));
  const surface = { name: 'api', surface: { path: 'api/http-surface.json', sha256: 'b'.repeat(64) } };
  const ordered = orderCapturedMembers(config, members, [surface]);
  assert.deepEqual(ordered.map(({ name }) => name), ['api', 'sdk', 'app']);
  const context = buildCaptureContext(config, ordered, [], [library, shared]);
  assert.deepEqual((context.members as unknown[])[0], surface);
  // surface contract는 문서 경로가 없으므로 그대로 둔다. symbol-map의 capture 전용 publicSymbols는 싣지 않는다.
  assert.deepEqual((context.links as Array<Record<string, unknown>>)[0]!.contract, { member: 'api' });
  assert.deepEqual(context.libraries, [
    { name: 'app<-sdk', consumer: 'app', provider: 'sdk', ids: 'symbol-map', symbolMap: [{ provider: 'p1', consumer: 'c1' }] },
    { name: 's', consumer: 'app', provider: 'sdk', ids: 'shared', publicSymbols: ['x'] },
  ]);
  const withDocuments = { ...config, links: [{ name: 'l', client: 'sdk', server: 'api', match: { hosts: ['a.example'] },
    contract: { member: 'api', documents: ['x.json'] } }] };
  assert.deepEqual((buildCaptureContext(withDocuments, ordered).links as Array<Record<string, any>>)[0]!.contract.documents, ['x.json']);
  assert.equal(buildCaptureContext(config, ordered).libraries, undefined);
});

test('surface로 내보낼 문서는 선언 측 http 문서와 openapi 문서뿐이다', () => {
  const server = facts('js', 'http', [decl('h')], { roles: ['server'], dispatch: 'specificity' });
  const client = facts('kotlin', 'http', [
    { kind: 'route-call', channel: '/a', method: 'GET', dynamic: false, pathAnchor: 'root', ...at, symbol: { qualifiedName: 'k', usr: 'k' } },
  ], { roles: ['client'] });
  const spec = facts('openapi', null, []);
  const persistence = facts('js', 'persistence', [
    { kind: 'relation-use', channel: 'users', dynamic: false, ...at, symbol: { qualifiedName: 'r', usr: 'r' } },
  ]);
  assert.deepEqual(surfaceDocumentIndexes([client, server, persistence, spec]), [1, 3]);
});

test('library root: provider 호출부와 그 호출부에서 닿은 SDK 심볼을 선언대로 consumer id로 옮긴다', () => {
  const call = (usr: string, extra: Record<string, unknown> = {}) => ({ kind: 'route-call', channel: '/a', method: 'GET',
    dynamic: false, pathAnchor: 'root', ...at, symbol: { qualifiedName: usr, usr }, ...extra });
  const sdk = facts('kotlin', 'http', [call('call:get'), call('call:post'), call('call:test', { testSource: true }),
    { kind: 'route-call', channel: '/b', method: 'GET', dynamic: false, pathAnchor: 'root', ...at }], { roles: ['client'], sourceSets: { tests: 'included' } });
  const js = facts('js', 'http', [call('js:call')], { roles: ['client'] });
  const spec = facts('openapi', null, []);
  const analysis = (platform: string, roots: readonly unknown[], reached: readonly unknown[], rootsTruncated = false, role = 'reverse') =>
    ({ platform, role, graph: { roots, reached, rootsTruncated } }) as unknown as TraceAnalysis;
  const reverse = analysis('kotlin', [{ id: 'call:get', symbol: { usr: 'call:get' } }, { id: 'rel:use', symbol: { usr: 'rel:use' } },
    { id: 'call:post' }], [
    { symbol: { usr: 'pub:get' }, roots: [0] }, { symbol: { usr: 'internal:rel' }, roots: [1] }, { symbol: { usr: 'pub:post' }, roots: [2] }]);
  const forward = analysis('kotlin', [{ id: 'call:get', symbol: { usr: 'call:get' } }], [{ symbol: { usr: 'fwd' }, roots: [0] }], false, 'forward');
  const shared = { name: 'l', consumer: 'app', provider: 'sdk', ids: 'shared' as const };
  const plans = planLibraryRoots(shared, [spec, sdk, js], [reverse, forward]);
  // symbol 없는 root(call:post — 생산자가 찾지 못함)에서 닿은 것처럼 보이는 정점과 relation-use root에서 닿은 정점은 뺀다.
  assert.deepEqual(plans, [
    { platform: 'js', callSites: 1, candidates: 1, roots: ['js:call'], notPublic: 0, missingMapEntries: [], providerAnalyses: 0 },
    { platform: 'kotlin', callSites: 2, candidates: 3, roots: ['call:get', 'call:post', 'pub:get'], notPublic: 0, missingMapEntries: [],
      providerAnalyses: 1 },
  ]);
  const exported = planLibraryRoots({ ...shared, publicSymbols: ['pub:get', 'pub:post'] }, [sdk], [reverse]);
  assert.deepEqual([exported[0]!.roots, exported[0]!.notPublic], [['pub:get'], 2]);
  // root 목록이 잘린 문서는 어느 root에서 닿았는지 모르므로 도달 정점 전부를 후보로 둔다.
  const truncated = analysis('kotlin', reverse.graph.roots, reverse.graph.reached, true);
  assert.deepEqual(planLibraryRoots(shared, [sdk], [truncated])[0]!.roots,
    ['call:get', 'call:post', 'internal:rel', 'pub:get', 'pub:post']);
  const mapped = planLibraryRoots({ name: 'm', consumer: 'app', provider: 'sdk', ids: 'symbol-map',
    symbolMap: [{ provider: 'pub:get', consumer: 'app:get' }], publicSymbols: ['pub:get', 'pub:post', 'call:post'] }, [sdk], [truncated]);
  assert.deepEqual([mapped[0]!.roots, mapped[0]!.notPublic, mapped[0]!.missingMapEntries], [['app:get'], 4, ['call:post', 'pub:post']]);
  const unmapped = planLibraryRoots({ name: 'm', consumer: 'app', provider: 'sdk', ids: 'symbol-map',
    symbolMap: [{ provider: 'other', consumer: 'app:other' }] }, [sdk], [reverse]);
  assert.deepEqual([unmapped[0]!.roots, unmapped[0]!.missingMapEntries], [[], []]);
  assert.deepEqual(planLibraryRoots(shared, [spec], []), []);
});
