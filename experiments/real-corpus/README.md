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
- Objective-C 소스는 Swift 인덱스 밖이다 — cartograph가 직접 패턴으로 읽은 사실만
  포함되며 `objective-c-handlers`/`objective-c-sources` 한계가 붙는다.

## 구성

- `manifest.json` — 고정 아카이브(package·버전·URL·sha256·라이선스·upstream),
  스테이징 규칙, 케이스별 선택과 수동 정답.
- `run.mjs` — 아카이브 검증·스테이징→`swift build`→`capturePreflight`→비교.
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

macOS 전용(스텁은 macOS SwiftPM만 둔다). 아카이브는 pub.dev·GitHub에서 받아 sha256을
검증하고, diff 케이스는 프로젝트를 git 초기화해 기저를 커밋한 뒤 새 버전을 덮어쓴다.
kartograph 인자가 있으면 `kotlin: true` 케이스의 Kotlin 브리지 문서를 조인한다.

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
DSL 스캔)은 아래 `run-rn-receiver.mjs`가 다룬다 — kartograph Kotlin은 범위 밖이다.

## React Native 수신 측 (cartograph Expo DSL)

`run-rn-receiver.mjs`는 같은 tarball에서 extract-js(호출 측)와 cartograph
`bridges --target react-native --allow-empty-index`(Expo DSL 수신 측)를 만들고
`isthmus check`로 결합한다. cartograph 실행 파일이 필요하다.

```bash
npm run build
node experiments/real-corpus/run-rn-receiver.mjs \
  "$(pwd)/dist/cli/main.js" /path/to/cartograph [/path/to/empty-index-store]
```

결과: **matchedModules 1**(ExpoHaptics, `mechanism: "expo"`) ·
**matchedMethods 3**(notificationAsync·impactAsync·selectionAsync). iOS만 쓰면
Android 전용 `performHapticsAsync`가 미대응 invocation으로 남는다 — 이는 결함이
아니라 플랫폼 비대칭이다. kartograph Android 수신 측을 더하면 4가 된다. 결과는
`results/rn-receiver-results.json`에 남긴다.

## 결과 해석 (LocalSend 추가 실행 기준)

`isthmus 0.6.0` + `cartograph 0.15.1` + `dartograph 0.11.0` + `kartograph 0.9.0` 조합:

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

[캐시 측정 기록](CACHE-MEASUREMENTS.md)은 공개 캐시 소스 3케이스와 합성 1케이스에서
첫 수집·재사용·보고서 동등성을 확인한다. SDK와 생산자 캐시는 유지하며, 전체 코퍼스
정밀도나 앱 런타임 성능 측정과 구분한다.
