import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseLanguageTraversal,
  traversalGraphFromDocument,
  traversalGraphFromImpact,
  traversalPath,
  TraversalValidationError,
  validateTraversalGraph,
} from './language-traversal.ts';
import type { LanguageImpact } from './preflight-context.ts';

/** 두 root가 한 정점을 공유하는 합성 정방향 순회다. */
function document(): any {
  return {
    format: 'language-traversal', version: 1, tool: { name: 'synthetic', version: '0.0.0' },
    generatedAt: '2026-09-27T00:00:00Z', platform: 'js', project: '/work/p', revision: 'r1', graphRevision: 'g1',
    direction: 'dependencies',
    roots: [{ id: 'a', symbol: { usr: 'a', qualifiedName: 'A' } }, { id: 'file:src/b.ts' }],
    reached: [
      { symbol: { usr: 'c', location: { path: 'src/c.ts', line: 3, column: 1 } }, via: 'a', depth: 1, roots: [0, 1],
        relationships: ['call', 'reference'] },
      { symbol: { usr: 'd', kind: 'method', location: { path: 'src/d.kt' } }, via: 'c', depth: 2, roots: [0, 1] },
    ],
    truncated: false, limitations: ['partial: synthetic'],
  };
}

test('language-traversal v1을 검증하고 root 출처·대표 경로를 보존한다', () => {
  const parsed = parseLanguageTraversal(document());
  assert.equal(parsed.direction, 'dependencies');
  assert.deepEqual(parsed.reached[1]?.roots, [0, 1]);
  assert.deepEqual(parsed.reached[1]?.symbol.location, { path: 'src/d.kt' });
  const graph = traversalGraphFromDocument(parsed);
  assert.equal(graph.rootProvenance, 'complete');
  assert.equal(graph.revision, 'r1');
  assert.equal(graph.graphRevision, 'g1');
  assert.deepEqual(traversalPath(graph, 'd'), ['a', 'c', 'd']);
  assert.deepEqual(traversalPath(graph, 'a'), ['a']);
  // root 순서는 생산자의 입력 순서다(인덱스 의미). 정렬을 강요하지 않는다.
  const reordered = document();
  reordered.roots.reverse();
  reordered.reached.forEach((row: any) => { row.roots = [0, 1]; });
  assert.equal(parseLanguageTraversal(reordered).roots[0]?.id, 'file:src/b.ts');
  const minimal = { ...document(), revision: undefined, graphRevision: undefined, truncated: true,
    truncationReasons: ['depth'], rootsTruncated: true };
  const truncated = traversalGraphFromDocument(parseLanguageTraversal(JSON.parse(JSON.stringify(minimal))));
  assert.equal(truncated.rootsTruncated, true);
  assert.deepEqual(truncated.truncationReasons, ['depth']);
  assert.equal(truncated.revision, undefined);
});

/** root B가 root A의 의존자이고, C는 B를 거쳐 두 root 모두에서 닿는 순회다. */
function rootToRoot(): any {
  return {
    ...document(), direction: 'dependents',
    roots: [{ id: 'A', symbol: { usr: 'A' } }, { id: 'B', symbol: { usr: 'B' } }],
    reached: [
      { symbol: { usr: 'B' }, via: 'A', depth: 1, roots: [0] },
      { symbol: { usr: 'C' }, via: 'B', depth: 1, roots: [0, 1] },
      { symbol: { usr: 'D' }, via: 'C', depth: 2, roots: [0, 1] },
    ],
  };
}

test('다른 root에서 닿은 root도 reached에 싣고 자기 인덱스는 roots에 넣지 않는다', () => {
  const graph = traversalGraphFromDocument(parseLanguageTraversal(rootToRoot()));
  assert.deepEqual(graph.reached.map(({ symbol, roots }) => [symbol.usr, roots]), [['B', [0]], ['C', [0, 1]], ['D', [0, 1]]]);
  // 경로는 via가 root id인 곳에서 멈춘다. B가 A에서 닿았어도 C의 목격 경로는 B에서 시작한다.
  assert.deepEqual(traversalPath(graph, 'B'), ['A', 'B']);
  assert.deepEqual(traversalPath(graph, 'D'), ['B', 'C', 'D']);
  const cycle = rootToRoot();
  cycle.reached = [{ symbol: { usr: 'A' }, via: 'B', depth: 1, roots: [1] }, { symbol: { usr: 'B' }, via: 'A', depth: 1, roots: [0] }];
  assert.deepEqual(traversalPath(traversalGraphFromDocument(parseLanguageTraversal(cycle)), 'A'), ['B', 'A']);
  for (const mutate of [
    (value: any) => { value.reached[0].roots = [0, 1]; },
    (value: any) => { value.reached[1].roots = [1]; },
    (value: any) => { value.reached[1].via = 'C'; },
    (value: any) => { value.reached[2].roots = [1]; },
  ]) {
    const value = rootToRoot();
    mutate(value);
    assert.throws(() => parseLanguageTraversal(value), TraversalValidationError);
  }
  // 64개 상한으로 잘린 목록에서는 via root의 큰 인덱스가 빠질 수 있다.
  const roots = Array.from({ length: 66 }, (_, index) => ({ id: `r${String(index).padStart(2, '0')}` }));
  assert.doesNotThrow(() => validateTraversalGraph(roots, [{ symbol: { usr: 'x' }, via: 'r65', depth: 1,
    roots: Array.from({ length: 64 }, (_, index) => index) }], { rootsTruncated: true, truncated: false }));
});

test('잘린 순회는 부모 root 포함 규칙을 강제하지 않지만 그 밖의 불변식은 그대로 본다', () => {
  const value = document();
  value.truncated = true;
  value.reached[1].roots = [1];
  assert.doesNotThrow(() => parseLanguageTraversal(value));
  value.truncated = false;
  assert.throws(() => parseLanguageTraversal(value), /parent/);
  value.rootsTruncated = true;
  assert.doesNotThrow(() => parseLanguageTraversal(value));
});

test('계약 위반을 조용히 고치지 않고 거부한다', () => {
  const mutations: Array<(value: any) => void> = [
    (value) => { value.version = 2; },
    (value) => { value.extra = true; },
    (value) => { value.tool = { name: 'x' }; },
    (value) => { value.tool.extra = 1; },
    (value) => { value.generatedAt = 'yesterday'; },
    (value) => { value.platform = 'openapi'; },
    (value) => { value.project = ''; },
    (value) => { value.revision = ''; },
    (value) => { value.direction = 'both'; },
    (value) => { value.rootsTruncated = 'yes'; },
    (value) => { value.truncated = 'no'; },
    (value) => { value.truncationReasons = ['depth']; },
    (value) => { value.truncated = true; value.truncationReasons = ['z', 'a']; },
    (value) => { value.limitations = [1]; },
    (value) => { value.roots = {}; },
    (value) => { value.roots[0].extra = 1; },
    (value) => { value.roots[0].symbol.usr = 'other'; },
    (value) => { value.roots[1].id = 'a'; },
    (value) => { value.reached = [value.reached[1], value.reached[0]]; },
    (value) => { value.reached[0].extra = 1; },
    (value) => { value.reached[0].symbol = { usr: 'c', extra: 1 }; },
    (value) => { value.reached[0].symbol = { qualifiedName: 'C' }; },
    (value) => { value.reached[0].symbol.location = { path: '/abs.ts', line: 1 }; },
    (value) => { value.reached[0].symbol.location = { path: 'src/c.ts', column: 1 }; },
    (value) => { value.reached[0].symbol.location = { path: 'src/c.ts', line: 0 }; },
    (value) => { value.reached[0].symbol.location = { path: 'src/c.ts', extra: 1 }; },
    (value) => { value.reached[0].depth = 0; },
    (value) => { value.reached[1].depth = 129; },
    (value) => { value.reached[1].depth = 3; },
    (value) => { value.reached[0].via = 'missing'; },
    (value) => { value.reached[0].via = ''; },
    (value) => { value.reached[0].roots = []; },
    (value) => { value.reached[0].roots = [1, 0]; },
    (value) => { value.reached[0].roots = [0, 0]; },
    (value) => { value.reached[0].roots = [0, 2]; },
    (value) => { value.reached[0].roots = [0.5]; },
    (value) => { value.reached[0].roots = [1]; },
    (value) => { value.reached[0].relationships = ['reference', 'call']; },
    (value) => { value.reached[0].relationships = ['']; },
    (value) => { value.reached[1].symbol.usr = 'a'; },
    (value) => { value.reached[1].symbol.usr = 'c'; value.reached[1].via = 'a'; value.reached[1].depth = 1; },
  ];
  for (const mutate of mutations) {
    const value = document();
    mutate(value);
    assert.throws(() => parseLanguageTraversal(value), TraversalValidationError, JSON.stringify(value).slice(0, 80));
  }
  assert.throws(() => parseLanguageTraversal(null), TraversalValidationError);
  assert.throws(() => parseLanguageTraversal({ ...document(), roots: Array.from({ length: 10_001 }, (_, index) => ({ id: `r${index}` })) }));
  assert.throws(() => validateTraversalGraph([{ id: 'r' }], [{ symbol: { usr: 'x' }, via: 'r', depth: 1,
    roots: Array.from({ length: 65 }, () => 0) }], { rootsTruncated: true, truncated: true }));
});

test('옛 역방향 영향은 대표 root 하나로만 출처를 복원하고 root가 여럿이면 witness로 표시한다', () => {
  const impact: LanguageImpact = {
    id: 'k', platform: 'kotlin', tool: { name: 'kartograph', version: '1' }, requested: { files: [], symbols: [] },
    roots: [{ id: 'z-root', qualifiedName: 'Z' }, { id: 'a-root', qualifiedName: 'A', kind: 'method',
      location: { path: 'a.kt', line: 1 } }],
    affected: [
      { symbol: { id: 'child', qualifiedName: 'Child' }, via: 'grand', depth: 2, relationships: ['call', 'call'] },
      { symbol: { id: 'grand', qualifiedName: 'Grand' }, via: 'z-root', depth: 1, relationships: [] },
    ],
    limitations: ['x'], truncated: false,
  };
  const graph = traversalGraphFromImpact(impact, 'kartograph-impact');
  assert.deepEqual(graph.roots.map(({ id }) => id), ['a-root', 'z-root']);
  assert.equal(graph.rootProvenance, 'witness');
  assert.deepEqual(graph.reached.map(({ symbol, roots }) => [symbol.usr, roots]), [['grand', [1]], ['child', [1]]]);
  assert.deepEqual(graph.reached[1]?.relationships, ['call']);
  assert.equal(graph.reached[0]?.relationships, undefined);
  assert.deepEqual(graph.roots[0]?.symbol, { usr: 'a-root', qualifiedName: 'A', kind: 'method', location: { path: 'a.kt', line: 1 } });
  const single = traversalGraphFromImpact({ ...impact, roots: [impact.roots[0]!] }, 'change-impact');
  assert.equal(single.rootProvenance, 'complete');
  assert.throws(() => traversalGraphFromImpact({ ...impact, affected: [{ ...impact.affected[0]!, via: 'loop' }] }, 'change-impact'),
    /root/);
});
