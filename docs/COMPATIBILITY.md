# 공개 호환 버전 세트

2026-10-01 갱신한 isthmus 0.11.0의 릴리스 후보 호환 대상 세트다. 새 후보 세트는 현재 로컬 산출물로
검사 중이며, registry 설치본과 cold-cache CI 검증은 발행 뒤 별도로 기록한다. 이전 발행본의 설치 검증은
[0.10.0 절](#0100-호환-갱신-2026-09-30)과 [tsograph 0.1.0 절](#tsograph-010-추가-2026-10-01)에
보존한다. 이전 조합의 MethodChannel·BasicMessageChannel 조인,
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
세트이고, 이후 저장소 manifest를 kartograph 0.14.0으로 갱신했다. npm 0.10.0은 아래 표에서 tsograph를
뺀 세트를 담는다 — tsograph 0.1.0 행은 npm 0.10.0 발행 뒤 저장소 manifest에만 더했고, npm은 재발행하지 않으며
isthmus 0.11.0 릴리스 후보 tarball은 tsograph 0.2.0 행을 포함한다.
기존 npm 아카이브는 불변이다.
`npm run verify`의 `scripts/verify-compatibility.mjs`가 이 문서·README·README.ko의
버전 표기가 정본과 일치하는지 검사하므로, 버전을 올릴 때 한 곳만 고치면 drift가 실패로
드러난다. 이 문서의 산문이 서술하는 기능 범위와 실측 이력은 정본이 아니다.

## 호환 버전 표

아래 표는 현재 저장소에서 검증하는 호환 대상이다. 발행 전에는 후보 산출물로 검사하고 발행 후에는
registry 설치본과 cold-cache CI의 실제 버전을 대조한다. 과거 발행본 검증은 아래 이력과 구분한다.

| 도구 | 호환 버전 | 설치 | 이 세트가 제공하는 기능 |
| --- | --- | --- | --- |
| isthmus-cli | **0.11.0** | `npm install --global isthmus-cli@0.11.0` (Node 22.18.0 이상) | `check`·`query`·`graph`·`diff`(`--http` 포함)·`retentions`·`impact`·`preflight`·`trace`·`surface export`·`verify-runtime`·`extract-js`, GitHub Action `ictechgy/isthmus@v0.11.0` |
| cartograph | **0.23.1** | GitHub Release 아카이브(`cartograph-0.23.1-macos-universal.tar.gz`), `brew install ictechgy/tap/cartograph`(tap의 최신판) | `bridges --target flutter`, `bridges --messages`·`--events`(v2), Expo Modules DSL(`mechanism`), `impact`, `dead --external-retentions`, `schema`(persistence), `routes`(http `route-call`: URLSession·Alamofire·Moya), `impact --format language-traversal`(`--roots-from`) |
| kartograph | **0.18.1** | GitHub Release 아카이브(`kartograph-0.18.1.tar`/`.zip`), Gradle plugin `io.github.ictechgy.kartograph` | `impact --graph-file`, `bridges --target flutter --messages --graph-file`, `bridges --target flutter --events`, Expo Modules DSL(`mechanism`), `schema`(persistence), `routes --role client`(Retrofit·RestTemplate·RestClient·WebClient·`@HttpExchange`)·`--role server`(Spring MVC·WebFlux), `impact --format language-traversal`, `reach` |
| dartograph | **0.16.1** | `dart pub global activate dartograph 0.16.1` | `bridges --format json`, `bridges --messages`·`--events --format json`(v2), `impact`, `schema`(persistence, `symbol.usr`), `routes --role client`(http·dio·retrofit.dart·chopper), `impact --format language-traversal` |
| schemagraph | **0.7.0** | `cargo install schemagraph-cli --version 0.7.0 --locked` 또는 GitHub Release 아카이브(`schemagraph-0.7.0-aarch64-apple-darwin.tar.gz`·`schemagraph-0.7.0-x86_64-unknown-linux-gnu.tar.gz`, `SHA256SUMS`) | `facts`(sql persistence `relation-decl`, `symbol.usr`), `query`·`impact --format language-traversal`(DB 의존자, trace 입력) |
| gartograph | **0.9.1** | `brew install ictechgy/tap/gartograph` 또는 `go install github.com/ictechgy/gartograph/cmd/gartograph@v0.9.1` | `schema`(persistence `relation-use`), `routes --role server`(net/http·chi·gin·echo)·`--role client`(net/http·resty), `reach`, `impact --format language-traversal` |
| rustograph | **0.4.1** | `brew install ictechgy/tap/rustograph` 또는 `cargo install --git https://github.com/ictechgy/rustograph --tag v0.4.1` | `schema`(persistence `relation-use`), `routes --role server`(axum·actix)·`--role client`(reqwest·ureq), `reach`, `impact --format language-traversal` |
| tsograph | **0.2.0** | `npm i -g tsograph@0.2.0` (Node 22.18.0 이상) | `openapi`(OpenAPI 2.0/3.0/3.1 → `route-contract`), `routes --role server`(Next.js App Router·Pages Router API, Hono·Express·Fastify·Koa·NestJS)·`--role client`(웹/RN fetch·axios·ky), `schema`(Prisma·SQL 텍스트 persistence `relation-use`), `graph`·`reach`·`impact`(language-traversal v1) |

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

## tsograph 0.1.0 추가 (2026-10-01)

npm 0.10.0 발행 뒤 저장소 manifest에 tsograph 0.1.0(npm)을 더했다. npm의 isthmus-cli 0.10.0 tarball에 든
`compatibility.json`에는 tsograph가 없고, isthmus npm은 재발행하지 않는다 — 다음 isthmus 릴리스의 tarball이 이
행을 포함한다. 격리한 npm prefix에 설치한 tsograph 0.1.0의 `--version`이 `scripts/verify-installed-compatibility.mjs`로
manifest와 일치함을 확인했고(macOS arm64), cold-cache workflow의 `api-producers` job이 같은 대조를 npm 설치본으로
반복한다. 이 확인은 설치·버전 범위다 — tsograph 문서를 isthmus 0.10.0 발행본의 check·trace로 잇는 e2e는 이 세트의
발행본으로 측정하지 않았다.

## 0.10.0 호환 갱신 (2026-09-30)

isthmus 0.10.0은 http 도메인(check·query·`diff --http`·trace·surface)과 persistence·language-traversal 입력을
받는다. 이 세트의 producer는 그 문서를 생산하는 첫 발행본이다 — cartograph 0.23.0(Homebrew·GitHub Release),
kartograph 0.18.0(GitHub Release·Gradle Plugin Portal), dartograph 0.16.0(pub.dev), schemagraph 0.7.0(crates.io
`schemagraph-cli`·GitHub Release 아카이브), gartograph 0.9.0·rustograph 0.4.0(GitHub Release·Homebrew). 새로 더한
schemagraph·gartograph·rustograph 행은 cold-cache CI가 발행 아카이브의 checksum과 `--version`을 manifest와 대조한다.
cold-cache는 빌드 시간이 없는 schemagraph 릴리스 아카이브를 쓰고, crates.io 설치 경로는 아래 발행 전 확인에서 따로
확인했다.

발행 전 확인(2026-09-30, macOS arm64): 위 여섯 producer의 발행 아카이브(cartograph는 formula·릴리스 노트의
sha256, kartograph TAR·gartograph·rustograph·schemagraph는 발행 checksum 파일과 일치)와 격리한 pub cache의
dartograph 0.16.0, 릴리스 브랜치에서 `npm pack`한 isthmus-cli 0.10.0 후보 tarball의 격리 설치본이
`scripts/verify-installed-compatibility.mjs`를 통과했다. 같은 후보와 cartograph·dartograph·kartograph 발행본으로
`scripts/verify-cold-cache.mjs`의 고정 문서 조인·retention·preflight와 `fixtures/bridge-app` 3방향 MethodChannel
조인도 통과했다. crates.io에서 격리 root로 `cargo install schemagraph-cli --version 0.7.0 --locked`한 설치본도
`verify-installed-compatibility`를 통과했다. npm 0.10.0 설치본의 대조는 발행 뒤 cold-cache workflow로 확인한다.

이 확인은 설치·버전·기존 bridge 조인 경로다. 이 세트 producer의 http·persistence·language-traversal 문서를
발행본으로 만들어 trace까지 잇는 e2e는 각 producer 저장소의 개발 검증(isthmus 76b6141·3a45450 벡터 lock)에 있고,
이 세트의 발행본으로 다시 측정하지 않았다.
rustograph 0.4.0은 서버 `route-decl`의 `location.column`을 UTF-16 코드 단위로 센다(GRAPH-EXCHANGE는 UTF-8
바이트) — 비ASCII 문자가 있는 줄에서 열 위치가 어긋나는 알려진 결함이다.

## 0.9.0 / 0.14.0 호환 갱신 (2026-09-21)

npm의 isthmus 0.9.0, Homebrew의 cartograph 0.20.0, pub.dev의 dartograph 0.15.0,
GitHub Release의 kartograph 0.14.0 TAR 설치본을 당시 manifest와 대조했다.
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
npm install --global isthmus-cli@0.10.0
node scripts/verify-cold-cache.mjs "$(npm root --global)/isthmus-cli/dist/cli/main.js"

# producer까지 포함한 3방향 조인 검증 (macOS)
curl -fsSL https://github.com/ictechgy/cartograph/releases/download/0.23.0/cartograph-0.23.0-macos-universal.tar.gz -o cartograph-0.23.0.tar.gz
tar -xzf cartograph-0.23.0.tar.gz   # cartograph/cartograph
dart pub global activate dartograph 0.16.0
curl -fsSL https://github.com/ictechgy/kartograph/releases/download/v0.18.0/kartograph-0.18.0.tar -o kartograph-0.18.0.tar
tar -xf kartograph-0.18.0.tar
node scripts/verify-installed-compatibility.mjs \
  isthmus="$(command -v isthmus)" cartograph="$PWD/cartograph/cartograph" \
  dartograph="$HOME/.pub-cache/bin/dartograph" kartograph="$PWD/kartograph-0.18.0/bin/kartograph"
node scripts/verify-cold-cache.mjs "$(npm root --global)/isthmus-cli/dist/cli/main.js" \
  "$PWD/cartograph/cartograph" "$HOME/.pub-cache/bin/dartograph" "$PWD/kartograph-0.18.0/bin/kartograph"

# API 영향 producer의 발행 아카이브 버전 대조 (Linux x86_64 예시 — macOS는 darwin 아카이브)
curl -fsSLO https://github.com/ictechgy/gartograph/releases/download/v0.9.0/gartograph-0.9.0-linux-amd64.tar.gz
curl -fsSLO https://github.com/ictechgy/rustograph/releases/download/v0.4.0/rustograph-0.4.0-linux-amd64.tar.gz
curl -fsSLO https://github.com/ictechgy/schemagraph/releases/download/v0.7.0/schemagraph-0.7.0-x86_64-unknown-linux-gnu.tar.gz
for archive in *.tar.gz; do tar -xzf "$archive"; done
node scripts/verify-installed-compatibility.mjs \
  gartograph="$PWD/gartograph-0.9.0-linux-amd64/gartograph" \
  rustograph="$PWD/rustograph-0.4.0-linux-amd64/rustograph" \
  schemagraph="$PWD/schemagraph-0.7.0/schemagraph"

# tsograph는 npm 발행본을 설치해 버전을 대조한다
npm install --global tsograph@0.1.0
node scripts/verify-installed-compatibility.mjs tsograph="$(command -v tsograph)"
```

cartograph는 Homebrew formula 대신 같은 GitHub Release 아카이브를 manifest 버전으로 받는다. tap에는
최신 formula 하나만 있어 `brew install`로는 버전을 고정할 수 없다 — 그래서 cartograph를 새로 발행할 때마다
manifest를 올리기 전까지 cold-cache가 실패했다. formula의 `url`이 바로 이 아카이브이므로 설치되는 실행 파일은
같다. cartograph 릴리스에는 checksum 파일이 없어 workflow는 GitHub가 기록한 release asset digest(sha256)와
대조한다. formula 자체(`brew test`)는 producer 릴리스 절차가 확인한다.

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
      - run: brew install ictechgy/tap/cartograph   # tap 최신판 — 고정하려면 위 cold-cache 절처럼 릴리스 아카이브
      - run: dart pub global activate dartograph 0.16.0
      - run: npm install --global isthmus-cli@0.10.0
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
