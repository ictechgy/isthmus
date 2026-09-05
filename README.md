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

**0.1.4.** bridge-facts 버전 1 파서와 `check`, `query`, `graph`, `diff`,
cartograph용 외부 보존 근거 왕복을 구현했다. 외부 입력·혼합 target·그래프 크기와
Dart/Swift Phase 0 추출 경계를 fail-closed로 강화했다. 다음 단계는 실제 Flutter 앱
도그푸딩과 React Native 지원이다.

정식 producer는 cartograph 0.5.3 이상과 dartograph 0.1.1 이상이다. 두 도구의 실제 출력과
공개 battery 플러그인의 Swift USR·Dart 호출 근거 왕복을 검증했다.

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

실제 공개 Flutter 플러그인에서 생산부터 소비까지 확인하려면 저장소 루트에서 다음 검증을
실행한다. 스크립트는 `plus_plugins`의 고정 커밋을 sparse checkout하고 배터리 플러그인의
원본 Dart·Swift 소스에서 세 메서드의 보존 근거를 확인한 뒤 임시 checkout을 지운다.
네트워크, Git 2.26 이상, Swift 6, cartograph 0.5.3 이상, dartograph 0.1.1 이상이
필요하다. isthmus는 현재 소스에서 자동으로 다시 빌드하며, 세 번째 인자로 별도 isthmus
JavaScript 산출물을 넘길 수도 있다.

```bash
npm run build
node scripts/verify-public-flutter-plugin.mjs \
  /path/to/cartograph \
  /path/to/dartograph
```

공개 플러그인 검증은 원본 `addMethodCallDelegate` 구현에서 나온 Swift USR과 세 원본 Dart
호출 위치를 확인하고, cartograph `--explain`이 해당 심볼의 대표 근거를 읽는지 검증한다. 이미
public인 플러그인 handler의 dead 상태 전환을 억지로 만들지는 않는다. 그 전환과
`setMethodCallHandler` 경로는 `verify-cartograph-roundtrip.mjs`의 합성 코퍼스가 별도로
검증한다.

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

출력은 `isthmus-check` 버전 1 JSON이며 다음 네 사실을 보고한다.

- `unhandled-invocation` (error): 호출은 있지만 네이티브 핸들러가 없음
- `unregistered-channel-creation` (error): 호출 측 채널 생성은 있지만 네이티브 등록이 없음
- `registration-without-creation` (warning): 네이티브 채널 등록은 있지만 호출 측 생성이 없음
- `handler-without-invocation` (warning): 네이티브 핸들러는 있지만 호출 측 사용이 없음

모든 이슈는 관찰된 위치를 `evidence`로 제공한다. 동적 이름, 해석하지 못한 receiver나
handler 본문, USR 누락, 입력 생성 시각 차이, 혼합 target은 `limitations`에 출처와 함께
남긴다. 이 도구는 삭제 가능 여부를 판정하지 않는다.

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

실제 두 producer와 외부 보존 근거 왕복을 검증하려면 cartograph 0.5.3 이상,
dartograph 바이너리와 두 도구가 함께 분석할 fixture 루트를 넘긴다. 이 검증은 producer
바이너리와 컴파일러 인덱스가 필요하므로 `npm run verify`와 공개 CI에는 포함되지 않으며
릴리스 전에 수동으로 실행한다.

```bash
node scripts/verify-cartograph-roundtrip.mjs \
  /path/to/cartograph \
  /path/to/dartograph \
  /path/to/FalsePositiveCorpus
```

## 변경 전후 비교 (0.1.4 이상)

같은 프로젝트의 변경 전후 Dart·Swift 교환 파일을 비교하려면:

```bash
isthmus diff \
  --before before-dart.json before-swift.json \
  --after after-dart.json after-swift.json --strict
```

`isthmus-diff` v1은 추가·제거된 논리 메서드 연결, 새로 관찰된 불일치와 사라진 불일치,
양 시점의 분석 한계와 그 차이, producer 버전·생성 시각을 JSON으로 출력한다. 연결에는 호출자와
핸들러 위치가 포함된다. 줄 이동은 연결 변경으로 세지 않으며 rename은 추측하지 않는다.
같은 논리 키의 호출자·핸들러 교체나 개별 호출 위치 증감은 이번 비교 범위에 포함하지 않는다.

`--strict`는 새로 관찰된 error가 있을 때만 1이다. 기존 오류·경고·분석 한계만 있으면 0이므로
성공 코드가 삭제 안전성이나 완전한 분석을 뜻하지 않는다. `resolvedIssues`도 이전 불일치가
더 이상 관찰되지 않는다는 뜻이며, 동적 전환·추출기 변경 때문인지 한계를 함께 확인해야 한다.

현재 diff는 Flutter의 Dart·Swift 문서만 받는다. 각 시점에 두 플랫폼이 모두 필요하며,
양 시점의 `project`와 플랫폼·도구별 문서 개수가
같아야 한다. 한 checkout의 같은 경로에서 각 revision을 빌드해 JSON을 보관한다. 일부 파일만
추출한 결과와 전체 결과를 비교하지 말고 같은 분석 설정을 사용한다. 입력 파일은 합계 256개,
텍스트 길이 제한은 기존 CLI와 동일하다. 혼합 target이나 비교 불가능한 입력은 코드 2로 거부한다.
`generatedAt`은 fact 추출 시각이며 revision 순서가 아니다. 비교 방향은 `--before`와
`--after` 인자로 결정되므로 사용자가 올바른 revision의 파일을 지정해야 한다.

## 코딩 에이전트 skill

네이티브 브리지 핸들러를 지우거나 이름을 바꾸기 전에 `query`로 다른 언어의 호출자를
확인하도록 가르치는 skill 원문을 [`Skills/isthmus/SKILL.md`](Skills/isthmus/SKILL.md)에 제공한다.
사용하는 에이전트의 프로젝트 skill 디렉터리에 이 파일을 복사해 사용할 수 있다.

Codex는 이 checkout의 `.agents/skills/isthmus` 링크로 같은 원문을 발견한다.
`Skills/isthmus/SKILL.md` 한 곳만 편집하며, npm 패키지에는 이 원문이 포함된다.
스킬 내용 검증과 모델별 지침 조정 근거는 [에이전트 감사 기록](docs/AGENT-AUDIT.md)에 있다.

## 라이선스

[MIT](LICENSE). 상업적 사용을 포함해 영구 무료다.
