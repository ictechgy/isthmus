# Handoff

_Last updated: 2026-11-16_

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
- 2026-11-15: extract-js `js-binding-scope:` 한계를 측정한다 — 브랜치 `ccr-37904670-hxdjsx`의 `057a133`
  (PR #164로 열림, 미머지·미발행, CHANGELOG `[Unreleased]`). 첫 수는 인식한 모듈 값이 귀속 호출·기록된 선언과 export·
  원시값 소비 밖에서 쓰인 횟수, 뒤 절은 출처를 따라갈 수 없는 값의 입구(해석되지 않은 import, 네임스페이스
  import, 값을 쓰는 `require()`, 동적 `import()`) 수다. 뒤 수가 0이 아니면 첫 수가 0이어도 하한으로 남기고, 둘 다
  0일 때만 줄이 빠진다. 그런 입력(codegen 스펙만 스캔 등)에서는 `impact --strict`가 1→0으로 바뀔 수 있다(재현:
  스펙+수신 문서). 실제 앱 소스는 거의 항상 패키지를 import해 줄이 남는다(expo-haptics 14.1.4: 사실 동일, `0 …;
  lower bound because 7`). conformance 벡터·생산자 8곳은 이 줄을 참조하지 않고, 드리프트는 없다(생산자 7곳 current,
  schemagraph not-vendored). `npm run verify` 통과. GLM 리뷰는 `packet-ask`가 없어 실행하지 못했다.
- 2026-11-15 같은 브랜치 후속(PR #164에 포함): 측정 중 발견한 extract-js 사실 누락·거짓 사실을 고쳤다. 커밋마다 실패하는
  회귀 테스트를 먼저 두고 변이 검사로 확인했다(CHANGELOG `[Unreleased]` `### Fixed`).
  - `7f6eb19` 선언 초기값의 객체 리터럴·함수 본문 이름을 로컬 선언으로 기록하지 않는다 — import 없이 전역으로
    읽는 파일의 NativeModules 사실 전체가 사라지던 문제. 타입 주석의 이름도 선언자로 읽지 않는다.
  - `c66eee5` 선언이 문장 끝(ASI 줄바꿈, for 머리의 `)`, 블록 끝 `}`)에서 끝난다 — 세미콜론 없는 코드·for-of 뒤에서
    첫 선언이 파일 끝까지 이어져 뒤의 바인딩·export가 수집되지 않던 문제(원래 후보 목록 밖, 같은 함수에서 발견).
  - `42fd6fd` `import X, * as NS`의 default X를 잃지 않고, 두 네임스페이스 형태를 모두 인식한다.
  - `98c4d03` 속성 자리 브리지 API 이름(`OBJ.NativeModules`·`OBJ.TurboModuleRegistry`·`OBJ.requireNativeModule(…)`)은
    체인 길이가 아니라 OBJ가 그 API를 내보내는 모듈(react-native·Expo)인지로 판정한다. 그 밖의 객체는 사실 없이
    `unattributed-js-native-modules:`로 센다(메시지 확장). 속성 자리 이름은 파일 바인딩·별칭으로 읽지 않아 홀수
    체인 위치의 거짓 method-invoke·module-import가 없어졌다.
  - expo-haptics 14.1.4 사실은 수정마다 바이트 단위로 같았다. 적대 입력 시간은 수정 전 트리와 같은 범위다.
- 2026-11-16 PR #164 독립 리뷰("수정 후 머지 가능") 반영 — 아래 커밋은 PR에 푸시됐다. 이후 재검토 반영처럼 그 뒤에
  쌓인 커밋의 푸시 여부는 `git status`(origin 대비 ahead)로 확인한다:
  - `5a6949a` B1: 초기값 없는 타입 주석 선언(`let timer: Timer`)이 다음 줄 선언의 초기값을 가져가 거짓
    `Haptics.cancel`과 사라진 한계를 만들던 문제. 같은 수정이 이번 릴리스의 주석 건너뛰기가 `Map<string, Array<number>>`의
    `>>`에서 파일 끝까지 넘어가던 회귀(리뷰 밖에서 재현)도 고친다. impact --strict 종단 테스트 포함.
  - `e4fc95a` S1·S2: 대괄호 분류의 인자 재탐색(이차)과 비교 `<`에서 파일 끝까지 가던 타입 인수 탐색을 없앴다.
    리뷰 입력 nestcall 32k head 약 20초 → 0.3~0.75초, lt 6000 main 약 7초·head 약 15초 → 0.2~0.4초.
  - `c57965d` S3a import 문이 아닌 `import` 낱말(import.meta·객체 키·JSX 글자)이 뒤 코드를 삼키던 문제와 그 계수,
    S3b 템플릿 보간의 브리지 API 언급 계수·문서, S3c 초기값 제네릭 호출 인수의 쉼표, S4 Babel·TS interop
    (`_interopRequireDefault(require('react-native'))`의 `.default.NativeModules`) 사실 유지, N2 이중 계수 제거,
    N3 버려지는 식 문장 비계수, N1 `as const`·non-null 줄 끝 ASI와 CHANGELOG 정정, N5 문서.
  - 실제 패키지 7개(react-native 0.88.1, screens 4.30.1, vision-camera 5.2.4 등)에서 리뷰 반영 전후 사실 차이 없음.
- 2026-11-16 PR #164 델타 재검토("수정 후 머지 가능") 반영: S-A 초기값 제네릭 덩어리 건너뛰기가 안쪽 괄호의 `>`와
  짝지어 세미콜론 없는 뒤 문장을 삼키던 문제(안쪽 괄호는 그 안에서 연 제네릭만 닫는다 — main부터 있던 거짓 `M.x` 호출도
  사라짐), S-B 템플릿 정규식의 이차 시간, N-b 기본 import 변환 `.default`를 react-native로 한정(Expo 패키지는 센다) — `ecf87ea`.
- 생산자 사본 드리프트는 `node scripts/conformance-drift.mjs <producer>=<checkout> ...`로 본다. 이 후속 직전에는
  cartograph·kartograph의 `http-limitation-scope.json`만 생산자 케이스 차이였고, 나머지는 consumer 전용 케이스 차이
  (`stale-consumer-only`, 드리프트로 셈)였다. tsograph는 그 consumer 전용 `dispatch.validate` 케이스를 실행한다.

## 후속 후보 (사용자가 고르기 전에는 착수하지 않는다)

- 생산자 버전 경보: 검증 세트보다 오래된 생산자 문서를 알리는 소비자 한계를 시도했지만, 한계가 `impact --strict`
  등 엄격 게이트의 "분석 공백"으로 세어져 종료 코드가 0→1로 바뀌었다. 게이트에 들지 않는 별도 notice 채널이
  필요하며 출력 계약 설계가 먼저다.
- 새 공유 suite(열 인코딩, persistence 이름, limitation 접두사 목록): 생산자 8곳이 함께 바뀐다.
- bridge 문서가 스캔한 target을 밝히는 선택 필드(`scannedTargets` 초안, GRAPH-EXCHANGE)의 생산자 합의.
- extract-js 거짓 사실(기존 동작, 우선순위 높음): 바인딩 지도가 파일 전역이라 서로 다른 함수 본문이 같은 이름을
  다른 모듈에 묶으면 마지막 선언이 이긴다. `function A() { const M = NativeModules.A; M.x(); }`와
  `function B() { const M = NativeModules.B; M.y(); }`가 한 파일에 있으면 A의 호출이 거짓 `B.x`로 귀속된다.
  건전한 최소 수정 후보: 한 파일에서 같은 이름이 서로 다른 모듈에 묶이면 그 이름을 바인딩에서 빼고(호출은 미귀속,
  초기값은 js-binding-scope로 셈) — 사실이 줄어드는 출력 변경이라 사용자 결정이 필요하다.
- extract-js 수집 공백(기존 동작, 이번에 고치지 않음): `const`·`let`·`var` 초기값의 함수 본문
  (`const Screen = () => { … }`) 안 선언을 수집하지 않아 함수형 컴포넌트 안 `const M = NativeModules.X`의 호출이
  귀속되지 않고, 그 안의 `const { X } = NativeModules`는 module-import 사실도 내지 않는다. 지금은 js-binding-scope로
  센다. 위 거짓 사실 문제 때문에 본문 선언을 파일 전역 지도에 넣는 수정은 건전하지 않다 — 형제 컴포넌트의 같은
  이름(`const module = NativeModules.A`/`…B`)이 거짓 사실이 된다. 블록 범위 바인딩(선언 구간 안에서만 적용)이 먼저다.
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

## Resume Prompt

HANDOFF.md와 적용 AGENTS.md를 읽고 branch/status를 확인해줘. isthmus-cli 0.14.0은 발행됐고, 2026-11-03 계열
검토 후속은 #162로 main에 머지됐으나 미발행(`[Unreleased]`)이다. 2026-11-15 js-binding-scope 측정(`057a133`)과
그 후속 extract-js 수정·리뷰 반영은 PR #164(브랜치 `ccr-37904670-hxdjsx`)로 열려 있다. 마지막 로컬 커밋이 푸시됐는지는
`git status`로 확인한다. 발행 여부는 npm registry로 확인하고, 위 후속 후보와 릴리스는 내가 고르기 전에 착수하지 마.
