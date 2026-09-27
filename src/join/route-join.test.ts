import assert from 'node:assert/strict';
import test from 'node:test';

import { parseBridgeFactsDocument, type BridgeFactsDocument } from '../exchange/parse.ts';
import { parseRouteTemplate, type HttpMethod } from '../exchange/route-template.ts';
import { BridgeJoinValidationError, joinBridgeDocuments } from './join.ts';
import {
  clearlyViolates,
  compareRanks,
  evaluateSegments,
  MAX_ROUTE_SUFFIX_CANDIDATES,
  methodQuality,
  RouteIndex,
  type RouteDeclaration,
  type RouteSideOutcome,
} from './route-index.ts';
import type { RouteJoinResult, RouteScope } from './route-join.ts';

/** 합성 http 문서를 계약 파서로 검증해 만든다. */
function document(platform: string, roles: string[], facts: unknown[], extra: Record<string, unknown> = {}): BridgeFactsDocument {
  return parseBridgeFactsDocument({
    format: 'bridge-facts', version: 1, tool: { name: 'synthetic', version: '0.0.0' },
    generatedAt: '2026-09-27T00:00:00Z', platform, target: 'http', project: '/work/example',
    roles, facts, limitations: [],
    ...(roles.includes('server') && platform !== 'openapi' ? { dispatch: 'specificity' } : {}),
    ...extra,
  });
}

let line = 0;
/** 위치가 겹치지 않는 route 사실이다. */
function fact(kind: string, method: string | undefined, channel: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  line += 1;
  return {
    kind, channel, ...(method === undefined ? {} : { method }), dynamic: false, pathAnchor: 'root',
    location: { path: kind === 'route-call' ? 'app/Api.kt' : 'src/routes.ts', line, column: 1 }, ...extra,
  };
}

const decl = (method: string, channel: string, extra: Record<string, unknown> = {}) => fact('route-decl', method, channel, extra);
const call = (method: string | undefined, channel: string, extra: Record<string, unknown> = {}) => fact('route-call', method, channel, extra);
const contract = (method: string, channel: string, extra: Record<string, unknown> = {}) => fact('route-contract', method, channel, extra);

/** 서버·클라이언트 문서를 조인해 route 결과를 돌려준다. */
function joinRoutes(...documents: BridgeFactsDocument[]): RouteJoinResult {
  const routes = joinBridgeDocuments(documents).routes;
  assert.ok(routes !== undefined);
  return routes;
}

/** 단일 scope의 첫 호출 decl 결과다. */
function declOutcome(scope: RouteScope, template: string, method?: string): RouteSideOutcome | undefined {
  return scope.calls.find((item) => item.template === template && item.method === method)?.decl;
}

/** 결과가 match면 대상 템플릿들을, 아니면 상태를 돌려준다. */
function describe(outcome: RouteSideOutcome | undefined): string {
  if (outcome === undefined) return 'none';
  if (outcome.status === 'matched') return `matched:${outcome.quality}:${outcome.targets.map((t) => `${t.method} ${t.template}`).join(',')}`;
  if (outcome.status === 'ambiguous') return `ambiguous:${outcome.targets.map((t) => t.template).join(',')}`;
  if (outcome.status === 'method-mismatch') return `method-mismatch:${outcome.provable ? 'provable' : 'unprovable'}`;
  if (outcome.status === 'near-miss') return `near-miss:${outcome.reason}`;
  return 'missing';
}

test('/users/me 호출은 리터럴 decl에, /users/{} 호출은 파라미터 decl에만 match한다', () => {
  const routes = joinRoutes(
    document('js', ['server'], [decl('GET', '/users/me'), decl('GET', '/users/{}')]),
    document('kotlin', ['client'], [call('GET', '/users/me'), call('GET', '/users/{}'), call('GET', '/users/42')]),
  );
  const scope = routes.scopes[0]!;
  assert.equal(scope.scope, 'default');
  assert.equal(describe(declOutcome(scope, '/users/me', 'GET')), 'matched:exact:GET /users/me');
  // 호출 파라미터는 decl 파라미터가 있으면 리터럴에 붙지 않는다(정적 우선 오독 방지).
  assert.equal(describe(declOutcome(scope, '/users/{}', 'GET')), 'matched:exact:GET /users/{}');
  assert.equal(describe(declOutcome(scope, '/users/42', 'GET')), 'matched:exact:GET /users/{}');
});

test('호출 파라미터가 decl 리터럴에만 맞으면 param-to-literal이고, 둘 이상이면 모호하다', () => {
  const routes = joinRoutes(
    document('js', ['server'], [decl('GET', '/articles/featured'), decl('GET', '/tags/new'), decl('GET', '/tags/top')]),
    document('kotlin', ['client'], [call('GET', '/articles/{}'), call('GET', '/tags/{}')]),
  );
  const scope = routes.scopes[0]!;
  assert.equal(describe(declOutcome(scope, '/articles/{}', 'GET')), 'matched:param-to-literal:GET /articles/featured');
  assert.equal(describe(declOutcome(scope, '/tags/{}', 'GET')), 'ambiguous:/tags/new,/tags/top');
});

test('/files는 명시적 decl이 있으면 명시적 decl에, 없으면 catch-all 접두사 decl에 match한다', () => {
  const symbol = { qualifiedName: 'Files.get', usr: 'files-get' };
  const catchAll = [decl('GET', '/files/{**}', { symbol }), decl('GET', '/files', { symbol, catchAllPrefix: true })];
  const withExplicit = joinRoutes(
    document('js', ['server'], [...catchAll, decl('GET', '/files', { symbol: { qualifiedName: 'Files.list', usr: 'files-list' } })]),
    document('kotlin', ['client'], [call('GET', '/files'), call('GET', '/files/a/b'), call('GET', '/files/')]),
  ).scopes[0]!;
  assert.equal(describe(declOutcome(withExplicit, '/files', 'GET')), 'matched:exact:GET /files');
  const target = (declOutcome(withExplicit, '/files', 'GET') as Extract<RouteSideOutcome, { status: 'matched' }>).targets[0]!;
  assert.equal(target.catchAllPrefix, false);
  assert.equal(describe(declOutcome(withExplicit, '/files/a/b', 'GET')), 'matched:catch-all:GET /files/{**}');
  // 빈 끝 세그먼트만 남으면 증명 불가 후보라 모호함·error 근거가 아니다.
  assert.equal(describe(declOutcome(withExplicit, '/files/', 'GET')), 'matched:param-to-literal:GET /files/{**}');
  const onlyCatchAll = joinRoutes(
    document('js', ['server'], catchAll),
    document('kotlin', ['client'], [call('GET', '/files')]),
  ).scopes[0]!;
  assert.equal(describe(declOutcome(onlyCatchAll, '/files', 'GET')), 'matched:catch-all:GET /files');
  // 접두사 decl이 없으면 /files는 {**}와 맞지 않는다. 슬래시를 붙이면 빈 끝 세그먼트로 닿는
  // 증명 불가 후보가 있어 error 대신 끝 슬래시 불일치 warning이다(두 미상이 겹친 경우).
  const withoutPrefix = joinRoutes(
    document('js', ['server'], [decl('GET', '/files/{**}')]),
    document('kotlin', ['client'], [call('GET', '/files')]),
  ).scopes[0]!;
  assert.equal(describe(declOutcome(withoutPrefix, '/files', 'GET')), 'near-miss:trailing-slash');
  // 접두사 decl로 닿은 호출은 원본 {**} decl도 호출한 것으로 본다.
  assert.deepEqual(onlyCatchAll.decls.map(({ called }) => called), [true, true]);
});

test('부분 세그먼트와 경로 제약(닫힌 종류만 평가, regex는 증명 불가)을 적용한다', () => {
  const scope = joinRoutes(
    document('js', ['server'], [
      decl('GET', '/files/{}.json'),
      decl('GET', '/users/{}', { paramConstraints: [{ segment: 1, kind: 'int' }] }),
      decl('GET', '/orders/{}', { paramConstraints: [{ segment: 1, kind: 'regex', pattern: '[0-9]+' }] }),
      decl('GET', '/v/{}', { paramConstraints: [{ segment: 1, kind: 'uuid' }] }),
      decl('GET', '/v/{}'),
    ]),
    document('kotlin', ['client'], [
      call('GET', '/files/a.json'), call('GET', '/files/{}.json'), call('GET', '/files/.json'),
      call('GET', '/users/12'), call('GET', '/users/me'), call('GET', '/users/%20'),
      call('GET', '/orders/abc'),
      call('GET', '/v/550e8400-e29b-41d4-a716-446655440000'), call('GET', '/v/latest'),
    ]),
  ).scopes[0]!;
  assert.equal(describe(declOutcome(scope, '/files/a.json', 'GET')), 'matched:param-to-literal:GET /files/{}.json');
  assert.equal(describe(declOutcome(scope, '/files/{}.json', 'GET')), 'matched:exact:GET /files/{}.json');
  assert.equal(describe(declOutcome(scope, '/files/.json', 'GET')), 'missing');
  assert.equal(describe(declOutcome(scope, '/users/12', 'GET')), 'matched:exact:GET /users/{}');
  // int 제약을 명백히 어기면 후보에서 빠진다. 퍼센트 인코딩은 해석하지 않고 남긴다.
  assert.equal(describe(declOutcome(scope, '/users/me', 'GET')), 'missing');
  assert.equal(describe(declOutcome(scope, '/users/%20', 'GET')), 'matched:exact:GET /users/{}');
  assert.equal(describe(declOutcome(scope, '/orders/abc', 'GET')), 'matched:param-to-literal-constrained:GET /orders/{}');
  // 제약만 다른 같은 템플릿은 모두 match 대상이고 제약 있는 쪽 순위가 높다.
  assert.equal(describe(declOutcome(scope, '/v/550e8400-e29b-41d4-a716-446655440000', 'GET')),
    'matched:exact:GET /v/{},GET /v/{}');
  // uuid 제약을 어긴 값은 제약 없는 decl에만 닿는다.
  assert.equal(describe(declOutcome(scope, '/v/latest', 'GET')), 'matched:exact:GET /v/{}');
});

test('method는 정확히 같아야 하고 ANY·HEAD·OPTIONS·동적 동사만 예외다', () => {
  const scope = joinRoutes(
    document('js', ['server'], [decl('GET', '/a'), decl('ANY', '/b'), decl('POST', '/c')]),
    document('kotlin', ['client'], [
      call('HEAD', '/a'), call('OPTIONS', '/c'), call('DELETE', '/b'), call(undefined, '/c', { methodDynamic: true }),
      call('PUT', '/a'),
    ]),
  ).scopes[0]!;
  assert.equal(describe(declOutcome(scope, '/a', 'HEAD')), 'matched:head-as-get:GET /a');
  assert.equal(describe(declOutcome(scope, '/c', 'OPTIONS')), 'matched:options-any:POST /c');
  assert.equal(describe(declOutcome(scope, '/b', 'DELETE')), 'matched:any-method:ANY /b');
  assert.equal(describe(declOutcome(scope, '/c', undefined)), 'matched:exact:POST /c');
  assert.equal(describe(declOutcome(scope, '/a', 'PUT')), 'method-mismatch:provable');
  assert.equal(methodQuality('GET', 'POST'), undefined);
});

test('끝 슬래시·대소문자만 다르면 불일치로 내리고, optional·caseInsensitive decl은 match한다', () => {
  const scope = joinRoutes(
    document('js', ['server'], [
      decl('GET', '/a'), decl('GET', '/B'), decl('GET', '/c', { trailingSlash: 'optional' }),
      decl('GET', '/d/', { trailingSlash: 'optional' }), decl('GET', '/E', { caseInsensitive: true }),
    ]),
    document('kotlin', ['client'], [
      call('GET', '/a/'), call('GET', '/b'), call('GET', '/c/'), call('GET', '/d'), call('GET', '/e'), call('GET', '/'),
    ]),
  ).scopes[0]!;
  assert.equal(describe(declOutcome(scope, '/a/', 'GET')), 'near-miss:trailing-slash');
  assert.equal(describe(declOutcome(scope, '/b', 'GET')), 'near-miss:case');
  assert.equal(describe(declOutcome(scope, '/c/', 'GET')), 'matched:exact:GET /c');
  assert.equal(describe(declOutcome(scope, '/d', 'GET')), 'matched:exact:GET /d/');
  assert.equal(describe(declOutcome(scope, '/e', 'GET')), 'matched:exact:GET /E');
  assert.equal(describe(declOutcome(scope, '/', 'GET')), 'missing');
});

test('pathAnchor 네 조합: root↔root 정확, base 호출↔root decl suffix, root 호출↔base decl suffix, base↔base 없음', () => {
  const scope = joinRoutes(
    document('js', ['server'], [
      decl('GET', '/api/v1/items/{}'), decl('GET', '/admin/items/{}'),
      decl('GET', '/reports/{}', { pathAnchor: 'base' }), decl('POST', '/exports', { pathAnchor: 'base' }),
    ]),
    document('kotlin', ['client'], [
      call('GET', '/v1/items/{}', { pathAnchor: 'base' }),
      call('GET', '/items/{}', { pathAnchor: 'base' }),
      call('GET', '/{}', { pathAnchor: 'base' }),
      call('GET', '/api/reports/7'),
      call('GET', '/svc/exports'),
      call('GET', '/reports/7', { pathAnchor: 'base' }),
    ]),
  ).scopes[0]!;
  assert.equal(describe(declOutcome(scope, '/v1/items/{}', 'GET')), 'matched:suffix:GET /api/v1/items/{}');
  // 구체성이 같은 suffix 후보(서로 다른 접두사의 같은 꼬리)는 모호하다.
  assert.equal(describe(declOutcome(scope, '/items/{}', 'GET')), 'ambiguous:/api/v1/items/{},/admin/items/{}');
  // 리터럴 세그먼트가 없는 base 호출은 suffix 후보를 만들지 않는다.
  assert.equal(describe(declOutcome(scope, '/{}', 'GET')), 'missing');
  assert.equal(describe(declOutcome(scope, '/api/reports/7', 'GET')), 'matched:suffix:GET /reports/{}');
  // suffix 위의 method 불일치는 증명 불가다.
  assert.equal(describe(declOutcome(scope, '/svc/exports', 'GET')), 'method-mismatch:unprovable');
  assert.equal(describe(declOutcome(scope, '/reports/7', 'GET')), 'missing');
});

test('suffix 후보는 호출당 상한을 넘으면 모호함으로 본다', () => {
  const decls = Array.from({ length: MAX_ROUTE_SUFFIX_CANDIDATES + 1 }, (_, index) => decl('GET', `/p${index}/items`));
  const scope = joinRoutes(
    document('js', ['server'], decls),
    document('kotlin', ['client'], [call('GET', '/items', { pathAnchor: 'base' })]),
  ).scopes[0]!;
  const outcome = declOutcome(scope, '/items', 'GET');
  assert.equal(outcome?.status, 'ambiguous');
  assert.equal(outcome.status === 'ambiguous' && outcome.capped, true);
});

test('dynamic 사실은 조인하지 않고 소비자가 센다', () => {
  const joined = joinBridgeDocuments([
    document('js', ['server'], [decl('GET', '/a'), { ...decl('GET', 'prefix + x'), dynamic: true }]),
    document('kotlin', ['client'], [
      call('GET', '/a'),
      { ...call('GET', 'base + "/x"'), dynamic: true, channelPrefix: '/x' },
      { ...call('GET', 'u'), dynamic: true, channel: null },
    ]),
  ]);
  const scope = joined.routes!.scopes[0]!;
  assert.equal(scope.calls.length, 1);
  assert.equal(scope.dynamicDecls, 1);
  assert.equal(scope.dynamicCalls, 2);
  assert.equal(scope.prefixCalls.length, 1);
  assert.deepEqual(joined.limitations.map(({ message }) => message), [
    'unjoined-dynamic-routes: 1 route declaration or contract facts with a non-literal template were not joined',
    'unjoined-dynamic-route-calls: 2 route call facts with a non-literal template were not joined',
  ]);
});

test('귀속 게이트: 단일 서비스 입력은 service 없는 호출만, 다중 서비스 입력은 같은 service 호출만 잇는다', () => {
  const single = joinRoutes(
    document('js', ['server'], [decl('GET', '/a')]),
    document('kotlin', ['client'], [call('GET', '/a'), call('GET', '/secret-path', { service: 'other', authority: 'hooks.example.com' })]),
  );
  assert.deepEqual(single.scopes.map(({ scope }) => scope), ['default']);
  assert.deepEqual(single.scopes[0]!.calls.map(({ template }) => template), ['/a']);
  assert.equal(single.scopes[0]!.unboundCalls, 1);
  const multi = joinRoutes(
    document('js', ['server'], [decl('GET', '/a')], { service: 'orders' }),
    document('openapi', ['server'], [contract('GET', '/b', { service: 'billing' })]),
    document('kotlin', ['client'], [
      call('GET', '/a', { service: 'orders' }), call('GET', '/b', { service: 'billing' }),
      call('GET', '/c'), call('GET', '/d', { service: 'unknown' }),
    ]),
  );
  assert.deepEqual(multi.scopes.map(({ scope }) => scope), ['billing', 'orders']);
  assert.deepEqual(multi.scopes.map(({ calls }) => calls.map(({ template }) => template)), [['/b'], ['/a']]);
  // service 없는 미귀속 호출은 모든 scope를 불렀을 수 있고, 다른 service 호출은 아무 scope도 부르지 않았다.
  assert.deepEqual(multi.scopes.map(({ unboundCalls }) => unboundCalls), [1, 1]);
  assert.equal(multi.scopes[0]!.declScanned, false);
  assert.equal(multi.scopes[0]!.contractDocuments, 1);
  const joined = joinBridgeDocuments([
    document('js', ['server'], [decl('GET', '/a')]),
    document('kotlin', ['client'], [call('GET', '/x', { service: 'other' })]),
  ]);
  assert.deepEqual(joined.limitations.map(({ message }) => message), [
    'unjoined-unbound-route-calls: 1 route call facts without an attributed declaration side (paths and hosts are not reported) were not joined',
  ]);
  assert.equal(JSON.stringify(joined).includes('/x'), false);
});

test('선언 측 service가 일부만 있으면 scope를 정할 수 없어 입력 오류다', () => {
  assert.throws(() => joinBridgeDocuments([
    document('js', ['server'], [decl('GET', '/a')], { service: 'orders' }),
    document('openapi', ['server'], [contract('GET', '/a')]),
    document('kotlin', ['client'], []),
  ]), (error) => error instanceof BridgeJoinValidationError && /all declare a service or none/.test(error.message));
});

test('http 입력 구성: 선언 측과 호출 측이 각각 필요하고 드리프트 입력만 예외다', () => {
  const client = document('kotlin', ['client'], []);
  const server = document('js', ['server'], []);
  const spec = document('openapi', ['server'], []);
  assert.equal(joinBridgeDocuments([server, client]).routes!.driftOnly, false);
  assert.equal(joinBridgeDocuments([spec, client]).routes!.scopes[0]!.declScanned, false);
  assert.equal(joinBridgeDocuments([server, spec]).routes!.driftOnly, true);
  for (const inputs of [[client, document('swift', ['client'], [])], [server, document('js', ['server'], [])], [spec, spec]]) {
    assert.throws(() => joinBridgeDocuments(inputs), /at least one declaration-side document/);
  }
});

test('http 문서는 bridge·persistence 요건을 채우지 않는다', () => {
  const bridgeEmptyDart = parseBridgeFactsDocument({
    format: 'bridge-facts', version: 1, tool: { name: 'synthetic', version: '0.0.0' },
    generatedAt: '2026-09-27T00:00:00Z', platform: 'dart', target: null, project: '/work/example',
    facts: [], limitations: [],
  });
  // http 문서가 kotlin·swift여도 bridge 수신 측이 아니다.
  assert.throws(() => joinBridgeDocuments([
    bridgeEmptyDart, document('kotlin', ['server', 'client'], []), document('swift', ['client'], []),
  ]), /Bridge documents must include at least one caller platform/);
});

test('trie 없이도 evaluateSegments·compareRanks·clearlyViolates가 계약 규칙을 따른다', () => {
  const declaration = (template: string, extra: Partial<RouteDeclaration> = {}): RouteDeclaration => {
    const parsed = parseRouteTemplate(template);
    assert.ok(parsed.ok);
    return {
      id: 0, template, segments: parsed.segments, method: 'GET', anchor: 'root',
      caseInsensitive: false, catchAllPrefix: false, constraints: new Map(), ...extra,
    };
  };
  const segments = (template: string) => {
    const parsed = parseRouteTemplate(template);
    assert.ok(parsed.ok);
    return parsed.segments;
  };
  const partial = declaration('/a{}');
  assert.equal(evaluateSegments(partial, partial.segments, segments('/{}'), false)?.paramToLiteral, true);
  assert.equal(evaluateSegments(partial, partial.segments, segments('/ab{}'), false)?.unprovable, true);
  assert.equal(evaluateSegments(partial, partial.segments, segments('/b{}c'), false), undefined);
  assert.equal(evaluateSegments(partial, partial.segments, segments('/a{}'), false)?.unprovable, false);
  const literal = declaration('/abc');
  assert.equal(evaluateSegments(literal, literal.segments, segments('/a{}'), false)?.unprovable, true);
  assert.equal(evaluateSegments(literal, literal.segments, segments('/x{}'), false), undefined);
  assert.equal(evaluateSegments(literal, literal.segments, segments('/ABC'), true)?.unprovable, false);
  const empty = declaration('/');
  assert.equal(evaluateSegments(empty, empty.segments, segments('/{}'), false), undefined);
  const param = declaration('/{}', { constraints: new Map([[0, 'slug' as const]]) });
  assert.deepEqual(evaluateSegments(param, param.segments, segments('/a{}'), false)?.ranks, [2]);
  assert.equal(evaluateSegments(param, param.segments, segments('/a.b'), false), undefined);
  assert.equal(compareRanks([4], [4, 0]) > 0, true);
  assert.equal(compareRanks([1], [4, 0]) < 0, true);
  assert.equal(compareRanks([4, 1], [1, 4]) > 0, true);
  assert.equal(clearlyViolates('-12', 'int'), false);
  assert.equal(clearlyViolates('550E8400E29B41D4A716446655440000', 'uuid'), false);
  assert.equal(clearlyViolates('not-a-uuid', 'uuid'), true);
  assert.equal(clearlyViolates('ok_slug-1', 'slug'), false);
});

test('suffix 비교 예산을 넘으면 부분 결과 대신 실패한다', () => {
  const parsed = parseRouteTemplate('/a/b/c');
  assert.ok(parsed.ok);
  const declaration: RouteDeclaration = {
    id: 0, template: '/a/b/c', segments: parsed.segments, method: 'GET', anchor: 'root',
    caseInsensitive: false, catchAllPrefix: false, constraints: new Map(),
  };
  const index = new RouteIndex([declaration], { remaining: 1 });
  const probeSegments = parseRouteTemplate('/c');
  assert.ok(probeSegments.ok);
  assert.throws(() => index.match({ segments: probeSegments.segments, anchor: 'base', method: 'GET' as HttpMethod }),
    /RouteSuffixBudgetError/);
});

/** project가 다른 합성 http 문서다(workspace member 흉내). */
function memberDocument(project: string, platform: string, roles: string[], facts: unknown[],
  extra: Record<string, unknown> = {}): BridgeFactsDocument {
  return document(platform, roles, facts, { project, ...extra });
}

test('link 조인은 project가 다른 member 문서를 link 이름 scope 하나로 잇고 match로만 귀속한다', () => {
  const server = memberDocument('/work/server', 'js', ['server'], [decl('GET', '/users/{}', { service: 'other' })],
    { service: 'other' });
  const client = memberDocument('/work/client', 'kotlin', ['client'], [
    call('GET', '/users/{}', { authority: 'api.example.com' }),
    call('GET', '/users/{}', { baseRef: 'kt:ApiModule.base' }),
    call('GET', '/users/{}', { service: 'example-api' }),
    call('GET', '/users/{}', { authority: 'cdn.example.com' }),
    call('GET', '/users/{}', { authority: 'api.example.com', dynamic: true, channel: null }),
  ]);
  const matches = { hosts: ['api.example.com'], refs: ['kt:ApiModule.base'], services: ['example-api'] };
  const joined = joinBridgeDocuments([server, client], { composition: 'trace', link: {
    scope: 'mobile->api',
    isServerDocument: (candidate) => candidate === server,
    isClientDocument: (candidate) => candidate === client,
    attributes: (_document, item) => (item.authority !== undefined && matches.hosts.includes(item.authority)) ||
      (item.baseRef !== undefined && matches.refs.includes(item.baseRef)) ||
      (item.service !== undefined && matches.services.includes(item.service)),
  } });
  const routes = joined.routes!;
  assert.equal(routes.scopes.length, 1);
  const [scope] = routes.scopes;
  // 선언 측 service('other')는 link scope를 가르지 않는다. 호출 service와 달라도 match 조건이 귀속을 정한다.
  assert.equal(scope?.scope, 'mobile->api');
  assert.equal(scope?.declScanned, true);
  assert.equal(scope?.calls.length, 3);
  assert.ok(scope?.calls.every(({ decl: outcome }) => describe(outcome) === 'matched:exact:GET /users/{}'));
  assert.equal(scope?.unboundCalls, 1);
  assert.equal(scope?.dynamicCalls, 1);
  assert.deepEqual(routes.limitations.map(({ message }) => message).sort(), [
    'unjoined-dynamic-route-calls: 1 route call facts with a non-literal template were not joined',
    'unjoined-unbound-route-calls: 1 route call facts without an attributed declaration side (paths and hosts are not reported) were not joined',
  ]);
});

test('link 조인은 문서 신원으로 측을 정해 server member 문서의 호출을 link 호출로 세지 않는다', () => {
  const server = memberDocument('/work/server', 'js', ['server', 'client'], [decl('GET', '/a'), call('GET', '/a', { service: 's' })]);
  const client = memberDocument('/work/client', 'kotlin', ['client'], [call('GET', '/a', { service: 's' })]);
  const joined = joinBridgeDocuments([server, client], { composition: 'trace', link: {
    scope: 'l', isServerDocument: (candidate) => candidate === server, isClientDocument: (candidate) => candidate === client,
    attributes: (_document, item) => item.service === 's',
  } });
  const [scope] = joined.routes!.scopes;
  assert.equal(scope?.calls.length, 1);
  assert.equal(scope?.calls[0]?.endpoint.platform, 'kotlin');
  assert.equal(scope?.clientDocuments, 1);
});

test('link 조인은 trace 구성에서만 받고, link 없는 조인은 여전히 project 하나를 요구한다', () => {
  const server = memberDocument('/work/server', 'js', ['server'], [decl('GET', '/a')]);
  const client = memberDocument('/work/client', 'kotlin', ['client'], [call('GET', '/a')]);
  const link = { scope: 'l', isServerDocument: () => true, isClientDocument: () => true, attributes: () => true };
  assert.throws(() => joinBridgeDocuments([server, client], { link }), /requires the trace composition/);
  assert.throws(() => joinBridgeDocuments([server, client], { composition: 'trace' }), BridgeJoinValidationError);
});
