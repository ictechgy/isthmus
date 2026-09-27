import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { parseBridgeFactsDocument, type BridgeFactsDocument } from '../exchange/parse.ts';
import { joinBridgeDocuments } from '../join/join.ts';
import {
  applyBaseline,
  baselineEntryKey,
  createBaselineDocument,
  encodeBaselineDocument,
  parseBaselineDocument,
} from './baseline.ts';
import { createCheckReport, httpIssueCodes, type CheckIssue, type CheckReport } from './check-report.ts';
import { createCodeQualityFindings, encodeCodeQualityReport } from './codequality.ts';
import { createHttpMatches } from './pairs.ts';
import { createSarifLog, encodeSarifLog } from './sarif.ts';

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
    location: { path: kind === 'route-call' ? 'app/Api.kt' : kind === 'route-contract' ? 'openapi.yaml' : 'src/routes.ts', line, column: 1 },
    ...extra,
  };
}
const decl = (method: string, channel: string, extra: Record<string, unknown> = {}) => fact('route-decl', method, channel, extra);
const call = (method: string | undefined, channel: string, extra: Record<string, unknown> = {}) => fact('route-call', method, channel, extra);
const contract = (method: string, channel: string, extra: Record<string, unknown> = {}) => fact('route-contract', method, channel, extra);

/** 입력을 조인해 check 보고서를 만든다. */
function report(...documents: BridgeFactsDocument[]): CheckReport {
  return createCheckReport(joinBridgeDocuments(documents));
}

/** 진단을 비교하기 쉬운 문자열로 줄인다. */
function codes(checkReport: CheckReport): string[] {
  return checkReport.issues.map((issue) =>
    `${issue.severity} ${issue.code} ${issue.method ?? '-'} ${issue.channel} @${issue.scope}`);
}

test('error 전제가 모두 증명되면 route-call-without-decl·route-method-mismatch는 error다', () => {
  const result = report(
    document('js', ['server'], [decl('GET', '/api/v1/items'), decl('GET', '/api/v1/items/{}')]),
    document('kotlin', ['client'], [call('GET', '/api/v1/items'), call('GET', '/api/v1/orders'), call('DELETE', '/api/v1/items/{}')]),
  );
  assert.deepEqual(codes(result), [
    'error route-method-mismatch DELETE /api/v1/items/{} @default',
    'warning route-decl-without-call GET /api/v1/items/{} @default',
    'error route-call-without-decl GET /api/v1/orders @default',
  ]);
  assert.equal(result.summary.errors, 2);
  assert.equal(result.summary.matchedRoutes, 1);
  // method 불일치 증거에는 호출과 경로 후보 decl이 함께 실린다.
  const mismatch = result.issues.find(({ code }) => code === 'route-method-mismatch')!;
  assert.deepEqual(mismatch.evidence.map(({ route }) => route?.kind), ['route-decl', 'route-call']);
});

test('선언 측이 contract뿐인 link는 decl 기반 진단을 -unverified까지 내지 않는다 (f)', () => {
  const result = report(
    document('openapi', ['server'], [contract('GET', '/api/v1/items'), contract('POST', '/api/v1/items')]),
    document('swift', ['client'], [call('GET', '/api/v1/items'), call('GET', '/api/v1/missing'), call('PUT', '/api/v1/items')]),
  );
  assert.deepEqual(codes(result), [
    'warning route-contract-without-call POST /api/v1/items @default',
    'warning route-call-without-contract-unverified PUT /api/v1/items @default',
    'warning route-call-without-contract-unverified GET /api/v1/missing @default',
  ]);
  assert.equal(result.issues.some(({ code }) => code.startsWith('route-call-without-decl') || code.startsWith('route-method-mismatch')), false);
  assert.equal(result.summary.errors, 0);
});

test('사실 0건 서버 문서도 route-decl을 스캔했다는 근거라 호출이 error가 된다', () => {
  const result = report(document('js', ['server'], []), document('kotlin', ['client'], [call('GET', '/a')]));
  assert.deepEqual(codes(result), ['error route-call-without-decl GET /a @default']);
});

test('base 앵커·테스트 소스·마스킹·동적 동사·동적 decl은 error 근거가 아니다', () => {
  const server = document('js', ['server'], [decl('GET', '/a')]);
  const cases: Array<[Record<string, unknown>, string]> = [
    [call('GET', '/missing', { pathAnchor: 'base' }), 'route-call-without-decl-unverified'],
    [call('GET', '/missing', { testSource: true }), 'route-call-without-decl-unverified'],
    [call('GET', '/hooks/{}', { maskedSegments: 1 }), 'route-call-without-decl-unverified'],
    [call(undefined, '/missing', { methodDynamic: true }), 'route-call-without-decl-unverified'],
    [call('POST', '/a', { testSource: true }), 'route-method-mismatch-unverified'],
    [call('POST', '/a', { pathAnchor: 'base' }), 'route-method-mismatch-unverified'],
  ];
  for (const [item, code] of cases) {
    const client = document('kotlin', ['client'], [item], { sourceSets: { tests: 'included' } });
    const issues = report(server, client).issues.filter(({ code: issueCode }) => issueCode.startsWith('route-call') || issueCode.startsWith('route-method'));
    assert.deepEqual(issues.map(({ code: issueCode, severity }) => `${severity} ${issueCode}`), [`warning ${code}`], JSON.stringify(item));
  }
  const dynamicServer = document('js', ['server'], [decl('GET', '/a'), { ...decl('GET', 'x'), dynamic: true }]);
  assert.deepEqual(codes(report(dynamicServer, document('kotlin', ['client'], [call('GET', '/b')])))
    .filter((code) => code.includes('route-call')), ['warning route-call-without-decl-unverified GET /b @default']);
});

test('서버 측 공백 접두사만 완화하고 모르는·체인 전용·호출 측 접두사는 error를 남긴다 (c)', () => {
  const client = document('kotlin', ['client'], [call('GET', '/missing')], { limitations: ['route-coverage: client typo'] });
  for (const prefix of ['route-coverage:', 'unresolved-route-prefix:', 'route-framework-version-unknown:',
    'framework-provided-routes:', 'route-dispatch-order-unknown:', 'route-template-expansion-capped:']) {
    const server = document('js', ['server'], [decl('GET', '/a')], { limitations: [`${prefix} synthetic gap`] });
    assert.equal(report(server, client).issues.find(({ channel }) => channel === '/missing')?.code,
      'route-call-without-decl-unverified', prefix);
  }
  for (const message of ['unknown-gap: 1', 'missing-route-usrs: 2', 'route-call-coverage: 1', 'unjoined-dynamic-routes: 9 forged']) {
    const server = document('js', ['server'], [decl('GET', '/a')], { limitations: [message] });
    assert.equal(report(server, client).issues.find(({ channel }) => channel === '/missing')?.code,
      'route-call-without-decl', message);
  }
});

test('호출이 닿지 않은 선언은 warning이고 호출 측 공백·미귀속 호출·base decl이면 -unverified다', () => {
  const server = document('js', ['server'], [decl('GET', '/a'), decl('GET', '/b'), decl('GET', '/c', { pathAnchor: 'base' })]);
  assert.deepEqual(codes(report(server, document('kotlin', ['client'], [call('GET', '/a')]))), [
    'warning route-decl-without-call GET /b @default',
    'warning route-decl-without-call-unverified GET /c @default',
  ]);
  for (const client of [
    document('kotlin', ['client'], [call('GET', '/a')], { limitations: ['http-wrapper-unresolved: 1 declared wrapper has no calls'] }),
    document('kotlin', ['client'], [call('GET', '/a'), { ...call('GET', 'u'), dynamic: true }]),
    document('kotlin', ['client'], [call('GET', '/a'), call('GET', '/elsewhere', { service: 'partner' })]),
  ]) {
    assert.deepEqual(codes(report(server, client)).filter((code) => code.includes('/b')),
      ['warning route-decl-without-call-unverified GET /b @default']);
  }
  // 호출 측 문서가 없는 드리프트 입력은 미호출 진단을 내지 않는다.
  const drift = report(server, document('openapi', ['server'], [contract('GET', '/a')]));
  assert.equal(drift.issues.some(({ code }) => code.includes('without-call')), false);
});

test('catch-all 접두사·테스트 소스 decl은 미호출·충돌 대상이 아니고 같은 키 중복만 충돌이다', () => {
  const symbol = { qualifiedName: 'Files.get', usr: 'files-get' };
  const server = document('js', ['server'], [
    decl('GET', '/files/{**}', { symbol }), decl('GET', '/files', { symbol, catchAllPrefix: true }),
    decl('GET', '/files', { symbol: { qualifiedName: 'Files.list', usr: 'files-list' } }),
    decl('GET', '/dup'), decl('GET', '/dup'),
    decl('GET', '/narrow'), decl('GET', '/narrow', { narrowed: true }),
    decl('GET', '/c/{}', { paramConstraints: [{ segment: 1, kind: 'int' }] }), decl('GET', '/c/{}'),
    decl('GET', '/t', { testSource: true }), decl('GET', '/t'),
  ], { sourceSets: { tests: 'included' } });
  const result = report(server, document('kotlin', ['client'], [
    call('GET', '/files'), call('GET', '/files/x'), call('GET', '/dup'), call('GET', '/narrow'), call('GET', '/c/1'), call('GET', '/t'),
  ]));
  assert.deepEqual(codes(result), ['warning route-decl-conflict GET /dup @default']);
  assert.equal(result.issues[0]!.evidence.length, 2);
});

test('decl과 contract의 드리프트를 양방향으로 내고 ANY decl은 모든 method를 덮는다', () => {
  const result = report(
    document('js', ['server'], [decl('GET', '/a'), decl('ANY', '/b'), decl('GET', '/only-server'), decl('GET', '/x', { pathAnchor: 'base' })]),
    document('openapi', ['server'], [contract('GET', '/a'), contract('POST', '/b'), contract('GET', '/only-spec')]),
    document('kotlin', ['client'], [call('GET', '/a'), call('POST', '/b'), call('GET', '/only-server'), call('GET', '/only-spec')]),
  );
  assert.deepEqual(codes(result).filter((code) => code.includes('without-contract') || code.includes('without-decl')), [
    'warning route-call-without-contract-unverified GET /only-server @default',
    'warning route-decl-without-contract GET /only-server @default',
    'error route-call-without-decl GET /only-spec @default',
    'warning route-contract-without-decl GET /only-spec @default',
  ]);
});

test('모호·끝 슬래시·대소문자 진단은 decl과 contract에서 같은 신원이면 하나로 합친다', () => {
  const result = report(
    document('js', ['server'], [decl('GET', '/a'), decl('GET', '/p/new'), decl('GET', '/p/top'), decl('GET', '/Case')]),
    document('openapi', ['server'], [contract('GET', '/a'), contract('GET', '/p/new'), contract('GET', '/p/top')]),
    document('kotlin', ['client'], [call('GET', '/a/'), call('GET', '/p/{}'), call('GET', '/case')]),
  );
  assert.deepEqual(codes(result).filter((code) => !code.includes('without')), [
    'warning route-trailing-slash-mismatch GET /a/ @default',
    'warning route-case-mismatch GET /case @default',
    'warning ambiguous-route-call GET /p/{} @default',
  ]);
  const slash = result.issues.find(({ code }) => code === 'route-trailing-slash-mismatch')!;
  // 증거는 조인과 같은 끝점 순서(플랫폼 우선)다.
  assert.deepEqual(slash.evidence.map(({ route }) => route?.kind), ['route-decl', 'route-call', 'route-contract']);
});

test('두 scope가 같은 키에 진단을 내도 scope로 신원이 갈려 codequality·baseline이 섞이지 않는다', () => {
  const result = report(
    document('js', ['server'], [decl('GET', '/a')], { service: 'orders' }),
    document('kotlin', ['server'], [decl('GET', '/a')], { service: 'billing' }),
    document('kotlin', ['client'], [call('POST', '/a', { service: 'orders' }), call('POST', '/a', { service: 'billing' })]),
  );
  assert.deepEqual(codes(result), [
    'warning route-decl-without-call GET /a @billing',
    'error route-method-mismatch POST /a @billing',
    'warning route-decl-without-call GET /a @orders',
    'error route-method-mismatch POST /a @orders',
  ]);
  const fingerprint = (issue: Parameters<typeof baselineEntryKey>[0]) => createHash('sha256').update(baselineEntryKey(issue)).digest('hex');
  const findings = createCodeQualityFindings(result, fingerprint);
  assert.equal(new Set(findings.map(({ fingerprint: value }) => value)).size, 4);
  assert.match(findings[0]!.description, /scope 'billing'/);
  const baseline = createBaselineDocument(result.issues, '2026-09-27T00:00:00.000Z');
  assert.deepEqual(baseline.entries.map(({ scope }) => scope), ['billing', 'orders', 'billing', 'orders']);
  const reparsed = parseBaselineDocument(JSON.parse(encodeBaselineDocument(baseline)));
  const suppressed = applyBaseline(result, reparsed.entries.filter(({ scope }) => scope === 'orders'));
  assert.deepEqual(suppressed.issues.map(({ scope, suppressed: flag }) => `${scope}:${flag === true}`),
    ['billing:false', 'billing:false', 'orders:true', 'orders:true']);
  assert.equal(suppressed.summary.errors, 1);
});

test('scope 없는 기존 진단의 베이스라인 키는 4원소 그대로고 http 항목은 scope가 필수다', () => {
  assert.equal(
    baselineEntryKey({ code: 'unhandled-invocation', target: 'flutter', channel: 'c', method: 'm' }),
    '["unhandled-invocation","flutter","c","m"]',
  );
  assert.equal(baselineEntryKey({ code: 'relation-use-without-decl', target: 'persistence', channel: 'users' }),
    '["relation-use-without-decl","persistence","users",null]');
  assert.equal(baselineEntryKey({ code: 'route-call-without-decl', target: 'http', channel: '/a', method: 'GET', scope: 'default' }),
    '["route-call-without-decl","http","/a","GET","default"]');
  const base = { format: 'isthmus-baseline', version: 1, generatedAt: '2026-09-27T00:00:00Z' };
  assert.throws(() => parseBaselineDocument({ ...base, entries: [{ code: 'route-call-without-decl', target: 'http', channel: '/a' }] }),
    /require a scope/);
  assert.throws(() => parseBaselineDocument({ ...base, entries: [{ code: 'unhandled-invocation', target: 'flutter', channel: 'c', scope: 'x' }] }),
    /Invalid scope/);
});

test('SARIF·codequality·baseline·pairs에는 귀속되지 않은 호출의 경로와 host가 없다', () => {
  const joined = joinBridgeDocuments([
    document('js', ['server'], [decl('GET', '/a')]),
    document('kotlin', ['client'], [
      call('GET', '/missing'),
      call('POST', '/services/T000/B000/XXXXSECRET', { service: 'partner', authority: 'hooks.example.com' }),
    ]),
  ]);
  const checkReport = createCheckReport(joined);
  const fingerprint = (issue: Parameters<typeof baselineEntryKey>[0]) => baselineEntryKey(issue);
  const outputs = [
    JSON.stringify(checkReport),
    encodeSarifLog(createSarifLog(checkReport, '0.0.0', fingerprint)),
    encodeCodeQualityReport(createCodeQualityFindings(checkReport, fingerprint)),
    encodeBaselineDocument(createBaselineDocument(checkReport.issues, '2026-09-27T00:00:00.000Z')),
    JSON.stringify(createHttpMatches(joined)),
  ];
  for (const output of outputs) {
    assert.equal(output.includes('XXXXSECRET'), false);
    assert.equal(output.includes('hooks.example.com'), false);
  }
  const sarif = createSarifLog(checkReport, '0.0.0', fingerprint);
  const ruleIds = sarif.runs[0]!.tool.driver.rules.map(({ id }) => id);
  for (const code of httpIssueCodes) assert.ok(ruleIds.includes(code), code);
  const result = sarif.runs[0]!.results.find(({ ruleId }) => ruleId === 'route-call-without-decl')!;
  assert.equal(result.properties.scope, 'default');
  assert.match(result.message.text, /in scope 'default'/);
});

test('--pairs의 http 매치는 선언 측 키·품질별로 호출·decl·contract를 묶는다', () => {
  const joined = joinBridgeDocuments([
    document('js', ['server'], [decl('GET', '/items/{}'), decl('GET', '/tags/new')]),
    document('openapi', ['server'], [contract('GET', '/items/{}')]),
    document('kotlin', ['client'], [call('GET', '/items/{}'), call('GET', '/items/7'), call('GET', '/tags/{}')]),
  ]);
  const matches = createHttpMatches(joined);
  assert.deepEqual(matches.map(({ scope, key, quality, uses, decls, contracts }) =>
    [scope, key.method, key.template, quality, uses.length, decls.length, contracts.length]), [
    ['default', 'GET', '/items/{}', 'exact', 2, 1, 1],
    ['default', 'GET', '/tags/new', 'param-to-literal', 1, 1, 0],
  ]);
  assert.deepEqual(matches[0]!.uses[0]!.route, { kind: 'route-call', method: 'GET', template: '/items/{}', pathAnchor: 'root' });
  const issues: readonly CheckIssue[] = createCheckReport(joined).issues;
  assert.deepEqual(issues.map(({ code }) => code), ['route-decl-without-contract', 'route-call-without-contract-unverified']);
});
