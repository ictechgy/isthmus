# 브리지 사실 교환 형식 (버전 1)

isthmus 소유의 추가 입력/보고 계약은 [변경 사전 점검](IMPACT.md),
[언어 간 전이 분석과 수집](PREFLIGHT.md),
[런타임 통신 검증](RUNTIME.md)에 있다. 이들은 기존 bridge-facts v1 생산자 필드를
변경하지 않는다. 런타임에서 지원하는 transport를 정적 producer 지원으로 해석하지 않는다.

개발 중인 [BasicMessageChannel v2](BRIDGE-MESSAGES.md)와
[EventChannel v2](BRIDGE-EVENTS.md)는 별도 transport 문서다.
개발 중인 [React Native 이벤트 v2](BRIDGE-RN-EVENTS.md)는 코어 RN 전역 이벤트의
`event-emit`↔`event-listen`을 다루며 Flutter transport와 섞지 않는다.
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

- bridge target 관점에서 rust는 호출 측도 수신 측도 아니다 — bridge target
  문서에 rust 사실이 있으면 입력 오류로 거부한다.
- bridge 도메인 입력의 호출·수신 측 최소 요건을 rust 문서는 어느 쪽으로도
  채우지 않는다.
- bridge 도메인에서 rust 문서는 사실이 없으므로 `target`은 `null`이다.
  `persistence` 외의 비null target은 입력 오류다.
- 예외는 `target: "persistence"`뿐이다 — 그 도메인에서 rust는 호출 측
  생산자다(아래 persistence 절).

### `target: "persistence"` (v1 확장)

언어 코드가 SQL 스키마 객체를 이름으로 참조하는 경계다. 호출 측은 코드를 읽는
생산자(`platform: "go"`의 gartograph, `platform: "rust"`의 rustograph 등),
수신 측은 스키마 카탈로그를 읽는
`platform: "sql"` 문서(schemagraph)다. 이 target 안에서는 sql이 유일한 수신
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
- 입력 구성: `platform: "sql"` 문서나 `target: "persistence"` 문서가 하나라도
  있으면 persistence 도메인 입력으로 보아, sql 문서 최소 하나와
  `target: "persistence"`인 비sql 문서 최소 하나를 요구한다. `target: null`
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
| `relation-use` | sql 외 (v1: Go) | 코드의 관계·컬럼 이름 참조 — SQL 리터럴, struct 태그, 쿼리 빌더 |
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
- 조인 입력 구성 요건은 도메인별로 적용한다. bridge 도메인 문서(target이
  브리지 메커니즘이거나 플랫폼이 dart·js·swift·kotlin인 문서)가 있으면 호출 측
  플랫폼(dart·js) 문서와 수신 측 플랫폼(swift·kotlin) 문서가 각각 최소 하나
  있어야 한다. 한쪽만 있는 입력은 한쪽 관찰을 경계 불일치로 오독할 수 있으므로
  소비자는 입력 오류로 거부한다. 사실이 없는 문서도 해당 플랫폼이 분석됐다는
  근거로 인정한다. persistence 도메인의 구성 요건은 위 persistence 절을 따른다

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
| gartograph | `schema --format json` | Go 소스의 SQL 리터럴 관계·컬럼 이름, `db`/`sql`/`gorm` struct 태그, 쿼리 빌더 호출 (`target: "persistence"`) | (없음 — 코드 쪽이 참조하는 쪽) |
| schemagraph | `facts --graph graph.json` | 카탈로그의 테이블·뷰·컬럼 선언 (`platform: "sql"`, `target: "persistence"`) | (없음 — 스키마 쪽이 선언하는 쪽) |
| rustograph | `schema` | Rust 코드의 관계·컬럼 참조 — sqlx 계열 리터럴·`table!` 매크로·`table_name` 어트리뷰트 (`platform: "rust"`, `target: "persistence"`) | (없음) |

**cartograph가 첫 번째 생산 구현이다.** PR #11에서 SwiftSyntax 스캐너와 `bridges --format json`이 버전 1로 구현됐다.

cartograph의 버전 1 구현은 `symbol.usr`을 붙이기 위해 인덱스 스토어를 요구한다. 인덱스가 없으면 불완전한 문서를 내보내지 않고 도구 실패(종료 코드 2)로 끝난다. 이는 문서 형식의 limitation이 아니라 생산 명령의 선행 조건이다.

## Phase 0 결정

- **Swift `case` 귀속**: 감싸는 타입·함수의 `qualifiedName`과, 생산 구현이 가진 안정 식별자(`usr`)를 `symbol`에 넣는다. 사실의 `location`은 `case` 문자열 위치다. Phase 0 SwiftSyntax 실험은 USR을 만들 수 없어 그 수를 `missing-handler-usrs`로 보고한다
- **Pigeon · Turbo Modules codegen**: 버전 1에는 별도 `codegen-resolved` 종류나 플래그를 추가하지 않는다. 생성 코드의 리터럴도 같은 채널·메서드 사실이고 조인 규칙이 같기 때문이다. 버전 1은 생성 여부를 계약에 싣지 않으며, 필요해지면 조인 키를 바꾸지 않는 선택 필드로 추가한다. 소비자는 경로만 보고 사용자 작성 코드라고 가정하지 않는다
- **한 단계 상수 추적**: `const kChannel = '…'`와 Swift `static let`처럼 같은 파일의 문자열 상수 한 단계는 정적 사실로 낸다. 그 이상이거나 보간된 표현식은 원문과 `dynamic: true`로 보존한다
- **구문 해석 한계**: Dart의 해석하지 못한 `invokeMethod` receiver는 `unresolved-receiver-invocations:`, Swift의 named-function handler는 `opaque-handler-bodies:` limitation으로 센다. 로컬 선언이 import된 `FlutterMethodChannel`을 가리면 `shadowed-flutter-method-channel:`로 알리고 사실 생성을 보류한다
- **Swift 조건부 컴파일**: Flutter를 import한 파일에 `#if`가 있으면 활성 구성을 추측하지 않고 compiler-indexed 추출이 필요하다고 실패한다
- **버전 1 승격**: `expected/dart.json`과 `expected/swift.json`을 실제 추출기로 만들고, 채널 1개·메서드 1개 연결, 핸들러 없는 호출 1개, 호출 없는 핸들러 2개를 `expected/join.json`으로 대조해 충족했다
