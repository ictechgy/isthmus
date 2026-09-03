# isthmus — 작업 규칙

이 저장소는 cartograph 프로젝트 군의 **조인 도구**다. 무거운 해석은 자매 도구가 하고, 여기서는 그들이 내보낸 사실을 잇는다. 전역 규칙(`~/.claude/CLAUDE.md`)에 **더해지는** 것을 적는다.

## 먼저 읽을 것

1. `docs/GRAPH-EXCHANGE.md` — **이 프로젝트의 핵심 산출물.** 세 자매 도구가 지켜야 할 계약이다. 코드보다 이것을 먼저 굳힌다
2. `docs/PRD.md`, `docs/PLAN.md`
3. `docs/RESEARCH.md` — 브리지 메커니즘별로 확인된 것과 아닌 것
4. `../cartograph/CLAUDE.md` — 상속할 설계 원칙

## cartograph 에서 그대로 가져오는 것

`../kartograph/CLAUDE.md` 의 같은 절과 동일. 특히:

- **삭제 판정을 내지 않는다.** "Dart 어디서도 안 부르는 채널" 은 사실이고, 그것이 미사용이라는 판정은 소비자의 몫이다
- **분석 한계를 응답에.** 문자열 조인은 원리적으로 근사다. 동적으로 조립되는 채널 이름(`'com.example/$feature'`)은 못 본다. 그런 리터럴이 몇 개 있는지 세어 `limitations` 에 싣는다
- **종료 코드 계약**, **오탐 코퍼스**, **`query`**, **커버리지 90%**

## 이 프로젝트만의 규칙

- **교환 형식이 먼저, 코드는 나중.** `GRAPH-EXCHANGE.md` 가 확정되기 전에 조인 코드를 쓰지 않는다. 형식이 바뀌면 세 저장소가 같이 바뀐다
- **isthmus 는 어떤 언어도 직접 파싱하지 않는다** — 단 하나, JS/TS 만 예외다. Swift 는 cartograph, Kotlin 은 kartograph, Dart 는 dartograph 가 `bridges` 명령으로 내보낸다. JS/TS 는 자매 도구가 없으므로(그 자리는 knip 등이 채우고 있어 만들지 않기로 했다) isthmus 안에 작은 추출기를 둔다. TypeScript 컴파일러 API 로 `NativeModules.X`, `TurboModuleRegistry.get('X')`, `requireNativeComponent('X')` 리터럴을 뽑는다
- **도구 언어는 TypeScript.** JS/TS 추출기가 TS 컴파일러 API 를 쓰므로 자연스럽고, 조인 자체는 어느 언어든 상관없다. 배포는 npm(`npx isthmus`)
- **입력은 전부 파일이다.** 자매 도구를 셸로 부르지 않는다. 사용자가 각 도구를 돌려 JSON 을 만들고 isthmus 에 경로를 넘긴다. 이유: 세 도구의 설치 · 빌드 요구사항(Xcode, Gradle, Flutter SDK)을 isthmus 가 떠안으면 아무 데서도 못 돈다. 편의 래퍼는 나중에
- **되돌려 주는 것도 파일이다.** `isthmus retentions --for cartograph` 가 cartograph 가 읽을 수 있는 보존 근거 파일을 낸다. cartograph 쪽에는 그것을 읽는 `--external-retentions <path>` 가 필요하다(`docs/PLAN.md` 선행 작업)

## 검증

- `npm test`, 커버리지 게이트(c8, 라인 90%), CLI 계약 스크립트
- **코퍼스는 실제 앱이어야 한다.** Flutter 앱 + iOS 러너 하나를 `fixtures/` 에 두고, 세 도구를 실제로 돌려 만든 JSON 을 커밋한다. 조인 결과가 "이 핸들러는 보존되어야 한다 / 이 호출은 핸들러가 없다" 를 양방향으로 맞추는지 스크립트로 검증
- PR 마다 GLM 리뷰. 리뷰의 주장은 코드로 확인한 뒤 반영

## 하지 않는 것

- 자매 도구의 그래프 전체를 읽지 않는다. **브리지 사실만** 읽는다. 전체 그래프 조인은 크고 느리고, 질문에 답하는 데 필요 없다
- Capacitor · Cordova · Kotlin Multiplatform 은 v0.1 범위 밖. 메커니즘이 같으면 어댑터 하나로 붙는다 — 나중에
- 자동 수정 없음

## 커밋과 브랜치

전역 규칙과 같다. `AGENTS.md` 는 패키지 구조가 생기는 Phase 1 에서.
