# persistence 수동 왕복 추적

코드가 쓰는 테이블·컬럼과, 그 테이블에 기대는 코드·DB 객체를 손으로 잇는 절차다.
**아직 자동화되지 않았다.** isthmus는 JSON 파일만 읽고 쓰며 자매 도구를 실행하지 않는다.
아래 명령은 사람이나 에이전트가 차례로 실행하고, isthmus는 그 사이에서 사용↔선언 쌍만 낸다.

이 절차로 답하려는 질문은 두 가지다.

- 이 테이블(또는 컬럼)을 바꾸면 어떤 코드 선언과 그 소비자가 영향을 받는가
- 이 코드가 쓰는 테이블은 무엇이고, 그 테이블의 DB 내부 의존자(뷰·트리거·FK)는 무엇인가

## 준비: 생산자별 명령과 식별자

모든 문서는 같은 `project` 문자열을 가져야 한 번에 조인된다([GRAPH-EXCHANGE](GRAPH-EXCHANGE.md)).
코드 쪽 `relation-use` 사실의 `symbol.usr`가 그 생산자의 impact id와 같아야 코드 방향으로
정확히 이어진다. 오늘(2026-09-26) 기준 생산자별 상태는 다음과 같다.

| 생산자 | persistence 문서 명령 | `relation-use`의 `symbol` | 코드 방향 다음 명령 |
|---|---|---|---|
| cartograph (Swift) | `cartograph schema` | 인덱스 스토어가 있으면 감싸는 선언의 Swift USR(`s:…`)을 `usr`에 싣는다. 파일 범위 사실은 symbol이 없다 | `cartograph impact '<usr>' --format json` (선택자는 이름·한정 이름·USR을 받는다) |
| kartograph (Kotlin/Java) | `kartograph schema --project <dir> --format json --graph-file <snapshot>` | 조건부. 스냅샷을 주고, 사실이 함수·메서드 본문 안에 있을 때만 JVM id(`method:owner#name desc` 형태)를 `usr`에 싣는다. 스냅샷은 `snapshot --include-paths`로 캡처해야 소스 위치가 맞는다 | `kartograph impact '<usr>' --graph-file <snapshot>` |
| dartograph (Dart) | `dartograph schema --format json [--project <root>] <package-root>` (패키지 루트는 필수, 예: `.`) | `qualifiedName`(`Class.method`)만 있고 `usr`는 없다. dartograph impact id(`<package:…\|project:…>::Class.member`)와 문자열이 달라 자동으로 잇지 못한다 | 위치(`location.path`)와 `qualifiedName`으로 사람이 찾는다 |
| gartograph (Go) | `gartograph schema [--dir <module-root>]` (기본은 현재 디렉터리) | 없다 | 위치(파일·줄)로만 찾는다 |
| rustograph (Rust) | `rustograph schema [--dir <crate-root>]` (기본은 현재 디렉터리) | 없다 | 위치(파일·줄)로만 찾는다 |
| schemagraph (카탈로그) | `schemagraph facts --document catalog.json --project <root> -o sql-facts.json` | `relation-decl`의 `qualifiedName`이 그래프 정점 id(VertexId, 예: `main.users`, `main.users.id`)다. `usr`에도 같은 값을 싣는 변경이 계획돼 있으나 이 문서 시점에는 확인하지 않았다 | `schemagraph impact <VertexId> --graph graph.json` |

schemagraph의 그래프와 사실은 같은 카탈로그 문서에서 만들어야 정점 id가 일치한다.
카탈로그 문서는 JDBC·Go probe가 만들거나 `scan --emit-document`로 얻는다.

```bash
schemagraph scan --document catalog.json -o graph.json
schemagraph facts --document catalog.json --project "$PROJECT" -o sql-facts.json
```

## 절차

1. 코드 쪽 persistence 문서를 만든다. 예: Kotlin/Java.

   ```bash
   kartograph snapshot --classes build/classes --project "$PROJECT" --include-paths > graph.snapshot.json
   kartograph schema --project "$PROJECT" --format json --graph-file graph.snapshot.json > code-facts.json
   ```

2. 카탈로그 쪽 문서와 그래프를 만든다(위 schemagraph 명령).

3. 사용↔선언 쌍을 낸다.

   ```bash
   isthmus check code-facts.json sql-facts.json --pairs > check.json
   ```

   `--pairs`는 기본 `--format json`에서만 쓴다. `sarif`·`codequality`와 함께 쓰면 사용 오류(64)다.
   출력은 플래그 없는 check 문서에 최상위 `matches`만 더한 것이다. 요약·이슈·베이스라인·
   `--strict` 판정은 바뀌지 않는다.

   ```json
   {
     "domain": "persistence",
     "key": { "relation": "public.users", "column": "email" },
     "uses": [{ "platform": "kotlin", "location": { "path": "src/Repo.kt", "line": 4, "column": 1 },
                "symbol": { "qualifiedName": "Repo.find", "usr": "method:com/example/Repo#find()V" } }],
     "decls": [{ "platform": "sql", "symbol": { "qualifiedName": "public.users.email" } }]
   }
   ```

   - `key.relation`은 조인이 해석한 선언 측 한정 이름이다. 비한정 사용(`users`)과 한정 사용
     (`public.users`)이 같은 선언으로 해석되면 한 매치로 합친다. `key.column`이 없으면 관계
     수준 매치다. 컬럼 철자는 대소문자만 다르면 한 키로 합치고 사용 측 최소 철자를 쓴다.
   - `uses`·`decls`의 끝점은 사실의 `platform`·`location`·`symbol`을 그대로 복사한다.
   - 사용과 선언이 모두 관찰된 것만 싣는다. 선언 없는 사용·모호한 사용·사용 없는 선언은
     기존 `issues`에 있다.
   - 끝점 총수가 100,000을 넘으면 부분 목록 대신 종료 코드 2로 실패한다. 문서 수나 스캔
     범위를 줄여 다시 실행한다.

4. 코드 방향: 바꾸려는 관계의 `uses[].symbol.usr`를 코드 생산자의 impact에 넣는다.

   ```bash
   jq -r '.matches[] | select(.key.relation == "public.users") | .uses[].symbol.usr // empty' check.json | sort -u
   kartograph impact 'method:com/example/Repo#find()V' --graph-file graph.snapshot.json
   cartograph impact 's:…' --format json
   ```

5. DB 방향: `decls[].symbol.qualifiedName`(VertexId)을 schemagraph impact에 넣는다.

   ```bash
   jq -r '.matches[].decls[].symbol.qualifiedName' check.json | sort -u
   schemagraph impact public.users --graph graph.json
   ```

6. 관계 하나만 볼 때는 query의 relation 주체를 쓴다.

   ```bash
   isthmus query relation:users code-facts.json sql-facts.json
   ```

   조인과 같은 규칙으로 해석한다: 한정 이름은 정확히 같은 선언만, 비한정 이름은 마지막
   세그먼트가 같은 선언이 하나일 때만 찾는다. 여럿이면 추측하지 않고 `ambiguous`와 후보
   (`relation:audit.users` 같은 다시 질의할 수 있는 이름)를 낸다. 결과는 기존 query 외피
   (`status`·`requested`·`level: "persistence"`·`limitations`·`result`)를 쓰며, `result`에
   관계 수준 사용(`usedBy`)·선언(`dependsOn`)·컬럼별 증거(`columns`)·이 관계의 check 진단
   (`issues`)을 싣는다. 선언이 없어도 같은 이름의 사용이 관찰됐으면 선언 없는 관계로 찾고,
   선언도 사용도 없으면 기존처럼 `notFound`와 종료 코드 64다. 이름 자체가 `relation:`으로
   시작하는 bridge 채널·메서드는 같은 이름의 관계가 없으면 이전처럼 그 이름으로 찾고(`level:
   "bridge"`), 관계와 겹치면 관계가 우선하므로 qualifiedName(예: `flutter:relation%3Afoo`)으로 묻는다.

## 해석할 때

- 빈 `matches`나 `usr`가 없는 끝점은 영향이 없다는 증거가 아니다. usr가 없는 사용(dartograph,
  gartograph, rustograph, 스냅샷 없는 kartograph, 파일 범위 Swift 사실)은 위치로만 이어진다.
- 쌍의 정확도는 생산자의 이름 해석을 넘지 못한다. ORM·프레임워크별 테이블 이름 규칙은
  생산자 책임이며, 생산자 문서의 지원 범위와 limitation을 함께 본다.
- `limitations`와 `-unverified` 진단은 그대로 남는다. `catalog-coverage:`가 있으면 선언 쪽이,
  `unjoined-dynamic-relations`가 있으면 사용 쪽이 부분 관찰이다.
- 이 절차는 한 project 안에서만 동작한다. 여러 저장소(예: 백엔드와 클라이언트)를 한 번에
  잇는 것은 아직 지원하지 않는다.
