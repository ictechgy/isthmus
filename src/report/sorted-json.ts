import { compareStrings } from '../compare.ts';

/** JSON 객체 키를 모든 깊이에서 정렬하고 마지막 개행을 붙인다. */
export function encodeSortedJson(value: unknown, compact = false): string {
  return `${JSON.stringify(sortJson(value), null, compact ? undefined : 2)}\n`;
}

/**
 * 정렬 JSON 한 줄을 값의 신원 키로 쓴다. 객체 키 순서가 달라도 같은 값이면 같은 키다.
 *
 * preflight(관계·limitation)와 trace(gap·알림·선언 끝점)가 중복 제거와 결정적 정렬에 같은 신원을 쓴다.
 */
export function canonicalJsonKey(value: unknown): string {
  return encodeSortedJson(value, true);
}

/** 신원 키 순으로 값을 나열한다. 로캘과 무관한 `compareStrings` 순서다. */
export function valuesSortedByKey<T>(entries: ReadonlyMap<string, T>): T[] {
  return [...entries.entries()].sort(([left], [right]) => compareStrings(left, right)).map(([, value]) => value);
}

/**
 * 정렬 JSON 신원이 같은 항목을 하나로 줄이고 신원 순으로 나열한다. 같은 신원이면 뒤의 항목이 남는다.
 *
 * gap·limitation 목록처럼 여러 곳에서 같은 공백을 신고해도 한 번만 싣고, 입력 순서와 무관하게 같은 바이트로
 * 직렬화하려고 쓴다.
 */
export function uniqueByCanonicalJson<T>(items: readonly T[]): T[] {
  return valuesSortedByKey(new Map(items.map((item) => [canonicalJsonKey(item), item])));
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
