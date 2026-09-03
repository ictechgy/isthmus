# isthmus 계획

세 자매 중 **의존이 가장 많다.** 혼자서는 시작할 수 없고, cartograph 와 dartograph 에 선행 작업이 있다. 그 대신 isthmus 자체는 작다.

## 선행 작업 (다른 저장소)

| 저장소 | 작업 | 상태 |
|---|---|---|
| `../cartograph` | `bridges --format json` — SwiftSyntax 로 `FlutterMethodChannel(name:)` · `setMethodCallHandler` · `case "…"` · `RCT_EXPORT_MODULE/METHOD` · `@objc(…)` 리터럴 추출. 형식은 `docs/GRAPH-EXCHANGE.md` | 미착수 — **첫 번째로 할 일** |
| `../cartograph` | `--external-retentions <path>` + `RetentionReason.externalBridge` + `--explain` 문장 | 미착수 |
| `../dartograph` | `bridges --format json` — Phase 4 | dartograph 가 Phase 1 도 안 됨 |
| `../kartograph` | `bridges --format json` — Phase 4 | v0.2 에서 필요 |

**dartograph 를 기다리지 않는 길**: Phase 0 에서 Dart 쪽 추출을 `package:analyzer` 기반 100 줄짜리 스크립트로 임시 구현해 형식을 검증한다. 그 스크립트가 나중에 dartograph `bridges` 의 초안이 된다.

## Phase 0 — 형식 검증 (1 세션)

목표: `GRAPH-EXCHANGE.md` 초안 0 이 실제 코드에 맞는지 확인하고 1 로 올린다.

### 0.1 대상

- `flutter/packages` 에서 MethodChannel 을 쓰는 플러그인 하나. 후보: `path_provider`, `url_launcher`, `shared_preferences` (전부 iOS 구현이 Swift 인지 ObjC 인지 세션에서 확인 — **ObjC 면 cartograph 가 못 본다**, Swift 구현이 있는 것을 고른다)
- 없으면 `fixtures/` 에 직접 만든다: Flutter 앱 + iOS 러너, 채널 하나, 메서드 셋, 오타 하나

### 0.2 양쪽 추출 스크립트

- Dart: `package:analyzer` 로 `MethodChannel(` 생성자와 `invokeMethod(` 호출의 첫 인자 리터럴 + 위치
- Swift: `SwiftSyntax` 로 `FlutterMethodChannel(name:` · `setMethodCallHandler` · `switch call.method { case "…" }` 리터럴 + 위치. **이것이 cartograph `bridges` 의 초안**
- 둘 다 `GRAPH-EXCHANGE.md` 형식으로 JSON 출력

### 0.3 손 조인

- 두 JSON 을 `jq` 로 조인해 본다. 맞춰지는가 · 안 맞춰지는 것은 왜인가(동적 이름? 형식의 구멍?) · `case` 를 어느 심볼에 귀속시킬 것인가
- 결과로 `GRAPH-EXCHANGE.md` 를 고쳐 버전 1. 미결 세 항목에 답을 적는다

## Phase 1 — cartograph `bridges` (cartograph 저장소, 1 세션)

- Phase 0 의 Swift 스크립트를 cartograph 의 `CartographSyntax` 모듈 안에 `BridgeFactScanner` 로. `bridges --format json` 명령
- cartograph 의 규칙대로: 테스트 · 커버리지 · CLI 계약 · CHANGELOG · GLM 리뷰 · PR
- 이 PR 이 머지되어야 isthmus 가 실제 입력을 갖는다

## Phase 2 — isthmus 골격 + `check` (1~2 세션)

- TypeScript 패키지. `src/` 아래 `exchange/`(형식 파서 · 검증), `join/`, `report/`, `cli/`. `AGENTS.md`
- 종료 코드 계약 + 검증 스크립트 첫 커밋. 커버리지 게이트(c8, 90%)
- `check` — 세 종류 보고. 각 항목에 양쪽 위치. `limitations` 에 동적 이름 수와 입력 신선도
- 코퍼스: Phase 0 의 대상에서 실제로 만든 두 JSON 을 `fixtures/` 에 커밋. 스크립트가 기대 보고와 양방향 대조

## Phase 3 — 되돌려 주기 (cartograph + isthmus, 1~2 세션)

- isthmus `retentions --for cartograph`
- cartograph `--external-retentions` + `RetentionReason.externalBridge` + `--explain`
- 검증: 코퍼스의 iOS 러너에서 cartograph `dead` 가 핸들러를 보고하다가, retentions 를 넘기면 보고하지 않고 `--explain` 이 Dart 위치를 말한다. **이 테스트가 isthmus 의 존재 이유를 증명한다**

## Phase 4 — `query` · `graph` · 릴리스 (1 세션)

- `query <channel|method>` — cartograph 스키마 골격
- `graph` — 경계 간선 DOT/Mermaid/JSON
- `skill` — 짧다: "네이티브 핸들러를 지우기 전에 `isthmus query` 로 Dart/JS 쪽 호출자를 봐라"
- npm 발행, 0.1.0

## Phase 5 — RN (v0.2)

- JS/TS 추출기(`extract-js`, TS 컴파일러 API)
- cartograph `bridges` 에 RN 종류 추가
- 대상: 네이티브 코드가 있는 RN 라이브러리(예: `react-native-webview` — 존재 확실). 바탕화면의 RN 앱(`골목골목/mobile`)은 Expo managed 라 네이티브 코드가 없어 대상이 아니다

## Phase 6 — Kotlin (kartograph Phase 4 이후)

## 세션 운영

- **cartograph 저장소를 건드리는 Phase(1, 3)는 cartograph 의 규칙을 따른다** — 그 저장소의 `CLAUDE.md`, GLM 리뷰, 오탐 코퍼스
- 한 세션 한 Phase 일부. PR 마다 GLM 리뷰. 형식 변경은 네 저장소 동시 PR

## 진행 표

| Phase | 상태 | 비고 |
|---|---|---|
| 0 형식 검증 | 미착수 | Dart 임시 스크립트로 dartograph 를 기다리지 않음 |
| 1 cartograph `bridges` | 미착수 | cartograph 저장소 |
| 2 골격 + check | 미착수 | |
| 3 되돌려 주기 | 미착수 | cartograph `--external-retentions` |
| 4 query · graph · 릴리스 | 미착수 | |
| 5 RN | 미착수 | v0.2 |
| 6 Kotlin | 미착수 | kartograph 대기 |
