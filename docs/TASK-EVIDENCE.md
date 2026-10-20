# 작업 조회와 입력 근거 (실험적 v1)

## 설계 결정과 첫 수직 단위

2026-10-20, Isthmus main `a35f7c04d91c9c7b3b39147e19d62f8412a2a1b3`에서 시작했다.
기존 trace는 revision/graphRevision과 precomputed sha256을 검사하지만 bridge-facts에는 revision이 없다.
추출 시각 차이의 `input-freshness`는 동일 입력의 증거가 아니다.
Kartograph의 기존 bytes/membership·compiler witness·matched/stale/unverified 계약을 대신하지 않는다.

첫 단위는 **단일 project trace를 입력으로 하는 읽기 전용 `task` 명령**이다. 기존 trace와 check의
조인·규칙 및 trace 출력 상한을 재사용한다. 별도 그래프나 승인 엔진, HTTP payload 분석,
AI-DLC adapter, 생산자 실행·Git 조회·자동 capture는 만들지 않는다. workspace·preflight/impact의
추가 조립은 후속 단위다. 기존 capture 스크립트·입력 리더·SQL 벡터·생산자 lock은 변경하지 않는다.

bridge-facts와 language-traversal을 바꾸는 대신 **별도 선택적 manifest**를 쓴다. 기존 소비자가
무시하는 필드보다 더 작은 호환 경계이며 모든 생산자의 동시 출시가 필요 없다.
manifest는 trace context 자체, 소비한 모든 facts/traversal 및 선택적 검증 결과의 UTF-8 바이트를 묶는다.
CLI가 한 번 읽은 문자열을 캐시해 해시 검사와 실제 분석이 같은 내용을 소비하게 한다.

`alignment`는 선언과 바이트의 비교(`matched`/`stale`/`missing`/`unverified`)이고,
`verification`은 언제나 `unverified`다. 이 버전은 **수동 선언을 compiler receipt로 승격하지 않는다**.
동일한 생성 시각·commit·dirty=false·capture ID만으로 matched를 만들지 않는다. `matched`여도
현재 checkout, 실제 컴파일 성공, 테스트 실행 진위, 미선언 입력의 완전성을 입증하지 않는다.
stale가 하나라도 있으면 다른 missing/unverified와 함께 남긴다. 목록을 자르기 전에 전체 개수와
unknown 여부를 정하며 `complete: false`, `requiresReview: true`를 유지한다.

## 명령과 입력

```sh
isthmus task trace-context.json [--evidence evidence.json] [--limit 1..100] [--strict] [--compact]
```

기본은 보고서와 코드 0, `--strict`는 unknown·규칙 오류·실패한 검증이 있으면 1이다.
잘못되거나 읽을 수 없는 입력은 2, 잘못된 옵션은 64다. 기존 명령의 JSON·종료 코드는 바꾸지 않는다.
경로는 각 context/manifest 파일의 디렉터리 기준이다. manifest 경로는 프로젝트 상대 경로만 받는다.
검증 입력은 명시적으로 지정한 JSON만 읽으며 소스/디렉터리를 자동 탐색하지 않는다.

`isthmus-evidence-manifest` v1은 다음 모양이다(아래 해시는 예시이며 실제 파일의 해시로 바꾼다).

```json
{
  "format": "isthmus-evidence-manifest", "version": 1,
  "expected": {
    "captureId": "capture-001", "repository": "https://github.com/example/app",
    "commit": "0123456789012345678901234567890123456789", "dirty": true,
    "sourceDigest": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "sourceDigestScheme": "example-explicit-source-membership-v1",
    "toolchainDigest": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "buildConfigurationDigest": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
  },
  "artifacts": [
    {
      "id": "server-facts", "path": "server.http.json", "role": "bridge-facts",
      "sha256": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      "producer": { "name": "tsograph", "version": "0.1.0" }
    }
  ]
}
```

각 artifact의 선택적 `input`은 `expected`와 같은 필드 전부를 가진다. 생략하면 `missing`이며
`expected`를 상속하지 않는다. sourceDigest는 dirty 소스 **내용과 파일 membership**을 포함해야 한다.
scheme이 다르면 비교하지 못하므로 `unverified`, 나머지 알려진 값이 다르면 `stale`다.
toolchainDigest는 선택한 compiler/JDK/생산자 실행 환경, buildConfigurationDigest는 variant·target·
옵션·선택 입력을 포함하는 capture profile의 지문이다. 이 v1은 지문 계산기를 제공하지 않는다.
각 scope의 소스 집합·정렬·바이트·설정 계약을 scheme으로 명시하고 실제 생산자 receipt를 후속 연동한다.

role은 `trace-context`, `bridge-facts`, `traversal`, `validation`이다. id와 정규화된 path는 유일해야 한다.
출력 id는 `artifact:<manifest id>` 또는 `input:<입력 순번>`으로 구분해 누락 입력과 선언 id가 충돌하지 않는다.
최대 512 artifacts, 각 식별자는 최대 1,024자다. 모든 소비 입력에 항목이 필요하다. 미사용 artifact는
검사한 것으로 표시하지 않는다. producer는 실제 JSON의 `tool`과 비교하고 없으면 `unverified`다.
traversal/context가 revision을 제공하면 commit과 비교하며, bridge-facts의 revision 부재를 추측으로 채우지 않는다.

## 검증 결과와 먼저 볼 테스트

선택적 validation artifact는 아래의 작은 **관찰 전달 계약**이다. 테스트/규칙을 실행하는 엔진이 아니다.

```json
{
  "format": "isthmus-task-validation", "version": 1,
  "tool": { "name": "example-test-runner", "version": "1" },
  "tests": [{ "id": "users-get", "platform": "js", "usr": "ts:api/users.get", "outcome": "passed" }],
  "limitations": []
}
```

최대 1,000 tests, outcome은 `passed`/`failed`/`unknown`이다. test id는 결과 파일 안에서 유일하다.
trace가 실제 도달한 `(platform, usr)`와 정확히 같은 항목만 우선 확인 대상으로 낸다. 실패, unknown,
passed 순이며 이름으로 테스트나 호출 관계를 추측하지 않는다. 이유에는 원래 trace chain 번호와 도달 근거를
싣는다. 매핑이 없으면 `test-mapping-missing`이며 테스트가 없거나 통과했다는 뜻이 아니다.
관찰된 passed도 바이트·입력 선언 일치와 실행 진위를 구별한다. validation 항목의 한계도 unknown에 남긴다.

## 증명 수준과 후속 조건

### 다음 최소 단위: Kartograph native verification binding

2026-10-20 후속 설계. 참조 생산자 main은 `7b3acbbad87184992b39d948844318ba37fb153e`다.
`BuildWitnessCodec`의 witness v1/v2와 `ProvenanceVerifier`의 source/config/classes membership 검사를
다시 구현하지 않는다. 별도 수집 스크립트가 **같은 snapshot 바이트**에 대해 실제 Kartograph의
`verify-snapshot`을 facts/traversal 생성 전후에 실행하고, snapshot·실행 파일/명시적 runtime 파일 및
생성 artifact의 해시를 `isthmus-kartograph-receipt` v1으로 묶는다. 첫 지원은 persistence facts와
그 facts의 실제 USR을 roots로 한 역방향 language-traversal이다.

native 결과 `matched`/`stale`/`unverified`와 원인을 그대로 보존한다. 실행 실패·형식/버전 오류는
receipt를 만들지 않는다. snapshot/producer 바이트가 중간에 바뀌면 stale이며 생성 시각은 쓰지 않는다.
이 receipt는 **수집 당시의 native 판독**이다. 오프라인 task가 파일 해시를 대조해도 현재 source/config를
다시 읽었다고 주장하지 않는다. 수동 manifest의 `verification: unverified`는 유지한다. 악의적인 생산자나
pre/post 사이의 변경 후 원복을 배제한다는 인증도 아니다.

manifest의 선택적 `kartographReceipt: {path, sha256}`는 그 receipt 바이트를 지정한다. 소비자는
실제 소비한 artifact id·해시·역할·생산자 버전과 대조하고 native 수집 상태와 오프라인 일치를 따로 낸다.
receipt에 없는 artifact, missing/unknown native 근거를 clean으로 승격하지 않는다.

수집은 사용자가 신뢰하는 producer/config에서만 실행한다. 제품 CLI는 producer를 실행하지 않는다.
먼저 해당 프로젝트의 지원 Gradle compiler task로 witness/snapshot과 checkout-local input bindings를
만든 뒤 `node scripts/capture-kartograph-evidence.mjs capture.json`을 실행한다.

```json
{
  "format": "isthmus-kartograph-capture", "version": 1,
  "command": ["/work/tools/kartograph/bin/kartograph"],
  "runtimeFiles": ["/work/tools/kartograph/lib/each-actual-runtime.jar"],
  "project": "/work/project", "snapshot": "/work/project/build/reports/kartograph/jvm-snapshot.json",
  "scope": "selected-project-scope", "inputBindings": "/work/project/build/kartograph/jvm-input-bindings.json",
  "output": "/work/new-capture-directory"
}
```

`command`는 절대 경로 실행 파일과 명시적 prefix 인자 배열이며 셸로 해석하지 않는다. `runtimeFiles`에는
실제로 쓰는 CLI JAR 전체를 선택한다. 옵션/credential/environment 파일을 자동 수집하지 않는다.
output은 새 디렉터리여야 한다. 생성 파일은 `snapshot.json`, `persistence.json`, `roots.json`,
`reverse.json`과 `receipt.json`이며, facts에 USR이 없으면 roots/traversal을 만들지 않고 한계로 남긴다.
manifest artifact id는 각각 `kartograph-persistence`, `kartograph-reverse`를 사용한다.

검증 경계: 현재 Windows에는 Java/Javac/Gradle/Kartograph 실행 파일이 없어 실제 receipt 생성은
차단되어 있다. 새 로컬 설치를 하지 않는다. 승인된 GitHub CI는 고정 Kartograph source, Temurin
17.0.17+10, checksum이 고정된 생산자 Gradle 9.7.1 wrapper를 사용한다. JDK 배포 식별자는
[공식 Temurin 발표](https://adoptium.net/news/2025/11/eclipse-temurin-8u472-11029-17017-2109-2501-available)에서 확인했다.
Node 테스트의 fake producer는 프로세스·해시·오류 경계만 검증하며
실제 컴파일 증거로 세지 않는다. 실제 fixture는 지원 JDK와 공식 생산자에서 compile → witness/snapshot →
capture를 실행하고, 동일 크기/mtime 소스 변경·build config 변경·class 변경·missing binding·legacy snapshot을
native 결과와 대조해야 한다. 실행 경로가 승인·확인되기 전에는 이 실제 fixture를 통과했다고 보고하지 않는다.

Swift compiler index·Kotlin/JVM bytecode는 소스 해시만으로 그 소스에서 빌드됐다고 할 수 없다.
Kartograph의 지원 compiler lifecycle receipt 및 bytes/membership 비교를 재사용해야 한다.
소스를 직접 읽는 생산자도 읽은 파일의 pre/post membership·내용과 도구/설정의 결합을 증명해야 한다.
이 수동 v1은 어느 언어도 그 수준을 증명한다고 주장하지 않는다. SQL catalog와 runtime 관찰도
각자의 scope·실행 환경 증거가 필요하다. Windows의 합성 JSON 테스트는 Swift/macOS 빌드 검증이 아니다.

다음 단계는 지원 생산자 **하나**의 receipt를 이 manifest에 손실 없이 연결하고, 실제 dirty 소스·
build configuration 변화 및 stale artifact로 검증하는 것이다. 그 뒤 작업 인터페이스를 preflight/impact로 확장한다.
Pythograph #23, Isthmus #154/#155의 작업·리뷰·머지는 이 변경에 포함하지 않는다.

효과 측정은 source-only / tools-only / task-integrated를 같은 모델·과제·예산으로 비교할 수 있게
분리한다. 각 조건의 실제 query 호출 수, 입력 준비/해싱 시간, 조회 시간, 사용 토큰, 정답·unknown·
실패를 따로 기록한다. 기존 Kartograph 후속 24회(각 6/12 성공, 실제 graph query 0회)는 생산성 향상의
증거가 아니다. 이번 기능·합성 테스트 통과로 생산성 향상을 주장하지 않는다.
