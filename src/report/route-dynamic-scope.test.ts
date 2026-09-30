import assert from 'node:assert/strict';
import test from 'node:test';

import { BridgeFactsValidationError, parseBridgeFactsDocument, type BridgeFactsDocument } from '../exchange/parse.ts';
import { joinBridgeDocuments } from '../join/join.ts';
import { createCheckReport, type CheckReport } from './check-report.ts';
import { createHttpSurfaceDiff, type HttpDiffDocument } from './http-diff.ts';

/**
 * dynamic 선언의 `dynamicScope`가 check·diff --http의 error 전제 (d)에 주는 효과다. 스코프 있는 dynamic 선언은 스코프와
 * 겹칠 수 있는 호출의 판정만 막고, 스코프 없는 dynamic 선언은 기존처럼 scope의 모든 호출을 막는다(하위 호환).
 */

let line = 0;

/** 합성 http 문서다. */
function document(platform: string, roles: string[], facts: unknown[], extra: Record<string, unknown> = {}): BridgeFactsDocument {
  return parseBridgeFactsDocument({
    format: 'bridge-facts', version: 1, tool: { name: 'synthetic', version: '0.0.0' },
    generatedAt: '2026-09-30T00:00:00Z', platform, target: 'http', project: '/work/example',
    roles, facts, limitations: [],
    ...(roles.includes('server') && platform !== 'openapi' ? { dispatch: 'specificity' } : {}),
    ...extra,
  });
}

/** 위치가 겹치지 않는 route 사실이다. */
function fact(kind: string, method: string, channel: string | null, extra: Record<string, unknown> = {}): Record<string, unknown> {
  line += 1;
  return {
    kind, channel, method, dynamic: channel === null, pathAnchor: 'root',
    location: { path: kind === 'route-call' ? 'app/Api.py' : 'app/urls.py', line, column: 1 },
    symbol: { qualifiedName: `${kind}${line}`, usr: `synthetic:${kind}:${line}` },
    ...extra,
  };
}
const decl = (method: string, channel: string, extra: Record<string, unknown> = {}) => fact('route-decl', method, channel, extra);
const dynamicDecl = (method: string, extra: Record<string, unknown> = {}) => fact('route-decl', method, null, extra);
const call = (method: string, channel: string, extra: Record<string, unknown> = {}) => fact('route-call', method, channel, extra);

/** 진단을 비교하기 쉬운 문자열로 줄인다. */
function codes(report: CheckReport): string[] {
  return report.issues.map((issue) => `${issue.severity} ${issue.code} ${issue.method ?? '-'} ${issue.channel}`);
}

/** 문서 하나를 검증한다. 거부되면 오류 문구를 돌려준다. */
function rejection(facts: unknown[], platform = 'kotlin', roles = ['server']): string | undefined {
  try {
    document(platform, roles, facts);
    return undefined;
  } catch (error) {
    if (error instanceof BridgeFactsValidationError) return error.message;
    throw error;
  }
}

test('dynamicScope 검증: dynamic 선언에만, 앵커·method 규칙을 지켜야 받는다', () => {
  assert.equal(rejection([dynamicDecl('ANY', { dynamicScope: { templatePrefixes: ['/admin'], methods: ['GET'] } })]), undefined);
  assert.equal(rejection([dynamicDecl('GET', { dynamicScope: { templates: ['/a/{}'], templateSuffixes: ['/b'] } })]), undefined);
  assert.equal(rejection([dynamicDecl('ANY', { pathAnchor: 'base', dynamicScope: { templatePrefixes: ['/'], methods: ['POST'] } })]),
    undefined);
  assert.match(rejection([decl('GET', '/static', { dynamicScope: { templatePrefixes: ['/static'] } })])!,
    /only valid on a dynamic declaration/);
  assert.match(rejection([fact('route-call', 'GET', null, { dynamicScope: { templatePrefixes: ['/a'] } })], 'kotlin', ['client'])!,
    /"dynamicScope" is not valid on route-call/);
  assert.match(rejection([dynamicDecl('GET', { dynamicScope: { templatePrefixes: ['/a'], methods: ['GET'] } })])!,
    /methods only on an ANY route-decl/);
  assert.match(rejection([dynamicDecl('ANY', { dynamicScope: { methods: ['GET'] } })])!, /entries require at least one of/);
  assert.match(rejection([dynamicDecl('ANY', { dynamicScope: {} })])!, /entries require at least one of/);
  assert.match(rejection([dynamicDecl('ANY', { dynamicScope: { limitationIndex: 0, templates: ['/a'] } })])!,
    /accepts only templates/);
  assert.match(rejection([dynamicDecl('ANY', { dynamicScope: ['/a'] })])!, /must be a JSON object/);
  assert.match(rejection([dynamicDecl('ANY', { dynamicScope: { templatePrefixes: ['/a/'] } })])!, /must not end with/);
  assert.match(rejection([dynamicDecl('ANY', { dynamicScope: { templates: ['/%2f'] } })])!, /lowercase-percent-hex/);
  assert.match(rejection([dynamicDecl('ANY', { pathAnchor: 'base', dynamicScope: { templates: ['/a'] } })])!,
    /base-anchored route dynamicScope/);
  assert.match(rejection([dynamicDecl('ANY', { pathAnchor: 'base', dynamicScope: { templatePrefixes: ['/a'] } })])!,
    /base-anchored route dynamicScope/);
  const many = Array.from({ length: 1_001 }, (_, index) => `/p${index}`);
  assert.match(rejection([dynamicDecl('ANY', { dynamicScope: { templates: many } })])!, /more than 1000 path templates/);
  // 다른 target 문서의 사실에 실리면 버리지 않고 거부한다.
  assert.throws(() => parseBridgeFactsDocument({
    format: 'bridge-facts', version: 1, tool: { name: 'synthetic', version: '0.0.0' }, generatedAt: '2026-09-30T00:00:00Z',
    platform: 'dart', target: 'flutter', project: '/work/example', limitations: [],
    facts: [{ kind: 'method-invoke', channel: 'c', method: 'm', dynamic: false, dynamicScope: { templates: ['/a'] } }],
  }), BridgeFactsValidationError);
});

test('dynamicScope는 정규화되어 보존된다(원소 중복 제거·문자열 순)', () => {
  const parsed = document('kotlin', ['server'], [dynamicDecl('ANY', {
    dynamicScope: { templatePrefixes: ['/b', '/a', '/b'], methods: ['POST', 'GET'] },
  })]);
  assert.deepEqual(parsed.facts[0]!.dynamicScope, { templatePrefixes: ['/a', '/b'], methods: ['GET', 'POST'] });
});

test('스코프 있는 dynamic decl은 스코프와 겹치는 호출만 -unverified로 내린다', () => {
  const report = createCheckReport(joinBridgeDocuments([
    document('python', ['server'], [
      decl('GET', '/api/items'),
      // re_path처럼 템플릿을 옮기지 못했지만 /admin 아래임은 증명한 등록(GET 전용).
      dynamicDecl('GET', { dynamicScope: { templatePrefixes: ['/admin'] } }),
      // 메서드를 모르는 등록이지만 /legacy/{}.php 꼴임은 증명했다.
      dynamicDecl('ANY', { dynamicScope: { templates: ['/legacy/{}.php'] } }),
    ]),
    document('kotlin', ['client'], [
      call('GET', '/api/items'),
      call('GET', '/admin/users'), call('POST', '/admin/users'), call('HEAD', '/Admin/Users/'),
      call('DELETE', '/legacy/index.php'), call('GET', '/api/orders'),
    ]),
  ]));
  assert.deepEqual(codes(report), [
    // POST는 GET 전용 dynamic decl이 받을 수 없어 error, HEAD는 GET으로도 닿고 대소문자·끝 슬래시는 넓게 읽는다.
    'warning route-call-without-decl-unverified HEAD /Admin/Users/',
    'warning route-call-without-decl-unverified GET /admin/users',
    'error route-call-without-decl POST /admin/users',
    'error route-call-without-decl GET /api/orders',
    'warning route-call-without-decl-unverified DELETE /legacy/index.php',
  ]);
  // 소비자 계수는 스코프 있는 dynamic 선언 수를 더해 싣는다.
  const counted = report.limitations.find(({ message }) => message.startsWith('unjoined-dynamic-routes:'));
  assert.equal(counted?.message, 'unjoined-dynamic-routes: 2 route declaration or contract facts with a non-literal template '
    + 'were not joined; 2 of them declare a dynamicScope and only affect calls inside it');
});

test('스코프 없는 dynamic decl이 하나라도 있으면 기존처럼 모든 호출의 error를 막는다(하위 호환)', () => {
  const report = createCheckReport(joinBridgeDocuments([
    document('python', ['server'], [
      dynamicDecl('GET', { dynamicScope: { templatePrefixes: ['/admin'] } }),
      dynamicDecl('POST'),
    ]),
    document('kotlin', ['client'], [call('PUT', '/api/orders')]),
  ]));
  assert.deepEqual(codes(report), ['warning route-call-without-decl-unverified PUT /api/orders']);
  const counted = report.limitations.find(({ message }) => message.startsWith('unjoined-dynamic-routes:'));
  assert.match(counted!.message, /; 1 of them declare a dynamicScope/);
});

test('같은 위치의 dynamic decl 사본이 스코프 없는 것과 섞이면 넓은 쪽(스코프 없음)으로 합친다', () => {
  const shared = dynamicDecl('ANY', { dynamicScope: { templatePrefixes: ['/admin'] } });
  const unscoped = { ...shared, dynamicScope: undefined };
  const scopedAgain = { ...shared, dynamicScope: { templatePrefixes: ['/ops'] } };
  const join = joinBridgeDocuments([
    document('python', ['server'], [shared]),
    document('python', ['server'], [unscoped]),
    document('python', ['server'], [scopedAgain]),
    document('kotlin', ['client'], [call('GET', '/api/orders')]),
  ]);
  const scope = join.routes!.scopes[0]!;
  assert.equal(scope.dynamicDecls, 1);
  assert.equal(scope.dynamicDeclEntries.length, 1);
  assert.equal(scope.dynamicDeclEntries[0]!.range, undefined);
  assert.equal(scope.calls[0]!.dynamicDeclGap, true);
  // 스코프 있는 사본 둘만이면 두 스코프 모두 공백이다.
  const scopedOnly = joinBridgeDocuments([
    document('python', ['server'], [shared]),
    document('python', ['server'], [scopedAgain]),
    document('kotlin', ['client'], [call('GET', '/ops/health'), call('GET', '/api/orders')]),
  ]).routes!.scopes[0]!;
  assert.equal(scopedOnly.dynamicDeclEntries.length, 2);
  assert.deepEqual(scopedOnly.calls.map(({ template, dynamicDeclGap }) => `${template} ${dynamicDeclGap}`),
    ['/ops/health true', '/api/orders false']);
});

test('dynamic contract의 스코프는 route-call-without-contract 판정에 같은 방식으로 적용된다', () => {
  const join = joinBridgeDocuments([
    document('kotlin', ['server'], [decl('GET', '/v1/items')]),
    document('openapi', ['server'], [
      { kind: 'route-contract', channel: null, method: 'GET', dynamic: true, pathAnchor: 'root',
        location: { path: 'openapi.yaml', line: 3, column: 3 }, symbol: { qualifiedName: 'listReports' },
        dynamicScope: { templatePrefixes: ['/v1/reports'] } },
    ]),
    document('kotlin', ['client'], [call('GET', '/v1/reports/7'), call('GET', '/v1/other')]),
  ]);
  const calls = join.routes!.scopes[0]!.calls;
  assert.deepEqual(calls.map(({ template, dynamicContractGap }) => `${template} ${dynamicContractGap}`),
    ['/v1/reports/7 true', '/v1/other false']);
});

test('match된 호출은 dynamic decl이 있는지만 싣고 스코프 비교를 하지 않는다', () => {
  const scope = joinBridgeDocuments([
    document('python', ['server'], [decl('GET', '/api/items'), dynamicDecl('GET', { dynamicScope: { templates: ['/x'] } })]),
    document('kotlin', ['client'], [call('GET', '/api/items')]),
  ]).routes!.scopes[0]!;
  assert.equal(scope.calls[0]!.decl?.status, 'matched');
  assert.equal(scope.calls[0]!.dynamicDeclGap, true);
});

/** diff finding 하나를 찾는다. */
function only(report: HttpDiffDocument, code: string) {
  const found = report.findings.filter((entry) => entry.code === code);
  assert.equal(found.length, 1, `${code} in ${report.findings.map((entry) => entry.code).join(',')}`);
  return found[0]!;
}

test('diff --http: head dynamic decl의 스코프 밖 깨짐은 error이고 스코프 안 깨짐만 after-declaration-gap이다', () => {
  const before = document('python', ['server'], [decl('POST', '/api/orders'), decl('GET', '/admin/panel')]);
  const after = document('python', ['server'], [dynamicDecl('ANY', { dynamicScope: { templatePrefixes: ['/admin'] } })]);
  const report = createHttpSurfaceDiff({
    before: [before], after: [after],
    clients: [document('kotlin', ['client'], [call('POST', '/api/orders'), call('GET', '/admin/panel')])],
  });
  assert.equal(only(report, 'removed-bound-route').route!.template, '/api/orders');
  const unverified = only(report, 'removed-bound-route-unverified');
  assert.equal(unverified.route!.template, '/admin/panel');
  assert.deepEqual(unverified.calls![0]!.reasons, ['after-declaration-gap']);
  assert.deepEqual(only(report, 'declarations-dynamic').counts, { before: 0, after: 1 });
});

test('diff --http: 스코프 없는 head dynamic decl은 모든 깨짐을 after-declaration-gap으로 둔다(하위 호환)', () => {
  const report = createHttpSurfaceDiff({
    before: [document('python', ['server'], [decl('POST', '/api/orders')])],
    after: [document('python', ['server'], [dynamicDecl('ANY')])],
    clients: [document('kotlin', ['client'], [call('POST', '/api/orders')])],
  });
  assert.deepEqual(only(report, 'removed-bound-route-unverified').calls![0]!.reasons, ['after-declaration-gap']);
});
