# Phase 0 실험 지침

루트 [AGENTS.md](../../AGENTS.md)와 [교환 계약](../../docs/GRAPH-EXCHANGE.md)을 따른다.

- Dart·Swift 추출기는 계약 검증용 실험이다. 제품은 dartograph·cartograph가 생산한다.
  실험 코드를 isthmus 런타임에 포함하거나 정식 producer로 안내하지 않는다.
- 실험 추출기는 향후 제거 대상이지만 `expected/`를 읽는 제품 회귀 테스트가 남아 있다.
  제거 전에 참조를 조사하고 동등한 검증을 옮긴다. 작업 범위 밖에서 자동 삭제하지 않는다.
- `fixture/`와 `expected/`는 연결·미연결·오타·동적 이름의 독립된 기대값이다.
  새 출력으로 덮어써 통과시키지 말고, 사실 위치·논리 키·분석 한계의 변경 이유를 확인한다.
- 실험에서도 import provenance·어휘 scope·상수 추적·UTF-8 열·안전한 경로·시각을 검증한다.
  파서가 증명하지 못한 부분은 추측 대신 limitation 또는 명시적 실패로 남긴다.
- `join/`은 제품 parser/join을 재사용하는 회귀 검증이다. 별도 조인 정책을 복제하지 않는다.
- `.dart_tool/`, `.build/`, `build/`, 로컬 lockfile·coverage 산출물을 커밋하지 않는다.
- 외부 공개 fixture는 source revision·라이선스·재현 절차를 남긴다.

## 해당 부분을 바꿨을 때 실행할 검사

저장소 루트에서:

```bash
npm run test:phase0:join
(cd experiments/phase-0/dart && dart analyze && dart test)
(cd experiments/phase-0/swift && swift test)
```

Dart 의존성 초기화가 필요하면 실험 폴더에서 `dart pub get`을 실행한다.
SwiftSyntax는 기본적으로 외부 의존성을 해석하며, 로컬 checkout은 해당 실험 README의
`SWIFT_SYNTAX_PATH` 방식으로 지정한다. 실제 producer 왕복 명령은
[scripts 지침](../../scripts/AGENTS.md)에 있다. 일반 npm 검증은 Dart·Swift 실험 테스트를 실행하지 않는다.
