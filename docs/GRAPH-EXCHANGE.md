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
`location.line`과 `location.column`은 1부터 시작하며, `column`은 해당 줄의 UTF-8 바이트
오프셋에 1을 더한 값이다. 생산자는 언어 런타임의 UTF-16 또는 Unicode scalar 열을 그대로
내보내지 않는다.
소비자는 이 조건을 어긴 문서를 거부해 로컬 경로 노출과 후속 출력 문법 오염을 막는다.
프로젝트 경로와 채널·메서드·심볼 이름에도 제어 문자를 넣지 않는다.
NEL(U+0085)과 Unicode 줄·문단 구분자(U+2028/U+2029)도 허용하지 않는다.
`generatedAt`은 timezone이 명시된 ISO 8601 날짜·시각이어야 한다. 생산자는 입력 offset을
UTC로 변환하고 밀리초 세 자리의 `YYYY-MM-DDTHH:mm:ss.SSSZ` 형식으로 정규화한다.
소비자는 버전 1에 정의되지 않은 추가 필드를 검증 경계에서
제거하고, 위치의 줄·열은 1 이상의 안전한 정수만 허용한다.

`channel: null`은 `method-handle`에서만 허용하며, "채널이 없다"가 아니라 생산자가
핸들러를 어느 채널에 귀속할지 **모른다**는 뜻이다. 소비자는 이 사실을 조인하지 않고,
호출 없는 핸들러 같은 불일치에도 포함하지 않는다. 생산자는 그 수와 원인을 정확히
`unattributed-method-handles:`로 시작하는 limitation으로 알려야 하며, 없으면 소비자는
문서를 거부한다.

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

`module-*`과 `component-*`는 버전 1에 예약되어 있지만 isthmus 0.1에서는 아직 조인하지
않는다. 0.1 소비자는 거짓 정상 결과를 막기 위해 이 네 종류를 입력 오류로 거부하며,
실제 조인은 RN 지원과 함께 0.2에서 제공한다.

## 조인 규칙 (isthmus 가 적용)

- `channel-create` ↔ `channel-register`: `channel` 이 같다. 플랫폼별로 따로 맞춘다 (Swift 와 Kotlin 이 각각 등록하는 것이 정상)
- 생성 없는 `channel-register`는 호출 측 사용을 찾지 못한 경고로 보존한다
- `method-invoke` ↔ `method-handle`: `(channel, method)` 가 같다
- `module-import` ↔ `module-export`: 0.2에서 `channel`(모듈 이름)로 조인할 예정
- `dynamic: true`이거나 `channel: null`인 사실은 조인하지 않고 `limitations`로 센다. 조인할 수 없다는 이유로 불일치라고 판정하지 않는다.
  세는 주체는 소비자다. isthmus는 조인에서 제외한 dynamic 사실을 직접 세어 자신을 출처(`tool: "isthmus"`)로 밝힌 limitation으로 내보내며, 같은 위치의 중복 사실은 한 번만 센다. 생산자의 `dynamic-*` limitation은 원인을 설명하는 추가 정보이지 소비자가 신뢰의 근거로 삼는 값이 아니다. `channel: null` 핸들러도 같다. 생산자의 `unattributed-method-handles:` 신고가 없으면 문서를 거부하지만, 신고한 개수는 검증하지 않고 소비자가 실제 사실 수를 다시 센다
- 수신 측이 스스로 신고한 분석 공백은 심각도에 반영한다. 소비자는 `objective-c-sources:`·`shadowed-flutter-method-channel:`(등록과 핸들러를 모두 가림), `opaque-handler-bodies:`(핸들러를 가림)를 수신 측 플랫폼 문서에서 발견하면 "핸들러 없는 호출"과 "등록 없는 채널 생성"을 error가 아니라 판정 불가(`-unverified` 경고)로 보고한다. 소비자가 직접 센 `unjoined-dynamic-methods`·`unjoined-unattributed-handlers`는 핸들러를, `unjoined-dynamic-channels`는 등록을 가리는 공백으로 본다. 알려진 접두사만 인정한다. 모르는 한계를 공백으로 넓게 해석하면 진짜 불일치가 경고로 묻힌다. 호출 측 플랫폼의 한계는 네이티브 코드를 가리지 않으므로 심각도를 바꾸지 않는다.
  이 접두사들은 계약이다. 생산자는 문구를 바꿀 때 접두사를 유지하고, 새 공백 종류를 추가하면 소비자의 목록도 함께 갱신한다. 목록이 닫혀 있으므로 갱신 전까지는 그 공백이 error로 보고된다(안전한 방향).
  완화 단위는 현재 조인 전체다. limitation 문법에 파일·채널 범위가 없어 공백을 개별 진단에 귀속할 수 없기 때문이다. 범위가 생기면 진단별로 좁힌다. 같은 이유로 `objective-c-sources:`처럼 소비자가 직접 셀 수 없는 공백은 생산자의 신고를 그대로 믿는다. 과다 신고는 진짜 불일치를 경고로 묻고, 과소 신고는 거짓 error를 남긴다
- 위치는 증거이지 조인 키가 아니다. 같은 `(channel, method)` 사실이 여러 위치에 있어도 존재 여부는 키 집합으로 판단하고, 위치는 모두 증거로 보존한다
- 한 번의 조인에 넣는 모든 문서는 정확히 같은 `project` 문자열을 가져야 한다. 다른 프로젝트의 같은 채널 이름을 연결하지 않기 위해 불일치는 입력 오류로 거부한다
- 한 번의 조인 입력에는 호출 측 플랫폼(dart·js) 문서와 수신 측 플랫폼(swift·kotlin) 문서가 각각 최소 하나 있어야 한다. 한쪽만 있는 입력은 한쪽 관찰을 경계 불일치로 오독할 수 있으므로 소비자는 입력 오류로 거부한다. 사실이 없는 문서도 해당 플랫폼이 분석됐다는 근거로 인정한다

생산자는 채널 생성자와 핸들러 등록 사이의 변수 참조를 따라 채널 이름을 `channel-register`에 옮긴다. `FlutterMethodChannel` 객체를 만들기만 하고 핸들러를 달지 않은 코드는 등록 사실이 아니다.

### `target` 호환 규칙

- 사실이 없을 때만 문서의 `target`은 `null`이다
- 사실이 하나 이상이고 한 브리지 메커니즘만 담으면 그 값을 쓴다
- 버전 1에는 사실별 `target`이 없다. 한 Swift 프로젝트에 Flutter와 React Native 사실이
  함께 있으면 생산자는 결정적인 대표값을 쓰고 정확히 `mixed-targets:`로 시작하는
  limitation을 반드시 추가한다
- 소비자는 `mixed-targets` 문서에서 사실별 메커니즘을 복원할 수 없으므로 조인을 보류한다. 생산자는 위의 정확한 표기를 써야 하며, 소비자는 대소문자·앞 공백·콜론 누락처럼 명백한 변형도 fail-closed로 보류한다. CLI 명령은 빈 정상 결과를 내지 않고 도구 실패(종료 코드 2)를 반환한다. 안전한 혼합 프로젝트 지원은 문서를 target별로 나누거나 다음 형식 버전에 사실별 target을 추가한 뒤 제공한다

소비자는 `platform`과 fact 역할도 함께 검증한다. Dart/JS는 호출 측 종류만,
Swift/Kotlin은 수신 측 종류만 생산할 수 있다.

### 입력 자원 상한

- 한 명령은 최대 256개 교환 문서를 받는다
- 한 문서는 최대 100,000개 fact를 담는다
- CLI는 파일 하나당 UTF-16 문자열 길이 16Mi, 전체 64Mi를 넘으면 파싱 전에 거부한다
- 경계 그래프의 Cartesian 간선은 최대 100,000개다

## 되돌려 주는 형식: 외부 보존 근거

isthmus `retentions --for <tool>` 의 출력. 자매 도구의 `--external-retentions <path>` 가 읽는다.

```jsonc
{
  "format": "external-retentions",
  "version": 0,
  "producedBy": { "name": "isthmus", "version": "x.y.z" },
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

이 문서는 부분적으로 만들지 않는다. 소비 도구가 읽을 수 있는 수신 측 문서가 입력에 없거나, 호출자가 있는데도 `symbol`이 없어 근거로 바꿀 수 없는 매치 핸들러가 있으면 isthmus는 일부만 담은 목록 대신 도구 실패(종료 코드 2)로 끝낸다. 근거가 빠진 목록은 소비자에게 살아 있는 핸들러를 미사용으로 보이게 하기 때문이다.

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
- **구문 해석 한계**: Dart의 해석하지 못한 `invokeMethod` receiver는 `unresolved-receiver-invocations:`, Swift의 named-function handler는 `opaque-handler-bodies:` limitation으로 센다. 로컬 선언이 import된 `FlutterMethodChannel`을 가리면 `shadowed-flutter-method-channel:`로 알리고 사실 생성을 보류한다
- **Swift 조건부 컴파일**: Flutter를 import한 파일에 `#if`가 있으면 활성 구성을 추측하지 않고 compiler-indexed 추출이 필요하다고 실패한다
- **버전 1 승격**: `expected/dart.json`과 `expected/swift.json`을 실제 추출기로 만들고, 채널 1개·메서드 1개 연결, 핸들러 없는 호출 1개, 호출 없는 핸들러 2개를 `expected/join.json`으로 대조해 충족했다
