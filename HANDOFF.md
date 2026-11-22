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
- 2026-11-22 extract-js 블록 범위 바인딩·초기값 본문 수집과 그 네 차례 독립 리뷰 반영은 PR #165로 main에 squash 머지됐다
  (`33cc631`, 미발행, CHANGELOG `[Unreleased]` `### Fixed`). 파서를 지금은 교체하지 않는다는 결정은 PR #166(`30285f9`)으로
  아래 후속 후보에 적었다. 커밋·리뷰 회차별 근거(되돌림 변형, 오라클 시드, 12개 패키지 비교, 시간)는
  [HANDOFF-HISTORY](HANDOFF-HISTORY.md)의 "완료 — extract-js 블록 범위 바인딩 (PR #165)" 절에 옮겼다.
- 2026-11-22 브랜치 `ccr-37904670-hxdjsx`(main `30285f9`에서 다시 시작, 미푸시 — 푸시·PR은 조정자가 한다): 계열 4차 배치
  "더 개선할 것을 찾아 개선하라"로 기록된 extract-js 결함 셋을 고쳤다(CHANGELOG `[Unreleased]` `### Fixed` 앞 세 항목). 사용자가
  B2·S2를 "작고 안전하면 고쳐도 된다"고 정했다.
  - B2 레지스트리 출처: `NativeModules`(별칭 포함)가 레지스트리인지 이름 단위 지도(`destructuredFromReactNative`·`requireSpecifiers`)
    대신 위치를 덮는 선언으로 판정한다. 블록 범위 표와 같은 규칙의 두 번째 `ScopedBindingTable`(레지스트리 출처 표)에 후보 이름
    (`NativeModules`와 `NativeModules: X` 별칭)의 선언·재대입만 넣고 레지스트리 출처 선언에만 값을 준다 — 새 범위 규칙을 만들지
    않고 리뷰 네 번을 거친 표를 재사용한다. 수집이 끝나면 모든 import를 본 출처로 기록을 다시 넣는다(뒤에 온 `import RN`). 정하지
    못한 관여(블록 밖 `var`, 넓게 잡힌 for 머리 뒤, 잠정 매개변수 목록 너머, 레지스트리 재대입 — 무엇을 대입했는지 모르므로 불확실
    재대입으로 넣는다)는 센다. 값이 살아남지 못한 레지스트리 선언(같은 범위 다른 값 재선언)도 하나씩 센다.
  - S2 템플릿 보간: `templateInterpolationCode`(lexer)가 보간 본문을 조각마다 꺼내고(중첩 템플릿 글자는 빼서 선형) 스캐너가 다시
    토큰화한다. 대입·증감이 있는 조각의 대입 대상이 될 수 있는 이름은 불확실 재대입, 모듈 바인딩·상대 import 이름 쓰임은 첫 수로
    센다. 보간 안 호출은 귀속하지 않는다. js-binding-scope 문구에 "or used inside a template interpolation"을 더했다(접두사 그대로).
  - b07: 속성 자리 이름(`.`·`?.` 뒤) 뒤 괄호는 매개변수 목록이 아니다(`foo.function(M)`·`foo.bar(M)` 뒤 다음 줄 `{`).
  - 재현(수정 전 main `30285f9`): jest 대역·형제 함수·블록 `var` 대역·다른 함수의 별칭에서 거짓 `Camera.take`·`B.b`·`C.c`,
    `` `${M = other}` `` 뒤 거짓 `Camera.take`, `` `${M.take()}` ``와 `foo.function(M)` 블록 안 참 호출의 무계수 소실, 같은 블록의
    `var` 가둠으로 생긴 거짓 사실. 수정 뒤 같은 입력은 사실 없음·계수·참 사실 귀속이다(`js-document.test.ts` 끝 세 테스트).
  - 근거: 새 테스트(문서 3, lexer 2, 오라클 1)는 main에서 실패하고, 되돌림 변형 14종(이름 판정, 다른 범위 별칭, 확실 재대입, 재반영
    없음, 별칭 후보 없음, 정하지 못한 관여 미계수, 보간 재대입 없음, 보간 계수 없음, 멤버 대상 포함, 보간 확실 재대입, 속성 자리
    판정 없음, 보간 상대 import 미계수, 살아남지 못한 선언 미계수, 잠정 목록 대체 해석 없음)이 모두 테스트에 잡혔다. 오라클에
    `extended`(보간 재대입·호출, `foo.function(M)`·`foo?.wrap(M)` 뒤 블록)·`registry`(추적 이름 `NativeModules`, 레지스트리 출처 선언
    네 꼴과 대역) 선택을 더했다 — 기본 생성기의 고정 시드 프로그램은 바이트까지 같다(난수 소비 동일, 지문 비교). 새 고정 시드는
    확장 {4, 6}·레지스트리 {15, 17} × 1,500회. 로컬 넓은 실행: 확장 시드 1~200(228,515개), 레지스트리 1~150(163,032개), 기본 1~60
    (68,470개) × 1,500회에서 문제 0. 같은 생성기로 main은 확장 시드 1~10에서 593개, 레지스트리 1~10에서 1,100개 프로그램이 실패한다.
    레지스트리 넓은 실행이 찾은 잠정 매개변수 목록 너머의 무계수 소실(시드 45·49)은 고쳐 회귀 테스트로 넣었다.
  - 공개 패키지 12개(위 PR #165 목록과 같은 판)의 사실·모든 한계 수·`--events` 출력은 main과 같다(차이는 js-binding-scope 문구뿐).
  - 적대 입력 30여 종(catch 매개변수·문자열 키 별칭·기본값 별칭·export·TS `declare const`·태그드 템플릿·JSX 속성 템플릿·멤버 증감·
    템플릿 리터럴 타입·중첩 템플릿·정규식 따옴표 보간·속성 자리 제네릭 호출 등)을 main과 비교해 새 거짓 사실이 없음을 확인했다
    (catch 매개변수·정규식 따옴표는 기존 한계 그대로). 시간(부하 16~26 기계, 세 번의 최솟값, main/HEAD): 같은 이름 대역 함수 3만 2천
    1.98/2.49초, 별칭 3만 2천 1.39/2.39초, 보간 재대입 3만 2천 0.57/0.98초, typescript.js 5.19/4.23초, 1만 6천 단계 중첩 템플릿
    0.05초 — 1만 6천→6만 4천 배로 늘려도 선형이다.
  - `npm run verify` 통과(타입 검사, 호환성, conformance 352, 제품 테스트 1,428개·커버리지 라인 99.20/분기 95.27/함수 98.41 —
    `js-scan.ts` 99.50/93.14/99.47, `lexer.ts` 98.90/97.99/100, `js-scopes.ts` 100/96.68/100, Phase 0 조인 15, clean build, 스크립트 225,
    CLI 0/1/2/64·패키지 계약). 첫 실행은 부하 20~26에서 `js-scan.test.ts`의 선형 시간 테스트(상한 6초·3초)만 시간 초과로 실패했다 — 같은
    부하에서 main 기준 실행도 같은 테스트가 실패했고, 그 입력의 시간은 main/HEAD 0.61/0.66초·0.30/0.19초로 같다. 재실행은 모두 통과했다.
    GLM 리뷰는 `packet-ask`가 없어 실행하지 못했다.
- 생산자 사본 드리프트는 `node scripts/conformance-drift.mjs <producer>=<checkout> ...`로 본다. 이 후속 직전에는
  cartograph·kartograph의 `http-limitation-scope.json`만 생산자 케이스 차이였고, 나머지는 consumer 전용 케이스 차이
  (`stale-consumer-only`, 드리프트로 셈)였다. tsograph는 그 consumer 전용 `dispatch.validate` 케이스를 실행한다.

## 후속 후보 (사용자가 고르기 전에는 착수하지 않는다)

- 생산자 버전 경보: 검증 세트보다 오래된 생산자 문서를 알리는 소비자 한계를 시도했지만, 한계가 `impact --strict`
  등 엄격 게이트의 "분석 공백"으로 세어져 종료 코드가 0→1로 바뀌었다. 게이트에 들지 않는 별도 notice 채널이
  필요하며 출력 계약 설계가 먼저다.
- 새 공유 suite(열 인코딩, persistence 이름, limitation 접두사 목록): 생산자 8곳이 함께 바뀐다.
- bridge 문서가 스캔한 target을 밝히는 선택 필드(`scannedTargets` 초안, GRAPH-EXCHANGE)의 생산자 합의.
- extract-js 남은 파일 전역 지도(2026-11-22 확인, 기존 동작): `NativeModules` 레지스트리 출처는 이번 브랜치에서 선언마다
  판정하게 됐다(아래 현재 상태). react-native **모듈 객체** 판정용 `requireSpecifiers`·`requireModules`·`interopDefaultModules`는
  아직 이름 단위다 — `function f() { const RN = require('react-native'); } function g() { const RN = mock; RN.NativeModules.B.b(); }`의
  `B.b`와, 같은 `g`에서 `const { NativeModules } = RN` 뒤 접근은 거짓 사실이다(재현: 이번 브랜치 HEAD에서도 그대로). 모듈 객체
  선언도 레지스트리 출처 표처럼 위치를 덮는 선언으로 판정하면 고칠 수 있다(`isReactNativeNamespace`·`propertyBaseSpecifier`).
- extract-js 가림 공백(기존 동작): 블록 범위 표에 넣지 않는 이름 — `catch (M)` 매개변수, 함수·클래스 선언 이름, 식 본문
  화살표 매개변수(`M => M.x()`) — 은 같은 이름의 바깥 모듈 바인딩을 가리지 않아 그 안의 호출이 바깥 모듈로 귀속될 수 있다. JSX 속성 `name={…}`은 재대입으로 읽혀 같은 이름 바인딩을 지운다(사실이 줄 뿐이다).
  속성 자리 API로 만든 초기값(`var M = _reactNative.NativeModules.A`)은 바인딩이 아니어서 Babel 출력의 `M.x()`는 귀속되지
  않는다(초기값을 js-binding-scope로 센다).
- extract-js 4차 리뷰가 기록만 하라고 한 기존 결함 중 B2(레지스트리 출처가 이름 단위)·S2(템플릿 보간)·`b07`(`foo.function(M)` 뒤
  다음 줄 `{`)은 이번 브랜치에서 고쳤다(아래 현재 상태). 남은 것: JSX 글자 `<View>a M = 1</View>`의 `M = 1`을 재대입으로 읽는다(사실이
  계수가 될 뿐이다).
- extract-js 보간 경계(기존 동작, 토크나이저 한계): 보간 안 정규식 리터럴의 따옴표·백틱(`` `${s.replace(/"/g, '')}` ``)을 문자열
  시작으로 읽어 템플릿이 파일 뒤쪽까지 이어진다 — 그 뒤 코드의 사실·계수가 조용히 사라질 수 있다(템플릿 원문이 브리지 API 이름을
  언급하면 하한으로만 센다). react-native 0.88.1 `scripts/spm/*.js`에 이 꼴이 있다. 보간 건너뛰기에 정규식 위치 판정이 필요하다.
- extract-js 보간 안 이름(이번 브랜치에서 넣은 근사): 보간은 이름을 찾는 데만 다시 토큰화한다. 대입·증감이 있는 보간은 대입 대상이
  될 수 있는 이름을 모두 대상이 확실하지 않은 재대입으로 보고(`${a ? M : (N = 1)}`의 M도), 보간 안 함수의 매개변수·선언과 TS 템플릿
  리터럴 타입 안 이름도 템플릿 위치의 바인딩으로 센다 — 과다 계수 쪽이다. 보간 안 호출은 귀속하지 않는다.
- extract-js 레지스트리 출처의 수집 중 판정(이번 브랜치, 모듈 바인딩과 같은 한계): `const { A } = NativeModules`(레지스트리 구조
  분해)는 수집 중에 판정한다. 그때까지 같은 이름의 범위를 정하지 못한 `var`가 있었거나 위치가 그 선언의 값 적용 구간 밖이면 사실을
  내지 않고, 동결 뒤 그 원천 위치를 레지스트리 값으로 센다(조용히 사라지지 않는다).
- extract-js 잠정 분류의 과다 계수(3차 리뷰 반영, 건전성은 오라클로 확인): 메서드 약칭의 매개변수가 바깥 모듈 바인딩과 같은
  이름이면 그 쓰임을 세고, 메서드 본문의 `var`는 범위를 정하지 못한 선언이라 그 쓰임과 바깥 같은 이름 블록 선언의 쓰임을 센다.
  추상·오버로드 시그니처의 매개변수 이름은 값 쓰임으로 세어질 수 있다. JSX 글자 안의 `NAME = …`은 선언 초기값 안에서도 재대입으로
  읽혀 그 바인딩의 쓰임이 사실 대신 계수가 된다(JSX를 토큰으로 나누지 않는 렉서의 기존 한계, 리뷰 u02). `if`·`for`·`while`·
  `switch`·`with` 이름의 메서드는 제어문으로 읽는다(`catch` 메서드만 `try` 뒤가 아닌 것으로 가른다).
- extract-js 수집 중 값 포착(2026-11-22 2차 리뷰 반영 중 확인, 기존 동작 — main부터): 별칭 `const N = M`·`export { M }`은 수집 순서대로
  그때의 해석을 포착한다. 같은 함수에서 뒤에 끌어올린 `var M`(`function g() { const N = M; var M = fake; N.go(); }` — 실행하면
  `undefined.go()`로 죽는 코드)이나 다른 함수의 뒤 재대입(`function f() { const N = M; N.go(); } function g() { M = fake; }`, 호출 순서에
  따라 거짓)을 반영하지 않아 거짓 `A.go`가 남는다. 동결 뒤 별칭·export 원천을 다시 해석해 달라지면 그 값을 거두고 세면 고칠 수 있다.
- extract-js JSX 글자의 선언 오인(2차 리뷰 n20, 인위적 입력): JSX 글자 `We will let Camera: know`의 `let Camera:`를 타입 주석이 붙은
  선언으로 읽어 같은 이름 바깥 바인딩의 `Camera.take()`가 조용히 사라진다. JSX를 토큰으로 나누지 않는 렉서라 가르려면 JSX 인식이
  필요하다.
- extract-js 정하지 못한 범위의 정밀도(2차 리뷰 반영, 건전성은 오라클로 확인): 사이 묶음은 그 var를 감싼 블록뿐 아니라 묶음 전체의
  모듈 쓰임을 세고, 대상이 확실하지 않은 재대입은 바깥 묶음의 쓰임을 센다 — 진실이 귀속 가능한 호출도 세어질 수 있다(과다 계수).
- extract-js 남은 관찰 공백(리뷰 반영 중 확인, 모두 js-binding-scope로 셈): 중첩 제네릭 인수를 둔 API 호출
  (`requireNativeModule<A<B>>('X')`, `>>` 한 토큰)은 호출로 읽지 않는다. JSX는 토큰으로 나누지 않아 `</Text>`의 `/`가
  정규식으로 읽힐 수 있고, 줄 끝 JSX `>`·`/>`는 ASI 피연산자 끝으로 보지 않는다(비교 `>`와 구분 불가). JSX 형제 자식
  `{a}{NativeModules.Info.version}`의 두 번째 `{…}`는 블록으로 보여 그 값이 버려지는 식 문장으로 분류된다(재검토 N-d).
  타입 매개변수 기본값이 있는 제네릭 화살표 `<T = X,>(x) => {…}`는 `=` 때문에 한 덩어리로 건너뛰지 못해, 쉼표가
  선언자 목록을 다시 열고 뒤 객체 리터럴을 패턴으로 읽는다(재검토 N-c, import 없이 전역 NativeModules를 읽는 파일만 영향).
- extract-js 파서 교체(2026-11-22 사용자가 판단을 맡김 → 지금은 하지 않는다): 손으로 쓴 토큰 스캐너라 PR #165의 독립 리뷰
  네 번마다 새 오인 형태가 나왔다. TypeScript 컴파일러 API·acorn 같은 실제 파서로 바꾸면 이 계열이 사라지지만 의존성과
  설계가 크게 바뀐다. 지금은 "토큰이 증명할 때만 확실, 나머지는 센다" 원칙과 정적 범위 오라클로 거짓 사실을 막는다. 위에 기록한
  결함(B2·S2 등)을 고치다 같은 계열의 오인이 다시 나오면 교체를 먼저 검토한다.
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
- (PR #165, 머지됨) js-binding-scope 문구에 "redeclared", "used outside the block a declaration is scoped to", "where the scan cannot
  tell which declaration or parameter applies"가 더해졌다(접두사
  그대로). 함수형 컴포넌트·훅에서 바인딩하는 앱 소스는 method-invoke·module-import 사실이 늘고, 형제 범위의 같은 이름·안쪽
  대역으로 생긴 거짓 귀속은 사라진다. 라벨·맨 블록·다음 줄 `{` 메서드 안 var, 복합·구조 분해 재대입, 모듈 멤버 구조 분해는
  사실 대신 계수가 되고, 매개변수 타입 주석이 가리던 import 호출은 미귀속 계수(`unattributed-js-*-calls`)에 다시 든다.
  `check --strict`·`impact --strict` 결과가 바뀔 수 있다.
- (이 브랜치) js-binding-scope 문구에 "or used inside a template interpolation"이 더해졌다(접두사·수 위치 그대로). 테스트 도우미의
  `NativeModules` 대역·다른 함수의 별칭이 내던 거짓 module-import·method-invoke는 사라지고, 블록 밖 `var`·재대입한 레지스트리
  바인딩의 접근, 템플릿 보간 안의 모듈 쓰임은 사실 대신 계수가 된다. `foo.bar(M)` 뒤 다음 줄 블록 안 호출은 계수 대신 사실이 된다.
  `check --strict`·`impact --strict` 결과가 바뀔 수 있다.

## Resume Prompt

HANDOFF.md와 적용 AGENTS.md를 읽고 branch/status를 확인해줘. isthmus-cli 0.14.0은 발행됐고, 2026-11-03 계열
검토 후속(#162)과 js-binding-scope 측정·extract-js 후속(#164)은 main에 머지됐으나 미발행(`[Unreleased]`)이다.
2026-11-22 extract-js 블록 범위 바인딩(#165)도 main에 머지됐다(미발행). 레지스트리 출처·템플릿 보간·속성 자리 호출 수정은
브랜치 `ccr-37904670-hxdjsx`에 있다 — 푸시·PR 여부는 `git status`와 GitHub로 확인한다. 발행 여부는 npm registry로 확인하고, 위 후속 후보와 릴리스는 내가 고르기 전에 착수하지 마.
