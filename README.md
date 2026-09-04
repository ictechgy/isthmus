# isthmus

크로스플랫폼 앱에서 **언어 경계를 넘는 호출**을 그래프로 잇는 도구.
[cartograph](https://github.com/ictechgy/cartograph)(Swift) · kartograph(Kotlin, 예정) ·
[dartograph](https://github.com/ictechgy/dartograph)(Dart)가 각자 그린 지도를 하나로 붙인다.

이름은 지협(isthmus) — 두 땅덩어리를 잇는 좁은 육교. 지도에서 다리를 뜻하는 말이다.

## 무엇을 하려는가

React Native 나 Flutter 앱의 네이티브 코드는 JS/Dart 가 **문자열 이름으로** 부른다. `MethodChannel('com.example/camera')`, `NativeModules.CameraModule`. 컴파일러 인덱스는 이 문자열을 못 본다. 그래서:

- cartograph 는 Flutter 가 부르는 Swift 핸들러를 **미사용** 이라고 한다 — 오탐
- 기존 언어별 분석만으로는 "Dart가 `invokeMethod('takePhoto')`를 부르는데 Swift 쪽에
  그 핸들러가 없다"를 **빌드 전에** 잡기 어렵다 — 런타임 크래시
- 같은 이유로 "이 채널은 Swift에는 있는데 Dart 어디서도 안 부른다"는 교차 경계
  사실을 언어별 도구 하나만으로는 판단하기 어렵다

isthmus 는 각 언어 도구가 내보낸 **브리지 사실**(채널 이름 · 메서드 이름 · 등록 지점 · 호출 지점)을 문자열 키로 조인해서, 경계를 넘는 간선을 만들고 위 세 가지를 답한다. 그리고 그 결과를 cartograph/kartograph 에 **보존 근거로 돌려준다** — "Swift `CameraHandler.takePhoto` 는 `lib/camera.dart:42` 가 채널 `com.example/camera` 로 부르므로 보존".

isthmus는 조사한 도구들이 언어별로 나눠 보던 이 교차 경계를 조인한다.

## 상태

**0.1.1.** bridge-facts 버전 1 파서와 `check`, `query`, `graph`,
cartograph용 외부 보존 근거 왕복을 구현했다. 외부 입력·혼합 target·그래프 크기와
Dart/Swift Phase 0 추출 경계를 fail-closed로 강화했다. 다음 단계는 실제 Flutter 앱
도그푸딩과 React Native 지원이다.

현재 cartograph는 Swift fact를 생산하지만 Dart producer는 아직 정식 릴리스 전이다.
저장소의 Phase 0 Dart 추출기는 형식 검증용 임시 구현이며 운영 도구로 배포되지 않는다.

| 문서 | 내용 |
|---|---|
| [`docs/PRD.md`](docs/PRD.md) | 무엇을 · 누구를 위해 · 어디까지 |
| [`docs/PLAN.md`](docs/PLAN.md) | 단계별 계획. **cartograph 와 dartograph 에 선행 작업이 있다** |
| [`docs/GRAPH-EXCHANGE.md`](docs/GRAPH-EXCHANGE.md) | 자매 도구가 내보내는 브리지 사실의 형식. 세 저장소가 공유하는 계약 |
| [`docs/RESEARCH.md`](docs/RESEARCH.md) | 확인된 사실 · 확인되지 않은 주장 |
| [`experiments/phase-0/`](experiments/phase-0/) | Dart·Swift 임시 추출기, 고정 JSON, 손 조인 검증 |

## 의존 관계

```
cartograph  ──bridges──┐
kartograph  ──bridges──┼──▶ isthmus ──▶ 경계 간선 · 불일치 보고 · 보존 근거
dartograph  ──bridges──┤
JS/TS 추출기 ─bridges──┘
```

isthmus 자체는 작다. 무거운 일(각 언어의 해석)은 자매 도구가 한다.

## 설치

Node.js 22.18.0 이상이 필요하다.

전역 설치 후 CLI 이름 `isthmus`로 실행한다.

```bash
npm install --global isthmus-cli
isthmus --help
```

설치 없이 한 번 실행할 때는 package 이름을 명시한다.

```bash
npx isthmus-cli --help
```

`npx isthmus`는 이름이 같은 다른 package를 설치하므로 사용하지 않는다.

## 사용

isthmus는 자매 도구를 직접 실행하지 않는다. 각 도구가 만든 JSON 파일을 전달한다.

```bash
isthmus check dart-bridges.json swift-bridges.json
```

전체 명령과 현재 package 버전은 다음처럼 확인한다.

```bash
isthmus --help
isthmus --version
```

CI에서 브리지 오류가 있으면 실패시키려면 `--strict`를 붙인다.

```bash
isthmus check dart-bridges.json swift-bridges.json --strict
```

매치된 Swift 핸들러를 cartograph 보존 근거로 돌려주려면:

```bash
isthmus retentions \
  dart-bridges.json swift-bridges.json \
  --for cartograph > external-retentions.json

cartograph dead --external-retentions external-retentions.json
```

`retentions`는 핸들러의 USR을 우선 사용하고 없으면 `qualifiedName`을 남긴다. `mixed-targets` 문서는 v1에서 사실별 target을 복원할 수 없어 모든 소비 명령이 종료 코드 2로 조인을 보류한다. 먼저 생산 단계에서 target별 문서로 분리해야 한다.

채널이나 메서드가 경계 반대편의 어느 위치와 연결되는지 조회하려면:

```bash
isthmus query takePhoto dart-bridges.json swift-bridges.json
```

경계 간선만 JSON, Graphviz DOT, Mermaid로 출력하려면:

```bash
isthmus graph dart-bridges.json swift-bridges.json
isthmus graph dart-bridges.json swift-bridges.json --format dot
isthmus graph dart-bridges.json swift-bridges.json --format mermaid
```

`query`는 같은 메서드가 여러 채널에 있으면 후보를 반환하고 임의로 고르지 않는다.
반환된 `qualifiedName`을 같은 subject 자리에 넣어 정확한 후보를 다시 조회할 수 있다.
`graph`는 매치된 간선만 내보내며, 입력의 `limitations`를 JSON 필드 또는 DOT/Mermaid
주석으로 보존한다. 증거의 Cartesian 곱이 100,000개 간선을 넘으면 메모리 폭증을 막기
위해 입력 오류로 종료한다.

출력은 `isthmus-check` 버전 1 JSON이며 다음 세 사실을 보고한다.

- `unhandled-invocation` (error): 호출은 있지만 네이티브 핸들러가 없음
- `unregistered-channel-creation` (error): 호출 측 채널 생성은 있지만 네이티브 등록이 없음
- `handler-without-invocation` (warning): 네이티브 핸들러는 있지만 호출 측 사용이 없음

모든 이슈는 관찰된 위치를 `evidence`로 제공한다. 동적 이름, USR 누락, 입력 생성 시각 차이, 혼합 target은 `limitations`에 출처와 함께 남긴다. 이 도구는 삭제 가능 여부를 판정하지 않는다.

| 종료 코드 | 의미 |
|---|---|
| `0` | 실행 성공. 기본 모드에서는 이슈가 있어도 보고만 함 |
| `1` | `--strict`에서 error 이슈를 발견함 |
| `2` | 파일 읽기, JSON, 교환 계약, 보류된 조인 등 도구 실패 |
| `64` | 잘못된 명령·옵션·입력 개수 또는 `query`의 `notFound`·`ambiguous` |

저장소 checkout에서 개발할 때는 먼저 `npm ci`를 실행한다. 개발 검증은 타입 체크,
제품 코드 90% 커버리지, clean build, 실제 CLI·package 계약을 함께 실행한다.

```bash
npm run verify
```

로컬 cartograph 코퍼스와 외부 보존 근거 왕복을 검증하려면 빌드된 cartograph 바이너리와 fixture 루트를 넘긴다.
이 검증은 외부 바이너리와 코퍼스가 필요하므로 `npm run verify`와 공개 CI에는 포함되지
않으며 릴리스 전에 수동으로 실행한다.

```bash
node scripts/verify-cartograph-roundtrip.mjs \
  /path/to/cartograph \
  /path/to/FalsePositiveCorpus
```

## 코딩 에이전트 skill

네이티브 브리지 핸들러를 지우거나 이름을 바꾸기 전에 `query`로 다른 언어의 호출자를
확인하도록 가르치는 skill 원문을 [`Skills/isthmus/SKILL.md`](Skills/isthmus/SKILL.md)에 제공한다.
사용하는 에이전트의 프로젝트 skill 디렉터리에 이 파일을 복사해 사용할 수 있다.

## 라이선스

[MIT](LICENSE). 상업적 사용을 포함해 영구 무료다.
