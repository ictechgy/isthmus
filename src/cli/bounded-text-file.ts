import { constants } from 'node:fs';
import { open } from 'node:fs/promises';

/** 읽기 원인을 경로·본문 없이 명령 계층으로 전달한다. */
export class BoundedTextReadError extends Error {
  readonly reason: 'read' | 'limit' | 'encoding';
  constructor(reason: 'read' | 'limit' | 'encoding') { super(`Bounded input ${reason} failure.`); this.name = 'BoundedTextReadError'; this.reason = reason; }
}

/** 일반 UTF-8 파일만 cap+1 바이트까지 읽어 증가 중인 파일도 상한 안에서 거부한다. */
export async function readBoundedTextFile(path: string, maximumBytes: number): Promise<string> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) throw new BoundedTextReadError('limit');
  let handle;
  try { handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK); }
  catch { throw new BoundedTextReadError('read'); }
  try {
    const entry = await handle.stat();
    if (!entry.isFile()) throw new BoundedTextReadError('read');
    if (entry.size > maximumBytes) throw new BoundedTextReadError('limit');
    const chunks: Buffer[] = [];
    let bytes = 0;
    while (bytes <= maximumBytes) {
      const chunk = Buffer.alloc(Math.min(64 * 1024, maximumBytes + 1 - bytes));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (bytesRead === 0) break;
      bytes += bytesRead;
      if (bytes > maximumBytes) throw new BoundedTextReadError('limit');
      chunks.push(chunk.subarray(0, bytesRead));
    }
    try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks, bytes)); }
    catch { throw new BoundedTextReadError('encoding'); }
  } catch (error) {
    if (error instanceof BoundedTextReadError) throw error;
    throw new BoundedTextReadError('read');
  } finally { await handle.close(); }
}

/**
 * UTF-8이 UTF-16 코드 단위 하나에 쓰는 최대 바이트 수다.
 *
 * 1~3바이트 문자는 1단위, 4바이트 문자는 2단위이고, 잘못된 바이트는 최대 3바이트마다 U+FFFD 1단위로 디코딩된다(BOM도
 * 3바이트에 1단위로 남는다). 그래서 바이트 수가 UTF-16 상한의 이 배수를 넘는 파일은 디코딩하면 반드시 상한을 넘는다.
 */
const MAX_UTF8_BYTES_PER_UTF16_UNIT = 3;

/**
 * 일반 파일만 `readFile(path, 'utf8')`과 같게 읽는다. 요청을 하나씩 처리하는 MCP serve의 읽기 경계다.
 *
 * FIFO 열기나 끝없는 장치 읽기 하나가 순차 세션 전체를 멈추므로, O_NONBLOCK으로 열어 FIFO에서도 막히지 않고 연
 * 핸들이 일반 파일이 아니면 읽기 전에 `read`로 거부한다. 디코딩은 readFile과 같아(BOM 보존, 잘못된 바이트는
 * U+FFFD) CLI와 같은 문서·sha256을 낸다.
 *
 * @param maximumLength 호출부가 받아들이는 최대 UTF-16 길이다. 주면 디코딩해도 그 길이를 넘을 수밖에 없는 파일(바이트가
 *   길이의 3배 초과)을 읽기 전에 `limit`으로 거부한다 — 큰 파일 하나를 통째로 메모리에 올리다 순차 세션이 힙 부족으로
 *   죽지 않게 한다. 그 밖의 크기 판정은 지금처럼 호출부의 UTF-16 길이 검사가 맡는다.
 */
export async function readRegularTextFile(path: string, maximumLength?: number): Promise<string> {
  let handle;
  try { handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK); }
  catch { throw new BoundedTextReadError('read'); }
  try {
    const entry = await handle.stat();
    if (!entry.isFile()) throw new BoundedTextReadError('read');
    if (maximumLength !== undefined && entry.size > MAX_UTF8_BYTES_PER_UTF16_UNIT * maximumLength) {
      throw new BoundedTextReadError('limit');
    }
    return await handle.readFile({ encoding: 'utf8' });
  } catch (error) {
    if (error instanceof BoundedTextReadError) throw error;
    throw new BoundedTextReadError('read');
  } finally { await handle.close(); }
}
