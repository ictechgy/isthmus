import { isJsonObject, isSafeNonEmptyString } from './parse.ts';

/**
 * 영향·순회 입력 파서(preflight context, 옛 역방향 어댑터, `language-traversal`, trace context)가 공유하는
 * JSON 모양 검사 도우미다.
 *
 * 모듈마다 같은 `object`·`array`·`safe` 검사를 복제하던 것을 한 곳에 모은다. 오류 종류와 문구는 호출 모듈이
 * 정한다 — 각 파서는 자기 오류 클래스를 던지는 `fail`을 넘기고, 문구는 호출 지점에서 그대로 준다. 그래서 공유해도
 * 명령별 오류 분류와 출력 문구가 바뀌지 않는다. 검사는 fail-closed이며 입력 원문을 메시지에 넣지 않는다.
 */
export interface JsonGuards {
  /** 배열·null이 아닌 JSON 객체만 통과시킨다. */
  object(input: unknown, message: string): Record<string, unknown>;
  /** 길이가 `maximum` 이하인 배열만 통과시킨다. 복사하지 않고 입력 배열을 그대로 돌려준다. */
  array(input: unknown, maximum: number, message: string): unknown[];
  /** 모든 항목이 문자열(빈 문자열 포함)인 배열의 복사본이다. 한계 문구처럼 자유 텍스트 목록에 쓴다. */
  textStrings(input: unknown, maximum: number, message: string): string[];
  /** 모든 항목이 안전한 비어 있지 않은 문자열인 배열의 복사본이다. id·관계 이름 목록에 쓴다. */
  safeStrings(input: unknown, maximum: number, message: string): string[];
  /** 안전한 비어 있지 않은 문자열이다. */
  safe(input: unknown, message: string): string;
  /** 없으면 undefined, 있으면 안전한 비어 있지 않은 문자열이다. */
  optionalSafe(input: unknown, message: string): string | undefined;
}

/**
 * 오류 생성 방식을 받아 검사 도우미 묶음을 만든다.
 *
 * @param fail 호출 모듈의 오류 클래스를 던지는 함수다. 메시지는 호출 지점의 고정 문구다.
 * @returns 같은 `fail`을 쓰는 검사 도우미다.
 */
export function createJsonGuards(fail: (message: string) => never): JsonGuards {
  const array = (input: unknown, maximum: number, message: string): unknown[] => {
    if (!Array.isArray(input) || input.length > maximum) fail(message);
    return input;
  };
  const safe = (input: unknown, message: string): string => {
    if (!isSafeNonEmptyString(input)) fail(message);
    return input;
  };
  return {
    object(input, message) {
      if (!isJsonObject(input)) fail(message);
      return input;
    },
    array,
    textStrings(input, maximum, message) {
      const values = array(input, maximum, message);
      if (!values.every((item) => typeof item === 'string')) fail(message);
      return [...values] as string[];
    },
    safeStrings(input, maximum, message) {
      const values = array(input, maximum, message);
      if (!values.every(isSafeNonEmptyString)) fail(message);
      return [...values] as string[];
    },
    safe,
    optionalSafe: (input, message) => (input === undefined ? undefined : safe(input, message)),
  };
}
