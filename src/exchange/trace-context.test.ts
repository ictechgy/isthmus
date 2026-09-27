import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  analysisProject,
  normalizeTraceAnalysis,
  parseTraceContext,
  TraceContextValidationError,
  type TraceAnalysisReference,
} from './trace-context.ts';
import { TraversalValidationError } from './language-traversal.ts';

const fixture = (name: string) => readFile(new URL(`../../fixtures/trace/${name}`, import.meta.url), 'utf8')
  .then((text) => JSON.parse(text));
const context = await fixture('context.json');

test('trace context를 검증하고 선택을 결정적 순서로 정규화한다', () => {
  const parsed = parseTraceContext(context);
  assert.equal(parsed.project, '/work/trace-example');
  assert.equal(parsed.revision, 'rev-1');
  assert.equal(parsed.analyses.length, 4);
  const routes = parseTraceContext({ ...context, revision: undefined, selection: { routes: [
    { method: 'POST', template: '/b' }, { method: 'ANY', template: '/a', scope: 'svc' }, { method: 'GET', template: '/a' },
  ] } });
  assert.equal(routes.revision, undefined);
  assert.deepEqual(routes.selection, { routes: [
    { method: 'GET', template: '/a' }, { method: 'POST', template: '/b' }, { method: 'ANY', template: '/a', scope: 'svc' },
  ] });
  assert.deepEqual(parseTraceContext({ ...context, selection: { relations: ['b', 'a'] } }).selection, { relations: ['a', 'b'] });
  assert.deepEqual(parseTraceContext({ ...context, selection: { symbols: [{ platform: 'kotlin', usr: 'k' }, { platform: 'js', usr: 'j' }] } })
    .selection, { symbols: [{ platform: 'js', usr: 'j' }, { platform: 'kotlin', usr: 'k' }] });
});

test('맨 workspace 매니페스트는 trace context로 옮기라는 원인과 함께 거부한다', () => {
  assert.throws(() => parseTraceContext({ format: 'isthmus-workspace', version: 1, members: [] }), /bare isthmus-workspace manifest/);
});

test('잘못된 context·선택을 거부한다', () => {
  const mutations: Array<(value: any) => void> = [
    (value) => { value.version = 2; },
    (value) => { value.members = []; },
    (value) => { value.project = ''; },
    (value) => { value.revision = 3; },
    (value) => { value.documents = []; },
    (value) => { value.documents = ['a.json', 'a.json']; },
    (value) => { value.analyses = {}; },
    (value) => { value.analyses[0].extra = 1; },
    (value) => { value.analyses[1].id = value.analyses[0].id; },
    (value) => { value.analyses[0].platform = 'openapi'; },
    (value) => { value.analyses[0].role = 'sideways'; },
    (value) => { value.analyses[0].path = ''; },
    (value) => { value.selection = []; },
    (value) => { value.selection = { routes: [{ method: 'GET', template: '/a' }], relations: ['x'] }; },
    (value) => { value.selection = { files: ['/abs/a.ts'] }; },
    (value) => { value.selection = { files: ['../a.ts'] }; },
    (value) => { value.selection = { files: [{ member: 'server', path: 'a.ts' }] }; },
    (value) => { value.selection = { relations: [{ member: 'server', name: 'users' }] }; },
    (value) => { value.selection = { symbols: [{ member: 'server', platform: 'js', usr: 'a' }] }; },
    (value) => { value.analyses[0].precomputed = { sha256: 'A'.repeat(64), revision: 'r' }; },
    (value) => { value.analyses[0].precomputed = { sha256: 'a'.repeat(64) }; },
    (value) => { value.analyses[0].precomputed = { sha256: 'a'.repeat(64), revision: 'r', generatedAt: 'yesterday' }; },
    (value) => { value.analyses[0].precomputed = { sha256: 'a'.repeat(64), revision: 'r', extra: 1 }; },
    (value) => { value.selection = { routes: [] }; },
    (value) => { value.selection = { routes: [{ method: 'get', template: '/a' }] }; },
    (value) => { value.selection = { routes: [{ method: 'GET', template: '/a/{id}' }] }; },
    (value) => { value.selection = { routes: [{ method: 'GET', template: 'a' }] }; },
    (value) => { value.selection = { routes: [{ method: 'GET', template: '/a', scope: '' }] }; },
    (value) => { value.selection = { routes: [{ method: 'GET', template: '/a', extra: 1 }] }; },
    (value) => { value.selection = { routes: [{ method: 'GET', template: '/a' }, { method: 'GET', template: '/a' }] }; },
    (value) => { value.selection = { relations: [''] }; },
    (value) => { value.selection = { symbols: [{ platform: 'sql', usr: 'main.users' }] }; },
    (value) => { value.selection = { symbols: [{ platform: 'js' }] }; },
    (value) => { value.selection = { symbols: [{ platform: 'js', usr: 'a', extra: 1 }] }; },
  ];
  for (const mutate of mutations) {
    const value = structuredClone(context);
    mutate(value);
    assert.throws(() => parseTraceContext(value), TraceContextValidationError);
  }
  assert.throws(() => parseTraceContext(null), TraceContextValidationError);
});

const reference = (id: string, platform: TraceAnalysisReference['platform'], role: TraceAnalysisReference['role']) =>
  ({ id, platform, role, path: `${id}.json` });

test('분석 형식을 감지해 정규화하고 context 선언과 대조한다', async () => {
  const forward = await fixture('server-forward.json');
  const db = await fixture('db-dependents.json');
  const project = context.project as string;
  assert.equal(normalizeTraceAnalysis(forward, reference('f', 'js', 'forward'), project).graph.source, 'language-traversal');
  assert.equal(normalizeTraceAnalysis(db, reference('d', 'sql', 'db-dependents'), project).graph.source, 'language-traversal');
  for (const [raw, entry, pattern] of [
    [forward, reference('f', 'js', 'reverse'), /dependents traversal/],
    [forward, reference('f', 'kotlin', 'forward'), /platform differs/],
    [{ ...forward, project: '/other' }, reference('f', 'js', 'forward'), /project differs/],
    [{ ...db, project: '/other' }, reference('d', 'sql', 'db-dependents'), /project differs/],
    [db, reference('d', 'sql', 'reverse'), /db-dependents/],
    [db, reference('d', 'js', 'db-dependents'), /platform differs/],
    [[], reference('x', 'js', 'reverse'), /JSON object/],
    [{ format: 'unknown' }, reference('x', 'js', 'reverse'), /Unsupported analysis format/],
  ] as const) {
    assert.throws(() => normalizeTraceAnalysis(raw, entry, project), pattern);
  }
  assert.throws(() => normalizeTraceAnalysis({ ...forward, version: 2 }, reference('f', 'js', 'forward'), project),
    TraversalValidationError);
});

test('옛 역방향 형식은 preflight 어댑터를 거쳐 reverse 역할로만 받는다', () => {
  const project = '/work/trace-example';
  const kartograph = {
    format: 'kartograph-impact', version: 1, status: 'found', inputs: { current: { revision: 'x', scope: 'fixture' } },
    changed: [{ usr: 'kt:Api.get', qualifiedName: 'Api.get', presentIn: ['current'], location: null }],
    affected: [{ usr: 'kt:Screen', qualifiedName: 'Screen', presentIn: ['current'], location: { path: `${project}/a/Screen.kt`, line: 4 },
      pathStatus: 'complete', pathOmissions: [], paths: [{ revision: 'current', changed: 'kt:Api.get', nodes: ['kt:Screen', 'kt:Api.get'],
        edges: [{ source: 'kt:Screen', target: 'kt:Api.get', kind: 'call', origin: 'bytecode', traversal: 'dependency' }] }] }],
    unresolved: [], limitations: [], truncated: { results: false, depth: false, budget: false },
  };
  const graph = normalizeTraceAnalysis(kartograph, reference('k', 'kotlin', 'reverse'), project).graph;
  assert.equal(graph.source, 'kartograph-impact');
  assert.deepEqual(graph.reached[0]?.symbol.location, { path: 'a/Screen.kt', line: 4 });
  const cartograph = { format: 'change-impact', version: 1, level: 'symbol', changeScope: [{ usr: 's:Api', qualifiedName: 'Api' }],
    affected: [{ symbol: { usr: 's:View', qualifiedName: 'View' }, depth: 1, via: 's:Api', relationship: 'call' }],
    limitations: [], truncated: false };
  assert.equal(normalizeTraceAnalysis(cartograph, reference('c', 'swift', 'reverse'), project).graph.source, 'change-impact');
  const dartograph = { version: 1, changed: { symbols: ['d:Api'], libraries: [] },
    impacted: [{ id: 'd:Screen', depth: 1, path: ['d:Screen', 'd:Api'] }], limitations: [], truncated: 0 };
  assert.equal(normalizeTraceAnalysis(dartograph, reference('d', 'dart', 'reverse'), project).graph.source, 'dartograph-impact');
  assert.throws(() => normalizeTraceAnalysis(kartograph, reference('k', 'kotlin', 'forward'), project), /dependencies traversal/);
  assert.throws(() => normalizeTraceAnalysis(cartograph, reference('c', 'kotlin', 'reverse'), project), /platform differs/);
  assert.throws(() => normalizeTraceAnalysis({ ...kartograph, version: 9 }, reference('k', 'kotlin', 'reverse'), project),
    /Invalid producer impact analysis/);
});

const workspaceContext = JSON.parse(await readFile(new URL('../../fixtures/trace-workspace/context.json', import.meta.url), 'utf8'));

test('workspace context는 member·link를 검증하고 문서·분석을 member 순서로 펼친다', () => {
  const parsed = parseTraceContext(workspaceContext);
  assert.equal(parsed.project, undefined);
  assert.deepEqual(parsed.workspace?.members.map(({ name, revision }) => [name, revision]),
    [['server', 'srv-7f3c2a1'], ['server-spec', 'srv-7f3c2a1'], ['client', 'cli-41d9e0b']]);
  assert.deepEqual(parsed.documents, ['server/server.http.json', 'server/server.persistence.json', 'server/db.sql.json',
    'server/api.openapi.json', 'client/android.http.json', 'client/ios.http.json']);
  assert.deepEqual(parsed.analyses.map(({ id, member }) => [id, member]), [['server-forward', 'server'], ['server-reverse', 'server'],
    ['server-db', 'server'], ['android-reverse', 'client'], ['ios-reverse', 'client']]);
  assert.equal(parsed.analyses[4]?.precomputed?.revision, 'cli-41d9e0b');
  assert.deepEqual(parsed.workspace?.links[0]?.contract, { member: 'server-spec', documents: ['server/api.openapi.json'],
    authoritative: true });
  assert.equal(analysisProject(parsed, parsed.analyses[3]!), '/work/example-client');
  const relations = parseTraceContext({ ...workspaceContext, selection: { relations: [
    { member: 'server', name: 'orders' }, { member: 'client', name: 'cache' }] } });
  assert.deepEqual(relations.selection, { relations: [{ member: 'client', name: 'cache' }, { member: 'server', name: 'orders' }] });
  const symbols = parseTraceContext({ ...workspaceContext, selection: { symbols: [{ member: 'client', platform: 'kotlin', usr: 'k' }] } });
  assert.deepEqual(symbols.selection, { symbols: [{ member: 'client', platform: 'kotlin', usr: 'k' }] });
  const empty = parseTraceContext({ ...workspaceContext, links: [] });
  assert.deepEqual(empty.workspace?.links, []);
  const noAnalyses = structuredClone(workspaceContext);
  delete noAnalyses.members[2].analyses;
  assert.equal(parseTraceContext(noAnalyses).analyses.length, 3);
});

test('workspace context의 잘못된 member·link·선택을 원인과 함께 거부한다', () => {
  const cases: Array<[(value: any) => void, RegExp]> = [
    [(value) => { value.project = '/work'; }, /move project/],
    [(value) => { value.members = []; }, /members must be a list/],
    [(value) => { value.members = {}; }, /members must be a list/],
    [(value) => { value.members[0].extra = 1; }, /Invalid workspace member entry/],
    [(value) => { value.members[0] = 'server'; }, /Invalid workspace member entry/],
    [(value) => { delete value.members[0].revision; }, /needs a revision/],
    [(value) => { value.members[0].documents = []; }, /at least one bridge-facts document/],
    [(value) => { value.members[1].name = 'server'; }, /names must be unique/],
    [(value) => { value.members[1].documents = ['server/db.sql.json']; }, /unique across members/],
    [(value) => { value.members[2].analyses[0].id = 'server-forward'; }, /ids must be unique/],
    [(value) => { value.members[2].analyses[0].path = 'server/server-forward.json'; }, /unique paths/],
    [(value) => { value.members[0].catalog = {}; }, /Invalid workspace member catalog/],
    [(value) => { value.members[0].catalog = { graphSha: '' }; }, /Invalid catalog graphSha/],
    [(value) => { value.members[0].catalog = { source: 3 }; }, /Invalid catalog source/],
    [(value) => { value.links = {}; }, /links must be a list/],
    [(value) => { delete value.links; }, /links must be a list/],
    [(value) => { value.links[0].extra = 1; }, /Invalid workspace link entry/],
    [(value) => { value.links[0].client = 'nobody'; }, /must name members/],
    [(value) => { value.links.push(structuredClone(value.links[0])); }, /link names must be unique/],
    [(value) => { delete value.links[0].match; }, /needs a match object/],
    [(value) => { value.links[0].match = {}; }, /at least one host, service or baseRef/],
    [(value) => { value.links[0].match = { hosts: [] }; }, /at least one host, service or baseRef/],
    [(value) => { value.links[0].match.interfaces = ['kt:Api']; }, /interfaces is not implemented/],
    [(value) => { value.links[0].match.urls = ['x']; }, /Invalid workspace link match field/],
    [(value) => { value.links[0].match.hosts = ['API.example.com']; }, /lowercase host/],
    [(value) => { value.links[0].match.hosts = ['https://api.example.com']; }, /lowercase host/],
    [(value) => { value.links[0].match.hosts = ['a.example', 'a.example']; }, /must not repeat/],
    [(value) => { value.links[0].match.hosts = 'api.example.com'; }, /Invalid workspace link match list/],
    [(value) => { value.links[0].match.services = ['']; }, /Invalid link match service/],
    [(value) => { value.links[0].match.baseRefs = [{ ref: 'r', pathPrefix: '/v1' }]; }, /pathPrefix/],
    [(value) => { value.links[0].match.baseRefs = [{ ref: 'r', extra: 1 }]; }, /Invalid link match baseRef field/],
    [(value) => { value.links[0].match.baseRefs = ['r']; }, /Invalid link match baseRef\./],
    [(value) => { value.links[0].contract = { member: 'server-spec', documents: [] }; }, /contract documents must be non-empty/],
    [(value) => { value.links[0].contract.documents = ['client/ios.http.json']; }, /listed in the contract member/],
    [(value) => { value.links[0].contract.member = 'nobody'; }, /contract member must name a member/],
    [(value) => { value.links[0].contract.authoritative = 'yes'; }, /authoritative flag/],
    [(value) => { value.links[0].contract.extra = 1; }, /Invalid workspace link contract\./],
    [(value) => { value.selection = { relations: ['orders'] }; }, /\{member, name\} objects/],
    [(value) => { value.selection = { relations: [{ member: 'server' }] }; }, /Invalid relation selection/],
    [(value) => { value.selection = { relations: [{ member: 'nobody', name: 'orders' }] }; }, /must name a workspace member/],
    [(value) => { value.selection = { symbols: [{ platform: 'js', usr: 'a' }] }; }, /need a member/],
  ];
  for (const [mutate, pattern] of cases) {
    const value = structuredClone(workspaceContext);
    mutate(value);
    assert.throws(() => parseTraceContext(value), pattern, pattern.source);
  }
});

test('사전 계산 artifact의 증언 revision은 문서 revision이 없을 때만 쓰고, 다르면 거부한다', async () => {
  const forward = await fixture('server-forward.json');
  const precomputed = { sha256: 'a'.repeat(64), revision: 'rev-1', generatedAt: '2026-09-26T00:00:00Z' };
  const entry = { ...reference('f', 'js', 'forward'), precomputed };
  const same = normalizeTraceAnalysis(forward, entry, '/work/trace-example');
  assert.equal(same.revision, 'rev-1');
  assert.equal(same.revisionAttested, undefined);
  const { revision: _revision, ...unrevised } = forward;
  const attested = normalizeTraceAnalysis(unrevised, entry, '/work/trace-example');
  assert.equal(attested.revision, 'rev-1');
  assert.equal(attested.revisionAttested, true);
  assert.throws(() => normalizeTraceAnalysis(forward, { ...entry, precomputed: { ...precomputed, revision: 'rev-0' } },
    '/work/trace-example'), /contradicts its precomputed revision/);
});
