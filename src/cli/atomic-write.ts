import { randomBytes } from 'node:crypto';
import { rename, rm, writeFile } from 'node:fs/promises';

/**
 * 같은 디렉터리의 배타적 임시 파일에 쓰고 rename으로 원자 교체한다.
 *
 * 중단·디스크 가득 참 중에 기존 베이스라인이 잘린 채 남으면 다음 실행이
 * 코드 2로 실패한다. rename은 같은 파일시스템 안에서 원자적이다.
 *
 * 임시 파일 이름은 pid와 무작위 바이트로 만들어 예측할 수 없고 `wx`로
 * 배타 생성한다. 미리 놓인 심링크를 예측된 이름으로 통한 임의 파일
 * 덮어쓰기로 이어지지 않는다. 쓰기에 실패하면 임시 파일만 지운다.
 */
export async function writeTextAtomically(
  path: string,
  text: string,
  temporaryPathFor: (path: string) => string = unpredictableTemporaryPath,
): Promise<void> {
  const temporaryPath = temporaryPathFor(path);
  try {
    await writeFile(temporaryPath, text, { encoding: 'utf8', flag: 'wx' });
    await rename(temporaryPath, path);
  } catch (error) {
    // EEXIST는 배타 생성이 거부된 것으로 임시 파일이 우리 것이 아니라는 뜻이다.
    // 남은 오류에서만 직접 만든 임시 파일을 지운다.
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
    throw error;
  }
}

/** 같은 디렉터리 안의 예측 불가능한 임시 파일 이름을 만든다. */
function unpredictableTemporaryPath(path: string): string {
  return `${path}.${process.pid}.${randomBytes(12).toString('hex')}.tmp`;
}
