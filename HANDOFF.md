# Handoff

_Last updated: 2026-11-25_

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
- 2026-11-22 extract-js 레지스트리 출처·템플릿 보간·속성 자리 호출 수정(기록된 결함 B2·S2·b07)과 그 세 차례 독립 리뷰 반영은
  PR #167로 main에 squash 머지됐다(`4a3e99d`, 2026-11-23, 미발행, CHANGELOG `[Unreleased]` `### Fixed`). 커밋·리뷰 회차별 근거(되돌림
  변형, 오라클 모드·시드, 12개 패키지 비교, 시간)는 [HANDOFF-HISTORY](HANDOFF-HISTORY.md)의 "완료 — extract-js 레지스트리 출처·템플릿
  보간·속성 자리 호출 (PR #167)" 절에 옮겼다.
- 2026-11-25 브랜치 `ccr-37904670-hxdjsx`(main `4a3e99d`에서 다시 시작, 미푸시 — 푸시·PR은 조정자가 한다): 계열 5차 배치
  "더 개선할 것을 찾아 개선하라"로 후속 후보의 "extract-js 보간 경계"(템플릿 보간 안 정규식 리터럴)를 고쳤다(CHANGELOG
  `[Unreleased]` `### Fixed` 첫 항목, `src/extract/lexer.ts`).
  - 결함: 보간 건너뛰기(`skipInterpolation`)와 보간 코드 추출(`templateInterpolationCode`)이 정규식 리터럴을 읽지 않아 그 안의
    `"`·`'`·백틱·`{`·`}`·`//`(`/\//g`)를 문자열·중첩 템플릿·깊이·줄 주석으로 읽었다. 템플릿이 뒤 코드(흔히 파일 끝)까지 이어져 그
    코드의 사실·계수가 사라졌고(그 코드가 브리지 API 이름을 언급할 때만 하한 입구 하나로 셌다), 삼킴이 안쪽 같은 이름 선언을 가리면
    거짓 사실도 났다.
  - 재현(main `4a3e99d`, `node src/cli/main.ts extract-js <file> --project .`): `const Cam = NativeModules.Camera;` 뒤 함수 안
    `` return `${name.replace(/"/g, '')}`; ``(또는 `/\//g`·`/{/g`)와 그 뒤 `Cam.take();` → `module-import Camera@2`만 있고 한계는 빈
    배열(참 `method-invoke Camera.take@6`이 조용히 사라짐). `` const q = `${s.replace(/"/g, '')}`; function f() { const M = makeFake();
    log('"}`'); M.take(); } ``(줄 나눔) → 거짓 `method-invoke Camera.take@7`. 고친 뒤 앞은 참 사실, 뒤는 사실 없음이다.
  - 고침(아래 PR #168 리뷰 반영 뒤의 규칙): 보간 본문의 코드 단위를 `readInterpolationCode` 하나로 읽는다(두 함수가 같은 경계를
    찾는다). `/`는 앞 코드가 보간 시작·`(`·`[`·`{`·그 밖의 연산자·구두점(`=`·`=>`·`,`·`?`·접두 `!` 등)이거나 예약어 `case`·`delete`·
    `do`·`else`·`in`·`instanceof`·`new`·`return`·`throw`·`typeof`·`void`(`.`·`#` 뒤는 아니다)이고, 바로 뒤가 `>`가 아니며(`/>`는 JSX
    자기 닫음 태그), 같은 줄에서 닫힐 때만 정규식이다. 나머지는 전처럼 나눗셈이다 — 이름(문맥 키워드 `get`·`of`, `await`·`yield`,
    `.`·`#` 뒤 예약어, 비ASCII 글자가 섞인 이름 포함)·숫자·리터럴·정규식·`)`·`]`·안쪽 블록 `}`·`++`/`--`·후위 `!`(TS non-null)·모든
    `<`·`=>`가 아닌 `>`(타입 인수) 뒤. 닫히지 않는 후보는 나눗셈이고 바로 뒤 `/`도 나눗셈이다. 닫히지 않은 후보의 경로를 (위치, 문자
    클래스 안 여부)로 기억해(`RegexFailureMemo`) 한 줄에 그런 후보가 많아도 선형이다 — 판정은 바꾸지 않는다.
  - 근거: 새 테스트(lexer 2 — 정규식 14꼴·나눗셈 17꼴·줄 경계·선형 읽기 수, 문서 1 — 정규식 다섯 꼴의 참 사실과 가려진 선언의
    거짓 사실)는 main 렉서에서 실패한다(선형 읽기 수 테스트는 main에도 정규식 판정이 없어 통과한다). 되돌림 변형 25종(기억 없음,
    문맥 키워드를 식 앞 예약어로, `.` 판정 없음, non-null·`<`·증감·`)`·`]`·비ASCII 판정 없음, 두 함수 각각의 `}`·따옴표·중첩 템플릿
    뒤 판정, 정규식 끝 뒤 연산자 자리, 정규식 이스케이프·문자 클래스·줄 끝 판정 없음, 공백이 연산자 자리, 두 함수 각각 정규식 읽기
    없음, `typeof` 없음, 닫히지 않은 후보가 줄 끝까지 삼킴, 클래스 밖 상태만 기억, `.`을 연산자로)이 모두 테스트에 잡힌다.
  - TypeScript 파서 오라클(스크래치 `fuzz-templates.mjs`: 보간에 정규식·나눗셈·문자열·주석·중첩 템플릿·여러 줄 사슬을 섞은 유효한
    JS를 만들어 최상위 템플릿 범위와 보간 조각을 AST와 비교): 시드 1~7 × 5,000개(유효한 34,675개)에서 이 브랜치 문제 0, main은
    시드 1·2의 유효한 4,954·4,961개 중 3,136·3,210개가 틀린다. 손으로 쓴 적대 입력 35개(TS·TSX 포함)를 AST와 비교: 이 브랜치는 유효한 34개 모두 맞고, main은
    16개가 틀린다(유효하지 않은 1개는 둘 다 TS 복구 파스와 다르다). 실제 파일(12개 패키지, 저장소 `node_modules/typescript/lib`,
    isthmus `src`·`scripts`, 자매 tsograph `src`·`node_modules`) 중 TS가 오류 없이 파싱하고 템플릿이 있는 948개에서 AST의 최상위
    템플릿 범위를 모두 같게 읽는다 — main은 3개가 틀린다(react-native `scripts/spm` 둘, tsograph `src/graph/static-pnp.ts:108`의
    `` `@types/${name.replace(/^@([^/]+)\//u, '$1__')}` ``).
  - 기존 오라클 생성기 넓은 실행(이 브랜치, × 1,500회, 문제 0): 기본 1~60(68,470개), 확장 1~150(171,468), 레지스트리 1~120(133,749),
    별칭 1~120(131,509), 충돌 1~120(136,888), 충돌+확장 1~60(68,757) — PR #167 기록과 같은 수다. 모드마다 시드 1~10은 판정·귀속·
    계수 합이 main과 같다. 생성기는 보간에 정규식을 내지 않아 회귀 확인용이다(고친 꼴은 위 TS 파서 오라클이 본다).
  - 공개 패키지 12개(PR #165 목록과 같은 판): 사실·`--events` 출력은 main과 같다. 한계 수는 react-native 0.88.1의 js-binding-scope 하한
    입구 수만 2563 → 2562다 — 토큰이 달라진 파일은 4,857개 중 `scripts/spm/scaffold-package-swift.js`·`spm-pbxproj.js` 둘이고, 앞
    파일에서 main은 604행 템플릿이 815행 JSDoc 주석 안까지 이어져 주석 속 `import` 낱말을 "import 문이 아닌 `import` 낱말"로 셌다
    (거짓 입구). 첫 수(66)와 나머지 수는 같다.
  - 시간(CPU 시간, 세 번의 최솟값, main/이 브랜치): typescript.js 토큰화 0.84~1.02/0.88~0.90초, 추출 2.29/2.25초. 적대 생성기(한 줄
    템플릿마다 닫히지 않는 후보, 한 템플릿에 후보 다수, 닫히는 정규식 다수, 나눗셈 다수, 줄마다 템플릿, 이스케이프 홀짝) 3만 2천 →
    25만 6천 배로 늘려도 선형이고 이 브랜치가 main보다 상수배(약 1.2~2배) 느리다.
  - `npm run verify` 통과(커밋한 헤드, 부하 17~25; 타입 검사, 호환성, conformance 352, 제품 테스트 1,437개·커버리지 라인 99.21/분기
    95.32/함수 98.42 — `lexer.ts` 99.19/98.54/100, `js-scan.ts` 99.53/93.27/99.51, Phase 0 조인 15, clean build, 스크립트 225, CLI
    0/1/2/64·패키지 계약). 앞의 두 실행(부하 21~37)은 `js-scan.test.ts`의 선형 시간 테스트(재선언 상한 6초)만 9.5·8.3초로 실패했다 —
    그 입력에는 템플릿이 없고 CPU 시간은 main/이 브랜치 0.63/0.67초이며, 같은 부하의 main 실행도 같은 테스트가 10.3초로 실패했다
    (그 main 실행은 5분 시한에 걸려 끝나지 못했다). 그 두 실행에서 건너뛴 뒤 단계(조인·빌드·스크립트·계약)도 따로 통과했다. GLM
    리뷰는 `packet-ask`가 없어 실행하지 못했다.
- 2026-11-25 PR #168(헤드 `aaabd72`, 푸시됨) 독립 리뷰 반영(같은 브랜치, 그 위에 커밋, 미푸시). 차단 없음, 고칠 것 3·잔소리 2 — 모두
  `aaabd72`가 새로 나눗셈을 정규식 시작으로 읽어 템플릿이 뒤 코드를 삼키고 참 사실이 한계 없이 사라지는 꼴이었다(main은 맞게
  읽었다). 지적마다 main·`aaabd72`·이 커밋에서 TS 파서의 템플릿 범위와 비교했다(범위는 [시작, 끝)).
  - S1 타입 인수 `>`: `` `${f<T> / 2}"/` ``는 TS·main 10~25, `aaabd72` 10~52, 이 커밋 10~25(`x as Array<T> / 2`·`new Foo<T> / 2`도
    같다). `.ts`의 `` (n: number) => `${n as Fixed<2> / 100} / ${max}` `` 뒤 `Cam.take()`는 `aaabd72`에서 사라졌고(한계 없음) 이 커밋에서
    `method-invoke Camera.take@4`다. `=` 바로 뒤가 아닌 `>`를 값 뒤로 본다(`=>`는 연산자 자리) — `<RegExp>/x/`와 `>` 뒤 JSX 글자의
    `/`는 main처럼 나눗셈이다.
  - S2 `<Fade in />`: 예약어 이름 속성 뒤 `/>`를 정규식으로 읽었다 — `` `<body>${renderToString(<Fade in />)}</body>` `` 뒤
    `Camera.take@5`가 `aaabd72`에서 사라졌다. `/` 바로 뒤가 `>`면 정규식으로 읽지 않는다(`<Foo new />`도). `>`로 시작하는 정규식
    (`/>"/`)은 main처럼 나눗셈이다.
  - S3 문서 과장: `await`·`yield`를 이름으로 쓴 꼴은 `aaabd72`가 새로 틀린 것이었다(`var await` 뒤 `` `${await / 2}"/` ``: TS·main
    36~52, `aaabd72` 36~86 — 재현 입력의 위치). 감싼 함수가 async·생성기인지 모르므로 둘을 식 앞 예약어에서 뺐다(이 커밋은 main과
    같다). CHANGELOG에 정규식 자리를 정확히 적고(모든 `<`가 값 뒤다), main과 같이 나눗셈으로 남는 자리(`if (x) /re/`·`while (x)
    /re/`·`for (;;) /re/`·`for (m of /re/)`·`[.../re/]`·`a < /re/`·`++/re/.lastIndex`·`<RegExp>/x/`, async 함수 안 `await /re/`)와,
    main에서 정규식 둘의 오인이 서로 상쇄되던 보간(`` `${f(/"/g, />"/)}` ``)은 하나만 고쳐져 템플릿이 이어질 수 있음을 적었다.
  - N1 private 이름·비ASCII 이름: `this.#new / 2`·`#in`·`#return`은 `#`을 연산자로, `Δin / 2`·`éreturn / 2`는 비ASCII 글자에서 낱말을
    끊어 뒤 조각을 예약어로 읽었다. `#`을 `.`처럼(이름 자리) 보고 공백이 아닌 비ASCII 글자를 낱말에 넣는다.
  - N2 깨진 코드: `` x = `${(/<CR>/}`;/ ``에서 닫히지 않은 후보 뒤 다음 줄의 `/`가 정규식으로 이어져 템플릿이 파일 끝까지 갔다(main 4~13,
    `aaabd72` 4~15). 닫히지 않은 후보 뒤를 값 뒤로 둔다(이 커밋 4~13, `\n`도 같다).
  - 근거: 리뷰 입력을 모두 테스트로 넣었다(lexer 나눗셈 꼴 12개 추가·N2 줄 끝 두 개, 문서 테스트 1개 — 다섯 파일의 참 Camera.take).
    입력 19개가 하나씩 `aaabd72`에서 실패하고 이 커밋에서 통과한다. 되돌림 변형 31종(앞 25종을 새 코드에 맞추고 S1 `>`를 늘
    연산자·`=>`의 `>`도 값·`/>` 판정 없음·`await`/`yield` 예약어·`#` 연산자·비ASCII 낱말 끊기·닫히지 않은 후보 뒤 연산자 자리를
    더함)이 모두 잡힌다.
  - TS 파서 오라클 확장(`fuzz-templates2.mjs`, TSX로 파싱, 타입 인수·JSX 속성(`<Fade in />`·`<Foo new />`·`<a>{x}</a>`)·비교 `<`·`>`·
    시프트·private 이름·비ASCII·`await`/`yield` 이름·반환 타입 화살표·`/>/g`·`/</g` 추가, main과 비교): 시드 1~7 × 5,000개(유효한
    34,724개)에서 이 커밋은 틀린 것 0·main 대비 퇴행 0이다(main은 16,544개가 틀리고, `aaabd72`는 시드 1에서 퇴행 624개다). `>`로 시작하고
    따옴표를 담은 정규식(`/>"/`)까지 섞으면 이 커밋이 틀리는 프로그램은 모두 그 정규식을 담은 것(시드당 287~384개, main도 틀린다)이고,
    main 대비 퇴행 20개는 모두 위 상쇄 꼴이다. 기존 생성기(`fuzz-templates.mjs`) 시드 1~3 × 5,000개도 문제 0이다.
  - 실제 파일 948개(위와 같은 묶음)는 이 커밋·`aaabd72` 모두 TS와 같다. 12개 패키지·typescript lib·tsograph `src` 5,268개 파일의
    토큰 열이 `aaabd72`와 같고, 12개 패키지 출력은 `aaabd72`·main 비교 결과와 같다(사실·`--events` 동일, react-native 2563 → 2562만).
  - 시간(CPU 시간, main/`aaabd72`/이 커밋): typescript.js 토큰화 0.94/0.84/0.88초, 추출 main 2.06·이 커밋 2.07초. 적대 생성기는 3만 2천
    → 25만 6천 배에서 선형이다.
  - `npm run verify` 통과(`f93a11f`, 부하 10~16; 타입 검사, 호환성, conformance 352, 제품 테스트 1,438개·커버리지 라인 99.21/분기
    95.31/함수 98.42 — `lexer.ts` 99.22/98.58/100, `js-scan.ts` 99.53/93.23/99.51, Phase 0 조인 15, clean build, 스크립트 225, CLI
    0/1/2/64·패키지 계약). 앞의 세 실행(부하 15~27)은 템플릿이 없는 벽시계 선형 시간 테스트만 실패했다(`js-scan.test.ts` 재선언
    9.1~10.7초 > 6초, 한 번은 `js-scopes.test.ts` 형제 범위 8.8초 — 렉서를 쓰지 않는다). 그 입력의 CPU 시간은 main/`aaabd72`/이 커밋
    0.86/0.62/0.75초이고, 따로 돌리면 통과한다. 그 실행에서 건너뛴 뒤 단계도 따로 통과했다.
- 생산자 사본 드리프트는 `node scripts/conformance-drift.mjs <producer>=<checkout> ...`로 본다. 이 후속 직전에는
  cartograph·kartograph의 `http-limitation-scope.json`만 생산자 케이스 차이였고, 나머지는 consumer 전용 케이스 차이
  (`stale-consumer-only`, 드리프트로 셈)였다. tsograph는 그 consumer 전용 `dispatch.validate` 케이스를 실행한다.

## 후속 후보 (사용자가 고르기 전에는 착수하지 않는다)

- 생산자 버전 경보: 검증 세트보다 오래된 생산자 문서를 알리는 소비자 한계를 시도했지만, 한계가 `impact --strict`
  등 엄격 게이트의 "분석 공백"으로 세어져 종료 코드가 0→1로 바뀌었다. 게이트에 들지 않는 별도 notice 채널이
  필요하며 출력 계약 설계가 먼저다.
- 새 공유 suite(열 인코딩, persistence 이름, limitation 접두사 목록): 생산자 8곳이 함께 바뀐다.
- bridge 문서가 스캔한 target을 밝히는 선택 필드(`scannedTargets` 초안, GRAPH-EXCHANGE)의 생산자 합의.
- extract-js 남은 파일 전역 지도(2026-11-22 확인, 기존 동작): `NativeModules` 레지스트리 출처는 PR #167에서 선언마다
  판정하게 됐다(위 현재 상태). react-native **모듈 객체** 판정용 `requireSpecifiers`·`requireModules`·`interopDefaultModules`는
  아직 이름 단위다 — `function f() { const RN = require('react-native'); } function g() { const RN = mock; RN.NativeModules.B.b(); }`의
  `B.b`와, 같은 `g`에서 `const { NativeModules } = RN` 뒤 접근은 거짓 사실이다(재현: PR #167 머지 뒤 main `4a3e99d`에서도 그대로, 2026-11-25 확인). 모듈 객체
  선언도 레지스트리 출처 표처럼 위치를 덮는 선언으로 판정하면 고칠 수 있다(`isReactNativeNamespace`·`propertyBaseSpecifier`).
- extract-js 가림 공백(기존 동작): 블록 범위 표에 넣지 않는 이름 — `catch (M)` 매개변수, 함수·클래스 선언 이름, 식 본문
  화살표 매개변수(`M => M.x()`, `(M) => M.x()`) — 은 같은 이름의 바깥 모듈 바인딩을 가리지 않아 그 안의 호출이 바깥 모듈로 귀속될 수
  있다. 레지스트리 이름도 같다(전역 `NativeModules`, import 별칭, `= RN` 별칭 — `(NativeModules) => NativeModules.Camera.take()`가 거짓
  사실). PR #167이 새로 연 `require('react-native')` 별칭 출처만 그 이름이 이런 자리에 쓰이면 사실 대신 센다. JSX 속성 `name={…}`은 재대입으로 읽혀 같은 이름 바인딩을 지운다(사실이 줄 뿐이다).
  속성 자리 API로 만든 초기값(`var M = _reactNative.NativeModules.A`)은 바인딩이 아니어서 Babel 출력의 `M.x()`는 귀속되지
  않는다(초기값을 js-binding-scope로 센다).
- extract-js 4차 리뷰가 기록만 하라고 한 기존 결함 중 B2(레지스트리 출처가 이름 단위)·S2(템플릿 보간)·`b07`(`foo.function(M)` 뒤
  다음 줄 `{`)은 PR #167에서 고쳤다(위 현재 상태). 남은 것: JSX 글자 `<View>a M = 1</View>`의 `M = 1`을 재대입으로 읽는다(사실이
  계수가 될 뿐이다).
- extract-js 보간 경계: 보간 안 정규식 리터럴(`` `${s.replace(/"/g, '')}` ``)은 2026-11-25 브랜치에서 고쳤다(위 현재 상태). main처럼
  나눗셈으로 남는 자리: `)`·`}` 바로 뒤(`if (x) /re/`·`while (x) /re/`·`for (;;) /re/`·블록 `}`), `of`·`...`·`<`·`++`/`--`·`>` 뒤
  (`for (m of /re/)`·`[.../re/]`·`a < /re/`·`++/re/.lastIndex`·`<RegExp>/x/`), async 함수·생성기 안 `await`·`yield` 뒤, `>`로 시작하는
  정규식(`/>"/`), `>` 뒤 `/`로 시작하는 JSX 글자. 보간 안 JSX 글자의 따옴표는 문자열 시작으로 읽는다(기존 동작). main에서 정규식 둘의
  오인이 상쇄되던 보간(`` `${f(/"/g, />"/)}` ``)은 하나만 고쳐져 템플릿이 이어질 수 있다. 보간 밖 코드의 정규식 판정(`isRegexPosition`)은 바꾸지 않았다 — 문맥 키워드(`get`·
  `of` 등)·TS non-null `!` 뒤 나눗셈을 정규식으로 읽어 다음 `/`나 줄 끝까지를 한 토큰으로 삼킨다(기존 동작).
- extract-js 보간 안 이름(PR #167에서 넣은 근사): 보간은 이름을 찾는 데만 다시 토큰화한다. 대입·증감·`for`가 있는 보간은 대입
  대상이 될 수 있는 이름을 모두 대상이 확실하지 않은 재대입으로 보고(`${a ? M : (N = 1)}`의 M도), 보간 안 함수의 매개변수·선언과 TS
  템플릿 리터럴 타입 안 이름도 템플릿 위치의 바인딩으로 센다 — 과다 계수 쪽이다. 보간 안 호출은 귀속하지 않는다.
- extract-js 레지스트리 별칭에서 만든 바인딩(기존 동작): 모듈 식 판정은 이름 그대로인 `NativeModules.X`만 바인딩한다. 별칭의
  `const C = NM.Cam`(`import { NativeModules as NM }`·`{ NativeModules: NM } = RN`)과 `const NM = require('react-native').NativeModules`·
  `const NM = RN.NativeModules`는 사실·계수는 내지만(초기값을 한 번 센다) 바인딩하지 않아 그 뒤 `C.go()`·`NM.Cam.go()`는 쓰임마다
  세지 않는다. 오라클 `alias` 모드는 이 꼴을 내지 않는다. 같은 쪽 기존 부정확: `const NativeModules = require('react-native')`(모듈
  객체 전체)와 `const { NativeModules } = require('react-native').Foo`도 레지스트리로 읽는다(specifier만 본다).
- extract-js 객체 키·메서드 이름 자리의 `NativeModules`(기존 동작, main부터): `{ NativeModules: 1 }`의 키와 `class K { *NativeModules()
  {} }`·`get NativeModules() {}`의 이름을 베어 레지스트리 값으로 읽어 동적 `module-import NativeModules`를 낸다(`dynamic-module-names:`로
  센다 — 정적 거짓 사실은 아니다). react-native 0.88.1 `index.js:307`의 게터 `get NativeModules() { return require(…).default; }`가 이
  꼴이다 — 그 자리는 실제로 레지스트리를 내보내므로 사실을 지울지(공개 패키지 출력이 바뀐다) 대신 셀지를 정해야 한다. 레지스트리
  별칭(`NM`)은 PR #167에서 이름 자리로 건너뛴다.
- extract-js require 별칭 위험 판정의 과다 발동(PR #167, 세는 쪽): `const { NativeModules: NM } = require('react-native')`의 이름이
  표가 가리지 않는 자리에도 쓰이는지를 넓게 본다 — TS 함수 타입 `type F = (NM: string) => void;`, 기본값 `(x = NM) => x`, 괄호로 감싼
  반환 타입을 읽지 못한 목록도 위험으로 본다. 그 파일의 참 `NM.Camera.open()`은 사실 대신 계수가 된다(main은 이 출처를 읽지 않아
  사실이 없었다). 좁히려면 타입 별칭·타입 주석 자리의 함수 타입과 기본값 식을 가르면 된다.
- extract-js 같은 범위 `var` 재선언 앞의 참 호출(PR #167 S1의 결과, 기존 규칙): `var C = NativeModules.Camera; const D = C; D.take();
  { const NativeModules = mock; var C = NativeModules.Camera; }`의 `D.take()`는 실행하면 네이티브 Camera를 부르지만, 그 `var`가 두 값을
  가져 묶음 전체를 거두므로 사실 없이 첫 초기값만 센다(main·`55aef42`는 `Camera.take`, `af6e204`는 `Camera.take`와 계수 1). 같은 범위의
  다른 값 재선언은 초기값을 세는 기존 규칙이다. 위치마다 그때까지의 선언만 보면 살릴 수 있지만 `var` 끌어올림 때문에 앞 위치도 뒤
  선언의 값일 수 있어(함수 안 재대입) 지금은 하지 않는다.
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
- (PR #167, 머지됨) js-binding-scope 문구에 "or used inside a template interpolation"이 더해졌다(접두사·수 위치 그대로). 테스트 도우미의
  `NativeModules` 대역·다른 함수의 별칭이 내던 거짓 module-import·method-invoke는 사라지고, 블록 밖 `var`·재대입한 레지스트리
  바인딩의 접근, 템플릿 보간 안의 모듈 쓰임은 사실 대신 계수가 된다. `foo.bar(M)` 뒤 다음 줄 블록 안 호출은 계수 대신 사실이 된다.
  PR #167 리뷰 반영으로 대역에서 꺼낸 바인딩(`const Camera = NativeModules['Camera']`)의 거짓 method-invoke도 사라지고(정하지 못하면
  쓰임마다 센다), 레지스트리 별칭과 이름이 같은 로컬 모듈 바인딩·`require('react-native')` 별칭 구조 분해의 호출은 사실이 되며,
  보간 안 레지스트리 별칭 쓰임은 첫 수에 든다. 델타 리뷰 반영으로 react-native가 아닌 모듈의 require로 가져온 `NativeModules`의 접근이
  `unattributed-js-native-modules:`에 들고(react-native 0.88.1에 새 줄, 3), 다른 모듈에서 가져온 원천에서 꺼낸 바인딩의 쓰임이 첫 수에
  든다. `check --strict`·`impact --strict` 결과가 바뀔 수 있다.

- (이 브랜치) 템플릿 보간 안 정규식 리터럴 뒤 코드를 읽는다 — 그 템플릿에 삼켜졌던 뒤 코드의 사실·계수가 나타나고(사실이 늘 수
  있다), 삼킨 구간이 가리던 안쪽 선언 때문에 생긴 거짓 사실은 사라진다. 삼킨 구간의 주석·문자열을 코드로 읽어 센 입구(`import` 낱말
  등)와 "브리지 API를 언급하는 템플릿" 입구가 줄 수 있다. main에서 정규식 둘의 오인이 상쇄되던 보간(`` `${f(/"/g, />"/)}` ``)만은
  템플릿이 뒤 코드로 이어질 수 있다. `check --strict`·`impact --strict` 결과가 바뀔 수 있다.

## Resume Prompt

HANDOFF.md와 적용 AGENTS.md를 읽고 branch/status를 확인해줘. isthmus-cli 0.14.0은 발행됐고, 2026-11-03 계열
검토 후속(#162)과 js-binding-scope 측정·extract-js 후속(#164)은 main에 머지됐으나 미발행(`[Unreleased]`)이다.
2026-11-22 extract-js 블록 범위 바인딩(#165)과 레지스트리 출처·템플릿 보간·속성 자리 호출 수정(#167)도 main에 머지됐다(미발행).
템플릿 보간 안 정규식 리터럴 수정은 브랜치 `ccr-37904670-hxdjsx`(main `4a3e99d`에서 시작)에 있다 — 푸시·PR 여부는 `git status`와
GitHub로 확인한다. 발행 여부는 npm registry로 확인하고, 위 후속 후보와 릴리스는 내가 고르기 전에 착수하지 마.
