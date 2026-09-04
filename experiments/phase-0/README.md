# Phase 0 — 브리지 사실 형식 검증

`docs/GRAPH-EXCHANGE.md` 버전 1을 실제 파서 출력에 대조한 임시 실험이다. 이 코드는 isthmus 제품에 들어가지 않는다. Dart 추출기는 dartograph로, Swift 추출기는 cartograph로 옮긴 뒤 제거한다.

## 코퍼스

- `fixture/lib/camera_bridge.dart`: 리터럴·보간 채널, 리터럴·동적 메서드, 오타 호출
- `fixture/ios/Runner/CameraPlugin.swift`: `static let` 채널, `setMethodCallHandler`, 문자열 `case`, 보간 채널
- `expected/dart.json`, `expected/swift.json`: 두 추출기의 결정적 출력
- `expected/join.json`: 정적 사실만 `(channel, method)`로 연결한 결과
- `expected/check.json`: 제품 `check` 명령의 결정적 JSON 출력
- `expected/query.json`: 제품 `query takePhoto` 명령의 결정적 JSON 출력
- `expected/graph.json`: 제품 `graph` 명령의 결정적 JSON 출력
- `expected/retentions.json`: 제품 `retentions --for cartograph` 명령의 결정적 JSON 출력
- `expected/cartograph-*.json`: cartograph 실제 코퍼스 USR로 외부 보존 왕복을 검증하는 target별 입력·출력

로컬에 Flutter SDK와 `flutter/packages`가 없어 소스 코퍼스를 직접 만들었다. 두 파서와 조인은 실행했지만 Flutter 앱 빌드는 검증하지 않았다. 공개 Flutter 플러그인 도그푸딩은 cartograph Phase 1에서 계속한다.

## 확인된 결과

- `dev.isthmus/camera` 채널 생성과 등록 1쌍 연결
- `takePhoto` 호출과 핸들러 1쌍 연결
- 오타 호출 `takePhotos`는 핸들러 없는 호출로 분리
- `captureStill`, `recordVideo`는 호출 없는 핸들러로 분리
- 보간 채널·동적 메서드는 조인하지 않고 `limitations`로 전달
- `channel: null`인 핸들러는 불일치에서 제외
- `mixed-targets` 문서는 사실별 메커니즘을 알 수 없어 조인을 보류
- Swift `method-handle`은 `CameraPlugin.register`에 귀속. Phase 0은 USR을 만들 수 없어 `missing-handler-usrs`로 보고
- 위치 열은 1부터 시작하는 UTF-8 바이트 기준이며 생성 시각은 UTC 밀리초 형식으로 정규화
- 조건부 컴파일 안의 Swift Flutter 브리지 구문은 활성 구성을 추측하지 않고 compiler-indexed 추출이 필요하다고 실패

## 실행

Dart 3.13.3과 analyzer 14.3.0으로 검증했다.

```bash
cd experiments/phase-0/dart
dart pub get
dart analyze
dart test
```

SwiftSyntax는 기본적으로 공식 저장소에서 해석한다. 이미 체크아웃이 있으면 네트워크 없이 경로를 넘길 수 있다.

```bash
cd experiments/phase-0/swift
SWIFT_SYNTAX_PATH=/path/to/swift-syntax swift test
```

두 고정 JSON의 호환 조인은 제품의 교환 파서와 조인 구현을 사용하며 `npm run verify`에도 포함된다.

```bash
cd experiments/phase-0/join
node --test join.test.mjs
node join-cli.mjs ../expected/dart.json ../expected/swift.json
```

cartograph의 실제 컴파일러 인덱스 코퍼스와 보존 근거 왕복은 저장소 루트에서 실행한다.

```bash
npm run build
node scripts/verify-cartograph-roundtrip.mjs \
  /path/to/cartograph \
  /path/to/FalsePositiveCorpus
```
