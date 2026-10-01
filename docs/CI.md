# PR마다 HTTP route 영향 보고 (GitHub Action)

_기록: 2026-09-30 · 상태: 개발 중([HTTP-DIFF](HTTP-DIFF.md)·[TRACE](TRACE.md)의 base..head CI 절차를 Action으로 묶음)_

저장소 루트의 composite Action([`action.yml`](../action.yml))은 pull request마다 다음을 한다.

1. base와 head를 **같은 checkout 경로**에서 차례로 체크아웃하고, 사용자의 capture 설정으로 생산자를 실행한다
   ([`capture-trace.mjs`](TRACE.md#capture로-한-번에-수집하기)). 미리 만든 문서를 줄 수도 있다.
2. `isthmus diff --http`(surface 또는 workspace 모드)로 base에서 결합하던 클라이언트 호출이 head에서 끊기는지 본다.
3. severity가 info가 아닌 finding의 route만 골라 `isthmus trace`로 핸들러·테이블·DB 의존자·클라이언트 코드를 잇는다.
4. 결과를 Markdown으로 렌더링해 job summary(항상)와 스티키 PR 댓글(선택)에 싣고, JSON을 artifact로 올린다.
5. `fail-on` 정책으로 job 결과를 정한다.

**빈 결과는 안전의 증거가 아니다.** 댓글은 incompleteness finding이 있으면 맨 위에 경고 배너를 싣고, 깨짐이 없어도
"관찰 차이일 뿐 증명이 아니다"라고 쓴다. 요청·응답 필드, query, 헤더 호환성은 판정하지 않는다.

> 생산자(tsograph·kartograph·schemagraph 등) **설치는 사용자 workflow의 책임**이다. isthmus 제품은 JSON만 읽고
> 생산자를 실행하지 않는다([AGENTS.md](../AGENTS.md)). Action은 배포 스크립트 `capture-trace.mjs`를 base·head에
> 한 번씩 부르는 CI 절차일 뿐이다.

## 설계 결정

- **위치 — 저장소 루트 composite Action**(`uses: ictechgy/isthmus@<tag>`). Action과 CLI가 같은 태그·같은 버전
  번호로 나가므로 "Action v0.10.0 + CLI 0.10.0" 조합을 따로 맞출 필요가 없다(`isthmus-version` 기본값이 Action
  ref의 `package.json` 버전이다). 렌더러·오케스트레이터는 CLI와 같은 저장소의 `isthmus-http-diff`·`isthmus-trace`
  형식 변경과 같은 PR에서 함께 바뀌어야 한다. 별도 저장소는 두 저장소의 동시 릴리스를 요구하고, 하위 디렉터리
  Action(`ictechgy/isthmus/ci@…`)은 경로만 길어진다. composite라 빌드 산출물(`dist`)을 커밋할 필요도 없다.
- **렌더러 — CLI 하위 명령이 아니라 스크립트**([`scripts/render-pr-comment.mjs`](../scripts/render-pr-comment.mjs)).
  제품은 JSON만 읽고 쓰는데 Markdown은 교환 형식이 아니라 표현이다. capture-trace처럼 npm 패키지에 싣는 스크립트라
  GitHub 밖 CI에서도 쓸 수 있다(아래 [다른 CI](#다른-ci에서-렌더러만-쓰기)). 의존성이 없어 설치한 CLI 버전과 무관하게
  Action 자신의 사본을 쓴다.
- **trace는 기본으로 base capture**(`trace-side: base`). 모든 non-info route는 base에 있다 — 삭제·속성 변경·결합
  변화는 base route 기준이고, head에만 있는 추가 route는 info다. head capture에는 삭제된 route가 없어 `route-without-decl`
  만 남는다. 대가로 trace가 보여 주는 클라이언트 호출은 base의 호출이다(깨짐 호출 표는 diff의 교차 평가라 head 호출).
- **base commit**: `base-sha`를 주지 않으면, head가 PR 병합 commit(`actions/checkout`의 기본 `refs/pull/N/merge`)이고
  둘째 부모가 PR head일 때 **첫째 부모**다 — 병합이 base에 더하는 변화만 비교한다. 이벤트의 `base.sha`만 쓰면 base
  브랜치가 앞서 나갔을 때 PR에 없는 변화가 거꾸로(삭제로) 보일 수 있다. 그 밖에는 이벤트 `base.sha`다.
- **같은 checkout 경로**: 문서의 `project`가 checkout 경로라 worktree 두 개로 나누면 diff가 project 불일치(2)로
  거부한다. Action은 한 checkout에서 base → head 순서로 바꾸고 끝나면 원래 commit으로 되돌린다. 추적 파일이
  바뀐 checkout은 거부한다.

## 빠른 시작 — 단일 저장소(서버·클라이언트가 한 모노레포)

권장 구성은 **두 job**이다. 분석 job은 PR 코드(생산자)를 실행하므로 읽기 권한만 갖고, 댓글 job은 checkout도 PR 코드
실행도 없이 artifact의 JSON을 Action 코드로 다시 렌더링해 게시한다.

```yaml
# .github/workflows/isthmus-http-impact.yml
name: isthmus HTTP impact
on: pull_request          # pull_request_target은 쓰지 않는다(아래 보안 절)

permissions:
  contents: read

jobs:
  analyze:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          fetch-depth: 2            # 병합 commit의 부모(base)까지. 없으면 Action이 그 commit만 가져온다
          persist-credentials: false
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: '22.18.0'
      - name: 생산자 설치(사용자 책임 — 저장소가 정한 설치 스크립트 자리표시자)
        run: ./ci/install-producers.sh
      - uses: ictechgy/isthmus@<release-tag>   # 실제로는 태그의 commit SHA로 고정한다
        with:
          capture-config: .isthmus/capture.json
          fail-on: error
          comment-mode: summary

  comment:
    needs: analyze
    if: always() && github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-latest
    timeout-minutes: 5
    permissions:
      pull-requests: write
    steps:
      - uses: actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8.0.1
        with:
          name: isthmus-http-impact
          path: ${{ runner.temp }}/isthmus-results
      - uses: ictechgy/isthmus@<release-tag>
        with:
          command: comment
          results-dir: ${{ runner.temp }}/isthmus-results
```

capture 설정(`.isthmus/capture.json`, [`isthmus-trace-capture` v1](TRACE.md#설정-isthmus-trace-capture-v1))의 예다.
상대 경로 root는 Action이 checkout 경로 기준으로 바꾸고, `output`·`trace`·`selection`은 Action이 정하므로 생략한다.
생산자 명령과 인자는 각 생산자 README를 따른다(아래는 모양만 보이는 예시다).

```json
{
  "format": "isthmus-trace-capture", "version": 1,
  "roots": { "repo": "." },
  "tools": {
    "tsograph": { "command": ["tsograph"] },
    "kartograph": { "command": ["kartograph"] },
    "schemagraph": { "command": ["schemagraph"] }
  },
  "members": [{
    "name": "app", "project": { "root": "repo" }, "revision": { "git": true },
    "documents": [
      { "name": "server.http.json", "tool": "tsograph", "args": ["routes", "--role", "server", "--project", "{project}"] },
      { "name": "schema.json", "tool": "tsograph", "args": ["schema", "--project", "{project}"] },
      { "name": "sql-facts.json", "tool": "schemagraph", "args": ["facts", "--document", { "root": "repo", "path": "db/catalog.json" }, "--project", "{project}"] },
      { "name": "android.http.json", "tool": "kartograph", "args": ["routes", "--role", "client", "--project", "{project}"] }
    ],
    "analyses": [
      { "id": "server-forward", "platform": "js", "role": "forward", "tool": "tsograph",
        "args": ["reach", "--project", "{project}", "--generated-at", "{generatedAt}"], "roots": "arguments" },
      { "id": "db", "platform": "sql", "role": "db-dependents", "tool": "schemagraph",
        "args": ["impact", "--graph", { "root": "repo", "path": "db/graph.json" }, "--format", "language-traversal",
                 "--project", "{project}", "--revision", "{revision}", "--generated-at", "{generatedAt}"], "roots": "arguments" },
      { "id": "android-reverse", "platform": "kotlin", "role": "reverse", "tool": "kartograph",
        "args": ["impact", "--format", "language-traversal", "--project", "{project}"], "roots": "roots-from" }
    ]
  }]
}
```

단일 member에 link가 없으면 surface 모드다. Action이 capture한 문서를 나눈다: target http(또는 사실 0건 openapi)
문서 중 server 역할·route-decl/route-contract·openapi 문서는 `--before`/`--after`, client 역할 문서는 head의 것을
`--clients`로 준다(원자 배포 모노레포). persistence·sql 문서는 diff에 넣지 않고 trace에만 쓴다. 앱 스토어에 나간
클라이언트를 기준으로 보려면 [미리 만든 문서 모드](#미리-만든-문서-모드)로 릴리스 태그의 클라이언트 문서를 준다.

## 두 저장소 — workspace

서버 저장소 PR에서 클라이언트 저장소는 **고정한 릴리스**(태그)로 옆에 꺼낸다. 서버만 base·head로 바뀌고 클라이언트
member는 두 시점에서 같다([HTTP-DIFF workspace 모드](HTTP-DIFF.md#workspace-모드)).

```yaml
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          path: server
          fetch-depth: 2
          persist-credentials: false
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          repository: example-org/example-client   # 비공개면 읽기 전용 토큰을 secret으로 준다
          ref: v3.2.0                               # 배포된 클라이언트 릴리스
          path: client-app
          persist-credentials: false
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: '22.18.0'
      - run: ./server/ci/install-producers.sh     # 자리표시자
      - uses: ictechgy/isthmus@<release-tag>
        with:
          repository-path: ${{ github.workspace }}/server
          capture-config: .isthmus/capture.workspace.json
          fail-on: error
```

```json
{
  "format": "isthmus-trace-capture", "version": 1,
  "roots": { "server": ".", "client": "../client-app" },
  "tools": { "tsograph": { "command": ["tsograph"] }, "kartograph": { "command": ["kartograph"] } },
  "members": [
    { "name": "server", "project": { "root": "server" }, "revision": { "git": true },
      "documents": [{ "name": "server.http.json", "tool": "tsograph", "args": ["routes", "--role", "server", "--project", "{project}"] }],
      "analyses": [{ "id": "server-forward", "platform": "js", "role": "forward", "tool": "tsograph",
                     "args": ["reach", "--project", "{project}", "--generated-at", "{generatedAt}"], "roots": "arguments" }] },
    { "name": "client", "project": { "root": "client" }, "revision": { "git": true },
      "documents": [{ "name": "android.http.json", "tool": "kartograph", "args": ["routes", "--role", "client", "--project", "{project}"] }],
      "analyses": [{ "id": "android-reverse", "platform": "kotlin", "role": "reverse", "tool": "kartograph",
                     "args": ["impact", "--format", "language-traversal", "--project", "{project}"], "roots": "roots-from" }] }
  ],
  "links": [{ "name": "mobile->api", "client": "client", "server": "server", "match": { "hosts": ["api.example.com"] } }]
}
```

member가 둘 이상이거나 link가 있으면 capture context는 workspace이고, Action은 base·head context에서 분석·catalog·
선택을 뺀 `isthmus-workspace` 매니페스트 두 개를 만들어 workspace 모드로 비교한다. 클라이언트 저장소 CI가 릴리스마다
올린 사실 문서를 쓰려면 capture 설정의 사전 계산 문서(`precomputed`)로 가리킨다.

## 미리 만든 문서 모드

생산자를 앞 단계에서 직접 돌렸거나 다른 CI의 artifact를 받았으면 capture 없이 문서를 준다. base·head 체크아웃은
사용자 단계의 몫이다. 경로는 `GITHUB_WORKSPACE` 기준이고 공백·줄바꿈으로 나눈다.

```yaml
      - uses: ictechgy/isthmus@<release-tag>
        with:
          before: ${{ runner.temp }}/base/server.http.json
          after: ${{ runner.temp }}/head/server.http.json
          clients: ${{ runner.temp }}/release-3.2/android.http.json
          trace-context: ${{ runner.temp }}/base/trace-context.json   # 선택 — 선택(selection)은 Action이 바꾼다
```

`before`·`after`에 workspace 매니페스트나 [http surface artifact](HTTP-SURFACE.md)를 하나씩 줘도 된다(모드는 CLI가
정한다). trace context의 상대 경로는 context 파일 기준으로 절대 경로로 바꿔 출력 디렉터리에 다시 쓴다.

## 입력

| 입력 | 기본값 | 뜻 |
|---|---|---|
| `command` | `analyze` | `analyze`(수집·diff·trace·렌더링) 또는 `comment`(내려받은 결과를 다시 렌더링해 게시) |
| `capture-config` | — | head commit에서 읽는 capture 설정(`repository-path` 상대). base·head에 같은 설정을 쓴다 |
| `before`·`after`·`clients` | — | 미리 만든 문서 모드. `capture-config`와 함께 쓸 수 없다 |
| `trace-context` | — | 미리 만든 문서 모드의 trace context |
| `trace` | `true` | 바뀐 route의 trace 여부 |
| `trace-side` | `base` | capture 모드에서 trace할 capture |
| `fail-on` | `error` | `diff --http --fail-on` 토큰. 빈 값·`none`은 보고만. 더 엄격한 게이트는 `error,incomplete` |
| `comment-mode` | `summary` | `summary`(job summary만) 또는 `sticky`(같은 job에서 댓글도 — `pull-requests: write` 필요) |
| `comment-key` | `default` | 한 PR에 isthmus 댓글을 여러 개 둘 때의 구분자 |
| `comment-author` | `github-actions[bot]` | 고칠 댓글의 작성자. 기본 토큰이 아닐 때만 바꾼다 |
| `max-rows`·`max-chains` | `20`·`50` | 댓글 표의 행 수와 `trace --max-rows`, `trace --max-chains` |
| `isthmus-version` | Action ref의 버전 | npm에서 설치할 정확한 버전(범위·태그 불가, `--ignore-scripts`) |
| `isthmus-path` | — | 빌드된 isthmus checkout(시험용). 주면 npm을 쓰지 않는다 |
| `repository-path` | `github.workspace` | capture 모드가 base·head로 바꾸는 checkout |
| `base-sha`·`head-sha` | 병합 commit 첫째 부모·`github.sha` | 비교할 두 commit. `pull_request` 밖(예: push)에서는 `base-sha`를 준다(`github.event.before` 등) |
| `output-dir` | `runner.temp/isthmus-ci` | 비어 있어야 하는 출력 디렉터리 |
| `upload-artifact`·`artifact-name` | `true`·`isthmus-http-impact` | JSON·댓글 artifact(행렬 job이면 이름을 다르게) |
| `results-dir`·`pr-number` | —·이벤트 PR 번호 | `comment` 명령 입력 |
| `expected-head-sha`·`expected-head-repository`·`expected-head-branch` | — | `comment` 명령에서 PR 번호를 artifact로 받을 때(workflow_run) 셋 다 필수 |
| `github-token` | `github.token` | 댓글 단계에만 넘긴다 |

출력: `failed`, `diff-exit-code`, `broken-calls`, `proven-broken-calls`, `incompleteness`, `call-impact`,
`output-dir`, `comment-file`. `call-impact`의 `no-breaks-observed`는 완전성 주장이 아니다.

artifact에는 `diff.json`(`isthmus-http-diff` v1), `trace.json`(`isthmus-trace` v1), `trace-context.json`(바꾼 선택),
`meta.json`(`isthmus-ci-meta` v1 — 종료 코드·fail-on·trace 상태·비교한 commit·단계 오류), `comment.md`, capture
설정 사본과 capture manifest가 들어간다. 생산자가 만든 사실 문서는 올리지 않는다.

## 종료 코드와 실패

- `diff --http`가 1(fail-on에 걸림)이면 `failed=true`이고 마지막 단계가 job을 실패시킨다. 판정은 CLI 종료 코드가
  정본이고 댓글은 걸린 finding 수를 함께 싣는다.
- 설치·checkout·capture·diff(2·64)·trace 실패도 `failed=true`다. 그래도 댓글·summary·artifact는 남는다 — 댓글 맨
  위에 "실행이 끝나지 않았다, 결과는 없거나 부분적이다"를 싣는다(빈 댓글이 깨끗함으로 읽히지 않게).
- 입력 자체가 틀리면(모드 충돌·잘못된 SHA·범위 버전 등) 출력 없이 분석 단계가 실패한다.

## 댓글 모양

합성 fixture(`scripts/fixtures/ci/make-demo-repo.mjs` — base에서 안드로이드가 부르는 `GET /api/users/{}`를 head에서
지운 저장소)의 결과다.

```markdown
<!-- isthmus-http-impact:default -->
### isthmus · HTTP route impact

> [!CAUTION]
> **1 client call(s) stop binding at head** — 1 proven, 0 unverified.

**fail-on** `error`: **failed** — 1 matching finding(s).

| Findings | error | warning | info | Routes +/−/~ | Broken calls (proven) | Rebound calls |
| --- | --- | --- | --- | --- | --- | --- |
| 2 | 1 | 1 | 0 | 0 / 1 / 0 | 1 (1) | 0 |

#### Client calls that stop binding (1)

| Severity | Finding | Route (scope · side) | Client call (file:line, symbol) | Head result | Unproven premises |
| --- | --- | --- | --- | --- | --- |
| `error` | `removed-bound-route` | `GET /api/users/{}` `default · decl` | `android/app/src/main/java/example/UsersApi.kt:12` `UsersApi.get` | `missing` | — |

#### Affected server code, data and clients (trace)

<details><summary><code>GET /api/users/{} (default)</code> — 1 handler(s), 2 table/column(s), 2 DB dependent(s), 1 client call(s)</summary>

- Handlers: `users.get`
- Tables and columns: `main.users`, `main.users.email`
- DB dependents: `main.active_users (view)`, `main.orders (table)`
- Client calls and affected client code:
  - `android/app/src/main/java/example/UsersApi.kt:12` `UsersApi.get` → affects `UsersRepository.load`, `ProfileViewModel.refresh`

</details>
```

- 순서: 실행 오류 → 결과 한 줄 → **불완전성 배너** → fail-on → 요약 표 → 끊기는 호출(error 먼저, 호출마다 한 행,
  `-unverified`는 빠진 전제 `reasons`) → incompleteness 표 → 다른 route가 받게 된 호출 → 표면 변화(info는 개수만) →
  trace(route마다 접은 블록, gap이 있으면 경고) → 범위 알림.
- 불완전성 배너는 incompleteness finding이 하나라도 있거나 `callImpact`가 `not-assessed`면 반드시 나온다. 깨짐이
  없는데 불완전하면 "깨짐 관찰 안 됨"과 배너가 함께 나온다.
- 위치는 생산자가 준 project 상대 경로다. workspace면 호출 위치 앞에 link의 client member 이름을 붙인다.
- 같은 입력이면 같은 바이트다(시각을 싣지 않는다).

## 보안

- **`pull_request_target`을 쓰지 않는다.** 그 이벤트는 base 저장소 권한·secret으로 돌기 때문에 PR 코드를 checkout해
  생산자로 실행하면 PR 작성자가 쓰기 토큰을 얻는다. `pull_request`에서 포크 PR의 토큰은 읽기 전용이다.
- **권한 최소화**: 분석 job은 `contents: read`만, `pull-requests: write`는 댓글 job에만 준다. secret은 필요 없다
  (비공개 클라이언트 저장소를 꺼낼 때의 읽기 토큰만 예외이며 출력·로그에 싣지 않는다).
- **토큰 분리**: `github-token`은 댓글 단계에만 환경 변수로 넘긴다. 생산자·isthmus 자식 프로세스 환경에서는
  `GITHUB_ENV`·`GITHUB_OUTPUT`·`GITHUB_PATH`·`GITHUB_STEP_SUMMARY`·`GITHUB_TOKEN`·`ACTIONS_*` 토큰 변수를 뺀다(PR
  코드가 뒤 단계를 조작하기 어렵게 하는 심층 방어 — 같은 job 안에서 완전한 격리는 아니다. 그래서 두 job 구성을 권한다).
- **식 주입 방지**: `action.yml`은 입력·이벤트 값을 `run` 스크립트에 `${{ }}`로 끼워 넣지 않고 환경 변수로만 넘긴다.
  PR 제목·브랜치 이름은 어디에도 쓰지 않는다. 오케스트레이터는 SHA·버전·fail-on 입력 모양을 검증하고 자식은 셸 없이
  인자 배열로 실행한다. 생산자·capture의 stderr는 `::stop-commands::`로 감싸 로그에 싣는다(워크플로 명령 주입 방지).
  `GITHUB_OUTPUT`에는 줄바꿈 없는 값만 쓴다.
- **다시 렌더링**: `comment` 명령은 artifact의 `comment.md`를 쓰지 않고 JSON을 Action 코드로 다시 렌더링한다. artifact는
  PR 코드가 만든 것이라 그대로 올리면 임의의 Markdown(링크·멘션)을 봇 이름으로 게시하게 된다. 이 보장은 **두 job 구성에만**
  있다. 한 job의 `comment-mode: sticky`는 분석 단계가 쓴 본문 파일을 올리므로 같은 job에서 돈 PR 코드(백그라운드 프로세스)가
  그 파일을 바꾸거나 게시 단계의 토큰을 읽을 수 있다 — 표식 검사는 내용의 경계가 아니다.
- **이스케이프**: 사실 문자열(경로·심볼·템플릿·scope·detail·오류 문구)은 모두 코드 스팬(표 안이면 `|` 이스케이프,
  backtick 수에 맞춘 울타리)이나 HTML 숫자 엔티티(`<summary>` 안)로만 싣는다. 줄바꿈·제어 문자는 공백으로 바꾸고
  값마다 160자로 자른다. 양방향 재배치(bidi)·폭 없는 문자는 지운다. 숫자는 안전한 정수만 싣는다.
- **크기 상한**: 댓글은 65,000자(GitHub 한도 65,536 이하)로 줄 단위로 자르고, 열린 `<details>`를 닫은 뒤 잘랐다는
  알림을 붙인다. 표마다 `max-rows`로 먼저 줄인다.
- **스티키 댓글**: 표식(`<!-- isthmus-http-impact:<key> -->`)으로 시작하고 `comment-author`가 쓴 댓글만 고친다.
- **SHA 고정**: Action 안의 서드파티 Action(`actions/upload-artifact`)과 예시의 Action은 commit SHA로 고정한다.
  사용자도 `ictechgy/isthmus`를 태그의 commit SHA로 고정하기를 권한다.
- **npm 설치**: 정확한 버전만 받고 `--ignore-scripts`로 설치한다. 네트워크는 npm registry와 GitHub API(댓글,
  얕은 checkout의 commit 가져오기)만 쓴다.

### 포크 PR에 댓글 달기 (workflow_run)

포크 PR의 `pull_request` 토큰은 쓰기 권한이 없어 댓글 단계가 경고만 남긴다(job summary는 남는다). 포크 PR에도
댓글이 필요하면 분석 workflow를 그대로 두고 **checkout 없는** 두 번째 workflow를 `workflow_run`으로 돌린다.

```yaml
# .github/workflows/isthmus-comment.yml
name: isthmus comment
on:
  workflow_run:
    workflows: [isthmus HTTP impact]
    types: [completed]
permissions:
  actions: read
  pull-requests: write
jobs:
  comment:
    if: github.event.workflow_run.event == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8.0.1
        with:
          name: isthmus-http-impact
          path: ${{ runner.temp }}/isthmus-results
          run-id: ${{ github.event.workflow_run.id }}
          github-token: ${{ github.token }}
      - uses: ictechgy/isthmus@<release-tag>
        with:
          command: comment
          results-dir: ${{ runner.temp }}/isthmus-results
          pr-number: ''                                            # artifact(meta)의 번호를 쓴다
          expected-head-sha: ${{ github.event.workflow_run.head_sha }}
          expected-head-repository: ${{ github.event.workflow_run.head_repository.full_name }}
          expected-head-branch: ${{ github.event.workflow_run.head_branch }}
```

PR 번호는 artifact(PR 코드가 만든 값)에서 오므로 `expected-head-sha`·`expected-head-repository`·`expected-head-branch`가
모두 필수다 — 게시기는 그 PR의 head commit·head 저장소·head 브랜치가 분석한 실행과 모두 같을 때만 댓글을 단다. head SHA만으로는
PR 신원이 아니다(남의 PR head commit을 자기 포크로 가져와 PR을 열면 SHA가 같다). head 저장소·브랜치는 그 PR을 연 쪽만 정할 수
있다. 이 값들은 식으로 `with:`에 넘기고 `run`에는 넣지 않는다(브랜치 이름은 신뢰하지 않는 문자열이다). 본문은 JSON을 다시
렌더링하므로 렌더러 틀을 벗어나지 못한다.

## 다른 CI에서 렌더러만 쓰기

렌더러는 npm 패키지에 들어 있다.

```bash
isthmus diff --http --before base.http.json --after head.http.json --clients clients.json > diff.json || test $? -eq 1
node node_modules/isthmus-cli/scripts/render-pr-comment.mjs --diff diff.json [--trace trace.json] [--meta meta.json] \
  [--max-rows 20] [--max-chars 65000] [--key default] > comment.md
```

종료 코드는 성공 0, 입력 오류 2(모르는 형식·읽기 실패), 사용 오류 64다. GitLab 등에서는 결과를 merge request 노트로
올리는 단계를 CI가 따로 둔다(렌더러는 게시하지 않는다).

## 자체 시험

[`.github/workflows/action-self-test.yml`](../.github/workflows/action-self-test.yml)은 isthmus PR마다 `uses: ./`로
Action을 합성 fixture에 돌린다. 댓글은 달지 않는다(job summary 모드).

- `precomputed (surface)`·`precomputed (workspace)`: `fixtures/http-diff/`와 `fixtures/trace-workspace/`로 보고 모드
  출력을 확인하고, `fail-on: error`면 단계가 실패하는지 본다.
- `capture`: `make-demo-repo.mjs`가 만든 합성 git 저장소에서 capture 모드를 끝까지 돌리고(생산자 없이 사전 계산
  문서만 복사) trace의 테이블·클라이언트 코드와 원래 commit 복원을 확인한다.
- `comment`(opt-in): 저장소 변수 `ISTHMUS_SELF_TEST_COMMENT`가 `true`이고 같은 저장소 PR일 때만 두 job 구성의
  댓글 경로를 돈다.

같은 경로는 `npm run verify`의 `scripts/ci-http-impact.test.mjs`·`render-pr-comment.test.mjs`·`post-pr-comment.test.mjs`도
로컬에서 확인한다.

## 한계

- `diff --http`와 `trace`는 isthmus-cli 0.10.0부터 발행본에 있다. `isthmus-version`에 0.9.0 이하를 주면
  `diff --http`가 사용 오류 64로 끝나고 댓글에 원인을 싣는다. 0.10.0 이전 태그에는 `action.yml`이 없다.
- 생산자 설치·실행 시간은 저장소마다 다르다. capture 단계별 시간 제한은 capture 설정(`timeoutSeconds`)이 정한다.
- trace 선택은 바뀐 route 1,000개까지다(넘치면 댓글에 수를 싣는다). trace 출력은 `max-chains`·`max-rows`로 잘린
  artifact다 — 전체가 필요하면 artifact의 `trace-context.json`으로 상한 없이 다시 돌린다.
- 같은 job 안에서 생산자(PR 코드)를 다른 단계와 완전히 격리할 수는 없다. `comment-mode: sticky`(한 job 구성)는 편의용이고,
  같은 저장소 PR 작성자는 이미 쓰기 권한이 있으며 포크 PR 토큰은 읽기 전용이라는 GitHub 모델에 기댄다.

## 변경 파일에서 페이지·서버 액션 추적

Action 0.12.0의 선택적 `trace-files`는 저장소 상대 경로나 `{member,path}` 객체의 JSON 배열이다.
예: `[{"member":"server","path":"src/lib/query.ts"}]`. 공백 있는 파일 이름도 JSON으로 보존한다.
최대 1,000개이며 절대 경로·`..`·제어 문자·역슬래시는 거부한다. 빈 입력과 `[]`는 기존 route 선택을 유지한다.

비어 있지 않으면 HTTP diff와 fail-on은 그대로 실행하고 trace 선택만 파일로 바꾼다. 따라서 API 표면이
같아도 공유 서버 코드 변경에서 페이지·서버 액션 영향을 볼 수 있다. capture 모드는 두 시점에서
심볼 목록과 2단계 역방향 roots를 수집한다. JS `impact` 명령에 tsograph 0.3.0의 `--entry-points`를
더하면 PR 댓글에 관찰한 진입점 종류·심볼·위치를 함께 표시한다. 생산자의 부재·candidate·잘림 공백은 유지한다.

`trace-side`는 기존과 같이 base(기본) 또는 head다. 삭제한 파일은 base, 새 파일은 head에만 있을 수
있으므로 선택한 시점에 없는 파일은 영향 없음 대신 `file-without-symbols` 등 공백으로 남는다.
precomputed 모드는 해당 파일에 roots를 둔 역방향 분석과 `fileSymbols`를 호출자가 준비해야 한다.
변경 파일 목록은 Git diff로 분석 job에서 만들고 입력을 환경 변수로 전달한다. PR 파일 이름을 shell
스크립트에 식으로 끼워 넣지 않으며, 분석 job에 댓글 쓰기 토큰을 주지 않는다.
