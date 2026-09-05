# 빌드·검증 workflow

루트 [AGENTS.md](../AGENTS.md)를 따른다. `build.mjs`와 tsconfig가 `dist/`를 만든다.

- `npm run verify`는 clean build 검증을 한 번 수행한 뒤 같은 산출물로 CLI/package 계약을 검사한다.
  `verify:cli`·`verify:package` 단독 명령은 자체 build 검증을 유지한다.
- `run-tests.mjs`의 Node 커버리지 게이트와 Phase 0 조인을 유지한다. 검사 생략으로 속도를 얻지 않는다.
- 자식 실행은 `run-child.mjs`의 인자 배열·timeout·버퍼를 재사용한다. 상태·실행 오류·JSON을 확인한다.
  zsh의 문자열 자동 분할이나 macOS `timeout`을 가정하지 않는다. PID/프로세스 핸들로 기다린다.
- 독립 읽기는 병렬화할 수 있으나 `dist/`를 바꾸는 build/package 검사를 동시에 실행하지 않는다.
- `verify-cli-contract.mjs`는 실제 명령 출력·종료 코드, `verify-package-contract.mjs`는 배포 파일·source map을 확인한다.
- 임시 디렉터리는 전용 경로·제한된 권한으로 만들고 실패 시에도 정리한다.
  직접 만든 정확한 디렉터리의 범위를 확인한 뒤 재귀 정리한다.
- 공개 checkout은 고정 저장소·revision·sparse 경로·Git 설정/hook 격리를 유지한다.
  CI는 최소 Node·읽기 권한·시간 제한·SHA 고정 Action을 유지하며 PR과 main push를 검사한다.

## producer 경계를 바꿀 때

README의 최소 버전과 명령을 함께 확인한다. 최신 실행 파일과 compiler index를 사용한다.

```bash
npm run build
node scripts/verify-cartograph-roundtrip.mjs /path/to/cartograph /path/to/dartograph /path/to/FalsePositiveCorpus
node scripts/verify-public-flutter-plugin.mjs /path/to/cartograph /path/to/dartograph
```

합성 corpus는 producer → retention → dead 억제·explain을, 공개 plugin은 원본 Dart 위치·Swift USR·
대표 evidence를 검증한다. 두 검사는 일반 npm verify 밖에서 해당 연동 변경·릴리스 시 실행한다.
같은 project·추출 범위를 사용하고 경로 별칭 차이를 살핀다. 통과를 위해 문서의 project를 임의로 덮어쓰지 않는다.
