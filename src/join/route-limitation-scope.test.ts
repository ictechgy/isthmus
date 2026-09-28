import assert from 'node:assert/strict';
import test from 'node:test';

import { parseBridgeFactsDocument, type BridgeFactsDocument } from '../exchange/parse.ts';
import { parseRouteTemplate, type RouteMethod } from '../exchange/route-template.ts';
import { RouteLimitationScopeIndex, RouteScopeBudgetError, isDeclarationSideGap } from './route-limitation-scope.ts';

/** 한계 하나에 스코프 하나를 붙인 합성 서버 문서다. */
function scopedDocument(scope: Record<string, unknown>, extraLimitations: string[] = []): BridgeFactsDocument {
  return parseBridgeFactsDocument({
    format: 'bridge-facts', version: 1, tool: { name: 'synthetic', version: '0.0.0' },
    generatedAt: '2026-09-29T00:00:00Z', platform: 'kotlin', target: 'http', project: '/work/example',
    roles: ['server'], dispatch: 'specificity', facts: [],
    limitations: ['framework-provided-routes: synthetic', ...extraLimitations],
    limitationScopes: [{ limitationIndex: 0, ...scope }],
  });
}

/** 스코프 색인이 호출 하나에 이 한계를 적용하는지다. */
function coversCall(scope: Record<string, unknown>, template: string, method: RouteMethod | undefined = 'GET',
  anchor: 'root' | 'base' = 'root'): boolean {
  const index = new RouteLimitationScopeIndex([scopedDocument(scope)], { remaining: 1_000_000 });
  const parsed = parseRouteTemplate(template);
  assert.ok(parsed.ok);
  return index.applicable({ segments: parsed.segments, anchor, ...(method === undefined ? {} : { method }), side: 'call' }).length > 0;
}

test('정확 템플릿은 같은 경로만 덮고 끝 슬래시·ASCII 대소문자 차이는 보수적으로 덮는다', () => {
  const scope = { templates: ['/error'] };
  assert.equal(coversCall(scope, '/error'), true);
  assert.equal(coversCall(scope, '/error/'), true);
  assert.equal(coversCall(scope, '/ERROR'), true);
  assert.equal(coversCall(scope, '/errors'), false);
  assert.equal(coversCall(scope, '/error/x'), false);
  assert.equal(coversCall(scope, '/api/items'), false);
  // 호출 파라미터는 어떤 값(빈 값 포함)도 될 수 있어 리터럴 스코프와 겹칠 수 있다.
  assert.equal(coversCall(scope, '/{}'), true);
  assert.equal(coversCall(scope, '/e{}r'), true);
  assert.equal(coversCall(scope, '/x{}'), false);
});

test('스코프 템플릿의 파라미터·{**}는 넓게 읽는다(빈 값, 0개 이상 세그먼트)', () => {
  assert.equal(coversCall({ templates: ['/files/{}'] }, '/files/'), true);
  assert.equal(coversCall({ templates: ['/files/{}'] }, '/files/a/b'), false);
  assert.equal(coversCall({ templates: ['/files/{**}'] }, '/files'), true);
  assert.equal(coversCall({ templates: ['/files/{**}'] }, '/files/a/b'), true);
  assert.equal(coversCall({ templates: ['/files/{**}'] }, '/other'), false);
  assert.equal(coversCall({ templates: ['/r/{}.json'] }, '/r/.json'), true);
  assert.equal(coversCall({ templates: ['/r/{}.json'] }, '/r/a.xml'), false);
});

test('접두사는 세그먼트 경계에서 그 아래 전체를 덮고 루트 접두사는 모든 경로다', () => {
  const actuator = { templatePrefixes: ['/actuator'] };
  assert.equal(coversCall(actuator, '/actuator'), true);
  assert.equal(coversCall(actuator, '/actuator/health/{}'), true);
  assert.equal(coversCall(actuator, '/actuators'), false);
  assert.equal(coversCall(actuator, '/api/actuator'), false);
  assert.equal(coversCall({ templatePrefixes: ['/'] }, '/'), true);
  assert.equal(coversCall({ templatePrefixes: ['/'] }, '/any/path'), true);
});

test('접미사는 알 수 없는 앞부분 뒤의 꼬리를 덮고 base 앵커 호출은 앞부분을 모른다', () => {
  const suffix = { templateSuffixes: ['/items/{}'] };
  assert.equal(coversCall(suffix, '/items/1'), true);
  assert.equal(coversCall(suffix, '/v2/api/items/1'), true);
  // 끝 슬래시 차이(`/items/`)와 빈 파라미터를 함께 넓게 읽으므로 `/items`도 덮는다(보수적 근사).
  assert.equal(coversCall(suffix, '/items'), true);
  assert.equal(coversCall(suffix, '/orders'), false);
  assert.equal(coversCall(suffix, '/items/1/extra'), false);
  // base 호출: 알 수 없는 앞부분 뒤라서 /error를 끝에 둔 경로면 정확 템플릿과도 겹칠 수 있다.
  assert.equal(coversCall({ templates: ['/app/error'] }, '/error', 'GET', 'base'), true);
  assert.equal(coversCall({ templates: ['/app/error'] }, '/other', 'GET', 'base'), false);
});

test('method 조건은 HEAD→GET·OPTIONS·동적 동사를 보수적으로 덮는다', () => {
  const staticResources = { templatePrefixes: ['/'], methods: ['GET', 'HEAD'] };
  assert.equal(coversCall(staticResources, '/api/items', 'GET'), true);
  assert.equal(coversCall(staticResources, '/api/items', 'POST'), false);
  assert.equal(coversCall(staticResources, '/api/items', 'DELETE'), false);
  assert.equal(coversCall(staticResources, '/api/items', 'OPTIONS'), true);
  assert.equal(coversCall(staticResources, '/api/items', undefined), true);
  assert.equal(coversCall({ templates: ['/a'], methods: ['GET'] }, '/a', 'HEAD'), true);
  assert.equal(coversCall({ templates: ['/a'], methods: ['HEAD'] }, '/a', 'GET'), false);
});

test('선언 측 비교는 선언 method로 닿을 수 있는 숨은 호출을 본다', () => {
  const index = new RouteLimitationScopeIndex([scopedDocument({ templates: ['/items'], methods: ['HEAD'] })], { remaining: 1_000 });
  const segments = (template: string) => {
    const parsed = parseRouteTemplate(template);
    assert.ok(parsed.ok);
    return parsed.segments;
  };
  const applies = (template: string, method: RouteMethod) =>
    index.applicable({ segments: segments(template), anchor: 'root', method, side: 'declaration' }).length > 0;
  assert.equal(applies('/items', 'GET'), true);
  assert.equal(applies('/items', 'ANY'), true);
  assert.equal(applies('/items', 'POST'), false);
  assert.equal(applies('/items/{**}', 'GET'), true);
  assert.equal(applies('/orders', 'GET'), false);
});

test('스코프 없는 한계는 항상 적용되고 스코프가 없으면 공유 목록을 돌려준다', () => {
  const plain = parseBridgeFactsDocument({
    format: 'bridge-facts', version: 1, tool: { name: 'synthetic', version: '0.0.0' },
    generatedAt: '2026-09-29T00:00:00Z', platform: 'kotlin', target: 'http', project: '/work/example',
    roles: ['server'], dispatch: 'specificity', facts: [], limitations: ['route-coverage: synthetic'],
  });
  const unscopedOnly = new RouteLimitationScopeIndex([plain], { remaining: 10 });
  const probe = { segments: [{ kind: 'literal', value: 'x' }] as const, anchor: 'root' as const, method: 'GET' as const, side: 'call' as const };
  assert.equal(unscopedOnly.hasScopes, false);
  assert.equal(unscopedOnly.applicable(probe), unscopedOnly.messages);
  const mixed = new RouteLimitationScopeIndex([scopedDocument({ templates: ['/error'] }, ['route-coverage: synthetic'])], { remaining: 100 });
  assert.deepEqual(mixed.limitations, [
    { message: 'framework-provided-routes: synthetic', scoped: true },
    { message: 'route-coverage: synthetic', scoped: false },
  ]);
  assert.deepEqual(mixed.applicable(probe), ['route-coverage: synthetic']);
});

test('비교 예산을 넘으면 부분 결과 대신 실패한다', () => {
  const index = new RouteLimitationScopeIndex([scopedDocument({ templatePrefixes: ['/{}'] })], { remaining: 3 });
  const parsed = parseRouteTemplate('/a/b/c/d/e/f');
  assert.ok(parsed.ok);
  assert.throws(() => index.applicable({ segments: parsed.segments, anchor: 'root', method: 'GET', side: 'call' }), RouteScopeBudgetError);
});

test('출력에 원소를 싣는 한계는 서버·계약 측 공백 접두사뿐이다', () => {
  assert.equal(isDeclarationSideGap('framework-provided-routes: x'), true);
  assert.equal(isDeclarationSideGap('contract-coverage: x'), true);
  assert.equal(isDeclarationSideGap('route-call-coverage: x'), false);
  assert.equal(isDeclarationSideGap('unknown-prefix: x'), false);
});
