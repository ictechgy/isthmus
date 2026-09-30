import assert from 'node:assert/strict';
import test from 'node:test';

import { breadthFirstShortestPaths } from './breadth-first.ts';

test('정렬한 root와 키 순 자식으로 가장 가까운 부모를 via로 정한다', () => {
  // b는 root a·c 모두의 자식이다. 정렬 순서상 a가 먼저 큐에서 나오므로 via는 a다.
  const edges = new Map<string, Map<string, string>>([
    ['c', new Map([['b', 'c->b']])],
    ['a', new Map([['d', 'a->d'], ['b', 'a->b']])],
    ['b', new Map([['e', 'b->e'], ['d', 'b->d']])],
  ]);
  const visits: string[] = [];
  const depths = breadthFirstShortestPaths(['c', 'a', 'a'], (parent) => edges.get(parent), (child, parent, depth, edge) => {
    visits.push(`${child}<-${parent}@${depth}:${edge}`);
    return true;
  });
  assert.deepEqual(visits, ['b<-a@1:a->b', 'd<-a@1:a->d', 'e<-b@2:b->e']);
  assert.deepEqual([...depths], [['a', 0], ['c', 0], ['b', 1], ['d', 1], ['e', 2]]);
});

test('visit가 거절한 자식은 depth 없이 남아 다른 부모에서 다시 보인다', () => {
  const edges = new Map([['r', [['x', 1], ['y', 1]] as const], ['y', [['x', 2]] as const]]);
  const seen: string[] = [];
  const depths = breadthFirstShortestPaths(['r'], (parent) => edges.get(parent), (child, parent, depth) => {
    seen.push(`${child}<-${parent}@${depth}`);
    return !(child === 'x' && depth === 1);
  });
  assert.deepEqual(seen, ['x<-r@1', 'y<-r@1', 'x<-y@2']);
  assert.equal(depths.get('x'), 2);
});
