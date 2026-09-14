# 고정 소스에서 사전 점검 도구 구축

개발 소스의 절차이며 현재 공개된 isthmus 0.5.0에는 새 preflight 기능이 없다.
이 절차는 로컬 Git 저장소의 **지정한 commit만** 새 디렉터리에 풀어 세 도구를 구축한다.
원본의 미커밋 수정, dist, .build, .dart_tool을 복사하지 않는다. SDK와 전역 의존성 캐시는
공유할 수 있으므로 빈 머신 전체 설치 시간과 구분한다. 소스 다운로드·발행은 수행하지 않는다.

## 준비

- Node.js 22.18.0 이상, Dart 3.11 이상, Swift 6 toolchain. 검증 호스트는 macOS다.
- 로컬 Git checkout 세 개: isthmus, cartograph, dartograph.
- 선택한 Cartograph commit은 `impact`와 `bridges --messages`를 함께 제공해야 한다.
  Dartograph는 `bridges --messages`, isthmus는 `preflight --summary/--explain`이 필요하다.
- 앱의 Swift 인덱스와 실제 Flutter 검증에는 해당 앱의 Flutter/Xcode 환경이 추가로 필요하다.
  도구 자체를 구축하는 과정은 Flutter SDK를 필수로 요구하지 않는다.

아직 이 기능을 모두 포함한 공개 호환 버전은 확정·발행하지 않았다. 저장소 checkout의
`docs/COMPETITIVENESS.md`에서 검증 중인 개발 commit과 남은 작업을 확인할 수 있다.
기능 이름만 보고 기존 발행 버전을 사용하지 않는다. 소스 commit이 로컬 Git에 있어야 하며
빌드 과정의 npm/pub/SwiftPM 의존성 해석은 네트워크를 사용할 수 있다.

## 실행

`build.json`에 실제 로컬 경로와 `git rev-parse <ref>`로 확인한 전체 40자리 commit을 적는다.
아래 `<...>`는 대체해야 할 값이다. 상대 경로는 JSON 파일의 디렉터리를 기준으로 해석한다.
destination은 존재하지 않아야 하고 그 부모 디렉터리는 미리 준비한다.

```json
{
  "format": "isthmus-toolchain-build",
  "version": 1,
  "destination": "../built-isthmus-tools",
  "repositories": {
    "isthmus": {"path": "../isthmus", "revision": "<40-character-commit>"},
    "cartograph": {"path": "../cartograph", "revision": "<40-character-commit>"},
    "dartograph": {"path": "../dartograph", "revision": "<40-character-commit>"}
  }
}
```

```bash
node scripts/build-preflight-toolchain.mjs build.json
```

스크립트는 commit 확인 → source archive → Swift 빌드 → Dart AOT 빌드 → npm tarball 생성·
격리 설치 순서로 실행한다. 기존 destination을 덮어쓰지 않고, 실패 시 자신이 새로 만든
destination만 정리한다. 각 단계의 로그는 별도의 임시 근거 디렉터리에 남기며 경로를 알린다.
성공한 디렉터리는 옮기지 않고 그대로 사용한다.

`<destination>/toolchain.json`에는 source commit, SDK 버전, 실행 파일/패키지 hash, 단계별
시간과 아래 명령 배열이 있다.

- `commands.isthmus`: Node와 설치된 CLI의 경로.
- `commands.cartograph`: impact와 Basic을 함께 제공하는 실행 파일 경로.
- `commands.dartograph`: AOT 실행 파일 경로.

이 성공은 구축과 CLI 기능 확인이다. 앱 분석의 정확성·모든 런타임 의존성 검증을 뜻하지 않는다.

## 앱 수집 및 CI 연결

[PREFLIGHT.md](PREFLIGHT.md)의 capture 설정에서 위 두 producer 명령을 사용하고 Basic이
필요하면 `"messages": true`를 지정한다. 서로 다른 Cartograph 실행 파일을 나눠 쓸 필요가 없다.
실행 파일과 앱 소스·생성 설정·SDK 입력을 `toolInputs`/`inputs`에 선언한다.

```bash
node <isthmus-source>/scripts/capture-preflight.mjs capture.json
node <installed-isthmus-main.js> preflight context.json --summary --strict --compact
```

첫 명령은 기존 설정의 prepare 명령으로 앱 인덱스를 갱신하고 내용 해시가 같은 수집 결과만
재사용한다. 두 번째 명령의 exit 1은 검토할 결과이며 JSON을 버리지 않는다. 공개 Pigeon의
prefix와 실행하지 않은 시나리오 등은 의도적으로 공백으로 남을 수 있다.

CI에서는 도구 구축과 앱 수집을 구분한다. 도구는 검증한 commit의 빌드 산출물을 사용하고,
앱 입력이 바뀔 때 capture를 갱신한다. 저장소의 소비자 성능 검사는 5초 예산을 검사하지만
producer 및 앱 빌드 시간은 포함하지 않는다. 원격 CI 실행과 최초 외부 사용자의 구축은
로컬 source archive 검증과 별도로 확인해야 한다.

## 실제 Dart 바인딩 상태 대조

저장소 검증 스크립트는 Flutter의 실제 BasicMessageChannel API를 mock messenger와 함께
실행해 mutable 필드, 고정 필드, 순차 대입, then/else에서 관찰한 주소를 producer와 대조한다.

```bash
node scripts/verify-dart-binding-runtime.mjs <flutter> <dartograph-aot>
```

같은 mutable 필드 호출이 호출 이력에 따라 다른 주소를 쓰면 정적 단일 주소로 확정하지
않아야 한다. 반대로 고정 필드와 명확한 직선 흐름은 실제 주소를 유지해야 한다.
이 검증은 Dart/Flutter 바인딩 상태의 실행이며 native IPC나 앱 전체 동작 검증은 아니다.
