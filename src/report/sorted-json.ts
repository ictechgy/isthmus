import { compareStrings } from '../compare.ts';

/** JSON 객체 키를 모든 깊이에서 정렬하고 마지막 개행을 붙인다. */
export function encodeSortedJson(value: unknown): string {
  return `${JSON.stringify(sortJson(value), null, 2)}\n`;
}

/** JSON 배열 순서는 보존하고 객체 키만 재귀 정렬한다. */
function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => compareStrings(left, right))
      .map(([key, item]) => [key, sortJson(item)]),
  );
}
