/** locale과 ICU 버전에 무관한 UTF-16 코드 단위 문자열 순서를 반환한다. */
export function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
