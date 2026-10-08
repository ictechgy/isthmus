import assert from 'node:assert/strict';
import test from 'node:test';

import { parseNavigationFactsDocument } from '../exchange/navigation.ts';
import { parseBridgeFactsDocument } from '../exchange/parse.ts';
import { parseLanguageTraversal } from '../exchange/language-traversal.ts';
import { createNavigationTrace } from './navigation-trace.ts';

const project = '/work/example';
const navigation = parseNavigationFactsDocument({ format: 'navigation-facts', version: 1, platform: 'js', project,
  tool: { name: 'tsograph', version: 'test' }, generatedAt: '2026-01-01T00:00:00Z', limitations: [],
  facts: [{ kind: 'screen-route', urlTemplate: '/catalog', dynamic: false, location: { path: 'src/router.ts', line: 1, column: 1 },
    screen: { usr: 'src/screen.ts#Catalog' } }],
});
const location = { path: 'src/api.ts', line: 1, column: 1 };
const client = parseBridgeFactsDocument({ format: 'bridge-facts', version: 1, platform: 'js', target: 'http', project,
  tool: { name: 'tsograph', version: 'test' }, generatedAt: '2026-01-01T00:00:00Z', roles: ['client'], limitations: [],
  facts: [{ kind: 'route-call', channel: '/v2/catalog', method: 'GET', dynamic: false, pathAnchor: 'root', location,
    symbol: { usr: 'src/api.ts#read', qualifiedName: 'read' } }],
});
const server = parseBridgeFactsDocument({ format: 'bridge-facts', version: 1, platform: 'js', target: 'http', project,
  tool: { name: 'tsograph', version: 'test' }, generatedAt: '2026-01-01T00:00:00Z', roles: ['server'], dispatch: 'specificity', limitations: [],
  facts: [{ kind: 'route-decl', channel: '/v2/catalog', method: 'GET', dynamic: false, pathAnchor: 'root', location,
    symbol: { usr: 'src/server.ts#catalog', qualifiedName: 'catalog' } }],
});
const traversal = parseLanguageTraversal({ format: 'language-traversal', version: 1, platform: 'js', project,
  tool: { name: 'tsograph', version: 'test' }, generatedAt: '2026-01-01T00:00:00Z', direction: 'dependencies', dispatch: 'direct',
  roots: [{ id: 'src/screen.ts#Catalog', symbol: { usr: 'src/screen.ts#Catalog', qualifiedName: 'Catalog' } }],
  reached: [{ symbol: { usr: 'src/api.ts#read' }, via: 'src/screen.ts#Catalog', depth: 1, roots: [0] }],
  truncated: false, limitations: [],
});

test('navigation forward reach joins actual client API calls to backend declarations', () => {
  const report = createNavigationTrace(navigation, [client, server], [traversal]);
  assert.equal(report.chains.length, 1);
  assert.equal(report.chains[0]?.screen.usr, 'src/screen.ts#Catalog');
  assert.equal(report.chains[0]?.calls[0]?.symbol?.usr, 'src/api.ts#read');
  assert.equal(report.chains[0]?.calls[0]?.routes[0]?.decls[0]?.symbol?.usr, 'src/server.ts#catalog');
});

test('unrelated roots cannot make a screen reach a call and virtual URLs never form backend declarations', () => {
  const unrelated = { ...traversal, roots: [{ id: 'src/other.ts#Other', symbol: { usr: 'src/other.ts#Other' } }],
    reached: [{ ...traversal.reached[0]!, via: 'src/other.ts#Other' }] };
  const report = createNavigationTrace(navigation, [client, server], [unrelated]);
  assert.deepEqual(report.chains[0]?.calls, []);
  assert.ok(report.gaps.some((gap) => gap.code === 'screen-analysis-missing'));
  assert.ok(report.chains.every((chain) => chain.calls.every((call) => call.routes.every((route) => route.key.template !== '/catalog'))));
});

test('reachable client calls without backend declarations remain visible with a gap', () => {
  const report = createNavigationTrace(navigation, [client], [traversal]);
  assert.equal(report.chains[0]?.calls[0]?.symbol?.usr, 'src/api.ts#read');
  assert.deepEqual(report.chains[0]?.calls[0]?.routes, []);
  assert.ok(report.gaps.some((gap) => gap.code === 'screen-call-unjoined'));
});

test('a matched backend route does not import an unrelated caller into the selected screen chain', () => {
  const extra = { ...client, facts: [...client.facts, { ...client.facts[0]!,
    location: { ...location, line: 8 }, symbol: { usr: 'src/api.ts#unrelated', qualifiedName: 'unrelated' } }] };
  const report = createNavigationTrace(navigation, [extra, server], [traversal]);
  assert.equal(report.chains[0]?.calls.length, 1);
  assert.deepEqual(report.chains[0]?.calls[0]?.routes[0]?.uses.map((use) => use.symbol?.usr), ['src/api.ts#read']);
});


test('HTTP producer, join and freshness limitations retain provenance', () => {
  const report = createNavigationTrace(navigation, [
    { ...client, limitations: ['client-analysis: unresolved requests'] },
    { ...server, generatedAt: '2026-01-04T00:00:00Z', limitations: ['server-analysis: omitted handlers'] },
  ], [traversal]);
  assert.ok(report.httpLimitations.some((item) => item.tool === 'tsograph' && item.message.startsWith('client-analysis:')));
  assert.ok(report.httpLimitations.some((item) => item.message.startsWith('server-analysis:')));
  assert.ok(report.httpLimitations.some((item) => item.origin === 'consumer' && item.message.startsWith('input-freshness:')));
});

test('unassessed traversal creates explicit evidence and unresolved coverage gaps', () => {
  const { dispatch: _, ...unassessed } = traversal;
  const report = createNavigationTrace(navigation, [client, server], [unassessed]);
  assert.equal(report.chains[0]?.calls[0]?.evidence, 'unknown');
  assert.ok(report.gaps.some((item) => item.code === 'screen-analysis-evidence-unreported'));
  assert.ok(report.gaps.some((item) => item.code === 'screen-unresolved-calls-unreported'));
});

test('equivalent analysis order and repeated gaps produce canonical output', () => {
  const first = { ...traversal, truncated: true, limitations: ['z-limit'] };
  const second = { ...traversal, rootsTruncated: true, limitations: ['a-limit'] };
  const dynamic = { ...navigation.facts[0]!, dynamic: true };
  const input = { ...navigation, facts: [...navigation.facts, dynamic, dynamic] };
  const forward = createNavigationTrace(input, [client, server], [first, second, first]);
  const reverse = createNavigationTrace(input, [server, client], [second, first]);
  assert.deepEqual(forward, reverse);
  assert.equal(forward.gaps.filter((gap) => gap.code === 'screen-route-dynamic').length, 1);
  assert.equal(forward.gaps.find((gap) => gap.code === 'screen-route-dynamic')?.screen, 'src/screen.ts#Catalog');
});

test('screen-owned requests are reached at depth zero', () => {
  const owned = { ...client, facts: [{ ...client.facts[0]!, symbol: { usr: 'src/screen.ts#Catalog', qualifiedName: 'Catalog' } }] };
  const report = createNavigationTrace(navigation, [owned, server], [{ ...traversal, reached: [] }]);
  assert.equal(report.chains[0]?.calls[0]?.depth, 0);
  assert.equal(report.chains[0]?.calls[0]?.evidence, 'direct');
});

test('coverage limitations and HTTP calls without caller identity cannot appear complete', () => {
  const missing = { ...client, facts: [{ kind: 'route-call' as const, channel: '/v2/catalog', method: 'GET',
    dynamic: false, pathAnchor: 'root' as const, location }] };
  const report = createNavigationTrace({ ...navigation, limitations: ['navigation-project-coverage: incomplete source discovery'] },
    [missing, { ...server, limitations: ['server-analysis: incomplete handlers'] }], [traversal]);
  assert.ok(report.gaps.some((gap) => gap.code === 'navigation-analysis-limitations'));
  assert.ok(report.gaps.some((gap) => gap.code === 'http-analysis-limitations'));
  assert.ok(report.gaps.some((gap) => gap.code === 'http-call-symbol-missing'));
  assert.ok(report.limitations.some((line) => line.startsWith('navigation-http-caller-coverage: 1')));
});

test('distinct requests at one source location retain route identity and canonical order without locations', () => {
  const first = { ...client, facts: [{ ...client.facts[0]!, channel: '/v2/a', symbol: { usr: 'src/screen.ts#Catalog', qualifiedName: 'Catalog-a' } }] };
  const { location: _, ...withoutLocation } = first.facts[0]!;
  const second = { ...client, facts: [{ ...withoutLocation, channel: '/v2/b', symbol: { usr: 'src/screen.ts#Catalog', qualifiedName: 'Catalog-b' } }] };
  const input = { ...navigation, facts: [navigation.facts[0]!, navigation.facts[0]!] };
  const forward = createNavigationTrace(input, [first, second], [{ ...traversal, reached: [] }]);
  const reverse = createNavigationTrace(input, [second, first], [{ ...traversal, reached: [] }]);
  assert.deepEqual(forward, reverse);
  assert.equal(forward.chains.length, 1);
  assert.deepEqual(forward.chains[0]?.calls.map((call) => call.route?.template).sort(), ['/v2/a', '/v2/b']);
});

test('multiple matching server declarations retain canonical routes under document permutation', () => {
  const other = { ...server, facts: [{ ...server.facts[0]!, symbol: { usr: 'src/server.ts#other', qualifiedName: 'other' } }] };
  assert.deepEqual(createNavigationTrace(navigation, [client, server, other], [traversal]),
    createNavigationTrace(navigation, [other, client, server], [traversal]));
});

test('same unjoined occurrence with different names and test flags has a deterministic conservative representative', () => {
  const alias = { ...client, facts: [{ ...client.facts[0]!, testSource: true as const,
    symbol: { usr: 'src/api.ts#read', qualifiedName: 'readAlias' } }] };
  const forward = createNavigationTrace(navigation, [client, alias], [traversal]);
  const reverse = createNavigationTrace(navigation, [alias, client], [traversal]);
  assert.deepEqual(forward, reverse);
  assert.equal(forward.chains[0]?.calls.length, 1);
  assert.equal(forward.chains[0]?.calls[0]?.route?.testSource, true);
});

test('declared forward-analysis limitations become a gap only for their matching screen roots', () => {
  const limited = { ...traversal, limitations: ['graph-coverage: incomplete source discovery'] };
  const selected = createNavigationTrace(navigation, [client, server], [limited]);
  assert.ok(selected.gaps.some((gap) => gap.code === 'screen-analysis-limitations' && gap.screen === 'src/screen.ts#Catalog'));
  const unrelated = { ...limited, roots: [{ id: 'Other', symbol: { usr: 'Other' } }], reached: [] };
  assert.ok(!createNavigationTrace(navigation, [client, server], [traversal, unrelated]).gaps.some((gap) => gap.code === 'screen-analysis-limitations'));
});

test('three metadata variants choose the same representative under every input permutation', () => {
  const variants = ['zeta', 'alpha', 'middle'].map((name, index) => ({ ...client, facts: [{ ...client.facts[0]!,
    ...(index === 0 ? { testSource: true as const } : {}), symbol: { usr: 'src/api.ts#read', qualifiedName: name } }] }));
  const orders = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  const reports = orders.map((order) => createNavigationTrace(navigation, order.map((index) => variants[index]!), [traversal]));
  for (const report of reports) assert.deepEqual(report, reports[0]);
  assert.equal(reports[0]?.chains[0]?.calls[0]?.symbol?.qualifiedName, 'alpha');
  assert.equal(reports[0]?.chains[0]?.calls[0]?.route?.testSource, true);
});
