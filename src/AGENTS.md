# 제품 코드

루트 [AGENTS.md](../AGENTS.md)를 따른다. 제품 계약은 [GRAPH-EXCHANGE.md](../docs/GRAPH-EXCHANGE.md)다.

## 경계

- `exchange/`: `unknown` JSON을 검증·정규화한다. I/O·조인·보고 정책을 넣지 않는다.
- `join/`: 검증된 사실을 논리 키로 묶는다. I/O·표현 형식을 넣지 않는다.
- `report/`: 조인 결과를 check/query/graph/diff/retention 문서로 변환한다.
- `cli/`: 인자·파일 I/O·스트림·종료 코드. lower layer가 CLI를 import하지 않게 한다.
- TypeScript strict 설정 유지. 주석은 한국어, 식별자·사용자 메시지는 영어.
  공개 타입·함수에는 계약과 존재 이유를 설명하는 문서 주석을 둔다.

## Code Review Rules

- parser/join의 project·platform·target·경로·시각·크기·문자열 검증을 재사용한다.
  `mixed-targets` 보류나 미해석 사실을 빈 정상 결과 또는 추측한 정적 연결로 바꾸면 결함이다.
- JSON 키와 논리 목록은 기존 정렬 도우미를 쓰고 증거 중복을 제거한다.
  locale 의존 정렬, 충돌하는 키 직렬화, 상한 없는 Cartesian 곱을 피한다.
- query의 `subject/usedBy/dependsOn/limitations`와 모호성 응답을 유지한다.
  retention의 Swift USR·Dart 호출 근거를 보존하고 USR/이름 dedup namespace를 분리한다.
- diff는 논리 연결의 관찰 차이다. endpoint 교체·rename·생성 시각으로 revision 순서를 추론하지 않는다.
  양 시점의 한계와 producer 메타데이터가 유지돼야 한다.
- `0/1/2/64`는 명령별 의미를 따른다. check strict는 현재 error, diff strict는 새 error에만 1이다.
  실패는 원인 종류·해결 방향을 제공하되 입력 본문이나 민감한 경로를 노출하지 않는다.

## 테스트

테스트는 모듈 옆 `*.test.ts`. 집중 실행은 `node --test src/<module>/<name>.test.ts`.
전체 게이트는 루트 지침을 따른다. 기대값은 독립 리터럴·수동 검증 fixture로 만들고,
수정한 분기의 순서·중복·동적/미귀속·오류·상한을 검사한다. CLI 변경은 실제 프로세스와
빌드된 명령 계약도 확인한다. 검증이나 limitations를 삭제해 테스트를 통과시키지 않는다.
