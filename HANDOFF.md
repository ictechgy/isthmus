# Handoff

_Last updated: 2026-09-06 21:20 KST by Claude (Claude Code)_

## Goal

Flutter Dart ↔ Swift의 bridge facts를 조인해 호출 근거·불일치·외부 retention을 제공한다.
작업 규칙의 정본은 [AGENTS.md](AGENTS.md)이며 CLAUDE.md는 이를 참조한다.

## Current Status

- `main`과 `origin/main`은 `8b1c285`(PR #13 squash)에서 일치한다.
- **npm 발행이 남았다.** package/CHANGELOG/README는 0.1.5지만 registry latest는 아직 0.1.4다.
  이 환경의 npm이 인증되어 있지 않아(`npm whoami` → E401) `npm publish`를 실행하지 못했다.
  `npm publish --dry-run`은 통과했다(isthmus-cli@0.1.5, 49개 파일 63.2kB).
- 로컬 `.gitignore` 미커밋 수정은 사용자 소유로 보존한다. 커밋 요청이 오면 별도 브랜치에서 다룬다.
- 이전 세션이 남긴 plus_plugins 조사 메모 두 건을 **이번 세션에 실제 producer로 재현했다.**
  아래 Blockers에서 미검증 제안이 아니라 확인된 사실로 승격했다.

## Completed

- PR #4 `30e0396`: 실제 cartograph·dartograph 생산부터 isthmus retention, dead/explain까지 검증.
- PR #7 `e08ad85`: `diff --before <files...> --after <files...> [--strict]`.
- PR #8 `a73222d`: 0.1.4 버전·CHANGELOG·설치 안내 갱신과 배포.
- PR #9 `b2eebfa`: 루트 AGENTS 정본, CLAUDE 참조, src/scripts/docs/experiments별 지침.
- PR #11 `a5ea24a`: 조인 플랫폼 구성 fail-closed와 입력 오류 원인 구분.
- PR #12 `122fca6`(이번 세션): 보고 없이 사라지던 관찰 두 곳을 닫았다.
  - 조인에서 제외한 사실을 isthmus가 직접 세어 `tool`이 `isthmus`인 limitation으로 낸다.
    `unjoined-dynamic-channels`·`unjoined-dynamic-methods`·`unjoined-unattributed-handlers`.
    생산자의 신고 여부와 신고한 개수에 의존하지 않는다. 같은 위치 중복은 증거 dedup과 같은
    규칙으로 한 번만 세고, dynamic이면서 미귀속인 핸들러는 dynamic으로만 센다.
  - `retentions --for cartograph`가 수신 측 Swift 문서를 요구하고, 호출자가 있는데도 `symbol`이
    없어 근거로 바꿀 수 없는 매치 핸들러가 있으면 부분 문서 대신 종료 코드 2로 실패한다.
- PR #13 `8b1c285`(이번 세션): 0.1.5 버전·CHANGELOG·README 상태 갱신. 발행은 미완료.

## Key Files & State

- [교환 계약](docs/GRAPH-EXCHANGE.md): 조인 규칙에 "세는 주체는 소비자"와 보존 문서 부분 생성
  금지를 명시했다. 변경 전에 producer/consumer 영향을 확인한다.
- `src/join/join.ts`: `collectLimitations` → `unjoinedFactLimitations`가 조인하지 못한 사실을
  플랫폼별로 센다. 키를 JSON으로 만드는 이유는 `channel`이 null일 수 있어서다(주석 참조).
- `src/report/retentions.ts`: `validateCartographRetentionInputs`(Swift 문서 요구)와
  `rejectUnresolvedSwiftHandlers`(심볼 없는 매치 핸들러 거부).
- `src/cli/check-command.ts`: typed 입력 오류 4종과 공유 매퍼 `inputFailureResult`.
  보간값은 숫자 `inputPosition`과 parse.ts의 정적 `reason`뿐이다(이번 세션에 재확인).
- `experiments/phase-0/expected/{check,graph,query,join}.json`: 새 limitation 세 줄이 늘었다.
- [README](README.md): `tool`이 `isthmus`인 한계 세 종류와 retentions 거부 조건을 설명한다.

## Important Context / Decisions

- 확인된 사실: 제품 CLI는 파일만 읽는다. producer 실행은 integration 검증 스크립트의 책임이다.
- 관찰 손실은 생산자 신고에 의존하지 않는다. 계약이 "limitations로 센다"고 정한 항목은
  소비자가 직접 센다. 생산자 문자열은 원인 설명이지 신뢰의 근거가 아니다.
- 근거가 빠진 보존 문서는 만들지 않는다. 부분 목록은 소비자에게 살아 있는 핸들러를 미사용으로
  보이게 하므로, 만들 수 없으면 종료 코드 2로 실패한다.
- 노출하는 오류 메시지는 정적 문자열·숫자만 보간한다.
- **설치된 producer는 cartograph 0.6.0, dartograph 0.2.0이다.** 이전 기록(0.5.5)보다 최신이며
  두 통합 검증 스크립트를 모두 통과한다. README/스크립트의 최소 버전 게이트는 그대로다.
- PR #12에서 의식적으로 제외한 항목: 모노레포 project 재기준화, ObjC 진단 정책, retentions
  다중 caller evidence, query `notFound` 종료 코드, check 베이스라인, RN/Kotlin/EventChannel.
- Windows CI는 보류: `src/script-security.test.ts` 하네스의 shebang·chmod·TMPDIR 의존 때문이다.

## Verification

이번 세션에서 직접 확인한 결과:
- `npm run verify`: 제품 166개(신규 11), Phase 0 조인 15개 통과; 라인 98.89%, 분기 95.55%,
  함수 98.47%. `Package contract verified: isthmus-cli@0.1.5`.
- PR #12·#13 모두 CI 두 잡(ubuntu-latest, macos-latest) 그린 후 squash 머지.
- `verify-cartograph-roundtrip.mjs`: cartograph 0.6.0·dartograph 0.2.0으로 통과(변경 후 재실행).
- `verify-public-flutter-plugin.mjs`: 고정 커밋 `13e17047`에서 **0.1.5 산출물로** 통과.
- 빌드된 CLI로 결함 시나리오 재현 확인: 생산자 신고 없는 dynamic 사실 → 한계 3줄,
  symbol 없는 매치 핸들러 → 코드 2, kotlin 수신 문서만 → 코드 2, 정상 경로는 retention 1건.
- GLM 리뷰(effort=high): 지적 9건 중 2건 채택, 1건은 코드로 클린 확인, 나머지는 반증하거나
  기존 추적 항목으로 분류했다. 근거는 PR #12 본문에 남겼다.

## Blockers & Open Questions

배포 blocker는 없다. npm 발행만 인증 문제로 대기 중이다.

1. **ObjC 사각지대 — 재현 완료, 진단 정책 결정 필요.** 이전 세션 메모를 실제 producer로
   재현했다. 공개 `plus_plugins` 고정 커밋 `13e17047`의 `package_info_plus`는 iOS·macOS 핸들러가
   모두 Objective-C(`FPPPackageInfoPlusPlugin.m`)다. cartograph 0.6.0은 facts 0개·`target: null`
   문서와 함께 `objective-c-sources: 2 Objective-C file(s) were read only for React Native export
   macros, so a Flutter handler written in Objective-C cannot appear here`를 낸다.
   그런데 isthmus는 그 한계를 `limitations`에 복사만 하고 심각도에 쓰지 않아,
   `check --strict`가 **errors 2 / 종료 코드 1**을 낸다(`unhandled-invocation getAll`,
   `unregistered-channel-creation`). 핸들러는 `.m` 파일에 실제로 있다.
   cartograph 소스(`Sources/CartographKit/BridgeFacts.swift`)에도 "이것을 세지 않으면 isthmus는
   '핸들러 없는 호출'을 오류로 낸다"는 주석이 있다. 즉 생산자는 알려줬고 소비자가 안 읽는다.
   `src/report/check-report.ts`는 limitations를 심각도 계산에 전혀 쓰지 않는다.
   결정해야 할 것: (a) 수신 측이 커버리지 공백을 신고하면 error를 별도 code·warning으로 낮출지,
   (b) 판단 불가로 보고 코드 2로 거부할지, (c) cartograph에 파일·채널 단위 귀속을 요청할지.
   (a)는 무관한 `.m` 파일 하나가 프로젝트 전체의 error를 무르게 하는 위험이 있고,
   (c)는 계약 변경이라 자매 저장소 합의가 필요하다. 관련 한계가 하나 더 있다:
   `objective-c-handlers: N ... carry no USR, so a retention for them cannot be applied`.
2. **모노레포 project 기준 — `/tmp` 절반은 재현 완료.** 두 producer가 macOS 심볼릭 링크를
   **반대 방향으로** 정규화한다. 같은 디렉터리를 주어도 cartograph는 `/tmp/...`, dartograph는
   `/private/tmp/...`를 낸다. cartograph에 `/private/tmp/...`를 명시해도 `/tmp/...`로 바꿔 낸다.
   isthmus는 정확한 문자열 일치를 요구하므로 코드 2로 거부한다(설계대로). 사용자 쪽 플래그로
   맞출 방법이 없으므로 자매 저장소의 정규화 합의가 필요하다. `/tmp` 밖 경로에서는 문제없다.
   기존 통합 스크립트가 이 문제를 만나지 않는 이유는 저장소 아래나 `~` 아래 경로를 쓰기 때문이다.
   `*_platform_interface`와 plugin의 producer root가 다른 절반은 아직 재현하지 않았다.
3. **check 베이스라인**: PRD v0.1 목표의 "베이스라인"이 미구현이다.
4. **retentions 대표 증거**: `invocations[0]`만 evidence로 실린다. external-retentions v0 형식
   변경이라 cartograph 합의가 필요하다.
5. **관찰량 미노출**: `isthmus-check`의 `summary`에 입력 fact 수·한계 수가 없어, "브리지가 없는
   프로젝트"와 "아무것도 관찰하지 못한 실행"이 같은 출력을 낸다. isthmus 소유 형식이라 국지적으로
   고칠 수 있다.

RN·Kotlin·Event/Basic 채널 지원은 별도 계획이다. 새 종류는 계약을 먼저 합의한다.

## What Worked

- 개선점을 빌드된 CLI 실행으로 실증한 뒤 우선순위를 정하고, 재현 테스트를 먼저 썼다.
- 계약 문서와 구현을 대조해 "강제되는 절반과 신고에만 의존하는 절반"을 찾았다.
  `channel: null`은 parse에서 fail-closed인데 `dynamic`은 아무 강제가 없었다.
- 자매 저장소 소스를 읽어 생산자의 의도를 확인했다. cartograph의 주석이 ObjC 한계를 왜 내는지
  직접 설명하고 있어, 소비자 쪽 미구현임을 코드 근거로 확정할 수 있었다.
- 리뷰 지적을 코드로 검증했다. 채택 2건은 실제 비대칭·테스트 공백이었고, 구분자 키 제안은
  `channel`이 null일 수 있다는 기존 테스트로 반증했다.
- Phase 0 결정성 테스트가 첫 구현의 중복 카운트 부풀림을 잡았다. 골든은 diff로 한 줄씩 대조했다.

## What Did Not Work / Avoid

- 리뷰 지적을 검증 없이 반영하지 않는다. 이번에도 9건 중 2건만 유효했다.
- `packet-ask-safe`(보호 런처)의 GLM provider가 실패한다. `doctor`는 정상이고 offline
  `inspect`·`--preview`도 되지만 실제 호출은 290바이트 요청도 `PROVIDER_FAILED`(종료 코드 21)다.
  같은 패킷이 `packet-ask`로는 성공한다. 자격증명·모델·allowlist를 고쳐 우회하지 않았다.
- 미해석 결과나 관찰 소실을 코드 삭제 안전성으로 해석하지 않는다.
- 낡은 producer binary, 서로 다른 추출 범위, OS 임시경로 별칭으로 비교 결과를 오염시키지 않는다.
- cartograph는 인덱스 스토어가 없으면 종료 코드 2로 거부한다. 조사용 checkout에도 빌드 가능한
  Swift 타깃과 `swift build`가 필요하다.
- 다른 세션이 자매 저장소를 동시에 수정할 수 있다. branch/HEAD/status를 확인하고 변경을 보존한다.

## Next Steps

1. **0.1.5 발행**: npm 인증 후 `npm publish`, 이어서 registry와 설치본을 검증한다.
   태그·GitHub release가 필요한지는 이전 릴리스 관행을 확인한다(0.1.4에는 태그가 없다).
2. **ObjC 진단 정책**: 위 Blockers 1의 (a)/(b)/(c) 중 하나를 정한다. 재현은 끝났으므로 결정만
   내리면 구현할 수 있다. 재현 절차는 `package_info_plus`를 고정 커밋으로 sparse checkout하고,
   인덱스용 최소 Swift 타깃을 만들어 `swift build` 후 두 producer를 돌리는 것이다.
   경로는 `/tmp` 밖이어야 한다(Blockers 2).
3. **project 정규화**: cartograph·dartograph 중 어느 쪽을 바꿀지 자매 저장소에서 합의한다.
   isthmus 쪽 완화는 다른 프로젝트를 잘못 연결할 수 있으므로 마지막 수단이다.
4. `.gitignore` 미커밋 수정은 사용자 소유다. 커밋 요청이 오면 별도 브랜치에서 다룬다.

## Resume Prompt

`/Users/jinhongan/Desktop/isthmus`에서 AGENTS.md와 HANDOFF.md를 읽고 git 상태를 확인해줘.
PR #12(관찰 손실 차단)와 #13(0.1.5 준비)이 `8b1c285`로 머지됐지만 npm 발행은 인증 문제로
남아 있어. 로컬 .gitignore 미커밋 수정을 보존해줘. 발행을 요청하면 npm 인증부터 확인하고,
ObjC 작업을 요청하면 재현은 끝났으니 진단 정책 결정부터 시작해줘.
