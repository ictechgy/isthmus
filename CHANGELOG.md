# Changelog

이 프로젝트의 주요 변경 사항을 기록한다.

## [Unreleased]

### Added

- bridge-facts 버전 1 계약과 Dart·Swift Phase 0 추출 코퍼스
- `channel: null`과 `mixed-targets`에서 조인을 보류하는 안전 규칙
- TypeScript exchange 파서, 논리 키 조인, 세 종류 `check` 진단
- 결정적 `isthmus-check` JSON과 입력 limitations·신선도 보고
- `check <files...> [--strict]` CLI와 종료 코드 `0/1/2/64` 검증
- `retentions <files...> --for cartograph`와 실제 `dead`·`--explain` 왕복 검증
- `query <channel|method> <files...>` 양방향 조회와 qualifiedName 모호성 해소·미발견 응답
- `graph <files...> [--format json|dot|mermaid]` 경계 그래프 출력
- 네이티브 핸들러 변경 전 경계 호출자 확인을 안내하는 배포용 isthmus skill
- 최소 Node 버전에서 전체 검증을 실행하는 SHA 고정 GitHub Actions CI
- 루트·명령별 `--help`와 package metadata 기반 `--version`
- 제품 코드 라인·함수·분기 90% 커버리지 게이트

### Changed

- locale과 입력 순서에 무관한 정렬, 중복 증거 제거, qualifiedName 구분자 이스케이프
- bridge-facts의 timezone 없는 시각과 이름 제어 문자를 거부하도록 입력 검증 강화
- cartograph 보존 문서의 생산 버전을 package metadata와 동기화
