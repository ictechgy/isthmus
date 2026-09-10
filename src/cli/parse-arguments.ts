/** 플래그와 위치 인수로 나뉜 명령 인수다. */
export interface ParsedCommandArguments {
  /** 값 플래그 이름과 그 값이다. 같은 플래그를 두 번 주면 사용법 오류다. */
  readonly valueFlags: ReadonlyMap<string, string>;
  /** 값 없는 플래그 이름들이다. 반복은 한 번과 같다. */
  readonly booleanFlags: ReadonlySet<string>;
  /** 플래그가 아닌 인수다. `--` 뒤는 `-`로 시작해도 모두 여기에 담긴다. */
  readonly positionals: readonly string[];
}

/**
 * 모든 분석 하위 명령이 같은 규칙으로 인수를 읽게 하는 공유 파서다.
 *
 * 플래그는 위치 인수 앞뒤 어디에 와도 된다. 값 플래그의 값은 비어 있지 않고
 * `-`로 시작하지 않아야 한다. `--` 이후는 모두 위치 인수로 읽어 `-`로
 * 시작하는 경로·이름도 전달할 수 있다. 모르는 플래그, 중복 값 플래그, 빈
 * 플래그 값은 사용법 오류다(undefined).
 */
export function parseCommandArguments(
  arguments_: readonly string[],
  valueFlagNames: readonly string[],
  booleanFlagNames: readonly string[],
): ParsedCommandArguments | undefined {
  const valueFlags = new Set(valueFlagNames);
  const booleanFlags = new Set(booleanFlagNames);
  const values = new Map<string, string>();
  const booleans = new Set<string>();
  const positionals: string[] = [];
  let onlyPositionals = false;
  for (let index = 0; index < arguments_.length; index++) {
    const argument = arguments_[index];
    if (argument === undefined) return undefined;
    if (onlyPositionals || !argument.startsWith('-')) {
      positionals.push(argument);
      continue;
    }
    if (argument === '--') {
      onlyPositionals = true;
      continue;
    }
    if (valueFlags.has(argument)) {
      if (values.has(argument)) return undefined;
      const value = arguments_[index + 1];
      // 빈 값은 경로가 아니라 호출 오류다. 읽기 실패(코드 2)보다 사용법(64)이 맞다.
      if (value === undefined || value.length === 0 || value.startsWith('-')) {
        return undefined;
      }
      values.set(argument, value);
      index++;
      continue;
    }
    if (booleanFlags.has(argument)) {
      booleans.add(argument);
      continue;
    }
    return undefined;
  }
  return { valueFlags: values, booleanFlags: booleans, positionals };
}
