# Handoff

_Last updated: 2026-09-06 21:55 KST by Claude (Claude Code)_

## Goal

Flutter Dart ↔ Swift의 bridge facts를 조인해 호출 근거·불일치·외부 retention을 제공한다.
작업 규칙의 정본은 [AGENTS.md](AGENTS.md)이며 CLAUDE.md는 이를 참조한다.

## Current Status

- `main`과 `origin/main`은 `bc497d2`(PR #16 squash)에서 일치한다.
- npm `isthmus-cli@0.1.6`이 최신 발행본이고 registry latest도 0.1.6이다. 발행본 `dist`와
  README가 `main` 빌드와 완전히 일치함을 tarball 대조로 확인했다.
- **0.1.5는 저장소보다 앞서 나갔다.** 발행 시점의 작업 트리가 기능 브랜치여서 아직 머지하지
  않은 #15가 tarball에 담겼다. unpublish 대신 #15를 머지하고 0.1.6으로 두 상태를 맞췄다.
  0.1.5는 registry에 남아 있고 코드 내용은 0.1.6과 사실상 같다.
- 로컬 `.gitignore` 미커밋 수정은 사용자 소유로 보존한다. 커밋 요청이 오면 별도 브랜치에서 다룬다.
- 이전 세션이 남긴 plus_plugins 조사 메모 두 건을 **이번 세션에 실제 producer로 재현했다.**
  ObjC 항목은 재현 뒤 수정까지 끝났고, 경로 정규화 항목은 아래 Blockers에 남았다.

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
- PR #13 `8b1c285`(이번 세션): 0.1.5 버전·CHANGELOG·README 상태 갱신.
- PR #15 `9029a4e`(이번 세션): 수신 측이 신고한 분석 공백을 심각도에 반영한다.
  Objective-C로 쓰인 Flutter 핸들러처럼 수신 측 분석에 나타날 수 없는 코드가 있으면
  "핸들러 없는 호출"과 "등록 없는 채널 생성"을 error가 아니라 `-unverified` 경고로 낸다.
  증거와 한계는 그대로 남기고 `--strict`를 실패시키지 않는다. 공백의 종류를 나눠 채널
  진단과 메서드 진단을 따로 판단하고, 호출 측 한계는 심각도를 바꾸지 않으며, 알려진
  접두사만 인정한다.
- PR #16 `bc497d2`(이번 세션): 0.1.6 준비와 발행 사고 정정. npm 발행 완료.

## Key Files & State

- [교환 계약](docs/GRAPH-EXCHANGE.md): 조인 규칙에 "세는 주체는 소비자"와 보존 문서 부분 생성
  금지를 명시했다. 변경 전에 producer/consumer 영향을 확인한다.
- `src/join/join.ts`: `collectLimitations` → `unjoinedFactLimitations`가 조인하지 못한 사실을
  플랫폼별로 센다. 키를 JSON으로 만드는 이유는 `channel`이 null일 수 있어서다(주석 참조).
- `src/report/retentions.ts`: `validateCartographRetentionInputs`(Swift 문서 요구)와
  `rejectUnresolvedSwiftHandlers`(심볼 없는 매치 핸들러 거부).
- `src/report/check-report.ts`: `receiverCoverageGaps`가 수신 측 한계를 "핸들러를 가리는
  공백"과 "등록을 가리는 공백"으로 나눈다. 접두사 목록은 닫혀 있고 계약이다.
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
- `npm run verify`: 제품 178개(신규 23), Phase 0 조인 15개 통과; 라인 98.92%, 분기 95.67%,
  함수 98.53%. `Package contract verified: isthmus-cli@0.1.6`.
- PR #12·#13·#14·#15·#16 모두 CI 두 잡(ubuntu-latest, macos-latest) 그린 후 squash 머지.
- 발행본 검증: registry latest 0.1.6, `diff -r dist <tarball>/dist` 완전 일치, README 일치.
  발행본 CLI로 phase-0은 `unhandled-invocation` error(코드 1), 실제 ObjC 플러그인은
  `unhandled-invocation-unverified` 경고(코드 0)를 내는 것을 확인했다.
- `verify-cartograph-roundtrip.mjs`: cartograph 0.6.0·dartograph 0.2.0으로 통과(변경 후 재실행).
- `verify-public-flutter-plugin.mjs`: 고정 커밋 `13e17047`에서 **0.1.6 산출물로** 통과.
- 빌드된 CLI로 결함 시나리오 재현 확인: 생산자 신고 없는 dynamic 사실 → 한계 3줄,
  symbol 없는 매치 핸들러 → 코드 2, kotlin 수신 문서만 → 코드 2, 정상 경로는 retention 1건.
- GLM 리뷰 두 번(effort=high). #12는 9건 중 2건 채택, #15는 테스트 공백 7건 채택. 수신
  문서에 caller kind가 섞여 완화가 번진다는 지적 2건은 `parse.ts`의 platform/kind 검증으로
  반증했다. 근거는 각 PR 본문과 코멘트에 남겼다.

## Blockers & Open Questions

배포 blocker는 없다. 0.1.6까지 발행을 마쳤다.

1. **한계의 완화 단위와 target 귀속.** `receiverCoverageGaps`의 완화는 조인 전체에 적용된다.
   limitation 문법에 파일·채널 범위가 없어 개별 진단에 귀속할 수 없기 때문이다. 그 결과
   무관한 `.m` 파일 하나가 같은 조인의 다른 채널 진단까지 경고로 낮춘다. GLM 리뷰가 짚은
   변형도 있다: `JoinLimitation`에 target이 없어, 다른 target의 수신 문서가 신고한 공백이
   현재 target 진단의 심각도를 바꾼다. 사실은 target별로만 조인되므로 이건 비논리적 완화다.
   고치려면 `JoinLimitation`에 target을 더해야 하고, 이는 check·query·graph·diff의 출력
   형태 변경이다. 범위 있는 limitation 문법은 GRAPH-EXCHANGE 변경이라 자매 저장소 합의가 필요하다.
2. **ObjC 핸들러의 retention**: `objective-c-handlers: N ... carry no USR, so a retention for
   them cannot be applied by --external-retentions`. 핸들러는 보이지만 USR이 없어 보존 근거로
   쓸 수 없다. check 쪽은 #15로 닫혔지만 retentions 쪽은 남아 있다. external-retentions 형식
   논의가 필요하다.
3. **모노레포 project 기준 — `/tmp` 절반은 재현 완료.** 두 producer가 macOS 심볼릭 링크를
   **반대 방향으로** 정규화한다. 같은 디렉터리를 주어도 cartograph는 `/tmp/...`, dartograph는
   `/private/tmp/...`를 낸다. cartograph에 `/private/tmp/...`를 명시해도 `/tmp/...`로 바꿔 낸다.
   isthmus는 정확한 문자열 일치를 요구하므로 코드 2로 거부한다(설계대로). 사용자 쪽 플래그로
   맞출 방법이 없으므로 자매 저장소의 정규화 합의가 필요하다. `/tmp` 밖 경로에서는 문제없다.
   기존 통합 스크립트가 이 문제를 만나지 않는 이유는 저장소 아래나 `~` 아래 경로를 쓰기 때문이다.
   `*_platform_interface`와 plugin의 producer root가 다른 절반은 아직 재현하지 않았다.
4. **check 베이스라인**: PRD v0.1 목표의 "베이스라인"이 미구현이다.
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
  직접 설명하고 있어, 소비자 쪽 미구현임을 코드 근거로 확정할 수 있었다.
- 리뷰 지적을 코드로 검증했다. 채택 2건은 실제 비대칭·테스트 공백이었고, 구분자 키 제안은
  `channel`이 null일 수 있다는 기존 테스트로 반증했다.
- Phase 0 결정성 테스트가 첫 구현의 중복 카운트 부풀림을 잡았다. 골든은 diff로 한 줄씩 대조했다.

## What Did Not Work / Avoid

- **발행 전에 브랜치와 `git status`를 확인한다.** 0.1.5는 작업 트리가 기능 브랜치일 때
   발행돼 미출시 코드가 나갔다. `npm publish`는 checkout 상태를 그대로 담는다.
- npm 발행은 `PUT 202`로 끝나고 registry 반영은 비동기다. 직후 조회로 실패를 단정하지 않는다.
  npm 계정에 2FA가 걸려 있어 `--otp`가 필요하고, 코드가 30초면 만료되므로 사용자가 직접 실행한다.
- 리뷰 지적을 검증 없이 반영하지 않는다. #12는 9건 중 2건, #15는 지적 2건을 코드로 반증했다.
- `packet-ask-safe`(보호 런처)의 GLM provider가 실패한다. `doctor`는 정상이고 offline
  `inspect`·`--preview`도 되지만 실제 호출은 290바이트 요청도 `PROVIDER_FAILED`(종료 코드 21)다.
  같은 패킷이 `packet-ask`로는 성공한다. 자격증명·모델·allowlist를 고쳐 우회하지 않았다.
- 미해석 결과나 관찰 소실을 코드 삭제 안전성으로 해석하지 않는다.
- 낡은 producer binary, 서로 다른 추출 범위, OS 임시경로 별칭으로 비교 결과를 오염시키지 않는다.
- cartograph는 인덱스 스토어가 없으면 종료 코드 2로 거부한다. 조사용 checkout에도 빌드 가능한
  Swift 타깃과 `swift build`가 필요하다.
- 다른 세션이 자매 저장소를 동시에 수정할 수 있다. branch/HEAD/status를 확인하고 변경을 보존한다.

## Next Steps

1. **완화 단위 좁히기**(Blockers 1): `JoinLimitation`에 target을 더할지 결정한다. 출력 형태
   변경이므로 소비자 영향을 먼저 정리한다.
2. **project 정규화**(Blockers 3): cartograph·dartograph 중 어느 쪽을 바꿀지 자매 저장소에서
   합의한다. isthmus 쪽 완화는 다른 프로젝트를 잘못 연결할 수 있으므로 마지막 수단이다.
3. **ObjC retention**(Blockers 2): USR 없는 ObjC 핸들러의 보존 근거를 어떻게 다룰지 정한다.
4. 태그·GitHub release가 필요한지는 이전 관행을 확인한다(0.1.4~0.1.6 모두 태그가 없다).
5. `.gitignore` 미커밋 수정은 사용자 소유다. 커밋 요청이 오면 별도 브랜치에서 다룬다.

ObjC 재현 절차(다시 필요할 때): `package_info_plus`를 고정 커밋으로 sparse checkout하고,
인덱스용 최소 Swift 타깃을 만들어 `swift build` 후 두 producer를 돌린다. 경로는 `/tmp`
밖이어야 한다(Blockers 3).

## Resume Prompt

`/Users/jinhongan/Desktop/isthmus`에서 AGENTS.md와 HANDOFF.md를 읽고 git 상태를 확인해줘.
0.1.6까지 발행을 마쳤고 `main`은 `bc497d2`야. 로컬 .gitignore 미커밋 수정을 보존해줘.
발행을 요청하면 브랜치와 git status부터 확인하고 사용자에게 `--otp`로 직접 실행하게 해줘.
후속 작업은 한계의 완화 단위(target 귀속)와 producer 경로 정규화가 우선이야.
