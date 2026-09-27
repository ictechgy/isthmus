import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  normalizeTraceAnalysis,
  parseTraceContext,
  TraceContextValidationError,
  type TraceAnalysisReference,
} from './trace-context.ts';
import { TraversalValidationError } from './language-traversal.ts';

const fixture = (name: string) => readFile(new URL(`../../fixtures/trace/${name}`, import.meta.url), 'utf8')
  .then((text) => JSON.parse(text));
const context = await fixture('context.json');

test('trace context를 검증하고 선택을 결정적 순서로 정규화한다', () => {
  const parsed = parseTraceContext(context);
  assert.equal(parsed.project, '/work/trace-example');
  assert.equal(parsed.revision, 'rev-1');
  assert.equal(parsed.analyses.length, 4);
  const routes = parseTraceContext({ ...context, revision: undefined, selection: { routes: [
    { method: 'POST', template: '/b' }, { method: 'ANY', template: '/a', scope: 'svc' }, { method: 'GET', template: '/a' },
  ] } });
  assert.equal(routes.revision, undefined);
  assert.deepEqual(routes.selection, { routes: [
    { method: 'GET', template: '/a' }, { method: 'POST', template: '/b' }, { method: 'ANY', template: '/a', scope: 'svc' },
  ] });
  assert.deepEqual(parseTraceContext({ ...context, selection: { relations: ['b', 'a'] } }).selection, { relations: ['a', 'b'] });
  assert.deepEqual(parseTraceContext({ ...context, selection: { symbols: [{ platform: 'kotlin', usr: 'k' }, { platform: 'js', usr: 'j' }] } })
    .selection, { symbols: [{ platform: 'js', usr: 'j' }, { platform: 'kotlin', usr: 'k' }] });
});

test('workspace 매니페스트는 Phase 3 원인과 함께 거부한다', () => {
  assert.throws(() => parseTraceContext({ format: 'isthmus-workspace', version: 1, members: [] }), /Phase 3/);
});

test('잘못된 context·선택을 거부한다', () => {
  const mutations: Array<(value: any) => void> = [
    (value) => { value.version = 2; },
    (value) => { value.members = []; },
    (value) => { value.project = ''; },
    (value) => { value.revision = 3; },
    (value) => { value.documents = []; },
    (value) => { value.documents = ['a.json', 'a.json']; },
    (value) => { value.analyses = {}; },
    (value) => { value.analyses[0].extra = 1; },
    (value) => { value.analyses[1].id = value.analyses[0].id; },
    (value) => { value.analyses[0].platform = 'openapi'; },
    (value) => { value.analyses[0].role = 'sideways'; },
    (value) => { value.analyses[0].path = ''; },
    (value) => { value.selection = []; },
    (value) => { value.selection = { routes: [{ method: 'GET', template: '/a' }], relations: ['x'] }; },
    (value) => { value.selection = { files: ['a'] }; },
    (value) => { value.selection = { routes: [] }; },
    (value) => { value.selection = { routes: [{ method: 'get', template: '/a' }] }; },
    (value) => { value.selection = { routes: [{ method: 'GET', template: '/a/{id}' }] }; },
    (value) => { value.selection = { routes: [{ method: 'GET', template: 'a' }] }; },
    (value) => { value.selection = { routes: [{ method: 'GET', template: '/a', scope: '' }] }; },
    (value) => { value.selection = { routes: [{ method: 'GET', template: '/a', extra: 1 }] }; },
    (value) => { value.selection = { routes: [{ method: 'GET', template: '/a' }, { method: 'GET', template: '/a' }] }; },
    (value) => { value.selection = { relations: [''] }; },
    (value) => { value.selection = { symbols: [{ platform: 'sql', usr: 'main.users' }] }; },
    (value) => { value.selection = { symbols: [{ platform: 'js' }] }; },
    (value) => { value.selection = { symbols: [{ platform: 'js', usr: 'a', extra: 1 }] }; },
  ];
  for (const mutate of mutations) {
    const value = structuredClone(context);
    mutate(value);
    assert.throws(() => parseTraceContext(value), TraceContextValidationError);
  }
  assert.throws(() => parseTraceContext(null), TraceContextValidationError);
});

const reference = (id: string, platform: TraceAnalysisReference['platform'], role: TraceAnalysisReference['role']) =>
  ({ id, platform, role, path: `${id}.json` });

test('분석 형식을 감지해 정규화하고 context 선언과 대조한다', async () => {
  const forward = await fixture('server-forward.json');
  const db = await fixture('db-dependents.json');
  const project = context.project as string;
  assert.equal(normalizeTraceAnalysis(forward, reference('f', 'js', 'forward'), project).graph.source, 'language-traversal');
  assert.equal(normalizeTraceAnalysis(db, reference('d', 'sql', 'db-dependents'), project).graph.source, 'language-traversal');
  for (const [raw, entry, pattern] of [
    [forward, reference('f', 'js', 'reverse'), /dependents traversal/],
    [forward, reference('f', 'kotlin', 'forward'), /platform differs/],
    [{ ...forward, project: '/other' }, reference('f', 'js', 'forward'), /project differs/],
    [{ ...db, project: '/other' }, reference('d', 'sql', 'db-dependents'), /project differs/],
    [db, reference('d', 'sql', 'reverse'), /db-dependents/],
    [db, reference('d', 'js', 'db-dependents'), /platform differs/],
    [[], reference('x', 'js', 'reverse'), /JSON object/],
    [{ format: 'unknown' }, reference('x', 'js', 'reverse'), /Unsupported analysis format/],
  ] as const) {
    assert.throws(() => normalizeTraceAnalysis(raw, entry, project), pattern);
  }
  assert.throws(() => normalizeTraceAnalysis({ ...forward, version: 2 }, reference('f', 'js', 'forward'), project),
    TraversalValidationError);
});

test('옛 역방향 형식은 preflight 어댑터를 거쳐 reverse 역할로만 받는다', () => {
  const project = '/work/trace-example';
  const kartograph = {
    format: 'kartograph-impact', version: 1, status: 'found', inputs: { current: { revision: 'x', scope: 'fixture' } },
    changed: [{ usr: 'kt:Api.get', qualifiedName: 'Api.get', presentIn: ['current'], location: null }],
    affected: [{ usr: 'kt:Screen', qualifiedName: 'Screen', presentIn: ['current'], location: { path: `${project}/a/Screen.kt`, line: 4 },
      pathStatus: 'complete', pathOmissions: [], paths: [{ revision: 'current', changed: 'kt:Api.get', nodes: ['kt:Screen', 'kt:Api.get'],
        edges: [{ source: 'kt:Screen', target: 'kt:Api.get', kind: 'call', origin: 'bytecode', traversal: 'dependency' }] }] }],
    unresolved: [], limitations: [], truncated: { results: false, depth: false, budget: false },
  };
  const graph = normalizeTraceAnalysis(kartograph, reference('k', 'kotlin', 'reverse'), project).graph;
  assert.equal(graph.source, 'kartograph-impact');
  assert.deepEqual(graph.reached[0]?.symbol.location, { path: 'a/Screen.kt', line: 4 });
  const cartograph = { format: 'change-impact', version: 1, level: 'symbol', changeScope: [{ usr: 's:Api', qualifiedName: 'Api' }],
    affected: [{ symbol: { usr: 's:View', qualifiedName: 'View' }, depth: 1, via: 's:Api', relationship: 'call' }],
    limitations: [], truncated: false };
  assert.equal(normalizeTraceAnalysis(cartograph, reference('c', 'swift', 'reverse'), project).graph.source, 'change-impact');
  const dartograph = { version: 1, changed: { symbols: ['d:Api'], libraries: [] },
    impacted: [{ id: 'd:Screen', depth: 1, path: ['d:Screen', 'd:Api'] }], limitations: [], truncated: 0 };
  assert.equal(normalizeTraceAnalysis(dartograph, reference('d', 'dart', 'reverse'), project).graph.source, 'dartograph-impact');
  assert.throws(() => normalizeTraceAnalysis(kartograph, reference('k', 'kotlin', 'forward'), project), /dependencies traversal/);
  assert.throws(() => normalizeTraceAnalysis(cartograph, reference('c', 'kotlin', 'reverse'), project), /platform differs/);
  assert.throws(() => normalizeTraceAnalysis({ ...kartograph, version: 9 }, reference('k', 'kotlin', 'reverse'), project),
    /Invalid producer impact analysis/);
});
