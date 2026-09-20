# Handoff

_Last updated: 2026-09-20_

현재 재개 정보만 담는다. 작업 규칙은 [AGENTS.md](AGENTS.md), 이전 원문·측정·판정은
[HANDOFF-HISTORY.md](HANDOFF-HISTORY.md)에 보존한다. 과거 Next Steps·미발행 표기는 당시 기록이다.

## 현재 재개 기준

- npm **isthmus-cli 0.8.0**은 사용자가 발행했고, [v0.8.0 릴리스](https://github.com/ictechgy/isthmus/releases/tag/v0.8.0)의
  소스는 `5825329`다. registry 아카이브와 검증 후보가 바이트 단위로 같고 별도 npm 설치의
  CLI 계약·cold-cache 검증이 통과했다. [공개 설치 CI](https://github.com/ictechgy/isthmus/actions/runs/35489733996)도 두 잡 모두 성공했다.
- 현재 [호환 manifest](compatibility.json)와 cold-cache CI는 cartograph 0.20.0·kartograph 0.12.0·
  dartograph 0.15.0을 대상으로 한다. npm 0.8.0에 포함된 발행 시점 manifest의 kartograph는
  0.11.0이며, 현재 저장소의 추가 검증과 구분한다. 기존 아카이브는 불변이다.
- 추가 검증은 **kartograph 0.12.0**을 사용한다. 0.11.0의 일반 `bridges --target react-native`
  사용 오류를 공개 expo-haptics에서 발견해 [kartograph PR #87](https://github.com/ictechgy/kartograph/pull/87)에서
  수정했다. 이 버전은 P1.1-2 의존성 분석·Gradle task와 누락됐던 배포 문서도 포함한다.
  GitHub·Plugin Portal 발행, 공개 아카이브 해시, 독립 CLI/Portal 설치를 확인했다.
  [Release CI](https://github.com/ictechgy/kartograph/actions/runs/35495655546)도 성공했다.
- 전체 Flutter 발행본 검증: **15/15, TP 83 / FN 0 / FP 0**, 15개 cache miss→hit·보고서 동일성.
  최종 발행본으로 다시 실행해 같은 결과를 확인했다. 실행 방법과 관찰 범위는
  [공개 코퍼스](experiments/real-corpus/README.md), [캐시 측정](experiments/real-corpus/CACHE-MEASUREMENTS.md)을 따른다.
- RN 원본 코퍼스는 react-native-sound0.13.0의 TS 구독↔Kotlin 방출과 0.11.2의 알려진 JS
  caller 누락을 함께 기록한다. TP/FN 단위는 소스 사실이며, 누락을 0으로 보정하지 않는다.
  Expo Haptics의 Swift3·Kotlin4 수신 메서드도 독립적으로 대조한다.
- 하네스는 공개 원본을 스텁과 함께 정적으로 분석한다. Flutter/RN 엔진·기기·앱 전체 런타임,
  소스 전용 Kotlin의 JVM ID·보존 성공을 검증했다는 뜻은 아니다.
- cartograph Action 예제는 0.20.0 태그로 고정했고, cartograph·dartograph의 현재/과거 인계
  분리는 각각 [#128](https://github.com/ictechgy/cartograph/pull/128)·[#132](https://github.com/ictechgy/dartograph/pull/132)로 머지됐다.
- `docs/RESEARCH.md`는 기존 사용자 수정이다. kartograph의 `.claude/`·`HANDOFF.cartograph-notes.md`,
  dartograph의 `HANDOFF-PROGRESS.md`·icon-drafts도 사용자 파일로 보존한다.
- 원시 검증·리뷰·발행 기록은 로컬 `.git/release-corpus-docs-20260920/`, 앞선 발행 근거는
  `.git/release-p1-20260920/`에 있다. 다른 checkout에서 이 경로의 존재를 가정하지 않는다.
- 측정 종료 후 이 작업의 Swift build·독립 Gradle 다운로드 캐시 15개 디렉터리를 휴지통으로
  옮겼다. 원본 소스·아카이브·설치본·결과·리뷰 로그는 보존했으며, 복원 경로는 로컬
  `cleanup-final.json`에 있다. 휴지통 이동을 디스크 공간 회수로 해석하지 않는다.

## Next Steps

요청한 kartograph0.12.0 발행·공개 코퍼스/캐시 확대·네 저장소 인계 정리는 완료 근거를
위에 기록했다. 문서/결과 PR의 실제 머지 상태는 GitHub에서 확인하고, 과거 작업을 다시 시작하지 않는다. 이후의 선택 후보는 다음과 같다.

- 실제 앱/기기 런타임 검증과 공개 원본의 컴파일러 ID를 포함하는 RN/Kotlin 보존 코퍼스.
- 알려진 JS `var` emitter 등 추출 한계의 후속 검토. 휴리스틱이나 합성 사실로 공백을 지우지 않는다.
- kartograph dependency baseline/suppress·processor 귀속 등 추가 기능은 별도 범위다.

## Resume Prompt

HANDOFF.md와 적용 AGENTS.md를 읽고 branch/status를 확인해줘. isthmus0.8.0 발행은 완료됐고,
kartograph0.12.0 발행과 공개 코퍼스/캐시 검증 확대도 끝났어. 최종 결과·발행·머지는 실제
PR/릴리스와 기록으로 확인해. HANDOFF-HISTORY.md의 옛 Next Steps를 현재 지시로 삼지 말고,
RESEARCH 등 사용자 파일을 보존해. 후보 검증·발행본 검증·앱 런타임을 구분해.
