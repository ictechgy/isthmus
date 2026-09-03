# isthmus

크로스플랫폼 앱에서 **언어 경계를 넘는 호출**을 그래프로 잇는 도구. [cartograph](../cartograph)(Swift) · [kartograph](../kartograph)(Kotlin) · [dartograph](../dartograph)(Dart) 가 각자 그린 지도를 하나로 붙인다.

이름은 지협(isthmus) — 두 땅덩어리를 잇는 좁은 육교. 지도에서 다리를 뜻하는 말이다.

## 무엇을 하려는가

React Native 나 Flutter 앱의 네이티브 코드는 JS/Dart 가 **문자열 이름으로** 부른다. `MethodChannel('com.example/camera')`, `NativeModules.CameraModule`. 컴파일러 인덱스는 이 문자열을 못 본다. 그래서:

- cartograph 는 Flutter 가 부르는 Swift 핸들러를 **미사용** 이라고 한다 — 오탐
- 어떤 도구도 "Dart 가 `invokeMethod('takePhoto')` 를 부르는데 Swift 쪽에 그 핸들러가 없다" 를 **빌드 전에** 잡지 못한다 — 런타임 크래시
- 어떤 도구도 "이 채널은 Swift 에는 있는데 Dart 어디서도 안 부른다" 를 말하지 못한다 — 진짜 미사용

isthmus 는 각 언어 도구가 내보낸 **브리지 사실**(채널 이름 · 메서드 이름 · 등록 지점 · 호출 지점)을 문자열 키로 조인해서, 경계를 넘는 간선을 만들고 위 세 가지를 답한다. 그리고 그 결과를 cartograph/kartograph 에 **보존 근거로 돌려준다** — "Swift `CameraHandler.takePhoto` 는 `lib/camera.dart:42` 가 채널 `com.example/camera` 로 부르므로 보존".

기존 도구 어느 것도 하지 않는 일이다.

## 상태

**계획 단계.** 코드는 없고, 세 자매 도구가 내보낼 **교환 형식**의 초안이 있다. 시작하려면 [`CLAUDE.md`](CLAUDE.md) 를 읽고 [`docs/PLAN.md`](docs/PLAN.md) 의 Phase 0 부터.

| 문서 | 내용 |
|---|---|
| [`docs/PRD.md`](docs/PRD.md) | 무엇을 · 누구를 위해 · 어디까지 |
| [`docs/PLAN.md`](docs/PLAN.md) | 단계별 계획. **cartograph 와 dartograph 에 선행 작업이 있다** |
| [`docs/GRAPH-EXCHANGE.md`](docs/GRAPH-EXCHANGE.md) | 자매 도구가 내보내는 브리지 사실의 형식. 세 저장소가 공유하는 계약 |
| [`docs/RESEARCH.md`](docs/RESEARCH.md) | 확인된 사실 · 확인되지 않은 주장 |

## 의존 관계

```
cartograph  ──bridges──┐
kartograph  ──bridges──┼──▶ isthmus ──▶ 경계 간선 · 불일치 보고 · 보존 근거
dartograph  ──bridges──┤
JS/TS 추출기 ─bridges──┘
```

isthmus 자체는 작다. 무거운 일(각 언어의 해석)은 자매 도구가 한다.

## 라이선스

MIT. 상업적 사용을 포함해 영구 무료다.
