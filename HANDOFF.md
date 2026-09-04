# Handoff

_Last updated: 2026-09-05 01:52 KST by Codex_

## Goal

- 각 언어 도구가 만든 bridge facts를 문자열 경계에서 조인하고, 실제 호출 근거를
  cartograph 같은 소비자에 external retention으로 돌려준다. 현재 완성된 첫 경로는
  Dart/Flutter ↔ Swift다.

## Current Status

- `main`의 기준 커밋은 `30e0396`(PR #4 squash merge)다.
- isthmus package는 `isthmus-cli` 0.1.3이며 이번 변경은 제품 런타임이 아니라 실제 producer
  integration/release gate를 추가했다.
- cartograph 0.5.3과 dartograph 0.1.1을 사용하는 실제 왕복이 통과한다.
- 필수 후속 구현이나 배포 blocker는 없다.
- 로컬의 `.gitignore`, `CLAUDE.md`, `AGENTS.md` 변경은 사용자 소유이며 이번 PR들에 넣지 않았다.

## Completed

- cartograph bridge facts는 project-relative path, UTC millisecond 시각, target별 문서를 낸다.
- `verify-cartograph-roundtrip.mjs`가 실제 cartograph와 dartograph producer를 실행하고,
  isthmus retention, cartograph dead suppression과 explain evidence까지 확인한다.
- cartograph 0.5.3 미만과 dartograph 0.1.1 미만 또는 모호한 버전 출력을 fail-closed로 거부한다.
- 공개 `fluttercommunity/plus_plugins`의 고정 커밋
  `13e170479b3c66c890fa401f5fdb3af141faf67a`에서 battery plugin을 dogfood한다.
- 공개 dogfood는 원본 Dart 호출 위치, Swift handler USR, 세 retention과 cartograph 대표
  explain evidence를 확인한다.
- GLM max 리뷰의 지적을 반영했고 두 후속 리뷰에서 critical/high/medium blocker 0건을 확인했다.

## Key Files & State

- `docs/GRAPH-EXCHANGE.md`: 네 저장소가 공유하는 v1 계약.
- `scripts/verify-cartograph-roundtrip.mjs`: 합성 코퍼스의 실제 producer→join→dead/explain 게이트.
- `scripts/verify-public-flutter-plugin.mjs`: pinned 공개 plugin의 producer→join→consumer 게이트.
- `src/script-security.test.ts`: version, cleanup, path 비노출과 producer 호출 검증.
- `src/public-dogfood-script.test.ts`: 공개 gate 사용법과 strict version 검증.
- `docs/PLAN.md`: Flutter/Swift 경로 완료, RN/Kotlin의 이후 순서.

## Important Context / Decisions

- Facts:
  - production isthmus CLI는 입력 파일만 읽는다. producer를 실행하는 코드는 release 검증
    스크립트이며 제품 명령이 Xcode/Dart SDK 의존성을 떠안지 않는다.
  - public battery handler는 이미 public이라 dead→retained 전환을 억지로 만들 수 없다.
    공개 gate는 USR·원본 위치·explain 소비를, 합성 gate는 실제 dead suppression을 검증한다.
  - 같은 Swift handler 심볼의 여러 retention 중 cartograph `--explain`은 대표 evidence 하나를
    표시하지만 retention 문서의 세 method는 모두 생성·검증된다.
  - macOS `/var`와 `/private/var` 정규화가 Swift/Dart에서 달라, 공개 checkout은 저장소 아래
    전용 임시 디렉터리를 만들고 부모·접두사 확인 후 정리한다.
  - 공개 Git checkout은 고정 SHA, sparse paths, 빈 hook template, 격리된 Git config를 사용한다.
- Assumptions:
  - 사용자는 cartograph 0.5.3, dartograph 0.1.1, Node 22.18 이상을 사용한다.

## Verification

- Ran: `npm run verify`
  - Result: pass, 124 product tests, Phase 0 join 15, line 98.54%, CLI/package contracts.
- Ran: `verify-cartograph-roundtrip.mjs` with real producer binaries
  - Result: pass; external retention changes cartograph dead output and explain includes Dart evidence.
- Ran: `verify-public-flutter-plugin.mjs` with cartograph 0.5.3/dartograph 0.1.1
  - Result: pass at the pinned plus_plugins revision.
- Ran: GitHub PR #4 CI
  - Result: both push and pull-request verify jobs passed.
- Related releases:
  - cartograph PR #21, release `0.5.3`, Homebrew tap commit `70f0c7f`.
  - dartograph PR #1, CI repair PR #2, pub.dev/GitHub release `v0.1.1`.

## Blockers & Open Questions

- No blocker for Dart/Flutter ↔ Swift.
- RN remains v0.2 and needs a real native RN library plus JS/TS producer.
- Kotlin waits for kartograph bridge production.
- Any EventChannel/BasicMessageChannel work must first define semantics in GRAPH-EXCHANGE.

## What Worked

- Real producer output exposed path, timestamp, target and stale-binary problems that stored JSON missed.
- Synthetic and public-source fixtures complement one another instead of pretending one fixture proves all paths.
- GLM findings were converted into failing tests before being accepted.

## What Did Not Work / Avoid

- Do not validate integration with hand-authored expected producer JSON alone.
- Do not run against an old cartograph release binary; both scripts enforce minimum versions.
- Do not use OS temp aliases for a shared project field unless both producers canonicalize identically.
- Do not broaden Git credentials or hooks for the public-source checkout.

## Next Steps

1. No required work remains for goals 1–6 of the cartograph integration milestone.
2. Begin RN only with an explicit v0.2 request and a native-source public fixture.
3. If bridge kinds or target semantics change, update `docs/GRAPH-EXCHANGE.md` and all producers together.

## Resume Prompt

Open this repository at `/Users/jinhongan/Desktop/isthmus`, read `HANDOFF.md` and applicable
`AGENTS.md` files, then continue from: `Goals 1–6 are complete; choose an explicit RN, Kotlin, or
new bridge-kind follow-up before changing code.`
