# 언어 그래프 순회 교환 형식 (`language-traversal` v1)

_기록: 2026-09-27 · 상태: isthmus 소비자 구현(`trace`), 생산자 합의 진행 중_

언어 생산자(TS 생산자 `tsograph`, Python 생산자 `pythograph`, cartograph, kartograph, dartograph 등)와 schemagraph가
**내보내고** isthmus [`trace`](TRACE.md)가 **읽는** 순회 결과 형식이다. 한 번의 정방향
(`dependencies`) 또는 역방향(`dependents`) 순회를 담고, 도달한 정점마다 어느 root에서 닿았는지를
보존한다. isthmus는 이 숲을 생산자 id의 **정확한 문자열 일치**로만 bridge-facts 사실에 잇는다.
bridge-facts v1의 필드는 바꾸지 않는다([GRAPH-EXCHANGE](GRAPH-EXCHANGE.md)).

## 문서

```jsonc
{
  "format": "language-traversal",
  "version": 1,
  "tool": { "name": "tsograph", "version": "0.1.0" },
  "generatedAt": "2026-09-27T00:00:00Z",        // bridge-facts와 같은 시각 문법
  "platform": "js",                              // dart | swift | kotlin | js | go | rust | python | sql
  "project": "/abs/path",                        // bridge-facts와 같은 POSIX realpath 규칙
  "revision": "<git sha>",                       // 선택: 분석한 소스 revision
  "graphRevision": "<opaque>",                   // 선택: 순회에 쓴 그래프 산출물의 신원
  "dispatch": "bound",                           // 선택: 생산자가 정한 dispatch 해석 방식 표식
  "direction": "dependencies",                   // dependencies | dependents
  "roots": [ { "id": "<생산자 id>", "symbol": { "usr": "<같은 id>", "qualifiedName": "…" },
               "unresolvedCalls": 2 } ],         // 선택: 1 이상, 0이면 생략
  "reached": [
    { "symbol": { "usr": "<생산자 id>", "qualifiedName": "…", "kind": "method",
                  "location": { "path": "src/a.ts", "line": 3, "column": 1 } },
      "via": "<부모 usr 또는 root id>", "depth": 1, "roots": [0], "relationships": ["call"],
      "evidence": "bound",                       // 선택: direct | bound | candidate
      "unresolvedCalls": 1 }                     // 선택: 1 이상, 0이면 생략
  ],
  "rootsTruncated": true,                        // 선택: 잘렸을 때만 싣는다
  "truncated": false,
  "truncationReasons": ["depth"],                // 선택: truncated가 true일 때만
  "limitations": ["…"]
}
```

## 필드 의미

- `direction`: `dependencies`는 root가 기대는 쪽(호출·참조 대상), `dependents`는 root에 기대는
  쪽(호출자·참조자)이다. trace의 `forward` 역할은 `dependencies`, `reverse`·`db-dependents`
  역할은 `dependents`만 받는다.
- `roots[].id`는 생산자 id다. 심볼 root는 `symbol`을 싣고 `symbol.usr`가 `id`와 같다. 파일 선택처럼
  심볼이 아닌 root, 생산자가 해석하지 못한 요청은 `symbol`을 생략한다. 해석하지 못한 요청은
  원문을 `id`에 두고 `limitations`에 `root-not-found:`로 시작하는 문구, `truncationReasons`에
  `root-not-found`, `truncated: true`를 함께 싣는다. **trace는 `symbol`이 있는 root만 잇는다.**
  `root-not-found`는 **그 요청 root에만 해당하는 사유**다: 찾은 root의 도달은 그 요청 없이 계산한 것과 같아야 하고, 다른
  이유(깊이·출력·예산)로도 잘렸으면 그 사유를 함께 싣는다. 그래서 trace는 사유가 `root-not-found`뿐인 문서에서 찾은 root의
  hop을 잘린 것으로 보지 않고, 못 찾은 root를 따라가야 하는 hop에만 `analysis-root-not-found`를 남긴다
  ([TRACE](TRACE.md#root-not-found는-root-단위)).
- `roots`의 순서는 생산자의 입력 순서이며 `reached[].roots`가 가리키는 인덱스의 의미다. 정렬을
  요구하지 않지만 id는 유일해야 하고, 같은 입력이면 같은 순서여야 한다.
- `reached[].symbol.usr`는 **그 생산자가 bridge-facts의 `symbol.usr`(route-decl·route-call·
  relation-use)에 싣는 문자열과 같아야 한다.** isthmus는 문자열을 정규화·추측하지 않는다.
  `platform: "sql"`(schemagraph)은 VertexId를 쓰며 이것은 facts의 `relation-decl` `symbol.usr`와
  같다(예: `main.users`, `main.users.email`).
- `reached`는 **자기 자신이 아닌 root 하나 이상에서 닿은 모든 정점**이다. 다른 root에서 닿은 root도
  싣는다(예: 테이블 23개 전부를 root로 준 DB 의존자 순회에서, FK로 다른 root 테이블에 기대는 root
  테이블). 그런 항목의 `roots`에는 그 정점에 닿는 **다른** root만 싣고 자기 인덱스는 넣지 않는다.
  자기 자신에서만 닿는(순환) root는 싣지 않는다.
- `via`는 가장 짧은 경로 하나의 직전 정점(root id 또는 다른 도달 정점의 usr)이고 `depth`는 그 정점에
  닿는 root 중 가장 가까운 것까지의 간선 수다. via가 root id면 depth는 1이다 — via root가 다른 root에서
  닿았더라도 경로는 그 root에서 시작한다. 예: root A(0)·B(1)이고 B가 A의 의존자, C가 B의 의존자면
  `{usr: B, via: A, depth: 1, roots: [0]}`, `{usr: C, via: B, depth: 1, roots: [0, 1]}`이다.
- **root 항목의 depth는 기준값이고 via는 목격이다.** root 항목의 depth는 다른 root 기준이지만, 그 via
  정점 V의 depth·roots는 이 root를 포함한 모든 root 기준이다. V에 닿는 짧은 경로가 이 root를 거치면(호출
  그래프의 재귀, FK 순환) V의 depth가 root 항목의 depth - 1보다 작고, via를 따라가면 이 root로 돌아온다.
  예: root A(0)·R(1), 간선 A→W→V→R과 R→V면 `{usr: V, via: R, depth: 1, roots: [0, 1]}`,
  `{usr: R, via: V, depth: 3, roots: [0]}`이다. 소비자는 root 항목의 depth를 믿고, via 사슬이 그 root로
  돌아오면 경로를 부분 목격으로만 다룬다(trace는 `witnessPartial`과 `witness-partial` gap).
- `reached[].roots`는 이 정점에 닿는 **모든**(자기 제외) root 인덱스의 오름차순 목록이다(비어 있지
  않음). 64개를 넘으면 가장 작은 인덱스 64개만 싣고 문서에 `rootsTruncated: true`를 단다. 입력 root
  수의 상한이 아니다.
- `relationships`는 생산자가 관찰한 간선 종류(`call`·`reference`·`reads` 등)의 정렬된 목록이다.
  32개까지. 의미는 생산자 문서가 정한다.
- `symbol.location`은 생산자가 관찰한 project 상대 위치다. JVM처럼 줄·열이 없으면 생략하고
  1로 채우지 않는다(열은 줄이 있을 때만).
- `revision`·`graphRevision`은 불투명 문자열이다. isthmus는 서로 비교만 한다(schemagraph는
  graph.json 바이트의 소문자 hex SHA-256을 `graphRevision`에 싣는다).
- `truncated`는 깊이·출력·예산 등으로 순회가 잘렸다는 뜻이다. 잘린 순회의 부재는 아무것도
  증명하지 않는다. 예외로 사유가 `root-not-found`뿐이면 못 찾은 요청 root만의 표시다(위 `roots[].id`).

## 근거 등급과 잇지 못한 호출 (선택 필드)

dependency injection·인터페이스 dispatch를 해석하는 생산자(tsograph)는 경로가 늘어나는 만큼 그 경로가 얼마나
확실한지도 함께 낸다. 모두 선택 필드이며 v1에 더해진 것이다(버전은 그대로 1).

- `dispatch`(문서, 문자열): 생산자가 정한 dispatch 해석 방식 표식이다(tsograph는 `direct`·`bound`·`candidates`).
  isthmus는 값을 해석하지 않고 출력의 분석 메타데이터에 그대로 싣는다. **이 필드가 있으면 그 문서는 아래
  두 신고를 한다는 선언이다**: 모든 도달 정점의 근거 등급을 분류하고(`evidence`가 없는 정점은 `direct`),
  잇지 못한 호출이 1개 이상인 모든 root·도달 정점에 `unresolvedCalls`를 싣는다(없는 값은 0).
- `reached[].evidence`: `"direct"` | `"bound"` | `"candidate"`. 등급은 간선 집합이 포개진다
  (`direct ⊂ bound ⊂ candidate`).
  - `direct` — 컴파일러·구문이 해석한 간선만 쓴다.
  - `bound` — 주입된 구현의 전체 프로그램 흐름으로 해석한 dispatch 간선을 포함한다. 인터페이스 자리로
    들어오는 관찰된 흐름이 모두 알려진 프로젝트 구현이어야 한다.
  - `candidate` — 가능성만 있는 구현 간선을 하나 이상 포함한다.

  값은 **나열된 root 각각에 대해** "그 root에서 이 정점에 닿는 가장 강한 등급"을 구한 뒤 그중 가장 약한
  것이다. 즉 `evidence: "direct"`는 이 정점에 닿는 모든 root에서 direct 간선만으로 닿는다는 뜻이다(64개 상한으로
  잘린 목록이면 목록에서 빠진 root도 포함한다). root마다 성립하는 하한이어야 다중 root 문서에서 소비자가
  특정 root(핸들러 하나)의 hop 등급을 부풀리지 않는다. `depth`·`via`·`roots`는 여전히 허용된 **전체** 그래프
  (가장 약한 등급까지 포함) 기준이며, 등급별 최단 경로는 via 사슬과 다를 수 있다.
- `reached[].unresolvedCalls`·`roots[].unresolvedCalls`: 1 이상의 정수(상한 1,000,000). 그 정점 **자신의**
  나가는 호출 지점 중 생산자가 대상을 잇지 못한 수다. 0이면 생략한다(0을 싣지 않는다). 다른 root에서 닿아
  `reached`에도 실린 root는 두 곳에 같은 값을 싣는다.

### 필드가 없을 때 (문서 수준 규칙)

없는 선택 필드는 "0"이나 "direct"로 단정하지 않는다. 소비자는 문서 단위로 신고 여부를 정한다.

| 신고 여부 | 판정 | 없는 값의 의미 |
|---|---|---|
| 근거 등급 분류 | `dispatch`가 있거나 `evidence`를 실은 정점이 하나라도 있다 | `direct` |
| 근거 등급 미분류, `platform: "sql"` | schemagraph 간선(FK·뷰 정의 등)은 스키마에 선언된 것이다 | `direct` |
| 근거 등급 미분류, 언어 그래프 | 생산자가 분류하지 않았다(옛 어댑터 포함) | `unassessed` — 가능성 간선이 섞였는지 모른다 |
| 잇지 못한 호출 신고 | `dispatch`가 있거나 `unresolvedCalls`를 실은 root·정점이 하나라도 있다 | 0 |
| 잇지 못한 호출 미신고 | 위가 모두 아니다(옛 어댑터 포함) | 알 수 없음 — 완전성을 주장하지 않는다 |

잇지 못한 호출을 신고하지만 `dispatch`를 내지 않는 생산자가 한 문서에서 잇지 못한 호출이 하나도 없으면 문서만
보고는 "미신고"와 구별되지 않는다. 그런 생산자는 `dispatch`(예: `"direct"`)를 실어 신고를 선언한다. 선언하지
않으면 소비자는 보수적으로 "알 수 없음"으로 읽는다.

### 소비자가 검사하는 것과 생산자 보장

- 검사한다: `evidence` 열거값, `unresolvedCalls`의 정수·범위(1~1,000,000, 0 거부), `dispatch`가 안전한 비지 않은
  문자열인지, 다른 root에서 닿은 root 항목의 `unresolvedCalls`가 `roots[]` 항목과 같은지(둘 다 없거나 같은 수).
- 검사하지 않는다(생산자 보장): 등급의 포개짐과 "root마다 하한" 정의, via 부모와 자식 사이의 등급 관계.
  via는 전체 그래프 최단 경로의 목격이고 간선 등급을 싣지 않으므로, 예컨대 via 간선이 candidate여도 더 긴
  direct 경로가 있으면 자식은 `direct`일 수 있다. 소비자가 via 부모의 등급으로 자식 등급을 제한하면 올바른
  문서를 거부하게 되므로 이 관계는 강제하지 않는다.
- 역방향(`dependents`) 문서의 `unresolvedCalls`는 싣되 trace가 쓰지 않는다. 잇지 못한 호출은 순회 밖의 어느
  정점에서든 이 root로 들어오는 빠진 간선일 수 있어 특정 hop에 귀속할 수 없기 때문이다.

## 검증 규칙 (소비자, fail-closed)

isthmus는 아래를 어긴 문서를 고쳐 읽지 않고 입력 오류(종료 코드 2)로 거부한다.

- 정의되지 않은 필드(문서·root·reached·symbol·location·tool)는 거부한다. `dispatch`·`evidence`·
  `unresolvedCalls`는 정의된 선택 필드다. bridge-facts v1은 정의되지
  않은 필드를 버리고 읽지만, 이 형식은 v1부터 새 형식이라 의미가 다른 필드가 조용히 무시되는 쪽보다
  거부를 택했다. 필드 추가는 이 문서의 개정과 함께 한다.
- root id는 서로 유일하고, 도달 usr도 서로 유일하다. 도달 usr가 `roots[i].id`와 같으면 그 항목의
  `roots`에 `i`가 없어야 한다. `via`는 자기 자신일 수 없다.
- `via`는 root id이거나 다른 도달 정점이다. `depth`는 1~128이고, via가 root id면 1, 아니면 부모
  depth + 1이다. 단 root 항목(usr가 root id)은 via가 도달 정점일 때 depth 관계를 검사하지 않는다(위 순환).
- `roots`는 범위 안의 엄격한 오름차순 인덱스이며 1~64개다. via가 root면 그 root의 인덱스를 포함한다
  (`rootsTruncated: true` 문서에서 64개로 잘린 목록의 via root 인덱스가 마지막 인덱스보다 크면 예외).
- `truncated`와 `rootsTruncated`가 모두 거짓이면 부모에 닿는 root가 자식의 자기 인덱스를 빼고 모두
  자식에 포함된다. 부모가 root면 그 root와, 그 root가 다른 root에서 닿았다면 그 root들이 대상이다.
  이 규칙은 root 항목에도 적용한다 — via 간선이 실제로 있으므로 via에 닿는 다른 root는 이 root에도 닿는다.
- `reached`는 (depth, usr) 엄격한 오름차순이다(UTF-16 코드 단위 비교, locale 무관).
- `truncationReasons`는 정렬된 유일한 문자열이고 `truncated: true`일 때만 비어 있지 않을 수 있다.
- `evidence`는 `direct`·`bound`·`candidate` 중 하나, `unresolvedCalls`는 1~1,000,000 정수다(0은 생략).
  다른 root에서 닿은 root 항목의 `unresolvedCalls`는 `roots[]` 항목 값과 같다.
- 상한: root 10,000개, 도달 정점 100,000개, 정점당 root 인덱스 64개, 관계 32개, depth 128.

## 옛 형식 어댑터 (trace)

trace는 새 형식을 우선하고, 이미 배포된 형식은 어댑터로 같은 숲에 투영한다. 어댑터는 새 id를
만들지 않는다.

| 형식 | 역할 | 투영 |
|---|---|---|
| `schemagraph-impact` v1 | `db-dependents`(sql) | `subject.id`가 root, `impacted[].{id, via, distance, edges}`가 도달 정점·via·depth·관계. subject 자신으로 돌아온 항목(순환)은 뺀다. 선택 키(`complete`·`visited` 등)는 무시한다. `via`가 없는 옛 보고서는 거부한다 |
| `kartograph-impact` v1 | `reverse`(kotlin) | preflight와 공유하는 kartograph 어댑터(`LanguageImpact` 계약)를 쓴다(current 경로만) |
| `change-impact` v1 | `reverse`(swift) | preflight와 공유하는 cartograph 어댑터를 쓴다 |
| dartograph impact v1 | `reverse`(dart) | preflight와 공유하는 dartograph 어댑터를 쓴다 |

옛 형식에는 근거 등급과 잇지 못한 호출이 없다. 어댑터는 둘 다 "미신고"로 표시한다 — `schemagraph-impact`의
sql 간선은 `direct`, 옛 언어 역방향 형식은 `unassessed`로 읽힌다.

옛 역방향 형식에는 정점별 root 목록이 없다. 어댑터는 via 사슬의 대표 root 하나만 복원하므로 root가
둘 이상이면 root 출처가 부분적이다(`rootProvenance: "witness"`). trace는 이 분석을 쓴 hop에
`roots-provenance-partial` gap을 남긴다. 옛 형식에는 도구 버전·revision이 없어 출력 메타데이터에서
빠지고, context가 revision을 선언하면 `analysis-revision-unknown` gap이 된다.

## 생산자가 할 일

- bridge-facts의 route-decl(핸들러), route-call(호출을 감싸는 선언), relation-use(감싸는 선언)의
  `symbol.usr`와 순회의 id를 같은 문자열로 낸다. 못 채우면 사실의 usr를 생략하고
  `missing-route-usrs:`·`missing-relation-usrs:` 같은 체인 전용 한계로 신고한다.
- 정방향 순회(가칭 `reach`)는 핸들러 전체를 root로, 역방향 순회는 relation-use를 감싼 심볼이나
  route-call을 감싼 심볼을 root로 한 번에 낸다. 다중 root 문서는 `reached[].roots`를 반드시 싣는다.
- dispatch를 해석하면 `dispatch`를 싣고, 도달 정점마다 root별 하한 등급(`evidence`)과 잇지 못한 호출 수
  (`unresolvedCalls`, root 포함)를 낸다. dispatch를 해석하지 않고 가능성 간선(override·프로토콜 구현 후보 등)도
  싣지 않는 생산자가 잇지 못한 호출을 신고할 수 있으면 `dispatch: "direct"`로 신고를 선언한다 — 이 선언은 모든
  정점이 `direct`라는 주장도 되므로, 가능성 간선을 싣는 생산자는 정점마다 `evidence`를 함께 낸다.
- 결정적 출력: 같은 입력이면 같은 바이트다. `generatedAt`은 고정 옵션을 제공하는 것이 좋다.
