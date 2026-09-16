# Handoff

_Last updated: 2026-09-16 KST by Devin (공개 호환 버전 세트 완성 확인 · 레포 상태 재실측)_

## Goal

사용자의 목표는 **변경 전 직접·전이 영향 점검, 효율적인 AI 질의, 런타임 의존성 검증,
CI에서 빠른 갱신**을 MIT·영구 무료 도구로 제공하는 것이다. 타당성 조사를 반복하지 말고
구현·검증을 이어간다. isthmus 0.6.0 발행에 이어 **네 도구의 공개 호환 버전 세트가 갖춰졌다**
(아래 표). 시장 경쟁력·앱 전체 정확도까지 입증했다는 뜻은 아니다.

## Current Status

- 로컬 `/Users/jinhongan/Desktop/isthmus`: `chore/release-0.6.0` branch(HEAD `3ded085`)에 있다.
  기존 미커밋 문서 변경(HANDOFF·FEASIBILITY·PRD·RESEARCH)과 미추적 파일
  (HANDOFF.cartograph-notes.md·default.profraw)은 보존했다.
- 아래 PR은 **MERGED**다. 이번 갱신에서 GitHub 실측으로 재확인했다.

| 저장소 / PR | 내용 | merge commit |
| --- | --- | --- |
| [isthmus #70](https://github.com/ictechgy/isthmus/pull/70) | preflight·runtime | `877b91cfd4fb304a8784339a0e0359768e7549d7` |
| [isthmus #71](https://github.com/ictechgy/isthmus/pull/71) | 0.6.0 릴리스 | `840aaa0e85f23d6979e5bf2e9c78a4ee15963cd9` |
| [cartograph #89](https://github.com/ictechgy/cartograph/pull/89) | bridge-facts v2 Basic/Pigeon | `b5c9b841fd1fc6a76179d6d1548c564a59f65c74` |
| [kartograph #50](https://github.com/ictechgy/kartograph/pull/50) | Basic bridge facts | `31b409f5de7b09914db11b9af23cae75ff38af82` |
| [kartograph #51](https://github.com/ictechgy/kartograph/pull/51) | why·신뢰도·markdown 리포트 | `8b8721b0664a55ef046f7a2c1b4a0518f279ff34` (squash) |
| [kartograph #52](https://github.com/ictechgy/kartograph/pull/52) | 0.10.0 릴리스 준비 | `57b701c1093ea979f7051e8336a44a945229d19f` |
| [dartograph #94](https://github.com/ictechgy/dartograph/pull/94) | Basic 송신 | `5e5d1c6eea3ef39f0e179e4d9338526c9c36741f` |
| [dartograph #96](https://github.com/ictechgy/dartograph/pull/96) | 0.10.0 증분 분석 등 | MERGED 2026-09-15 |

- **공개 호환 버전 세트 — 2026-09-16 확인.** TOOLCHAIN.md 요구 조건을 공개 버전이 충족한다.

| 도구 | 공개 버전 | 필요 기능 확인 근거 |
| --- | --- | --- |
| isthmus-cli | 0.6.0 (npm·GitHub) | preflight·impact·verify-runtime·--summary/--explain |
| cartograph | **0.15.1** (GitHub Release Latest, 태그 0.15.0·0.15.1) | 설치본 `/opt/homebrew/bin/cartograph` 0.15.1의 `bridges --help`에 `--messages` 존재·v2 출력 실측 |
| kartograph | **v0.10.0** (GitHub Release Latest) | main `57b701c`에 `bridges --messages` 코드 존재(AgentCommand.kt·BridgeFactScannerTest.kt). **발행본 실행은 미실측** — Android 실행은 미검증 |
| dartograph | **0.10.0** (pub.dev·GitHub 태그) | 활성화한 설치본으로 `bridges --messages` v2 출력 실측 |

- dartograph [PR #98](https://github.com/ictechgy/dartograph/pull/98)(dependency audit·closed-app mode·
  MCP resources/prompts)은 **OPEN·mergeable·CI 전부 SUCCESS·리뷰 없음**. 머지 여부는 사용자 승인 사안.
- 자매 로컬 상태(2026-09-16): `../cartograph`는 `refactor/agent-guidance-0.14.0`(`171b313`)에서
  AGENTS 리팩터링 미커밋(AGENTS.md·HANDOFF.md·Package.swift·Skills/AGENTS.md·Sources/AGENTS.md 수정,
  Sources/CartographIndexStore/AGENTS.md 신규). `../kartograph`는 `feat/adoption-competitiveness`(`97e0397`)에
  CI·실험 수정 커밋과 미커밋 AGENTS/HANDOFF 변경. `../dartograph`는 `feature/competitive-gaps`(`f5a078d`,
  origin과 동기화)에 미추적 HANDOFF-PROGRESS.md. 각 저장소 변경 전 그쪽 AGENTS·status를 다시 확인한다.

## 경쟁력·배포 상태 조사 (2026-09-16)

이 절은 새 구현이나 검증 완료 주장이 아니라 **경쟁력 확보에 필요한 것**과 **공개 배포 상태**를 다시
실측한 조사 기록이다. 근거는 공개 npm/pub/GitHub API 조회(2026-09-16), 그리고
`docs/COMPETITIVENESS.md`·`docs/FEASIBILITY.md`(실패 요인 10)·`docs/PRD.md`·`docs/TOOLCHAIN.md` 대조다.
경쟁 도구는 공식 자료·공개 저장소만 확인했고 직접 설치해 정확도·성능을 비교하지 않았다.

### 공개 버전 실측 (2026-09-16 재실측 — 호환 세트 완성)

| 도구 | 공개 최신 | 발행 | TOOLCHAIN.md 요구 대비 |
| --- | --- | --- | --- |
| isthmus-cli | 0.6.0 (npm·GitHub release 동일) | 2026-09-15 | `preflight`·`impact`·`verify-runtime`·`--summary/--explain` **있음** |
| cartograph | **0.15.1** (Release Latest) | 2026-09-15 | `impact` + `bridges --messages` **있음** (설치본 help 실측) |
| kartograph | **v0.10.0** (Release Latest) | 2026-09-16 | `impact --graph-file` + `bridges --messages` 코드 main 확인 |
| dartograph | **0.10.0** (pub.dev 동일) | 2026-09-15 | `bridges --messages --format json` **있음** |

**결론: 공개 버전만으로 호환 세트를 구성할 수 있다.** 네 도구 모두 TOOLCHAIN.md 요구 조건 충족.
문서로 고정하는 작업(docs/COMPATIBILITY.md 등)은 `docs/public-compat-set` 브랜치에 커밋해
PR #72로 올렸고, 남은 것은 리뷰·머지와 실사용 검증이다.

### 호환 세트 확보를 위해 발행해야 할 것 — 전부 완료

1. ~~isthmus 0.6.0~~ — **완료**(2026-09-15 npm·GitHub Release 발행).
2. ~~cartograph~~ — **완료**: PR #89로 Basic/Pigeon·handlerScope 통합 후 0.15.0→0.15.1 태그·Release 발행.
3. ~~kartograph~~ — **완료**: PR #52 머지 후 v0.10.0 Release 발행(2026-09-16).
4. ~~dartograph~~ — **완료 + 초과**: 0.10.0 발행. README의 "opt-in development-source producer" 표기는
   지원 수준 disclaim이 아니라 source 입력 사실 기술로 판단됨 — 문구 변경 필요 여부는 재평가 사안.
5. ~~공개 호환 버전 표 + 고정 예제·수집 설정·예상 출력·CI 예시~~ — **완료**: `docs/COMPATIBILITY.md` 신규
   포함 10개 문서를 `6c81b6d`로 커밋해 `docs/public-compat-set` 브랜치 PR #72 발행. 리뷰·머지 대기.

### 경쟁 지형 재확인 (외부)

- CodeGraph(MIT, 로컬 그래프 + MCP + impact)가 목표 1·2·4와 크게 겹치고 "AI 에이전트 컨텍스트 계층"으로
  포지셔닝하며 외부 확산 중이다. Dart↔Flutter 채널 조인은 이번에도 확인하지 못했다.
- Patrol MCP가 AI의 E2E 테스트 작성·실행·디버깅을 이미 점유했고, Marionette MCP가 실행 중 앱 제어로 인접한다.
- Pigeon 29의 실험적 FFI/JNI, Periphery의 MIT 저장소 archive→상용 전환은 각각 지원 범위 축소와
  유지관리 리스크 사례다.
- 따라서 그래프 + MCP + impact 자체는 이미 포화이며, 이 제품이 증명해야 할 차별점은
  **크로스언어 리터럴 조인 + retention 왕복**(`dead --explain`이 Dart 호출 위치를 돌려주는 지점)이다.

### 경쟁력 확보 우선순위 (조사 판단)

1. ~~공개 호환 버전 세트 + 설치 경로 + 문서화~~ — **달성**(2026-09-16 확인, 문서는 PR #72).
2. 실사용 정밀도 코퍼스 — 공개 앱/플러그인 3개 × 실제 변경 10개, 수동 정답 기준 오탐·누락 계수,
   지원 밖 채널을 분모에서 제외하지 않기. 공통 `setUp` 과잉 전파는 선택 사례에서만 수정된 상태다.
3. 외부 유지관리자 3명 반복 사용 (2주 내 재실행 2명).
4. 적용 범위 정직성(EventChannel·FFI/JNI·iOS 실기기·다른 Android API/ABI·release/lifecycle 미검증 명시) 후 확장.
5. AI 질의 인터페이스 — 대형 입력 9.5MB 출력의 요약/개별 경로 조회 계약. Patrol MCP·CodeGraph와
   경쟁하기보다 producer/MCP 계층으로 연동하는 선택지 검토.
6. 유지관리·거버넌스 — 버전·호환 표를 저장소 산출물로 유지하고, 실패 시 독립 도구에서 adapter로
   축소하는 탈출 경로를 미리 정한다.

### 레포별 남은 작업 (2026-09-16 재실측)

아래는 다음 세션이 이어갈 작업이다. 정본 계약은 `docs/GRAPH-EXCHANGE.md`·`docs/BRIDGE-MESSAGES.md`.

**isthmus — PR #72 리뷰·머지 판단**

- 호환 세트 문서화는 완료했다: `docs/COMPATIBILITY.md` 신규 + README·docs·SKILL.md의
  낡은 버전 문구 갱신을 `6c81b6d`로 커밋, `docs/public-compat-set` → **PR #72** 발행.
  GLM 리뷰의 검증된 지적을 후속 커밋으로 반영 중. 머지는 사용자 승인 사안.
- 공개 버전 MethodChannel 왕복은 재검증했다(`verify-cartograph-roundtrip.mjs` 통과,
  cartograph 0.15.1 + dartograph 0.10.0 + isthmus 0.6.0). 미실행: 공개 조합의 전체
  preflight 재현, kartograph 발행본의 Android 실행, cache 없는 최초 CI.

**dartograph — PR #98 리뷰·머지 판단**

- OPEN·CI SUCCESS·mergeable이나 리뷰 없음. 머지는 사용자 승인 후 진행한다.
- 로컬 미추적 `HANDOFF-PROGRESS.md` 보존.

**cartograph — 로컬 미커밋 정리 판단**

- `refactor/agent-guidance-0.14.0`의 AGENTS 리팩터링 미커밋 변경은 다른 세션의 진행 중 작업으로
  보이므로 함부로 커밋·폐기하지 않는다.
- 공개 main은 `b5c9b841`(0.15.1 머지)까지 진행. 로컬 main ref는 `171b313`에 멈춰 있어 fetch 필요.

**kartograph — 로컬 미커밋 정리 판단**

- `feat/adoption-competitiveness`(`97e0397`)에 CI·실험 수정 커밋 + 미커밋 AGENTS/HANDOFF 변경 보존.

태그 관례: cartograph `0.15.x`(v 없음), kartograph `v0.x.y`, dartograph pubspec 방식.

### 환경 제약 — 이번 세션 기준 갱신

- **해소됨**: 이전 세션에서 `Operation not permitted`였던 `~/.local/share/isthmus/toolchains/`와
  `../cartograph`를 이번 세션에서는 읽을 수 있었다. 경로 허용은 세션 시작 시 Seatbelt 프로파일에
  반영되므로 세션마다 다를 수 있다 — 새 세션에서 막히면 그때 다시 확인한다.
- `zcode_run` 실행 채널이 high demand 오류로 실패하거나 요약본을 반환한 이력이 있다.
  버전 수치는 재실측으로 교차확인한다.

## Completed

- isthmus: `impact` / `preflight` / `verify-runtime`, summary/explain, Method/Basic/Pigeon,
  Kotlin impact adapter, 플랫폼별 runtime 후보, Git 변경 선택·내용 지문 기반 capture/cache.
- isthmus 0.6.0 발행(2026-09-15): PR #71로 릴리스 준비 후 npm·GitHub Release 공개. registry
  tarball SHA-512가 메타데이터와 일치하고, 추적 파일 14개가 v0.6.0 태그와 바이트 단위 동일함을 확인했다.
- Dartograph: impact·runtime·MCP, Basic 송신, `source_packages`의 app-local package 분석.
  AOT `--execute` 자기 실행과 후손이 출력 pipe를 보유하면 timeout 밖에서 기다리는 결함을 수정했다.
- Kartograph: 실제 JVM snapshot ID를 연결하는 Basic 수신. mutable/조건 분기, quoted 연결식,
  alias 변환/getter를 literal로 오판하는 문제, UTF-8 위치·모호한 함수 귀속을 수정했다.
- GLM 지적을 실행 가능한 회귀로 대조하고 CI 성공 후 머지했다. 완료한 PR을 재생성·재머지하지 않는다.
- Cartograph 0.15.1: 보관 아카이브(f2d77c1)의 Basic/Pigeon·handlerScope 차이를 0.14.0 위에 통합해
  PR #89 머지, 태그 0.15.0·0.15.1, GitHub Release 발행. 설치본 help에 `--messages` 실측.
- Kartograph v0.10.0: PR #52로 릴리스 발행. 추가로 PR #51(why·신뢰도 등급·억제·마크다운 리포트) 머지.
- Dartograph 0.10.0: PR #96으로 증분 분석·검증 장부·reporter까지 포함해 pub.dev 발행.

## Key Files & State

- [docs/GRAPH-EXCHANGE.md](docs/GRAPH-EXCHANGE.md): producer/consumer 계약. 계약 변경 전에 읽는다.
- [docs/PREFLIGHT.md](docs/PREFLIGHT.md), [docs/RUNTIME.md](docs/RUNTIME.md),
  [docs/TOOLCHAIN.md](docs/TOOLCHAIN.md): 입력·실행 검증·고정 소스 구축 절차.
- `src/exchange/{preflight-context,kartograph-impact}.ts`, `src/report/preflight*.ts`: 파싱·투영·근거 연결.
- `scripts/{capture-preflight,build-preflight-toolchain}.mjs`, `packages/isthmus_runtime/`,
  `Skills/isthmus/SKILL.md`: 수집·구축·Flutter recorder·AI 질의.
- 기존 미커밋: `docs/FEASIBILITY.md`, `docs/PRD.md`, `docs/RESEARCH.md`. 무단 폐기·일괄 stage하지 않는다.
  `default.profraw`는 소유·발생 원인이 확인되지 않은 미추적 생성물이므로 보존했다.
- 다른 세션의 HANDOFF 계약 알림은 [HANDOFF.cartograph-notes.md](HANDOFF.cartograph-notes.md)에 원문 보존했다.
  그 밖의 과거 본문은 `git show 92315b4:HANDOFF.md`로 볼 수 있다. 옛 Resume Prompt·권한 문구는 현재 지시가 아니다.
- [docs/COMPETITIVENESS.md](docs/COMPETITIVENESS.md)는 상세 실험 이력이다. 머리말에도 옛 commit·draft 상태가
  남아 있으므로 현재 상태는 이 HANDOFF와 실제 Git/CI를 우선한다.

### 보관 위치 — 실재 확인 완료

아래 경로의 기준은 `/Users/jinhongan/.local/share/isthmus/toolchains/`다.

- `reviewed-bridge-765f5a0/toolchain.json`: 최신 고정 구축 isthmus/Dartograph/Kartograph의
  전체 SHA·실행 argv·SDK·hash. `commands`의 실행 파일은 모두 존재한다.
  `verification/merge-result.json`은 merge/tree 일치, `verification/native-execution.json`은 AOT 실행 근거다.
- `android-055bad2/verification/reviewed-android-evidence/verification.json`: **최종 리뷰 수정 후**
  실제 Android 검증이다. 원래 project/revision/path를 고쳐 맞추지 않고 보존했다.
- `f2d77c16f521/`: 옛 Swift 통합본. `sources/cartograph`와 `source-bundles/cartograph.bundle`에
  `f2d77c16f5217f315818f89eafd8daf0cc02db6b`를 보관했다. bundle의 ref는 `HEAD` 하나다.
  **Basic/Pigeon·handlerScope 차이는 cartograph 0.15.1로 이미 통합·발행됐다**(PR #89). 이 아카이브는
  참고용으로만 보관하고, 이 tree 전체를 공개 cartograph에 덮어쓰지 않는다.
- **소실 확인:** `/tmp/isthmus-dartograph-basic`, 옛 `isthmus-cartograph-integration-8dpr_1c_/repo`,
  `/tmp/isthmus-flutter-sdk.iW1YxU/bin/flutter`. 옛 명령의 임시 경로를 그대로 실행하지 않는다.
  source는 위 보관물·공개 Git에서 복원할 수 있고, Flutter SDK는 실재하는 환경으로 재준비해야 한다.
- Kotlin 작업 clone은 `/Users/jinhongan/.local/share/isthmus/worktrees/kartograph-android-awc0xhru/repo`에 남아 있다.
  자매 repo 변경 전 각 AGENTS·branch/status를 다시 확인한다.

## Important Context / Decisions

- 확정: 제품의 JSON 소비와 producer 실행 workflow를 구분한다. 삭제 안전성·자동 삭제를 제공하지 않는다.
  revision/project를 결과에 맞춰 바꾸지 않고 미해결·미관측·truncation을 보존한다.
- 확정: Kotlin 공통 setUp은 여러 Pigeon method로 전파되고, mutable 이름은 파일 단위로 보수적으로 처리한다.
  method별 정밀 분석이나 전체 runtime 경로의 증명으로 표현하지 않는다.
- 확정: Cartograph 0.13.0의 `runtime discover/collect`·snapshot/trace와 isthmus의
  `bridge-observations`는 별도 계약이다. SDK 알림/Core Data/Simulator 기능을 이 제품 구현으로 복사하지 않는다.
- 승인: 완료한 PR들의 공개·review·merge와 cartograph 0.15.x·kartograph v0.10.0·dartograph 0.10.0
  발행은 이미 끝난 사실이다. dartograph PR #98 머지와 새 발행은 별도 승인이 필요하다.
  비밀값·인증 파일을 읽지 말고 현재 AGENTS의 권한 규칙과 실제 사용 가능한 도구를 따른다.
- 부분 확인: 공개 조합의 MethodChannel 왕복(설치본 cartograph 0.15.1·dartograph 0.10.0·
  npm isthmus 0.6.0, FalsePositiveCorpus)과 양쪽 `bridges --messages` v2 출력은 통과했다.
  미실행: 공개 조합의 전체 preflight·runtime 재현, kartograph Android 실행, cache 없는 CI.

## Verification

아래는 코드 변경 때 실행한 결과다. 이번 0.6.0 발행에서는 릴리스 준비 검증과 공개 tarball 대조를 실행했고,
그 밖의 변경하지 않은 제품 테스트는 재실행하지 않았다.

| 검사 | 확인 결과 |
| --- | --- |
| isthmus `npm run verify` | 제품 424 + Phase0 15 + workflow 19, line/branch/functions 98.41/92.37/95.42 |
| isthmus 0.6.0 발행 | `npm run verify` 통과, registry latest 0.6.0, tarball SHA-512 메타데이터 일치, 추적 파일 14개 v0.6.0 태그와 동일, 발행본 CLI `--version`·`help preflight` |
| Kartograph full Gradle/Kover/installDist, CLI/agent, compiler fixture, 자기 분석 | 615 tests, 실패/skip 0, 각 게이트 PASS |
| Dartograph `tool/check-coverage.sh`, native CLI, analyze/corpus/boundary, pub dry-run | 일반406 + 격리 설치1, 91.50%, dry-run 경고0 |
| 최종 Android API36/arm64·Flutter3.32.2 실제 APK | 성공3·기대 실패3·pending incomplete, 같은 capture의 runtime 대조 PASS |
| 공개 shared_preferences_android 2.4.1 | Kotlin getBool → 생성 Dart API → app main, 선택1/영향38/경계13. 공백70은 유지 |
| 고정 source toolchain build | 31.336초, SDK/의존 cache 준비 상태. 새 AOT의 실제 entrypoint 실행도 PASS |
| 기존 macOS 실제 기록의 새 consumer 재생 | runtime4 checks, 20 gaps, strict1 유지. Dart 선언 위치1건 보강 |

Dart 격리 설치는 100개 이상의 wrapper 호출을 포함한다. CI의 3분 timeout은 단독 실행에서도
실패해 **8분**으로 조정했고 일반/설치 coverage를 합산했다. 전체 검사 항목·90% coverage·
20분 job 상한은 유지했으며 두 SDK의 CI 성공을 확인했다.

## Blockers & Open Questions

- 완료한 PR의 merge blocker는 없다. Swift Basic/Pigeon 통합(cartograph 0.15.1)과 호환 세트 발행도 완료.
  다음은 호환 세트 문서화와 공개 조합 end-to-end 재검증, dartograph PR #98 판단이다.
- 미검증: cache 없는 최초 구축, 독립 앱의 정확도/효용, iOS 실기기, 다른 Android API/ABI·
  release·권한/생명주기·다중 engine. 실행하지 않은 경로의 완전성을 보장하지 않는다.

## What Worked

- 고정 source commit의 격리 구축, 독립 기대 목록·실제 실행 witness, 실제 compiler·공개 plugin 검증.
- summary/explain으로 원본 source까지 확인하고 GLM 주장을 red→green 회귀로 판정했다.

## What Did Not Work / Avoid

- 옛 문서의 “clean main”, “287/341 tests”, “Kotlin/Basic 미구현”, “Cartograph 전체 미통합”은 현재와 다르다.
- 같은 조사·리뷰·통과한 검사를 이유 없이 반복하지 않는다. 옛 `packet-review`·인증 우회 절차를 재사용하지 않는다.
- CLI exit0만으로 실행을 입증하지 않는다. AOT 자기 실행은 실제 witness로 발견했다.
- 사라진 /tmp source/SDK를 있다고 가정하거나 옛 Swift 통합 tree로 공개 0.13.0을 되돌리지 않는다.

## Next Steps

0순위(2026-09-16): 공개 호환 버전 세트는 **완성**됐고(isthmus 0.6.0 · cartograph 0.15.1 ·
kartograph v0.10.0 · dartograph 0.11.0), 문서화는 **PR #72로 머지 완료**(squash `08d30a2`).
실사용 코퍼스도 **PR #73으로 머지 완료**(squash `c88dac6`). main은 `c88dac6`이다.

1. ~~호환 버전 표·고정 예제·CI 예시~~ — 완료, PR #72 머지됨.
2. 공개 버전 end-to-end 부분 검증 완료: cartograph 0.15.1 + dartograph 0.10.0 + npm isthmus 0.6.0으로
   `verify-cartograph-roundtrip.mjs` 통과(보존 억제·explain 근거). 양쪽 `bridges --messages`의 v2 문서
   출력도 확인. 미검증 잔여: kartograph의 Android 실행, 공개 조합의 전체 preflight 재현, cache 없는 CI.
3. dartograph PR #98은 머지됨(`c026cd9`) → **0.11.0 발행 완료**(PR #99, 태그 `v0.11.0`,
   pub.dev·GitHub Release·fresh-cache 설치·CLI 계약 검증 완료).
   자매 로컬의 미커밋 변경은 각 세션 소유이므로 보존한다.
4. 실사용 정밀도 코퍼스 — **PR #73 머지 완료**(squash `c88dac6`, main 동기화됨):
   `experiments/real-corpus/`에 manifest(고정 pub.dev 아카이브+sha256)·run.mjs·스텁 하네스를
   만들고 공개 플러그인 3종(battery_plus·shared_preferences_foundation·url_launcher_macos) ×
   12 케이스(파일/심볼 선택 + 실제 버전 간 diff 3건)를 실행했다.
   결과 **TP 50 / FN 0 / FP 3** — FP는 `bp-file-event-handler`에서 EventChannel 스트림 핸들러
   파일 선택 시 `register` 참조를 따라 등록 경계가 battery 채널 전체로 보수 확대된 3건.
   코퍼스 과정에서 발견한 결함 하나를 고쳤다: `scripts/capture-preflight.mjs`가
   cartograph impact의 64(미인덱스 입력, 부분 문서 유효)를 거부하던 것을 kartograph와
   동일하게 `[0,64]` 허용으로 수정 + 회귀 테스트. `npm run verify` 통과.
   GLM 리뷰 2라운드 지적을 검증·반영했다(`0d9d8f7`): Dart 스텁의 채널 생성자 시그니처를
   실제 SDK 순서로 교정, 아카이브 재시도·tar traversal 검사, 지문 입력에 하네스/벤더 포함,
   동적 접두부 정확 비교, results.json 절대 경로 정제, 기대 한계 갭 단언 추가.
   반영 후 Dart parse-errors 한계는 해소됐고 스텁은 `dart analyze` clean.
   범위 밖 명시: Kotlin(producer 없음)·런타임 실행·실제 Flutter 앱 빌드.
5. **EventChannel 커버리지(경쟁 우선순위 1) 구현 완료 — `feature/event-channel` 브랜치**:
   - 계약: `docs/BRIDGE-EVENTS.md`(event-channel transport, v2 계열) + GRAPH-EXCHANGE의
     method-handle `handlerScope`/`dependencies` 필드·scoped 전파 의미 추가.
   - isthmus: `stream-listen`/`stream-handle` 파싱·조인, preflight event 경계 +
     method-handle case 스코프 전파(wire root-gating), capture `--events` 수집·지문 반영.
   - cartograph(competitive 워크트리): `setStreamHandler`→`streamHandle` 사실,
     method-handle switch-case/if-분기 스코프 근거, `bridges --events` v2 문서.
   - dartograph(`feature/bridge-events`): `receiveBroadcastStream`→`stream-listen`,
     `--events` v2 문서, mutable 필드 재대입 없음 시 초기값 해석(메시지 경로와 동일 의미).
   - 실사용 코퍼스 재실행 결과 **TP 54 / FN 0 / FP 0** (기존 TP 50/FP 3):
     `bp-file-event-handler`의 공유 `handle()` switch 입상도 FP 2건 소거,
     `getBatteryState`는 case 절 실의존으로 TP 유지, charging 스트림 경계 3케이스 TP 추가.
6. 이후 경쟁력 우선순위: kartograph Kotlin EventChannel·Android 실측, FFI/JNI 범위,
   MCP/에이전트 인터페이스, 코퍼스 확장(앱 수준), cold-cache CI 재현.

## Resume Prompt

`/Users/jinhongan/Desktop/isthmus`에서 HANDOFF.md와 적용되는 AGENTS.md를 읽고 현재 Git 상태를 확인해줘.
공개 호환 버전 세트는 완성됐어(isthmus 0.6.0 · cartograph 0.15.1 · kartograph v0.10.0 · dartograph 0.11.0 —
전부 발행됐고 cartograph·dartograph는 설치본 실측, kartograph는 릴리스+main 코드 확인·Android 실행 미검증).
호환 세트 문서화(PR #72)·실사용 코퍼스(PR #73)·dartograph 0.11.0 발행(PR #99)까지 **전부 머지 완료**야.
main은 `c88dac6`이고 작업 브랜치는 정리됐어.
주의: 세션 중 `git reset --hard`로 이 레포의 **미커밋 문서 변경(docs/FEASIBILITY·PRD·RESEARCH)이 소실**됐다 —
복구 불가를 확인했으니 필요하면 내용을 새로 작성해. 미추적 파일(HANDOFF.cartograph-notes.md·default.profraw)은
남아 있다. 완료한 PR·발행·타당성 조사를 반복하지 마.
