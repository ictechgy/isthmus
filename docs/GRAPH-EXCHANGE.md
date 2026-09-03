# 브리지 사실 교환 형식 (초안 0)

cartograph · kartograph · dartograph · isthmus 의 JS/TS 추출기가 **내보내고**, isthmus 가 **읽는** 형식. 이 문서가 바뀌면 네 저장소가 같이 바뀐다. 초안이며, isthmus Phase 0 에서 실제 코드에 대조한 뒤 1 로 올린다.

## 원칙

- 각 도구는 **자기 언어에서 본 사실만** 낸다. 판정하지 않는다
- 위치는 항상 파일 · 줄 · 열. isthmus 의 모든 보고가 양쪽 위치를 가리켜야 한다
- 리터럴이 아닌 이름은 `dynamic: true` 로 표시하고 **버리지 않는다.** 한계를 세는 데 필요하다
- 키 순서는 정렬, 파일은 diff 가능해야 한다 (cartograph `GraphDocument` 와 같은 이유)

## 문서

```jsonc
{
  "format": "bridge-facts",
  "version": 0,
  "tool": { "name": "dartograph", "version": "0.1.0" },
  "generatedAt": "2026-09-04T12:00:00Z",   // 신선도 판단용
  "platform": "dart" | "swift" | "kotlin" | "js",
  "target": "flutter" | "react-native" | "capacitor",  // 브리지 메커니즘
  "project": "/abs/path",
  "facts": [ Fact, ... ],
  "limitations": [ "dynamic-channel-names: 3 channel constructors use a non-literal name", ... ]
}
```

## Fact

공통 필드:

```jsonc
{
  "kind": "channel-create" | "channel-register" | "method-invoke" | "method-handle"
        | "module-export" | "module-import" | "component-export" | "component-require",
  "channel": "com.example/camera",     // 없으면 null. dynamic 이면 원문 표현식
  "method": "takePhoto",               // method-* 에만
  "dynamic": false,
  "location": { "path": "lib/camera.dart", "line": 42, "column": 5 },
  "symbol": {                          // 이 사실을 담고 있는 선언 (있으면)
    "qualifiedName": "CameraPlugin.takePhoto",
    "usr": "s:…"                       // cartograph 는 USR, kartograph 는 JVM 시그니처, dartograph 는 요소 ID
  }
}
```

### 종류별 의미

| kind | 누가 내는가 | 뜻 |
|---|---|---|
| `channel-create` | Dart / JS | 호출하는 쪽이 채널 객체를 만들었다 |
| `channel-register` | Swift / Kotlin | 받는 쪽이 채널에 핸들러를 달았다 (`setMethodCallHandler`) |
| `method-invoke` | Dart / JS | `invokeMethod('m')` 호출 |
| `method-handle` | Swift / Kotlin | 핸들러 안에서 `case "m":` 또는 동등한 분기 |
| `module-export` | Swift / Kotlin | RN `RCT_EXPORT_MODULE(Name)`, `@ReactModule(name=)` |
| `module-import` | JS | `NativeModules.Name`, `TurboModuleRegistry.get('Name')` |
| `component-export` | Swift / Kotlin | RN `RCT_EXPORT_VIEW_PROPERTY` 등 뷰 매니저 |
| `component-require` | JS | `requireNativeComponent('Name')` |

RN 의 메서드는 `method-invoke`(JS: `NativeModules.Name.method()`) / `method-handle`(네이티브: `RCT_EXPORT_METHOD(method:)`, `@ReactMethod fun method`) 로 같은 종류를 쓴다. `channel` 자리에 모듈 이름이 들어간다.

## 조인 규칙 (isthmus 가 적용)

- `channel-create` ↔ `channel-register`: `channel` 이 같다. 플랫폼별로 따로 맞춘다 (Swift 와 Kotlin 이 각각 등록하는 것이 정상)
- `method-invoke` ↔ `method-handle`: `(channel, method)` 가 같다
- `module-import` ↔ `module-export`: `channel` (모듈 이름)
- `dynamic: true` 인 사실은 조인하지 않고 `limitations` 로 센다

## 되돌려 주는 형식: 외부 보존 근거

isthmus `retentions --for <tool>` 의 출력. 자매 도구의 `--external-retentions <path>` 가 읽는다.

```jsonc
{
  "format": "external-retentions",
  "version": 0,
  "producedBy": { "name": "isthmus", "version": "0.1.0" },
  "generatedAt": "…",
  "retentions": [
    {
      "symbol": { "usr": "s:…", "qualifiedName": "CameraPlugin.takePhoto" },
      "reason": "bridge",
      "evidence": {
        "channel": "com.example/camera",
        "method": "takePhoto",
        "caller": { "platform": "dart", "path": "lib/camera.dart", "line": 42 }
      }
    }
  ]
}
```

자매 도구는 이것을 `RetentionReason.externalBridge` 로 매핑하고, `--explain` 에서 `evidence` 를 그대로 문장으로 만든다.

## 자매 도구가 해야 할 일 (선행 작업)

| 도구 | 명령 | 낼 것 | 읽을 것 |
|---|---|---|---|
| cartograph | `bridges --format json` | Swift 의 `FlutterMethodChannel(name:)`, `setMethodCallHandler`, `case "…"`, `RCT_EXPORT_*`, `@objc(…)` | `--external-retentions` |
| dartograph | `bridges --format json` | `MethodChannel(…)`, `invokeMethod(…)`, Pigeon 산출물 | (없음 — Dart 쪽이 부르는 쪽) |
| kartograph | `bridges --format json` | `MethodChannel(…)`, `setMethodCallHandler`, `when (call.method)`, `@ReactModule`, `@ReactMethod` | `--external-retentions` |
| isthmus 내장 | `extract-js` | `NativeModules.*`, `TurboModuleRegistry.get`, `requireNativeComponent` | — |

**cartograph 가 첫 번째다.** cartograph 는 이미 있고, `bridges` 는 SwiftSyntax 로 리터럴을 뽑는 작은 명령이다. cartograph 저장소에 이슈/PR 로 넣는다.

## 미결

- Swift 쪽 `case "takePhoto":` 를 어느 핸들러 심볼에 귀속시킬 것인가 — 클로저 안이라 USR 이 없다. 감싸는 함수/타입의 USR + 줄로 표시하는 것이 현실적
- Pigeon · Turbo Modules codegen 산출물을 "정적 참조로 해결됨" 으로 표시하는 방법 — 사실 종류를 하나 더 둘지(`codegen-resolved`), `dynamic` 의 반대 플래그로 둘지
- 버전 0 → 1 승격 조건: Flutter ↔ Swift 코퍼스가 이 형식으로 실제로 조인되었을 때
