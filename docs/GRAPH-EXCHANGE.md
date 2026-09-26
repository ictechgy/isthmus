# 브리지 사실 교환 형식 (버전 1)

isthmus 소유의 추가 입력/보고 계약은 [변경 사전 점검](IMPACT.md),
[언어 간 전이 분석과 수집](PREFLIGHT.md),
[런타임 통신 검증](RUNTIME.md)에 있다. 이들은 기존 bridge-facts v1 생산자 필드를
변경하지 않는다. 런타임에서 지원하는 transport를 정적 producer 지원으로 해석하지 않는다.

개발 중인 [BasicMessageChannel v2](BRIDGE-MESSAGES.md)와
[EventChannel v2](BRIDGE-EVENTS.md)는 별도 transport 문서다.
개발 중인 [React Native 이벤트 v2](BRIDGE-RN-EVENTS.md)는 코어 RN 전역 이벤트의
`event-emit`↔`event-listen`을 다루며 Flutter transport와 섞지 않는다.
`target: "http"`는 [HTTP 경계 합의 초안](#개발-중-http-경계-합의-초안)만 있으며 아직 어떤 소비
명령도 받지 않는다. 아래 규범 절은 그 초안이 합의·구현될 때까지 그대로 유효하다.
`check`는 v2 문서를 직접 소비해 transport별 진단 코드로 보고한다. `query`는 v2 경계를
`message`·`stream` kind 주체로, `graph`는 literal v2 경계를 `message`·`stream` 간선으로,
`diff`는 literal v2 경계의 추가·삭제와 v2 진단의 introduced/resolved를 싣는다.
`retentions`는 literal v2 경계의 네이티브 선언을 method 없는 보존 근거로 낸다.
`preflight`는 선택적 context.messages로 소비한다. `impact`는 v1 전용으로 version 2를
명시적으로 거부한다 — 모르는 facts를 무시하고 초록 결과를 내지 않는다.

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
  "generatedAt": "2026-09-04T12:00:00Z",   // 문서 추출 시각
  "platform": "dart" | "swift" | "kotlin" | "js" | "go" | "rust" | "sql",
  "target": "flutter" | "react-native" | "capacitor" | "persistence" | null,  // 경계 메커니즘
  "project": "/abs/path",                        // POSIX realpath로 정규화한 절대 경로
  "facts": [ Fact, ... ],
  "limitations": [ "dynamic-channel-names: 3 channel constructors use a non-literal name", ... ]
}
```

## 선택적 limitation 스코프 (v1 확장)

기존 `limitations: string[]`는 유지한다. 생산자는 그 중 특정 항목의 **공백 전체**를
포함하는 채널 집합을 증명할 수 있을 때만 선택적 `limitationScopes`를 추가한다.

```json
"limitations": ["opaque-handler-bodies: 1 handler body could not be inspected"],
"limitationScopes": [{"limitationIndex": 0, "channels": ["dev.example/camera"]}]
```

- `limitationIndex`는 같은 문서의 `limitations` 배열에 대한 0부터 시작하는 인덱스다.
  항목별로 하나만 허용한다. 같은 접두사의 다른 항목과 다른 문서의 공백을 덮어쓰지 않는다.
- `channels`는 제어 문자가 없는 비어 있지 않은 채널 문자열의 비어 있지 않은 배열이다.
  글롭·대소문자 접기·부분 문자열 매칭을 하지 않는다. 중복은 제거하고 문자열 순으로 정규화한다.
- 채널 이름을 일부 발견한 것만으로 스코프를 만들지 않는다. 해당 한계가 가릴 수 있는 모든
  채널을 포함하는 **보수적 상한**이어야 한다. 동적 이름·미해석 위임·읽기 실패 때문에
  상한을 증명할 수 없으면 그 항목의 스코프를 생략한다. ObjC 파일에서 채널 리터럴을
  몇 개 읽었다는 것만으로 `objective-c-sources`의 범위를 좁히지 않는다.
- 스코프가 없는 항목은 기존 target 범위 전체에 적용한다. 스코프 있는 항목과 공존하면
  범위 없는 공백이 우선하며, 다른 target과 호출 측 한계는 기존 규칙대로 처리한다.
  `target: null`은 target을 추측하지 않고 모든 target의 해당 채널에 적용한다.
- 잘못된 인덱스, 중복 인덱스, 빈 채널 집합, 잘못된 타입은 입력 오류로 거부한다. 잘못된
  스코프를 빈 공백으로 읽고 error를 만들지 않는다. 문서당 최대 1,000 스코프, 정규화 전
  채널 원소 합계 최대 10,000개다. 파일 위치는 채널 집합의 대체물이 아니다.
- 문자열 끝의 `[channels: …]`는 문장일 뿐 파싱하지 않는다. JSON 문자열 인코딩이 쉼표·
  대괄호·따옴표 이스케이프를 맡는다. 같은 채널 안의 플랫폼 조건은 이 범위로 구분하지 않는다.
- 옛 v1 소비자는 모르는 필드를 버리고 기존 문자열을 target 전체로 적용한다. 새 소비자는
  조인 결과의 해당 `JoinLimitation.channels`에 범위를 보존하며 check/query/graph/diff에
  전달한다. 스코프 배열 자체가 비었으면 추가 범위가 없다는 뜻이며 기존 전체 적용이다.
  범위만 바뀌어도 diff에서 한계 변화로 보인다. isthmus의 직접 계수에는 선택적
  `origin: "consumer"`를 붙이고, 이 필드는 생산 문서에서 복사하지 않는다. `unjoined-*`를 생산자가 신고해
  소비자의 자체 계수를 덮어쓰는 것은 여전히 허용하지 않는다.

## Fact

공통 필드:

```jsonc
{
  "kind": "channel-create" | "channel-register" | "method-invoke" | "method-handle"
        | "module-export" | "module-import" | "component-export" | "component-require"
        | "relation-use" | "relation-decl",
  "channel": "com.example/camera",     // 귀속할 수 없으면 null. dynamic 이면 원문 표현식.
                                       // relation-* 에서는 관계 이름(아래 persistence 절)
  "method": "takePhoto",               // method-* 에만. relation-* 에서는 선택적 컬럼 이름
  "mechanism": "expo",                 // module-*/component-* 에만(method-*와
                                       // 상호 배타). 생략은 "core"
  "optional": true,                    // module-import 에만 — 호출 API가
                                       // 부재 시 null 반환을 허용한다는 증거
  "dynamic": false,
  "location": { "path": "lib/camera.dart", "line": 42, "column": 5 },
  "symbol": {                          // 이 사실을 담고 있는 선언 (있으면)
    "qualifiedName": "CameraPlugin.register",
    "usr": "s:…"                       // 생산 도구의 안정 식별자. Phase 0 구문 실험에서는 생략 가능
  }
}
```

선택적 `sourceLanguage: "objective-c"`는 `platform: "swift"` 문서에 담긴 `.m`/`.mm`의
**Objective-C 구현 사실**을 구분한다. 실제 Clang 인덱스에서 확인한 `c:` USR이 있으면
`usr`까지 함께 싣는다. 인덱스가 없거나 선언을 유일하게 확인하지 못하면 `usr`를 생략하고
구문이 아는 `qualifiedName`만 둘 수 있다 — Swift의 `missing-handler-usrs`와 같은
대칭이다. 합성 안정 식별자(SCIP 문법 등)를 지어 진짜 신원처럼 싣지 않는다.
`usr`가 있는데 `c:`로 시작하지 않으면 입력 오류다.
그 외 값·플랫폼·확장자 조합은 입력 오류다.
필드가 없으면 기존 플랫폼 의미를 유지한다. 위치 확장자만으로 Objective-C라고 추측하지 않는다.
`sourceLanguage`는 Swift 플랫폼 문서 안의 Objective-C 구현을 구분하는 생산자의 자가 선언 필드다.
보존 근거로 내보내려면 실제 Clang `c:` USR이 필요하다. 언어 표식을 붙여도 식별자가
없는 매치 선언을 부분 보존 목록에서 조용히 제외하지 않는다.

`method-handle`의 `symbol`은 문자열 `case` 자체가 아니라 그것을 감싸는 타입·함수 선언이다. Swift 클로저에는 USR이 없으므로 `qualifiedName`은 `CameraPlugin.register`처럼 감싸는 선언을 가리키고, `location`은 실제 `case` 문자열을 가리킨다. cartograph의 생산 구현은 인덱스와 결합해 `usr`까지 채워야 한다. 구문 실험처럼 `usr`을 채우지 못하면 `missing-handler-usrs`를 `limitations`에 싣는다.

### `method-handle`의 선택적 분기 근거 (v1 확장)

`method-handle` 사실은 선택적 `handlerScope`와 `dependencies`를 함께 실을 수 있다.
필드 형태·상한·완전성 의미는 [BRIDGE-MESSAGES](BRIDGE-MESSAGES.md)의 "handler별 의존
근거" 절과 같으며, 차이는 범위가 가리키는 것뿐이다. `handlerScope`는 감싸는 핸들러
선언 안에서 이 메서드로 귀속한 분기(예: `switch`의 `case "m"` 절, `if call.method == "m"`
의 참 분기)의 소스 범위다. `scope: "handler"` 의존은 그 분기 안의 관찰된 사용 관계이고,
`scope: "registration"` 의존은 감싸는 핸들러 선언 안에서 어떤 메서드 분기 범위에도
속하지 않는 공유 부분이다. Objective-C 사실(`sourceLanguage: "objective-c"`)은 분기
근거를 싣지 않는다.

소비자는 **한 `(channel, method)` 경로의 언어 심볼로 귀속 가능한 수신 사실이 전부
완전한 분기 근거를 가질 때만** 범위별 전파를 적용한다. 그때는 도달한
dependency/dispatch 후보에서만 해당 경계로 전파하고, 수신 선언과 등록
(`channel-register`) 위치는 직접 변경 대상으로 선택된 경우에만 경계를 연다.
귀속 불가능한 Objective-C 사실은 분기 근거를 가질 수 없으므로 이 판정에서 제외하고
기존처럼 공백 증거로 남는다. 근거가 없거나 불완전한 수신 사실이 하나라도 있으면
기존 넓은 후보를 보존하고 정밀도 공백을 알린다 — 등록 선언이 도달되면 그 안의
모든 경계를 보고하는 기존 동작이다. 옛 v1 소비자는 이 두 필드를 모르는 추가 필드로
제거하므로, 이 확장을 내는 생산자와 읽는 소비자의 배포 순서는 자유다.

`location`은 `relation-decl`을 제외한 모든 kind에서 필수다 — live catalog 선언에는
소스 위치가 없으므로 그 kind만 생략할 수 있다(아래 persistence 절).
`location.path`는 프로젝트 루트 기준 상대 경로다. 절대 경로, `..` 상위 이동, 제어 문자를 넣지 않는다.
`location.line`과 `location.column`은 1부터 시작하며, `column`은 해당 줄의 UTF-8 바이트
오프셋에 1을 더한 값이다. 생산자는 언어 런타임의 UTF-16 또는 Unicode scalar 열을 그대로
내보내지 않는다.
소비자는 이 조건을 어긴 문서를 거부해 로컬 경로 노출과 후속 출력 문법 오염을 막는다.
프로젝트 경로와 채널·메서드·심볼 이름에도 제어 문자를 넣지 않는다.
NEL(U+0085)과 Unicode 줄·문단 구분자(U+2028/U+2029)도 허용하지 않는다.
식별자(프로젝트 경로·위치 경로·채널·메서드·심볼 이름·도구 이름·스코프 채널)에 유효하지 않은 유니코드 코드 포인트인 짝 없는 서러게이트(lone surrogate, U+D800~U+DFFF)도 허용하지 않으며(소비자는 `toWellFormed()`로 검증), 이를 어긴 문서는 URI 인코딩 등 하류 출력 파이프라인의 오작동을 막기 위해 파싱 단계에서 거부한다.
`limitations` 문자열은 원인 설명이라 문장을 자유롭게 쓸 수 있고 소비자가 내용을
검증하지 않는다. 소비자의 텍스트 출력(DOT·Mermaid 주석 등)에는 제어 문자를
제거해 넣고, JSON 출력은 인코딩이 이스케이프를 맡는다.
`generatedAt`은 문서를 추출한 시각이다. source mtime이나 compiler index 생성 시각을
대신 넣지 않는다. v1·v2 문서는 선택적 `sourceModifiedAt`으로 이번 추출에서 읽은
소스 파일의 최신 filesystem mtime을 별도로 보존할 수 있다. 읽은 파일이 없거나 mtime을
측정하지 않았으면 생략한다. archive가 고정한 오래된 mtime도 그대로 관찰값이며,
추출 시각보다 미래여도 거부하거나 추측해 교정하지 않는다.
두 필드 모두 timezone이 명시된 ISO 8601 날짜·시각이어야 한다. 생산자는 입력 offset을
UTC로 변환하고 밀리초 세 자리의 `YYYY-MM-DDTHH:mm:ss.SSSZ` 형식으로 정규화한다.
입력 간 추출 시각 차이는 `generatedAt`만 비교한다. 어느 시각도 compiler snapshot과
현재 source의 일치, 실제 앱 실행, 분석 완전성을 입증하지 않는다. 이를 확인하는
build witness와 `limitations`는 별도로 유지한다. 기존 kartograph 0.12.0 이하의
기본 `generatedAt`은 source mtime이었으므로 다른 생산자와 비교한 시각 차이를
빌드 노후화로 해석하지 않는다. 소비자는 버전을 보고 시각을 임의로 교체하지 않는다.
소비자는 버전 1에 정의되지 않은 추가 필드를 검증 경계에서
제거하고, 위치의 줄·열은 1 이상의 안전한 정수만 허용한다.

### 이름 경계 사실의 선택적 `mechanism` 필드 (v1 확장)

`target: "react-native"` 문서 안에는 코어 RN 경로와 Expo Modules 경로가
공존한다 — Expo는 별도 target이 아니다. `requireNativeModule`의 해석 순서가
`expo.modules` → `NativeModulesProxy` → **`TurboModuleRegistry` 폴백**이라
코어 RN 모듈도 만족시키는데, 별도 target으로 나누면 이 폴백이 거짓 미수출
오류를 만든다. 대신 이름 경계 사실 네 종류(`module-import`·`module-export`·
`component-require`·`component-export`)에 선택적 `mechanism: "core" | "expo"`
를 둔다. 생략은 `core`다 — 이 필드가 없던 문서는 모두 코어 RN만 기술했다.

- 생산자는 관찰한 API가 어느 경로로 해석되는지 알 때만 실는다. 어떤 경로인지
  알 수 없는 사실에는 필드를 생략해(=`core`) 추측을 싣지 않는다.
- 허용 값은 `"core"`·`"expo"`뿐이고 다른 target 문서의 사실에는 실을 수 없다.
  소비자는 잘못 놓인 mechanism을 모르는 필드로 버리지 않고 문서를 거부한다 —
  추가 필드 제거는 정의되지 않은 필드에만 적용된다.
- 옛 소비자는 모르는 추가 필드로 버린다 — 기존 `(target, 이름)` 조인은 유지되고
  mechanism 불일치 구분만 사라진다.

### `module-import`의 선택적 `optional` 필드 (v1 확장)

호출 측 API마다 모듈 부재 의미가 다르다. `requireOptionalNativeModule`·
`TurboModuleRegistry.get`·`getNullable`은 부재 시 던지지 않고 `null`을
돌려주지만, `requireNativeModule`·`getEnforcing`·`NativeModules.X` 접근은
부재를 호출자가 감당한다는 신호가 아니거나 그대로 크래시다. 부재를 허용하는
API로 관찰한 `module-import`에만 `optional: true`를 실을 수 있다.

- 미수출 그룹의 호출자가 **전부** `optional`이면 `module-import-without-export`
  error 대신 `module-import-without-export-optional` warning으로 내린다 —
  부재가 호출자에게 관찰 가능한 정상 경로다. 던지는 호출자가 하나라도
  섞이면 그 호출 지점은 부재 시 크래시하므로 error를 유지한다.
- 다른 종류의 사실에는 실을 수 없고 `true`가 아닌 값은 문서 거부다.
  옛 소비자는 모르는 필드로 버린다 — 미수출은 종전대로 error로 읽힌다.

`channel: null`은 `method-handle`에서만 허용하며, "채널이 없다"가 아니라 생산자가
핸들러를 어느 채널에 귀속할지 **모른다**는 뜻이다. 소비자는 이 사실을 조인하지 않고,
호출 없는 핸들러 같은 불일치에도 포함하지 않는다. 생산자는 그 수와 원인을 정확히
`unattributed-method-handles:`로 시작하는 limitation으로 알려야 하며, 없으면 소비자는
문서를 거부한다.

FFI·JNI 등 채널 계약 밖의 네이티브 interop은 fact로 만들지 않는다 — 심볼 이름 조인은
런타임 결정 구조라 정적 채널 키로 귀속할 수 없다. 대신 생산자는 소스에서 interop
근거(dart:ffi 계열 import, `@_cdecl`·Dart C API·dlsym, `external fun`·`System.loadLibrary`·
`native` 메서드·JNI export 이름, Go의 `import "C"`·`//export`)를 관측하면
`unscanned-ffi-interop:`로 시작하는 limitation에 파일 수를 실어 알린다. 이 라벨은
정보성이다 — 파일 수준 표식만으로는 어느 채널의 호출·핸들러가 interop으로 가려졌는지
귀속할 수 없으므로 소비자의 공백 심각도를 바꾸지 않고 그대로 전달한다.
어느 문서에나 실을 수 있다.

### `platform: "go"` (v1 확장)

Go는 cgo(`import "C"`·`//export`)와 gomobile처럼 심볼 이름 경계의 interop을 쓴다 —
채널·이름 리터럴 계약의 호출/수신 fact 종류로 귀속할 수 없다. 그래서 bridge
target에서는 go 문서가 `facts`를 비워 두고 `unscanned-ffi-interop:` limitation만
실는다. 예외는 `target: "persistence"`뿐이다 — 그 도메인에서 go는 호출 측
생산자다(아래 persistence 절).

- bridge target 관점에서 go는 호출 측도 수신 측도 아니다 — bridge target 문서에
  go bridge kind 사실이 있으면 입력 오류로 거부한다.
- bridge 도메인 입력의 호출 측(dart·js)·수신 측(swift·kotlin) 최소 하나 요건을
  go 문서는 어느 쪽으로도 채우지 않는다 — bridge 도메인에서 go만 있는 입력이나
  한쪽+go만 있는 입력은 기존과 같이 거부된다.
- go 문서의 limitation은 다른 문서의 공백 심각도를 바꾸지 않는다 — 수신 측 공백
  완화는 swift·kotlin 문서의 한계에만 적용된다. persistence 도메인에서는
  go 문서가 호출 측이라 그 문서의 한계도 호출 측 한계다.
- bridge 도메인에서 go 문서는 사실이 없으므로 `target`은 `null`이다.
  `persistence` 외의 비null target은 입력 오류다.
- gomobile bind 경계는 소스 표식이 없어 정적으로 관측되지 않는다 — 생산자가
  추측해 신고하지 않는다.

### `platform: "rust"` (v1 확장)

Rust의 비Rust 경계는 PyO3·cbindgen·UniFFI·wasm-bindgen 같은 FFI 계열로
심볼 이름 경계의 interop이다 — go와 같은 이유로 bridge target에서는
사실을 내지 않는다. 규칙은 go 절과 같다:

- bridge target 관점에서 rust는 호출 측도 수신 측도 아니다 — bridge target을
  선언한 rust 문서나 bridge kind 사실을 실은 rust 문서는 입력 오류로 거부한다.
- bridge 도메인 입력의 호출·수신 측 최소 요건을 rust 문서는 어느 쪽으로도
  채우지 않는다.
- bridge 도메인에서 rust 문서는 사실이 없으므로 `target`은 `null`이다.
  `persistence` 외의 비null target은 입력 오류다.
- 예외는 `target: "persistence"`뿐이다 — 그 도메인에서 rust는 호출 측
  생산자다(아래 persistence 절).

### `target: "persistence"` (v1 확장)

언어 코드가 SQL 스키마 객체를 이름으로 참조하는 경계다. 호출 측은 코드를 읽는
생산자(`platform: "go"`의 gartograph, `platform: "rust"`의 rustograph,
`platform: "kotlin"`의 kartograph, `platform: "swift"`의 cartograph,
`platform: "dart"`의 dartograph 등),
수신 측은 스키마 카탈로그를 읽는 `platform: "sql"` 문서(schemagraph)다. 이 target 안에서는 sql이 유일한 수신
측이고 나머지 플랫폼은 모두 호출 측이다 — 호출 측 언어가 늘어나도 계약은
그대로다.

| kind | 누가 내는가 | 뜻 |
|---|---|---|
| `relation-use` | sql 외 플랫폼 | 코드가 관계(테이블·뷰·materialized view) 이름을 참조했다 |
| `relation-decl` | sql | 스키마 카탈로그가 관계를 선언한다 |

두 kind 모두 `channel`에 관계 이름을 싣는다. 선언 측은 항상 `schema.name`
한정 형태를 쓰고, 사용 측은 코드에 쓰인 그대로(한정·비한정 모두) 쓴다 —
인용 부호는 생산자가 벗겨 낸다. `method`는 이 도메인에서 컬럼 이름이다:
`method`를 가진 `relation-use`는 (관계, 컬럼) 참조, `method`를 가진
`relation-decl`은 그 관계의 컬럼 선언이다. 컬럼 참조는 관계 참조를 함축하지
않는다 — 생산자는 관계 사실과 컬럼 사실을 각각 별도로 낸다.

`relation-decl`만 `location`을 생략할 수 있다 — 카탈로그 객체에는 소스 위치가
없다. 대신 `symbol.qualifiedName`에 `schema.object[.member]` 정규 id를 싣고,
생산자의 안정 정점 식별자가 있으면 `symbol.usr`에 넣는다. `relation-use`의
`location`은 기존 규칙 그대로 필수다. `relation-decl`은 카탈로그 이름이
항상 리터럴이므로 `dynamic: false`다.

조인 규칙 (persistence 도메인):

- 조인 키는 소문자로 접은 관계 이름이다. SQL 방언마다 대소문자 규칙이 달라
  소비자는 기본 Unicode 소문자 접기로 비교한다. 이름 안의 `.`는 한정
  구분자다 — 이름 자체에 `.`가 들어간 객체는 생산자가 `%2E`로 escape해 낸다.
- 한정 사용(`a.b`)은 접은 한정 선언과 정확히 같을 때만 잇는다. 비한정
  사용(`b`)은 마지막 세그먼트가 같은 선언과 잇는다 — 후보가 하나면 match,
  둘 이상이면 어느 선언인지 추측하지 않는다. 모호한 사용은 match도
  missing도 아닌 `ambiguous-relation-use` 경고로만 보고한다.
- `method`를 가진 사용은 (해석된 관계 키, 접은 컬럼) 쌍으로 조인한다 —
  관계가 맞았어도 그 관계의 해당 컬럼 선언이 없으면 `column-use-without-decl`이다.
- 진단: `relation-use-without-decl`은 error다 — 코드가 선언되지 않은 관계를
  참조하는 것은 깨진 쿼리·드리프트의 근거다. `relation-decl-without-use`는
  warning이다 — 스캔된 코드가 참조하지 않는 스키마 객체는 dead-schema
  후보지 삭제 판정이 아니다. 컬럼 선언의 미사용은 흔하고 신호가 약아
  `column-decl-without-use` 진단은 만들지 않는다.
- 심각도 완화: sql 문서가 `catalog-coverage:`로 시작하는 limitation을
  신고하면(읽지 못한 스키마·스캔 범위 제한 같은 수신 측 공백)
  `relation-use-without-decl`·`column-use-without-decl`을 `-unverified`
  경고로 내린다 — 모르는 한계를 공백으로 넓게 읽지 않고 알려진 접두사만
  인정하는 기존 규칙과 같다. 소비자가 직접 센 `unjoined-dynamic-relations`
  (조인하지 못한 dynamic·비해석 관계 사용 수)는 호출 측 공백이라
  `relation-decl-without-use`의 `-unverified` 판정 근거다.
- `platform: "go"`·`"rust"`의 "사실을 담지 않는다" 규칙은 이 target에서만
  풀린다 — 이 문서들은 `relation-use`만 실을 수 있고 그때 `target`은
  `persistence`다.
- 입력 구성: `target: "persistence"` 문서가 하나라도 있으면 persistence
  도메인 입력으로 보아, sql 문서 최소 하나와 `target: "persistence"`인 비sql
  문서 최소 하나를 요구한다. `platform: "sql"`이지만 사실이 없는 문서
  (`target: null`)는 이 도메인을 만들지 않는다 — 카탈로그를 못 읽은 빈
  문서가 bridge-only 조인을 막아서는 안 된다. `target: null`
  문서는 이 도메인의 호출 측으로 세지 않는다 — 스키마 경계를 스캔하지 않은
  문서를 "참조 없음"으로 읽으면 모든 선언이 거짓 미사용으로 보고된다.
  bridge 도메인 문서가 함께 들어오면 두 도메인의 구성 요건을 각각 검사한다.

### 종류별 의미

| kind | 누가 내는가 | 뜻 |
|---|---|---|
| `channel-create` | Dart / JS | 호출하는 쪽이 채널 객체를 만들었다 |
| `channel-register` | Swift / Kotlin | 받는 쪽이 채널에 핸들러를 달았다 (`setMethodCallHandler`). 위치도 생성자가 아니라 이 호출을 가리킨다 |
| `method-invoke` | Dart / JS | `invokeMethod('m')` 호출 |
| `method-handle` | Swift / Kotlin | 핸들러 안에서 `case "m":` 또는 동등한 분기 |
| `module-export` | Swift / Kotlin | RN `RCT_EXPORT_MODULE(Name)`, `@ReactModule(name=)`; Expo `Module` DSL `Name("N")` |
| `module-import` | JS | `NativeModules.Name`, `TurboModuleRegistry.get('Name')`; Expo `requireNativeModule`·`requireOptionalNativeModule` |
| `component-export` | Swift / Kotlin | RN `RCT_EXPORT_VIEW_PROPERTY` 등 뷰 매니저; Expo `View(V.self)` DSL |
| `component-require` | JS | `requireNativeComponent('Name')`; Expo `requireNativeViewManager('Name')` |
| `relation-use` | sql 외 (v1: Go·Rust·Kotlin·Swift·Dart) | 코드의 관계·컬럼 이름 참조 — SQL 리터럴, struct 태그, 쿼리 빌더 |
| `relation-decl` | sql | 카탈로그의 관계·컬럼 선언 — `channel`은 `schema.name` 한정 |

RN 의 메서드는 `method-invoke`(JS: `NativeModules.Name.method()`) / `method-handle`(네이티브: `RCT_EXPORT_METHOD(method:)`, `@ReactMethod fun method`) 로 같은 종류를 쓴다. `channel` 자리에 모듈 이름이 들어간다.

`module-*`과 `component-*`는 이름 기반으로 조인된다. isthmus는 JS 호출 측과
Swift/Kotlin 수신 측의 같은 이름을 (target, `channel`=모듈·컴포넌트 이름) 키로
연결한다. JS 측은 내장 추출기 `isthmus extract-js`가 무의존 토큰 스캔으로 낸다 —
`NativeModules.X`·`NativeModules['X']`·`TurboModuleRegistry.get*('X')`·
`requireNativeModule`/`requireOptionalNativeModule`·`requireNativeComponent`·
`codegenNativeComponent`·`requireNativeViewManager`와 같은 파일·상대 import·
`export { A as B } from` 형태의 배럴 재수출(4홉 상한) 범위의 바인딩 해석,
그리고 확정된 모듈 식의 멤버 호출(`method-invoke`)까지 읽는다.
비리터럴 이름·메서드는 원문 표현식을 실은 `dynamic: true` 사실로 보존하고,
계약이 허용하지 않는 리터럴(빈 이름·제어 문자 포함)도 정적 이름이 아니라
동적 사실로 내린다. Expo 전용 API 이름(`requireNativeModule`·
`requireOptionalNativeModule`·`requireNativeViewManager`)은 Expo 패키지
specifier의 import·`import { api as alias }` 별칭·CJS
`require('expo…')` 바인딩으로 확인되거나, 어떤 가져오기·로컬 선언도 없이
호출되면 `mechanism: "expo"`를 싣는다 — 코어 RN에는 같은 이름의 진입점이
없다. 반대로 같은 이름이 로컬에 선언됐거나(같은 파일 래퍼·쉼) Expo가 아닌
specifier에서 가져온 동명 래퍼면 해석 경로를 알 수 없어 mechanism을
생략하고, 같은 이름의 매개변수가 가리는 호출도 생략한다.
`function NAME(...)` 선언부는 호출로 읽지 않는다. 부재를 허용하는 조회
(`requireOptionalNativeModule`, `TurboModuleRegistry.get`·`getNullable`)로
관찰한 `module-import`에는 `optional: true`를 싣고, 던지는 조회
(`requireNativeModule`, `getEnforcing`)·`NativeModules.X` 접근·컴포넌트
require에는 싣지 않는다.
스캔 집합을 벗어난 바인딩(패키지 import, 함수 결과,
인스턴스 상태)은 `limitations`로만 보고한다 — 정적 이름을 추측해 연결하지
않는다. 함수·메서드·`{…}` 본문을 가진 화살표의 매개변수는 그 본문 안에서
파일 바인딩을 가리는 것으로 처리하지만, 식 본문 화살표(`M => M.x()`)·
`for`/`catch` 등 선언문 밖의 바인딩·`export * from` 재수출은 추적하지 않는다.
토큰 스캔은 완전한 JS 의미 해석이 아니므로 이 추출기의 출력은 관찰 범위의
근거다.

## 조인 규칙 (isthmus 가 적용)

- `channel-create` ↔ `channel-register`: `channel` 이 같다. 플랫폼별로 따로 맞춘다 (Swift 와 Kotlin 이 각각 등록하는 것이 정상)
- 생성 없는 `channel-register`는 호출 측 사용을 찾지 못한 경고로 보존한다
- `method-invoke` ↔ `method-handle`: `(channel, method)` 가 같다
- `module-import` ↔ `module-export`: `(target, channel=모듈 이름)`이 같고
  mechanism이 도달 가능해야 한다. `mechanism: "expo"`인 import는
  TurboModuleRegistry 폴백이 있어 core·expo export 모두와 잇고,
  core(생략 포함) import는 core export만 만족시킨다. export를 찾지 못한
  import는 error, import를 찾지 못한 export는 warning이다. 다만 미수출
  그룹의 호출자가 전부 `optional`이면(부재 시 `null`을 돌려주는 API로만
  관찰) error 대신 `module-import-without-export-optional` warning이다.
  같은 이름의
  export가 mechanism만 다르게 관찰된 호출은 error가 아니라
  `module-import-mechanism-mismatch` warning이다 — 코어 호출이 Expo export에
  실제로 도달하는지의 상호운용은 아직 미해결이다. 반대 방향도 같다 —
  호출이 mechanism만 다르게 관찰된 export는 `module-export-mechanism-mismatch`
  warning이다. 불일치 진단은 양쪽 증거 위치를 함께 실는다
- `component-require` ↔ `component-export`: `(target, channel=컴포넌트 이름)`이
  같고 mechanism이 같아야 한다 — `requireNativeViewManager`에는 모듈과 같은
  폴백이 없다. export를 찾지 못한 require는 error, require를 찾지 못한
  export는 warning이다. 코어 require×expo export처럼 상호운용이 미해결인
  불일치만 `component-require-mechanism-mismatch` warning이다; expo
  require에 코어 export만 관찰된 경우는 확정된 미수출로 error를 유지한다.
  export 쪽의 대칭 불일치는 `component-export-mechanism-mismatch` warning이다
- 한 이름 아래 mechanism이 섞이면 그룹 전체가 아니라 호출·수신 증거 쌍 단위로
  판정한다. 만족한 호출자와 도달한 수신자만 매치로 고정하고 나머지는 각각
  미수출·미호출 증거로 남기므로, 한 이름이 매치·미수출·미호출 결과 둘 이상에
  동시에 나타날 수 있다
- `dynamic: true`이거나 `channel: null`인 사실은 조인하지 않고 `limitations`로 센다. 조인할 수 없다는 이유로 불일치라고 판정하지 않는다.
  세는 주체는 소비자다. isthmus는 조인에서 제외한 dynamic 사실을 직접 세어 자신을 출처(`tool: "isthmus"`)로 밝힌 limitation으로 내보내며, 같은 위치의 중복 사실은 한 번만 센다. 생산자의 `dynamic-*` limitation은 원인을 설명하는 추가 정보이지 소비자가 신뢰의 근거로 삼는 값이 아니다. `channel: null` 핸들러도 같다. 생산자의 `unattributed-method-handles:` 신고가 없으면 문서를 거부하지만, 신고한 개수는 검증하지 않고 소비자가 실제 사실 수를 다시 센다
- 수신 측이 스스로 신고한 분석 공백은 심각도에 반영한다. 소비자는 `objective-c-sources:`·`shadowed-flutter-method-channel:`(등록과 핸들러를 모두 가림), `opaque-handler-bodies:`(핸들러를 가림)를 수신 측 플랫폼 문서에서 발견하면 "핸들러 없는 호출"과 "등록 없는 채널 생성"을 error가 아니라 판정 불가(`-unverified` 경고)로 보고한다. 소비자가 직접 센 `unjoined-dynamic-methods`·`unjoined-unattributed-handlers`는 핸들러를, `unjoined-dynamic-channels`는 등록을, `unjoined-dynamic-exports`는 모듈·컴포넌트 export를 가리는 공백으로 본다 — 이 경우 "export 없는 import·require"도 error가 아니라 판정 불가(`-unverified` 경고)다. 알려진 접두사만 인정한다. `unjoined-` 접두사는 isthmus가 직접 세고 `origin: "consumer"`를 붙인 한계에만 유효하다. 이 출처는 입력 문서에서 복사하지 않는다. 생산자가 tool 이름을 isthmus로 적거나 같은 접두사를 차용해도 자체 계수의 근거가 되지 않는다. 모르는 한계를 공백으로 넓게 해석하면 진짜 불일치가 경고로 묻힌다. 호출 측 플랫폼의 한계는 네이티브 코드를 가리지 않으므로 심각도를 바꾸지 않는다.
  이 접두사들은 계약이다. 생산자는 문구를 바꿀 때 접두사를 유지하고, 새 공백 종류를 추가하면 소비자의 목록도 함께 갱신한다. 목록이 닫혀 있으므로 갱신 전까지는 그 공백이 error로 보고된다(안전한 방향).
  완화 단위는 진단의 target이다. 사실은 target별로만 조인되므로 target을 가진 수신 문서가 신고한 공백은 그 target 진단의 심각도만 낮춘다. `unjoined-dynamic-exports`는 소비자 계수라 채널 범위를 갖지 않아 같은 target의 미수출 진단 전체를 완화한다 — "어떤 수신 문서에도 export가 없다"는 판정은 한 수신 플랫폼의 동적 export 사실 하나로도 반증될 수 있으므로 플랫폼을 가르지 않는 것이 맞다. 단 특정 플랫폼에서만 export가 빠진 경우와 "어디에도 없다"를 이 진단은 구분하지 못한다. 사실이 없는(`target: null`) 수신 문서의 공백은 어느 target의 분석을 가리는지 귀속 근거가 없어 모든 target에 적용한다. 같은 target에 귀속된 수신 문서가 사실과 함께 공존해도 마찬가지다. 수신 문서 여러 개가 소스 트리를 나누어 가졌을 수 있어, 귀속 없는 문서가 본 소스가 해당 target의 핸들러를 가릴 가능성을 배제할 수 없기 때문이다. mixed-targets 문서의 한계도 선언한 target을 신뢰할 수 없어 귀속 없이 남긴다. 선택적 limitationScopes가 있으면 같은 target 안에서도 그 채널에만 적용한다. 범위가 없으면 기존 전체 적용을 유지한다. 같은 이유로 `objective-c-sources:`처럼 소비자가 직접 셀 수 없는 공백은 생산자의 신고를 그대로 믿는다. 과다 신고는 진짜 불일치를 경고로 묻고, 과소 신고는 거짓 error를 남긴다
- 위치는 증거이지 조인 키가 아니다. 같은 `(channel, method)` 사실이 여러 위치에 있어도 존재 여부는 키 집합으로 판단하고, 위치는 모두 증거로 보존한다
- 한 번의 조인에 넣는 모든 문서는 정확히 같은 `project` 문자열을 가져야 한다. 다른 프로젝트의 같은 채널 이름을 연결하지 않기 위해 불일치는 입력 오류로 거부한다
- 생산자는 `project`를 내보내기 전에 **POSIX realpath**(`realpath(3)`)로 정규화한다. 결과는 항상 symlink·`..`·중복 슬래시가 접힌 절대 경로다. 프로젝트 경로를 해결할 수 없거나 결과가 이 계약이 금지하는 제어 문자(NEL과 U+2028/U+2029 포함)를 포함하면 생산자는 문서를 내보내지 않고 실패한다 — 소비자에게 거부될 문서를 내보내지 않는다. 버전 1은 POSIX를 가정하며, Windows 정규화(드라이브 문자 대소문자, `\\?\` 접두사)는 Windows 지원 시 별도 합의한다. kartograph의 목표 기준은 JVM `Path.toRealPath()`다
- `project`는 생산자가 선언한 **조인 루트**다. 모든 사실의 `location.path`는 이 루트 기준 상대 경로이며, 모노레포에서 분석 루트와 조인 루트가 다르면 생산자가 위치를 조인 루트 기준으로 재기준화해 내보낸다. 생산 후에 문서의 `project`만 손으로 고쳐 쓰는 것은 조인 루트 선언이 아니다 — `location.path`가 다른 트리를 가리키게 되어 계약 위반이다. 선언 방법은 생산자 옵션이고 우선순위는 명시 옵션 > 자동 감지 > 분석 루트다. dartograph(0.5.0): `--project <shared-root>`는 스캔 범위를 위치 인자로 둔 채 `project`와 `location.path`를 공유 루트 기준으로 재기준화하고, 공유 루트는 realpath 정규화 후 package root를 포함하거나 동일해야 하며(위반은 사용 오류), pub workspace 자동 감지는 스캔 루트 pubspec의 `resolution: workspace` 선언 시 `workspace:` 키를 가진 가장 가까운 조상 pubspec 디렉터리(Melos의 워크스페이스 루트 정의와 동일)를 realpath로 채택한다. 자동 감지 실패(조상 루트 부재·pubspec 파싱 불가)는 분석 루트로 폴백하되 `pub-workspace-root-not-found`·`pub-workspace-pubspec-unparsed` limitation을 실어 조인 기준 어긋남을 조용히 넘기지 않는다 — 둘은 호출 측 한계라 isthmus는 심각도를 바꾸지 않고 그대로 전달한다. cartograph의 `--project`는 분석 루트 자체이므로 realpath 정규화 규칙만으로 이 정의를 만족한다. 조인 가능 여부는 소비자 설치본으로 왕복 실측했다(dartograph#38·#52: 모노레포 2패키지의 `project` 문자열 일치와 isthmus check 조인 성공, 옵션 없는 구행동 문서의 거부까지 양방향)
- 소비자는 정확한 문자열 일치를 유지하며 경로를 스스로 해결하지 않는다(isthmus는 JSON 파일만 읽는다). 소비자는 정규화 이행 여부를 검증할 수 없다 — 검증 가능한 것은 문서 간 `project` 문자열 일치뿐이고, 정규화 위반은 오직 조인 입력 오류로만 관측된다. realpath가 수렴시키는 것은 symlink·`..`·슬래시 축뿐이다. Unicode NFC/NFD 표기 차이, 대소문자 무시 파일시스템의 표기 차이, 마운트 별칭은 같은 디렉터리에 다른 문자열로 남고 불일치로 거부된다(안전하지만 디버깅이 필요하다). 근거: 같은 정규화가 없으면 macOS의 `/tmp`↔`/private/tmp`처럼 같은 디렉터리가 도구마다 다른 문자열이 된다(isthmus에서 재현). cartograph는 Foundation의 `resolvingSymlinksInPath().standardizedFileURL.path`가 `/private/tmp`을 `/tmp`으로 출력함을 실측하고 주입된 POSIX realpath를 채택했고(cartograph#73, 0.10.1 — 실측 입출력 쌍은 그 PR 본문 참조), dartograph의 `Directory.resolveSymbolicLinks()`는 POSIX에서 같은 기준을 만족한다
- 조인 입력 구성 요건은 도메인별로 적용한다. bridge 도메인 문서는 명시 규칙으로
  판정한다: `target`이 `flutter`·`react-native`·`capacitor`이거나, `target`이
  `null`이고 `platform`이 dart·js·swift·kotlin인 문서다. `persistence` target
  문서는 플랫폼이 kotlin·swift·dart여도 bridge 문서가 아니다 — 이 플랫폼들은 여러
  도메인의 생산자라 platform만으로 역할을 정하면 다른 도메인 문서가 bridge 근거로
  샌다. bridge 도메인 문서가 있으면 그중 호출 측 플랫폼(dart·js) 문서와 수신 측
  플랫폼(swift·kotlin) 문서가 각각 최소 하나 있어야 한다. 한쪽만 있는 입력은 한쪽
  관찰을 경계 불일치로 오독할 수 있으므로 소비자는 입력 오류로 거부한다. 사실이
  없는 문서도 해당 플랫폼이 분석됐다는 근거로 인정한다. 그래서 관계 사용을 하나도
  찾지 못한 kotlin·swift·dart persistence 생산 결과(사실 0건, `target: null`)도
  bridge 문서로 세지며, persistence 입력에 이런 문서만 bridge 쪽으로 남아 요건을
  못 채우면 isthmus는 그 원인(null target)을 오류 문구에 밝힌다. persistence 도메인의
  구성 요건은 위 persistence 절을 따른다
- 같은 판정이 조인 밖에서 bridge 역할을 묻는 곳에도 그대로 적용된다(isthmus 구현
  기준): `retentions`의 수신 측 문서 요건(같은 플랫폼의 persistence 문서는 근거가
  아니라 종료 코드 2), 수신 측 공백 한계의 완화 근거, `impact --runtime`의 정적 후보
  플랫폼, preflight context의 bridge 문서(persistence 문서는 원인 문구로 거부),
  `diff`의 스냅샷 구성. `diff`는 아직 persistence 비교를 지원하지 않으므로
  `persistence` target 문서나 sql 문서가 한 스냅샷에라도 있으면 일반 구성 문구가 아닌
  원인 문구로 거부한다

생산자는 채널 생성자와 핸들러 등록 사이의 변수 참조를 따라 채널 이름을 `channel-register`에 옮긴다. `FlutterMethodChannel` 객체를 만들기만 하고 핸들러를 달지 않은 코드는 등록 사실이 아니다.

### `target` 호환 규칙

- 사실이 없을 때만 문서의 `target`은 `null`이다
- 사실이 하나 이상이고 한 브리지 메커니즘만 담으면 그 값을 쓴다
- 버전 1에는 사실별 `target`이 없다. 한 Swift 프로젝트에 Flutter와 React Native 사실이
  함께 있으면 생산자는 결정적인 대표값을 쓰고 정확히 `mixed-targets:`로 시작하는
  limitation을 반드시 추가한다
- 소비자는 `mixed-targets` 문서에서 사실별 메커니즘을 복원할 수 없으므로 조인을 보류한다. 생산자는 위의 정확한 표기를 써야 하며, 소비자는 대소문자·앞 공백·콜론 누락처럼 명백한 변형도 fail-closed로 보류한다. 단, `non-mixed-targets`나 `mixed-targets-like`처럼 낱말 내부에 포함된 표기는 다른 의미의 산문이므로 보류 근거로 삼지 않고 단어 경계와 대소문자 무시(`(?<![\w-])mixed-targets(?![\w-])/i`)로 판정한다. CLI 명령은 빈 정상 결과를 내지 않고 도구 실패(종료 코드 2)를 반환한다. 안전한 혼합 프로젝트 지원은 문서를 target별로 나누거나 다음 형식 버전에 사실별 target을 추가한 뒤 제공한다

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
        "caller": { "platform": "dart", "path": "lib/camera.dart", "line": 42 },
        "callers": [
          { "platform": "dart", "path": "lib/camera.dart", "line": 42 },
          { "platform": "dart", "path": "lib/widget.dart", "line": 7 }
        ],
        "callersOmitted": 3
      }
    }
  ]
}
```

cartograph는 `RetentionReason.externalBridge`, kartograph는 `EXTERNAL_BRIDGE`로 매핑하고,
`--explain`에서 채널·메서드·원본 Dart/JS 호출 근거를 보여 준다. `--for cartograph`는
Swift 플랫폼 문서, `--for kartograph`는 Kotlin 플랫폼 문서를 최소 하나 요구한다.
이 확장은 개발 브랜치에 있으며 새 소비 도구와 함께 검증·발행해야 한다.

- `caller` 은 대표 호출 위치다. 결정적 순서(플랫폼·경로·줄·열)의 첫 호출이며
  v0 초안부터 있던 필드라 옛 소비자가 계속 읽는다.
- 선택 `callers` 는 이 근거의 **전체** 호출 위치(대표 포함)를 같은 결정적 순서로
  실는다. 호출이 둘 이상일 때만 두어, 호출이 하나인 근거는 기존 문서와 바이트가
  같다. 근거당 상한은 100개이며, 문서에 실제로 실은 호출 위치 총상한은 1,000,000개다. `callersOmitted` 계수는 저장 위치 수가 아니다.
- 상한을 넘은 호출은 조용히 버리지 않고 선택 `callersOmitted` (비음수 정수,
  0이면 생략)로 밝힌다. `omittedObjectiveCHandlers` 와 같은 계수 공개 원칙이다.
- 소비 도구는 모르는 필드를 무시한다(Swift `JSONDecoder` 의 기본 동작). 그래서
  이 확장은 생산자(isthmus)를 먼저 배포해도 안전하고, 소비 도구가 `callers` 를
  문장으로 치는 것은 별도 구현 사항이다.
- v2 경계의 보존 근거에는 메서드가 없다. literal로 확정된 `message-handle`·
  `stream-handle`·`event-emit`의 대상 플랫폼 심볼을 `evidence.channel`과 호출자/구독자만으로
  싣고 `method`를 생략한다. dynamic prefix 후보는 보존하지 않는다.

cartograph 보존에는 Swift 선언과 실제 Clang USR을 가진 Objective-C 구현을 포함한다.
Clang 구현 파일을 그래프에 포함하는 cartograph 빌드가 선행해야 한다. ObjC 이름으로
Swift USR이나 셀렉터 기반 추측 간선을 만들지 않는다. `omittedObjectiveCHandlers`는
옛 생산 문서의 한계를 읽기 위한 필드로 남지만, 새 isthmus는 식별자 없는 ObjC 매치가
있으면 종료 코드 2로 실패한다.

kartograph 보존은 `symbol.usr`에 생산자가 실제 JVM 그래프에서 얻은 정점 식별자를
요구한다. `qualifiedName` 폴백은 하지 않는다. 소비자는 이 식별자가 현재 그래프에
정확히 존재해야 적용하며, 하나라도 없으면 오래되거나 다른 빌드의 부분 근거로 보아
문서 전체를 거부한다. 외부에서 호출되는 멤버의 소유 타입과 바깥 소유 타입도 MEMBER 관계로 보존하며,
형제 멤버 전체를 보존하지 않는다. module/component 이름 매치만으로는 아직 보존 근거를
생성하지 않는다.

이 문서는 대상 범위 안에서 부분적으로 만들지 않는다. 소비 도구가 읽을 수 있는 수신 측 문서가 입력에 없거나, 호출자가 있는데도 `symbol`이 없어 근거로 바꿀 수 없는 매치 핸들러가 있으면 isthmus는 일부만 담은 목록 대신 도구 실패(종료 코드 2)로 끝낸다. 근거가 빠진 목록은 소비자에게 살아 있는 핸들러를 미사용으로 보이게 하기 때문이다. 문서에 실제로 실은 호출 위치 총상한(1,000,000개)을 초과한 경우에도 부분 근거를 내지 않고 입력을 좁히도록 안내하며 종료 코드 2로 실패한다.

## 자매 도구가 해야 할 일 (선행 작업)

| 도구 | 명령 | 낼 것 | 읽을 것 |
|---|---|---|---|
| cartograph | `bridges --format json` | Swift 의 `FlutterMethodChannel(name:)`, `setMethodCallHandler`, `case "…"`, `RCT_EXPORT_*`, `@objc(…)` | `--external-retentions` |
| dartograph | `bridges --format json` | `MethodChannel(…)`, `invokeMethod(…)`, Pigeon 산출물 | (없음 — Dart 쪽이 부르는 쪽) |
| kartograph | `bridges --format json` | `MethodChannel(…)`, `setMethodCallHandler`, `when (call.method)`, `@ReactModule`, `@ReactMethod` | `--external-retentions` |
| isthmus 내장 | `extract-js` | `NativeModules.*`, `TurboModuleRegistry.get*`, `requireNativeModule`, `requireNativeComponent` 계열, 바인딩 해석된 멤버 호출 | — |
| gartograph | `schema` | Go 소스의 SQL 리터럴 관계·컬럼 이름, `db`/`sql`/`gorm` struct 태그, 쿼리 빌더 호출 (`target: "persistence"`) | (없음 — 코드 쪽이 참조하는 쪽) |
| schemagraph | `facts --document catalog.json` | 카탈로그의 테이블·뷰·컬럼 선언 (`platform: "sql"`, `target: "persistence"`) | (없음 — 스키마 쪽이 선언하는 쪽) |
| rustograph | `schema` | Rust 코드의 관계·컬럼 참조 — sqlx 계열 리터럴·`table!` 매크로·`table_name` 어트리뷰트 (`platform: "rust"`, `target: "persistence"`) | (없음) |
| kartograph | `schema` | Kotlin/Java 소스의 관계·컬럼 참조 — Room 어노테이션·JDBC 호출·Exposed DSL·jOOQ·SQL 리터럴·`.sq`/`.sqm` (`platform: "kotlin"`, `target: "persistence"`) | (없음) |
| cartograph | `schema` | Swift 소스의 관계·컬럼 참조 — sqlite3 인자·GRDB `sql:`·`Table`·`databaseTableName`·SQLite.swift·Fluent·SQL 리터럴 (`platform: "swift"`, `target: "persistence"`) | (없음) |
| dartograph | `schema --format json` | Dart 소스의 관계·컬럼 참조 — sqflite SQL·테이블·컬럼 인자·sqlite3/postgres SQL·drift `Table`·custom 쿼리·`.drift`·floor `@Entity`/`@DatabaseView`/`@Query`·대문자 SQL 리터럴 (`platform: "dart"`, `target: "persistence"`) | (없음) |

**bridge facts 생산의 첫 구현은 cartograph다.** PR #11에서 SwiftSyntax 스캐너와 `bridges --format json`이 버전 1로 구현됐다.

cartograph의 버전 1 구현은 `symbol.usr`을 붙이기 위해 인덱스 스토어를 요구한다. 인덱스가 없으면 불완전한 문서를 내보내지 않고 도구 실패(종료 코드 2)로 끝난다. 이는 문서 형식의 limitation이 아니라 생산 명령의 선행 조건이다.

## Phase 0 결정

- **Swift `case` 귀속**: 감싸는 타입·함수의 `qualifiedName`과, 생산 구현이 가진 안정 식별자(`usr`)를 `symbol`에 넣는다. 사실의 `location`은 `case` 문자열 위치다. Phase 0 SwiftSyntax 실험은 USR을 만들 수 없어 그 수를 `missing-handler-usrs`로 보고한다
- **Pigeon · Turbo Modules codegen**: 버전 1에는 별도 `codegen-resolved` 종류나 플래그를 추가하지 않는다. 생성 코드의 리터럴도 같은 채널·메서드 사실이고 조인 규칙이 같기 때문이다. 버전 1은 생성 여부를 계약에 싣지 않으며, 필요해지면 조인 키를 바꾸지 않는 선택 필드로 추가한다. 소비자는 경로만 보고 사용자 작성 코드라고 가정하지 않는다
- **한 단계 상수 추적**: `const kChannel = '…'`와 Swift `static let`처럼 같은 파일의 문자열 상수 한 단계는 정적 사실로 낸다. 그 이상이거나 보간된 표현식은 원문과 `dynamic: true`로 보존한다
- **구문 해석 한계**: Dart의 해석하지 못한 `invokeMethod` receiver는 `unresolved-receiver-invocations:`, Swift의 named-function handler는 `opaque-handler-bodies:` limitation으로 센다. 로컬 선언이 import된 `FlutterMethodChannel`을 가리면 `shadowed-flutter-method-channel:`로 알리고 사실 생성을 보류한다
- **Swift 조건부 컴파일**: Flutter를 import한 파일에 `#if`가 있으면 활성 구성을 추측하지 않고 compiler-indexed 추출이 필요하다고 실패한다
- **버전 1 승격**: `expected/dart.json`과 `expected/swift.json`을 실제 추출기로 만들고, 채널 1개·메서드 1개 연결, 핸들러 없는 호출 1개, 호출 없는 핸들러 2개를 `expected/join.json`으로 대조해 충족했다

## 개발 중: HTTP 경계 합의 초안

> **개발 중 — 합의 초안, 아직 어떤 소비 명령도 받지 않음.**
> 현재 isthmus는 `target: "http"`와 `platform: "openapi"`·`"python"` 문서를 입력 오류로
> 거부한다. 이 절은 [API 변경 영향 계획](API-IMPACT-PLAN.md)의 계약 제안이다. 위 절들의
> 규범 문장(문서 스키마의 열거, `target` 호환 규칙, project 단일 규칙, 플랫폼 역할 검증,
> 조인 입력 구성 요건)은 이 초안이 합의·구현될 때까지 그대로 유효하다. 구현은 계획의
> Phase마다 필요한 필드만 옮기며, 그때 위 절들을 함께 개정한다.

REST over HTTP 경계다. 서버 라우트 선언, 클라이언트 호출, 스펙 operation을
(HTTP method, 정규 경로 템플릿)으로 잇는다. host는 조인 키가 아니다. GraphQL·gRPC는 키의
의미가 달라 이 target에 넣지 않는다. 결과는 route 단위이며, 요청·응답 본문 필드, query
파라미터, 헤더의 호환성은 판정하지 않는다.

### target과 kind

| kind | 역할 | 내는 플랫폼 | 뜻 |
|---|---|---|---|
| `route-decl` | 서버(선언 측) | `kotlin`(JVM, Java 포함), `js`, `python` | 서버가 라우트를 선언하고 핸들러에 묶었다 |
| `route-call` | 클라이언트(호출 측) | `kotlin`, `swift`, `dart`, `js` | 클라이언트 코드가 HTTP 요청을 만든다 |
| `route-contract` | 계약(선언 측) | `openapi` | 스펙 문서의 operation |

- 역할은 platform이 아니라 **kind**로 정한다. kotlin·js 문서는 서버와 클라이언트를 겸할 수
  있다. 그래서 "Dart/JS는 호출 측 종류만, Swift/Kotlin은 수신 측 종류만" 검증은 이 target에
  적용하지 않고, 위 표의 (kind, platform) 조합만 허용한다.
- swift의 `route-decl`(Vapor 등)과 go·rust·sql의 http 사실은 생산자가 생길 때 합의한다. 그
  전까지는 입력 오류다.
- bridge kind(`method-invoke`/`method-handle` 등)를 route에 재사용하지 않는다. 재사용하면 bridge
  조인·retentions·preflight 경계로 사실이 새어 들어간다.
- 새 platform `openapi`는 target이 `null` 또는 `http`이고 `route-contract`만 낸다. `symbol`에는
  `usr` 없이 `qualifiedName` = operationId를 정보용으로 싣는다. `location`은 스펙 파일 기준의
  줄과 UTF-8 바이트 열이다. `python`은 Python 생산자와 함께 추가하며 target은 `null`·
  `persistence`·`http`다.
- 옛 소비자는 모르는 target·platform 문서를 거부하므로, 배포 순서와 무관하게 조용한 오독이 없다.

### 문서 필드와 사실 0건 문서

- `roles`는 `["server"]`·`["client"]`·`["server", "client"]` 중 하나이며 target `http` 문서에
  필수다. `route-decl`은 roles에 server가, `route-call`은 client가 있는 문서에만 둘 수 있다.
- 기존 "사실이 없을 때만 `target`은 `null`" 규칙에 **http 한정 예외**를 둔다. roles가 비어
  있지 않은 문서는 사실이 0건이어도 target `http`를 유지하고, roles가 없는 0건 문서는 기존대로
  `null`이다. 이 예외는 (1) 호출이 0건인 클라이언트를 "스캔 안 함"과 구분하고, (2) 0건
  kotlin·swift 라우트 문서가 `null`이 되어 bridge 수신 요건을 채우는 누수를 막으며, (3) 사실
  0건 bridge 문서를 분석 근거로 인정하는 기존 규칙을 그대로 둔다.
- `dispatch: "specificity" | "registration-order"`는 `route-decl`을 담은 문서에 필수다(아래
  디스패치 모델).
- 선택 필드: `service`(서비스 신원 문자열), `sourceSets: {"tests": "excluded" | "included"}`
  (테스트 소스를 스캔했는지 선언).
- `service`는 문서와 route 사실 양쪽에 둘 수 있다. 사실의 **유효 service**는 사실 값이 있으면 그
  값, 없으면 문서 값이다. 둘 다 있는데 다르면 입력 오류(종료 코드 2)다. 여러 서비스를 부르는
  클라이언트 문서는 문서 값을 생략하고 사실마다 싣는다. 귀속 게이트와 진단 신원 `scope`는 유효
  service만 쓴다. 해석이 갈려 귀속과 baseline이 달라지지 않게 하기 위해서다.
- bridge 도메인 판정은 명시 규칙으로 바꾼다. target이 `flutter`·`react-native`·`capacitor`
  이거나, target이 `null`이고 platform이 dart·js·swift·kotlin인 문서만 bridge 도메인 문서다.
  target `http`·`persistence` 문서는 bridge 어느 쪽 요건도 채우지 않는다.
- 입력 구성: target `http` 문서가 있으면 link마다(매니페스트가 없으면 조인 전체) 선언 측
  문서(`route-decl`·`route-contract` 사실이 있거나 roles에 server가 있는 문서)와 호출 측
  문서(roles에 client가 있는 문서)가 각각 하나 이상 필요하다. 한쪽만 있으면 입력 오류(종료
  코드 2)다. 예외는 decl과 contract만 비교하는 드리프트 모드와 diff surface 모드다. 선언 측을
  contract 문서만으로 채운 link는 받지만, decl 기반 진단은 평가하지 않는다(아래 error 전제 (f)).

### route 사실 필드

```jsonc
{
  "kind": "route-call",
  "method": "GET",                        // 아래 method 집합
  "channel": "/api/v1/items/{}",          // 정규 경로 템플릿. dynamic이면 원문(길이 상한)
  "dynamic": false,
  "pathAnchor": "root",                   // 필수: root | base
  "authority": "api.example.com",         // 선택: 리터럴 host
  "baseRef": "<base 식의 생산자 id>",       // 선택, route-call 전용
  "service": "example-mobile",            // 선택
  "location": { "path": "core/network/ItemsApi.kt", "line": 42, "column": 9 },
  "symbol": { "qualifiedName": "ItemsRepository.list", "usr": "<생산자 impact id>" }
}
```

- `method`는 `GET`·`HEAD`·`POST`·`PUT`·`PATCH`·`DELETE`·`OPTIONS`·`TRACE` 중 하나이거나 `ANY`다.
  `ANY`는 `route-decl` 전용이다(method 없는 `@RequestMapping`, `app.all`, Django 함수 뷰).
  `route-call`의 동사가 리터럴이 아니면 `method`를 생략하고 `methodDynamic: true`를 단다.
  선언된 래퍼나 라이브러리에 기본 동사가 있으면 그 값을 쓴다.
- `pathAnchor`(필수): `root`는 템플릿이 서버 경로 루트부터 확정됐다는 뜻이다. `base`는 정적으로
  알 수 없는 base 경로 뒤에 붙는다는 뜻이다.
- `authority`는 userinfo를 뗀 리터럴 host다. `baseRef`는 base URL 식의 생산자 id이고 `service`는
  서비스 신원 문자열이다. 셋은 귀속 게이트의 입력이며 조인 키가 아니다.
- `route-decl` 전용: `trailingSlash: "strict" | "optional"`(생략은 unknown),
  `caseInsensitive: true`(증명한 경우만), `narrowed: true`(params·headers·consumes·produces·version
  조건으로 같은 키를 나눈 핸들러), `paramConstraints: [{segment, kind, pattern?}]`(kind는
  `int`·`uuid`·`slug`·`path`·`regex`), `order: {group, index}`(registration-order 문서에서만),
  `configDefault: true`(아래 base 접두사), `catchAllPrefix: true`(아래 0세그먼트 catch-all 펼침).
- `route-call` 전용: `queryTailStripped: true`(끝 보간이 query임을 증명하고 떼어 냄),
  `channelPrefix`(dynamic 호출에서 증명된 리터럴 접두사 템플릿. 후보 표시용이며 판정에 쓰지
  않음), `maskedSegments`(마스킹한 세그먼트 수).
- `route-contract`와 생성 클라이언트의 `route-call`은 증거로 `operationId`를 실을 수 있다.
  `--include-tests`로 낸 사실에는 `testSource: true`를 단다.
- `location`은 모든 route kind에 필수다. 바이트코드 원천이면 값과 usr는 바이트코드에서, 위치는
  소스의 어노테이션 토큰에서 얻는다. 위치를 찾지 못하면 사실을 내지 않고 측에 맞는 접두사로
  센다(decl은 `route-coverage:`, call은 `route-call-coverage:`).
- `symbol.usr`는 `route-decl`이면 핸들러 메서드, `route-call`이면 호출을 감싸는 선언의 생산자
  impact id다.
- 잘못 놓인 필드(call의 `trailingSlash`·`order`, decl의 `baseRef`·`queryTailStripped`, 다른
  target 문서의 route 필드)는 모르는 필드로 버리지 않고 문서를 거부한다. `mechanism`과 같은
  규칙이며, 추가 필드 제거는 정의되지 않은 필드에만 적용된다.

### 정규 경로 템플릿

정규화는 생산자 책임이다. isthmus는 문법만 검증하고, 위반한 문서는 다시 정규화하지 않고
입력 오류(종료 코드 2)로 거부한다.

```text
template    = "/" segment *( "/" segment )    ; 빈 세그먼트 허용(중복·끝 슬래시 보존)
segment     = "{**}" / *( pchar-lit / "{}" )
pchar-lit   = unreserved / pct-encoded / sub-delims / ":" / "@"   ; RFC 3986 pchar
pct-encoded = "%" 대문자-HEXDIG 대문자-HEXDIG                       ; unreserved 문자는 인코딩하지 않음
```

- `/`로 시작하고 scheme·host·query·fragment를 뗀다. 중복 슬래시, 끝 슬래시, 대소문자는
  보존한다. persistence의 소문자 접기를 재사용하지 않는다. `/` 하나는 루트 템플릿이다.
- percent-encoding은 대문자 hex로 쓰고 unreserved 문자는 디코드한다. 리터럴 중괄호는
  `%7B`·`%7D`다.
- 세그먼트 전체가 파라미터면 `{}`로 쓰고, 이름·정규식·변환기는 `paramConstraints`와 증거로만
  남긴다. 세그먼트 일부만 파라미터면 리터럴 골격을 남긴다(`/files/{}.json`).
- `{**}`는 **마지막 세그먼트 전체**에만 올 수 있는 끝 catch-all이며, **세그먼트 1개 이상**과
  맞는다.
- **0세그먼트 catch-all**: catch-all 앞 경로 자체(`/files`)도 받는 프레임워크가 있다(Spring
  `{*path}`, Next `[[...slug]]` 등). `{**}`만 내면 `/files` 호출이 거짓
  `route-call-without-decl`이 되므로, 생산자는 `/files/{**}`와 함께 catch-all을 뗀 접두사
  decl(`/files`)을 하나 더 펼쳐 낸다. 루트 catch-all(`/{*path}`)의 접두사 decl은 `/`다. 어느
  프레임워크·버전·패턴(Spring 끝 `**`, Express 4 `*` 포함)이 0세그먼트나 빈 끝 세그먼트를
  받는지는 착수할 때 공식 소스로 확인해 http-template 벡터에 provenance와 함께 고정한다.
  현재 목록은 추정이다.
- 펼친 접두사 decl에는 `catchAllPrefix: true`를 단다. 목록 엔드포인트 `/files`와
  `/files/{*path}`가 함께 있는 흔한 구성에서 명시적 decl과 구분하기 위해서다.
  - `method`·`symbol`·`location`은 원본 catch-all decl과 같다. 같은 문서에 원본 decl(같은
    method와 `symbol.usr`, 템플릿 = 접두사 + `/{**}`)이 없으면 입력 오류다.
  - specificity 문서에서는 원본 `{**}` decl과 같은 순위로 본다. 그래서 같은 키의 명시적
    decl이 있으면 항상 명시적 decl이 match다. 매칭 품질은 `catch-all`이다.
  - registration-order 문서에서는 원본 decl의 `order`를 그대로 물려받는다.
  - `route-decl-conflict` 대상에서 뺀다. 원본끼리의 중복은 원본 `{**}` decl에서 한 번만
    잡힌다.
- optional 세그먼트는 decl 여러 개로 펼친다. 16개를 넘으면 dynamic과
  `route-template-expansion-capped:`로 낸다. 프레임워크가 자동으로 붙이는 HEAD·OPTIONS는 decl로
  내지 않는다(아래 method 예외가 처리). 중간 `**` 패턴은 버전별 허용 여부를 확인하기 전까지
  dynamic과 스코프가 있는 `route-coverage:`로 낸다.
- isthmus가 검증하는 것은 `/` 시작, pchar·`/`·`{}`·`{**}` 토큰만 있는지, `{**}`가 끝 세그먼트
  전체인지, 제어 문자가 없는지, `%XX`가 대문자 hex인지, unreserved 문자(`A-Z`·`a-z`·`0-9`·`-`·
  `.`·`_`·`~`)를 인코딩하지 않았는지다. 뒤의 둘을 받아 주면 `%2f`와 `%2F`처럼 다르게 정규화한
  생산자끼리 조용히 조인되지 않는다. `:id`처럼 합법 문자로 된 미변환 표기는 소비자가 구분할 수
  없으므로 생산자 적합성 벡터(http-template)가 책임진다. 프레임워크·클라이언트별 변환표(Spring
  `{id:정규식}`, Django `<int:pk>`, Express `:id(정규식)`, AntPathMatcher 조립 차이)도 이 문서가
  아니라 그 벡터에 둔다.

### base 접두사와 클라이언트 결합

- 서버 템플릿에는 정적으로 확정된 접두사를 모두 넣는다(기본 프로필의 리터럴 context-path,
  WebFlux base-path, 클래스×메서드 매핑, 라우터 mount·prefix, 스펙 servers path·basePath).
  확정하지 못한 접두사(기본값이 아닌 `spring.mvc.servlet.path`, 재정의된 플레이스홀더 등)는
  `pathAnchor: "base"`와 `unresolved-route-prefix:`로 낸다. 저장소 안 어느 프로필에서도
  재정의하지 않은 `${key:default}`의 기본값은 `configDefault: true` 증거와 함께 쓸 수 있다.
  환경 변수 재정의는 모델링하지 않는다.
- 클라이언트 base + path 결합은 라이브러리별 네 갈래를 생산자가 적용한다. RFC 3986 방식
  (Retrofit·Ktor·`URL(relativeTo:)`·retrofit.dart base)은 `/x`를 root, `x`를 base로 본다. 슬래시
  결합 방식(axios·chopper·Moya·openapi-fetch)은 base다. dio 단순 연결은 base가 리터럴이면 실제
  결과를 쓰고, 미상이면 `/`로 시작할 때만 base, 아니면 dynamic과 `ambiguous-base-join:`이다.
  base 없는 API는 전체 URL의 host 뒤 경로를 쓰고, host가 동적이면 base다.
- 문자열 보간은 모든 생산자가 같은 규칙을 쓴다. 보간이 세그먼트 전체를 덮으면 `{}`다. 끝
  보간이 query임을 증명하면(값이 빈 문자열이거나 `?`로 시작) 떼어 내고 `queryTailStripped`를
  단다. 증명하지 못하면 dynamic과 `channelPrefix`다. 선언된 래퍼 호출은 `http-wrappers` v1
  선언의 `pathAnchor`를 따른다.

### 조인 규칙 (http)

- 세그먼트 단위로 맞춘다. 리터럴 세그먼트는 정확히 같아야 한다. decl의 `{}`는 비어 있지 않은
  단일 세그먼트와, `{**}`는 세그먼트 1개 이상과 맞는다. call의 `{}`(마스킹된 세그먼트 포함)가
  decl 리터럴에만 맞으면 `param-to-literal` 품질이다.
- `paramConstraints`의 닫힌 종류(`int`·`uuid`·`slug`)는 call 리터럴이 명백히 어길 때 후보에서
  뺀다. `regex`는 방언 차이와 ReDoS 위험 때문에 평가하지 않고 `param-to-literal-constrained`
  후보로 둔다. 이 후보는 구체성 비교에서 빼고 error 근거로 쓰지 않는다.
- method는 정확히 같아야 한다. 예외는 decl `ANY`(`any-method`), call HEAD ↔ decl
  GET(`head-as-get`), call OPTIONS ↔ 같은 경로의 decl(`options-any`)이다. `methodDynamic` call은
  경로만으로 잇되 error 근거가 되지 않는다.
- 끝 슬래시만 다르면 `route-trailing-slash-mismatch`(decl이 `trailingSlash: "optional"`이면
  match), 대소문자만 다르면 `route-case-mismatch`(decl이 `caseInsensitive`면 match)다.
- pathAnchor 조합은 넷이다. decl 자리의 contract(서버 변수를 해석하지 못해 base인 contract
  포함)도 같은 규칙을 쓴다.
  - root call ↔ root decl: 정확 매칭이다.
  - base call ↔ root decl: 세그먼트 경계 suffix 후보다. call에 리터럴 세그먼트가 1개 이상
    있어야 한다.
  - root call ↔ base decl: decl 템플릿이 call 템플릿의 세그먼트 경계 suffix이면 후보다. decl에
    리터럴 세그먼트가 1개 이상 있어야 한다. root decl과 정확 매칭되는 call에는 이 후보를 붙이지
    않는다. 이 후보 위의 method 불일치는 error 근거가 아니며 `route-method-mismatch-unverified`다.
    후보를 찾지 못한 call이 error가 되는지는 아래 error 전제 (c)의 `unresolved-route-prefix:`
    스코프가 정한다.
  - base call ↔ base decl: 잇지 않는다. 두 앵커가 모두 미상이라 꼬리가 같아도 같은 경로라는
    근거가 없다. 이 call은 error 전제 (b)가 거짓이라 `-unverified`로만 남는다.
- 두 suffix 후보 모두 호출당 64개까지다. 후보가 유일하면 `suffix` match, 여럿이면 ambiguous다.
  base decl·base contract의 `route-decl-without-call`·`route-contract-without-call`은 항상
  `-unverified`다. 잇지 않은 base call이 그 경로를 불렀을 수 있기 때문이다.
- root로 승격(`declared-base`)되는 것은 workspace link의 `match.baseRefs`에 `pathPrefix`가
  선언된 baseRef의 호출뿐이다.
- dynamic이거나 `channel`이 null인 사실은 조인하지 않고 소비자가 `unjoined-dynamic-routes`·
  `unjoined-dynamic-route-calls`로 센다. `channelPrefix`는 query·trace에 `prefix-candidate`로만
  보인다.
- 매칭 품질(`exact`·`suffix`·`declared-base`·`declared-wrapper`·`any-method`·`head-as-get`·
  `options-any`·`catch-all`·`param-to-literal`·`param-to-literal-constrained`·`prefix-candidate`)은
  `check --pairs`와 query에만 싣는다. info 심각도는 새로 만들지 않는다.

### 디스패치 모델

- `route-decl` 문서는 `dispatch`를 선언한다. `specificity`에서는 여러 decl이 맞을 때 구체성
  (리터럴 > 부분 세그먼트 > 제약 있는 `{}` > `{}` > `{**}`, 왼쪽 세그먼트부터 비교) 최상위가
  유일할 때만 match이고, 동률이면 `ambiguous-route-call`이다. `registration-order`에서는 같은
  `order.group` 안에서 `index`가 가장 작은 decl이 match이고, group이 다르거나 order가 없으면
  ambiguous다.
- registration-order 생산자는 같은 라우터 체인 안에서 증명한 등록 순서만 `order`로 싣는다.
  증명하지 못하면 `route-dispatch-order-unknown:`을 낸다. 앞선 파라미터 decl이 뒤의 더 구체적인
  decl을 가리면 `route-decl-shadowed` warning이다.
- narrowed decl과 경로 제약만 다른 decl은 모두 match 대상이며 충돌로 보지 않는다.
- 프레임워크별 값은 착수할 때 공식 소스로 확인해 벡터로 고정한다. 현재는 추정이다: Spring
  PathPattern·Fastify·Next·werkzeug는 specificity, Express·Koa·Hono·NestJS(Express 어댑터)·
  Django는 registration-order. Express의 `next()` 위임은 모델링하지 않고 limitation 문구에 적는다.

### 귀속 게이트

- route-call은 다음 중 하나일 때만 그 link의 서버·계약과 비교한다: `authority` ∈
  `match.hosts`, `baseRef` ∈ `match.baseRefs[].ref`, 유효 service ∈ `match.services`, 호출을 감싸는
  선언의 소유 타입 ∈ `match.interfaces`. `interfaces`는 Retrofit·Feign 서비스 인터페이스나 생성
  클라이언트 타입의 생산자 class id다. DI로 빌더와 `create`를 나눈 앱처럼 baseRef를 얻지 못하는
  경우를 위한 사용자 선언이며, 선언으로 귀속한 증거에는 declared 출처를 표시한다.
- 매니페스트가 없으면 call의 유효 service가 선언 측 문서의 service(문서 값이나 그 문서 사실의
  유효 service)와 정확히 같을 때만 자동 귀속한다. 이때 그 선언 측 문서들이 아래 "서버 측"이다.
- 귀속되지 않은 호출은 판정 전제에서 빼고 `unjoined-unbound-route-calls`로 개수만 센다. host
  휴리스틱으로 귀속하지 않는다.

### check 진단 (http)

| 코드 | 심각도 | 조건 |
|---|---|---|
| `route-call-without-decl` | error | 아래 (a)~(f)가 모두 증명될 때만. (f)가 거짓이면 평가하지 않는다. 그 밖에 하나라도 빠지면 `route-call-without-decl-unverified` warning |
| `route-method-mismatch` | error | (a)~(f)에 더해 method가 확정됨. (f)가 거짓이면 평가하지 않고, 그 밖에는 `-unverified` warning |
| `route-call-without-contract` | error | `link.contract.authoritative`, (a), (b), contract 측 `unresolved-contract-servers:`·`contract-coverage:` 없음, (e)가 모두 성립할 때만. 아니면 `-unverified` warning |
| `route-decl-without-call`, `route-contract-without-call` | warning | 문구는 "스캔한 클라이언트 기준 미관찰". 호출 측 공백이 있거나 client roles 문서가 없으면 `-unverified` |
| `route-contract-without-decl`, `route-decl-without-contract` | warning | 같은 link에 decl과 contract가 모두 있을 때의 드리프트 |
| `ambiguous-route-call`, `route-trailing-slash-mismatch`, `route-case-mismatch`, `route-decl-conflict`, `route-decl-shadowed` | warning | `route-decl-conflict`는 narrowed도 제약 차이도 아닌 같은 키 decl의 중복(`catchAllPrefix` decl은 제외) |

error 전제는 다음과 같다. "서버 측"은 link의 server member이고, 매니페스트가 없으면 귀속 게이트가
고른 선언 측 문서들이다.

- (a) 호출이 link에 귀속됐다.
- (b) `pathAnchor`가 `root`이거나 `declared-base`로 승격됐다.
- (c) 서버 측에 이 호출 템플릿을 덮는 서버 측 limitation이 없다. 스코프가 있으면 스코프 기준,
  없으면 서버 측 전체 기준이다.
- (d) 이 템플릿을 덮는 `unjoined-dynamic-routes`가 0이다.
- (e) 테스트 소스 사실(`testSource`)이 아니다.
- (f) 서버 측에 route-decl을 스캔한 문서가 하나 이상 있다. platform이 `openapi`가 아니고
  roles에 server가 있는 http 문서를 말하며, 사실이 0건이어도 센다("스캔했으나 없음").

(f)가 거짓인 link, 곧 선언 측이 contract뿐인 link는 decl을 스캔하지 않은 것이다. 이런 link에서는
`route-call-without-decl`·`route-method-mismatch`와 그 `-unverified` 변형을 내지 않고 contract
코드만 평가한다. 서버 측 문서가 없으면 (c)·(d)가 공허하게 참이 되어, 스펙과 클라이언트만 있는
구성의 귀속된 root 호출이 전부 거짓 error가 되는 것을 막기 위해서다.

진단 신원: http 진단은 기존 code·target·channel·method에 5번째 원소 `scope`(link 이름,
매니페스트가 없으면 service 문자열)를 더한다. 두 link가 같은 (method, template)에 진단을 내도
baseline 억제와 codequality 지문이 섞이지 않게 하기 위해서다. scope가 없는 기존 키는 바이트
단위로 유지한다.

### limitation 접두사와 측

http 문서의 측은 platform이 아니라 **접두사**로 정한다. 한 문서가 서버와 클라이언트를 겸할 수
있기 때문이다. 목록은 닫혀 있다. 모르는 접두사는 공백으로 읽지 않으므로 그 진단은 error로
남는다(안전한 방향). 목록은 계획의 Phase 0에서 기계 판독용 `docs/limitation-prefixes.json`으로
추출할 예정이다.

| 측 | 접두사 | 완화하는 진단 |
|---|---|---|
| 서버(수신) | `route-coverage:`, `unresolved-route-prefix:`, `route-framework-version-unknown:`, `framework-provided-routes:`, `route-dispatch-order-unknown:`, `route-template-expansion-capped:` | `route-call-without-decl`, `route-method-mismatch` |
| 계약 | `unresolved-contract-servers:`, `contract-coverage:` | `route-call-without-contract` |
| 호출 측 | `route-call-coverage:`, `unresolved-base-url:`, `url-rewrite-interceptors:`, `ambiguous-base-join:`, `http-wrapper-undeclared:`, `http-wrapper-unresolved:`, `generated-client-unscanned:`, `unbound-route-calls-omitted:` | `route-decl-without-call`, `route-contract-without-call` |
| 체인 전용 | `missing-route-usrs:`, `missing-relation-usrs:`, `framework-dispatch-unmodeled:` | check 심각도에 영향 없음(trace gap 근거) |
| 소비자 계수(`origin: "consumer"`) | `unjoined-dynamic-routes`, `unjoined-dynamic-route-calls`, `unjoined-unbound-route-calls` | 앞의 둘은 각각 서버 측·호출 측 공백. 셋째는 개수 공개용 |

- `framework-provided-routes:`는 프로젝트 코드에 선언이 없는 경로(Spring Security의
  `/login`·`/logout`, actuator, springdoc, `/error`, Spring Data REST, 정적 리소스, Next
  `public/`·rewrites·middleware, Flask static 등)를 생산자가 starter·의존성으로 감지했을 때
  낸다. 합성 decl은 내지 않는다. 설정 조합을 정확히 흉내 내지 못하면 거짓 match가 생기기
  때문이다.
- `http-wrapper-unresolved:`는 `http-wrappers` 선언의 owner·name이 실제 심볼과 맞지 않거나
  선언된 래퍼의 호출이 0건일 때 낸다. 낡은 선언이 조용히 0건을 내어 "호출 없음"으로 읽히지
  않게 하기 위해서다.

### http limitation 스코프

- 기존 `limitationScopes`를 http 문서용으로 확장한다. 항목 형태는 `{limitationIndex, templates?,
  templatePrefixes?, templateSuffixes?}`이고, http 문서의 스코프 항목은 `channels` 대신 이 세 필드
  중 하나 이상을 비어 있지 않게 쓴다.
- `templates`는 정확한 정규 템플릿 집합이다. `templatePrefixes`는 세그먼트 경계의 root 접두사로,
  `/actuator`는 `/actuator`와 그 아래 템플릿을 덮는다. `templateSuffixes`는 base 앵커 decl의 알려진
  접미사다.
- 원소는 정규 템플릿 문법을 따르고 세그먼트 단위로만 비교한다. 글롭·정규식·대소문자 접기는
  하지 않는다. 인덱스 규칙, 상한(문서당 스코프 1,000개, 원소 합계 10,000개), 보수적 상한 원칙은
  위 [선택적 limitation 스코프](#선택적-limitation-스코프-v1-확장) 절과 같다.
- 스코프를 증명하지 못하면 그 항목은 기존처럼 문서의 member 전체에 적용한다. dynamic decl에
  증명된 리터럴 접두사가 있으면 `unjoined-dynamic-routes`도 그 접두사로 좁힌다.

### 테스트 소스 정책

- 생산자는 기본으로 테스트 소스 세트의 `route-decl`·`route-call`을 내지 않고 문서에
  `sourceSets.tests: "excluded"`를 선언한다. 테스트 소스 세트의 경로 규칙(`src/test`,
  `src/androidTest`, `Tests/`, `*.test.ts`, `test_*.py` 등)은 벡터로 고정한다. JVM은 테스트 class
  root를 넘기지 않는 방식으로 제외한다.
- `--include-tests`로 포함하면 `sourceSets.tests: "included"`를 선언하고 사실에 `testSource: true`를
  단다. 이 사실은 check error 근거가 되지 않으며 trace에서도 기본 제외한다.
- 테스트의 가짜 host 호출과 목 객체가 authoritative contract 아래에서 거짓 error가 되는 것을
  막기 위한 정책이다. persistence 사실에도 같은 정책을 적용할지는 persistence 절을 개정할 때
  합의한다.

### 보안: route-call 원문

- 생산자는 URL의 userinfo·query·fragment를 제거한다.
- 고엔트로피 세그먼트와 알려진 웹훅 host(예: `hooks.slack.com`)의 경로 세그먼트는 `{}`로
  마스킹하고 `maskedSegments`에 수를 싣는다. 고엔트로피 기준(길이, 문자 종류 수 등)은 url-compose
  벡터로 고정해 생산자 사이에서 같게 읽는다. 마스킹된 세그먼트는 파라미터처럼 취급되어 error
  근거가 되지 않는다.
- 선택 옵션 `--route-call-hosts <목록>`을 주면, 목록 밖 authority의 호출은 사실 대신
  `unbound-route-calls-omitted:` 개수로만 낸다.
- 귀속은 소비자가 매니페스트로 판정하므로 생산자는 어떤 호출이 귀속될지 모른다. 그래서
  isthmus의 **모든 출력**은 귀속되지 않은 호출의 `channel`과 `authority`를 싣지 않고 개수만
  낸다. check(json·SARIF·codequality), baseline 파일, query, `--pairs`, graph, diff, impact,
  trace, `serve`(MCP) 응답, 입력 오류 문구가 모두 대상이고 앞으로 추가하는 출력도 같다. 입력
  오류는 원문 대신 문서 경로와 사실 순번으로 가리킨다. dynamic 원문에는 길이 상한을 둔다.
- 스펙 입력은 크기·YAML alias 확장·깊이에 상한을 두고, 외부 `$ref`와 네트워크를 쓰지 않는다.
  오류와 증거에는 스펙 원문과 절대경로를 넣지 않는다.

### 다중 저장소: workspace 매니페스트 예외

기존 "한 조인의 모든 문서는 정확히 같은 `project`" 규칙은 **문서·member 단위로 유지**한다.
예외는 하나다. `isthmus-workspace` 매니페스트가 선언한 link에 한해 http 도메인만 member 사이
조인을 허용한다.

```jsonc
{
  "format": "isthmus-workspace", "version": 1,
  "members": [
    { "name": "api", "project": "/abs/api", "revision": "<git sha>",
      "documents": ["api.http.json", "api.persistence.json", "db.sql.json"],
      "catalog": { "graphSha": "<sha256>", "source": "db-repo@<sha>" } },
    { "name": "android", "project": "/abs/android", "revision": "<git sha>",
      "documents": ["android.http.json"] },
    { "name": "contracts", "project": "/abs/api", "revision": "<git sha>",
      "documents": ["api.openapi.json"] }
  ],
  "links": [
    { "name": "android->api", "client": "android", "server": "api",
      "match": { "hosts": ["api.example.com"],
                 "baseRefs": [{ "ref": "<생산자 id>", "pathPrefix": "/v1" }],
                 "services": ["example-mobile"], "interfaces": ["<생산자 class id>"] },
      "contract": { "member": "contracts", "documents": ["api.openapi.json"],
                    "authoritative": true } }
  ]
}
```

- 각 문서의 `project`는 자기 member의 `project`와 정확히 같아야 한다. 문자열 일치만 보고 경로를
  스스로 해결하지 않는 기존 규칙과 같다. contract 문서는 `contract.member`의 project를 가진다.
- 두 member가 같은 project를 공유할 수 있다. 모노레포에서 서버 DB와 클라이언트 로컬 DB를
  나누거나, 릴리스 태그 worktree의 구버전 클라이언트를 별도 member로 넣을 때 쓴다.
- persistence·bridge 조인은 member 밖으로 나가지 않는다. http 조인은 link에 선언된 쌍(client
  member의 `route-call` ↔ server member의 `route-decl`·contract)에서만 한다. link가 없는 member끼리는
  잇지 않는다.
- `contract.authoritative`는 "이 클라이언트는 이 스펙에 있는 것만 부른다"는 사용자 선언이며,
  증거에는 선언 출처(workspace)를 표시한다.
- `libraries[{consumer, provider}]`는 공유 SDK 저장소용으로 이름만 예약한다.
- 상세 규칙(revision 검사, 사전 계산 분석, 카탈로그 재발행)은 구현할 때 별도 문서로 옮긴다.

### 미결 항목

- openapi 문서의 `roles` 값(server를 재사용할지, contract 역할을 새로 둘지)과 사실 0건 스펙
  문서의 표현.
- `authority` 정규화(대소문자, 기본 포트).
- 빈 끝 세그먼트만 남은 경로가 `{**}`와 맞는지. 0세그먼트 펼침과 함께 http-template 벡터로
  확정한다.
- `unjoined-unbound-route-calls`가 `route-decl-without-call`을 `-unverified`로 내리는지.
