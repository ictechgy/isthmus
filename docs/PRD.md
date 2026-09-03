# isthmus PRD

## 한 줄

크로스플랫폼 앱에서 문자열 이름으로 언어 경계를 넘는 호출(플랫폼 채널 · 네이티브 모듈)을 그래프 간선으로 만들고, 불일치와 미사용을 근거와 함께 보고하며, 그 사실을 언어별 도구에 보존 근거로 돌려주는 조인 도구.

## 문제

RN 이나 Flutter 앱은 두 세계로 나뉜다. JS/Dart 세계와 Swift/Kotlin 세계. 둘을 잇는 것은 **문자열**이다.

```dart
// Dart
const channel = MethodChannel('com.example/camera');
await channel.invokeMethod('takePhoto');
```
```swift
// Swift
let channel = FlutterMethodChannel(name: "com.example/camera", binaryMessenger: messenger)
channel.setMethodCallHandler { call, result in
    switch call.method {
    case "takePhoto": ...
```

어떤 컴파일러도 이 둘을 잇지 않는다. 결과:

1. **오탐**: cartograph 는 `takePhoto` 핸들러를 부르는 Swift 코드가 없으므로 미사용이라 한다. 에이전트가 지운다. 앱이 런타임에 죽는다
2. **탐지 불가한 불일치**: Dart 가 `'takePhotos'` 로 오타를 내면 아무 도구도 빌드 전에 못 잡는다
3. **진짜 미사용을 못 봄**: Swift 에 `'recordVideo'` 핸들러가 있는데 Dart 어디서도 안 부른다. 아무 도구도 말하지 않는다

이 문제를 다루는 도구는 **없다** (`docs/RESEARCH.md`). 완화책은 도구가 아니라 코드 생성이다 — Flutter Pigeon, RN Turbo Modules codegen 은 문자열을 정적 참조로 바꾼다. 그러나 codegen 을 안 쓰는 코드가 훨씬 많고, codegen 을 써도 채널 이름 자체는 여전히 문자열이다.

## 사용자

1. **Flutter/RN 앱을 가진 팀** — CI 에서 `isthmus check --strict`: 핸들러 없는 호출(1 로 실패), 호출 없는 핸들러(보고)
2. **cartograph/kartograph 사용자** — 네이티브 핸들러가 "미사용" 으로 나오는 오탐을 없앤다
3. **코딩 에이전트** — 네이티브 코드를 지우기 전에 `isthmus query 'com.example/camera'` 로 누가 부르는지 본다

## 범위

### 반드시 (v0.1) — Flutter ↔ Swift

- 입력: dartograph `bridges` JSON + cartograph `bridges` JSON (형식: `docs/GRAPH-EXCHANGE.md`)
- 조인: 채널 이름으로 등록 ↔ 생성을, (채널, 메서드) 로 호출 ↔ 핸들러 case 를 잇는다
- `check` — 세 가지 보고: 핸들러 없는 호출(오류) · 호출 없는 핸들러(경고) · 등록 없는 채널 생성(오류). 각 항목에 양쪽 파일 · 줄
- `graph` — 경계 간선만 담은 DOT · Mermaid · JSON
- `query <channel-or-method>` — 양쪽에서 누가 만들고 누가 부르는지. cartograph `SymbolQueryDocument` 와 같은 골격(`subject` · `usedBy` · `dependsOn` · `limitations`)
- `retentions --for cartograph` — cartograph 가 읽을 보존 근거 파일. "이 Swift 심볼은 `lib/x.dart:N` 이 채널 `c` 메서드 `m` 으로 부르므로 보존"
- `limitations`: 동적 채널 이름 수, 동적 메서드 이름 수, 양쪽 입력의 신선도(생성 시각)
- 종료 코드 계약, 베이스라인, JS/TS 없이도 동작
- 오탐 코퍼스: 실제 Flutter 앱 + iOS 러너

### 다음 (v0.2)

- **RN ↔ Swift**: JS/TS 추출기(`NativeModules.X`, `TurboModuleRegistry.get`, `requireNativeComponent`) + cartograph 쪽 `RCT_EXPORT_MODULE`/`@objc(...)` 이름. Turbo Modules codegen 스펙(`NativeX.ts`)이 있으면 그것을 1차 원천으로
- **↔ Kotlin**: kartograph `bridges` 가 나오면. `MethodChannel(flutterEngine.dartExecutor, "…")`, `@ReactMethod`
- `EventChannel`, `BasicMessageChannel`

### 나중에

- Capacitor · Cordova 플러그인, KMP `expect/actual`, WebView `@JavascriptInterface` ↔ JS
- 자매 도구를 대신 돌려 주는 편의 래퍼(`isthmus run`)

### 하지 않는 것

- 삭제 판정 · 자동 수정
- 언어 직접 파싱(JS/TS 제외). Swift/Kotlin/Dart 는 자매 도구의 몫
- 자매 도구 그래프 전체 조인. 브리지 사실만

## 핵심 설계

### 교환 형식이 제품이다

`docs/GRAPH-EXCHANGE.md` 가 세 저장소가 공유하는 계약이다. isthmus 의 첫 산출물은 코드가 아니라 이 형식의 확정이고, 첫 PR 은 cartograph 에 `bridges` 명령을 넣는 것이다.

### 조인은 문자열이고, 그것이 한계다

- 리터럴만 잇는다. `'com.example/$feature'` 처럼 보간되거나 변수로 전달된 이름은 **못 본다**. 그런 지점의 수를 세어 `limitations` 에 싣고, 조인 결과가 "전부" 라고 주장하지 않는다
- 메서드 이름은 채널 안에서만 유일하다. (채널, 메서드) 쌍이 키다
- 같은 채널을 iOS 와 Android 가 각각 등록하는 것이 정상이다. "Swift 에 없다" 는 iOS 타깃이 있을 때만 오류다. 입력에 어느 플랫폼의 사실인지가 들어 있어야 한다(형식에 `platform` 필드)

### 되돌려 주기

cartograph 에 `--external-retentions <path>` 를 추가한다. 파일은 `{usr | qualifiedName, reason: "bridge", evidence: {channel, method, caller: {path, line}}}` 의 목록. cartograph 의 `RetentionReason` 에 `.externalBridge` 케이스가 생기고, `dead --explain` 이 "retained because `lib/camera.dart:42` invokes it over channel `com.example/camera`" 라고 말한다. 이것이 isthmus 의 가치가 사용자에게 닿는 지점이다.

## 성공 기준

- `flutter/packages` 의 플러그인 하나(예: `path_provider`)에서 Dart ↔ Swift 조인이 **모든** 메서드를 맞춘다(수동 검증)
- 오타 픽스처(`'takePhotos'`)를 `check --strict` 가 1 로 잡는다
- cartograph 에 retentions 를 넘기면 핸들러 오탐이 0 이 되고 `--explain` 이 Dart 쪽 위치를 말한다
- 자기 검증: 코퍼스 양방향, 커버리지 90%, 종료 코드 계약

## 이름

isthmus — 두 땅을 잇는 좁은 육교. 지도 위의 다리.
