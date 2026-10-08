# 화면 URL과 API 호출 연결

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

근거 등급·미해결 호출 집계를 신고하지 않은 분석은 `unknown`과 gaps로 표시하며 strict는 1로 끝난다. HTTP 생산자·조인의 한계와 스코프는 `httpLimitations`로 보존한다. navigation/HTTP 한계가 있거나 HTTP 호출의 caller 심볼이 없으면 전역 coverage gap을 남겨 strict 통과를 보류한다. source revision 신선도를 이 별도
artifact만으로 증명하지 않으며 limitation을 유지한다. 입력은 파일당 16 MiB·전체 64 MiB UTF-8 바이트까지 일반 파일에서만 읽고, 출력은 16 Mi UTF-16 문자로 제한한다. 읽기·인코딩·JSON·계약·project 불일치·예산 실패를 구분한다. 1,000,000 link-work
예산을 넘으면 부분 목록 대신 실패한다. 기존 `trace`·bridge-facts 처리와 출력은 변경하지 않는다.
