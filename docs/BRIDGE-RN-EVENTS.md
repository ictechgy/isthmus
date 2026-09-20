# React Native native → JS 이벤트 교환 계약

isthmus 0.8.0·cartograph 0.20.0·kartograph 0.11.0의 `bridge-facts` v2 확장이다. 기존 v1과 Flutter v2 문서에 섞지 않는다.
생산 명령은 isthmus `extract-js --events`, cartograph/kartograph `bridges --rn-events`다.
이 옵션은 이벤트 전용 문서를 선택한다. v1 사실도 필요하면 옵션 없는 명령을 별도로 실행한다.

- `transport: "react-native-event"`, `target: "react-native"`(빈 facts이면 null).
- JS 문서는 `event-listen`, Swift/Kotlin 문서는 `event-emit`만 낸다.
- `channel`은 코어 RN의 전역 이벤트 이름이다. 이름이 리터럴로 확정되지 않으면 원문과
  `dynamic: true`를 남기고 조인하지 않는다. `method`, `channelPrefix`는 허용하지 않는다.
- 위치·심볼·project·generatedAt·자원 상한은 [GRAPH-EXCHANGE](GRAPH-EXCHANGE.md)와
  [v2 계약](BRIDGE-EVENTS.md)을 따른다. 네이티브 방출을 담는 실제 선언에만 심볼을 붙인다.
- 같은 project·transport 안에서 정확히 같은 리터럴 이름으로 연결한다. 플랫폼이나
  네이티브 모듈 이름을 추측하지 않는다. Expo의 모듈별 이벤트와 코어 전역 버스를 섞지 않는다.

`check`는 `event-listen-without-emit`, `event-listen-without-emit-unverified`,
`event-emit-without-listen`을 warning으로 보고한다. 이벤트를 관찰하지 못했다는 것이
즉시 실행 오류를 뜻하지 않으므로 error로 올리지 않는다. 동적 이름은 불일치가 아니라
관찰 한계다. `query`의 kind는 `event`, qualifiedName은 `react-native:event:<이름>`이며,
`graph`·`diff`는 이 전송 형식을 독립된 키로 보존한다.

현재 스캔 범위는 코어 RN `DeviceEventEmitter.addListener`, 직접 생성한 `NativeEventEmitter`
인스턴스의 구독, Swift `RCTEventEmitter` 하위 타입의 `sendEvent(withName:body:)`, Kotlin의
`getJSModule(...RCTDeviceEventEmitter::class.java).emit(...)`이다. 동적 이름, 래퍼·인스턴스
필드·파일 간 emitter 추적, Expo 모듈별 이벤트, Fabric UI 이벤트와 TurboModule codegen
이벤트, Swift extension·조건부 컴파일/import·파일 범위 이름 가림은 완전하게 해석하지 않으며 관찰 범위를 limitations로 남긴다.

JS 호출 측은 named/namespace ESM import와 모듈 범위의 직접
`const|let|var RN = require('react-native')`를 지원한다. 인스턴스의 `let`/`var`는 모듈
범위에서 직접 초기화한 경우만 추적하며, 재할당·escape·이름 가림·생성자 변경이나 초기화
전 구독은 확정하지 않는다. `const`는 선언된 블록 범위 안에서만 추적한다.
하나의 declarator와 괄호 없는 직접 constructor 초기화가 현재 범위다. 그 밖의 식에서
알려진 RN constructor가 관찰되면 사실을 추측하지 않고 미해석 한계로 센다.
이 추출 확장은 isthmus 0.9.0부터 제공하며 0.8.0에는 포함되지 않는다.

`preflight`와 런타임 대조는 이 transport를 아직 지원하지 않는다. preflight context에
넣으면 명시적으로 거부한다. 이 계약의 구현·단위 검사·공개 소스 실행·발행은 별도 상태다.

## 공식 소스 대조

React Native v0.81.4의 [NativeEventEmitter 구현](https://github.com/facebook/react-native/blob/v0.81.4/packages/react-native/Libraries/EventEmitter/NativeEventEmitter.js)은
구독과 방출을 공통 RCTDeviceEventEmitter에 전달한다. 따라서 이 코어 transport는
모듈 이름으로 나누지 않는다. [네이티브 방출 구현](https://github.com/facebook/react-native/blob/v0.81.4/packages/react-native/React/Modules/RCTEventEmitter.m)과
[Android 인터페이스](https://github.com/facebook/react-native/blob/v0.81.4/packages/react-native/ReactAndroid/src/main/java/com/facebook/react/modules/core/DeviceEventManagerModule.kt)도
이 이벤트 이름을 사용한다. 이는 해당 버전의 API 의미 대조이며 실제 RN 앱 실행 검증은 아니다.
