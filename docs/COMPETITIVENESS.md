# 변경 사전 점검 목표와 검증 기록

2026-09-14 시작. 사용자 목표는 아래 네 가지이며, 일부 명령의 테스트 통과로 전체 목표를
완료 처리하지 않는다. MIT·로컬 실행·근거와 분석 한계 보존은 유지한다.

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
