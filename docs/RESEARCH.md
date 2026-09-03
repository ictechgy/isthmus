# isthmus 리서치 노트

2026-09-04 기준. **확인됨** 은 1차 출처를 직접 읽었거나 코드로 재현한 것, **확인 필요** 는 GLM 또는 기억에서 나온 주장이다.

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

### RN 프로젝트 현황 (바탕화면)

- `~/Desktop/골목골목/mobile`: Expo, RN 0.86.2, **`ios/` 없음, Swift 0, ObjC 0**, TS 35 파일. managed 워크플로. 네이티브 코드가 없으므로 isthmus 대상이 아니다. `expo prebuild` 로 `ios/` 를 만들 수 있으나 그래도 브리지 코드는 Expo 모듈 안(node_modules)에 있다

## 확인 필요

- **Flutter 플러그인의 iOS 구현 언어** — `flutter/packages` 의 `path_provider`, `url_launcher`, `shared_preferences` 가 Swift 인지 ObjC 인지. ObjC 면 cartograph 가 못 본다(`.swift` 만 분석). Swift 구현이 있는 플러그인을 골라야 한다
- **Pigeon 산출물의 형태** — 채널 이름이 생성 코드의 상수로 들어가고, Dart · Swift 양쪽 생성 파일이 같은 문자열을 가진다고 기억. 그러면 Pigeon 을 쓰는 코드도 리터럴 조인이 된다(단 생성 파일을 분석에 포함해야)
- **RN Turbo Modules codegen** — `NativeX.ts` 스펙 파일에서 네이티브 인터페이스를 생성. 모듈 이름은 `TurboModuleRegistry.getEnforcing<Spec>('X')` 의 문자열. 구식 브리지(`NativeModules.X`)와 공존
- **RN 네이티브 쪽 이름 등록** — iOS: `RCT_EXPORT_MODULE(Name)` 매크로(ObjC) 또는 Swift `@objc(Name)` + ObjC 브리징. **RN 의 iOS 네이티브 모듈은 대부분 ObjC 매크로를 거친다** — Swift 만 보는 cartograph 로 얼마나 잡히는지가 v0.2 의 관건. 확인 필요
- **`react-native-webview`** — 네이티브 코드가 있는 RN 라이브러리로 존재 확실. iOS 구현 언어 미확인
- **Capacitor 플러그인 메커니즘** — `@objc func method(_ call: CAPPluginCall)` + `CAP_PLUGIN` 매크로로 기억. v0.3 이후

## 설계에 영향을 주는 사실

- **조인은 근사다.** 보간 문자열, 상수를 거친 이름, 변수로 전달된 채널은 못 본다. 상수를 거친 경우(`const kChannel = '…'; MethodChannel(kChannel)`)는 흔하므로 **한 단계 상수 추적**은 v0.1 에 넣는다. Dart 의 `const` 와 Swift 의 `static let` 은 analyzer/SwiftSyntax 로 해결 가능
- **같은 채널을 두 플랫폼이 각각 등록하는 것이 정상.** "Swift 에 없다" 는 iOS 타깃이 있을 때만 오류. 교환 형식의 `platform` 필드가 이것을 위한 것
- **신선도.** 세 도구의 JSON 이 서로 다른 시각에 만들어진다. `generatedAt` 을 비교해 하루 이상 차이 나면 `limitations` 에 알린다. cartograph 의 `index-staleness` 와 같은 이유

## 출처

- cartograph `CHANGELOG.md` 0.1.0 ~ 0.4.0 — `@objc` · IB · 셀렉터가 보존 규칙이 된 경위
- knip 관련 도구 목록 — https://knip.dev/reference/related-tooling
- GLM 리서치 응답(2026-09-04) — "브리지 교차 그래프는 미개척" 판단. 1차 출처 아님
