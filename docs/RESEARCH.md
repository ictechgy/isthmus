# isthmus 리서치 노트

2026-09-04 기준, 2026-09-08 보강. **확인됨** 은 1차 출처를 직접 읽었거나 코드로 재현한 것, **확인 필요** 는 GLM 또는 기억에서 나온 주장이다. 취소선 항목은 이후 1차 출처로 확인돼 본문에 기록한 것이다.

## 확인됨

### 이 문제를 다루는 도구가 없다

- JS/TS: `knip`, `dependency-cruiser`, `madge` 는 JS 세계 안의 그래프다. 네이티브 모듈 이름 문자열을 따라가지 않는다
- Dart: `package:analyzer`, DCM 은 Dart 안이다
- Swift: cartograph 는 인덱스 스토어를 읽고, 인덱스는 문자열 리터럴을 심볼로 기록하지 않는다 — **cartograph 를 만들면서 직접 확인한 사실.** `@objc` 셀렉터, IB 연결이 같은 이유로 보존 규칙이 되었다
- GLM 도 "이를 다루는 주류 도구는 현재 없다(확신 중간)" 고 했다. 두 출처가 일치하나, "없다" 는 증명이 어려우므로 Phase 0 에서 한 번 더 검색한다

### cartograph 가 이미 가진 것 (재사용 가능)

- `CartographSyntax` 모듈: SwiftSyntax 로 소스를 걷는 인프라(`SwiftSyntaxAnalyzer`, `InterfaceBuilderScanner`, `SourceFactsCache`). `BridgeFactScanner` 는 여기 들어간다
- `RetentionReason` 열거형 + `dead --explain` 문장 생성. `.externalBridge` 케이스 추가는 작은 변경
- `GraphDocument` 의 정렬 키 · diff 가능 출력 관례 — 교환 형식이 같은 관례를 따른다
- `query` 의 `limitations` 구조 — isthmus 의 동적 이름 카운트가 같은 자리에 들어간다

### RN 프로젝트 범위

- Expo managed 워크플로처럼 `ios/`와 네이티브 브리지 소스가 없는 앱은 직접 분석 대상이
  아니다. `expo prebuild` 뒤에도 실제 브리지 코드는 주로 Expo 모듈 의존성에 있다

## 확인 필요

- ~~**Flutter 플러그인의 iOS 구현 언어**~~ — **확인됨(2026-09-08)**: cartograph 실측 문서
  (`docs/scans/2026-09-flutter-plugins.md`) 기준 battery_plus·connectivity_plus·device_info_plus·
  network_info_plus·sensors_plus·mobile_scanner·flutter_secure_storage·audioplayers·
  flutter_local_notifications(macOS)는 Swift, package_info_plus·share_plus·permission-handler·
  geolocator·just_audio·sqflite는 ObjC 구현이라 cartograph가 사실을 내지 못한다
- **Pigeon 산출물의 형태** — 채널 이름이 생성 코드의 상수로 들어가고, Dart · Swift 양쪽 생성 파일이 같은 문자열을 가진다고 기억. 그러면 Pigeon 을 쓰는 코드로 리터럴 조인이 된다(단 생성 파일을 분석에 포함해야)
- **RN Turbo Modules codegen** — `NativeX.ts` 스펙 파일에서 네이티브 인터페이스를 생성. 모듈 이름은 `TurboModuleRegistry.getEnforcing<Spec>('X')` 의 문자열. 구식 브리지(`NativeModules.X`)와 공존
- ~~**RN 네이티브 쪽 이름 등록**~~ — **확인됨(2026-09-08)**: RN iOS 모듈은 `.m`의
  `RCT_EXPORT_*` 매크로에 있고(react-native-device-info 28건·react-native-webview 2건 실측),
  cartograph는 `ReactNativeMacroScanner`로 `.m`을 텍스트 스캔해 사실로 낸다. USR이 없어
  retention 왕복은 불가(`objective-c-handlers:` limitation)
- **`react-native-webview`** — 네이티브 코드가 있는 RN 라이브러리로 존재 확실. iOS 구현 언어 미확인
- **Capacitor 플러그인 메커니즘** — `@objc func method(_ call: CAPPluginCall)` + `CAP_PLUGIN` 매크로로 기억. v0.3 이후

## 설계에 영향을 주는 사실

- **조인은 근사다.** 보간 문자열, 상수를 거친 이름, 변수로 전달된 채널은 못 본다. 상수를 거친 경우(`const kChannel = '…'; MethodChannel(kChannel)`)는 흔하므로 **한 단계 상수 추적**은 v0.1 에 넣는다. Dart 의 `const` 와 Swift 의 `static let` 은 analyzer/SwiftSyntax 로 해결 가능
- **같은 채널을 두 플랫폼이 각각 등록하는 것이 정상.** "Swift 에 없다" 는 iOS 타깃이 있을 때만 오류. 교환 형식의 `platform` 필드가 이것을 위한 것
- **신선도.** 세 도구의 JSON 이 서로 다른 시각에 만들어진다. `generatedAt` 을 비교해 하루 이상 차이 나면 `limitations` 에 알린다. cartograph 의 `index-staleness` 와 같은 이유

## 완화 범위 축소 제안 (2026-09-08)

isthmus 0.1.7(#18)로 완화 단위는 진단의 target이 됐다. 남은 과완화 — 같은 target 안에서
무관한 공백이 모든 진단을 `-unverified`로 낮추는 문제 — 를 줄이는 두 방향의 제안이다.
**원래 제안 기록**이며, 이후 구조화 v1 확장의 정본은 GRAPH-EXCHANGE의 선택적 limitation 스코프 절이다. 근거는 cartograph 0.8.2 소스와 그 실측 문서
`docs/scans/2026-09-flutter-plugins.md`(2026-09-05~07)다.

### 확인된 사실

- 과완화의 실측 사례: flutter_local_notifications는 macOS Swift 핸들러 14개가 전부 매치되고
  이슈 20개가 남았는데, 그들의 손 분류는 15개 Android 전용 메서드 · 1개 iOS `.m` 안
  (getCallbackHandle) · 3개 example/ 비대칭이다. `.m`이 실제로 가리는 것은 1건뿐이지만
  숫자의 합은 19라 한 건의 분류가 보존된 원문에 없다. 20건 전체가 실제 완화 대상이었다고
  단정할 수 없으며, 채널 스코프의 효과는 진단별 결과로 재검증해야 한다.
- cartograph는 이미 `.m`을 텍스트로 스캔한다(`ReactNativeMacroScanner`: 주석·문자열을
  상태 기계로 blanking하고 고정 형태 매크로를 추출). RN 경로에서는 ObjC 핸들러 사실이
  생산된다(`objective-c-handlers:`, USR 없음). Flutter 경로의 `.m`은 RN 매크로만 읽는다
  (`objective-c-sources:`).
- ObjC 구현이라 사실이 아예 없는 인기 플러그인이 6개다: package_info_plus·share_plus·
  permission-handler·geolocator·just_audio·sqflite.

### 방향 A — cartograph가 ObjC Flutter 핸들러를 사실로 스캔

이미 RN 매크로에 쓰는 `.m` 텍스트 스캐닝을 Flutter 형태(`initWithName:` 채널 리터럴,
`setMethodCallHandler` 블록, `isEqualToString:@"…"` 분기)로 확장한다.

- 효과: 6개 플러그인이 관측 가능해지고, package_info_plus 류의 `-unverified`가 실제
  판정(매치 또는 진짜 error)으로 바뀐다. `objective-c-sources:`의 잔여 범위가 줄어
  방향 B의 스코프도 정확해진다.
- 선행 조건: **isthmus Blockers 2(ObjC 핸들러 retention)와 함께 정해야 한다.** symbol 전체가 없는
  ObjC 사실이 조인에서 매치되면 `retentions --for cartograph`가
  `rejectUnresolvedSwiftHandlers`로 종료 코드 2가 된다(오늘은 사실이 없어 통과). 또한
  ObjC 선언은 cartograph 그래프에 없으므로 이름 기반 retention을 보내도 지킬 대상이
  그래프에 없는 것일 수 있다 — "그래프에 안 보임"과 "삭제 위험"이 ObjC에서 따로
  성립하는지 cartograph 확인이 필요하다.

### 방향 B — 공백 limitation의 채널 스코프 접미사 (계약 추가)

limitation 문자열 끝에 선택적 기계 가독 접미사를 둔다. 접두사는 바꾸지 않는다.

```text
objective-c-sources: 4 file(s) … [channels: plugins.flutter.io/flutter_local_notifications]
shadowed-flutter-method-channel: 1 … [channels: dev.isthmus/camera]
```

- 호환성: 옛 소비자는 접두사 일치가 그대로 성립해 현행대로 target 전체를 완화한다.
  새 소비자(isthmus)는 접미사의 채널에 걸리는 진단만 완화한다. 접미사가 없으면
  target 전체(현행 유지). 버전 1 문자열 문법 안에서 전후방 호환이다.
- 파일 스코프(`[files: …]`)는 진단에 대응시킬 수 없다(읽지 못한 파일이 어떤 채널을
  가리는지 알 수 없으므로) — 사람·에이전트 증거로만 싣는 옵션.
- 채널 이름에는 계약의 safe-string 규칙(제어 문자 금지)이 이미 적용되지만 `]`·구분자
  이스케이프 문법은 새로 정해야 한다.

### isthmus 쪽 구현 약속 (합의 후)

- B: 접미사 파서 + `receiverCoverageGaps`의 채널 단위 완화(target 단위는 유지).
  스코프된 공백이 다른 채널 진단을 낮추지 않는 회귀 테스트 포함.
- A: isthmus 변경 없음. 단 ObjC 사실이 들어오면 retentions 정책(Blockers 2)을 같이 정한다.

### 합의 질문 (cartograph · kartograph · dartograph)

1. A(ObjC Flutter 핸들러 사실 생산)를 할 의향이 있는가? 한다면 Blockers 2와 순서는?
2. B의 접미사 문법을 수용하는가? 스코프 단위는 채널인가 파일도 함께인가?
   kartograph의 수신 측 공백 중 채널 스코프가 가능한 것이 있는가?
3. dartograph의 호출 측 공백(`unresolved-receiver-invocations:` 등)은 스코프가 필요한가?
   isthmus는 호출 측 한계로 심각도를 바꾸지 않으므로 증거 보존만으로 충분할 수 있다.
4. B를 v1 문자열 접미사가 아니라 bridge-facts v2의 구조화 limitation(독립 필드)으로
   할 것인가? v2는 깔끔하지만 네 저장소 동시 버전 인상과 이행 기간 비용이 있다.

## 다른 오픈소스에서 흡수할 장점 (2026-09-08)

열린 Blockers와 완화 범위 제안(cartograph#64)에 대한 흡수 후보다. 전부 1차 출처를
직접 확인했다. GitHub 검색 재확인 결과 "flutter platform channel" 관련 저장소는 전부
예제 앱이고 크로스 언어 브리지 조인 도구는 여전히 없다(2026-09-04 판단 재확인).

### Blockers 4 (check 베이스라인) — ESLint bulk suppressions와 detekt baseline

- ESLint(`eslint/eslint` `docs/src/use/command-line-interface.md`): `--suppress-all`·
  `--suppress-rule`이 현재 위반을 `eslint-suppressions.json`에 저장해 이후 실행에서는
  새 위반만 보고한다. `--prune-suppressions`로 해결된 억제를 정리하고,
  `--pass-on-unpruned-suppressions`로 오래된 억제의 통과 여부를 선택한다.
  카운트 기반·자기 정리·기본 엄격이 한 세트로 있다.
- detekt(`detekt/detekt` `website/docs/introduction/baseline.mdx`): `baseline.xml`이
  `CurrentIssues`(자동 베이스라인 — 이후 새 항목만 출력)와 `ManuallySuppressedIssues`
  (오탐 기록)를 분리한다. 항목 ID는 `RuleID:Finding_Signature` 서명이다.
- isthmus 흡수면: `src/report/diff.ts`의 `issueKey`(code+target+channel+method)가 이미
  안정 서명이라 베이스라인 ID로 재사용된다. 설계 후보는 `check --baseline <file>` +
  베이스라인 갱신 플래그, 해결 항목 자동 prune, "베이스라인 등록"과 "오탐 억제" 분리.
  isthmus 소유 출력이라 계약 변경이 없다.

### Blockers 2 (ObjC retention) — ObjC USR은 인덱스 스토어에 존재한다

- `swiftlang/indexstore-db` README: "Raw index data can be produced by compilers such as
  **Apple Clang** and Swift using the `-index-store-path` option." xcodebuild 인덱스
  스토어에는 ObjC 심볼의 clang 인덱스 유닛(USR 포함)이 들어간다.
- cartograph의 `objective-c-handlers: … carry no USR`는 `.m`을 인덱스 없이 텍스트로
  스캔하는 현재 파이프라인의 한계지 생태계 한계가 아니다. 방향 A(ObjC Flutter 핸들러
  사실화)에 clang 인덱스 유닛을 결합하면 USR 있는 retention 왕복이 가능할 수 있다 —
  cartograph#64의 순서 의존 논의에 이 사실을 보탠다. 인덱스 없이 빌드된 환경의
  fallback 신원으로는 SCIP 문법이 후보다.
- SCIP(`sourcegraph/scip` `scip.proto`): `<symbol> ::= <scheme> ' ' <package> ' '
  (<descriptor>)+ | 'local ' <local-id>`. 공백은 이중 공백으로 이스케이프하고,
  식별자 문자(`_-+$`·영숫자) 밖의 이름은 백틱으로 감싼다(내부 백틱은 이중 백틱).
  크로스 언어 안정 심볼 문법의 확립된 선행例다.

### 완화 범위 제안(cartograph#64) 보강

- 접미사 이스케이프 선행: SCIP 백틱 방식과 isthmus query의 기존 퍼센트 표기
  (`src/report/query.ts`의 `encodeSubjectComponent`: %→%25, #→%23)가 있다.
  `[channels: …]` 값 문법은 isthmus가 이미 발행하는 퍼센트 표기를 재사용하는 쪽이
  내부 일관성에 좋다.
- 방향 A의 파싱 옵션: `tree-sitter-grammars/tree-sitter-objc`(존재 확인)나
  `ast-grep/ast-grep` 류 구조 파싱, 또는 cartograph 기존 상태 기계 텍스트 스캔 확장
  (주석·문자열 처리 완비). 고정 형태 매크로는 텍스트 스캔으로 정확하지만 Flutter ObjC
  핸들러 형태(블록 인자, `isEqualToString:` 분기)는 구조 파싱이 견고하다.
- `kythe/kythe`: 플러그형 크로스 언어 사실 교환 생태계 — bridge-facts의 건축 선행.
  v2의 구조화 limitation·심볼 설계 참고(방향 B 질문 4).
- clang USR 근거와 퍼센트 표기 재사용 제안은 cartograph#64 코멘트로 전달했다
  (2026-09-08, 사용자 등록 — 세션 토큰은 자매 저장소 쓰기 403).

### CI 통합 — SARIF 리포터

- `oasis-tcs/sarif-spec`. cartograph는 이미 dead/cycles/rules를 SARIF·github-actions
  형식으로 내보낸다(그쪽 HANDOFF #35 기록). isthmus `check`에 SARIF 리포터를 추가하면
  GitHub code scanning·PR annotation으로 결과가 흐른다. additive이고 isthmus 소유라
  JSON 계약과 독립이다.

### Blockers 3 (project 정규화) — realpath 선행

- cartograph 자신이 심볼 매칭 내부에서 `resolvingSymlinksInPath` +
  `standardizedFileURL`을 쓴다(`BridgeFacts.swift`의 `canonical()`). POSIX realpath과
  각 언어 stdlib(Node `fs.realpathSync`, Python `os.path.realpath`)이 같은 표준이다.
  합의 방향은 "생산자가 realpath로 정규화한 `project`를 낸다"며, 가족 내 선행이 있다.

### 흡수하지 않기로 한 것

- knip `--fix`(미사용 파일 자동 삭제): isthmus 제품 규칙(자동 수정·자동 삭제 없음)의
  정반대다.
- Periphery의 assign-only 검출: cartograph 그래프 쪽 주제(그쪽 감사에 G202로 기록됨),
  isthmus의 것이 아니다.
- cargo-machete·depcheck 등 의존성 공간 도구: 브리지 조인 범위 밖.

## 2차 흡수 조사 (2026-09-08, 0.2.0 이후)

1차 조사(위 섹션)의 일부는 0.2.0에 흡수됐다: Clang USR 근거(indexstore-db)가
`sourceLanguage: objective-c` + 실제 `c:` USR 보존으로 구현됐다. 이 섹션은 남은 과제와
새 흡수 후보를 기록한다. 출처는 전부 2026-09-08에 원문(raw/API)으로 직접 확인했다.

### Blockers 4 (check 베이스라인) — 만료 기한과 두 종류의 베이스라인

- Trivy(`aquasecurity/trivy` `docs/guide/configuration/filtering.md`): `.trivyignore`
  항목에 `CVE-… exp:2023-01-01` 형태로 **만료일**을 붙인다. 베이스라인 항목이 영구적이
  않아야 한다는 위생 규칙의 선행이다.
- Semgrep(`semgrep/semgrep` `cli/src/semgrep/commands/scan.py`): `--baseline-commit`이
  baseline 이후 findings만 보고한다. isthmus에는 스냅샷 비교 `diff --before/--after`가
  이미 있으므로, PRD의 "베이스라인"은 git-diff 방식보다 **지속 suppressions 파일**에
  가깝다.
- 1차 조사의 ESLint bulk suppressions(카운트 기반·자동 prune·기본 엄격)과 detekt
  baseline(자동 베이스라인/오탐 기록 분리, 서명 ID)을 합친 설계 방향: `issueKey`
  (code+target+channel+method, `src/report/diff.ts`에 이미 존재) 기반 suppressions
  파일, 해결 항목 자동 prune, 수동 오탐의 별도 구분, 선택적 만료일. isthmus 소유
  출력이라 계약 변경이 없다.

### Blockers 3 (모노레포 project root) — Pub Workspaces가 언어 네이티브 표준

- Melos(`invertase/melos`, Apache-2.0, `docs/getting-started.mdx`): 워크스페이스는 루트
  `pubspec.yaml`이 있는 디렉터리이며, 현재 **Dart Pub Workspaces**(Dart 언어 네이티브
  모노레포 표준) 위에 있다. Blockers 3의 분쟁 대상인 plus_plugins가 바로 pub
  workspace다.
- 합의 방향: 생산자가 `project`를 **pub workspace 루트**로 해석해 realpath 정규화
  문자열로 낸다. 그러면 Blockers 3의 두 절반(`/tmp` 별칭, `*_platform_interface`와
  plugin의 root 불일치)이 같은 기준으로 해결된다. cartograph 내부의 `canonical()`
  (`resolvingSymlinksInPath`)이 가족 내 선행이다.

### 미래 `extract-js` — 파서 엔진과 의존 예산

- 계약은 isthmus 내장 `extract-js`를 예약해 두었다(RN `NativeModules.*`,
  `TurboModuleRegistry.get`, `requireNativeComponent`). 후보 엔진: oxc
  (`oxc-project/oxc`, MIT), tree-sitter-typescript(MIT), 플러그인 구성의 선행은
  knip(`webpro-nl/knip`, ISC, `packages/knip/src/plugins` 186개).
- 긴장점: isthmus는 현재 **런타임 의존 0**(package.json에 dependencies가 없다).
  네이티브/WASM 파서 바인딩은 첫 런타임 의존이라 package 계약(설치 면적·크기)
  결정이 먼저다.
- 반대 가설: RN 세 형태는 고정 형태 문자열이라 파서 없이 텍스트/토큰 스캔으로
  가능하다(cartograph `ReactNativeMacroScanner`가 주석·문자열 상태 기계로 증명한
  방식). 고정 형태를 넘는 문법이 필요해지는 시점에 실측으로 결정한다.

### CodeQL — 개념은 흡수, 엔진은 비흡수

- `github/codeql` 저장소는 MIT(쿼리·라이브러리)지만 CodeQL CLI는 GitHub 별도
 라이선스다. 프레임워크 브리지를 데이터로 모델링하는 사상(model packs 개념)은
  bridge-facts의 선행 사례지만, 컴파일러급 데이터플로 엔진은 JSON 파일만 읽는 CLI의
  범위 밖이다. 검토·비흡수로 기록한다.

### 생태계 재확인

- 새 검색어(flutter unused native code, platform channel dead code)로도 브리지 조인
  도구는 나오지 않는다(2026-09-08). 2026-09-04 판단의 재확인.

## 출처

- cartograph `CHANGELOG.md` 0.1.0 ~ 0.4.0 — `@objc` · IB · 셀렉터가 보존 규칙이 된 경위
- knip 관련 도구 목록 — https://knip.dev/reference/related-tooling
- GLM 리서치 응답(2026-09-04) — "브리지 교차 그래프는 미개척" 판단. 1차 출처 아님
- cartograph `docs/scans/2026-09-flutter-plugins.md`(2026-09-05~07, 커밋 고정 실측 14개 저장소 +
  plus_plugins·4개 플러그인 Dart↔Swift 조인) — 2026-09-08에 main 브랜치 사본을 직접 읽었다
- cartograph `Sources/CartographKit/BridgeFacts.swift`·`Sources/CartographSyntax/ReactNativeMacroScanner.swift`
  (0.8.2, main) — limitation 생산 지점과 `.m` 텍스트 스캐닝 구현을 직접 읽었다
- isthmus PR #18 — target별 완화 단위와 `unjoined-*` tool 검증
- 2차 흡수 조사 원문(2026-09-08): trivy `docs/guide/configuration/filtering.md`, semgrep `cli/src/semgrep/commands/scan.py`, melos `docs/getting-started.mdx`, knip·oxc·tree-sitter-typescript·github/codeql 저장소 메타(라이선스·플러그인 수)
