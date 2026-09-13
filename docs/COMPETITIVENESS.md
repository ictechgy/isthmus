# 변경 사전 점검 목표와 검증 기록

2026-09-14 시작. 사용자 목표는 아래 네 가지이며, 일부 명령의 테스트 통과로 전체 목표를
완료 처리하지 않는다. MIT·로컬 실행·근거와 분석 한계 보존은 유지한다.

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
- [ ] 언어 내부 의존성 producer 연결과 전이 영향 경로. 단순한 브리지 영향만으로 1번 완료 금지.
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

1. cartograph의 진행 중 impact 출력 상태를 재확인한 뒤 helper→Swift handler→Dart caller와
   Dart 내부 소비자까지 전이 연결한다. producer 고유 신원·경로·한계를 보존한다.
   `ImpactDocument`에는 아직 project/revision/fingerprint가 없다. `SymbolQuery.Subject`는
   usr와 선언 위치가 있다. Dart bridge symbol은 AST의 짧은 qualifiedName뿐이며 constructor/
   extension에서 누락된다(`lib/src/index/bridge_index.dart`의 `_enclosingSymbol`). query의 usr는
   graph node id다. query found + 유일 신원/소스 일치로 연결하고 가장 가까운 선언 추측은 금지.
2. Pigeon/Basic의 정적 producer 지원과 실제 앱 producer→runtime→impact 통합을 검증한다.
   runtime Basic 성공을 정적 Basic 지원으로 표기하지 않는다. iOS/Android 실검증은 아직 없다.
3. 정상적인 negative 시나리오의 의도된 오류도 검증할 수 있게 기대 outcome 정책을 검토한다.
   현재 verifier는 모든 error/missing-handler/timeout을 실패로 센다. 의도된 실패를 숨기는
   blanket ignore 대신 독립 기대에 명시하는 방향이 필요하다.
4. CI에서 양쪽 사실·실행 revision·변경 목록을 갱신하는 재현 workflow와 캐시 무효화/전체
   소요 시간을 검증한다. 필요하면 증분 또는 장기 질의 세션을 추가한다.
5. 공개 프로젝트·설치본·GLM PR 리뷰까지 통과한 뒤 네 사용자 요구 전체를 다시 감사한다.

아직 전체 목표 미완료. 전이 영향 연결·더 넓은 runtime/정적 coverage·CI 자동 갱신과
신선도 검증·최종 배포/리뷰가 남았다. 외부 사용자 도입성과 실제 앱의 탐지율도 미검증이다.
