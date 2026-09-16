# 실사용 정밀도 코퍼스

공개 Flutter 플러그인의 **고정 pub.dev 아카이브** 위에서 `isthmus preflight`의 경계 예측을
수동 정답과 비교한다. 합성 fixture가 아니라 실제 배포된 소스·실제 버전 간 diff를 쓴다.

## 범위와 한계

- **실측**: MethodChannel(v1)·Pigeon/BasicMessageChannel(v2)의 정적 브리지 경계,
  파일·심볼·git diff(`since`) 선택, Swift+Objective-C 네이티브 관찰, Dart↔native 조인.
- **하네스**: Flutter SDK가 없어 Swift는 `harness/swift/FlutterMacOS.swift` 스텁을
  의존성으로 둔 SwiftPM 타깃을 **실제 컴파일**해 컴파일러 인덱스를 만들고,
  Dart는 `harness/flutter_stub`(최소 services/foundation 표면)와 pub.dev 의존성을
  수동 `package_config.json`으로 해석한다. 런타임 실행은 없다.
- **범위 밖**: Kotlin/Android(producer 미설치·미실행), EventChannel 스트림,
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

## 케이스와 정답

12개 케이스 — 파일/심볼 선택과 실제 버전 간 diff를 섞는다.

| 케이스 | 선택 | 정답 근거 |
|---|---|---|
| bp-file-swift-plugin | macOS 플러그인 파일 | 등록+3핸들러 한 파일 → 3 method |
| bp-file-dart-channel | `method_channel_battery_plus.dart` | 채널 생성+3 invokeMethod → 3 method |
| bp-symbol-dart-batterylevel | `MethodChannelBattery.batteryLevel` | `getBatteryLevel`만 호출 → 1 method |
| bp-file-event-handler | `BatteryPlusChargingHandler.swift` | EventChannel만 — method 경계 없음 |
| bp-diff-622-623 | 실제 6.2.2→6.2.3 diff | iOS ObjC 등록 파일 1줄+Kotlin → 3 method |
| sp-file-plugin | `SharedPreferencesPlugin.swift` | 두 Api 구현 → 11 prefix |
| sp-file-generated | `messages.g.swift` | Pigeon 배선 파일 → 11 prefix |
| sp-symbol-legacy-remove | `LegacySharedPreferencesPlugin.remove(key:)` USR | dispatch 근거 → `LegacyUserDefaultsApi.remove`만 |
| sp-diff-253-254 | 실제 2.5.3→2.5.4 diff | 생성 파일 codec rename → 11 prefix |
| ul-file-plugin | `UrlLauncherPlugin.swift` | 구현+등록 → 2 prefix |
| ul-symbol-setup | `UrlLauncherApiSetup.setUp` USR | 등록 함수 변경 → 2 prefix |
| ul-diff-321-322 | 실제 3.2.1→3.2.2 diff | Pigeon v10→v22 재생성·wire format 변경 → 2 prefix |

Pigeon 채널명은 `\(channelSuffix)` 보간으로 **동적**이다 — 정답·예측 모두
관측된 `channelPrefix`로 비교한다.

## 실행

```bash
npm run build
node experiments/real-corpus/run.mjs /path/to/cartograph /path/to/dartograph
```

macOS 전용(스텁은 macOS SwiftPM만 둔다). 아카이브는 pub.dev에서 받아 sha256을
검증하고, diff 케이스는 프로젝트를 git 초기화해 기저를 커밋한 뒤 새 버전을 덮어쓴다.

## 결과 해석 (최초 실행, 2025-09 기준)

`isthmus 0.6.0` + `cartograph 0.15.1` + `dartograph 0.11.0` 조합:

- **TP 50 / FN 0 / FP 3** (12/12 케이스 실행).
- FN 0 — 정답 경계를 빠뜨리지 않았다. 단 Objective-C·동적 채널은
  `objective-c-handlers`·`dynamic-message-channel-names` 등 한계로 표시됐다.
- FP 3은 `bp-file-event-handler` 한 케이스에서 발생: EventChannel 스트림 핸들러
  파일을 선택했는데 `register(with:)`가 그 파일의 심볼을 참조해 등록 경계가
  `dev.fluttercommunity.plus/battery` 채널 전체로 확대됐다. 메서드 단위로는
  오탐이지만 "등록 배선이 깨질 수 있다"는 보수적 확대이며 `unscanned-event-channels`
  한계가 함께 보고됐다.
- `bp-diff-622-623`은 `status: unobserved`(심볼 분석 공백)이면서도 변경 파일에 있는
  ObjC fact에서 3 method 경계를 보고했다 — `unconfigured-platform-changes`로
  Kotlin 공백이 명시된다.
- 이 수치는 **정적 브리지 경계**의 정밀도다. 런타임 실행·EventChannel·Kotlin·
  실제 Flutter 앱 빌드는 측정하지 않았다.
