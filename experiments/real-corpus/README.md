# 실사용 정밀도 코퍼스

공개 Flutter 플러그인과 **실제 앱(LocalSend)** 의 고정 아카이브 위에서
`isthmus preflight`의 경계 예측을 수동 정답과 비교한다. 합성 fixture가 아니라
실제 배포된 소스·실제 버전 간 diff를 쓴다.

## 범위와 한계

- **실측**: MethodChannel(v1)·Pigeon/BasicMessageChannel(v2)·EventChannel
  (v2 `stream-listen`/`stream-handle`)의 정적 브리지 경계,
  파일·심볼·git diff(`since`) 선택, Swift+Objective-C 네이티브 관찰,
  Dart↔Swift↔Kotlin 3방향 조인.
  EventChannel은 `bridges --events` opt-in 문서로 수집해 별도 transport로 조인한다.
- **하네스**: Flutter SDK가 없어 Swift는 `harness/swift/FlutterMacOS.swift` 스텁을
  의존성으로 둔 SwiftPM 타깃을 **실제 컴파일**해 컴파일러 인덱스를 만들고,
  Dart는 `harness/flutter_stub`(최소 services/foundation 표면)와 pub.dev 의존성을
  수동 `package_config.json`으로 해석한다. 런타임 실행은 없다.
- **Kotlin**: kartograph 바이너가 주어지면 `kotlin: true` 케이스에서 스냅샷 없는
  **소스 스캔**으로 채널·핸들러 사실을 조인한다. 컴파일러 인덱스·런타임 실행이
  아니므로 `missing-handler-usrs` 한계가 붙는다. 바이너가 없으면 기존처럼
  미구성 플랫폼 한계를 관측한다.
- **범위 밖**: Kotlin 컴파일 인덱스·Android 기기 실행,
  Flutter 엔진 실행, iOS 기기 빌드, 앱 수준 전체 정밀도.
- 이 하네스의 iOS Objective-C 파일은 컴파일하지 않는다 — cartograph가 직접 패턴으로 읽은 사실만
  포함되며 `objective-c-handlers`/`objective-c-sources` 한계가 붙는다.

## 구성

- `manifest.json` — 고정 아카이브(package·버전·URL·sha256·라이선스·upstream),
  스테이징 규칙, 케이스별 선택과 수동 정답.
- `run.mjs` — 아카이브 검증·스테이징→`swift build`→`capturePreflight`→비교.
- `public-archive.mjs` — RN npm 아카이브의 고정 SHA256·멤버 경로/종류 검사. 고정 해시가
  신뢰 기준이며 tar 목록 검사는 보조 방어다. 임의의 신뢰할 수 없는 아카이브를 받는 제품 API가 아니다.
- `harness/` — FlutterMacOS.swift 스텁, flutter_stub Dart 패키지.
- `results/results.json` — 최근 실행의 케이스별 예측·정답·계수·한계.

스테이징은 원본을 수정하지 않는다. 플러그인 아카이브의 `lib/`·네이티브 디렉터리를
바이트 동일하게 복사하고, battery는 Dart 브리지가 사는 `battery_plus_platform_interface`의
`lib/`·pubspec과 `battery_plus`의 `macos/`·`ios/`·`android/`를 조합한다
(android/는 미구성 Kotlin 한계를 드러내기 위해 포함한다).
`{ "from": ..., "to": ... }` 매핑으로 아카이브 내부 경로를 재배치할 수 있다 —
LocalSend는 GitHub tarball의 `app/` 하위를 프로젝트 루트로 옮긴다.
앱 타깃은 SPM 외부 의존을 `stubTargets` 스텁 모듈로 대체한다
(LocalSend의 Defaults·DockProgress·LaunchAtLogin·window_manager).

## 케이스와 정답

15개 케이스 — 파일/심볼 선택과 실제 버전 간 diff를 섞는다.

| 케이스 | 선택 | 정답 근거 |
|---|---|---|
| bp-file-swift-plugin | macOS 플러그인 파일 | 등록+3핸들러 한 파일 → 3 method + charging stream |
| bp-file-dart-channel | `method_channel_battery_plus.dart` | 채널 생성+3 invokeMethod+1 수신 → 3 method + charging stream |
| bp-symbol-dart-batterylevel | `MethodChannelBattery.batteryLevel` | `getBatteryLevel`만 호출 → 1 method |
| bp-file-event-handler | `BatteryPlusChargingHandler.swift` | `getBatteryState`(case 절이 ChargingHandler 호출) + charging stream |
| bp-diff-622-623 | 실제 6.2.2→6.2.3 diff | iOS ObjC 등록 파일 1줄+Kotlin → 3 method |
| sp-file-plugin | `SharedPreferencesPlugin.swift` | 두 Api 구현 → 11 prefix |
| sp-file-generated | `messages.g.swift` | Pigeon 배선 파일 → 11 prefix |
| sp-symbol-legacy-remove | `LegacySharedPreferencesPlugin.remove(key:)` USR | dispatch 근거 → `LegacyUserDefaultsApi.remove`만 |
| sp-diff-253-254 | 실제 2.5.3→2.5.4 diff | 생성 파일 codec rename → 11 prefix |
| ul-file-plugin | `UrlLauncherPlugin.swift` | 구현+등록 → 2 prefix |
| ul-symbol-setup | `UrlLauncherApiSetup.setUp` USR | 등록 함수 변경 → 2 prefix |
| ul-diff-321-322 | 실제 3.2.1→3.2.2 diff | Pigeon v10→v22 재생성·wire format 변경 → 2 prefix |
| ls-swift-appdelegate | `AppDelegate.swift` | 채널 등록+`handleFlutterCall` switch 한 파일 → 12 method |
| ls-dart-macos-channel | `macos_channel.dart` | 채널 선언+11 invokeMethod → 11 method(네이티브 전용 핸들러 제외) |
| ls-dart-android-channel | `android_channel.dart` | 6 invokeMethod ↔ Kotlin `when` 핸들러 6 → 6 method |

Pigeon 채널명은 `\(channelSuffix)` 보간으로 **동적**이다 — 정답·예측 모두
관측된 `channelPrefix`로 비교한다.

## 실행

```bash
npm run build
node experiments/real-corpus/run.mjs /path/to/cartograph /path/to/dartograph [/path/to/kartograph]
```

발행 npm 패키지의 수집기를 직접 사용하고 15케이스의 캐시도 함께 측정하려면:

```bash
node experiments/real-corpus/run.mjs /path/to/cartograph /path/to/dartograph /path/to/kartograph \
  --isthmus-package /path/to/node_modules/isthmus-cli --measure-cache
```

macOS 전용(스텁은 macOS SwiftPM만 둔다). 아카이브는 pub.dev·GitHub에서 받아 sha256을
검증하고, diff 케이스는 프로젝트를 git 초기화해 기저를 커밋한 뒤 새 버전을 덮어쓴다.
kartograph 인자가 있으면 `kotlin: true` 케이스의 Kotlin 브리지 문서를 조인한다. GitHub 배포의
`bin/kartograph`와 형제 `lib/` 디렉터리를 유지해야 하며, 둘 다 수집 캐시 지문에 포함한다.
생성물·하네스는 Git diff 선택에서 제외하되 capture 입력으로 계속 지문을 남긴다.
케이스 오류·FN/FP·예상 한계 불일치는 종료 코드 1이다. `--measure-cache`는 케이스마다
새 isthmus 캐시에서 miss→hit와 전체 보고서 동일성을 검사한다. 결과의 `milliseconds`는 첫
capture만의 시간이며, 재사용 시간과 스텝별 시간은 `cacheMeasurement`에 분리한다.
SDK·컴파일·producer 캐시는 지우지 않으므로 앱 빌드나 일반적인 성능 향상 측정은 아니다.

## React Native 호출 측 (extract-js)

`manifest.json`의 `rn` 절은 npm tarball을 고정하고 `run-rn-js.mjs`로 호출 측 사실을
계수한다. 이 경로는 producer 없이 isthmus CLI만으로 재현된다.

```bash
npm run build
node experiments/real-corpus/run-rn-js.mjs "$(pwd)/dist/cli/main.js"
```

범위는 JS/TS `extract-js`가 생산하는 `module-import`·`method-invoke`뿐이다. expo-haptics
14.1.4는 `ExpoHaptics` 모듈 수입(mechanism `expo`, optional) 1건과 메서드 호출 4건을
기대하며, 2026-09-18 실행은 **TP 5 / FN 0 / FP 0**이었다. 수신 측(cartograph Expo
DSL 스캔)은 아래 `run-rn-receiver.mjs`가 다룬다. Kotlin 수신 측은 명시적으로 추가한다.

## React Native 수신 측 (cartograph Expo DSL)

`run-rn-receiver.mjs`는 같은 tarball에서 extract-js(호출 측)와 cartograph
`bridges --target react-native --allow-empty-index`(Expo DSL 수신 측)를 만들고
`isthmus check`로 결합한다. cartograph 실행 파일이 필요하다.

```bash
npm run build
node experiments/real-corpus/run-rn-receiver.mjs \
  "$(pwd)/dist/cli/main.js" /path/to/cartograph [/path/to/empty-index-store]
```

Swift 전용 결과: **matchedModules 1**(ExpoHaptics, `mechanism: "expo"`) ·
**matchedMethods 3**(notificationAsync·impactAsync·selectionAsync). iOS만 쓰면
Android 전용 `performHapticsAsync`가 미대응 invocation으로 남는다 — 이는 결함이
아니라 플랫폼 비대칭이다. kartograph Android 수신 측을 더하면 4가 된다. 결과는
`results/rn-receiver-results.json`에 남긴다.

Kotlin 수신 측을 포함하려면 기존 명령 뒤에 `--kartograph /path/to/kartograph`를 붙인다.
원본 `HapticsModule.kt`의 4개 핸들러를 별도로 확인하고 Swift의 3개 핸들러도 독립적으로 대조한다.
두 플랫폼을 합치면 모듈 1개·메서드 4개가 조인되고 Android 전용 메서드도 대응한다.
결과는 `results/rn-kotlin-receiver-results.json`에 써서 Swift 전용 실행 결과와 구분한다.
**kartograph 0.12.0 이상**을 사용한다. 0.11.0은 일반 `--target react-native`를 코드 64로
거부하는 회귀가 있었으며 이 공개 코퍼스에서 재현해 수정했다. 소스 스캔이므로 JVM ID·보존
성공·앱 런타임을 검증하는 경로는 아니다. 이전 Swift 전용 결과는
[과거 결과](results/history/pre-kotlin-rn-receiver.json)에 보존한다.

고정 npm 아카이브의 파일 mtime은 `1985-10-26T08:15:00Z`다. 발행된 Kotlin 0.12.0 생산자는 이 값을
`generatedAt`에 사용하고 JS·Swift는 추출 시각을 사용하므로, 소비자에 수십 년의
`input-freshness` 차이가 기록된다. 원본 해시 검증과 이 시간 한계를 함께 보존·해석한다.
개발 소스에서는 `generatedAt`을 추출 시각으로 통일하고 `sourceModifiedAt`에 mtime을
따로 기록한다. 어느 시각도 compiler snapshot과 source의 일치를 보장하지 않는다.

## React Native 전역 이벤트 (JS ↔ Kotlin/Java)

```bash
node experiments/real-corpus/run-rn-events.mjs /path/to/isthmus/dist/cli/main.js /path/to/kartograph
```

기본 기대값·출력은 개발 소스용이다. 발행된 isthmus0.8.0을 대조하려면 마지막에
`--published`를 주면 해당 버전의 알려진 누락 기대값을 사용한다. 선택적 output-json을
지정해 별도 파일로 기록할 수 있다. 개발 실행은 과거 발행본 결과 파일을 덮어쓰지 않는다.

고정 `react-native-sound` 두 버전의 원본을 검사한다. 0.13.0의 `src/index.ts`는 직접 만든
const NativeEventEmitter로 `onPlayChange`를 구독하고 Kotlin `Sound.kt`는 같은 리터럴을
방출한다. 0.11.2의 CommonJS namespace와 모듈 범위 `var` emitter 구독은 개발 소스에서
직접 초기화·안정 바인딩을 확인해 관찰한다. 발행된 0.8.0의 caller FN 기록은 보존한다.

TP/FN/FP 단위는 **소스 사실**이며 각 케이스의 정답은 구독 1개·방출 1개다.
이벤트 이름 조인 수(`matchedEvents`)와 구분한다. [개발 소스 결과](results/rn-event-development-results.json)는
TP 4 / FN 0 / FP 0이며 두 사례에서 각각 이벤트 1개가 연결된다. `expectedScopeMatches`는 이 명시된 범위와 관측이 맞는지
확인하는 값이지 전체 정확도나 삭제 안전성 판정이 아니다.
원본 위치·아카이브 해시를 검사하고 소스/라이선스 해시를 근거로 기록한다. native 컴파일이나
RN 엔진을 실행하지 않으며 JVM ID가 없어 보존 요청이 거부되는 것도 검사한다.
개발 소스에서는 두 사례 모두 JVM ID가 없는 보존 요청을 거부하는지 확인한다.
결과의 `limitations`는 caller·native·consumer가 실제로 보고한 한계를 모두 보존한다.

아카이브 경계의 회귀 검사는 `node --test experiments/real-corpus/public-archive.test.mjs`로
실행하며 두 OS PR CI에도 포함된다.

## 컴파일된 공개 RN 원본과 실제 Flutter 앱 (개발 소스)

```bash
node experiments/real-corpus/run-rn-compiled.mjs /path/to/isthmus/dist/cli/main.js \
  /path/to/kartograph /path/to/gradle /path/to/android-35/android.jar /path/to/result.json
```

[컴파일된 원본 결과](results/rn-compiled-development-results.json)는 react-native-sound0.13.0의
원본 `Sound.kt`를 Kotlin2.4.20/JVM21로 컴파일한다. Android SDK와 명시적인 RN API 스텁을
사용하고 원본 JS/Kotlin·라이선스 바이트를 확인한다. `Sound.setOnPlay(ZD)V`의 실제 JVM ID로
retention을 만들고 dead 후보 억제와 `src/index.ts:127` caller explain을 확인했다.
스텁을 RN 엔진 실행으로 해석하지 않으며, 이 fixture에는 Gradle build witness를 붙이지 않았다.

[런타임 결과](results/runtime-development-results.json)는 Flutter3.47.2의 실제 macOS 앱과
소유한 Android API36 arm64 에뮬레이터 앱에서 MethodChannel·BasicMessageChannel 및 고정
공개 Pigeon plugin을 실행한 별도 근거다. 성공·오류·미등록·타임아웃·pending을 대조했다.
물리 기기·iOS·release·모든 lifecycle 검증은 포함하지 않고, RN 엔진 검증과도 구분한다.
연결된 기기 대신 전용 에뮬레이터를 선택하려면 Android 하네스에 `--new-emulator`를 준다.

## 현재 발행 조합 결과 (2026-09-20)

[검증한 설치본/해시](results/published-tools.json)는 isthmus 0.8.0 · cartograph 0.20.0 ·
kartograph 0.12.0 · dartograph 0.15.0이다. npm 패키지에 들어 있는 capture 라이브러리를
직접 불러 전체 15케이스를 실행했다. 새 producer 버전은 현재 저장소의 compatibility.json과
cold-cache CI에도 반영하며, npm 0.8.0에 처음 포함된 manifest와 구분한다.

- [Flutter 원시 결과](results/results.json): **TP 83 / FN 0 / FP 0**, 15/15.
- [전체 캐시 측정](results/full-corpus-cache-measurements.json): 15/15 miss→hit·전체 보고서 동일성.
- [Kotlin/Swift Expo 수신 측](results/rn-kotlin-receiver-results.json): 모듈 1개·메서드 4개, 미대응 호출 0.
- [RN 전역 이벤트](results/rn-event-results.json): 발행본 소스 사실 **TP 3 / FN 1 / FP 0**.
  FN 1은 발행본 0.8.0이 놓친 0.11.2의 var emitter 구독이다. 위 개발 소스 결과와 구분한다.

각 수치는 그 케이스의 수동 정답·선택 범위를 대상으로 한다. Flutter 스텁·수동 Dart package_config·
Kotlin/Java 소스 스캔의 한계를 유지하며, 앱 엔진이나 기기를 실행한 결과가 아니다.

## 이전 결과 해석 (LocalSend 추가 실행 기준)

`isthmus 0.6.0` + `cartograph 0.15.1` + `dartograph 0.11.0` + `kartograph 0.9.0` 조합:

원본 수치는 [이전 Flutter 결과](results/history/pre-0.8.0-flutter.json)에 보존한다.

- **TP 83 / FN 0 / FP 0** (15/15 케이스 실행, `kotlinCoverage: true`).
- FN 0 — 정답 경계를 빠뜨리지 않았다. 단 Objective-C·동적 채널·JVM 심볼은
  `objective-c-handlers`·`dynamic-message-channel-names`·`missing-handler-usrs`
  등 한계로 표시됐다.
- LocalSend는 **앱 수준 첫 3방향 조인**이다. Dart↔Kotlin 채널
  (`org.localsend.localsend_app/localsend`)은 6/6 메서드가 정확히 조인됐고,
  macOS 채널(`main-delegate-channel`)에서는 실제 불일치를 그대로 보고한다 —
  Dart의 `removeExistingDestinationAccess` 호출은 네이티브 핸들러가 없고
  (error), Swift의 `removeDestinationFolderAccess` 핸들러는 호출자가 없다
  (warning). 둘 다 경계로 예측돼 TP로 계수된다.
- `bp-diff-622-623`은 `status: unobserved`(심볼 분석 공백)이면서도 변경 파일에 있는
  ObjC fact에서 3 method 경계를 보고한다.
- 이 수치는 **정적 브리지 경계**의 정밀도다. Kotlin은 소스 스캔이며 런타임
  실행·실제 Flutter 앱 빌드는 측정하지 않았다.

## 수집 캐시 측정

[캐시 측정 기록](CACHE-MEASUREMENTS.md)은 최신 발행 조합의 전체 15케이스와 이전
4케이스를 조건별로 구분한다. SDK와 생산자 캐시는 유지하며 앱 런타임 성능 측정과 구분한다.
