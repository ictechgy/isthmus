import { createHash } from 'node:crypto';

import { HttpSurfaceValidationError, importHttpSurface, type ImportedHttpSurface } from '../exchange/http-surface.ts';
import { isJsonParseFailure, MAX_INPUT_TEXT_LENGTH, MAX_TOTAL_INPUT_TEXT_LENGTH, type ReadTextFile } from './command-support.ts';

/**
 * `isthmus-http-surface` artifact 파일 읽기다. trace·`diff --http`가 공유한다.
 *
 * 파일을 크기 상한 안에서 읽고, 매니페스트가 고정한 sha256이 있으면 읽은 내용의 SHA-256과 대조한 뒤(다르면 다른
 * 릴리스의 artifact이거나 받다가 깨진 것), 내용 digest와 계약을 검증한다. 오류 문구에는 경로 대신 호출자가 준
 * 라벨(시점·순번)만 싣는다.
 */

/** 읽고 검증한 artifact와 그 파일 바이트의 sha256이다. */
export interface LoadedHttpSurface {
  readonly imported: ImportedHttpSurface;
  readonly sha256: string;
}

/** artifact를 읽지 못했거나 고정한 sha256·계약과 맞지 않는다. 경로 없이 라벨만 싣는다. */
export class HttpSurfaceInputError extends Error {
  /** 원인과 해결 방향을 담은 고정 문구만 보존한다. */
  constructor(message: string) {
    super(message);
    this.name = 'HttpSurfaceInputError';
  }
}

/**
 * artifact 하나를 읽는다. `budget.used`에 읽은 텍스트 길이를 더해 명령 전체 입력 상한을 지킨다.
 *
 * sha256은 UTF-8로 읽은 내용을 다시 UTF-8로 부호화해 계산한다. JSON 텍스트는 UTF-8이어야 하므로 올바른 artifact에서는
 * 파일 바이트 해시와 같고, UTF-8이 아닌 바이트가 섞이면 해시가 달라져 항상 거부된다(사전 계산 분석과 같은 규칙).
 */
export async function readHttpSurface(path: string, label: string, pinnedSha256: string | undefined,
  readTextFile: ReadTextFile, budget: { used: number }): Promise<LoadedHttpSurface> {
  let text: string;
  try {
    text = await readTextFile(path);
  } catch {
    throw new HttpSurfaceInputError(`Unable to read ${label}; check that the file exists and is readable.`);
  }
  budget.used += text.length;
  if (text.length > MAX_INPUT_TEXT_LENGTH || budget.used > MAX_TOTAL_INPUT_TEXT_LENGTH) {
    throw new HttpSurfaceInputError(`${capitalize(label)} exceeds the input size limits.`);
  }
  const sha256 = createHash('sha256').update(text, 'utf8').digest('hex');
  if (pinnedSha256 !== undefined && sha256 !== pinnedSha256) {
    throw new HttpSurfaceInputError(`${capitalize(label)} does not match its pinned sha256; download the surface release the `
      + 'manifest names again, or update the pin after reviewing the new release.');
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    if (isJsonParseFailure(error)) throw new HttpSurfaceInputError(`${capitalize(label)} is not valid JSON.`);
    throw error;
  }
  try {
    return { imported: importHttpSurface(value), sha256 };
  } catch (error) {
    if (error instanceof HttpSurfaceValidationError) {
      throw new HttpSurfaceInputError(`${capitalize(label)} violates the isthmus-http-surface contract: ${error.message}`);
    }
    throw error;
  }
}

/** 문장 첫 글자를 대문자로 바꾼다. */
function capitalize(text: string): string {
  return text.length === 0 ? text : `${text[0]!.toUpperCase()}${text.slice(1)}`;
}
