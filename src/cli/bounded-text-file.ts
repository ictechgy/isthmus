import { constants } from 'node:fs';
import { open, stat } from 'node:fs/promises';

/** 읽기 원인을 경로·본문 없이 명령 계층으로 전달한다. */
export class BoundedTextReadError extends Error {
  readonly reason: 'read' | 'limit' | 'encoding';
  constructor(reason: 'read' | 'limit' | 'encoding') { super(`Bounded input ${reason} failure.`); this.name = 'BoundedTextReadError'; this.reason = reason; }
}

/** 연 파일에서 경계 읽기가 쓰는 최소 표면이다. `FileHandle`이 그대로 맞는다. */
export interface BoundedReadHandle {
  stat(): Promise<{ isFile(): boolean; readonly size: number }>;
  read(buffer: Buffer, offset: number, length: number, position: null): Promise<{ readonly bytesRead: number }>;
  close(): Promise<void>;
}

/**
 * 경계 읽기가 쓰는 파일시스템이다. 실제 구현은 {@link nodeBoundedFileSystem}이다.
 *
 * 테스트가 열기 호출 여부와 fstat 뒤 커지는 파일을 시간에 기대지 않고 확인하려고 바꿔 넣는 자리다.
 */
export interface BoundedFileSystem {
  /** 링크를 따라간 경로의 종류다. 열기 전에 일반 파일인지 가린다. */
  stat(path: string): Promise<{ isFile(): boolean }>;
  /** 읽기 전용·논블로킹으로 연다. stat 뒤에 FIFO로 바뀐 경로도 반대쪽을 기다리지 않는다. */
  open(path: string): Promise<BoundedReadHandle>;
}

/** Node 파일시스템으로 만든 {@link BoundedFileSystem}이다. */
export const nodeBoundedFileSystem: BoundedFileSystem = {
  stat: (path) => stat(path),
  open: (path) => open(path, constants.O_RDONLY | constants.O_NONBLOCK),
};

/** 한 번에 읽는 최대 바이트 수다. 상한+1 바이트를 넘겨 읽지 않도록 마지막 청크는 남은 만큼만 요청한다. */
const READ_CHUNK_BYTES = 64 * 1024;

/**
 * 일반 파일 하나를 `maximumBytes` 바이트까지 읽는다. 두 텍스트 리더(CLI·serve와 trace-navigation)의 공용 경계다.
 *
 * 1. 열기 전에 stat(링크를 따라감)으로 일반 파일인지 본다. FIFO·장치·디렉터리는 열지 않고 `read`다 — FIFO 열기는
 *    반대쪽을 기다릴 수 있고, 장치는 열기만으로 부작용이 있을 수 있다.
 * 2. 읽기 전용·논블로킹으로 연 핸들을 fstat으로 다시 본다(stat과 열기 사이에 경로가 바뀌는 경쟁).
 * 3. fstat 크기가 상한을 넘으면 읽지 않고 `limit`이다.
 * 4. fstat 뒤 커진 파일도 상한+1 바이트째를 읽는 순간 멈추고 `limit`이다.
 *
 * 그 밖의 실패(없는 경로·권한·읽기 오류)는 `read`다. 디코딩은 리더마다 다르므로 바이트를 그대로 돌려준다.
 *
 * @param fileSystem 테스트만 바꾼다.
 */
export async function readRegularFileBytes(path: string, maximumBytes: number,
  fileSystem: BoundedFileSystem = nodeBoundedFileSystem): Promise<Buffer> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) throw new BoundedTextReadError('limit');
  await requireRegularPath(path, fileSystem);
  let handle;
  try { handle = await fileSystem.open(path); }
  catch { throw new BoundedTextReadError('read'); }
  try { return await readOpenedRegularFile(handle, maximumBytes); }
  catch (error) {
    if (error instanceof BoundedTextReadError) throw error;
    throw new BoundedTextReadError('read');
  } finally { await handle.close(); }
}

/** 경로가 일반 파일을 가리키지 않으면(stat 실패 포함) 열기 전에 `read`로 거부한다. */
async function requireRegularPath(path: string, fileSystem: BoundedFileSystem): Promise<void> {
  let entry;
  try { entry = await fileSystem.stat(path); }
  catch { throw new BoundedTextReadError('read'); }
  if (!entry.isFile()) throw new BoundedTextReadError('read');
}

/**
 * 연 핸들이 일반 파일인지 다시 보고, 상한+1 바이트에 닿기 전까지 청크로 모은다.
 *
 * 0바이트 읽기는 파일 끝이다. 요청보다 적게 읽힌 것은 fstat 크기만큼 읽은 뒤에만 끝으로 본다 — 작은 파일은 첫 읽기가
 * 크기를 채우므로 끝을 확인하는 빈 읽기를 한 번 더 하지 않고, 크기 0으로 알리는 파일(procfs 같은 가상 파일)은 readFile처럼
 * 빈 읽기까지 읽으며, 끝 전에 짧게 돌려주는 파일시스템에서도 앞부분만 읽고 멈추지 않는다. 청크는 읽힌 앞부분만 쓰므로
 * 0으로 채우지 않는다.
 */
async function readOpenedRegularFile(handle: BoundedReadHandle, maximumBytes: number): Promise<Buffer> {
  const entry = await handle.stat();
  if (!entry.isFile()) throw new BoundedTextReadError('read');
  if (entry.size > maximumBytes) throw new BoundedTextReadError('limit');
  const chunks: Buffer[] = [];
  let bytes = 0;
  while (bytes <= maximumBytes) {
    const request = Math.min(READ_CHUNK_BYTES, maximumBytes + 1 - bytes);
    const chunk = Buffer.allocUnsafe(request);
    const { bytesRead } = await handle.read(chunk, 0, request, null);
    bytes += bytesRead;
    if (bytes > maximumBytes) throw new BoundedTextReadError('limit');
    chunks.push(chunk.subarray(0, bytesRead));
    if (bytesRead === 0 || (bytesRead < request && entry.size > 0 && bytes >= entry.size)) break;
  }
  return Buffer.concat(chunks, bytes);
}

/**
 * 일반 UTF-8 파일만 cap+1 바이트까지 읽어 증가 중인 파일도 상한 안에서 거부한다. trace-navigation의 읽기 경계다.
 *
 * 잘못된 UTF-8은 대체 문자로 바꾸지 않고 `encoding`으로 거부한다(NAVIGATION 계약). BOM은 지우지 않는다.
 */
export async function readBoundedTextFile(path: string, maximumBytes: number): Promise<string> {
  const bytes = await readRegularFileBytes(path, maximumBytes);
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new BoundedTextReadError('encoding'); }
}

/**
 * UTF-8이 UTF-16 코드 단위 하나에 쓰는 최대 바이트 수다.
 *
 * 1~3바이트 문자는 1단위, 4바이트 문자는 2단위이고, 잘못된 바이트는 최대 3바이트마다 U+FFFD 1단위로 디코딩된다(BOM도
 * 3바이트에 1단위로 남는다). 그래서 바이트 수가 UTF-16 상한의 이 배수를 넘는 파일은 디코딩하면 반드시 상한을 넘는다.
 */
const MAX_UTF8_BYTES_PER_UTF16_UNIT = 3;

/**
 * 일반 파일만 `readFile(path, 'utf8')`과 같게 읽는다. CLI 명령과 MCP serve가 같이 쓰는 입력 읽기 경계다.
 *
 * FIFO·장치·디렉터리는 열지 않고 `read`로 거부한다 — FIFO 열기나 끝없는 장치 읽기 하나가 CLI 프로세스나 요청을 하나씩
 * 처리하는 serve 세션 전체를 멈추기 때문이다. 바이트를 다 모은 뒤 한 번만 디코딩해 readFile과 같은 문자열을 낸다(BOM
 * 보존, 잘못된·잘린 바이트는 U+FFFD) — 청크마다 디코딩하면 경계에 걸친 다중 바이트 문자가 깨지고, 기본 `TextDecoder`는
 * BOM을 지운다. 그래서 일반 파일 입력의 문서·sha256은 readFile로 읽던 때와 같다.
 *
 * @param maximumLength 호출부가 받아들이는 최대 UTF-16 길이다. 디코딩해도 그 길이를 넘을 수밖에 없는 파일(바이트가
 *   길이의 3배 초과)은 읽기 전에, 읽는 중 그만큼 커진 파일은 그 바이트+1에서 `limit`으로 거부한다 — 큰 파일 하나를
 *   통째로 메모리에 올리지 않는다. 그 밖의 크기 판정은 지금처럼 호출부의 UTF-16 길이 검사가 맡는다.
 */
export async function readRegularTextFile(path: string, maximumLength: number): Promise<string> {
  return (await readRegularFileBytes(path, MAX_UTF8_BYTES_PER_UTF16_UNIT * maximumLength)).toString('utf8');
}
