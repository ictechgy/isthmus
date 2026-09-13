# 런타임 통신 검증 계약

개발 소스의 `verify-runtime`은 명시한 시나리오에서 실제 관찰한 통신 결과를 검증한다.
아직 npm 0.5.0에는 없다. 이 문서의 fixture는 합성 소비자 검증이며 실제 Flutter 엔진에서
수집한 기록이 아니다. 수집기·앱 실행·정적 영향 연결은 전체 목표의 후속 구현이다.

```bash
npm run build
node dist/cli/main.js verify-runtime \
  --expectations fixtures/runtime/expectations.json fixtures/runtime/success.json --strict
```

## 독립적인 기대 목록

`bridge-expectations` v1:

```json
{
  "format": "bridge-expectations",
  "version": 1,
  "project": "/app",
  "revision": "tested-source-revision",
  "checks": [{
    "id": "photo-main-ios",
    "scenario": "take-photo",
    "platform": "ios",
    "instance": "main",
    "transport": "method-channel",
    "channel": "example/camera",
    "method": "takePhoto"
  }]
}
```

실행 로그를 보고 기대 목록을 역생성하면 누락된 실행을 발견할 수 없다. 검증할 기능에서
목록을 먼저 정한다. checks 1~10,000개, 고유한 id가 필요하다. 인스턴스 생략은 어떤
인스턴스든 허용한다는 뜻이다. 엔진별 검증이 필요하면 인스턴스를 명시한다.

## 실행 기록

`bridge-runtime` v1은 같은 project·revision과 producer의 `tool: {name, version}`,
`run: {id, scenario, platform, status, startedAt, finishedAt?}`, `droppedEvents`, `events`를 가진다.

- platform은 `ios/macOS`를 추측하지 않고 `ios|macos|android|linux|windows` 중 하나로 선언한다.
- run status는 `completed|incomplete`. 완료 실행은 종료 시각이 필요하며 시작보다 앞설 수 없다.
- 시각은 bridge-facts와 같은 유효한 timezone 포함 ISO 형식이다.
- event는 `sequence`, `instance`, `transport`, `channel`, `method?`, `outcome`, `caller?`다.
  sequence는 1부터 시작하는 고유한 정수, caller는 상대 `path`와 1부터 시작하는 `line/column`이다.
- transport `method-channel`은 method가 필요하다. `basic-message-channel`은 채널이 주소이며
  method를 붙일 수 없다. Pigeon 메서드 이름이나 접미사를 채널 문자열에서 임의로 파싱하지 않는다.
- outcome은 `success|missing-handler|error|timeout|pending`. 인자·반환값·원문 오류·스택은
  출력 계약에 없으며 입력에 있더라도 파싱 단계에서 버린다. 수집기 자체도 저장하지 않아야 한다.
- 이벤트 100,000개 상한. 수집을 제한하면 `droppedEvents`를 증가시킨다. sequence 빈 구간은
  적어도 그만큼의 유실 계수가 있어야 한다. 응답 대기는 pending으로 남긴다.
- 입력 파일당 16×1024², 전체 64×1024² UTF-16 코드 유닛 예산. 실행 파일은 최대 256개다.
- run id는 전체 입력에서 유일해야 한다. 다른 project·중복 run은 계약 오류다.

project와 revision은 생산자의 선언이다. 소비자는 서로 일치하는지 검사하며 실제 checkout·
빌드 내용까지 증명하지 않는다. 수집·CI 단계에서 변경된 소스의 정확한 식별자를 넣어야 한다.

## 판정과 증거

현재 revision의 run만 기대와 대조한다. 오래된 run은 `staleRuns`로 세고 전체 결과를 incomplete로
만든다. 시나리오·플랫폼·transport·channel·method·선택한 instance가 모두 맞아야 관찰 근거다.

- `passed`: 해당 라우팅의 성공 관찰이 있고 실행 중단·유실·대기·실패가 없다.
- `failed`: 같은 호출이 한 번 성공했어도 실패/미구현/timeout이 하나라도 있다.
- `unobserved`: 해당 기대와 맞는 호출을 관찰하지 못했다.
- `incomplete`: 맞는 관찰이 있지만 실행 중단·유실·대기가 남았다.

기대 밖 통신 실패도 `failures`와 전체 status에 반영한다. 전체 결과는 실행 공백이나 미충족
기대가 있으면 incomplete다. `scope: declared-scenarios`, `complete: false`를 항상 보존하므로
passed는 선언한 기대의 통과이며 모든 의존성·기능의 완전성 보증이 아니다.

항목별 evidence는 runId·sequence·instance·outcome·caller로 원본 기록을 가리킨다. 최대 20개를
표시하고 `observedCalls`·`evidenceOmitted`로 전체 수와 생략 수를 구분한다. 평가는 모든 호출에
적용한다. 증거 표시 생략은 원본 수집 유실(`droppedEvents`)과 다르다.

기본 모드는 보고서 생성 성공 0, strict는 failed/incomplete 1, 입력 실패 2, 사용법 오류 64다.
`--compact`는 JSON 공백만 줄인다. 로그에 비밀을 넣지 않는 책임은 수집기와 실행 환경에도 있다.
