# 제품 코드 지침

루트 [AGENTS.md](../AGENTS.md)를 따르며, 계약은 [GRAPH-EXCHANGE.md](../docs/GRAPH-EXCHANGE.md)다.

## 모듈 경계

- `exchange/`: 외부 JSON을 검증·정규화한다. 파일 I/O·조인·보고 정책을 넣지 않는다.
- `join/`: 검증된 사실의 논리 키를 연결한다. 파일 I/O·출력 형식을 넣지 않는다.
- `report/`: 조인 결과를 check/query/graph/diff/retention 문서로 변환한다.
- `cli/`: 인자·파일 I/O·표준 입출력·종료 코드를 담당한다.

데이터는 exchange → join → report → cli 순서로 흐르며, 하위 계층은 상위 계층을 import하지 않는다.
테스트는 해당 모듈 옆 `*.test.ts`에 둔다. 작은 모듈마다 지침 파일을 중복 생성하지 않는다.

## 구현과 출력 계약

- TypeScript strict 설정을 유지한다. 외부 JSON은 `unknown`에서 검증하며 타입 단언으로 경계를 우회하지 않는다.
- 프로젝트·플랫폼·target·위치·크기·문자열 검증은 기존 parser/join 경계를 재사용한다.
- `mixed-targets`처럼 조인을 보류해야 하는 입력을 빈 정상 결과로 바꾸지 않는다.
- 동적 이름·미귀속 핸들러·누락된 producer는 불완전성의 근거다. 추측으로 정적 연결을 만들지 않는다.
- JSON은 기존 정렬 도우미로 결정적으로 출력한다. 배열도 논리 키 기준 정렬·증거 중복 제거를 유지한다.
  locale 의존 정렬이나 대량 Cartesian 곱 생성으로 안정성과 입력 상한을 깨뜨리지 않는다.
- `query`는 기존 `subject`, `usedBy`, `dependsOn`, `limitations` 골격과 모호성 응답을 유지한다.
- `retentions`는 Swift 심볼의 USR과 호출 근거를 보존하고, USR과 이름 dedup 키를 분리한다.
- `diff`는 논리 키의 전후 관찰 차이다. 줄 이동·동적 전환을 rename이나 삭제 안전성으로 해석하지 않는다.
  두 시점의 분석 한계와 producer 메타데이터를 보존한다.
- 종료 코드 `0/1/2/64`는 각 명령의 공개 계약을 따른다.
  특히 `check --strict`는 현재 error, `diff --strict`는 새 error에만 1이다.
- 주석은 한국어, 식별자·사용자에게 보이는 메시지는 영어로 작성한다.
  공개 타입·함수에는 존재 이유와 계약을 설명하는 문서 주석을 붙인다.

## 검증

- 집중 검증: `node --test src/<module>/<name>.test.ts`.
- 전체 제품 게이트: `npm run verify`. CLI 변경은 실제 프로세스와 빌드된 CLI 계약도 검증한다.
- 기대값은 제품 함수로 재계산하지 않는다. 수동으로 검증한 fixture나 독립적인 리터럴을 사용한다.
- 입력 순서·중복·같은 이름의 다른 채널·동적/미귀속 사실·잘못된 입력·크기 상한을 해당 변경에 맞게 검증한다.
- 테스트가 통과하도록 검증이나 `limitations`를 삭제하지 않는다.
