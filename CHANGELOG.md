# Changelog

이 프로젝트의 주요 변경 사항을 기록한다.

## [Unreleased]

### Changed

- 실제 cartograph·dartograph `bridges` 출력을 isthmus와 cartograph 보존 근거까지 왕복 검증
- 왕복 검증에서 cartograph 0.5.3 미만의 stale 바이너리를 fail-closed로 거부

## [0.1.3] - 2026-09-04

### Changed

- 보류된 조인의 직접 report/query/graph 생성을 거부하고 retention dedup 키 공간 분리
- 생성 없는 채널 등록 경고와 null-channel handler limitation 계약 추가
- Phase 0 Dart·Swift scope/provenance/조건부 컴파일/금지 문자 경계 보강
- 해석하지 못한 Dart receiver와 Swift named-function handler를 limitation으로 보고

## [0.1.2] - 2026-09-04

### Changed

- 아직 조인하지 않는 RN module·component fact를 0.1에서 fail-closed로 거부
- 입력 문서·fact·텍스트 크기 상한과 Unicode 줄 구분자 검증 추가
- clean `dist` 빌드와 검증 subprocess 제한시간·출력 버퍼 적용
- 설치 예시, Phase 0 한계, agent skill의 실패 처리 안내 보강

## [0.1.1] - 2026-09-04

### Changed

- bridge-facts의 추가 필드 제거, 실제 달력 시각·안전한 정수·platform 역할 검증
- project 불일치와 `mixed-targets` 전체 조인을 fail-closed로 처리
- query의 cross-kind 모호성·qualifiedName 우선순위와 graph 간선 상한·심볼 병합 보강
- 임시 retention 파일과 배포 source map 계약 강화
- Dart·Swift Phase 0 추출기의 경로·구문·어휘 범위·오탐 경계 보강
- Phase 0 손 조인을 제품 파서와 동기화하고 표준 검증에 포함

## [0.1.0] - 2026-09-04

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
