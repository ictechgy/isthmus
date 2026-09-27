# http route 표면 비교 (`isthmus diff --http`)

_기록: 2026-09-28 · 상태: 개발 중(Phase 3 소비자 — surface·workspace·base..head CI) · [API 변경 영향 계획](API-IMPACT-PLAN.md)_

```bash
# surface 모드: 서버·스펙 한 벌의 base와 head, 선택적으로 고정한 클라이언트
isthmus diff --http --before <server/spec.json...> --after <server/spec.json...> \
  [--clients <client.json...>] [--fail-on <tokens>] [--strict] [--compact]

# workspace 모드: base와 head의 isthmus-workspace 매니페스트
isthmus diff --http --before base.workspace.json --after head.workspace.json \
  [--fail-on <tokens>] [--strict] [--compact]
```

한 서버(또는 스펙)의 http 표면을 두 시점에서 비교하고, **base에서 결합하던 클라이언트 호출이 head에서
결합하지 않게 되는지**를 보고한다. route 단위이며 요청·응답 본문 필드, query 파라미터, 헤더 호환성은
판정하지 않는다(`scope.fieldCompatibility`·`scope.queryAndHeaders`가 `not-assessed`). 필드 수준 비교는 스펙
diff 도구를 함께 쓴다. 조인·귀속·매칭 규칙은 [GRAPH-EXCHANGE의 http 절](GRAPH-EXCHANGE.md#개발-중-http-경계-v1-확장)을
그대로 쓴다 — 새 매칭 규칙을 만들지 않는다. 결과는 관찰 차이이며, **빈 findings나 종료 코드 0은 "깨지는
클라이언트가 없다"는 증거가 아니다.** 귀속·스캔이 불완전하면 그 사실을 명시한 incompleteness finding이 반드시
나온다.

기존 bridge `diff`(`isthmus diff --before … --after …`)의 입력·출력·종료 코드는 그대로다. `--http`는 `diff`
바로 다음 인수여야 한다(경로 목록 안의 문자열이 모드를 바꾸지 못하게 위치로 고정했다). `--http` 없이 http
문서를 주면 이전처럼 원인 문구와 함께 2로 거부한다.

## 설계 결정

계획은 "surface 모드(서버·스펙 단독), workspace 모드, base..head CI 모드"라는 이름만 정한다. 열린 선택을 다음처럼
정했다.

- **새 명령이 아니라 `diff --http`.** 기존 `diff`가 "두 시점의 관찰 차이" 명령이고 http 문서를 원인 문구로
  거부하던 자리다. 모드 구분 인수를 `diff` 바로 뒤로 고정해, MCP처럼 경로 목록을 그대로 넘기는 호출자가
  경로 문자열로 모드를 바꿀 수 없게 했다. MCP `diff` 도구는 바뀌지 않는다(bridge 전용).
- **새 출력 형식 `isthmus-http-diff` v1.** bridge `isthmus-diff` v1의 필드(`addedMethods` 등)는 bridge 논리 키라
  http route를 담을 자리가 없다. 기존 필드의 뜻을 바꾸지 않으려고 형식을 나눴다.
- **호출은 한 벌만 평가한다(교차 평가).** 같은 클라이언트 호출 집합을 base 선언 측과 head 선언 측에 각각
  조인해 결합 결과를 비교한다. base 호출과 head 호출을 따로 조인해 호출 신원으로 짝지으면, 줄이 움직였거나
  클라이언트도 함께 바뀐 호출이 "사라짐"으로 보여 실제 깨짐을 놓친다(거짓 "깨짐 없음" 방향). 교차 평가는 서버
  변경만의 영향을 분리한다.
  - surface 모드는 호출 문서를 `--clients`로 **한 번만** 받는다. 어떤 클라이언트를 기준으로 할지(원자 배포하는
    모노레포면 head 클라이언트, 앱 스토어에 나간 모바일이면 릴리스 태그의 클라이언트)는 사용자가 고른다.
    `--before`·`--after`에 클라이언트 전용 문서(roles가 `["client"]`)를 넣으면 2로 거부한다.
  - workspace 모드는 **head 매니페스트의 client member** 호출을 평가한다("서버 member가 바뀌고 클라이언트 member는
    그 revision에 머문다"). base 매니페스트에서는 link의 server·contract member 문서만 읽는다 — client로만 쓰이는
    member의 base 문서는 읽지 않는다(읽고 버리지 않기 위해서다).
- **route 신원은 (scope, 측, pathAnchor, method, 정규 템플릿).** 측은 `decl`(route-decl)과 `contract`
  (route-contract)이며 따로 비교한다. method나 템플릿이 바뀐 route는 삭제 하나와 추가 하나다 — rename·
  대체를 추론하지 않는다(bridge diff와 같은 원칙). 같은 키의 속성(경로 제약·끝 슬래시·catch-all 접두사 여부·
  대소문자)은 키에 속한 정적 선언 사실들의 값 집합으로 비교한다. 핸들러 심볼·위치 변화는 차이가 아니다.
- **결합(bound)의 기준은 check와 같은 매처.** 호출이 한 선언 측에서 `matched`면 그 target들에 결합한 것이다.
  `ambiguous`는 후보 중 하나에 결합했을 수 있는 것으로 보고, 그 위의 깨짐은 항상 `-unverified`다.
- **error는 전제가 모두 증명될 때만**(check의 error 전제를 diff에 옮긴 것). 하나라도 빠지면 `-unverified`
  warning이고 호출마다 `reasons`에 빠진 전제를 싣는다([아래](#error-전제)).
- **스펙 측 깨짐의 error는 authoritative 계약에서만.** 스펙에서 operation이 빠져도 서버가 그 경로를 계속 받을
  수 있다. workspace link의 `contract.authoritative: true`("이 클라이언트는 이 스펙에 있는 것만 부른다")일 때만
  error이고, 매니페스트가 없는 surface 모드의 contract 측 깨짐은 항상 `-unverified`다.
- **입력 구성 차이는 관찰 차이가 아니다.** 두 시점의 선언 측 문서 인벤토리(platform·도구 이름·스펙 여부별 개수)가
  다르면 2로 거부한다. 부분 추출과 전체 추출을 비교하면 모든 route가 삭제·추가로 보이기 때문이다(bridge diff와
  같은 규칙). project도 두 시점(surface는 `--clients`까지)이 같아야 한다 — 같은 checkout 경로에서 revision만
  바꿔 생산한다.

## 입력

### surface 모드

- `--before`·`--after`: 한 서버·스펙의 선언 측 http 문서(target `http`이고 roles에 server가 있거나 route-decl·
  route-contract 사실이 있는 문서, 사실 0건 openapi 문서 포함). 각 시점에 하나 이상. 서버와 클라이언트를 겸하는
  문서(BFF)는 선언 측으로만 쓴다(그 문서의 route-call은 이 비교에 들지 않는다).
- `--clients`(선택): 호출 측 문서(roles에 client). 서버를 겸하는 문서는 호출 측으로만 쓴다. 없으면 호출 영향을
  평가하지 않고 표면이 바뀐 scope마다 `clients-unscanned`가 나온다.
- 모든 문서의 `project`가 같아야 한다. bridge target 문서와 persistence·sql 문서는 거부한다. 문서는 세 목록을
  합쳐 256개 이하이고 입력 텍스트 상한은 다른 명령과 같다.
- scope는 매니페스트 없는 귀속 규칙 그대로다: 선언 측 service 문자열(없으면 `default`). base와 head의 scope는
  이름으로 짝짓는다. service가 바뀌면 옛 scope의 route는 삭제, 새 scope의 route는 추가로 보이고 옛 scope에
  결합하던 호출은 head에서 귀속되지 않아 `-unverified` 깨짐이 된다.

### workspace 모드

`--before`와 `--after`에 각각 `isthmus-workspace` v1 매니페스트 하나를 준다
([GRAPH-EXCHANGE 매니페스트](GRAPH-EXCHANGE.md#다중-저장소-workspace-매니페스트-예외)). 한쪽만 매니페스트면 2다.

```json
{
  "format": "isthmus-workspace", "version": 1,
  "members": [
    { "name": "server", "project": "/work/example-server", "revision": "srv-head",
      "documents": ["server/server.http.json", "server/api.openapi.json"] },
    { "name": "client", "project": "/work/example-client", "revision": "cli-release-3.2",
      "documents": ["client/android.http.json"] }
  ],
  "links": [
    { "name": "mobile->api", "client": "client", "server": "server",
      "match": { "hosts": ["api.example.com"] } }
  ]
}
```

- member·link 파싱은 [trace workspace context](TRACE.md#입력-workspace-저장소가-나뉜-서버클라이언트)와 같은 코드다.
  같은 제한을 따른다: member `revision` 필수, `match`는 `hosts`·`services`·`baseRefs[].ref`만(`interfaces`·
  `pathPrefix`는 거부), `contract: {member, documents, authoritative?}`. member에 `analyses`는 받지 않는다(diff는
  순회를 쓰지 않는다). 상대 경로는 매니페스트 파일이 있는 디렉터리 기준이다.
- **두 매니페스트의 link 정의가 같아야 한다**(이름·client·server·`match`·`contract.member`·`authoritative`).
  link를 바꾸면 귀속이 바뀌어 선언 측 변화와 섞이므로 2로 거부한다. link의 server·contract member는 두 매니페스트
  모두에 같은 `project`로 있어야 한다. `revision`과 문서 목록은 달라도 된다(그것이 비교 대상이다).
- link 하나가 scope 하나이고 이름이 link 이름이다. base 조인 = base 매니페스트의 server·contract 문서 + head의
  client 문서, head 조인 = head의 server·contract 문서 + head의 client 문서다. 귀속·서비스 범위는 trace link 조인과
  같다(`match.services`, `link-service-ambiguous`).
- member 문서 중 persistence·sql 문서는 매니페스트를 여러 명령이 같이 쓰므로 받되 이 비교에 쓰지 않는다. bridge
  target 문서는 거부한다. 문서의 `project`는 자기 member의 `project`와 같아야 한다.
- head 매니페스트에서 어느 link에도 client로 들지 않은 member의 client http 문서는 `http-member-unlinked`다.
- 입력 오류 문구는 경로 대신 순번을 싣는다. surface는 `--before`·`--after`·`--clients` 순서, workspace는 base 매니페스트의
  server·contract member 문서(member 순서) 다음 head 매니페스트의 모든 member 문서 순서다.

### base..head CI 모드

CI 모드는 별도 입력 형식이 아니라 위 두 모드를 base·head 커밋에서 만든 문서로 돌리는 운영 방식이다.

1. **같은 checkout 경로에서** base 커밋을 체크아웃해 생산자를 실행하고 JSON을 보관한다. 그다음 head 커밋으로
   바꿔 다시 실행한다. `project`는 checkout 경로 문자열이라 `git worktree`로 다른 경로에 꺼내면 project가 달라져
   2로 거부된다.
2. 모노레포(서버·클라이언트가 한 저장소)면 surface 모드로 돌리고 `--clients`에 head의 클라이언트 문서(원자 배포)나
   릴리스 태그에서 만든 클라이언트 문서(배포된 앱)를 준다. 두 벌을 모두 보려면 명령을 두 번 돌린다.
3. 저장소가 나뉘면 서버 저장소 CI가 base·head 서버 문서를 만들고, 클라이언트 저장소 CI가 릴리스마다 올린 클라이언트
   문서 artifact를 내려받아 base·head 매니페스트 두 개를 쓴다(server member만 다르다).
4. `--fail-on`으로 실패 조건을 정한다. 권장값은 `--fail-on error,incomplete`(증명된 깨짐 또는 판단을 막는 공백)이고,
   증명되지 않은 깨짐까지 막으려면 `removed-bound-route-unverified,changed-bound-route-unverified`를 더한다.

```yaml
# .github/workflows/http-diff.yml (예시 — `ci/produce-http-facts.sh`는 저장소가 정하는 생산자 실행 스크립트 자리표시자다)
name: http-diff
on: pull_request
jobs:
  http-diff:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - name: base 문서 생산
        run: |
          git checkout --quiet "${{ github.event.pull_request.base.sha }}"
          ./ci/produce-http-facts.sh server "$RUNNER_TEMP/base.http.json"   # 저장소가 정한 생산자 실행(자리표시자)
      - name: head 문서 생산
        run: |
          git checkout --quiet "${{ github.event.pull_request.head.sha }}"
          ./ci/produce-http-facts.sh server "$RUNNER_TEMP/head.http.json"
          ./ci/produce-http-facts.sh clients "$RUNNER_TEMP/clients.http.json"
      - name: route 표면 비교
        run: |
          npx isthmus-cli diff --http \
            --before "$RUNNER_TEMP/base.http.json" \
            --after "$RUNNER_TEMP/head.http.json" \
            --clients "$RUNNER_TEMP/clients.http.json" \
            --fail-on error,incomplete > "$RUNNER_TEMP/http-diff.json"
      - if: always()
        uses: actions/upload-artifact@v4
        with:
          name: http-diff
          path: ${{ runner.temp }}/http-diff.json
```

비밀값은 필요 없다. 클라이언트 저장소 artifact를 다른 저장소에서 내려받을 때 쓰는 토큰은 저장소 secret으로 두고
출력·로그에 싣지 않는다. isthmus는 귀속되지 않은 호출의 경로·host를 어떤 출력에도 싣지 않는다.

## 출력: `isthmus-http-diff` v1

```jsonc
{
  "format": "isthmus-http-diff", "version": 1, "mode": "surface",
  "project": "/work/example-api",            // workspace면 대신 "workspace": {links, before, after}
  "scope": { "granularity": "route", "fieldCompatibility": "not-assessed", "queryAndHeaders": "not-assessed" },
  "findings": [{
    "code": "removed-bound-route", "severity": "error", "category": "impact",
    "scope": "default", "side": "decl",
    "route": { "method": "GET", "template": "/api/users/{}", "pathAnchor": "root" },
    "calls": [{
      "call": { /* route-call 끝점: platform·location·symbol·route */ },
      "before": { "status": "matched", "quality": "exact",
                  "routes": [{ "method": "GET", "template": "/api/users/{}", "pathAnchor": "root" }] },
      "after": { "status": "missing" }
    }]
  }],
  "limitations": { "before": [ /* base 조인 한계 */ ], "after": [ /* head 조인 한계 */ ] },
  "producers": { "before": [], "after": [], "clients": [] },
  "summary": { "findings": 1, "errors": 1, "warnings": 0, "info": 0, "routesAdded": 0, "routesRemoved": 1,
               "routesChanged": 0, "brokenCalls": 1, "reboundCalls": 0, "incompleteness": 0,
               "callImpact": "breaks-found" }
}
```

- finding은 `code`·`severity`(`error`·`warning`·`info`)·`category`(`surface`·`impact`·`incompleteness`)와 해당하는
  필드(`scope`·`side`·`route`·`snapshot`·`change`·`evidence`·`calls`·`counts`·`detail`)를 싣는다. 표면 finding의
  `evidence.before`·`evidence.after`는 그 키의 선언 끝점이고, `change`는 바뀐 속성의 두 시점 값 목록이다.
- `calls[].after.status`: `matched`(다른 route에 결합 — `rebound-route-calls`), `missing`, `method-mismatch`,
  `trailing-slash-mismatch`, `case-mismatch`, `ambiguous`, `unattributed`(head에서 이 scope에 귀속되지 않음),
  `not-evaluated`(head scope에 그 측의 선언 문서가 없음). `-unverified` finding의 호출은 `reasons`를 싣는다.
- 호출 끝점은 base 조인에서 이 scope에 **귀속된** 호출만 싣는다. 어느 조인에서도 귀속되지 않은 호출은
  `calls-unattributed`의 개수로만 나온다.
- `summary.callImpact`: `breaks-found`(impact 깨짐 finding이 하나라도 있음), `no-breaks-observed`(없음 — 완전성
  주장이 아니다, `summary.incompleteness`를 함께 본다), `not-assessed`(평가할 호출 측 문서가 하나도 없음).
- 같은 입력이면 바이트 단위로 같은 출력이다. finding은 scope·측·템플릿·method·앵커·코드 순, 끝점은 조인과 같은
  순서다. 목록에 싣는 호출 끝점이 합계 100,000개를 넘으면 부분 결과 없이 2다.

## finding 코드

| 코드 | 심각도 | 분류 | 뜻 |
|---|---|---|---|
| `route-added` | info | surface | head에만 있는 route 키 |
| `route-removed` | warning | surface | base에만 있는 route 키. 결합하던 호출이 있으면 impact finding이 따로 나온다 |
| `route-param-constraints-changed` | warning | surface | 같은 키의 `paramConstraints` 집합이 바뀌었다(경로 파라미터 제약 추가·삭제·종류 변경) |
| `route-trailing-slash-changed` | warning | surface | 같은 키의 `trailingSlash`(strict·optional·미상) 집합이 바뀌었다 |
| `route-catch-all-changed` | warning | surface | 같은 키가 명시적 선언과 catch-all 접두사 펼침(`catchAllPrefix`) 사이를 오갔다 |
| `route-case-sensitivity-changed` | warning | surface | 같은 키의 `caseInsensitive` 집합이 바뀌었다 |
| `removed-bound-route` | error | impact | head에서 삭제된 route에 base에서 결합하던 호출이 head에서 어디에도 결합하지 않는다. [error 전제](#error-전제)가 모두 증명됨 |
| `removed-bound-route-unverified` | warning | impact | 위와 같지만 전제 하나 이상을 증명하지 못했다(호출마다 `reasons`) |
| `changed-bound-route` | error | impact | head에도 있는 route에 base에서 결합하던 호출이 head에서 결합하지 않는다(제약·끝 슬래시·대소문자 변화, 다른 선언 추가로 생긴 모호함 등). 전제가 모두 증명됨 |
| `changed-bound-route-unverified` | warning | impact | 위와 같지만 전제 하나 이상을 증명하지 못했다 |
| `rebound-route-calls` | warning | impact | base에서 이 route에 결합하던 호출이 head에서 다른 route에 결합한다(다른 핸들러가 받는다 — 예: `/users/me` 삭제로 `/users/{}`가 받음, 더 구체적인 route 추가) |
| `clients-unscanned` | warning | incompleteness | 표면이 바뀐 scope에 닿을 수 있는 호출 측 문서가 없어 호출 영향을 평가하지 않았다 |
| `calls-unattributed` | warning | incompleteness | 표면이 바뀐 scope를 불렀을 수 있지만 귀속되지 않은 호출 수(`counts.before`·`counts.after`). 경로·host는 싣지 않는다 |
| `calls-dynamic` | warning | incompleteness | 표면이 바뀐 scope에 귀속됐지만 템플릿이 리터럴이 아니라 평가하지 못한 호출 수 |
| `client-coverage-gap` | warning | incompleteness | 표면이 바뀐 scope의 호출 측 문서가 호출 측 공백 접두사 한계를 신고했다(`detail`에 접두사) |
| `declaration-coverage-gap` | warning | incompleteness | 한 시점(`snapshot`)의 선언 측이 서버·계약 공백 접두사 한계를 신고했다. 보이는 삭제·추가가 추출 공백일 수 있다 |
| `declarations-dynamic` | warning | incompleteness | 선언 측에 템플릿이 리터럴이 아닌 선언이 있어(`counts`) 그 변화는 보이지 않는다 |
| `link-service-ambiguous` | warning | incompleteness | workspace link의 서비스 범위를 정하지 못해 선언 일부를 잇지 않았다(`snapshot`, `detail`) |
| `http-member-unlinked` | warning | incompleteness | head 매니페스트에서 어느 link에도 client로 들지 않은 member의 client http 문서(`counts.after`) — 그 호출은 평가하지 않았다 |

- 호출 측 incompleteness(`clients-unscanned`·`calls-unattributed`·`calls-dynamic`·`client-coverage-gap`)는 표면
  finding이 하나 이상 있는 scope에만 낸다. 선언이 같으면 결합도 같아 깨질 수 없기 때문이다(속성까지 같은 키 집합은
  매처 입력이 같다). 선언 측 incompleteness는 표면 변화와 무관하게 낸다 — 보이지 않는 선언의 변화는 감지할 수 없다.
- 호출이 깨졌는지는 표면 finding과 무관하게 모든 결합 호출에서 계산한다. 그래서 속성이 그대로인 route에도
  `changed-bound-route`가 날 수 있다(예: 다른 선언 추가로 모호해짐).

### error 전제

`removed-bound-route`·`changed-bound-route`는 호출마다 다음이 모두 성립할 때만 error다. 하나라도 빠지면 그 호출은
`-unverified` finding으로 가고 빠진 전제가 `reasons`에 실린다.

| reason | 전제 |
|---|---|
| `before-binding-unproven` | base 결과가 `matched`이고 품질이 `exact`·`any-method`·`head-as-get`·`options-any`·`catch-all`이다(`suffix`·`param-to-literal`·`param-to-literal-constrained`·`ambiguous`는 증명된 결합이 아니다) |
| `base-anchored-call` | 호출 `pathAnchor`가 `root`다 |
| `method-dynamic` | 호출 동사가 확정됐다 |
| `test-source` | 테스트 소스 호출이 아니다 |
| `masked-call` | 마스킹된 세그먼트가 없다 |
| `after-unattributed` | head 조인에서도 같은 scope에 귀속됐다 |
| `after-not-evaluated` | head scope에 그 측의 선언 문서가 있다(decl 측은 route-decl을 스캔한 문서) |
| `after-outcome-unproven` | head 결과가 `missing`이거나 모든 경로 후보가 증명 가능한 `method-mismatch`다(끝 슬래시·대소문자 불일치와 모호함은 증명된 미결합이 아니다) |
| `after-declaration-gap` | head의 그 측에 공백 접두사 한계나 dynamic 선언이 없다 |
| `contract-not-authoritative` | contract 측이면 link `contract.authoritative`가 `true`다(surface 모드는 항상 이 reason) |

## `--fail-on`과 종료 코드

`--fail-on`은 쉼표로 나눈 토큰 목록이다. 토큰은 위 finding 코드, `error`(error finding 전부), `warning`(warning
이상 전부), `incomplete`(incompleteness finding 전부)다. 모르는 토큰·빈 토큰은 사용 오류 64다 — 오타가 조용히
아무것도 막지 않는 CI를 만들지 않기 위해서다. `--strict`는 `--fail-on error`와 같고 함께 쓰면 합집합이다.

| 코드 | 뜻 |
|---|---|
| `0` | 보고서 생성. `--fail-on`·`--strict`에 걸린 finding 없음(깨짐이 없다는 뜻이 아니다) |
| `1` | 걸린 finding이 하나 이상. 보고서는 stdout에 그대로이고 stderr에 걸린 코드와 개수만 싣는다 |
| `2` | 입력·계약·읽기 오류, project·인벤토리·link 정의 불일치, 한쪽만 매니페스트, 출력 상한. stdout은 비운다 |
| `64` | 사용 오류(모드 인수 위치, 빈 목록, 모르는 플래그·토큰, 문서 256개 초과) |

## 범위와 남은 일

- 구현: surface·workspace 모드, 교차 평가, finding 19종, `--fail-on`·`--strict`, 합성 fixture(`fixtures/http-diff/`).
- 판정하지 않는 것: 필드·query·헤더 호환성, narrowed 조건 변화, 핸들러 심볼 교체, registration-order 디스패치(파서가
  아직 거부한다), http limitationScopes(초안 — 한계는 문서 전체에 적용).
- MCP에는 노출하지 않는다(MCP `diff`는 bridge 전용 그대로). 노출은 trace·`--pairs`와 함께 출력 상한을 정할 때 결정한다.
