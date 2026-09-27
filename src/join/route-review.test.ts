import assert from 'node:assert/strict';
import test from 'node:test';

import { parseBridgeFactsDocument, type BridgeFactsDocument } from '../exchange/parse.ts';
import { createCheckReport } from '../report/check-report.ts';
import { joinBridgeDocuments } from './join.ts';

/**
 * GLM 리뷰 지적의 재현 테스트다. 지적마다 계약이 요구하는 동작을 고정한다.
 */
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
function fact(kind: string, method: string, channel: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  line += 1;
  return {
    kind, channel, method, dynamic: false, pathAnchor: 'root',
    location: { path: kind === 'route-call' ? 'app/Api.kt' : 'src/routes.ts', line, column: 1 }, ...extra,
  };
}
const decl = (method: string, channel: string, extra: Record<string, unknown> = {}) => fact('route-decl', method, channel, extra);
const call = (method: string, channel: string, extra: Record<string, unknown> = {}) => fact('route-call', method, channel, extra);

/** 호출 측 진단 코드만 모은다. */
function callCodes(...documents: BridgeFactsDocument[]): string[] {
  return createCheckReport(joinBridgeDocuments(documents)).issues
    .filter(({ code }) => code.startsWith('route-call') || code.startsWith('route-method') ||
      code.endsWith('-mismatch') || code === 'ambiguous-route-call')
    .map(({ severity, code, channel }) => `${severity} ${code} ${channel}`);
}

test('리뷰 1: 긴 호출은 필수로 함께 있는 원본 {**} decl이 받고, 접두사로 닿으면 원본도 호출된 것으로 본다', () => {
  const symbol = { qualifiedName: 'Files.get', usr: 'files-get' };
  const server = document('js', ['server'], [
    decl('GET', '/a/{**}', { symbol }), decl('GET', '/a', { symbol, catchAllPrefix: true }),
  ]);
  const client = document('kotlin', ['client'], [call('GET', '/a/x'), call('GET', '/a/x/y'), call('GET', '/a')]);
  assert.deepEqual(callCodes(server, client), []);
  const scope = joinBridgeDocuments([server, client]).routes!.scopes[0]!;
  assert.deepEqual(scope.calls.map(({ template, decl: outcome }) =>
    `${template}:${outcome?.status === 'matched' ? outcome.targets.map((target) => target.template).join(',') : outcome?.status}`),
  ['/a/x:/a/{**}', '/a/x/y:/a/{**}', '/a:/a']);
  const onlyPrefixCall = joinBridgeDocuments([server, document('kotlin', ['client'], [call('GET', '/a')])]).routes!.scopes[0]!;
  assert.deepEqual(onlyPrefixCall.decls.map(({ declaration, called }) => `${declaration.template}:${called}`), ['/a/{**}:true', '/a:true']);
});

test('리뷰 1: 접두사 decl과 원본의 유효 service가 다르면 원본이 다른 scope로 갈라지므로 입력 오류다', () => {
  const symbol = { qualifiedName: 'Files.get', usr: 'files-get' };
  assert.throws(() => document('js', ['server'], [
    decl('GET', '/a/{**}', { symbol, service: 'one' }), decl('GET', '/a', { symbol, catchAllPrefix: true, service: 'two' }),
  ]), /no matching \{\*\*\} declaration/);
});

test('리뷰 2: suffix 후보도 caseInsensitive decl은 대소문자를 접어 맞춘다', () => {
  assert.deepEqual(callCodes(
    document('js', ['server'], [decl('GET', '/users', { pathAnchor: 'base', caseInsensitive: true })]),
    document('kotlin', ['client'], [call('GET', '/api/Users')]),
  ), []);
  assert.deepEqual(callCodes(
    document('js', ['server'], [decl('GET', '/api/v1/Users', { caseInsensitive: true })]),
    document('kotlin', ['client'], [call('GET', '/v1/users', { pathAnchor: 'base' })]),
  ), []);
  // caseInsensitive가 아니면 suffix에서도 대소문자를 구분한다(base 호출이라 error는 아니다).
  assert.deepEqual(callCodes(
    document('js', ['server'], [decl('GET', '/api/v1/Users')]),
    document('kotlin', ['client'], [call('GET', '/v1/users', { pathAnchor: 'base' })]),
  ), ['warning route-call-without-decl-unverified /v1/users']);
});

test('리뷰 3: roles에 server가 없는 문서는 route-decl을 실을 수 없어 (f)를 거짓으로 참이 되게 할 수 없다', () => {
  assert.throws(() => document('js', ['client'], [decl('GET', '/a')], { dispatch: undefined }), /matching document role/);
  // openapi(contract)만 있는 선언 측은 (f)가 거짓이라 decl 기반 진단을 내지 않는다.
  assert.deepEqual(callCodes(
    document('openapi', ['server'], [fact('route-contract', 'GET', '/a', { location: { path: 'o.yaml', line: 1, column: 1 } })]),
    document('kotlin', ['client'], [call('GET', '/b')]),
  ), ['warning route-call-without-contract-unverified /b']);
});

test('리뷰 4: 소비자 계수 한계는 입력 문서 순서와 무관하게 같은 순서다', () => {
  const server = document('js', ['server'], [decl('GET', '/a'), { ...decl('GET', 'x'), dynamic: true }]);
  const kotlin = document('kotlin', ['client'], [call('GET', '/z', { service: 'other' }), { ...call('GET', 'y'), dynamic: true }]);
  const swift = document('swift', ['client'], [{ ...call('GET', 'w'), dynamic: true }]);
  const forward = joinBridgeDocuments([server, kotlin, swift]).limitations;
  const backward = joinBridgeDocuments([swift, kotlin, server]).limitations;
  assert.deepEqual(backward, forward);
  assert.deepEqual(forward.map(({ platform, message }) => `${platform} ${message.split(':')[0]}`), [
    'js unjoined-dynamic-routes', 'kotlin unjoined-dynamic-route-calls', 'kotlin unjoined-unbound-route-calls',
    'swift unjoined-dynamic-route-calls',
  ]);
});

test('리뷰 5: 증명 불가 후보만으로 닿는 near-miss도 error로 올리지 않고 불일치 warning으로 남긴다', () => {
  const regex = { paramConstraints: [{ segment: 1, kind: 'regex', pattern: '[0-9]+' }] };
  assert.deepEqual(callCodes(
    document('js', ['server'], [decl('GET', '/Orders/{}', regex)]),
    document('kotlin', ['client'], [call('GET', '/orders/abc')]),
  ), ['warning route-case-mismatch /orders/abc']);
  assert.deepEqual(callCodes(
    document('js', ['server'], [decl('GET', '/orders/{}/', regex)]),
    document('kotlin', ['client'], [call('GET', '/orders/abc')]),
  ), ['warning route-trailing-slash-mismatch /orders/abc']);
  // 빈 끝 세그먼트↔{**}도 두 미상(끝 슬래시 정책, 0세그먼트 수용)이 겹친 경우라 error가 아니다.
  assert.deepEqual(callCodes(
    document('js', ['server'], [decl('GET', '/files/{**}')]),
    document('kotlin', ['client'], [call('GET', '/files')]),
  ), ['warning route-trailing-slash-mismatch /files']);
});

test('리뷰 6: 문서 service와 다른 사실 service는 파서가 거부하므로 서버 측 문서 선택은 유효 service와 같다', () => {
  assert.throws(() => document('js', ['server'], [decl('GET', '/a', { service: 'two' })], { service: 'one' }),
    /differs from the document service/);
  const routes = joinBridgeDocuments([
    document('js', ['server'], [], { service: 'one', limitations: ['route-coverage: synthetic'] }),
    document('js', ['server'], [decl('GET', '/a', { service: 'two' })]),
    document('kotlin', ['client'], [call('GET', '/b', { service: 'two' })]),
  ]).routes!;
  assert.deepEqual(routes.scopes.map(({ scope, serverLimitations }) => `${scope}:${serverLimitations.length}`), ['one:1', 'two:0']);
  assert.deepEqual(callCodes(...[
    document('js', ['server'], [], { service: 'one', limitations: ['route-coverage: synthetic'] }),
    document('js', ['server'], [decl('GET', '/a', { service: 'two' })]),
    document('kotlin', ['client'], [call('GET', '/b', { service: 'two' })]),
  ]), ['error route-call-without-decl /b']);
});

test('suffix 비교 예산을 넘으면 조인이 부분 결과 없이 원인과 해결 방향을 담은 입력 오류로 바꾼다', () => {
  // 선언 2,500개 × 오프셋 20 × base 호출 101개 > 5,000,000번 비교. 어느 후보도 맞지 않아 상한(64)에
  // 걸려 일찍 끝나지 않는다.
  const deep = `/${Array.from({ length: 19 }, () => 'a').join('/')}/x`;
  const decls = Array.from({ length: 2_500 }, () => decl('GET', deep));
  const calls = Array.from({ length: 101 }, () => call('GET', '/y/x', { pathAnchor: 'base' }));
  assert.throws(
    () => joinBridgeDocuments([document('js', ['server'], decls), document('kotlin', ['client'], calls)]),
    (error: unknown) => error instanceof Error && error.name === 'BridgeJoinValidationError' &&
      /Http suffix matching exceeds 5000000 comparisons; narrow the inputs/.test(error.message),
  );
});

test('매니페스트 없는 입력의 route-call-without-contract는 공백이 없어도 항상 -unverified다', () => {
  const report = createCheckReport(joinBridgeDocuments([
    document('js', ['server'], [decl('GET', '/a'), decl('GET', '/b')]),
    document('openapi', ['server'], [fact('route-contract', 'GET', '/a', { location: { path: 'o.yaml', line: 1, column: 1 } })]),
    document('kotlin', ['client'], [call('GET', '/a'), call('GET', '/b'), call('POST', '/a')]),
  ]));
  const contractSide = report.issues.filter(({ code }) => code.startsWith('route-call-without-contract'));
  assert.deepEqual(contractSide.map(({ severity, code, method, channel }) => `${severity} ${code} ${method} ${channel}`), [
    'warning route-call-without-contract-unverified POST /a',
    'warning route-call-without-contract-unverified GET /b',
  ]);
  // 같은 입력의 decl 쪽은 전제가 모두 증명돼 error다 — contract 쪽만 authoritative 선언이 없어 낮춘다.
  assert.equal(report.issues.find(({ code }) => code === 'route-method-mismatch')?.severity, 'error');
});

test('mixed-targets 보류가 http 귀속 위반보다 먼저 결정되어 보류 원인이 이긴다', () => {
  // 선언 측 service가 일부만 있어 route 조인은 입력 오류가 될 입력이지만, 같은 입력의 한 문서가
  // mixed-targets를 신고하면 조인 전체가 보류되어야 한다(route 조인을 실행하지 않는다).
  const mixed = parseBridgeFactsDocument({
    format: 'bridge-facts', version: 1, tool: { name: 'synthetic', version: '0.0.0' },
    generatedAt: '2026-09-27T00:00:00Z', platform: 'kotlin', target: 'flutter', project: '/work/example',
    facts: [{ kind: 'channel-register', channel: 'c', dynamic: false, location: { path: 'a.kt', line: 1, column: 1 } }],
    limitations: ['mixed-targets: flutter and react-native facts share this document'],
  });
  const dart = parseBridgeFactsDocument({
    format: 'bridge-facts', version: 1, tool: { name: 'synthetic', version: '0.0.0' },
    generatedAt: '2026-09-27T00:00:00Z', platform: 'dart', target: 'flutter', project: '/work/example',
    facts: [{ kind: 'channel-create', channel: 'c', dynamic: false, location: { path: 'a.dart', line: 1, column: 1 } }],
    limitations: [],
  });
  const joined = joinBridgeDocuments([
    dart, mixed,
    document('js', ['server'], [decl('GET', '/a')], { service: 'orders' }),
    document('openapi', ['server'], [fact('route-contract', 'GET', '/a', { location: { path: 'o.yaml', line: 1, column: 1 } })]),
    document('kotlin', ['client'], [call('GET', '/a')]),
  ]);
  assert.equal(joined.deferred, true);
  assert.equal(joined.routes, undefined);
  assert.equal(joined.observedFacts, 5);
});

/** 호출 템플릿별 decl 쪽 결과를 짧게 적는다. */
function outcomes(side: 'decl' | 'contract', ...documents: BridgeFactsDocument[]): string[] {
  return joinBridgeDocuments(documents).routes!.scopes.flatMap(({ scope, calls }) => calls.map((item) => {
    const outcome = item[side];
    const detail = outcome?.status === 'matched'
      ? `${outcome.quality}:${outcome.targets.map(({ template }) => template).join(',')}`
      : outcome?.status === 'ambiguous' ? `ambiguous:${outcome.targets.map(({ template }) => template).sort().join(',')}` : outcome?.status;
    return `${scope} ${item.template} ${detail}`;
  }));
}

test('suffix 후보도 구체성으로 순위를 매긴다: base 호출은 리터럴 root 선언을 {} 형제보다 먼저 고른다', () => {
  const client = document('kotlin', ['client'], [call('GET', '/companies/tech', { pathAnchor: 'base' }), call('GET', '/companies/42', { pathAnchor: 'base' })]);
  assert.deepEqual(outcomes('decl',
    document('js', ['server'], [decl('GET', '/api/v1/companies/tech'), decl('GET', '/api/v1/companies/{}')]), client), [
    'default /companies/tech suffix:/api/v1/companies/tech',
    'default /companies/42 suffix:/api/v1/companies/{}',
  ]);
  // openapi contract도 같은 구체성 규칙으로 고른다.
  const spec = document('openapi', ['server'], [
    fact('route-contract', 'GET', '/api/v1/companies/{}', { location: { path: 'o.yaml', line: 1, column: 1 } }),
    fact('route-contract', 'GET', '/api/v1/companies/tech', { location: { path: 'o.yaml', line: 2, column: 1 } }),
  ]);
  assert.deepEqual(outcomes('contract', spec, client), [
    'default /companies/tech suffix:/api/v1/companies/tech',
    'default /companies/42 suffix:/api/v1/companies/{}',
  ]);
  assert.deepEqual(callCodes(spec, client), []);
});

test('suffix 후보도 구체성으로 순위를 매긴다: root 호출은 리터럴 base 선언을 {} 형제보다 먼저 고른다', () => {
  assert.deepEqual(outcomes('decl',
    document('js', ['server'], [decl('GET', '/companies/{}', { pathAnchor: 'base' }), decl('GET', '/companies/tech', { pathAnchor: 'base' })]),
    document('kotlin', ['client'], [call('GET', '/api/companies/tech')]),
  ), ['default /api/companies/tech suffix:/companies/tech']);
  // 오프셋이 달라도 호출 세그먼트에 맞춰 비교한다. 알 수 없는 base 자리는 어떤 세그먼트보다 낮다.
  assert.deepEqual(outcomes('decl',
    document('js', ['server'], [decl('GET', '/tech', { pathAnchor: 'base' }), decl('GET', '/{}/tech', { pathAnchor: 'base' })]),
    document('kotlin', ['client'], [call('GET', '/api/companies/tech')]),
  ), ['default /api/companies/tech suffix:/{}/tech']);
});

test('구체성이 같은 suffix 후보는 여전히 모호하고, method 불일치는 여전히 error 근거가 아니다', () => {
  assert.deepEqual(outcomes('decl',
    document('js', ['server'], [decl('GET', '/a/companies/{}'), decl('GET', '/b/companies/{}')]),
    document('kotlin', ['client'], [call('GET', '/companies/{}', { pathAnchor: 'base' }), call('GET', '/companies/42', { pathAnchor: 'base' })]),
  ), [
    'default /companies/{} ambiguous:/a/companies/{},/b/companies/{}',
    'default /companies/42 ambiguous:/a/companies/{},/b/companies/{}',
  ]);
  assert.deepEqual(callCodes(
    document('js', ['server'], [decl('POST', '/companies/tech', { pathAnchor: 'base' }), decl('POST', '/companies/{}', { pathAnchor: 'base' })]),
    document('kotlin', ['client'], [call('GET', '/api/companies/tech')]),
  ), ['warning route-method-mismatch-unverified /api/companies/tech']);
});

test('다른 scope의 suffix 후보는 함께 순위를 매기지 않는다', () => {
  assert.deepEqual(outcomes('decl',
    document('js', ['server'], [decl('GET', '/api/v1/companies/{}')], { service: 'orders' }),
    document('kotlin', ['server'], [decl('GET', '/api/v1/companies/tech')], { service: 'billing' }),
    document('kotlin', ['client'], [call('GET', '/companies/tech', { pathAnchor: 'base', service: 'orders' })]),
  ), ['orders /companies/tech suffix:/api/v1/companies/{}']);
});
