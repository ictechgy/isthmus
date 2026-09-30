# 조직 경계 http 표면 (`isthmus-http-surface` v1)

_기록: 2026-09-30 · 상태: 개발 중(Phase 7 — 조직 경계) · [API 변경 영향 계획](API-IMPACT-PLAN.md)_

```bash
# 서버 조직(게시자): 서버·스펙 문서에서 surface를 만든다
isthmus surface export --name example-api --revision v2.4 server.http.json api.openapi.json > example-api-2.4.surface.json
isthmus surface export --workspace server.workspace.json --member api > example-api-2.4.surface.json

# 클라이언트 조직(소비자): surface를 link의 server·contract로 가져온다
isthmus trace trace-context.json            # member {name, surface: {path, sha256}}
isthmus diff --http --before base.workspace.json --after head.workspace.json
isthmus diff --http --before example-api-2.3.surface.json --after example-api-2.4.surface.json --clients android.http.json
```

서버 팀과 클라이언트 팀이 다른 조직에 있으면 한 [workspace 매니페스트](GRAPH-EXCHANGE.md#다중-저장소-workspace-매니페스트-예외)가
두 저장소를 함께 가리킬 수 없다. 서버 쪽은 선언 측 사실만 담은 **자기 완결 artifact**를 릴리스마다 게시하고, 클라이언트
쪽은 그것을 파일 sha256으로 고정해 trace·`diff --http`의 server·contract member로 쓴다. 조인·귀속·매칭 규칙은
[GRAPH-EXCHANGE의 http 절](GRAPH-EXCHANGE.md#개발-중-http-경계-v1-확장)을 그대로 쓴다 — surface는 새 매칭 규칙을 만들지 않고
선언 측 입력의 **운반 형식**만 정한다.

## 설계 결정

- **선언 측 bridge-facts의 부분집합.** surface 문서는 bridge-facts http 문서에서 `format`·`version`·`project`·
  `sourceModifiedAt`을 빼고, 사실에서 위치·심볼 이름·호출 사실·테스트 소스를 뺀 모양이다. 가져오는 쪽은 surface 문서를
  (임시 위치·핸들러 토큰을 붙인) bridge-facts 문서로 만들어 **같은 파서**로 검증한 뒤 임시 값을 떼어 낸다. 그래서 route
  문법·kind·method·앵커·경로 제약·`dispatch`·`order`·catch-all 접두사·limitation 스코프 규칙이 한 벌이다.
- **가져오는 쪽 판정에 필요한 것만 싣는다.** 귀속(유효 service)·매칭(템플릿·method·앵커·끝 슬래시·대소문자·경로 제약·
  catch-all·등록 순서)·error 전제(선언 측 스캔 문서 수·서버·계약 측 공백 한계와 스코프·dynamic 선언 수·`sourceSets`)에 쓰이는
  필드만 남긴다. 그 밖(핸들러가 어디에 있고 무엇을 부르는지)은 서버 내부다.
- **핸들러 너머는 불투명(`continuation: "opaque"`).** v1은 정방향 도달·DB 의존자 같은 사전 계산 분석을 surface에 싣지
  않는다. 그런 분석은 내부 심볼 id·테이블·컬럼 이름을 전부 드러내 비공개 원칙이 무너지고, 소비자는 그 id를 다른 입력과
  대조할 수단이 없다(게시자 그래프와 revision이 같은지 증명할 수 없다). trace는 surface의 route에서 멈추고
  `server-surface-opaque` gap으로 밝힌다. 필요하면 서버 조직이 자기 저장소에서 같은 route로 trace를 돌린다 — usr 공개를
  고르면 gap이 핸들러 usr를 실어 그 작업의 입력이 된다. 다른 continuation 값은 v1에서 입력 오류다(나중 확장을 옛 소비자가
  조용히 오독하지 않게).
- **서명 없는 무결성.** `digest`는 `digest`를 뺀 문서의 정규 JSON(모든 깊이의 키 정렬, 공백 없음, UTF-8)의 SHA-256이다.
  서명이 아니다 — 누가 만들었는지는 증명하지 않고, 내보낸 뒤 손으로 고친 파일(digest를 다시 계산하지 않은 파일)을 거부한다.
  소비자는 매니페스트에 **파일 바이트의 sha256**을 고정한다(사전 계산 분석의 `precomputed.sha256`과 같은 규칙). 게시 경로의
  진위(누가 올렸는가)는 배포 채널(사내 artifact 저장소 권한, 릴리스 서명 등)이 맡는다.

## 형식

```jsonc
{
  "format": "isthmus-http-surface", "version": 1,
  "name": "example-api",                 // surface 신원. 릴리스가 바뀌어도 같다(diff는 이름이 같은 두 릴리스만 비교)
  "revision": "v2.4",                    // 게시자가 밝힌 릴리스·커밋
  "exporter": { "name": "isthmus", "version": "0.9.0" },
  "privacy": { "handlers": "opaque", "limitations": "prefix-only" },
  "continuation": "opaque",
  "documents": [{
    "platform": "js", "target": "http", "tool": { "name": "tsograph", "version": "…" }, "generatedAt": "…",
    "roles": ["server"], "dispatch": "specificity", "sourceSets": { "tests": "excluded" }, "service": "example-api",
    "facts": [
      { "kind": "route-decl", "method": "GET", "channel": "/api/orders/{}", "dynamic": false, "pathAnchor": "root",
        "paramConstraints": [{ "segment": 2, "kind": "int" }], "handler": "h3" },
      { "kind": "route-decl", "method": "GET", "channel": "/files", "dynamic": false, "pathAnchor": "root",
        "catchAllPrefix": true, "handler": "h1" }
    ],
    "limitations": ["route-coverage: detail withheld by the http surface publisher"],
    "limitationScopes": [{ "limitationIndex": 0, "templatePrefixes": ["/admin"] }]
  }, {
    "platform": "openapi", "target": "http", "roles": ["server"], "…": "…",
    "facts": [{ "kind": "route-contract", "method": "GET", "channel": "/api/orders/{}", "dynamic": false,
      "pathAnchor": "root", "operationId": "getOrder", "symbol": { "qualifiedName": "getOrder" } }]
  }],
  "digest": "<sha256 hex>"
}
```

- 최상위 키는 위 9개뿐이다. `name`·`revision`은 앞뒤 공백·제어 문자 없는 256자 이하 문자열이다. `documents`는 1~256개다.
- **문서**: 키는 `platform`·`target`·`tool`·`generatedAt`·`roles`·`dispatch`·`sourceSets`·`service`·`facts`·`limitations`·
  `limitationScopes`만. openapi가 아닌 문서는 target `http`와 roles 정확히 `["server"]`다(호출 측을 싣지 않는다). openapi
  문서는 bridge-facts 규칙 그대로다(사실 0건 스펙 문서는 target `null`, roles 없음). `sourceSets`가 있으면 `tests: "excluded"`다.
- **사실**: 키는 `kind`·`channel`·`method`·`dynamic`·`pathAnchor`·`service`·`trailingSlash`·`caseInsensitive`·`narrowed`·
  `paramConstraints`·`configDefault`·`catchAllPrefix`·`order`·`operationId`·`handler`·`symbol`만. 위치·`testSource`·
  `authority`·`baseRef` 같은 키는 입력 오류다. openapi가 아닌 문서는 `route-decl`만, openapi 문서는 `route-contract`만 담는다.
  - `dynamic: true`면 `channel`은 `null`이다(원문 식은 서버 소스 조각이다). 소비자는 dynamic 선언을 전과 같이
    `unjoined-dynamic-routes`로 세어 error 전제 (d)를 지킨다.
  - `handler`: 같은 핸들러의 decl끼리 같은 불투명 토큰(`h` + 양의 정수)이다. catch-all 접두사 decl과 원본 `{**}` decl을
    짝짓고, 서로 다른 핸들러의 같은 키 decl을 한 증거로 합치지 않기 위해서다. 핸들러 usr가 없던 decl에는 없다. 토큰은
    한 artifact 안에서만 뜻이 있다(릴리스마다 다시 매긴다).
  - `symbol`: decl은 `privacy.handlers: "usr"`일 때만 정확히 `{usr}`이고 `handler`와 1:1이어야 한다. contract는 스펙
    operationId인 `{qualifiedName}`만 올 수 있다.
  - `order.group`: 불투명 토큰(`g` + 양의 정수, 문서마다 매김)이다. 등록 순서는 같은 문서·같은 group 안에서만 비교하므로
    group 이름 없이도 뜻이 같다. 한 (group, index) = 한 등록 규칙은 게시자의 내보내기가 원본 위치로 검증한다(소비자는
    위치를 받지 않으므로 다시 검증할 수 없다).
- **한계**: 서버 측 공백 접두사(`route-coverage:` 등)와 계약 측 공백 접두사(`unresolved-contract-servers:`·`contract-coverage:`)의
  한계만 싣는다. `privacy.limitations: "prefix-only"`(기본)면 문구가 정확히 `<접두사> detail withheld by the http surface publisher`다.
  `"full"`이면 원문이다. 그 한계의 `limitationScopes`(서버 경로)는 그대로 싣는다.

### 내보내기(`isthmus surface export`)가 빼는 것

| 서버 문서의 값 | surface |
|---|---|
| 문서 `project`(절대 경로), `sourceModifiedAt` | 싣지 않는다 |
| 사실 `location`(핸들러·스펙 소스 경로) | 싣지 않는다 |
| 핸들러 `symbol.qualifiedName`·`usr` | 불투명 `handler` 토큰. `--include-handler-usrs`면 usr만 더한다(이름은 어떤 선택으로도 싣지 않는다) |
| `route-call` 사실(BFF가 부르는 다른 서비스) | 싣지 않는다. roles는 `["server"]`로 |
| 테스트 소스 사실(`testSource`) | 싣지 않는다. `sourceSets.tests`는 `"excluded"`로 |
| dynamic 선언의 원문 식 | `channel: null` |
| 생산 도구 이름·버전, 문서 `generatedAt`, `service`, `dispatch` | 싣는다 — 귀속(`service`)·매칭(`dispatch`)과 `diff --http` 인벤토리 비교(도구 이름)에 필요하다 |
| registration-order group 이름 | 불투명 `g` 토큰 |
| 한계 원문 | 서버·계약 측 공백 접두사만, 기본은 접두사 + 고정 문구(`--include-limitation-text`면 원문). 호출 측·체인 전용·모르는 접두사의 한계는 싣지 않는다 — 소비자 link 조인에서 서버 문서의 그런 한계는 판정에 쓰이지 않는다 |

- 입력은 한 project의 선언 측 http 문서(route-decl을 스캔한 서버 문서, 사실 0건 포함)와 openapi 문서다. 클라이언트 전용
  문서, persistence·sql·bridge 문서, `mixed-targets` 한계가 있는 문서는 원인 문구와 2로 거부한다. `--workspace`·`--member`는
  매니페스트의 문서 member 하나에서 선언 측 http 문서만 골라 쓰고(문서 project가 member project와 같아야 한다), `--name`·
  `--revision`의 기본값은 member 이름과 revision이다.
- 문서는 정규 JSON 순서로 정렬해 입력 순서와 무관하게 같은 바이트를 낸다. 만든 surface는 가져오는 쪽 파서로 다시 검증한다
  (계약을 어기는 artifact를 게시하기 전에 실패한다). 결과는 stdout이다.
- 핸들러 usr 공개는 게시자의 선택이다. usr가 파일 경로나 패키지 구조를 담는 생산자(tsograph 등)라면 공개가 곧 경로 공개다.
- 남는 약한 정보: `h`·`g` 토큰은 원래 usr·group 문자열의 정렬 순서로 매기므로 핸들러·router group의 **수**와 사전순 상대
  순서, 어떤 route들이 한 핸들러를 공유하는지가 드러난다. 경로·이름은 드러나지 않는다.

## 가져오기

surface는 매니페스트의 **surface member**로 가져온다. 문서 member가 들어갈 수 있는 자리(link `server`, link `contract.member`)
어디에나 쓸 수 있다.

```jsonc
"members": [
  { "name": "api", "surface": { "path": "vendor/example-api-2.4.surface.json", "sha256": "<파일 sha256>" } },
  { "name": "client", "project": "/work/example-client", "revision": "cli-3.2.0", "documents": ["android.http.json"] }
],
"links": [{ "name": "mobile->api", "client": "client", "server": "api", "match": { "hosts": ["api.example.com"] },
            "contract": { "member": "api", "authoritative": true } }]
```

- surface member는 `name`과 `surface: {path, sha256}`만 받는다. link `client`는 될 수 없다(surface에는 호출이 없다). project·revision·문서·분석·카탈로그는 게시한 조직의 것이라
  이쪽에서 선언하지 않는다(revision은 artifact가 싣는다). 경로는 매니페스트·context 디렉터리 기준이고, 같은 surface 경로를
  두 번 쓰거나 문서·분석 경로와 겹치면 입력 오류다.
- CLI는 파일을 읽어 고정한 sha256과 대조하고(다르면 부분 결과 없이 2 — 다른 릴리스이거나 받다가 깨졌다), digest와 계약을
  검증한다. 오류 문구는 경로 대신 `trace http surface 1`·`before http surface 1`처럼 순번만 싣는다.
- link `contract.member`가 surface member면 `documents`를 쓰지 않는다 — 그 surface의 openapi 문서 전체가 계약이다. surface에
  openapi 문서가 없으면 입력 오류다. contract가 없는 link는 기존 규칙대로 server member(surface)의 openapi 문서를 계약으로 쓴다.
- relation·symbol·file 선택과 `fileSymbols`는 surface member를 가리킬 수 없다(내부가 공개되지 않는다). library의 consumer·provider도
  문서 member만이다.
- 가져온 선언 끝점은 위치가 없고, 게시자가 usr를 공개했을 때만 `symbol`을 싣는다. 이름은 공개되지 않으므로 그때 `qualifiedName`도
  usr 값이다.

### trace

- surface가 선언한 route는 `server-surface-opaque` gap을 남긴다(`member`·`route`, usr를 공개했으면 `symbol`). 핸들러의 정방향
  도달·relation-use·DB hop이 없으므로 `handler-without-symbol`·`analysis-missing`(정방향)·`persistence-unscanned`를 그 member에
  더하지 않는다 — 이 gap 하나가 그 공백 전체를 밝힌다. usr를 공개한 surface는 그 핸들러를 `handlers[]`에 도달 근거 없이 싣는다.
- route → 귀속된 호출 → 클라이언트 영향은 그대로다. surface의 서버·계약 측 공백 한계(스코프 포함)는 조인 한계로 실린다.
- workspace 요약의 surface member는 `{name, surface: {name, revision, sha256, privacy}}`다(project·revision 없음).

### diff --http

- **workspace 모드**: base·head 매니페스트가 같은 surface member 이름에 서로 다른 릴리스를 고정한다. base에서는 link의
  server·contract인 surface만 읽고(문서와 같은 규칙), 읽지 않은 surface member는 요약에 고정한 sha256만 싣는다. link의 server·contract
  member는 두 시점 모두 surface여야 하고 artifact `name`이 같아야 한다(문서 member의 "같은 project" 규칙에 대응). 선언 측
  인벤토리(platform·도구 이름·테스트 소스 설정·dispatch)도 같아야 한다. 요약 member는 `surface: {name, revision, sha256}`다.
- **surface 모드**: `--before`·`--after`에 surface artifact를 하나씩 주면 그 선언 측 문서를 `--clients` 호출에 교차 평가한다.
  두 artifact의 `name`이 같아야 하고, 호출 측 문서끼리만 project가 같아야 한다(artifact에는 project가 없다). 귀속은 매니페스트
  없는 규칙(유효 service 일치·단일 서비스)이라 클라이언트 호출에 서버와 같은 service가 있어야 결합한다 — host로 귀속하려면
  workspace 모드를 쓴다. 출력에 `surface: {name, before: {revision, sha256}, after: {revision, sha256}}`(sha256은 CLI가 계산)와
  호출 측 project를 싣는다. 매니페스트가 없으므로 contract 측 깨짐은 항상 `-unverified`다.
- 두 시점의 종류(문서 목록·surface·매니페스트)가 섞이면 2다.

## 한계와 남은 일

- surface는 게시자의 신고다. 소비자는 digest·sha256으로 "그 게시물"인지만 확인하고, 게시자 서버가 실제로 그 route를 받는지는
  확인하지 않는다(bridge-facts 생산자 문서와 같은 신뢰 수준).
- 사전 계산 continuation(게시자가 정방향·DB 분석을 함께 싣고 revision 일치로 이어 가기)은 v1에 없다.
- check·query는 아직 workspace 매니페스트를 받지 않으므로 surface도 받지 않는다. capture 설정(`scripts/capture-trace.mjs`)도
  surface member·library를 아직 모른다(생성한 context에 손으로 더한다).
- 합성 예제는 `fixtures/http-surface/`(서버 조직 문서 두 릴리스, 내보낸 surface, 클라이언트 조직의 trace context와 diff
  매니페스트)에 있다.
