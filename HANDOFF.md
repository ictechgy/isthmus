# Handoff

_Last updated: 2026-11-22_

현재 재개 정보다. 규칙은 [AGENTS.md](AGENTS.md), 이전 발행·검증 원장은
[HANDOFF-HISTORY.md](HANDOFF-HISTORY.md)에 보존한다(2026-09-20 인계 원문은 그 파일 끝 절). 과거 Next Steps는
현재 실행 지시가 아니다.

## 현재 상태

- 발행본은 isthmus-cli **0.14.0**(npm `latest`, 2026-11-03)이다. 0.14.0 tarball의 `compatibility.json`은
  저장소 HEAD와 같고 producer 핀은 0.13.0 세트(cartograph 0.25.0·kartograph 0.20.0·dartograph 0.16.1·
  schemagraph 0.7.0·gartograph 0.9.1·rustograph 0.4.1·tsograph 0.10.0·pythograph 0.2.1)다.
- 공개 감시 세트 `compatibility.released.json`은 isthmus 0.13.0이다. 0.14.0으로 올리려면 cold-cache
  workflow(예약·수동 전용)를 0.14.0으로 실행한 기록이 먼저 필요하다. producer 최신 발행본
  (2026-11-03 기준 cartograph 0.30.0·kartograph 0.26.0·dartograph 0.17.0·schemagraph 0.9.0·gartograph 0.11.0·
  rustograph 0.7.0·tsograph 0.11.0·pythograph 0.3.1)의 공식 설치·호환 검증도 아직 없다
  ([COMPATIBILITY](docs/COMPATIBILITY.md)).
- 2026-11-03 계열 검토 후속은 #162(`4f6a874`, 2026-11-04 squash 머지)로 main에 들어갔고 아직 발행되지 않았다
  (CHANGELOG `[Unreleased]`). 독립 Claude 리뷰와 재검증을 거쳤다 — AGENTS.md의 GLM 리뷰는 `packet-ask`가 없는
  환경이라 실행하지 못했다. 포함 내용:
  - http root↔root 정확 매칭 작업 예산(조인당 10,000,000 단위, 넘으면 exit 2)
  - bridge 구성 요건의 target 단위 검사
  - `conformance-drift.mjs`의 케이스 `appliesTo` 판정(`stale-consumer-only`도 드리프트로 셈), 패키지 포함, 주간·수동 드리프트 workflow
  - extract-js `NativeModules` 출처·가림 규칙, 별칭·모듈 객체 접근
  - persistence `case-folded-relations:` 한계와 3부 이름 규칙 명시
  - COMPATIBILITY 발행 상태·설치 예제 핀 정정과 그 핀의 자동 검사
  - 계약 표·README·스킬 현행화, git 2.45 미만에서도 맞는 lazy fetch 격리 테스트
- 2026-11-15~16 js-binding-scope 측정과 그 후속 extract-js 수정·리뷰 반영은 PR #164로 main에 squash 머지됐다
  (`c9549e6`, 2026-11-16, 미발행, CHANGELOG `[Unreleased]`). 커밋별 내용·실제 패키지 비교·적대 입력 시간은
  [HANDOFF-HISTORY](HANDOFF-HISTORY.md)의 "완료 — js-binding-scope 측정과 extract-js 후속 (PR #164)" 절에 옮겼다.
- 2026-11-22 브랜치 `ccr-37904670-hxdjsx`(main `c9549e6`에서 다시 시작, 미푸시·미머지 — 푸시·PR은 조정자가 한다):
  "저장소마다 더 개선할 것을 찾아 개선하라"는 사용자 요청(계열 3차 배치)으로 후속 후보의 extract-js 거짓 사실·수집 공백
  두 항목을 고쳤다(CHANGELOG `[Unreleased]` `### Fixed` 앞 두 항목). 후보가 사용자 결정을 요구한 이유(참 사실도 줄어드는
  최소 수정)는 블록 범위 해석으로 피했다.
  - `ec42f32` 선언 바인딩·한 단계 문자열 상수를 블록 범위로 해석한다(`src/extract/js-scopes.ts`). 형제 함수·블록·메서드가
    같은 이름을 다른 모듈에 묶을 때의 거짓 `B.x`·`module-import Beta`, 안쪽의 모듈 아닌 같은 이름 선언·import 가림을
    무시한 거짓 `Outer.fake`·`Camera.take`, react-native import가 있는 파일의 함수 안 `const NativeModules = mock`이 낸
    베어 레지스트리 사실·거짓 `Fake.x`를 없앴다. `const`·`let`은 감싼 블록(for 머리는 그 for 문), `var`는 선언 블록에만
    값을 적용하고 함수 본문 전체를 가린다. 같은 범위의 다른 모듈 재선언·재대입은 귀속하지 않고(초기값을 셈), 블록 밖
    `var`·본문이 블록이 아닌 for 머리 선언 뒤처럼 값을 정하지 못한 모듈 바인딩 쓰임은 `js-binding-scope:`로 센다. 후보가
    제안한 "파일 안 충돌 이름 제거"와 달리 각 범위의 참 사실은 남는다. 줄어드는 출력은 재현으로 거짓임을 보인 사실과
    한계로 센 쓰임뿐이다.
  - `7ba0d32` 초기값 `{…}`(함수 본문·객체 리터럴·클래스 본문) 안 선언·재대입·export를 수집한다. 선언을 `{`에서 멈추고
    바깥 순회가 본문을 읽은 뒤 짝 `}`에서 이어 읽어 재귀하지 않는다. 함수형 컴포넌트·훅의 호출이 귀속된다.
  - 근거: 수정 전 main(`c9549e6`)의 거짓 사실 재현 → 수정 뒤 같은 입력. 새 회귀 테스트는 main(첫 커밋 몫)과 첫 커밋
    (둘째 커밋 몫)에서 실패하고, 변이 11종(객체 키 가드, var 함수 범위, 넓힌 가림 표시, 가린 모듈 표시, 같은 범위
    충돌 판정, 호출별 바인딩, 본문 멈춤, 수집 중 사슬, 동결 색인, 위치별 로컬 판정, import보다 안쪽 대역)이 모두 테스트에
    잡혔다. 공개 패키지 12개
    (react-native 0.88.1, react-native-screens 4.30.1, react-native-vision-camera 5.2.4, expo-haptics 14.1.4,
    expo-camera 58.0.14, react-native-svg 15.16.1, react-native-reanimated 4.8.0, react-native-gesture-handler 3.5.0,
    react-native-webview 14.0.1, react-native-device-info 15.0.2, @react-native-async-storage/async-storage 3.1.1,
    @react-native-community/netinfo 12.0.1)의 사실·한계 수와 `--events` 출력은 main과 같다 — 이 패키지들은 모듈 범위에서
    바인딩한다. 함수 범위 바인딩을 쓰는 공개 앱 코퍼스는 이 환경에서 받을 수 없어(GitHub codeload 차단) 합성 테스트로만
    확인했다.
  - 적대 입력: 같은 이름의 형제 함수 4만 개(`var M = …; M = other;`)는 약 0.8초다(main 약 0.5초). 같은 이름 범위를 전부
    훑던 중간 구현은 약 7초(이차)여서 수집 중 활성 사슬·동결 색인으로 바꿨다. 1만 단계로 중첩된 초기값 본문·블록은 0.1초대에
    호출 스택을 넘기지 않는다.
  - `npm run verify` 통과. GLM 리뷰는 `packet-ask`가 없어 실행하지 못했다.
- 생산자 사본 드리프트는 `node scripts/conformance-drift.mjs <producer>=<checkout> ...`로 본다. 이 후속 직전에는
  cartograph·kartograph의 `http-limitation-scope.json`만 생산자 케이스 차이였고, 나머지는 consumer 전용 케이스 차이
  (`stale-consumer-only`, 드리프트로 셈)였다. tsograph는 그 consumer 전용 `dispatch.validate` 케이스를 실행한다.

## 후속 후보 (사용자가 고르기 전에는 착수하지 않는다)

- 생산자 버전 경보: 검증 세트보다 오래된 생산자 문서를 알리는 소비자 한계를 시도했지만, 한계가 `impact --strict`
  등 엄격 게이트의 "분석 공백"으로 세어져 종료 코드가 0→1로 바뀌었다. 게이트에 들지 않는 별도 notice 채널이
  필요하며 출력 계약 설계가 먼저다.
- 새 공유 suite(열 인코딩, persistence 이름, limitation 접두사 목록): 생산자 8곳이 함께 바뀐다.
- bridge 문서가 스캔한 target을 밝히는 선택 필드(`scannedTargets` 초안, GRAPH-EXCHANGE)의 생산자 합의.
- extract-js 남은 파일 전역 지도(2026-11-22 확인, 기존 동작): 모듈 객체 판정용 `requireSpecifiers`·`requireModules`·
  `interopDefaultModules`·`destructuredSources`는 아직 파일 전역이다. 한 함수의 `const { NativeModules } = require('react-native')`가
  다른 함수의 `const NativeModules = mock`을 레지스트리로 읽게 만든다(거짓 사실). 블록 범위 표의 선언에 출처를 실으면 고칠 수 있다.
- extract-js 가림 공백(기존 동작): 블록 범위 표에 넣지 않는 이름 — `catch (M)` 매개변수, 배열 구조 분해 `const [M]`,
  함수·클래스 선언 이름, 식 본문 화살표 매개변수(`M => M.x()`) — 은 같은 이름의 바깥 모듈 바인딩을 가리지 않아 그 안의
  호출이 바깥 모듈로 귀속될 수 있다. JSX 속성 `name={…}`은 재대입으로 읽혀 같은 이름 바인딩을 지운다(사실이 줄 뿐이다).
  속성 자리 API로 만든 초기값(`var M = _reactNative.NativeModules.A`)은 바인딩이 아니어서 Babel 출력의 `M.x()`는 귀속되지
  않는다(초기값을 js-binding-scope로 센다).
- extract-js 남은 관찰 공백(리뷰 반영 중 확인, 모두 js-binding-scope로 셈): 중첩 제네릭 인수를 둔 API 호출
  (`requireNativeModule<A<B>>('X')`, `>>` 한 토큰)은 호출로 읽지 않는다. JSX는 토큰으로 나누지 않아 `</Text>`의 `/`가
  정규식으로 읽힐 수 있고, 줄 끝 JSX `>`·`/>`는 ASI 피연산자 끝으로 보지 않는다(비교 `>`와 구분 불가). JSX 형제 자식
  `{a}{NativeModules.Info.version}`의 두 번째 `{…}`는 블록으로 보여 그 값이 버려지는 식 문장으로 분류된다(재검토 N-d).
  타입 매개변수 기본값이 있는 제네릭 화살표 `<T = X,>(x) => {…}`는 `=` 때문에 한 덩어리로 건너뛰지 못해, 쉼표가
  선언자 목록을 다시 열고 뒤 객체 리터럴을 패턴으로 읽는다(재검토 N-c, import 없이 전역 NativeModules를 읽는 파일만 영향).
- 발행 workflow·npm provenance(외부 권한 필요), 파일별 커버리지 하한.

## 머지 뒤 바로 알아 둘 것

- 새 주간 `conformance-drift` workflow는 생산자 7곳이 isthmus `c76e105` 벡터를 다시 벤더링한 PR을 머지하기
  전까지 실패한다(예상된 신호). 그 PR들은 같은 계열 검토 배치(각 저장소 브랜치 `ccr-37904670-hxdjsx`)로 열려 있다.
- 다음 릴리스(0.15.0 후보)는 `[Unreleased]`를 발행한다. `compatibility.json` 생산자 핀은 공식 설치·cold-cache
  검증 기록이 생긴 뒤에만 올린다.
- js-binding-scope 줄의 문구가 바뀌었다. 고정 문구 전체를 맞추던 사용처는 `js-binding-scope:` 접두사로 바꿔야 한다
  (저장소 안 사용처는 없다. `experiments/real-corpus/results`의 옛 문구는 0.7.0 실행 기록이라 그대로 둔다).
  `unattributed-js-native-modules:`(미발행) 메시지도 추적되지 않는 객체의 속성 접근까지 설명하도록 바뀌었다.
- extract-js 수정으로 사실이 늘거나 줄 수 있다: 세미콜론 없는 코드·for-of 뒤·import 없는 전역 NativeModules
  파일은 사실이 늘고, 출처 모를 객체의 속성 API(`jest.requireActual('react-native').NativeModules.X` 포함)와 홀수
  체인 위치의 거짓 귀속은 사라진다. `check --strict` 결과가 바뀔 수 있다.
- (이 브랜치) js-binding-scope 문구에 "redeclared"와 "used outside the block a declaration is scoped to"가 더해졌다(접두사
  그대로). 함수형 컴포넌트·훅에서 바인딩하는 앱 소스는 method-invoke·module-import 사실이 늘고, 형제 범위의 같은 이름·안쪽
  대역으로 생긴 거짓 귀속은 사라진다. `check --strict`·`impact --strict` 결과가 바뀔 수 있다.

## Resume Prompt

HANDOFF.md와 적용 AGENTS.md를 읽고 branch/status를 확인해줘. isthmus-cli 0.14.0은 발행됐고, 2026-11-03 계열
검토 후속(#162)과 js-binding-scope 측정·extract-js 후속(#164)은 main에 머지됐으나 미발행(`[Unreleased]`)이다.
2026-11-22 extract-js 블록 범위 바인딩·초기값 본문 수집은 브랜치 `ccr-37904670-hxdjsx`에 있다 — 푸시·PR 여부는
`git status`와 GitHub로 확인한다. 발행 여부는 npm registry로 확인하고, 위 후속 후보와 릴리스는 내가 고르기 전에 착수하지 마.
