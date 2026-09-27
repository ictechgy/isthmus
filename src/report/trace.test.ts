import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { parseBridgeFactsDocument } from '../exchange/parse.ts';
import { traversalGraphFromImpact } from '../exchange/language-traversal.ts';
import { normalizeTraceAnalysis, parseTraceContext, type TraceAnalysis } from '../exchange/trace-context.ts';
import { joinBridgeDocuments, BridgeJoinValidationError } from '../join/join.ts';
import { createTraceReport, hasTraceGaps, TraceInputError, type TraceInput, type TraceReport } from './trace.ts';
import { encodeSortedJson } from './sorted-json.ts';

const read = async (name: string) => JSON.parse(await readFile(new URL(`../../fixtures/trace/${name}`, import.meta.url), 'utf8'));

/** 합성 미니 프로젝트 fixture 전체다. 테스트마다 복제해 변형한다. */
const fixture = {
  context: await read('context.json'),
  docs: {
    server: await read('server.http.json'),
    persistence: await read('server.persistence.json'),
    sql: await read('db.sql.json'),
    android: await read('android.http.json'),
  } as Record<string, any>,
  analyses: {
    'server-forward': await read('server-forward.json'),
    'server-reverse': await read('server-reverse.json'),
    db: await read('db-dependents.json'),
    'android-reverse': await read('android-reverse.json'),
  } as Record<string, any>,
};

type Fixture = typeof fixture;

/** fixture를 복제·변형해 검증된 trace 입력으로 만든다. 빠진 문서·분석은 context에서도 뺀다. */
function build(mutate: (value: Fixture) => void = () => {}, extra: TraceAnalysis[] = []): TraceInput {
  const value = structuredClone(fixture);
  mutate(value);
  const context = parseTraceContext({ ...value.context,
    analyses: value.context.analyses.filter(({ id }: { id: string }) => value.analyses[id] !== undefined) });
  return {
    context,
    documents: Object.values(value.docs).filter((document) => document !== undefined).map(parseBridgeFactsDocument),
    analyses: [...context.analyses.map((reference) => normalizeTraceAnalysis(value.analyses[reference.id], reference, context.project)),
      ...extra],
  };
}

const report = (mutate?: (value: Fixture) => void, extra?: TraceAnalysis[]) => createTraceReport(build(mutate, extra));
const codes = (result: TraceReport) => [...new Set(result.gaps.map(({ code }) => code))].sort();
const select = (selection: unknown) => (value: Fixture) => { value.context.selection = selection; };

test('route 선택은 핸들러→정방향→relation-use→VertexId→DB 의존자와 route→호출→클라이언트 영향을 잇는다', () => {
  const result = report();
  assert.equal(result.complete, false);
  assert.deepEqual(result.scope, { granularity: 'route', fieldCompatibility: 'not-assessed', queryAndHeaders: 'not-assessed' });
  assert.deepEqual(result.gaps, []);
  assert.equal(hasTraceGaps(result), false);
  const [chain] = result.chains;
  assert.deepEqual(chain?.selector, { route: { method: 'GET', template: '/api/users/{}' } });
  assert.deepEqual(chain?.handlers.map(({ usr, routes }) => [usr, routes]),
    [['ts:api/users.get', [{ scope: 'default', method: 'GET', template: '/api/users/{}' }]]]);
  assert.deepEqual(chain?.relationUses.map(({ relation, column, resolved, reachedFrom }) =>
    [relation, column, resolved, reachedFrom[0]?.path]), [
    ['users', undefined, { relation: 'main.users' }, ['ts:api/users.get', 'ts:service/users.load', 'ts:repo/users.findById']],
    ['users', 'email', { relation: 'main.users', column: 'email' },
      ['ts:api/users.get', 'ts:service/users.load', 'ts:repo/users.findById']],
  ]);
  assert.deepEqual(chain?.database.map(({ vertex, dependents }) => [vertex, dependents.map(({ usr, witnessRoot }) => [usr, witnessRoot])]), [
    ['main.users', [['main.active_users', undefined], ['main.orders', undefined]]],
    ['main.users.email', [['main.active_users', 'main.users']]],
  ]);
  const [route] = chain!.routes;
  assert.deepEqual(route?.calls.map(({ call, side, quality, affected }) =>
    [call.symbol?.usr, side, quality, affected.map(({ usr, depth }) => [usr, depth])]),
  [['kt:UsersApi.get', 'decl', 'exact', [['kt:UsersRepository.load', 1], ['kt:ProfileViewModel.refresh', 2]]]]);
  assert.deepEqual(result.summary, { chains: 1, routes: 1, handlers: 1, relationUses: 2, databaseVertices: 2,
    databaseDependents: 3, calls: 1, clientSymbols: 2, gaps: 0 });
});

test('relation 선택은 사용 심볼에서 역방향으로 핸들러·route·클라이언트까지 잇고 다른 root의 목격을 표시한다', () => {
  const result = report(select({ relations: ['users'] }));
  assert.deepEqual(result.gaps, []);
  const [chain] = result.chains;
  assert.deepEqual(chain?.routes.map(({ method, template, calls }) => [method, template, calls.map(({ call }) => call.symbol?.usr)]), [
    ['POST', '/api/users', ['kt:UsersApi.create']], ['GET', '/api/users/{}', ['kt:UsersApi.get']],
  ]);
  assert.deepEqual(chain?.handlers.map(({ usr, reachedFrom }) => [usr, reachedFrom.map(({ from, depth, witnessRoot }) =>
    [from, depth, witnessRoot])]), [
    ['ts:api/users.create', [['ts:repo/users.findById', 1, 'ts:repo/audit.write']]],
    ['ts:api/users.get', [['ts:repo/users.findById', 2, undefined]]],
  ]);
  assert.deepEqual(chain?.database.map(({ vertex }) => vertex), ['main.users', 'main.users.email']);
  assert.ok(chain?.relationUses.every(({ reachedFrom }) => reachedFrom.length === 0));
});

test('심볼 선택은 핸들러 자신도 route로 잇고, 핸들러에 닿지 않으면 non-http-entry로 남긴다', () => {
  const handler = report(select({ symbols: [{ platform: 'js', usr: 'ts:api/users.get' }] }));
  assert.deepEqual(handler.chains[0]?.routes.map(({ template }) => template), ['/api/users/{}']);
  assert.deepEqual(codes(handler), ['analysis-missing']);
  const job = report(select({ symbols: [{ platform: 'js', usr: 'ts:jobs/purge.run' }] }));
  assert.deepEqual(codes(job), ['analysis-missing', 'non-http-entry']);
  assert.deepEqual(job.chains[0]?.routes, []);
  assert.equal(hasTraceGaps(job), true);
});

test('같은 입력은 문서·분석 순서와 무관하게 바이트 단위로 같은 출력을 낸다', () => {
  const forward = build();
  const shuffled: TraceInput = { ...forward, documents: [...forward.documents].reverse(), analyses: [...forward.analyses].reverse() };
  assert.equal(encodeSortedJson(createTraceReport(shuffled)), encodeSortedJson(createTraceReport(forward)));
  const relation = build(select({ relations: ['users', 'audit_log'] }));
  assert.equal(encodeSortedJson(createTraceReport({ ...relation, documents: [...relation.documents].reverse() })),
    encodeSortedJson(createTraceReport(relation)));
});

test('다른 root에서 닿은 root 테이블도 DB 의존자로 싣고 그 너머는 목격 root를 표시한다', () => {
  const result = report((value) => {
    const db = value.analyses.db;
    db.roots.push({ id: 'main.orders', symbol: { usr: 'main.orders', kind: 'table' } });
    db.reached.push({ symbol: { usr: 'main.order_items', kind: 'table' }, via: 'main.orders', depth: 1, roots: [0, 2],
      relationships: ['references'] });
    db.reached.sort((left: any, right: any) => left.depth - right.depth || (left.symbol.usr < right.symbol.usr ? -1 : 1));
  });
  assert.deepEqual(result.gaps, []);
  const users = result.chains[0]!.database.find(({ vertex }) => vertex === 'main.users')!;
  assert.deepEqual(users.dependents.map(({ usr, path, witnessRoot }) => [usr, path, witnessRoot]), [
    ['main.active_users', ['main.users', 'main.active_users'], undefined],
    ['main.order_items', ['main.orders', 'main.order_items'], 'main.orders'],
    ['main.orders', ['main.users', 'main.orders'], undefined],
  ]);
});

test('root를 거쳐 돌아오는 목격 경로는 지어내지 않고 witness-partial로 표시한다', () => {
  const result = report((value) => {
    const db = value.analyses.db;
    db.roots.push({ id: 'main.orders', symbol: { usr: 'main.orders' } });
    db.reached = [
      { symbol: { usr: 'main.audit_view' }, via: 'main.users', depth: 1, roots: [0] },
      { symbol: { usr: 'main.v' }, via: 'main.orders', depth: 1, roots: [0, 2] },
      { symbol: { usr: 'main.orders' }, via: 'main.v', depth: 3, roots: [0] },
    ];
  });
  const users = result.chains[0]!.database.find(({ vertex }) => vertex === 'main.users')!;
  assert.deepEqual(users.dependents.map(({ usr, depth, path, witnessRoot, witnessPartial }) =>
    [usr, depth, path, witnessRoot, witnessPartial]), [
    ['main.audit_view', 1, ['main.users', 'main.audit_view'], undefined, undefined],
    ['main.v', 1, ['main.orders', 'main.v'], 'main.orders', undefined],
    ['main.orders', 3, ['main.v', 'main.orders'], undefined, true],
  ]);
  assert.deepEqual(result.gaps.map(({ code, analysis, symbol }) => [code, analysis, symbol]),
    [['witness-partial', 'db', { platform: 'sql', usr: 'main.orders' }]]);
});

test('핸들러·relation-use 도달에서도 root 순환 목격은 witness-partial이다', () => {
  const forward = report((value) => {
    const graph = value.analyses['server-forward'];
    graph.roots.push({ id: 'ts:repo/users.findById', symbol: { usr: 'ts:repo/users.findById' } });
    graph.reached = [
      { symbol: { usr: 'ts:repo/audit.write' }, via: 'ts:api/users.create', depth: 1, roots: [0] },
      { symbol: { usr: 'ts:service/users.load' }, via: 'ts:repo/users.findById', depth: 1, roots: [0, 1, 2] },
      { symbol: { usr: 'ts:repo/users.findById' }, via: 'ts:service/users.load', depth: 2, roots: [0, 1] },
    ];
  });
  assert.ok(forward.chains[0]!.relationUses.every(({ reachedFrom }) => reachedFrom[0]?.witnessPartial === true));
  assert.deepEqual(forward.gaps.map(({ code, symbol }) => [code, symbol?.usr]), [['witness-partial', 'ts:repo/users.findById']]);
  const reverse = report((value) => {
    const graph = value.analyses['server-reverse'];
    graph.roots.push({ id: 'ts:api/users.get', symbol: { usr: 'ts:api/users.get' } });
    graph.reached = [
      { symbol: { usr: 'ts:api/users.create' }, via: 'ts:repo/audit.write', depth: 1, roots: [0, 1] },
      { symbol: { usr: 'ts:service/users.load' }, via: 'ts:api/users.get', depth: 1, roots: [1, 2] },
      { symbol: { usr: 'ts:api/users.get' }, via: 'ts:service/users.load', depth: 2, roots: [1] },
    ];
    value.context.selection = { relations: ['users'] };
  });
  const get = reverse.chains[0]!.handlers.find(({ usr }) => usr === 'ts:api/users.get')!;
  assert.deepEqual(get.reachedFrom.map(({ path, witnessPartial }) => [path, witnessPartial]),
    [[['ts:service/users.load', 'ts:api/users.get'], true]]);
  assert.ok(reverse.gaps.some(({ code, symbol }) => code === 'witness-partial' && symbol?.usr === 'ts:api/users.get'));
});

test('같은 root의 분석이 여럿이면 root 자신의 경로, depth, 분석 id 순으로 한 근거만 싣는다', () => {
  const result = report((value) => {
    for (const id of ['server-forward', 'android-reverse']) {
      const copy = structuredClone(value.analyses[id]);
      value.analyses[`z-${id}`] = copy;
      value.context.analyses.push({ ...value.context.analyses.find((entry: any) => entry.id === id), id: `z-${id}` });
    }
    // z-android-reverse에서는 ProfileViewModel이 더 가깝지만 다른 root의 목격으로만 닿는다.
    const reverse = value.analyses['z-android-reverse'];
    reverse.reached = [...reverse.reached.filter((row: any) => row.symbol.usr !== 'kt:ProfileViewModel.refresh'),
      { symbol: { usr: 'kt:ProfileViewModel.refresh' }, via: 'kt:UsersApi.create', depth: 1, roots: [0, 1] }]
      .sort((left: any, right: any) => left.depth - right.depth || (left.symbol.usr < right.symbol.usr ? -1 : 1));
  });
  const chain = result.chains[0]!;
  assert.deepEqual(chain.relationUses.map(({ reachedFrom }) => reachedFrom.map(({ analysis }) => analysis)),
    [['server-forward'], ['server-forward']]);
  assert.deepEqual(chain.routes[0]?.calls[0]?.affected.map(({ usr, analysis, witnessRoot }) => [usr, analysis, witnessRoot]), [
    ['kt:UsersRepository.load', 'android-reverse', undefined],
    ['kt:ProfileViewModel.refresh', 'android-reverse', undefined],
  ]);
});

test('핸들러·호출·선언 측 심볼이 없으면 각 hop을 gap으로 남긴다', () => {
  assert.deepEqual(codes(report((value) => { delete value.docs.server.facts[0].symbol; })), ['handler-without-symbol']);
  assert.deepEqual(codes(report((value) => { delete value.docs.android.facts[0].symbol; })), ['call-without-symbol']);
  assert.deepEqual(codes(report((value) => { delete value.docs.sql.facts[0].symbol.usr; })), ['relation-decl-without-symbol']);
  const unsymbolized = report((value) => { delete value.docs.persistence.facts[2].symbol; });
  assert.deepEqual(codes(unsymbolized), ['relation-use-without-symbol']);
  assert.match(unsymbolized.gaps[0]!.detail, /^1 js relation use/);
  const relation = report((value) => {
    delete value.docs.persistence.facts[2].symbol;
    value.context.selection = { relations: ['audit_log'] };
  });
  assert.deepEqual(codes(relation), ['analysis-missing', 'relation-use-without-symbol']);
  assert.equal(relation.gaps.find(({ code }) => code === 'relation-use-without-symbol')?.evidence?.location?.path,
    'server/db/audit.ts');
});

test('계약만 있는 route와 없는 route는 핸들러를 만들지 않고 gap이다', () => {
  const contract = report((value) => {
    value.docs.openapi = { format: 'bridge-facts', version: 1, tool: { name: 'synthetic', version: '0' },
      generatedAt: '2026-09-27T00:00:00Z', platform: 'openapi', target: 'http', project: '/work/trace-example', roles: ['server'],
      limitations: [], facts: [{ kind: 'route-contract', method: 'GET', channel: '/api/health', dynamic: false, pathAnchor: 'root',
        location: { path: 'openapi.yaml', line: 3, column: 3 }, symbol: { qualifiedName: 'getHealth' } }] };
    value.context.documents.push('openapi.json');
    value.context.selection = { routes: [{ method: 'GET', template: '/api/health' }] };
  });
  assert.deepEqual(codes(contract), ['route-contract-only']);
  assert.equal(contract.chains[0]?.routes[0]?.contracts.length, 1);
  const missing = report(select({ routes: [{ method: 'GET', template: '/nope' }, { method: 'GET', template: '/api/users/{}', scope: 'x' }] }));
  assert.deepEqual(codes(missing), ['route-without-decl']);
  assert.equal(missing.gaps.length, 2);
  assert.deepEqual(missing.chains, []);
});

test('분석이 없거나 잘렸거나 root 귀속이 부분적이면 gap이다', () => {
  assert.deepEqual(codes(report((value) => { delete value.analyses['server-forward']; })), ['analysis-missing']);
  assert.deepEqual(codes(report((value) => { delete value.analyses.db; })), ['analysis-missing']);
  assert.deepEqual(codes(report((value) => { delete value.analyses['android-reverse']; })), ['analysis-missing']);
  const truncated = report((value) => {
    value.analyses['server-forward'].truncated = true;
    value.analyses['server-forward'].truncationReasons = ['depth'];
  });
  assert.deepEqual(codes(truncated), ['analysis-truncated']);
  assert.match(truncated.gaps[0]!.detail, /\(depth\)/);
  const capped = report((value) => {
    const forward = value.analyses['server-forward'];
    const others = Array.from({ length: 64 }, (_, index) => `ts:aa/${String(index).padStart(2, '0')}`);
    forward.roots = [...others.map((id) => ({ id })), ...forward.roots];
    forward.rootsTruncated = true;
    forward.reached = [
      { symbol: { usr: 'ts:shared' }, via: others[0], depth: 1, roots: others.map((_, index) => index) },
      ...forward.reached.map((row: any) => ({ ...row, roots: row.roots.map((index: number) => index + 64) })),
    ].sort((left: any, right: any) => left.depth - right.depth || (left.symbol.usr < right.symbol.usr ? -1 : 1));
  });
  assert.deepEqual(codes(capped), ['analysis-truncated']);
  assert.match(capped.gaps[0]!.detail, /64 roots/);
  // 생산자가 해석하지 못한 요청은 symbol 없는 root로 남는다. 같은 문자열이어도 생산자 id로 잇지 않는다.
  const unresolved = report((value) => {
    const forward = value.analyses['server-forward'];
    forward.roots[1] = { id: 'ts:api/users.get' };
    forward.reached = forward.reached.filter((row: any) => row.symbol.usr === 'ts:repo/audit.write');
    forward.truncated = true;
    forward.truncationReasons = ['root-not-found'];
  });
  assert.deepEqual(codes(unresolved), ['analysis-missing']);
  const legacy = traversalGraphFromImpact({ id: 'android-legacy', platform: 'kotlin', tool: { name: 'kartograph', version: '1' },
    requested: { files: [], symbols: ['x'] },
    roots: [{ id: 'kt:UsersApi.create', qualifiedName: 'create' }, { id: 'kt:UsersApi.get', qualifiedName: 'get' }],
    affected: [{ symbol: { id: 'kt:Screen', qualifiedName: 'Screen' }, via: 'kt:UsersApi.get', depth: 1, relationships: [] }],
    limitations: [], truncated: false }, 'kartograph-impact');
  const witness = report((value) => { delete value.analyses['android-reverse']; },
    [{ id: 'android-legacy', platform: 'kotlin', role: 'reverse', graph: legacy }]);
  assert.deepEqual(codes(witness), ['analysis-revision-unknown', 'roots-provenance-partial']);
  assert.equal(witness.analyses.find(({ id }) => id === 'android-legacy')?.tool, undefined);
});

test('revision이 context나 서로와 다르면 stale-analysis다', () => {
  assert.deepEqual(codes(report((value) => { value.analyses['server-forward'].revision = 'rev-0'; })), ['stale-analysis']);
  assert.deepEqual(codes(report((value) => { delete value.analyses['server-forward'].revision; })), ['analysis-revision-unknown']);
  const noContext = report((value) => {
    delete value.context.revision;
    value.analyses['server-forward'].revision = 'rev-0';
  });
  assert.deepEqual(codes(noContext), ['stale-analysis']);
  assert.equal(noContext.gaps.length, 4);
  assert.deepEqual(codes(report((value) => { delete value.context.revision; })), []);
  const partial = report((value) => {
    delete value.context.revision;
    delete value.analyses['server-forward'].revision;
  });
  assert.deepEqual(codes(partial), ['analysis-revision-unknown']);
  assert.equal(partial.gaps[0]?.analysis, 'server-forward');
  assert.match(partial.gaps[0]!.detail, /other analyses/i);
  const graphs = report((value) => {
    const other = structuredClone(value.analyses.db);
    other.graphRevision = 'catalog-2';
    other.roots = [{ id: 'main.audit_log' }];
    other.reached = [];
    value.analyses['db-2'] = other;
    value.context.analyses.push({ id: 'db-2', platform: 'sql', role: 'db-dependents', path: 'db-2.json' });
  });
  assert.deepEqual(codes(graphs), ['stale-analysis']);
  assert.equal(graphs.gaps.length, 2);
});

test('귀속되지 않은 호출은 개수만 gap으로 싣고 경로·host는 어떤 필드에도 싣지 않는다', () => {
  const result = report((value) => {
    value.docs.server.service = 'api';
    value.docs.android.facts.push({ kind: 'route-call', method: 'POST', channel: '/secret-hook/{}', dynamic: false, pathAnchor: 'root',
      authority: 'hooks.example.com', service: 'other', location: { path: 'android/Hook.kt', line: 3, column: 1 },
      symbol: { qualifiedName: 'Hook.send', usr: 'kt:Hook.send' } });
    value.docs.android.facts[0].service = 'api';
    value.context.selection = { routes: [{ method: 'GET', template: '/api/users/{}', scope: 'api' }] };
  });
  assert.deepEqual(codes(result), ['unattributed-calls-omitted']);
  const text = encodeSortedJson(result);
  assert.doesNotMatch(text, /secret-hook|hooks\.example\.com|Hook\.send/);
  // service가 다른 호출은 이 scope에 닿을 수 없어 세지 않는다. 이름 없는 호출 하나만 이 scope의 공백이다.
  assert.match(result.gaps[0]!.detail, /^1 route call/);
  assert.equal(result.chains[0]?.routes[0]?.calls.length, 1);
});

test('모호·테스트 소스·동적 호출과 클라이언트 미스캔을 gap으로 남긴다', () => {
  const ambiguous = report((value) => {
    value.docs.server.facts.push(
      { kind: 'route-decl', method: 'GET', channel: '/f/a{}', dynamic: false, pathAnchor: 'root',
        location: { path: 'server/f.ts', line: 1, column: 1 }, symbol: { qualifiedName: 'f.a', usr: 'ts:f.a' } },
      { kind: 'route-decl', method: 'GET', channel: '/f/{}b', dynamic: false, pathAnchor: 'root',
        location: { path: 'server/f.ts', line: 2, column: 1 }, symbol: { qualifiedName: 'f.b', usr: 'ts:f.b' } });
    value.docs.android.facts.push({ kind: 'route-call', method: 'GET', channel: '/f/axb', dynamic: false, pathAnchor: 'root',
      location: { path: 'android/F.kt', line: 1, column: 1 }, symbol: { qualifiedName: 'F.get', usr: 'kt:F.get' } });
    value.context.selection = { routes: [{ method: 'GET', template: '/f/a{}' }] };
  });
  assert.ok(codes(ambiguous).includes('ambiguous-route-call'));
  assert.deepEqual(ambiguous.chains[0]?.routes[0]?.calls, []);
  const testSource = report((value) => {
    value.docs.android.sourceSets = { tests: 'included' };
    value.docs.android.facts[0].testSource = true;
    value.docs.server.sourceSets = { tests: 'included' };
    value.docs.server.facts.push({ ...value.docs.server.facts[0], testSource: true,
      location: { path: 'server/test/users.test.ts', line: 1, column: 1 } });
  });
  assert.deepEqual(codes(testSource), ['test-source-omitted']);
  const testOnly = report((value) => {
    value.docs.server.sourceSets = { tests: 'included' };
    value.docs.server.facts[0].testSource = true;
  });
  assert.deepEqual(codes(testOnly), ['test-source-omitted']);
  assert.deepEqual(testOnly.chains[0]?.handlers, []);
  assert.match(testSource.gaps[0]!.detail, /^2 test-source/);
  assert.deepEqual(testSource.chains[0]?.routes[0]?.calls, []);
  const dynamic = report((value) => {
    value.docs.android.facts.push({ kind: 'route-call', method: 'GET', channel: 'base + path', dynamic: true, pathAnchor: 'root',
      location: { path: 'android/D.kt', line: 1, column: 1 } });
  });
  assert.deepEqual(codes(dynamic), ['dynamic-route-calls']);
  const serverOnly = report((value) => { delete value.docs.android; });
  assert.deepEqual(codes(serverOnly), ['http-clients-unscanned']);
  assert.equal(serverOnly.chains[0]?.relationUses.length, 2);
});

test('trace 구성은 한쪽 http 문서만으로도 조인하지만 strict 구성은 그대로 거부한다', () => {
  const documents = build((value) => { delete value.docs.android; }).documents;
  assert.throws(() => joinBridgeDocuments(documents), BridgeJoinValidationError);
  assert.equal(joinBridgeDocuments(documents, { composition: 'trace' }).routes?.scopes.length, 1);
});

test('조인하지 못한 relation-use와 모호한 선택은 hop 대신 gap이다', () => {
  const unjoined = report((value) => {
    const base = value.docs.persistence.facts[0];
    value.docs.persistence.facts.push(
      { ...base, channel: 'ghosts', location: { path: 'server/db/users.ts', line: 7, column: 1 } },
      { ...base, method: 'nickname', location: { path: 'server/db/users.ts', line: 8, column: 1 } },
      { ...base, channel: 'tableFor(kind)', dynamic: true, location: { path: 'server/db/users.ts', line: 9, column: 1 } });
  });
  assert.deepEqual(codes(unjoined), ['column-use-without-decl', 'dynamic-relation-use', 'relation-use-without-decl']);
  assert.equal(unjoined.gaps.filter(({ code }) => code === 'relation-use-without-decl').length, 1);
  assert.ok(unjoined.chains[0]?.relationUses.every(({ relation }) => relation !== 'tableFor(kind)'));
  const ambiguous = (selection: unknown) => report((value) => {
    value.docs.sql.facts.push({ kind: 'relation-decl', channel: 'audit.users', dynamic: false,
      symbol: { qualifiedName: 'audit.users', usr: 'audit.users' } });
    value.context.selection = selection;
  });
  assert.deepEqual(codes(ambiguous({ relations: ['users'] })), ['relation-selection-ambiguous']);
  assert.deepEqual(ambiguous({ relations: ['users'] }).chains, []);
  const qualified = ambiguous({ relations: ['main.users'] });
  assert.deepEqual(codes(qualified), ['relation-use-ambiguous', 'relation-without-use']);
  assert.deepEqual(qualified.chains[0]?.database.map(({ vertex }) => vertex), ['main.users']);
  assert.ok(codes(ambiguous({ routes: [{ method: 'GET', template: '/api/users/{}' }] })).includes('relation-use-ambiguous'));
});

test('relation 선택도 dynamic 사용을 gap으로 밝히고 사용 없음 문구를 약하게 쓴다', () => {
  const result = report((value) => {
    value.docs.persistence.facts.push({ ...value.docs.persistence.facts[0], channel: 'tableFor(kind)', dynamic: true,
      location: { path: 'server/db/users.ts', line: 9, column: 1 } });
    value.docs.sql.facts.push({ kind: 'relation-decl', channel: 'main.unused', dynamic: false,
      symbol: { qualifiedName: 'main.unused', usr: 'main.unused' } });
    value.context.selection = { relations: ['main.unused'] };
  });
  assert.deepEqual(codes(result), ['analysis-missing', 'dynamic-relation-use', 'relation-without-use']);
  assert.equal(result.gaps.find(({ code }) => code === 'dynamic-relation-use')?.evidence?.location?.line, 9);
  assert.match(result.gaps.find(({ code }) => code === 'relation-without-use')!.detail, /1 relation use\(s\) with a non-literal name/);
  assert.deepEqual(result.chains[0]?.relationUses, []);
});

test('선언이나 사용이 없는 relation 선택은 없음이 아니라 gap이다', () => {
  const ghost = report((value) => {
    value.docs.persistence.facts.push({ ...value.docs.persistence.facts[0], channel: 'ghosts',
      location: { path: 'server/db/users.ts', line: 7, column: 1 } });
    value.context.selection = { relations: ['ghosts', 'nothing'] };
  });
  assert.deepEqual(codes(ghost), ['relation-use-without-decl', 'relation-without-decl']);
  assert.equal(ghost.chains.length, 1);
  assert.deepEqual(ghost.chains[0]?.selector, { relation: 'ghosts' });
  assert.deepEqual(ghost.chains[0]?.handlers.map(({ usr }) => usr), ['ts:api/users.create', 'ts:api/users.get']);
});

test('입력에 없는 측은 전역 gap이다', () => {
  assert.deepEqual(codes(report((value) => { delete value.docs.sql; })), ['persistence-unscanned', 'relation-use-without-decl']);
  const noServer = report((value) => {
    delete value.docs.server;
    value.context.selection = { relations: ['users'] };
  });
  assert.deepEqual(codes(noServer), ['http-server-unscanned', 'non-http-entry']);
  assert.deepEqual(codes(report((value) => {
    delete value.docs.sql;
    delete value.docs.persistence;
    value.context.selection = { symbols: [{ platform: 'js', usr: 'ts:repo/users.findById' }] };
  })), []);
});

test('다른 project·bridge 문서·mixed-targets 입력은 거부한다', () => {
  const input = build();
  assert.throws(() => createTraceReport({ ...input, context: { ...input.context, project: '/elsewhere' } }), TraceInputError);
  const bridge = parseBridgeFactsDocument({ format: 'bridge-facts', version: 1, tool: { name: 't', version: '0' },
    generatedAt: '2026-09-27T00:00:00Z', platform: 'dart', target: 'flutter', project: '/work/trace-example', limitations: [],
    facts: [{ kind: 'channel-create', channel: 'c', dynamic: false, location: { path: 'lib/a.dart', line: 1, column: 1 } }] });
  assert.throws(() => createTraceReport({ ...input, documents: [...input.documents, bridge] }), /bridge-target/);
  const mixed = build((value) => { value.docs.persistence.limitations = ['mixed-targets: synthetic']; });
  assert.throws(() => createTraceReport(mixed), /mixed bridge targets/);
  const empty = parseBridgeFactsDocument({ format: 'bridge-facts', version: 1, tool: { name: 't', version: '0' },
    generatedAt: '2026-09-27T00:00:00Z', platform: 'kotlin', target: null, project: '/work/trace-example', limitations: [], facts: [] });
  assert.deepEqual(createTraceReport({ ...input, documents: [...input.documents, empty] }).gaps, []);
});
