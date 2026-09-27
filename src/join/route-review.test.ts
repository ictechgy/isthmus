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
