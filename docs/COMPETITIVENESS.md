# 변경 사전 점검 목표와 검증 기록

2026-09-14 시작. 사용자 목표는 아래 네 가지이며, 일부 명령의 테스트 통과로 전체 목표를
완료 처리하지 않는다. MIT·로컬 실행·근거와 분석 한계 보존은 유지한다.

## Android 확장 진행 — 구현을 계속할 것

최신 사용자 지시: **"쭉 진행해줘. 더불어 android 쪽 브릿지도 해줘"**.
타당성 조사를 다시 시작하지 않는다. 기존 네 가지 개선 목표에 Kotlin/Android를 추가해
구현·실제 producer/실행 검증을 진행 중이며 아직 전체 완료가 아니다.

- 소비자 개발 소스에 Kotlin preflight 선택/분석, Method·Basic 입력, runtime 플랫폼별
  후보 분리, Kotlin-only diff를 추가했다. Swift와 Kotlin을 한 diff에 섞어 삭제가 가려지는
  입력은 계속 거부한다. Kotlin `kartograph-impact`의 current 경로·원래 edge origin을
  사용하며 base 경로와 누락된 중간 심볼은 현재 간선으로 만들지 않는다.
- JVM 실제 출력의 nullable 좌표를 확인했다. Kotlin 분석 심볼은 `{path,line?,column?}`를
  보존하며 열 번호를 합성하지 않는다. Dart binding과 bridge fact의 완전한 좌표 규칙은
  유지한다. 일치하는 부분 위치는 보강하고 알려진 좌표가 충돌하면 거부한다.
- capture는 선택적 `kartograph`/`kartographSnapshot`과 `.kt`/`.java` 변경을 지원한다.
  snapshot 내용·실행 도구·JAR 입력을 신선도에 반영하고 미구성 플랫폼 변경은 공백으로
  남긴다. Android-only source 구축은 Swift를 요구하지 않는다.
- 소비자 전체 verify 통과: 제품 424, Phase 0 15, workflow 19; coverage
  line/branch/functions 98.41/92.37/95.42 (`/tmp/isthmus-android-final-root-verify.log`).
  CLI exit 0/1/2/64와 npm package 계약도 통과했다. skill YAML·발견 경로와 문서 링크 42개를
  확인했다. Python skill validator는 PyYAML 부재로 실행하지 못해 Ruby Psych로 구조를 확인했다.
- GLM consumer C1/C2(생략 중복 계수·부분 위치 병합)는 회귀로 재현해 수정했다.
  packet 208,153 bytes SHA `edf0aa775fe3`, `/tmp/isthmus-android-consumer-glm.log`.
  기존 macOS 실행 요약은 새 소비자로 재생해 4 checks/20 gaps/strict 1이 동일했다.
- 실제 Android API36 arm64에서 자체 Method/Basic과 공개 shared_preferences_android 2.4.1
  Pigeon getBool 성공 3개, 기대 실패 3개와 pending을 검증했다. 동일 project/capture revision의
  정적 후보 연결도 통과했다. `isthmus-android-evidence-pSv9ye/verification.json`(macOS 임시 루트):
  65.419초, source capture 6.811초, cache 184ms, 반복 APK build 1.906초. 준비된 SDK/캐시 환경이며
  최초 설치·원격 CI 시간은 아니다. 미해석 근거는 남아 있고 strict 전체 성공을 주장하지 않는다.
- Dart의 같은 이름 후보는 실제 producer ID를 재조회한 뒤 파일 위치로 연결하도록 수정했다.
  다른 파일의 `main`을 선택하지 않으며 같은 파일의 상충하는 후보는 연결하지 않는다.
- Dartograph 개발 clone `/tmp/isthmus-dartograph-basic`의 `source_packages` opt-in을 실제 공개
  생성 `messages_async.g.dart`에 적용해 getBool의 실제 Dart ID/위치를 확인했다. 두 번째 공개
  native 심볼 선택은 별도 revision으로 수집하고 이미 실행한 runtime revision을 바꿔 맞추지 않는다.
- 공개 native 심볼 전파도 통과했다. Kotlin `6ebca9a`와 Dart `23d4d35`의 실제 Android
  `isthmus-android-evidence-Kb2VfW/verification.json`: SharedPreferencesPlugin.getBool의 정확한
  JVM ID → generated Dart getBool → 앱 main. 선택 1, 영향 심볼 38, 경계 13, 검토 파일 6이다.
  공통 setUp의 보수적 전파 때문에 다른 Pigeon 메서드도 후보이며 70개 공백을 유지한다.
  하네스 전체 80.789초, 최초 capture 7.916초/cache 178ms, 공개 심볼 capture 13.517초,
  반복 APK build 1.894초다. 성공 3·기대 실패 3·pending과 같은 capture의 runtime 대조가 통과했다.
  CqHzfs의 실패 snapshot은 회귀 근거로 보존했다. Kotlin 문자열·모호한 함수 선택에 대한
  추가 경계 검토는 별도 최종 커밋으로 반영 중이며 고정 소스 설치본 검증은 다음 단계다.
- 설치본 `--explain`에서 Dart 분석 root에 위치가 없으면 별도 query의 선언 위치도 출력에
  빠지는 문제를 발견해 수정했다. 기존 심볼 종류를 유지하며 위치를 병합하고 모순된 위치·
  bridge USR은 거부한다. Method/Basic 회귀 3개와 실제 Kb2VfW context에서 generated getBool의
  원본 `messages_async.g.dart:244:3` 보존을 확인했다. 해당 좁은 GLM 리뷰 로그는
  `/tmp/isthmus-dart-declaration-glm.log`다.
- 검증 하네스는 직접 시작한 emulator process group의 종료를 확인하고 임시 파일을 정리한다.
  종료 확인 실패는 성공 처리하지 않으며 이미 기록된 부분 JSON을 정리 전에 보존한다.
  CqHzfs의 cleanup은 실제 owned AVD 확인·정상 종료까지 통과했다.
- Kotlin clone은 `/Users/jinhongan/.local/share/isthmus/worktrees/kartograph-android-awc0xhru/repo`,
  branch `feat/isthmus-android-bridges`, 통합 기준 `32809b5`다. 이전 project/역방향 send/graph-file/
  함수 범위 문제가 수정됐고 필수 Gradle·Kover·CLI·agent·compiler fixture·analysis gates를 통과했다.
  GLM C1~C3 및 실제 공개 함수 매핑을 후속 회귀로 검증 중이다.
- worker `android_kotlin_producer`는 Kotlin clone, `android_runtime_harness`는 현재 Dart clone의
  source_packages 후속 검증만 소유한다. root가 Android harness·capture·소비자·최종 통합을
  소유하며 원본 자매 저장소와 기존 미커밋 HANDOFF/리서치 문서를 보존한다.

다음 실행: Kotlin/Dart 최종 회귀 → 고정 source 구축과 설치본 Android 검증 → 재개 기록. GLM follow-up packet 92,096 bytes SHA
`063ec5f7f07d`(`/tmp/isthmus-android-followup-glm.log`): D1의 빈 Dart 선택은 실제 호출부가
건너뛰므로 재현되지 않는다. D2는 AVD 불일치 진단·소유 config 보존으로 보강했다. D3은
재조회 미해결 후보 수를 명시하고 해당 공백의 캐시 보존을 red→green 회귀로 확인했다.
입력 선택의 한계 목록과 수집 결과의 한계를 분리해 결과 추가를 입력 변동으로 오인하지 않는다.
공개 호환 버전·원격 CI·첫 외부 사용자·실제 변경 대비 효용 비교는 별도 잔여 목표다.

## 구현 재개 — 범위 누락·경로 별칭 수정과 최종 native 검증

2026-09-14 사용자 정정에 따라 타당성 조사 반복을 멈추고 기존 네 가지 개선 목표의
구현·검증을 재개했다. 아래 작업은 새 리서치 계획이 아니라 실제 수정과 실행 결과다.

- Cartograph `f2d77c1`: handler 범위 목록이 비거나 일부만 전달되면 `complete: false`를
  보존한다. 관찰한 closure 참조를 공통 등록 의존으로 잘못 넓히지 않고 해당 handler에
  남긴다. 같은 선언·범위의 경로 별칭 중복은 병합해 Dictionary 충돌을 없앴다.
  누락/부분 목록의 잘못된 완전성·의존성, 경로 별칭의 실제 크래시를 먼저 재현했다.
- 관련 45tests 통과, 1000 handler 분리 검사 0.492초. 전체 coverage 90.11%, CLI·실제
  compiler fixture·self dead/module cycles/type cycles/rules 통과.
  로그는 `/tmp/isthmus-scope-inventory-{red,green}.log`, `/tmp/isthmus-scope-alias-red.log`,
  `/tmp/isthmus-scope-final-*.log`다. GLM 후속 지적의 누락 목록·별칭 충돌을 실제 재현해 반영했다.
- isthmus `5241187` / Cartograph `f2d77c1` / Dartograph `df5c414`를 새 디렉터리에 구축·
  격리 설치했다. 45.112초(SDK·전역 의존성 캐시 준비 상태). 재사용 위치는
  `/Users/jinhongan/.local/share/isthmus/toolchains/f2d77c16f521/`이며 `toolchain.json`에
  정확한 버전·실행 경로·hash가 있다. 소스 Git bundle도 별도로 보존했다.
- 이 **최종 설치본**으로 실제 macOS Flutter native 검사 통과(전체 하네스 60.401초):
  성공 check 4개/2개 scenario-platform 쌍, 기대한 error/missing-handler/timeout 3개,
  pending 구분. 같은 revision의 정적 후보와 실행을 대조했다. 설치본 summary는
  12,921 bytes, native 후보 위치·2쌍/4checks·정적 errors 2와 gaps 20을 유지하며 strict 1이다.
  errors는 의도적으로 등록하지 않은 fixture 경계이며 분석 공백을 성공으로 숨기지 않았다.
- 공개 Pigeon launch/canLaunch/setup의 독립 영향, path_provider/shared_preferences 경로,
  합성 retention→dead 억제·explain과 limitation 스코프 검증도 최종 설치본으로 통과했다.
- 공개 battery 검증에서 기존 스크립트가 허용된 ObjC 이름 신원(USR 없음)을 거부했다.
  이전 Cartograph `628f9b9`에서도 실패를 재현해 이번 producer 회귀와 구분했다.
  `verify-public-flutter-plugin.mjs`가 고정 source의 정확한 handler 이름을 인정하도록 고친 뒤
  공개 source→retention→consumer 검증을 통과했다. sourceLanguage·원본 경로·동적 여부와
  USR이 있을 때의 Clang 식별자 요구는 유지했다. 이 하네스 수정은 위 `5241187` 뒤의 변경이다.

설치 디렉터리의 `verification/`에 실행 로그·원본 실패와 수정 후 성공·runtime JSON 및
summary를 보존했다. iOS/Android 실제 실행, 전체 앱 탐지율, 원격 PR/CI와 공개 호환 버전은
이 결과에 포함되지 않는다. 전체 네 가지 목표를 완료한 것으로 표시하지 않는다.

## 고정 소스 구축·producer 통합 체크포인트

이전 턴은 구현·실행 검증·커밋을 완료한 progress다. 현재 원본 자매 저장소의 작업을
변경하지 않고 별도 통합 branch에서 진행한다. 아래 이전 기록의 미완료 항목과 구분한다.

- Cartograph 원본 `de1bac9`의 작업 트리를 전후 hash 일치로 복사해 `6b507a6` 기준선을
  만들고 Basic을 합쳤다. integration branch는 `feature/isthmus-preflight-integration`,
  checkout은 `isthmus-cartograph-integration-8dpr_1c_/repo`(아래 임시 상위 경로)다.
  원본의 impact/MCP/runtime와 Basic이 한 실행 파일에 있다. 최종 현재 commit `628f9b9`.
- 새 source archive 구축에서 발견한 handler 범위 중복을 고쳤다. 실제 겹침은 여전히
  incomplete이며, 전이 override와 모호한 dispatch/위치 없는 대상도 검증했다. 큰 setup의
  범위·참조를 선언/owner별로 분류하고 파일 사이의 dependency 생성 예산을 공유한다.
  1000 handler 구문/합성 인덱스 분리 검사 약 0.48초, 범위·예산 변이 검사는 실제 실패했다.
  coverage 90.07%, CLI/fixtures와 self dead/module·type cycles/rules 통과.
  `/tmp/isthmus-main-integration-final-*.log`, `/tmp/isthmus-main-self-*.log`.
- Dartograph 최종 현재 commit `df5c414`: mutable 필드 진입 상태를 initializer로 단정하지
  않고, 직선 대입과 독립 then/else·closure/loop/switch 상태를 구분한다. exporter version/
  transport pair 검증과 Basic 전용 dynamic limitation을 추가했다. 400tests, coverage 91.51%,
  analyzer boundary·CLI·false-positive corpus·AOT·pub dry-run 통과. c6 직렬 실행 로그 참고.
- 실제 Flutter Basic API + mock messenger에서 같은 mutable 호출의 a/b 변화, 고정 필드 a,
  직선 대입 b, else 경로 a를 실행하고 producer와 대조했다. mutable 주소는 확정하지 않으면서
  나머지 세 경로의 정확한 주소를 보존한다. native IPC 검증은 아니다.
  `isthmus-binding-evidence-XIggQ5/verification.json`.
- `build-preflight-toolchain.mjs`는 세 저장소의 전체 commit ID만 새 디렉터리에 archive하여
  Swift/Dart AOT/npm 설치본을 구축한다. 기존 destination 보호, 잘못된 commit과 JSON 원문
  비노출 검사를 추가했다. 첫 전체 구축은 63.685초(SDK/전역 의존성 캐시 준비 상태).
  최초 bdb24e2/0305fcf/8795857 조합에서 실제 source 회귀를 찾아 수정했으므로 그 빌드의
  capability 성공을 최종 public 검증 성공으로 오인하지 않는다. 이후 최종 refs 재구축 결과는
  아래 재확인 절에 있다.
- GLM Dart 검토: SHA 02f6f1eae0a1, 125,892 bytes. 실제 field mutation·exporter pair·문구를
  수정했다. redaction으로 변형된 테스트 문자열은 원본 검사 실패가 아니다.
  GLM Swift 검토: SHA 1cdcebf1a096, 237,588 bytes. opaque gap·ambiguous dispatch를 반영했고
  예산이 fact별이라는 지적은 map 바깥의 document budget으로 반증했다. 실제 생성 비용과
  범위 중복은 별도 재현·수정했다. `/tmp/isthmus-{dart,swift}-producer-glm.log`.
- 하위 작업자의 사용량 제한 후 main이 변경과 로그를 이어받아 검증했다. 원본 자매 worktree는
  보존되어 있으며 commit/branch가 다른 세션의 작업을 덮어쓴 상태가 아니다.

2026-09-14 실용성 조사에서 최종 구축 기록과 공개 source 검증 로그를 재확인했다.
isthmus `5241187` / Cartograph `628f9b9` / Dartograph `df5c414`의 새 source/build 구축은
48.033초(SDK·전역 의존성 캐시 준비 상태)였고, 같은 Cartograph 실행 파일의 impact/Basic을
사용한 공개 Pigeon·foundation 두 패키지와 Flutter mock 바인딩 검증이 통과했다.
`/tmp/isthmus-final-toolchain-build.log`, `/tmp/isthmus-final-clean-{pigeon,foundation,binding}.log`.
이 결과는 최초 외부 사용자 설치나 최종 구축물의 실제 native 앱 재실행 근거가 아니다.
경쟁 대안·실패 요인 10개·외부 사용자 평가 제안도 [FEASIBILITY.md](FEASIBILITY.md)에 갱신했다.

다음 작업: 최종 도구 조합의 native 실행·남은 리뷰 검토 → 원격 PR/CI와 공개 호환 버전
정리 → 첫 외부 사용자 구축 및 더 넓은 변경 표본 평가. 전체 목표는 active다.

2026-09-14 현재 체크포인트. isthmus 구현 커밋은 `6503516`이다.
이전 턴은 실제 검증 근거가 다음 수정을 결정한 progress였고,
아래 구현·검증을 추가했다. 뒤의 과거 수치와 미지원 문장은 해당 실행 시점의 기록이다.

- **전이 영향 정밀도:** Basic v2의 handlerScope/dependencies/실제 overrides dispatch 후보를
  조인한다. 직접 선택한 setup·공유 등록 의존은 전체, 개별 handler 의존은 해당 boundary로
  전파한다. 근거가 불완전하면 넓은 후보와 공백을 남긴다. 공개 url_launcher_macos 3.2.2의
  launch 변경→Dart launch만, canLaunch 변경→Dart canLaunch만, setup 변경→둘 다를
  원본 source·실제 compiler index·producer로 검증했다. 초기 complete=false 원인은 인덱스에서
  parameter 대상 종류가 사라진 것이었고 producer에서 실제 종류를 보존해 해결했다.
  공개 근거 `isthmus-pigeon-evidence-3karpn`(macOS 임시 디렉터리), 최초 수집 11.022초,
  canLaunch 재선택 2.470초·setup 재선택 3.082초. 캐시 실행 시간으로 해석하지 않는다.
- **공개 source corpus:** path_provider_foundation 2.4.1의 getDirectoryPath→generated API→
  getTemporaryPath, shared_preferences_foundation 2.5.4의 getValue→generated API→getString을
  검증했다. production lib/native/LICENSE를 byte 동일하게 복사하고 실제 FlutterMacOS로
  컴파일했다. 각각 첫 수집 15.155/17.169초, 단일 선택 3.054/3.119초, 근거 공백 8/7개 유지.
  근거 `isthmus-public-foundation-evidence-2Ei1St`. 앱 실행이나 UserDefaults 접근은 하지 않았다.
- **실제 native 통합:** 최신 producer로 자체 Basic과 공개 Pigeon의 정적 후보·runtime을
  같은 revision에서 대조했다. Method closure의 helper가 Basic 등록 의존으로 섞이지 않는
  것도 raw dependency로 확인했다. 성공 check 4개(2 scenario/platform 쌍), 기대 실패 3개,
  pending 미완료를 구분했다. 전체 69.321초, runtime aligned/passed이나 정적 errors 2·gaps 20과
  strict 1을 유지한다. 근거 `isthmus-native-evidence-tErDYr/verification.json`.
- **AI 질의:** summary/explain을 배포 skill·양문 README·패키지 계약에 연결했다. 요약에도
  candidateKey와 bounded native handler 위치를 제공한다. 최종 독립 forward test는 CLI 1회,
  isthmus-preflight-summary 12,893 bytes로 2개 시나리오·4개 check·native 후보·20개 공백을
  구분했다. 초기 스킬의 runtime 예시가 전체 출력을 쓰던 불일치와 summary의 다른 root를
  explain 경로로 서술한 오류는 수정했다. 출력 경로는 실제 result.path를 그대로 따른다.
  최종 tarball을 네트워크 없이 격리 설치해 같은 runtime 요약·후보 위치·2쌍/4checks를
  확인했다. `isthmus-final-installed-v8c46uwy/verification.json`에 근거를 보존했다.
- **검증·성능:** npm verify 제품 405개·Phase 0 15개·수집 7개·build/CLI/package 통과,
  coverage line/branch/functions 98.26/92.84/95.17. `/tmp/isthmus-scoped-final-verify.log`.
  10,000 Basic handler의 단일 구현 선택은 5회 중앙 189ms·최대 190ms, summary 1,817 bytes.
  다른 소비자 대형 입력도 5초 예산 통과(`/tmp/isthmus-scoped-final-benchmark.log`). CI에 같은
  소비자 성능 검사를 추가했다. producer/인덱스/앱 빌드 시간은 이 게이트 밖이다.
- **GLM 소비자 검토:** packet SHA 133e2228e52d, 179,019 bytes, low. F4(같은 위치의 다른
  동적 표현식 소실)를 재현·수정했다. F1은 endpointKey의 nodes.has guard로 반증했고,
  F2의 미변경 dependency는 관련 boundary.receiver에 보존됨을 확인했다. F3은 공통
  inputFailureResult가 BridgeJoinValidationError를 처리한다. F5의 혼합 metadata는 의도한
  보수적 전파이며 회귀·문서로 고정했다. `/tmp/isthmus-basic-final-glm-review.log`.
- **자매 저장소:** 격리 Cartograph d8870e7·723d788, Dartograph 7d96f3b로 커밋했다.
  Swift coverage 90.43%와 CLI/fixture/self 분석 필수 게이트가 통과했다. Dart analyze·391tests·
  compile·CLI·pub dry-run은 통과했으나 기존 runtime_scanner의 analyzer 경계 게이트 실패를
  parent에서도 재현했다. `cb3f2b7`에서 AST 구현을 index로 옮기고 기존 import 경로를
  re-export로 유지해 boundary gate도 통과했다. import 경로를 제외한 구현 body 동일성과
  runtime/bridge 회귀·391tests·CLI·compile·pub dry-run을 확인했다. 원본 dirty 자매 worktree는 보존했다.
  자매 PR별 GLM 검토·공개 호환 버전·원격 CI는 아직 남았다.

위 macOS 임시 근거의 상위 경로는
`/var/folders/lw/r6rd_zlj3ps7pb_h2sdtcr3w0000gn/T/`이며 일부 realpath 표기는 `/private`로 시작한다.
source 프로젝트는 하네스 종료 때 정리되므로 보고서의 source 경로를 실제 로컬 파일 링크로
만들지 않는다. 재현은 scripts의 검증 진입점을 사용한다. Basic Dartograph AOT는
`isthmus-dartograph-basic-aot-ekr6kosa/dartograph`에 있고 준비 12.027초·source hash 전후 일치를
확인했다. 원본 source는 이후 구조 보강될 수 있으므로 이 AOT의 build-time hash와 구분한다.

다음 순서: 자매 PR GLM 리뷰·호환 producer 버전 통합 → 실제 원격 CI/첫 사용자 구축 검증.
현재 Basic Cartograph 격리 branch의 base에는 기존 원본 worktree의 미커밋 impact 구현이
없어, 검증 하네스는 명시한 impact binary와 Basic binary를 나눠 사용했다. 외부인이 하나의
공개 호환 버전으로 구축할 수 있는 상태로 아직 안내하지 않는다. 더 넓은 변경 표본의 누락/오탐·검토
시간 비교와 prefix/instance·플랫폼별 미검증 범위는 계속 평가한다. 전체 네 목표는 active다.

2026-09-14 실용성 재검증: 미커밋 Basic/Pigeon·summary/explain 변경을 포함한
`npm run verify`가 제품 396개·Phase 0 15개·수집 7개·build/CLI/package를 통과했다
(line/branch/functions 98.23/92.49/94.75, `/tmp/isthmus-feasibility-current-verify.log`).
공개 Pigeon의 실제 producer context를 최신 CLI로 재생해 두 경계·공개 Dart 소비자 경로와
errors 0·evidenceGaps 9·requiresReview true·strict 1을 확인했다. 기존 native 앱 실행 근거는
재사용했으며 이번에 native 앱을 재빌드하지 않았다. 공통 `setUp` 신원에 의한 메서드별
영향 후보의 과잉 전파 가능성을 후속 정밀도 검증에 포함한다. 경쟁·대안·실패 요인과
외부인 구축 검증 제안은 [FEASIBILITY.md](FEASIBILITY.md)를 갱신했다. 아래 Basic 미지원·
요약 개선 예정 문장은 이전 실행 시점의 기록이며 최신 소스의 전면 미구현을 뜻하지 않는다.

2026-09-14 최신 구현: `preflight`에 독립 runtime 기대/기록 대조도 연결됐다.
실제 macOS 앱에서 compiler index→producer→Swift helper→Dart 소비자와 실행을 같은
capture revision으로 검증했다. 아래의 합성 source 검증과 구별한다.

- 전체 Node verify: 제품 378개·Phase 0 15개·수집 workflow 6개, coverage
  line/branch/functions 98.49/93.03/96.00, build/CLI/package 통과.
  `/tmp/isthmus-runtime-preflight-final-verify.log`. 이후 GLM 지적 재현을 위한 테스트 2개를
  추가해 해당 파일 전체 11개와 typecheck를 통과했다(제품 구현은 변경되지 않음).
- Flutter recorder 16개 테스트·analyze 통과. timeout 관찰과 실제 Future의 응답 대기를
  분리해 늦은 응답 후 completed를 허용한다. timeout 결과·늦은 예외 전달은 유지하며,
  아직 응답이 남거나 finish로 동결된 미완료 기록은 완료로 바뀌지 않는다.
- 실제 native 실행: 성공 기대 4개(동적 MethodChannel·전이 소비자·자체 Basic·공개 Pigeon),
  의도된 error/missing-handler/timeout 기대 3개 통과. pending은 strict 실패 유지.
  `runtime.aligned: true`, `runtime.verification.status: passed` 확인.
  전체 58.539초: Flutter index 준비 19.672초·Xcode index 15.694초·runtime 빌드 7.279초·
  재빌드 4.454초·앱 실행 1.117초(나머지는 수집·도구 실행·의존성 준비 등).
  근거 `/var/folders/lw/r6rd_zlj3ps7pb_h2sdtcr3w0000gn/T/isthmus-native-evidence-jn0EwY/verification.json`.
- 해당 실제 기록을 최종 CLI로 재생해 native 후보 위치·누락된 전이 시나리오·오래된 기대·
  비기대 실패 3개를 확인했다. 정적 오류 2개는 의도적으로 등록하지 않은 missing-runtime
  채널에서 발생했고, Basic 정적 미지원·미관찰/미포함 경계는 preflight strict 1로 남았다.
  정적 후보는 실행한 native 심볼의 확정이 아니다.
- 소비자만 측정: 20,000 전이 소비자 + 100,000 runtime events + 1,000 기대를 새 CLI
  프로세스 5회에서 중앙 316ms·최대 319ms. 출력 9,540,579 bytes.
  `/tmp/isthmus-runtime-preflight-benchmark-final.log`. 출력량이 커서 AI용 요약·경로 조회의
  명시적 한도 제공은 다음 개선 후보이며 compact의 정보 보존 원칙과 구분해야 한다.
- Dartograph 0.8.0을 원본 저장소 밖의 `/tmp/isthmus-dartograph-aot-Yjb0Yf/dartograph`로
  컴파일해 native 통합에 사용했다. 원본 bin/lib/pubspec/lock/package_config 해시가 컴파일
  전후 같은지 검증했고 빌드는 11.605초였다. 이 최초 도구 준비 시간은 위 native 실행 시간 밖이다.
  형제 저장소의 소스 변경은 하지 않았다.
- GLM 검토(packet SHA `d2eb76df713b`, 129,582 bytes, low, 약 315.7초): runtime/preflight·
  recorder·관련 테스트/계약 범위. F1은 성립하지 않는다: required 경계 키는 반드시 byRoute에
  있어 그 경계를 관찰한 주소라면 keys.length가 0일 수 없다. 같은 파일의 다른 주소를
  caller-file로 수집해도 원래 경계는 미관찰로 남는 테스트와, 같은 주소의 다른 시나리오가
  독립 기대를 통과하지 못하는 테스트로 확인했다. F2는 후보의 sourceLanguage를 보존하는
  의도된 동작이며 Objective-C 신원을 Swift 그래프에 연결하지 않는 회귀를 추가했다.
  F3는 주소 수준의 배선 관찰이며 알려진 메서드별 검증·독립 시나리오와 구분하도록 문서를
  명확히 했다. 이 범위에 검증된 blocker는 남지 않았다. 전체 PR 범위의 나머지 검토는 별도다.
- 최종 기능을 tarball로 만들어 네트워크 없이 격리 설치했다. 설치된 CLI의 runtime 결합·
  native 후보 신원 출력과 skill 구조 검증이 통과했다. npm 발행·원격 PR/CI는 하지 않았다.
- 새 verifier의 skill forward check도 통과했다. preflight CLI 1회로 strict 1과 runtime
  passed/정렬 일치를 구분하고, Basic 공백과 현재 없는 source project를 확인해 잘못된 로컬
  링크를 만들지 않았다. 전체 조사에는 읽기/진단 17개(8개 orchestration call), jq shape 실수
  2개가 있어 대형 JSON의 안정된 요약/개별 경로 조회는 여전히 효율 개선 근거가 된다.
  검증자 답변에서 4개 check를 4개 scenario로 부른 표현은 수정이 필요했다. 실제 scenario는
  success·chain 두 개이며 skill에 check 수와 scenario/platform 쌍의 수를 구분하도록 보강했다.

이전 단계: `preflight` CLI와 별도 producer 수집 workflow 연결.
현재 계약·실행 방법은 [PREFLIGHT.md](PREFLIGHT.md), 실용성 조사 당시 판단은
[오픈소스 가능성·실패 요인 10개·경쟁/대체 수단](FEASIBILITY.md)에 있다.

- `npm run verify` 통과: 제품 367개·Phase 0 15개·수집 workflow 6개,
  line/branch/functions 98.35/92.54/95.38, build/CLI/package 통과.
  로그 `/tmp/isthmus-preflight-capture-verify.log`.
- 실제 Dartograph와 Cartograph/Swift compiler index로 helper→handler→channel→Dart caller→
  service→screen 경로와 다섯 소스 파일을 확인했다. 첫 수집 23.811초, 동일 입력 캐시 3.735초,
  Swift 소스 변경 후 재수집 18.458초. 코드 변경 시 revision이 바뀌고 영향 경로는 유지됐다.
  근거 `/private/var/folders/lw/r6rd_zlj3ps7pb_h2sdtcr3w0000gn/T/isthmus-preflight-evidence-UjoiTx/verification.json`.
  합성 소스와 Flutter 타입 stub을 쓴 실제 producer 검증이며 native IPC 검증이 아니다.
- 수집기는 명시된 소스/설정·producer 구현·isthmus 코드·주요 toolchain 환경의 내용 해시를
  사용한다. 캐시 변조·수집 중 변경·소스/도구 변경·삭제·Git rename을 검증했고 raw producer
  근거를 sidecar/캐시에 보존한다. 범위는 `declared-inputs`이며 실제 앱의 입력 목록 완전성은 미검증이다.
- 실제 임시 Git 저장소에서 since 선택·rename 양쪽·미추적 소스를 검증했다. 설정/리소스
  변경은 별도 검토로 남긴다. iOS CI 설정은 문서 예시이며 실제 앱의 원격 CI 실행은 남아 있다.
- 로컬 tarball을 네트워크 없이 격리 설치해 bin의 preflight→Dart screen, 도움말,
  수집 모듈 import를 확인했다. skill 구조 검증도 통과했다. npm 발행은 하지 않았다.
- adapter가 실제 Dartograph의 정수 truncation·중첩 미귀속 목록·선언 위치와 query 전체 ID를
  처리하도록 고쳤다. Cartograph의 미관찰 선택과 runtime review를 공백으로 보존한다.

아래 이전 검증 수치와 negative outcome 정책은 해당 시점의 기록이다. 공개 앱의 더 넓은 적용
범위, Pigeon/Basic 정적 연결, 재현 가능한 실제 앱 CI 및 최종 PR 범위 검토는 여전히 남아 있다.

## 완료 기준

1. 특정 파일·심볼 변경 전에 직접·전이 영향을 찾고 원인이 되는 경로와 양쪽 소스 위치를
   제공한다. 브리지 밖 언어 내부 의존성도 producer 근거로 연결한다. 삭제·미관찰 파일,
   모호한 심볼, 동적 의존성을 깨끗한 결과로 처리하지 않는다.
2. 배포되는 질의 skill 또는 MCP로 필요한 영향 범위를 적은 호출과 출력으로 가져온다.
   실제 설치본에서 발견·호출·결과 해석을 검증한다. 출력 절약 때문에 근거·한계를 잃지 않는다.
3. 런타임에서 드러나는 브리지 의존성을 실제 실행에서 수집하고 정적 관찰과 대조한다.
   실행 환경·시나리오·revision·호출 실패를 구분하고, 실행하지 않은 경로를 통과로 처리하지
   않는다. MethodChannel 및 Pigeon/BasicMessageChannel 공개 사례를 검증한다.
4. CI에서 관찰을 자동 갱신하는 재현 가능한 workflow와 성능 근거를 제공한다. 전체 실행과
   반복/증분 실행을 측정하고, 코드·설정·producer 변경과 삭제 시 오래된 근거 재사용을 막는다.

## 구현 순서

- [x] 파일·심볼·변경 목록에서 브리지 영향과 관련 진단을 찾는 `impact` 명령.
- [x] 언어 내부 의존성 producer 연결과 전이 영향 경로(합성 소스·실제 producer). 공개 앱 적용 범위 검증은 남음.
- [x] 영향 질의용 배포 skill·compact/변경 목록 인터페이스·실제 CLI forward test.
- [x] 런타임 관찰 계약·Flutter 수집기·정적 후보 연결·시나리오 누락과 실패 검증(macOS).
- [ ] Pigeon/BasicMessageChannel 및 공개 프로젝트에서 적용 범위 실측.
- [ ] CI 갱신·성능/캐시 무효화 검증과 처음 설치하는 사용자를 위한 재현 절차.
- [ ] 전체 제품 verify, 경계 통합, 실제 사례, 설치본, PR GLM 리뷰.

## 현재 근거

- 시작 HEAD `fe786f9`, 깨끗한 main에서 `feat/change-preflight` 분기.
- 기존 `npm run verify`: 제품 287개, Phase 0 15개, CLI/package/build 통과(직전 조사).
- 공개 battery 플러그인은 근거 전달을 입증하지만 public 핸들러의 오탐 감소를 입증하지 않는다.
- 공식 url_launcher_ios는 Pigeon의 BasicMessageChannel과 접미사를 사용한다. 기존 MethodChannel
  조인만으로 지원됐다고 주장할 수 없다.
- 비교 대상: [Pigeon](https://pub.dev/packages/pigeon),
  [GlassWing](https://github.com/glasswing-ase25/GlassWing),
  [CodeGraph의 RN/Expo 경계](https://github.com/colbymchenry/codegraph#mixed-ios--react-native--expo-bridging).
  경쟁 제품의 README 기능과 실제 실행 정확도를 구분한다.

## 진행 기록

- `impact` 구현: 파일·정확 심볼·변경 JSON, 관련 호출자/핸들러/배선·진단·검토 파일,
  미관찰/동적 선택 보존, 관련 공백도 실패시키는 strict, 정보 손실 없는 compact.
- 검증: `npm run verify` 제품 309개·Phase 0 15개·build/CLI/package 통과.
  coverage line/branch/functions 99.02/95.90/97.25. 로그 `/tmp/isthmus-impact-verify.log`.
- 배포 skill의 impact 절차·미발행 구분을 추가하고 realpath 발견/패키지 포함 검사를 통과.
  기본 python에는 PyYAML이 없었으나 `/usr/bin/python3`에 있어 quick_validate 통과.
- cartograph는 별도 세션이 `feature/change-impact-workflow`에서 전이 영향 분석을 수정 중.
  그 저장소는 변경하지 않는다. 새 `change-impact` v1의 `selected/changeScope/affected/via/depth`,
  `selectionIssues/limitations/truncated`를 확인했다. 아직 변하는 출력이므로 연동 전 재확인 필요.
- dartograph의 기존 `affected`는 import/export 라이브러리 수준이다. 심볼 전이 분석으로
  과장하지 않는다. bridge 호출 위치를 그래프 선언에 임의로 귀속시키지 않는다.
- `verify-runtime` 소비자 구현: 독립 `bridge-expectations`와 `bridge-runtime` 실행 기록 대조.
  scenario/platform/instance/revision 분리, 실패·timeout·missing-handler·pending·중단·유실·
  stale 입력 검증. MethodChannel과 BasicMessageChannel의 라우팅 형태를 구분한다.
  `scope: declared-scenarios`, `complete: false`를 보존한다. 이후 실제 Flutter 수집기도 구현했다.
- 런타임 포함 `npm run verify`: 제품 331개·Phase 0 15개·build/CLI/package 통과,
  line/branch/functions 99.06/96.39/97.23. 로그 `/tmp/isthmus-runtime-verify.log`.
- `node scripts/benchmark-preflight.mjs` 통과(빌드된 CLI, Node 22.20.0, darwin arm64).
  새로운 CLI 프로세스 5회, 시작/읽기/파싱/분석/JSON 직렬화 포함. 브리지 40,000 facts,
  채널 10,000·스코프 1,000: 중앙 382ms·최대 434ms, 출력 9,178,488 bytes.
  런타임 100,000 events·기대 1,000: 중앙 166ms·최대 167ms, 출력 1,769,531 bytes.
  소비자 시간 예산은 5초. producer·앱 빌드·CI 전체 갱신은 미측정이며 4번 완료가 아니다.
- 일반 PATH에는 Flutter가 없었지만 Spotlight로 iCloud SDK를 발견했다. Git 날짜 조회 및
  frontend의 framework.dart 읽기가 정지함을 프로세스/stack sample로 확인했다. 사용자 SDK를
  수정하지 않고 공식 Flutter 3.32.2, commit `8defaa71a77c16e8547abdbfad2053ce3a6e2d5b`를
  `/tmp/isthmus-flutter-sdk.iW1YxU`에 격리 설치해 해결했다. `--no-version-check`를 사용한다.
  임시 SDK가 사라지면 동일 tag/commit으로 재설치한다. 공개 의존성은 pub.dev에서 받았다.
- `packages/isthmus_runtime`: 명시 codec·동적 resolver, 원래 bytes/exception/null Future 전달,
  pending/timeout/drop/clock regression, payload 미저장. exact Basic 설정이 동적 Method resolver보다
  우선하도록 실제 실패 테스트 뒤 수정. Flutter analyze clean, 제품 테스트 14개 통과.
- Flutter fixture emitter가 만든 `/tmp/isthmus-runtime-recorder.json`을 최신 소비자 CLI가
  읽어 독립 기대 2개를 strict 통과했다. fake messenger 사례이며 native 사례와 구분한다.
- 실제 native 검증 `scripts/verify-flutter-runtime.mjs`: Flutter 3.32.2/Dart 3.8.1,
  macOS 12 배포 대상, Xcode 27, 자체 Swift 채널과 공개 `url_launcher_macos 3.2.2`의
  Pigeon 생성 API를 실제 실행. success 기대 3개 통과, error/missing-handler/timeout 각 1개,
  pending 1개를 구별해 strict 실패까지 확인. URL을 열지 않고 canLaunchUrl만 실행했다.
  최신 근거: `/var/folders/lw/r6rd_zlj3ps7pb_h2sdtcr3w0000gn/T/isthmus-native-evidence-js8D7R/verification.json`.
  전체 31.486초, 첫 앱 빌드 23.723초·변경 없는 재빌드 4.984초·실행 1.158초.
  직전 동일 코드 실행은 전체 28.169초/빌드 20.628초/재빌드 5.042초였다.
  iOS/Android native 앱 검증 및 실제 앱의 전체 탐지율 증거로 확대하지 않는다.
- 수집기 fake messenger 고정 payload 벤치마크: 20k calls×5 측정(1회 warmup 제외),
  baseline 중앙 35,261µs, 관찰 중앙 96,979µs, 추가 중앙 3.0859µs/call,
  compact 기록 2,629,257 bytes. 실제 디바이스 IPC 성능은 아니다.
- `impact --runtime --revision`: 동적 실제 주소에서 Swift 후보를 찾되 기존 정적 미해석을
  지우지 않는다. 다른 OS/Basic 정적 연결은 unsupported. 표시 caller가 20개로 잘려도 검토
  파일 전체는 유지한다. 현재 실제 producer+runtime+전이 영향 통합은 남아 있다.
- 최신 Node `npm run verify`: 제품 341개·Phase 0 15개, build/CLI/package 통과,
  line/branch/functions 99.01/96.41/97.08. `/tmp/isthmus-preflight-final-verify.log`.
- AI skill forward test에서 중복 query와 비로컬 snapshot의 잘못된 로컬 링크가 드러나,
  report.project·위치 기준·중복 조회 지침을 보강했다. 동일 저비용 agent는 잘못된 링크를
  반복했으나 fresh verifier는 `/fixture`가 실제 작업 트리가 아님을 정확히 보고하고 링크를
  만들지 않았다. 모델 전체의 성능 개선으로 일반화하지 않는다. skill 형식/발견 경로도 통과.
- 실제 앱 경로에 대한 비동기 질문은 답이 없어 공개 플러그인·재현 앱으로 진행했다.
  자매 저장소 변경은 없다.

## 바로 이어서 할 일

1. 공개 앱·플러그인의 실제 producer→preflight 적용 범위를 측정한다. 현재 검증 실행은
   `node scripts/verify-preflight-producers.mjs <cartograph-bin> <dartograph.dart> <flutter-bin>`.
   자매 저장소는 각각 `feature/change-impact-workflow`, `feat/impact-precheck`에서 다른
   작업이 진행 중이므로 변경을 보존한다. Cartograph의 impact는 files/symbols 혼용 금지·
   limit 최대 10,000이다. Dart caller는 batch query found+유일 신원+같은 파일로 연결한다.
   constructor/extension의 bridge symbol 부재는 아직 공백이다. producer 원문은 sidecar에 있다.
2. Pigeon/Basic의 정적 producer 지원과 공개 앱 적용 범위를 구현·검증한다. macOS의
   producer→runtime→preflight 통합은 위 기록대로 통과했다.
   runtime Basic 성공을 정적 Basic 지원으로 표기하지 않는다. iOS/Android 실검증은 아직 없다.
3. `allowedOutcomes`와 timeout 완료 상태는 실제 native 실행까지 통과했다. 이 검증을
   재사용하고 같은 코드를 반복 빌드하지 않는다. 다른 앱/플랫폼 또는 수집기 변경 때 확대한다.
4. 실제 앱에서 수집 설정의 입력 범위와 native prepare 명령·index 신선도를 검증한다.
   현재 내용 해시는 명시된 입력만 커버한다. producer를 소스로 실행하면 매번 약 4초가
   소요되므로 설치된 실행 파일 또는 별도 출력 위치의 컴파일본으로 전체/반복 시간을 비교한다.
   외부 SDK·설정·로컬 패키지까지 포함한 입력 목록, 공개 사례 CI 재현을 완성한다.
5. 공개 프로젝트·실제 CI·최종 PR 범위의 GLM 리뷰를 완료한 뒤 네 사용자 요구 전체를 다시
   감사한다. 새 runtime 결합의 설치본은 검증됐다. AI의 대형 결과 취득에는 출력량을 줄이는
   요약/개별 경로 조회를 고려하고 전체 근거와 생략 계수를 함께 보존한다.

아직 전체 목표 미완료. 전이 영향 연결·더 넓은 runtime/정적 coverage·CI 자동 갱신과
신선도 검증·최종 배포/리뷰가 남았다. 외부 사용자 도입성과 실제 앱의 탐지율도 미검증이다.
