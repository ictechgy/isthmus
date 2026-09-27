import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { parseBridgeFactsDocument, type BridgeFactsDocument } from '../exchange/parse.ts';
import { parseWorkspaceManifest } from '../exchange/trace-context.ts';
import { BridgeJoinValidationError } from '../join/join.ts';
import {
  createHttpSurfaceDiff,
  createHttpWorkspaceDiff,
  HttpDiffInputError,
  type HttpDiffDocument,
  type HttpWorkspaceSnapshot,
} from './http-diff.ts';
import { HTTP_DIFF_CODES, type HttpDiffCode, type HttpDiffFinding } from './http-diff-findings.ts';
import { encodeSortedJson } from './sorted-json.ts';
import { TraceInputError } from './trace-inputs.ts';

/**
 * `diff --http` 정책 — finding 코드마다 합성 음성·양성 fixture를 두고, error 전제(reason)마다 하나씩 빠뜨려
 * `-unverified`로 내려가는지, 입력 구성 차이가 관찰 차이로 읽히지 않는지(입력 오류), 출력이 결정적인지 본다.
 */

const project = '/work/api';
let line = 0;

/** 합성 http 문서다. 서버 역할이면 dispatch를, 스펙이 아니면 sourceSets를 채운다. */
function doc(platform: string, roles: string[], facts: unknown[], extra: Record<string, unknown> = {}): BridgeFactsDocument {
  return parseBridgeFactsDocument({
    format: 'bridge-facts', version: 1, tool: { name: 'synthetic', version: '0.0.0' }, generatedAt: '2026-09-28T00:00:00Z',
    platform, target: 'http', project, roles, facts, limitations: [],
    ...(roles.includes('server') && platform !== 'openapi' ? { dispatch: 'specificity' } : {}),
    ...(platform === 'openapi' ? {} : { sourceSets: { tests: 'excluded' } }),
    ...extra,
  });
}

/** route-decl 사실이다. 위치는 호출마다 새 줄이다. */
function decl(method: string, channel: string, extra: Record<string, unknown> = {}) {
  line += 1;
  return { kind: 'route-decl', method, channel, dynamic: false, pathAnchor: 'root',
    location: { path: 'src/api.ts', line, column: 1 }, symbol: { qualifiedName: `${method} ${channel}`, usr: `ts:${method}${channel}` }, ...extra };
}

/** route-contract 사실이다. */
function contract(method: string, channel: string) {
  line += 1;
  return { kind: 'route-contract', method, channel, dynamic: false, pathAnchor: 'root',
    location: { path: 'openapi.yaml', line, column: 1 }, symbol: { qualifiedName: `op${line}` } };
}

/** route-call 사실이다. method가 없으면 동사가 동적인 호출이다. */
function call(method: string | undefined, channel: string, extra: Record<string, unknown> = {}) {
  line += 1;
  return { kind: 'route-call', ...(method === undefined ? { methodDynamic: true } : { method }), channel, dynamic: false,
    pathAnchor: 'root', location: { path: 'app/Api.kt', line, column: 1 }, symbol: { qualifiedName: `call${line}`, usr: `kt:call${line}` }, ...extra };
}

const server = (facts: unknown[], extra: Record<string, unknown> = {}) => doc('js', ['server'], facts, extra);
const clients = (facts: unknown[], extra: Record<string, unknown> = {}) => doc('kotlin', ['client'], facts, extra);
const spec = (facts: unknown[]) => doc('openapi', ['server'], facts);

/** 코드 목록(정렬)이다. */
const codes = (report: HttpDiffDocument) => report.findings.map(({ code }) => code);

/** 코드 하나의 finding을 찾는다. 없으면 실패한다. */
function only(report: HttpDiffDocument, code: HttpDiffCode): HttpDiffFinding {
  const found = report.findings.filter((entry) => entry.code === code);
  assert.equal(found.length, 1, `${code} in ${codes(report).join(',')}`);
  return found[0]!;
}

const fixtureRoot = new URL('../../fixtures/http-diff/', import.meta.url);
const fixture = async (path: string) => parseBridgeFactsDocument(JSON.parse(await readFile(new URL(path, fixtureRoot), 'utf8')));

test('surface fixture: 삭제·변경·rebound·속성 변화와 dynamic 호출 공백을 결정적으로 보고한다', async () => {
  const inputs = {
    before: [await fixture('surface/before.server.json')],
    after: [await fixture('surface/after.server.json')],
    clients: [await fixture('surface/clients.json')],
  };
  const report = createHttpSurfaceDiff(inputs);
  assert.deepEqual([...new Set(codes(report))].sort(), [
    'calls-dynamic', 'changed-bound-route', 'rebound-route-calls', 'removed-bound-route', 'removed-bound-route-unverified',
    'route-added', 'route-catch-all-changed', 'route-param-constraints-changed', 'route-removed', 'route-trailing-slash-changed',
  ]);
  const removed = report.findings.filter(({ code }) => code === 'removed-bound-route');
  assert.deepEqual(removed.map(({ route }) => `${route!.method} ${route!.template}`), ['POST /api/orders', 'DELETE /api/users/{}']);
  assert.equal(removed[1]!.calls![0]!.after.status, 'method-mismatch');
  assert.deepEqual(only(report, 'removed-bound-route-unverified').calls![0]!.reasons, ['method-dynamic']);
  const changed = only(report, 'changed-bound-route');
  assert.equal(changed.calls![0]!.call.route!.template, '/api/orders/42');
  assert.deepEqual(only(report, 'route-param-constraints-changed').change, { before: ['2:int'], after: ['2:uuid'] });
  assert.deepEqual(only(report, 'route-trailing-slash-changed').change, { before: ['strict'], after: ['optional'] });
  assert.deepEqual(only(report, 'route-catch-all-changed').change, { before: ['catch-all-prefix'], after: ['explicit'] });
  const rebound = only(report, 'rebound-route-calls');
  assert.equal(rebound.route!.template, '/api/users/me');
  assert.deepEqual(rebound.calls![0]!.after.routes, [{ method: 'GET', template: '/api/users/{}', pathAnchor: 'root' }]);
  assert.deepEqual(only(report, 'calls-dynamic').counts, { before: 1, after: 1 });
  assert.equal(report.summary.callImpact, 'breaks-found');
  assert.equal(report.summary.brokenCalls, 4);
  assert.equal(report.summary.provenBrokenCalls, 3);
  assert.equal(report.summary.errors, 3);
  assert.equal(report.summary.routesChanged, 2);
  // 입력 순서와 무관하게 바이트 단위로 같다(선언 측 문서를 둘로 나눠 순서를 뒤집는다).
  // catch-all 접두사 선언은 원본과 같은 문서에 있어야 하므로 핸들러 심볼 단위로 나눈다.
  const split = (document: BridgeFactsDocument, half: 0 | 1) => {
    const handlers = [...new Set(document.facts.map(({ symbol }) => symbol?.usr))];
    return parseBridgeFactsDocument({ ...JSON.parse(JSON.stringify(document)),
      facts: document.facts.filter(({ symbol }) => handlers.indexOf(symbol?.usr) % 2 === half) });
  };
  const halves = (document: BridgeFactsDocument) => [split(document, 0), split(document, 1)];
  const forward = createHttpSurfaceDiff({ ...inputs, before: halves(inputs.before[0]!), after: halves(inputs.after[0]!) });
  const backward = createHttpSurfaceDiff({ ...inputs, before: halves(inputs.before[0]!).reverse(),
    after: halves(inputs.after[0]!).reverse() });
  assert.equal(encodeSortedJson(backward), encodeSortedJson(forward));
  assert.deepEqual(forward.findings, report.findings);
});

test('선언이 같으면 finding이 없고 호출 영향은 no-breaks-observed다(완전성 주장이 아니다)', () => {
  const declarations = server([decl('GET', '/a')]);
  const report = createHttpSurfaceDiff({ before: [declarations], after: [declarations], clients: [clients([call('GET', '/a')])] });
  assert.deepEqual(report.findings, []);
  assert.equal(report.summary.callImpact, 'no-breaks-observed');
  assert.equal(report.mode, 'surface');
  assert.equal(report.project, project);
});

test('호출 측 문서가 없으면 표면이 바뀐 scope에 clients-unscanned이고 호출 영향은 not-assessed다', () => {
  const report = createHttpSurfaceDiff({ before: [server([decl('GET', '/a'), decl('GET', '/b')])],
    after: [server([decl('GET', '/a')])], clients: [] });
  assert.deepEqual(codes(report), ['clients-unscanned', 'route-removed']);
  assert.equal(report.summary.callImpact, 'not-assessed');
});

test('대소문자 구분 변화와 끝 슬래시로만 닿던 호출은 changed-bound-route-unverified다', () => {
  const report = createHttpSurfaceDiff({
    before: [server([decl('GET', '/Items', { caseInsensitive: true }), decl('GET', '/list', { trailingSlash: 'optional' })])],
    after: [server([decl('GET', '/Items'), decl('GET', '/list', { trailingSlash: 'strict' })])],
    clients: [clients([call('GET', '/list/')])],
  });
  assert.deepEqual(only(report, 'route-case-sensitivity-changed').change,
    { before: ['case-insensitive'], after: ['case-sensitive'] });
  const changed = only(report, 'changed-bound-route-unverified');
  assert.equal(changed.calls![0]!.after.status, 'trailing-slash-mismatch');
  assert.deepEqual(changed.calls![0]!.reasons, ['after-outcome-unproven']);
});

test('귀속되지 않은 호출과 호출 측 공백 접두사는 개수·접두사만 싣는다', () => {
  const report = createHttpSurfaceDiff({
    before: [server([decl('GET', '/a'), decl('GET', '/b')], { service: 'api' })],
    after: [server([decl('GET', '/a')], { service: 'api' })],
    clients: [clients([call('GET', '/secret/{}', { authority: 'hooks.example.net' })],
      { limitations: ['route-call-coverage: generated client not scanned'] })],
  });
  assert.deepEqual(only(report, 'calls-unattributed').counts, { before: 1, after: 1 });
  assert.equal(only(report, 'client-coverage-gap').detail, 'route-call-coverage:');
  const text = encodeSortedJson(report);
  assert.ok(!text.includes('/secret/') && !text.includes('hooks.example.net'), 'unattributed call path or host leaked');
});

test('head 선언 측 공백 접두사는 declaration-coverage-gap이고 그 위의 깨짐은 -unverified다', () => {
  const report = createHttpSurfaceDiff({
    before: [server([decl('GET', '/a'), decl('GET', '/b')])],
    after: [server([decl('GET', '/a')], { limitations: ['route-coverage: dynamic router not scanned'] })],
    clients: [clients([call('GET', '/b')])],
  });
  const gap = only(report, 'declaration-coverage-gap');
  assert.deepEqual([gap.snapshot, gap.side, gap.detail], ['after', 'decl', 'route-coverage:']);
  assert.deepEqual(only(report, 'removed-bound-route-unverified').calls![0]!.reasons, ['after-declaration-gap']);
});

test('dynamic 선언은 표면 변화와 무관하게 declarations-dynamic으로 남는다', () => {
  const dynamic = { kind: 'route-decl', method: 'GET', channel: null, dynamic: true, pathAnchor: 'root',
    location: { path: 'src/api.ts', line: 900, column: 1 } };
  const report = createHttpSurfaceDiff({ before: [server([decl('GET', '/a'), dynamic])], after: [server([decl('GET', '/a')])],
    clients: [] });
  const finding = only(report, 'declarations-dynamic');
  assert.deepEqual([finding.side, finding.counts], ['decl', { before: 1, after: 0 }]);
  assert.equal(report.summary.incompleteness, 1);
});

test('스펙 operation 삭제는 surface 모드에서 contract-not-authoritative, 스펙이 비면 after-not-evaluated다', () => {
  const declarations = server([decl('GET', '/a')]);
  const emptySpec = parseBridgeFactsDocument({ format: 'bridge-facts', version: 1, tool: { name: 'synthetic', version: '0.0.0' },
    generatedAt: '2026-09-28T00:00:00Z', platform: 'openapi', target: null, project, facts: [], limitations: [] });
  const report = createHttpSurfaceDiff({ before: [declarations, spec([contract('GET', '/a'), contract('GET', '/b')])],
    after: [declarations, spec([contract('GET', '/a')])], clients: [clients([call('GET', '/b')])] });
  const removed = only(report, 'removed-bound-route-unverified');
  assert.equal(removed.side, 'contract');
  assert.deepEqual(removed.calls![0]!.reasons, ['contract-not-authoritative']);
  const emptied = createHttpSurfaceDiff({ before: [declarations, spec([contract('GET', '/b')])], after: [declarations, emptySpec],
    clients: [clients([call('GET', '/b')])] });
  assert.deepEqual(only(emptied, 'removed-bound-route-unverified').calls![0]!.reasons,
    ['after-not-evaluated', 'contract-not-authoritative']);
});

test('service 이름이 바뀌면 옛 scope에 결합하던 호출은 head에서 귀속되지 않아 -unverified다', () => {
  const report = createHttpSurfaceDiff({ before: [server([decl('GET', '/a')], { service: 'api' })],
    after: [server([decl('GET', '/a')], { service: 'api-v2' })], clients: [clients([call('GET', '/a', { service: 'api' })])] });
  const removed = only(report, 'removed-bound-route-unverified');
  assert.equal(removed.scope, 'api');
  assert.deepEqual(removed.calls![0]!.after, { status: 'unattributed' });
  assert.ok(removed.calls![0]!.reasons!.includes('after-unattributed'));
  assert.deepEqual(report.findings.filter(({ code }) => code === 'route-added').map(({ scope }) => scope), ['api-v2']);
});

test('증명하지 못한 결합·base 호출·마스킹·테스트 소스 호출의 깨짐은 모두 -unverified이고 reason을 싣는다', () => {
  const before = server([decl('GET', '/api/items/{}'), decl('GET', '/api/hooks/{}'), decl('GET', '/api/probe'),
    decl('GET', '/items', { pathAnchor: 'base' })]);
  const report = createHttpSurfaceDiff({ before: [before], after: [server([decl('GET', '/keep')])], clients: [clients([
    call('GET', '/items/{}', { pathAnchor: 'base' }),
    call('GET', '/api/hooks/{}', { maskedSegments: 1 }),
    call('GET', '/api/probe', { testSource: true }),
    call('GET', '/v1/items'),
  ], { sourceSets: { tests: 'included' } })] });
  const reasons = report.findings.filter(({ code }) => code === 'removed-bound-route-unverified')
    .flatMap(({ calls }) => calls ?? []).flatMap(({ reasons: entry }) => entry ?? []);
  for (const reason of ['before-binding-unproven', 'base-anchored-call', 'masked-call', 'test-source']) {
    assert.ok(reasons.includes(reason as never), `${reason} missing`);
  }
  assert.equal(report.summary.errors, 0);
});

test('모호하게 닿던 호출은 결합 후보로 보고 head에서 후보 하나에 결합하면 깨짐이 아니다', () => {
  const ambiguousCall = call('GET', '/items/{}', { pathAnchor: 'base' });
  const before = server([decl('GET', '/a/items/{}'), decl('GET', '/b/items/{}')]);
  const kept = createHttpSurfaceDiff({ before: [before], after: [server([decl('GET', '/a/items/{}')])],
    clients: [clients([ambiguousCall])] });
  assert.ok(!codes(kept).some((code) => code.includes('bound-route')), codes(kept).join(','));
  const lost = createHttpSurfaceDiff({ before: [before], after: [server([decl('GET', '/c')])], clients: [clients([ambiguousCall])] });
  const findings = lost.findings.filter(({ code }) => code === 'removed-bound-route-unverified');
  assert.equal(findings.length, 2);
  assert.equal(findings[0]!.calls![0]!.before.status, 'ambiguous');
});

test('head에서 모호해진 호출은 base route가 후보에 남아도 증명된 결합이 아니라 -unverified 깨짐이다', () => {
  const report = createHttpSurfaceDiff({ before: [server([decl('GET', '/files/{}.json')])],
    after: [server([decl('GET', '/files/{}.json'), decl('GET', '/files/data.{}')])], clients: [clients([call('GET', '/files/data.json')])] });
  const changed = only(report, 'changed-bound-route-unverified');
  assert.equal(changed.calls![0]!.after.status, 'ambiguous');
  assert.ok(changed.calls![0]!.after.routes!.some(({ template }) => template === '/files/{}.json'));
  assert.ok(changed.calls![0]!.reasons!.includes('after-outcome-unproven'));
  assert.equal(report.summary.provenBrokenCalls, 0);
});

test('서버·클라이언트를 겸하는 문서는 선언 측과 호출 측으로 각각 투영한다', () => {
  const bff = (facts: unknown[]) => doc('js', ['server', 'client'], facts);
  const report = createHttpSurfaceDiff({ before: [bff([decl('GET', '/a'), decl('GET', '/b'), call('GET', '/x')])],
    after: [bff([decl('GET', '/a'), call('GET', '/y')])], clients: [bff([decl('GET', '/zzz'), call('GET', '/b')])] });
  assert.equal(only(report, 'removed-bound-route').route!.template, '/b');
  assert.ok(!report.findings.some(({ route }) => route?.template === '/zzz'));
});

test('surface 입력 구성 차이는 관찰 차이가 아니라 입력 오류다', () => {
  const declarations = server([decl('GET', '/a')]);
  const other = parseBridgeFactsDocument({ ...JSON.parse(JSON.stringify(declarations)), project: '/work/other' });
  const persistence = parseBridgeFactsDocument({ format: 'bridge-facts', version: 1, tool: { name: 'synthetic', version: '0' },
    generatedAt: '2026-09-28T00:00:00Z', platform: 'sql', target: null, project, facts: [], limitations: [] });
  const cases: Array<[() => unknown, RegExp]> = [
    [() => createHttpSurfaceDiff({ before: [declarations], after: [other], clients: [] }), /one project/],
    [() => createHttpSurfaceDiff({ before: [declarations], after: [declarations, spec([])], clients: [] }), /same producers/],
    [() => createHttpSurfaceDiff({ before: [declarations], after: [server([decl('GET', '/a')], { sourceSets: { tests: 'included' } })],
      clients: [] }), /same producers/],
    [() => createHttpSurfaceDiff({ before: [declarations], after: [clients([])], clients: [] }), /client-only documents/],
    [() => createHttpSurfaceDiff({ before: [declarations], after: [declarations], clients: [declarations] }), /client role/],
    [() => createHttpSurfaceDiff({ before: [declarations, persistence], after: [declarations], clients: [] }), /only http-target/],
    [() => createHttpSurfaceDiff({ before: [], after: [declarations], clients: [] }), /at least one server or spec/],
  ];
  for (const [run, message] of cases) assert.throws(run, (error: unknown) => error instanceof HttpDiffInputError && message.test(error.message));
  const mixed = server([decl('GET', '/a')], { service: 'api' });
  assert.throws(() => createHttpSurfaceDiff({ before: [mixed, server([decl('GET', '/b')])], after: [mixed, server([decl('GET', '/b')])],
    clients: [] }), BridgeJoinValidationError);
});

/* ───────────── workspace ───────────── */

const workspaceRoot = new URL('workspace/', fixtureRoot);

/** 매니페스트와 그 문서를 읽어 한 시점을 만든다(fixture 경로는 매니페스트 기준). */
async function workspaceSnapshot(name: string, mutate: (manifest: any) => void = () => {},
  overrides: Record<string, BridgeFactsDocument> = {}): Promise<HttpWorkspaceSnapshot> {
  const manifest = JSON.parse(await readFile(new URL(name, workspaceRoot), 'utf8'));
  mutate(manifest);
  const workspace = parseWorkspaceManifest(manifest);
  const documents = new Map<string, BridgeFactsDocument>();
  for (const path of workspace.documents) {
    documents.set(path, overrides[path] ?? parseBridgeFactsDocument(JSON.parse(await readFile(new URL(path, workspaceRoot), 'utf8'))));
  }
  return { workspace, documents };
}

test('workspace fixture: authoritative 계약과 서버의 삭제가 link마다 깨진 호출로 나온다', async () => {
  const report = createHttpWorkspaceDiff(await workspaceSnapshot('before.workspace.json'), await workspaceSnapshot('after.workspace.json'));
  assert.equal(report.mode, 'workspace');
  assert.deepEqual(report.findings.map(({ code, side }) => `${code}:${side}`), [
    'removed-bound-route:contract', 'route-removed:contract', 'removed-bound-route:decl', 'route-removed:decl']);
  assert.equal(report.findings[0]!.scope, 'mobile->api');
  assert.equal(report.workspace!.before.members.find(({ name }) => name === 'server')!.revision, 'srv-base');
  assert.equal(report.workspace!.links[0]!.contract!.authoritative, true);
  assert.equal(report.summary.brokenCalls, 1);
});

test('workspace: 서비스 범위를 못 정한 link와 link 밖 client 문서는 incompleteness로 남는다', async () => {
  const twoServices = doc('js', ['server'], [decl('GET', '/api/orders/{}', { service: 'orders' }), decl('POST', '/api/orders', { service: 'billing' })],
    { project: '/work/example-server', tool: { name: 'synthetic-http-diff', version: '0.0.0' } });
  const before = await workspaceSnapshot('before.workspace.json');
  const after = await workspaceSnapshot('after.workspace.json', () => {}, { 'server-after/server.http.json': twoServices });
  const ambiguous = createHttpWorkspaceDiff(before, after);
  const issue = only(ambiguous, 'link-service-ambiguous');
  assert.equal(issue.snapshot, 'after');
  assert.match(issue.detail!, /several services/);
  const moved = await workspaceSnapshot('after.workspace.json', (manifest) => {
    manifest.members.push({ name: 'web', project: '/work/example-web', revision: 'web-1', documents: ['client/web.http.json'] });
  }, { 'client/web.http.json': parseBridgeFactsDocument({ ...JSON.parse(JSON.stringify(clients([call('GET', '/api/x')]))),
    project: '/work/example-web' }) });
  const unlinked = createHttpWorkspaceDiff(before, moved);
  const finding = only(unlinked, 'http-member-unlinked');
  assert.deepEqual([finding.member, finding.counts], ['web', { after: 1 }]);
});

test('workspace: server member 문서의 호출은 평가하지 않는다(호출은 head client member에서만 온다)', async () => {
  const bff = (manifestDocument: BridgeFactsDocument) => parseBridgeFactsDocument({ ...JSON.parse(JSON.stringify(manifestDocument)),
    roles: ['server', 'client'], facts: [...JSON.parse(JSON.stringify(manifestDocument.facts)), { kind: 'route-call', method: 'GET',
      channel: '/api/orders/{}', dynamic: false, pathAnchor: 'root', authority: 'api.example.com',
      location: { path: 'src/bff.ts', line: 1, column: 1 }, symbol: { qualifiedName: 'bff', usr: 'ts:bff' } }] });
  const plain = await workspaceSnapshot('before.workspace.json');
  const path = 'server-before/server.http.json';
  const before = await workspaceSnapshot('before.workspace.json', () => {}, { [path]: bff(plain.documents.get(path)!) });
  const report = createHttpWorkspaceDiff(before, await workspaceSnapshot('after.workspace.json'));
  assert.ok(!encodeSortedJson(report).includes('ts:bff'));
  assert.equal(report.summary.brokenCalls, 1);
});

test('workspace: link 정의·서버 project·인벤토리가 다르면 입력 오류다', async () => {
  const before = await workspaceSnapshot('before.workspace.json');
  const changedMatch = await workspaceSnapshot('after.workspace.json', (manifest) => { manifest.links[0].match.hosts = ['api2.example.com']; });
  assert.throws(() => createHttpWorkspaceDiff(before, changedMatch), /same links/);
  const reordered = await workspaceSnapshot('after.workspace.json', (manifest) => {
    manifest.links[0].match = { services: ['b', 'a'], hosts: ['api.example.com'] };
  });
  const reorderedBefore = await workspaceSnapshot('before.workspace.json', (manifest) => {
    manifest.links[0].match = { hosts: ['api.example.com'], services: ['a', 'b'] };
  });
  assert.equal(createHttpWorkspaceDiff(reorderedBefore, reordered).format, 'isthmus-http-diff');
  const movedProject = await workspaceSnapshot('after.workspace.json', (manifest) => {
    manifest.members[0].project = '/work/elsewhere';
  }, { 'server-after/server.http.json': parseBridgeFactsDocument({ ...JSON.parse(JSON.stringify(server([decl('GET', '/a')]))),
    project: '/work/elsewhere' }) });
  assert.throws(() => createHttpWorkspaceDiff(before, movedProject), /keep its project/);
  const noSpec = await workspaceSnapshot('after.workspace.json', (manifest) => {
    manifest.members[1].documents = ['server-after/server.http.json', 'server-after/api.openapi.json'];
    manifest.members[0].documents = ['extra.json'];
  }, { 'extra.json': parseBridgeFactsDocument({ ...JSON.parse(JSON.stringify(doc('kotlin', ['server'], []))),
    project: '/work/example-server' }) });
  assert.throws(() => createHttpWorkspaceDiff(before, noSpec), /same producers/);
  const wrongProject = await workspaceSnapshot('after.workspace.json', () => {}, {
    'server-after/server.http.json': parseBridgeFactsDocument({ ...JSON.parse(JSON.stringify(server([]))), project: '/work/x' }) });
  assert.throws(() => createHttpWorkspaceDiff(before, wrongProject), TraceInputError);
});

test('workspace 매니페스트는 analyses와 모르는 필드를 거부한다', async () => {
  const manifest = JSON.parse(await readFile(new URL('before.workspace.json', workspaceRoot), 'utf8'));
  assert.throws(() => parseWorkspaceManifest({ ...manifest, members: [{ ...manifest.members[0], analyses: [] }, ...manifest.members.slice(1)] }),
    /do not take analyses/);
  assert.throws(() => parseWorkspaceManifest({ ...manifest, selection: {} }), /unknown field/);
  assert.throws(() => parseWorkspaceManifest({ ...manifest, format: 'isthmus-trace-context' }), /isthmus-workspace version 1/);
  assert.throws(() => parseWorkspaceManifest({ ...manifest, members: [] }), /1 to/);
  assert.throws(() => parseWorkspaceManifest({ ...manifest, members: [manifest.members[0], manifest.members[0]] }), /unique/);
  const duplicated = structuredClone(manifest);
  duplicated.members[1].documents = [...duplicated.members[1].documents, duplicated.members[0].documents[0]];
  assert.throws(() => parseWorkspaceManifest(duplicated), /unique across members/);
});

test('finding 코드 표는 docs/HTTP-DIFF.md와 같다', async () => {
  const text = await readFile(new URL('../../docs/HTTP-DIFF.md', import.meta.url), 'utf8');
  const section = text.slice(text.indexOf('## finding 코드'), text.indexOf('### error 전제'));
  const rows = [...section.matchAll(/^\| `([a-z-]+)` \| (error|warning|info) \| (surface|impact|incompleteness) \|/gmu)]
    .map(([, code, severity, category]) => [code, severity, category]);
  assert.deepEqual(rows, Object.entries(HTTP_DIFF_CODES).map(([code, { severity, category }]) => [code, severity, category]));
});
