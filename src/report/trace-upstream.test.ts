import assert from 'node:assert/strict';
import test from 'node:test';

import { parseBridgeFactsDocument } from '../exchange/parse.ts';
import { analysisProject, normalizeTraceAnalysis, parseTraceContext } from '../exchange/trace-context.ts';
import { createTraceReport, MAX_TRACE_UPSTREAM_ROWS, TraceInputError, type TraceReport, type TraceUpstreamRoute } from './trace.ts';
import { limitTraceReport } from './trace-view.ts';
import { encodeSortedJson } from './sorted-json.ts';

/**
 * upstream route 전이 추적(`upstreamDepth`)을 합성 4서비스 workspace로 검증한다.
 *
 * 서비스 d가 `GET /d/items/{}`를 선언하고, c가 그것을 부르며 자기 `GET /c/items/{}`를 가진다. b는 c를, a는 b를 부르고 각자
 * route를 가진다. c는 a의 `GET /a/page`도 부른다(`notify`) — a를 따라가면 c의 route로 돌아오는 순환이다. 모든 호출·선언은
 * go 문서이고, 각 서비스의 역방향 분석이 호출을 감싼 함수에서 자기 route 핸들러로 닿는다.
 */

const header = { format: 'bridge-facts', version: 1, tool: { name: 'synthetic-upstream', version: '0.0.0' },
  generatedAt: '2026-09-30T00:00:00Z', platform: 'go', target: 'http', limitations: [], sourceSets: { tests: 'excluded' } };

/** route 사실이다. */
function route(kind: 'route-decl' | 'route-call', method: string, channel: string, usr: string, extra: Record<string, unknown> = {}) {
  return { kind, method, channel, dynamic: false, pathAnchor: 'root', location: { path: `${usr.split(':')[1]}.go`, line: 1, column: 1 },
    symbol: { qualifiedName: usr, usr }, ...extra };
}

/** 서비스 하나의 http 문서다. 호출이 있으면 server·client roles를 겸한다. */
function service(name: string, decls: unknown[], calls: unknown[]) {
  return { ...header, project: `/work/${name}`, roles: calls.length === 0 ? ['server'] : ['server', 'client'],
    dispatch: 'specificity', facts: [...decls, ...calls] };
}

/** 역방향 분석이다. root마다 닿은 심볼(depth 1)을 준다. 여러 root가 닿은 심볼은 한 행에 root를 모은다. */
function reverse(name: string, edges: Record<string, string[]>, extraReached = 0) {
  const roots = Object.keys(edges);
  const byUsr = new Map<string, { via: string; roots: number[] }>();
  const add = (usr: string, index: number) => {
    const entry = byUsr.get(usr) ?? { via: roots[index]!, roots: [] };
    entry.roots.push(index);
    byUsr.set(usr, entry);
  };
  roots.forEach((root, index) => edges[root]!.forEach((usr) => add(usr, index)));
  // 행 상한 검사용으로 닿은 심볼을 더 싣는다(첫 root에서 닿음).
  for (let index = 0; index < extraReached; index++) add(`${roots[0]}.helper${String(index).padStart(5, '0')}`, 0);
  const reached = [...byUsr.entries()].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([usr, { via, roots: rooted }]) => ({ symbol: { usr, qualifiedName: usr }, via, depth: 1, roots: rooted, relationships: ['call'] }));
  return { format: 'language-traversal', version: 1, tool: { name: 'synthetic-upstream', version: '0.0.0' },
    generatedAt: '2026-09-30T00:00:00Z', platform: 'go', project: `/work/${name}`, revision: `${name}-1`, direction: 'dependents',
    truncated: false, limitations: [], roots: roots.map((id) => ({ id, symbol: { usr: id } })), reached };
}

/** 합성 workspace 전체 파일이다. */
function files(extraReached = 0): Record<string, unknown> {
  return {
    'd.http.json': service('d', [route('route-decl', 'GET', '/d/items/{}', 'go:d.Items')], []),
    'c.http.json': service('c', [route('route-decl', 'GET', '/c/items/{}', 'go:c.ItemHandler')], [
      route('route-call', 'GET', '/d/items/{}', 'go:c.fetchItem', { authority: 'd.example.test' }),
      route('route-call', 'POST', '/a/page', 'go:c.notify', { authority: 'a.example.test' }),
    ]),
    'b.http.json': service('b', [route('route-decl', 'GET', '/b/view/{}', 'go:b.View')], [
      route('route-call', 'GET', '/c/items/{}', 'go:b.fetch', { authority: 'c.example.test' }),
    ]),
    'a.http.json': service('a', [route('route-decl', 'POST', '/a/page', 'go:a.Page')], [
      route('route-call', 'GET', '/b/view/{}', 'go:a.fetch', { authority: 'b.example.test' }),
    ]),
    'c.reverse.json': reverse('c', { 'go:c.fetchItem': ['go:c.ItemHandler'], 'go:c.notify': ['go:c.ItemHandler'] }),
    'b.reverse.json': reverse('b', { 'go:b.fetch': ['go:b.View'] }, extraReached),
    'a.reverse.json': reverse('a', { 'go:a.fetch': ['go:a.Page'] }),
  };
}

/** 합성 workspace context다. */
function context(extra: Record<string, unknown> = {}) {
  const member = (name: string, analyses: boolean) => ({ name, project: `/work/${name}`, revision: `${name}-1`,
    documents: [`${name}.http.json`],
    ...(analyses ? { analyses: [{ id: `${name}-reverse`, platform: 'go', role: 'reverse', path: `${name}.reverse.json` }] } : {}) });
  const link = (client: string, server: string) => ({ name: `${client}->${server}`, client, server,
    match: { hosts: [`${server}.example.test`] } });
  return {
    format: 'isthmus-trace-context', version: 1,
    members: [member('d', false), member('c', true), member('b', true), member('a', true)],
    links: [link('c', 'd'), link('b', 'c'), link('a', 'b'), link('c', 'a')],
    selection: { routes: [{ method: 'GET', template: '/d/items/{}' }] },
    ...extra,
  };
}

/** trace를 만든다. `upstreamDepth`는 CLI 값(TraceInput)이다. */
function trace(options: { depth?: number; contextDepth?: number; extraReached?: number } = {}): TraceReport {
  const parsed = parseTraceContext(context(options.contextDepth === undefined ? {} : { upstreamDepth: options.contextDepth }));
  const all = files(options.extraReached);
  return createTraceReport({
    context: parsed,
    documents: parsed.documents.map((path) => parseBridgeFactsDocument(all[path])),
    analyses: parsed.analyses.map((reference) => normalizeTraceAnalysis(all[reference.path], reference, analysisProject(parsed, reference))),
    ...(options.depth === undefined ? {} : { upstreamDepth: options.depth }),
  });
}

/** upstream 트리를 `member route [scope: caller → …]` 문자열로 펼친다. */
function tree(routes: readonly TraceUpstreamRoute[] | undefined, indent = ''): string[] {
  return (routes ?? []).flatMap((upstream) => [
    `${indent}${upstream.member} ${upstream.method} ${upstream.template} scopes=${upstream.scopes.join(',')}`
      + (upstream.callers === undefined ? '' : ' followed'),
    ...(upstream.callers ?? []).flatMap(({ scope, calls }) => [
      `${indent}  <${scope}>`,
      ...calls.flatMap((call) => [`${indent}    ${call.call.member} ${call.call.symbol?.usr}`, ...tree(call.upstreamRoutes, `${indent}      `)]),
    ]),
  ]);
}

/** 선택한 route의 첫 호출 hop이다. */
const firstCall = (report: TraceReport) => report.chains[0]!.routes[0]!.calls[0]!;

/** 특정 코드의 gap·알림을 `route member` 문자열로 모은다. */
const coded = (report: TraceReport, code: string) => [...report.gaps, ...report.notices]
  .filter((gap) => gap.code === code).map((gap) => `${gap.route?.scope} ${gap.route?.method} ${gap.route?.template} ${gap.member}`);

test('기본 깊이 1은 v1처럼 한 단계만 싣고 upstreamDepth 1을 명시해도 출력 바이트가 같다', () => {
  const report = trace();
  assert.equal(report.upstreamDepth, undefined);
  assert.deepEqual(tree(firstCall(report).upstreamRoutes), ['c GET /c/items/{} scopes=b->c']);
  assert.deepEqual(coded(report, 'upstream-route-callers-not-followed'), ['b->c GET /c/items/{} c']);
  assert.match(report.gaps.find(({ code }) => code === 'upstream-route-callers-not-followed')!.detail, /trace follows one upstream hop/);
  assert.equal(encodeSortedJson(trace({ depth: 1 })), encodeSortedJson(report));
  assert.equal(encodeSortedJson(trace({ contextDepth: 1 })), encodeSortedJson(report));
  assert.deepEqual(report.notices, []);
});

test('깊이 2는 upstream route의 호출자를 link로 따라가고 다음 단계에서 멈춘 곳을 밝힌다', () => {
  const report = trace({ depth: 2 });
  assert.equal(report.upstreamDepth, 2);
  assert.deepEqual(tree(firstCall(report).upstreamRoutes), [
    'c GET /c/items/{} scopes=b->c followed',
    '  <b->c>',
    '    b go:b.fetch',
    '      b GET /b/view/{} scopes=a->b',
  ]);
  assert.deepEqual(coded(report, 'upstream-route-callers-not-followed'), ['a->b GET /b/view/{} b']);
  assert.match(report.gaps.find(({ code }) => code === 'upstream-route-callers-not-followed')!.detail,
    /reached 2 upstream hop\(s\) above the traced route; trace follows 2 upstream hops \(upstreamDepth\)/);
  // 따라간 호출 hop도 요약에 든다: 호출 hop 2개(c.fetchItem, b.fetch), 클라이언트 영향 2개, upstream route 2개.
  assert.deepEqual([report.summary.calls, report.summary.clientSymbols, report.summary.upstreamRoutes], [2, 2, 2]);
  // context 값도 같은 효과이고 CLI 값이 우선한다.
  assert.equal(encodeSortedJson(trace({ contextDepth: 2 })), encodeSortedJson(report));
  assert.equal(encodeSortedJson(trace({ contextDepth: 5, depth: 2 })), encodeSortedJson(report));
});

test('순환(c → a → c)은 이미 체인에 있는 route에서 멈추고 upstream-route-cycle 알림만 남긴다', () => {
  const report = trace({ depth: 8 });
  assert.deepEqual(tree(firstCall(report).upstreamRoutes), [
    'c GET /c/items/{} scopes=b->c followed',
    '  <b->c>',
    '    b go:b.fetch',
    '      b GET /b/view/{} scopes=a->b followed',
    '        <a->b>',
    '          a go:a.fetch',
    '            a POST /a/page scopes=c->a followed',
    '              <c->a>',
    '                c go:c.notify',
    '                  c GET /c/items/{} scopes=b->c',
  ]);
  assert.deepEqual(coded(report, 'upstream-route-cycle'), ['b->c GET /c/items/{} c']);
  assert.ok(report.notices.some(({ code }) => code === 'upstream-route-cycle'));
  assert.ok(!report.gaps.some(({ code }) => code === 'upstream-route-cycle'));
  // 깊이 안에서 모두 따라갔으므로 멈춤 gap이 없다.
  assert.deepEqual(coded(report, 'upstream-route-callers-not-followed'), []);
  // 깊이 3이면 a의 route에서 멈춘다.
  assert.deepEqual(coded(trace({ depth: 3 }), 'upstream-route-callers-not-followed'), ['c->a POST /a/page a']);
});

test('선택한 route로 돌아오는 순환은 조상으로 본다(재귀 호출)', () => {
  // c의 route를 직접 선택하면 c.notify → a → c 순환이 선택한 route 자체에서 끊겨야 한다.
  const parsed = parseTraceContext(context({ selection: { routes: [{ method: 'GET', template: '/c/items/{}' }] }, upstreamDepth: 8 }));
  const all = files();
  const report = createTraceReport({
    context: parsed,
    documents: parsed.documents.map((path) => parseBridgeFactsDocument(all[path])),
    analyses: parsed.analyses.map((reference) => normalizeTraceAnalysis(all[reference.path], reference, analysisProject(parsed, reference))),
  });
  assert.deepEqual(tree(firstCall(report).upstreamRoutes), [
    'b GET /b/view/{} scopes=a->b followed',
    '  <a->b>',
    '    a go:a.fetch',
    '      a POST /a/page scopes=c->a followed',
    '        <c->a>',
    '          c go:c.notify',
    '            c GET /c/items/{} scopes=b->c',
  ]);
  assert.deepEqual(coded(report, 'upstream-route-cycle'), ['b->c GET /c/items/{} c']);
});

test('행 상한을 다 쓰면 남은 upstream route는 upstream-route-callers-not-followed로 멈춘다', () => {
  const report = trace({ depth: 8, extraReached: MAX_TRACE_UPSTREAM_ROWS });
  assert.deepEqual(tree(firstCall(report).upstreamRoutes), [
    'c GET /c/items/{} scopes=b->c followed',
    '  <b->c>',
    '    b go:b.fetch',
    '      b GET /b/view/{} scopes=a->b',
  ]);
  const stopped = report.gaps.filter(({ code }) => code === 'upstream-route-callers-not-followed');
  assert.deepEqual(stopped.map(({ route: key }) => key?.template), ['/b/view/{}']);
  assert.match(stopped[0]!.detail, /row cap \(10000 per chain\) was reached/);
});

test('같은 입력은 바이트 단위로 같고, 출력 상한은 따라간 호출 hop 목록도 자른다', () => {
  assert.equal(encodeSortedJson(trace({ depth: 8 })), encodeSortedJson(trace({ depth: 8 })));
  // b의 역방향 분석이 b.fetch에서 두 심볼(b.View와 도우미 하나)에 닿게 해 따라간 호출 hop의 affected가 잘리게 한다.
  const limited = limitTraceReport(trace({ depth: 8, extraReached: 1 }), { maxChains: 10, maxRows: 1 });
  const nested = firstCall(limited).upstreamRoutes![0]!.callers![0]!.calls[0]!;
  assert.equal(nested.affected.length, 1);
  assert.deepEqual(limited.truncation.omitted.filter(({ path }) => path.includes('callers')), [{
    path: 'chains[0].routes[0].calls[0].upstreamRoutes[0].callers[0].calls[0].affected', total: 2, shown: 1,
  }]);
});

test('upstreamDepth는 1..8 정수만 받는다', () => {
  assert.throws(() => parseTraceContext(context({ upstreamDepth: 0 })), /upstreamDepth must be an integer from 1 to 8/);
  assert.throws(() => parseTraceContext(context({ upstreamDepth: 9 })), /upstreamDepth/);
  assert.throws(() => parseTraceContext(context({ upstreamDepth: 1.5 })), /upstreamDepth/);
  assert.throws(() => trace({ depth: 9 }), TraceInputError);
});
