# 오픈소스 실용성·경쟁 대안 검증

2026-09-14 재확인. 목적은 누구나 로컬에서 구축해 사용할 수 있는 오픈소스의 실용성이다.
HANDOFF의 최신 절·개발 소스·실제 검증 산출물과 공개 1차 자료를 대조했다.
[최신 진행 기록](COMPETITIVENESS.md)의 목표는 진행 중이며 외부 사용자의 실용성 검증은 남아 있다.
상업적 규모를 성공 조건으로 삼지 않는다. 기존 네 가지 구현 목표는 유지한다.
경쟁 도구는 공식 문서·공개 저장소를 확인했으며 직접 설치해 정확도·성능을 비교하지 않았다.
공개 사용 후기는 해당 작성자의 경험이며 시장 전체의 사용 비율을 뜻하지 않는다.

**판단: 좁은 범위에서 유용한 도구가 될 기술적 근거는 있지만, 외부 사용자가 반복해서
쓸 만큼 편하고 정확하다는 증거는 아직 없다.** 검증할 가치는 변경된 Swift 코드에서
브리지를 거쳐 영향을 받는 Dart 코드를 설명하고, 실행 관찰과 미검증 범위를 함께 제공하는
데 있다. 모든 런타임 의존성을 보증한다는 목표는 현재 정적 관찰과 시나리오 기록만으로
충족할 수 없다.

현재 상태는 [COMPETITIVENESS.md](COMPETITIVENESS.md)와 개발 소스를 대조했다.

- `feat/change-preflight`, HEAD `137973c` 이후 미커밋 Basic/Pigeon·조회 개선을 포함해
  `npm run verify` 통과: 제품 396개, Phase 0 15개, 수집 workflow 7개, 타입·clean build·
  CLI/package 계약. line/branch/functions 98.23/92.49/94.75.
  임시 로그: `/tmp/isthmus-feasibility-current-verify.log`.
- 실제 producer 자동 수집·CLI·전이 영향 연결이 구현됐다. 공개 `url_launcher_macos 3.2.2`
  수집 산출물을 최신 CLI로 재생했다. Dart send 2개·Swift handler 2개, 경계 2개와 공개
  Dart 소비자 경로를 확인했다. summary는 errors 0·evidenceGaps 9·requiresReview true·
  strict exit 1을, explain은 경로와 검토 필요 상태를 유지한다.
- 공개 source 수집은 원본 Swift/Dart 코드와 실제 FlutterMacOS framework를 사용했다.
  검증용 SwiftPM manifest와 Dart dev dependency 제외를 적용했으며 runtime 실행은 아니다.
  기존 실제 macOS 하네스의 원본 기록도 확인했다: 성공 check 4개, 의도한 실패 check 3개,
  pending 미완료 구분과 capture revision 정렬. 이번에 앱을 재빌드하지 않았으며 iOS/Android
  또는 전체 앱 탐지율의 증거로 해석하지 않는다.
- 이전 대형 합성 입력의 전체 보고서는 9,540,579 bytes, summary 6,983 bytes,
  explanation 4,457 bytes였다. 소비자 중앙값은 각각 338ms·513ms·273ms였다.
  출력 감소는 확인했지만 summary가 더 빠르다는 결과는 아니며 AI 정확도·토큰 절약도 미측정이다.
  `/tmp/isthmus-view-benchmark.log`. producer·native 빌드는 이 시간 밖이다.
- 기존 공개 Pigeon 수집은 37.371초, 별도 실제 macOS 하네스는 58.539초였다. 프로젝트와
  단계가 다르므로 합산하거나 일반 앱 CI 시간으로 해석하지 않는다.
- Basic producer 확장은 자매 저장소의 격리 개발 worktree에 있고 새 preflight 기능은
  미발행이다. 일반 사용자가 공개 설치 명령만으로 이 상태를 재현할 수 있다고 안내하지 않는다.

정밀도를 추가 검증해야 할 구체적인 출력도 확인했다. 공개 Pigeon의 두 handler 신원이 공통
`UrlLauncherApiSetup.setUp`이다. 구현 파일 전체 선택 후 `UrlLauncherMacOS.canLaunch`의
설명 경로는 `Swift launch → setUp → canLaunchUrl 채널 후보 → Dart canLaunchUrl → canLaunch`로
나온다. 실제 생성 코드에서는 별도 closure가 각각 `api.launch`와 `api.canLaunch`를 호출한다.
**등록 함수 수준의 보수적인 전파가 메서드별 영향보다 넓어질 수 있다는 근거**다.
이 위험은 공개 정밀도 코퍼스([experiments/real-corpus](../experiments/real-corpus/))로 측정했다.
EventChannel 스트림 핸들러 파일 선택에서 등록 경계가 채널 전체로 확대된 FP 3건을 case 절
근거로 좁힌 뒤, LocalSend를 포함한 최신 15건 실행은 **TP 83 / FN 0 / FP 0**이다.

후속 구현에서는 이 문제를 실제 단일 USR 선택으로 재현한 뒤 handler별 compiler 참조와
dispatch 후보를 연결해 수정했다. 공개 launch/canLaunch 각각의 독립 변경과 공통 setup
변경을 대조해 필요한 영향은 유지하고 다른 메서드로의 전파를 제외했다. Method/Basic이
같은 함수에 등록되는 경우도 보강했다. path_provider와 shared_preferences의 공개 source
경로와 공개 Pigeon의 실제 macOS 정적/runtime 결합도 추가 검증했다. 최신 제품 검사 405개와
세부 근거는 [진행 기록](COMPETITIVENESS.md)에 있다. 일반 앱 전체 정밀도·외부 사용자 효용은 별도다.

기존 임시 근거(정리되면 없어질 수 있음): 공개 source는
`/private/var/folders/lw/r6rd_zlj3ps7pb_h2sdtcr3w0000gn/T/isthmus-pigeon-evidence-cgWzKF/`,
실제 native는 `/var/folders/lw/r6rd_zlj3ps7pb_h2sdtcr3w0000gn/T/isthmus-native-evidence-jn0EwY/`.
재현 진입점은 [공개 Pigeon 검증](../scripts/verify-public-pigeon.mjs),
[실제 macOS 검증](../scripts/verify-flutter-runtime.mjs), [벤치마크](../scripts/benchmark-preflight.mjs)다.

**실패한다면 가능한 이유 10가지.** 구현 공백과 검증할 가설을 구분했다.

1. **반복해서 쓸 필요가 있는지 미검증이다.** 직접 native 코드를 관리하는 Flutter 팀의
   필요를 가정하고 있다. 작은 사용자층도 충분하지만 실제 장애·재사용 근거는 확보해야 한다.
2. **Pigeon이 가치의 일부를 이미 제공한다.** 공식 코드 생성은 문자열·메시지 타입을
   양쪽에서 수동으로 맞추는 부담을 줄인다. 오타 탐지만으로 도입 이유가 충분하지 않을 수 있다.
   [공식 설명](https://docs.flutter.dev/platform-integration/platform-channels).
3. **지원 범위가 사용자의 앱과 맞지 않을 수 있다.** Basic·Event는 정적 후보 연결이
   구현돼 `check`가 v2 문서를 직접 진단하지만, Android/Kotlin의 모든 실행 형태와
   모든 Pigeon 생성 형태의 지원 근거는 여전히 없다. 지원하는 채널만 분모로 삼으면
   실제 유용성을 과대평가한다.
4. **영향 후보가 너무 넓을 수 있다.** 위 공개 Pigeon의 공통 setUp 신원처럼 서로 다른
   handler가 합쳐지면 관련 없는 소비자까지 검토하게 할 수 있다. 경로 존재와 변경 영향의
   확정은 다르며 메서드별 정밀도 검증이 필요하다.
5. **실행 기록으로 정적 불확실성을 모두 해소할 수 없다.** 동적 주소·suffix·engine instance·
   조건부 등록이 있고 실행하지 않은 경로는 남는다. 통신 성공만으로 업무 결과나 native
   심볼 실행을 증명하지 못한다. 모든 의존성을 보증하는 용도로 쓰면 실패한다.
6. **첫 설치와 설정이 절약할 시간보다 비쌀 수 있다.** Node CLI 외에 producer 두 개,
   Dart/Flutter, Swift compiler index와 Apple 경로의 Xcode 환경이 필요하다.
   외부인이 문서만 보고 첫 유용한 보고서를 만드는 시간은 미측정이다.
7. **누락된 입력이 캐시 신선도를 무너뜨릴 수 있다.** 내용 해시·변조 방어·수집 중 변경·
   rename 검증은 구현됐다. 그러나 범위는 declared-inputs이며 빠뜨린 생성 설정·SDK 의존성·
   빌드 조건까지 자동으로 포괄하지 않는다. 항상 최신이라는 보장은 없다.
8. **CI 전체 비용 대비 이득이 미검증이다.** JSON 분석 시간과 producer·인덱스·앱 빌드
   시간을 구분해야 한다. 캐시 재사용과 변경 후 재수집은 세밀한 증분 분석 전체의 증명이
   아니다. 실제 앱에서 추가 실행 비용과 줄어드는 검토 시간을 비교해야 한다.
9. **MCP·로컬 그래프·자동 갱신 자체는 이미 경쟁이 있다.** CodeGraph와 Patrol MCP가
   관련 기능을 제공한다. 근거 정확도·추가 누락 발견·검토 시간에서 이득을 증명해야 한다.
10. **유지관리 부담과 배포 단절이 채택을 막을 수 있다.** SDK·producer 두 개·소비자·수집기·
    생성 코드의 호환성이 함께 필요하다. 실행법이 개발 worktree와 오래된 문서에 흩어지면
    MIT 코드가 있어도 타인이 구축하기 어렵다. 외부인의 구축·기여 성공은 미검증이다.

**이미 문제의 일부를 해결하는 회사와 프로젝트**가 있다. 아래 기능 전체를 같은 범위로
제공하는 상용 제품은 이번 조사에서 확인하지 못했다. 경쟁자가 없다는 증거는 아니다.

| 주체·도구 | 공식 자료에서 확인한 기능 | isthmus와의 관계 |
|---|---|---|
| Google / Flutter Pigeon | 타입이 있는 Dart·native 통신 코드 생성. [패키지](https://pub.dev/packages/pigeon) | 문자열·타입 불일치 예방의 대안. 전이 영향 보고와는 목적이 다르다. |
| LeanCode / Patrol·Patrol MCP | native 상호작용을 포함한 E2E 테스트, AI 실행·세션 재사용. [MCP 저장소](https://github.com/leancodepl/patrol/blob/master/packages/patrol_mcp/README.md) | runtime 검증과 AI 연결의 대안이자 통합 대상. |
| mobile.dev / Maestro | Flutter Semantics를 이용하는 외부 UI 자동화, compiled 앱·권한 흐름 검증. [공식 Flutter 지원](https://docs.maestro.dev/get-started/supported-platform/flutter) | 화면·사용자 흐름 성공 검증의 대안. Swift 호출 경로 근거와 범위가 다르다. |
| Sourcegraph | 코드 검색·탐색·MCP. [MCP 문서](https://sourcegraph.com/docs/api/mcp) | 코드 이해·AI 질의의 대안. Dart↔Swift 채널 연결은 확인하지 못했다. |
| CodeScene | Git 이력에서 함께 변경되는 파일·함수의 change coupling. [공식 설명](https://codescene.com/blog/change-coupling-visualize-the-cost-of-change) | 숨은 관계·변경 영향 추정. 변경 이력은 실제 채널 호출의 증명과 다르다. |
| CodeGraph, MIT 오픈소스 | 영향 분석·MCP·파일 변경 자동 갱신, RN/Expo 및 Swift/ObjC 경계 연결. [저장소](https://github.com/colbymchenry/codegraph) | 목표 1·2·4와 크게 겹친다. Dart 지원을 Flutter 채널 지원으로 확대 해석하지 않는다. |
| GlassWing, Apache-2.0 연구 프로젝트 | Flutter Android의 Dart AOT와 Java/Kotlin 호출 관계 연결. [저장소](https://github.com/glasswing-ase25/GlassWing) | 언어 경계 분석의 선행 사례. Swift 개발 소스 변경 점검과 대상이 다르다. |
| dart_source_graph, BSD-3-Clause | Dart 의미 분석 그래프와 전이 영향 질의. [패키지](https://pub.dev/packages/dart_source_graph) | Dart 내부 영향 분석의 대안. native 채널 연결은 확인하지 못했다. |

Sourcegraph의 현재 [precise navigation 목록](https://sourcegraph.com/docs/code-navigation/precise-code-navigation)에
Dart·Swift가 없다는 사실은 검색 자체의 불가능을 뜻하지 않는다. CodeGraph의 성능·정확도
수치는 제작자 측정이며 이번 조사에서 독립적으로 검증하지 않았다.
CodeGraph는 일부 경계의 heuristic provenance도 명시한다. 근거 유형이나 미해석 표시만으로
독점적 차별점이라고 주장하지 않는다. 관계·차별점 열은 공식 기능 범위에서 한 판단이다.

**사람들이 사용하는 대체 수단**은 여러 절차의 조합이다. 공개적으로 확인한 범위는 다음과 같다.

- 예방: Pigeon 코드 생성. [Flutter 공식 안내](https://docs.flutter.dev/platform-integration/platform-channels).
- 통신 검증: integration_test와 native/Dart 단위 테스트. native UI에는 Patrol을 고려하도록
  공식 문서가 안내한다. [플러그인 테스트](https://docs.flutter.dev/testing/testing-plugins).
- 실제 도입 근거: STRV의 공개 Flutter 템플릿에는 Patrol 설치와
  `patrol test --flavor develop` 절차가 있다. [테스트 절](https://github.com/strvcom/flutter-template#testing).
- 수동 검증 병행: 2025-09-23 Flutter Forum 작성자는 integration tests와 native 수동 테스트·
  mock을 조합한다고 보고했다. 같은 토론에는 Patrol의 로컬/CI 문제와 Maestro 사용 경험도 있다.
  개별 경험이며 현재 모든 팀의 상태로 일반화하지 않는다.
  [사용자 직접 경험](https://forum.itsallwidgets.com/t/e2e-testing-tools-patrol-vs-maestro-vs-appium-what-do-you-use/4034).
- 미사용 분석 오탐: Periphery는 ignore·파일 유지·public/ObjC 접근 선언 유지 옵션을 제공한다.
  필요한 코드를 보수적으로 유지하는 대안이다. [문서](https://github.com/peripheryapp/periphery#objective-c).
  선언마다 ignore를 넣는 방식의 유지 부담도 공개 이슈에 보고됐다. Flutter에 한정한 도입
  증거는 아니다. [사용자 요청 #1012](https://github.com/peripheryapp/periphery/issues/1012).
- 변경 영향 탐색: IDE 참조 검색과 코드 검색·그래프 질의가 가능한 대안이다. Flutter 팀에서
  각 방법이 사용되는 비율이나 isthmus 대비 시간은 이 조사에서 측정하지 않았다.

Pigeon 채널 연결 오류의 공개 보고도 존재한다([wakelock_plus #105](https://github.com/fluttercommunity/wakelock_plus/issues/105)).
통신 문제가 존재한다는 증거지만 원인을 재현하지 않았으므로 isthmus가 이 오류를 예방하거나
진단할 수 있다고 주장하지 않는다. 위 대체 수단의 존재 역시 isthmus에 대한 미충족 수요를
자동으로 입증하지 않는다.

**다음 판정 실험 제안.** 아래는 아직 달성한 결과나 확정된 지원 범위가 아니다.

1. 공개 앱·플러그인 3개에서 과거 변경 또는 재현 가능한 결함 10개를 고른다. 수동 정답을 기준으로
   지원 범위·찾은 영향·놓친 영향·오탐을 각각 센다. 지원 밖 채널도 분모에서 숨기지 않는다.
   공통 setUp의 독립 메서드 변경을 넣어 위 정밀도 위험도 검증한다.
2. 동일 변경에서 기존 검색·검토 및 Pigeon+통합 테스트와 비교해 추가 발견과 검토 시간을
   기록한다. 테스트 개수·별점·그래프 크기를 사용자 가치로 대신하지 않는다.
3. SDK가 준비된 새 환경에서 작성자 도움 없이 설치·첫 보고서·CI를 재현한다. 이후 동의한
   외부 사용자에게 같은 절차를 검증받는다. 이번 조사에서는 누구에게도 연락하지 않았다.
   첫 유용한 보고서까지 15분 이내를 잠정 목표로 하고 SDK 다운로드 시간은 별도 기록한다.
   producer·CLI 호환 공개 버전, 고정 예제·수집 설정·예상 출력·CI 예시를 함께 제공해야 한다.
   기본 검증에 외부 AI 계정이 필요하지 않아야 하며 macOS/Xcode 요건을 명시한다.
4. native 빌드·producer 추출·조인·runtime 시간을 분리 측정하고 코드·설정·도구 버전·삭제의
   캐시 무효화를 확인한다. 정확도가 같을 때 반복 실행의 추가 비용을 비교한다.
5. 기존 테스트에서 실행 기록을 가져오는 흐름을 완성한다. 로컬 실행·공개 형식·선택적 AI
   연결·재현 예제와 호환 버전을 제공한다.

공개 사례에서 추가 누락 발견이나 검토 시간 절감이 없거나 설치·유지 비용이 이득을 상쇄하면,
독립 도구의 범위를 줄여 기존 producer·코드 그래프·테스트 도구의 연동 기능으로 제공하는
방향을 검토할 근거가 된다. 전체 구현 목표는 아직 완료되지 않았다.
