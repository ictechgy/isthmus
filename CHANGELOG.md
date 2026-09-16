# Changelog

이 프로젝트의 주요 변경 사항을 기록한다.

## [Unreleased]

### Added

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
  기존 check·query·graph·diff 파이프라인에 그대로 들어간다. Expo Modules
  호출명은 읽지만 Expo 전용 의미(`mechanism`)는 아직 계약에 없다.

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
