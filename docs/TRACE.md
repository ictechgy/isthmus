# route 단위 영향 추적 (`isthmus trace`)

_기록: 2026-09-27 · 상태: 개발 중(Phase 3 소비자 — 단일 project와 workspace) · [API 변경 영향 계획](API-IMPACT-PLAN.md)_

```bash
isthmus trace trace-context.json [--strict] [--compact]
```

한 project — 또는 서버와 클라이언트가 다른 저장소에 있는 workspace의 여러 member — 의 bridge-facts(http·
persistence)와 생산자 순회([`language-traversal` v1](LANGUAGE-TRAVERSAL.md) 또는 옛 형식)를 받아 route 단위
영향 후보를 경로 증거와 함께 잇는다. "이 API를 바꾸면 이 테이블들과 이 클라이언트 호출부, 그리고 그 호출부를
쓰는 클라이언트 코드가 영향받는다"를 한 명령으로 보여 주는 것이 목표다. 제품은 JSON만 읽고 생산자를
실행하지 않는다. 결과는 항상 `complete: false`이고, 끊긴 곳은 `gaps`로만 보고한다. **gap이나 빈 목록은
"닿지 않는다"의 증거가 아니다.** 요청·응답 본문 필드, query 파라미터, 헤더 호환성은 판정하지 않는다
(`scope.fieldCompatibility`·`scope.queryAndHeaders`가 `not-assessed`).

세 방향을 지원한다.

- **route 선택**: route-decl → 핸들러 usr → 정방향 순회(`forward`)의 도달 집합과 핸들러 자신 →
  그 usr를 `symbol.usr`로 가진 relation-use → persistence 조인 → relation-decl VertexId →
  schemagraph 의존자(`db-dependents`). 그리고 route → 귀속된 route-call → 호출을 감싼 심볼의
  클라이언트 역방향 순회(`reverse`).
- **relation·심볼 선택**: relation-use를 감싼 심볼(또는 선택한 심볼) → 역방향 순회 → route-decl
  핸들러 → route → 클라이언트. relation 선택은 그 relation의 VertexId 의존자도 싣는다.
- **파일 선택**: 파일에 놓인 심볼(분석 위치, 없으면 사실 위치) → 심볼 선택과 같은 역방향 체인. 파일에 놓인
  relation-use는 hop과 DB 의존자로 싣는다([아래](#파일-선택)).

## 입력: `isthmus-trace-context` v1 (단일 project)

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
  `analysis-revision-unknown`이다. context에 없으면 분석끼리 다를 때 `stale-analysis`, 일부 분석에만
  revision이 있으면 없는 쪽이 `analysis-revision-unknown`이다. 같은
  플랫폼 분석의 `graphRevision`이 다르면 역시 `stale-analysis`다.
- `selection`: 정확히 하나. 목록은 1~1,000개이고 중복은 거부한다.
  - `routes: [{method, template, scope?}]` — method는 동사 또는 `ANY`, template은 정규 경로 템플릿
    (다시 정규화하지 않는다). check·query와 같이 **정확히 같은 선언 측 키**만 찾는다. scope를 생략하면
    그 키가 있는 모든 scope다.
  - `relations: [name]` — `query relation:`과 같은 해석(한정 이름 정확, 비한정은 마지막 세그먼트가
    유일할 때만). 모호하면 추측하지 않는다.
  - `symbols: [{platform, usr}]` — 언어 심볼(sql 제외)에서 역방향으로 route를 찾는다.
  - `files: [path]` — 사실 위치와 같은 project 상대 경로([파일 선택](#파일-선택)).
- `analyses[].precomputed`(선택): 다른 곳에서 미리 계산해 내려받은 artifact다([사전 계산 분석](#사전-계산-분석)).
- 맨 `format: "isthmus-workspace"` 매니페스트는 원인 문구와 함께 거부한다. 매니페스트의 member·link를 아래
  workspace context로 옮기고 member별 `analyses`와 `selection`을 더한다.

## 입력: workspace (저장소가 나뉜 서버·클라이언트)

```json
{
  "format": "isthmus-trace-context",
  "version": 1,
  "members": [
    { "name": "server", "project": "/work/example-server", "revision": "srv-7f3c2a1",
      "catalog": { "graphSha": "<schemagraph graph.json sha256>", "source": "server/migrations" },
      "documents": ["server/server.http.json", "server/server.persistence.json", "server/db.sql.json"],
      "analyses": [
        { "id": "server-forward", "platform": "js", "role": "forward", "path": "server/server-forward.json" },
        { "id": "server-reverse", "platform": "js", "role": "reverse", "path": "server/server-reverse.json" },
        { "id": "server-db", "platform": "sql", "role": "db-dependents", "path": "server/db-dependents.json" }
      ] },
    { "name": "server-spec", "project": "/work/example-server", "revision": "srv-7f3c2a1",
      "documents": ["server/api.openapi.json"] },
    { "name": "client", "project": "/work/example-client", "revision": "cli-41d9e0b",
      "documents": ["client/android.http.json", "client/ios.http.json"],
      "analyses": [
        { "id": "android-reverse", "platform": "kotlin", "role": "reverse", "path": "client/android-reverse.json" },
        { "id": "ios-reverse", "platform": "swift", "role": "reverse", "path": "client/ios-reverse.change-impact.json",
          "precomputed": { "sha256": "<artifact sha256>", "revision": "cli-41d9e0b", "generatedAt": "2026-09-26T21:00:00Z" } }
      ] }
  ],
  "links": [
    { "name": "mobile->api", "client": "client", "server": "server",
      "match": { "hosts": ["api.example.com"], "services": ["example-api"], "baseRefs": [{ "ref": "kt:NetworkModule.baseUrl" }] },
      "contract": { "member": "server-spec", "documents": ["server/api.openapi.json"], "authoritative": true } }
  ],
  "selection": { "routes": [{ "method": "GET", "template": "/api/orders/{}" }] }
}
```

전체 합성 예제는 `fixtures/trace-workspace/`(서버 저장소 `server/`, 클라이언트 저장소 `client/`)에 있다.

- **형식 결정 — v1 추가 필드.** `members`·`links`는 단일 project 필드(`project`·`revision`·`documents`·
  `analyses`)와 **서로 배타적인** 추가 필드다. 섞으면 원인 문구와 함께 거부한다. v2를 만들지 않은 이유: 옛
  isthmus는 모르는 context 필드를 거부하므로 workspace context를 단일 project로 조용히 오독할 수 없고(버전을
  올려 얻는 성질을 이미 가진다), 단일 project context와 그 출력은 바이트 단위로 그대로라 옮길 것이 없다.
  단일 project를 workspace로 옮기려면 `project`·`revision`·`documents`·`analyses`를 member 하나로 옮기고
  link를 선언한다.
- **모양 재사용.** member·link는 [GRAPH-EXCHANGE의 `isthmus-workspace` 초안](GRAPH-EXCHANGE.md#다중-저장소-workspace-매니페스트-예외)을
  그대로 쓰고 member에 `analyses`를 더했다. link 이름이 route scope(진단 신원의 `scope`)가 된다.
- **member**: `name`(유일), `project`, `revision`(필수 — member 사이에는 context revision이 없으므로 분석 신선도를
  member마다 검사하려면 있어야 한다), `documents`(1개 이상), `analyses`(선택), `catalog`(선택, `graphSha`·
  `source`). member는 1~64개, 문서·분석 경로는 workspace 전체에서 유일하고 합계 256개 이하, 분석 id도 전체에서
  유일하다. 두 member가 같은 project를 공유할 수 있다(예: 같은 서버 저장소의 스펙만 담은 member, 릴리스 태그
  worktree의 구버전 클라이언트). 각 문서의 `project`는 자기 member의 `project`와 같아야 하고(아니면 종료 코드 2),
  분석의 `project`도 member와 같아야 한다.
- **link**: `name`(유일), `client`·`server`(member 이름), `match`(필수), `contract`(선택). link는 0~256개다.
  - `match`는 `hosts`(route-call `authority`와 같은 소문자 `host[:port]` 문법), `services`(유효 service),
    `baseRefs: [{ref}]` 중 하나 이상에 항목이 있어야 한다. 호출은 하나라도 맞으면 그 link에 귀속되고, 아니면
    개수만 센다(`unattributed-calls-omitted`). host 휴리스틱은 쓰지 않는다. 초안의 `interfaces`와
    `baseRefs[].pathPrefix`(declared-base 승격)는 아직 구현하지 않아 **거부**한다(조용히 무시하지 않는다).
  - 선언 측은 server member의 http 문서, 호출 측은 client member의 http 문서다(문서 신원으로 정한다). link 하나가
    scope 하나다.
  - **서비스 범위**: `match.services`가 있으면 선언 측 선언 중 그 서비스(유효 service)의 것만 잇고, 다른 서비스로
    확정된 호출은 host·baseRef가 맞아도 귀속하지 않는다(service 없는 호출은 host·baseRef로 귀속될 수 있다). 선언 측이
    서비스를 하나도 밝히지 않았으면(단일 서비스) 이름 없는 선언도 잇고, 이름 있는 선언과 섞인 이름 없는 선언은 빼고
    `link-service-ambiguous`를 남긴다. `match.services`가 없는데 선언 측 서비스 신원(이름 없음 포함)이 둘 이상이면
    다른 서비스의 선언에 조용히 잇지 않도록 선언을 하나도 잇지 않고 `link-service-ambiguous`를 남긴다.
  - `contract: {member, documents, authoritative?}`: `documents`는 그 member의 문서 중 openapi 문서다(아니면
    종료 코드 2). contract가 있으면 server member의 openapi 문서는 그 link에서 빼고 계약 끝점은 contract
    member에서만 온다. contract가 없으면 server member의 openapi 문서가 계약이다. `authoritative`는 되싣기만
    하고 trace 판정에는 쓰지 않는다(check용 선언).
- **조인 경계**: persistence 조인과 언어 순회(분석)는 member 안에서만 잇는다 — 클라이언트 로컬 DB와 서버 DB가
  섞이지 않는다. http는 link에 선언된 쌍에서만 잇는다. 체인 키는 `[member, platform, id]`다. 그래서 호출부의
  클라이언트 영향은 client member의 역방향 분석에서만, 핸들러의 정방향 도달과 DB 의존자는 server member의
  분석에서만 찾는다.
- **revision 검사**: 분석 revision을 그 member의 `revision`과 비교한다. 다르면 `stale-analysis`, 분석에 없으면
  `analysis-revision-unknown`이다. member 사이에서는 비교하지 않는다(저장소가 다르면 revision도 다르다). 같은
  member·플랫폼 분석의 `graphRevision`이 다르면 `stale-analysis`다. member `catalog.graphSha`가 있으면 그
  member의 sql 분석은 소스 revision 대신 `graphRevision`을 그 값과 비교한다(다르면 `stale-analysis`, 없으면
  `analysis-revision-unknown`). 새 코드(`analysis-revision-mismatch`)를 만들지 않은 이유: 뜻이 `stale-analysis`와
  같고, 기존 소비자가 쓰는 코드를 둘로 나누지 않기 위해서다. 출력 gap의 `member`가 어느 기준과 비교했는지 밝힌다.
- **선택**: `routes`의 `scope`는 link 이름이다(생략하면 모든 link). persistence가 member 밖으로 나가지 않으므로
  `relations: [{member, name}]`, `symbols: [{member, platform, usr}]`, `files: [{member, path}]`처럼 member를
  밝혀야 한다. 단일 project context는 member를 받지 않는다.
- bridge-facts 문서에는 revision 필드가 없어 문서의 신선도는 검사하지 못한다. link 조인의 문서 `generatedAt`이
  하루 넘게 벌어지면 조인 한계 `input-freshness`(link 출처)로만 보인다.

### 사전 계산 분석

`analyses[].precomputed: {sha256, revision, generatedAt?}`는 다른 곳(예: iOS 분석을 돌리는 클라이언트 macOS
CI)에서 미리 계산해 내려받은 artifact를 받는다. 단일 project·workspace 모두 쓸 수 있다.

- `sha256`(소문자 hex 64자)은 artifact 파일 바이트의 SHA-256이다. CLI가 읽은 내용과 대조하고 다르면 부분 결과
  없이 종료 코드 2다(다른 빌드의 artifact이거나 내려받다 깨졌다). sha256 없는 증언은 파일과 묶이지 않으므로
  받지 않는다.
- `revision`은 artifact를 만든 쪽이 증언한 소스 revision이다. 분석 문서가 revision을 싣지 않는 옛 형식
  (`change-impact` v1 등)이면 이 증언으로 revision을 비교하고 출력 분석 요약에 `revisionSource: "attested"`를
  단다. 증언은 생산자 신고가 아니므로 **보수적으로** 기준과 같아도 `analysis-revision-unknown`(문구: context가
  증언했고 CLI가 sha256을 대조함)을 남기고, 기준과 다르면 `stale-analysis`다. 그래서 옛 형식 artifact를 쓴
  trace는 `--strict`에서 1이다 — 생산자가 revision을 싣는 `language-traversal` v1 artifact를 쓰면 gap이 없다.
  문서가 revision을 싣는데 증언과 다르면 입력 오류(종료 코드 2)다.
- `generatedAt`은 정보용으로 분석 요약에 되싣는다.
- 옛 cartograph `change-impact`는 절대 경로 위치를 project 기준으로 되돌린다. CI checkout 경로가 member
  `project`와 다르면 위치가 빠지고 `cartograph-location-outside-project:` 분석 한계가 남는다.

### 파일 선택

파일 선택은 **파일 단위 과대 근사**다. 바뀐 줄을 모르므로 파일에 놓인 모든 심볼을 바뀐 것으로 본다.

- 심볼: 그 member(단일 project면 전체)의 언어 분석(sql 제외)이 이 파일에 위치시킨 root·도달 심볼과, 이 파일에
  위치한 bridge 사실(route-decl·route-call·relation-use, sql·openapi 제외)의 `symbol.usr`(**사실 위치
  fallback**)다. 이 심볼들로 심볼 선택과 같은 역방향 체인을 만든다. 핸들러가 파일에 있으면 그 route도 잇는다.
- 파일에 놓인 relation-use는 hop(도달 근거 없음)과 VertexId 의존자로 싣는다. dynamic 사용은 hop이 아니라 gap이다.
- 무엇이든 찾으면 항상 **알림** `file-selection-coarse`를 남긴다(아래 [gap과 알림](#gap과-알림)). 과대 근사는 영향을
  숨기지 않으므로 `--strict`를 실패시키지 않는다.
- 분석이 이 파일에 심볼을 하나도 두지 않아 사실 위치로만 대신했으면 gap `file-selection-fact-fallback`을 남긴다.
  이쪽은 사실 없는 심볼이 빠져 **영향을 숨길 수 있으므로** 알림이 아니라 gap이다. 아무것도 찾지 못하면 체인 없이
  gap `file-without-symbols`다.
- 클라이언트 파일을 고르면 그 심볼에서 서버 핸들러에 닿지 않으므로 `non-http-entry`가 남는다. 파일 선택은 서버
  변경 영향용이며, 클라이언트 내부 영향은 호출부의 `affected`로 본다.

## 출력: `isthmus-trace` v1

모든 출력은 알림 목록 `notices`와 `summary.notices`를 싣는다([gap과 알림](#gap과-알림)). workspace 출력은 아래
모양에 다음을 더한다(단일 project 출력의 나머지 필드는 그대로다): 최상위 `project`·`revision` 대신
`workspace: {members: [{name, project, revision, catalog?}], links: [{name, client, server, match, contract?:
{member, authoritative?}}]}`(문서 경로는 싣지 않는다), 모든 끝점(`declarations`·`contracts`·`calls[].call`·`use`·
`decls`)과 `handlers[]`·`database[]`·`affected[]`·gap의 `member`, 분석 요약의 `member`, 조인 한계의 출처
(`member` 또는 `link`). 사전 계산 분석 요약은 `precomputed`와(증언 revision을 썼으면) `revisionSource: "attested"`를
싣는다. 파일 선택 체인의 selector는 `{file, member?}`, workspace relation 선택은 `{relation, member}`다.

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
                       "depth": 1, "path": ["kt:UsersApi.get", "kt:UsersRepository.load"], "evidence": "unassessed" }] }] }],
    "handlers": [{ "platform": "js", "usr": "ts:api/users.get", "qualifiedName": "users.get",
                   "routes": [{ "scope": "default", "method": "GET", "template": "/api/users/{}" }], "reachedFrom": [] }],
    "relationUses": [{ "use": { /* relation-use 끝점 */ }, "relation": "users",
      "resolved": { "relation": "main.users" }, "decls": [ /* relation-decl 끝점 */ ],
      "reachedFrom": [{ "from": "ts:api/users.get", "analysis": "server-forward", "depth": 2, "evidence": "bound",
                        "path": ["ts:api/users.get", "ts:service/users.load", "ts:repo/users.findById"] }] }],
    "database": [{ "vertex": "main.users", "dependents": [{ "platform": "sql", "usr": "main.active_users",
      "kind": "view", "analysis": "db", "depth": 1, "path": ["main.users", "main.active_users"], "evidence": "direct" }] }]
  }],
  "gaps": [],
  "notices": [],
  "limitations": [ /* 조인 한계(check와 같은 모양) */ ],
  "analysisLimitations": [{ "analysis": "…", "message": "…" }],
  "analyses": [{ "id": "db", "platform": "sql", "role": "db-dependents", "source": "language-traversal",
                 "direction": "dependents", "tool": { "…": "…" }, "revision": "rev-1", "graphRevision": "catalog-1",
                 "truncated": false, "rootsTruncated": false, "rootProvenance": "complete",
                 "evidenceReported": false, "unresolvedCallsReported": false, "roots": 2, "reached": 2 }],
  "summary": { "chains": 1, "routes": 1, "handlers": 1, "relationUses": 2, "databaseVertices": 2,
               "databaseDependents": 3, "calls": 1, "clientSymbols": 2, "gaps": 0, "notices": 0,
               "evidence": { "direct": 3, "bound": 2, "candidate": 0, "unassessed": 2 } }
}
```

- 끝점(`declarations`·`calls[].call`·`use`·`decls`)은 `check --pairs`와 같은 투영(platform·
  location·symbol·route)이다. 모든 id는 생산자가 준 문자열이다. 체인 키는 `[platform, id]`이며
  다른 생산자의 id를 섞지 않는다.
- `path`·`depth`는 생산자의 via 목격을 따른다. 목격 경로가 이 hop의 시작 root가 아닌 다른 root에서
  시작하면 `witnessRoot`를 싣는다 — 그때 depth·path는 그 root 기준이고, 시작 root에서의 거리는 depth
  이상이라는 것만 안다(경로를 지어내지 않는다). 같은 정점에 근거가 여럿이면 더 강한 근거 등급(direct,
  bound, candidate, unassessed 순), 시작 root 자신의 경로, depth, 분석 id 순으로 하나만 싣는다 — 한 분석이라도
  더 강한 근거로 닿으면 그 hop은 약한 근거에만 기대지 않기 때문이다.
- root 항목의 via 목격이 그 root 자신으로 돌아오면(순환) 돌아오기 직전까지의 경로만 싣고
  `witnessPartial: true`를 단다(`witnessRoot`는 싣지 않는다). depth는 생산자 값을 그대로 쓴다.
- 순회에서 다른 root에서 닿은 root 항목도 도달 정점으로 쓴다. 그래서 테이블 A의 DB 의존자에는 B가
  함께 root로 주어졌어도 B가 실린다. B 너머의 정점은 B에서 시작하는 목격 경로와 `witnessRoot: B`를 싣는다.
- **근거 등급**: 모든 도달 근거(`relationUses[].reachedFrom`·`handlers[].reachedFrom`·`calls[].affected`·
  `database[].dependents`)는 `evidence`를 싣는다. 값은 도달한 정점의 등급(`direct`·`bound`·`candidate`)이며,
  생산자 정의상 그 정점에 닿는 root마다 성립하는 하한이라 목격 경로에서 가장 약한 등급과 같다. 시작점 자신
  (depth 0)은 `direct`다. 생산자가 등급을 분류하지 않은 언어 분석은 `unassessed`, 분류하지 않은 sql 분석은
  `direct`다([필드가 없을 때](LANGUAGE-TRAVERSAL.md#필드가-없을-때-문서-수준-규칙)). `candidate` hop은 빼지 않고
  싣되 `candidate-dispatch` gap을 남긴다. `bound`는 품질 표시일 뿐 gap이 아니다. `summary.evidence`는 이 도달
  근거들의 등급별 수다. `analyses[]`는 `dispatch`(있으면), `evidenceReported`, `unresolvedCallsReported`를 싣는다.
- **완전성 신호**: route 선택에서 핸들러를 root로 한 정방향 분석마다, 핸들러 root나 그 핸들러에서 닿은 정점
  (`roots`에 핸들러 인덱스가 있는 도달 정점)에 `unresolvedCalls`가 있으면 `reach-possibly-incomplete`를
  남긴다 — 문구에 합계, 정점 수, 예시 id 5개(핸들러 먼저, 그다음 문서 순서)를 싣는다. 분석이 잇지 못한
  호출을 아예 신고하지 않으면 0인지 모르므로 `reach-completeness-unknown`을 남긴다. 역방향·DB 분석의
  `unresolvedCalls`는 특정 hop에 귀속할 수 없어 이 gap을 만들지 않는다.
- **의도한 보수 규칙**: 같은 핸들러를 root로 한 정방향 분석이 여럿이면 분석마다 따로 판정한다. 한 분석이
  잇지 못한 호출을 신고하고 이 핸들러에서 닿는 곳에 하나도 없어도, 신고하지 않는 다른 분석이 있으면 그 분석의
  `reach-completeness-unknown`은 그대로 남고 `--strict`는 1이다. 합친 relation-use hop은 신고하지 않는 분석에서만
  올 수 있고(생산자·버전이 달라 도달 집합이 다를 수 있다), 신고하는 분석의 "0"은 그 분석이 본 그래프에 대한
  말일 뿐 다른 분석의 정점·간선을 보증하지 않기 때문이다. 이 gap을 없애려면 신고하지 않는 분석을 context에서
  빼거나 그 생산자가 신고하게 한다.
- `summary.evidence.direct`가 0보다 크다고 생산자가 direct 등급을 선언했다는 뜻은 아니다. 시작점 자신(depth 0)의
  도달(예: 핸들러가 직접 감싼 relation-use)은 간선이 없어 분석과 무관하게 `direct`로 세기 때문이다. 생산자의
  신고 여부는 `analyses[].evidenceReported`로 본다.
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
| `handler-without-symbol` | route-decl에 `symbol.usr`가 없다 |
| `route-contract-only` | route가 contract로만 선언돼 따라갈 핸들러가 없다 |
| `relation-use-without-symbol` | relation-use에 `symbol.usr`가 없다(route 선택은 플랫폼별 개수, relation 선택은 사실별 증거) |
| `relation-decl-without-symbol` | relation-decl에 VertexId(`symbol.usr`)가 없다 |
| `call-without-symbol` | 귀속된 route-call에 `symbol.usr`가 없다 |
| `analysis-missing` | 필요한 역할·플랫폼·root id의 분석이 없다(`symbol`에 찾은 id) |
| `analysis-truncated` | 분석이 잘렸거나(`truncationReasons` 포함), root 귀속 64개 상한 때문에 이 root의 도달이 빠졌을 수 있다 |
| `witness-partial` | root 항목의 via 목격이 그 root로 돌아와(순환) 다른 root에서의 경로를 알 수 없다. depth는 유효하다 |
| `roots-provenance-partial` | 옛 형식의 다중 root 분석이라 root 출처를 대표 root 하나로만 안다 |
| `candidate-dispatch` | hop이 가능성만 있는 구현 간선(`candidate`)으로만 뒷받침된다. hop은 그대로 싣는다. relation-use(`evidence`에 사용 사실, `symbol`에 핸들러)·핸들러 도달은 hop마다, 클라이언트·DB 영향 목록은 시작 심볼·분석별 개수와 예시 5개로 묶는다 |
| `reach-possibly-incomplete` | 핸들러나 그 핸들러에서 닿은 정점에 생산자가 잇지 못한 호출이 있어 그 너머의 relation-use가 빠졌을 수 있다(합계·정점 수·예시 id) |
| `reach-completeness-unknown` | 핸들러의 정방향 분석이 잇지 못한 호출을 신고하지 않아 도달이 끊겼는지 알 수 없다(분석·체인별 하나) |
| `stale-analysis` | 분석 revision이 context(workspace면 member)나 다른 분석과 다르거나, 같은 플랫폼(workspace면 같은 member·플랫폼) 분석의 graphRevision이 다르거나, sql 분석 graphRevision이 member `catalog.graphSha`와 다르다 |
| `analysis-revision-unknown` | context(workspace면 member)가 revision을 선언했는데(또는 context에 없고 다른 분석에는 있는데) 이 분석에 revision이 없다. member `catalog.graphSha`가 있는데 sql 분석에 graphRevision이 없어도 같다 |
| `non-http-entry` | 역방향 순회가 어느 route-decl 핸들러에도 닿지 않았다(스케줄·큐·CLI 진입점이거나 순회 불완전) |
| `unattributed-calls-omitted` | 이 scope를 불렀을 수 있는 귀속되지 않은 호출 수. 경로·host는 싣지 않는다 |
| `dynamic-route-calls` | 이 scope에 귀속됐지만 템플릿이 리터럴이 아니라 매칭하지 못한 호출 수 |
| `ambiguous-route-call` | 이 route와 다른 선언 사이에서 모호한 귀속 호출(따라가지 않음) |
| `test-source-omitted` | 체인에서 뺀 테스트 소스 route 사실 수 |
| `http-clients-unscanned` | 이 scope에 닿을 수 있는 client roles 문서가 없다 |
| `http-server-unscanned` | 역방향 선택인데 route-decl을 스캔한 server 문서가 없다 |
| `persistence-unscanned` | persistence 호출 측 문서나 sql 선언 문서가 없다(workspace는 link server이거나 persistence 문서가 있는 member마다) |
| `relation-use-without-decl` | 닿은 relation-use가 선언과 조인되지 않았다 |
| `column-use-without-decl` | 관계는 해석됐지만 컬럼 사용에 맞는 컬럼 선언이 없다 |
| `relation-use-ambiguous` | 비한정 relation-use가 여러 선언 후보와 맞는다 |
| `dynamic-relation-use` | relation-use의 이름이 리터럴이 아니다(원문은 증거로만). route 선택은 닿은 것만, relation 선택은 어느 relation을 가리키는지 모르므로 문서의 모든 dynamic 사용을 싣는다 |
| `relation-selection-ambiguous` | 선택한 relation 이름이 여러 선언과 맞는다 |
| `relation-without-decl` | 선택한 relation의 선언이 없다 |
| `relation-without-use` | 선택한 relation의 리터럴 사용이 관찰되지 않았다(없다는 증거가 아님). dynamic 사용이 있으면 문구에 그 수를 싣는다 |
| `file-selection-coarse` | **알림(notice)**. 파일 선택은 파일 단위 과대 근사다 — 파일에 놓인 모든 심볼을 바뀐 것으로 본다. `notices`에 실리고 `--strict`를 실패시키지 않는다 |
| `file-selection-fact-fallback` | 분석이 선택한 파일에 심볼을 두지 않아 사실 위치로만 대신했다. 사실 없는 심볼은 빠졌을 수 있다 |
| `file-without-symbols` | 선택한 파일에 놓인 분석 심볼·사실이 없다(없다는 증거가 아님). 체인을 만들지 않는다 |
| `link-service-ambiguous` | link의 선언 측이 여러 서비스를 내는데 `match.services`가 좁히지 않아 선언을 하나도 잇지 않았거나, 좁혔지만 service 없는 선언이 섞여 그 선언을 뺐다(`link`·`member`) |
| `http-member-unlinked` | workspace member의 http 문서가 해당 역할(client 또는 server·contract)의 link에 속하지 않아 잇지 않았다 |

### gap과 알림

gap은 과소 보고일 수 있는 공백(따라가지 못한 hop, 빠진 입력, 증명하지 못한 신선도)이고, **알림(notice)**은 영향을
숨길 수 없고 과대 보고만 할 수 있는 표시다. 알림 등급 코드는 지금 `file-selection-coarse` 하나다
(`TRACE_NOTICE_CODES`). 알림은 같은 모양으로 최상위 `notices`에 싣고 `summary.notices`로 세며, `gaps`·
`summary.gaps`·`--strict` 실패에는 들지 않는다. 새 코드를 알림으로 두려면 "과대 보고만 가능"을 문서로 보여야 한다.

gap은 `selector`(체인)·`member`(workspace)·`route`·`symbol`·`analysis`·`evidence` 중 해당하는 필드를 싣는다.
모든 코드의 음성 fixture는 `src/report/trace-workspace.test.ts`가 이 표와 대조한다. 귀속되지 않은
호출은 어떤 gap에도 경로·host·심볼을 싣지 않고 개수만 싣는다.

## 종료 코드

`0` 보고서 생성, `1` `--strict`이고 gap이 하나 이상(보고서는 stdout에 그대로), `2` 입력·계약·읽기
오류(원인과 입력 순번만, 원문·경로 없음, stdout은 비움), `64` 사용 오류.

- `--strict` 없이는 gap이 있어도 0이다. gap은 보고서의 `gaps`로만 읽는다.
- 알림(`notices`)만 있으면 `--strict`에서도 0이다. 예: 분석이 파일의 심볼을 모두 위치시키는 파일 선택.
- 사전 계산 artifact의 sha256 불일치, 증언과 다른 문서 revision, member project와 다른 문서·분석, 구현하지 않은
  link match 필드는 gap이 아니라 2다(입력이 선언과 다르다).
- 이 의미는 `src/cli/trace-command.test.ts`가 실제 CLI 프로세스로 고정한다.

## 현재 범위와 남은 일

- 구현: 단일 project, workspace(member·link·catalog·사전 계산 분석), routes·relations·symbols·files 선택.
- **형제 전파 opt-in은 보류**한다. 계획은 이름만 적고(`형제 전파 opt-in`) 무엇을 형제로 볼지(같은 핸들러의 다른
  route, 같은 테이블의 다른 컬럼, 같은 인터페이스의 다른 구현 등)와 전파 범위를 정의하지 않는다. 정의 없이 넣으면
  과대 근사의 크기를 소비자가 가늠할 수 없으므로 계획이 정의할 때까지 넣지 않는다.
- 남은 일: http diff(surface·workspace·base..head CI 모드), link match의 `interfaces`와 `baseRefs[].pathPrefix`
  (declared-base), check·query의 workspace 매니페스트 수용(지금은 여전히 입력 오류), MCP 노출(출력 상한과 함께 결정).
- 입력 수집 스크립트(`scripts/capture-trace.mjs`)는 아직 없다. 생산자 명령을 차례로 실행하고 context를
  손으로 쓴다. 합성 예제는 `fixtures/trace/`(단일 project)와 `fixtures/trace-workspace/`(분리된 두 저장소)에
  있다(실제 앱 입력으로 쓸 수 없다).
- 생산자 쪽: TS 생산자의 route-decl·relation-use usr와 `reach`/impact의 language-traversal 출력,
  schemagraph impact의 language-traversal 출력은 각 저장소에서 진행 중이다. 옛 schemagraph-impact v1은
  어댑터로 받는다.
