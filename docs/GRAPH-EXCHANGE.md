# 브리지 사실 교환 형식 (버전 1)

cartograph · kartograph · dartograph · isthmus 의 JS/TS 추출기가 **내보내고**, isthmus 가 **읽는** 형식. 이 문서가 바뀌면 네 저장소가 같이 바뀐다. 버전 1은 `experiments/phase-0/`의 Dart ↔ Swift 코퍼스를 양방향으로 조인해 검증했다.

## 원칙

- 각 도구는 **자기 언어에서 본 사실만** 낸다. 판정하지 않는다
- 위치는 항상 파일 · 줄 · 열. isthmus 의 모든 보고가 양쪽 위치를 가리켜야 한다
- 리터럴이 아닌 이름은 `dynamic: true` 로 표시하고 **버리지 않는다.** 한계를 세는 데 필요하다
- 키 순서는 정렬, 파일은 diff 가능해야 한다 (cartograph `GraphDocument` 와 같은 이유)

## 문서

```jsonc
{
  "format": "bridge-facts",
  "version": 1,
  "tool": { "name": "dartograph", "version": "0.1.0" },
  "generatedAt": "2026-09-04T12:00:00Z",   // 신선도 판단용
  "platform": "dart" | "swift" | "kotlin" | "js",
  "target": "flutter" | "react-native" | "capacitor" | null,  // 브리지 메커니즘
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
  "channel": "com.example/camera",     // 귀속할 수 없으면 null. dynamic 이면 원문 표현식
  "method": "takePhoto",               // method-* 에만
  "dynamic": false,
  "location": { "path": "lib/camera.dart", "line": 42, "column": 5 },
  "symbol": {                          // 이 사실을 담고 있는 선언 (있으면)
    "qualifiedName": "CameraPlugin.register",
    "usr": "s:…"                       // 생산 도구의 안정 식별자. Phase 0 구문 실험에서는 생략 가능
  }
}
```

`method-handle`의 `symbol`은 문자열 `case` 자체가 아니라 그것을 감싸는 타입·함수 선언이다. Swift 클로저에는 USR이 없으므로 `qualifiedName`은 `CameraPlugin.register`처럼 감싸는 선언을 가리키고, `location`은 실제 `case` 문자열을 가리킨다. cartograph의 생산 구현은 인덱스와 결합해 `usr`까지 채워야 한다. 구문 실험처럼 `usr`을 채우지 못하면 `missing-handler-usrs`를 `limitations`에 싣는다.

`location.path`는 프로젝트 루트 기준 상대 경로다. 절대 경로, `..` 상위 이동, 제어 문자를 넣지 않는다.
소비자는 이 조건을 어긴 문서를 거부해 로컬 경로 노출과 후속 출력 문법 오염을 막는다.
프로젝트 경로와 채널·메서드·심볼 이름에도 제어 문자를 넣지 않는다.
`generatedAt`은 timezone이 명시된 ISO 8601 날짜·시각이어야 한다.
소비자는 버전 1에 정의되지 않은 추가 필드를 검증 경계에서
제거하고, 위치의 줄·열은 1 이상의 안전한 정수만 허용한다.

`channel: null`은 "채널이 없다"가 아니라 생산자가 핸들러를 어느 채널에 귀속할지 **모른다**는 뜻이다. 소비자는 이 사실을 조인하지 않고, 호출 없는 핸들러 같은 불일치에도 포함하지 않는다. 생산자는 그 수와 원인을 `unattributed-method-handles` 같은 limitation으로 알려야 한다.

### 종류별 의미

| kind | 누가 내는가 | 뜻 |
|---|---|---|
| `channel-create` | Dart / JS | 호출하는 쪽이 채널 객체를 만들었다 |
| `channel-register` | Swift / Kotlin | 받는 쪽이 채널에 핸들러를 달았다 (`setMethodCallHandler`). 위치도 생성자가 아니라 이 호출을 가리킨다 |
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
- `dynamic: true`이거나 `channel: null`인 사실은 조인하지 않고 `limitations`로 센다. 조인할 수 없다는 이유로 불일치라고 판정하지 않는다
- 위치는 증거이지 조인 키가 아니다. 같은 `(channel, method)` 사실이 여러 위치에 있어도 존재 여부는 키 집합으로 판단하고, 위치는 모두 증거로 보존한다
- 한 번의 조인에 넣는 모든 문서는 정확히 같은 `project` 문자열을 가져야 한다. 다른 프로젝트의 같은 채널 이름을 연결하지 않기 위해 불일치는 입력 오류로 거부한다

생산자는 채널 생성자와 핸들러 등록 사이의 변수 참조를 따라 채널 이름을 `channel-register`에 옮긴다. `FlutterMethodChannel` 객체를 만들기만 하고 핸들러를 달지 않은 코드는 등록 사실이 아니다.

### `target` 호환 규칙

- 사실이 없을 때만 문서의 `target`은 `null`이다
- 사실이 하나 이상이고 한 브리지 메커니즘만 담으면 그 값을 쓴다
- 버전 1에는 사실별 `target`이 없다. 한 Swift 프로젝트에 Flutter와 React Native 사실이
  함께 있으면 생산자는 결정적인 대표값을 쓰고 정확히 `mixed-targets:`로 시작하는
  limitation을 반드시 추가한다
- 소비자는 `mixed-targets` 문서에서 사실별 메커니즘을 복원할 수 없으므로 조인을 보류한다. CLI 명령은 빈 정상 결과를 내지 않고 도구 실패(종료 코드 2)를 반환한다. 안전한 혼합 프로젝트 지원은 문서를 target별로 나누거나 다음 형식 버전에 사실별 target을 추가한 뒤 제공한다

소비자는 `platform`과 fact 역할도 함께 검증한다. Dart/JS는 호출 측 종류만,
Swift/Kotlin은 수신 측 종류만 생산할 수 있다.

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

**cartograph가 첫 번째 생산 구현이다.** PR #11에서 SwiftSyntax 스캐너와 `bridges --format json`이 버전 1로 구현됐다.

cartograph의 버전 1 구현은 `symbol.usr`을 붙이기 위해 인덱스 스토어를 요구한다. 인덱스가 없으면 불완전한 문서를 내보내지 않고 도구 실패(종료 코드 2)로 끝난다. 이는 문서 형식의 limitation이 아니라 생산 명령의 선행 조건이다.

## Phase 0 결정

- **Swift `case` 귀속**: 감싸는 타입·함수의 `qualifiedName`과, 생산 구현이 가진 안정 식별자(`usr`)를 `symbol`에 넣는다. 사실의 `location`은 `case` 문자열 위치다. Phase 0 SwiftSyntax 실험은 USR을 만들 수 없어 그 수를 `missing-handler-usrs`로 보고한다
- **Pigeon · Turbo Modules codegen**: 버전 1에는 별도 `codegen-resolved` 종류나 플래그를 추가하지 않는다. 생성 코드의 리터럴도 같은 채널·메서드 사실이고 조인 규칙이 같기 때문이다. 버전 1은 생성 여부를 계약에 싣지 않으며, 필요해지면 조인 키를 바꾸지 않는 선택 필드로 추가한다. 소비자는 경로만 보고 사용자 작성 코드라고 가정하지 않는다
- **한 단계 상수 추적**: `const kChannel = '…'`와 Swift `static let`처럼 같은 파일의 문자열 상수 한 단계는 정적 사실로 낸다. 그 이상이거나 보간된 표현식은 원문과 `dynamic: true`로 보존한다
- **버전 1 승격**: `expected/dart.json`과 `expected/swift.json`을 실제 추출기로 만들고, 채널 1개·메서드 1개 연결, 핸들러 없는 호출 1개, 호출 없는 핸들러 2개를 `expected/join.json`으로 대조해 충족했다
