# 런타임 통신 검증 계약

개발 소스의 `verify-runtime`은 명시한 시나리오에서 실제 관찰한 통신 결과를 검증한다.
아직 npm 0.5.0에는 없다. [Flutter 수집기](../packages/isthmus_runtime/README.md)는 앱의
BinaryMessenger에 주입해 실제 outgoing 호출을 기록한다. 정적 후보 연결은
[impact의 런타임 입력](IMPACT.md#런타임-관찰-연결)과
[preflight의 실행 대조](PREFLIGHT.md#전이-분석과-runtime-대조)를 사용한다.

아래 fixtures/runtime JSON은 합성 소비자 검증이다. 실제 native 검증은 별도 절차로 구분한다.

```bash
npm run build
node dist/cli/main.js verify-runtime \
  --expectations fixtures/runtime/expectations.json fixtures/runtime/success.json --strict
```

## 실제 Flutter 앱 검증

```bash
node scripts/verify-flutter-runtime.mjs /path/to/flutter/bin/flutter
# 실제 producer와 전이 분석까지 연결할 때(최신 isthmus build 필요)
node scripts/verify-flutter-runtime.mjs /path/to/flutter/bin/flutter dist/cli/main.js /path/to/cartograph /path/to/dartograph/bin/dartograph.dart
```

macOS·Xcode·CocoaPods·Flutter SDK가 필요하며 최초 준비에는 네트워크를 사용한다. 스크립트는 임시 앱을
만들고 `url_launcher_macos 3.2.2`를 고정해 실제 Pigeon 생성 API를 호출한다. URL을 열지 않고
`canLaunchUrl`만 실행한다. 자체 Swift MethodChannel/BasicMessageChannel도 함께 검사한다.
공개 의존성은 pub.dev에서 해결한다. 앱·Pods 배포 대상은 macOS 12이며 시스템/사용자 앱 설정은 수정하지 않는다.

성공 4개 기대(동적 호출·전이 소비자 호출·자체 Basic·공개 Pigeon), 네이티브 error·missing-handler·timeout의 구분, 앱 Future의 원래 지연 응답,
pending 실행의 미완료와 payload 미기록을 확인한다. 소스·의존성 잠금·SDK revision으로
검증 revision을 만들며, 임시 앱은 정리하고 기록 JSON과 검증 요약 디렉터리를 출력한다.
이 검사는 실제 macOS native 통신이며 iOS/Android 앱 검증으로 확대 해석하지 않는다.

producer 인자를 주면 실제 Xcode compiler index와 양쪽 producer로 별도 Swift helper에서
Dart runtimeBridge→runtimeService→runtimeScreen까지의 경로를 확인한다. context의 입력
해시를 앱의 recorder revision으로 전달하고 같은 revision의 runtime과 preflight를 대조한다.
동적 echo와 전이 소비자의 echo는 별도 시나리오·recorder로 기록해 다른 호출 위치를 공유하지 않는다.
Basic 정적 미지원·실행하지 않은 경계 때문에 preflight strict가 1인 경우도 근거로 보존한다.
선택적 마지막 인자로 준비된 dartograph 실행 파일을 주면 소스 실행의 반복 JIT 비용을 줄일 수 있다.

검증 SDK는 Flutter 3.32.2/Dart 3.8.1이다. 최초 SDK/공개 패키지 준비 시간과 소비자 CLI
시간은 분리한다. 같은 앱의 첫 빌드와 변경 없는 재빌드를 둘 다 측정해 `steps`에 남긴다.

수집기 자체의 검사와 고정 payload 오버헤드 측정:

```bash
cd packages/isthmus_runtime
flutter pub get
flutter analyze --no-pub
flutter test --no-pub
flutter test tool/emit_runtime_fixture.dart --no-pub
flutter test tool/benchmark_recorder.dart --no-pub
```

벤치마크는 fake messenger를 쓰는 디버그 Flutter 테스트다. 실제 디바이스 IPC 지연의 측정이
아니다. 임시/진단 빌드에서 필요한 채널과 실제 codec을 명시하며, Basic/Pigeon reply의 성공·
실패 의미는 명시 classifier가 정한다. 대응하는 codec이 없으면 이름만으로 추측하지 않는다.

## 실제 Android 앱 검증

개발 소스의 Android 하네스는 별도 debug 앱에서 Kotlin MethodChannel/BasicMessageChannel
핸들러를 실행하고 수집기 JSON을 검증한다. Android SDK·JDK·Flutter와 실행 가능한 Android
장치 또는 에뮬레이터 이미지가 필요하다.

```bash
node scripts/verify-flutter-android-runtime.mjs <flutter> <adb> <isthmus-js>
# 같은 capture의 Kotlin 정적 영향과 연결
node scripts/verify-flutter-android-runtime.mjs <flutter> <adb> <isthmus-js> \
  --kartograph <kartograph-bin> --dartograph <dartograph-aot>
```

API 36 arm64 실행에서는 자체 Method/Basic과 공개 `shared_preferences_android 2.4.1`의
Pigeon `getBool` 성공 3개, 기대한 오류·핸들러 누락·timeout 3개, pending 미완료와 자체
Kotlin 본문의 실행 marker를 확인했다. 공개 패키지의 원본 소스·LICENSE·실제 생성 codec을
사용한다. 하네스가 만든 앱과 에뮬레이터만 정리하고 기록과 실행 인자는 근거 폴더에 남긴다.
기본 공개 패키지 경로는 pub 캐시이며 `ISTHMUS_SHARED_PREFERENCES_ANDROID`로 지정할 수 있다.
장치가 없으면 API 36 Google Play 이미지를 사용하며 `ISTHMUS_ANDROID_SYSTEM_IMAGE`로
설치된 이미지 ID를 지정할 수 있다. 최신 조합의 결과는 [진행 기록](COMPETITIVENESS.md)에 남긴다.
이는 명시한 통신 시나리오의 검증이며 임의의 런타임 의존성을 자동 발견하는 기능은 아니다.
정적 연결에는 실제 앱 project와 capture revision을 사용하며 실행 후 식별자를 고쳐 맞추지 않는다.
공개 Kotlin `SharedPreferencesPlugin.getBool`의 실제 snapshot ID만 변경 대상으로 선택하는
별도 capture도 검사한다. 생성 Dart API와 앱 호출자까지 도달해야 통과하며, 이 선택의
revision은 원래 실행 기록과 구분한다. Kotlin의 공통 Pigeon 등록 함수는 여러 채널을 영향
후보로 넓힐 수 있으므로 메서드별 완전한 정밀도를 주장하지 않는다.

## 독립적인 기대 목록

`bridge-expectations` v1:

```json
{
  "format": "bridge-expectations",
  "version": 1,
  "project": "/app",
  "revision": "tested-source-revision",
  "checks": [{
    "id": "photo-main-ios",
    "scenario": "take-photo",
    "platform": "ios",
    "instance": "main",
    "transport": "method-channel",
    "channel": "example/camera",
    "method": "takePhoto",
    "allowedOutcomes": ["success"]
  }]
}
```

실행 로그를 보고 기대 목록을 역생성하면 누락된 실행을 발견할 수 없다. 검증할 기능에서
목록을 먼저 정한다. checks 1~10,000개, 고유한 id가 필요하다. 인스턴스 생략은 어떤
인스턴스든 허용한다는 뜻이다. 엔진별 검증이 필요하면 인스턴스를 명시한다.
`allowedOutcomes`는 선택 사항이며 `success`, `error`, `missing-handler`, `timeout` 중
1~4개의 중복 없는 terminal outcome만 허용한다. 생략하면 `success`만 허용하고,
`pending`은 응답 대기 상태라 기대 결과로 지정할 수 없다.

Flutter recorder에서 timeout은 관찰 제한시간을 넘겼다는 뜻이다. 늦은 응답이나 예외는 앱에
그대로 전달하고 기록의 timeout은 유지한다. 실제 Future가 모두 끝난 뒤 finish하면 completed가
될 수 있지만, 응답이 아직 남은 상태로 finish하면 incomplete다. 따라서 명시한 timeout 기대가
아직 진행 중인 통신까지 허용하지 않는다. finish 후 기록은 나중 응답으로 변경되지 않는다.

## 실행 기록

`bridge-runtime` v1은 같은 project·revision과 producer의 `tool: {name, version}`,
`run: {id, scenario, platform, status, startedAt, finishedAt?}`, `droppedEvents`, `events`를 가진다.

- platform은 `ios/macOS`를 추측하지 않고 `ios|macos|android|linux|windows` 중 하나로 선언한다.
- run status는 `completed|incomplete`. 완료 실행은 종료 시각이 필요하며 시작보다 앞설 수 없다.
- 시각은 bridge-facts와 같은 유효한 timezone 포함 ISO 형식이다.
- event는 `sequence`, `instance`, `transport`, `channel`, `method?`, `outcome`, `caller?`다.
  sequence는 1부터 시작하는 고유한 정수, caller는 상대 `path`와 1부터 시작하는 `line/column`이다.
- transport `method-channel`은 method가 필요하다. `basic-message-channel`은 채널이 주소이며
  method를 붙일 수 없다. Pigeon 메서드 이름이나 접미사를 채널 문자열에서 임의로 파싱하지 않는다.
- outcome은 `success|missing-handler|error|timeout|pending`. 인자·반환값·원문 오류·스택은
  출력 계약에 없으며 입력에 있더라도 파싱 단계에서 버린다. 수집기 자체도 저장하지 않아야 한다.
- 이벤트 100,000개 상한. 수집을 제한하면 `droppedEvents`를 증가시킨다. sequence 빈 구간은
  적어도 그만큼의 유실 계수가 있어야 한다. 응답 대기는 pending으로 남긴다.
- 입력 파일당 16×1024², 전체 64×1024² UTF-16 코드 유닛 예산. 실행 파일은 최대 256개다.
- run id는 전체 입력에서 유일해야 한다. 다른 project·중복 run은 계약 오류다.

project와 revision은 생산자의 선언이다. 소비자는 서로 일치하는지 검사하며 실제 checkout·
빌드 내용까지 증명하지 않는다. 수집·CI 단계에서 변경된 소스의 정확한 식별자를 넣어야 한다.

## 판정과 증거

현재 revision의 run만 기대와 대조한다. 오래된 run은 `staleRuns`로 세고 전체 결과를 incomplete로
만든다. 시나리오·플랫폼·transport·channel·method·선택한 instance가 모두 맞아야 관찰 근거다.

- `passed`: 해당 라우팅의 관찰이 하나 이상 있고 모든 terminal outcome이 기대의
  `allowedOutcomes`에 포함되며 실행 중단·유실·대기가 없다.
- `failed`: 같은 호출에 기대하지 않은 terminal outcome이 하나라도 있다. 기대한
  `error`·`missing-handler`·`timeout`도 원본 `failures`와 `failedCalls`에는 남기며,
  `expectedFailedCalls`와 `unexpectedFailedCalls`로 구분한다. 기대 목록 밖의 실패는
  `unexpectedFailedCalls`로 전체 상태를 실패로 만든다.
- `unobserved`: 해당 기대와 맞는 호출을 관찰하지 못했다.
- `incomplete`: 맞는 관찰이 있지만 실행 중단·유실·대기가 남았다.

라우팅과 인스턴스가 겹치는 기대가 있으면 이벤트는 적용 가능한 모든 기대의
`allowedOutcomes`를 만족해야 한다. 넓은 인스턴스 기대가 특정 인스턴스 기대의 실패를
가리지 않는다. 기대하지 않은 성공도 해당 check를 `failed`로 만들며 terminal 실패가
없어도 전체 상태에 반영한다.

기대 밖 통신 실패도 `failures`와 전체 status에 반영한다. 전체 결과는 실행 공백이나 미충족
기대가 있으면 incomplete다. `scope: declared-scenarios`, `complete: false`를 항상 보존하므로
passed는 선언한 기대의 통과이며 모든 의존성·기능의 완전성 보증이 아니다.

항목별 evidence는 runId·sequence·instance·outcome·caller로 원본 기록을 가리킨다. 최대 20개를
표시하고 `observedCalls`·`evidenceOmitted`로 전체 수와 생략 수를 구분한다. 평가는 모든 호출에
적용한다. 증거 표시 생략은 원본 수집 유실(`droppedEvents`)과 다르다.

기본 모드는 보고서 생성 성공 0, strict는 failed/incomplete 1, 입력 실패 2, 사용법 오류 64다.
`--compact`는 JSON 공백만 줄인다. 로그에 비밀을 넣지 않는 책임은 수집기와 실행 환경에도 있다.
