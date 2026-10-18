import assert from 'node:assert/strict';
import test from 'node:test';

import { compareStrings } from '../compare.ts';
import { parseNavigationFactsDocument } from '../exchange/navigation.ts';
import { parseBridgeFactsDocument } from '../exchange/parse.ts';
import { parseLanguageTraversal } from '../exchange/language-traversal.ts';
import { createNavigationTrace, NavigationTraceInputError } from './navigation-trace.ts';

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

test('mixed-target HTTP documents defer the join and fail as a navigation input error', () => {
  const mixed = { ...client, limitations: ['mixed-targets: flutter and react-native'] };
  for (const documents of [[mixed, server], [server, mixed], [mixed]]) {
    assert.throws(() => createNavigationTrace(navigation, documents, [traversal]), (error: unknown) =>
      error instanceof NavigationTraceInputError
      && error.message === 'Navigation trace cannot use documents with mixed bridge targets; split them by target.');
  }
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

test('multi-root navigation preserves the actual witness instead of attributing its depth to the screen', () => {
  const multi = parseLanguageTraversal({ ...traversal, revision: 'rev-a', graphRevision: 'graph-a',
    roots: [{ id: 'Other', symbol: { usr: 'Other' } }, ...traversal.roots],
    reached: [{ ...traversal.reached[0]!, via: 'Other', roots: [0, 1] }] });
  const report = createNavigationTrace(navigation, [client, server], [multi]);
  const call = report.chains[0]!.calls[0]!;
  assert.deepEqual(call.path, ['Other', 'src/api.ts#read']);
  assert.equal(call.witnessRoot, 'Other');
  const source = report.analyses.find((analysis) => analysis.id === call.witnesses[0]!.analysis)!;
  assert.equal(source.revision, 'rev-a');
  assert.equal(source.graphRevision, 'graph-a');
  assert.ok(report.gaps.some((gap) => gap.code === 'screen-witness-other-root'));
});

test('candidate reach and conflicting source or graph revisions cannot become a gap-free trace', () => {
  const candidate = parseLanguageTraversal({ ...traversal, revision: 'old', graphRevision: 'graph-old',
    dispatch: 'candidates', reached: [{ ...traversal.reached[0]!, evidence: 'candidate' }] });
  const current = parseLanguageTraversal({ ...traversal, revision: 'new', graphRevision: 'graph-new' });
  const report = createNavigationTrace(navigation, [client, server], [candidate, current]);
  assert.ok(report.gaps.some((gap) => gap.code === 'screen-candidate-dispatch'));
  assert.ok(report.gaps.some((gap) => gap.code === 'screen-analysis-revision-conflict'));
  assert.ok(report.gaps.some((gap) => gap.code === 'screen-analysis-graph-revision-conflict'));
  assert.deepEqual(report.chains[0]!.calls[0]!.witnesses.map((witness) => witness.evidence).sort(), ['candidate', 'direct']);
  assert.deepEqual(report, createNavigationTrace(navigation, [server, client], [current, candidate, current]));
});

test('selected-screen witnesses and missing revisions retain exact source metadata even with no HTTP calls', () => {
  const known = { ...traversal, revision: 'rev-a', graphRevision: 'graph-a' };
  const partial = { ...traversal, truncated: true, rootsTruncated: true, truncationReasons: ['depth-limit'], limitations: ['scope: partial'] };
  const report = createNavigationTrace(navigation, [client, server], [known, partial]);
  const call = report.chains[0]!.calls[0]!;
  assert.deepEqual(call.path, ['src/screen.ts#Catalog', 'src/api.ts#read']);
  assert.equal(call.witnessRoot, undefined);
  assert.equal(call.witnessPartial, undefined);
  assert.equal(call.witnesses.length, 2);
  assert.ok(report.gaps.some((gap) => gap.code === 'screen-analysis-revision-unknown'));
  assert.ok(report.gaps.some((gap) => gap.code === 'screen-analysis-graph-revision-unknown'));
  const source = report.analyses.find((item) => item.truncated)!;
  assert.equal(source.revision, undefined);
  assert.deepEqual(source.tool, traversal.tool);
  assert.equal(source.generatedAt, traversal.generatedAt);
  assert.equal(source.rootsTruncated, true);
  assert.deepEqual(source.truncationReasons, ['depth-limit']);
  assert.deepEqual(source.limitations, ['scope: partial']);
  const empty = createNavigationTrace(navigation, [], [partial]);
  assert.deepEqual(empty.chains[0]!.calls, []);
  assert.deepEqual(empty.analyses, [source]);
});

test('partial cyclic root witnesses stay partial and never invent a screen-to-call path', () => {
  const cyclic = parseLanguageTraversal({ ...traversal, revision: 'rev-a',
    roots: [{ id: 'src/api.ts#read', symbol: { usr: 'src/api.ts#read' } }, ...traversal.roots],
    reached: [
      { symbol: { usr: 'V' }, via: 'src/api.ts#read', depth: 1, roots: [0, 1] },
      { symbol: { usr: 'W' }, via: 'src/screen.ts#Catalog', depth: 1, roots: [1] },
      { symbol: { usr: 'src/api.ts#read' }, via: 'V', depth: 3, roots: [1] },
    ] });
  const report = createNavigationTrace(navigation, [client, server], [cyclic]);
  assert.deepEqual(report.chains[0]!.calls[0]!.path, ['V', 'src/api.ts#read']);
  assert.equal(report.chains[0]!.calls[0]!.witnessPartial, true);
  assert.equal(report.chains[0]!.calls[0]!.witnessRoot, undefined);
  assert.equal(report.chains[0]!.calls[0]!.witnesses[0]!.witnessRoot, undefined);
  assert.ok(report.gaps.some((gap) => gap.code === 'screen-witness-partial'));
  // 완전한 입력에서는 V도 다른 root를 목격한다. 부분 귀속 fixture로 그 관찰을
  // 분리해, 부분 경로 자체가 other-root gap을 만들어 내지 않음을 검증한다.
  const partialAttribution = parseLanguageTraversal({ ...cyclic, truncated: true,
    reached: cyclic.reached.map((row) => row.symbol.usr === 'V' ? { ...row, roots: [0] } : row) });
  const isolated = createNavigationTrace(navigation, [client, server], [partialAttribution]);
  assert.ok(isolated.gaps.some((gap) => gap.code === 'screen-witness-partial'));
  assert.ok(!isolated.gaps.some((gap) => gap.code === 'screen-witness-other-root'));

});

test('unrelated revision conflicts do not contaminate the selected screen but remain visible as provenance', () => {
  const related = { ...traversal, revision: 'rev-a', graphRevision: 'graph-a' };
  const unrelated = { ...traversal, revision: 'rev-b', graphRevision: 'graph-b',
    roots: [{ id: 'Other', symbol: { usr: 'Other' } }], reached: [] };
  const report = createNavigationTrace(navigation, [client, server], [related, unrelated]);
  assert.ok(!report.gaps.some((gap) => gap.code.includes('revision')));
  assert.deepEqual(report.analyses.map((analysis) => analysis.revision).sort(), ['rev-a', 'rev-b']);
});

test('a complete selected-screen witness is preferred to an equal-grade witness from another root', () => {
  const own = parseLanguageTraversal({ ...traversal, revision: 'rev-a' });
  const other = parseLanguageTraversal({ ...traversal, revision: 'rev-a',
    roots: [{ id: 'Other', symbol: { usr: 'Other' } }, ...traversal.roots],
    reached: [{ ...traversal.reached[0]!, via: 'Other', roots: [0, 1] }] });
  for (const analyses of [[other, own], [own, other]]) {
    const call = createNavigationTrace(navigation, [client, server], analyses).chains[0]!.calls[0]!;
    assert.deepEqual(call.path, ['src/screen.ts#Catalog', 'src/api.ts#read']);
    assert.equal(call.witnessRoot, undefined);
    assert.equal(call.witnesses.length, 2);
  }
});

test('a stronger representative never discards unknown alternate observations', () => {
  const { dispatch: _, ...unknown } = traversal;
  const report = createNavigationTrace(navigation, [client, server], [traversal, unknown]);
  assert.equal(report.chains[0]!.calls[0]!.evidence, 'direct');
  assert.deepEqual(report.chains[0]!.calls[0]!.witnesses.map(({ evidence }) => evidence).sort(), ['direct', 'unknown']);
  for (const witness of report.chains[0]!.calls[0]!.witnesses) {
    assert.ok(report.analyses.some(({ id }) => id === witness.analysis));
  }
  assert.ok(report.gaps.some(({ code }) => code === 'screen-analysis-evidence-unreported'));
});

test('analysis limitations are stored once in the inventory instead of amplified into every call witness', () => {
  const limited = { ...traversal, limitations: [`scope: ${'x'.repeat(128_000)}`] };
  const repeated = parseBridgeFactsDocument({ ...client, facts: Array.from({ length: 100 }, (_, index) =>
    ({ ...client.facts[0], location: { ...location, line: index + 1 } })) });
  const report = createNavigationTrace(navigation, [repeated], [limited]);
  assert.equal(report.chains[0]!.calls.length, 100);
  assert.equal(report.analyses.length, 1);
  const id = report.analyses[0]!.id;
  assert.match(id, /^sha256:[a-f0-9]{64}$/);
  assert.ok(report.chains[0]!.calls.every(({ witnesses }) => witnesses[0]!.analysis === id));
  assert.ok(JSON.stringify(report).length < 500_000);
});

test('repeated long witness paths fail within a bounded output budget instead of constructing oversized output', () => {
  const usr = 'x'.repeat(4096);
  const repeated = parseBridgeFactsDocument({ ...client, facts: Array.from({ length: 1100 }, (_, index) =>
    ({ ...client.facts[0], symbol: { usr, qualifiedName: 'read' }, location: { ...location, line: index + 1 } })) });
  const long = parseLanguageTraversal({ ...traversal,
    reached: [{ ...traversal.reached[0], symbol: { usr } }] });
  assert.throws(() => createNavigationTrace(navigation, [repeated], [long]), /witness output exceeds its text limit/);
});

test('a documented multi-screen reach links every screen instead of spending the budget on rescans', () => {
  // `tsograph reach <screen-usr>...` 모양: 화면 200개를 root로 넣은 분석 하나, 화면마다 닿는 행 25개(합 5,000), 호출 500개.
  // 화면마다 모든 root·행·호출을 다시 세면 200 × (200 + 5,000 + 500)이 예산 1,000,000을 넘어, 실제 연결은 2만 남짓인데도 거부됐다.
  const screens = Array.from({ length: 200 }, (_, index) => `src/screens.ts#S${String(index).padStart(3, '0')}`);
  const reachedRow = (screen: number, index: number) => `${screens[screen]}.r${String(index).padStart(2, '0')}`;
  const reach = parseLanguageTraversal({ ...traversal, revision: 'rev-a', roots: screens.map((usr) => ({ id: usr, symbol: { usr } })),
    reached: screens.flatMap((screen, root) => Array.from({ length: 25 }, (_, index) =>
      ({ symbol: { usr: reachedRow(root, index) }, via: screen, depth: 1, roots: [root] })))
      .sort((left, right) => compareStrings(left.symbol.usr, right.symbol.usr)) });
  const input = parseNavigationFactsDocument({ ...navigation, facts: screens.map((usr, index) => ({ kind: 'screen-route',
    urlTemplate: `/s${index}`, dynamic: false, location: { ...location, line: index + 1 }, screen: { usr } })) });
  const calls = parseBridgeFactsDocument({ ...client, facts: Array.from({ length: 500 }, (_, index) => ({ ...client.facts[0]!,
    location: { ...location, line: index + 1 }, symbol: { usr: reachedRow(index % 200, Math.floor(index / 200)), qualifiedName: 'read' } })) });
  const report = createNavigationTrace(input, [calls, server], [reach]);
  assert.deepEqual(report.gaps, []);
  assert.equal(report.chains.length, 200);
  assert.equal(report.chains.reduce((total, chain) => total + chain.calls.length, 0), 500);
  assert.ok(report.chains.every((chain) => chain.calls.every((call) =>
    call.path.length === 2 && call.path[0] === chain.screen.usr && call.routes.length === 1)));
});

test('link-work counts only the roots, rows, witness path elements and calls that each screen links', () => {
  // 화면 X의 사실 10개 × (root 1 + 행 33,333 + 목격 경로 원소 2 × 33,333) = 정확히 1,000,000이다. 다른 분석의
  // root·행, X가 닿지 않는 호출, 분석이 없는 화면은 연결 작업이 아니므로 세지 않는다.
  const rows = (via: string, count: number) => Array.from({ length: count }, (_, index) =>
    ({ symbol: { usr: `${via}.r${String(index).padStart(5, '0')}` }, via, depth: 1, roots: [0] }));
  const analysis = (root: string, count: number) => parseLanguageTraversal({ ...traversal, revision: 'rev-a',
    roots: [{ id: root, symbol: { usr: root } }], reached: rows(root, count) });
  const facts = (usr: string, count: number) => Array.from({ length: count }, (_, index) => ({ kind: 'screen-route',
    urlTemplate: `/${usr}/${index}`, dynamic: false, location: { ...location, line: index + 1 }, screen: { usr } }));
  const unrelatedCalls = parseBridgeFactsDocument({ ...client, facts: Array.from({ length: 100 }, (_, index) => ({ ...client.facts[0]!,
    location: { ...location, line: index + 1 }, symbol: { usr: `U.r${String(index).padStart(5, '0')}`, qualifiedName: 'read' } })) });
  const analyses = [analysis('X', 33_333), analysis('U', 1_000)];
  const exact = parseNavigationFactsDocument({ ...navigation, facts: [...facts('X', 10), ...facts('W', 100)] });
  assert.equal(createNavigationTrace(exact, [unrelatedCalls, server], analyses).chains.length, 110);
  // root 하나를 더 찾는 화면 사실 하나가 1,000,001번째 작업이라 부분 목록 대신 실패한다.
  const over = parseNavigationFactsDocument({ ...exact, facts: [...exact.facts, ...facts('Y', 1)] });
  assert.throws(() => createNavigationTrace(over, [unrelatedCalls, server], [...analyses, analysis('Y', 0)]),
    (error: unknown) => error instanceof NavigationTraceInputError
      && error.message === 'Navigation linking exceeds its work limit; narrow screen or analysis inputs.');
});
