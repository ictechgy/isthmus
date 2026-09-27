# route 단위 영향 추적 (`isthmus trace`)

_기록: 2026-09-27 · 상태: 개발 중(Phase 2 소비자, 단일 project) · [API 변경 영향 계획](API-IMPACT-PLAN.md)_

```bash
isthmus trace trace-context.json [--strict] [--compact]
```

한 project의 bridge-facts(http·persistence)와 생산자 순회([`language-traversal` v1](LANGUAGE-TRAVERSAL.md)
또는 옛 형식)를 받아 route 단위 영향 후보를 경로 증거와 함께 잇는다. 제품은 JSON만 읽고 생산자를
실행하지 않는다. 결과는 항상 `complete: false`이고, 끊긴 곳은 `gaps`로만 보고한다. **gap이나 빈 목록은
"닿지 않는다"의 증거가 아니다.** 요청·응답 본문 필드, query 파라미터, 헤더 호환성은 판정하지 않는다
(`scope.fieldCompatibility`·`scope.queryAndHeaders`가 `not-assessed`).

두 방향을 지원한다.

- **route 선택**: route-decl → 핸들러 usr → 정방향 순회(`forward`)의 도달 집합과 핸들러 자신 →
  그 usr를 `symbol.usr`로 가진 relation-use → persistence 조인 → relation-decl VertexId →
  schemagraph 의존자(`db-dependents`). 그리고 route → 귀속된 route-call → 호출을 감싼 심볼의
  클라이언트 역방향 순회(`reverse`).
- **relation·심볼 선택**: relation-use를 감싼 심볼(또는 선택한 심볼) → 역방향 순회 → route-decl
  핸들러 → route → 클라이언트. relation 선택은 그 relation의 VertexId 의존자도 싣는다.

## 입력: `isthmus-trace-context` v1

```json
{
  "format": "isthmus-trace-context",
  "version": 1,
  "project": "/work/trace-example",
  "revision": "rev-1",
  "documents": ["server.http.json", "server.persistence.json", "db.sql.json", "android.http.json"],
  "analyses": [
    { "id": "server-forward", "platform": "js", "role": "forward", "path": "server-forward.json" },
    { "id": "server-reverse", "platform": "js", "role": "reverse", "path": "server-reverse.json" },
    { "id": "db", "platform": "sql", "role": "db-dependents", "path": "db-dependents.json" },
    { "id": "android-reverse", "platform": "kotlin", "role": "reverse", "path": "android-reverse.json" }
  ],
  "selection": { "routes": [{ "method": "GET", "template": "/api/users/{}" }] }
}
```

- 상대 경로는 **context 파일이 있는 디렉터리** 기준이고 절대 경로는 그대로 쓴다. 모든 문서의
  `project`는 context `project`와 정확히 같아야 한다. 문서는 1~256개, 분석은 0~256개, 입력 텍스트는
  파일당 16Mi·전체 64Mi(UTF-16) 상한이다.
- `documents`: target `http`·`persistence` 문서(사실 0건 `target: null` 문서는 받되 아무것도 잇지
  않는다). bridge target(flutter·react-native·capacitor) 문서와 mixed-targets 입력은 거부한다.
  check와 달리 한쪽 측만 있어도 조인하며, 빠진 측은 gap으로 밝힌다.
- `analyses[].role`: `forward`(dependencies 순회), `reverse`(dependents 순회),
  `db-dependents`(platform `sql` 전용 dependents 순회). 형식은 문서의 표식으로 고른다 —
  `language-traversal` v1, 그리고 역할별 옛 형식([어댑터 표](LANGUAGE-TRAVERSAL.md#옛-형식-어댑터-trace)).
  같은 역할·플랫폼·root id의 분석이 여럿이면 합치고, 같은 정점은 한 근거만 싣는다.
- `revision`(선택): 분석의 `revision`과 비교한다. 다르면 `stale-analysis`, 분석에 없으면
  `analysis-revision-unknown`이다. context에 없으면 분석끼리 다를 때만 `stale-analysis`다. 같은
  플랫폼 분석의 `graphRevision`이 다르면 역시 `stale-analysis`다.
- `selection`: 정확히 하나. 목록은 1~1,000개이고 중복은 거부한다.
  - `routes: [{method, template, scope?}]` — method는 동사 또는 `ANY`, template은 정규 경로 템플릿
    (다시 정규화하지 않는다). check·query와 같이 **정확히 같은 선언 측 키**만 찾는다. scope를 생략하면
    그 키가 있는 모든 scope다.
  - `relations: [name]` — `query relation:`과 같은 해석(한정 이름 정확, 비한정은 마지막 세그먼트가
    유일할 때만). 모호하면 추측하지 않는다.
  - `symbols: [{platform, usr}]` — 언어 심볼(sql 제외)에서 역방향으로 route를 찾는다.
- `format: "isthmus-workspace"`(다중 저장소)는 원인 문구와 함께 거부한다. workspace trace는 Phase 3이다.

## 출력: `isthmus-trace` v1

```jsonc
{
  "format": "isthmus-trace", "version": 1, "project": "/work/trace-example", "revision": "rev-1",
  "complete": false,
  "scope": { "granularity": "route", "fieldCompatibility": "not-assessed", "queryAndHeaders": "not-assessed" },
  "selection": { "routes": [{ "method": "GET", "template": "/api/users/{}" }] },
  "chains": [{
    "selector": { "route": { "method": "GET", "template": "/api/users/{}" } },
    "routes": [{ "scope": "default", "method": "GET", "template": "/api/users/{}",
      "declarations": [ /* route-decl 끝점: platform·location·symbol·route */ ], "contracts": [],
      "calls": [{ "call": { /* route-call 끝점 */ }, "side": "decl", "quality": "exact",
        "affected": [{ "platform": "kotlin", "usr": "kt:UsersRepository.load", "analysis": "android-reverse",
                       "depth": 1, "path": ["kt:UsersApi.get", "kt:UsersRepository.load"] }] }] }],
    "handlers": [{ "platform": "js", "usr": "ts:api/users.get", "qualifiedName": "users.get",
                   "routes": [{ "scope": "default", "method": "GET", "template": "/api/users/{}" }], "reachedFrom": [] }],
    "relationUses": [{ "use": { /* relation-use 끝점 */ }, "relation": "users",
      "resolved": { "relation": "main.users" }, "decls": [ /* relation-decl 끝점 */ ],
      "reachedFrom": [{ "from": "ts:api/users.get", "analysis": "server-forward", "depth": 2,
                        "path": ["ts:api/users.get", "ts:service/users.load", "ts:repo/users.findById"] }] }],
    "database": [{ "vertex": "main.users", "dependents": [{ "platform": "sql", "usr": "main.active_users",
      "kind": "view", "analysis": "db", "depth": 1, "path": ["main.users", "main.active_users"] }] }]
  }],
  "gaps": [],
  "limitations": [ /* 조인 한계(check와 같은 모양) */ ],
  "analysisLimitations": [{ "analysis": "…", "message": "…" }],
  "analyses": [{ "id": "db", "platform": "sql", "role": "db-dependents", "source": "language-traversal",
                 "direction": "dependents", "tool": { "…": "…" }, "revision": "rev-1", "graphRevision": "catalog-1",
                 "truncated": false, "rootsTruncated": false, "rootProvenance": "complete", "roots": 2, "reached": 2 }],
  "summary": { "chains": 1, "routes": 1, "handlers": 1, "relationUses": 2, "databaseVertices": 2,
               "databaseDependents": 3, "calls": 1, "clientSymbols": 2, "gaps": 0 }
}
```

- 끝점(`declarations`·`calls[].call`·`use`·`decls`)은 `check --pairs`와 같은 투영(platform·
  location·symbol·route)이다. 모든 id는 생산자가 준 문자열이다. 체인 키는 `[platform, id]`이며
  다른 생산자의 id를 섞지 않는다.
- `path`·`depth`는 생산자의 via 목격을 따른다. 목격 경로가 이 hop의 시작 root가 아닌 다른 root에서
  시작하면 `witnessRoot`를 싣는다 — 그때 depth·path는 그 root 기준이고, 시작 root에서의 거리는 depth
  이상이라는 것만 안다(경로를 지어내지 않는다). 같은 정점에 근거가 여럿이면 시작 root 자신의 경로,
  depth, 분석 id 순으로 하나만 싣는다.
- 호출은 귀속된 정적 호출만 싣는다(check 귀속 게이트와 같다). decl에 match된 호출은 `side: "decl"`,
  decl 쪽이 없거나 맞지 않고 선택 키의 contract에 match된 호출은 `side: "contract"`다. 품질 표기는
  `check --pairs`와 같다.
- 테스트 소스 사실(`testSource`)은 기본으로 체인에서 뺀다(`test-source-omitted`).
- 정렬·키 순서가 고정돼 같은 입력이면 바이트 단위로 같은 출력이다. hop·정점·gap 합계가 1,000,000을
  넘으면 부분 결과 없이 종료 코드 2다.

## gap 코드

| 코드 | 뜻 |
|---|---|
| `route-without-decl` | 선택한 (method, template)과 정확히 같은 route-decl·route-contract가 선택 scope에 없다 |
| `handler-without-symbol` | route-decl에 `symbol.usr`가 없거나, route가 contract로만 선언돼 핸들러가 없다 |
| `relation-use-without-symbol` | relation-use에 `symbol.usr`가 없다(route 선택은 플랫폼별 개수, relation 선택은 사실별 증거) |
| `relation-decl-without-symbol` | relation-decl에 VertexId(`symbol.usr`)가 없다 |
| `call-without-symbol` | 귀속된 route-call에 `symbol.usr`가 없다 |
| `analysis-missing` | 필요한 역할·플랫폼·root id의 분석이 없다(`symbol`에 찾은 id) |
| `analysis-truncated` | 분석이 잘렸거나(`truncationReasons` 포함), root 귀속 64개 상한 때문에 이 root의 도달이 빠졌을 수 있다 |
| `roots-provenance-partial` | 옛 형식의 다중 root 분석이라 root 출처를 대표 root 하나로만 안다 |
| `stale-analysis` | 분석 revision이 context나 다른 분석과 다르거나, 같은 플랫폼 분석의 graphRevision이 다르다 |
| `analysis-revision-unknown` | context가 revision을 선언했는데 분석에 revision이 없다 |
| `non-http-entry` | 역방향 순회가 어느 route-decl 핸들러에도 닿지 않았다(스케줄·큐·CLI 진입점이거나 순회 불완전) |
| `unattributed-calls-omitted` | 이 scope를 불렀을 수 있는 귀속되지 않은 호출 수. 경로·host는 싣지 않는다 |
| `dynamic-route-calls` | 이 scope에 귀속됐지만 템플릿이 리터럴이 아니라 매칭하지 못한 호출 수 |
| `ambiguous-route-call` | 이 route와 다른 선언 사이에서 모호한 귀속 호출(따라가지 않음) |
| `test-source-omitted` | 체인에서 뺀 테스트 소스 route 사실 수 |
| `http-clients-unscanned` | 이 scope에 닿을 수 있는 client roles 문서가 없다 |
| `http-server-unscanned` | 역방향 선택인데 route-decl을 스캔한 server 문서가 없다 |
| `persistence-unscanned` | persistence 호출 측 문서나 sql 선언 문서가 없다 |
| `relation-use-without-decl` | 닿은 relation-use(또는 컬럼 사용)가 선언과 조인되지 않았다 |
| `relation-use-ambiguous` | 비한정 relation-use가 여러 선언 후보와 맞는다 |
| `dynamic-relation-use` | 닿은 relation-use의 이름이 리터럴이 아니다(원문은 증거로만) |
| `relation-selection-ambiguous` | 선택한 relation 이름이 여러 선언과 맞는다 |
| `relation-without-decl` | 선택한 relation의 선언이 없다 |
| `relation-without-use` | 선택한 relation의 사용이 관찰되지 않았다(없다는 증거가 아님) |

gap은 `selector`(체인)·`route`·`symbol`·`analysis`·`evidence` 중 해당하는 필드를 싣는다. 귀속되지 않은
호출은 어떤 gap에도 경로·host·심볼을 싣지 않고 개수만 싣는다.

## 종료 코드

`0` 보고서 생성, `1` `--strict`이고 gap이 하나 이상(보고서는 stdout에 그대로), `2` 입력·계약·읽기
오류(원인과 입력 순번만, 원문·경로 없음), `64` 사용 오류.

## 현재 범위와 남은 일

- 단일 project만 받는다. workspace(서버·클라이언트 저장소 분리)·형제 전파·files 선택·http diff는 Phase 3이다.
- MCP에는 노출하지 않는다(계획대로 Phase 3에 출력 상한과 함께 결정).
- 입력 수집 스크립트(`scripts/capture-trace.mjs`)는 아직 없다. 생산자 명령을 차례로 실행하고 context를
  손으로 쓴다. 합성 예제는 `fixtures/trace/`에 있다(실제 앱 입력으로 쓸 수 없다).
- 생산자 쪽: TS 생산자의 route-decl·relation-use usr와 `reach`/impact의 language-traversal 출력,
  schemagraph impact의 language-traversal 출력은 각 저장소에서 진행 중이다. 옛 schemagraph-impact v1은
  어댑터로 받는다.
