# src/AGENTS.md

Phase 2 제품 코드의 모듈 경계다. 저장소 루트 지침과 `docs/GRAPH-EXCHANGE.md`를 먼저 따른다.

- `exchange/`: bridge-facts v1 파싱과 검증. 조인이나 보고 정책을 넣지 않는다
- `join/`: 검증된 사실의 문자열 키 조인. 파일 I/O와 출력 형식을 넣지 않는다
- `report/`: 조인 결과를 사용자·에이전트용 진단으로 변환한다
- `cli/`: 인자, 파일 I/O, 표준 입출력, 종료 코드만 담당한다

의존 방향은 `exchange` → `join` → `report` → `cli`다. 아래 계층이 위 계층을 import하지 않는다.
모든 공개 타입·함수에는 계약과 존재 이유를 설명하는 문서 주석을 붙인다.
