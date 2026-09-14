# 언어 간 변경 사전 점검

개발 소스 기능이며 npm 0.5.0 발행본에는 없다. `isthmus preflight`는 JSON만 읽는다.
세 도구를 고정 source commit에서 새로 구축하는 방법은 [TOOLCHAIN.md](TOOLCHAIN.md)에 있다.
언어 내부 해석과 compiler index 생성은 producer 및 별도 workflow가 맡는다.
개발 소스는 Flutter Dart↔Swift/Kotlin의 MethodChannel과 producer가 제공한 사용 관계를 연결한다.
선택적 [BasicMessageChannel v2 입력](BRIDGE-MESSAGES.md)을 함께 수집하면 literal 주소와
Pigeon의 증명된 prefix 후보도 연결한다. 플랫폼별 실제 실행·모든 생성 형태·앱 전체 정확도는
별도 검증 범위다. Kotlin 및 Basic producer 확장은 현재 개발 버전이 필요하다.

```bash
isthmus preflight context.json --strict --compact
isthmus preflight context.json --summary --limit 20 --strict --compact
isthmus preflight context.json --explain <exact-producer-symbol-id> --strict --compact
isthmus preflight context.json --revision <expected-capture-revision> --strict --compact
isthmus preflight context.json success.json failure.json --expectations checks.json --strict --compact
```

`impact`는 bridge-facts에서 직접 관련된 경계를 찾는다. `preflight`는 언어별 전이 분석도
입력받아 Swift helper→handler→채널→Dart caller→Dart 소비자를 연결한다. 두 명령 모두
`complete: false`이며 삭제 허가나 영향 범위의 완전성을 보증하지 않는다.

## 입력 계약

`isthmus-preflight-context` v1은 다음을 담는다. 예제는 저장소의
`fixtures/preflight/context.json`이며 실제 앱 입력으로 사용할 수 없는 합성 자료다.

- `project`: 두 bridge-facts 문서와 동일한 정규화된 프로젝트 경로.
- `revision`: 같은 수집의 신원을 나타내는 비어 있지 않은 문자열. 필드만으로 로컬 코드의
  신선도를 확인할 수 없다. 아래 수집기는 명시된 입력 내용의 SHA-256을 사용한다.
- `selection`: `dart`·`swift`·`kotlin`별 `{files, symbols}`. 파일은 project 상대 경로이며 이름·USR은
  producer가 해석한다. `{}`는 `noChanges`이고 검증되지 않은 선택과 구분된다.
- `bridges`: 같은 project의 Dart와 Swift 또는 Kotlin bridge-facts v1. 호출/수신 문서가 모두 필요하며 mixed-targets는 거부한다.
- `messages`: 선택적 Basic 전용 bridge-facts v2 목록. 주면 같은 project의 Dart와 native 문서가
  모두 필요하다. v1과 별도 transport로 조인하며 method를 합성하지 않는다.
- `analyses`: 언어별 `{id, platform, tool, requested, roots, affected, limitations, truncated}`.
  심볼은 `{id, qualifiedName, kind?, location?}`이고 위치는 producer가 관찰한 소스 위치다. affected 항목은
  `{symbol, via, depth, relationships}`이다. `via`가 가리키는 선행 심볼을 사용하므로 영향을
  받는 소비자라는 뜻이다. 원래 producer ID를 유지하며 누락된 위치를 만들지 않는다.
  Kotlin/JVM 심볼 위치는 관찰된 `{path, line?, column?}`를 보존한다. bytecode에 없는
  줄·열 번호를 1로 채우지 않는다. Dart binding과 bridge fact의 위치는 기존처럼 완전한
  line/column을 요구하며, 부분 위치는 Kotlin 분석 심볼에만 허용한다.
  JVM line table의 줄은 함수 선언보다 첫 실행 구문을 가리킬 수 있으므로 선언 시작으로
  다시 해석하지 않는다.
- `trigger`: 후속 Dart 분석에만 쓰는 선택적 필드. 브리지에서 도달한 호출자 ID이며, 해당
  분석의 유일한 symbol 요청과 root에 포함되어야 한다. 초기 선택으로 다시 세지 않는다.
- `bindings`: Dart fact 위치와 실제 query로 얻은 심볼의 연결. `{platform:"dart", location,
  requested, symbol}`. requested는 fact의 짧은 이름과 같아야 하고 선언과 호출 파일이 같아야
  한다. query qualifiedName은 전체 graph ID일 수 있어 requested와 같다고 강제하지 않는다.
- `limitations`: 수집 단계에서 남은 공백. producer 공백·미귀속·truncation도 보고서에서 보존한다.

분석 ID·분석 안의 심볼 ID는 유일해야 한다. 부모 누락·순환을 만드는 depth 불일치·다른
프로젝트·모르는 플랫폼을 거부한다. 초기 requested의 합집합은 selection과 정확히 같아야 한다.
상한은 context 텍스트 UTF-16 길이 64 Mi, 분석 256개, roots+affected 총 50,000개,
binding 100,000개, 각 producer depth 128, 관계 문자열 32개, 조합된 근거 1,000,000개다.

## 출력과 해석

보고서는 `isthmus-preflight` v1, `scope: cross-language-impact`다.

- `roots`, `affected[].via/depth/relations`로 가장 가까운 변경 root까지 경로를 복원한다.
  `language` 관계와 실제 fact를 가리키는 bridge 관계를 구분한다.
- `boundaries`는 영향받는 소비자 경계와 검토할 의존 경계를 구분한다. Dart 호출자를 바꾼다는
  이유로 변경되지 않은 native handler의 다른 호출자에게까지 영향을 전파하지 않는다.
- Basic의 완전한 handler 범위 귀속 근거가 있으면 실제 dependency/dispatch 후보로 해당
  경계에만 전파한다. `bridge-message-dependency`는 원래 참조 위치·대상과 선택된 dispatch
  후보를 보존한다. 등록 함수 직접 변경과 closure 밖 공유 의존 변경은 전체 관련 배선을
  포함한다. 근거가 없으면 넓은 후보와 `unresolved-message-handler-scope` 공백을 유지한다.
- `reviewFiles`, `issues`, `limitations`, `bridgeLimitations`와 선택적 `messageLimitations`를 함께 읽는다. 바인딩 부재,
  후속 Dart 분석 부재, 미관찰 선택, producer truncation은 검토가 필요한 공백이다.
- compact는 공백만 제거한다. `--strict`는 관련 error·공백·미관찰 선택 또는 revision 불일치에
  코드 1을 반환하고 JSON을 유지한다. 입력 계약/읽기 실패는 2, 사용 오류는 64다.
- `noChanges`는 모델링한 소스 선택이 없다는 뜻이다. 설정·리소스 변경 공백이 있으면 strict는
  여전히 실패한다. 알 수 없는 선택을 영향 없는 변경으로 처리하지 않는다.

### 작은 요약과 개별 경로

`--summary`는 `isthmus-preflight-summary` v1이다. 전체 분석의 `summary`·`requiresReview`를
유지하고 목록을 `{total, items, omitted}`로 제한한다. 기본 20개, `--limit`은 1~100이며
요약에만 쓴다. 생략한 항목도 분석·strict 판정에 포함된다. 원문 producer 근거는 context의
sidecar와 전체 보고서에서 확인한다. `--compact`는 각 출력의 JSON 공백만 줄인다.

`--explain <selector>`는 `isthmus-preflight-explanation` v1이다. 정확한 subject key,
producer ID, qualifiedName 순서로 찾는다. `result.path`는 root에서 대상까지 **전체 배열**이고
각 단계의 relations만 표시 한도가 있다. `found`이면 전체 보고서의 strict 종료 코드를
유지하며 `notFound`·`ambiguous`는 JSON과 종료 코드 64를 반환한다. summary와 explain은
동시에 쓰지 않는다. 처음에 summary로 찾은 ID를 explain에 전달하면 대형 JSON을 반복해서
읽지 않고 필요한 경로를 얻을 수 있다.

두 뷰의 `runtime.verification.declaredScenarioPlatforms`는 선언된 scenario/platform 쌍 수다.
통과한 시나리오 수가 아니며 `passedChecks`와도 구분한다. 일부 표시 목록이 비어 있거나
잘려도 전체 검토 필요 상태와 근거 공백은 사라지지 않는다.
runtime route의 candidateKey로 후보 목록을 찾을 수 있으며 `handlers`도 `{total, items, omitted}`로
native 위치·심볼을 제공한다. 이 omitted는 뷰의 표시 생략까지 포함하며 기존 `handlersOmitted`는
전체 runtime 보고서가 먼저 적용한 후보 표시 상한의 생략 수다. 둘을 합산하지 않는다.

## 전이 분석과 runtime 대조

`--expectations <checks.json>`를 주면 context 뒤의 위치 인자는 bridge-runtime v1 기록이다.
기대만 주고 기록을 생략할 수도 있으며 이는 미관찰 검증으로 남는다. 기록만 주고 기대를
생략하면 사용 오류다. 각 기대/기록은 UTF-16 16 Mi, context를 포함한 전체 입력은 64 Mi,
runtime 문서는 최대 256개다. [런타임 계약](RUNTIME.md)의 독립 기대·실패·미완료 규칙을 재사용한다.

- `runtime.verification`: 선언된 시나리오 자체의 검증. 기대 목록과 기록이 과거 revision에서
  서로 일치하면 이 부분만 passed일 수 있으므로 `runtime.aligned`도 확인해야 한다.
- `runtime.aligned`: 기대 목록의 revision과 정적 context revision의 일치 여부. 다르면
  `stale-runtime-expectations` 공백을 추가해 strict가 실패한다. 원본 revision을 고쳐 쓰지 않는다.
- `runtime.routes`: 현재 context revision의 관련 실행 주소. run·scenario·OS·instance·outcome
  집계를 보존하며 정적 후보는 `candidates`라고 표시한다. 특정 native 심볼이 실제 실행됐다는
  증명이 아니다. 기존 `affected` 경로나 정적 동적/미귀속 공백은 덮어쓰지 않는다.
- `runtime.candidates`: 동적 호출로 새로 찾은 native 후보의 실제 fact 위치·심볼. route의
  `candidateKey`로 찾으며 여러 runtime 인스턴스에서도 후보 목록은 한 번만 저장한다.
  후보는 주소당 20개까지 표시하고 `handlersOmitted`로 생략 수를 알린다. 검토 파일에는
  표시 상한 밖의 후보도 포함한다. 후보 존재를 실제 native 실행 심볼의 확정으로 바꾸지 않는다.
  Swift producer가 실은 Objective-C fact는 `sourceLanguage: objective-c`를 유지하며,
  Swift 언어 그래프의 신원으로 변환하지 않는다.
- `selectionReasons`는 주소 일치(`route`)와 검토 파일에서 선언한 caller(`caller-file`)를
  구분한다. 기록의 caller는 수집기가 명시한 위치이며 주변 선언이나 stack에서 추측하지 않는다.
  caller 표시는 route당 20개까지이며 생략 수를 알리고 reviewFiles에는 모든 관련 파일을 남긴다.
- `unobservedBoundaries`: 현재 실행 기록이 없는 관련 정적 경계. `uncoveredBoundaries`는
  현재 기대 시나리오에 들어 있지 않은 관련 경계다. 다른 주소의 통신만 성공하면 이 공백은 남는다.
- Basic/Pigeon 기록은 v2 messages가 있을 때 Basic 주소에만 연결한다. 같은 이름의
  MethodChannel이 Basic을 덮지 않는다. `matching: prefix` 후보의 실행 관찰도 suffix/instance
  배선의 정적 공백을 지우지 않는다. v2가 없거나 해당 native 언어 문서가 없으면 정적 연결은 unsupported다.
  runtime 검증과 정적 후보 연결의 지원 범위는 다르며 다른 플랫폼을 추측해 연결하지 않는다.
- Android 실행은 Kotlin 후보, iOS/macOS 실행은 Swift 후보에만 연결한다. 양쪽 native 문서가
  함께 있는 경계는 한쪽 실행만으로 모두 관찰됐다고 표시하지 않는다. 같은 주소라도 candidateKey가
  다를 수 있으므로 원래 키로 조회한다. 조건부 플랫폼 분기가 필요한 앱은 native별 capture를 사용한다.

기대 실패는 `allowedOutcomes`로 명시한다. `runtime.verification.status`가 passed이고
aligned가 true여도 정적 공백·미관찰/미포함 경계가 남으면 전체 strict는 1이다.

경계의 관찰/기대 포함 여부는 **주소 수준**이다. 같은 주소를 공유하는 기능·인자 분기·호출
경로가 모두 실행됐다는 뜻이 아니다. 원하는 기능은 독립 기대 목록에 해당 scenario로 지정해야
한다. 알려진 관련 메서드는 각각 대조하며, 메서드가 알려지지 않은 channel-only 경계는 해당
채널의 메서드 통신을 배선 관찰로만 인정한다. 그것으로 모든 메서드나 소스 경로의 실행을 보증하지 않는다.

## Android 수집

`cartograph` 대신 `kartograph`와 `kartographSnapshot`을 지정하면 Android만 수집할 수 있다.
양쪽 native producer를 함께 지정할 수도 있다. Kotlin snapshot은 prepare 단계가 만들며
내용을 캐시 지문에 자동 포함한다. `toolInputs`에는 Kartograph 실행 스크립트와 배포의 `lib/`
디렉터리를 모두 넣는다. 실행 스크립트가 같아도 실제 JAR이 바뀔 수 있기 때문이다.

```json
{
  "project": "/path/to/flutter-app",
  "inputs": ["lib", "android/app/src", "android/app/build.gradle.kts", "pubspec.yaml", "pubspec.lock"],
  "toolInputs": ["/path/to/kartograph/bin/kartograph", "/path/to/kartograph/lib", "/path/to/dartograph"],
  "dartograph": ["/path/to/dartograph"],
  "kartograph": ["/path/to/kartograph/bin/kartograph"],
  "kartographSnapshot": "android/app/build/reports/kartograph/debug-snapshot.json",
  "prepare": [["android/gradlew", "-p", "android", ":app:kartographSnapshotDebug"]],
  "messages": true,
  "selection": {"kotlin": {"files": ["android/app/src/main/kotlin/example/CameraPlugin.kt"], "symbols": []}},
  "output": ".isthmus/context.json",
  "cache": ".isthmus/cache.json"
}
```

예제 Gradle task는 앱에 Kartograph plugin을 적용한 경우다. snapshot 출력 경로는 실제
프로젝트의 build directory에 맞춘다(Flutter가 build directory를 옮길 수 있다). 별도 snapshot
생성 명령을 prepare에 연결해도 된다. 생성 설정·SDK·variant 등 실제 분석에 영향을 주는
입력도 선언한다. Git `since`는 `.kt`·`.java` 변경과 rename 양쪽 경로를 선택하며 해당
producer를 구성하지 않은 플랫폼의 변경은 공백으로 남긴다.

Kotlin adapter는 `kartograph-impact` v1의 current 경로와 bytecode/runtime-model 출처를 보존한다.
base/current를 섞은 입력은 거부한다. 경로 중간 심볼·위치·출력 페이지가 빠졌으면 그 사실을
알리고 현재 의존 경로를 지어내지 않는다. 전체 원본은 `.sources.json`에 남긴다.
adapter는 경로의 node/edge 항목을 합해 1,000,000개까지 읽고 상한 초과는 입력 오류로
거부한다. 수집 명령은 producer의 depth 128·출력 10,000개 한도를 사용한다.

앱 내부에 복사한 공개 Pigeon 패키지의 Dart 구현까지 연결하려면 이를 지원하는 개발
Dartograph의 `dartograph.yaml`에서 분석할 로컬 패키지를 명시한다.

```yaml
source_packages:
  - vendor/shared_preferences_android
```

이는 지정한 패키지의 `lib/`만 추가한다. 앱의 path dependency로 연결하고 `flutter pub get`을
실행한 뒤, 설정 파일·패키지 소스·pubspec·package_config를 capture 입력에도 포함한다.
pub 캐시 전체나 모든 의존 패키지를 분석했다고 간주하지 않는다. 같은 이름의 Dart 후보는
producer의 실제 ID와 파일 위치로 대조하며 같은 파일 안에서도 모호하면 연결하지 않는다.

## 자동 수집과 CI

`scripts/capture-preflight.mjs`는 별도 workflow 진입점이다. 사용자가 작성한 설정의 `prepare`
명령을 실행하고 producer JSON을 수집한다. 신뢰하지 않는 저장소가 제공한 명령 설정을
그대로 실행하지 않는다. 패키지에는 이 스크립트·run-child·컴파일된 소비자 모듈이 포함된다.

```bash
# 저장소에서 사용: npm ci와 npm run build 후
node scripts/capture-preflight.mjs capture.json

# 앱에 설치한 패키지에서 사용: 새 기능이 포함된 버전을 설치한 뒤
node node_modules/isthmus-cli/scripts/capture-preflight.mjs capture.json
```

아래는 iOS 앱용 설정 형태다. project·scheme·도구 경로와 입력 목록은 실제 앱에 맞춰야 한다.
이 iOS 설정 자체를 실행 검증했다고 주장하지 않는다. 실검증한 SwiftPM fixture 절차는 아래에 있다.

```json
{
  "project": "/absolute/path/to/flutter-app",
  "inputs": [
    "lib", "ios/Runner", "ios/Runner.xcodeproj/project.pbxproj",
    "ios/Podfile", "ios/Podfile.lock", "pubspec.yaml", "pubspec.lock",
    ".dart_tool/package_config.json"
  ],
  "toolInputs": ["/absolute/path/to/cartograph", "/absolute/path/to/dartograph"],
  "dartograph": ["/absolute/path/to/dartograph"],
  "cartograph": ["/absolute/path/to/cartograph"],
  "prepare": [[
    "xcodebuild", "-workspace", "ios/Runner.xcworkspace", "-scheme", "Runner",
    "-configuration", "Debug", "-sdk", "iphonesimulator",
    "-derivedDataPath", ".isthmus/DerivedData",
    "COMPILER_INDEX_STORE_ENABLE=YES", "CODE_SIGNING_ALLOWED=NO", "build"
  ]],
  "indexStore": ".isthmus/DerivedData/Index.noindex/DataStore",
  "since": "main",
  "output": ".isthmus/context.json",
  "cache": ".isthmus/cache.json"
}
```

`since` 대신 `selection: {"swift":{"files":["ios/Runner/CameraPlugin.swift"],"symbols":[]}}`
처럼 변경 전 대상을 명시할 수 있다. 둘을 함께 쓰지 않는다. CI에서는 checkout한 저장소의
base commit SHA를 since에 넣고 해당 commit을 fetch해 둔다. Git의 rename 양쪽·삭제·변경
파일과 미추적 Dart/Swift 소스를 선택한다. 추적된 설정·리소스 변경은 별도 검토 공백으로 남긴다.

Flutter 의존성을 준비한 후 수집기를 실행하고 생성된 JSON을 `isthmus preflight`에 전달한다.
수집기 코드 1은 보고서가 생성됐지만 검토가 필요하다는 뜻이고, 2는 수집 실패다. CI 스크립트는
1일 때도 context 보고서를 보존해야 한다. 외부로 올릴 artifact에 개인 경로가 있는지 검토한다.
`.isthmus/`와 빌드 출력은 Git에서 제외하고 입력 해시 범위에도 넣지 않는다.

캐시는 **명시한 입력 범위**에서만 유효하다. 사용하는 xcconfig·Pigeon 입력·로컬 패키지·
SDK 버전 파일·producer가 로드하는 라이브러리와 설정도 inputs/toolInputs에 포함해야 한다.
실행 파일이 wrapper이면 wrapper 하나의 해시만으로 실제 구현 전체를 보증하지 못한다.
입력 디렉터리 내부 symlink는 거부하므로 필요한 실제 소스 경로를 별도로 선언한다.

소스·설정·producer 파일 내용, 명령·선택 설정, isthmus 구현, Node/OS/아키텍처 및 주요
toolchain 환경의 해시가 키에 포함된다. 파일 추가·수정·삭제로 키가 바뀌면 prepare부터 다시
실행한다. 수집 전후 해시가 다르면 결과를 발행하지 않는다. prepare가 lock 파일 등을 정상적으로
갱신한 경우에는 준비가 끝난 상태부터 수집 전후를 비교한다. 빌드 명령이 실제 index를 갱신하는지는
호출자가 책임지는 명시적 전제다. 코드 0을 임의의 빌드 설정까지 정확하다는 보증으로 삼지 않는다.

context 옆의 `.sources.json`에는 원래 producer 출력, 선언한 입력의 해시, 단계별 시간이 있다.
캐시 복원 시에도 이 근거를 복원한다. 일반 호출 그래프로 투영하지 못한 Cartograph runtime
review·runtime dependency 항목은 공백으로 표시하고 원문 producer 보고서에서 확인한다.
런타임 통신은 [별도 검증](RUNTIME.md)을 사용하며 이 정적 경로에 실제 실행 신원을 추측해 붙이지 않는다.

Basic 수집은 설정에 `"messages": true`를 추가한다. 같은 producer에 `bridges --messages`를
호출하며 그 기능이 있는 개발 버전이 필요하다. 별도의 message producer를 쓸 때는
`"messages": {"cartograph": ["/path/to/message-cartograph"], "dartograph": ["/path/to/message-dartograph"]}`처럼
명령을 지정한다. 생략한 쪽은 기본 producer를 사용한다. override 실행 파일과 관련 구현도
`toolInputs`에 넣어야 하며 feature 설정·명령·override 버전은 캐시 키에 포함된다.

## 실행 근거

현재 개발 producer가 있는 환경에서 다음 검증을 실행했다.

```bash
node scripts/verify-preflight-producers.mjs /path/to/cartograph /path/to/dartograph/bin/dartograph.dart /path/to/flutter
```

임시 SwiftPM 소스의 실제 compiler index와 실제 Dartograph 분석을 사용해 helper→handler→
channel→Dart caller→service→screen 경로, source 위치, 캐시 재사용, 소스 변경 후 재수집을 확인한다.
Swift의 Flutter 타입은 컴파일용 stub이므로 native IPC 검증이 아니다. Flutter 의존성 준비는
offline 캐시를 사용한다. SDK·producer 저장소를 변경하지 않고 임시 fixture에서 빌드한다.

2026-09-14 최신 실행은 첫 수집 23.811초, 같은 입력의 캐시 사용 3.735초, 소스 변경 후 18.458초였다.
Dartograph 소스를 직접 실행하므로 버전 조회에도 약 4초가 들었다. producer 설치·Flutter 의존성
준비는 이 시간 밖이며, 대형 앱이나 배포된 producer 실행 파일의 성능으로 일반화하지 않는다.
수집기의 코드·도구 변경/삭제·중간 변경·캐시 변조·다른 파일의 query·Git rename 회귀는
`node --test scripts/capture-preflight.test.mjs`로 검사하며 `npm run verify`에도 포함된다.

소비자 성능 회귀는 `node scripts/benchmark-preflight.mjs`로 검사하며 저장소 CI에서도 실행한다.
CLI 시작·JSON 읽기·분석·직렬화를 포함한 5회 실행을 측정한다. 전이/runtime 대형 입력과
같은 setup을 공유하는 Basic handler 10,000개의 단일 구현 선택을 포함한다. 각 입력의
최대 실행 5초를 게이트로 쓰며 producer·인덱스·앱 빌드 시간은 이 게이트 밖이다.

공개 source의 메서드별 전파 검증은 아래 명령으로 재현한다. 준비된 Flutter pub 캐시의
`url_launcher_macos 3.2.2` 원본과 실제 FlutterMacOS framework를 사용한다. 생성 파일 원본을
수정하지 않고 검증용 SwiftPM manifest와 Dart dev dependency 제외를 적용한다.

```bash
node scripts/verify-public-pigeon.mjs <flutter> <cartograph-impact> <cartograph-messages> <dartograph-entry-or-exe> <url_launcher_macos-3.2.2>
```

Swift launch/canLaunch 구현을 각각 선택하면 해당 Dart wrapper만, 공통 setup을 선택하면
양쪽 wrapper 모두를 포함해야 한다. 이 검증은 native IPC 실행과 별도다. 실제 macOS 통합은
`verify-flutter-runtime.mjs`의 기존 producer 인자 뒤에 `--message-cartograph <path>`를 추가한다.
하네스는 공개 plugin을 임시 앱의 vendor로 복사하고 원본 bytes·명시된 입력 해시·동일 revision의
정적 후보/runtime 관찰을 검증한다. 기본 Flutter recorder는 payload나 원문 오류를 기록하지 않는다.
