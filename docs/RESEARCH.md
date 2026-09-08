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
**구현 승인이 아니라 합의용 초안**이며, 근거는 cartograph 0.8.2 소스와 그 실측 문서
`docs/scans/2026-09-flutter-plugins.md`(2026-09-05~07)다.

### 확인된 사실

- 과완화의 실측 사례: flutter_local_notifications는 macOS Swift 핸들러 14개가 전부 매치되고
  이슈 20개가 남았는데, 그들의 손 분류는 15개 Android 전용 메서드 · 1개 iOS `.m` 안
  (getCallbackHandle) · 3개 example/ 비대칭이다. `.m`이 실제로 가리는 것은 1건뿐이지만
  `objective-c-sources:` 하나가 20건 전부를 완화한다. 계약이 경고한 "과다 신고는 진짜
  불일치를 경고로 묻는다"의 실례다.
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
- 선행 조건: **isthmus Blockers 2(ObjC 핸들러 retention)와 함께 정해야 한다.** USR 없는
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

## 출처

- cartograph `CHANGELOG.md` 0.1.0 ~ 0.4.0 — `@objc` · IB · 셀렉터가 보존 규칙이 된 경위
- knip 관련 도구 목록 — https://knip.dev/reference/related-tooling
- GLM 리서치 응답(2026-09-04) — "브리지 교차 그래프는 미개척" 판단. 1차 출처 아님
- cartograph `docs/scans/2026-09-flutter-plugins.md`(2026-09-05~07, 커밋 고정 실측 14개 저장소 +
  plus_plugins·4개 플러그인 Dart↔Swift 조인) — 2026-09-08에 main 브랜치 사본을 직접 읽었다
- cartograph `Sources/CartographKit/BridgeFacts.swift`·`Sources/CartographSyntax/ReactNativeMacroScanner.swift`
  (0.8.2, main) — limitation 생산 지점과 `.m` 텍스트 스캐닝 구현을 직접 읽었다
- isthmus PR #18 — target별 완화 단위와 `unjoined-*` tool 검증
