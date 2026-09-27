import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { runCheckCommand } from './check-command.ts';
import type { CommandResult } from './command-support.ts';
import { runDiffCommand } from './diff-command.ts';
import { runGraphCommand } from './graph-command.ts';
import { runImpactCommand } from './impact-command.ts';
import { runPreflightCommand } from './preflight-command.ts';
import { runQueryCommand } from './query-command.ts';
import { runRetentionsCommand } from './retentions-command.ts';

/**
 * http 도메인의 CLI 경계다. 입력은 `fixtures/http`의 합성 문서(가상의 items API)뿐이다.
 * 귀속되지 않은 호출(`third-party-hooks` service, 마스킹된 웹훅 경로)의 경로·host가 어떤
 * 출력에도 나오지 않는지 함께 본다.
 */
const fixtureRoot = new URL('../../fixtures/http/', import.meta.url);
const read = (path: string): Promise<string> => readFile(new URL(path, fixtureRoot), 'utf8');
const clock = (): Date => new Date('2026-09-27T00:00:00.000Z');
const all = ['server.json', 'openapi.json', 'android.json', 'ios.json'];

/** 귀속되지 않은 호출의 원문이 결과에 없는지 확인한다. */
function assertNoUnattributed(result: CommandResult): void {
  for (const secret of ['/services/', 'hooks.example.com', 'third-party-hooks']) {
    assert.equal(result.standardOutput.includes(secret), false, secret);
    assert.equal(result.standardError.includes(secret), false, secret);
  }
}

test('check는 http 문서를 조인해 scope가 붙은 진단과 matchedRoutes를 낸다', async () => {
  const result = await runCheckCommand(['check', ...all], read, undefined, clock, '0.0.0');
  assert.equal(result.exitCode, 0);
  assertNoUnattributed(result);
  const report = JSON.parse(result.standardOutput) as {
    summary: Record<string, number>;
    issues: Array<{ severity: string; code: string; method?: string; channel: string; scope?: string }>;
    limitations: Array<{ message: string }>;
  };
  assert.equal(report.summary.matchedRoutes, 4);
  assert.deepEqual(report.issues.map(({ severity, code, method, channel, scope }) => `${severity} ${code} ${method} ${channel} ${scope}`), [
    'warning route-decl-without-call-unverified GET /api/v1/items/featured default',
    'warning route-decl-without-contract GET /api/v1/items/featured default',
    'warning route-contract-without-call-unverified DELETE /api/v1/items/{} default',
    'warning route-contract-without-decl DELETE /api/v1/items/{} default',
    'warning route-call-without-contract-unverified PUT /api/v1/items/{} default',
    'error route-method-mismatch PUT /api/v1/items/{} default',
    'warning route-call-without-contract-unverified GET /api/v1/orders default',
    'error route-call-without-decl GET /api/v1/orders default',
    'warning route-call-without-contract-unverified GET /files default',
    'warning route-decl-without-contract GET /files/{**} default',
  ]);
  assert.deepEqual(report.limitations.map(({ message }) => message.split(':')[0]),
    ['unjoined-unbound-route-calls', 'unjoined-dynamic-route-calls']);
  const strict = await runCheckCommand(['check', ...all, '--strict'], read, undefined, clock, '0.0.0');
  assert.equal(strict.exitCode, 1);
});

test('check --pairs는 기본 문서에 http matches만 덧붙인다', async () => {
  const plain = await runCheckCommand(['check', ...all], read, undefined, clock, '0.0.0');
  const paired = await runCheckCommand(['check', ...all, '--pairs'], read, undefined, clock, '0.0.0');
  assert.equal(paired.exitCode, plain.exitCode);
  assertNoUnattributed(paired);
  const { matches, ...rest } = JSON.parse(paired.standardOutput) as { matches: Array<Record<string, unknown>> };
  assert.deepEqual(rest, JSON.parse(plain.standardOutput));
  assert.deepEqual(matches.map(({ domain, scope, key, quality }) => [domain, scope, key, quality]), [
    ['http', 'default', { method: 'GET', template: '/api/v1/items' }, 'exact'],
    ['http', 'default', { method: 'POST', template: '/api/v1/items' }, 'exact'],
    ['http', 'default', { method: 'GET', template: '/api/v1/items/{}' }, 'exact'],
    ['http', 'default', { method: 'GET', template: '/files' }, 'catch-all'],
  ]);
  const listMatch = matches[0] as { uses: Array<{ symbol?: { usr?: string } }>; decls: unknown[]; contracts: unknown[] };
  assert.deepEqual(listMatch.uses.map(({ symbol }) => symbol?.usr), ['kt:ItemsApi.list', 's:ItemsEndpoint.list']);
  assert.equal(listMatch.decls.length, 1);
  assert.equal(listMatch.contracts.length, 1);
});

test('SARIF·codequality·baseline에도 http 진단의 scope가 실리고 미귀속 호출은 없다', async () => {
  const sarif = await runCheckCommand(['check', ...all, '--format', 'sarif'], read, undefined, clock, '0.0.0');
  assertNoUnattributed(sarif);
  const log = JSON.parse(sarif.standardOutput) as {
    runs: Array<{ tool: { driver: { rules: Array<{ id: string }> } }; results: Array<{ properties: { scope?: string } }> }>;
  };
  assert.ok(log.runs[0]!.tool.driver.rules.some(({ id }) => id === 'route-call-without-decl'));
  assert.ok(log.runs[0]!.results.every(({ properties }) => properties.scope === 'default'));
  const codequality = await runCheckCommand(['check', ...all, '--format', 'codequality'], read, undefined, clock, '0.0.0');
  assert.equal(codequality.exitCode, 0);
  assertNoUnattributed(codequality);
  const written = new Map<string, string>();
  const updated = await runCheckCommand(['check', ...all, '--update-baseline', 'baseline.json'], read,
    async (path, text) => { written.set(path, text); }, clock, '0.0.0');
  assert.equal(updated.exitCode, 0);
  const baselineText = written.get('baseline.json')!;
  assert.equal(baselineText.includes('/services/'), false);
  assert.ok((JSON.parse(baselineText) as { entries: Array<{ scope?: string }> }).entries.every(({ scope }) => scope === 'default'));
  const suppressed = await runCheckCommand(['check', ...all, '--strict', '--baseline', 'baseline.json'],
    async (path) => (path === 'baseline.json' ? baselineText : read(path)), undefined, clock, '0.0.0');
  assert.equal(suppressed.exitCode, 0);
  assert.equal((JSON.parse(suppressed.standardOutput) as { summary: { suppressed: number } }).summary.suppressed, 10);
});

test('사실 0건 client 문서는 받아지고 bridge 요건을 채우지 않는다', async () => {
  const result = await runCheckCommand(['check', 'server.json', 'dart-empty-client.json'], read, undefined, clock, '0.0.0');
  assert.equal(result.exitCode, 0);
  const report = JSON.parse(result.standardOutput) as { summary: { matchedRoutes: number }; issues: Array<{ code: string }> };
  assert.equal(report.summary.matchedRoutes, 0);
  assert.ok(report.issues.every(({ code }) => code === 'route-decl-without-call'));
  const onlyServer = await runCheckCommand(['check', 'server.json', 'openapi.json'], read, undefined, clock, '0.0.0');
  assert.equal(onlyServer.exitCode, 0, 'decl과 contract만 있는 드리프트 입력은 받는다');
  const missingSide = await runCheckCommand(['check', 'android.json', 'ios.json'], read, undefined, clock, '0.0.0');
  assert.equal(missingSide.exitCode, 2);
  assert.match(missingSide.standardError, /at least one declaration-side document/);
});

test('query route:는 귀속된 키만 찾고 qualifiedName으로 다시 질의할 수 있다', async () => {
  const found = await runQueryCommand(['query', 'route:GET /api/v1/items', ...all], read);
  assert.equal(found.exitCode, 0);
  assertNoUnattributed(found);
  const document = JSON.parse(found.standardOutput) as {
    level: string;
    result: { subject: { qualifiedName: string; kind: string }; usedBy: unknown[]; dependsOn: unknown[] };
  };
  assert.equal(document.level, 'http');
  assert.deepEqual(document.result.subject, { name: 'GET /api/v1/items', qualifiedName: 'route:GET /api/v1/items default', kind: 'route' });
  assert.equal(document.result.usedBy.length, 2);
  assert.equal(document.result.dependsOn.length, 2);
  const again = await runQueryCommand(['query', document.result.subject.qualifiedName, ...all], read);
  assert.equal(again.exitCode, 0);
  const prefix = await runQueryCommand(['query', 'route:GET /api/v1/items/search/{}', 'server.json', 'ios.json'], read);
  assert.equal(prefix.exitCode, 64, '선언·호출 키가 없으면 prefix 후보만으로 찾지 않는다');
  const withPrefix = JSON.parse((await runQueryCommand(['query', 'route:GET /api/v1/items/{}', ...all], read)).standardOutput) as {
    result: { prefixCandidates: unknown[]; issues: Array<{ code: string }> };
  };
  assert.equal(withPrefix.result.prefixCandidates.length, 0);
  const ambiguous = await runQueryCommand(['query', 'route:/api/v1/items/{}', ...all], read);
  assert.equal(ambiguous.exitCode, 64);
  assert.match(ambiguous.standardError, /matches 3 scoped keys/);
  const unattributed = await runQueryCommand(['query', 'route:POST /services/{}/{}/{}', ...all], read);
  assert.equal(unattributed.exitCode, 64);
  // 요청 문자열의 반향(`requested`) 말고는 어디에도 그 호출이 나오지 않는다.
  const { requested, ...unattributedRest } = JSON.parse(unattributed.standardOutput) as Record<string, unknown>;
  assert.equal(requested, 'route:POST /services/{}/{}/{}');
  assert.equal(unattributedRest.status, 'notFound');
  assertNoUnattributed({ ...unattributed, standardOutput: JSON.stringify(unattributedRest) });
  assert.match(unattributed.standardError, /No attributed http route/);
  for (const subject of ['route:', 'route:GET', 'route:GET items', 'route:FETCH /a', 'route:GET /a%2f']) {
    const usage = await runQueryCommand(['query', subject, ...all], read);
    assert.equal(usage.exitCode, 64, subject);
    assert.equal(usage.standardOutput, '');
  }
});

test('query route: 주체는 dynamic 호출의 증명된 접두사를 prefix 후보로 보인다', async () => {
  const withSearch = await runQueryCommand(['query', 'route:GET /api/v1/items/search', 'server.json', 'openapi.json', 'ios.json',
    'android.json'], async (path) => {
    if (path !== 'server.json') return read(path);
    const server = JSON.parse(await read(path)) as { facts: unknown[] };
    server.facts.push({
      kind: 'route-decl', method: 'GET', channel: '/api/v1/items/search', dynamic: false, pathAnchor: 'root',
      location: { path: 'server/routes/items.ts', line: 50, column: 5 },
    });
    return JSON.stringify(server);
  });
  assert.equal(withSearch.exitCode, 0);
  const document = JSON.parse(withSearch.standardOutput) as { result: { prefixCandidates: Array<{ location: { line: number } }> } };
  assert.deepEqual(document.result.prefixCandidates.map(({ location }) => location.line), [52]);
});

test('http 도메인을 아직 소비하지 않는 명령은 원인을 밝혀 거부한다', async () => {
  const expectations: Array<[Promise<CommandResult>, RegExp]> = [
    [runGraphCommand(['graph', ...all], read), /Graph does not support http documents yet/],
    [runRetentionsCommand(['retentions', ...all, '--for', 'cartograph'], read, clock, '0.0.0'), /Retentions does not support http/],
    [runImpactCommand(['impact', '--file', 'app/src/main/java/example/ItemsApi.kt', ...all], read), /Impact does not support http/],
    [runDiffCommand(['diff', '--before', 'server.json', 'android.json', '--after', 'server.json', 'android.json'], read),
      /Diff does not support http documents yet/],
  ];
  for (const [pending, message] of expectations) {
    const result = await pending;
    assert.equal(result.exitCode, 2);
    assert.match(result.standardError, message);
    assert.equal(result.standardOutput, '');
  }
  const context = JSON.parse(await readFile(new URL('../preflight/context.json', fixtureRoot), 'utf8')) as {
    project: string; bridges: unknown[];
  };
  context.bridges = [{ ...(JSON.parse(await read('android.json')) as object), project: context.project }];
  const preflight = await runPreflightCommand(['preflight', 'context.json'], async () => JSON.stringify(context));
  assert.equal(preflight.exitCode, 2);
  assert.match(preflight.standardError, /remove http documents from the context/);
});

test('check --pairs는 http 쌍 상한을 넘으면 stdout 없이 종료 코드 2다', async () => {
  const server = await read('server.json');
  const client = (file: number): string => JSON.stringify({
    ...(JSON.parse(server) as object), platform: 'kotlin', roles: ['client'], dispatch: undefined,
    facts: Array.from({ length: 50_001 }, (_, index) => ({
      kind: 'route-call', channel: '/api/v1/items', method: 'GET', dynamic: false, pathAnchor: 'root',
      location: { path: `app/Calls${file}.kt`, line: index + 1, column: 1 },
    })),
  });
  const inputs: Record<string, string> = { 'server.json': server, 'c0.json': client(0), 'c1.json': client(1) };
  const result = await runCheckCommand(['check', 'server.json', 'c0.json', 'c1.json', '--pairs'],
    async (path) => inputs[path]!, undefined, clock, '0.0.0');
  assert.equal(result.exitCode, 2);
  assert.equal(result.standardOutput, '');
  assert.match(result.standardError, /Cannot produce http pairs with more than 100000/);
  const plain = await runCheckCommand(['check', 'server.json', 'c0.json', 'c1.json'], async (path) => inputs[path]!,
    undefined, clock, '0.0.0');
  assert.equal(plain.exitCode, 0, '--pairs 없이는 같은 입력이 정상 보고된다');
});
