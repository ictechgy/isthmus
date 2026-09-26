# MCP 서버 (`isthmus serve`)

`isthmus serve`는 stdio 위에서 MCP(Model Context Protocol)를 말한다.
코딩 에이전트(Claude Code, Devin, 호환 클라이언트)가 이 프로세스를 자식으로 띄우고,
일곱 개의 분석 도구를 JSON-RPC `tools/call`로 호출한다. 각 도구는 대응하는 CLI
명령과 정확히 같은 실행 경로·보고서 형식·한계 보고를 재사용한다 — MCP 응답에
담기는 문서는 파이프로 받은 CLI 출력과 동일하다.

## 실행과 연결

서버는 인자 없이 시작하고, 한 줄에 JSON-RPC 메시지 하나씩 주고받는다(newline-delimited).
stdin이 닫히면 종료 코드 0으로 끝난다. 세션 상태를 쌓지 않으므로 재시작해도 잃는 것이 없다.

```bash
isthmus serve            # MCP stdio 서버로 실행
isthmus serve --verbose  # usage 64 — 플래그는 없다
```

클라이언트 설정 예시(개념적 — 클라이언트별 키 이름은 다르다):

```json
{ "command": "isthmus", "args": ["serve"] }
```

지원 프로토콜 버전은 `2025-06-18`·`2025-03-26`·`2024-11-05`다. `initialize`가
요청한 버전을 지원하면 그대로 협상하고, 모르는 버전에는 최신 지원 버전을 제안한다.
`notifications/*` 알림에는 응답하지 않고, 배치 요청은 거부한다(-32600).

## 도구

모든 도구의 `documents`는 GRAPH-EXCHANGE v1/v2 브리지 사실 문서 경로 2개 이상이다.
경로는 서버 프로세스의 작업 디렉터리 기준으로 해석된다 — 클라이언트는 읽을 수 있는
경로만 넘겨야 한다.

| 도구 | 대응 명령 | 선택 인자 |
|---|---|---|
| `check` | `isthmus check` | `strict` |
| `query` | `isthmus query` | `name`(필수, `relation:<name>`이면 persistence 관계 질의) |
| `graph` | `isthmus graph` | `format: json\|dot\|mermaid` |
| `diff` | `isthmus diff` | `before`/`after`(필수), `strict` |
| `impact` | `isthmus impact` | `file`·`symbol`·`changes` 중 정확히 하나(필수), `runtime`, `revision`, `strict`, `compact` |
| `preflight` | `isthmus preflight` | `context`(필수), `runtime[]`, `expectations`, `revision`, `summary`, `limit`, `explain`, `strict`, `compact` |
| `retentions` | `isthmus retentions` | `producer`(필수, `cartograph` 또는 `kartograph`; Kotlin은 개발 빌드) |

## 응답 의미

- 보고서 JSON은 `content[0].text`에 문자열로 담긴다 — CLI stdout과 동일한 문서다.
- 명령의 stderr(질의 힌트·원인 메시지)가 있으면 두 번째 text 블록으로 뒤따른다.
- `isError`는 **문서를 만들지 못한 실패**(usage 64, 입력/내부 2)에만 세운다.
  `query`의 `notFound`(64)나 `check --strict`의 발견(1)은 정답 문서를 실은 정상
  응답이다 — 문서 안의 `status`·`summary`·`limitations`가 판정 근거다.
- 발견·한계·미해석 사실은 CLI와 같은 규칙으로 보존된다. `isError: false`와 빈
  결과를 완전성의 증거로 읽지 않는다 — `limitations`를 함께 본다.

## 범위와 주의점

- 서버는 호출자의 파일 읽기 권한을 그대로 상속한다 — MCP 표면 자체에는 인증이 없다.
  부모 에이전트가 이미 읽을 수 있는 파일만 도구 인자로 넘기는 모델이며, 네트워크
  노출은 하지 않는다(stdio 전용).
- `--update-baseline`·`--output` 같은 파일 쓰기 경로는 도구 인자로 열지 않았다.
- 이것은 제품 명령의 **트랜스포트**다. 새 분석이나 새 보고서 형식을 추가하지 않고,
  교환 계약(GRAPH-EXCHANGE)의 범위를 넓히지도 않는다.
