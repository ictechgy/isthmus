import { compareStrings } from './compare.ts';

/**
 * 결정적 너비 우선 탐색으로 root마다가 아닌 "가장 가까운 root" 기준의 최단 경로 나무를 만든다.
 *
 * kartograph 어댑터(관찰 경로를 대표 via 사슬로 줄인다 — trace가 받는 옛 역방향 형식)와 preflight 보고서(언어 영향과
 * bridge 경계를 이어 영향 정점을 찾는다)가 같은 규칙을 쓴다: root를 정렬해 큐에 넣고, 부모마다 자식을 키 순으로
 * 보며, 처음 닿은 부모가 via가 된다. 그래서 같은 입력이면 via·depth·출력 순서가 항상 같다.
 *
 * @param roots 시작 정점 키다. depth 0이며 정렬해서 큐에 넣는다.
 * @param children 부모에서 나가는 `[자식 키, 간선 값]` 목록이다. 없으면 undefined다. 키 순으로 정렬해 본다.
 * @param visit 아직 depth가 없는 자식을 처음 볼 때 부른다. false를 돌려주면 depth를 매기지 않고 큐에도 넣지 않는다 —
 *   같은 자식을 다른 부모에서 다시 볼 수 있다(예: depth 상한을 넘은 경로를 세기만 할 때).
 * @returns 도달한 정점의 depth다. root가 먼저, 그다음 방문 순서로 들어 있다.
 */
export function breadthFirstShortestPaths<Edge>(
  roots: Iterable<string>,
  children: (parent: string) => Iterable<readonly [string, Edge]> | undefined,
  visit: (child: string, parent: string, depth: number, edge: Edge) => boolean,
): Map<string, number> {
  const queue = [...roots].sort(compareStrings);
  const depths = new Map(queue.map((key) => [key, 0]));
  for (let head = 0; head < queue.length; head++) {
    const parent = queue[head]!;
    for (const [child, edge] of [...(children(parent) ?? [])].sort(([left], [right]) => compareStrings(left, right))) {
      if (depths.has(child)) continue;
      const depth = depths.get(parent)! + 1;
      if (!visit(child, parent, depth, edge)) continue;
      depths.set(child, depth);
      queue.push(child);
    }
  }
  return depths;
}
