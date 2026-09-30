import assert from 'node:assert/strict';
import test from 'node:test';

import { parseBridgeFactsDocument, type BridgeFactsDocument } from '../exchange/parse.ts';
import { joinBridgeDocuments } from '../join/join.ts';
import { createCheckReport } from './check-report.ts';
import { createHttpMatches } from './pairs.ts';

/**
 * go·rust·python 클라이언트 route-call이 기존 호출 측 플랫폼과 같은 조인·귀속·심각도 규칙을 따르는지 확인한다.
 * 결합 규칙(base join)은 생산자 책임이고 isthmus는 받은 템플릿만 본다 — 플랫폼별 예외 분기가 없어야 한다.
 */

let line = 0;

/** 합성 http 문서다. */
function document(platform: string, roles: string[], facts: unknown[], extra: Record<string, unknown> = {}): BridgeFactsDocument {
  return parseBridgeFactsDocument({
    format: 'bridge-facts', version: 1, tool: { name: 'synthetic', version: '0.0.0' },
    generatedAt: '2026-09-30T00:00:00Z', platform, target: 'http', project: '/work/example',
    roles, facts, limitations: [],
    ...(roles.includes('server') ? { dispatch: 'specificity' } : {}),
    ...extra,
  });
}

/** 위치가 겹치지 않는 route 사실이다. */
function fact(kind: string, method: string, channel: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  line += 1;
  return {
    kind, channel, method, dynamic: false, pathAnchor: 'root',
    location: { path: `client/call${line}.src`, line, column: 1 },
    symbol: { qualifiedName: `${kind}${line}`, usr: `synthetic:${kind}:${line}` },
    ...extra,
  };
}

for (const platform of ['go', 'rust', 'python']) {
  test(`${platform} route-call은 서버 선언과 조인되고 미결합 root 호출은 error다`, () => {
    const join = joinBridgeDocuments([
      document('go', ['server'], [fact('route-decl', 'GET', '/api/users/{}')]),
      document(platform, ['client'], [
        fact('route-call', 'GET', '/api/users/{}'),
        fact('route-call', 'DELETE', '/api/users/{}'),
        fact('route-call', 'GET', '/api/orders'),
        // 알 수 없는 base 뒤의 호출(httpx base_url 미상 등)은 suffix 후보만 된다.
        fact('route-call', 'GET', '/users/{}', { pathAnchor: 'base' }),
      ]),
    ]);
    const report = createCheckReport(join);
    assert.deepEqual(report.issues.map(({ severity, code, method, channel }) => `${severity} ${code} ${method} ${channel}`), [
      'error route-call-without-decl GET /api/orders',
      'error route-method-mismatch DELETE /api/users/{}',
    ]);
    assert.deepEqual(createHttpMatches(join).map((match) => [match.quality, match.uses.map(({ platform: used }) => used)]), [
      ['exact', [platform]],
      ['suffix', [platform]],
    ]);
  });
}
