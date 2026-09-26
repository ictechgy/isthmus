# isthmus

크로스플랫폼 앱에서 **언어 경계를 넘는 호출**을 그래프로 잇는 도구.
[cartograph](https://github.com/ictechgy/cartograph)(Swift) · [kartograph](https://github.com/ictechgy/kartograph)(Kotlin) ·
[dartograph](https://github.com/ictechgy/dartograph)(Dart)가 각자 그린 지도를 하나로 붙인다.

[English](README.md)

이름은 지협(isthmus) — 두 땅덩어리를 잇는 좁은 땅다리. 지도에서 다리를 뜻하는 말이다.

## 무엇을 하려는가

React Native나 Flutter 앱의 네이티브 코드는 JS/Dart가 **문자열 이름으로** 부른다.
`MethodChannel('com.example/camera')`, `NativeModules.CameraModule`. 컴파일러 인덱스는 이
문자열을 볼 수 없다. 그래서:

- cartograph는 Flutter가 부르는 Swift 핸들러를 **미사용**이라고 한다 — 오탐
- 기존 언어별 분석만으로는 "Dart가 `invokeMethod('takePhoto')`를 부르는데 Swift 쪽에
  그 핸들러가 없다"를 **빌드 전에** 잡기 어렵다 — 런타임 크래시
- 같은 이유로 "이 채널은 Swift에는 있는데 Dart 어디서도 안 부른다"는 교차 경계
  사실을 언어별 도구 하나만으로는 판단하기 어렵다

isthmus는 각 언어 도구가 내보낸 **브리지 사실**(채널 이름 · 메서드 이름 · 등록 지점 ·
호출 지점)을 문자열 키로 조인해서, 경계를 넘는 간선을 만들고 위 세 가지를 답한다.
그리고 그 결과를 cartograph에 **보존 근거로 돌려준다** — "Swift
`CameraHandler.takePhoto`는 `lib/camera.dart:42`가 채널 `com.example/camera`로 부르므로
보존".

## 상태

**0.6.0**은 Flutter Dart ↔ Swift/Kotlin 변경 사전 점검, MethodChannel·Pigeon/BasicMessageChannel
사실, 명시한 런타임 시나리오 대조와 내용 기반 수집 캐시를 지원한다. `impact
--file`/`--symbol`/`--changes`(정보 손실 없는 `--compact` JSON과 분석 공백도 실패시키는
`--strict` 포함), producer 전이 영향 경로를 다루는 `preflight <context.json>`의
`--summary`/`--explain`, `verify-runtime --expectations`가 추가됐다. 실제 macOS·Android
검증 앱에서 공개 플러그인 API를 실행했다. 설정과 측정 범위는 [사전 점검](docs/PREFLIGHT.md),
[런타임 검증](docs/RUNTIME.md), [고정 소스 구축](docs/TOOLCHAIN.md)을 참조한다.

**0.9.0**의 현재 검증된 producer 세트는 cartograph **0.20.0**,
kartograph **0.14.0**, dartograph **0.15.0**이다 — 설치 명령·고정 예제·CI 예시는
[호환 버전](docs/COMPATIBILITY.md)을 참조한다. 발행된 npm 0.9.0 아카이브에는
원래의 kartograph 0.13.0 manifest가 유지된다. MethodChannel 조인과 보존 근거 왕복은
cartograph 0.5.3 이상·dartograph 0.1.1 이상부터 지원하며, 이전 공개 세트
(cartograph 0.15.1·dartograph 0.10.0·isthmus 0.6.0)로 왕복을 다시 확인했다.
React Native 모듈·컴포넌트 사실(`module-import`↔`module-export`,
`component-require`↔`component-export`)은 `react-native` target 안에서 이름으로
조인된다. 선택적 `mechanism` 필드가 core와 Expo 해석 경로를 구분한다. Expo의
`requireNativeModule` 계열 수입은 TurboModuleRegistry 폴백으로 core·Expo 양쪽
수출에 닿지만, `requireNativeViewManager`는 mechanism이 일치해야 한다. 같은 이름이
다른 mechanism으로만 관찰되면 상대편 부재 대신 `*-mechanism-mismatch` 경고로 보고된다.
부재를 허용하는 조회(`requireOptionalNativeModule`,
`TurboModuleRegistry.get`/`getNullable`)로 부른 수입은 `optional: true`를 싣고,
부재 모듈의 호출자가 전부 부재를 허용하면 error 대신
`module-import-without-export-optional` 경고가 나온다.
`isthmus extract-js`가 JS/TS 소스에서 호출 측 사실을 추출하고(`NativeModules.*`,
`TurboModuleRegistry.get*`, `requireNativeComponent`/`codegenNativeComponent`,
`requireNativeModule` 계열 호출, 해석된 멤버 호출), cartograph와 kartograph는
Expo Modules DSL(`Module`/`definition()`, `Name`, `Function`, `View`,
`@ExpoModule`/`@JS`)을 스캔해 그 수출에 `mechanism: "expo"`를 표시한다 —
`GRAPH-EXCHANGE.md`에 적힌 토큰 스캔 관찰 범위 안에서 end-to-end RN 조인이
재현된다. EventChannel v2 전송은 자매 저장소 전반에 구현됐고, `check`가 v2
Bridge·Event 문서를 직접 소비해 transport별 진단을 낸다.
보존 근거는 cartograph(Swift/Objective-C)와 kartograph(Kotlin/JVM)에 전달한다.
앱 전체 적용 범위와 최초 외부 사용자 구축은 아직 검증하지 않았다.

두 번째 조인 도메인 `persistence`는 코드와 DB 스키마를 잇는다.
`gartograph schema`가 Go 측 `relation-use` 사실(타입이 확인된
`database/sql`·sqlx·gorm 호출, SQL 리터럴, `TableName()` 바인딩,
`db`/`sql`/`gorm` 컬럼 태그)을 보내고 `schemagraph facts`가 카탈로그
`relation-decl` 사실을 보낸다. `rustograph schema`·`kartograph schema`·
`cartograph schema`·`dartograph schema`도 Rust·Kotlin/Java·Swift·Dart(sqflite·
sqlite3·postgres·drift·floor)에 대해 같은 `relation-use` 사실을 낸다. `check`는 선언 없는 사용, 모호한 비한정
이름, 카탈로그에 없는 컬럼 참조, 어느 코드도 참조하지 않는 선언을 보고한다 —
생산자가 스키마 전체를 보지 못했을 때는 `catalog-coverage:`·
`unjoined-dynamic-relations:` limitation이 진단을 `*-unverified`로 내린다.
계약은 [`docs/GRAPH-EXCHANGE.md`](docs/GRAPH-EXCHANGE.md)의 persistence 절을
참조한다.

변경 예측은 고정된 공개 정밀도 코퍼스 — `battery_plus`·`shared_preferences_foundation`·
`url_launcher_macos`와 **LocalSend** 앱, 파일/심볼/버전 diff 15케이스 — 로 측정한다.
최근 실행은 **TP 83 / FN 0 / FP 0**을 기록했고, 최초의 앱 수준 Dart↔Swift↔Kotlin
3방향 조인을 포함한다([`experiments/real-corpus/`](experiments/real-corpus/)).
이 수치는 스텁 컴파일 Swift와 소스 스캔 Kotlin 위의 정적 브리지 경계이며,
런타임 실행·앱 전체 정밀도는 측정하지 않았다.

| 문서 | 내용 |
|---|---|
| [`docs/PRD.md`](docs/PRD.md) | 무엇을 · 누구를 위해 · 어디까지 |
| [`docs/PLAN.md`](docs/PLAN.md) | 단계별 계획. **cartograph와 dartograph에 선행 작업이 있다** |
| [`docs/GRAPH-EXCHANGE.md`](docs/GRAPH-EXCHANGE.md) | 자매 도구가 내보내는 브리지 사실의 형식. 자매 저장소들이 공유하는 계약 |
| [`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md) | 공개 호환 버전, 고정 예제, CI 설정 |
| [`docs/RESEARCH.md`](docs/RESEARCH.md) | 확인된 사실 · 확인되지 않은 주장 |
| [`docs/PERSISTENCE-TRACE.md`](docs/PERSISTENCE-TRACE.md) | `check --pairs`로 코드 → 테이블 → DB 의존자를 잇는 수동 왕복 절차(아직 자동화 안 됨) |
| [`experiments/real-corpus/`](experiments/real-corpus/) | 고정 공개 플러그인·앱 정밀도 코퍼스(TP/FN/FP 계수) |
| [`experiments/phase-0/`](experiments/phase-0/) | Dart·Swift 임시 추출기, 고정 JSON, 손 조인 검증 |

## 의존 관계

```
cartograph  ──bridges──┐
kartograph  ──bridges──┼──▶ isthmus ──▶ 경계 간선 · 불일치 보고 · 보존 근거
dartograph  ──bridges──┤
JS/TS 추출기 ─bridges──┘
gartograph · rustograph ─────┐
kartograph · cartograph ─────┼─persistence─▶ isthmus
dartograph ──────────────────┤
schemagraph (SQL 카탈로그) ──┘
```

isthmus 자체는 작다. 무거운 일(각 언어의 해석)은 자매 도구가 한다.

## 설치

Node.js 22.18.0 이상이 필요하다.

전역 설치 후 CLI 이름 `isthmus`로 실행한다.

```bash
npm install --global isthmus-cli
isthmus --help
```

설치 없이 한 번 실행할 때는 패키지 이름을 명시한다.

```bash
npx isthmus-cli --help
```

`npx isthmus`는 이름이 같은 다른 패키지를 설치하므로 사용하면 안 된다.

## 사용

`impact --file`·`--symbol`·`--changes` 사전 점검과 정보 손실 없는 `--compact`, 분석
공백도 실패시키는 `--strict`를 제공한다. 빌드·계약·현재 브리지 한정 범위는
[변경 사전 점검](docs/IMPACT.md)을 참조한다.
Android 개발 지원은 `selection.kotlin`과 kartograph snapshot을 사용한다. Kotlin Method/Basic
사실을 Dart 소비자에 연결하고 Android 실행은 Kotlin 후보에만 대조한다.
[Android 수집 설정](docs/PREFLIGHT.md#android-수집)과 [선택적 Kotlin 도구 구축](docs/TOOLCHAIN.md)을 참조한다.
`verify-runtime --expectations`는 revision·시나리오·플랫폼·엔진 인스턴스별
통신 기록을 대조한다([계약](docs/RUNTIME.md)). 선택적 [Flutter 수집기](packages/isthmus_runtime/README.md)는
실제 macOS·Android 앱에서 핸들러와 `url_launcher_macos 3.2.2`·
`shared_preferences_android 2.4.1`의 Pigeon 생성 API로 검증했다.
언어 내부 전이 영향 연결과 스냅샷 수집은 구현됐으며, 더 넓은 앱 적용 범위와
처음 설치하는 사용자의 재현 절차는 검증 중이다.

0.6.0의 `preflight <context.json> --strict --compact`는 producer의 전이 영향과
브리지를 연결한다. 별도 수집 workflow는 명시된 입력의 내용 해시로 캐시를 재사용하며,
실제 producer를 사용한 합성 소스 검증을 통과했다. 사용법·지원 경계·CI 설정은
[언어 간 변경 사전 점검](docs/PREFLIGHT.md)을 참조한다. 실제 앱 전체 검증은 남아 있다.
`isthmus init [capture.json]`은 그 capture 설정 scaffold를 쓰고(`--toolchain`을 주면
구축한 `toolchain.json`의 실제 producer 명령을 채운다), `isthmus doctor <capture.json>`은
설정을 검증하고 참조한 실행 파일이 `PATH`나 지정 경로에 있는지 확인만 한다 — 실행하지 않는다.
runtime JSON과 `--expectations <checks.json>`를 함께 주면 같은 revision의 실행과
전이 분석을 대조하고, 네이티브 후보·미관찰 경계·시나리오 누락을 기존 정적 공백과 함께 보고한다.

`preflight <context.json> --summary --strict --compact`로 작은 개요를 읽고,
`--explain <exact-producer-symbol-id>`로 한 심볼의 전체 원인 경로를 조회한다.
summary는 목록당 기본 20개(`--limit 1..100`)를 표시하며 생략한 항목도 검토 상태에 반영한다.
선택적 [Basic/Pigeon v2 입력](docs/BRIDGE-MESSAGES.md)은 literal 주소와
증명된 prefix 후보를 연결한다. prefix의 suffix·instance 배선 불확실성은 유지한다.
이 추가 기능은 위에 나열한 공개 producer 버전의 `bridges --messages`로 사용할 수 있다.
에이전트 클라이언트는 `isthmus serve`(MCP stdio 서버)로 같은 명령을 도구로 호출할 수 있다 —
check·query·graph·diff·impact·preflight·retentions를 노출한다.
[MCP 서버 계약](docs/MCP.md)을 본다.
검증된 개발 조합을 재현하거나 도구를 직접 감사하려면 로컬 Git의 고정 commit에서
구축하는 [도구 구축 절차](docs/TOOLCHAIN.md)를 쓴다. Dart AOT 실행 파일, impact와
Basic을 함께 제공하는 cartograph, 격리 설치된 isthmus 패키지를 준비한다.

isthmus CLI는 각 도구가 만든 JSON 파일을 읽는다. 선택적 수집 workflow는 설정에
명시한 준비·producer 명령을 실행한다.

```bash
isthmus check dart-bridges.json swift-bridges.json
```

전체 명령과 현재 패키지 버전은 다음과 같이 확인한다.

```bash
isthmus --help
isthmus --version
```

브리지 오류가 있을 때 CI가 실패하도록 하려면 `--strict`를 붙인다.

```bash
isthmus check dart-bridges.json swift-bridges.json --strict
```

옵션은 어떤 명령에서든 입력 파일 앞뒤 어디에 와도 된다
(`isthmus graph --format dot dart-bridges.json swift-bridges.json`도 동작).
`-`로 시작하는 값은 항상 다음 옵션으로 읽히므로, `-`로 시작하는 경로나 이름은
옵션 해석을 끝내는 `--` 구분자 뒤에 쓴다:
`isthmus query -- -unusual-name dart-bridges.json swift-bridges.json`.
`-h`/`--help`는 어느 위치에 있든 도움말을 내고, `isthmus help <command>`로 명령의
사용법을 볼 수 있으며, 모르는 명령은 루트 도움말을 출력한다.

### React Native 호출 측 사실

React Native 앱에서는 `isthmus extract-js`가 호출 측 문서를 직접 만든다 — JS/TS
파일이나 디렉터리를 넘기고, 결과를 자매 도구가 낸 Swift·Kotlin 문서와 함께
`check`에 넣는다:

```bash
isthmus extract-js src/ --project . > js-bridges.json
isthmus check js-bridges.json ios-bridges.json android-bridges.json
```

출력은 자매 도구가 만드는 것과 같은 `bridge-facts` 버전 1 문서라 모든 소비
명령이 그대로 받는다.

### SARIF 출력

check 결과를 GitHub code scanning(또는 그 밖의 SARIF 2.1.0 소비자)에 올리려면
isthmus-check JSON 대신 SARIF를 요청한다.

```bash
isthmus check dart-bridges.json swift-bridges.json --format sarif > isthmus.sarif
```

기본값인 `--format json`은 버전이 붙은 isthmus-check 문서를 유지한다. SARIF는 같은
조인 결과의 additive·isthmus 소유 렌더링이다. 모든 이슈는 check 진단 코드를 규칙 id로
하는 결과가 되고, 첫 증거 끝점이 주 위치가 되며(프로젝트 상대 경로가 퍼센트 인코딩된
저장소 상대 URI가 된다), 나머지 끝점은 관련 위치로 실린다. 베이스라인이 억제한 이슈는
`external` suppression을 달고 나온다. 결과마다 논리 이슈 식별자(code·target·channel·
method)의 `partialFingerprints` 해시가 있어 소스 줄이 움직여도 중복 판정이 베이스라인
억제와 같은 기준으로 살아남는다.

### GitLab Code Quality 출력

check 결과를 GitLab 머지 요청 위젯에 표시하려면 Code Quality 아티팩트를 대신 낸다.

```bash
isthmus check dart-bridges.json swift-bridges.json --format codequality > gl-code-quality-report.json
```

억제되지 않은 모든 이슈가 첫 증거 끝점의 발견 하나가 된다. `check_name`은 `isthmus:`에
진단 코드를 붙인 값이고, `severity`는 error를 `major`로·warning을 `minor`로 내리며,
`fingerprint`는 SARIF와 같은 논리 이슈 해시를 재사용해 실행 사이의 병합 판정이 유지된다.
이 형식에는 억제 개념이 없으므로 베이스라인이 받아들인 이슈는 새 발견으로 다시 뜨지
않도록 목록에서 제외한다 — 베이스라인을 머지 요청 파이프라인에만 적용하고 기본
브랜치에는 적용하지 않으면, GitLab 비교가 받아들인 이슈를 해당 머지 요청이 "고친"
것으로 표시할 수 있다는 점에 유의한다.

`--strict`·`--baseline`·`--update-baseline`은 모든 형식과 조합되고 문서화된 종료
코드 동작을 유지한다.

### persistence 쌍

`check`는 기본적으로 매치된 관계·컬럼의 개수만 내고, 어느 코드 사용이 어느 카탈로그
선언과 만났는지는 싣지 않는다. `--pairs`는 그 목록을 최상위 `matches` 배열로 더한다.

```bash
isthmus check code-facts.json sql-facts.json --pairs
isthmus query relation:users code-facts.json sql-facts.json
```

매치 하나는 `{domain: "persistence", key: {relation, column?}, uses, decls}`다. `key.relation`은
조인이 해석한 선언 이름이라, 같은 테이블로 해석되는 비한정 `users`와 한정 `public.users`는
한 매치로 합쳐진다. 끝점은 사실의 `platform`·`location`·`symbol`을 그대로 복사한다(사용의
`symbol.usr`는 생산자의 impact id, 선언의 `symbol.qualifiedName`은 schemagraph 정점 id).
요약·이슈·베이스라인 억제·`--strict` 판정 등 나머지 문서는 플래그 없는 실행과 바이트 단위로
같다. `--pairs`는 기본 `--format json`에서만 쓸 수 있고(`sarif`·`codequality`와 함께면 사용
오류, 종료 코드 64), 사용·선언 끝점이 100,000개를 넘으면 부분 목록 대신 종료 코드 2로
실패한다. `query relation:<name>`은 같은 조인 규칙(한정 이름은 정확히, 비한정 이름은 마지막
세그먼트가 같은 선언이 하나일 때만, 후보가 여럿이면 `ambiguous`)으로 관계 하나를 찾아 사용·
선언·컬럼별 증거·check 진단을 낸다. 이 id들을 kartograph/cartograph `impact`와
`schemagraph impact`에 넘기는 방법은 [persistence 수동 왕복 추적](docs/PERSISTENCE-TRACE.md)을
본다. 이 연결은 아직 자동화되지 않았다.

### 베이스라인

현재 발견된 이슈를 인정해 베이스라인으로 기록하고, 다음 실행부터 그 파일을 적용한다.

```bash
isthmus check dart-bridges.json swift-bridges.json --update-baseline isthmus-baseline.json
isthmus check dart-bridges.json swift-bridges.json --strict --baseline isthmus-baseline.json
```

`--update-baseline`은 이번 실행을 억제하지 않고 현재 이슈 전체를 isthmus 소유
`isthmus-baseline` 버전 1 문서로 다시 쓴다. 파일 전체를 새로 쓰므로 해결된 항목은
자동으로 빠진다. `--baseline`은 항목과 논리 이슈 식별자(code·target·channel·method)가
같은 이슈만 억제하므로 소스 줄이 이동해도 억제가 깨지지 않고, 새 채널·메서드 불일치는
억제되지 않는다. 억제된 이슈도 지워지지 않는다 — 사실·증거·심각도를 보존한 채
`suppressed` 표시가 붙고 요약의 error·warning 계산과 `--strict` 판단에서만 빠진다.
어느 이슈와도 맞지 않는 항목은 `staleBaselineEntries`로 세므로, 해결된 이슈가
베이스라인에 남아 다음 악화가 가려질 수 있음을 보고서에서 볼 수 있다. 베이스라인
파일의 읽기 실패·JSON 오류·계약 위반은 종료 코드 2로 실패한다. 두 플래그를 한 실행에
함께 쓸 수 없고, 플래그 바로 뒤의 값이 `-`로 시작하면 거부된다(`-`로 시작하는 합법적
파일명 포함). `--update-baseline`을 `--strict`와 함께 쓰면 파일은 기록되고 종료
코드는 이번 실행의 억제되지 않은 error를 따른다. 기록할 항목이 10,000개를 넘으면
소비할 수 없는 산출물을 남기지 않고 종료 코드 2로 실패한다. 쓰기는 같은 디렉터리에
임시 파일을 쓰고 rename으로 교체하는 원자적 방식이라 중단돼도 기존 파일이 깨지지
않는다.

### 보존 근거

매치된 Swift 핸들러를 cartograph 보존 근거로 돌려주려면:

```bash
isthmus retentions \
  dart-bridges.json swift-bridges.json \
  --for cartograph > external-retentions.json

cartograph dead --external-retentions external-retentions.json
```

`retentions`는 컴파일러 식별자를 사용하며 Swift 선언에만 `qualifiedName` 폴백을 허용한다. 메서드를
여러 위치에서 호출하면 근거가 전체 호출 위치를 `callers`로 싣고(대표 `caller`는 옛
소비자를 위해 유지), 근거당 100개 상한을 넘은 호출은 조용히 버리지 않고
`callersOmitted`로 계수를 밝힌다. `mixed-targets` 문서는 v1에서 사실별 target을
복원할 수 없어 모든 소비 명령이 종료 코드 2로 조인을 보류하며, 이때 몇 개의 문서에서
관찰한 사실 몇 개가 조인되지 못했는지를 함께 알린다. 먼저 생산 단계에서
target별 문서로 분리해야 한다.

0.8.0의 `--for cartograph`는 Swift 플랫폼 문서를, `--for kartograph`는 Kotlin
플랫폼 문서를 요구합니다. Kotlin에는 실제 JVM 식별자, ObjC 구현에는 실제 Clang `c:`
USR이 필요합니다. 매치된 선언의 식별자가 없으면 부분 문서 대신 코드 2로 실패합니다.
ObjC에는 Clang 선언을 그래프에 포함하는 cartograph 0.20.0 이상, Kotlin에는 외부 보존 입력을 읽는
kartograph 0.11.0 이상이 필요합니다. Kotlin 소비자는 그래프에 없는 식별자도 거부합니다.

```bash
isthmus retentions dart.json kotlin.json --for kartograph > kotlin-retentions.json
# 평소 kartograph dead 인자에 --external-retentions kotlin-retentions.json을 추가합니다.
```

모든 소비 명령은 호출 측(dart/js)과 수신 측(swift/kotlin) 플랫폼 문서를 최소 하나씩 요구한다.
한쪽만 있으면 한쪽 관찰을 경계 불일치로 오독하지 않고 종료 코드 2로 거부한다. 입력
실패 메시지는 원인(읽기 실패, JSON 오류, 교환 계약 위반, project 불일치, 플랫폼 구성
누락, 크기 상한)과 입력 순서, 해결 방향을 구분해 전달하며 입력 본문과 경로는 노출하지
않는다.

실제 공개 Flutter 플러그인에서 생산부터 소비까지 확인하려면 저장소 루트에서 다음
검증을 실행한다. 스크립트는 `plus_plugins`의 고정 커밋을 sparse checkout으로
내려받고 배터리 플러그인의 원본 Dart·Swift 소스에서 세 메서드의 보존 근거를 확인한
뒤 임시 checkout을 지운다. 네트워크, Git 2.26 이상, Swift 6, cartograph 0.5.3 이상,
dartograph 0.1.1 이상이 필요하다. isthmus는 현재 소스에서 자동으로 다시 빌드하며,
세 번째 인자로 별도 isthmus JavaScript 산출물을 넘길 수도 있다.

```bash
npm run build
node scripts/verify-public-flutter-plugin.mjs \
  /path/to/cartograph \
  /path/to/dartograph
```

공개 플러그인 검증은 원본 `addMethodCallDelegate` 구현에서 나온 Swift USR과 원본
Dart 호출 위치 세 곳을 확인하고, cartograph `--explain`이 해당 심볼의 대표 근거를
읽는지 검증한다. 이미 public인 플러그인 핸들러의 dead 상태 전환을 억지로 만들지는
않는다. 그 전환과 `setMethodCallHandler` 경로는
`verify-cartograph-roundtrip.mjs`의 합성 코퍼스가 별도로 검증한다.

### query와 graph

채널이나 메서드가 경계 반대편의 어느 위치와 연결되는지 조회하려면:

```bash
isthmus query takePhoto dart-bridges.json swift-bridges.json
```

경계 간선만 JSON, Graphviz DOT, Mermaid로 출력하려면:

```bash
isthmus graph dart-bridges.json swift-bridges.json
isthmus graph dart-bridges.json swift-bridges.json --format dot
isthmus graph dart-bridges.json swift-bridges.json --format mermaid
```

`query`는 같은 메서드가 여러 채널에 있으면 후보를 반환하고 임의로 고르지 않는다.
반환된 `qualifiedName`을 같은 subject 자리에 넣어 정확한 후보를 다시 조회할 수 있다.
`qualifiedName`은 `target:` 뒤에 퍼센트 이스케이프된 구성 요소가 붙는 형태로
`%`·`#`·`:`가 모두 이스케이프되므로, 첫 `:`와 `#` 기준으로 나눈 뒤 디코딩하면
채널·메서드 이름이 항상 되돌아온다. `notFound`·`ambiguous` 질의는 종료 코드 64와
함께 원인 한 줄을 stderr에 출력하므로, 스크립트가 stdout을 파싱하지 않고도
호출 오류와 이름 부재를 구분할 수 있다.
`graph`는 매치된 간선만 내보내며, 입력의 `limitations`를 JSON 필드 또는 DOT/Mermaid
주석으로 보존한다. 증거의 Cartesian 곱이 100,000개 간선을 넘으면 메모리 폭주를 막기
위해 종료 코드 2로 실패한다.

### check가 보고하는 것

출력은 `isthmus-check` 버전 1 JSON이며 다음 사실을 보고한다.

- `unhandled-invocation` (error): 호출은 있지만 네이티브 핸들러가 없음
- `unregistered-channel-creation` (error): 호출 측 채널 생성은 있지만 네이티브 등록이 없음
- `registration-without-creation` (warning): 네이티브 채널 등록은 있지만 호출 측 생성이 없음
- `handler-without-invocation` (warning): 네이티브 핸들러는 있지만 호출 측 사용이 없음
- `unhandled-invocation-unverified` (warning): 위 첫 항목과 같은 사실이지만, 수신 측이
  핸들러를 놓쳤을 수 있다고 스스로 신고해 없는 것인지 못 본 것인지 판정할 수 없음
- `unregistered-channel-creation-unverified` (warning): 같은 이유로 등록 여부를 판정할 수 없음

React Native 이름 경계도 같은 방향으로 보고한다 — `require`/`import`에 맞는
`export`가 없으면 error, `export`에 호출자가 없으면 warning이다.

- `module-import-without-export` (error) / `-unverified` (warning)
- `module-import-without-export-optional` (warning): 호출자가 전부 부재 허용
  API를 썼으므로 수출 부재가 크래시가 아니라 기능 저하임
- `module-export-without-import` (warning)
- `component-require-without-export` (error) / `-unverified` (warning)
- `component-export-without-require` (warning)
- `module-import-mechanism-mismatch`, `module-export-mechanism-mismatch`,
  `component-require-mechanism-mismatch`, `component-export-mechanism-mismatch`
  (warning): 이름이 상대편에 있지만 호환되지 않는 core/Expo 해석 경로로만
  관찰됨

`check`는 BasicMessageChannel·EventChannel bridge-facts v2 문서도 직접 소비해
같은 짝 규칙으로 transport별 진단을 보고한다.

- `unhandled-message-send` (error) / `-unverified` (warning): Dart Basic send에
  대응 네이티브 메시지 핸들러가 없음
- `message-handler-without-send` (warning): 네이티브 Basic 핸들러에 대응 Dart
  send가 없음
- `unhandled-stream-listen` (error) / `-unverified` (warning): Dart Event 스트림
  listener에 대응 네이티브 스트림 핸들러가 없음
- `stream-handler-without-listen` (warning): 네이티브 Event 핸들러에 대응 Dart
  listener가 없음

dynamic `channelPrefix` 경로는 판정이 아니라 후보다 — 항상
`dynamic-message-address`·`dynamic-stream-address` 소비자 한계로 실리고, 관찰된
상대가 없으면 `unmatched-message-boundary`·`unmatched-stream-boundary`가 더해지며,
증명된 prefix가 없는 동적 주소는 `unresolved-message-addresses` 한계에 포함된다.
빠진 쪽을 prefix 후보가 덮는 literal 경계도 error 대신 같은 후보 한계로 내린다.
`summary`는 v2 입력이 있을 때만 `matchedMessages`·`matchedStreams`(literal 매치만)를
더한다. `query`는 v2 경계를 `message`·`stream` kind 주체로, `graph`는 literal v2 경계를
`message`·`stream` 간선으로, `diff`는 literal v2 경계의 추가·삭제와 v2 진단을 생산한다.
`retentions --for cartograph`는 literal v2 Swift 핸들러를 method 없는 근거로 보존하고,
`impact`는 여전히 v1 입력만 받고 version 2를 거부한다.

`summary`는 이슈 계수와 함께 관찰량을 싣는다. `observedFacts`는 입력 문서 전체의 사실
총수이고 `observedLimitations`는 보고된 분석 한계 수다. 이로써 브리지가 없는 프로젝트와
아무것도 관찰하지 못한 실행이 같은 보고서를 내지 않는다 — `observedFacts`가 0이면
생산자가 서술할 것을 아무것도 보지 못했다는 뜻이다.

`-unverified` 종류는 수신 측 문서의 한계에서 나온다. 예를 들어 Flutter 핸들러가
Objective-C로 쓰인 플러그인에서 cartograph는 `objective-c-sources:`를 신고하고 핸들러
사실을 완전히 열거하지 못할 수 있다. 이때 "핸들러 없는 호출"을 error로 단정하면 이
도구가 없애려던 오탐을 이 도구가 만든다. 사실과 증거는 그대로 보고하되 `--strict`를
실패시키지 않는다. 공백의 종류는 구분된다. 이름이 리터럴이 아닌 채널 등록은 채널
진단만 낮추고 메서드 진단은 낮추지 않는다. 완화 단위는 진단의 target이다. 사실은
target별로만 조인되므로 다른 target 수신 문서가 신고한 공백은 현재 target의 진단을
낮추지 않고, 사실이 없는 수신 문서의 공백은 가려진 대상을 특정할 수 없어 모든
target에 적용한다. 호출 측 한계는 네이티브 코드를 가리지 않으므로 심각도에 영향을
주지 않으며, 알 수 없는 한계 문구는 공백으로 해석하지 않는다.

0.2.0부터 v1의 선택적 `limitationScopes`를 읽는다. `{ limitationIndex, channels }`는
해당 한계 전체의 보수적 채널 상한이며, 단순히 발견한 리터럴 목록이면 안 된다. 스코프가
없거나 다른 범위 불명 공백이 공존하면 기존 target 전체 완화를 유지한다. 빈 채널
집합이나 잘못된 인덱스는 입력 오류다. 스코프는 check/query/graph/diff에서 `channels`로
보존된다. 생산자가 tool 이름을 isthmus로 적어도 자체 계수를 신뢰하지 않으며,
`unjoined-*`는 소비자가 직접 붙인 `origin: "consumer"`가 있어야 완화 근거가 된다.

선택적 `sourceLanguage: "objective-c"` 필드는 `.m`/`.mm` 구현을 구분합니다.
cartograph 0.20.0과 isthmus 0.8.0에서는 실제 Clang USR을 보존 근거로 내보낼 수 있습니다. Clang USR이
없는 ObjC 매치는 코드 2로 실패합니다. 옛 문서의 `omittedObjectiveCHandlers`는 한계로
계속 읽지만, 새 출력은 이러한 매치를 조용히 제외하지 않습니다. 심볼 자체가 없는
Swift 선언도 실패합니다.

모든 이슈는 관찰된 위치를 `evidence`로 제공한다. 동적 이름, 해석하지 못한 수신자나
핸들러 본문, USR 누락, 입력 생성 시각 차이, 혼합 target은 `limitations`에 출처와
함께 남긴다. 이 도구는 삭제 가능 여부를 판정하지 않는다.

isthmus 출력 문서는 버전 1 안에서 필드 추가나 새 이슈 code를 호환 변경으로 다룬다.
기존 필드의 의미를 바꾸거나 제거할 때 문서 버전을 올린다.

`limitations`에는 생산자가 신고한 한계와 isthmus가 직접 센 한계가 함께 들어간다.
각 항목은 `platform`·`target`·`tool`로 출처와 귀속을 밝히고, `origin: "consumer"`인
항목은 조인 단계에서 관찰한 것이다. 조인하지 못한 사실은 생산자의 신고나 그 개수와
무관하게 플랫폼·target별로 다시 센다.

- `unjoined-dynamic-channels`: 이름이 리터럴이 아닌 채널 생성·등록 사실
- `unjoined-dynamic-methods`: 이름이 리터럴이 아닌 호출·핸들러 사실
- `unjoined-unattributed-handlers`: 어느 채널에 속하는지 모르는 핸들러 사실

같은 위치의 중복 사실은 한 번만 센다. dynamic이면서 미귀속인 핸들러는 dynamic으로만
센다.

| 종료 코드 | 의미 |
|---|---|
| `0` | 실행 성공. 기본 모드에서는 이슈가 있어도 보고만 함 |
| `1` | `--strict`에서 error 이슈를 발견함(diff는 새로 관찰된 error만 해당). `-unverified` 경고와 베이스라인이 억제한 error는 실패시키지 않음 |
| `2` | 파일 읽기, JSON, 교환 계약, project 불일치, 플랫폼 구성 누락, 보류된 조인, 크기 상한(입력 텍스트·그래프 간선·베이스라인 항목·persistence 쌍 끝점), 베이스라인 파일 오류·쓰기 실패, 만들 수 없는 보존 근거 등 도구 실패. stderr가 원인을 구분 |
| `64` | 잘못된 명령·옵션·입력 개수 또는 `query`의 `notFound`·`ambiguous` |

저장소 checkout에서 개발할 때는 먼저 `npm ci`를 실행한다. 개발 검증은 타입 체크와 clean build를 실행하고 제품 코드 90% 커버리지를
강제하며 실제 CLI·패키지 계약 검증을 함께 수행한다.

```bash
npm run verify
```

실제 두 producer와 외부 보존 근거 왕복을 검증하려면 cartograph 0.5.3 이상,
dartograph 바이너리와 두 도구가 함께 분석할 fixture 루트를 넘긴다. 이 검증은 producer
바이너리와 컴파일러 인덱스가 필요하므로 `npm run verify`와 공개 CI에는 포함되지 않으며
릴리스 전에 수동으로 실행한다.

```bash
node scripts/verify-cartograph-roundtrip.mjs \
  /path/to/cartograph \
  /path/to/dartograph \
  /path/to/FalsePositiveCorpus
```

생산자가 발행한 `limitationScopes`가 소비자까지 전달되어 진단을 채널 단위로만
완화하는지 확인하려면 자기완결 스코프 dogfood를 실행한다. 스크립트는 스캐너가
본문을 볼 수 없으면서 채널 이름은 리터럴로 알려지는 형태(위임 핸들러 등록)의
최소 Swift 패키지와 Dart 호출 측을 합성하고, 스코프가 붙은 채널의 미처리 호출만
`-unverified` 경고로 낮아지고 같은 target의 인접 미처리 호출과 등록 없는 채널
생성은 error로 남는지 검증한다. cartograph 0.9.0 이상, dartograph 0.1.1 이상,
Swift 6이 필요하며 네트워크 접근은 하지 않는다.

```bash
node scripts/verify-limitation-scopes.mjs \
  /path/to/cartograph \
  /path/to/dartograph
```

## 변경 전후 비교 (0.1.4 이상)

같은 프로젝트의 변경 전후 Dart·Swift 교환 파일을 비교하려면:

```bash
isthmus diff \
  --before before-dart.json before-swift.json \
  --after after-dart.json after-swift.json --strict
```

`isthmus-diff` v1은 추가·제거된 논리 메서드 연결, 새로 관찰된 불일치와 더 이상
관찰되지 않는 불일치, 양 시점의 분석 한계와 그 차이, producer 버전·생성 시각을
JSON으로 출력한다. 연결에는 호출자와 핸들러 위치가 포함된다. 줄 이동은 연결 변경으로
세지 않으며 rename은 추측하지 않는다. 같은 논리 키의 호출자·핸들러 교체나 개별 호출
위치 증감은 diff 비교 범위에 포함하지 않는다.

`--strict`는 새로 관찰된 error가 있을 때만 1이다. 기존 오류·경고·분석 한계만 있으면
0이므로 성공 코드가 삭제 안전성이나 완전한 분석을 뜻하지 않는다. `resolvedIssues`도
이전 불일치가 더 이상 관찰되지 않는다는 뜻이며, 동적 전환·추출기 변경 때문인지를 한계와
함께 확인해야 한다. `--strict`은 인자 위치와 무관하게 인식하며 두 번 이상 줄 수 없다.

`diff`는 호출 문서(Flutter Dart 또는 React Native JS)와 수신 문서(Swift
또는 Kotlin)를 받는다. 한 비교에는 네이티브 언어 하나만 사용하며 각 시점에 호출/수신 문서가 모두 필요하다.
양 시점의 `project`와 플랫폼·도구별 문서 개수가 같아야 한다. 한 checkout의 같은
경로에서 각 revision을 빌드해 JSON을 보관한다. 일부 파일만 추출한 결과와 전체 결과를
비교하지 말고 같은 분석 설정을 사용한다. 입력 파일은 합계 256개, 텍스트 길이 제한은
기존 CLI와 동일하다. 혼합 target이나 비교 불가능한 입력은 종료 코드 2로 거부한다.
`generatedAt`은 사실 추출 시각이며 revision 순서가 아니다. 비교 방향은 `--before`와
`--after` 인자로 결정되므로 사용자가 올바른 revision의 파일을 지정해야 한다.

## 코딩 에이전트 skill

네이티브 브리지 핸들러를 지우거나 이름을 바꾸기 전에 `query`로 다른 언어의 호출자를
확인하도록 가르치는 skill 원문을
[`Skills/isthmus/SKILL.md`](Skills/isthmus/SKILL.md)에 제공한다. 사용하는 에이전트의
프로젝트 skill 디렉터리에 이 파일을 복사해 사용할 수 있다.

Codex는 이 checkout의 `.agents/skills/isthmus` 링크로 같은 원문을 발견한다.
원문은 `Skills/isthmus/SKILL.md` 한 곳만 편집하면 되며, npm 패키지에는 이 원문이
포함된다. 스킬 내용 검증과 모델별 지침 조정 근거는
[에이전트 감사 기록](docs/AGENT-AUDIT.md)에 있다.

## 라이선스

[MIT](LICENSE). 상업적 사용을 포함해 영구 무료다.

## RN 이벤트 경계

`extract-js --events`와 자매 도구의 `bridges --rn-events`는 코어 RN 전역 이벤트를
별도 v2 transport로 만듭니다. `--events`는 이벤트 전용 출력을 선택하므로, 기존 v1
모듈·컴포넌트·메서드 사실은 해당 플래그 없이 별도 실행으로 수집합니다. `check`·`query`·`graph`·`diff`가 리터럴 이름으로 연결하고,
미대응 구독·방출은 warning입니다. Expo의 모듈별 이벤트와 preflight/runtime 대조는
지원하지 않습니다. [계약과 관찰 범위](docs/BRIDGE-RN-EVENTS.md)를 참고하세요.
