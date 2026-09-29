import assert from 'node:assert/strict';
import test from 'node:test';

import { parseBridgeFactsDocument, type BridgeFactsDocument } from '../exchange/parse.ts';
import { parseRouteTemplate } from '../exchange/route-template.ts';
import { createRouteIssues } from '../report/route-issues.ts';
import { joinBridgeDocuments } from './join.ts';
import { RouteIndex, type RouteDeclaration, type RouteSideOutcome } from './route-index.ts';
import type { RouteJoinResult, RouteScope } from './route-join.ts';
import { findRouteShadows, MAX_ROUTE_SHADOW_COMPARISONS, pathCovers, RouteShadowBudgetError } from './route-shadow.ts';

/** 합성 http 문서를 계약 파서로 검증해 만든다. */
function document(roles: string[], facts: unknown[], extra: Record<string, unknown> = {}): BridgeFactsDocument {
  return parseBridgeFactsDocument({
    format: 'bridge-facts', version: 1, tool: { name: 'synthetic', version: '0.0.0' },
    generatedAt: '2026-09-29T00:00:00Z', platform: roles.includes('server') ? 'python' : 'kotlin', target: 'http',
    project: '/work/example', roles, facts, limitations: [],
    ...(roles.includes('server') ? { dispatch: 'registration-order' } : {}),
    ...extra,
  });
}

let line = 0;
/**
 * 등록 순서가 있는 decl이다. index마다 위치를 따로 둔다(한 index는 한 등록). Django처럼 끝 슬래시는 strict이고
 * `{**}`로 끝나면 생략한다.
 */
function decl(method: string, channel: string, index: number | undefined, extra: Record<string, unknown> = {}): Record<string, unknown> {
  line += 1;
  return {
    kind: 'route-decl', method, channel, dynamic: false, pathAnchor: 'root',
    ...(channel.endsWith('{**}') ? {} : { trailingSlash: 'strict' }),
    location: { path: 'shop/urls.py', line: index === undefined ? 1_000 + line : index + 1, column: 10 },
    ...(index === undefined ? {} : { order: { group: 'django:shop.urls', index } }),
    ...extra,
  };
}

/** 위치가 겹치지 않는 route-call이다. */
function call(method: string | undefined, channel: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  line += 1;
  return {
    kind: 'route-call', channel, ...(method === undefined ? {} : { method }), dynamic: false, pathAnchor: 'root',
    location: { path: 'app/Api.kt', line, column: 1 }, ...extra,
  };
}

/** 서버·클라이언트 문서를 조인해 route 결과를 돌려준다. */
function joinRoutes(...documents: BridgeFactsDocument[]): RouteJoinResult {
  const routes = joinBridgeDocuments(documents).routes;
  assert.ok(routes !== undefined);
  return routes;
}

/** 단일 scope에서 호출 하나의 decl 결과를 요약한다. */
function outcome(scope: RouteScope, template: string, method?: string): string {
  return describe(scope.calls.find((item) => item.template === template && item.method === method)?.decl);
}

/** 결과가 match면 대상을, 아니면 상태를 돌려준다. */
function describe(result: RouteSideOutcome | undefined): string {
  if (result === undefined) return 'none';
  if (result.status === 'matched') {
    return `matched:${result.quality}:${result.targets.map((t) => `${t.method} ${t.template}`).sort().join(',')}`;
  }
  if (result.status === 'ambiguous') return `ambiguous:${result.targets.map((t) => `${t.method} ${t.template}`).sort().join(',')}`;
  if (result.status === 'method-mismatch') return `method-mismatch:${result.provable ? 'provable' : 'unprovable'}`;
  if (result.status === 'near-miss') return `near-miss:${result.reason}`;
  return 'missing';
}

test('같은 group에서는 index가 가장 작은 decl이 호출을 받는다(구체성과 반대 결과도 그대로)', () => {
  const routes = joinRoutes(
    document(['server'], [decl('GET', '/items/{}/', 5), decl('GET', '/items/featured/', 6), decl('GET', '/tags/featured/', 7),
      decl('GET', '/tags/{}/', 8)]),
    document(['client'], [call('GET', '/items/featured/'), call('GET', '/tags/featured/'), call('GET', '/tags/7/')]),
  );
  const scope = routes.scopes[0]!;
  // 앞선 파라미터 decl이 뒤의 리터럴 decl을 가린다(구체성이면 리터럴이 이긴다).
  assert.equal(outcome(scope, '/items/featured/', 'GET'), 'matched:exact:GET /items/{}/');
  assert.equal(outcome(scope, '/tags/featured/', 'GET'), 'matched:exact:GET /tags/featured/');
  assert.equal(outcome(scope, '/tags/7/', 'GET'), 'matched:exact:GET /tags/{}/');
});

test('호출 파라미터는 앞선 리터럴 decl에 기대지 않고, 앞선 정규식 decl은 가로챘을 수 있는 후보로 남는다', () => {
  const routes = joinRoutes(
    document(['server'], [
      decl('GET', '/users/me/', 1), decl('GET', '/users/{}/', 2),
      decl('GET', '/years/{}/', 3, { paramConstraints: [{ segment: 1, kind: 'regex', pattern: '[0-9]{4}' }] }),
      decl('GET', '/years/{}/', 4),
      decl('GET', '/codes/you/', 5), decl('GET', '/codes/me/', 6),
      decl('GET', '/only/{}/', 7, { paramConstraints: [{ segment: 1, kind: 'regex', pattern: '[a-z]+' }] }),
    ]),
    document(['client'], [call('GET', '/users/{}/'), call('GET', '/users/me/'), call('GET', '/years/2024/'),
      call('GET', '/codes/{}/'), call('GET', '/only/abc/')]),
  );
  const scope = routes.scopes[0]!;
  assert.equal(outcome(scope, '/users/{}/', 'GET'), 'matched:exact:GET /users/{}/');
  assert.equal(outcome(scope, '/users/me/', 'GET'), 'matched:exact:GET /users/me/');
  // 정규식은 평가하지 않으므로 앞선 정규식 decl도 match 대상이고 증명된 결합이 아니다.
  assert.equal(outcome(scope, '/years/2024/', 'GET'), 'matched:param-to-literal-constrained:GET /years/{}/,GET /years/{}/');
  // 조건부 후보만 있고 템플릿이 둘이면 호출 값에 따라 받는 decl이 달라 모호하다.
  assert.equal(outcome(scope, '/codes/{}/', 'GET'), 'ambiguous:GET /codes/me/,GET /codes/you/');
  assert.equal(outcome(scope, '/only/abc/', 'GET'), 'matched:param-to-literal-constrained:GET /only/{}/');
});

test('method를 먼저 거르므로 앞선 decl이 받지 않는 method는 뒤 decl로 가고, 불일치 판정은 그대로다', () => {
  const routes = joinRoutes(
    document(['server'], [decl('GET', '/items/{}/', 1), decl('ANY', '/items/featured/', 2), decl('GET', '/reports/', 3)]),
    document(['client'], [call('GET', '/items/featured/'), call('POST', '/items/featured/'), call('POST', '/reports/'),
      call('HEAD', '/items/featured/')]),
  );
  const scope = routes.scopes[0]!;
  assert.equal(outcome(scope, '/items/featured/', 'GET'), 'matched:exact:GET /items/{}/');
  assert.equal(outcome(scope, '/items/featured/', 'POST'), 'matched:any-method:ANY /items/featured/');
  assert.equal(outcome(scope, '/items/featured/', 'HEAD'), 'matched:head-as-get:GET /items/{}/');
  assert.equal(outcome(scope, '/reports/', 'POST'), 'method-mismatch:provable');
  const issues = createRouteIssues(routes);
  assert.deepEqual(issues.filter(({ severity }) => severity === 'error').map(({ code, channel }) => `${code} ${channel}`),
    ['route-method-mismatch /reports/']);
});

test('group·문서·dispatch가 다른 후보는 순서를 비교하지 않고 모호하다(근거가 더 강한 단위만 남긴다)', () => {
  const second = document(['server'], [decl('GET', '/items/{}/', 1)], { tool: { name: 'synthetic-b', version: '0.0.0' } });
  const routes = joinRoutes(
    document(['server'], [decl('GET', '/items/featured/', 9), decl('GET', '/free/{}/', undefined), decl('GET', '/free/x/', 2),
      decl('GET', '/mixed/{}/', 3)]),
    second,
    document(['server'], [
      { kind: 'route-decl', method: 'GET', channel: '/mixed/me/', dynamic: false, pathAnchor: 'root',
        location: { path: 'blog/app.py', line: 3, column: 1 } },
      { kind: 'route-decl', method: 'GET', channel: '/spec/{}/', dynamic: false, pathAnchor: 'root',
        location: { path: 'blog/app.py', line: 4, column: 1 } },
    ], { dispatch: 'specificity' }),
    document(['client'], [call('GET', '/items/featured/'), call('GET', '/free/x/'), call('GET', '/mixed/{}/'),
      call('GET', '/mixed/me/'), call('GET', '/spec/1/')]),
  );
  const scope = routes.scopes[0]!;
  // 두 문서의 같은 group 문자열은 다른 체인이다.
  assert.equal(outcome(scope, '/items/featured/', 'GET'), 'ambiguous:GET /items/featured/,GET /items/{}/');
  // order 없는 decl은 어느 decl과도 순서를 비교하지 않는다.
  assert.equal(outcome(scope, '/free/x/', 'GET'), 'ambiguous:GET /free/x/,GET /free/{}/');
  // 조건부(호출 파라미터↔리터럴) 후보만 가진 구체성 단위는 반드시 닿는 registration-order 단위에 밀린다.
  assert.equal(outcome(scope, '/mixed/{}/', 'GET'), 'matched:exact:GET /mixed/{}/');
  // 양쪽 모두 반드시 닿으면 dispatch 모델을 넘어 비교할 근거가 없다.
  assert.equal(outcome(scope, '/mixed/me/', 'GET'), 'ambiguous:GET /mixed/me/,GET /mixed/{}/');
  assert.equal(outcome(scope, '/spec/1/', 'GET'), 'matched:exact:GET /spec/{}/');
  assert.equal(createRouteIssues(routes).some(({ severity }) => severity === 'error'), false);
});

test('suffix 후보는 가려져 요청을 받지 못하는 decl을 빼고 구체성 규칙으로 정한다', () => {
  const routes = joinRoutes(
    document(['server'], [decl('GET', '/api/companies/{}/', 1), decl('GET', '/api/companies/tech/', 2),
      decl('GET', '/api/orders/', 3), decl('GET', '/api/tags/new/', 4), decl('GET', '/api/tags/{}/', 5),
      decl('POST', '/api/posts/{}/', 6), decl('GET', '/api/posts/new/', 7)]),
    document(['client'], [call('GET', '/companies/tech/', { pathAnchor: 'base' }), call('GET', '/orders/', { pathAnchor: 'base' }),
      call('GET', '/tags/new/', { pathAnchor: 'base' }), call('GET', '/posts/new/', { pathAnchor: 'base' })]),
  );
  const scope = routes.scopes[0]!;
  // `/api/companies/tech/`는 앞선 `{}`에 경로·method가 모두 가려져 어떤 base에서도 요청을 받지 않는다.
  assert.equal(outcome(scope, '/companies/tech/', 'GET'), 'matched:suffix:GET /api/companies/{}/');
  assert.equal(outcome(scope, '/orders/', 'GET'), 'matched:suffix:GET /api/orders/');
  assert.equal(outcome(scope, '/tags/new/', 'GET'), 'matched:suffix:GET /api/tags/new/');
  // 경로만 가려진 decl은 method가 다른 요청을 여전히 받을 수 있어 빼지 않는다.
  assert.equal(outcome(scope, '/posts/new/', 'GET'), 'matched:suffix:GET /api/posts/new/');
});

test('먼저 등록한 decl이 경로와 method를 모두 받으면 route-decl-shadowed, 경로만 받으면 route-decl-path-shadowed다', () => {
  const routes = joinRoutes(
    document(['server'], [
      decl('GET', '/items/{}/', 5), decl('ANY', '/items/featured/', 6), decl('GET', '/items/new/', 7),
      decl('ANY', '/dup/', 8), decl('ANY', '/dup/', 9),
      decl('GET', '/docs/{**}', 10), decl('GET', '/docs/api/{}', 11),
      decl('GET', '/late/', 13), decl('GET', '/late/', 12, { narrowed: true }),
    ]),
    document(['client'], [call('GET', '/items/featured/'), call('GET', '/late/')]),
  );
  const scope = routes.scopes[0]!;
  const shadows = Object.fromEntries(scope.decls.filter(({ shadow }) => shadow !== undefined).map((fact) =>
    [`${fact.declaration.method} ${fact.declaration.template} #${fact.declaration.registration!.index}`,
      `${fact.shadow!.kind} by #${scope.decls[fact.shadow!.by]!.declaration.registration!.index}`]));
  assert.deepEqual(shadows, {
    'ANY /items/featured/ #6': 'path by #5',
    'GET /items/new/ #7': 'full by #5',
    'ANY /dup/ #9': 'full by #8',
    'GET /docs/api/{} #11': 'full by #10',
  });
  // narrowed decl은 조건이 맞지 않는 요청을 다음 등록으로 넘기므로 순서를 걸을 때 멈추지 않는다.
  assert.equal(outcome(scope, '/late/', 'GET'), 'matched:exact:GET /late/,GET /late/');
  const issues = createRouteIssues(routes);
  const byCode = (code: string) => issues.filter((issue) => issue.code === code).map(({ channel, method }) => `${method} ${channel}`).sort();
  assert.deepEqual(byCode('route-decl-shadowed'), ['ANY /dup/', 'GET /docs/api/{}', 'GET /items/new/']);
  assert.deepEqual(byCode('route-decl-path-shadowed'), ['ANY /items/featured/']);
  // 가려진 decl은 호출 없음 대신 가림으로 보고한다(경로만 가려진 decl은 다른 method로 닿을 수 있어 그대로 둔다).
  assert.deepEqual(byCode('route-decl-without-call'), ['ANY /dup/', 'ANY /items/featured/', 'GET /docs/{**}']);
  assert.equal(issues.every(({ severity, code }) => !code.includes('shadowed') || severity === 'warning'), true);
  // 증거는 가려진 decl과 가린 decl이다.
  const shadowed = issues.find(({ code, channel }) => code === 'route-decl-shadowed' && channel === '/items/new/')!;
  assert.deepEqual(shadowed.evidence.map(({ route }) => route?.template), ['/items/{}/', '/items/new/']);
});

/** 가림 판정 단위 검사용 선언이다. `trailingSlash: null`은 끝 슬래시 미상이다. */
function declaration(
  id: number,
  template: string,
  index: number,
  extra: Omit<Partial<RouteDeclaration>, 'trailingSlash'> & { trailingSlash?: 'strict' | 'optional' | null } = {},
): RouteDeclaration {
  const parsed = parseRouteTemplate(template);
  assert.ok(parsed.ok, template);
  const { trailingSlash = 'strict', ...rest } = extra;
  return {
    id, template, segments: parsed.segments, method: 'GET', anchor: 'root',
    ...(trailingSlash === null ? {} : { trailingSlash }),
    caseInsensitive: false, catchAllPrefix: false, constraints: new Map(),
    registration: { group: 'g', index }, ...rest,
  };
}

test('경로 덮음은 건전하게만 판정한다(제약·끝 슬래시·catch-all·대소문자·앵커)', () => {
  const covers = (earlier: RouteDeclaration, later: RouteDeclaration) => pathCovers(earlier, later);
  assert.equal(covers(declaration(0, '/a/{}', 0), declaration(1, '/a/b', 1)), true);
  assert.equal(covers(declaration(0, '/a/{}', 0), declaration(1, '/a/{}', 1, { constraints: new Map([[1, 'int']]) })), true);
  assert.equal(covers(declaration(0, '/a/{}', 0), declaration(1, '/a/p{}.json', 1)), true);
  assert.equal(covers(declaration(0, '/a/{}', 0), declaration(1, '/a/', 1)), false);
  assert.equal(covers(declaration(0, '/a/{}', 0), declaration(1, '/a/b/c', 1)), false);
  // 닫힌 제약은 같은 제약의 {}만, 정규식은 아무것도 덮지 않는다.
  assert.equal(covers(declaration(0, '/a/{}', 0, { constraints: new Map([[1, 'int']]) }), declaration(1, '/a/1', 1)), false);
  assert.equal(covers(declaration(0, '/a/{}', 0, { constraints: new Map([[1, 'int']]) }),
    declaration(1, '/a/{}', 1, { constraints: new Map([[1, 'int']]) })), true);
  assert.equal(covers(declaration(0, '/a/{}', 0, { constraints: new Map([[1, 'regex']]) }),
    declaration(1, '/a/{}', 1, { constraints: new Map([[1, 'regex']]) })), false);
  assert.equal(covers(declaration(0, '/a/{}', 0, { constraints: new Map([[1, 'path']]) }), declaration(1, '/a/b', 1)), true);
  // 부분 세그먼트.
  assert.equal(covers(declaration(0, '/f/{}.json', 0), declaration(1, '/f/a.json', 1)), true);
  assert.equal(covers(declaration(0, '/f/{}.json', 0), declaration(1, '/f/.json', 1)), false);
  assert.equal(covers(declaration(0, '/f/{}.json', 0), declaration(1, '/f/x{}.json', 1)), true);
  assert.equal(covers(declaration(0, '/f/x{}', 0), declaration(1, '/f/{}.json', 1)), false);
  assert.equal(covers(declaration(0, '/f/{}.json', 0), declaration(1, '/f/{}', 1)), false);
  // catch-all.
  assert.equal(covers(declaration(0, '/d/{**}', 0), declaration(1, '/d/a/b', 1)), true);
  assert.equal(covers(declaration(0, '/d/{**}', 0), declaration(1, '/d/x/{**}', 1, { trailingSlash: null })), true);
  assert.equal(covers(declaration(0, '/d/{**}', 0), declaration(1, '/d', 1)), false);
  assert.equal(covers(declaration(0, '/d/{**}', 0), declaration(1, '/d/a/', 1)), false);
  assert.equal(covers(declaration(0, '/d/{**}', 0), declaration(1, '/d/a', 1, { trailingSlash: 'optional' })), false);
  assert.equal(covers(declaration(0, '/d/{}', 0), declaration(1, '/d/{**}', 1, { trailingSlash: null })), false);
  // 끝 슬래시: 뒤 decl이 strict가 아니면 앞 decl이 optional이어야 토글 변형까지 덮는다.
  assert.equal(covers(declaration(0, '/a/{}', 0), declaration(1, '/a/b', 1, { trailingSlash: 'optional' })), false);
  assert.equal(covers(declaration(0, '/a/{}', 0), declaration(1, '/a/b', 1, { trailingSlash: null })), false);
  assert.equal(covers(declaration(0, '/a/{}', 0, { trailingSlash: 'optional' }), declaration(1, '/a/b', 1, { trailingSlash: 'optional' })), true);
  assert.equal(covers(declaration(0, '/a/{}', 0, { trailingSlash: null }), declaration(1, '/a/b', 1)), true);
  // 대소문자 무시·base 앵커는 판정하지 않는다.
  assert.equal(covers(declaration(0, '/a/{}', 0, { caseInsensitive: true }), declaration(1, '/a/b', 1)), false);
  assert.equal(covers(declaration(0, '/a/{}', 0), declaration(1, '/a/b', 1, { anchor: 'base' })), false);
});

test('가림은 같은 group의 앞선 index만 보고, 같은 index·순서 없는 decl·catch-all 접두사·테스트 소스는 빼고, 예산을 넘으면 실패한다', () => {
  const candidates = (declarations: RouteDeclaration[], extra: { narrowed?: number[]; testSource?: number[] } = {}) =>
    declarations.map((item) => ({
      declaration: item, narrowed: extra.narrowed?.includes(item.id) ?? false, testSource: extra.testSource?.includes(item.id) ?? false,
    }));
  const budget = () => ({ remaining: MAX_ROUTE_SHADOW_COMPARISONS });
  const shadows = findRouteShadows(candidates([
    declaration(0, '/a/{}', 3), declaration(1, '/a/b', 3), declaration(2, '/a/c', 2),
    declaration(3, '/a/d', 4, { registration: { group: 'other', index: 4 } }),
    declaration(4, '/a/e', 5, { registration: {} }),
    declaration(5, '/a/f', 6, { catchAllPrefix: true }),
    declaration(6, '/a/g', 7), declaration(7, '/h/{}', 1), declaration(8, '/h/x', 2),
  ], { testSource: [6, 7] }), budget());
  assert.deepEqual([...shadows.keys()], []);
  const found = findRouteShadows(candidates([declaration(0, '/a/{}', 3), declaration(1, '/a/{}', 1, { method: 'POST' }),
    declaration(2, '/a/b', 9, { method: 'ANY' }), declaration(3, '/a/c', 9, { method: 'ANY' })]), budget());
  assert.deepEqual(Object.fromEntries(found), { 0: { kind: 'path', by: 1 }, 2: { kind: 'path', by: 1 }, 3: { kind: 'path', by: 1 } });
  const anyFirst = findRouteShadows(candidates([declaration(0, '/a/{}', 5, { method: 'ANY' }), declaration(1, '/a/{}', 1, { method: 'POST' }),
    declaration(2, '/a/b', 9)]), budget());
  assert.deepEqual(Object.fromEntries(anyFirst), { 0: { kind: 'path', by: 1 }, 2: { kind: 'full', by: 0 } });
  assert.throws(() => findRouteShadows(candidates([declaration(0, '/a/{}', 1), declaration(1, '/a/b', 2)]), { remaining: 2 }),
    RouteShadowBudgetError);
});

test('RouteIndex는 registration 없는 선언에 대해 이전 구체성 결과를 그대로 낸다', () => {
  const specificity = (template: string, id: number): RouteDeclaration => {
    const { registration: _registration, ...rest } = declaration(id, template, 0);
    return rest;
  };
  const index = new RouteIndex([specificity('/items/{}', 0), specificity('/items/featured', 1)], { remaining: 1_000 });
  const parsed = parseRouteTemplate('/items/featured');
  assert.ok(parsed.ok);
  assert.equal(describe(index.match({ segments: parsed.segments, method: 'GET', anchor: 'root' })), 'matched:exact:GET /items/featured');
});

test('경로만 덮는 앞선 decl이 여럿이면 가장 먼저 등록한 것을 증거로 고른다', () => {
  const facts = Array.from({ length: 50 }, (_, index) => decl(index % 2 === 0 ? 'GET' : 'PUT', '/bulk/{}', index));
  const routes = joinRoutes(document(['server'], [...facts, decl('DELETE', '/bulk/x', 60)]), document(['client'], []));
  const scope = routes.scopes[0]!;
  const bulk = scope.decls.find(({ declaration: item }) => item.template === '/bulk/x')!;
  assert.equal(bulk.shadow?.kind, 'path');
  assert.equal(scope.decls[bulk.shadow!.by]!.declaration.registration?.index, 0);
});

test('증명 불가 후보만 가진 단위끼리는 모호함 대신 모두 match 대상이고, narrowed 후보만 있으면 그것이 match다', () => {
  const regex = { paramConstraints: [{ segment: 1, kind: 'regex', pattern: '[0-9]+' }] };
  const routes = joinRoutes(
    document(['server'], [decl('GET', '/n/{}/', undefined, regex), decl('GET', '/n/{}/', undefined, regex),
      decl('GET', '/only/', 3, { narrowed: true }), decl('GET', '/shared/{}/', 4, { narrowed: true })]),
    document(['client'], [call('GET', '/n/1/'), call('GET', '/only/'), call('GET', '/shared/x/')]),
  );
  const scope = routes.scopes[0]!;
  assert.equal(outcome(scope, '/n/1/', 'GET'), 'matched:param-to-literal-constrained:GET /n/{}/,GET /n/{}/');
  assert.equal(outcome(scope, '/only/', 'GET'), 'matched:exact:GET /only/');
  assert.equal(outcome(scope, '/shared/x/', 'GET'), 'matched:exact:GET /shared/{}/');
});

test('부분 세그먼트 decl도 뒤의 리터럴·좁은 골격 decl을 가린다', () => {
  const routes = joinRoutes(
    document(['server'], [decl('ANY', '/f/{}.json', 1), decl('POST', '/f/{}.json', 2), decl('GET', '/f/a.json', 3),
      decl('GET', '/f/x{}.json', 4), decl('GET', '/f/{}.xml', 5)]),
    document(['client'], []),
  );
  const shadows = Object.fromEntries(routes.scopes[0]!.decls.filter(({ shadow }) => shadow !== undefined)
    .map(({ declaration: item, shadow }) => [`${item.method} ${item.template}`, shadow!.kind]));
  assert.deepEqual(shadows, { 'POST /f/{}.json': 'full', 'GET /f/a.json': 'full', 'GET /f/x{}.json': 'full' });
});

test('같은 registration-order 문서를 두 번 주면 사실이 하나로 합쳐져 순서가 그대로다', () => {
  const server = document(['server'], [decl('GET', '/items/{}/', 5), decl('GET', '/items/featured/', 6)]);
  const routes = joinRoutes(server, server, document(['client'], [call('GET', '/items/featured/')]));
  const scope = routes.scopes[0]!;
  assert.equal(scope.decls.length, 2);
  assert.equal(outcome(scope, '/items/featured/', 'GET'), 'matched:exact:GET /items/{}/');
  assert.deepEqual(createRouteIssues(routes).map(({ code }) => code), ['route-decl-shadowed']);
});

test('완전히 가려진 decl은 root 호출의 match 대상도, route-decl-conflict 대상도 아니다', () => {
  const routes = joinRoutes(
    document(['server'], [decl('GET', '/p/{}t', 0), decl('GET', '/p/ab{}t', 1), decl('GET', '/a/b', 2), decl('GET', '/a/b', 3)]),
    document(['client'], [call('GET', '/p/ab{}t')]),
  );
  const scope = routes.scopes[0]!;
  // 앞 decl은 이 호출에 증명 불가 후보라 순서 걷기가 뒤 decl까지 닿지만, 뒤 decl은 어떤 요청도 받지 못한다.
  assert.equal(outcome(scope, '/p/ab{}t', 'GET'), 'matched:param-to-literal:GET /p/{}t');
  const issues = createRouteIssues(routes).map(({ code, channel }) => `${code} ${channel}`).sort();
  assert.deepEqual(issues, ['route-decl-shadowed /a/b', 'route-decl-shadowed /p/ab{}t', 'route-decl-without-call /a/b']);
});
