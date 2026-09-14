import { isJsonParseFailure, MAX_INPUT_TEXT_LENGTH, MAX_TOTAL_INPUT_TEXT_LENGTH } from './command-support.ts';
import type { ReadTextFile } from './command-support.ts';

/** 기대·실행 JSON의 예산을 공유하며 이미 읽은 정적 context 크기도 포함한다. */
export class RuntimeJsonReader {
  private readonly readTextFile: ReadTextFile;
  private totalLength: number;
  private position = 0;

  constructor(readTextFile: ReadTextFile, initialLength = 0) {
    this.readTextFile = readTextFile;
    this.totalLength = initialLength;
  }

  async read(path: string): Promise<unknown> {
    this.position++;
    let text: string;
    try { text = await this.readTextFile(path); }
    catch { throw new RuntimeInputError(`Unable to read runtime input ${this.position}; check the file exists and is readable.`); }
    this.totalLength += text.length;
    if (text.length > MAX_INPUT_TEXT_LENGTH || this.totalLength > MAX_TOTAL_INPUT_TEXT_LENGTH) {
      throw new RuntimeInputError(`Runtime input ${this.position} exceeds the input size limits.`);
    }
    try { return JSON.parse(text); }
    catch (error) {
      if (isJsonParseFailure(error)) throw new RuntimeInputError(`Runtime input ${this.position} is not valid JSON.`);
      throw error;
    }
  }
}

/** runtime 입력 I/O·JSON 오류를 내부 결함과 구분한다. */
export class RuntimeInputError extends Error {}
