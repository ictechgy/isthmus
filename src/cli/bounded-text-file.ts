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
