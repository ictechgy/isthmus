// D1 회귀 테스트용 적대적 git 저장소 fixture다(capture-preflight `since`, capture-trace revision·도구 `source`).
// 분석 대상 저장소의 설정이 명령을 실행하면 마커 디렉터리에 그 명령 이름의 빈 파일이 생긴다:
//   filter-clean·filter-smudge(점이 든 드라이버 evil.name), filter-process(대소문자가 섞인 드라이버 Proc),
//   fsmonitor(core.fsmonitor hook), hook(.git/hooks/post-index-change — git이 index를 고쳐 쓰면 실행된다),
//   submodule-filter·submodule-fsmonitor(서브모듈 자신의 설정 — 상위 저장소의 git config 조회로는 보이지 않는다),
//   uploadpack(부분 clone의 promisor remote — 빠진 객체를 읽는 조회가 lazy fetch를 띄우면 그 remote.origin.uploadpack이 돈다).
import { appendFile, chmod, mkdir, mkdtemp, readdir, realpath, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runChild } from '../../run-child.mjs';

/** stat만 낡게 만드는 과거 시각이다. 내용은 그대로라 git이 내용을 다시 읽어야 하는 상태가 된다. */
const STALE_TIME = new Date('2020-01-01T00:00:00Z');

/**
 * 마커를 남기는 실행 파일과 그 뒤에 붙는 명령이다. 모두 git이 계속 진행하게 한다 — 실행된 마커가 다음 명령의 실패에
 * 가려지지 않게 하기 위해서다. clean·smudge는 내용을 그대로 돌려준다. process는 git의 handshake(pkt-line 40바이트)에
 * `git-filter-server`·`version=2`로 답하고 기능을 하나도 알리지 않는다(git은 그 필터로 변환하지 않는다). 곧바로 끝내면
 * git이 "the remote end hung up"으로 죽는다. fsmonitor는 실패(1)로 답해 git이 전체 검사로 돌아가게 한다.
 * uploadpack은 마커를 남긴 뒤 진짜 git-upload-pack으로 넘겨, 격리가 없으면 lazy fetch가 실제로 끝나게 한다.
 */
const MARKER_SCRIPTS = {
  'filter-clean': 'cat', 'filter-smudge': 'cat',
  'filter-process': "head -c 40 > /dev/null\nprintf '0016git-filter-server\\n000eversion=2\\n00000000'\ncat > /dev/null",
  fsmonitor: 'exit 1', hook: 'exit 0', 'submodule-filter': 'cat', 'submodule-fsmonitor': 'exit 1',
  uploadpack: 'exec git-upload-pack "$@"',
};

/** fixture git 환경이다. 개발자의 전역·시스템 설정(hooksPath·fsmonitor·lfs 등)이 테스트를 흔들지 않게 한다. */
export function fixtureEnvironment(environment = process.env) {
  return { ...environment, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
}

/** fixture를 만드는 git이다. hook·서명을 끄고 작성자를 고정하며, 실패하면 종료 코드와 stderr로 throw한다. */
export function fixtureGit(directory, args) {
  const result = runChild('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false',
    '-c', 'protocol.file.allow=always', '-c', 'user.name=Isthmus Fixture', '-c', 'user.email=fixture@isthmus.invalid', ...args],
  { cwd: directory, env: fixtureEnvironment() });
  if (result.status !== 0) throw new Error(`fixture git failed with status ${result.status}: ${result.stderr}`);
  return result.stdout;
}

/**
 * 마커 디렉터리와 마커를 남기는 실행 파일을 전용 임시 디렉터리에 만든다. 테스트가 끝나면 그 디렉터리만 지운다.
 * 경로는 git 설정 값과 셸에 따옴표 없이 넣으므로 안전한 문자만 허용한다.
 * @returns {Promise<{scratch: string, bin: string, found: () => Promise<string[]>}>} 분석 대상 밖의 작업 디렉터리,
 *   실행 파일 디렉터리, 생긴 마커 이름 목록
 */
export async function markerKit(t) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'isthmus-git-isolation-')));
  t.after(() => rm(base, { recursive: true, force: true }));
  if (!/^[A-Za-z0-9/._-]+$/u.test(base)) throw new Error('The temporary directory path needs shell quoting; set TMPDIR to a plain path.');
  const bin = join(base, 'bin');
  const markers = join(base, 'markers');
  await mkdir(bin);
  await mkdir(markers);
  for (const [name, tail] of Object.entries(MARKER_SCRIPTS)) {
    await writeFile(join(bin, name), `#!/bin/sh\n: > ${join(markers, name)}\n${tail}\n`);
    await chmod(join(bin, name), 0o755);
  }
  return { scratch: base, bin, found: async () => (await readdir(markers)).sort() };
}

/**
 * 저장소를 만들어 커밋한 뒤 명령을 실행하는 설정을 심는다(커밋할 때는 아직 실행되지 않는다).
 * 속성은 `* filter=<driver>`와 `*.swift filter=Proc`이고 `attributes`가 'tree'면 커밋한 `.gitattributes`,
 * 'info'면 `.git/info/attributes`에 둔다. `driver`가 Buffer면 그 바이트를 그대로 이름으로 쓴다(잘못된 UTF-8 재현).
 * `stale`의 파일은 내용은 두고 mtime만 과거로 돌린다. 반환값은 심기 전에 읽은 HEAD commit이다.
 */
export async function initHostileRepository(repository, kit, { attributes = 'tree', driver = 'evil.name', stale = [] } = {}) {
  fixtureGit(repository, ['init', '--quiet', '--template=', '--initial-branch=fixture']);
  const name = Buffer.from(driver);
  const rules = Buffer.concat([Buffer.from('* filter='), name, Buffer.from('\n*.swift filter=Proc\n')]);
  if (attributes === 'tree') await writeFile(join(repository, '.gitattributes'), rules);
  fixtureGit(repository, ['add', '-A']);
  fixtureGit(repository, ['commit', '--quiet', '-m', 'fixture']);
  const head = fixtureGit(repository, ['rev-parse', 'HEAD']).trim();
  const gitDirectory = fixtureGit(repository, ['rev-parse', '--absolute-git-dir']).trim();
  if (attributes === 'info') {
    await mkdir(join(gitDirectory, 'info'), { recursive: true });
    await writeFile(join(gitDirectory, 'info/attributes'), rules);
  }
  await appendFile(join(gitDirectory, 'config'), Buffer.concat([Buffer.from('[filter "'), name,
    Buffer.from(`"]\n\tclean = ${kit.bin}/filter-clean\n\tsmudge = ${kit.bin}/filter-smudge\n`),
    Buffer.from(`[filter "Proc"]\n\tprocess = ${kit.bin}/filter-process\n[core]\n\tfsmonitor = ${kit.bin}/fsmonitor\n`)]));
  await mkdir(join(gitDirectory, 'hooks'), { recursive: true });
  await writeFile(join(gitDirectory, 'hooks/post-index-change'), `#!/bin/sh\nexec ${kit.bin}/hook\n`);
  await chmod(join(gitDirectory, 'hooks/post-index-change'), 0o755);
  for (const path of stale) await utimes(join(repository, path), STALE_TIME, STALE_TIME);
  return head;
}

/**
 * `superproject`(그 안의 기존 파일을 커밋)에 서브모듈 `sub`를 더한다. 서브모듈 자신의 설정에만 filter 드라이버
 * `subevil`과 fsmonitor를 심고 서브모듈 파일의 stat을 낡게 만든다. 반환한 함수는 서브모듈 HEAD를 새 커밋으로 옮긴다
 * (상위 저장소가 기록한 commit과 달라진다).
 */
export async function initSuperprojectWithHostileSubmodule(superproject, origin, kit) {
  await mkdir(origin, { recursive: true });
  fixtureGit(origin, ['init', '--quiet', '--template=', '--initial-branch=fixture']);
  await writeFile(join(origin, 'inner.dart'), 'inner');
  await writeFile(join(origin, '.gitattributes'), '* filter=subevil\n');
  fixtureGit(origin, ['add', '-A']);
  fixtureGit(origin, ['commit', '--quiet', '-m', 'inner']);
  fixtureGit(superproject, ['init', '--quiet', '--template=', '--initial-branch=fixture']);
  fixtureGit(superproject, ['add', '-A']);
  fixtureGit(superproject, ['submodule', '--quiet', 'add', origin, 'sub']);
  fixtureGit(superproject, ['commit', '--quiet', '-m', 'superproject']);
  const submodule = join(superproject, 'sub');
  const gitDirectory = fixtureGit(submodule, ['rev-parse', '--absolute-git-dir']).trim();
  await appendFile(join(gitDirectory, 'config'),
    `[filter "subevil"]\n\tclean = ${kit.bin}/submodule-filter\n[core]\n\tfsmonitor = ${kit.bin}/submodule-fsmonitor\n`);
  await utimes(join(submodule, 'inner.dart'), STALE_TIME, STALE_TIME);
  // fixture 자신은 심은 설정을 실행하지 않도록 같은 명령줄 무력화로 커밋한다.
  return () => fixtureGit(submodule, ['-c', 'core.fsmonitor=false', '-c', 'filter.subevil.clean=',
    'commit', '--quiet', '--allow-empty', '-m', 'move']);
}

/**
 * origin 저장소(`lib/old.dart`를 60줄로 커밋한 뒤 `lib/bridge.dart`로 이름을 바꿔 다시 커밋)를 만들고 그 blob:none
 * 부분 clone을 `clone`에 둔다. checkout은 HEAD의 blob만 받으므로 이름을 바꾸기 전 `lib/old.dart`의 blob은 clone에
 * 없다 — base commit과의 `diff --find-renames`나 HEAD↔index rename 탐지가 그 blob을 읽으면 git은 promisor remote에서
 * lazy fetch를 띄워 clone의 `remote.origin.uploadpack`(kit의 마커)을 실행한다(격리가 막아야 한다). 이름을 바꾸기 전
 * base commit을 돌려준다 — capture의 `since`와 `reset --soft` 기준이다.
 * @param {string} clone 부분 clone을 둘 빈 디렉터리(분석 대상 project가 된다)
 * @param {string} origin promisor origin을 둘 디렉터리(분석 대상 밖, kit.scratch 아래)
 * @param {{bin: string}} kit markerKit 결과(uploadpack 마커 스크립트가 bin에 있다)
 * @returns {Promise<{base: string}>} 이름을 바꾸기 전 base commit
 */
export async function initPartialCloneWithPromisorMarker(clone, origin, kit) {
  await mkdir(origin, { recursive: true });
  fixtureGit(origin, ['init', '--quiet', '--template=', '--initial-branch=fixture']);
  // 부분 clone과 그 뒤 빠진 객체의 lazy fetch(특정 SHA 요청)를 origin이 허용하게 한다.
  fixtureGit(origin, ['config', 'uploadpack.allowFilter', 'true']);
  fixtureGit(origin, ['config', 'uploadpack.allowAnySHA1InWant', 'true']);
  await mkdir(join(origin, 'lib'));
  await mkdir(join(origin, 'ios'));
  // rename을 blob 내용으로 판정하게 60줄로 둔다(짧으면 git이 blob을 읽지 않고도 같은 이름만으로 판정한다).
  await writeFile(join(origin, 'lib/old.dart'), `${Array.from({ length: 60 }, (_, index) => `line ${index}`).join('\n')}\n`);
  await writeFile(join(origin, 'ios/Helper.swift'), 'struct Helper {}\n');
  await writeFile(join(origin, 'producer.txt'), 'producer implementation\n');
  fixtureGit(origin, ['add', '-A']);
  fixtureGit(origin, ['commit', '--quiet', '-m', 'base']);
  const base = fixtureGit(origin, ['rev-parse', 'HEAD']).trim();
  fixtureGit(origin, ['mv', 'lib/old.dart', 'lib/bridge.dart']);
  await appendFile(join(origin, 'lib/bridge.dart'), 'line 60\n');
  fixtureGit(origin, ['add', '-A']);
  fixtureGit(origin, ['commit', '--quiet', '-m', 'rename']);
  await mkdir(clone, { recursive: true });
  // file:// URL은 객체를 하드링크하지 않아 과거 blob이 실제로 빠진다(로컬 경로 복제는 전부 복사한다).
  fixtureGit(clone, ['clone', '--quiet', '--filter=blob:none', `file://${origin}`, '.']);
  fixtureGit(clone, ['config', 'remote.origin.uploadpack', join(kit.bin, 'uploadpack')]);
  // 격리가 없을 때 lazy fetch가 protocol 정책에 막히지 않고 실제로 마커를 실행하게 한다(격리는 fetch 자체를 막는다).
  fixtureGit(clone, ['config', 'protocol.file.allow', 'always']);
  return { base };
}
