# 공개 호환 버전 세트

2026-09-21 갱신한 isthmus 0.9.0의 호환 대상 세트다. 이번 갱신의 설치본 검증은
[0.9.0 / 0.14.0 절](#090--0140-호환-갱신-2026-09-21)에 구분했다. 이전 조합의 MethodChannel·BasicMessageChannel 조인,
변경 사전 점검, retention 왕복, React Native·Expo 모듈 조인은 아래
[실측으로 확인한 범위](#실측으로-확인한-범위-2026-09-16-2026-09-18-추가)의
근거가 있다. EventChannel v2 문서는 세 producer 발행본이 생산하지만
이 세트에서의 조인 실측은 아래 목록에 없다 — 별도 검증 범위다.
새 브리지 기능의 개발 검증은 아래 2026-09-20 절에 구분했다.
고정 소스 구축([TOOLCHAIN.md](TOOLCHAIN.md))은 검증된 개발 commit 조합이
필요하거나 발행본을 신뢰할 수 없을 때의 대안이다.

이 표와 cold-cache CI의 기계 판독 정본은 현재 저장소 루트의 `compatibility.json`이다.
각 npm 패키지는 발행 시점의 manifest를 포함한다. 이미 발행된 npm 0.8.0의 원본은
[v0.8.0 태그](https://github.com/ictechgy/isthmus/blob/v0.8.0/compatibility.json)의 kartograph 0.11.0
세트다. 이후 0.8.0 + kartograph 0.12.0 설치 검증도 보존한다. npm 0.9.0의 원본은
[v0.9.0 태그](https://github.com/ictechgy/isthmus/blob/v0.9.0/compatibility.json)의 kartograph 0.13.0
세트이며, 현재 저장소 manifest는 0.9.0 + 0.14.0을 대상으로 한다. 기존 npm 아카이브는 불변이다.
`npm run verify`의 `scripts/verify-compatibility.mjs`가 이 문서·README·README.ko의
버전 표기가 정본과 일치하는지 검사하므로, 버전을 올릴 때 한 곳만 고치면 drift가 실패로
드러난다. 이 문서의 산문이 서술하는 기능 범위와 실측 이력은 정본이 아니다.

## 호환 버전 표

아래 표는 현재 저장소에서 검증하는 호환 대상이다. 발행 전에는 후보 산출물로 검사하고 발행 후에는
registry 설치본과 cold-cache CI의 실제 버전을 대조한다. 과거 발행본 검증은 아래 이력과 구분한다.

| 도구 | 호환 버전 | 설치 | 이 세트가 제공하는 기능 |
| --- | --- | --- | --- |
| isthmus-cli | **0.9.0** | `npm install --global isthmus-cli@0.9.0` (Node 22.18.0 이상) | `check`·`query`·`graph`·`diff`·`retentions`·`impact`·`preflight`·`verify-runtime`·`extract-js` |
| cartograph | **0.20.0** | `brew install ictechgy/tap/cartograph` | `bridges --target flutter`, `bridges --messages`·`--events`(v2), Expo Modules DSL(`mechanism`), `impact`, `dead --external-retentions` |
| kartograph | **0.14.0** | GitHub Release 아카이브(`kartograph-0.14.0.tar`/`.zip`), Gradle plugin `io.github.ictechgy.kartograph` | `impact --graph-file`, `bridges --target flutter --messages --graph-file`, `bridges --target flutter --events`, Expo Modules DSL(`mechanism`) |
| dartograph | **0.15.0** | `dart pub global activate dartograph` | `bridges --format json`, `bridges --messages`·`--events --format json`(v2), `impact` |

최소 조합은 따로 있다. MethodChannel(v1) 조인과 retention 왕복만 필요하면
cartograph 0.5.3 이상·dartograph 0.1.1 이상도 동작한다. BasicMessageChannel(v2),
preflight 전이 경로, Kotlin 쪽 조인에는 위 표의 버전이 필요하다. EventChannel
v2 문서의 최소 버전은 dartograph 0.12.0(`--events`, stream-listen)·
kartograph 0.10.1(`--events`, stream-handle)·cartograph 0.18.0(`--events`,
stream-handler)이고, 이 세트 3방향 조인 실측은 아직 없다.
React Native는 수신 측 사실(cartograph `RCT_EXPORT_*`·kartograph `@ReactModule`),
isthmus 0.7.0의 모듈·컴포넌트 이름 조인, `isthmus extract-js`의 JS/TS 호출 측
추출이 갖춰졌다. 추출은 토큰 스캔 관찰 범위의 근거다 — 동적 이름·스캔 집합
밖 바인딩은 limitations로만 보고하며 앱 전체 정확도를 주장하지 않는다.
Expo Modules는 사실의 선택적 `mechanism` 필드(`core`·`expo`, 생략=core)로
구분한다. 수신 측 스캔은 cartograph 0.18.0(멤버 체인 호출 포함)과
kartograph 0.10.1부터 발행됐고, 중첩 제네릭·완전 정규화·`this.` 한정 호출은
0.10.2에서 스캔된다.

일반 RN/Expo 수신 측의 `bridges --target react-native` 수정은 0.12.0 이상에 포함된다.
0.11.0은 이 정상 명령을 코드 64로 거부하는 회귀가 있었고, 공개 expo-haptics 원본에서
재현해 0.12.0에서 수정했다. [공개 코퍼스](../experiments/real-corpus/README.md)는
원래 npm 0.8.0 설치본의 결과와 후속 개발 검증을 별도 파일로 보존한다.

## 0.9.0 / 0.14.0 호환 갱신 (2026-09-21)

npm의 isthmus 0.9.0, Homebrew의 cartograph 0.20.0, pub.dev의 dartograph 0.15.0,
GitHub Release의 kartograph 0.14.0 TAR 설치본을 현재 manifest와 대조했다.
kartograph TAR의 SHA-256은 발행 checksum과 일치하며, 격리한 npm 설치와 pub cache를 사용했다.
`scripts/verify-cold-cache.mjs`에서 고정 문서의 정상·오류 조인, retention 출력,
preflight summary와 `fixtures/bridge-app`의 실제 producer 추출 → 3방향 MethodChannel
조인 → cartograph 대상 retention 출력을 확인했다. 새 러너의 공개 설치 경로는
[cold-cache workflow](../.github/workflows/cold-cache.yml)가 같은 manifest로 검증한다.

이 검사는 Swift 스텁을 컴파일하고 Kotlin 소스를 스캔한다. Kotlin JVM 식별자 보존,
실제 앱 실행, 전체 공개 코퍼스의 정확도를 새 조합으로 다시 측정한 결과는 아니다.
kartograph 0.14.0의 KAPT/KSP receipt·snapshot·Gradle cache·선택적 collector 검증은
[별도 릴리스](https://github.com/ictechgy/kartograph/releases/tag/v0.14.0)의 범위다.
아래 0.13.0 조합과 런타임 검증 이력은 그대로 보존하며, isthmus npm은 재발행하지 않는다.

## 0.9.0 / 0.13.0 후속

isthmus 0.9.0은 안정적인 모듈 범위 let/var·CommonJS namespace 이벤트 구독과
선택적 sourceModifiedAt 보존을 추가한다. kartograph 0.13.0은 bridge 추출 시각을 source
mtime과 분리하며 dependency baseline/suppress 및 선택적 JSR-269 source 귀속을 제공한다.
공개 RN 원본의 source-fact TP4/FN0/FP0, 컴파일된 Sound.kt의 retention·원본 caller explain,
Flutter3.47.2 macOS 앱·Android 에뮬레이터 검증은 [범위별 결과](../experiments/real-corpus/README.md)에 있다.
원래 0.8.0/0.12.0의 발행본·캐시 수치와 새 버전 설치 검증은 별도 근거다.

## 새 브리지 기능과 검증 범위 (2026-09-20)

isthmus 0.8.0은 `retentions --for kartograph`와 실제 Clang USR의 Objective-C 보존을
지원한다. 대응 소비자는 kartograph 0.11.0·cartograph 0.20.0이다. 필요한 심볼 ID가 없는
입력은 부분 보존 대신 실패한다. 코어 RN 이벤트는 `extract-js --events`와 두 native
producer의 `bridges --rn-events`로 별도 v2 `react-native-event` 문서를 조인한다.
Expo 이벤트·RN preflight·앱 전체 런타임 검증은 지원 범위가 아니다.

개발 커밋에서 실제 Clang→ObjC 보존→explain, JS/Swift/Kotlin RN 이벤트 조인, 기존
Dart/Swift 왕복과 고정 공개 battery 플러그인의 macOS 보존을 검증했다. 동일 아카이브의 발행·독립 설치와 공개 cold-cache CI도 확인했다.
이번 추가 조합은 전체 Flutter 15케이스(TP 83 / FN 0 / FP 0), 15 cache miss/hit 동등성,
Expo Swift/Kotlin 4메서드와 RN 전역 이벤트의 명시된 source-fact 범위를 다시 검증했다.
[현재 코퍼스 결과](../experiments/real-corpus/README.md#현재-발행-조합-결과-2026-09-20)와
[설치/해시 근거](../experiments/real-corpus/results/published-tools.json)를 참조한다.

## 실측으로 확인한 범위 (2026-09-16, 2026-09-18 추가)

2026-09-16 측정은 이전 세트(isthmus 0.6.0 · cartograph 0.15.1 · kartograph
0.10.0 · dartograph 0.10.0)에서 했다. 아래는 당시 검증 이력이며, 현재 조합의
추가 측정은 위 절과 공개 코퍼스 결과를 따른다.

- cartograph 0.15.1 `bridges` → isthmus 0.6.0 `retentions --for cartograph` →
  cartograph 0.15.1 `dead --external-retentions`의 억제와 `--explain` 근거 문장을
  공개 corpus(Flutter 스텁을 포함한 SwiftPM fixture)에서 확인했다.
  재현: `node scripts/verify-cartograph-roundtrip.mjs <cartograph> <dartograph> <fixture-root>`.
- cartograph 0.15.1과 dartograph 0.10.0의 `bridges --messages`가 bridge-facts v2
  (`transport: basic-message-channel`) 문서를 출력함을 확인했다.
- kartograph의 `bridges` 실행은 2026-09-18에 해소됐다(아래 항목) — 위에서
  "0.10.0을 Android 프로젝트로 실행하지 않았다"는 제한은 더 이상 적용되지 않는다.
- 2026-09-18: `expo-haptics@14.1.4`(npm tarball)에서 JS·Swift·Kotlin 3방향 조인을
  확인했다. **발행 설치본** cartograph 0.18.0이 `module-export`(ExpoHaptics,
  `mechanism: "expo"`)와 멤버 체인이 붙은 `AsyncFunction`의 method-handle 3건을
  생산했고, kartograph **0.10.2 준비본**(release-prep installDist)이 method-handle
  4건(Android 전용 `performHapticsAsync` 포함)을 생산했다. isthmus **0.7.0
  준비본**의 `check`가 `errors: 0`으로 모듈 1·메서드 4를 조인했다 — iOS에 없는
  Android 메서드의 플랫폼 비대칭이 추정이 아니라 실측으로 확인됐다.
  준비본 측정이므로 v0.10.2·0.7.0 발행 아티팩트의 재측정은 발행 후 별도다.

아직 확인하지 않은 것: 전체 앱 정확도, iOS 실기기, 다른 Android API/ABI,
release 빌드·권한/생명주기·다중 engine. 실행하지 않은 경로의 완전성을 보장하지
않는다. cache 없는 첫 설치는 아래 cold-cache 절차와 워크플로로 감시한다.

## cold-cache 재현

발행 산출물만 새로 설치해 조인·보존·사전 점검이 재현되는지 확인하는 경로다.
`.github/workflows/cold-cache.yml`이 주 1회 같은 단계를 새 러너에서 실행한다 —
발행본이 아래에서 바뀌거나 설치 경로가 깨지면 예약 실행이 잡아낸다.

```bash
# 발행 패키지만으로 고정 fixture 검증 (Ubuntu 포함 어느 OS나)
npm install --global isthmus-cli@0.9.0
node scripts/verify-cold-cache.mjs "$(npm root --global)/isthmus-cli/dist/cli/main.js"

# producer까지 포함한 3방향 조인 검증 (macOS)
brew install ictechgy/tap/cartograph
dart pub global activate dartograph 0.15.0
curl -fsSL https://github.com/ictechgy/kartograph/releases/download/v0.14.0/kartograph-0.14.0.tar -o kartograph-0.14.0.tar
tar -xf kartograph-0.14.0.tar
node scripts/verify-installed-compatibility.mjs \
  isthmus="$(command -v isthmus)" cartograph="$(brew --prefix)/bin/cartograph" \
  dartograph="$HOME/.pub-cache/bin/dartograph" kartograph="$PWD/kartograph-0.14.0/bin/kartograph"
node scripts/verify-cold-cache.mjs "$(npm root --global)/isthmus-cli/dist/cli/main.js" \
  "$(brew --prefix)/bin/cartograph" "$HOME/.pub-cache/bin/dartograph" "$PWD/kartograph-0.14.0/bin/kartograph"
```

두 번째 명령은 `fixtures/bridge-app`을 세 producer가 각각 스캔한다 —
Swift는 `swift build`로 실제 컴파일러 인덱스를 만들고, Kotlin은 스냅샷 없는
소스 스캔이다(`missing-handler-usrs` 한계가 붙는다). 스텁 컴파일과 소스 스캔은
실제 Flutter SDK·Android 기기 실행이 아니다. 첫 원격 실행의 성공 여부는
워크플로 기록으로 별도 확인한다.

## 고정 예제: Dart↔Swift 왕복 (목표 15분)

Flutter 앱 체크아웃 루트에서 실행한다. 경로·scheme은 실제 앱에 맞춘다.

```bash
# 1. 네이티브 인덱스와 Dart 패키지 해석 — 스캐너가 handler 선언의 USR을 얻는 데 필요하다
xcodebuild -workspace ios/Runner.xcworkspace -scheme Runner \
  -configuration Debug -sdk iphonesimulator \
  -derivedDataPath .isthmus/DerivedData \
  COMPILER_INDEX_STORE_ENABLE=YES CODE_SIGNING_ALLOWED=NO build
dart pub get   # 또는 flutter pub get

# 2. 양쪽 bridge facts 수집 (v1 MethodChannel)
cartograph bridges --project . --target flutter \
  --derived-data .isthmus/DerivedData > swift-bridges.json
dartograph bridges --format json --project . . > dart-bridges.json

# 2b. 선택 — BasicMessageChannel(v2)은 별도 문서로 수집한다
cartograph bridges --project . --target flutter --messages \
  --derived-data .isthmus/DerivedData > swift-messages.json
dartograph bridges --messages --format json --project . . > dart-messages.json

# 3. 조인·진단 — error가 있으면 --strict가 1을 반환한다
isthmus check dart-bridges.json swift-bridges.json --strict

# 4. retention 왕복 — Dart가 부르는 Swift handler를 dead 분석에서 살려둔다
isthmus retentions dart-bridges.json swift-bridges.json \
  --for cartograph > external-retentions.json
cartograph dead --external-retentions external-retentions.json
cartograph dead --external-retentions external-retentions.json --explain <HandlerName>
```

예상 출력 형태:

- `isthmus check`는 `isthmus-check` v1 JSON이다. `summary`에 issue별 개수와
  `observedFacts`·`observedLimitations`가 있다. `unhandled-invocation`·
  `unregistered-channel-creation`은 error, `registration-without-creation`·
  `handler-without-invocation`과 `-unverified` 종류는 warning이다.
- `isthmus retentions`는 `external-retentions` v0 문서다. `retentions[].symbol`과
  `evidence`(caller의 platform·path·line, method, channel)를 담는다.
- `cartograph dead --explain <이름>`은 보존 이유와 함께 `evidence: dart <path>:<line>
  invokes '<method>' on channel '<channel>'` 형태의 근거를 보여준다.

## preflight 수집 설정

변경 전 전이 영향까지 보려면 producer 분석을 함께 수집한다. 계약의 정본은
[PREFLIGHT.md](PREFLIGHT.md)다. 최소 형태(iOS):

```json
{
  "project": "/absolute/path/to/flutter-app",
  "inputs": [
    "lib", "ios/Runner", "ios/Runner.xcodeproj/project.pbxproj",
    "pubspec.yaml", "pubspec.lock", ".dart_tool/package_config.json"
  ],
  "toolInputs": [
    "/opt/homebrew/bin/cartograph",
    "/Users/<you>/.pub-cache/bin/dartograph"
  ],
  "cartograph": ["/opt/homebrew/bin/cartograph"],
  "dartograph": ["/Users/<you>/.pub-cache/bin/dartograph"],
  "prepare": [[
    "xcodebuild", "-workspace", "ios/Runner.xcworkspace", "-scheme", "Runner",
    "-configuration", "Debug", "-sdk", "iphonesimulator",
    "-derivedDataPath", ".isthmus/DerivedData",
    "COMPILER_INDEX_STORE_ENABLE=YES", "CODE_SIGNING_ALLOWED=NO", "build"
  ]],
  "indexStore": ".isthmus/DerivedData/Index.noindex/DataStore",
  "since": "main",
  "messages": true,
  "output": ".isthmus/context.json",
  "cache": ".isthmus/cache.json"
}
```

```bash
node "$(npm root --global)/isthmus-cli/scripts/capture-preflight.mjs" capture.json
isthmus preflight .isthmus/context.json --summary --strict --compact
isthmus preflight .isthmus/context.json --explain <producer-symbol-id> --compact
```

Android만 필요하면 `cartograph`·`indexStore` 대신 `kartograph`·`kartographSnapshot`과
prepare의 Gradle snapshot task를 쓴다([PREFLIGHT.md의 Android 수집](PREFLIGHT.md#android-수집)).
캐시는 선언한 입력 범위에서만 유효하며, producer 실행 파일·래퍼·`lib/`까지 `toolInputs`에
넣어야 한다. `.isthmus/`는 Git에서 제외한다.

## CI 예시 (GitHub Actions)

도구는 공개 버전을 설치하고, 앱 입력이 바뀔 때만 capture가 prepare부터 다시 실행된다.
Action은 SHA로 고정하고, `since`에는 대상 PR의 base commit을 넣는다.

```yaml
name: bridge-preflight
on:
  pull_request:

jobs:
  preflight:
    runs-on: macos-15
    steps:
      - uses: actions/checkout@<pin-sha>   # v5 계열, SHA 고정
        with:
          fetch-depth: 0
      - uses: subosito/flutter-action@<pin-sha>
        with:
          channel: stable
      - run: brew install ictechgy/tap/cartograph
      - run: dart pub global activate dartograph
      - run: npm install --global isthmus-cli@0.9.0
      - run: flutter pub get
      - name: Capture bridge facts and producer analyses
        env:
          BASE_SHA: ${{ github.event.pull_request.base.sha }}
        run: |
          # capture.json의 "since"를 BASE_SHA로 쓰거나, 이 파일을 CI에서 생성한다
          node "$(npm root --global)/isthmus-cli/scripts/capture-preflight.mjs" capture.json
      - name: Preflight gate
        run: isthmus preflight .isthmus/context.json --summary --strict --compact
        # exit 1 = 검토할 변경 영향 있음(JSON 보존), 2 = 수집/입력 실패
```

capture의 종료 코드 1은 "보고서는 생성됐지만 검토 필요"이므로 CI에서 context JSON을
버리지 않는다. 외부에 올리는 artifact에 개인 경로가 포함되는지 먼저 확인한다.
원격 CI의 최초 구축·캐시 동작은 로컬 검증과 별도로 확인해야 한다.
