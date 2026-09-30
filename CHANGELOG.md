# Changelog

이 프로젝트의 주요 변경 사항을 기록한다.

## [Unreleased]

## [0.10.0] - 2026-09-30

호환 릴리스 세트: cartograph 0.23.0 · kartograph 0.18.0 · dartograph 0.16.0 · schemagraph 0.7.0 ·
gartograph 0.9.0 · rustograph 0.4.0.

0.9.0 이후 #104–#135를 담는다. bridge 전용이던 isthmus가 persistence(코드↔스키마 relation)와 http(route 선언↔호출↔
OpenAPI) 도메인을 받고, route·테이블에서 핸들러·DB 의존자·클라이언트 코드까지 잇는 `trace`와 API 변경의 클라이언트
영향을 보는 `diff --http`, 그리고 PR마다 그 결과를 보고하는 GitHub Action을 더한다. 먼저 아래 "동작 변경"을 읽는다.
그 아래 요약 뒤의 세부 절은 개발 중 기록한 그대로다(최근 PR이 위).

### 동작 변경 — 업그레이드 전에 확인할 것

0.9.0은 target `http`·`persistence`와 platform `go`·`rust`·`python`·`sql`·`openapi` 문서를 모두
`Unsupported bridge target.`/`Unsupported bridge platform.`(종료 코드 2)으로 거부했다. 0.10.0은 이 문서를
`check`·`query`·`trace`·`diff --http`·`surface export`에서 받고, 받지 않는 명령은 원인을 밝혀 거부한다. bridge 문서만
넣는 기존 입력의 대표 명령 출력과 종료 코드는 바이트 단위로 고정해 두었다(#115).

- **http 문서는 `graph`·`diff`·`impact`·`retentions`·preflight context에서 종료 코드 2**: target `http` 또는 platform
  `openapi` 문서를 빈 정상 결과로 읽지 않고 원인 문구와 함께 거부한다. bridge `diff`는 `isthmus diff --http`를 안내한다.
  http 비교는 `diff --http`, 영향 추적은 `trace`를 쓴다(#118, #122).
- **persistence 입력**(#109–#116):
  - `retentions --for kartograph|cartograph`: 같은 플랫폼의 persistence 문서만 수신 측으로 들어오면 빈 목록·종료 코드 0
    대신 종료 코드 2와 원인 문구다.
  - `diff`: persistence·sql 문서를 "persistence 비교를 아직 지원하지 않는다"는 원인 문구로 거부한다(2). preflight
    context도 persistence 문서를 원인 문구로 거부한다.
  - `impact`: 비한정 사용(`users`)이 닿는 한정 선언(`public.users`)의 `column-use-without-decl`을 조인과 같은 규칙으로
    귀속하고, 선택한 persistence 사실의 진단은 경고도 `--strict` blocker다 — `--strict` 결과가 1로 바뀔 수 있다.
  - `impact --runtime`: persistence 문서만 있는 native 플랫폼 주소의 `staticStatus`가 `unobserved` 대신
    `unsupported`다(두 값 모두 런타임 공백이라 `--strict` 종료 코드는 같다).
  - bridge 문서 판정은 한 규칙이다: target이 flutter·react-native·capacitor이거나 `target: null`이고 platform이
    dart·js·swift·kotlin인 문서만 bridge 문서다. 관계 사용이 0건인 kotlin·swift·dart persistence 문서(`target: null`)는
    bridge 문서로 세지며, 오류 문구가 그 원인을 밝힌다.
- **다른 target 문서의 route 필드는 입력 오류(2)**: http 전용 필드(경로 스코프, `dynamicScope`, `order` 등)가 bridge·
  persistence 문서에 실리면 거부한다. `channelPrefix`는 기존 계약 필드라 예외로 버린다.
- **`query` 이름 접두사**: `relation:<name>`·`route:[<METHOD> ]<template>`로 시작하는 이름이 관계·route 질의가 된다.
  같은 이름의 관계가 있으면 bridge 키보다 우선하므로 그 bridge 키는 qualifiedName으로 질의한다. `relation:`만 있는
  이름과 형식이 맞지 않는 `route:` 이름은 사용 오류(64)다.

### 요약 — 새 기능

- **GitHub Action**(#135, [CI](docs/CI.md)): 저장소 루트 composite Action을 `uses: ictechgy/isthmus@v0.10.0`(실제로는 그
  태그의 commit SHA)으로 쓴다. Action과 CLI가 같은 태그로 나가며, `action.yml`의 `isthmus-version` 기본값은 Action ref의
  `package.json` 버전이라 태그를 따른다(`@v0.10.0`이면 `isthmus-cli@0.10.0`). PR마다 base·head를 수집해 `diff --http`와
  바뀐 route의 `trace`를 돌리고 job summary·artifact·선택적 스티키 댓글로 남긴다. 렌더러 `scripts/render-pr-comment.mjs`는
  npm 패키지에 들어 있어 다른 CI에서도 쓴다.
- **persistence 도메인**(#108–#116): platform `go`·`rust`·`sql` 문서, 코드 `relation-use`↔스키마 `relation-decl` 조인,
  `check --pairs`(사용↔선언 쌍), `query relation:<name>`, [수동 왕복 추적](docs/PERSISTENCE-TRACE.md).
- **http 도메인**(#118, #126–#128, #131, #133): route 사실 검증과 세그먼트 매처·진단, `query route:`, http limitation
  스코프와 Spring PathPattern 벡터, platform `python`과 `registration-order` 디스패치, go·rust 서버 `route-decl`,
  python·go·rust 클라이언트 `route-call`과 결합 방식, dynamic 선언의 `dynamicScope`.
- **`trace`**(#119–#121, #123–#125, #130–#131, #133): route·relation·심볼·파일에서 핸들러 → 테이블 → DB 의존자, 호출부 →
  영향받는 클라이언트 코드를 생산자 id 정확 일치와 명시적 gap으로 잇는다. 입력은 생산자의 `language-traversal`
  문서다. 근거 등급, 다중 저장소 workspace, `files` 선택, `scripts/capture-trace.mjs`와 MCP `trace`, upstream route와
  `upstreamDepth` 전이 추적을 포함한다.
- **`diff --http`**(#122): 한 서버·스펙 또는 workspace의 base·head route 표면을 비교해 base에서 결합하던 호출이 head에서
  결합하지 않는 곳을 찾는다(`--fail-on`).
- **조직 경계**(#129–#130): `isthmus-http-surface` v1과 `surface export`, sha256으로 고정한 surface member, 공유 SDK
  `libraries`.
- **적합성 벡터**: http-template·url-compose·http-limitation-scope에 케이스를 더하고 http-dispatch suite를 새로 냈다.
  `SHA256SUMS`가 바뀌었지만 기존 케이스의 기대값은 그대로라 옛 벤더본도 통과한다(#134는 aiohttp 두 케이스의
  `versionRange`만 적었다).
- **검증 하네스**(#104–#107): RN build witness, iPhone release, RN 새 아키텍처 lifecycle 검사. 제품 동작 변화는 없다.
- **내부**(#132): preflight를 trace 공유 모듈 위로 수렴했다. 출력·종료 코드는 바이트 단위로 같다.

### Changed — 호환 세트와 cold-cache (릴리스 준비)

- `compatibility.json`과 [호환 버전](docs/COMPATIBILITY.md)·README의 producer 세트를 cartograph 0.23.0·kartograph
  0.18.0·dartograph 0.16.0으로 올리고 schemagraph 0.7.0·gartograph 0.9.0·rustograph 0.4.0 행을 더했다. tsograph와
  pythograph 행은 발행 뒤 저장소 manifest만 바꾸는 후속으로 더한다.
- cold-cache workflow가 cartograph를 `brew install` 대신 manifest 버전의 GitHub Release 아카이브로 받는다. tap에는 최신
  formula 하나뿐이라 버전을 고정할 수 없어 cartograph를 발행할 때마다 이 job이 깨졌다(2026-09-28부터 실패). formula의
  `url`이 같은 아카이브라 설치되는 실행 파일은 같다.
- cold-cache에 `api-producers` job을 더했다: schemagraph·gartograph·rustograph 발행 아카이브를 manifest 버전으로 받아
  발행 checksum과 `--version`을 대조한다(설치·버전만 — trace e2e는 아니다).


- **위치**([CI](docs/CI.md)): 저장소 루트 composite Action `action.yml`(`uses: ictechgy/isthmus@<tag>`). Action과 CLI가 같은
  태그·버전으로 나가고, `isthmus-version` 기본값이 Action ref의 버전이다(npm 설치는 정확한 버전·`--ignore-scripts`,
  시험용 `isthmus-path`).
- **흐름**: capture 설정(`isthmus-trace-capture` v1, head commit에서 읽음)으로 base·head를 **같은 checkout 경로**에서 차례로
  수집하거나 미리 만든 문서를 받아 `diff --http`(surface·workspace)를 돌리고, non-info finding의 route만 `trace`한다(기본 base
  capture — 모든 non-info route가 base에 있다). base commit 기본값은 PR 병합 commit의 첫째 부모다. 결과는 job summary·
  artifact(`diff.json`·`trace.json`·`meta.json`·`comment.md`)와 선택적 스티키 댓글로 남고 `fail-on`으로 job을 실패시킨다.
- **렌더러** `scripts/render-pr-comment.mjs`(npm 패키지 포함, CLI 하위 명령 아님 — 제품은 JSON만 쓴다): 불완전성 배너를
  맨 앞에, 끊기는 호출을 client `file:line`·심볼로, 바뀐 route의 핸들러·테이블·DB 의존자·클라이언트 코드를 싣는다. 빈
  결과를 안전으로 쓰지 않는다. 사실 문자열은 코드 스팬·HTML 엔티티로만 싣고 65,000자로 줄 단위로 자른다. 결정적 출력.
- **보안**: `pull_request_target` 없음, 분석 job `contents: read`·댓글 job만 `pull-requests: write`, 토큰은 댓글 단계에만,
  `run`에 식을 끼워 넣지 않음, 생산자 환경에서 `GITHUB_ENV` 등 파일 명령 경로·토큰 제거, 신뢰하지 않는 로그는
  `::stop-commands::`, `comment` 명령은 artifact JSON을 다시 렌더링(comment.md를 그대로 올리지 않음), artifact에서 온 PR
  번호는 PR head의 commit·저장소·브랜치 대조(workflow_run — head SHA만으로는 PR 신원이 아니다), bidi·폭 없는 문자 제거,
  서드파티 Action SHA 고정.
- **자체 시험** `.github/workflows/action-self-test.yml`: 합성 fixture로 미리 만든 문서(surface·workspace)와 합성 git 저장소의
  capture 모드를 job summary 모드로 돌린다(댓글은 저장소 변수로 opt-in). 로컬은 `npm run verify`의 세 스크립트 테스트.

### Fixed — aiohttp base 미상 벡터의 `versionRange`

- url-compose `base-join/aiohttp-unknown-base-relative`에 `>=3.11`(`/` 없는 상대 경로는 3.11부터),
  `base-join/aiohttp-unknown-base-rooted`에 `>=3.8`(`base_url` 도입)을 적었다. 기대값은 그대로이고 SHA256SUMS를 갱신했다.
- [HTTP-WRAPPERS](docs/HTTP-WRAPPERS.md#go-rust-python-클라이언트)에 `urllib.parse.urljoin`을 `rfc3986`으로 묶지 않는 이유(상대
  병합에서 빈 세그먼트를 지운다)를 적었다.

### Added — trace upstream route 전이 추적 `upstreamDepth` (Phase 8)

- **opt-in**([TRACE](docs/TRACE.md#전이-추적-upstreamdepth)): CLI `--upstream-depth <1..8>`, MCP `upstreamDepth`, context
  `upstreamDepth`(CLI 값 우선). 기본 1은 v1과 출력 바이트가 같다.
- **따라가기**: upstream route를 server로 잇는 link마다 그 route에 match된 호출 hop을 `callers: [{scope, calls}]`에 싣고, 그 호출
  hop이 다시 자기 upstream route를 싣는다. library consumer hop도 같다.
- **순환·상한**: (member, scope, method, template) 조상 집합으로 순환을 끊고 알림 `upstream-route-cycle`을 남긴다. 따라간 단계의
  호출 hop·`affected`는 체인마다 10,000행까지이고, 깊이·상한에 멈춘 곳은 기존 `upstream-route-callers-not-followed`(문구로 구분)다.
  순서는 깊이 우선·정렬 순서로 결정적이다.
- **요약·상한**: `summary.calls`·`clientSymbols`·`upstreamRoutes`·`evidence`가 따라간 호출 hop까지 세고, `--max-rows`가 `callers`
  아래 목록도 자른다.

### Added — python·go·rust 클라이언트 `route-call`과 결합 방식 (Phase 8)

- **계약**: platform `python`·`go`·`rust`의 http 문서가 `route-call`을 낼 수 있다(이전에는 입력 오류). 조인·귀속·심각도 규칙은
  다른 호출 측 플랫폼과 같다([GRAPH-EXCHANGE](docs/GRAPH-EXCHANGE.md#target과-kind)).
- **결합 방식**([HTTP-WRAPPERS](docs/HTTP-WRAPPERS.md#go-rust-python-클라이언트)): 공식 소스와 실행 기록으로 확인한 규칙을 이름으로
  적었다 — `rfc3986`(Go `ResolveReference`, Rust `Url::join`; base 리터럴이면 RFC 3986 해석 결과), `go-join-path`(Go 1.19+
  `url.JoinPath`), `resty-base-url`(go-resty v2·v3), `httpx-base-url`(httpx 0.28), `aiohttp-base-url`(aiohttp 3.11+, 버전 제약 포함).
  base 없는 net/http·reqwest·requests는 전체 URL 규칙을 쓴다. `http-wrappers` 선언의 `language`에 `go`·`rust`·`python`을 더했다.
- **벡터**: url-compose에 `compose.base-join` 39건(`producer:gartograph`·`producer:rustograph`·`producer:pythograph`)을 더하고
  SHA256SUMS를 갱신했다. 참조 구현은 `scripts/verify-conformance.mjs`에 있다.

### Added — dynamic 선언의 스코프 `dynamicScope` (Phase 8)

- **계약**([GRAPH-EXCHANGE](docs/GRAPH-EXCHANGE.md#dynamic-선언의-스코프-dynamicscope)): dynamic `route-decl`·`route-contract`가
  `dynamicScope: {templates?, templatePrefixes?, templateSuffixes?, methods?}`로 받을 수 있는 요청의 증명된 상한을 싣는다. 모양·원소
  문법·비교는 http limitation 스코프와 같고, `methods`는 `ANY` decl 전용, base 앵커는 `templateSuffixes`·`templatePrefixes: ["/"]`만
  받는다. 정적 사실·`route-call`·다른 target 사실에 실리면 입력 오류다. 스코프를 실은 선언은 자기 method로도 좁힌다.
- **소비자**: check error 전제 (d)·`-unverified`, `diff --http` `after-declaration-gap`이 호출마다 겹치는 dynamic 선언만 본다.
  trace는 선언 없는 route 선택에 겹칠 수 있는 dynamic 선언이 있으면 `route-dynamic-decls` gap을 더한다. `unjoined-dynamic-routes`
  문구는 스코프를 실은 선언 수를 끝에 더하고(없으면 이전 바이트), surface는 `dynamicScope`를 그대로 싣는다.
- **하위 호환**: `dynamicScope` 없는 dynamic 선언은 이전처럼 scope 전체의 공백이다.
- **벡터**: `http-limitation-scope`에 `scope.dynamic-validate` 17건·`scope.dynamic-applies` 14건을 더했다(SHA256SUMS 갱신 —
  이 파일을 벤더링한 생산자는 다시 벤더링한다).

### Changed — preflight를 trace 공유 모듈 위로 수렴 (Phase 7d, 내부 리팩터)

- 사용자에게 보이는 변화는 없다. `isthmus preflight`·`isthmus trace`의 입력 계약, JSON 출력 바이트, 종료 코드, stderr 문구가
  그대로다(녹화한 테스트 입력 12,145건·결정적 변이 합성 입력 32,786건의 함수 결과와 실제 프로세스 preflight 2,624건의
  stdout·stderr·종료 코드를 리팩터 전과 바이트 단위로 대조).
- preflight와 trace가 따로 갖던 부분을 공유 모듈로 옮겼다: 옛 역방향 영향 계약과 검증(`exchange/language-impact.ts`, depth
  128·관계 32 상한 한 곳), 영향·순회 파서의 JSON 검사(`exchange/json-guards.ts`), Kotlin·순회 부분 위치 규칙, 역방향
  continuation의 최단 경로 탐색(`breadth-first.ts`, kartograph 어댑터와 preflight 보고서), gap·limitation 신원과 결정적 나열
  (`report/sorted-json.ts`), context 파일 읽기(`cli/command-support.ts`). 기존 import 경로(`dist/exchange/preflight-context.js`의
  `PreflightValidationError`·`validateLanguageImpact`·`MAX_PREFLIGHT_*`)는 다시 내보내 유지한다.

### Added — capture 설정의 surface member와 library (`scripts/capture-trace.mjs`)

- **surface 가져오기**([TRACE capture](docs/TRACE.md#capture의-surface-member와-library)): member `{name, surface: {path, sha256}}`.
  사실 단계 뒤·순회 전에 파일 바이트 sha256을 고정 값과 대조하고(다르면 `surface:<member>` 단계 오류) digest·계약을 trace와 같은
  파서로 검증한 뒤 `<member>/http-surface.json`에 복사해 context surface member로 싣는다. manifest `members`에 출처·sha256·
  이름·revision·공개 수준을 남긴다.
- **surface 내보내기**: member `{name, surface: {export: {member, name?, revision?, includeHandlerUsrs?, includeLimitationText?}}}`.
  같은 capture의 문서 member가 모은 선언 측 http·openapi 문서로 `isthmus surface export`를 실행하고 공개 수준 플래그를 그대로
  넘긴다. 결과는 게시할 artifact이자 context surface member다.
- **libraries**: trace context와 같은 선언(`ids: "shared" | "symbol-map"`)을 받고 `publicSymbols`·`symbolMap`은 직접 쓰거나 root 아래
  JSON 파일로 준다(기존 경로 규칙). consumer 역방향 순회는 모든 순회 뒤로 미루고, provider route-call 심볼과 provider 역방향
  분석이 그 호출부에서 닿은 SDK 심볼을 선언대로 옮긴 id를 root로 더한다(`--roots-from` 등 분석 설정대로). context에
  `libraries`를 싣고, library consumer는 `documents: []`일 수 있다. `symbol-map`의 `publicSymbols`는 capture 전용 점검 값이다.
- **새 경고**: `library-no-roots`(consumer가 그 library에서 root를 하나도 받지 못함 → trace `library-ids-unmatched`),
  `library-map-entry-missing`(호출부에서 닿은 공개 SDK id가 대응표에 없음), `library-roots-undelivered`(옮긴 root를 받을 생산자
  명령 역방향 분석이 없음 → trace `library-continuation-unrooted`). manifest `libraries[]`에 platform별 후보·root·공개 API 밖 수를
  남긴다.
- surface member·library가 없는 설정의 실행 순서·context·manifest는 그대로다.

### Added — trace upstream route, root 단위 root-not-found, go·rust http, Spring 결합 (Phase 7 후속)

- **upstream route**([TRACE](docs/TRACE.md#upstream-route-호출-member-자신의-route)): 서비스 A가 B를 부르면서 자기 route도 가질 때,
  B route → A 호출의 역방향 도달이 A 자신의 route-decl 핸들러 usr와 정확히 같으면 호출 hop(과 library consumer hop)에
  `upstreamRoutes: [{method, template, member?, handler, depth, declarations, scopes}]`를 싣는다. 같은 member·platform 안의 정확한
  usr 일치만 쓴다. v1은 한 단계다 — route를 link가 server로 이으면 scope마다 **`upstream-route-callers-not-followed`**(그 route를
  선택해 이어 간다), 잇는 link가 없으면 **`route-decl-unlinked`**다. `summary.upstreamRoutes`를 더했다(항상 실리는 새 키).
- **link 없는 자기 route의 gap 정리**: 역방향 선택이 link 없는 자기 route 핸들러에 닿으면 `non-http-entry` 대신, scope 없는 route
  선택이 그런 route와 같으면 `route-without-decl` 대신 `route-decl-unlinked`다. 그래서 server 측 **`http-member-unlinked`**는
  체인이 따라갈 수 없는 선언(contract, usr 없는·dynamic route-decl)을 담은 문서만 센다(surface member는 이전처럼 모든 선언 문서).
  kartograph #124 e2e의 A(`orders-service`)처럼 핸들러 usr가 있는 route만 가진 member에는 member 단위 gap 대신 route 단위 gap이 남는다.
- **root-not-found는 root 단위**([TRACE](docs/TRACE.md#root-not-found는-root-단위)): 사유가 `root-not-found`뿐인 순회 문서는
  찾은 root의 hop에 `analysis-truncated`를 남기지 않는다. 못 찾은 root를 따라가야 하는 hop만 새 **`analysis-root-not-found`**
  (이전 `analysis-missing`)를 받는다. 다른 사유가 함께 있으면 그 사유만 `analysis-truncated`에 싣고, `symbol` 없는 root 없이
  root-not-found만 신고한 문서는 이전처럼 전체 잘림이다. library 공개 API를 root로 넘긴 분석이 `--strict`를 실패시키던 잡음이
  사라진다(#129의 열린 질문). LANGUAGE-TRAVERSAL에 root-not-found가 요청 root만의 사유라는 생산자 보장을 적었다.
- **platform `go`·`rust`의 http**([GRAPH-EXCHANGE](docs/GRAPH-EXCHANGE.md#gorust의-http-v1-확장)): target `http`와 서버
  `route-decl`(`specificity`·`registration-order`)을 받는다. 이전에는 `Go/Rust documents may only carry a null or persistence
  target.`(2)이었고 문구가 `… a null, persistence, or http target.`로 바뀌었다. `route-call`은 생산자와 url-compose 벡터가 생길
  때까지 입력 오류다. language-traversal·capture의 go·rust는 이미 받는다.
- **Spring 클라이언트 base 결합**([HTTP-WRAPPERS](docs/HTTP-WRAPPERS.md#base-결합)): `DefaultUriBuilderFactory`(연결 + 경로 전체
  `//` 축약, 점 세그먼트 유지, host 뒤 `/` 삽입), Boot `RestTemplateBuilder.rootUri`(`/` 접두 템플릿에만), `@HttpExchange` 타입·메서드
  url 결합을 표와 본문에 더하고 GRAPH-EXCHANGE의 "네 갈래"를 다섯 갈래로 고쳤다. url-compose 벡터 13개(`base-join/spring-*`,
  `producer:kartograph`, join `spring-uri-builder`·`spring-root-uri`·`spring-http-exchange`)를 더했다 — `url-compose.json` sha256이
  바뀌었다. **kartograph는 다시 벤더링하고 러너에 세 join을 더해야 한다.** cartograph·dartograph·tsograph·pythograph는 이 케이스를
  고르지 않으므로 코드 변경 없이 새 해시로 다시 벤더링만 하면 된다(옛 벤더본도 계속 통과한다).
- **합성 fixture**: `fixtures/trace-workspace/context-upstream.json`·`client/bff.http.json`(client member의 BFF route). CLI 계약이
  upstream route와 `route-decl-unlinked`의 `--strict` 1을 확인한다.

### Added — 조직 경계: http surface와 공유 SDK library (Phase 7a)

- **`isthmus-http-surface` v1**([HTTP-SURFACE](docs/HTTP-SURFACE.md)): 한 workspace 매니페스트로 묶을 수 없는 조직(서버·클라이언트
  저장소 권한이 다름)을 위한 자기 완결 서버 표면이다. 선언 측 bridge-facts의 부분집합이라 새 매칭 규칙이 없고, 가져오는 쪽이 같은
  파서로 검증한다. 내용 `digest`(digest를 뺀 정규 JSON의 SHA-256, 서명 아님)와 `revision`·`exporter`·`privacy`를 싣는다.
  `continuation`은 v1에서 `"opaque"`만 받는다(게시자의 정방향·DB 분석은 싣지 않는다).
- **`isthmus surface export`**: 서버·스펙 문서 목록 또는 `--workspace`·`--member`에서 surface를 만든다. 위치(핸들러 소스 경로)·
  핸들러 이름·문서 project·route-call(BFF가 부르는 서비스)·테스트 소스·dynamic 원문·router group 이름은 싣지 않는다. 핸들러는
  불투명 토큰(`h1`…)으로 묶고, `--include-handler-usrs`면 usr만 더한다. 한계는 서버·계약 측 공백 접두사만 싣고 기본은
  `<접두사> detail withheld by the http surface publisher`(`--include-limitation-text`면 원문)다. 만든 artifact는 가져오는 쪽
  파서로 다시 검증한다.
- **surface member**(`{name, surface: {path, sha256}}`): trace context와 `isthmus-workspace` 매니페스트의 link `server`·
  `contract.member` 자리에 쓸 수 있다. CLI가 파일 sha256을 대조하고(다르면 2) digest·계약을 검증한다. trace는 surface가 선언한
  route에서 **`server-surface-opaque`** gap으로 멈추고(usr 공개 시 gap `symbol`과 도달 근거 없는 핸들러 hop), 그 member에
  `handler-without-symbol`·정방향 `analysis-missing`·`persistence-unscanned`를 더하지 않는다. surface member는 선택·`fileSymbols`·
  library가 가리킬 수 없다.
- **`diff --http`와 surface**: workspace 모드에서 surface member의 두 릴리스를 비교한다(두 시점 모두 surface이고 artifact 이름이
  같아야 한다). `--before`·`--after`에 surface artifact를 하나씩 주는 surface 모드도 받는다 — project 일치는 `--clients`끼리만
  보고 출력에 `surface: {name, before, after}`(revision·sha256)를 싣는다. 두 시점의 입력 종류가 섞이면 2다(이전 문구 "two
  workspace manifests or two document lists"는 "two workspace manifests, two http surfaces or two document lists"로 바뀌었다).
- **workspace `libraries`**([TRACE](docs/TRACE.md#library-공유-sdk-저장소)): 공유 SDK 저장소(provider, route-call을 담은 client
  member)와 그 SDK를 쓰는 앱(consumer)의 선언이다. trace는 SDK 호출의 역방향 영향에서 consumer의 역방향 분석으로 이어 가
  호출 hop에 `consumers`(`entries`·`affected`·`notInConsumerGraph`·`notPublic`)를 싣는다. id는 `ids: "shared"`(같은 문자열,
  선택 `publicSymbols`) 또는 `"symbol-map"`(대응표)으로만 맞추고, 생략하면 입력 오류다. consumer 분석이 root로 받지 않은 id는
  **`library-continuation-unrooted`**, provider가 아는 SDK id가 하나도 consumer 그래프에 없으면 **`library-ids-unmatched`**다.
  root-not-found는 생산자가 밝힌 "노드 없음"이라 개수만 싣는다. v1은 한 단계만 잇는다(provider이면서 consumer인 member는 입력
  오류). library consumer는 bridge-facts 문서 없이 분석만 가질 수 있다.
- **출력 호환**: surface member·library가 없는 입력의 trace·`diff --http` 출력은 바이트 단위로 같다. MCP `trace`는 같은 context를
  읽는다(새 도구 없음).
- **합성 fixture**: `fixtures/http-surface/`(서버 조직 문서 두 릴리스, 내보낸 surface, 클라이언트 조직 trace context·diff
  매니페스트), `fixtures/trace-library/`(surface로 가져온 API, SDK provider, `shared`·`symbol-map` consumer 앱 둘).

### Added — platform `python`과 `registration-order` 디스패치 (Phase 6 소비자)

- **platform `python`**([GRAPH-EXCHANGE](docs/GRAPH-EXCHANGE.md#platform-python-v1-확장)): pythograph 문서를 받는다. 이전
  버전은 `Unsupported bridge platform.`(2)으로 거부했다. target은 `null`·`persistence`·`http`이고 그 밖은 입력 오류다.
  http에서는 `route-decl`만 받는다 — Python 클라이언트(requests·httpx)의 `route-call`은 생산자 구현과 url-compose 벡터가
  생길 때 더한다. persistence에서는 기존 규칙대로 호출 측(`relation-use`)이다. `language-traversal` platform에도 더해
  trace context가 `platform: "python"` forward·reverse 분석을 받는다(capture 설정 포함). `compatibility.json`에는 발행본이
  없어 행을 더하지 않았다.
- **`dispatch: "registration-order"`와 `order: {group, index}`**([디스패치 모델](docs/GRAPH-EXCHANGE.md#디스패치-모델)):
  초안이라 거부하던 값을 확정·구현한다. 같은 문서·같은 group 안에서 먼저 등록한 decl이 호출을 받는다. method를 먼저
  거르는 규칙과 error 전제는 그대로라 순서는 match 대상만 고르고 새 error를 만들지 않는다. group·문서·dispatch가 다른
  후보는 근거가 더 강한(반드시 닿는) 단위만 남긴 뒤 둘 이상이면 `ambiguous-route-call`이다. 앞 index의 정규식 등 증명
  불가 후보와 narrowed 후보는 함께 match 대상에 넣고, suffix 후보에는 순서를 쓰지 않는다.
- **엄격한 검증(입력 오류 2)**: `order`는 registration-order 문서의 `route-decl`에만, `{group, index}` 두 키만 받는다.
  group은 제어 문자·앞뒤 공백 없는 256자 이하 문자열, index는 0 이상의 안전 정수다. 같은 (group, index)는 같은 소스
  위치(한 등록)여야 하고, 같은 group은 같은 유효 service여야 하며, catch-all 접두사 decl은 원본의 `order`를 물려받아야 한다.
- **가림 진단**: `route-decl-shadowed`(warning — 앞선 등록이 뒤 decl의 모든 경로와 method를 받아 어떤 라우터에서도 호출을
  받지 못함, 이 decl은 `route-decl-without-call`·`route-decl-conflict` 대신 이것으로만 보고하고 어느 호출의 match 대상도 되지 않음)와 `route-decl-path-shadowed`(warning — 경로만
  덮음: Django 같은 경로 우선 프레임워크에서는 405, method 우선 라우터에서는 다른 method로 닿음). 판정은 건전하게만
  한다(정규식·닫힌 제약의 리터럴·narrowed·대소문자 무시·base 앵커·미상 끝 슬래시는 덮는다고 보지 않음). 한 조인의 판정은
  5,000,000번까지이며 넘으면 입력 오류다. SARIF 규칙 목록에 두 코드가 더해졌다(http 입력이 있을 때만).
- **`diff --http`**([HTTP-DIFF](docs/HTTP-DIFF.md#등록-순서-registration-order)): `order` 값은 비교하지 않고, 순서 변화는
  교차 평가의 결합 변화(`rebound-route-calls` 등)와 새 surface finding `route-shadowing-changed`(warning)로 본다. 두 시점의
  문서별 `dispatch`가 다르면 인벤토리 불일치로 입력 오류다.
- **적합성 벡터**: 새 suite `conformance/http-dispatch.json` 45케이스(`dispatch.validate` — 생산자도 적용,
  `dispatch.match`·`dispatch.shadow` — 소비자). 기존 세 파일과 그 sha256은 그대로라 생산자가 **다시 벤더링할 필요는 없다**.
  registration-order를 내는 pythograph는 새 suite를 `conformance.lock`에 더해 `dispatch.validate`를 실행하길 권한다.
- **e2e 확인**: pythograph `origin/main`(`bc87783`)의 `fixtures/django/drf-shop`(기본 registration-order)과
  `fixtures/flask/blog-app`(specificity) 문서를 합성 Kotlin 클라이언트 문서와 check에 넣어 입력 오류가 없고, Django 쪽은
  fixture의 dynamic 패턴·스코프 없는 `route-coverage:` 때문에 error 없이 `-unverified`만, Flask 쪽은 기대한 error 4건
  (미선언 경로·int 제약 위반·method 불일치·static 스코프 밖 POST)만 나오며, 의도한 가림 패턴(`items/<str:key>/` 뒤의
  `items/featured/`)이 `route-decl-path-shadowed`로 보고됨을 확인했다.

### Fixed — retrofit.dart base 결합 계약

- [HTTP-WRAPPERS](docs/HTTP-WRAPPERS.md#base-결합) base 결합표와 [GRAPH-EXCHANGE](docs/GRAPH-EXCHANGE.md#base-접두사와-클라이언트-결합)가
  retrofit.dart를 "RFC 3986 상대 해석"으로 적던 것을 고친다. retrofit_generator 10.2.11 소스와 실제 dio 5.11.1 요청을 기록한
  모의 서버 오라클(dartograph)로 확인한 결과 두 단계다: ① 생성 코드 `_combineBaseUrls`가 `@RestApi(baseUrl)`을 dio base에
  RFC 3986으로 해석하고 ② 메서드 경로(`@Path` 치환 후)는 그 결과에 dio 단순 문자열 연결로 붙는다. 그래서
  `@RestApi(baseUrl: '…/rv1')` + `@GET('/users/{id}')`는 `/users/{}`가 아니라 `/rv1/users/{}`(root)다.
- dio 단순 연결의 정의(`baseUrl + path`, `:/`가 하나면 `//`→`/`, 점 세그먼트 제거, 슬래시 삽입 없음)와, 경로 없는 base
  리터럴 뒤 상대 경로가 host에 붙는 경우(`https://h` + `users`)를 dynamic + `ambiguous-base-join:`으로 두는 규칙을 명시한다.
- url-compose 벡터에는 retrofit.dart 전용 케이스가 없고 기존 `rfc3986`·`dio-concat` 케이스는 새 서술과 모순되지 않아
  벡터와 `SHA256SUMS`는 바뀌지 않는다(생산자 재벤더링 불필요).

### Added — http limitation 스코프 (Phase 4)

- **http 문서의 `limitationScopes`**([GRAPH-EXCHANGE](docs/GRAPH-EXCHANGE.md#http-limitation-스코프)): 초안이던 경로 스코프를
  계약으로 확정하고 구현한다. 항목은 `{limitationIndex, templates?, templatePrefixes?, templateSuffixes?, methods?}`이고
  경로 필드 하나 이상이 필요하다. 정규 템플릿·제어 문자·상한(스코프 1,000개, 원소 10,000개)·모르는 키·http 문서의
  `channels`·다른 target 문서의 경로 필드를 엄격히 검증해 입력 오류(2)로 거부한다. 이전 개발 빌드는 http 문서의
  `limitationScopes`를 거부했다.
- **판정 효과**: 서버·계약 측 공백 한계는 스코프와 겹칠 수 있는 **호출**에만, 호출 측 공백 한계는 스코프와 겹칠 수
  있는 **선언**에만 적용된다. `check`의 error 전제 (c)와 `route-call-without-contract`, `route-decl-without-call`·
  `route-contract-without-call`의 `-unverified`, `diff --http`의 `after-declaration-gap`이 호출·선언 단위로 판정된다.
  스코프 없는 한계는 이전처럼 문서 전체를 막는다(하위 호환). 비교는 보수적 교집합이다(ASCII 대소문자·끝 슬래시 하나·
  빈 파라미터·`{**}` 0세그먼트를 넓게 읽음, base 앵커는 알 수 없는 앞부분, HEAD→GET·OPTIONS·동적 동사). 한 조인의
  비교는 5,000,000칸까지이며 넘으면 입력 오류다.
- **출력**: 조인 한계(check·query·trace·`diff --http`)에 `routeScope`를 싣는다. 호출 측·모르는 접두사 한계는 귀속되지
  않은 호출 경로를 담을 수 있어 원소 수(`withheldElements`)만 싣는다. `diff --http`의 `declaration-coverage-gap`·
  `client-coverage-gap` 상세는 스코프 있는 한계로만 신고된 접두사에 ` (scoped)`를 붙인다.
- **`framework-provided-routes:` 스코프의 뜻**: "프레임워크가 선언 없는 추가 경로를 받을 수 있다" — 그 경로에 닿을 수 있는
  호출의 미결합 판정만 막는다. Spring Boot(`/error` 전체 method, 정적 리소스 GET·HEAD, webjars·actuator·Security)와
  Next.js 예시를 문서화했다.
- **적합성 벡터**: `conformance/http-template.json`에 Spring MVC PathPattern 변환 15케이스(`framework.spring.path-pattern`,
  Spring Framework v6.2.10 공식 소스로 확인 — 끝 `**`·`{*x}` 0세그먼트, 중간 `**` 거부, 6.x 끝 슬래시 strict 기본,
  빈 매핑 `""`와 `/`, 끝 `*`·부분 세그먼트의 빈 값 변형, 변형 16개 상한)를, 새 suite `conformance/http-limitation-scope.json`
  (스코프 적용·검증 27케이스)을 더했다. `SHA256SUMS`가 바뀌었으므로 벡터를 벤더링하는 생산자(kartograph·cartograph·
  tsograph)는 다시 벤더링하고 `conformance.lock`을 갱신해야 한다.
- 계약: Spring의 빈 값 매칭(끝 `*`, 부분 세그먼트 변수)은 소비자 매칭을 바꾸지 않고 생산자가 빈 값 변형 decl을 함께
  내는 규칙으로 정했다.

### Fixed — capture 순회 root 위생과 root-not-found 부분 성공

- **root 위생**: capture가 언어 순회(forward·reverse) root에 그 생산자 그래프의 노드가 될 수 없는 id를 넘기던 문제를
  고친다. persistence의 비sql 문서는 `relation-use`만 실을 수 있어, tsograph `schema`는 Prisma model·field와 TypedSQL 선언을
  사용 측 kind로 싣고 usr를 노드가 아닌 이름공간(`#model:`·`#typedsql:`)에 둔다. capture는 생산자가 README로 밝힌 이
  표식의 relation-use를 root에서 빼고(생산자 `tool.name`별 고정 표 — 추측하지 않는다), 파일 선택 2단계처럼 그 platform의
  심볼 목록(그래프 노드 전체)을 이미 받았으면 목록에 없는 사실 usr도 뺀다. 선택한 심볼·파일 심볼은 거르지 않는다. 뺀 id는
  manifest `rootFilters`에 싣고, 목록과 어긋난 id는 `roots-not-in-listing` 경고로도 알린다.
- **종료 코드 64의 부분 성공**: 순회 분석이 64로 끝났어도 stdout이 유효한 `language-traversal` 문서이고 root-not-found를
  계약대로 기록했으면(`truncationReasons`와 `symbol` 없는 root, 그 id가 넘긴 root) `acceptExitCodes` 없이 받는다. 못 찾은
  id는 그 단계의 `rootsNotFound`, manifest·결과 JSON의 `warnings`, stderr 경고에 남고, trace는 `analysisLimitations`와
  `analysis-missing`·`analysis-truncated` gap으로 드러낸다. 문서가 없거나 기록이 없으면 이전처럼 실패한다. 생산자 심볼
  목록 파서는 노드 id 전체(`ids`)를 함께 돌려준다([TRACE](docs/TRACE.md#root-위생과-root-not-found)).

### Added — http diff (개발 중, Phase 3 소비자)

- **`isthmus diff --http`**([HTTP-DIFF](docs/HTTP-DIFF.md)): 한 서버·스펙의 http route 표면을 두 시점에서 비교하고, base에서
  결합하던 클라이언트 호출이 head에서 결합하지 않게 되는 곳을 보고한다. 새 출력 형식 `isthmus-http-diff` v1(bridge
  `isthmus-diff` v1은 그대로). `--http`는 `diff` 바로 다음 인수여야 하며(경로 문자열이 모드를 바꾸지 못하게), `--http` 없는
  bridge diff와 MCP `diff` 도구는 바뀌지 않는다.
  - surface 모드: `--before`·`--after`의 선언 측 문서와 `--clients`로 한 번만 받은 호출을 교차 평가한다(같은 호출을 base·head
    선언 측에 따로 조인). workspace 모드: base·head `isthmus-workspace` 매니페스트 두 개 — link마다 base의 server·contract
    문서와 head의 client member 호출, head의 server·contract 문서와 같은 호출을 조인한다. 매니페스트 파싱과 link 조인(귀속·
    서비스 범위)은 trace와 같은 코드다(`parseWorkspaceManifest`, `joinWorkspaceLink`로 공유).
  - route 신원은 (scope, 측, pathAnchor, method, 정규 템플릿)이고 rename을 추론하지 않는다. 입력 구성 차이(project·선언 측
    인벤토리·link 정의)는 입력 오류(2)다.
  - finding 19종: surface(`route-added`·`route-removed`·`route-param-constraints-changed`·`route-trailing-slash-changed`·
    `route-catch-all-changed`·`route-case-sensitivity-changed`), impact(`removed-bound-route`·`changed-bound-route`와
    `-unverified` 변형, `rebound-route-calls`), incompleteness(`clients-unscanned`·`calls-unattributed`·`calls-dynamic`·
    `client-coverage-gap`·`declaration-coverage-gap`·`declarations-dynamic`·`link-service-ambiguous`·`http-member-unlinked`).
    error는 check의 전제를 옮긴 10가지 전제가 모두 증명될 때만이고, 빠진 전제는 호출마다 `reasons`로 싣는다. contract 측
    깨짐의 error는 link `contract.authoritative: true`에서만이다. 귀속되지 않은 호출은 개수만 싣는다.
  - `--fail-on <code|error|warning|incomplete>[,...]`와 `--strict`(= `--fail-on error`): 걸린 finding이 있으면 1, 모르는 토큰은 64.
  - base..head CI 절차와 GitHub Actions 예시(비밀값 없음), 합성 fixture `fixtures/http-diff/`(surface·분리된 두 저장소
    workspace), 코드마다의 음성 fixture·종료 코드·결정성 테스트, 문서 코드 표 대조 테스트, CLI 계약 스크립트 검사.
- bridge `diff`가 http 문서를 거부할 때 `isthmus diff --http`를 안내한다.

### Added — 파일 선택의 2단계 capture와 trace context `fileSymbols`

- **capture 2단계 수집**: 파일 선택이면 capture가 역방향 순회를 뒤로 미룬다. 1단계로 정방향·사전 계산 분석과 member
  `listings`(생산자 심볼 목록 — tsograph `graph`, kartograph `snapshot --include-paths`(v1·compact v2), cartograph `graph
  --level symbol --format json`)를 모으고, 선택한 파일에 놓인 심볼을 찾아 역방향 root에 더한 뒤 역방향을 실행한다. 그래서
  사실이 없는 헬퍼(핸들러가 부르는 함수 등)도 root가 되어 `file-selection-fact-fallback`·`analysis-missing` 없이 route에 닿는다.
  목록이 없는 platform은 1단계 순회가 파일에 위치시킨 심볼만 쓰고(부분), schemagraph·dartograph처럼 목록이 없으면 fallback을
  그대로 둔다. platform마다 출처(`listing`·`traversal`)·완전성·찾은 심볼·더한 root 수와 남은 한계를 manifest
  `fileSelection`에 싣는다. 파일 선택이 아니면 목록은 실행하지 않는다. context의 분석 순서는 설정 순서 그대로다.
- **trace context `fileSymbols`(선택, 추가 필드)**: `[{member?, path, platform, usrs}]` — 선택한 파일에 생산자 목록이 놓은
  심볼이다. tsograph는 순회 root에 위치를 싣지 않아 분석 위치만으로는 파일의 심볼을 알 수 없으므로, capture가 목록에서 찾은
  심볼을 여기 싣고 trace는 분석 위치와 같은 근거로 쓴다. 파일 선택에서만 받고 선택한 파일만 가리킬 수 있다(아니면 입력 오류).
  필드가 없는 context와 그 출력은 바이트 단위로 그대로다.
- capture 문서에 cartograph `impact --roots-from`(cartograph PR #150) 지원을 적었다. capture는 버전을 추측해 감지하지 않는다 —
  그 cartograph를 쓰면 분석 항목에 `roots: "roots-from"`을 준다.

### Added — trace capture와 MCP trace (Phase 3)

- **`scripts/capture-trace.mjs`(npm 패키지 포함)**: `isthmus-trace-capture` v1 설정 하나로 trace 입력 전체를 모은다 —
  (a) 생산자 사실 명령 또는 사전 계산 사실 문서(bridge-facts·member project 즉시 검증), (b) member마다 `isthmus check
  --pairs`(양쪽 측이 있는 도메인의 문서만, `pairs/<member>.json`), (c) 사실에서 뽑은 선택 무관 상위 집합 root(핸들러
  usr, route-call·relation-use를 감싼 usr와 선택한 심볼, sql VertexId)로 생산자 순회(`arguments`·`separator`·
  `roots-from` 전달, `maxRootsPerRun`·128KiB 인자 상한으로 나눠 실행, trace 파서로 검증), (d) 단일 project·workspace
  `trace-context.json`과 artifact(사전 계산 분석은 sha256·revision 증언을 `precomputed`에), 도구 `--version`·소스
  revision·member revision·단계별 argv·종료 코드·artifact sha256을 담은 `capture-manifest.json`, (e) 선택적
  `isthmus trace`. 자식은 셸 없이 인자 배열로 단계별 시간 제한 안에서 실행하고, 실패는 단계와 명령을 밝히며 stderr는
  `logs/`에만 남긴다. 모든 경로는 선언한 root 아래(`..`·심링크 탈출·제어 문자·`.env`·키 파일 이름 거부)이고 출력
  디렉터리는 없거나 비어 있어야 한다. 설정 검증·root 추출·context 조립은 `dist/report/trace-capture.js`에 있다.
- **trace 출력 상한**: `isthmus trace --max-chains <1..1000> --max-rows <1..10000>`이 chain과 모든 행 목록(목록마다)을
  자르고 `truncation: {maxChains, maxRows, truncated, omittedLists, omitted[{path, total, shown}]}`를 더한다. `summary`와
  종료 코드는 자르기 전 보고서 기준이고, 플래그가 없으면 출력은 그대로다.
- **MCP `trace` 도구**: `context`·`maxChains`(기본 10)·`maxRows`(기본 25)·`strict`·`compact`. 항상 출력 상한을 넘긴다.
  `check --pairs`는 MCP에 노출하지 않는다(API-IMPACT-PLAN 결정 표).

### Added

- **trace workspace(개발 중, Phase 3 소비자)**: 서버와 클라이언트가 다른 git 저장소에 있어도 `isthmus trace` 한
  번으로 route → 테이블·DB 의존자 → 호출부 → 클라이언트 영향 심볼을 잇는다. `isthmus-trace-context` v1에 서로
  배타적인 추가 필드 `members`·`links`를 더했다(v2 없음 — 옛 isthmus는 모르는 필드를 거부하고 단일 project
  context와 출력은 바이트 단위로 그대로다). member·link 모양은 GRAPH-EXCHANGE `isthmus-workspace` 초안을 재사용하고
  member에 `analyses`를 더한다. member `revision`은 필수이고 분석 revision은 member마다 비교하며(`stale-analysis`·
  `analysis-revision-unknown` 재사용), `catalog.graphSha`가 있으면 sql 분석 graphRevision과 비교한다. link `match`는
  `hosts`·`services`·`baseRefs[].ref`를 구현하고 `interfaces`·`baseRefs[].pathPrefix`는 거부한다. persistence·언어
  순회는 member 안에서만, http는 link 쌍에서만 잇고(체인 키 `[member, platform, id]`), 출력 끝점·hop·gap·분석 요약에
  `member`를 싣는다. `match.services`가 있으면 그 서비스의 선언만 잇고 다른 서비스로 확정된 호출은 귀속하지 않으며,
  좁히지 않은 link의 선언 측이 여러 서비스면 선언을 잇지 않는다. 새 gap `http-member-unlinked`·`link-service-ambiguous`. 조인에 `link` 선택 사항(trace 구성 전용)을 추가했다.
- **trace 사전 계산 분석**: 분석 참조의 `precomputed: {sha256, revision, generatedAt?}`로 다른 곳(예: 클라이언트
  macOS CI)에서 만든 artifact를 받는다. CLI가 파일 SHA-256을 대조하고(다르면 2), revision 없는 옛 형식은 증언
  revision으로 비교하되(`revisionSource: "attested"`) 보수적으로 `analysis-revision-unknown`을 남긴다. 문서 revision과
  증언이 다르면 입력 오류다.
- **trace files 선택**: `files: [path]`(workspace는 `[{member, path}]`)가 파일에 놓인 분석 심볼과 사실 위치
  fallback의 심볼로 역방향 체인을 만들고, 파일의 relation-use를 hop·DB 의존자로 싣는다. 파일 단위 과대 근사라
  항상 알림 `file-selection-coarse`를 남긴다. 분석 위치 없이 사실 위치로만 대신하면 gap
  `file-selection-fact-fallback`, 찾은 것이 없으면 `file-without-symbols`.
- **trace 알림(notice) 등급**: 과대 보고만 할 수 있고 영향을 숨기지 않는 코드(`TRACE_NOTICE_CODES`, 지금은
  `file-selection-coarse`)는 최상위 `notices`와 `summary.notices`에 싣고 `gaps`·`--strict` 실패에서 뺀다. 모든 trace
  출력에 `notices`·`summary.notices`가 추가된다. 형제 전파 opt-in은 계획이 정의하지 않아 보류했다.
- 분리된 두 저장소 합성 fixture(`fixtures/trace-workspace/`), TRACE.md gap 코드 전수(33종) 음성 fixture와 문서 대조
  테스트, 실제 CLI 프로세스로 고정한 `--strict` 종료 코드 의미, CLI 계약 스크립트의 workspace trace 검사.

- **`trace` 명령(개발 중, Phase 2 소비자)**: `isthmus trace <trace-context.json> [--strict] [--compact]`가
  `isthmus-trace-context` v1(단일 project의 http·persistence 문서, 역할별 생산자 순회, routes·relations·
  symbols 중 한 선택)을 읽어 `isthmus-trace` v1을 낸다. route 선택은 route-decl 핸들러 → 정방향 순회 →
  relation-use → persistence 조인 → relation-decl VertexId → schemagraph 의존자와, route → 귀속된 호출 →
  클라이언트 역방향 순회를 잇는다. relation·심볼 선택은 역방향 순회로 핸들러·route·클라이언트를 찾는다.
  조인·귀속은 check와 같은 코드(`check --pairs` 투영 포함)를 재사용하고, 한쪽 측만 있어도 조인하되 빠진
  측은 gap으로 밝힌다(조인에 `composition: "trace"` 선택 사항 추가, 기존 명령은 그대로). 결과는 항상
  `complete: false`이고 출력의 모든 id는 생산자 문자열이며, 귀속되지 않은 호출은 개수만 싣는다. gap 코드
  30종(`handler-without-symbol`·`relation-use-without-symbol`·`route-without-decl`·`analysis-missing`·
  `analysis-truncated`·`stale-analysis`·`non-http-entry`·`unattributed-calls-omitted` 등)과 `--strict`(gap이
  있으면 1). MCP에는 노출하지 않는다([TRACE](docs/TRACE.md)).
- **[`language-traversal` v1 계약](docs/LANGUAGE-TRAVERSAL.md)과 fail-closed 파서**: 정방향·역방향 순회,
  정점별 `via`·`depth`·root 인덱스 목록(64개 상한과 `rootsTruncated`), 결정적 순서. 다른 root에서 닿은
  root도 `reached`에 싣고 그 항목의 `roots`에는 자기 인덱스를 넣지 않는다(다중 root DB 순회에서 root
  테이블끼리의 FK 의존자가 사라지지 않게 하기 위해서다). root 항목의 depth는 기준값이고 via는 그 root를
  거쳐 돌아올 수 있는 목격이라 depth 관계를 검사하지 않으며, trace는 순환 목격을 `witness-partial`로 표시한다. trace는 새 형식을
  우선하고 `schemagraph-impact` v1과 preflight의 kartograph·cartograph·dartograph 어댑터를 대체 경로로 공유한다.
- **`language-traversal` v1 선택 필드 — 근거 등급과 잇지 못한 호출**: DI dispatch를 해석하는 생산자(tsograph)를 위해
  문서 `dispatch`(생산자 표식), `reached[].evidence`(`direct`·`bound`·`candidate`, 나열된 root마다 성립하는 하한),
  `reached[].unresolvedCalls`·`roots[].unresolvedCalls`(1~1,000,000, 0이면 생략)를 더한다. 파서는 열거값·정수
  범위와 root 항목의 `unresolvedCalls` 일치를 검사하고, via 사이 등급 관계는 via가 전체 그래프 목격이라 생산자
  보장으로 둔다. 없는 필드는 문서 단위로 읽는다 — `dispatch`나 필드를 실은 정점이 있으면 신고하는 문서(없는 등급은
  `direct`, 없는 수는 0), 아니면 sql은 `direct`, 언어 그래프는 `unassessed`, 잇지 못한 호출은 "알 수 없음"이다.
- **trace 근거 등급·완전성 gap**: 모든 도달 근거(relation-use·핸들러 `reachedFrom`, 클라이언트 `affected`, DB
  `dependents`)가 `evidence`를 싣고, 같은 정점의 근거가 여럿이면 더 강한 등급을 먼저 고른다. `summary.evidence`에
  등급별 수, `analyses[]`에 `dispatch`·`evidenceReported`·`unresolvedCallsReported`를 싣는다. 새 gap
  `candidate-dispatch`(가능성 구현 간선으로만 닿는 hop, hop은 유지), `reach-possibly-incomplete`(핸들러나 그
  도달 정점에 잇지 못한 호출 — 합계와 예시 id), `reach-completeness-unknown`(정방향 분석이 잇지 못한 호출을 신고하지
  않음). `bound`는 품질 표시일 뿐 gap이 아니다. 합성 fixture의 TS 순회는 `dispatch: "direct"`를 싣는다.

- **http 도메인 Phase 1(개발 중)**: `check`·`query`가 `target: "http"` 문서를 소비한다.
  platform `openapi`(`route-contract` 전용)와 kind `route-decl`·`route-call`·`route-contract`를
  받고, 역할은 kind로 정한다. `roles`로 사실 0건 http 문서도 "스캔했으나 없음"을 표현하며 이
  문서는 bridge·persistence 요건을 채우지 않는다. 정규 경로 템플릿 문법을 검증하고(다시 정규화하지
  않고 사유 코드로 거부), 세그먼트 trie 매처로 정확·`{}`·부분 세그먼트·`{**}`(catch-all 접두사
  decl)·구체성·닫힌 경로 제약·HEAD/OPTIONS·동적 동사·끝 슬래시/대소문자·경로 앵커 네 조합과
  suffix 후보(호출당 64개)를 판정한다. 매니페스트 없는 귀속 게이트(service 일치, 단일 서비스)를
  적용하고, 귀속되지 않은 호출은 `unjoined-unbound-route-calls` 개수로만 남긴다.
- http check 진단 16종(`route-call-without-decl`·`route-method-mismatch`·`route-call-without-contract`와
  `-unverified` 변형, 미호출·드리프트·모호·끝 슬래시·대소문자·충돌). error는 전제 (a)~(f)가 모두
  증명될 때만이고, 선언 측이 스펙뿐인 link는 decl 기반 진단을 내지 않는다. 이 버전은 매니페스트의
  `contract.authoritative`가 없어 `route-call-without-contract`가 항상 `-unverified`다.
- http 진단 신원의 5번째 원소 `scope`. 베이스라인·SARIF(`properties.scope`)·Code Quality에
  실리며, scope가 없는 기존 키·지문과 http가 없는 입력의 SARIF 규칙 목록은 바이트 단위로 같다.
- `check --pairs`의 http 매치(`{domain: "http", scope, key: {method, template}, quality, uses,
  decls, contracts}`)와 `query route:[<METHOD> ]<template>[ <scope>]` 주체(MCP `query`도 같은 경로).
- [`http-wrappers` v1 스키마와 공통 해석 규칙](docs/HTTP-WRAPPERS.md), 공유 적합성 벡터
  `conformance/http-template.json`·`conformance/url-compose.json`과 `SHA256SUMS`(패키지에 포함).
  `npm run verify`가 `scripts/verify-conformance.mjs`로 해시·형식을 대조하고 소비자 케이스는 제품
  매처로, 생산자 케이스는 참조 구현으로 실행한다.

- `check --pairs`(기본 `--format json` 전용)가 최상위 `matches`에 persistence 사용↔선언 쌍을
  싣는다. 키는 조인이 해석한 선언 관계(와 컬럼)이고, 끝점은 사실의 platform·location·symbol을
  그대로 복사한다. 플래그 없는 출력과 요약·이슈·베이스라인·`--strict` 판정은 바이트 단위로
  같다. `sarif`·`codequality`와 함께 쓰면 사용 오류(64), 끝점이 100,000개를 넘으면 부분 목록
  없이 종료 코드 2다. MCP `check` 도구에는 노출하지 않는다.
- `query relation:<name>`이 persistence 조인 규칙(한정 이름 정확 일치, 비한정 이름은 마지막
  세그먼트가 유일할 때만, 여럿이면 `ambiguous`)으로 관계 하나의 사용·선언·컬럼별 증거·진단을
  기존 query 외피(`level: "persistence"`)로 낸다. 미발견은 기존처럼 `notFound`와 64다.
  이름 자체가 `relation:`으로 시작하는 bridge 채널·메서드는 같은 이름의 관계가 없으면 이전처럼
  그 이름으로 찾는다. 관계와 겹치면 관계가 우선하므로 그 bridge 키는 qualifiedName
  (예: `flutter:relation%3Afoo`)으로 질의한다. `relation:`만 있는 이름은 사용 오류(64)다.
  MCP `query` 도구도 같은 경로라 `name`에 `relation:<name>`을 받는다.
- [persistence 수동 왕복 추적](docs/PERSISTENCE-TRACE.md) 문서: `--pairs`의 사용 `symbol.usr`를
  kartograph·cartograph impact에, 선언 VertexId를 `schemagraph impact`에 넘기는 절차와
  생산자별 usr 부착 현황. 이 연결은 아직 자동화하지 않았다.

### Verified

- RN 새 아키텍처 후속 하네스에서 Android 에뮬레이터 31개 검사와 강제 종료 후 31개,
  iOS 시뮬레이터 release 20개 검사와 종료 후 20개를 통과했다. Android는 실제 OS audio focus
  정지·복귀를, iOS는 원본 Sound 재생과 UIKit scene 시작 경로를 확인했다. 실기기 RN 확장과
  수신 전화·저메모리 종료는 이 결과에 포함하지 않는다.
- iPhone 실기기의 Flutter3.47.2/iOS27 release에서 Dart product 모드, Method/Basic 성공 2건,
  오류·미등록·timeout·pending과 Swift marker를 확인했다. 테스트 앱 제거까지 검증했다.
- 전용 Android 에뮬레이터의 RN0.81.4/Hermes 새 아키텍처 release에서 Fabric layout,
  Codegen TurboModule 왕복·오류, 공개 Sound 원본의 실제 무음 미디어 재생·구독 해제·
  background/foreground 뒤 호출과 이벤트 등 26개 검사를 통과했다. Android 실기기 legacy
  기록과 구분하며 iOS RN·모든 lifecycle·가청 출력의 검증을 주장하지 않는다.

### Changed

- `graph`·`diff`·`impact`·`retentions`·preflight context는 http 문서(target `http` 또는 platform
  `openapi`)를 빈 정상 결과로 읽지 않고 원인 문구와 종료 코드 2로 거부한다.
- 아직 구현하지 않은 http 초안 값(`dispatch: "registration-order"`, `order`, http 문서의
  `limitationScopes`, `isthmus-workspace` 매니페스트)과 다른 target 문서의 route 필드는 입력
  오류로 거부한다(`channelPrefix`는 기존 계약 필드라 예외로 버린다).

- persistence 도메인의 호출 측 생산자에 dartograph `schema`(`platform: "dart"`)를 추가했다.
  조인 로직은 이미 비sql `target: "persistence"` 문서를 받으므로 코드 변경은 없고, dart
  persistence 문서가 bridge 호출 측 요건을 채우지 않는다는 불변식과 persistence 단독·혼합
  입력 조인을 테스트로 고정했다. GRAPH-EXCHANGE 생산자 표·kind 표와 README 의존 관계도를
  다섯 개 코드 생산자(Go·Rust·Kotlin·Swift·Dart)에 맞췄다.

- RN iOS용 release/Codegen 하네스와 명시적 fmt consteval 우회 옵션을 추가했다.
  성공·실패 로그와 원본/수정 의존성 근거를 보존하고 소유한 시뮬레이터만 정리한다.
- 현재 저장소의 호환 producer pin을 kartograph 0.14.0으로 갱신했다. npm 0.9.0의
  원본 아카이브와 발행 당시 kartograph 0.13.0 manifest는 유지한다.
- iOS 하네스에 `--physical --release`와 선택적 `--team`, RN 하네스에 `--new-architecture`·
  `--new-emulator`를 추가했다. RN은 설치 전에 입력과 APK를 보존하고 소유한 앱·AVD 정리 실패를 전달한다.
- bridge 역할 판정을 platform 대신 한 가지 명시 규칙으로 통일했다: `target`이
  flutter·react-native·capacitor이거나, `target: null`이고 platform이 dart·js·swift·kotlin인
  문서만 bridge 문서다. 조인 구성, diff 스냅샷, retentions 수신 측, 수신 공백 완화,
  preflight context, impact runtime 후보가 같은 판정을 쓴다. bridge 전용·persistence 전용·
  혼합·사실 0건 bridge 문서 입력의 대표 명령 출력과 종료 코드는 바이트 단위로 고정했고
  (`UPDATE_DOMAIN_COMPOSITION=1`로 다시 캡처), 의도해서 달라진 동작은 아래 Fixed에 적었다.

### Fixed

- `retentions --for kartograph|cartograph`가 같은 플랫폼의 persistence 문서만 있는 입력을
  수신 측 근거로 세어 빈 목록과 종료 코드 0을 내던 결함을 고쳤다. 이제 종료 코드 2와 원인 문구다.
- `diff`가 persistence 문서나 sql 문서를 받으면 일반 스냅샷 구성 문구 대신 persistence 비교를
  아직 지원하지 않는다는 원인 문구로 거부한다(종료 코드 2는 같다). preflight context도
  persistence 문서를 조인 실패 문구 대신 원인 문구로 거부한다.
- `impact`가 persistence 진단을 원문 채널 문자열로 걸러, 비한정 사용(`users`)이 닿는 한정
  선언(`public.users`)의 `column-use-without-decl`을 빠뜨리던 결함을 고쳤다. 조인과 같은
  해석 규칙으로 귀속하며, 선택한 persistence 사실의 진단은 경고도 `--strict` blocker다.
- `impact --runtime`이 같은 플랫폼의 persistence 문서만 있는 native 플랫폼(예: android run에서
  kotlin persistence 문서만 있을 때)을 분석한 것으로 세어, 정적 핸들러를 찾지 않았는데도
  주소의 `staticStatus`를 `unobserved`(정적 핸들러 없음)로 내던 결함을 고쳤다. 이제
  `unsupported`다. 두 값 모두 런타임 공백이라 `--strict` 종료 코드는 같다.
- 관계 사용이 0건인 kotlin·swift·dart persistence 문서(`target: null`)만 bridge 쪽에 남은
  persistence 입력은 target null이 bridge 문서로 세진다는 원인을 오류 문구에 밝힌다.

## [0.9.0] - 2026-09-20

호환 릴리스 세트: cartograph 0.20.0 · kartograph 0.13.0 · dartograph 0.15.0.

### Added

- RN 이벤트 추출이 named/namespace ESM과 직접 CommonJS RN namespace의 안정적인
  모듈 범위 let/var NativeEventEmitter 초기화를 지원한다. 공개 react-native-sound 두 버전의
  source-fact 검사는 TP 4 / FN 0 / FP 0이며, 이전 0.8.0의 caller FN 기록도 보존한다.
- v1/v2의 선택적 `sourceModifiedAt`을 검증하고 impact/diff 입력 근거에 보존한다.
  `generatedAt`은 추출 시각이며 source mtime이나 compiler freshness를 대신하지 않는다.

### Verified

- 원본 Sound.kt의 실제 컴파일 JVM ID → retention → dead 억제·JS caller explain과
  무관한 메서드 미도달 대조를 추가했다. Android SDK+명시적인 RN API 스텁을 사용하며
  RN 엔진 실행이나 Gradle build witness 검증으로 해석하지 않는다.
- Flutter 3.47.2의 실제 macOS 앱·소유한 Android 에뮬레이터에서 Method/Basic/Pigeon의
  성공·오류·미등록·timeout·pending을 대조했다. 실기기·iOS·release·모든 lifecycle은 범위 밖이다.

### Fixed

- README에서 연결하는 호환 버전 문서를 npm 패키지에 포함하고 package 계약에서 확인한다.
- 초기화 전·재할당·escape·이름 가림·중괄호 없는 조건부 선언과 const 블록 밖 구독을
  확정하지 않는다. 직접 초기화 범위 밖의 알려진 constructor는 미해석 한계로 남기고,
  예약어 이름의 객체 메서드 호출 뒤 ASI 선언을 조건문 본문으로 오인하지 않는다.
- macOS 하네스가 이미 12.0인 deployment target과 새 Flutter의 프로젝트 단위 CocoaPods
  설정을 처리한다. Android 하네스의 `--new-emulator`는 전용 AVD를 선택한다.

### Changed

- 호환 producer 세트를 kartograph 0.13.0으로 갱신했다. 0.11.0의
  일반 RN target 필터 회귀를 수정한 producer이며, 기존 npm 0.8.0 아카이브의 발행 시점
  manifest와 구분한다.
- 공개 RN 이벤트·Kotlin 수신 측 코퍼스와 전체 Flutter 15케이스의 cache miss/hit·보고서
  동등성 검증을 추가했다. 발행본과 개발 소스의 기대값·결과 파일을 분리하고 관찰 한계를 보존한다.

## [0.8.0] - 2026-09-20

호환 릴리스 세트: cartograph 0.20.0 · kartograph 0.11.0 · dartograph 0.15.0.

### Added

- `retentions --for kartograph`가 실제 Kotlin/JVM 식별자와 Dart/JS 호출 근거를 내보낸다.
  cartograph 대상도 실제 Clang USR이 있는 ObjC 선언을 포함하며, 식별자 누락은 부분 보존
  대신 실패한다. 이전에 ObjC 제외 계수와 함께 성공하던 name-only 입력도 이제 코드 2로
  실패한다. cartograph 0.20.0·kartograph 0.11.0이 대응 소비자다.
- 코어 RN 전역 이벤트를 `extract-js --events`의 `event-listen`과 네이티브
  `bridges --rn-events`의 `event-emit`으로 연결한다. 별도 v2 transport이며 check의
  미대응 진단은 warning, query/graph kind는 event다. Expo·preflight/runtime은 범위 밖이다.
- `scripts/measure-preflight-cache.mjs`가 격리한 빈 캐시와 재사용 수집의 시간·문서 동등성을
  검사한다. 사용자 캐시·SDK·빌드 캐시는 지우지 않는다.

### Fixed

- JS 이벤트의 동명 객체 속성을 import된 emitter로 오인하지 않는다. v1·v2 JS 위치의 열은
  공통 어휘 단계에서 UTF-8 바이트로 계산한다.

- v1·v2를 함께 내보낼 때에도 보존 문서 전체의 호출 근거 상한을 적용한다.

## [0.7.0] - 2026-09-19

### Added

- `retentions --for cartograph`가 v2 Basic·Event 경계의 Swift 핸들러를 보존한다.
  literal로 확정된 `message-handle`·`stream-handle`의 심볼을 `evidence.channel`과
  호출자만으로 싣고 `method`를 생략한다 — cartograph의 `Evidence.method`도 선택
  필드라 실제 발행 소비자로 디코드·적용을 확인했다. dynamic prefix 후보와 ObjC v2
  핸들러는 v1과 같은 규칙으로 제외하고 ObjC 수는 `omittedObjectiveCHandlers`에
  더한다.
- `query`·`graph`·`diff`가 bridge-facts v2 경계를 소비한다. `query`는 Basic을
  `message`, Event를 `stream` kind 주체로 찾고(같은 이름의 v1 채널과도 kind로 구분),
  `graph`는 literal로 확정된 v2 경계를 `message`·`stream` 간선으로 낸다. `diff`는
  literal v2 경계의 추가·삭제와 v2 진단의 introduced/resolved를 보고하며, v2 입력은
  두 시점 모두에 있어야 하고 transport 집합이 같아야 한다. dynamic prefix 후보는
  확정 매치가 아니므로 graph·diff의 경계가 아니다. `impact`는 v1 전용으로
  남는다.
- `check`가 bridge-facts v2 문서(BasicMessageChannel·EventChannel)를 직접 소비한다.
  literal `message-send`에 대응 `message-handle`이 없으면 `unhandled-message-send`
  error(수신 측 `unattributed-message-handles:` 공백이면 `-unverified` warning),
  대응 send 없는 handler는 `message-handler-without-send` warning이다. EventChannel은
  `unhandled-stream-listen`·`-unverified`·`stream-handler-without-listen`으로 대칭
  보고한다. dynamic `channelPrefix`는 후보로만 다뤄 미대응을 error로 만들지 않고
  `dynamic-*-address`·`unmatched-*-boundary` 소비자 한계로 남기며, literal 경계가
  덮는 prefix 후보도 진단에서 제외한다. `summary`는 v2 입력이 있을 때만
  `matchedMessages`·`matchedStreams`를 더하고, SARIF·Code Quality·baseline이 새
  코드를 그대로 싣는다. `query`·`graph`·`diff`·`retentions`·`impact`는 v1 전용으로
  남아 version 2를 명시적으로 거부한다.
- `isthmus init [capture.json] [--project <dir>] [--toolchain <toolchain.json>] [--force]`:
  `scripts/capture-preflight.mjs`가 실행할 capture 설정 scaffold를 JSON으로 쓴다.
  `--toolchain`을 주면 `isthmus-built-toolchain` JSON의 실제 producer 명령을 채우고,
  앱별로 다른 `prepare`는 자리표시자로 남긴다. 기존 파일은 `--force` 없이는 덮어쓰지 않는다.
- `isthmus doctor <capture.json>`: capture 설정을 수집기와 같은 정본 규칙
  (`src/exchange/capture-config.ts`)으로 검증하고 producer·prepare 첫 토큰이 `PATH`나
  지정 경로에 실제로 있는지 확인한다. 제품은 producer를 실행하거나 버전을 조회하지 않는다.
  출력은 `isthmus-doctor` v1 JSON이며 정상 0, 미완성 1, 입력·계약 오류 2, 사용 오류 64다.
  capture 검증 규칙을 제품으로 이동해 `scripts/capture-preflight.mjs`와 단일 정본을 공유한다.
- `compatibility.json`: 공개 호환 버전 세트의 기계 판독 정본이다. `scripts/verify-compatibility.mjs`가
  `package.json`의 isthmus 버전과 `docs/COMPATIBILITY.md`·`README`의 producer 버전 표기가
  정본과 일치하는지 `npm run verify`에서 검사해 손으로 적은 표의 drift를 실패로 드러낸다.
  정본은 npm 패키지에 포함된다.

- React Native 모듈·컴포넌트 경계 조인: `module-import`↔`module-export`와
  `component-require`↔`component-export`를 `(target, channel=이름)`으로 연결한다.
  export 없는 호출 측 이름은 `module-import-without-export`·
  `component-require-without-export` error, 짝 없는 수신 측 이름은
  `module-export-without-import`·`component-export-without-require` warning이다.
  수신 측의 동적 export 계수(`unjoined-dynamic-exports:`)는 미수출 진단을
  `-unverified` warning으로 낮춘다. query의 `module`·`component` 주체, graph의
  `module`·`component` 간선, diff의 added/removed 모듈·컴포넌트와 SARIF 규칙을
  함께 제공한다. diff는 두 스냅샷의 target 집합이 다르면 코드 삭제로 오인하지
  않고 입력 오류로 거부한다.
- `isthmus extract-js <file-or-dir> [more...] [--project <dir>]`: React Native
  호출 측 bridge-facts 생산자다. 무의존 JS/TS 토큰 스캔으로 `NativeModules.X`·
  `NativeModules['X']`·`TurboModuleRegistry.get*`·`requireNativeModule`/
  `requireOptionalNativeModule`·`requireNativeComponent`·`codegenNativeComponent`·
  `requireNativeViewManager`를 읽고, 같은 파일 상수·바인딩·상대 import·배럴
  재수출을 해석해 멤버 호출을 `method-invoke`로 귀속한다. 비리터럴 이름은
  `dynamic: true`에 원문 표현을 실어 보존하고, 스캔 집합을 벗어난 바인딩은
  `unattributed-js-*` limitations로 보고한다. 출력은 `bridge-facts` v1 문서라
  기존 check·query·graph·diff 파이프라인에 그대로 들어간다.
- bridge-facts v1 확장 `optional`: 부재를 허용하는 모듈 조회 API
  (`requireOptionalNativeModule`, `TurboModuleRegistry.get`·`getNullable`)로
  관찰한 `module-import`가 `optional: true`를 싣는다. 미수출 그룹의 호출자가
  전부 optional이면 `module-import-without-export` error 대신
  `module-import-without-export-optional` warning으로 내린다 — 부재 시
  크래시가 아니라 호출자에게 `null`이 반환되는 정상 경로다. 던지는 호출자가
  섞이면 error를 유지한다.
- bridge-facts v1 확장 `mechanism`: 이름 경계 사실 네 종류(`module-import`·
  `module-export`·`component-require`·`component-export`)가 `react-native`
  target 안에서 `"core" | "expo"` 해석 경로를 선택적으로 싣는다(생략=core).
  Expo `requireNativeModule` 계열은 TurboModuleRegistry 폴백이 있어
  `expo` import가 core·expo export 모두와 잇고, `requireNativeViewManager`는
  폴백이 없어 mechanism 일치만 잇는다. 같은 이름이 mechanism만 다르면
  미수출 error 대신 `module-import-mechanism-mismatch`·
  `component-require-mechanism-mismatch` warning으로 보고하고(Expo
  component-require×core export는 폴백 부재로 error 유지), 불일치 export는
  `incompatibleReceivers` 증거로 보존한다. extract-js는 Expo 전용 API 호출을
  `mechanism: "expo"`로 표시하고, Expo가 아닌 specifier의 동명 래퍼는
  생략한다. Expo DSL 수신 측 스캔은 cartograph·kartograph에 포함됐다.
- `check --format codequality`: GitLab Code Quality 아티팩트 출력이다. 억제되지
  않은 이슈 하나가 첫 증거 끝점의 발견 하나가 되고, `check_name`은
  `isthmus:<진단 코드>`, `severity`는 error→`major`·warning→`minor`,
  `fingerprint`는 SARIF와 같은 논리 이슈 해시다. 형식에 억제 개념이 없어
  베이스라인이 받아들인 이슈는 목록에서 제외한다.

## [0.6.0] - 2026-09-16

### Added

- Android 개발 지원: Kotlin snapshot 기반 preflight·Method/Basic 브리지·플랫폼별 runtime
  후보 대조와 Kotlin-only diff. Swift 없이 고정 소스에서 Android 도구를 구축할 수 있다.
- 실제 Android 앱 검증 하네스: 자체 Kotlin 핸들러와 공개 Pigeon API, 기대 실패·pending,
  같은 capture의 정적 연결과 반복 빌드/캐시를 검사하고 원본 근거를 보존한다.
- `scripts/build-preflight-toolchain.mjs`: 선택한 저장소의 고정 commit만 별도 디렉터리에서
  구축하고 실행 명령·SDK·hash·단계별 시간을 기록한다. 기존 출력 디렉터리를 보호하고
  npm tarball의 격리 설치까지 수행한다.
- `preflight --summary [--limit 1..100]`와 `--explain <selector>`: 전체 검토 상태와 항목 수를
  보존하는 작은 요약, 정확한 key/producer ID/qualifiedName의 전체 원인 경로를 제공한다.
  모호하거나 없는 조회는 근거 JSON과 코드 64를 반환한다. 배포 skill에 이 질의 흐름을 연결했다.
- 선택적 preflight `messages` 입력과 수집 설정: BasicMessageChannel v2의 literal 주소·
  증명된 Pigeon prefix를 MethodChannel과 분리해 정적 후보 및 runtime 근거에 연결한다.
  prefix의 suffix/instance 불확실성을 보존한다. 양쪽 producer의 개발 버전이 필요하다.
- 실제 macOS 앱에서 원본 공개 Pigeon 소스를 명시된 입력에 포함해 정적/native runtime을
  같은 revision으로 검증한다. 소비자 대형 입력과 Basic handler 10,000개 성능 검사를 CI에 추가했다.
- `preflight --expectations <checks.json> [runtime.json ...]`: 전이 분석과 실행 기록을 같은
  revision에서 대조한다. 다른 주소·누락 시나리오·오래된 기대/실행·미완료를 공백으로 보존하고,
  동적 호출에서 찾은 native 후보의 위치를 공유 목록으로 제공한다. 후보를 실제 실행 신원으로 바꾸지 않는다.
- 실제 macOS Flutter 앱의 compiler index→producer→전이 분석→runtime 결합을 검증하고,
  전이 소비자의 호출과 동적 호출을 각각의 시나리오·호출 위치로 기록한다.
- `preflight <context.json>`: producer 전이 영향과 브리지 근거를 연결하고 가장 가까운
  변경 심볼까지의 경로·검토 파일·공백을 출력한다. 실제 Dartograph/Cartograph의 합성
  source→compiler index→전이 분석 연결을 검증했다. 앱 전체 탐지율 검증과는 구분한다.
- 별도 `scripts/capture-preflight.mjs`: 명시된 소스·설정·producer 입력의 내용 해시,
  수집 전후 일치 확인, 캐시 복원, Git 변경/rename/미추적 소스 선택, 원래 producer 근거 저장.
  workflow 회귀 검사를 npm verify에 포함하고 실행 스크립트와 사용 문서를 패키지에 넣었다.
- runtime 기대의 `allowedOutcomes`: 정상적인 실패 시나리오를 명시적으로 검증하며
  기대 실패·비기대 실패 집계를 나눈다. 미완료·pending·stale·유실의 검증 조건은 유지한다.
- `impact --file|--symbol|--changes`: 수정 대상에서 관련 브리지 호출·핸들러·배선과
  검토 파일·진단을 찾는다. 미관찰·동적/미귀속 선택을 보존하며 `--strict`는 관련
  오류뿐 아니라 분석 공백도 실패시킨다. `--compact`는 JSON 정보 손실 없이 공백만 줄인다.
- 배포 isthmus skill에 변경 사전 점검과 개발 소스/발행본 기능 구분을 추가했다.
- `verify-runtime --expectations`: revision·시나리오·플랫폼·엔진 인스턴스별 통신
  관찰을 독립 기대 목록과 대조한다. 실패·미구현·타임아웃·실행 중단·기록 유실·
  오래된 실행·미관찰 기대를 구분한다.
- `impact --runtime <json> --revision <revision>`: 동적 호출의 실제 관찰 주소로
  정적 핸들러 후보와 검토 파일을 넓히고 원래 미해석 사실은 보존한다. 다른 OS/transport를
  추측해 연결하지 않으며 런타임 실패·오래된 기록·유실과 후보 공백도 strict에서 실패한다.
- 선택적 Flutter 패키지 `isthmus_runtime`: 명시 codec·동적 resolver로 outgoing
  MethodChannel/BasicMessageChannel을 관찰한다. 앱 응답·예외·null Future를 보존하고
  인자·반환값·원문 오류를 저장하지 않는다. 실제 macOS Swift/Pigeon 왕복과 실패 경로를 검증했다.
- impact/runtime 보고서에 증거 위치의 기준 `project`를 명시하고 배포 skill의
  snapshot 위치·로컬 파일 링크 구분과 중복 조회 지침을 보강했다.

### Fixed

- Dart 영향 root에 선언 위치가 없어도 실제 query 바인딩의 위치·기존 심볼 종류를 보존한다.
  바인딩·분석 위치 또는 브리지 USR이 충돌하면 조인을 거부한다.
- 같은 이름의 Dart 호출자는 producer가 반환한 실제 ID를 재조회해 파일 위치로 구별한다.
  같은 파일의 상충하는 후보는 임의로 연결하지 않는다.
- 같은 위치에 다른 동적 채널 표현식이 관찰되면 prefix 후보와 미해석 근거에 모두 보존한다.
- Basic handler의 범위·참조·실제 dispatch 후보 근거가 있으면 공통 등록 함수에서 서로
  독립적인 handler로 영향이 퍼지는 것을 막는다. 등록 선언 자체와 공유 등록 의존 변경은
  모든 관련 채널에 전파하며, 근거가 없거나 불완전하면 넓은 후보와 정밀도 공백을 보존한다.
- Flutter recorder는 timeout 관찰 후 실제 Future가 끝나면 실행 완료를 허용한다.
  timeout 결과와 늦은 응답·예외 전달은 유지하고, 아직 응답 대기 중인 호출과 finish 후
  동결된 미완료 기록은 통과로 바뀌지 않는다.

## [0.5.0] - 2026-09-13

### Added

- 공유 인수 파서를 도입해 모든 명령의 옵션이 입력 파일 앞뒤 어디에 와도 동작한다
  (`isthmus graph --format dot a.json b.json`). `--` 구분자 뒤는 모두 위치 인수로
  읽어 `-`로 시작하는 경로·이름도 전달할 수 있다. `-h`/`--help`는 임의 위치에서
  도움말을 내고, `help <command>`가 명령별 사용법을 출력한다.
- 조인 보류(mixed-targets, 종료 코드 2) 메시지가 몇 개의 문서에서 관찰한 fact 몇
  개가 조인되지 못했는지 숫자로 함께 알린다. diff의 비교 보류 메시지도 양쪽
  스냅샷의 관찰량을 함께 알린다.
- query `notFound`·`ambiguous`가 원인 한 줄을 stderr에 출력한다(후보 수 포함).
  종료 코드 64와 stdout JSON 문서는 불변이다.

### Changed

- query `qualifiedName`이 채널·메서드 이름의 `:`까지 퍼센트 이스케이프한다
  (`%`·`#`와 함께). 첫 `:`와 `#` 기준으로 나눈 뒤 디코딩하면 이름이 항상
  되돌아온다. 값이 달라지는 것은 `:`를 이름에 포함하는 채널·메서드뿐이다.
- 공유 CLI 인프라(`readBridgeDocuments`, 입력 오류 분류, 결과 형태)를
  `src/cli/command-support.ts`로 분리했다. SARIF 지문 해싱도 cli 계층으로 옮겨
  `createSarifLog`이 지문 함수를 주입받는다 — report 계층이 더는 Node 내장
  모듈에 의존하지 않는다. `createBridgeDiff`의 반환 형태를 `BridgeDiffDocument`
  인터페이스로 명시했다. 출력은 모두 이전과 같다(위 qualifiedName 항목 제외).

## [0.4.1] - 2026-09-10

### Fixed

- mixed-targets 한계 탐지 시 단어 경계 토큰(`(?<![\w-])mixed-targets(?![\w-])/i`)을 적용해, "non-mixed-targets workspaces" 등 다른 의미의 산문이 포함된 경우 조인을 잘못 보류(exit 2)하던 문제를 수정했다.
- 유효하지 않은 짝 없는 서러게이트(lone surrogate, `\ud800` 등)가 경로·문자열에 포함될 경우 SARIF 리포터에서 `URIError`로 인해 "Internal isthmus error"(exit 2)가 발생하던 문제를 해결하기 위해, 입력 파싱 단계에서 `toWellFormed()` 검사로 사전 거부하도록 했다.
- `retentions` 생성 시 핸들러별 호출자 다중 실림으로 인한 메모리 폭증을 방지하기 위해 문서 전체 호출자 총 예산(`MAX_RETENTION_CALLER_ENTRIES` 1,000,000)을 도입하고 상한 밖 호출자를 사전에 slice하도록 했다.
- `--baseline ''`처럼 빈 문자열 인자가 전달될 때 종료 코드 2가 아닌 사용법 오류(exit 64)로 거부하도록 옵션 검증을 수정했다.
- 베이스라인 원자 쓰기(`writeTextAtomically`)에 모드 `0o600`을 적용하고 fsync 부재 및 심링크 동작 주석을 보강했다.
- 교환 문서 검증 오류 메시지의 고정 문구 "isthmus 0.1 only accepts..."를 현재 버전에 맞게 "this isthmus version only accepts..."로 갱신했다.

## [0.4.0] - 2026-09-10

### Changed

- bridge-facts v1 완화(호환): `sourceLanguage: objective-c` 사실이 `usr` 없는
  `qualifiedName`-only symbol을 가질 수 있다. 인덱스가 없는 환경의 ObjC 핸들러도
  구문 이름 신원을 유지하며, `usr`이 있는 경우 여전히 실제 Clang `c:` 접두만
  허용한다. Swift의 `missing-handler-usrs`와 대칭이고 소비자(isthmus) 선행 배포다.

### Added

- `retentions` 근거의 다중 호출자 확장(external-retentions v0 additive): 메서드를
  여러 위치에서 호출하면 `evidence.callers`에 전체 호출 위치(대표 포함)를 결정적
  순서로 실고, 근거당 100개 상한을 넘으면 `callersOmitted`로 계수를 밝힌다. 대표
  `caller`는 옛 소비자 호환을 위해 유지되고 호출이 하나인 근거의 출력은 기존과
  바이트가 같다. 소비 도구(cartograph)는 알 수 없는 필드를 무시하므로 생산자
  선행 배포가 안전하다(설치본 cartograph 0.10.1로 왕복 검증).
- `check` 문서 `summary`에 관찰량 추가(호환 변경): `observedFacts`(입력 문서 전체의
  fact 총수)와 `observedLimitations`(보고된 분석 한계 수). 브리지가 없는 프로젝트와
  아무것도 관찰하지 못한 실행이 같은 보고서를 내지 않게 한다. 조인 보류 결과도
  관찰량은 보존한다.
- `check --format sarif`: 같은 조인 결과를 SARIF 2.1.0으로 내는 additive 출력(기본값
  `json`은 그대로). 이슈 코드가 규칙 id, 첫 증거 끝점이 주 위치, 나머지 끝점이 관련
  위치가 되고 베이스라인 억제 이슈는 `external` suppression으로 전달된다. 논리 이슈
  식별자의 `partialFingerprints` 해시로 소스 줄 이동에도 중복 판정이 안정적으로
  유지된다. `--strict`·`--baseline`·`--update-baseline`과 조합 가능하다. GitHub code
  scanning 업로드용.

## [0.3.0] - 2026-09-09

### Added

- `check --baseline <file>`·`--update-baseline <file>` (PRD v0.1의 베이스라인 목표).
  인정된 이슈를 isthmus 소유 `isthmus-baseline` 버전 1 문서에 기록하고 다음 실행에서
  논리 이슈 식별자(code·target·channel·method)가 같은 이슈만 `suppressed`로 억제한다.
  사실·증거·심각도는 보존되고 요약 계수와 `--strict`에서만 빠진다. `--update-baseline`은
  파일을 전체 다시 써서 해결된 항목을 자동 정리하고, 맞지 않는 항목은
  `staleBaselineEntries`로 센다. 잘못된 베이스라인 파일은 종료 코드 2로 실패한다.
  설계 근거는 ESLint bulk suppressions·detekt baseline·Trivy `.trivyignore` 조사
  (docs/RESEARCH.md)

### Changed

- diff의 introduced/resolved 이슈 내부 비교 키를 베이스라인과 공유하는 평탄한 논리 키
  (code·target·channel·method)로 단일화. 내용과 결정성은 그대로지만 code가 서로의
  접두사인 경계에서 배열 순서는 이전 버전 출력과 한 번 달라질 수 있다
- 저장소와 npm의 대표 README를 영어로 전환하고, 퇴고한 한글본을 `README.ko.md`로
  분리해 상호 링크했다. npm 패키지에도 두 문서를 모두 싣는다

## [0.2.0] - 2026-09-08

### Added

- bridge-facts v1의 선택적 `limitationScopes`를 검증하고 특정 한계 전체의 채널 상한으로
  사용한다. 범위 불명 공백은 기존 target 전체 완화를 유지하고, 잘못된 범위는 입력 오류다.
  범위는 query/check/graph/diff에 보존되며 범위만 바뀌어도 diff에 나타난다.
- `.m`/`.mm` 구현의 `sourceLanguage: objective-c`를 조인 증거로 보존한다. Swift 그래프
  보존 대상에서 제외한 매치는 `omittedObjectiveCHandlers`로 세고, 표식 없는 Swift 핸들러의
  symbol 누락은 계속 실패한다. 실제 Clang `c:` USR은 증거에 보존하되 Swift 그래프
  포함 여부와 구분한다. 생산자보다 이 소비자 확장을 먼저 배포해야 한다.

### Fixed

- 생산자 tool 이름을 isthmus로 적어 자체 `unjoined-*` 계수를 사칭하는 경로를 막는다.
  소비자 내부에서만 붙인 `origin: consumer`로 직접 계수를 구분한다.
- flutter_local_notifications의 보존된 20건 중 분류 합계가 19건이라는 근거 한계를 정정한다.

## [0.1.7] - 2026-09-08

### Changed

- check·query·graph·diff 출력의 `limitations` 항목에 `target` 필드 추가. 생산 문서의 한계는
  그 문서의 target으로 귀속되고, isthmus가 직접 세는 조인 제외 사실은 플랫폼·target별로
  따로 센다. 텍스트 그래프(DOT·Mermaid)의 한계 주석도 `platform/target/tool` 형태가 된다

### Fixed

- 다른 target의 수신 문서가 신고한 분석 공백이 현재 target의 "핸들러 없는 호출"·
  "등록 없는 채널 생성"까지 경고로 낮추던 문제. 사실은 target별로만 조인되므로 완화
  단위를 진단의 target으로 좁혔다. 사실이 없는(`target: null`) 수신 문서의 공백은
  귀속 근거가 없어 종전대로 모든 target에 적용한다
- `unjoined-*` 접두사를 차용한 생산자 문자열을 공백 완화 근거로 인정하지 않는다.
  이 접두사들은 isthmus가 직접 세는 값이므로 `tool`이 `isthmus`인 항목만 유효하다
- mixed-targets 문서의 한계는 target 귀속 없이 보고한다. 선언한 target은 대표값이라
  신뢰할 수 없지만, 조인에서 제외한 사실 계수는 귀속만 잃고 관찰은 보존한다

## [0.1.6] - 2026-09-06

### Changed

- 수신 측이 분석 공백을 신고하면 "핸들러 없는 호출"·"등록 없는 채널 생성"을 error가 아니라
  `unhandled-invocation-unverified`·`unregistered-channel-creation-unverified` 경고로 보고.
  Flutter 핸들러가 Objective-C로 쓰인 플러그인에서 `check --strict`가 거짓 실패하지 않는다.
  사실과 증거, 한계는 그대로 보고하며 공백의 종류에 따라 채널·메서드 진단을 따로 판단한다

### Fixed

- 발행 사고 정정: npm에 올라간 0.1.5 tarball에는 위 변경이 이미 들어가 있었다. 저장소의
  0.1.5 태그 시점 코드와 달랐으므로 0.1.6이 두 상태를 다시 일치시킨다

## [0.1.5] - 2026-09-06

### Added

- 호출 측(dart·js)·수신 측(swift·kotlin) 플랫폼 문서가 모두 없는 조인 입력을 거부하는
  fail-closed 플랫폼 구성 검증. 한쪽 관찰이 경계 불일치 오류나 빈 보존 근거로 오독되지 않는다
- 조인하지 않은 사실을 isthmus가 직접 세어 `unjoined-dynamic-channels`·
  `unjoined-dynamic-methods`·`unjoined-unattributed-handlers` limitation으로 보고.
  생산자가 신고하지 않거나 신고한 개수가 실제와 달라도 관찰 공백이 보고서에서 사라지지 않는다

### Changed

- `retentions --for cartograph`가 수신 측 Swift 문서를 요구하고, 호출자가 있는데도
  `symbol`이 없어 근거를 만들 수 없는 매치 핸들러가 있으면 부분 보존 문서 대신 종료 코드 2로
  실패. 빈 보존 파일이 살아 있는 핸들러의 삭제 근거로 쓰이지 않는다
- 입력 실패 메시지를 원인(읽기·JSON·교환 계약 위반·project 불일치·크기 상한)과 입력 순서,
  해결 방향으로 구분. contract 위반은 입력 본문을 담지 않는 검증 이유를 함께 전달
- `diff --strict`을 임의의 인자 위치에서 인식하고 중복 `--strict`은 사용 오류로 거부
- `graph` 간선 상한·심볼 충돌 실패를 일반 입력 오류와 다른 메시지로 보고
- CI를 Ubuntu·macOS 매트릭스로 실행

## [0.1.4] - 2026-09-05

### Added

- `diff --before <files...> --after <files...> [--strict]`: 논리 연결·불일치·분석 한계의
  전후 비교와 새 오류에 한정한 CI 종료 코드

### Changed

- 실제 cartograph·dartograph `bridges` 출력을 isthmus와 cartograph 보존 근거까지 왕복 검증
- 왕복 검증에서 cartograph 0.5.3 미만의 stale 바이너리를 fail-closed로 거부
- 생산자 버전을 정확한 형식으로 검증하고 대상 심볼의 retention 근거와 실패 후 정리를 확인
- 격리된 Git 설정과 고정 `plus_plugins` 배터리 플러그인 소스로 USR·원본 위치·
  `--explain` 근거까지 생산·조인·보존 소비를 dogfood
- isthmus 계약을 완성한 dartograph 0.1.1 미만 생산자를 fail-closed로 거부

## [0.1.3] - 2026-09-04

### Changed

- 보류된 조인의 직접 report/query/graph 생성을 거부하고 retention dedup 키 공간 분리
- 생성 없는 채널 등록 경고와 null-channel handler limitation 계약 추가
- Phase 0 Dart·Swift scope/provenance/조건부 컴파일/금지 문자 경계 보강
- 해석하지 못한 Dart receiver와 Swift named-function handler를 limitation으로 보고

## [0.1.2] - 2026-09-04

### Changed

- 아직 조인하지 않는 RN module·component fact를 0.1에서 fail-closed로 거부
- 입력 문서·fact·텍스트 크기 상한과 Unicode 줄 구분자 검증 추가
- clean `dist` 빌드와 검증 subprocess 제한시간·출력 버퍼 적용
- 설치 예시, Phase 0 한계, agent skill의 실패 처리 안내 보강

## [0.1.1] - 2026-09-04

### Changed

- bridge-facts의 추가 필드 제거, 실제 달력 시각·안전한 정수·platform 역할 검증
- project 불일치와 `mixed-targets` 전체 조인을 fail-closed로 처리
- query의 cross-kind 모호성·qualifiedName 우선순위와 graph 간선 상한·심볼 병합 보강
- 임시 retention 파일과 배포 source map 계약 강화
- Dart·Swift Phase 0 추출기의 경로·구문·어휘 범위·오탐 경계 보강
- Phase 0 손 조인을 제품 파서와 동기화하고 표준 검증에 포함

## [0.1.0] - 2026-09-04

### Added

- bridge-facts 버전 1 계약과 Dart·Swift Phase 0 추출 코퍼스
- `channel: null`과 `mixed-targets`에서 조인을 보류하는 안전 규칙
- TypeScript exchange 파서, 논리 키 조인, 세 종류 `check` 진단
- 결정적 `isthmus-check` JSON과 입력 limitations·신선도 보고
- `check <files...> [--strict]` CLI와 종료 코드 `0/1/2/64` 검증
- `retentions <files...> --for cartograph`와 실제 `dead`·`--explain` 왕복 검증
- `query <channel|method> <files...>` 양방향 조회와 qualifiedName 모호성 해소·미발견 응답
- `graph <files...> [--format json|dot|mermaid]` 경계 그래프 출력
- 네이티브 핸들러 변경 전 경계 호출자 확인을 안내하는 배포용 isthmus skill
- 최소 Node 버전에서 전체 검증을 실행하는 SHA 고정 GitHub Actions CI
- 루트·명령별 `--help`와 package metadata 기반 `--version`
- 제품 코드 라인·함수·분기 90% 커버리지 게이트

### Changed

- locale과 입력 순서에 무관한 정렬, 중복 증거 제거, qualifiedName 구분자 이스케이프
- bridge-facts의 timezone 없는 시각과 이름 제어 문자를 거부하도록 입력 검증 강화
- cartograph 보존 문서의 생산 버전을 package metadata와 동기화
