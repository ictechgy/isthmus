# 변경 사전 점검 목표와 검증 기록

2026-09-14 시작. 사용자 목표는 아래 네 가지이며, 일부 명령의 테스트 통과로 전체 목표를
완료 처리하지 않는다. MIT·로컬 실행·근거와 분석 한계 보존은 유지한다.

## 완료 기준

1. 특정 파일·심볼 변경 전에 직접·전이 영향을 찾고 원인이 되는 경로와 양쪽 소스 위치를
   제공한다. 브리지 밖 언어 내부 의존성도 producer 근거로 연결한다. 삭제·미관찰 파일,
   모호한 심볼, 동적 의존성을 깨끗한 결과로 처리하지 않는다.
2. 배포되는 질의 skill 또는 MCP로 필요한 영향 범위를 적은 호출과 출력으로 가져온다.
   실제 설치본에서 발견·호출·결과 해석을 검증한다. 출력 절약 때문에 근거·한계를 잃지 않는다.
3. 런타임에서 드러나는 브리지 의존성을 실제 실행에서 수집하고 정적 관찰과 대조한다.
   실행 환경·시나리오·revision·호출 실패를 구분하고, 실행하지 않은 경로를 통과로 처리하지
   않는다. MethodChannel 및 Pigeon/BasicMessageChannel 공개 사례를 검증한다.
4. CI에서 관찰을 자동 갱신하는 재현 가능한 workflow와 성능 근거를 제공한다. 전체 실행과
   반복/증분 실행을 측정하고, 코드·설정·producer 변경과 삭제 시 오래된 근거 재사용을 막는다.

## 구현 순서

- [x] 파일·심볼·변경 목록에서 브리지 영향과 관련 진단을 찾는 `impact` 명령.
- [ ] 언어 내부 의존성 producer 연결과 전이 영향 경로. 단순한 브리지 영향만으로 1번 완료 금지.
- [ ] 영향 질의용 배포 skill과 효율적인 반복 질의 인터페이스.
- [ ] 런타임 관찰 계약·수집기·정적 대조·시나리오 누락과 실패 검증.
- [ ] Pigeon/BasicMessageChannel 및 공개 프로젝트에서 적용 범위 실측.
- [ ] CI 갱신·성능/캐시 무효화 검증과 처음 설치하는 사용자를 위한 재현 절차.
- [ ] 전체 제품 verify, 경계 통합, 실제 사례, 설치본, PR GLM 리뷰.

## 현재 근거

- 시작 HEAD `fe786f9`, 깨끗한 main에서 `feat/change-preflight` 분기.
- 기존 `npm run verify`: 제품 287개, Phase 0 15개, CLI/package/build 통과(직전 조사).
- 공개 battery 플러그인은 근거 전달을 입증하지만 public 핸들러의 오탐 감소를 입증하지 않는다.
- 공식 url_launcher_ios는 Pigeon의 BasicMessageChannel과 접미사를 사용한다. 기존 MethodChannel
  조인만으로 지원됐다고 주장할 수 없다.
- 비교 대상: [Pigeon](https://pub.dev/packages/pigeon),
  [GlassWing](https://github.com/glasswing-ase25/GlassWing),
  [CodeGraph의 RN/Expo 경계](https://github.com/colbymchenry/codegraph#mixed-ios--react-native--expo-bridging).
  경쟁 제품의 README 기능과 실제 실행 정확도를 구분한다.

## 진행 기록

- `impact` 구현: 파일·정확 심볼·변경 JSON, 관련 호출자/핸들러/배선·진단·검토 파일,
  미관찰/동적 선택 보존, 관련 공백도 실패시키는 strict, 정보 손실 없는 compact.
- 검증: `npm run verify` 제품 309개·Phase 0 15개·build/CLI/package 통과.
  coverage line/branch/functions 99.02/95.90/97.25. 로그 `/tmp/isthmus-impact-verify.log`.
- 배포 skill의 impact 절차·미발행 구분을 추가하고 realpath 발견/패키지 포함 검사를 통과.
  기본 python에는 PyYAML이 없었으나 `/usr/bin/python3`에 있어 quick_validate 통과.
- cartograph는 별도 세션이 `feature/change-impact-workflow`에서 전이 영향 분석을 수정 중.
  그 저장소는 변경하지 않는다. 새 `change-impact` v1의 `changed/affected/via/depth`,
  `selectionIssues/limitations/truncated`를 확인했다. 아직 변하는 출력이므로 연동 전 재확인 필요.
- dartograph의 기존 `affected`는 import/export 라이브러리 수준이다. 심볼 전이 분석으로
  과장하지 않는다. bridge 호출 위치를 그래프 선언에 임의로 귀속시키지 않는다.

아직 전체 목표 미완료. 전이 경계 연결·런타임 수집/검증·CI 자동 갱신/성능·실제 앱 검증은
남아 있다. 외부 사용자 도입성과 실제 앱의 탐지율도 미검증이다.
