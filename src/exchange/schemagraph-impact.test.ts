import assert from 'node:assert/strict';
import test from 'node:test';

import { adaptSchemagraphImpact } from './schemagraph-impact.ts';
import { TraversalValidationError } from './language-traversal.ts';

/** schemagraph main의 impact JSON과 같은 모양의 합성 문서다(선택 키 포함). */
function legacy(): any {
  return {
    format: 'schemagraph-impact', version: 1,
    subject: { id: 'main.users', kind: 'table', level: 'object', name: 'users', schema: 'main' },
    impacted: [
      { id: 'main.report', kind: 'view', via: 'main.active_users', distance: 2, edges: ['reads'] },
      { id: 'main.active_users', kind: 'view', via: 'main.users', distance: 1, edges: ['reads', 'reads', ''] },
      { id: 'main.orders', kind: 'table', via: 'main.users', distance: 1 },
    ],
    limitations: ['catalog: synthetic'], truncated: false, complete: true, visited: 4, examinedEdges: 5,
    truncationReasons: [],
  };
}

test('schemagraph-impact v1을 via 경로가 있는 sql 의존자 순회로 바꾼다', () => {
  const graph = adaptSchemagraphImpact(legacy());
  assert.equal(graph.source, 'schemagraph-impact');
  assert.equal(graph.direction, 'dependents');
  assert.deepEqual(graph.roots, [{ id: 'main.users', symbol: { usr: 'main.users', kind: 'table' } }]);
  assert.deepEqual(graph.reached.map(({ symbol, depth, via, relationships }) => [symbol.usr, depth, via, relationships]), [
    ['main.active_users', 1, 'main.users', ['reads']],
    ['main.orders', 1, 'main.users', undefined],
    ['main.report', 2, 'main.active_users', ['reads']],
  ]);
  assert.deepEqual(graph.limitations, ['catalog: synthetic']);
  const truncated = adaptSchemagraphImpact({ ...legacy(), truncated: true, truncationReasons: ['max', 'depth', 'max'],
    subject: { id: 'main.users' } });
  assert.deepEqual(truncated.truncationReasons, ['depth', 'max']);
  assert.equal(truncated.roots[0]?.symbol?.kind, undefined);
  const withoutReasons = { ...legacy() };
  delete withoutReasons.truncationReasons;
  assert.deepEqual(adaptSchemagraphImpact(withoutReasons).truncationReasons, []);
});

test('새 language-traversal 형식은 sql dependents만 받는다', () => {
  const traversal = {
    format: 'language-traversal', version: 1, tool: { name: 'schemagraph', version: '0.7.0' },
    generatedAt: '2026-09-27T00:00:00Z', platform: 'sql', project: '/work/p', direction: 'dependents',
    roots: [{ id: 'main.users' }], reached: [{ symbol: { usr: 'main.v' }, via: 'main.users', depth: 1, roots: [0] }],
    truncated: false, limitations: [],
  };
  assert.equal(adaptSchemagraphImpact(traversal).source, 'language-traversal');
  assert.throws(() => adaptSchemagraphImpact({ ...traversal, platform: 'js' }), /sql dependents/);
  assert.throws(() => adaptSchemagraphImpact({ ...traversal, direction: 'dependencies' }), /sql dependents/);
});

test('via 없는 옛 보고서·깨진 그래프·타입 오류를 거부한다', () => {
  const mutations: Array<(value: any) => void> = [
    (value) => { value.format = 'schemagraph-query'; },
    (value) => { value.version = 2; },
    (value) => { value.subject = null; },
    (value) => { value.subject.id = ''; },
    (value) => { value.impacted = {}; },
    (value) => { value.impacted[0] = 'x'; },
    (value) => { value.impacted[0].id = 3; },
    (value) => { delete value.impacted[0].via; },
    (value) => { value.impacted[0].distance = 0; },
    (value) => { value.impacted[0].edges = [1]; },
    (value) => { value.impacted[0].edges = Array.from({ length: 33 }, (_, index) => `e${index}`); },
    (value) => { value.impacted[0].via = 'main.unknown'; },
    (value) => { value.impacted[0].distance = 3; },
    (value) => { value.truncated = 'no'; },
    (value) => { value.truncationReasons = 'depth'; },
    (value) => { value.limitations = null; },
  ];
  for (const mutate of mutations) {
    const value = legacy();
    mutate(value);
    assert.throws(() => adaptSchemagraphImpact(value), TraversalValidationError);
  }
  assert.throws(() => adaptSchemagraphImpact('nope'), TraversalValidationError);
  // subject 자신으로 돌아오는 순환은 root 자신만의 도달이라 싣지 않는다.
  const cycle = legacy();
  cycle.impacted.push({ id: 'main.users', kind: 'table', via: 'main.report', distance: 3 });
  assert.ok(adaptSchemagraphImpact(cycle).reached.every(({ symbol }) => symbol.usr !== 'main.users'));
});
