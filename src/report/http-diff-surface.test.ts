import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { importHttpSurface, type ImportedHttpSurface } from '../exchange/http-surface.ts';
import { parseBridgeFactsDocument } from '../exchange/parse.ts';
import { parseWorkspaceManifest } from '../exchange/trace-context.ts';
import { createHttpSurface } from './http-surface-export.ts';
import { createHttpSurfaceDiff, createHttpWorkspaceDiff, HttpDiffInputError, type HttpWorkspaceSnapshot } from './http-diff.ts';

/**
 * 조직 경계 `diff --http` — 서버 조직이 게시한 surface 두 릴리스(v2.3 → v2.4, DELETE 삭제·items 추가)를 클라이언트 조직의
 * 호출에 교차 평가한다. workspace 매니페스트(surface member)와 surface artifact 두 개를 직접 주는 모드를 모두 본다.
 */

const root = new URL('../../fixtures/http-surface/', import.meta.url);
const text = (path: string) => readFile(new URL(path, root), 'utf8');
const json = async (path: string) => JSON.parse(await text(path));
const load = async (release: string) => {
  const raw = await text(`surfaces/example-api-${release}.surface.json`);
  return { imported: importHttpSurface(JSON.parse(raw)), sha256: createHash('sha256').update(raw, 'utf8').digest('hex') };
};
const v23 = await load('2.3');
const v24 = await load('2.4');
const client = parseBridgeFactsDocument(await json('client/android.http.json'));
const beforeManifest = await json('client/before.workspace.json');
const afterManifest = await json('client/after.workspace.json');

/** 매니페스트와 surface로 workspace 시점을 만든다. */
function snapshot(manifest: unknown, surface: ImportedHttpSurface | undefined): HttpWorkspaceSnapshot {
  const workspace = parseWorkspaceManifest(manifest);
  return { workspace, documents: new Map([['android.http.json', client]]),
    ...(surface === undefined ? {} : { surfaces: new Map([['api', surface]]) }) };
}

const summary = (findings: ReadonlyArray<{ code: string; severity: string; side?: string }>) =>
  findings.map(({ code, severity, side }) => `${side ?? '-'}:${code}:${severity}`).sort();

test('workspace 모드: surface member 두 릴리스의 차이와 깨지는 클라이언트 호출을 증명된 error로 낸다', () => {
  const report = createHttpWorkspaceDiff(snapshot(beforeManifest, v23.imported), snapshot(afterManifest, v24.imported));
  assert.deepEqual(summary(report.findings), [
    'contract:removed-bound-route:error', 'contract:route-added:info', 'contract:route-removed:warning',
    'decl:declaration-coverage-gap:warning', 'decl:declaration-coverage-gap:warning', 'decl:removed-bound-route:error',
    'decl:route-added:info', 'decl:route-removed:warning']);
  const broken = report.findings.find(({ code, side }) => code === 'removed-bound-route' && side === 'decl')!;
  assert.deepEqual(broken.route, { method: 'DELETE', template: '/api/orders/{}', pathAnchor: 'root' });
  assert.equal(broken.calls?.[0]?.call.symbol?.usr, 'kt:OrdersApi.cancel');
  assert.deepEqual(report.workspace?.before.members[0], { name: 'api',
    surface: { name: 'example-api', revision: 'v2.3', sha256: beforeManifest.members[0].surface.sha256 } });
  assert.deepEqual(report.workspace?.after.members[1], { name: 'client', project: '/work/example-client', revision: 'cli-3.2.0' });
  assert.equal(report.summary.provenBrokenCalls, 1);
  // 선언 끝점에는 서버 내부(위치·핸들러)가 없다.
  const removed = report.findings.find(({ code, side }) => code === 'route-removed' && side === 'decl')!;
  assert.deepEqual(removed.evidence?.before?.map(({ location, symbol }) => [location, symbol]), [[undefined, undefined]]);
});

test('workspace 모드: 다른 서버의 surface나 문서 member로 바뀐 server는 비교하지 않는다', async () => {
  const other = importHttpSurface(JSON.parse(JSON.stringify(createHttpSurface(
    [parseBridgeFactsDocument(await json('server/release-2.4/server.http.json'))],
    { name: 'other-api', revision: 'v1', exporterVersion: '0.0.0' }))));
  assert.throws(() => createHttpWorkspaceDiff(snapshot(beforeManifest, v23.imported), snapshot(afterManifest, other)),
    (error: unknown) => error instanceof HttpDiffInputError && /surface name/u.test(error.message));
  const documentMember = structuredClone(afterManifest);
  documentMember.members[0] = { name: 'api', project: '/work/example-server', revision: 'r', documents: ['server.http.json'] };
  documentMember.links[0].contract.documents = ['server.http.json'];
  const server = parseBridgeFactsDocument(await json('server/release-2.4/server.http.json'));
  const after: HttpWorkspaceSnapshot = { workspace: parseWorkspaceManifest(documentMember),
    documents: new Map([['android.http.json', client], ['server.http.json', server]]) };
  assert.throws(() => createHttpWorkspaceDiff(snapshot(beforeManifest, v23.imported), after),
    (error: unknown) => error instanceof HttpDiffInputError && /surface name/u.test(error.message));
  assert.throws(() => createHttpWorkspaceDiff(snapshot(beforeManifest, undefined), snapshot(afterManifest, v24.imported)),
    /Workspace surface was not read/u);
});

test('surface 모드: artifact 두 개를 --clients 호출에 교차 평가하고 신원을 싣는다(계약 깨짐은 authoritative가 아니라 -unverified)', () => {
  const report = createHttpSurfaceDiff({ before: v23.imported.documents, after: v24.imported.documents, clients: [client],
    artifacts: { before: v23, after: v24 } });
  assert.equal(report.project, '/work/example-client');
  assert.deepEqual(report.surface, { name: 'example-api', before: { revision: 'v2.3', sha256: v23.sha256 },
    after: { revision: 'v2.4', sha256: v24.sha256 } });
  assert.ok(summary(report.findings).includes('decl:removed-bound-route:error'));
  assert.ok(summary(report.findings).includes('contract:removed-bound-route-unverified:warning'));
  const noClients = createHttpSurfaceDiff({ before: v23.imported.documents, after: v24.imported.documents, clients: [],
    artifacts: { before: v23, after: v24 } });
  assert.equal(noClients.project, undefined);
  assert.equal(noClients.summary.callImpact, 'not-assessed');
});

test('surface 모드: 이름이 다른 surface와 여러 project의 --clients는 입력 오류다', async () => {
  const other = { imported: { ...v24.imported, surface: { ...v24.imported.surface, name: 'other-api' } }, sha256: v24.sha256 };
  assert.throws(() => createHttpSurfaceDiff({ before: v23.imported.documents, after: v24.imported.documents, clients: [client],
    artifacts: { before: v23, after: other } }), (error: unknown) => error instanceof HttpDiffInputError && /different names/u.test(error.message));
  const elsewhere = { ...client, project: '/work/other-client' };
  assert.throws(() => createHttpSurfaceDiff({ before: v23.imported.documents, after: v24.imported.documents,
    clients: [client, elsewhere], artifacts: { before: v23, after: v24 } }),
  (error: unknown) => error instanceof HttpDiffInputError && /one client project/u.test(error.message));
});

test('workspace 모드: link에 들지 않은 base surface는 읽지 않고 요약에 고정한 sha256만 싣는다', () => {
  const spare = { name: 'spare', surface: { path: '../surfaces/spare.surface.json', sha256: 'a'.repeat(64) } };
  const before = structuredClone(beforeManifest);
  before.members.push(spare);
  const after = structuredClone(afterManifest);
  after.members.push(spare);
  const afterSnapshot = snapshot(after, v24.imported);
  const report = createHttpWorkspaceDiff(snapshot(before, v23.imported), { ...afterSnapshot,
    surfaces: new Map([['api', v24.imported], ['spare', v23.imported]]) });
  assert.deepEqual(report.workspace?.before.members.find(({ name }) => name === 'spare'), { name: 'spare', surface: { sha256: 'a'.repeat(64) } });
  assert.deepEqual(report.workspace?.after.members.find(({ name }) => name === 'spare'),
    { name: 'spare', surface: { name: 'example-api', revision: 'v2.3', sha256: 'a'.repeat(64) } });
});
