# EventChannel 교환 계약 (bridge-facts v2)

bridge-facts v1 MethodChannel·[v2 BasicMessageChannel](BRIDGE-MESSAGES.md) 동작과 섞지
않고 opt-in `bridges --events`가 아래 v2 문서를 출력한다. Flutter `EventChannel`은
호출/응답이 아니라 네이티브→Dart 방향의 스트림이므로 사실 종류·전파 의미가 별도다.
런타임 스트림 구독과 취소의 동작은 [RUNTIME](RUNTIME.md)의 범위며, 이 문서는 정적 사실만
정의한다.

```json
{
  "format": "bridge-facts", "version": 2,
  "transport": "event-channel", "platform": "dart", "target": "flutter",
  "project": "/project", "generatedAt": "2026-09-16T00:00:00Z",
  "tool": { "name": "dartograph", "version": "development" },
  "facts": [{
    "kind": "stream-listen", "channel": "dev.example/charging", "dynamic": false,
    "location": { "path": "lib/battery.dart", "line": 49, "column": 9 },
    "symbol": { "qualifiedName": "MethodChannelBattery.batteryStateStream" }
  }],
  "limitations": []
}
```

- 기본 `bridges`는 기존 v1 출력을 유지하고 `--events`는 이 문서만 낸다. v1 문서의
  `unscanned-event-channels` limitation은 v1 형식이 스트림을 담지 않는다는 사실을
  계속 보고한다 — event 사실이 존재한다는 뜻이 아니라 v1 관찰 범위의 설명이다.
- 사실 종류는 `stream-listen`(Dart `receiveBroadcastStream` 스트림 구독 지점)과
  `stream-handle`(Swift/Kotlin `setStreamHandler`의 non-nil 등록, ObjC
  `setStreamHandler:`) 둘뿐이다. `onListen`/`onCancel` 콜백과 `EventSink`의 이벤트
  방출은 별도 사실 종류로 만들지 않고 handler 근거의 의존성으로 남긴다.
- `EventChannel(name)` 객체를 만들기만 한 지점은 사실이 아니다 — 채널 이름은 생성자에서
  `receiveBroadcastStream`/`setStreamHandler` 호출까지 변수 참조를 따라 옮긴다.
  nil handler 제거(`setStreamHandler(nil)`)는 등록이 아니다.
- method 필드는 없다. 스트림 채널에 가상의 메서드 이름을 붙이지 않는다.
- project·위치·symbol·시각·문자열·사실 수·미귀속 규칙은 기존 계약의 근거 보존 원칙을
  따른다. listener는 dart, handler는 swift·kotlin 또는 `sourceLanguage: "objective-c"`의
  ObjC 구현이다. 사실이 없으면 target은 null이다.
- 정적 이름은 decoded literal이다. 알 수 없으면 원래 표현식을 channel에 두고
  dynamic=true다. 선택적 `channelPrefix`는 dynamic일 때만 쓰며, 의미와 한계는
  [BRIDGE-MESSAGES](BRIDGE-MESSAGES.md)의 prefix 규칙과 같다.
- Native channel을 귀속할 수 없으면 channel=null이며 `unattributed-stream-handles:`
  limitation을 함께 낸다. 같은 transport의 같은 주소라도 MethodChannel/Basic과
  transport를 구분해 조인한다.
- `check`는 v2 문서를 직접 입력으로 받아 Event 경계를 진단한다. literal
  `stream-listen`에 대응 `stream-handle`이 없으면 `unhandled-stream-listen` error
  (수신 공백이면 `-unverified` warning), 대응 listener 없는 `stream-handle`은
  `stream-handler-without-listen` warning이다. dynamic prefix 후보는 항상
  `dynamic-stream-address` 소비자 한계로 실리고, 상대가 없으면
  `unmatched-stream-boundary`가 더해진다. prefix 없는 미해석 주소는
  `unresolved-message-addresses` 한계로 남긴다.
- 그 밖의 v1 전용 명령은 version 2를 명시적으로 거부한다. `preflight`는 context의
  message 문서 목록으로 소비하며 transport 필드로 구분한다 — 다른 명령이 모르는
  facts를 무시하고 초록 결과를 내게 하지 않는다.

## handler별 의존 근거

`handlerScope`·`dependencies` 선택 필드의 형태·완전성·상한·소비 의미는
[BRIDGE-MESSAGES](BRIDGE-MESSAGES.md)의 "handler별 의존 근거" 절과 같다. 스트림
핸들러는 클로저가 아니라 `FlutterStreamHandler` 구현 객체를 넘기는 형태가 일반적이라
대부분 근거가 없거나 불완전으로 남는다 — 그 경우 소비자는 넓은 영향 후보를 보존하고
정밀도 공백을 알린다. 등록 선언을 직접 변경 대상으로 선택하면 그 선언의 스트림 등록을
포함해 검토한다.

## Objective-C 스트림 핸들러

`platform: "swift"` 문서에 실린 `.m`/`.mm`의 `setStreamHandler:` 사실은
`sourceLanguage: "objective-c"`로 구분한다. ObjC 핸들러 본문은 Swift 그래프 밖이므로
handler 근거를 싣지 않으며(계약이 금지), 언어 심볼 귀속 실패는 기존과 같이
unbindable 증거로 남는다.

## 생산자별 범위

- cartograph: `FlutterEventChannel(name:)` + `setStreamHandler` 와 ObjC
  `setStreamHandler:`를 읽는다. Basic과 같은 변수 추적을 쓰되 스트림 전용 등록
  호출만 사실로 만든다.
- kartograph: `EventChannel(messenger, name)` + `setStreamHandler`를 같은 규칙으로
  읽는다. JVM 그래프에서 유일하게 확인한 symbol만 USR로 싣는다.
- dartograph: `EventChannel(...)` 수신자의 `receiveBroadcastStream` 호출을
  `stream-listen`으로 낸다. 수신자를 풀지 못한 스트림 호출은 사실로 만들지 않고
  limitation으로 센다.

이 문서만으로 세 생산자의 지원이 완료됐거나 Flutter의 모든 스트림 등록 형태가 해석됐다는
뜻은 아니다. literal·동적 prefix·nil handler·메서드 참조 핸들러·동일 주소의 transport
차이와 공개 플러그인 source를 테스트한 뒤 검증된 범위를 기록한다.
