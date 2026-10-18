# 화면 URL과 API 호출 연결

isthmus-cli 0.13.0과 tsograph 0.10.0부터 지원한다.

`navigation-facts` v1은 화면의 URL 템플릿과 생산자 그래프 심볼을 연결한다. HTTP
method·service·authority·backend dispatch 의미는 없으며 bridge-facts와 별도 형식이다.
화면 경로를 backend `route-decl`로 합성하지 않는다.

```json
{
  "format": "navigation-facts", "version": 1,
  "tool": {"name": "tsograph", "version": "example"},
  "generatedAt": "2026-01-01T00:00:00.000Z", "platform": "js", "project": "/work/example",
  "facts": [{
    "kind": "screen-route", "urlTemplate": "/catalog/{}", "dynamic": false,
    "location": {"path": "src/router.ts", "line": 8, "column": 1},
    "screen": {"usr": "src/screens.tsx#Catalog", "qualifiedName": "Catalog"}
  }],
  "limitations": []
}
```

static 사실에는 canonical URL과 정확한 screen USR이 모두 필요하다. 모호한 등록은
`dynamic: true`로 내며 URL이나 심볼을 알 수 없으면 생략/null로 남긴다. 위치는 상대 경로와
1 기반 UTF-8 열이다. 입력은 JS, 닫힌 필드, 100,000 사실·문자열·목록 상한으로 검증한다.

`tsograph navigation --project . --router-model router-model.json`은 선언 identity와 등록
구조를 설정한 생산자다. 라이브러리 메서드 이름을 추측하거나 앱 코드를 실행하지 않는다.
`tsograph reach --graph-file graph.json <screen-usr>...`로 같은 project의 정방향 결과를 저장한다.

```json
{
  "format": "navigation-trace-context", "version": 1,
  "navigation": "screens.json",
  "documents": ["client-http.json", "server-http.json"],
  "analyses": ["screen-reach.json"]
}
```

```sh
isthmus trace-navigation navigation-context.json --strict
```

context 경로는 context 파일의 디렉터리 기준이다. navigation·HTTP 문서·JS 정방향 분석의
project가 같아야 하며, 별도 저장소 project를 암묵적으로 합치지 않는다. 현재 이 명령은
단일 project용이다. workspace의 일반 `trace`와 별도로 운영한다.

결과의 각 chain은 화면 URL·심볼에서 해당 root로 실제 관찰한 호출 심볼만 고른 뒤 기존
HTTP matcher로 backend 선언·계약에 연결한다. 같은 URL 문자열만으로 화면과 backend를
직접 합치지 않는다. 없는 분석·잘림·미해결 호출·조인하지 못한 요청은 gaps로 남는다.
일반 종료는 0, strict의 gaps는 1, 입력/출력 실패는 2, 사용 오류는 64다.

근거 등급·미해결 호출 집계를 신고하지 않은 분석은 `unknown`과 gaps로 표시하며 strict는 1로 끝난다. HTTP 생산자·조인의 한계와 스코프는 `httpLimitations`로 보존한다. navigation/HTTP 한계가 있거나, 해당 screen root의 순회 분석이 한계를 신고하거나, HTTP 호출의 caller 심볼이 없으면 전역 coverage gap을 남겨 strict 통과를 보류한다. source revision 신선도를 이 별도
artifact만으로 증명하지 않으며 limitation을 유지한다. 입력은 파일당 16 MiB·전체 64 MiB UTF-8 바이트까지 일반 파일에서만 읽고, 출력은 16 Mi UTF-16 문자로 제한한다. 읽기·인코딩·JSON·계약·project 불일치·예산 실패를 구분한다. 1,000,000 link-work
예산을 넘으면 부분 목록 대신 실패한다. link-work는 화면 사실마다 그 화면의 root, 그 root에서 닿은 행, 행의 목격
경로 원소, 닿은 심볼의 HTTP 호출을 하나씩 센다. 그 화면과 무관한 분석의 root·행과 호출은 세지 않는다.
기존 `trace`·bridge-facts 처리와 출력은 변경하지 않는다.

같은 HTTP 발생의 부가 이름이 다르면 canonical 대표를 고르고, 하나라도 testSource를 신고하면
그 표시를 보존합니다. 원시 문서 순서를 바꿔도 chain·호출·gap·한계의 출력은 같습니다.

## 다음 릴리스: 목격 경로와 분석 출처

아래 보강은 다음 릴리스 대상이며 isthmus-cli 0.13.1 발행본에는 없다.

- 각 호출의 `path`는 생산자가 기록한 실제 목격 경로다. 여러 root가 같은 호출에 닿아도
  `depth`는 이 목격의 시작 root 기준이다. 선택한 화면과 다르면 `witnessRoot`와
  `screen-witness-other-root` gap을 남긴다. root 순환으로 앞부분이 없으면
  `witnessPartial: true`와 `screen-witness-partial` gap을 남기며 경로를 지어내지 않는다.
- `witnesses`는 같은 호출을 관찰한 모든 서로 다른 경로·근거 등급·분석 메타데이터를 보존한다.
  기존 `depth`·`evidence`와 `path`는 가장 강한 등급, 화면 기준 완전한 목격, 작은 depth, canonical 순서로 고른
  대표 관찰이다. 다른 관찰의 `candidate`·`unknown` 또는 한계를 제거하는 뜻이 아니다.
  화면 자체의 호출은 `[screen.usr]`, depth 0이며 순회 간선이 없어 analysis가 없다.
- 보고서 `analyses`는 호출이 없어도 생산자·생성 시각·revision·graphRevision·root·잘림·한계를
  보존한다. 호출의 `witnesses[].analysis`는 이 목록의 `id`를 참조한다. id는 정규화한 순회 문서의
  SHA-256이며 출처 식별용이다. 현재 소스 신선도를 증명하는 서명이 아니다. 반복된 메타데이터를
  호출마다 복사하지 않는다. 목격 목록·대표 경로의 누적 직렬화 크기는 8 Mi UTF-16 문자로
  제한하며, 상한을 넘으면 부분 성공 대신 코드 2로 실패한다.
- 해당 화면을 root로 가진 분석의 source revision 또는 graphRevision이 충돌하면 각각
  `screen-analysis-revision-conflict`·`screen-analysis-graph-revision-conflict` gap이다.
  revision이 없으면 `screen-analysis-revision-unknown`, 다른 분석이 graphRevision을 신고했으나
  일부가 생략했으면 `screen-analysis-graph-revision-unknown`이다. 시각으로 새 revision을 추측하지 않는다.
- `candidate` 도달은 `screen-candidate-dispatch` gap을 남긴다. 위 gap들은 strict에서 코드 1이며
  관찰된 호출은 그대로 반환한다. 동일 revision만으로 navigation·HTTP 사실 또는 현재 소스와의
  정합성을 증명하지 않으므로 기존 freshness limitation도 유지한다. 빈 결과나 코드 0은
  전체 도달 범위·삭제 안전성을 증명하지 않는다.
