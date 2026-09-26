# API 변경 영향 계획 (API → DB · API → 클라이언트)

_기록: 2026-09-26 · 상태: 승인된 프로그램, Phase 0 진행 중 · 구현 완료나 지원 주장이 아니다_

백엔드 API를 바꿀 때 닿는 DB 객체와 그 API를 부르는 클라이언트 코드를 정적으로 판단하기 위한
다단계 계획이다. isthmus, 언어 생산자(cartograph·kartograph·dartograph 등), schemagraph와
새 생산자가 대상이다. 공유 계약 초안은 [GRAPH-EXCHANGE의 HTTP 경계 합의 초안](GRAPH-EXCHANGE.md#개발-중-http-경계-합의-초안)에
있고, bridge 도메인의 기존 실행 순서는 [PLAN](PLAN.md)에 그대로 남는다. 조사·설계·비평의
원 기록은 저장소 밖 세션 자료라서, 저장소 안에서는 이 문서가 요약 정본이다.
**모든 기간은 1인 + 에이전트 기준 추측이다.**

## 목표

세 질문에 경로 증거와 함께 답한다.

1. **API → DB**: 이 엔드포인트·핸들러를 바꾸면 어떤 테이블·컬럼에 닿는가. DB 안에서는 어떤
   뷰·트리거·FK 참조 테이블이 영향받는가.
2. **API → 클라이언트**: 이 API를 부르는 클라이언트 호출부(iOS/Swift, Android/Kotlin,
   Flutter/Dart, 웹·RN JS/TS)는 어디인가. 그 호출부를 쓰는 화면·ViewModel 같은 클라이언트
   내부 코드는 무엇인가.
3. **테이블 → API → 클라이언트**: 이 테이블·컬럼을 바꾸면 어느 API와 어느 클라이언트
   코드까지 번지는가.

대상 백엔드는 Node/TS(Next·Hono 먼저, 이후 Express·Fastify·NestJS·Koa), Spring(Java/Kotlin),
Django(+DRF), Flask(+SQLAlchemy)다. OpenAPI 스펙이 있는 경우와 없는 경우를 모두 다룬다.

## 범위

- 결과는 **route 단위 영향 후보**다. 요청·응답 본문 필드(DTO), query 파라미터, 헤더의
  호환성은 판정하지 않는다. 실제 API 변경의 다수가 DTO 필드 변경이므로 check 문구와 trace
  출력 머리(`scope`)에 이 한계를 싣는다. 필드 수준 비교가 필요하면 스펙 diff 도구를 함께
  쓰도록 안내만 한다.
- REST over HTTP만 다룬다. GraphQL·gRPC는 조인 키의 의미가 달라 범위 밖이다.
- 정적 분석이다. 어떤 도구도 사용자 앱을 실행하지 않는다. 런타임 오라클(라우트 덤프, 스키마
  export, 모의 서버)은 검증에만 쓴다.
- 저장소 불변식을 유지한다. isthmus는 JSON만 읽고 쓰며 언어 해석은 생산자가 맡는다. 관찰
  근거와 `limitations`를 보존하고, 빈 결과·코드 0을 완전성 증거로 삼지 않는다. 삭제 안전성
  판정·자동 수정은 하지 않으며 trace 결과는 항상 `complete: false`다.
- Next.js server action과 RSC의 직접 DB 접근은 http 경계가 아니다. 언어 내부 경로(TS 생산자
  그래프)로 다룬다. http 체인에 나타나지 않는다고 영향이 없다는 뜻은 아니다.

## 2026-09-26 결정

- **네트워크 경계 도메인 착수 승인.** 작성 시점(2026-09-26)의 로컬 인계 메모(`HANDOFF.md`,
  커밋되지 않은 수정본)는 세 번째 도메인(네트워크 경계)을 남은 확장 후보로 들고 "자동 착수하지
  않는다"고 적고 있었다. 사용자가 이번에 착수를 승인했다.
- **순서는 사용자 앱 우선.** 설계 원안은 기존 자산만으로 양 끝이 닫히는 JVM 수직 조각(Spring
  MVC·Retrofit·JPA)을 척추로 두고, 스펙↔클라이언트 트랙을 곁에 두었다. 그러나 사용자 자신의
  백엔드(사용자 앱 A: Next.js + Prisma, 사용자 앱 B: Hono + D1 — 둘 다 비공개 저장소)는 모두 TS다. JVM 척추로는 사용자
  코드를 오랫동안 검증하지 못하므로, 설계가 대안으로 남긴 "사용자 앱 전체 체인 우선"을
  채택해 [단계](#단계-사용자-앱-우선-재배열)를 재배열했다.
- **새 생산자 저장소 이름은 보류.** 이 문서와 계약 초안은 "TS 생산자"(OpenAPI 변환과 Node/TS
  백엔드)와 "Python 생산자"로만 부른다.

### 설계 입력 정정

- dartograph `schema`는 병합됐다: dartograph `main` `ac560d7`(PR #139). isthmus도
  `e45ef2b`(#114)로 dartograph를 persistence 호출 측 생산자로 등록했다. GRAPH-EXCHANGE의 kind
  표도 이미 Go·Rust·Kotlin·Swift·Dart를 적고 있으므로, 이 표를 고치는 설계 항목은 Phase 0에서 뺀다.
- kartograph change-based-impact는 구현 브랜치가 없다. spec만 kartograph `main`(`12b2cdf`,
  #106)에 있고 승인을 기다린다.
- kartograph `dependencies`는 기존 명령(unused dependency 점검)이다. 정방향 순회는 새 이름(가칭
  `reach`)으로 만든다.

## 아키텍처 요약

```text
생산자 (언어 해석)                                   isthmus (JSON만 읽고 씀)
TS 생산자 openapi ───────── route-contract ──┐
cartograph · kartograph ─── route-call ──────┤   isthmus-workspace (members · links, 선택)
TS 생산자 · kartograph ──── route-decl ──────┼─► parse ─► join ─┬ bridge
각 생산자 schema ────────── relation-use ────┤                  ├ persistence: member 안에서만
schemagraph facts ───────── relation-decl ───┘                  └ http: link 안에서만
                                                                 ─► check · query · graph · diff
생산자 reach · impact, schemagraph impact ── language-traversal ─► trace (route 단위 후보)
```

- **http target**: bridge-facts v1에 target `http`를 더한다. kind는 `route-decl`(서버 라우트
  선언과 핸들러), `route-call`(클라이언트 호출), `route-contract`(스펙 operation) 셋이다. 역할은
  platform이 아니라 kind로 정한다. kotlin·js는 서버도 클라이언트도 될 수 있기 때문이다. 사실이
  0건인 문서도 `roles`로 "스캔했으나 없음"을 표현한다.
- **조인 키**는 (HTTP method, 정규 경로 템플릿)이고 host는 뺀다. 세그먼트 단위 매칭, 구체성
  또는 등록 순서 디스패치, 경로 제약, catch-all 의미는 계약으로 고정한다. 프레임워크별
  변환표는 conformance 벡터에 둔다.
- **귀속 게이트**: route-call은 workspace 매니페스트 link의 `match`(hosts·baseRefs·services·
  interfaces)에 걸리거나, 매니페스트 없이 서비스 문자열이 정확히 같을 때만 판정한다. 나머지는
  개수만 센다. host 휴리스틱으로 잇지 않는다.
- **error 조건**: route-call-without-decl 등은 귀속, 경로 앵커, 템플릿 스코프 단위의 수신 측
  커버리지, 동적 decl 공백 없음, 테스트 소스 아님, 수신 측 route-decl 스캔 문서 있음이 모두
  증명될 때만 error다. 하나라도 빠지면 `-unverified` warning이다. 단 선언 측이 스펙뿐인 link는
  decl 기반 코드를 아예 평가하지 않고 contract 코드만 평가한다.
- **persistence는 member 안에서만** 잇는다. 그래서 클라이언트 로컬 DB(Room 등)와 서버 DB가
  섞이지 않는다. 여러 저장소는 project 단일 규칙을 문서 단위로 지킨 채 `isthmus-workspace`
  매니페스트의 명시 link로 잇고, member 사이 조인은 http만 허용한다.
- **trace 명령**: 새 `trace`(계획)가 `language-traversal` v1 숲을 생산자 id 정확 일치로만 잇는다.
  이 형식은 정방향 `dependencies`·역방향 `dependents`를 담고 `reached[].roots`로 root 출처를
  보존한다. hop은 언어 내부(A), persistence 경계(B), http 경계(C) 셋이고 체인 키는
  `[member, platform, id]`다. 끊긴 곳은 `gaps[]`(예: `handler-without-symbol`,
  `non-http-entry`, `stale-graph`)로 보고한다. 기존 역방향 형식(kartograph-impact, cartograph
  change-impact, dartograph impact)은 어댑터로 받는다. preflight의 Flutter 계약은 바꾸지 않고
  파서·어댑터를 공유한다.
- **공유 규칙**: isthmus `conformance/`에 여러 생산자가 공유하는 suite(http-template,
  url-compose, sql-relations, location-column)와 파일별 sha256 목록을 둔다. 생산자는
  `conformance.lock`으로 벤더링한다. 닫힌 limitation 접두사 목록은 Phase 0에서
  `docs/limitation-prefixes.json`으로 추출해 기계 판독하고 dist에 번들한다. 래퍼 선언용
  `http-wrappers` v1 스키마도 isthmus docs가 소유한다. 모두 아직 없는 계획 산출물이다.

## 단계 (사용자 앱 우선 재배열)

공수 척도는 S ≤1주, M 1~3주, L 3~8주, XL 2개월 이상이다(추측). 아래 단계별 기간을 겹치지 않고
순서대로 더하면(1개월 ≈ 4.3주) 가치 게이트(Phase 3 끝)까지 약 7~11개월, Python 생산자까지 약
15~24개월이다(추측). 설계 원안(JVM 척추)의 추정은 각각 7~11개월, 16~22개월이었다. TS 생산자를
가치 게이트 앞으로 당긴 만큼 kartograph 라우트·JPA 작업을 Phase 4로 미뤘기 때문에 게이트까지의
합은 비슷하다(추측). 각 Phase의 거짓 error가 1건이라도 남으면 그 Phase는 끝나지 않는다.

### Phase 0 — 기반 (isthmus M, schemagraph S, 약 3~6주, 추측)

새 target을 넣기 전에 platform 기반 역할 판정 누수를 막는다. persistence 조인 결과(사용↔선언
쌍과 symbol)를 밖으로 내보내고, http 계약 초안을 합의에 올린다.

- 착수 게이트 기록: 이 문서(승인, 순서, 이름 보류, 설계 입력 정정).
- isthmus: platform만 보고 역할을 정하는 곳을 target 기반 명시 규칙으로 고치고 곳마다 재현
  테스트를 둔다. 대상은 diff `validateSnapshots`, retentions, preflight-view `isReceiverEndpoint`,
  check-report `receiverCoverageGaps`, preflight-context `parseBridges`, preflight-runtime의
  네이티브 플랫폼 계수, join의 bridge 구성 검사다. impact `selectFacts`가 고른 persistence
  사실은 `hasImpactBlockers`에서 `--strict` blocker로 센다.
- isthmus: `check --pairs`(opt-in, 사용↔선언 쌍과 양쪽 symbol), `query relation:<name>`,
  컬럼 이슈 누락 수정.
- isthmus: `docs/limitation-prefixes.json` 추출과 dist 번들(출력 바이트 동일),
  `compatibility.json` producers 행 갱신(schemagraph 추가, kartograph 현행화)과 설치본 검증 지원.
- isthmus: GRAPH-EXCHANGE HTTP 합의 초안. 합의만 받고 구현은 Phase 1에서 한다.
- schemagraph: impact/query JSON의 format·version 헤더, `impacted[].via`, facts `relation-decl`의
  `symbol.usr` = VertexId.
- 문서: `--pairs`의 usr를 생산자 impact에, VertexId를 schemagraph impact에 넣는 수동 왕복 절차.
- 스파이크(사용자 앱 관련만 앞당김)
  - S2: 앱 A Android(최신 AGP·Gradle·Kotlin 조합의 멀티모듈)에서
    저장소 밖 init script로 kartograph 스냅샷·usr 부착·역방향 분석이 되는지 확인한다. 안 되면
    `--classes` 수동 경로를 쓴다.
  - S4: 앱 A의 HTTP 래퍼(Android·iOS)를 수작업으로 판정한다. 세그먼트 보간·query 꼬리 규칙만으로 스펙
    경로 전수를 판정할 수 있는지 본다.
  - JVM 전제 스파이크(S1 오프라인 오라클, S3 Spring Data 상속 CRUD의 호출 id, S5 Kotlin
    `const val` 어노테이션 값)는 Phase 4로 옮긴다.

종료 조건: `npm run verify`와 GLM 리뷰 통과. `--pairs` 없는 check·baseline·SARIF·codequality
출력과 구성 검사 결과가 바이트 단위로 같다. 재현 사례가 기대대로 바뀐다(diff는 원인 문구로 거부,
retentions는 exit 2, impact `--strict`는 exit 1). persistence 픽스처에서 `--pairs`의 usr·VertexId가
해당 생산자 query로 100% 해석된다. S2·S4의 go/no-go와 대체 경로가 기록된다. no-go면 Phase 1의
앱 A 종료 조건을 수작업 목록 대비 재현율 보고로 낮춘다.

### Phase 1 — http 도메인 코어와 스펙↔클라이언트 check (isthmus L, TS 생산자 골격 M, cartograph M, kartograph M, 약 8~13주, 추측)

서버 생산자 없이 앱 A의 두 질문에 호출부 단위로 답한다: "iOS·Android가 스펙에 없는 경로·
동사를 부르는가", "이 스펙 operation을 부르는 호출부는 어디인가". http 계약·조인·귀속 규칙을
두 선언 원천(스펙, 합성 decl)과 두 호출 원천(Swift·Kotlin 래퍼)으로 먼저 검증한다.

- GRAPH-EXCHANGE §http 개정('개발 중' 표기, 이 Phase가 쓰는 필드만)과 자매 저장소 합의 기록.
- isthmus 코어
  - parse: kind 역할, roles, 0건 http 문서, 정규 문법 검증, 오배치 필드 거부.
  - 조인: 세그먼트 trie, route 조인(구체성·등록 순서·경로 제약·suffix·catch-all·HEAD/OPTIONS),
    귀속 게이트, route-contract 3자 조인(call↔contract, decl↔contract 드리프트).
  - 보고: http limitationScopes, check 코드와 rules, 진단 신원 `scope`, `query route:`,
    graph route 간선(단일 project), impact의 http 선택 blocker.
  - workspace v1은 check·query만 받고, 나머지 명령은 원인 문구로 거부한다. MCP check에 반영한다.
  - route-decl 조인은 이 Phase에서 합성 문서로만 검증한다(실제 생산자는 Phase 2).
- isthmus: `conformance/` 골격, http-template·url-compose suite(마스킹 포함), `http-wrappers` v1
  스키마, 래퍼 후보 제안 모드(사실로 내지 않음).
- TS 생산자 골격과 `openapi` 하위 명령: OAS 2.0/3.0/3.1을 `route-contract`로 바꾼다. `--service`를
  받고, servers path·basePath를 합성하며 host는 버린다. 로컬 `$ref`만 해석하고 크기·alias·깊이
  상한을 두며 네트워크는 쓰지 않는다.
- cartograph: 선언 래퍼 호출과 URLRequest 리터럴의 `route-call`, USR, Swift 보간·query 꼬리 규칙,
  테스트 타깃 제외, 마스킹. swift-openapi-generator를 감지하면 `generated-client-unscanned:`를 낸다.
- kartograph: 선언 래퍼 호출과 HttpURLConnection 리터럴의 `route-call`(소스 스캐너 경로), 같은
  파일 `const val`, Kotlin 문자열 템플릿·query 꼬리 규칙, 멀티모듈, 테스트 소스 제외.

종료 조건: 앱 A iOS·Android 래퍼 호출 전수(수작업 목록)와 추출 결과가 일치하고 거짓 error가
0건이다. query 꼬리를 증명하지 못한 호출은 dynamic과 `channelPrefix`로 나오고 판정에 쓰이지 않는다.
스펙 변이(경로 이름·동사·끝 슬래시)마다 기대한 진단이 나온다. authoritative를 선언하지 않은
link는 error가 0건이다. 스펙만 있는 link의 root 래퍼 호출 음성 fixture에서
`route-call-without-decl`·`route-method-mismatch`가 `-unverified` 변형까지 0건이다. 테스트 소스의
가짜 호출(테스트용 가짜 host 등)은 사실로 나오지 않는다. 래퍼 선언의 owner를 바꾸면 `http-wrapper-unresolved:`가 나온다. 0건 client 문서가 exit 2
없이 받아지고 bridge 요건을 채우지 않는다. 합성 decl 음성 fixture(`/users/me` 대 `/users/{}`,
`/files` 대 `/files/{**}`와 접두사 decl, 끝 슬래시·대소문자, 등록 순서 가림, root call 대 base
decl)가 기대대로 나온다. 명시적 `/files`와 `/files/{*path}`가 공존하면 `GET /files` 호출은 명시적
decl에만 match하고 `ambiguous-route-call`·`route-decl-conflict`가 나오지 않는다.
두 link가 같은 키에 진단을 내도 codequality·baseline이 섞이지 않는다. 스펙 파서 보안 시험과
lock sha가 같은 벡터를 통과하고, `npm run verify`가 통과한다.

### Phase 2 — TS 생산자: 사용자 앱 A·B의 API → DB (TS 생산자 L~XL, isthmus L, schemagraph S, 약 3~5개월, 추측)

앱 A(Next + Prisma)와 앱 B(Hono + D1)에서 "이 route를 바꾸면 이 테이블·컬럼과 DB 의존자에
닿는다"를 route 선택부터 경로 증거와 함께 보여 준다.

- TS 생산자 route-decl: Next App/Pages Router와 basePath, Hono. 프레임워크별 dispatch 모델은 착수
  시 공식 소스로 확인해 벡터로 고정한다. 현재는 추정이다(Next는 specificity, Hono는
  registration-order). 등록 순서 프레임워크는 `order`와 `route-decl-shadowed` 근거를 싣는다.
- TS 생산자 persistence `relation-use`: Prisma(lockfile 버전으로 이름 규칙 선택. 앱 A는 7.x라
  모델명 그대로와 `@@map`), D1 `prepare`/`batch`/`exec`의 리터럴 SQL(sql-relations suite).
- TS 생산자 graph/impact/`reach`를 roots가 있는 `language-traversal` v1로 직접 낸다. scheduled·
  queue 진입점을 표시한다.
- isthmus: platform js의 route-decl, `language-traversal` v1 파서, `isthmus-trace-context` v1 →
  `isthmus-trace` v1(단일 project, 정방향), schemagraph 어댑터, `scripts/capture-trace.mjs`,
  preflight와 모듈 공유, package files 반영.
- schemagraph: impact의 `language-traversal` v1 출력(dependents, via, roots)과 다중 subject.
- 카탈로그 capture: 앱 B는 저장소의 SQLite 마이그레이션을 로컬 SQLite에 적용해 schemagraph
  카탈로그를 만든다(wrangler 명령은 착수 시 확인). 앱 A의 카탈로그 원천(Prisma 마이그레이션 또는
  DDL)은 착수 시 정한다.
- 나머지 Node 프레임워크(Express·Fastify·NestJS·Koa), ORM(TypeORM·Sequelize·MikroORM·Drizzle·
  Knex), 웹·RN `route-call`은 가치 게이트 뒤에 TS 생산자 확장으로 순서를 다시 정한다.

종료 조건: 런타임 라우트 목록(Next build manifest 등) 대비 route-decl 정밀도 100%이고 재현율을
공개한다. 등록 순서 fixture에서 실제 디스패치 핸들러로 이어지고 `route-decl-shadowed`가 나온다.
DDL 오라클(`prisma migrate diff --script` 등) 대비 relation-use-without-decl 거짓 error가 0건이다.
버전을 모르면 결과가 갈리는 이름만 dynamic이다. 앱 A에서는 decl↔contract 드리프트 보고와
route → Prisma 테이블 → DB 의존자 trace가 나온다. 앱 B에서는 D1 `prepare` 사용이 migrations
테이블과 거짓 error 없이 조인되고, scheduled 진입점은 `non-http-entry` gap으로 나온다. trace
재실행 출력이 바이트 단위로 같고, 출력의 모든 id가 생산자 query로 해석된다(100%).
location-column 벡터(UTF-16 열 회귀 방지)를 통과한다.

### Phase 3 — trace·workspace 다중 저장소와 가치 게이트 (isthmus L, cartograph S, kartograph S, 약 5~8주, 추측)

원 요청 문장 전체를 저장소가 나뉘어도 한 명령으로 보여 준다: "이 API를 바꾸면 이 테이블들과
이 클라이언트 호출부, 그리고 그 호출부를 쓰는 클라이언트 코드가 영향받는다".

- trace 클라이언트 continuation: kotlin은 kartograph impact, swift는 cartograph change-impact
  또는 클라이언트 macOS CI가 미리 계산한 artifact를 쓴다.
- trace 선택과 방향: 테이블→API→클라이언트, symbol·files selection, workspace 입력, 형제 전파
  opt-in. files는 파일 단위 과대 근사(`file-selection-coarse`)와 사실 위치 fallback을 쓴다.
- http diff: surface 모드(서버·스펙 단독), workspace 모드, base..head CI 모드.
- workspace 확장: `contract.member`, catalog 기록, 여러 revision의 클라이언트 member(릴리스
  태그), 사전 계산 분석 수용(revision·sha 검사), 두 저장소 CI 예제.
- MCP 노출 결정(trace, `--pairs`, 출력 상한).

종료 조건: 분리된 두 git 저장소 fixture에서 API·테이블·DB 의존자·호출부·클라이언트 영향
심볼을 모두 담은 보고서가 나온다. gap 코드마다 음성 fixture가 기대대로 보고된다. `--strict`
종료 코드 의미를 테스트로 고정한다. 앱 A에서 route 변경 → Prisma 테이블 → iOS·Android
호출부 → 클라이언트 영향 심볼의 전체 체인이 나온다. **가치 게이트**: dogfooding 결과를 기록하고
Phase 4~6의 순서를 다시 정한다.

### Phase 4 — Spring: kartograph 라우트와 JPA 교정 (kartograph L+L, isthmus S, 약 3~5개월, 추측)

- 원안 Phase 0에서 옮긴 스파이크: S1(오라클 의존성 확보, 안 되면 GitHub Actions), S3(`repo.save`
  호출 대상 id와 owner 규칙), S5(Kotlin `const val` 어노테이션 값을 javap로 확인).
- kartograph PRD 범위를 개정한다. 어노테이션 값 보존은 change-based-impact spec의 스냅샷 변경과
  순서를 합의한 뒤 넣는다.
- `routes --role server|client`를 만든다. Spring MVC는 클래스×메서드, composed·메타 어노테이션,
  context-path, WebFlux base-path, 플레이스홀더 기본값, trailingSlash, narrowed, paramConstraints,
  framework-provided-routes를 다룬다. Retrofit은 `@GET` 계열·`@HTTP`, `@Url`(dynamic), baseRef,
  서비스 인터페이스 id를 다룬다.
- kartograph JPA 교정: `@Table`·`@Column`·`@JoinColumn`, 임베디드·상속·`@ElementCollection`,
  Boot 3·4 명명 전략 버전 감지, JPQL 모드. 그리고 `reach`.

종료 조건: 공개 Spring 앱의 `/actuator/mappings` 대비 route-decl 정밀도 100%이고, 재현율과 error
판정 가능 비율을 공개한다. Retrofit 템플릿이 MockWebServer 기록 경로와 일치한다. 명명 벡터가
Hibernate 6·7 스키마 export와 100% 일치한다. 같은 스냅샷에서 `reach(H) ∋ U ⇔ impact(U) ∋ H`가
성립한다.

### Phase 5 — Flutter·iOS 라이브러리 확장 (dartograph L, cartograph M, 약 2~3개월, 추측)

- dartograph `route-call`(package:http, dio, retrofit.dart, chopper)과 usr 헬퍼.
- cartograph URLSession·URLComponents·Alamofire·Moya, roots가 있는 `language-traversal` 출력.
- trace의 dart continuation.

종료 조건: 모의 서버에 기록된 실제 요청과 일치한다(dio 단순 연결, retrofit.dart 이중 규칙, Moya
`?` 인코딩 사례 포함). Dart binding 실패는 gap으로만 나온다. url-compose·http-template 벡터를
Dart·Swift 러너가 100% 통과한다.

### Phase 6 — Python 생산자 (새 저장소 XL, 약 3~5개월, 추측)

- Django(+DRF)·Flask 라우트(registration-order와 order, 변환기 paramConstraints, FBV의 `ANY`),
  persistence(Django app_label·db_table·FK·M2M·식별자 절단, SQLAlchemy, Flask-SQLAlchemy 3),
  graph/impact/reach. isthmus에 platform python을 추가한다.

종료 조건: resolver 순회·DRF router·Flask url_map 덤프 대비 route-decl 정밀도 100%. Django
백엔드 × iOS/Android 체인 fixture에서 세 질문의 기대 경로가 일치한다.

### Phase 7 (선택) — 조직 경계와 확장

http-surface export/import(매니페스트로 묶을 수 없는 조직), 공유 SDK 저장소용 libraries link,
서버 측 명령형 클라이언트(RestTemplate·WebClient·RestClient), gartograph·rustograph의
relation-use symbol, preflight를 trace 코어 위의 얇은 래퍼로 수렴.

## 미결 결정

| 결정 | 현재 권고 | 정할 때 |
|---|---|---|
| 새 생산자 저장소 이름 | 사용자 결정(보류) | 새 저장소를 만들기 전(Phase 1) |
| 사실 0건 http 문서 표현 | target `http` + `roles`, http 한정 target-null 예외 | Phase 1 계약 합의 |
| openapi 문서의 `roles`, `authority` 정규화 | [계약 초안의 미결 항목](GRAPH-EXCHANGE.md#미결-항목) | Phase 1 계약 합의 |
| 앱 A DB 카탈로그 원천 | Prisma 마이그레이션 또는 DDL 중 착수 시 확인 | Phase 2 |
| MCP에 trace·`--pairs` 노출 | 출력 상한과 함께 노출 | Phase 3 |
| 가치 게이트 뒤 순서 | Spring → Flutter·iOS → Python(재확인) | Phase 3 끝 |
| change-based-impact spec 승인과 스냅샷 변경 순서 | spec 먼저, 어노테이션 값은 그 위 선택 필드 | Phase 4 전 |
| 플레이스홀더 기본값(`${key:default}`) | 저장소 안 재정의가 없을 때만 기본값과 `configDefault` 증거 | Phase 4 |
| kartograph 정방향 명령 이름 | `reach` | Phase 4 |
| Python 생산자 구현·배포 | stdlib `ast`, 배포 방식(pipx·uv 등) 선호 확인 | Phase 6 전 |
| 스펙 operation → 핸들러 확장 필드 | 보류 | Phase 7 이후 |

## 주요 위험

| 위험 | 대응 |
|---|---|
| 앱 A 래퍼가 동적 query 꼬리를 경로 상수 뒤에 붙인다. 그래서 핵심 목록 호출이 dynamic이나 0건이 되어 "호출 없음"으로 오독될 수 있다 | S4로 미리 판정한다. 공통 보간 규칙을 두고, 증명하지 못한 꼬리는 dynamic과 `channelPrefix`로 후보로만 보인다. 낡은 선언은 `http-wrapper-unresolved:`, 선언 없는 직접 호출은 `http-wrapper-undeclared:`로 드러낸다 |
| 앱 A Android 툴체인(최신 AGP·Gradle·Kotlin)이 kartograph 검증 조합 밖일 수 있다 | S2에서 저장소 밖 init script와 `--classes` 수동 경로를 실측한다. 사용자 저장소는 수정하지 않는다 |
| 스펙만 있는 link에는 핸들러가 없어 API → DB가 끊긴다 | Phase 1은 호출부 판정까지만 약속한다. Phase 2부터 trace는 스펙만 있는 link를 `handler-without-symbol` gap으로 명시하고, TS 생산자가 route-decl을 채운다 |
| 사용자 앱 우선 재배열 때문에 http 계약이 JVM 원천 없이 굳을 수 있다(Spring 조립·디스패치 규칙이 늦게 검증됨) | Phase 4까지 §http를 '개발 중'으로 둔다. Spring 경계 사례(`{*path}`, 경로 제약, 끝 슬래시 기본값)는 문서 출처로 http-template 벡터에 먼저 넣는다 |
| 거짓 error 벡터: 프레임워크 제공 경로, 등록 순서 디스패치, 정규식 경로 제약, 테스트 소스 | error 전제 6조건, `framework-provided-routes:`, `dispatch`·`order`, 닫힌 제약 종류만 평가, 테스트 소스 기본 제외로 막는다. 규칙마다 음성 fixture를 둔다 |
| member 전체 완화와 귀속 게이트 때문에 실제 앱에서 error가 거의 0이 되어 가치가 낮아 보일 수 있다 | http limitationScopes로 템플릿 단위로 좁힌다. link `interfaces` 선언을 둔다. error 판정 가능 비율을 측정해 공개한다 |
| route 단위 결과를 DTO 호환성 판정으로 오독할 수 있다 | trace `scope`와 check 문구, 문서에 "필드·query·헤더 호환성은 판정하지 않음"을 싣는다 |
| route-call 원문에 비밀이 든 URL(웹훅 등)이 CI artifact로 저장소 밖에 나갈 수 있다 | 생산자 마스킹과 `--route-call-hosts`를 둔다. isthmus는 귀속되지 않은 호출의 원문을 graph·diff·SARIF·MCP를 포함한 어떤 출력에도 싣지 않는다 |
| 이름 규칙이 버전마다 바뀐다(Prisma 7→8, Boot 3→4) | 해석된 의존성 버전을 우선 쓴다. 버전을 모르면 결과가 갈리는 이름만 dynamic으로 내리고 실제 프레임워크 실행으로 벡터를 만든다 |
| 범위 폭증(백엔드 4종, 클라이언트 4종, XL 생산자 2개, 1인 유지보수) | 가치 게이트에서 순서를 다시 정한다. TS 생산자는 부분별로 배포할 수 있게 나눈다. 스파이크가 no-go면 범위를 줄여 이 문서를 갱신한다 |

## 검증 원칙

- 규칙마다 음성 fixture를 두고, 실제 추출기가 만든 golden을 `experiments/<phase>/`에 고정한다.
- conformance 벡터 케이스에는 provenance 등급(실행 > 소스 > 문서 > 미검증)·versionRange·
  appliesTo를 싣는다. 미검증 케이스는 구체적인 이름을 가질 수 없다.
- 런타임 오라클은 검증 전용이다. 지표는 사실 정밀도(목표 100%), 재현율(수치 공개), limitation
  신고의 적절성, error 판정 가능 비율이다.
- 왕복: 생산자 문서는 전부 isthmus parse를 통과하고, `--pairs`·trace 출력의 모든 usr·VertexId는
  해당 생산자 query로 해석돼야 한다(100%). 두 번 실행한 출력은 바이트 단위로 같아야 한다.
- dogfooding은 읽기 전용이다. 사용자 앱 저장소를 수정하지 않고, Gradle 연결은 저장소 밖
  init script로만 한다.
