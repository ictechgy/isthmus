# BasicMessageChannel 교환 계약 (bridge-facts v2)

bridge-facts v1 MethodChannel 동작과 섞지 않고 opt-in `bridges --messages`가 아래
v2 문서를 출력한다. 공개 호환 버전(cartograph 0.18.0·kartograph 0.10.2·dartograph
0.14.0)에 포함됐으며 isthmus 0.7.0이 소비한다. producer/consumer 구현과 공개 source
연결을 검증했으며, 플랫폼별 실제 실행·모든 Pigeon 생성 형태의 해석은 별도 검증 범위다.
통합/검증 이력은 [진행 기록](COMPETITIVENESS.md)에 남긴다.

```json
{
  "format": "bridge-facts", "version": 2,
  "transport": "basic-message-channel", "platform": "dart", "target": "flutter",
  "project": "/project", "generatedAt": "2026-09-14T00:00:00Z",
  "tool": { "name": "dartograph", "version": "development" },
  "facts": [{
    "kind": "message-send", "channel": "example/basic", "dynamic": false,
    "location": { "path": "lib/api.dart", "line": 10, "column": 5 },
    "symbol": { "qualifiedName": "Api.read" }
  }],
  "limitations": []
}
```

- 기본 `bridges`는 기존 v1 MethodChannel 출력을 유지한다. v2는 Basic 전용이며
  `message-send`(Dart send 호출)·`message-handle`(Swift/Kotlin setMessageHandler 등록)을 담는다.
  channel을 만들기만 한 지점을 send로 만들지 않고 nil handler 제거도 등록으로 만들지 않는다.
- method 필드는 없다. Basic의 채널 이름을 가상의 MethodChannel 메서드로 바꾸지 않는다.
- project·위치·symbol·시각·문자열·사실 수·미귀속 규칙은 기존 계약의 근거 보존 원칙을 따른다.
  sender는 dart, receiver는 swift 또는 kotlin이다. 사실이 없으면 target은 null이다.
- 정적 이름은 decoded literal이다. 알 수 없으면 원래 표현식을 channel에 두고 dynamic=true.
  생성 코드를 Pigeon이라고 알아봤다는 이유로 인스턴스 suffix를 빈 문자열로 가정하지 않는다.
- 선택적 `channelPrefix`는 dynamic일 때만 쓴다. AST가 확인한 비어 있지 않은 literal prefix이며
  가능한 주소의 보수적 범위다. 같은 prefix의 정적 연결은 후보이고 실제 suffix/instance가
  같다는 증명이 아니다. 임의 변수 이름에서 prefix를 지어내지 않는다.
- Native channel을 귀속할 수 없으면 channel=null이며 `unattributed-message-handles:`
  limitation을 함께 낸다. 알려지지 않은 receiver·codec·source·symbol은 숨기지 않는다.
- channelPrefix와 runtime 주소의 관계도 후보 근거다. 기존 MethodChannel과 동일한 주소를
  쓰더라도 transport를 구분한다. prefix 후보를 literal 조인이나 실제 native 실행 신원으로
  승격하지 않는다.
- `check`는 v2 문서를 직접 입력으로 받아 Basic 경계를 진단한다. literal send에 대응
  `message-handle`이 없으면 `unhandled-message-send` error(수신 공백이면
  `-unverified` warning), 대응 send 없는 `message-handle`은
  `message-handler-without-send` warning이다. dynamic prefix 후보는 항상
  `dynamic-message-address` 소비자 한계로 실리고, 상대가 없으면
  `unmatched-message-boundary`가 더해진다. prefix 없는 미해석 주소는
  `unresolved-message-addresses` 한계로 남긴다. literal 경계도 상대편을 prefix
  후보가 덮으면 error 대신 후보 한계로 내린다. `--format sarif`·`codequality`와
  `--baseline`도 이 코드를 그대로 싣는다.
- 그 밖의 v1 전용 명령(`query`·`graph`·`diff`·`retentions`·`impact`)은 version 2를
  명시적으로 거부한다. `preflight`는 context의 별도 message 문서 목록으로 소비한다 —
  다른 명령이 모르는 facts를 무시하고 초록 결과를 내게 하지 않는다.

## handler별 의존 근거 (개발 계약)

공통 등록 함수에 여러 handler가 있으면 함수 수준 영향만으로 서로 독립적인 채널까지
전파될 수 있다. native `message-handle`은 선택적으로 다음 두 필드를 함께 제공한다.

```json
{
  "handlerScope": {
    "start": { "path": "macos/messages.g.swift", "line": 20, "column": 30 },
    "end": { "path": "macos/messages.g.swift", "line": 28, "column": 4 },
    "complete": true
  },
  "dependencies": [{
    "kind": "call", "scope": "handler",
    "location": { "path": "macos/messages.g.swift", "line": 23, "column": 16 },
    "symbol": { "qualifiedName": "PluginApi.launch(url:)", "usr": "s:compiler-requirement" },
    "dispatchTargets": [{ "qualifiedName": "Plugin.launch(url:)", "usr": "s:compiler-implementation" }]
  }]
}
```

예제 USR은 구조 설명용이며 실제 문서에는 compiler index의 신원만 쓴다. `symbol`의 기존
의미는 감싸는 등록 선언으로 유지한다. 범위 start/end는 같은 파일의 SwiftSyntax closure
여는/닫는 괄호 위치이며 양 끝을 포함한다. dependencies는 같은 파일의 index 발생 위치,
`kind: call|reference`, `scope: handler|registration`, 실제 참조 대상 symbol을 담는다.
handler 의존은 해당 범위 안이다. registration 의존은 같은 감싸는 선언 안에서 어떤 handler
closure에도 속하지 않는 공유 부분이다. 다른 handler의 본문을 공유 부분으로 취급하지 않는다.

선택적 dispatchTargets는 index가 기록한 overrides 관계로 확인된 구현 후보다. 이름으로
만들거나 실제 실행 대상으로 확정하지 않는다. 원래 참조한 requirement는 symbol에 남긴다.
행당 dispatch 후보 10,000개, fact당 dependency 10,000개, 문서 전체 dependency와 dispatch
후보 합계는 1,000,000개 이하이며 잘라서 complete로 내보내지 않는다.

complete는 **관찰된 index 사용 관계의 범위 귀속**에 한정된다. literal closure 범위가
확정되고 그 선언의 관찰된 사용 관계를 위치로 구분할 수 있으며 source/index 신선도가
확인될 때만 true다. 위치 없는 관계·모호한 대상·불명확한 범위·오래된 source/index·method
reference handler는 false 또는 근거 부재로 남긴다. 모든 런타임 의존성을 보증하지 않는다.
대상은 producer 그래프의 프로젝트 선언 간 사용 관계다. 인덱스가 parameter 또는 external로
식별한 대상의 값 흐름은 이 완전성에 포함하지 않는다. 이름이나 USR 모양으로 parameter를
추측하지 않으며 인덱스의 실제 대상 종류를 보존해 구분한다.

소비자는 complete한 근거가 있을 때 도달한 dependency/dispatch 후보에서 해당 boundary로
전파한다. 등록 선언 자체를 직접 변경 대상으로 선택하면 그 선언의 모든 handler를 포함한다.
감싸는 선언이 다른 handler의 호출 때문에 영향받았다는 이유만으로 모든 boundary로 다시
전파하지 않는다. 근거가 없거나 불완전하면 기존 넓은 후보를 보존하고 정밀도 공백을 알린다.
같은 boundary에 완전한 관찰과 불완전한 관찰이 함께 있으면 넓은 후보와 공백을 유지한다.
영향 숲에 없는, 변경과 무관한 dependency도 관련 boundary의 receiver 원문에는 남긴다.

이 문서만으로 producer/consumer 지원이 완료됐거나 Pigeon의 모든 생성 형태가 해석됐다는
뜻은 아니다. literal·alias·shadowing·동적 prefix·nil handler·동일 주소의 transport 차이와
공개 Pigeon 생성 source를 테스트한 뒤 검증된 범위를 기록한다.

## Kotlin producer의 개발 경계

Kotlin의 v2도 같은 필드·역할·상한을 사용한다. JVM 그래프에서 유일하게 확인한 symbol만
USR로 싣고, source 문자열에서 JVM 식별자를 합성하지 않는다. Kotlin 소스의 closure 범위와
bytecode 위치만으로 실제 callback의 전체 의존성을 보증하지 않는다. 위 두 필드를 제공하지
못하면 소비자는 넓은 영향 후보와 범위 공백을 유지한다. 정적 주소는 실제 Kotlin 문자열이며
동적 prefix는 구문으로 확인한 범위만 제공한다. 다른 플랫폼의 동일 주소를 Kotlin 실행 신원으로
사용하지 않는다. `--graph-file` 입력의 현재 소스/빌드 범위와 한계를 함께 확인한다.
