# 공개 호환 버전 세트

2026-09-16 실측 기준, 아래 공개 버전만으로 MethodChannel·BasicMessageChannel 조인,
변경 사전 점검, retention 왕복을 재현할 수 있다. 고정 소스 구축([TOOLCHAIN.md](TOOLCHAIN.md))은
검증된 개발 commit 조합이 필요하거나 발행본을 신뢰할 수 없을 때의 대안이다.

## 호환 버전 표

| 도구 | 호환 버전 | 설치 | 이 세트가 제공하는 기능 |
| --- | --- | --- | --- |
| isthmus-cli | **0.6.0** | `npm install --global isthmus-cli` (Node 22.18.0 이상) | `check`·`query`·`graph`·`diff`·`retentions`·`impact`·`preflight`·`verify-runtime` |
| cartograph | **0.15.1** | `brew install ictechgy/tap/cartograph` | `bridges --target flutter`, `bridges --messages`(v2), `impact`, `dead --external-retentions` |
| kartograph | **0.10.0** | GitHub Release 아카이브(`kartograph-0.10.0.tar`/`.zip`), Gradle plugin `io.github.ictechgy.kartograph` | `impact --graph-file`, `bridges --target flutter --messages --graph-file` |
| dartograph | **0.10.0** | `dart pub global activate dartograph` | `bridges --format json`, `bridges --messages --format json`(v2), `impact` |

최소 조합은 따로 있다. MethodChannel(v1) 조인과 retention 왕복만 필요하면
cartograph 0.5.3 이상·dartograph 0.1.1 이상도 동작한다. BasicMessageChannel(v2),
preflight 전이 경로, Kotlin 쪽 조인에는 위 표의 버전이 필요하다. EventChannel과
React Native 추출은 어느 버전에도 없다(계획 단계).

## 실측으로 확인한 범위 (2026-09-16)

- cartograph 0.15.1 `bridges` → isthmus 0.6.0 `retentions --for cartograph` →
  cartograph 0.15.1 `dead --external-retentions`의 억제와 `--explain` 근거 문장을
  공개 corpus(Flutter 스텁을 포함한 SwiftPM fixture)에서 확인했다.
  재현: `node scripts/verify-cartograph-roundtrip.mjs <cartograph> <dartograph> <fixture-root>`.
- cartograph 0.15.1과 dartograph 0.10.0의 `bridges --messages`가 bridge-facts v2
  (`transport: basic-message-channel`) 문서를 출력함을 확인했다.
- kartograph 0.10.0은 `bridges --messages --graph-file` 코드가 main에 있음을 확인했으나
  이번 세션에서 Android 프로젝트로 실행하지는 않았다.

아직 확인하지 않은 것: 전체 앱 정확도, iOS 실기기, 다른 Android API/ABI,
release 빌드·권한/생명주기·다중 engine. 실행하지 않은 경로의 완전성을 보장하지
않는다. cache 없는 첫 설치는 아래 cold-cache 절차와 워크플로로 감시한다.

## cold-cache 재현

발행 산출물만 새로 설치해 조인·보존·사전 점검이 재현되는지 확인하는 경로다.
`.github/workflows/cold-cache.yml`이 주 1회 같은 단계를 새 러너에서 실행한다 —
발행본이 아래에서 바뀌거나 설치 경로가 깨지면 예약 실행이 잡아낸다.

```bash
# 발행 패키지만으로 고정 fixture 검증 (Ubuntu 포함 어느 OS나)
npm install --global isthmus-cli
node scripts/verify-cold-cache.mjs "$(npm root --global)/isthmus-cli/dist/cli/main.js"

# producer까지 포함한 3방향 조인 검증 (macOS)
brew install ictechgy/tap/cartograph
dart pub global activate dartograph
curl -fsSL https://github.com/ictechgy/kartograph/releases/download/v0.10.0/kartograph-0.10.0.tar | tar -x
node scripts/verify-cold-cache.mjs "$(npm root --global)/isthmus-cli/dist/cli/main.js" \
  "$(brew --prefix)/bin/cartograph" "$HOME/.pub-cache/bin/dartograph" <kartograph-경로>/bin/kartograph
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
      - run: npm install --global isthmus-cli@0.6.0
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
