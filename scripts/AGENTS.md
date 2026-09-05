# 검증 스크립트 지침

루트 [AGENTS.md](../AGENTS.md)를 따른다. 이 폴더는 제품 CLI와 달리 검증용 producer 실행을 담당한다.

- `build.mjs`와 tsconfig가 `dist/`를 만든다. 예전 파일이 남지 않는 clean build 계약을 유지한다.
- `run-tests.mjs`의 제품 커버리지 게이트와 Phase 0 조인 검증 연결을 유지한다.
- 자식 프로세스는 `run-child.mjs`를 사용해 인자 배열, 제한시간, 출력 버퍼와 오류 처리를 일관되게 한다.
  반환 상태·실행 오류·JSON을 확인하고, 자식 stderr를 그대로 사용자 오류로 내보내지 않는다.
- `verify-cli-contract.mjs`는 빌드된 CLI를 실행해 실제 출력과 `0/1/2/64` 계약을 확인한다.
- `verify-package-contract.mjs`는 npm 배포 파일 목록과 source map 등 공개 산출물을 검사한다.
  로컬 인증·실험 산출물이 패키지에 들어가지 않게 한다.
- 임시 문서는 전용 디렉터리와 제한된 권한으로 만들고 실패 경로에서도 정리한다.
  재귀 정리는 직접 만든 정확한 디렉터리의 소유 범위를 확인한 뒤 수행한다.
- 공개 source checkout은 저장소·revision·범위를 고정하고 Git 설정·hook 격리를 유지한다.
  새 네트워크 대상이나 범위는 작업 승인 범위를 확인한다.

## 실제 producer 검증

README의 최소 producer 버전과 명령을 함께 갱신한다. 검증 바이너리의 버전과 compiler index를
먼저 확인한다. 예전 release binary나 손으로 쓴 JSON만으로 현재 producer 호환성을 입증하지 않는다.

```bash
npm run build
node scripts/verify-cartograph-roundtrip.mjs /path/to/cartograph /path/to/dartograph /path/to/FalsePositiveCorpus
node scripts/verify-public-flutter-plugin.mjs /path/to/cartograph /path/to/dartograph
```

- 합성 corpus: 실제 두 producer → isthmus retentions → cartograph dead 억제·explain.
- 공개 plugin: 고정된 원본 소스의 Dart 위치·Swift USR·retention·대표 explain 근거.
  SwiftPM 타입 하네스 검증과 Flutter SDK로 앱 전체를 빌드한 검증을 구분한다.
- 두 producer의 `project`와 위치 기준은 같아야 한다. macOS 임시경로 별칭 차이를 주의하고
  검증 통과를 위해 경로나 프로젝트 정체성을 임의로 덮어쓰지 않는다.
- 이 두 검증은 일반 `npm run verify`에 포함되지 않는다. producer나 연동 변경·릴리스 시 별도로 실행한다.
