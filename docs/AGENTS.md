# 계약·계획 문서 지침

루트 [AGENTS.md](../AGENTS.md)를 따른다.

- [GRAPH-EXCHANGE.md](GRAPH-EXCHANGE.md)는 producer와 consumer가 공유하는 계약의 정본이다.
  형식을 먼저 합의한 뒤 코드를 수정한다. 변경 시 영향받는 모든 자매 저장소의 동시 PR과 호환성 검증을 계획한다.
- 필드 의미·버전·platform 역할·target·동적/미귀속 값·위치·시각·입력 상한을 명시한다.
  구현이 못 보는 범위를 형식의 정상 부재와 구분한다.
- [PRD.md](PRD.md)는 제품 의도, [PLAN.md](PLAN.md)는 실행 순서,
  [RESEARCH.md](RESEARCH.md)는 확인된 사실과 미검증 가정을 구분한다.
- 실제 구현·릴리스와 계획을 혼동하지 않는다. 진행 단계·producer 출시 여부·검증 수치를 바꿀 때
  코드·테스트·registry/릴리스 결과 등 근거를 확인한다.
- 성능·정확도·지원 범위를 측정 없이 단정하지 않는다. 합성 fixture, 공개 plugin 하네스,
  실제 앱 빌드가 각각 증명하는 범위를 구분한다.
- 리서치에는 출처와 확인 시점을 남긴다. 타 도구가 기능을 제공하지 않는다는 주장을 오래된 조사로 단정하지 않는다.
- README·CHANGELOG·배포용 `Skills/isthmus/SKILL.md`와 계약·사용법이 충돌하지 않게 확인한다.
  HANDOFF의 후속 제안은 승인된 계약 변경이나 이미 구현된 동작이 아니다.
