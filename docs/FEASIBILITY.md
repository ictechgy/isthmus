# 오픈소스 실용성·경쟁 대안 검증

2026-09-14 확인. 목적은 누구나 로컬에서 구축해 사용할 수 있는 오픈소스의 실용성이다.
아래 구현 상태는 조사 당시 기록이다. 이후 전이 CLI·자동 수집·실제 producer 연결 구현은
[최신 진행 기록](COMPETITIVENESS.md)에 반영했다. 외부 사용자의 실용성 검증은 아직 남아 있다.
상업적 규모를 성공 조건으로 삼지 않는다. 기존 네 가지 구현 목표는 유지한다.
경쟁 도구는 공식 문서·공개 저장소를 확인했으며 직접 설치해 정확도·성능을 비교하지 않았다.
공개 사용 후기는 해당 작성자의 경험이며 시장 전체의 사용 비율을 뜻하지 않는다.

**판단: 좁은 범위에서 유용한 도구가 될 기술적 근거는 있지만, 외부 사용자가 반복해서
쓸 만큼 편하고 정확하다는 증거는 아직 없다.** 검증할 가치는 변경된 Swift 코드에서
브리지를 거쳐 영향을 받는 Dart 코드를 설명하고, 실행 관찰과 미검증 범위를 함께 제공하는
데 있다. 모든 런타임 의존성을 보증한다는 목표는 현재 정적 관찰과 시나리오 기록만으로
충족할 수 없다.

현재 상태는 [COMPETITIVENESS.md](COMPETITIVENESS.md)와 개발 소스를 대조했다.

- 이번 확인에서 전이 분석·producer adapter·runtime 집중 테스트 37개 통과.
  `src/report/preflight.test.ts`의 Map 타입 추론 오류 1건을 재현한 뒤 타입을 명시해 수정했다.
- 수정 후 `npm run verify` 통과: 제품 361개, Phase 0 15개, 타입·clean build·CLI/package
  계약 통과. line/branch/functions 98.28/92.42/94.68.
  임시 실행 로그: `/tmp/isthmus-feasibility-verify.log`.
- 전이 분석은 정규화된 입력과 합성 fixture에서 검증됐다. 실제 producer 자동 수집과 CLI
  연결은 남았다. 단위 테스트 통과를 실제 앱의 전이 영향 탐지율로 해석하지 않는다.
- 기존 실제 macOS 하네스는 Swift 채널과 공개 url_launcher_macos의 Pigeon 호출을 검증했다.
  iOS/Android나 앱 전체 정확도의 증거가 아니며 이번에는 다시 실행하지 않았다.
- 기존 40k facts 최대 434ms는 producer·앱 빌드를 제외한 소비자 시간이다. 소형 macOS
  하네스의 첫 빌드 23.723초·재빌드 4.984초도 전체 앱 CI 예산을 증명하지 않는다.
- 새 기능은 개발 브랜치에 있다. 발행된 설치본에서 사용할 수 있다고 안내하지 않는다.

**실패한다면 가능한 이유 10가지.** 구현 공백과 검증할 가설을 구분했다.

1. **반복해서 쓸 필요가 있는지 미검증이다.** 직접 native 코드를 관리하는 Flutter 팀의
   필요를 가정하고 있다. 작은 사용자층도 충분하지만 실제 장애·재사용 근거는 확보해야 한다.
2. **Pigeon이 가치의 일부를 이미 제공한다.** 공식 코드 생성은 문자열·메시지 타입을
   양쪽에서 수동으로 맞추는 부담을 줄인다. 오타 탐지만으로 도입 이유가 충분하지 않을 수 있다.
   [공식 설명](https://docs.flutter.dev/platform-integration/platform-channels).
3. **주요 채널 형태를 놓칠 수 있다.** Pigeon/Basic runtime 관찰은 정적 연결 지원과 다르다.
   Basic 정적 연결, Android/Kotlin, EventChannel 공백이 실제 적용 범위를 제한한다.
4. **전이 영향이 실제 앱에서 끝까지 연결되지 않았다.** helper→handler→Dart caller→화면의
   합성 테스트는 있지만 실제 producer 종단 검증이 남았다. 채널 목록만으로 충분한지는 별개다.
5. **문자열 일치로 실행 대상을 확정할 수 없다.** 동적 이름·엔진 인스턴스·target·등록 조건의
   차이가 있다. 모호성과 미관찰을 보존해도 공백이 너무 많으면 유용한 결론이 적을 수 있다.
6. **runtime은 실행한 경로만 본다.** 권한·기기·환경별 다른 경로와 업무상 결과를 통신 성공
   하나로 검증할 수 없다. 수집기 설정·독립 기대 작성 비용도 있다.
   [Flutter의 채널별 통합 테스트 권고](https://docs.flutter.dev/testing/testing-plugins).
7. **오래된 입력이 최신 근거로 오인될 수 있다.** revision 필드만으로 미커밋 코드·생성 설정·
   producer 버전·삭제 파일의 일치를 증명할 수 없다. CI 생성·캐시 무효화 종단 검증이 남았다.
8. **전체 실행·설치 비용이 이득보다 클 수 있다.** JSON 조인 외에 두 producer, compiler
   index, native 빌드 환경, runtime 수집을 준비해야 한다. 외부인의 첫 실행 시간은 미측정이다.
9. **MCP·로컬 그래프·자동 갱신 자체는 이미 경쟁이 있다.** CodeGraph와 Patrol MCP가
   관련 기능을 제공한다. 근거 정확도·추가 누락 발견·검토 시간에서 이득을 증명해야 한다.
10. **오픈소스 유지 비용을 감당하지 못할 수 있다.** SDK·producer·생성 코드·출력 계약이
    함께 변한다. 공개 재현 사례와 호환성 검사가 부족하면 작성자 환경에서만 잘 될 수 있다.
    MIT 라이선스는 확인됐지만 외부인의 구축·기여 성공은 미검증이다.

**이미 문제의 일부를 해결하는 회사와 프로젝트**가 있다. 아래 기능 전체를 같은 범위로
제공하는 상용 제품은 이번 조사에서 확인하지 못했다. 경쟁자가 없다는 증거는 아니다.

| 주체·도구 | 공식 자료에서 확인한 기능 | isthmus와의 관계 |
|---|---|---|
| Google / Flutter Pigeon | 타입이 있는 Dart·native 통신 코드 생성. [패키지](https://pub.dev/packages/pigeon) | 문자열·타입 불일치 예방의 대안. 전이 영향 보고와는 목적이 다르다. |
| LeanCode / Patrol·Patrol MCP | native 상호작용을 포함한 E2E 테스트, AI 실행·세션 재사용. [MCP 저장소](https://github.com/leancodepl/patrol/blob/master/packages/patrol_mcp/README.md) | runtime 검증과 AI 연결의 대안이자 통합 대상. |
| Sourcegraph | 코드 검색·탐색·MCP. [MCP 문서](https://sourcegraph.com/docs/api/mcp) | 코드 이해·AI 질의의 대안. Dart↔Swift 채널 연결은 확인하지 못했다. |
| CodeScene | 함께 변경되는 파일의 change coupling. [공식 설명](https://codescene.com/blog/validation-for-behavioral-code-analysis/) | 숨은 관계·변경 영향 추정. 변경 이력은 실제 채널 호출의 증명과 다르다. |
| CodeGraph, MIT 오픈소스 | 영향 분석·MCP·파일 변경 자동 갱신, RN/Expo 및 Swift/ObjC 경계 연결. [저장소](https://github.com/colbymchenry/codegraph) | 목표 1·2·4와 크게 겹친다. Dart 지원을 Flutter 채널 지원으로 확대 해석하지 않는다. |
| GlassWing, Apache-2.0 연구 프로젝트 | Flutter Android의 Dart AOT와 Java/Kotlin 호출 관계 연결. [저장소](https://github.com/glasswing-ase25/GlassWing) | 언어 경계 분석의 선행 사례. Swift 개발 소스 변경 점검과 대상이 다르다. |
| dart_source_graph, BSD-3-Clause | Dart 의미 분석 그래프와 전이 영향 질의. [패키지](https://pub.dev/packages/dart_source_graph) | Dart 내부 영향 분석의 대안. native 채널 연결은 확인하지 못했다. |

Sourcegraph의 현재 [precise navigation 목록](https://sourcegraph.com/docs/code-navigation/precise-code-navigation)에
Dart·Swift가 없다는 사실은 검색 자체의 불가능을 뜻하지 않는다. CodeGraph의 성능·정확도
수치는 제작자 측정이며 이번 조사에서 독립적으로 검증하지 않았다.

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
- 변경 영향 탐색: IDE 참조 검색과 코드 검색·그래프 질의가 가능한 대안이다. Flutter 팀에서
  각 방법이 사용되는 비율이나 isthmus 대비 시간은 이 조사에서 측정하지 않았다.

**다음 판정 실험 제안.** 아래는 아직 달성한 결과나 확정된 지원 범위가 아니다.

1. 공개 앱·플러그인 3개에서 과거 변경 또는 재현 가능한 결함을 고른다. 수동 정답을 기준으로
   지원 범위·찾은 영향·놓친 영향·오탐을 각각 센다. 지원 밖 채널도 분모에서 숨기지 않는다.
2. 동일 변경에서 기존 검색·검토 및 Pigeon+통합 테스트와 비교해 추가 발견과 검토 시간을
   기록한다. 테스트 개수·별점·그래프 크기를 사용자 가치로 대신하지 않는다.
3. SDK가 준비된 새 환경에서 작성자 도움 없이 설치·첫 보고서·CI를 재현한다. 이후 동의한
   외부 사용자에게 같은 절차를 검증받는다. 이번 조사에서는 누구에게도 연락하지 않았다.
4. native 빌드·producer 추출·조인·runtime 시간을 분리 측정하고 코드·설정·도구 버전·삭제의
   캐시 무효화를 확인한다. 정확도가 같을 때 반복 실행의 추가 비용을 비교한다.
5. 기존 테스트에서 실행 기록을 가져오는 흐름을 완성한다. 로컬 실행·공개 형식·선택적 AI
   연결·재현 예제와 호환 버전을 제공한다.

공개 사례에서 추가 누락 발견이나 검토 시간 절감이 없거나 설치·유지 비용이 이득을 상쇄하면,
독립 도구의 범위를 줄여 기존 producer·코드 그래프·테스트 도구의 연동 기능으로 제공하는
방향을 검토할 근거가 된다. 전체 구현 목표는 아직 완료되지 않았다.
