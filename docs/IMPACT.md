# 변경 전 브리지 영향 점검

`impact`는 현재 개발 소스에 추가된 명령이다. npm 0.5.0 발행본에는 없으며, checkout에서
`npm ci && npm run build` 후 `node dist/cli/main.js impact ...`로 실행한다.

```bash
isthmus impact --file ios/Runner/CameraPlugin.swift dart.json swift.json
isthmus impact --symbol 'CameraPlugin.handle' dart.json swift.json --compact
isthmus impact --changes changes.json dart.json swift.json --strict
```

파일·심볼·변경 목록 중 한 가지 방식만 선택한다. 파일은 producer의 `location.path`와
같은 프로젝트 상대 경로다. 심볼은 `qualifiedName` 또는 USR과 정확히 일치하며,
같은 이름이 여러 위치에 있으면 모두 보고한다. 선택 값에 경로 정규화·접두 매칭·rename
추론을 적용하지 않는다. 심볼의 전역 유일성을 이름만으로 주장하지 않는다.

## 변경 목록 입력

```json
{
  "format": "isthmus-changes",
  "version": 1,
  "files": ["ios/Runner/CameraPlugin.swift", "lib/camera.dart"],
  "symbols": ["CameraPlugin.handle"]
}
```

두 목록은 합집합이며 하나는 생략 가능하다. 정규화 전 합계 1~10,000개를 허용한다.
파일은 bridge-facts의 상대 경로 조건, 심볼은 안전한 비어 있지 않은 문자열 조건을 따른다.
중복 제거 후 문자열 순으로 정렬한다. 알 수 없는 필드는 버린다. 입력 파일당 16 MiB,
변경 목록과 bridge-facts 전체 합계 64 MiB UTF-16 텍스트 길이 예산을 적용한다.

## 결과와 해석

`isthmus-impact` v1은 다음을 보존한다.

- `project`: 증거 상대 경로의 기준. CLI 실행 디렉터리와 동일하다고 추측하지 않는다.
  파일 존재를 확인하지 않은 snapshot 위치를 실제 로컬 파일 링크로 만들지 않는다.

- `selection` / `unmatchedSelectors`: 요청 목록과 관찰하지 못한 선택. 삭제된 코드는
  삭제 전 snapshot으로 조회한다. 새 snapshot에서 없다는 것은 영향이 없다는 증거가 아니다.
- `selectedFacts`: 실제 선택된 위치·플랫폼·target·종류·심볼·동적 여부. 동적/미귀속 사실도
  이 목록과 `summary.unresolvedSelectedFacts`에 남는다.
- `channels`: 관련 생성·등록 위치와 범위를 넓힌 `reason`.
- `methods`: 메서드별 Dart 호출과 Swift 핸들러. 생성·등록 변경은 그 채널의 모든 메서드로
  넓힌다(`channel-wiring`). 메서드 변경은 해당 논리 키만 선택한다(`method`).
- `reviewFiles`: 선택 지점, 관련 호출·핸들러·배선 파일의 중복 없는 목록.
- `issues`: 기존 check 정책으로 계산한 관련 진단. 다른 채널의 진단은 섞지 않는다.
- `limitations` / `relevantLimitations`: 전체 한계와 선택에 관련된 한계. 스코프 없는 한계는
  해당 target 전체에 적용한다. 미관찰·미해석 선택은 범위를 좁힐 수 없어 전체 한계를 보존한다.
- `inputs`: 생산 도구·버전·플랫폼·target·생성 시각. 파일 입력 순서와 무관하게 정렬한다.

`summary.observedFacts`는 전체 입력 fact 수, `selectedFacts`는 중복 제거한 선택 근거 수다.
`--compact`는 JSON 공백만 줄이며 근거·한계를 생략하지 않는다.

| 코드 | 의미 |
|---|---|
| 0 | 보고서 생성 성공. `unobserved`도 기본 모드에서는 보고한다. |
| 1 | `--strict`에서 관련 error·미검증 진단·관련 분석 한계·미해석 선택·미관찰 선택이 남음. |
| 2 | 읽기·JSON·교환 계약·입력 예산·조인 보류 등 실행 실패. 부분 보고서 없음. |
| 64 | 인수 또는 직접 입력한 파일/심볼 선택 오류. |

이 명령의 strict는 check strict보다 분석 공백에 엄격하다. 기존 check/diff 동작은 유지한다.

## 런타임 관찰 연결

```bash
isthmus impact --file lib/dynamic.dart dart.json swift.json \
  --runtime runtime.json --revision current-source-revision --compact
```

두 옵션은 함께 지정한다. runtime의 project는 정적 입력과 같아야 하고 revision은 호출자가
선언한 분석 revision과 같아야 한다. 정적 bridge-facts v1에는 revision 필드가 없으므로,
CI/호출자가 같은 소스에서 사실을 생산했다는 문맥을 제공해야 한다. 소비자가 이를 추측하지 않는다.

선택된 호출 파일·정확한 fact 위치 또는 선택된 정적 주소와 관련된 런타임 이벤트를 모은다.
동적 Dart 호출에서 관찰된 구체적인 MethodChannel 주소로 Swift 핸들러 후보를 찾으면
`reason: runtime-observation`으로 관련 메서드와 검토 파일을 넓힌다. 정적 invocation 사실을
합성하지 않고 `runtime` 필드에 별도 근거를 둔다. 정적 미해석 수와 기존 진단은 그대로 남는다.

런타임 run의 platform이 ios/macos이고 transport가 MethodChannel인 경우에만 현재 Swift
정적 핸들러 후보를 찾는다. native 심볼이나 엔진이 실제 실행됐다고 확정하지 않는다.
BasicMessageChannel과 다른 OS는 `unsupported`, 정적 후보가 없으면 `unobserved`다.
revision이 오래되면 이벤트를 연결하지 않고 `stale`로 보존한다.

주소·인스턴스별 호출을 묶고 호출 위치는 20개까지만 보여 주며 `callersOmitted`를 기록한다.
`reviewFiles`는 표시 생략과 무관하게 관찰한 전체 관련 파일을 유지한다. 런타임 실패·대기·
중단·유실·오래된 기록·관련 관찰 부재·정적 후보 공백도 strict 실패 조건이다.

## 현재 경계

`scope: "bridge"`, `complete: false`는 항상 명시한다. 현재 기능은 브리지에 직접 등장한
코드의 변경 범위를 찾는다. 언어 내부 helper→handler→Dart 화면으로 이어지는 전이 경로,
실제 엔진·등록 수명과 테스트 시나리오의 포괄성은 아직 검증하지 않는다. 런타임 관찰은
위 방식으로 후보를 넓히는 근거이며, 전체 의존성의 완전성이나 실제 핸들러 실행 증명은 아니다.
이들은 [전체 목표](COMPETITIVENESS.md)의 남은 구현이며 이 명령의 존재로 완료 처리하지 않는다.
