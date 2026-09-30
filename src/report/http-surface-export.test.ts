import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { importHttpSurface } from '../exchange/http-surface.ts';
import { parseBridgeFactsDocument, type BridgeFactsDocument } from '../exchange/parse.ts';
import { createHttpSurface, HttpSurfaceExportError } from './http-surface-export.ts';
import { encodeSortedJson } from './sorted-json.ts';

/**
 * surface 내보내기 — 무엇을 빼는지(개인정보·내부 정보)와 가져오는 쪽 조인에 필요한 것을 남기는지를 검증한다.
 * 입력은 `fixtures/http-surface/server`의 합성 서버 문서다(BFF 호출·테스트 소스·경로가 든 한계를 일부러 담았다).
 */

const root = new URL('../../fixtures/http-surface/server/', import.meta.url);
const read = async (path: string) => parseBridgeFactsDocument(JSON.parse(await readFile(new URL(path, root), 'utf8')));
const server23 = await read('release-2.3/server.http.json');
const spec23 = await read('release-2.3/api.openapi.json');
const options = { name: 'example-api', revision: 'v2.3', exporterVersion: '0.0.0' };

test('기본 내보내기는 위치·핸들러 이름·usr·호출·테스트 소스·project·한계 원문을 싣지 않는다', () => {
  const surface = createHttpSurface([server23, spec23], options);
  const text = encodeSortedJson(surface);
  for (const secret of ['src/routes', 'src/clients', 'test/health', 'orders.get', 'ts:api', 'billing.internal',
    '/v1/charges', '/internal/health', '/work/example-server', 'plugin loader', 'openapi.yaml', 'route-call-coverage']) {
    assert.ok(!text.includes(secret), secret);
  }
  assert.deepEqual(surface.privacy, { handlers: 'opaque', limitations: 'prefix-only' });
  assert.equal(surface.continuation, 'opaque');
  const decls = surface.documents.find(({ platform }) => platform === 'js')!;
  assert.deepEqual(decls.roles, ['server']);
  assert.deepEqual(decls.sourceSets, { tests: 'excluded' });
  assert.deepEqual(decls.facts.map(({ channel, handler }) => [channel, handler]), [
    ['/api/orders/{}', 'h4'], ['/api/orders', 'h3'], ['/api/orders/{}', 'h2'], ['/files/{**}', 'h1'], ['/files', 'h1']]);
  assert.deepEqual(decls.limitations, ['route-coverage: detail withheld by the http surface publisher']);
  assert.deepEqual(decls.limitationScopes, [{ limitationIndex: 0, templatePrefixes: ['/admin'] }]);
  const spec = surface.documents.find(({ platform }) => platform === 'openapi')!;
  assert.deepEqual(spec.facts.map(({ symbol }) => symbol), [{ qualifiedName: 'getOrder' }, { qualifiedName: 'createOrder' },
    { qualifiedName: 'cancelOrder' }]);
  // 내보낸 artifact는 가져오는 쪽 파서를 그대로 통과한다.
  assert.equal(importHttpSurface(JSON.parse(text)).documents.length, 2);
});

test('같은 입력이면 문서 순서와 무관하게 같은 바이트다', () => {
  assert.equal(encodeSortedJson(createHttpSurface([server23, spec23], options)),
    encodeSortedJson(createHttpSurface([spec23, server23], options)));
});

test('게시자가 고르면 핸들러 usr와 한계 원문을 싣는다(핸들러 이름·위치는 여전히 싣지 않는다)', () => {
  const surface = createHttpSurface([server23], { ...options, includeHandlerUsrs: true, includeLimitationText: true });
  const text = encodeSortedJson(surface);
  assert.deepEqual(surface.privacy, { handlers: 'usr', limitations: 'full' });
  assert.ok(text.includes('ts:api/orders.get') && text.includes('plugin loader'));
  assert.ok(!text.includes('"orders.get"') && !text.includes('src/routes/orders.ts'));
  assert.ok(!text.includes('ts:test/health.probe') && !text.includes('route-call-coverage'));
  const facts = importHttpSurface(JSON.parse(text)).documents[0]!.facts;
  assert.deepEqual(facts[0]!.symbol, { qualifiedName: 'ts:api/orders.get', usr: 'ts:api/orders.get' });
});

test('dynamic 선언의 원문과 router group 이름을 싣지 않는다', () => {
  const django: BridgeFactsDocument = parseBridgeFactsDocument({
    format: 'bridge-facts', version: 1, tool: { name: 'synthetic', version: '0.0.0' }, generatedAt: '2026-09-30T00:00:00Z',
    platform: 'python', target: 'http', project: '/work/django', roles: ['server'], dispatch: 'registration-order',
    facts: [
      { kind: 'route-decl', method: 'ANY', channel: '/items/{}/', dynamic: false, pathAnchor: 'root',
        location: { path: 'shop/urls.py', line: 3, column: 5 }, symbol: { qualifiedName: 'shop.views.item', usr: 'py:shop.views.item' },
        order: { group: 'django:config.urls', index: 2 } },
      { kind: 'route-decl', method: 'ANY', channel: 'settings.ADMIN_URL + "x"', dynamic: true, pathAnchor: 'root',
        location: { path: 'shop/urls.py', line: 4, column: 5 }, order: { group: 'django:config.urls', index: 3 } },
      { kind: 'route-decl', method: 'ANY', channel: '/health', dynamic: false, pathAnchor: 'root',
        location: { path: 'ops/urls.py', line: 1, column: 1 }, order: { group: 'django:ops.urls', index: 0 } },
    ],
    limitations: ['route-dispatch-order-unknown: middleware in config/settings.py may reorder', 'mystery: note'],
  });
  const surface = createHttpSurface([django], options);
  const text = encodeSortedJson(surface);
  assert.ok(!text.includes('ADMIN_URL') && !text.includes('django:') && !text.includes('settings.py') && !text.includes('mystery'));
  assert.deepEqual(surface.documents[0]!.facts.map(({ channel, order }) => [channel, order]),
    [['/items/{}/', { group: 'g1', index: 2 }], [null, { group: 'g1', index: 3 }], ['/health', { group: 'g2', index: 0 }]]);
  assert.deepEqual(surface.documents[0]!.limitations, ['route-dispatch-order-unknown: detail withheld by the http surface publisher']);
});

test('서버 표면이 아닌 입력은 원인 문구로 거부한다', () => {
  const client = parseBridgeFactsDocument({ ...JSON.parse(JSON.stringify(server23)), roles: ['client'],
    facts: server23.facts.filter(({ kind }) => kind === 'route-call'), dispatch: undefined });
  const expectError = (documents: readonly BridgeFactsDocument[], pattern: RegExp) => assert.throws(
    () => createHttpSurface(documents, options), (error: unknown) => error instanceof HttpSurfaceExportError && pattern.test(error.message));
  expectError([], /at least one/u);
  expectError([client], /client-only/u);
  expectError([server23, { ...spec23, project: '/work/other' }], /same project root/u);
  expectError([{ ...server23, limitations: ['mixed-targets: x'] }], /mixed-targets/u);
  const persistence = parseBridgeFactsDocument({ format: 'bridge-facts', version: 1, tool: { name: 's', version: '0' },
    generatedAt: '2026-09-30T00:00:00Z', platform: 'sql', target: null, project: '/work/example-server', facts: [], limitations: [] });
  expectError([persistence], /only http server documents/u);
  const emptySpec = parseBridgeFactsDocument({ format: 'bridge-facts', version: 1, tool: { name: 's', version: '0' },
    generatedAt: '2026-09-30T00:00:00Z', platform: 'openapi', target: null, project: '/work/example-server', facts: [], limitations: [] });
  const surface = createHttpSurface([emptySpec], options);
  assert.equal(surface.documents[0]!.target, null);
  assert.equal(surface.documents[0]!.roles, undefined);
});
