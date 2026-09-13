import { isProjectRelativePath, isSafeNonEmptyString } from './parse.ts';
import { compareStrings } from '../compare.ts';

/** 변경 대상의 프로젝트 상대 파일과 정확한 심볼 이름/USR이다. 두 목록은 합집합이다. */
export interface ImpactSelection {
  readonly files: readonly string[];
  readonly symbols: readonly string[];
}

/** 변경 목록이 큰 입력을 통한 선택 집합 증폭을 일으키지 않도록 제한한다. */
export const MAX_IMPACT_SELECTORS = 10_000;

/** 변경 선택 계약 실패를 소스 값이 없는 메시지로 구분한다. */
export class ImpactSelectionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImpactSelectionValidationError';
  }
}

/** 외부 변경 목록을 검증하고 위치·심볼 문자열을 손대지 않은 채 중복 제거한다. */
export function parseImpactSelection(input: unknown): ImpactSelection {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new ImpactSelectionValidationError('Changes must be a JSON object.');
  }
  const value = input as Record<string, unknown>;
  if (value.format !== 'isthmus-changes' || value.version !== 1) {
    throw new ImpactSelectionValidationError('Expected isthmus-changes version 1.');
  }
  const files = value.files === undefined ? [] : value.files;
  const symbols = value.symbols === undefined ? [] : value.symbols;
  if (!Array.isArray(files) || !Array.isArray(symbols) ||
    files.length + symbols.length === 0 || files.length + symbols.length > MAX_IMPACT_SELECTORS) {
    throw new ImpactSelectionValidationError('Changes require 1 to 10000 file or symbol selectors.');
  }
  if (!files.every(isProjectRelativePath) || !symbols.every(isSafeNonEmptyString)) {
    throw new ImpactSelectionValidationError('Changes require relative file paths and non-empty safe symbol names.');
  }
  return {
    files: [...new Set(files as string[])].sort(compareStrings),
    symbols: [...new Set(symbols as string[])].sort(compareStrings),
  };
}
