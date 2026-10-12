import type { Writable } from 'node:stream';

/** 도구 입력은 경로·옵션뿐이므로 한 메시지에 1 MiB보다 큰 본문을 받지 않는다. */
export const MAX_MCP_FRAME_BYTES = 1024 * 1024;

/** 손상된 입력 원문이나 신뢰할 수 없는 id를 응답에 되싣지 않는다. */
export interface FrameError {
  readonly error: 'too-large' | 'invalid-utf8';
}

/** 정상 JSON 텍스트 또는 JSON 파싱 전에 발견한 프레임 오류다. */
export type StdioFrame = string | FrameError;

/**
 * LF 전까지 최대 한 프레임만 보관한다. 초과 프레임은 다음 LF까지 버린 뒤 한 번만
 * 오류를 내므로 뒤의 정상 요청을 처리할 수 있다. UTF-8은 완성된 프레임에서 검증한다.
 */
export async function* readStdioFrames(
  input: AsyncIterable<Uint8Array>,
  maximumBytes = MAX_MCP_FRAME_BYTES,
): AsyncIterable<StdioFrame> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new RangeError('frame budget must be a positive safe integer');
  }
  const frame = Buffer.allocUnsafe(maximumBytes);
  let size = 0;
  let oversized = false;
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  const finish = (): StdioFrame => {
    if (oversized) return { error: 'too-large' };
    try { return decoder.decode(frame.subarray(0, size)); }
    catch { return { error: 'invalid-utf8' }; }
  };
  for await (const chunk of input) {
    const bytes = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    let start = 0;
    while (start < bytes.length) {
      const newline = bytes.indexOf(0x0a, start);
      const end = newline < 0 ? bytes.length : newline;
      const length = end - start;
      if (!oversized) {
        if (length > maximumBytes - size) {
          oversized = true;
          size = 0;
        } else if (length > 0) {
          // 고정 buffer에 복사해 chunk 수·원래 chunk 크기로 메모리가 늘지 않게 한다.
          bytes.copy(frame, size, start, end);
          size += length;
        }
      }
      if (newline < 0) break;
      yield finish();
      size = 0;
      oversized = false;
      start = newline + 1;
    }
  }
  if (oversized || size > 0) yield finish();
}

/** write 완료를 기다려 느린 소비자 앞에 응답이 무제한 쌓이지 않게 한다. */
export async function writeStdioLine(output: Writable, line: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    output.write(`${line}\n`, (error) => error ? reject(error) : resolve());
  });
}
