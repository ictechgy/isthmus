/**
 * 분석 대상 저장소에서 실행하는 git 조회(capture-preflight `since`, capture-trace revision·도구 `source`)를 그 저장소의
 * 설정에서 격리하는 인자를 만든다.
 *
 * 분석 대상의 git 설정(`.git/config`와 그 include, 속성 파일, 서브모듈 설정)은 신뢰하지 않는 입력이다. filter 드라이버
 * (`clean`·`smudge`·`process`), `core.fsmonitor`, 외부 diff·textconv, 서명 확인, index를 고쳐 쓸 때 도는 hook은 읽기
 * 전용으로 보이는 조회에서도 명령을 실행한다. 그래서 호출자는 조회마다 바로 앞에서 {@link CONFIG_NAMES_QUERY}로 그 순간
 * 설정된 키 이름을 다시 읽고(사이에 실행된 생산자가 설정을 바꿔도 따라간다) {@link isolatedGitArguments}로 덮는다.
 * 명령줄 `-c`는 모든 설정 파일보다 우선하고, git은 빈 filter 명령을 실행하지 않는다(git 2.54 실측). 서브모듈에서는 git을
 * 띄우지 않는다 — 서브모듈 자신의 설정에 있는 드라이버 이름은 상위 저장소의 조회로 알 수 없다. 분석 대상이 부분 clone이면
 * 조회가 빠진 객체를 만났을 때 git이 띄우는 promisor lazy fetch도 저장소 설정의 명령을 실행하므로, 호출자는 그 환경에
 * {@link GIT_ISOLATION_ENVIRONMENT}도 함께 준다.
 */

/**
 * 설정 키 이름만 모두 읽는 읽기 전용 조회 인자다(`git config -z --name-only --list`, 키마다 NUL로 끝나고 종료 코드는
 * 성공 0, 읽을 수 없는 설정은 128). 값은 받지 않는다 — 자격 증명 같은 설정 값을 읽을 이유가 없다.
 *
 * 정규식 조회(`--get-regexp '^filter\..*\.(clean|smudge|process)$'`)를 쓰지 않는 이유: UTF-8 로캘의 git은 `.`가 잘못된
 * UTF-8 바이트와 맞지 않아 그런 이름의 드라이버를 결과에서 빼지만, 속성은 바이트로 대조하므로 그 드라이버는 실행된다
 * (git 2.54, macOS 실측). 전체 키 목록은 로캘과 무관하다.
 */
export const CONFIG_NAMES_QUERY = Object.freeze(['config', '-z', '--name-only', '--list']);

/**
 * 격리한 git 조회에 함께 주는 환경이다. 분석 대상이 부분 clone(promisor remote)이고 조회에 필요한 객체가 로컬에
 * 없으면, git은 조회 도중 자식 fetch를 띄워 그 저장소 설정의 `remote.<name>.uploadpack`(로컬 경로 전송은 셸로 실행)·
 * `core.sshCommand`·`credential.helper` 같은 명령을 실행한다. 이 변수로 lazy fetch를 끄면 빠진 객체를 만난 조회는
 * fetch 없이 실패한다(fail-closed) — filter·fsmonitor와 달리 `-c`로 끌 수 없어 환경 변수를 쓴다. git 2.41 미만은 이
 * 변수를 무시하지만(그 git에는 끄는 수단이 없다) 정상 저장소의 조회 결과는 그대로다(빠진 객체가 없으면 fetch도 없다).
 */
export const GIT_ISOLATION_ENVIRONMENT = Object.freeze({ GIT_NO_LAZY_FETCH: '1' });

/** 명령을 가진 filter 드라이버 키다. 이름(첫 묶음)은 `filter.`과 마지막 `.<키>` 사이 전체다. */
const FILTER_COMMAND_KEY = /^filter\.(.*)\.(?:clean|smudge|process)$/su;

/** 명령줄로 덮을 수 없는 드라이버 이름의 원인·해결 방향이다. 신뢰하지 않는 이름 원문(제어 문자일 수 있다)은 싣지 않는다. */
const UNNEUTRALIZABLE_DRIVER = 'git cannot override a configured filter driver whose name contains "=" or is not valid UTF-8; '
  + 'rename or remove that filter driver in the git configuration, then rerun the capture.';

/** 격리할 수 없는 설정(덮을 수 없는 드라이버 이름, 불완전한 키 목록)이다. 호출자가 자기 단계 오류로 감싼다. */
export class GitIsolationError extends Error {
  /** 원인과 해결 방향만 담은 문구를 받는다. */
  constructor(message) {
    super(message);
    this.name = 'GitIsolationError';
  }
}

/**
 * {@link CONFIG_NAMES_QUERY} 출력에서 명령을 가진 filter 드라이버 이름을 모은다.
 *
 * 이름에는 점이 들어갈 수 있고 대소문자를 구분하며, 빈 이름도 `filter=` 속성이 고른다. `=`가 든 이름은 git이 `-c`
 * 값을 첫 `=`에서 키·값으로 나눠 덮을 수 없고, 잘못된 UTF-8 이름은 출력 디코딩에서 U+FFFD가 되어 같은 바이트로 인자에
 * 되돌릴 수 없다. 둘 다 조회를 멈추고 실패한다(fail-closed) — 실제 U+FFFD가 든 이름도 구분하지 못해 함께 거부한다.
 * @param {string} listing 키마다 NUL로 끝나는 출력(빈 문자열은 키 없음)
 * @returns {string[]} 중복 없이 정렬한 드라이버 이름
 * @throws {GitIsolationError} 목록이 NUL로 끝나지 않거나 덮을 수 없는 이름이 있을 때
 */
export function filterDriverNames(listing) {
  if (listing === '') return [];
  if (!listing.endsWith('\0')) throw new GitIsolationError('git returned an incomplete configuration listing; rerun the capture.');
  const names = new Set();
  for (const key of listing.slice(0, -1).split('\0')) {
    const name = FILTER_COMMAND_KEY.exec(key)?.[1];
    if (name === undefined) continue;
    if (name.includes('=') || name.includes('�')) throw new GitIsolationError(UNNEUTRALIZABLE_DRIVER);
    names.add(name);
  }
  return [...names].sort();
}

/**
 * 하위 명령마다 더하는 설정(하위 명령 앞)과 옵션(하위 명령 바로 뒤)이다. 정하지 않은 하위 명령은 받지 않는다.
 * - diff: 외부 diff·textconv를 끄고, 작업 트리와 비교할 때 stat만 바뀐 항목을 다시 읽어 index를 고쳐 쓰지 않는다
 *   (`diff.autoRefreshIndex=false` — 고쳐 쓰면 post-index-change hook이 돈다). 그 대신 stat만 바뀐 파일도 변경으로 낸다.
 * - diff·status: `--ignore-submodules=dirty`로 서브모듈에서 git을 띄우지 않는다. 기록된 commit과 서브모듈 HEAD의 차이는
 *   그대로 보고(`all`은 그것까지 숨긴다), 서브모듈 작업 트리 안의 커밋하지 않은 변경은 보지 않는다.
 * status는 호출자가 `GIT_OPTIONAL_LOCKS=0`으로 index를 쓰지 않게 한다.
 */
const SUBCOMMAND_RULES = new Map([
  ['rev-parse', { settings: [], options: [] }],
  ['ls-files', { settings: [], options: [] }],
  ['diff', { settings: ['-c', 'diff.autoRefreshIndex=false'], options: ['--no-ext-diff', '--no-textconv', '--ignore-submodules=dirty'] }],
  ['status', { settings: [], options: ['--ignore-submodules=dirty'] }],
]);

/**
 * 격리한 git 하위 명령 하나의 인자 배열이다(`git` 뒤에, `-C <dir>`를 쓰면 그 뒤에 붙인다).
 *
 * 공통으로 `core.fsmonitor`와 `log.showSignature`를 끄고, 드라이버마다 `clean`·`smudge`·`process`를 빈 명령으로,
 * `required`를 false로 덮는다(빈 명령의 필터가 실패로 취급되어 git이 멈추지 않게).
 * @param {string[]} drivers 바로 앞 조회의 {@link filterDriverNames} 결과
 * @param {string} subcommand `rev-parse`·`ls-files`·`diff`·`status`
 * @param {string[]} args 하위 명령의 나머지 인자(격리 옵션 뒤에 온다)
 * @returns {string[]} 하위 명령까지 포함한 인자
 * @throws {TypeError} 격리 규칙을 정하지 않은 하위 명령일 때(프로그래밍 오류)
 */
export function isolatedGitArguments(drivers, subcommand, args) {
  const rule = SUBCOMMAND_RULES.get(subcommand);
  if (rule === undefined) throw new TypeError(`No git isolation rule is defined for ${subcommand}.`);
  return ['-c', 'core.fsmonitor=false', '-c', 'log.showSignature=false',
    ...drivers.flatMap((name) => ['-c', `filter.${name}.clean=`, '-c', `filter.${name}.smudge=`,
      '-c', `filter.${name}.process=`, '-c', `filter.${name}.required=false`]),
    ...rule.settings, subcommand, ...rule.options, ...args];
}
