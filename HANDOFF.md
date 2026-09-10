# Handoff

## 2026-09-10 — retentions 다중 호출자 근거 (Blockers 5 절반 종결)

external-retentions v0의 additive 확장으로 `evidence.callers`(전체 호출 위치, 대표 포함,
결정적 순서, 근거당 상한 100)+`callersOmitted`(상한 초과 계수, 0이면 생략)를 실는다.
대표 `caller`는 옛 소비자 호환으로 유지되고 호출이 하나인 근거는 기존 출력과 바이트가
같다.

- **하위호환 실측(설치본 cartograph 0.10.1)**: corpus에 호출 하나를 복제한 다중 호출자
  문서로 `retentions`를 만들어 먹였다 — dead 억제 정상(CameraBridge 미보고), `--explain`
  정상(대표 호출 문장), exit 0. Swift `JSONDecoder`가 알 수 없는 키를 무시하므로
  구형 소비자도 그대로 읽는다. 생산자 선행 배포 안전(limitationScopes와 같은 패턴).
- **계약**: GRAPH-EXCHANGE "되돌려 주는 형식" 절에 예시·규칙(상한·계수 공개·소비자
  무시 근거) 명문화. README 양문·CHANGELOG 갱신.
- **남은 것(cartograph 쪽)**: `ExternalRetention`의 `callers` decoding과 `--explain`
  렌더링(전체 호출 나열 + `+N more`). 합의 issue 초안은
  `$TMPDIR/opencode/issue-cartograph-callers.md` — 토큰 403이라 **사용자가 등록**한다.
  등록 후 Blockers 5 완전 종결.

## 2026-09-10 — check summary 관찰량 노출·오류 분류 경계 분리 (opencode 세션)

- **PR #49 (main `db9ee3a`)**: 지연 리뷰 F4(a)(b) 반영 — 베이스라인 인코딩을 쓰기 try
  밖으로, JSON 파싱과 문서 검증의 try 분리(오분류 잠재 경로 제거).
- **이번 PR — Blockers 6 종결**: `isthmus-check` summary에 `observedFacts`(입력 문서
  fact 총수)·`observedLimitations`(한계 수) 추가(호환 변경). 조인 결과
  (`BridgeJoinResult.observedFacts`)가 관찰량을 들고 있어 보류(mixed-targets) 결과도
  관찰량을 보존한다. Phase 0 골든 check.json 재생성(observedFacts 10·
  observedLimitations 7). "브리지가 없는 프로젝트"와 "아무것도 관찰하지 못한 실행"이
  이제 구분된다.

## 2026-09-10 — SARIF 리포터·gitignore 커밋·지연 도착 리뷰 후속 (opencode 세션)

- **PR #46**: 사용자 소유였던 `.gitignore` 미커밋 수정을 약속대로 별도 브랜치로 커밈
  (`.serena/`, experiments 하위 Dart/Swift 산출물). 워크스페이스가 처음으로 깨끗해졌다.
  사용자는 호스트 dartograph 0.5.0 업그레이드도 완료(Next Steps 1 소멸).
- **PR #47 (main `ab5c997`)**: Next Steps 3 SARIF 리포터 — `check --format json|sarif`
  (기본 json 불변). 규칙 id=진단 코드, 주 위치=첫 증거 끝점(세그먼트별 RFC 3986 인코딩
  URI), 나머지 끝점=relatedLocations, 베이스라인 억제=`external` suppression, 논리 키
  sha256=`partialFingerprints.isthmusIssueV1`. driver 버전은 package.json에서 주입.
  GLM 리뷰(지연 도착) 반영: URI 인코딩·ruleIndex 폴백 제거·region 하한 가드·빈 버전
  생략·테스트 보강. 기각 근거(키 충돌 없음·결정성)와 유보 항목(alarm churn·GitHub
  업로드 상한 실측)은 RESEARCH 해당 절.
- **지연 도착한 이전 리뷰(구조·보안·성능)의 후속 지적 처분**: F4(a)(b) —
  `encodeBaselineDocument`이 쓰기 try 안에 있어 인코더 결함이 쓰기 실패로 오분류,
  `JSON.parse`와 문서 검증기가 같은 try라 검증기 RangeError가 "not valid JSON"으로
  오분류될 수 있는 잠재 결합(현재 미발생) — **수정 대기(Next Steps)**. F4(c)는 기각:
  diff 포함 전 명령이 try/catch + `inputFailureResult ?? internalError` 가드 확인.
  F5~F9는 문서 수준(단일 패스 정규화·fsync·mode·dangling 참조 등), RESEARCH 리뷰
  절의 장기 후보로 남김.

## 2026-09-10 — 구조·보안·성능 리뷰와 베이스라인 원자 쓰기 경화 (opencode 세션)

사용자 요청으로 제품 코드 전량 리뷰(실측 포함)를 하고 발견 1건을 수정했다(PR #44).
기록은 RESEARCH "구조·보안·성능 리뷰(2026-09-10)" 절 — 성능 실측(check 87k facts
0.17s, graph 92.5k 간선 0.16s 등), 확인된 강점, 발견·처분 전부 거기에 있다.

- **수정**: 베이스라인 임시파일이 `${path}.${pid}.tmp`로 예측 가능하고 `writeFile`
  기본 플래그가 심링크를 따라가던 문제(공유 시스템 임의 파일 덮기 가능). 를
  `src/cli/atomic-write.ts`로 분리해 pid+무작위 바이트 이름·`wx` 배타 생성·EEXIST
  시 미정리(우리 것이 아닌 파일)로 바꿨고 단위 테스트 4건을 추가했다.
- **문서화**: `limitations` 문자열의 자유 서술·소비자 미검증·텍스트 출력 경로 소독을
  GRAPH-EXCHANGE에 명문화(의미 변경 없는 v1 동작 설명).
- 미반영 후보(근거와 함께 RESEARCH에 기록): 비교자 내 `JSON.stringify`,
  `encodeSortedJson` 깊은 복사, query 전체 결과 구성 — 실측 규모에서 무의미.
  공유 CLI 인프라의 check-command 편중은 다음 CLI 확장 시 분리.

## 2026-09-09 — limitationScopes 양성 사례 종단 실측 (opencode 세션)

Next Steps 1을 닫았다(PR #43). `scripts/verify-limitation-scopes.mjs`(신규, 자기완결 합성 dogfood,
네트워크·git 불필요)가 cartograph 0.10.1 + dartograph 0.5.0 + isthmus 0.3.0 조합으로 통과했다:

- **스코프 실발행(양성)**: 위임 참조 핸들러(`setMethodCallHandler(HandlerDelegate().handleCall)`
  — 클로저도 아니고 같은 파일·`self` 가독 참조도 아님) + 리터럴 채널이면
  `opaque-handler-bodies:` limitation과 함께
  `limitationScopes: [{"limitationIndex": 0, "channels": ["demo.example/opaque"]}]`가
  실제로 발행된다. 발행 트리거의 코드 근거는 RESEARCH "스코프 양성 사례 실측" 절.
- **채널 단위 완화(소비)**: isthmus check가 스코프 채널의 미처리 호출만
  `unhandled-invocation-unverified` 경고로 낮추고, 같은 target 인접 채널의 미처리 호출과
  등록 없는 채널 생성은 error로 유지했다(summary errors 2·warnings 1, `--strict` exit 1).
  "핸들러만 가린다"는 계약 구분의 종단 확인. **인과 대조**도 포함: 같은 문서에서
  `limitationScopes`만 빼면 인접 채널까지 완화되는 과완화가 돌아온다(errors 1·warnings 2)
  — 완화의 원인이 스코프임을 입증.
- **fixture 주의점(첫 실패에서 확정)**: 위임 본문에 `switch call.method`를 두면 귀속 없는
  `channel: null` method-handle이 나와 `unattributed-method-handles:`(스코프 없는 공백)가
  함께 발행되고 전체 완화로 번진다. 본문에서 분기를 제거해 해결했다.
- 스크립트는 공개 plugin 스크립트와 동일 구조(버전 게이트 cartograph 0.9.0·dartograph
  0.1.1·isthmus 0.2.0, isthmus-js 오버라이드)이고 사용법 테스트
  `src/limitation-scopes-script.test.ts`를 추가했다. README 양문·scripts/AGENTS에 명령 안내.

## 2026-09-09 — 통합 검증 전체 그린: cartograph 0.10.1 · dartograph 0.5.0 · isthmus 0.3.0 (opencode 세션)

사용자가 `/var/folders` 쓰기 차단을 열자 cartograph가 샌드박스에서 실행 가능해져,
차단됐던 두 통합 검증이 **모두 통과**했다(아래 "실행 불가 확정" 절의 판정을 무효화).

- `verify-cartograph-roundtrip.mjs`: cartograph 0.10.1 + dartograph 0.5.0(샌드박스
  `PUB_CACHE`) + isthmus 0.3.0 dist — producer → retentions → dead 억제 → explain
  왕복 통과.
- `verify-public-flutter-plugin.mjs`: plus_plugins 고정 커밋 `13e17047` — macOS Swift
  근거와 **iOS ObjC 3개 핸들러·제외 계수** 검증 통과.
- ObjC Flutter 핸들러가 `sourceLanguage: objective-c`와 **실제 clang USR**(`c:objc(cs)…`)이
  붙은 사실로 추출된다(corpus 실측) — RESEARCH 1차 조사(indexstore-db의 Apple Clang
  유닛)와 제안 #22의 방향 A가 cartograph 0.10.1에서 구현된 결과다. `objective-c-handlers:`
  문구는 "outside the Swift analysis graph"로 바뀌었다(USR 부재가 아니라 그래프 밖이
  본질).
- 스코프 실측: `limitationScopes`는 **입증 가능한 채널 상한에서만** 발행된다 — 소스에서
  `opaque-handler-bodies:`이고 전 채널이 알려졌을 때만 스코프를 붙임을 확인했고, corpus의
  ObjC 공백은 상한 입증 불가로 `null`(계약의 "상한을 증명할 수 없으면 생략" 그대로).
  양성 사례(스코프 실제 등장)는 미실측 — opaque-handler-bodies 형태 fixture가 필요하다.

샌드박스 운영 기법(이번 실측): guard는 **워크스페이스 안 `.git/config` 쓰기**를 차단한다
(`git init` 불가, `push -u`의 upstream 저장 실패와 같은 뿌리). dogfood 스크립트는
checkout을 repositoryRoot에 만들므로 scripts·dist를 tmp로 복사한 뒤 **세 번째 인자
(isthmus-js 오버라이드)로 재빌드를 건너뛰어** 실행했고, `swift` PATH shim으로
`--disable-sandbox`를 보급했다(SwiftPM 자체 sandbox-exec 중첩 거부). Node `os.tmpdir()`은
`$TMPDIR`을 따르지만 `NSTemporaryDirectory()`·xcrun은 confstr(`/var/folders`)을 따른다 —
cartograph 실행에는 그 경로 개방이 필요했다.

## 2026-09-09 — toolchain 수리 후: cartograph는 샌드박스에서 실행 불가 확정 (opencode 세션)

> **이후 무효**: 같은 날 `/var/folders` 차단이 열리며 cartograph 실행 가능 — 최상단 절 참조.

사용자가 Swift toolchain을 수리했다(hello-world 통과, 컴파일러 6.3.3). corpus
`swift build`도 guard 플래그(`--disable-sandbox`, 필요 시 `--scratch-path`/`--cache-path`
`$TMPDIR` 아래)로 성공해 인덱스 스토어(v5)를 만들었다. 그러나 **cartograph의
인덱스 기반 명령(bridges·dead)은 샌드박스에서 실행할 수 없다**: 가속 DB를
`NSTemporaryDirectory()`(= confstr `/var/folders/…`, TMPDIR 환경변수를 무시함을
실측) 아래 `cartograph-index-db/`로 만드는데 그 경로 쓰기가 차단되고, CLI에 DB
경로 오버라이드가 없다(`IndexStoreProvider.defaultDatabasePath` 하드코딩).
xcrun도 같은 이유로 캐시 생성에 실패한다. 따라서 **verify-cartograph-roundtrip과
verify-public-flutter-plugin, cartograph limitationScopes 실측은 사용자 터미널에서
실행한다**(dartograph·isthmus·swift build는 샌드박스에서 모두 동작 — Blockers 3
dartograph 쪽 실측은 완료된 상태). 실행 명령은 Next Steps 1에 있다.

## 2026-09-09 — Blockers 3 수정 실측과 Swift toolchain 고장 발견 (opencode 세션)

**dartograph는 샌드박스에서 실행 가능했다** — `dart pub global activate dartograph 0.5.0`이
격리 `PUB_CACHE`(`…/homes/opencode/<id>/.pub-cache`)에 설치되고 `bridges`가 정상 동작한다.
이전 기록 "샌드박스에서 실행 불가"는 호스트 `~/.pub-cache`만 본 오판이었다.

합성 pub workspace로 Blockers 3 공유 루트 수정을 종단 실측했다(전부 통과):
자동 감지(`resolution: workspace` → 조상 `workspace:` 루트)는 project=워크스페이스 루트 +
location 재기준화(`packages/<pkg>/lib/…`), `--project` 명시도 동일, 비-workspace 패키지는
자기 루트 유지, orphan은 `pub-workspace-root-not-found` limitation과 함께 폴백(조용하지
않음). 이어서 isthmus check 조인 exit 0·matched 1/1·이슈 0, retentions 1건(재기준
evidence 경로 보존), project 불일치 음성은 코드 2 거부. **cartograph 실측 문서가 기록한
"문서 손 rewriting" 우회가 dartograph 쪽에서 불필요해졌음을 실증했다.** swift 문서는
합성(hand-synthetic)이었다 — 수신 측 실문서는 아래 toolchain 장애로 보류.

**호스트 Swift toolchain이 깨져 있다**: CLT 컴파일러는 6.3.3인데 SDK 26.5의 stdlib 모듈이
6.3.2(15.4 SDK는 6.1)라 `swift` hello-world 실행조차 "this SDK is not supported by the
compiler"로 실패한다. 디스크 파일 버전 사실이라 샌드박스 원인이 아니고, `swift build`
전반이 불가하다. 이로써 **차단된 것**: verify-cartograph-roundtrip, verify-public-flutter-plugin,
cartograph 0.10.1의 limitationScopes 실측(bridges는 인덱스 스토어 필수). brew cartograph
0.10.1 설치 자체는 확인했다. toolchain 수리는 사용자 판단(호스트 시스템 변경은 세션에서
시도하지 않는다). dartograph#38은 사용자가 닫았다.

## 2026-09-09 — Blockers 3 완전 종결 (opencode 세션)

dartograph가 **#52(merged, 0.5.0으로 pub.dev 발행)**로 공유 루트 (a)+(b)를 모두
구현했다: `--project <shared-root>`(스캔 범위는 위치 인자 유지, project·location.path
재기준화, 공유 루트는 realpath 후 package root 포함·동일 필수)와 pub workspace 자동
감지(`resolution: workspace` → `workspace:` 키를 가진 가장 가까운 조상 pubspec
디렉터리, Melos 정의와 동일), 우선순위 명시 옵션 > 감지 > 분석 루트, 감지 실패는
`pub-workspace-root-not-found`·`pub-workspace-pubspec-unparsed` limitation 폴백.
설치본 isthmus 0.2.0으로 모노레포 2패키지 왕복 실측(조인 성공 + 구행동 거부
양방향)까지 마쳤다. isthmus는 GRAPH-EXCHANGE의 자리표시자 문구를 이 의미론으로
구체화했다("생산자가 선언한 조인 루트" 정의 — cartograph의 `--project`=분석 루트와
dartograph의 재기준화 옵션을 모두 포섭). 두 폴백 limitation은 호출 측 한계라
isthmus 심각도 정책은 코드 변경 없음. **dartograph#38은 isthmus 계약 갱신까지
열어 두기로 했으므로 이제 사용자가 닫으면 된다.** dartograph 쪽 비차단 후속:
workspace 멤버십 검증(현재는 `workspace:` 키 존재만 확인).

## 2026-09-09 — Blockers 3의 realpath 절반 합의 성립 (opencode 세션)

cartograph#72가 **cartograph#73(merged)으로 닫히고 0.10.1로 발행됐다.** 주목할 구현
세부: Foundation의 `resolvingSymlinksInPath().standardizedFileURL.path`는 그 머신에서
`/private/tmp`을 `/tmp`으로 출력해 dartograph와 어긋나므로, 주입된 `FileSystem.realPath`
(POSIX realpath)로 정규화했다. 경로 해결 불가·NUL은 실패다. 사용자 FileSystem 구현은
새 메서드를 요구한다(기본은 미지원 오류). dartograph는 기존
`Directory.resolveSymbolicLinks()`로 이미 같은 기준을 만족한다. isthmus는 계약
(GRAPH-EXCHANGE)에 realpath 정규화 조항을 명문화하는 docs PR로 화답했고, 정확한
문자열 일치 fail-closed는 유지한다. isthmus#30(초안 보존 issue)은 사용자가 닫았다.
**모노레포 공유 루트 절반(dartograph#38)은 여전히 open·무응답이다.**
로컬 brew cartograph는 0.8.2(수동 tap 갱신 관행)라 realpath 수정은 0.10.1로
업그레이드해야 실제로 적용된다.

## 2026-09-09 — 0.3.0 발행 완료 (opencode 세션)

PR #34로 0.3.0을 준비(`92b160b`)하고 사용자가 `npm publish --otp`로 발행했다.
check 베이스라인(#29)과 영문 README·README.ko.md 분리(#33, tarball 동봉)가 포함된다.
발행 후 검증: registry latest 0.3.0(비동기 반영 — 직후 조회는 0.2.0, 약 25초 뒤 반영),
tarball의 `dist`·영문/한글 README·SKILL.md가 main 빌드와 바이트 일치, package metadata
0.3.0 확인. 발행본 CLI로 `--version` 0.3.0, phase-0 check 코드 0(error 1·warning 2)·
`--strict` 코드 1, **베이스라인 왕복**(update가 isthmus-baseline v1 3항목 기록·이번
실행 미억제 → strict+baseline 코드 0·suppressed 3·stale 0·전 이슈 `suppressed` 표시)
까지 확인했다. README 영문본이 npm 페이지 대표 문서가 됐다.

## 2026-09-08 — check 베이스라인과 2차 흡수 조사 (opencode 세션)

PR #29 `098c8ef`로 PRD v0.1 목표의 베이스라인(Blockers 4)을 닫았다. isthmus 소유
`isthmus-baseline` v1 문서, 논리 이슈 키(code·target·channel·method) 억제, `suppressed`
표시 보존, `--update-baseline` 전체 재작성(자동 prune), `staleBaselineEntries` 계수,
읽기·쓰기 상한 10,000 대칭, 원자 쓰기(temp+rename). 설계 근거는 RESEARCH의 오픈소스
조사(ESLint bulk suppressions·detekt baseline·Trivy `.trivyignore`)다. GLM 리뷰
(packet-review files 모드, effort=high) F1~F4를 전부 코드 검증 후 채택했고 기록은
PR #29 본문에 있다. 검증: `npm run verify` 전체(제품 246개, 커버리지 98.71/95.84/97.87,
Phase 0 15개, build·CLI·package 계약), CI 그린.

같은 세션에서 RESEARCH에 흡수 조사 두 건을 머지했다(#24 1차, #28 2차). 1차의 Clang USR
근거는 0.2.0 구현(#25)에 흡수됐고, 2차는 베이스라인 설계와 Blockers 3 합의 초안으로
이어졌다. Blockers 3은 양쪽 producer 소스에서 코드 근거를 확정했다: cartograph는
`CartographService.swift`의 `projectPath`(configuration ?? cwd)를 symlink 해결 없이
`project`로 싣고, dartograph는 `_runBridges`에서 `resolveSymbolicLinksSync()`로
정규화한다. 합의 issue는 사용자가 등록했다: [cartograph#72](https://github.com/ictechgy/cartograph/issues/72)
(realpath 정규화)·[dartograph#38](https://github.com/ictechgy/dartograph/issues/38)
(모노레포 공유 루트). 초안은 isthmus#30에 보존돼 있다(세션 토큰 권한이 생성만 되고
코멘트·닫기는 403이라 열려 있음 — 정리는 사용자 몫).

## 2026-09-08 — 0.2.0 발행 완료

PR #25(계약 확장)와 #26(릴리스)은 병합됐다. 릴리스 소스는 `06aa96d`다.
npm `isthmus-cli@0.2.0`과 latest 0.2.0을 확인했고, 공개 tarball의 SHA-512가 검증한 배포
파일과 일치했다. 공개 CLI와 설치본 모두 실제 Dart→Swift 보존 왕복을 통과했다.
설치본 49개 파일도 공개 tarball과 바이트 단위로 일치한다. npm 2단계 인증은 완료됐으며
소비자 선행 배포 조건을 충족했다. 자세한 검증 기록은 [PR #26](https://github.com/ictechgy/isthmus/pull/26)에 있다.

Cartograph 0.9.0 연계 변경과 배포 기록은 [cartograph #67](https://github.com/ictechgy/cartograph/pull/67)을 본다.
함수 간 값 전파는 아직 구현하지 않았으며, 심볼 도달성과 구분한 재현/설계 검토가 포함됐다.
기존 `.gitignore` 변경은 사용자 소유로 계속 보존한다.


## 2026-09-08 — issue #64 브리지 범위 확장 (리뷰 준비)

`feat/bridge-coverage-scopes`에서 선택적 v1 `limitationScopes`와 Objective-C 구현 표식,
`omittedObjectiveCHandlers` 왕복을 구현했다. 소비자 isthmus를 먼저 배포한다. 범위를 모르는
한계는 전체 target에 계속 적용한다. Objective-C 일반 공백은 일부 리터럴을 읽어도 좁히지 않는다.
Clang 인덱스가 있으면 실제 `c:` USR을 유일한 선언 위치에서 붙인다. 일반 분석은 Swift 전용이다.
코퍼스의 실제 Clang USR·Dart/Swift 보존 왕복·고정 battery_plus 검증을 통과했다.
Cartograph 718 tests, coverage 93.59%, CLI/실제 인덱스 코퍼스/dead·cycles(타입 포함)·rules 통과.
Isthmus `npm run verify` 통과. GLM packet-ask 검토 지적은 실패 재현 뒤 보완했다.
후속 요청: CodeQL/Semgrep의 근거 있는 장점과 상수·Needle DI·스토리보드 분기 사각지대를 점검한다.

_Last updated: 2026-09-10 (retentions 다중 호출자 근거 — Blockers 5 절반 종결)_

## Goal

Flutter Dart ↔ Swift의 bridge facts를 조인해 호출 근거·불일치·외부 retention을 제공한다.
작업 규칙의 정본은 [AGENTS.md](AGENTS.md)이며 CLAUDE.md는 이를 참조한다.

## Current Status

- 0.3.0 릴리스 소스는 `92b160b`(PR #34)다. 이후 인수 문서 변경은 배포 파일을 바꾸지 않는다.
- npm `isthmus-cli@0.3.0`이 최신 발행본이고 registry latest도 0.3.0이다(2026-09-09 발행,
  tarball·발행본 검증은 위 "0.3.0 발행 완료" 절). CHANGELOG Unreleased는 비어 있다.
- **0.1.5는 저장소보다 앞서 나갔다.** 발행 시점의 작업 트리가 기능 브랜치여서 아직 머지하지
  않은 #15가 tarball에 담겼다. unpublish 대신 #15를 머지하고 0.1.6으로 두 상태를 맞췄다.
  0.1.5는 registry에 남아 있고 코드 내용은 0.1.6과 사실상 같다.
- 로컬 `.gitignore` 미커밋 수정은 사용자 소유로 보존한다. 커밋 요청이 오면 별도 브랜치에서 다룬다.
- 이전 세션들이 남긴 plus_plugins 조사 메모 두 건은 **0.1.5~0.1.6 세션에서 실제 producer로
  재현됐다.** ObjC 항목은 재현 뒤 수정까지 끝났고(#15, target 귀속 후에도 동작 보존 #18,
  cartograph 0.10.1의 ObjC 사실 추출로 대부분 해소), 경로 정규화 항목은 2026-09-09
  cartograph 0.10.1·dartograph 0.5.0·계약 명문화로 닫혔다(Blockers 3 종결).

## Completed

- PR #4 `30e0396`: 실제 cartograph·dartograph 생산부터 isthmus retention, dead/explain까지 검증.
- PR #7 `e08ad85`: `diff --before <files...> --after <files...> [--strict]`.
- PR #8 `a73222d`: 0.1.4 버전·CHANGELOG·설치 안내 갱신과 배포.
- PR #9 `b2eebfa`: 루트 AGENTS 정본, CLAUDE 참조, src/scripts/docs/experiments별 지침.
- PR #11 `a5ea24a`: 조인 플랫폼 구성 fail-closed와 입력 오류 원인 구분.
- PR #12 `122fca6`(이전 세션): 보고 없이 사라지던 관찰 두 곳을 닫았다.
  - 조인에서 제외한 사실을 isthmus가 직접 세어 `tool`이 `isthmus`인 limitation으로 낸다.
    `unjoined-dynamic-channels`·`unjoined-dynamic-methods`·`unjoined-unattributed-handlers`.
    생산자의 신고 여부와 신고한 개수에 의존하지 않는다. 같은 위치 중복은 증거 dedup과 같은
    규칙으로 한 번만 세고, dynamic이면서 미귀속인 핸들러는 dynamic으로만 센다.
  - `retentions --for cartograph`가 수신 측 Swift 문서를 요구하고, 호출자가 있는데도 `symbol`이
    없어 근거로 바꿀 수 없는 매치 핸들러가 있으면 부분 문서 대신 종료 코드 2로 실패한다.
- PR #13 `8b1c285`(이전 세션): 0.1.5 버전·CHANGELOG·README 상태 갱신.
- PR #15 `9029a4e`(이전 세션): 수신 측이 신고한 분석 공백을 심각도에 반영한다.
  Objective-C로 쓰인 Flutter 핸들러처럼 수신 측 분석에 나타날 수 없는 코드가 있으면
  "핸들러 없는 호출"과 "등록 없는 채널 생성"을 error가 아니라 `-unverified` 경고로 낸다.
  증거와 한계는 그대로 남기고 `--strict`를 실패시키지 않는다. 공백의 종류를 나눠 채널
  진단과 메서드 진단을 따로 판단하고, 호출 측 한계는 심각도를 바꾸지 않으며, 알려진
  접두사만 인정한다.
- PR #16 `bc497d2`(이전 세션): 0.1.6 준비와 발행 사고 정정. npm 발행 완료.
- PR #18 `f074bab`(이번 세션): `JoinLimitation`에 target 귀속 추가. check 완화 단위를
  조인 전체에서 진단의 target으로 좁혔다(Blockers 1의 GLM 변형 절반 닫힘). 사실 없는
  수신 문서(target null)의 공백은 귀속 근거가 없어 전체 적용 유지(공존 조합 테스트
  고정). `unjoined-*` 접두사는 tool isthmus만 인정(리뷰 M1 fail-open). mixed-targets
  문서 한계는 null 귀속. diff 비교 키·DOT/Mermaid 주석에 target 반영. 골든 3종에
  `"target": "flutter"` 추가. GLM 리뷰 1회: 11건 중 8건 채택, 3건은 이유를 기록하고
  미채택(PR 코멘트 참조).
- PR #20 `a25bbf6`(이번 세션): 0.1.7 버전·CHANGELOG·README 상태 갱신과 npm 발행.
  발행 후 registry·tarball·발행본 실행 검증 완료.
- PR #22 `a60ebe9`(이번 세션): 완화 범위 축소 제안(방향 A·B + 합의 질문 4개)을
  RESEARCH에 추가. cartograph 0.8.2 소스와 실측 문서를 clone해 1차 출처로 근거를 댔다.
  합의 issue는 [cartograph#64](https://github.com/ictechgy/cartograph/issues/64)(사용자 등록,
  토큰에 자매 저장소 issue 쓰기 권한이 없음).
- PR #24 `982e67f`·#28 `d103634`(이번 세션): 오픈소스 흡수 조사 두 건을 RESEARCH에 기록.
  1차(베이스라인·Clang USR·SCIP·SARIF·realpath), 2차(Trivy 만료일·Semgrep baseline-commit·
  Pub Workspaces/Melos·oxc/knip·CodeQL 비흡수). cartograph#64 코멘트로 Clang USR 근거 전달.
- PR #29 `098c8ef`(이번 세션): check 베이스라인(`isthmus-baseline` v1, `--baseline`·
  `--update-baseline`). GLM 리뷰 F1~F4 채택(쓰기 상한·원자 쓰기·멱등 apply·JSON 오류
  분류). Blockers 4 닫힘.
- PR #25 `5fded38`·#26 `a25bbf6`·#27 `a2f0952`(별도 세션): 선택적 v1 `limitationScopes`·
  ObjC `sourceLanguage`·clang USR·`omittedObjectiveCHandlers`·`origin: consumer` 구현과
  0.2.0 발행, 그 기록. cartograph#65·0.9.0이 생산자 측.
- PR #31·#32·#35·#38·#39·#40·#41(이번 세션): 이 문서 갱신 일곱 번(베이스라인 머지,
  Blockers 3 합의 issue, 0.3.0 발행, toolchain 경계, 통합 검증 그린 등).
- PR #33 `f33d31b`(이번 세션): README 영문 전환 + 퇴고한 한글본 `README.ko.md` 분리
  (cartograph 관례, tarball 동봉). GLM 리뷰로 영문 문법·양 문서 대조·기술 정합성 점검.
- PR #34 `92b160b`(이번 세션): 0.3.0 릴리스 준비와 npm 발행(발행·검증 기록은 위 절).
- PR #43(이번 세션): `verify-limitation-scopes.mjs` 스코프 양성 종단 검증(인과 대조 포함)과
  사용법 테스트, RESEARCH 실측 절·README 양문·scripts AGENTS 안내. Blockers 1 완전 종결.
- PR #44(이번 세션): 구조·보안·성능 리뷰(2026-09-10) 반영 — 베이스라인 원자 쓰기 경화
  (`src/cli/atomic-write.ts`, 무작위 임시 이름·`wx` 배타 생성, 테스트 4종)와 GRAPH-EXCHANGE
  `limitations` 문자열 동작 명문화. 리뷰 기록은 RESEARCH 해당 절.
- PR #46(이번 세션): 사용자 소유 `.gitignore` 수정 커밋(Phase 0 산출물·serena 무시).
- PR #47(이번 세션): `check --format sarif` SARIF 2.1.0 리포터(리뷰 반영 포함).
- PR #36 `601dcde`·#37 `8d04dfd`(이번 세션): GRAPH-EXCHANGE에 project POSIX realpath
  정규화 조항과 "생산자가 선언한 조인 루트" 조항 명문화. cartograph#72→#73(0.10.1),
  dartograph#38→#52(0.5.0) 합의의 isthmus 쪽 이행. #36은 GLM 리뷰 P1×2·P2×4·P3×3 반영.
- isthmus#30(합의 초안 보존 issue)은 목적 달성 후 사용자 닫기.
- PR #14 `67de008`·#17 `d3e5ab7`(이전 세션): 이 문서 갱신 두 번. #14는 blocker 재현 기록,
  #17은 0.1.6 발행과 사고 경위.

## Key Files & State

- [교환 계약](docs/GRAPH-EXCHANGE.md): 조인 규칙에 "세는 주체는 소비자", 완화 단위가
  진단의 target이라는 것, 보존 문서 부분 생성 금지를 명시했다. 변경 전에 producer/consumer
  영향을 확인한다.
- `src/join/join.ts`: `limitationTarget`이 mixed-targets 문서를 null로 귀속시키고,
  `countFactsByPlatformTarget`가 조인 제외 사실을 (platform, target)별로 센다.
  `unjoinedFactKey`를 JSON으로 만드는 이유는 `channel`이 null일 수 있어서다(주석 참조).
- `src/report/retentions.ts`: `validateCartographRetentionInputs`(Swift 문서 요구)와
  `rejectUnresolvedSwiftHandlers`(심볼 없는 매치 핸들러 거부).
- `src/report/check-report.ts`: `receiverCoverageGaps(target)`이 수신 측 한계를 "핸들러를
  가리는 공백"과 "등록을 가리는 공백"으로 나누고 진단의 target별로 완화한다. 접두사
  목록은 닫혀 있고 계약이며, `unjoined-*`는 `tool`이 isthmus인 항목만 인정한다.
- `src/report/diff.ts`·`src/report/graph.ts`: 한계 비교 키와 텍스트 주석
  (`platform/target/tool`)에 target을 싣는다.
- `src/cli/check-command.ts`: typed 입력 오류(bridge-facts 4종 + baseline 읽기·JSON·계약·
  크기·쓰기·쓰기 상한)와 공유 매퍼 `inputFailureResult`. 보간값은 숫자 `inputPosition`·
  `MAX_BASELINE_ENTRIES`와 parse/baseline의 정적 `reason`뿐이다.
- `src/report/baseline.ts`: `isthmus-baseline` v1 parse/create/encode/apply. 항목 키
  `baselineEntryKey`는 diff의 이슈 비교 키와 동일하다(단일 원천). apply는 키 교집합
  기반이라 멱등이고, 억제는 `suppressed: true` 표시로 사실·증거를 보존한다.
- `experiments/phase-0/expected/{check,graph,query}.json`: limitations가 `target` 필드를
  담는다. `join.json`은 `{platform, message}` 투영이라 JoinLimitation 형태 영향이 없다.
- [README](README.md): `tool`이 `isthmus`인 한계 세 종류, target별 완화 단위, retentions
  거부 조건, 출력 문서 버전 1의 호환 변경 정책을 설명한다.
- [RESEARCH](docs/RESEARCH.md): "완화 범위 축소 제안 (2026-09-08)"이 Blockers 1의 합의
  초안이다(방향 A: cartograph의 ObjC Flutter 핸들러 사실화, 방향 B: 공백 limitation의
  채널 스코프 접미사). 실측 근거와 isthmus 쪽 구현 약속·합의 질문이 들어 있다.

## Important Context / Decisions

- 확인된 사실: 제품 CLI는 파일만 읽는다. producer 실행은 integration 검증 스크립트의 책임이다.
- 관찰 손실은 생산자 신고에 의존하지 않는다. 계약이 "limitations로 센다"고 정한 항목은
  소비자가 직접 센다. 생산자 문자열은 원인 설명이지 신뢰의 근거가 아니다. `unjoined-*`
  접두사도 그래서 tool이 isthmus인 항목만 완화 근거로 인정한다(#18).
- 완화 단위는 진단의 target이다(PR #18). target null(사실 없는 수신 문서)의 공백은
  귀속된 수신 문서가 공존해도 모든 target에 적용한다 — 수신 문서 여러 개가 소스 트리를
  나눴을 수 있어 귀속 없는 문서의 소스가 어떤 target의 핸들러든 가릴 수 있다(리뷰 M2에서
  "귀속 문서가 있는 target에는 미적용" 축소는 불건전으로 기각). 같은 target 안의 문서
  간 완화(kotlin(flutter) 공백이 swift(flutter) 증거 진단도 완화)는 파일·채널 범위
  limitation 도입 때 재검토 지점이다.
- mixed-targets 문서의 선언 target은 대표값이라 한계 귀속에 쓰지 않고, 계수도 null
  귀속으로 남긴다. 귀속을 잃어도 관찰은 보존한다.
- isthmus 출력 문서(isthmus-check/graph/query/diff)는 버전 1 안에서 필드 추가·새 이슈
  code를 호환 변경으로 다룬다(README 명문화, #15의 code 추가 선례와 동일 방침).
- 근거가 빠진 보존 문서는 만들지 않는다. 부분 목록은 소비자에게 살아 있는 핸들러를 미사용으로
  보이게 하므로, 만들 수 없으면 종료 코드 2로 실패한다.
- 노출하는 오류 메시지는 정적 문자열·숫자만 보간한다.
- **producer 릴리스는 cartograph 0.10.1(realpath 수정)·dartograph 0.5.0(공유 루트,
  pub.dev 2026-09-09 확인)**이다. 두 통합 검증 스크립트가 이 조합 + isthmus 0.3.0으로
  통과했다(최상단 절). 설치본: brew cartograph 0.10.1(확인), 샌드박스 `PUB_CACHE`
  dartograph 0.5.0(활성화·실측) — **호스트 `~/.pub-cache`의 dartograph 업그레이드만
  사용자 몫으로 남았다**. README/스크립트의 최소 버전 게이트(cartograph 0.5.3·
  dartograph 0.1.1)는 그대로다.
- PR #12에서 의식적으로 제외한 항목: 모노레포 project 재기준화, ObjC 진단 정책, retentions
  다중 caller evidence, query `notFound` 종료 코드, check 베이스라인, RN/Kotlin/EventChannel.
- Windows CI는 보류: `src/script-security.test.ts` 하네스의 shebang·chmod·TMPDIR 의존 때문이다.

## Verification

최근 세션에서 직접 확인한 결과:
- `npm run verify` 전체 통과(#34 기준): typecheck, 제품 246개, Phase 0 조인 15개;
  커버리지 게이트 충족. `Package contract verified: isthmus-cli@0.3.0`.
  `verify-cli-contract.mjs`에 발행 CLI 베이스라인 왕복 시나리오(update→strict+baseline
  억제 3·stale 0·코드 0, 손상 파일 코드 2)가 포함됐다.
- 통합 검증 그린: roundtrip·공개 플러그인 모두 cartograph 0.10.1 + dartograph 0.5.0 +
  isthmus 0.3.0으로 통과(세부·스코프 실측은 최상단 절).
- 스코프 dogfood: `verify-limitation-scopes.mjs` 통과 — 양성 스코프 실발행과 채널 단위
  완화 종단(동일 버전 조합, 2026-09-09 세션 최상단 절).
- PR #18~#41 전부 CI 두 잡(ubuntu-latest, macos-latest) 그린 후 squash 머지.
- GLM 리뷰 기록: #18(11건 중 8건 채택), #29(F1~F4 채택), #33(영문 퇴고 — 과장 지적
  1건은 제품 불변 조건으로 기각), #36(계약 조항 P1×2·P2×4·P3×3 반영), #43(빌드 타임아웃·
  스키마 가드·인과 대조 채택, 이슈 순서·default 의미론·버전 하한은 실측·코드로 기각).
  전부 packet-review files 모드·effort=high, 채택/기각 근거는 각 PR 본문·코멘트. #37은
  합의 원문 전사라 생략(사유 기록).
- 0.3.0 발행 검증은 위 "0.3.0 발행 완료" 절, 0.2.0은 해당 절과 PR #26, 0.1.7은 #21
  시점 기록을 본다.
- Blockers 3 코드 근거(2026-09-08, clone으로 직접 확인): cartograph
  `CartographService.swift` `projectPath = configuration.projectPath ?? cwd`(symlink 미해결,
  `project:`로 직행) vs dartograph `dartograph_cli.dart` `_runBridges`의
  `Directory(root).absolute.resolveSymbolicLinksSync()`. 당시 dartograph에 공유 루트
  옵션이 없었음(→ 0.5.0에서 `--project`·pub workspace 감지로 구현됨).

## Blockers & Open Questions

배포 blocker는 없다. 0.3.0까지 발행을 마쳤고 통합 검증도 전체 그린이다.

1. ~~**완화 범위**~~ — **완전 종결(2026-09-09).** target 절반은 #18, 파일·채널 절반은 #25의
   선택적 v1 `limitationScopes`(입증된 채널 상한만, 무범위는 target 전체 유지)로 닫혔고
   0.2.0/cartograph 0.9.0으로 양쪽 배포됐다. 남아 있던 양성 실측(실제 producer의 스코프
   발행 + 채널 단위 완화 종단)을 `verify-limitation-scopes.mjs`로 완료했다(최상단 절).
   스코프 없는 공백의 target 전체 완화는 설계대로 유지된다.
2. **ObjC 핸들러의 retention — 대부분 닫힘.** #25가 `sourceLanguage: objective-c`와
   clang 인덱스의 실제 `c:` USR을 보존하고, Swift 그래프 밖 매치는
   `omittedObjectiveCHandlers`로 센다(근거 없는 부분 문서 대신 계수 보고). 남은 것:
   인덱스 없이 빌드된 환경의 ObjC 핸들러 신원(fallback 문법 후보는 RESEARCH의 SCIP).
3. ~~**모노레포 project 기준**~~ — **완전 종결(2026-09-09).** realpath 절반은
   cartograph#73(0.10.1), 공유 루트 절반은 dartograph#52(0.5.0)로 구현되고
   GRAPH-EXCHANGE에 "생산자가 선언한 조인 루트" 정의로 명문화됐다. isthmus 코드
   변경은 없었고(정확 문자열 일치 유지), 왕복 실측은 dartograph 쪽에서 설치본
   isthmus로 완료. 로컬 설치본 업그레이드(brew cartograph 0.10.1, pub global
   dartograph 0.5.0) 후 통합 스크립트 재실행만 남았다.
4. ~~**check 베이스라인**~~ — **닫힘(#29)**: `isthmus-baseline` v1, 논리 이슈 키 억제,
   `suppressed` 표시 보존, 자동 prune, stale 계수. 만료일(Trivy `exp:`)은 미구현
   후보다(자동 prune+stale로 위생 확보 판단).
 5. **retentions 대표 증거**: **절반 종결(2026-09-10).** isthmus가 `evidence.callers`·
    `callersOmitted`(v0 additive)를 실는다 — 하위호환은 설치본 cartograph 0.10.1로
    실측(dead 억제·explain 정상). 남은 것은 cartograph의 callers 렌더링 합의·구현
    (issue 초안은 세션 tmp, 최상단 절).
6. ~~**관찰량 미노출**~~ — **닫힘(2026-09-10)**: `isthmus-check` summary에
   `observedFacts`·`observedLimitations` 추가(호환 변경). 조인 보류 결과도 관찰량
   보존. Phase 0 골든 재생성 포함.

RN·Kotlin·Event/Basic 채널 지원은 별도 계획이다. 새 종류는 계약을 먼저 합의한다.

## What Worked

- 개선점을 빌드된 CLI 실행으로 실증한 뒤 우선순위를 정하고, 재현 테스트를 먼저 썼다.
- 계약 문서와 구현을 대조해 "강제되는 절반과 신고에만 의존하는 절반"을 찾았다.
  `channel: null`은 parse에서 fail-closed인데 `dynamic`은 아무 강제가 없었다.
- 자매 저장소 소스를 읽어 생산자의 의도를 확인했다. cartograph의 주석이 ObjC 한계를 왜 내는지
  직접 설명하고 있어, 소비자 쪽 미구현임을 코드 근거로 확정할 수 있었다. #22 제안도
  cartograph를 clone해 스캐너 코드(`ReactNativeMacroScanner`)와 실측 문서
  (`docs/scans/2026-09-flutter-plugins.md`)를 1차 출처로 삼았다 — 과완화 실례
  (flutter_local_notifications 이슈 20건 중 `.m`이 가리는 것은 1건)가 이미 그 문서에 있었다.
- 리뷰 지적을 코드로 검증했다. 채택 2건은 실제 비대칭·테스트 공백이었고, 구분자 키 제안은
  `channel`이 null일 수 있다는 기존 테스트로 반증했다. #18에서도 11건 중 8건 채택·3건
  기각을 모두 코드 근거로 판정했다.
- 샌드박스 안에서 GLM 리뷰의 유일한 경로는 PATH의 `packet-review`(감독자 브리지)다.
  스크립트의 `--diff` 모드는 깨져 있다(bash 3.2 빈 배열 `set -u` 충돌 + 감독자 검증이
  files 필수·diff 배타를 동시에 요구). 파일 목록 모드(`--files <변경 파일들>`, 질문은
  `--question-stdin`)가 실제로 동작한다. 스크립트가 깨진 경우 같은 프로토콜(payload
  JSON을 `$TMPDIR/packet-requests/$id.json`으로, `$id.result.md` 폴링)을 재현해
  제출하는 것은 우회가 아니라 문서화된 사용이다.
- Phase 0 결정성 테스트가 첫 구현의 중복 카운트 부풀림을 잡았다. 골든은 diff로 한 줄씩 대조했다.

## What Did Not Work / Avoid

- **발행 전에 브랜치와 `git status`를 확인한다.** 0.1.5는 작업 트리가 기능 브랜치일 때
   발행돼 미출시 코드가 나갔다. `npm publish`는 checkout 상태를 그대로 담는다.
- npm 발행은 `PUT 202`로 끝나고 registry 반영은 비동기다. 직후 조회로 실패를 단정하지 않는다.
  npm 계정에 2FA가 걸려 있어 `--otp`가 필요하고, 코드가 30초면 만료되므로 사용자가 직접 실행한다.
  발행이 `PUT 404`로 실패하면 패키지 문제가 아니라 인증 문제다(레지스트리는 존재 여부를
  숨기려고 404를 쓴다). `npm whoami` → `npm owner ls isthmus-cli` → `npm config get registry`
  순서로 확인하고 `npm login`으로 재인증한다. 0.1.7 발행 시 토큰 만료로 실제 발생했다.
- 리뷰 지적을 검증 없이 반영하지 않는다. #12는 9건 중 2건, #15는 지적 2건을 코드로 반증했다.
- 샌드박스에서 `packet-ask`·`packet-ask-safe`는 돌지 않는다(설계). `packet-review`를 쓴다.
  자격증명·모델·allowlist를 고쳐 우회하지 않는다.
- 샌드박스 경계는 세션·시점별로 부분 차단되었다 열릴 수 있다(이번 세션: npm registry 403과
  GitHub CONNECT 403이 나중에 열림). 차단을 단정하기 전에 재시도하고, 막힌 상태면 사용자에게
  최소 단위(명령·패킷)로 넘긴다.
- git config가 비워져 있다(GIT_CONFIG_GLOBAL=/dev/null, HOME=격리 홈). 커밋에는
  `-c user.name=Coden -c user.email=ictechgy@gmail.com`, push에는
  `-c credential.helper=osxkeychain`을 명령 단위로 붙인다. `.git/config` 쓰기가 막혀
  `push -u`의 upstream 저장이 실패하므로 명시적 ref(`git push origin br:br`)로 push한다.
  `gh`는 임시 GH_CONFIG_DIR + `git credential fill`로 뽑은 GH_TOKEN(x-access-token)으로
  동작한다. 토큰은 출력하지 않는다. 이 토큰은 isthmus에서만 쓰기 가능하고 **자매
  저장소(cartograph) issue 쓰기는 403**이다 — 자매 저장소 쓰기 작업은 사용자에게
  명령과 본문을 준비해 넘긴다(#22에서 실제 적용).
- 미해석 결과나 관찰 소실을 코드 삭제 안전성으로 해석하지 않는다.
- 낡은 producer binary, 서로 다른 추출 범위, OS 임시경로 별칭으로 비교 결과를 오염시키지 않는다.
- cartograph는 인덱스 스토어가 없으면 종료 코드 2로 거부한다. 조사용 checkout에도 빌드 가능한
  Swift 타깃과 `swift build`가 필요하다.
- 다른 세션이 자매 저장소를 동시에 수정할 수 있다. branch/HEAD/status를 확인하고 변경을 보존한다.

## Next Steps

1. **cartograph callers 합의 issue 등록**(사용자): 초안
   `$TMPDIR/opencode/issue-cartograph-callers.md`를 ictechgy/cartograph에 등록한다.
   렌더링 구현이 되면 Blockers 5 완전 종결.
2. **ObjC 무인덱스 환경 신원 (Blockers 2 잔여)**: 인덱스 없이 빌드된 환경의 핸들러
   식별, SCIP fallback 문법이 RESEARCH 후보.
3. **SARIF 실측 여지**: GitHub 업로드 상한·suppression 자동 dismiss 동작은 실제
   저장소 업로드로 확인 필요(감독자 네트워크 제약상 세션에서 불가).
4. 베이스라인 만료일(Trivy `exp:` 방식)은 위생 후속 후보 — 자동 prune+stale로
   지금은 충분하다고 판단.
5. 태그·GitHub release가 필요한지는 이전 관행을 확인한다(0.1.4~0.3.0 모두 isthmus는
   태그가 없다. cartograph는 GitHub Release를 한다).

ObjC 재현 절차(다시 필요할 때): `package_info_plus`를 고정 커밋으로 sparse checkout하고,
인덱스용 최소 Swift 타깃을 만들어 `swift build` 후 두 producer를 돌린다. 과거의
"경로는 `/tmp` 밖" 제약은 cartograph 0.10.1(realpath 정규화, cartograph#73) 설치로
이 머신에서는 사라졌다. ObjC 핸들러는 이제 사실로 추출되므로(최상단 절) 이 재현의
목적 자체가 대부분 사라졌고, 남은 용도는 구버전 회귀 확인뿐이다.

## Resume Prompt

`/Users/jinhongan/Desktop/isthmus`에서 AGENTS.md와 HANDOFF.md를 읽고 git 상태를 확인해줘.
0.3.0까지 발행을 마쳤고(check 베이스라인 + 영문 README 포함) 0.3.0 릴리스 소스는
`92b160b`(PR #34)야 — 이 문서의 이후 갱신은 그 위에 쌓는다. Blockers는 1·3·4가 닫혔고
2는 대부분 닫혔어. 통합 검증은 cartograph 0.10.1·dartograph 0.5.0·isthmus 0.3.0 조합으로
전체 통과했고(roundtrip + 공개 플러그인 + ObjC clang USR 사실 + 스코프 발행 조건),
dartograph#38도 닫혔어. 로컬 .gitignore 미커밋 수정을 보존해줘.
발행을 요청하면 브랜치와 git status부터 확인하고 사용자에게 `--otp`로 직접 실행하게 해줘
(PUT 404는 인증 문제 — npm login 먼저). 후속 작업은 호스트 dartograph 업그레이드(사용자),
SARIF 리포터 순이야. limitationScopes 양성 실측은 완료됐어(verify-limitation-scopes.mjs,
Blockers 1 종결).
샌드박스에서 GLM 리뷰는 packet-review files 모드로 해줘(--diff 모드는 깨져 있음).
자매 저장소 쓰기와 isthmus issue 코멘트·닫기는 토큰 403이라 사용자 실행으로 넘기고,
워크스페이스 안 git init은 `.git/config` 쓰기 차단으로 불가하니 dogfood 스크립트는
tmp 사본 + isthmus-js 오버라이드로 돌려줘(최상단 절).
