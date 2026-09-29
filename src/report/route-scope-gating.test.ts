import assert from 'node:assert/strict';
import test from 'node:test';

import { parseBridgeFactsDocument, type BridgeFactsDocument } from '../exchange/parse.ts';
import { joinBridgeDocuments } from '../join/join.ts';
import { createCheckReport, type CheckReport } from './check-report.ts';
import { createHttpSurfaceDiff, type HttpDiffDocument } from './http-diff.ts';
import { encodeSortedJson } from './sorted-json.ts';

/**
 * http limitation 스코프가 check·diff --http의 error 판정에 주는 효과다. 스코프 있는 한계는 스코프와 겹치는
 * 호출(서버·계약 측)·선언(호출 측)의 판정만 막고, 스코프 없는 한계는 기존처럼 문서 전체를 막는다.
 */

let line = 0;

/** 합성 http 문서다. */
function document(platform: string, roles: string[], facts: unknown[], extra: Record<string, unknown> = {}): BridgeFactsDocument {
  return parseBridgeFactsDocument({
    format: 'bridge-facts', version: 1, tool: { name: 'synthetic', version: '0.0.0' },
    generatedAt: '2026-09-29T00:00:00Z', platform, target: 'http', project: '/work/example',
    roles, facts, limitations: [],
    ...(roles.includes('server') && platform !== 'openapi' ? { dispatch: 'specificity' } : {}),
    ...extra,
  });
}

/** 위치가 겹치지 않는 route 사실이다. */
function fact(kind: string, method: string, channel: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  line += 1;
  return {
    kind, channel, method, dynamic: false, pathAnchor: 'root',
    location: { path: kind === 'route-call' ? 'app/Api.kt' : 'src/Routes.kt', line, column: 1 },
    symbol: { qualifiedName: `${kind}${line}`, usr: `synthetic:${kind}:${line}` },
    ...extra,
  };
}
const decl = (method: string, channel: string, extra: Record<string, unknown> = {}) => fact('route-decl', method, channel, extra);
const call = (method: string, channel: string, extra: Record<string, unknown> = {}) => fact('route-call', method, channel, extra);

/** Spring Boot 웹 앱이 내는 모양의 합성 서버 문서다: `/error` 전체 method, 정적 리소스 GET·HEAD 전체 경로. */
function springServer(facts: unknown[], extraLimitations: string[] = []): BridgeFactsDocument {
  return document('kotlin', ['server'], facts, {
    limitations: [
      'framework-provided-routes: error controller (/error) is provided by the framework',
      'framework-provided-routes: static resources may be served for GET/HEAD under /**',
      ...extraLimitations,
    ],
    limitationScopes: [
      { limitationIndex: 0, templates: ['/error'] },
      { limitationIndex: 1, templatePrefixes: ['/'], methods: ['GET', 'HEAD'] },
    ],
  });
}

/** 진단을 비교하기 쉬운 문자열로 줄인다. */
function codes(report: CheckReport): string[] {
  return report.issues.map((issue) => `${issue.severity} ${issue.code} ${issue.method ?? '-'} ${issue.channel}`);
}

test('스코프 있는 framework-provided-routes는 스코프와 겹치는 호출만 -unverified로 내린다', () => {
  const report = createCheckReport(joinBridgeDocuments([
    springServer([decl('GET', '/api/items'), decl('POST', '/api/items')]),
    document('kotlin', ['client'], [
      call('GET', '/api/items'), call('POST', '/api/items'),
      call('DELETE', '/api/items'), call('POST', '/api/orders'), call('GET', '/api/orders'), call('PUT', '/error'),
    ]),
  ]));
  assert.deepEqual(codes(report), [
    // DELETE는 정적 리소스(GET·HEAD)와 /error 어느 스코프에도 없어 method 불일치가 그대로 error다.
    'error route-method-mismatch DELETE /api/items',
    // GET은 정적 리소스 스코프(/ 아래 GET·HEAD)에 들어 판정을 막고, POST는 막지 않는다.
    'warning route-call-without-decl-unverified GET /api/orders',
    'error route-call-without-decl POST /api/orders',
    // /error는 모든 method를 프레임워크가 받을 수 있다.
    'warning route-call-without-decl-unverified PUT /error',
  ]);
  assert.equal(report.summary.errors, 2);
});

test('스코프 없는 같은 한계는 기존처럼 문서 전체의 error를 막는다(하위 호환)', () => {
  const unscoped = document('kotlin', ['server'], [decl('GET', '/api/items')], {
    limitations: ['framework-provided-routes: error controller (/error) is provided by the framework'],
  });
  const report = createCheckReport(joinBridgeDocuments([
    unscoped, document('kotlin', ['client'], [call('POST', '/api/orders'), call('DELETE', '/api/items')]),
  ]));
  assert.deepEqual(codes(report), [
    'warning route-method-mismatch-unverified DELETE /api/items',
    'warning route-decl-without-call GET /api/items',
    'warning route-call-without-decl-unverified POST /api/orders',
  ]);
  assert.equal(report.limitations.find(({ message }) => message.startsWith('framework-provided-routes:'))?.routeScope, undefined);
});

test('스코프 있는 한계와 스코프 없는 한계가 공존하면 스코프 없는 공백이 우선한다', () => {
  const report = createCheckReport(joinBridgeDocuments([
    springServer([decl('GET', '/api/items')], ['route-coverage: 1 router could not be read']),
    document('kotlin', ['client'], [call('POST', '/api/orders')]),
  ]));
  assert.deepEqual(codes(report), [
    'warning route-decl-without-call GET /api/items',
    'warning route-call-without-decl-unverified POST /api/orders',
  ]);
});

test('스코프는 한계를 신고한 문서의 한계에만 붙고 다른 서버 문서의 스코프 없는 한계를 좁히지 않는다', () => {
  const report = createCheckReport(joinBridgeDocuments([
    springServer([decl('GET', '/api/items')]),
    document('js', ['server'], [], { limitations: ['unresolved-route-prefix: servlet path is configured'] }),
    document('kotlin', ['client'], [call('POST', '/api/orders')]),
  ]));
  assert.deepEqual(codes(report), [
    'warning route-decl-without-call GET /api/items',
    'warning route-call-without-decl-unverified POST /api/orders',
  ]);
});

test('templateSuffixes는 base 앵커 선언의 꼬리로 끝나는 root 호출만 막는다', () => {
  const server = document('kotlin', ['server'], [decl('GET', '/items/{}', { pathAnchor: 'base' })], {
    limitations: ['unresolved-route-prefix: 1 controller prefix is a placeholder without default'],
    limitationScopes: [{ limitationIndex: 0, templateSuffixes: ['/items/{}'] }],
  });
  const report = createCheckReport(joinBridgeDocuments([
    server, document('kotlin', ['client'], [call('GET', '/v1/items/1/extra'), call('GET', '/v1/orders')]),
  ]));
  assert.deepEqual(codes(report).filter((code) => code.includes('route-call')), [
    'error route-call-without-decl GET /v1/items/1/extra',
    'error route-call-without-decl GET /v1/orders',
  ]);
  const covered = createCheckReport(joinBridgeDocuments([
    server, document('kotlin', ['client'], [call('POST', '/v1/items/1')]),
  ]));
  // 꼬리가 같은 호출은 suffix 후보의 method 불일치이므로 -unverified다. 스코프가 따로 error를 만들지 않는다.
  assert.deepEqual(codes(covered).filter((code) => code.includes('route-')), [
    'warning route-decl-without-call-unverified GET /items/{}',
    'warning route-method-mismatch-unverified POST /v1/items/1',
  ]);
});

test('호출 측 스코프는 겹치는 선언의 미호출 진단만 -unverified로 내린다', () => {
  const report = createCheckReport(joinBridgeDocuments([
    document('kotlin', ['server'], [decl('GET', '/api/items'), decl('GET', '/api/admin/users'), decl('POST', '/api/admin/users')]),
    document('kotlin', ['client'], [call('GET', '/api/items')], {
      limitations: ['generated-client-unscanned: admin SDK was not scanned'],
      limitationScopes: [{ limitationIndex: 0, templatePrefixes: ['/api/admin'], methods: ['GET'] }],
    }),
  ]));
  assert.deepEqual(codes(report), [
    'warning route-decl-without-call-unverified GET /api/admin/users',
    'warning route-decl-without-call POST /api/admin/users',
  ]);
  // 호출 측 스코프의 경로 원소는 귀속되지 않은 호출 경로일 수 있어 출력에 싣지 않고 개수만 싣는다.
  const limitation = report.limitations.find(({ message }) => message.startsWith('generated-client-unscanned:'));
  assert.deepEqual(limitation?.routeScope, { methods: ['GET'], withheldElements: 1 });
  assert.ok(!encodeSortedJson(report.limitations).includes('/api/admin"'));
});

test('서버 측 스코프는 조인 한계에 원소 그대로 실린다', () => {
  const report = createCheckReport(joinBridgeDocuments([
    springServer([decl('GET', '/api/items')]),
    document('kotlin', ['client'], [call('GET', '/api/items')]),
  ]));
  assert.deepEqual(report.limitations.filter(({ routeScope }) => routeScope !== undefined).map(({ routeScope }) => routeScope), [
    { templates: ['/error'] },
    { templatePrefixes: ['/'], methods: ['GET', 'HEAD'] },
  ]);
});

/** diff finding 하나를 찾는다. */
function only(report: HttpDiffDocument, code: string) {
  const found = report.findings.filter((entry) => entry.code === code);
  assert.equal(found.length, 1, `${code} in ${report.findings.map((entry) => entry.code).join(',')}`);
  return found[0]!;
}

test('diff --http: head의 스코프 밖 깨짐은 error이고 스코프 안 깨짐만 after-declaration-gap이다', () => {
  const before = springServer([decl('POST', '/api/orders'), decl('GET', '/api/orders')]);
  const after = springServer([]);
  const report = createHttpSurfaceDiff({
    before: [before], after: [after],
    clients: [document('kotlin', ['client'], [call('POST', '/api/orders'), call('GET', '/api/orders')])],
  });
  assert.equal(only(report, 'removed-bound-route').route!.method, 'POST');
  const unverified = only(report, 'removed-bound-route-unverified');
  assert.equal(unverified.route!.method, 'GET');
  assert.deepEqual(unverified.calls![0]!.reasons, ['after-declaration-gap']);
  // 공백 자체는 incompleteness로 남되, 스코프 있는 한계로만 신고됐음을 표시한다.
  const gaps = report.findings.filter(({ code }) => code === 'declaration-coverage-gap');
  assert.deepEqual(gaps.map(({ snapshot, detail }) => `${snapshot} ${detail}`), [
    'after framework-provided-routes: (scoped)', 'before framework-provided-routes: (scoped)',
  ]);
});
