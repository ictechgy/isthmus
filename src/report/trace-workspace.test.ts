import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { parseBridgeFactsDocument } from '../exchange/parse.ts';
import { analysisProject, normalizeTraceAnalysis, parseTraceContext } from '../exchange/trace-context.ts';
import {
  createTraceReport,
  hasTraceGaps,
  TRACE_NOTICE_CODES,
  TraceInputError,
  type TraceInput,
  type TraceReport,
} from './trace.ts';
import { encodeSortedJson } from './sorted-json.ts';

/**
 * workspace trace — 분리된 두 저장소(서버·클라이언트) 합성 fixture와 gap 코드 전수 음성 fixture다.
 *
 * `fixtures/trace-workspace/server`는 TS 서버(route-decl·relation-use)와 schemagraph 흉내 sql 카탈로그를,
 * `client`는 Kotlin·Swift 호출부와 역방향 분석(iOS는 macOS CI가 미리 계산한 artifact — language-traversal과 옛
 * change-impact 두 형식)을 담는다.
 * 두 저장소는 project 루트와 revision이 서로 다르고 link 하나로만 이어진다.
 */

type Files = Record<string, any>;
interface Value { context: any; files: Files }

const workspaceRoot = new URL('../../fixtures/trace-workspace/', import.meta.url);
const singleRoot = new URL('../../fixtures/trace/', import.meta.url);
const readJson = async (root: URL, path: string) => JSON.parse(await readFile(new URL(path, root), 'utf8'));

/** context가 가리키는 모든 문서·분석 원문을 읽는다. */
async function load(root: URL, contextName: string): Promise<Value> {
  const context = await readJson(root, contextName);
  const paths = context.members === undefined
    ? [...context.documents, ...context.analyses.map(({ path }: { path: string }) => path)]
    : context.members.flatMap((member: any) => [...member.documents, ...(member.analyses ?? []).map(({ path }: any) => path)]);
  const files: Files = {};
  for (const path of paths) files[path] = await readJson(root, path);
  return { context, files };
}

const workspaceFixture = await load(workspaceRoot, 'context.json');
const legacyIosPath = 'client/ios-reverse.change-impact.json';
workspaceFixture.files[legacyIosPath] = await readJson(workspaceRoot, legacyIosPath);

/** iOS 역방향 분석을 revision 없는 옛 change-impact artifact로 바꾼다(증언 revision을 지정할 수 있다). */
const legacyIos = (revision?: string) => (value: Value) => {
  const ios = member(value, 'client').analyses[1];
  ios.path = legacyIosPath;
  if (revision !== undefined) ios.precomputed.revision = revision;
};
const singleFixture = await load(singleRoot, 'context.json');

/** fixture를 복제·변형해 검증된 trace 입력으로 만든다. sha256 대조는 CLI 층의 일이라 여기서는 하지 않는다. */
function build(base: Value, mutate: (value: Value) => void = () => {}): TraceInput {
  const value = structuredClone(base);
  mutate(value);
  const context = parseTraceContext(value.context);
  return {
    context,
    documents: context.documents.map((path) => parseBridgeFactsDocument(value.files[path])),
    analyses: context.analyses.map((reference) =>
      normalizeTraceAnalysis(value.files[reference.path], reference, analysisProject(context, reference))),
  };
}

const workspace = (mutate?: (value: Value) => void) => createTraceReport(build(workspaceFixture, mutate));
const single = (mutate?: (value: Value) => void) => createTraceReport(build(singleFixture, mutate));
const codes = (result: TraceReport) => [...new Set(result.gaps.map(({ code }) => code))].sort();
const member = (value: Value, name: string) => value.context.members.find((entry: any) => entry.name === name);
const select = (selection: unknown) => (value: Value) => { value.context.selection = selection; };

test('분리된 두 저장소에서 route 선택이 API·테이블·DB 의존자·호출부·클라이언트 영향 심볼을 모두 잇는다', () => {
  const result = workspace();
  assert.deepEqual(result.gaps, []);
  assert.equal(hasTraceGaps(result), false);
  assert.equal(result.project, undefined);
  assert.deepEqual(result.workspace?.members.map(({ name, project, revision }) => [name, project, revision]), [
    ['server', '/work/example-server', 'srv-7f3c2a1'], ['server-spec', '/work/example-server', 'srv-7f3c2a1'],
    ['client', '/work/example-client', 'cli-41d9e0b'],
  ]);
  assert.deepEqual(result.workspace?.links.map(({ name, client, server, contract }) => [name, client, server, contract]),
    [['mobile->api', 'client', 'server', { member: 'server-spec', authoritative: true }]]);
  const [chain] = result.chains;
  // API: 선언은 server member, 계약은 server-spec member(같은 project를 공유하는 두 member)에서 온다.
  const [route] = chain!.routes;
  assert.deepEqual([route?.scope, route?.method, route?.template], ['mobile->api', 'GET', '/api/orders/{}']);
  assert.deepEqual(route?.declarations.map(({ member: name, symbol }) => [name, symbol?.usr]), [['server', 'ts:api/orders.get']]);
  assert.deepEqual(route?.contracts.map(({ member: name, symbol }) => [name, symbol?.qualifiedName]), [['server-spec', 'getOrder']]);
  assert.deepEqual(chain?.handlers.map(({ member: name, usr }) => [name, usr]), [['server', 'ts:api/orders.get']]);
  // 테이블과 DB 의존자: server member 안에서만 잇는다.
  assert.deepEqual(chain?.relationUses.map(({ use, resolved }) => [use.member, use.symbol?.usr, resolved]), [
    ['server', 'ts:repo/orders.findById', { relation: 'main.orders' }],
    ['server', 'ts:repo/orders.findById', { relation: 'main.orders', column: 'status' }],
  ]);
  assert.deepEqual(chain?.database.map(({ member: name, vertex, dependents }) => [name, vertex, dependents.map(({ usr }) => usr)]), [
    ['server', 'main.orders', ['main.open_orders', 'main.order_items']],
    ['server', 'main.orders.status', ['main.open_orders']],
  ]);
  // 호출부와 클라이언트 영향 심볼: client member의 Kotlin(host 귀속)·Swift(service 귀속) 호출과 각 역방향 분석이다.
  assert.deepEqual(route?.calls.map(({ call, side, quality, affected }) => [call.member, call.platform, call.symbol?.usr, side, quality,
    affected.map(({ member: name, usr, analysis }) => [name, usr, analysis])]), [
    ['client', 'kotlin', 'kt:OrdersApi.get', 'decl', 'exact',
      [['client', 'kt:OrdersRepository.load', 'android-reverse'], ['client', 'kt:OrderDetailViewModel.refresh', 'android-reverse']]],
    ['client', 'swift', 's:OrdersClient.fetch', 'decl', 'exact',
      [['client', 's:OrderStore.refresh', 'ios-reverse'], ['client', 's:OrderDetailView.body', 'ios-reverse']]],
  ]);
  assert.deepEqual(route?.calls[1]?.affected[0]?.location, { path: 'ios/App/Stores/OrderStore.swift', line: 31, column: 10 });
  assert.deepEqual(result.summary, { chains: 1, routes: 1, handlers: 1, relationUses: 2, databaseVertices: 2,
    databaseDependents: 3, calls: 2, clientSymbols: 4, gaps: 0, notices: 0,
    evidence: { direct: 5, bound: 0, candidate: 0, unassessed: 4 } });
  const ios = result.analyses.find(({ id }) => id === 'ios-reverse')!;
  assert.deepEqual([ios.member, ios.source, ios.revision, ios.revisionSource, ios.precomputed?.generatedAt],
    ['client', 'language-traversal', 'cli-41d9e0b', undefined, '2026-09-26T21:00:00Z']);
  assert.deepEqual(result.notices, []);
  assert.equal(result.analyses.find(({ id }) => id === 'android-reverse')?.revisionSource, undefined);
  assert.ok(result.limitations.every(({ member: name, link }) => (name === undefined) !== (link === undefined)));
});

test('테이블 선택이 서버 member의 역방향 순회로 API를 찾고 link 너머 클라이언트까지 잇는다', () => {
  const result = workspace(select({ relations: [{ member: 'server', name: 'orders' }] }));
  assert.deepEqual(result.gaps, []);
  const [chain] = result.chains;
  assert.deepEqual(chain?.selector, { relation: 'orders', member: 'server' });
  assert.deepEqual(chain?.routes.map(({ method, template, calls }) => [method, template,
    calls.map(({ call, affected }) => [call.symbol?.usr, affected.map(({ usr }) => usr)])]), [
    ['POST', '/api/orders', [['kt:OrdersApi.create', ['kt:CheckoutViewModel.submit']]]],
    ['GET', '/api/orders/{}', [['kt:OrdersApi.get', ['kt:OrdersRepository.load', 'kt:OrderDetailViewModel.refresh']],
      ['s:OrdersClient.fetch', ['s:OrderStore.refresh', 's:OrderDetailView.body']]]],
  ]);
  assert.deepEqual(chain?.handlers.map(({ member: name, usr, reachedFrom }) => [name, usr, reachedFrom.map(({ from, depth }) => [from, depth])]), [
    ['server', 'ts:api/orders.create', [['ts:repo/orders.insert', 1]]],
    ['server', 'ts:api/orders.get', [['ts:repo/orders.findById', 2]]],
  ]);
  assert.deepEqual(chain?.database.map(({ vertex }) => vertex), ['main.orders', 'main.orders.status']);
});

test('workspace 출력은 분석 순서와 무관하게 바이트 단위로 같다', () => {
  const input = build(workspaceFixture);
  assert.equal(encodeSortedJson(createTraceReport({ ...input, analyses: [...input.analyses].reverse() })),
    encodeSortedJson(createTraceReport(input)));
});

test('persistence와 언어 순회는 member 밖으로 나가지 않는다', () => {
  // 클라이언트 로컬 캐시의 orders 테이블 사용은 서버 DB의 orders와 섞이지 않는다.
  const local = workspace((value) => {
    const cache = structuredClone(value.files['server/server.persistence.json']);
    cache.project = '/work/example-client';
    cache.platform = 'kotlin';
    cache.facts = [{ ...cache.facts[0], location: { path: 'android/Cache.kt', line: 3, column: 1 },
      symbol: { qualifiedName: 'Cache.load', usr: 'kt:Cache.load' } }];
    value.files['client/cache.persistence.json'] = cache;
    member(value, 'client').documents.push('client/cache.persistence.json');
    value.context.selection = { relations: [{ member: 'server', name: 'orders' }] };
  });
  assert.ok(local.chains[0]!.relationUses.every(({ use }) => use.member === 'server'));
  assert.deepEqual(local.gaps.map(({ code, member: name }) => [code, name]), [['persistence-unscanned', 'client']]);
  // 클라이언트 역방향 분석을 server member에 붙이면 그 호출의 영향은 client member에서 찾지 못한다.
  const moved = workspace((value) => {
    const android = member(value, 'client').analyses.shift();
    value.files[android.path].project = '/work/example-server';
    value.files[android.path].revision = 'srv-7f3c2a1';
    member(value, 'server').analyses.push(android);
  });
  assert.deepEqual(moved.gaps.map(({ code, member: name, symbol }) => [code, name, symbol?.usr]),
    [['analysis-missing', 'client', 'kt:OrdersApi.get']]);
});

test('revision은 member마다 검사하고 사전 계산 artifact는 증언 revision으로 검사한다', () => {
  const gaps = (mutate: (value: Value) => void) => workspace(mutate).gaps.map(({ code, member: name, analysis }) => [code, name, analysis]);
  assert.deepEqual(gaps((value) => { value.files['server/server-forward.json'].revision = 'srv-old'; }),
    [['stale-analysis', 'server', 'server-forward']]);
  assert.deepEqual(gaps((value) => { delete value.files['client/android-reverse.json'].revision; }),
    [['analysis-revision-unknown', 'client', 'android-reverse']]);
  assert.deepEqual(gaps(legacyIos('cli-old')), [['stale-analysis', 'client', 'ios-reverse']]);
  // 카탈로그 graphSha를 선언한 member의 sql 분석은 graphRevision으로 검사한다.
  assert.deepEqual(gaps((value) => { value.files['server/db-dependents.json'].graphRevision = 'f'.repeat(64); }),
    [['stale-analysis', 'server', 'server-db']]);
  assert.deepEqual(gaps((value) => { delete value.files['server/db-dependents.json'].graphRevision; }),
    [['analysis-revision-unknown', 'server', 'server-db']]);
  assert.deepEqual(gaps((value) => {
    value.files['server/db-dependents.json'].revision = 'catalog-only';
    delete member(value, 'server').catalog;
  }), [['stale-analysis', 'server', 'server-db']]);
  assert.deepEqual(gaps((value) => { value.files['server/db-dependents.json'].revision = 'catalog-only'; }), []);
  // 같은 member·플랫폼 분석의 graphRevision이 다르면 stale이다.
  assert.deepEqual(gaps((value) => {
    value.files['server/server-forward.json'].graphRevision = 'g1';
    value.files['server/server-reverse.json'].graphRevision = 'g2';
  }), [['stale-analysis', 'server', 'server-forward'], ['stale-analysis', 'server', 'server-reverse']]);
});

test('revision 없는 옛 형식 사전 계산 artifact는 증언 revision이 같아도 보수적으로 analysis-revision-unknown이다', () => {
  const result = workspace(legacyIos());
  assert.deepEqual(result.gaps.map(({ code, member: name, analysis }) => [code, name, analysis]),
    [['analysis-revision-unknown', 'client', 'ios-reverse']]);
  assert.match(result.gaps[0]!.detail, /attested by the trace context .*sha256/);
  const ios = result.analyses.find(({ id }) => id === 'ios-reverse')!;
  assert.deepEqual([ios.source, ios.revision, ios.revisionSource], ['change-impact', 'cli-41d9e0b', 'attested']);
  // 체인 자체는 그대로 잇는다(gap은 신선도를 증명하지 못했다는 표시일 뿐이다).
  assert.deepEqual(result.chains[0]?.routes[0]?.calls[1]?.affected.map(({ usr }) => usr), ['s:OrderStore.refresh', 's:OrderDetailView.body']);
  const stale = workspace(legacyIos('cli-old'));
  assert.match(stale.gaps[0]!.detail, /attested by the trace context/);
  // 단일 project에서 context revision이 없어도 증언 revision은 unknown이다.
  const flat = single((value) => {
    delete value.context.revision;
    delete value.files['android-reverse.json'].revision;
    value.context.analyses.find(({ id }: any) => id === 'android-reverse').precomputed = { sha256: 'a'.repeat(64), revision: 'rev-1' };
  });
  assert.deepEqual(flat.gaps.map(({ code, analysis }) => [code, analysis]), [['analysis-revision-unknown', 'android-reverse']]);
});

test('link match에 걸리지 않은 호출은 개수만 싣고 경로·host를 어떤 필드에도 싣지 않는다', () => {
  const result = workspace((value) => { value.context.links[0].match.hosts = ['other.example.com']; });
  assert.deepEqual(result.gaps.map(({ code, route, detail }) => [code, route?.scope, detail.slice(0, 18)]),
    [['unattributed-calls-omitted', 'mobile->api', '1 route call(s) co']]);
  assert.deepEqual(result.chains[0]?.routes[0]?.calls.map(({ call }) => call.symbol?.usr), ['s:OrdersClient.fetch']);
  assert.doesNotMatch(encodeSortedJson(result), /api\.example\.com|OrdersApi\.get/);
});

/** server member가 두 서비스(example-api·admin-api)의 같은 route를 선언하게 바꾼다. 계약도 example-api다. */
const twoServices = (value: Value) => {
  const http = value.files['server/server.http.json'];
  for (const fact of [...http.facts, ...value.files['server/api.openapi.json'].facts]) fact.service = 'example-api';
  http.facts.push({ ...http.facts[0], service: 'admin-api', location: { path: 'src/admin/orders.ts', line: 4, column: 3 },
    symbol: { qualifiedName: 'admin.orders.get', usr: 'ts:admin/orders.get' } });
};

test('link는 match.services가 좁힌 서비스의 선언만 잇고 다른 서비스로 확정된 호출을 귀속하지 않는다', () => {
  const narrowed = workspace((value) => {
    twoServices(value);
    // host는 맞지만 다른 서비스로 확정된 호출은 이 link 호출이 아니다.
    value.files['client/android.http.json'].facts[0].service = 'admin-api';
  });
  // service 없는 Android POST 호출(baseRef 귀속)은 좁힌 범위 밖 서비스(admin-api)가 있어 추측해 잇지 않는다.
  assert.deepEqual(codes(narrowed), ['link-service-ambiguous', 'unattributed-calls-omitted']);
  assert.match(narrowed.gaps.find(({ code }) => code === 'link-service-ambiguous')!.detail,
    /outside match\.services \(admin-api\), so route calls without a service were not attributed/);
  assert.match(narrowed.gaps.find(({ code }) => code === 'unattributed-calls-omitted')!.detail, /^2 route call/);
  const [route] = narrowed.chains[0]!.routes;
  assert.deepEqual(route?.declarations.map(({ symbol }) => symbol?.usr), ['ts:api/orders.get']);
  assert.deepEqual(narrowed.chains[0]?.handlers.map(({ usr }) => usr), ['ts:api/orders.get']);
  assert.deepEqual(route?.calls.map(({ call }) => call.symbol?.usr), ['s:OrdersClient.fetch']);
  // 선언 측 서비스가 모두 좁힌 범위 안이면 service 없는 host 귀속 호출도 잇는다.
  const single = workspace((value) => {
    for (const fact of [...value.files['server/server.http.json'].facts, ...value.files['server/api.openapi.json'].facts]) {
      fact.service = 'example-api';
    }
  });
  assert.deepEqual(single.gaps, []);
  assert.deepEqual(single.chains[0]?.routes[0]?.calls.map(({ call }) => call.symbol?.usr), ['kt:OrdersApi.get', 's:OrdersClient.fetch']);
});

test('선언 측이 여러 서비스인데 link가 좁히지 않으면 선언을 잇지 않고 link-service-ambiguous다', () => {
  const unnarrowed = workspace((value) => {
    twoServices(value);
    delete value.context.links[0].match.services;
  });
  assert.deepEqual(codes(unnarrowed), ['link-service-ambiguous', 'route-without-decl']);
  const gap = unnarrowed.gaps.find(({ code }) => code === 'link-service-ambiguous')!;
  assert.deepEqual([gap.link, gap.member], ['mobile->api', 'server']);
  assert.match(gap.detail, /several services \(admin-api, example-api\)/);
  assert.deepEqual(unnarrowed.chains, []);
  // 이름 없는 선언이 이름 있는 선언과 섞이면, 좁힌 link에서도 이름 없는 선언은 빼고 gap을 남긴다.
  const mixed = workspace((value) => {
    value.files['server/server.http.json'].facts[1].service = 'example-api';
  });
  // GET decl과 두 계약이 이름 없는 선언이라 빠지고, 그래서 선택한 GET route의 선언 측이 남지 않는다.
  assert.deepEqual(codes(mixed), ['link-service-ambiguous', 'route-without-decl']);
  assert.match(mixed.gaps.find(({ code }) => code === 'link-service-ambiguous')!.detail,
    /^3 server-side declaration\(s\) or contract\(s\) without a service were excluded/);
  assert.deepEqual(mixed.chains, []);
  // 좁히지 않았고 이름 없음 + 이름 하나면 역시 모호하다.
  const unnamedAndNamed = workspace((value) => {
    value.files['server/server.http.json'].facts[1].service = 'example-api';
    delete value.context.links[0].match.services;
  });
  assert.match(unnamedAndNamed.gaps.find(({ code }) => code === 'link-service-ambiguous')!.detail, /example-api, \(no service\)/);
});

test('link 계약이 없으면 server의 openapi 문서가 계약이고, 계약 문서가 openapi가 아니면 거부한다', () => {
  const withoutContract = workspace((value) => {
    const spec = member(value, 'server-spec');
    member(value, 'server').documents.push(...spec.documents);
    value.context.members = value.context.members.filter((entry: any) => entry.name !== 'server-spec');
    delete value.context.links[0].contract;
  });
  assert.deepEqual(withoutContract.gaps, []);
  assert.deepEqual(withoutContract.chains[0]?.routes[0]?.contracts.map(({ member: name }) => name), ['server']);
  assert.throws(() => workspace((value) => {
    member(value, 'server-spec').documents.push('server/db.sql.json');
    member(value, 'server').documents = member(value, 'server').documents.filter((path: string) => path !== 'server/db.sql.json');
    value.context.links[0].contract.documents = ['server/db.sql.json'];
  }), /contract documents must be openapi/);
});

test('link에 해당 역할로 속하지 않은 member의 http 문서와 member별 persistence 공백을 gap으로 남긴다', () => {
  const result = workspace((value) => {
    const web = structuredClone(value.files['client/ios.http.json']);
    web.project = '/work/example-web';
    web.platform = 'js';
    value.files['web/web.http.json'] = web;
    value.context.members.push({ name: 'web', project: '/work/example-web', revision: 'web-1', documents: ['web/web.http.json'] });
    delete value.context.links[0].contract;
    member(value, 'server').documents = member(value, 'server').documents.filter((path: string) => path !== 'server/db.sql.json');
  });
  assert.deepEqual(result.gaps.filter(({ code }) => code !== 'relation-use-without-decl')
    .map(({ code, member: name, detail }) => [code, name, detail.slice(0, 30)]), [
    ['http-member-unlinked', 'web', '1 client-role http document(s)'],
    ['http-member-unlinked', 'server-spec', '1 server-role http document(s)'],
    ['persistence-unscanned', 'server', 'The member lacks a persistence'],
  ]);
  // link가 계약 문서를 골라 쓰면 같은 member의 다른 openapi 문서도 빠진다 — member가 link에 있어도 문서 단위로 밝힌다.
  const extraSpec = workspace((value) => {
    value.files['server/internal.openapi.json'] = structuredClone(value.files['server/api.openapi.json']);
    member(value, 'server-spec').documents.push('server/internal.openapi.json');
  });
  assert.deepEqual(extraSpec.gaps.map(({ code, member: name, detail }) => [code, name, detail.slice(0, 31)]),
    [['http-member-unlinked', 'server-spec', '1 server-role http document(s) ']]);
});

test('workspace 입력이 member 계약을 어기면 부분 결과 없이 거부한다', () => {
  assert.throws(() => workspace((value) => { value.files['client/ios.http.json'].project = '/work/example-server'; }),
    (error: unknown) => error instanceof TraceInputError && /member project/.test(error.message));
  assert.throws(() => workspace((value) => {
    value.files['client/ios.http.json'] = { ...value.files['client/ios.http.json'], target: 'flutter', roles: undefined,
      sourceSets: undefined, facts: [{ kind: 'method-invoke', channel: 'c', method: 'm', dynamic: false,
        location: { path: 'a.dart', line: 1, column: 1 } }], platform: 'dart' };
  }), /bridge-target documents/);
  const input = build(workspaceFixture);
  assert.throws(() => createTraceReport({ ...input, documents: input.documents.slice(1) }), /member document order/);
  assert.throws(() => createTraceReport({ ...input, analyses: input.analyses.map(({ member: _member, ...rest }) => rest) }),
    /must belong to a member/);
  const flat = build(singleFixture);
  assert.throws(() => createTraceReport({ ...flat, analyses: flat.analyses.map((analysis) => ({ ...analysis, member: 'x' })) }),
    /single-project analyses must not/);
});

test('fileSymbols 목록이 사실 없는 파일의 심볼을 분석 위치처럼 잇고 사실 위치 fallback을 없앤다', () => {
  // 사실이 없는 헬퍼 파일이다. 분석은 위치를 싣지 않으므로 목록이 없으면 아무것도 찾지 못한다.
  const helperFile = 'server/service/users.ts';
  const withoutListing = single(select({ files: [helperFile] }));
  assert.deepEqual(codes(withoutListing), ['file-without-symbols']);
  const listed = (reroot: boolean) => single((value) => {
    value.context.selection = { files: [helperFile] };
    value.context.fileSymbols = [{ path: helperFile, platform: 'js', usrs: ['ts:service/users.load'] }];
    if (!reroot) return;
    // capture 2단계가 하듯 목록의 심볼을 역방향 root에 더한다.
    const reverse = value.files['server-reverse.json'];
    reverse.roots.push({ id: 'ts:service/users.load', symbol: { usr: 'ts:service/users.load' } });
    const get = reverse.reached.find(({ symbol }: any) => symbol.usr === 'ts:api/users.get');
    Object.assign(get, { roots: [1, 2], depth: 1, via: 'ts:service/users.load' });
    reverse.reached.sort((left: any, right: any) => left.depth - right.depth || (left.symbol.usr < right.symbol.usr ? -1 : 1));
  });
  const rerooted = listed(true);
  assert.equal(codes(rerooted).includes('file-selection-fact-fallback'), false);
  assert.equal(codes(rerooted).includes('analysis-missing'), false);
  assert.deepEqual(rerooted.chains[0]?.routes.map(({ method, template }) => [method, template]), [['GET', '/api/users/{}']]);
  assert.match(rerooted.notices[0]!.detail, /0 symbol\(s\) located by analyses, 1 more listed in fileSymbols and 0 more/);
  // 목록의 심볼을 root로 순회하지 않았으면 조용히 비우지 않고 analysis-missing으로 드러낸다.
  assert.ok(codes(listed(false)).includes('analysis-missing'));
  // 사실이 있는 파일에서 목록이 비어도(다른 파일만 실어도) 옛 fallback 문구 대신 목록을 언급한다.
  const factsOnly = single((value) => {
    value.context.selection = { files: ['server/db/users.ts', helperFile] };
    value.context.fileSymbols = [{ path: helperFile, platform: 'js', usrs: ['ts:service/users.load'] }];
  });
  assert.match(factsOnly.gaps.find(({ code }) => code === 'file-selection-fact-fallback')!.detail, /or fileSymbols listing/);
});

test('파일 선택은 파일에 놓인 심볼을 과대 근사로 잇고, 분석 위치가 없으면 사실 위치로 대신한다', () => {
  const server = workspace(select({ files: [{ member: 'server', path: 'src/db/orders.ts' }] }));
  // 과대 근사는 영향을 숨기지 않으므로 gap이 아니라 알림이고 --strict를 실패시키지 않는다.
  assert.deepEqual(server.gaps, []);
  assert.equal(hasTraceGaps(server), false);
  assert.deepEqual(server.notices.map(({ code, member: name }) => [code, name]), [['file-selection-coarse', 'server']]);
  assert.equal(server.summary.notices, 1);
  assert.equal(server.summary.gaps, 0);
  assert.match(server.notices[0]!.detail, /2 symbol\(s\) located by analyses and 0 more/);
  const [chain] = server.chains;
  assert.deepEqual(chain?.selector, { file: 'src/db/orders.ts', member: 'server' });
  assert.deepEqual(chain?.routes.map(({ method, template }) => [method, template]), [['POST', '/api/orders'], ['GET', '/api/orders/{}']]);
  assert.equal(chain?.relationUses.length, 3);
  assert.deepEqual(chain?.database.map(({ vertex }) => vertex), ['main.orders', 'main.orders.status']);
  // Kotlin 호출 파일: 분석은 이 파일에 심볼을 두지 않으므로 route-call 사실의 usr로 대신하고, 서버 핸들러에는 닿지 않는다.
  const client = workspace(select({ files: [{ member: 'client', path: 'android/app/src/main/java/example/OrdersApi.kt' }] }));
  // 사실 위치 fallback은 사실 없는 심볼을 빠뜨릴 수 있으므로 알림이 아니라 gap이다.
  assert.deepEqual(codes(client), ['file-selection-fact-fallback', 'non-http-entry']);
  assert.match(client.notices[0]!.detail, /0 symbol\(s\) located by analyses and 2 more/);
  assert.deepEqual(client.gaps.filter(({ code }) => code === 'non-http-entry').map(({ symbol }) => symbol?.usr),
    ['kt:OrdersApi.create', 'kt:OrdersApi.get']);
  const nothing = workspace(select({ files: [{ member: 'server', path: 'README.md' }] }));
  assert.deepEqual(nothing.chains, []);
  assert.deepEqual(codes(nothing), ['file-without-symbols']);
  // 단일 project도 같은 규칙이다. dynamic 사용은 hop이 아니라 gap이다.
  const flat = single((value) => {
    value.context.selection = { files: ['server/db/users.ts'] };
    const base = value.files['server.persistence.json'].facts[0];
    value.files['server.persistence.json'].facts.push({ ...base, channel: 'tableFor(kind)', dynamic: true,
      location: { path: 'server/db/users.ts', line: 30, column: 1 } });
  });
  // 단일 fixture의 분석은 위치를 싣지 않으므로 사실 위치 fallback gap도 남는다.
  assert.deepEqual(codes(flat), ['dynamic-relation-use', 'file-selection-fact-fallback']);
  assert.deepEqual(flat.notices.map(({ code }) => code), ['file-selection-coarse']);
  assert.deepEqual(flat.chains[0]?.selector, { file: 'server/db/users.ts' });
  assert.deepEqual(flat.chains[0]?.routes.map(({ template }) => template), ['/api/users', '/api/users/{}']);
  assert.deepEqual(flat.chains[0]?.relationUses.map(({ relation, column }) => [relation, column]),
    [['users', undefined], ['users', 'email']]);
});

/** TRACE.md gap 표의 코드 목록이다. 문서와 음성 fixture 목록이 어긋나면 이 테스트가 실패한다. */
const documentedCodes = (await readFile(new URL('../../docs/TRACE.md', import.meta.url), 'utf8'))
  .split('\n').flatMap((line) => /^\| `([a-z-]+)` \|/u.exec(line)?.[1] ?? []).sort();

/** gap 코드마다 그 코드를 기대대로 내는 음성 fixture다. */
const gapFixtures: Record<string, () => TraceReport> = {
  'route-without-decl': () => single(select({ routes: [{ method: 'GET', template: '/nope' }] })),
  'handler-without-symbol': () => single((value) => { delete value.files['server.http.json'].facts[0].symbol; }),
  'route-contract-only': () => workspace((value) => {
    const spec = value.files['server/api.openapi.json'];
    spec.facts.push({ ...spec.facts[0], channel: '/api/orders', location: { path: 'openapi.yaml', line: 50, column: 5 },
      symbol: { qualifiedName: 'listOrders' } });
    value.context.selection = { routes: [{ method: 'GET', template: '/api/orders' }] };
  }),
  'relation-use-without-symbol': () => single((value) => { delete value.files['server.persistence.json'].facts[0].symbol; }),
  'relation-decl-without-symbol': () => single((value) => { delete value.files['db.sql.json'].facts[0].symbol.usr; }),
  'call-without-symbol': () => single((value) => { delete value.files['android.http.json'].facts[0].symbol; }),
  'analysis-missing': () => workspace((value) => { member(value, 'client').analyses.shift(); }),
  'analysis-truncated': () => single((value) => {
    Object.assign(value.files['server-forward.json'], { truncated: true, truncationReasons: ['depth'] });
  }),
  'witness-partial': () => single((value) => {
    const db = value.files['db-dependents.json'];
    db.roots.push({ id: 'main.orders', symbol: { usr: 'main.orders' } });
    db.reached = [
      { symbol: { usr: 'main.audit_view' }, via: 'main.users', depth: 1, roots: [0] },
      { symbol: { usr: 'main.v' }, via: 'main.orders', depth: 1, roots: [0, 2] },
      { symbol: { usr: 'main.orders' }, via: 'main.v', depth: 3, roots: [0] },
    ];
  }),
  'roots-provenance-partial': () => workspace((value) => {
    legacyIos()(value);
    value.files[legacyIosPath].changeScope.push({ usr: 's:OrdersClient.create', qualifiedName: 'create' });
  }),
  'candidate-dispatch': () => single((value) => {
    const forward = value.files['server-forward.json'];
    forward.dispatch = 'candidates';
    forward.reached.find(({ symbol }: any) => symbol.usr === 'ts:repo/users.findById').evidence = 'candidate';
  }),
  'reach-possibly-incomplete': () => single((value) => { value.files['server-forward.json'].roots[1].unresolvedCalls = 2; }),
  'reach-completeness-unknown': () => single((value) => { delete value.files['server-forward.json'].dispatch; }),
  'stale-analysis': () => workspace((value) => { value.files['server/server-reverse.json'].revision = 'srv-old'; }),
  'analysis-revision-unknown': () => single((value) => { delete value.files['android-reverse.json'].revision; }),
  'non-http-entry': () => workspace(select({ symbols: [{ member: 'server', platform: 'js', usr: 'ts:jobs/purge.run' }] })),
  'unattributed-calls-omitted': () => workspace((value) => { value.context.links[0].match.services = ['other-api']; }),
  'dynamic-route-calls': () => single((value) => {
    value.files['android.http.json'].facts.push({ kind: 'route-call', method: 'GET', channel: 'base + path', dynamic: true,
      pathAnchor: 'root', location: { path: 'android/D.kt', line: 1, column: 1 } });
  }),
  'ambiguous-route-call': () => single((value) => {
    value.files['server.http.json'].facts.push(
      { kind: 'route-decl', method: 'GET', channel: '/f/a{}', dynamic: false, pathAnchor: 'root',
        location: { path: 'server/f.ts', line: 1, column: 1 }, symbol: { qualifiedName: 'f.a', usr: 'ts:f.a' } },
      { kind: 'route-decl', method: 'GET', channel: '/f/{}b', dynamic: false, pathAnchor: 'root',
        location: { path: 'server/f.ts', line: 2, column: 1 }, symbol: { qualifiedName: 'f.b', usr: 'ts:f.b' } });
    value.files['android.http.json'].facts.push({ kind: 'route-call', method: 'GET', channel: '/f/axb', dynamic: false,
      pathAnchor: 'root', location: { path: 'android/F.kt', line: 1, column: 1 }, symbol: { qualifiedName: 'F.get', usr: 'kt:F.get' } });
    value.context.selection = { routes: [{ method: 'GET', template: '/f/a{}' }] };
  }),
  'test-source-omitted': () => single((value) => {
    value.files['android.http.json'].sourceSets = { tests: 'included' };
    value.files['android.http.json'].facts[0].testSource = true;
  }),
  'http-clients-unscanned': () => workspace((value) => {
    member(value, 'client').documents = [];
    member(value, 'client').documents.push('client/ios.http.json');
    value.files['client/ios.http.json'].roles = ['server'];
    value.files['client/ios.http.json'].facts = [];
  }),
  'http-server-unscanned': () => single((value) => {
    value.context.documents = value.context.documents.filter((path: string) => path !== 'server.http.json');
    value.context.selection = { relations: ['users'] };
  }),
  'persistence-unscanned': () => workspace((value) => {
    member(value, 'server').documents = member(value, 'server').documents.filter((path: string) => path !== 'server/db.sql.json');
  }),
  'relation-use-without-decl': () => single((value) => {
    const base = value.files['server.persistence.json'].facts[0];
    value.files['server.persistence.json'].facts.push({ ...base, channel: 'ghosts', location: { path: 'server/db/users.ts', line: 7, column: 1 } });
  }),
  'column-use-without-decl': () => single((value) => {
    const base = value.files['server.persistence.json'].facts[0];
    value.files['server.persistence.json'].facts.push({ ...base, method: 'nickname', location: { path: 'server/db/users.ts', line: 8, column: 1 } });
  }),
  'relation-use-ambiguous': () => single((value) => {
    value.files['db.sql.json'].facts.push({ kind: 'relation-decl', channel: 'audit.users', dynamic: false,
      symbol: { qualifiedName: 'audit.users', usr: 'audit.users' } });
  }),
  'dynamic-relation-use': () => workspace((value) => {
    const persistence = value.files['server/server.persistence.json'];
    persistence.facts.push({ ...persistence.facts[0], channel: 'tableFor(kind)', dynamic: true,
      location: { path: 'src/db/orders.ts', line: 30, column: 1 } });
  }),
  'relation-selection-ambiguous': () => single((value) => {
    value.files['db.sql.json'].facts.push({ kind: 'relation-decl', channel: 'audit.users', dynamic: false,
      symbol: { qualifiedName: 'audit.users', usr: 'audit.users' } });
    value.context.selection = { relations: ['users'] };
  }),
  'relation-without-decl': () => workspace(select({ relations: [{ member: 'server', name: 'ghosts' }] })),
  'relation-without-use': () => workspace(select({ relations: [{ member: 'server', name: 'order_items' }] })),
  'file-selection-coarse': () => workspace(select({ files: [{ member: 'server', path: 'src/routes/orders.ts' }] })),
  'file-without-symbols': () => single(select({ files: ['docs/README.md'] })),
  'file-selection-fact-fallback': () => workspace(select({ files: [{ member: 'client',
    path: 'android/app/src/main/java/example/OrdersApi.kt' }] })),
  'http-member-unlinked': () => workspace((value) => { value.context.links = []; }),
  'link-service-ambiguous': () => workspace((value) => {
    twoServices(value);
    delete value.context.links[0].match.services;
  }),
};

test('TRACE.md의 모든 gap 코드에 그 코드를 내는 음성 fixture가 있다', () => {
  assert.deepEqual(Object.keys(gapFixtures).sort(), documentedCodes);
  assert.ok(documentedCodes.length >= 33);
  for (const [code, produce] of Object.entries(gapFixtures)) {
    const result = produce();
    const notice = TRACE_NOTICE_CODES.has(code);
    // 알림 등급 코드는 notices에만, 나머지는 gaps에만 실린다.
    assert.ok((notice ? result.notices : result.gaps).some((gap) => gap.code === code), `${code}: ${codes(result).join(', ')}`);
    assert.ok(!(notice ? result.gaps : result.notices).some((gap) => gap.code === code), code);
    if (!notice) assert.equal(hasTraceGaps(result), true, code);
  }
});
