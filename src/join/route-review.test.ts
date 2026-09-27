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
