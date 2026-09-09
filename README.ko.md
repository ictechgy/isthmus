# isthmus

크로스플랫폼 앱에서 **언어 경계를 넘는 호출**을 그래프로 잇는 도구.
[cartograph](https://github.com/ictechgy/cartograph)(Swift) · kartograph(Kotlin, 예정) ·
[dartograph](https://github.com/ictechgy/dartograph)(Dart)가 각자 그린 지도를 하나로 붙인다.

[English](README.md)

이름은 지협(isthmus) — 두 땅덩어리를 잇는 좁은 땅다리. 지도에서 다리를 뜻하는 말이다.

## 무엇을 하려는가

React Native나 Flutter 앱의 네이티브 코드는 JS/Dart가 **문자열 이름으로** 부른다.
`MethodChannel('com.example/camera')`, `NativeModules.CameraModule`. 컴파일러 인덱스는 이
문자열을 볼 수 없다. 그래서:

- cartograph는 Flutter가 부르는 Swift 핸들러를 **미사용**이라고 한다 — 오탐
- 기존 언어별 분석만으로는 "Dart가 `invokeMethod('takePhoto')`를 부르는데 Swift 쪽에
  그 핸들러가 없다"를 **빌드 전에** 잡기 어렵다 — 런타임 크래시
- 같은 이유로 "이 채널은 Swift에는 있는데 Dart 어디서도 안 부른다"는 교차 경계
  사실을 언어별 도구 하나만으로는 판단하기 어렵다

isthmus는 각 언어 도구가 내보낸 **브리지 사실**(채널 이름 · 메서드 이름 · 등록 지점 ·
호출 지점)을 문자열 키로 조인해서, 경계를 넘는 간선을 만들고 위 세 가지를 답한다.
그리고 그 결과를 cartograph/kartograph에 **보존 근거로 돌려준다** — "Swift
`CameraHandler.takePhoto`는 `lib/camera.dart:42`가 채널 `com.example/camera`로 부르므로
보존".

## 상태

**0.3.0.** bridge-facts 버전 1 파서와 `check`, `query`, `graph`, `diff`,
cartograph용 외부 보존 근거 왕복, 인정된 이슈를 논리 이슈 식별자로 억제하되 증거는
보존하는 check 베이스라인을 구현했다. 외부 입력·혼합 target·그래프 크기·
Dart/Swift Phase 0 추출 경계를 fail-closed로 강화했고, 조인하지 못한 사실은 소비자
쪽에서 다시 세고 근거를 만들지 못한 보존 대상은 조용히 사라지는 대신 실패로 보고한다.
수신 측이 신고한 분석 공백은 불일치가 아니라 판정 불가로 보고한다. 한계는 신고 문서의
target으로 귀속되어 공백 완화가 다른 target의 진단으로 번지지 않는다. 다음 단계는
실제 Flutter 앱 도그푸딩과 React Native 지원이다.

정식 producer는 cartograph 0.5.3 이상과 dartograph 0.1.1 이상이다. 두 도구의 실제 출력과
공개 battery 플러그인의 Swift USR·Dart 호출 근거 왕복을 검증했다.

| 문서 | 내용 |
|---|---|
| [`docs/PRD.md`](docs/PRD.md) | 무엇을 · 누구를 위해 · 어디까지 |
| [`docs/PLAN.md`](docs/PLAN.md) | 단계별 계획. **cartograph와 dartograph에 선행 작업이 있다** |
| [`docs/GRAPH-EXCHANGE.md`](docs/GRAPH-EXCHANGE.md) | 자매 도구가 내보내는 브리지 사실의 형식. 자매 저장소들이 공유하는 계약 |
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

`npx isthmus`는 이름이 같은 다른 package를 설치하므로 사용하면 안 된다.

## 사용

isthmus는 자매 도구를 직접 실행하지 않는다. 각 도구가 만든 JSON 파일을 전달하면 된다.

```bash
isthmus check dart-bridges.json swift-bridges.json
```

전체 명령과 현재 package 버전은 다음과 같이 확인한다.

```bash
isthmus --help
isthmus --version
```

브리지 오류가 있을 때 CI가 실패하도록 하려면 `--strict`를 붙인다.

```bash
isthmus check dart-bridges.json swift-bridges.json --strict
```

### 베이스라인

현재 발견된 이슈를 인정해 베이스라인으로 기록하고, 다음 실행부터 그 파일을 적용한다.

```bash
isthmus check dart-bridges.json swift-bridges.json --update-baseline isthmus-baseline.json
isthmus check dart-bridges.json swift-bridges.json --strict --baseline isthmus-baseline.json
```

`--update-baseline`은 이번 실행을 억제하지 않고 현재 이슈 전체를 isthmus 소유
`isthmus-baseline` 버전 1 문서로 다시 쓴다. 파일 전체를 새로 쓰므로 해결된 항목은
자동으로 빠진다. `--baseline`은 항목과 논리 이슈 식별자(code·target·channel·method)가
같은 이슈만 억제하므로 소스 줄이 이동해도 억제가 깨지지 않고, 새 채널·메서드 불일치는
억제되지 않는다. 억제된 이슈도 지워지지 않는다 — 사실·증거·심각도를 보존한 채
`suppressed` 표시가 붙고 요약의 error·warning 계산과 `--strict` 판단에서만 빠진다.
어느 이슈와도 맞지 않는 항목은 `staleBaselineEntries`로 세므로, 해결된 이슈가
베이스라인에 남아 다음 악화가 가려질 수 있음을 보고서에서 볼 수 있다. 베이스라인
파일의 읽기 실패·JSON 오류·계약 위반은 종료 코드 2로 실패한다. 두 플래그를 한 실행에
함께 쓸 수 없고, 플래그 바로 뒤의 값이 `-`로 시작하면 거부된다(`-`로 시작하는 합법적
파일명 포함). `--update-baseline`을 `--strict`와 함께 쓰면 파일은 기록되고 종료
코드는 이번 실행의 억제되지 않은 error를 따른다. 기록할 항목이 10,000개를 넘으면
소비할 수 없는 산출물을 남기지 않고 종료 코드 2로 실패한다. 쓰기는 같은 디렉터리에
임시 파일을 쓰고 rename으로 교체하는 원자적 방식이라 중단돼도 기존 파일이 깨지지
않는다.

### 보존 근거

매치된 Swift 핸들러를 cartograph 보존 근거로 돌려주려면:

```bash
isthmus retentions \
  dart-bridges.json swift-bridges.json \
  --for cartograph > external-retentions.json

cartograph dead --external-retentions external-retentions.json
```

`retentions`는 핸들러의 USR을 우선 사용하고 없으면 `qualifiedName`을 남긴다.
`mixed-targets` 문서는 v1에서 사실별 target을 복원할 수 없어 모든 소비 명령이 종료
코드 2로 조인을 보류한다. 먼저 생산 단계에서 target별 문서로 분리해야 한다.

cartograph는 Swift 심볼만 보존하므로 `--for cartograph`는 수신 측 Swift 문서를 최소
하나 요구하고, 없으면 빈 보존 문서 대신 종료 코드 2로 거부한다. 호출자가 있는데도
`symbol`이 없어 보존 근거로 바꿀 수 없는 Swift 핸들러가 있으면 부분 문서를 만들지
않고 같은 코드로 실패한다. 근거가 빠진 보존 파일은 소비자에게 살아 있는 핸들러를
미사용으로 보이게 하기 때문이다.

모든 소비 명령은 호출 측(dart)과 수신 측(swift) 플랫폼 문서를 최소 하나씩 요구한다.
한쪽만 있으면 한쪽 관찰을 경계 불일치로 오독하지 않고 종료 코드 2로 거부한다. 입력
실패 메시지는 원인(읽기 실패, JSON 오류, 교환 계약 위반, project 불일치, 플랫폼 구성
누락, 크기 상한)과 입력 순서, 해결 방향을 구분해 전달하며 입력 본문과 경로는 노출하지
않는다.

실제 공개 Flutter 플러그인에서 생산부터 소비까지 확인하려면 저장소 루트에서 다음
검증을 실행한다. 스크립트는 `plus_plugins`의 고정 커밋을 sparse checkout으로
내려받고 배터리 플러그인의 원본 Dart·Swift 소스에서 세 메서드의 보존 근거를 확인한
뒤 임시 checkout을 지운다. 네트워크, Git 2.26 이상, Swift 6, cartograph 0.5.3 이상,
dartograph 0.1.1 이상이 필요하다. isthmus는 현재 소스에서 자동으로 다시 빌드하며,
세 번째 인자로 별도 isthmus JavaScript 산출물을 넘길 수도 있다.

```bash
npm run build
node scripts/verify-public-flutter-plugin.mjs \
  /path/to/cartograph \
  /path/to/dartograph
```

공개 플러그인 검증은 원본 `addMethodCallDelegate` 구현에서 나온 Swift USR과 원본
Dart 호출 위치 세 곳을 확인하고, cartograph `--explain`이 해당 심볼의 대표 근거를
읽는지 검증한다. 이미 public인 플러그인 handler의 dead 상태 전환을 억지로 만들지는
않는다. 그 전환과 `setMethodCallHandler` 경로는
`verify-cartograph-roundtrip.mjs`의 합성 코퍼스가 별도로 검증한다.

### query와 graph

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
주석으로 보존한다. 증거의 Cartesian 곱이 100,000개 간선을 넘으면 메모리 폭주를 막기
위해 종료 코드 2로 실패한다.

### check가 보고하는 것

출력은 `isthmus-check` 버전 1 JSON이며 다음 사실을 보고한다.

- `unhandled-invocation` (error): 호출은 있지만 네이티브 핸들러가 없음
- `unregistered-channel-creation` (error): 호출 측 채널 생성은 있지만 네이티브 등록이 없음
- `registration-without-creation` (warning): 네이티브 채널 등록은 있지만 호출 측 생성이 없음
- `handler-without-invocation` (warning): 네이티브 핸들러는 있지만 호출 측 사용이 없음
- `unhandled-invocation-unverified` (warning): 위 첫 항목과 같은 사실이지만, 수신 측이
  핸들러를 놓쳤을 수 있다고 스스로 신고해 없는 것인지 못 본 것인지 판정할 수 없음
- `unregistered-channel-creation-unverified` (warning): 같은 이유로 등록 여부를 판정할 수 없음

`-unverified` 종류는 수신 측 문서의 한계에서 나온다. 예를 들어 Flutter 핸들러가
Objective-C로 쓰인 플러그인에서 cartograph는 `objective-c-sources:`를 신고하고 핸들러
사실을 완전히 열거하지 못할 수 있다. 이때 "핸들러 없는 호출"을 error로 단정하면 이
도구가 없애려던 오탐을 이 도구가 만든다. 사실과 증거는 그대로 보고하되 `--strict`를
실패시키지 않는다. 공백의 종류는 구분된다. 이름이 리터럴이 아닌 채널 등록은 채널
진단만 낮추고 메서드 진단은 낮추지 않는다. 완화 단위는 진단의 target이다. 사실은
target별로만 조인되므로 다른 target 수신 문서가 신고한 공백은 현재 target의 진단을
낮추지 않고, 사실이 없는 수신 문서의 공백은 가려진 대상을 특정할 수 없어 모든
target에 적용한다. 호출 측 한계는 네이티브 코드를 가리지 않으므로 심각도에 영향을
주지 않으며, 알 수 없는 한계 문구는 공백으로 해석하지 않는다.

0.2.0부터 v1의 선택적 `limitationScopes`를 읽는다. `{ limitationIndex, channels }`는
해당 한계 전체의 보수적 채널 상한이며, 단순히 발견한 리터럴 목록이면 안 된다. 스코프가
없거나 다른 범위 불명 공백이 공존하면 기존 target 전체 완화를 유지한다. 빈 채널
집합이나 잘못된 인덱스는 입력 오류다. 스코프는 check/query/graph/diff에서 `channels`로
보존된다. 생산자가 tool 이름을 isthmus로 적어도 자체 계수를 신뢰하지 않으며,
`unjoined-*`는 소비자가 직접 붙인 `origin: "consumer"`가 있어야 완화 근거가 된다.

선택적 fact 필드 `sourceLanguage: "objective-c"`는 `.m`/`.mm`의 ObjC 구현을 Swift
그래프와 구분한다. 이 사실에는 symbol을 붙이지 않는다. 매치는 check/query/graph에
남고 Swift 보존 목록에서는 제외되며, `omittedObjectiveCHandlers`가 제외 수를 알린다.
표식 없는 Swift 핸들러가 호출자가 있는데 symbol 없이 매치되면 여전히 종료 코드 2로
실패한다. 이 확장을 지원하는 소비자를 먼저 배포해야 한다. 옛 소비자는 스코프를
버리고 넓게 완화하며 ObjC 보존 생성은 실패한다.

모든 이슈는 관찰된 위치를 `evidence`로 제공한다. 동적 이름, 해석하지 못한 receiver나
handler 본문, USR 누락, 입력 생성 시각 차이, 혼합 target은 `limitations`에 출처와
함께 남긴다. 이 도구는 삭제 가능 여부를 판정하지 않는다.

isthmus 출력 문서는 버전 1 안에서 필드 추가나 새 이슈 code를 호환 변경으로 다룬다.
기존 필드의 의미를 바꾸거나 제거할 때 문서 버전을 올린다.

`limitations`에는 생산자가 신고한 한계와 isthmus가 직접 센 한계가 함께 들어간다.
각 항목은 `platform`·`target`·`tool`로 출처와 귀속을 밝히고, `origin: "consumer"`인
항목은 조인 단계에서 관찰한 것이다. 조인하지 못한 사실은 생산자의 신고나 그 개수와
무관하게 플랫폼·target별로 다시 센다.

- `unjoined-dynamic-channels`: 이름이 리터럴이 아닌 채널 생성·등록 사실
- `unjoined-dynamic-methods`: 이름이 리터럴이 아닌 호출·핸들러 사실
- `unjoined-unattributed-handlers`: 어느 채널에 속하는지 모르는 핸들러 사실

같은 위치의 중복 사실은 한 번만 센다. dynamic이면서 미귀속인 핸들러는 dynamic으로만
센다.

| 종료 코드 | 의미 |
|---|---|
| `0` | 실행 성공. 기본 모드에서는 이슈가 있어도 보고만 함 |
| `1` | `--strict`에서 error 이슈를 발견함(diff는 새로 관찰된 error만 해당). `-unverified` 경고와 베이스라인이 억제한 error는 실패시키지 않음 |
| `2` | 파일 읽기, JSON, 교환 계약, project 불일치, 플랫폼 구성 누락, 보류된 조인, 크기 상한(입력 텍스트·그래프 간선·베이스라인 항목), 베이스라인 파일 오류·쓰기 실패, 만들 수 없는 보존 근거 등 도구 실패. stderr가 원인을 구분 |
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

생산자가 발행한 `limitationScopes`가 소비자까지 전달되어 진단을 채널 단위로만
완화하는지 확인하려면 자기완결 스코프 dogfood를 실행한다. 스크립트는 스캐너가
본문을 볼 수 없으면서 채널 이름은 리터럴로 알려지는 형태(위임 핸들러 등록)의
최소 Swift 패키지와 Dart 호출 측을 합성하고, 스코프가 붙은 채널의 미처리 호출만
`-unverified` 경고로 낮아지고 같은 target의 인접 미처리 호출과 등록 없는 채널
생성은 error로 남는지 검증한다. cartograph 0.9.0 이상, dartograph 0.1.1 이상,
Swift 6이 필요하며 네트워크 접근은 하지 않는다.

```bash
node scripts/verify-limitation-scopes.mjs \
  /path/to/cartograph \
  /path/to/dartograph
```

## 변경 전후 비교 (0.1.4 이상)

같은 프로젝트의 변경 전후 Dart·Swift 교환 파일을 비교하려면:

```bash
isthmus diff \
  --before before-dart.json before-swift.json \
  --after after-dart.json after-swift.json --strict
```

`isthmus-diff` v1은 추가·제거된 논리 메서드 연결, 새로 관찰된 불일치와 더 이상
관찰되지 않는 불일치, 양 시점의 분석 한계와 그 차이, producer 버전·생성 시각을
JSON으로 출력한다. 연결에는 호출자와 핸들러 위치가 포함된다. 줄 이동은 연결 변경으로
세지 않으며 rename은 추측하지 않는다. 같은 논리 키의 호출자·핸들러 교체나 개별 호출
위치 증감은 diff 비교 범위에 포함하지 않는다.

`--strict`는 새로 관찰된 error가 있을 때만 1이다. 기존 오류·경고·분석 한계만 있으면
0이므로 성공 코드가 삭제 안전성이나 완전한 분석을 뜻하지 않는다. `resolvedIssues`도
이전 불일치가 더 이상 관찰되지 않는다는 뜻이며, 동적 전환·추출기 변경 때문인지 한계를
함께 확인해야 한다. `--strict`은 인자 위치와 무관하게 인식하며 두 번 이상 줄 수 없다.

현재 diff는 Flutter의 Dart·Swift 문서만 받는다. 각 시점에 두 플랫폼이 모두 필요하며,
양 시점의 `project`와 플랫폼·도구별 문서 개수가 같아야 한다. 한 checkout의 같은
경로에서 각 revision을 빌드해 JSON을 보관한다. 일부 파일만 추출한 결과와 전체 결과를
비교하지 말고 같은 분석 설정을 사용한다. 입력 파일은 합계 256개, 텍스트 길이 제한은
기존 CLI와 동일하다. 혼합 target이나 비교 불가능한 입력은 종료 코드 2로 거부한다.
`generatedAt`은 fact 추출 시각이며 revision 순서가 아니다. 비교 방향은 `--before`와
`--after` 인자로 결정되므로 사용자가 올바른 revision의 파일을 지정해야 한다.

## 코딩 에이전트 skill

네이티브 브리지 핸들러를 지우거나 이름을 바꾸기 전에 `query`로 다른 언어의 호출자를
확인하도록 가르치는 skill 원문을
[`Skills/isthmus/SKILL.md`](Skills/isthmus/SKILL.md)에 제공한다. 사용하는 에이전트의
프로젝트 skill 디렉터리에 이 파일을 복사해 사용할 수 있다.

Codex는 이 checkout의 `.agents/skills/isthmus` 링크로 같은 원문을 발견한다.
원문은 `Skills/isthmus/SKILL.md` 한 곳만 편집하면 되며, npm 패키지에는 이 원문이
포함된다. 스킬 내용 검증과 모델별 지침 조정 근거는
[에이전트 감사 기록](docs/AGENT-AUDIT.md)에 있다.

## 라이선스

[MIT](LICENSE). 상업적 사용을 포함해 영구 무료다.
