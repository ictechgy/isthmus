# Handoff

_Last updated: 2026-09-20 (자매 브리지 확장 PR 4개 CI 통과·머지 완료 · 네 저장소 main 동기화 · 미발행)_

## 현재 재개 기준

저장소별 재개 정보: [cartograph](https://github.com/ictechgy/cartograph/blob/main/HANDOFF.md) ·
[kartograph](https://github.com/ictechgy/kartograph/blob/main/HANDOFF.md) · [dartograph](https://github.com/ictechgy/dartograph/blob/main/HANDOFF.md).
제품 변경은 네 PR에 머지됐다. 이 문서는 그 인계 기록이며 재개 시 실제 Git 상태를 확인한다.

### 머지 완료 — 사용자 "다 머지 시켜줘" 승인

| 저장소 | PR | 상태 | 머지 커밋 |
|---|---|---|---|
| isthmus | [#96](https://github.com/ictechgy/isthmus/pull/96) | CI 통과·머지·로컬 main 동기화 | `ad7de61` |
| cartograph | [#123](https://github.com/ictechgy/cartograph/pull/123) | CI 통과·머지·로컬 main 동기화 | `5c43c36` |
| kartograph | [#82](https://github.com/ictechgy/kartograph/pull/82) | CI 통과·머지·로컬 main 동기화 | `37f0053` |
| dartograph | [#127](https://github.com/ictechgy/dartograph/pull/127) | CI 통과·머지·로컬 main 동기화 | `3ecabfd` |

- 최종 PR head를 대조하고 모든 check의 성공을 확인한 뒤 네 PR을 squash merge했다.
  네 저장소 모두 머지 트리와 검토한 PR 트리가 같음을 확인했고 기존 사용자 변경을 보존했다.
- 원격 PR의 `MERGED` 상태·머지 커밋과 로컬 main을 대조했다. 최종 PR CI 5개 실행이 모두
  성공했다: isthmus `35453711363`, cartograph `35453717002`, kartograph `35453722844`,
  dartograph CI `35453724783` 및 같은 저장소의 impact-precheck `35453724771`. kartograph는 JDK 17/21·AGP 최소 조합과
  전체 test 잡의 compiler/precision/Android/plugin/metadata 검증까지 통과했다.
- GLM 반영/기각 기록과 동반 PR 링크를 각 PR의 코멘트에 남겼다. 머지 턴에서는 새 제품 코드 변경이 없었으며
  앞선 구현 턴에서 완료한 GLM 리뷰를 재전송하지 않았다. 태그·패키지 발행은 수행하지 않았다.
- `.git/sibling-bridge-merge/final-merge-record.json`에 커밋·PR·리뷰 코멘트·머지·로컬 동기화와
  최종 CI 대조 결과가 있다. 같은 폴더에 실제 변경 patch·PR 본문·checks·CI job 기록을 보존한다.

### 이번 작업 — 자매 브리지 확장 (개발, 미발행)

- 네 저장소의 구현 브랜치는 `feature/sibling-bridge-support`였다. 구현 기준 HEAD는 isthmus
  `310481f`, cartograph `61abea5`, kartograph `6d0ce79`, dartograph `a6f0c7f`.
  제품·사용법 변경 81파일은 네 PR에 커밋·push·머지했다.
  현재 브랜치·머지 상태는 위 표를 따른다.
  기존 isthmus `docs/RESEARCH.md`, kartograph `.claude/`·`HANDOFF.cartograph-notes.md`,
  dartograph `HANDOFF-PROGRESS.md`·`editors/vscode/icon-drafts/`는 보존했다.
- isthmus: `retentions --for kartograph`(실제 JVM ID 필요), 실제 Clang USR의 ObjC 보존,
  코어 RN 전역 이벤트 v2(`extract-js --events`, event-listen↔event-emit), check 경고·
  query/graph event kind·기존 diff/retention 연동. v1+v2 통합 호출 근거 예산도 검사한다.
  [RN 이벤트 계약](docs/BRIDGE-RN-EVENTS.md)을 읽는다. Expo 이벤트·간접 emitter 추적·
  RN 이벤트 preflight/runtime은 지원하지 않는다. module/component 이름 매치만으로는
  보존 루트를 만들지 않는다.
- kartograph: external-retentions v0 파싱·`dead --external-retentions`·EXTERNAL_BRIDGE
  설명·소유 타입 보존·스냅샷 근거 왕복. 누락/잘못된 ID는 부분 적용 없이 실패한다.
  `bridges --rn-events`는 명시적인 RCTDeviceEventEmitter 요청 뒤 emit을 관찰한다.
  실제 심볼 부착에는 `snapshot --include-paths`와 유일한 소스 경로 해석이 필요하다.
  JVM package와 소스 디렉터리가 다르면 기존 보수적 경로 해석은 미확정으로 남는다.
- cartograph: `.m`/`.mm` Clang 선언·참조를 일반 그래프에도 포함한다. RN 구현 매크로에
  sourceLanguage와 컴파일러 ID를 붙이고, 같은 줄의 보조 class method는 Clang의
  instance-method 종류로 구분한다. 셀렉터 이름으로 추측 매칭하지 않는다.
  `bridges --rn-events`는 직접 Swift RCTEventEmitter 하위 타입의 방출을 별도 v2로 낸다.
  오탐 코퍼스 golden은 RNCalendar의 실제 class/method USR 2건과 해소된 옛 공백만 갱신했다.
- dartograph는 `doc/GRAPH-EXCHANGE.md`의 역할·계약 안내만 갱신했다. Dart 생산 코드는 그대로다.
- 최종 검증: isthmus `npm run verify` 통과(제품 629, Phase 0 15, workflow 22;
  line/branch/functions 97.37/91.42/95.65%). cartograph 전체 테스트 1,647개와
  CLI 하네스를 포함한 coverage 92.84%(32,184/34,666), 실제 compiler fixture·
  dead/cycles/type-cycles/rules 자기 분석 모두 통과했다. 최종 바이너리로 기존
  cartograph↔dartograph retention 왕복과 limitation-scopes 도그푸딩도 통과했다.
- 추가 실행: 실제 Clang+JS→ObjC 보존→dead explain, JS+인덱싱한 Swift+Kotlin 소스 RN
  이벤트 조인→Swift 보존 설명, 실제 Kotlin 컴파일→경로 포함 snapshot→bridges→isthmus→
  kartograph dead 억제·explain을 확인했다. Kotlin snapshot의 missing-build-witness /
  graph-file-freshness-unverified는 그대로 보존했다. Kotlin 잘못된 입력 14건과 RN 플래그
  4조합, v1/v2 query snapshot의 외부 호출 근거 왕복도 확인했다.
- Kotlin 정식 Gradle 검증 완료: 승인 후 Kotlin 2.4.20 의존성을 받아 JDK 21에서
  `./gradlew --no-daemon test :koverVerify :gradle-plugin:validatePlugins :cli:installDist`
  통과(760 tests, 실패·오류·skip 0). 실제 설치 배포의 CLI/agent 계약도 통과했다.
  설치된 Android SDK를 `ANDROID_HOME`으로 지정해 compiler corpus 44 retained /
  4 reportable을 확인했다. 자기 분석은 6개 생산 모듈·7,173 nodes, dead/private-dead/
  cycles/rules 0건, 총 5.46초(예산 15초)였다. 이전 턴의 offline 실패는 해소됐다.
- 캐시 측정: [기록](experiments/real-corpus/CACHE-MEASUREMENTS.md)과
  [원시 JSON](experiments/real-corpus/results/cache-measurements.json). 합성 bridge-app 1개와
  로컬 공개 pub 캐시의 shared_preferences_foundation 2.5.4 코퍼스 3케이스를 각각 두 번
  수집했고 모두 miss→hit·보고서 동일성을 확인했다. 공개 3케이스는 1,106~1,408ms →
  132~138ms였다. SDK·빌드·생산자 캐시는 유지했다. 전체 15케이스 재실행이나 원격
  아카이브 재인증, 앱 런타임 검증은 아니다.
- `dartograph --version`의 pub 설치 래퍼가 의존성 해석을 자동 실행했다. 이후에는 로컬
  source에서 만든 0.14.0 AOT 실행 파일을 사용했다. 같은 래퍼를 무심코 재실행하지 않는다.
- 후속 사용자 "승인"으로 의존성 다운로드·고정 공개 소스·GLM 외부 리뷰를 실행했다.
  공개 battery 플러그인 `13e170479b3c66c890fa401f5fdb3af141faf67a`를 내려받아,
  전체 ObjC 관찰의 ID 누락 거부와 명시적인 macOS include 범위의 보존 왕복을 검증했다.
  최종 바이너리로 재실행해 통과했다. RN 공식 소스 v0.81.4도 고정해 전역 이벤트 버스와
  ObjC 매크로 형태를 대조했고, 출처는 RN 이벤트 계약 문서에 남겼다.
- `packet-ask --provider glm` 실제 리뷰 완료: isthmus `eda1589ba30b`, cartograph
  `0d5b0f1cd8cc`, kartograph `42a71c2772aa`, dartograph `de643634a784`.
  검증한 수정분의 후속 리뷰는 isthmus `3e79c0bd84f7`, cartograph `125112deba78`,
  kartograph `3d7e8434c741`다. dartograph는 문서 설명 보완만 있어 후속 재전송 없이 확인했다.
  모델의 추측은 코드·테스트로 판별했고, 판정은 작업 폴더 `glm-disposition.md`에 기록했다.
  초기 paste 패킷은 리뷰 응답이 아니다. review는 `--staged` 또는 `--files`를 사용하며
  `--include-files`는 지원하지 않는다. isthmus 전체 diff에는 `--max-files 64`가 필요하다.
- 리뷰 반영: JS 동명 객체 속성의 가짜 이벤트 구독을 차단하고 공통 lexer의 열을 UTF-8로
  맞췄다. Swift 조건부 import/본문·extension·가림으로 제외된 범위를 계수·보고한다.
  Kotlin은 빈 JVM ID 거부·snapshot ID 소속 검증·정렬·호출 근거 보존·소유 타입 탐색 재사용,
  완전 수식 RN 이름과 잘못 닫힌 인자 처리를 보강했다. 각 동작은 회귀 검사로 확인했다.
  문서의 transport 구분·실패 조건·관찰 범위도 맞췄다.
- 요청한 구현·검증·리뷰와 후속 네 저장소 머지는 완료했다. 발행은 수행하지 않았다.
  RN 지원은 문서에 적은 정적 추출 범위이며 앱 전체 빌드·엔진 실행 검증은 아니다.
- 이전 `$TMPDIR/isthmus-kotlin-local-7j461rfx/`와 `/tmp/isthmus-*.log`는 이번 머지 턴 시작 시
  디스크에 없었다. 과거 원본·GLM 응답·receipt·`final-validation-summary.json`이 현재도
  존재한다고 가정하지 않는다. 앞선 실행 결과는 이 기록과 세션 대화에, GLM 판정 요약은
  새 PR 코멘트에 남겼다. 새 원격 CI 결과와 머지 근거는 상단 PR 및 `.git/sibling-bridge-merge/`를 따른다.
  변경 문서의 로컬 링크 152개와 네 저장소의 `git diff --check HEAD`는 이전 검증에서 통과했다.
- 이전 검증 턴에서는 당시 임시 폴더의 `cache-fixture/.build`·`cached-shared-prefs/.build`만
  정리하고 원본·실행 근거를 남겼다. 현재 그 임시 폴더는 없으며, 저장소의 원시 캐시 측정
  JSON과 이번 머지의 `.git/sibling-bridge-merge/` 기록은 보존돼 있다.

아래 내용은 이번 작업 전 상태를 보존한 기록이다. 현재 작업은 위 항목을 우선한다.


- `main`은 `50642d0`로 origin/main과 동기화. 열린 PR 없음. 작업 트리 변경은
  `docs/RESEARCH.md` 하나다(제품 코드 변경 없음).
- **0순위 발행 완료**: npm `isthmus-cli@0.7.0`(tarball sha512 `2DkZSQNV…`, 발행본
  `--version` 0.7.0, `compatibility.json` 포함) · annotated tag `v0.7.0`(9ca9870) ·
  GitHub Release `isthmus-cli 0.7.0`. CHANGELOG는 `[Unreleased]`를 `[0.7.0]
  - 2026-09-19`로 합쳐 발행 내용과 일치시켰다(#93). cold-cache도 isthmus를
  compatibility.json 버전으로 고정·대조하도록 켰다(#94).
- **이번 세션 머지(2026-09-19)**: #85~#94 12건. 최종 `npm run verify`는 제품 612 /
  coverage line/branch/functions 97.35/91.25/95.52.
- **다음 수 — 자매 저장소 작업(우선순위 순)**:
  1. **kartograph external retention(#9 짝)**: `dead`에 `--external-retentions <path>`를
     추가해 isthmus `external-retentions` v0를 파싱하고 `reason:"bridge"`를 외부 브리지
     사유로 매핑한다. kartograph `DeadCommand`는 내부 `RetentionEvidence`/`RetentionReason`
     만 있고 외부 입력이 없다(GitHub 코드 검색 `externalRetentions` 0건). 동반 isthmus
     작업은 `retentions --for kartograph`(Kotlin 수신 보존 대상)다.
  2. **RN native→JS 이벤트 경계(#7)**: GRAPH-EXCHANGE에 새 fact 종류(event-emit↔event-listen)
     ·조인·심각도 추가. cartograph·kartograph가 네이티브 방출을 emit하고 isthmus
     `extract-js`가 JS 구독을 listen으로 낸다. EventChannel v2와 구조 동형이며 4저장소
     동시 계약 변경이다(RESEARCH 우선순위 3 / CodeGraph `callback-synthesizer.ts:1638`).
  3. **ObjC retention(#8)**: cartograph가 Objective-C 선언을 그래프 노드로 포함해야
     external retention이 매칭할 수 있다(README L1288: "that fact scan does not make
     Objective-C declarations graph nodes"). 그 뒤 isthmus의 ObjC 보존 제외를 푼다.
  4. **#12 증분·성능**: 코드 변경이 아니라 dartograph(+kartograph) 실행 파일을 확보해
     Flutter 코퍼스를 두 번 돌려 cache hit/miss를 재는 환경 작업이다.
  - #11 이슈 승격: 보류.
- 이번 세션 검증: cartograph main 빌드로 expo-haptics 수신 측을 스캔하고, `dead
  --external-retentions`로 v1·v2 보존 파일의 디코드·적용을 확인했다(인덱스에 선언이 없어 매칭은 미확인).
- GLM 검토는 `packet-review`가 `packet-ask exited 125`로 실패해 확보하지 못했다.
- 아래 과거 절의 branch·OPEN·남은 것·버전 표는 당시 기록이며 현재 실행 지시가 아니다.
- **PR #81 MERGED(스쿼시 `65edc97`)**: `check --format codequality` GitLab Code
  Quality 발견 목록 출력. 억제 이슈 제외·지문 중복 가드·severity 명시 분기·
  `report/rules.ts` 중립 모듈 분리. GLM(패킷 `f2cb3d0dc19c`) 지적 반영 —
  `Set.add` 반환값 오독 결함을 신규 테스트가 잡아 수정. CI run `35301004099`
  macOS·Ubuntu SUCCESS 후 머지.
- **호환 버전 세트 발행 — kartograph 완료, isthmus는 npm 인증 대기**:
  - **kartograph v0.10.2 발행 완료**: PR #74 머지(스쿼시 `ecaa2be`, #73
    unmatched-keep-rule이 병합돼 Added+Fixed로 기록) → `v0.10.2` 태그 →
    release run `35307609887` SUCCESS. GitHub release 아티팩트(tar/zip/plugin jar/
    SBOM/SHA256SUMS)와 Gradle Plugin Portal `0.10.2` 발행 확인. 발행 tarball을
    받아 `--version`·`expo-haptics` 스캔(5 facts·method 4) 재검증 완료.
  - **isthmus PR #82 MERGED(스쿼시 `b039bbf`)**: package.json 0.7.0·호환 세트 문서.
    `npm publish`는 verify·패킹까지 성공 후 PUT에서 **E404(토큰 만료/권한 부족,
    whoami도 401)**로 차단 — `~/.npmrc`의 `_authToken`이 죽어 있다.
    **남은 발행 단계(인증 갱신 후)**: `npm publish` → `git tag v0.7.0 b039bbf` →
    `git push origin v0.7.0` → `gh release create v0.7.0`(이전 릴리스는 vX.Y.Z 태그).
  - cartograph 0.18.0은 발행 완료(brew formula·설치본·`fb7a2ca` 포함 확인).
  - dartograph 0.14.0은 pub.dev 발행 확인, 미발행 커밋 없음.
  - 배포 세트 실측: 발행 cartograph 0.18.0 + **발행** kartograph 0.10.2 +
    isthmus 0.7.0 dist로 `expo-haptics@14.1.4` 조인 `errors: 0`·모듈 1·메서드 4.
    (JAVA_HOME=/opt/homebrew/opt/openjdk@17, kartograph는 `--target` 없이 실행)
- isthmus #72~#80은 로컬 Git 이력에서 머지를 확인했다. Expo optional은 #78로 해결됐다.
  자매 Expo DSL 스캔은 기존 인계 기록상 cartograph #97·kartograph #67 머지 완료다.
  자매 저장소·도구 registry 최신 버전은 재조회하지 않았다. 설치 cartograph 버전과
  expo-haptics 고정 버전의 npm 메타데이터만 추가 확인했다.
- **#80 머지 완료**: 커밋 `829c3e7` → squash `8983c89`.
  https://github.com/ictechgy/isthmus/pull/80
  `packet-ask` GLM 리뷰 PASS(패킷 digest `1824f0858130`), macOS·Ubuntu CI SUCCESS
  (run `35227842479`). 코드·테스트 3파일만 머지했고 기존 문서 변경은 제외했다.
- 머지된 수정: `src/extract/js-scan.ts`가 Expo named import 별칭의 모듈 반환값을 추적한다.
  required/optional·제네릭·동적 이름·상대 export를 검증하고, 재대입·구조 분해·매개변수
  가림 등 불확실한 별칭은 파일 단위로 보수적으로 제외한다. 일반 함수 반환 추적은 아니다.
- 회귀: `src/extract/js-document.test.ts`에 3개 테스트, 빌드 CLI의
  `scripts/verify-cli-contract.mjs`에도 별칭 반환값 호출 검사를 반영했다.
  별칭 지원을 잠시 제거하면 양성 회귀 2개가 실패하고 복원 후 관련 46개가 통과했다.
- 최종 코드의 `npm run verify` 통과: 제품 558 / Phase 0 15 / workflow 21,
  line/branch/functions 97.58/91.28/95.71%, clean build·CLI/package 계약 통과.
  별도 lint 스크립트는 없으며 typecheck는 verify에 포함된다.
- 독립 리뷰에서 발견한 구조 분해·반환 타입 매개변수 오탐을 회귀로 반영했다.
  초기값마다 전체 토큰을 검색하던 중간 구현은 폐기하고 제외 이름을 한 번만 수집한다.
- **공개 소스 부분 검증(이번 세션, 중단 지점)**: `expo-haptics@14.1.4`를
  `npm pack --ignore-scripts`로 받아(sha256 `d721711e1315800035a7b8fbada612f9091ebed593529a2a0c08d48333acd130`,
  MIT) 임시 경로에서 검증했다. isthmus extract-js는 `src/ExpoHaptics.ts`의
  `requireOptionalNativeModule('ExpoHaptics')`를 `module-import` + `mechanism: "expo"`
  + `optional: true`로, `src/Haptics.ts`의 메서드 호출 4개
  (notificationAsync·impactAsync·selectionAsync·performHapticsAsync)를 귀속했다.
  임시 루트는 `/var/folders/lw/r6rd_zlj3ps7pb_h2sdtcr3w0000gn/T/opencode/`다.
  그 아래 `expo-haptics-14.1.4.tgz`, `expo-haptics/package/`(공개 소스),
  `expo-haptics/empty-index/`가 있다. 다음 세션에서 실재 여부를 먼저 확인한다.
  배포 URL: https://registry.npmjs.org/expo-haptics/-/expo-haptics-14.1.4.tgz
  npm metadata의 license는 MIT다. 소스 재배포 시 라이선스 원문도 별도로 확인해야 한다.
- **막힌 지점 해소 — 원인은 설치본 버전(2026-09-18 세션 실측)**: 설치 cartograph
  0.17.0에는 Expo DSL 스캔이 없다. `513cbef`(PR #97)는 어떤 태그에도 없고
  원격 최신 태그도 0.17.0이다 — main에 머지됐지만 **미발행**이다.
  `git show 0.17.0:…/BridgeFactScanner.swift`에 ExpoModulesCore 언급 0건.
- **소스 수집 조건 확인**: `bridges`는 인덱스 파일 목록이 아니라 디스크를 걷는다
  (`bridgeSourceFiles()` — `.swift`+`.m`/`.mm`, pathFilter·빌드산출물 가지치기).
  인덱스는 USR 부착에만 쓰이고, 빈 인덱스 + `--allow-empty-index`로 동작한다.
  Package.swift/podspec 불요. Expo 관문은 파일 단위 `import ExpoModulesCore` +
  `class X: Module`/`@ExpoModule`/`extension X: Module`.
- **재검증 — 모듈 조인 성공**: `../cartograph`의 `origin/main`(`aeba97d`)을
  `/tmp/cartograph-expo-dsl` 워크트리로 빼서 `swift build`(35초) 후 동일 명령 실행.
  `module-export` channel=ExpoHaptics·mechanism=expo·symbol=HapticsModule 생산.
  로컬 빌드 isthmus(main `8983c89`, dist)의 extract-js 산출과 `check` 조인 시
  `module-import`×`module-export` 조인 성공(미수출 import 오류 없음).
  산출물: `…/opencode/expo-haptics/{js-facts.json,swift-facts.json}`.
- **DSL 멤버 체인 공백 — cartograph PR #103 머지 완료(`fb7a2ca`, 스쿼시)**:
  `AsyncFunction("x") {…}.runOnQueue(.main)`처럼 결과 빌더 문장이 멤버 체인의
  베이스면 `ExpoDefinitionCollector.isDSLStatement`가 내부 호출을 거부해
  `method-handle`이 안 나오던 공백. `fix/expo-dsl-member-chain` 브랜치로
  `57510d8`(수정: 부모 호출의 `calledExpression` 자리면 통과) + `39854fe`
  (GLM 권고 인접 경계 테스트 2건)를 푸시했다. 신규 테스트의 red를 stash 복귀로
  확인, coverage 93.01%·cli-contract·fixtures·도그푸딩 4종 전부 통과.
  수정 후 실제 패키지 재실행: method-handle 3개 방출, isthmus check에서
  `matchedModules: 1 · matchedMethods: 3`, 남은 error는 Android 전용
  `performHapticsAsync` 1건뿐(정상). GLM 리뷰 수용 판정(패킷 `56d28c7dc4c5`).
  CI run `35253521054` 두 잡 전부 SUCCESS(자기분석 8m46s · coverage 게이트 11m16s).
- **정상인 비대칭 — kartograph 로컬 빌드로 실증 완료**: `performHapticsAsync`는
  JS가 `Platform.OS !== 'android'`로 보호하고 `android/…/HapticsModule.kt`에만
  존재한다고 추정했던 것을 Android 수신 측 사실로 확인했다.
  `JAVA_HOME=/opt/homebrew/opt/openjdk@21 ./gradlew :cli:installDist`로 빌드한
  kartograph 0.10.0의 `bridges --project <package>`가 `module-export`
  (ExpoHaptics·mechanism=expo) + method-handle 4개(notificationAsync·
  selectionAsync·impactAsync·performHapticsAsync) + `missing-handler-usrs`
  limitation을 생산했다(산출: `/tmp/karto-facts.json`). 3문서 `isthmus check`는
  `errors: 0 · matchedModules: 1 · matchedMethods: 4`로 완결 — iOS/Android
  양쪽 수신 측이 전부 실증됐다. 참고: method-handle에는 mechanism이 없는 것이
  kartograph의 의도된 형태(테스트명 "mechanism on name boundaries and methods
  without it"), generatedAt은 소스 최신 mtime 스냅샷이라 npm tarball의 정규화
  시각(1985-10-26)이 실리고 isthmus의 input-freshness 메모는 정확한 관측이다.
- **kartograph 체인/래퍼 공백 소스 확인 + 수정 — PR #72 머지 완료(`81cb6eb`, 스쿼시)**:
  Kotlin 스캐너(`index/BridgeFactScanner.kt`)는 토큰+괄호 수집기 구조라 부모를
  안 걷는다 — 호출의 `)`에서 바로 완결되므로 `.runOnQueue`/`.let{}` 꼬리가 사실
  생성을 막지 않는다(합성 검증: `Function("withChain"){}.let{}` 방출됨).
  중첩 람다·정의 블록 밖 거부는 기존 테스트가 커버한다. 다만 합성 입력
  (`/tmp/karto-gap-probe`)으로 같은 "조용한 누락" 류의 인접 공백 3건을 실증했다:
  ① 중첩 제네릭 `AsyncFunction<List<String>>` — 토큰 정규식 `<[^>]*>`가 첫
  `>`에서 끊겨 호출 전체가 투명해짐(메서드 누락·limitation 없음, 실제 패키지의
  `AsyncFunction<Unit>`는 단일 인자라 동작함) ② FQN
  `expo.modules.kotlin.modules.ModuleDefinition {}` — lookbehind `(?<![\w.])`가
  `.` 앞을 거부해 정의 블록이 안 보임(dynamic=true 클래스명 폴백 + 메서드 전부
  누락, `dynamic-expo-names` limitation은 정직하게 울림) ③ `this.AsyncFunction`
  수신자 한정 — 같은 lookbehind로 투명. ④ 인자 위치 DSL 호출(`print(AsyncFunction…)`)
  은 방출됨 — Kotlin DSL은 빌더 수신자 메서드라 람다 안 어디서든 등록되므로
  Swift 결과빌더 의미와 달리 방출이 의미상 맞다(결함이 아니라 교차도구 발산).
  수정: `fix/expo-dsl-scan-gaps` 브랜치 — `0b08441`(정규식 3공백 + 테스트 5건,
  red 확인) + `2995735`(GLM 지적 반영: 제네릭 절 `<[^{}]*>` → lazy `<[^{}]*?>`
  — 인자 안 `y > (z)`에 앵커 끌림 차단, `View` 제네릭 허용, 경계 테스트 6건 추가,
  제네릭 개행 미지원 주석 명시). GLM 리뷰 수용(패킷 `cdbbd9d90c64`), 보류 항목은
  PR 코멘트에 사유 기록. `:index:test` 84/84, 전체 게이트
  `test :koverVerify :cli:installDist` 통과, 실제 패키지 재스캔 회귀 없음.
  CI run `35293813833` 네 잡 전부 SUCCESS(test 25m50s·compatibility 17/21·
  agp-minimum). 배포판 kartograph는 0.10.0이라 이 수정은 미포함.
- **다음 세션 후보**:
  1. ~~cartograph PR #103의 CI·머지 판단~~ — 완료: CI SUCCESS 후 사용자 승인으로
     스쿼시 머지(`fb7a2ca`, 2026-09-18). 브랜치·`/tmp/cartograph-expo-dsl`
     워크트리 정리됨. 단 배포판(0.17.0)에는 아직 없다 — 다음 cartograph 릴리스까지
     수신 측 Expo 사실은 main 빌드가 필요하다.
  2. ~~kartograph PR #72의 CI·머지 판단~~ — 완료: CI 네 잡 SUCCESS 후 사용자
     승인으로 스쿼시 머지(`81cb6eb`, 2026-09-18). 브랜치·`/tmp/kartograph-expo-gaps`
     워크트리 정리됨, 본 저장소 main은 `81cb6eb`. 배포판 0.10.x에는 미포함 —
     다음 kartograph 릴리스까지 로컬 빌드 필요
     (`JAVA_HOME=/opt/homebrew/opt/openjdk@21 ./gradlew :cli:installDist`).
  3. 코퍼스 확장 후 신규 기능(별칭 추적·mechanism·optional)의 공개 호환
     버전 세트 발행과 RN 모듈·컴포넌트 retention 계약 확장을 이어간다.
     `experiments/real-corpus`는 Flutter 전용이므로 RN 적용 경계를 설계해야 한다.
     코퍼스·JSON 근거 파일·재현 스크립트는 아직 추가하지 않았다.
     → 버전 세트 발행은 위 "호환 버전 세트 발행" 절 상태로 진행됨
     (kartograph 0.10.2 발행 완료, isthmus 0.7.0은 npm 인증 대기).
- #80 머지 이후 하지 않은 것: 실제 앱 빌드·runtime 실행, 발행, retention 계약 변경,
  cartograph 저장소 변경, 전체 코퍼스 실행기 확장, 추가 커밋.
  사용자 요청으로 남은 구현은 중단했고 HANDOFF만 갱신했다. RESEARCH의 기존 변경은 보존했다.

## 과거 작업 이력

아래는 기존 세션의 근거를 보존한 기록이다. 현재 작업과 잔여 검증은 위 절을 우선한다.

## 완료 — README 영·한 퇴고 (PR #79 머지, squash `ea4cb95`)

- 브랜치 `docs/readme-rn-update`: 양쪽 README의 RN 절을 머지된 구현(mechanism 구분·
  Expo DSL 스캔·optional 부재 허용·extract-js)에 맞추고, check 진단 코드 목록에
  RN 경계 코드를 추가. `extract-js` 사용 절·`diff`의 RN JS 입력 반영.
- 한글본은 Claude(sonnet) 리뷰로 조사·용어 불일치 교정(싣고 오탈자, 사실/핸들러/
  패키지/네이티브 통일). GLM 리뷰 반영: 보존 근거 "왕복"↔"보내기" 구분 복원,
  영어 "missing export degrades" 주어 수정, "same pairing" 명확화.
- 검증: 링크·앵커·진단 코드·버전 주장을 소스와 대조. 문서 전용이라 npm verify 불요.
- **후속 정리 완료**: Expo 작업용 워크트리 `cartograph-expo`·`kartograph-expo`와
  양쪽 `feat/expo-mechanism` 로컬·원격 브랜치 삭제. 남은 워크트리는 다른 세션 것
  (`cartograph-p1`, kartograph `perf-fingerprint-parallel`, build/reports 평가 잔여 2개).

## 완료 — `module-import` optional 필드 (PR #78 머지, squash `9127222`)

- Expo `requireOptionalNativeModule`·`TurboModuleRegistry.get`/`getNullable`은 부재 시
  `null` 반환(호출자가 부재를 감당) — `requireNativeModule`·`getEnforcing`·
  `NativeModules.X`는 던지거나 부재 허용 신호가 아니다(RN·Expo 소스 확인).
- 계약: `module-import`에만 `optional?: boolean` 허용(그 외 종류·비boolean은 거부).
- extract-js가 부재 허용 조회로 관찰한 import에 `optional: true`를 싣는다(별칭 포함).
- 미수출 그룹 호출자가 전부 optional이면 error 대신
  `module-import-without-export-optional` warning. 하나라도 던지는 호출자가 섞이면 error 유지.
- 검증: npm test 554개·`npm run verify` 통과. end-to-end 확인: optional 두 호출은
  warning, `requireNativeModule`은 error.
- GLM 리뷰 반영 완료(`579345c`): `optional: false` 검증 구멍 폐쇄, mechanism-mismatch가
  optional보다 우선 진단(export 관찰 시 "미검증" 문구는 틀림), 빈 callers 방어.
  F3(`requireOptionalNativeViewManager`)는 expo에 존재하지 않아 기각.
- **PR #78 머지 완료** — squash `9127222`, 브랜치 삭제. main이 `9127222`다.
- 머지됨: cartograph PR #97(`513cbef`)·kartograph PR #67(`96a1aab`) Expo DSL 스캔.

## Goal

사용자의 목표는 **변경 전 직접·전이 영향 점검, 효율적인 AI 질의, 런타임 의존성 검증,
CI에서 빠른 갱신**을 MIT·영구 무료 도구로 제공하는 것이다. 타당성 조사를 반복하지 말고
구현·검증을 이어간다. isthmus 0.6.0 발행에 이어 **네 도구의 공개 호환 버전 세트가 갖춰졌다**
(아래 표). 시장 경쟁력·앱 전체 정확도까지 입증했다는 뜻은 아니다.

## Current Status

- 로컬 `/Users/jinhongan/Desktop/isthmus`: `main`에 있다(origin/main = `ea4cb95`).
  기존 미커밋 문서 변경(HANDOFF·FEASIBILITY·PRD·RESEARCH)과 미추적 파일
  (HANDOFF.cartograph-notes.md·default.profraw)은 보존했다.
- 자매 저장소: cartograph `refactor/agent-guidance-0.14.0` 브랜치(미머지 작업),
  kartograph `feat/event-channel-ffi` 브랜치(미머지 작업), dartograph·isthmus는 main.
- 아래 PR은 **MERGED**다. 이번 갱신에서 GitHub 실측으로 재확인했다.

| 저장소 / PR | 내용 | merge commit |
| --- | --- | --- |
| [isthmus #70](https://github.com/ictechgy/isthmus/pull/70) | preflight·runtime | `877b91cfd4fb304a8784339a0e0359768e7549d7` |
| [isthmus #71](https://github.com/ictechgy/isthmus/pull/71) | 0.6.0 릴리스 | `840aaa0e85f23d6979e5bf2e9c78a4ee15963cd9` |
| [cartograph #89](https://github.com/ictechgy/cartograph/pull/89) | bridge-facts v2 Basic/Pigeon | `b5c9b841fd1fc6a76179d6d1548c564a59f65c74` |
| [kartograph #50](https://github.com/ictechgy/kartograph/pull/50) | Basic bridge facts | `31b409f5de7b09914db11b9af23cae75ff38af82` |
| [kartograph #51](https://github.com/ictechgy/kartograph/pull/51) | why·신뢰도·markdown 리포트 | `8b8721b0664a55ef046f7a2c1b4a0518f279ff34` (squash) |
| [kartograph #52](https://github.com/ictechgy/kartograph/pull/52) | 0.10.0 릴리스 준비 | `57b701c1093ea979f7051e8336a44a945229d19f` |
| [dartograph #94](https://github.com/ictechgy/dartograph/pull/94) | Basic 송신 | `5e5d1c6eea3ef39f0e179e4d9338526c9c36741f` |
| [dartograph #96](https://github.com/ictechgy/dartograph/pull/96) | 0.10.0 증분 분석 등 | MERGED 2026-09-15 |

- **공개 호환 버전 세트 — 2026-09-16 확인.** TOOLCHAIN.md 요구 조건을 공개 버전이 충족한다.

| 도구 | 공개 버전 | 필요 기능 확인 근거 |
| --- | --- | --- |
| isthmus-cli | 0.6.0 (npm·GitHub) | preflight·impact·verify-runtime·--summary/--explain |
| cartograph | **0.15.1** (GitHub Release Latest, 태그 0.15.0·0.15.1) | 설치본 `/opt/homebrew/bin/cartograph` 0.15.1의 `bridges --help`에 `--messages` 존재·v2 출력 실측 |
| kartograph | **v0.10.0** (GitHub Release Latest) | main `57b701c`에 `bridges --messages` 코드 존재(AgentCommand.kt·BridgeFactScannerTest.kt). **발행본 실행은 미실측** — Android 실행은 미검증 |
| dartograph | **0.10.0** (pub.dev·GitHub 태그) | 활성화한 설치본으로 `bridges --messages` v2 출력 실측 |

- dartograph [PR #98](https://github.com/ictechgy/dartograph/pull/98)(dependency audit·closed-app mode·
  MCP resources/prompts)은 **OPEN·mergeable·CI 전부 SUCCESS·리뷰 없음**. 머지 여부는 사용자 승인 사안.
- 자매 로컬 상태(2026-09-16): `../cartograph`는 `refactor/agent-guidance-0.14.0`(`171b313`)에서
  AGENTS 리팩터링 미커밋(AGENTS.md·HANDOFF.md·Package.swift·Skills/AGENTS.md·Sources/AGENTS.md 수정,
  Sources/CartographIndexStore/AGENTS.md 신규). `../kartograph`는 `feat/adoption-competitiveness`(`97e0397`)에
  CI·실험 수정 커밋과 미커밋 AGENTS/HANDOFF 변경. `../dartograph`는 `feature/competitive-gaps`(`f5a078d`,
  origin과 동기화)에 미추적 HANDOFF-PROGRESS.md. 각 저장소 변경 전 그쪽 AGENTS·status를 다시 확인한다.

## 경쟁력·배포 상태 조사 (2026-09-16)

이 절은 새 구현이나 검증 완료 주장이 아니라 **경쟁력 확보에 필요한 것**과 **공개 배포 상태**를 다시
실측한 조사 기록이다. 근거는 공개 npm/pub/GitHub API 조회(2026-09-16), 그리고
`docs/COMPETITIVENESS.md`·`docs/FEASIBILITY.md`(실패 요인 10)·`docs/PRD.md`·`docs/TOOLCHAIN.md` 대조다.
경쟁 도구는 공식 자료·공개 저장소만 확인했고 직접 설치해 정확도·성능을 비교하지 않았다.

### 공개 버전 실측 (2026-09-16 재실측 — 호환 세트 완성)

| 도구 | 공개 최신 | 발행 | TOOLCHAIN.md 요구 대비 |
| --- | --- | --- | --- |
| isthmus-cli | 0.6.0 (npm·GitHub release 동일) | 2026-09-15 | `preflight`·`impact`·`verify-runtime`·`--summary/--explain` **있음** |
| cartograph | **0.15.1** (Release Latest) | 2026-09-15 | `impact` + `bridges --messages` **있음** (설치본 help 실측) |
| kartograph | **v0.10.0** (Release Latest) | 2026-09-16 | `impact --graph-file` + `bridges --messages` 코드 main 확인 |
| dartograph | **0.10.0** (pub.dev 동일) | 2026-09-15 | `bridges --messages --format json` **있음** |

**결론: 공개 버전만으로 호환 세트를 구성할 수 있다.** 네 도구 모두 TOOLCHAIN.md 요구 조건 충족.
문서로 고정하는 작업(docs/COMPATIBILITY.md 등)은 `docs/public-compat-set` 브랜치에 커밋해
PR #72로 올렸고, 남은 것은 리뷰·머지와 실사용 검증이다.

### 호환 세트 확보를 위해 발행해야 할 것 — 전부 완료

1. ~~isthmus 0.6.0~~ — **완료**(2026-09-15 npm·GitHub Release 발행).
2. ~~cartograph~~ — **완료**: PR #89로 Basic/Pigeon·handlerScope 통합 후 0.15.0→0.15.1 태그·Release 발행.
3. ~~kartograph~~ — **완료**: PR #52 머지 후 v0.10.0 Release 발행(2026-09-16).
4. ~~dartograph~~ — **완료 + 초과**: 0.10.0 발행. README의 "opt-in development-source producer" 표기는
   지원 수준 disclaim이 아니라 source 입력 사실 기술로 판단됨 — 문구 변경 필요 여부는 재평가 사안.
5. ~~공개 호환 버전 표 + 고정 예제·수집 설정·예상 출력·CI 예시~~ — **완료**: `docs/COMPATIBILITY.md` 신규
   포함 10개 문서를 `6c81b6d`로 커밋해 `docs/public-compat-set` 브랜치 PR #72 발행. 리뷰·머지 대기.

### 경쟁 지형 재확인 (외부)

- CodeGraph(MIT, 로컬 그래프 + MCP + impact)가 목표 1·2·4와 크게 겹치고 "AI 에이전트 컨텍스트 계층"으로
  포지셔닝하며 외부 확산 중이다. Dart↔Flutter 채널 조인은 이번에도 확인하지 못했다.
- Patrol MCP가 AI의 E2E 테스트 작성·실행·디버깅을 이미 점유했고, Marionette MCP가 실행 중 앱 제어로 인접한다.
- Pigeon 29의 실험적 FFI/JNI, Periphery의 MIT 저장소 archive→상용 전환은 각각 지원 범위 축소와
  유지관리 리스크 사례다.
- 따라서 그래프 + MCP + impact 자체는 이미 포화이며, 이 제품이 증명해야 할 차별점은
  **크로스언어 리터럴 조인 + retention 왕복**(`dead --explain`이 Dart 호출 위치를 돌려주는 지점)이다.

### 경쟁력 확보 우선순위 (조사 판단)

1. ~~공개 호환 버전 세트 + 설치 경로 + 문서화~~ — **달성**(2026-09-16 확인, 문서는 PR #72).
2. 실사용 정밀도 코퍼스 — 공개 앱/플러그인 3개 × 실제 변경 10개, 수동 정답 기준 오탐·누락 계수,
   지원 밖 채널을 분모에서 제외하지 않기. 공통 `setUp` 과잉 전파는 선택 사례에서만 수정된 상태다.
3. 외부 유지관리자 3명 반복 사용 (2주 내 재실행 2명).
4. 적용 범위 정직성(EventChannel·FFI/JNI·iOS 실기기·다른 Android API/ABI·release/lifecycle 미검증 명시) 후 확장.
5. AI 질의 인터페이스 — 대형 입력 9.5MB 출력의 요약/개별 경로 조회 계약. Patrol MCP·CodeGraph와
   경쟁하기보다 producer/MCP 계층으로 연동하는 선택지 검토.
6. 유지관리·거버넌스 — 버전·호환 표를 저장소 산출물로 유지하고, 실패 시 독립 도구에서 adapter로
   축소하는 탈출 경로를 미리 정한다.

### 레포별 남은 작업 (2026-09-16 재실측)

아래는 다음 세션이 이어갈 작업이다. 정본 계약은 `docs/GRAPH-EXCHANGE.md`·`docs/BRIDGE-MESSAGES.md`.

**isthmus — PR #72 리뷰·머지 판단**

- 호환 세트 문서화는 완료했다: `docs/COMPATIBILITY.md` 신규 + README·docs·SKILL.md의
  낡은 버전 문구 갱신을 `6c81b6d`로 커밋, `docs/public-compat-set` → **PR #72** 발행.
  GLM 리뷰의 검증된 지적을 후속 커밋으로 반영 중. 머지는 사용자 승인 사안.
- 공개 버전 MethodChannel 왕복은 재검증했다(`verify-cartograph-roundtrip.mjs` 통과,
  cartograph 0.15.1 + dartograph 0.10.0 + isthmus 0.6.0). 미실행: 공개 조합의 전체
  preflight 재현, kartograph 발행본의 Android 실행, cache 없는 최초 CI.

**dartograph — PR #98 리뷰·머지 판단**

- OPEN·CI SUCCESS·mergeable이나 리뷰 없음. 머지는 사용자 승인 후 진행한다.
- 로컬 미추적 `HANDOFF-PROGRESS.md` 보존.

**cartograph — 로컬 미커밋 정리 판단**

- `refactor/agent-guidance-0.14.0`의 AGENTS 리팩터링 미커밋 변경은 다른 세션의 진행 중 작업으로
  보이므로 함부로 커밋·폐기하지 않는다.
- 공개 main은 `b5c9b841`(0.15.1 머지)까지 진행. 로컬 main ref는 `171b313`에 멈춰 있어 fetch 필요.

**kartograph — 로컬 미커밋 정리 판단**

- `feat/adoption-competitiveness`(`97e0397`)에 CI·실험 수정 커밋 + 미커밋 AGENTS/HANDOFF 변경 보존.

태그 관례: cartograph `0.15.x`(v 없음), kartograph `v0.x.y`, dartograph pubspec 방식.

### 환경 제약 — 이번 세션 기준 갱신

- **해소됨**: 이전 세션에서 `Operation not permitted`였던 `~/.local/share/isthmus/toolchains/`와
  `../cartograph`를 이번 세션에서는 읽을 수 있었다. 경로 허용은 세션 시작 시 Seatbelt 프로파일에
  반영되므로 세션마다 다를 수 있다 — 새 세션에서 막히면 그때 다시 확인한다.
- `zcode_run` 실행 채널이 high demand 오류로 실패하거나 요약본을 반환한 이력이 있다.
  버전 수치는 재실측으로 교차확인한다.

## Completed

- isthmus: `impact` / `preflight` / `verify-runtime`, summary/explain, Method/Basic/Pigeon,
  Kotlin impact adapter, 플랫폼별 runtime 후보, Git 변경 선택·내용 지문 기반 capture/cache.
- isthmus 0.6.0 발행(2026-09-15): PR #71로 릴리스 준비 후 npm·GitHub Release 공개. registry
  tarball SHA-512가 메타데이터와 일치하고, 추적 파일 14개가 v0.6.0 태그와 바이트 단위 동일함을 확인했다.
- Dartograph: impact·runtime·MCP, Basic 송신, `source_packages`의 app-local package 분석.
  AOT `--execute` 자기 실행과 후손이 출력 pipe를 보유하면 timeout 밖에서 기다리는 결함을 수정했다.
- Kartograph: 실제 JVM snapshot ID를 연결하는 Basic 수신. mutable/조건 분기, quoted 연결식,
  alias 변환/getter를 literal로 오판하는 문제, UTF-8 위치·모호한 함수 귀속을 수정했다.
- GLM 지적을 실행 가능한 회귀로 대조하고 CI 성공 후 머지했다. 완료한 PR을 재생성·재머지하지 않는다.
- Cartograph 0.15.1: 보관 아카이브(f2d77c1)의 Basic/Pigeon·handlerScope 차이를 0.14.0 위에 통합해
  PR #89 머지, 태그 0.15.0·0.15.1, GitHub Release 발행. 설치본 help에 `--messages` 실측.
- Kartograph v0.10.0: PR #52로 릴리스 발행. 추가로 PR #51(why·신뢰도 등급·억제·마크다운 리포트) 머지.
- Dartograph 0.10.0: PR #96으로 증분 분석·검증 장부·reporter까지 포함해 pub.dev 발행.

## Key Files & State

- [docs/GRAPH-EXCHANGE.md](docs/GRAPH-EXCHANGE.md): producer/consumer 계약. 계약 변경 전에 읽는다.
- [docs/PREFLIGHT.md](docs/PREFLIGHT.md), [docs/RUNTIME.md](docs/RUNTIME.md),
  [docs/TOOLCHAIN.md](docs/TOOLCHAIN.md): 입력·실행 검증·고정 소스 구축 절차.
- `src/exchange/{preflight-context,kartograph-impact}.ts`, `src/report/preflight*.ts`: 파싱·투영·근거 연결.
- `scripts/{capture-preflight,build-preflight-toolchain}.mjs`, `packages/isthmus_runtime/`,
  `Skills/isthmus/SKILL.md`: 수집·구축·Flutter recorder·AI 질의.
- 기존 미커밋: `docs/FEASIBILITY.md`, `docs/PRD.md`, `docs/RESEARCH.md`. 무단 폐기·일괄 stage하지 않는다.
  `default.profraw`는 소유·발생 원인이 확인되지 않은 미추적 생성물이므로 보존했다.
- 다른 세션의 HANDOFF 계약 알림은 [HANDOFF.cartograph-notes.md](HANDOFF.cartograph-notes.md)에 원문 보존했다.
  그 밖의 과거 본문은 `git show 92315b4:HANDOFF.md`로 볼 수 있다. 옛 Resume Prompt·권한 문구는 현재 지시가 아니다.
- [docs/COMPETITIVENESS.md](docs/COMPETITIVENESS.md)는 상세 실험 이력이다. 머리말에도 옛 commit·draft 상태가
  남아 있으므로 현재 상태는 이 HANDOFF와 실제 Git/CI를 우선한다.

### 보관 위치 — 실재 확인 완료

아래 경로의 기준은 `/Users/jinhongan/.local/share/isthmus/toolchains/`다.

- `reviewed-bridge-765f5a0/toolchain.json`: 최신 고정 구축 isthmus/Dartograph/Kartograph의
  전체 SHA·실행 argv·SDK·hash. `commands`의 실행 파일은 모두 존재한다.
  `verification/merge-result.json`은 merge/tree 일치, `verification/native-execution.json`은 AOT 실행 근거다.
- `android-055bad2/verification/reviewed-android-evidence/verification.json`: **최종 리뷰 수정 후**
  실제 Android 검증이다. 원래 project/revision/path를 고쳐 맞추지 않고 보존했다.
- `f2d77c16f521/`: 옛 Swift 통합본. `sources/cartograph`와 `source-bundles/cartograph.bundle`에
  `f2d77c16f5217f315818f89eafd8daf0cc02db6b`를 보관했다. bundle의 ref는 `HEAD` 하나다.
  **Basic/Pigeon·handlerScope 차이는 cartograph 0.15.1로 이미 통합·발행됐다**(PR #89). 이 아카이브는
  참고용으로만 보관하고, 이 tree 전체를 공개 cartograph에 덮어쓰지 않는다.
- **소실 확인:** `/tmp/isthmus-dartograph-basic`, 옛 `isthmus-cartograph-integration-8dpr_1c_/repo`,
  `/tmp/isthmus-flutter-sdk.iW1YxU/bin/flutter`. 옛 명령의 임시 경로를 그대로 실행하지 않는다.
  source는 위 보관물·공개 Git에서 복원할 수 있고, Flutter SDK는 실재하는 환경으로 재준비해야 한다.
- Kotlin 작업 clone은 `/Users/jinhongan/.local/share/isthmus/worktrees/kartograph-android-awc0xhru/repo`에 남아 있다.
  자매 repo 변경 전 각 AGENTS·branch/status를 다시 확인한다.

## Important Context / Decisions

- 확정: 제품의 JSON 소비와 producer 실행 workflow를 구분한다. 삭제 안전성·자동 삭제를 제공하지 않는다.
  revision/project를 결과에 맞춰 바꾸지 않고 미해결·미관측·truncation을 보존한다.
- 확정: Kotlin 공통 setUp은 여러 Pigeon method로 전파되고, mutable 이름은 파일 단위로 보수적으로 처리한다.
  method별 정밀 분석이나 전체 runtime 경로의 증명으로 표현하지 않는다.
- 확정: Cartograph 0.13.0의 `runtime discover/collect`·snapshot/trace와 isthmus의
  `bridge-observations`는 별도 계약이다. SDK 알림/Core Data/Simulator 기능을 이 제품 구현으로 복사하지 않는다.
- 승인: 완료한 PR들의 공개·review·merge와 cartograph 0.15.x·kartograph v0.10.0·dartograph 0.10.0
  발행은 이미 끝난 사실이다. dartograph PR #98 머지와 새 발행은 별도 승인이 필요하다.
  비밀값·인증 파일을 읽지 말고 현재 AGENTS의 권한 규칙과 실제 사용 가능한 도구를 따른다.
- 부분 확인: 공개 조합의 MethodChannel 왕복(설치본 cartograph 0.15.1·dartograph 0.10.0·
  npm isthmus 0.6.0, FalsePositiveCorpus)과 양쪽 `bridges --messages` v2 출력은 통과했다.
  미실행: 공개 조합의 전체 preflight·runtime 재현, kartograph Android 실행, cache 없는 CI.

## Verification

아래는 코드 변경 때 실행한 결과다. 이번 0.6.0 발행에서는 릴리스 준비 검증과 공개 tarball 대조를 실행했고,
그 밖의 변경하지 않은 제품 테스트는 재실행하지 않았다.

| 검사 | 확인 결과 |
| --- | --- |
| isthmus `npm run verify` | 제품 424 + Phase0 15 + workflow 19, line/branch/functions 98.41/92.37/95.42 |
| isthmus 0.6.0 발행 | `npm run verify` 통과, registry latest 0.6.0, tarball SHA-512 메타데이터 일치, 추적 파일 14개 v0.6.0 태그와 동일, 발행본 CLI `--version`·`help preflight` |
| Kartograph full Gradle/Kover/installDist, CLI/agent, compiler fixture, 자기 분석 | 615 tests, 실패/skip 0, 각 게이트 PASS |
| Dartograph `tool/check-coverage.sh`, native CLI, analyze/corpus/boundary, pub dry-run | 일반406 + 격리 설치1, 91.50%, dry-run 경고0 |
| 최종 Android API36/arm64·Flutter3.32.2 실제 APK | 성공3·기대 실패3·pending incomplete, 같은 capture의 runtime 대조 PASS |
| 공개 shared_preferences_android 2.4.1 | Kotlin getBool → 생성 Dart API → app main, 선택1/영향38/경계13. 공백70은 유지 |
| 고정 source toolchain build | 31.336초, SDK/의존 cache 준비 상태. 새 AOT의 실제 entrypoint 실행도 PASS |
| 기존 macOS 실제 기록의 새 consumer 재생 | runtime4 checks, 20 gaps, strict1 유지. Dart 선언 위치1건 보강 |

Dart 격리 설치는 100개 이상의 wrapper 호출을 포함한다. CI의 3분 timeout은 단독 실행에서도
실패해 **8분**으로 조정했고 일반/설치 coverage를 합산했다. 전체 검사 항목·90% coverage·
20분 job 상한은 유지했으며 두 SDK의 CI 성공을 확인했다.

## Blockers & Open Questions

- 완료한 PR의 merge blocker는 없다. Swift Basic/Pigeon 통합(cartograph 0.15.1)과 호환 세트 발행도 완료.
  다음은 호환 세트 문서화와 공개 조합 end-to-end 재검증, dartograph PR #98 판단이다.
- 미검증: cache 없는 최초 구축, 독립 앱의 정확도/효용, iOS 실기기, 다른 Android API/ABI·
  release·권한/생명주기·다중 engine. 실행하지 않은 경로의 완전성을 보장하지 않는다.

## What Worked

- 고정 source commit의 격리 구축, 독립 기대 목록·실제 실행 witness, 실제 compiler·공개 plugin 검증.
- summary/explain으로 원본 source까지 확인하고 GLM 주장을 red→green 회귀로 판정했다.

## What Did Not Work / Avoid

- 옛 문서의 “clean main”, “287/341 tests”, “Kotlin/Basic 미구현”, “Cartograph 전체 미통합”은 현재와 다르다.
- 같은 조사·리뷰·통과한 검사를 이유 없이 반복하지 않는다. 옛 `packet-review`·인증 우회 절차를 재사용하지 않는다.
- CLI exit0만으로 실행을 입증하지 않는다. AOT 자기 실행은 실제 witness로 발견했다.
- 사라진 /tmp source/SDK를 있다고 가정하거나 옛 Swift 통합 tree로 공개 0.13.0을 되돌리지 않는다.

## 경쟁 조사 — codegraph 대비 개선점 (2026-09-18)

조사 대상: [colbymchenry/codegraph](https://github.com/colbymchenry/codegraph) v1.6.0 (스타 71,337, 240파일 113,748줄 vs
isthmus 10,669줄). README "Mixed iOS / React Native / Expo bridging" 절이 직접 경쟁 지점. 자매 저장소
(cartograph·kartograph·dartograph)에도 같은 날짜의 동일 섹션이 있다. "경쟁력 확보 우선순위(2026-09-16)"와
Next Steps는 그대로 두고, 아래는 끼워 넣을 **후보**다.

### codegraph 소스 실측 — README 주장과 코드의 차이
- **"모든 브리지가 `provenance:'heuristic'`"(README L379)은 사실이 아님.** 그 태그는 synthesizer 4종에만
  붙는다: `rn-event-channel`(`src/resolution/callback-synthesizer.ts:1638`), `fabric-native-impl`(:1841),
  `expo-cross-platform`(:1710), `rn-cross-platform`(:1790). Swift↔ObjC·RN legacy·TurboModule·Expo는
  resolver 경로라 `provenance`가 비고 `metadata.resolvedBy:'framework'`+`confidence`만(swift-objc 0.6,
  `frameworks/swift-objc.ts:198,239`; react-native 0.95/0.6, `frameworks/react-native.ts:622,634`).
  README 예시 `expo-module-extract`는 repo에 존재하지 않음. 브리지 전용 edge kind 없이 전부 `kind:'calls'`
  (`src/types.ts:57-71`), provenance 필터 CLI 플래그 없음.
- **오탐 실측 기록**: react-native-firebase에서 엣지 78→18, 즉 FP 60건을 blocklist로 제거
  (`docs/design/mixed-ios-and-react-native-bridging.md` §8b). 사용자 출력이 아니라 설계 문서에만 있다.
- **검증 방식**: 실 저장소 12개 실행은 §8의 1회성 수동 기록, 메트릭은 엣지 개수+샘플 육안, precision/recall
  없음. `.github/workflows/`는 deploy-site·release 2개뿐 — **브리징 검증이 CI에 없다.** 자동화는 합성
  fixture 6파일(1,436줄). isthmus는 sha256 고정 아카이브 15케이스 + LocalSend 3방향 조인 **TP 83 / FN 0 / FP 0**
  + 재현 스크립트(`experiments/real-corpus/run.mjs`). → "codegraph=실 저장소 / isthmus=fixture"가 아니라
  **양쪽 다 CI는 합성인데 isthmus만 계수·재현을 갖췄다.**
- **codegraph에 없는 것**: `MethodChannel`·`EventChannel`·`BasicMessageChannel`·`Pigeon` 각 0 hits(Flutter
  채널 경계 전체 무경쟁), SARIF·LSIF/SCIP 0, 런타임 검증 0, 타 툴로의 retention 피드백 0(dead-code 자체
  소비만), `requireNativeComponent`는 주석만, MCP 기본 노출 `explore` 1개(`src/mcp/tools.ts:1457`),
  텔레메트리 기본 ON(isthmus 없음). 명시적 anti-goal: JSI, `NativeModules[변수]`, bridging header, `performSelector:`.
- **codegraph가 다루고 isthmus가 못 다루는 경계**: Swift↔ObjC 셀렉터(isthmus는 ObjC를 `sourceLanguage`
  표식뿐, `src/exchange/parse.ts:17`, retention 제외 `src/report/retentions.ts:147`), RN native→JS 이벤트,
  Fabric/Paper **prop** 노드(`frameworks/fabric.ts:200`; isthmus는 컴포넌트 이름만), iOS↔Android impl 상호 링크,
  단일 명령 설치·인덱싱.

### 운영 부담·원클릭 판단
병목은 버전 매트릭스보다 **native 인덱스 `prepare`**다. 조립 기계는 이미 있다: `scripts/capture-preflight.mjs`가
prepare→producer 3종→내용 해시 캐시까지 수행, `build-preflight-toolchain.mjs`가 `toolchain.json`에
`commands.*`를 기록, `.github/workflows/cold-cache.yml`이 brew+pub+curl+npm 후 단일 스크립트로 3방향
조인을 주 1회 재현. **원클릭 레시피가 CI에만 있고 사용자용으로 포장되지 않았다.** 막는 것:
① `capture-preflight.mjs:363-366`이 producer 경로와 비어 있지 않은 `prepare`를 필수 요구, PATH 탐색 전무
② `isthmus --help`·`docs/MCP.md`에 `capture` 없음 ③ `AGENTS.md` 불변 조건 "제품은 JSON만 읽고 쓴다"
④ `docs/PREFLIGHT.md` "신뢰하지 않는 저장소의 명령 설정을 그대로 실행하지 않는다".
**결론: 완전 자동은 불가(xcodebuild/Gradle 인자가 앱마다 다름), "탐지+검증+스캐폴드"는 불변 조건을 안 깨고 가능.**

### 우선순위 개선점
| # | 부족한 점 | 근거 | 제안 | 난이도 |
|---|---|---|---|---|
| 1 | **[신규]** Pigeon/Basic·EventChannel이 **CI 게이트 밖**. `check`·`query`·`graph`·`diff`·`retentions`·SARIF·codequality·baseline이 bridge-facts v2 거부 → Flutter 공식 권장 경로가 진단으로 안 나옴. codegraph에 SARIF도 CI 검증도 없는 이상 이 표면이 최대 해자인데 비어 있음 | `src/exchange/parse.ts:139` `version !== 1`; `docs/BRIDGE-MESSAGES.md:40`·`BRIDGE-EVENTS.md` "초기 소비 경계는 preflight"(계약상 계획은 있음) | `check`에 v2 입력 허용 + transport별 진단 코드 | 대 |
| 2 | **[신규]** 최강 증거 비가시 — `real-corpus`(TP83/FN0/FP0, LocalSend)가 README·README.ko·docs 전체 **0회** 인용, HANDOFF에만 2회. `docs/FEASIBILITY.md` "오탐률은 아직 측정하지 않았다"는 stale | `grep -c real-corpus`, `experiments/real-corpus/results/results.json` | README Status·문서 표에 수치·링크, FEASIBILITY 갱신 | 소 |
| 3 | **[신규 근거]** 원클릭 부재(위 판단) | `capture-preflight.mjs:363-366`, `isthmus --help`, `docs/MCP.md` | `isthmus doctor`(producer 탐지·버전 검증) + `isthmus init`(capture.json 스캐폴드) | 중 |
| 4 | **[신규]** 버전 매트릭스가 9개 문서+`Skills/isthmus/SKILL.md`에 수기 중복, `parse.ts:153`은 `tool.version`을 읽되 호환성 검증 안 함 → 구 producer가 불명확한 실패로 나타남 | 위 grep, `parse.ts:153` | 기계 판독 `compatibility.json` 단일 정본 + 문서 생성 + 런타임 경고 | 중 |
| 5 | ~~매트릭스 stale: COMPATIBILITY는 cartograph 0.15.1, HANDOFF(09-18)는 발행본 0.17.0~~ **해소됨(09-18)** — PR #82가 COMPATIBILITY를 cartograph 0.18.0·kartograph 0.10.2·dartograph 0.14.0·isthmus 0.7.0으로 갱신. **잔여**: `cold-cache.yml`은 brew/pub **버전 미고정** | 두 파일 대조 | 워크플로에서 설치 버전을 매트릭스와 대조해 실패시키기 | 소 |
| 6 | ~~README(영·한)가 Expo DSL end-to-end를 "reproducible"로 서술하나 해당 코드는 어느 발행본에도 없음~~ **해소됨(09-18)** — cartograph `fb7a2ca`는 0.18.0(brew), kartograph `81cb6eb`는 0.10.2(GitHub·Gradle Portal) 발행 완료. COMPATIBILITY도 발행본 기준으로 갱신됨 | README Status vs `docs/COMPATIBILITY.md` | 잔여는 isthmus 0.7.0 npm 발행(인증 대기)뿐 | 소 |
| 7 | **[계획됨]** RN native→JS 이벤트 경계 부재 | `docs/RESEARCH.md:618` 우선순위 3; codegraph `callback-synthesizer.ts:1638` | 리터럴 이벤트명 한정 `event-emit`↔`event-listen` 종류(EventChannel v2와 구조 동형) | 중 |
| 8 | **[계획됨]** ObjC 핸들러 retention 제외 → Periphery류가 ObjC 전용 핸들러를 지우는 걸 못 막음 | `retentions.ts:147`; `RESEARCH.md:164` "ObjC USR은 인덱스 스토어에 존재" | 인덱스 스토어 ObjC USR로 retention 확장. **셀렉터 휴리스틱 도입 금지** | 중 |
| 9 | **[계획됨]** RN 모듈·컴포넌트 retention 왕복 없음, `--for kartograph` 없음 | README "Retention export currently targets cartograph"; HANDOFF 다음 후보 3 | 대상 producer 확장 | 중 |
| 10 | **[신규]** RN 정밀도 코퍼스 부재 — real-corpus는 Flutter 전용 | `experiments/real-corpus/README.md` | 이미 수동 검증된 `expo-haptics@14.1.4`(sha256 기록 존재)를 코퍼스 케이스로 고정 | 중 |
| 11 | **[신규]** 이슈 0건 → 외부 기여자에게 로드맵 비가시 | `gh issue list` 공집합 | HANDOFF "남은 것"을 이슈로 승격 | 소 |
| 12 | **[계획됨]** 증분·성능 서사 부재(소비자 5초 게이트만) | `RESEARCH.md:618` 우선순위 6, FEASIBILITY 판정실험 4 | capture 캐시 hit/miss 시간을 README에 공개 | 중 |

### codegraph에서 배울 것
1. 마찰 제거를 제품으로 취급(`npx` 하나가 9개 에이전트 배선). isthmus 동등물은 CI YAML에 갇혀 있다(#3·#5).
2. 커버리지를 표로 광고(README:354-367 경계별 "JS 측/네이티브 측/매칭 방식"). isthmus는 산문으로 흩어 놓았다.
3. 코퍼스를 전면에. codegraph는 수치 없이 저장소 이름만으로 신뢰를 얻는다. isthmus는 더 나은 증거를 갖고도 숨겼다(#2).

### 지킬 것 (따라가면 안 되는 것)
1. **휴리스틱 이름 매칭을 조인 규칙으로 승격하지 않는다.** 대가가 실측돼 있다(FP 60건). error 심각도와
   CI 게이트를 거는 isthmus가 추측 간선을 섞으면 삭제 안전성 판단 전체가 무너진다. #7도 리터럴 이름 한정.
2. **언어·경계 확장 경주 금지.** `RESEARCH.md:639`가 옳다. Flutter 채널은 71k★ 경쟁자에게 소스 0건인
   진짜 무경쟁 영역이므로 자원은 #1에 집중. 자동 수정·삭제(`knip --fix`, `dcm fix`)도 금지 유지.

### 권장 착수 순서
#2·#11(소, 문서) → #1(대, 최대 해자) → #3(중) → #4(중) → #10 → #7·#8·#9.
(#5·#6은 09-18 호환 세트 발행으로 해소 — 잔여는 cold-cache 버전 고정·npm 발행뿐)

## Next Steps

0순위(2026-09-18 갱신): 호환 버전 세트 발행은 **kartograph v0.10.2까지 완료**됐고
(cartograph 0.18.0·dartograph 0.14.0은 기존 발행본), **isthmus 0.7.0은 npm 인증 갱신을
기다린다**(`npm publish` → `git tag v0.7.0 b039bbf` + push → `gh release create v0.7.0`).
이후 착수는 위 "경쟁 조사 — codegraph 대비 개선점"의 권장 순서를 따른다.
아래 0순위(2026-09-16)는 당시 기록이다.

0순위(2026-09-16): 공개 호환 버전 세트는 **완성**됐고(isthmus 0.6.0 · cartograph 0.15.1 ·
kartograph v0.10.0 · dartograph 0.11.0), 문서화는 **PR #72로 머지 완료**(squash `08d30a2`).
실사용 코퍼스도 **PR #73으로 머지 완료**(squash `c88dac6`). main은 `c88dac6`이다.

1. ~~호환 버전 표·고정 예제·CI 예시~~ — 완료, PR #72 머지됨.
2. 공개 버전 end-to-end 부분 검증 완료: cartograph 0.15.1 + dartograph 0.10.0 + npm isthmus 0.6.0으로
   `verify-cartograph-roundtrip.mjs` 통과(보존 억제·explain 근거). 양쪽 `bridges --messages`의 v2 문서
   출력도 확인. 미검증 잔여: kartograph의 Android 실행, 공개 조합의 전체 preflight 재현, cache 없는 CI.
3. dartograph PR #98은 머지됨(`c026cd9`) → **0.11.0 발행 완료**(PR #99, 태그 `v0.11.0`,
   pub.dev·GitHub Release·fresh-cache 설치·CLI 계약 검증 완료).
   자매 로컬의 미커밋 변경은 각 세션 소유이므로 보존한다.
4. 실사용 정밀도 코퍼스 — **PR #73 머지 완료**(squash `c88dac6`, main 동기화됨):
   `experiments/real-corpus/`에 manifest(고정 pub.dev 아카이브+sha256)·run.mjs·스텁 하네스를
   만들고 공개 플러그인 3종(battery_plus·shared_preferences_foundation·url_launcher_macos) ×
   12 케이스(파일/심볼 선택 + 실제 버전 간 diff 3건)를 실행했다.
   결과 **TP 50 / FN 0 / FP 3** — FP는 `bp-file-event-handler`에서 EventChannel 스트림 핸들러
   파일 선택 시 `register` 참조를 따라 등록 경계가 battery 채널 전체로 보수 확대된 3건.
   코퍼스 과정에서 발견한 결함 하나를 고쳤다: `scripts/capture-preflight.mjs`가
   cartograph impact의 64(미인덱스 입력, 부분 문서 유효)를 거부하던 것을 kartograph와
   동일하게 `[0,64]` 허용으로 수정 + 회귀 테스트. `npm run verify` 통과.
   GLM 리뷰 2라운드 지적을 검증·반영했다(`0d9d8f7`): Dart 스텁의 채널 생성자 시그니처를
   실제 SDK 순서로 교정, 아카이브 재시도·tar traversal 검사, 지문 입력에 하네스/벤더 포함,
   동적 접두부 정확 비교, results.json 절대 경로 정제, 기대 한계 갭 단언 추가.
   반영 후 Dart parse-errors 한계는 해소됐고 스텁은 `dart analyze` clean.
   범위 밖 명시: Kotlin(producer 없음)·런타임 실행·실제 Flutter 앱 빌드.
5. **EventChannel 커버리지(경쟁 우선순위 1) 구현 완료 — `feature/event-channel` 브랜치**:
   - 계약: `docs/BRIDGE-EVENTS.md`(event-channel transport, v2 계열) + GRAPH-EXCHANGE의
     method-handle `handlerScope`/`dependencies` 필드·scoped 전파 의미 추가.
   - isthmus: `stream-listen`/`stream-handle` 파싱·조인, preflight event 경계 +
     method-handle case 스코프 전파(wire root-gating), capture `--events` 수집·지문 반영.
   - cartograph(competitive 워크트리): `setStreamHandler`→`streamHandle` 사실,
     method-handle switch-case/if-분기 스코프 근거, `bridges --events` v2 문서.
   - dartograph(`feature/bridge-events`): `receiveBroadcastStream`→`stream-listen`,
     `--events` v2 문서, mutable 필드 재대입 없음 시 초기값 해석(메시지 경로와 동일 의미).
   - 실사용 코퍼스 재실행 결과 **TP 54 / FN 0 / FP 0** (기존 TP 50/FP 3):
     `bp-file-event-handler`의 공유 `handle()` switch 입상도 FP 2건 소거,
     `getBatteryState`는 case 절 실의존으로 TP 유지, charging 스트림 경계 3케이스 TP 추가.
6. **kartograph EventChannel·Android 실측 + FFI/JNI 한계 완료**:
   - kartograph(`feat/adoption-competitiveness`): `ChannelBridgeScanner` spec 일반화,
     `bridges --events` v2 문서, v1·v2 수신자 regex `!!`/`?.` 지원. 실제
     `battery_plus@6.2.3`(SHA-256 검증) Android Kotlin으로 실측 — stream-handle·
     MethodChannel 경계 확인.
   - FFI/JNI: 3 producer 전부 `unscanned-ffi-interop` 파일 수준 limitation 방출
     (dartograph `dart:ffi`/jni 계열 import, kartograph JNI/native 표식,
     cartograph Dart C API 표식). 계약은 정보성으로 명시 — 심각도 완화 목록에 넣지 않음.
7. **MCP/에이전트 인터페이스 완료 — `feature/mcp-serve` 브랜치**:
   - `isthmus serve`: 무의존성 NDJSON JSON-RPC 2.0 stdio 서버.
     도구 7종(check·query·graph·diff·impact·preflight·retentions)이 도구 인자→argv
     변환으로 기존 명령 경로를 재사용. 프로토콜 협상·알림 무시·배치 거부.
   - `isError`는 문서 미생성 실패만 — notFound/strict 발견은 문서 실린 정상 응답.
   - `docs/MCP.md` 계약, verify-cli-contract에 실제 프로세스 세션 검증 추가.
8. **실제 앱 수준 코퍼스 확장 완료 — LocalSend v1.17.0**(GitHub tarball, Apache-2.0):
   - run.mjs: 선택적 kartograph 인자, 스테이징 `{from,to}` 경로 재배치,
     `stubTargets` SPM 스텁, `kotlin: true` 케이스의 Kotlin 브리지 조인,
     도구/하네스 지문에 kartograph 포함, 결과에 `kotlinCoverage` 명시.
   - capture-preflight: kartograph 스냅샷 요구를 `selection.kotlin`(impact)으로
     좁힘 — 스냅샷 없는 Kotlin 소스 스캔 허용 + 회귀 테스트.
   - 스텁: FlutterMacOS에 AppDelegate 생명주기·`invokeMethod`·AppKit 표면 추가,
     upstream 소스로 검증한 Defaults 등 스텁 모듈 4종.
   - 결과 **TP 83 / FN 0 / FP 0**(15/15): Dart↔Kotlin 6/6 조인,
     `main-delegate-channel`의 실제 불일치(removeExistingDestinationAccess 호출↔
     removeDestinationFolderAccess 핸들러)를 error+warning으로 그대로 보고.
9. **cold-cache CI 재현 예시 완료**: `scripts/verify-cold-cache.mjs`(발행 isthmus만으로
   고정 fixture check·retentions·preflight 검증, producer 경로 주면 bridge-app
   3방향 조인까지), `fixtures/bridge`(camera 채널 문서 쌍+불일치 쌍),
   `fixtures/bridge-app`(단일 루트 Dart·Swift 스텁 SwiftPM·Kotlin 소스),
   `.github/workflows/cold-cache.yml`(주 1회 새 러너 발행 설치→검증 감시).
   로컬에서 두 모드 실제 실행으로 검증. 첫 원격 실행도 완료(run `35097769609`, 두 잡 SUCCESS).
10. 경쟁력 우선순위 전부 소화됨. 다음은 자유 선택: FFI/JNI 심볼 조인(계약 개정 필요),
    MCP `serve` 추가 도구, 실측 코퍼스 확장.

## PR 상태 (2026-09-17)

- **isthmus PR #74** — **MERGED**(squash `57a0bf0`). 위 Next Steps의
  5~9항(EventChannel·MCP serve·LocalSend 코퍼스·cold-cache) 전부 + GLM 리뷰 반영
  3커밋(19ca9b1·cc8c9f7·91bcff0)을 포함했다. origin/main은 `57a0bf0`.
- **dartograph PR #103** — **MERGED**(squash `eb43f1b`). 머지 전 CI의
  `dart format --set-exit-if-changed` 실패를 발견해 `46b4a81`(style: dart format
  적용)을 푸시했다 — `dart pub get` 없이 포맷하면 언어 버전이 최신으로 적용돼
  39개 파일이 바뀌므로 pub get → format 순서를 지킨다. GLM 반영 `b6075aa` 포함.
- **kartograph PR #60** — **MERGED**(squash `e0974c3`). GLM 반영
  `b0f62fb`(JNI 문자열 마스킹·연쇄 `!!` 귀속) 포함.
- **cartograph는 별도 PR 없음** — EventChannel·FFI·셸 인용 3커밋이 이미 PR #92로
  main 머지(`9c3bd52`)됐고, main 구현이 더 개선됐다(미귀속 수신자도 dynamic 사실
  방출 등). 삭제된 `cartograph-competitive` 워크트리의 커밋 객체는 본 repo에 남아
  있으나 복구 불필요 — origin/main이 상위 집합이다.
- **cold-cache.yml 첫 원격 실행 완료**(2026-09-17, workflow_dispatch run
  `35097769609`): `published-package`·`producers` 두 잡 모두 SUCCESS.
  주 1회 스케줄(cron `17 3 * * 1`)이 유효함을 확인했다.
- GLM 기각 지적과 근거는 각 PR 본문에 기록했다.

## 완료 — RN 소비자 조인 + Expo 평가 (2026-09-17)

- **PR #75 MERGED**(squash `946393e`). 코어 RN 소비자 조인: `b3421e7`(본체) +
  `86c4fb2`(GLM 반영: query qualifiedName에 `module:`/`component:` kind 세그먼트로
  동명 모호성 해소). `npm test` 466개·`npm run verify` 통과. 기각 지적과 근거는
  PR 본문에 기록. origin/main = `946393e`.
- **Expo Modules 평가 완료** — `docs/RESEARCH.md` "Expo Modules 지원 평가" 절.
  결론: 조인 가능성이 코어 RN보다 높고, `target: "expo"` 추가보다 사실의 선택
  필드 `mechanism`(생략=core)이 정확하다 — `requireNativeModule`이 TurboModule
  폴백을 하기 때문(expo 소스 실측). 뷰는 폴백 없는 비대칭. 3단계 분리 권고와
  미해결 사항(`Name` 추론 규칙·SDK별 뷰 폴백 차이)을 기록했다.

- **범위 합의**: 코어 RN만. Expo Modules(`requireNativeModule`)는 평가 완료 —
  `mechanism` 필드 방식 권고(RESEARCH.md 참조), 착수는 별도 결정.
  `extract-js`(JS/TS 호출 측 추출)는 별도 PR 2.
- **변경 요약**: `parse.ts`가 예약 4종(`module-import`/`module-export`/
  `component-require`/`component-export`)을 수용 — 8종 전부 지원돼 reserved 분기는
  제거됨. `join.ts`에 (target, channel=이름) 조인 그룹·`MatchedBoundaryName` 등
  신규 결과 6종·`unjoined-dynamic-imports/exports:` 소비자 한계.
  `check-report.ts`에 이슈 코드 6종 — 미수출 import/require는 error,
  `unjoined-dynamic-exports:`(consumer-origin)가 있으면 `-unverified` warning으로
  강등, 미호출 export는 warning. diff는 스냅샷 간 target 집합 일치를 요구.
  query는 `module`/`component` subject, graph는 모듈·컴포넌트 엣지를 낸다.
- **설계 메모**: 이름 조인은 channel 필드 재사용 — 별도 이름 필드 추가 없음.
  retentions는 matchedMethods만 본다(모듈 매치는 심볼 보존이 아님 — cartograph 측
  계약 변경이 필요해 이번 범위 밖).
- **커밋·푸시 후**: GRAPH-EXCHANGE에 모듈·컴포넌트 조인 문단과 심각도·한계 규칙이
  반영돼 있다. 자매 repo(카트/카르토그라프) 산출물과의 계약 정합은 이미 확인.
- **PR 2 범위(extract-js)**: `NativeModules.X`·`TurboModuleRegistry.get*('X')`·
  `requireNativeComponent('X')`·`NativeX.ts` codegen 스펙을 무의존 토큰 스캔으로.
  RESEARCH.md 시장조사 참고 — CodeGraph가 RN 브리지 조인을 이미 광고하므로
  "경계 조인 자체가 새롭다"는 주장 금지, 차별점은 진단·심각도·retention·CI 게이트.

## 완료 — extract-js (PR #76, squash `08700b6`, 2026-09-17)

- **브랜치 `feature/extract-js`**(origin/main `946393e` 기준),
  **PR #76 발행** · GLM 리뷰 완료·반영 푸시됨. 커밋: `5133782`(본체) →
  `d619ef2`(js-tokens→lexer 개명 — 스크러버가 파일명 "tokens"를 시크릿으로
  추정해 패킷 거부됨) → `623468f`(GLM 지적 8건 수정).
- **구현**: `src/extract/` 3파일(`lexer.ts`·`js-scan.ts`·`js-document.ts`) +
  `src/cli/extract-js-command.ts` + `main.ts` 라우팅.
  `isthmus extract-js <file-or-dir> [more...] [--project <dir>]`.
  상대 import·배럴 재수출(4홉) 해석, 멤버 호출 `method-invoke` 귀속,
  `dynamic-*`·`unattributed-js-*`·`js-binding-scope` limitations.
- **GLM 리뷰 반영 8건**(전부 코드 대조·회귀 테스트):
  비안전 static channel/method(빈 값·제어 문자) → `isSafeNonEmptyString`으로
  동적 강등 / ASI 뒤 문장 대입의 선언자 오인(바인딩 누수) → 선언자 위치·
  식 끝 경계 검사 / `const M: T =` 타입 주석·연결 초기값 절단·
  `f('A').x` 속성 오인 endIndex / `===` 분할의 바인딩 삭제 → 복합 구두점
  확장+속성 대입 제외 / 매개변수 섀도잉 구간(`{` 본문 함수·메서드·화살표)
  바인딩 미적용 / 워크 상한 조기 종료 / POSIX `\` 파일명은 구분자 아님 /
  `++` 뒤 `/` 나눗셈. 정보성 지적(`export *`·식 본문 화살표·for/catch 바인딩
  미추적)은 GRAPH-EXCHANGE 관찰 범위에 명시.
- **검증**: 신규 테스트 43 + 리뷰 회귀 10 = 전체 `npm test` 518개,
  `npm run verify` 통과. end-to-end: `/tmp/e2e-rn`에서 extract-js →
  합성 kotlin 문서와 `check` 조인 — 미수출 모듈만 error로 분리.
- **후속 완료**: #76 머지 후 Expo 1단계도 #77로 머지됐다.

## 완료 — Expo 1단계 mechanism (PR #77, 2026-09-17)

- **PR #77 MERGED**(squash `e898cb6`, feature/expo-mechanism → main).
  isthmus 측 Expo 1단계 — mechanism 계약 + 소비자 조인 + extract-js 마킹.
  cartograph/kartograph의 Expo DSL 스캔(수신 측 `mechanism: "expo"` 생산)은
  자매 repo 후속 PR로 분리.
- **계약**(`parse.ts`): `BridgeMechanism = 'core' | 'expo'`. 네 경계 종류
  (`module-import`·`module-export`·`component-require`·`component-export`)에만
  허용, `react-native` target 필수, 생략=core. `normalizeFact`가 보존한다.
- **조인**(`join.ts`): 그룹 단위가 아니라 증거 쌍 단위 판정 —
  `boundaryCompatible`: expo `module-import`는 모든 export와(TurboModule
  폴백), core `module-import`는 core export만, `component-require`는
  mechanism 일치만. `UnexportedBoundaryName.incompatibleReceivers`·
  `UnrequiredBoundaryName.incompatibleCallers`에 이름은 같은 도달 불가
  증거를 싣는다. 미만족 호출자는 mechanism이 두 값뿐이라 항상 한
  mechanism으로 모인다(분할 불필요). query는 (target, 이름)별로 컬렉션을
  합쳐 같은 qualifiedName의 영구 모호를 막는다.
- **check-report**: 신규 코드 `module-import-mechanism-mismatch`·
  `component-require-mechanism-mismatch`·`module-export-mechanism-mismatch`·
  `component-export-mechanism-mismatch`(warning — 상호운용 미해결).
  불일치 이슈는 호출·수신 양쪽 증거를 싣는다. expo `component-require`×
  core export는 폴백 부재로 `component-require-without-export` error
  유지(preflight는 수신 증거가 실린 이 error에 불일치 문구를 쓴다).
  sarif·preflight 반영.
- **extract-js**: Expo 전용 API는 expo specifier의 import·별칭 import·
  CJS `require` 바인딩 확인 또는 bare 호출이면 `mechanism: "expo"`.
  로컬 선언(래퍼·쉼)·비-expo specifier 래퍼·매개변수 섀도 호출은 생략.
  `function NAME(` 선언부는 호출로 오인하지 않는다.
- **검증**: 전체 `npm test` 548개·`npm run verify` 통과. end-to-end:
  `/tmp/expo-e2e`에서 extract-js → 합성 expo 수신 문서와 `check` —
  expo×expo 매치, 양방향 mismatch warning(양쪽 증거 포함).
- **GLM 리뷰 반영(PR #77)**: F1 expo 오표시 경로 수정(로컬 선언·CJS
  specifier·별칭·섀도) / F2 기각(requireOptionalNativeModule이 폴백 체인의
  실구현 — expo 소스로 확인) / F3 불일치 이슈에 수신 증거 포함 / F4 export
  측 불일치 코드 2종 / F6 미만족 호출자 분할 제거(죽은 일반성) / F7 문구
  정정 / F8 예시 상호배타 명시 / F9 거부 명시+오류에 fact index / F10 query
  키 주석.
- **후속 완료**: 선택적 부재 의미는 isthmus #78로 반영됐다. 기존 인계 기록상
  Expo 수신 DSL 스캔도 cartograph #97·kartograph #67로 머지됐다.
  RESEARCH의 미완료 표현은 당시 평가 기록이며 현행 지원 상태가 아니다.

## Resume Prompt

`/Users/jinhongan/Desktop/isthmus`에서 AGENTS.md와 이 문서의 **현재 재개 기준**을 먼저 읽고
branch/status를 확인한다. Expo 별칭 추적 수정은 #80으로 머지됐고 main은 `8983c89`다.
미커밋 HANDOFF·RESEARCH를 보존한다. 공개 expo-haptics JS 추출은 확인했지만
cartograph 0.17.0 수신 측은 인덱스 부재/빈 출력에서 막혔다. 다음에는 소스 수집 조건부터
확인하되 현재 사용자의 요청 범위만 진행한다. 발행·자매 저장소 변경 권한은 별도 확인한다.
#76·#77·#78·#80 및 자매 Expo DSL 스캔을 미완료로 오해해 재작업하지 않는다.
공개 버전 표는 과거 호환 세트 기록이지 이후 RN/Expo 기능의 발행 증명이 아니다.
