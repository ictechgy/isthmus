# Handoff

_Last updated: 2026-09-20_

현재 재개 정보다. 규칙은 [AGENTS.md](AGENTS.md), 이전 발행·검증 원장은
[HANDOFF-HISTORY.md](HANDOFF-HISTORY.md)에 보존한다. 과거 Next Steps는 현재 실행 지시가 아니다.

## 현재 상태

- 현재 소스 버전은 isthmus-cli **0.9.0**이며 호환 세트는 cartograph **0.20.0**, kartograph
  **0.13.0**, dartograph **0.15.0**이다. [npm 0.9.0](https://www.npmjs.com/package/isthmus-cli/v/0.9.0)과
  [릴리스](https://github.com/ictechgy/isthmus/releases/tag/v0.9.0)는 발행 후 설치 근거와 함께 확인한다.
  현재 [compatibility.json](compatibility.json)과 불변 npm 0.8.0의 옛 manifest를 구분한다.
- JS 이벤트 추출은 안정적인 모듈 범위 let/var와 직접 CommonJS RN namespace를 지원한다.
  초기화 전·재할당·escape·이름 가림·생성자 변경과 const 블록 범위 밖 구독은 확정하지 않는다.
  [공개 RN 두 버전](experiments/real-corpus/results/rn-event-development-results.json)은
  **TP 4 / FN 0 / FP 0**이다. 발행본의 TP3/FN1 기록은 덮어쓰지 않았다.
- v1/v2 `generatedAt`은 추출 시각이며 optional `sourceModifiedAt`은 관찰한 source mtime이다.
  Kotlin producer가 두 값을 분리한다. 파서·impact/diff는 선택 메타데이터를 보존한다.
  시각은 compiler freshness나 실행 완전성 증거가 아니다. [공유 계약](docs/GRAPH-EXCHANGE.md)을 따른다.
- [공개 Sound.kt 컴파일 검사](experiments/real-corpus/results/rn-compiled-development-results.json)는
  Kotlin2.4.20/JVM21·Android SDK·명시적 RN API 스텁을 사용했다. 실제 JVM ID에 연결한
  retention으로 dead 후보를 억제하고 JS127행 explain을 확인했다. 무관한 메서드는 미도달로 남는다.
  RN 엔진 실행·전체 앱·Gradle witness 검증으로 과장하지 않는다.
- [실제 Flutter 앱 결과](experiments/real-corpus/results/runtime-development-results.json)는
  Flutter3.47.2 macOS 앱과 소유한 Android API36 arm64 에뮬레이터의 성공·오류·미등록·timeout·pending을
  대조한다. macOS 하네스는 현재 SDK의 CocoaPods 설정을 앱 단위로 지정한다.
  Android `--new-emulator`는 연결된 사용자 기기를 선택하지 않고 전용 AVD를 만든다.
  물리 기기·iOS·release·모든 lifecycle·RN 엔진은 검증하지 않았다.
- kartograph 후속에는 정확한 dependency baseline/suppress와 JSR-269 Filer 기반 processor
  source 귀속이 포함된다. [kartograph 인계](https://github.com/ictechgy/kartograph/blob/main/HANDOFF.md)와
  각 PR의 최종 CI·GLM 처분을 따른다. KAPT/KSP·processor 직접 파일 쓰기까지 지원한다고 주장하지 않는다.
- 원시 로그·실행 실패/복구·검증 기록은 로컬 `.git/remaining-all-20260920/`에 있다.
  앞선 발행본 15케이스 TP83/FN0과 캐시 검증은 `.git/release-corpus-docs-20260920/` 원장을 재사용한다.
  다른 checkout에서 이 로컬 경로가 존재한다고 가정하지 않는다.
- 작업 소유 캐시 7개를 휴지통으로 옮겼고 원본·아카이브·compiled class·snapshot 등
  76개 보존 파일의 해시가 같음을 확인했다. SDK와 검증 로그는 유지했다. 복원은 로컬
  `.git/remaining-all-20260920/cleanup-final.json`의 from/to 경로를 따른다.
  1,187,371 logical bytes의 휴지통 이동을 디스크 공간 회수로 해석하지 않는다.
- `docs/RESEARCH.md`, kartograph `.claude/`·`HANDOFF.cartograph-notes.md`, dartograph
  `HANDOFF-PROGRESS.md`·`editors/vscode/icon-drafts/`는 기존 사용자 변경으로 보존한다.

## 재개 기준

이번 후속의 실제 머지·CI 상태는 PR에서 확인한다. 구현·후보 검증·발행본·앱 실행을 구분한다.
0.9.0/0.13.0 발행 작업의 원시는 로컬 `.git/release-followups-20260920/`에 기록한다.
버전 파일만으로 발행을 단정하지 말고 registry·실제 설치·릴리스 CI를 확인한다. 기존 태그/아카이브는 바꾸지 않는다.
물리 기기/iOS와 KAPT/KSP 확장은 추가 환경·구현 범위를 명시해 선택한다. 이미 끝난 RN var 누락,
타임스탬프 분리, 공개 컴파일 retention, macOS/Android 하네스를 과거 목록 때문에 다시 시작하지 않는다.
