# Handoff

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

_Last updated: 2026-09-09 (Blockers 3 완전 종결 — realpath·공유 루트 모두 계약 명문화)_

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
  재현됐다.** ObjC 항목은 재현 뒤 수정까지 끝났고(#15, target 귀속 후에도 동작 보존 #18),
  경로 정규화 항목은 아래 Blockers에 남았다.

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
  pub.dev 2026-09-09 확인)이고, 이 머신의 설치본은 brew cartograph 0.8.2(tap 손
  갱신 관행)·dartograph 0.2.0(샌드박스에서 실행 불가)이다.** Blockers 3 수정들은
  설치본을 업그레이드해야 적용된다. 과거 0.6.0·0.2.0에서 두 통합 검증 스크립트를
  통과했다. README/스크립트의 최소 버전 게이트(cartograph 0.5.3·dartograph 0.1.1)는
  그대로다.
- PR #12에서 의식적으로 제외한 항목: 모노레포 project 재기준화, ObjC 진단 정책, retentions
  다중 caller evidence, query `notFound` 종료 코드, check 베이스라인, RN/Kotlin/EventChannel.
- Windows CI는 보류: `src/script-security.test.ts` 하네스의 shebang·chmod·TMPDIR 의존 때문이다.

## Verification

최근 세션에서 직접 확인한 결과:
- `npm run verify` 전체 통과(#29 기준): typecheck, 제품 246개, Phase 0 조인 15개;
  라인 98.71%, 분기 95.84%, 함수 97.87%. `Package contract verified: isthmus-cli@0.2.0`.
  `verify-cli-contract.mjs`에 발행 CLI 베이스라인 왕복 시나리오(update→strict+baseline
  억제 3·stale 0·코드 0, 손상 파일 코드 2)가 포함됐다.
- PR #24·#28·#29 모두 CI 두 잡(ubuntu-latest, macos-latest) 그린 후 squash 머지.
- GLM 리뷰(#29, effort=high, packet-review files 모드): F1(쓰기 상한 비대칭)·F2(비원자
  쓰기)·F3(apply 이중 적용 계수 흔들림)·F4(JSON RangeError 오분류)를 코드 검증 후
  채택. F4는 지원 런타임(Node ≥22.18)에서 깊은 중첩이 SyntaxError임을 실측하고 방어적
  분류만 남겼다. 니트 5건·테스트 공백 7건 중 6건 반영. 기록은 PR #29 본문.
- 0.2.0 발행 검증은 위 "0.2.0 발행 완료" 절과 PR #26 기록을 본다. 0.1.7 발행 검증
  (registry·tarball·발행본 phase-0)은 #21 시점 기록으로 완료.
- Blockers 3 코드 근거(2026-09-08, clone으로 직접 확인): cartograph
  `CartographService.swift` `projectPath = configuration.projectPath ?? cwd`(symlink 미해결,
  `project:`로 직행) vs dartograph `dartograph_cli.dart` `_runBridges`의
  `Directory(root).absolute.resolveSymbolicLinksSync()`. dartograph에 `--project`류
  공유 루트 옵션은 없다(위치 인자만).

## Blockers & Open Questions

배포 blocker는 없다. 0.1.7까지 발행을 마쳤다.

1. **완화 범위 — 구현 완료, 정착 대기.** target 절반은 #18, 파일·채널 절반은 #25의
   선택적 v1 `limitationScopes`(입증된 채널 상한만, 무범위는 target 전체 유지)로 닫혔고
   0.2.0/cartograph 0.9.0으로 양쪽 배포됐다. 남은 것: 실제 producer 실행에서 스코프
   신고가 얼마나 덮이는지 실측(공개 플러그인 재검증), 스코프 없는 공백의 target 전체
   완화는 설계대로 남는다.
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
5. **retentions 대표 증거**: `invocations[0]`만 evidence로 실린다. external-retentions v0 형식
   변경이라 cartograph 합의가 필요하다.
6. **관찰량 미노출**: `isthmus-check`의 `summary`에 입력 fact 수·한계 수가 없어, "브리지가 없는
   프로젝트"와 "아무것도 관찰하지 못한 실행"이 같은 출력을 낸다. isthmus 소유 형식이라 국지적으로
   고칠 수 있다.

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

1. **dartograph#38 닫기**(사용자): isthmus 계약 갱신이 완료됐으니 issue를 닫으면 된다.
   로컬 producer 업그레이드(brew cartograph 0.10.1, `dart pub global activate
   dartograph` 0.5.0) 후 통합 검증 스크립트 재실행도 사용자 환경에서만 가능하다
   (샌드박스는 dartograph 실행 불가). 재실행하면 ObjC 재현 절차의 `/tmp` 제약도
   무의미해진다.
2. **producer 스코프 신고 실측**: cartograph 0.9.0의 `limitationScopes`가 공개 플러그인
   실측에서 얼마나 덮이는지 확인(verify-public-flutter-plugin 재실행 포함).
3. **SARIF 리포터**(RESEARCH 흡수 후보): check 결과의 GitHub code scanning 통합.
   isthmus 단독, additive.
4. 베이스라인 만료일(Trivy `exp:` 방식)은 위생 후속 후보 — 자동 prune+stale 계수로
   지금은 충분하다고 판단.
5. 태그·GitHub release가 필요한지는 이전 관행을 확인한다(0.1.4~0.3.0 모두 isthmus는
   태그가 없다. cartograph는 GitHub Release를 한다).
6. `.gitignore` 미커밋 수정은 사용자 소유다. 커밋 요청이 오면 별도 브랜치에서 다룬다.

ObjC 재현 절차(다시 필요할 때): `package_info_plus`를 고정 커밋으로 sparse checkout하고,
인덱스용 최소 Swift 타깃을 만들어 `swift build` 후 두 producer를 돌린다. 경로는 `/tmp`
밖이어야 한다 — 단 이 제약은 cartograph 0.10.1(realpath 정규화, cartograph#73) 미만
설치본에만 유효하고, 업그레이드 후 재현하면 이 절차도 갱신한다.

## Resume Prompt

`/Users/jinhongan/Desktop/isthmus`에서 AGENTS.md와 HANDOFF.md를 읽고 git 상태를 확인해줘.
0.3.0까지 발행을 마쳤고(check 베이스라인 + 영문 README 포함) 0.3.0 릴리스 소스는
`92b160b`(PR #34)야 — 이 문서의 이후 갱신은 그 위에 쌓인다. Blockers 3은 cartograph
0.10.1(realpath)·dartograph 0.5.0(공유 루트)과 GRAPH-EXCHANGE 명문화로 완전 종결됐고,
dartograph#38 닫기와 로컬 producer 업그레이드만 사용자 몫으로 남았어. 로컬 .gitignore
미커밋 수정을 보존해줘.
발행을 요청하면 브랜치와 git status부터 확인하고 사용자에게 `--otp`로 직접 실행하게 해줘
(PUT 404는 인증 문제 — npm login 먼저). 후속 작업은 producer 스코프 신고 실측(producer
업그레이드 후 verify-public-flutter-plugin 재실행), SARIF 리포터 순이야.
샌드박스에서 GLM 리뷰는 packet-review files 모드로 해줘(--diff 모드는 깨져 있음).
자매 저장소 쓰기는 토큰 403이라 사용자 실행으로 넘긴다.
