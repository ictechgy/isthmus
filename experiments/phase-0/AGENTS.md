# Phase 0 실험

루트 [AGENTS.md](../../AGENTS.md)와 [교환 계약](../../docs/GRAPH-EXCHANGE.md)을 따른다.

- Dart/Swift 추출기는 계약 검증용이다. 제품 producer는 dartograph/cartograph다.
  실험 런타임을 제품에 넣거나 정식 producer로 안내하지 않는다.
- 향후 제거 대상이지만 제품 테스트가 `expected/`를 읽는다. 참조·대체 검증을 확인하기 전 삭제하지 않는다.
- `fixture/`·`expected/`는 연결·미연결·오타·동적 이름의 독립 기대값이다.
  새 출력으로 덮어쓰지 말고 위치·키·한계의 변경 이유를 검토한다.
- provenance·scope·한 단계 상수·UTF-8 열·경로·시각을 해당 parser로 검증한다.
  `join/`은 제품 parser/join을 재사용하며 별도 정책을 복제하지 않는다.
- `.dart_tool/`, `.build/`, `build/`, 로컬 lockfile/coverage는 커밋하지 않는다.
  외부 fixture의 revision·라이선스·재현 절차를 기록한다.

## 변경한 부분만 추가 검증

```bash
npm run test:phase0:join
(cd experiments/phase-0/dart && dart analyze && dart test)
(cd experiments/phase-0/swift && swift test)
```

조인 검사는 일반 npm verify에 포함되므로 이미 통과했으면 반복하지 않는다.
Dart/Swift 실험 변경에만 해당 언어 검사를 추가한다. Dart 초기화는 해당 폴더에서 `dart pub get`,
로컬 SwiftSyntax 사용법은 이 폴더 README를 따른다. 실제 producer 검증은 [scripts 지침](../../scripts/AGENTS.md)에 있다.
