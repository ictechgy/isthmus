# AI-DLC 작업 근거 adapter (실험적 v1)

## 구현 전 결정과 범위

2026-10-20, #156의 `9c8b48c7b2b563c725634337f4fa1d1d7e64f447` 위에 분리한 2단계다.
#156은 미머지이므로 PR base도 그 브랜치로 둔다. 기존 evidence/task·CLI/JSON·종료 코드는 바꾸지 않는다.
계획은 AI-DLC `delivery-planning`, 검증은 `build-and-test` 두 stage로 제한한다.
새 stage·orchestration·승인 엔진·자동 build·현재 checkout 검증은 만들지 않는다.

공식 최신 안정판 [v2.11.1](https://github.com/awslabs/aidlc-workflows/releases/tag/v2.11.1),
commit `895a35d86d20336d9b7bc4aedc9440e4a12c83ab`를 조사·smoke 기준으로 고정했다.
이 버전의 실제 [sensor 계약](https://github.com/awslabs/aidlc-workflows/blob/895a35d86d20336d9b7bc4aedc9440e4a12c83ab/docs/reference/07-sensor-system.md)과
[plugin contribution 계약](https://github.com/awslabs/aidlc-workflows/blob/895a35d86d20336d9b7bc4aedc9440e4a12c83ab/docs/harness-engineering/10-authoring-a-plugin.md)을 쓴다.
worker는 `aidlc-sensor-<id>.ts`의 `main(argv)`이며 dispatcher가 `--stage`와 `--output-path`를 붙인다.
plugin은 별도로 빌드·명시적으로 compose/select해야 활성화되는 opt-in contribution이다.

각 stage deliverable 옆 `<output-path>.isthmus-task.json` 한 파일을 읽는다. 다른 intent·Unit·stage를
자동 탐색하거나 최근 생성 시각의 파일을 고르지 않는다. 파일은 기존 `isthmus task ... --compact`의
결과 그대로이며, 원본의 해시와 예산 안의 bounded task를 sensor detail로 전달한다. 파일 읽기는 #155의
기존 일반 파일/바이트 상한 리더를 재사용한다. adapter는 graph·규칙·테스트 결과를 다시 계산하지 않는다.

일부 수집 실패를 전달할 때만 `isthmus-aidlc-input` v1의 `status`와 `reason`을 쓴다.
허용 status는 `timeout`, `unavailable`, `malformed`, `truncated`다. 이것은 실행 증명이 아닌
상위 수집기의 실패 관찰 전달 계약이다. 파일 누락·잘못된 JSON/UTF-8·상한 초과도 구분한다.

## 판독과 gate 경계

원본 task v1은 `complete:false`, `requiresReview:true`, `verification:unverified`다.
따라서 이 adapter가 만들 수 있는 sensor `pass`는 **항상 false**다. 유효한 JSON·명령 종료 코드 0·
artifact matched·과거 nativeAtCapture matched를 현재 checkout의 verified pass로 바꾸지 않는다.
지원하지 않는 clean/verified 주장은 malformed다. stale·unverified·unknown·truncated는 원본과
별도의 `states`에 함께 남긴다. source digest scheme의 현재 checkout 재계산도 하지 않는다.

기본 sensor는 `fire_on:gate`, `default_severity:advisory`다. 계획·검증 시 근거를 보여주지만
advisory의 실패가 gate를 막았다고 주장하지 않는다. blocking 사용은 별도의 명시적 프로젝트 선택이다.
그 경우 native AI-DLC의 기존 gate가 findings·noted pass·malformed·timeout·unavailable을 거부한다.
write-fired blocking은 이 고정 버전에서도 advisory이며, adapter가 대신 강제하지 않는다.
현재 task v1은 unknown이 남으므로 blocking으로 쓰면 gate가 열리지 않는 것이 정상이다.
override/승인 상태를 adapter에서 쓰거나 자동 승인하지 않는다.

AI-DLC dispatcher는 일부 script-error/tool-unavailable을 `result:passed`와 `note`로 기록한다.
그 결과는 verified pass가 아니다. 실제 gate smoke는 단순 sensor 종료 코드가 아니라
공식 state tool의 gate 진입 성공/거부와 audit를 검사한다. 별도 양성 control만 gate의 pass 경로를 확인한다.

## 검증 계획과 지원 경계

구현 전 실패 테스트를 두고 정상 task, mixed/stale 근거, unknown 목록 잘림, 잘못된 status 타입,
위조 clean, invalid JSON/UTF-8, 없는 파일·일반 파일 제한·상한을 검사한다.
실제 smoke는 고정 공식 native/runtime을 checksum으로 검증하고 임시 프로젝트에서 plugin validator·
composer·sensor dispatcher·state gate를 실행한다. advisory 실패는 audit를 남기고 gate를 열며,
동일 findings의 blocking binding은 gate를 거부하는지 확인한다. 실제 timeout도 별도 control로 검사한다.
이는 작은 integration fixture이며 실제 AI 대화·전체 AI-DLC 업무·앱 빌드·생산성 효과를 증명하지 않는다.

Windows에는 전역 설치·PATH 변경 없이 작업 공간의 고정 portable native/runtime만 사용한다.
기존 사용자의 AI-DLC 설치·프로젝트·credentials·권한은 변경하지 않는다. #156의 GLM 면제는 사용자
승인 범위로 기록하며, 이 새 PR의 GLM 요구를 영구 면제하는 것으로 확대하지 않는다.

## 사용

개발 빌드를 만든 뒤 새 plugin 디렉터리로 조립한다. npm package에도 source template과 조립기가
들어간다. native CLI의 build 인자는 bare TypeScript builder와 다르므로 `--plugin-root`를 쓴다.

```sh
npm run build
node scripts/build-aidlc-plugin.mjs ./dist/isthmus-evidence
aidlc engine plugin validate ./dist/isthmus-evidence --json
aidlc engine plugin build claude ./dist/isthmus-evidence-claude --plugin-root ./dist/isthmus-evidence
```

생성한 host plugin을 사용자의 명시적 선택으로 설치·compose/select한다. 직접 project에 sync할 때는
고정 버전의 `aidlc engine plugin sync --plugin-root <projected-plugin> --harness-dir .claude`를 쓴다.
실제 사용자의 프로젝트에는 이 작업에서 실행하지 않는다. native 검증 fixture는 별도 복사본에서만 실행한다.

```sh
isthmus task trace-context.json --evidence evidence.json --limit 20 --compact > <deliverable>.isthmus-task.json
```

PowerShell 5의 기본 `>` UTF-16 출력은 이 UTF-8 계약에 맞지 않는다. UTF-8로 저장해야 한다.
수집 실패 전달 예시는 `{"format":"isthmus-aidlc-input","version":1,"status":"timeout","reason":"capture timed out"}`다.
없는 파일을 빈 task로 대체하거나, strict 종료 코드 1을 통과로 기록하지 않는다.

## stdout 예산과 receipt의 현재 바인딩

nativeAtCapture matched와 현재 artifact binding은 별개다. receipt의 실제
`artifacts.items[].alignment`에 stale/missing/unverified가 있으면 normalized states에도 남긴다.
목록이 이미 잘렸으면 해당 unknown·truncated를 보존하고 안 보이는 상태를 추측하지 않는다.

입력 상한은 1 MiB이며, **출력은 JSON wrapper·개행·UTF-8을 포함해 256 KiB**다. 고정 dispatcher의
기본 1 MiB stdout 버퍼보다 여유를 둔다. 원본 task가 들어간 출력이 예산을 넘으면 `task` 대신
`taskSummary`를 내고 `outputTruncation.reason: sensor-output-byte-budget`을 명시한다.
sourceSha256, states, unknown의 total/sourceOmitted/추가 omitted, limitations의 계수·일부 상세,
native capture/current 상태를 유지한다. 상세 문자열도 JSON escape 바이트로 제한하며 잘림을 표시한다.
요약은 원본 task를 대체하는 새 증거가 아니므로 전체 상세는 같은 해시의 sidecar에서 확인해야 한다.
실제 runtime smoke는 같은 근접 입력에 대해 수정 전 무제한 wrapper의 noted-pass/상세 소실을
음성 대조군으로 재현하고, 수정 출력은 SENSOR_FAILED의 명시적 truncated 근거로 남는지 대조한다.
