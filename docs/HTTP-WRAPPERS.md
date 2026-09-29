# HTTP 래퍼 선언과 호출 조립 규칙 (`http-wrappers` v1)

_상태: 개발 중 계약(v1). isthmus는 이 파일을 읽지 않는다. 호출 측 생산자(cartograph·kartograph·
dartograph·TS 생산자 등)가 읽는 입력 스키마와, 그 생산자들이 함께 지켜야 하는 해석 규칙이다._

앱은 보통 HTTP 라이브러리를 직접 부르지 않고 자체 래퍼(엔드포인트 기술자, `send(path, method)`
같은 함수)를 거친다. 이 래퍼는 소스만 보고 "어느 인자가 경로이고 어느 인자가 동사인지"를
일반적으로 추측할 수 없다. 그래서 사용자가 래퍼를 선언하고, 생산자는 선언된 래퍼의 호출을
`route-call` 사실([GRAPH-EXCHANGE의 http 절](GRAPH-EXCHANGE.md#개발-중-http-경계-v1-확장))로 낸다.
해석 규칙은 [url-compose 벡터](../conformance/url-compose.json)로 고정한다. 규칙이 벡터와
다르면 벡터가 정본이다.

## 스키마

```jsonc
{
  "format": "http-wrappers",
  "version": 1,
  "wrappers": [
    {
      "language": "swift",                 // swift | kotlin | dart | js (호출 측 생산자 언어)
      "kind": "constructor",               // constructor | function
      "owner": "Network.Endpoint",         // 소유 타입(생성자·메서드) 또는 모듈 경로. 생산자 심볼 규칙
      "name": "init",                      // 생성자면 생성자 이름(swift init, kotlin <init>), 함수면 함수 이름
      "methodArg": { "label": "method" },  // 동사 인자: { index } · { label } · 둘 다
      "pathArg": { "label": "path" },      // 경로 인자: 같은 형식
      "defaultMethod": "POST",             // 선택: 동사 인자를 생략했을 때 선언의 기본값
      "methodEnum": { "get": "GET", "post": "POST" },  // 선택: enum case(또는 상수 이름) → 동사
      "pathAnchor": "root",                // 필수: 이 래퍼의 경로가 root인지 base 뒤인지
      "service": "example-api"             // 선택: 이 래퍼 호출의 service(귀속 게이트 입력)
    }
  ]
}
```

- `methodArg`와 `pathArg`는 `index`(0부터 시작하는 인자 위치)나 `label`(Swift 인자 레이블,
  Kotlin 매개변수 이름, JS 객체 속성 이름) 중 하나 이상을 적는다. 둘 다 적으면 아래 바인딩
  규칙을 따른다. 동사가 경로와 한 인자 객체에 들어 있으면(`request({ url, method })`) 두 인자
  모두 같은 `index`와 서로 다른 `label`을 쓴다.
- `methodArg`가 없으면 `defaultMethod`가 필수다(동사가 고정된 래퍼). 둘 다 없으면 선언 오류다.
- `methodEnum`의 값은 계약의 동사(`GET`·`HEAD`·`POST`·`PUT`·`PATCH`·`DELETE`·`OPTIONS`·`TRACE`)만 쓴다.
- `pathAnchor`는 래퍼가 경로를 붙이는 방식에서 정한다. 래퍼가 base URL 뒤에 슬래시 결합이나
  RFC 3986 상대 해석으로 붙이면 아래 [base 결합](#base-결합) 규칙이 우선이다. 이 필드는 base를
  모르는 래퍼 내부 결합을 사용자가 증명했을 때만 `root`다.
- `service`를 적으면 그 래퍼의 모든 `route-call`에 `service`를 싣는다. 여러 서비스를 부르는
  래퍼는 생략하고 호출 측 문서의 `service`나 매니페스트 귀속에 맡긴다.
- 모르는 필드는 선언 오류다. 선언을 조용히 무시하면 낡은 선언이 호출 0건을 내어 "호출
  없음"으로 읽힌다.

선언 파일은 저장소 밖에 둘 수 있다. 경로·비밀을 담지 않는 선언만 쓴다. 이 스키마는 isthmus
문서가 소유하며, 생산자는 같은 선언 파일을 서로 다른 언어의 래퍼에 함께 쓸 수 있다.

## 생산자 의무

- 선언과 일치하는 호출을 찾으면 `route-call`을 낸다. `symbol.usr`는 호출을 감싸는 선언의
  생산자 impact id다(GRAPH-EXCHANGE의 route 사실 필드).
- 선언의 `owner`·`name`이 실제 심볼과 맞지 않거나 선언된 래퍼의 호출이 0건이면
  `http-wrapper-unresolved:` limitation을 낸다. 낡은 선언이 조용히 0건을 내지 않게 하기 위해서다.
- 선언되지 않은 래퍼로 보이는 직접 HTTP 싱크(동사·경로 매개변수를 그대로 흘려보내는 함수)를
  찾았지만 해석하지 못하면 `http-wrapper-undeclared:`를 낸다. 싱크를 추측해 사실로 만들지 않는다.
- 이 limitation은 호출 측 공백이라 isthmus는 `route-decl-without-call`·
  `route-contract-without-call`을 `-unverified`로 내린다(error 판정에는 영향이 없다).
- 테스트 소스의 호출은 기본으로 내지 않는다(GRAPH-EXCHANGE 테스트 소스 정책).

## 공통 해석 규칙

모든 호출 측 생산자는 같은 규칙으로 경로와 동사를 확정한다. 언어마다 다르게 확정하면 같은
API를 부르는 iOS·Android 호출이 서로 다른 키로 조인된다. 각 규칙의 `ruleId`는 url-compose
벡터의 케이스와 같다.

### 경로 조립 (`compose.*`)

1. **query·fragment 꼬리** (`compose.query-tail`): 경로 리터럴의 첫 `?`(또는 `#`)부터 끝까지를
   뗀다. 그 뒤의 보간도 함께 버리고 `queryTailStripped: true`를 단다.
2. **suffix 조립** (`compose.suffix`): `/` 없이 경로 끝에 붙은 마지막 보간이 같은 함수의 지역
   변수이고, 그 초기식의 비어 있지 않은 값이 모두 `?` 리터럴로 시작하며(접두사가 `?`로 고정된
   쿼리 빌더 결과, `"?" + ...` 연결) 나머지 가지가 빈 문자열·`orEmpty()`이면 query 꼬리로 보고 뗀다
   (`queryTailStripped: true`). 증명하지 못하면 dynamic이다. 중간에 오는 query 꼬리도 dynamic이다.
3. **세그먼트 보간** (`compose.interpolation`): 보간(Swift `\(expr)`, Kotlin `${expr}`·`$ident`,
   Dart `${expr}`, JS 템플릿 `${expr}`)은 **세그먼트 전체를 채울 때만** `{}`가 된다. 즉 앞이 `/`로
   끝나고 뒤가 `/`로 시작하거나 경로 끝이어야 한다. 세그먼트 일부만 채우거나(`/files/${name}.json`)
   한 세그먼트에 둘 이상이면 호출은 dynamic이다. 서버 템플릿의 부분 세그먼트(`p{}s`)와 달리
   호출 쪽 부분 보간은 값 경계를 증명할 수 없기 때문이다.
4. **dynamic과 channelPrefix**: dynamic 호출은 `channel`에 원문 식(길이 상한 2,048)이나 `null`을
   싣고, 문제 되는 첫 보간 앞까지의 조립 결과가 `/`로 시작하면 그 정규 템플릿을 `channelPrefix`로
   싣는다(`/files/`, `/api/v1/articles`). `channelPrefix`는 query의 `prefix-candidate` 표시에만 쓰인다.
5. **같은 파일 상수**: 경로 인자나 보간이 같은 파일의 컴파일 타임 상수(Kotlin `const val`, Swift
   `static let` 리터럴, Dart `const`, JS `const` 리터럴)이면 값을 치환한다. 파일 밖 상수는 생산자가
   증명할 수 있을 때만 치환하고, 아니면 dynamic이다.
6. **정규화** (`compose.normalize`): 조립한 리터럴은 [정규 경로 템플릿](GRAPH-EXCHANGE.md#정규-경로-템플릿)
   표기로 쓴다. 비ASCII와 금지 문자는 UTF-8 대문자 퍼센트 인코딩, unreserved 인코딩은 디코드,
   리터럴 중괄호는 `%7B`·`%7D`다. 중복 슬래시·끝 슬래시·대소문자는 보존한다.

### base 결합

`compose.base-join`. base URL과 경로의 결합은 라이브러리 의미를 따른다.

| 결합 방식 | 예 | 경로 `/x` | 경로 `x` |
|---|---|---|---|
| RFC 3986 상대 해석 | Retrofit·Ktor·`URL(string:relativeTo:)` | root | base |
| 슬래시 결합 | axios·chopper·Moya·openapi-fetch | base | base |
| 단순 문자열 연결, base 리터럴 | dio, retrofit.dart 메서드 경로 | 연결 결과의 경로, root | 연결 결과의 경로, root |
| 단순 문자열 연결, base 미상 | dio, retrofit.dart 메서드 경로 | base | dynamic + `ambiguous-base-join:` |

**단순 문자열 연결**(dio `RequestOptions.uri`)은 경로가 `http:`·`https:`로 시작하지 않으면
`baseUrl + path`를 그대로 이어 붙이고, 결과에 `:/`가 정확히 하나면 그 뒤의 `//`를 `/`로 바꾼 다음
점 세그먼트를 지운다. 슬래시를 넣거나 빼지 않으므로 `https://api.example.com/v1` + `items`는
`/v1items`다. base 리터럴에 경로가 없는데 경로가 `/`로 시작하지 않으면 경로가 host에 붙으므로
(`https://h` + `users` → host `husers`) root 템플릿을 내지 않고 dynamic + `ambiguous-base-join:`이다.

**retrofit.dart는 두 단계다.** RFC 3986은 첫 단계에만 쓰인다.

1. 생성 코드의 `_combineBaseUrls(dio.options.baseUrl, @RestApi(baseUrl))`가 어노테이션 base를
   dio base에 RFC 3986으로 해석한다. 어노테이션 base가 절대 URL이면 그대로, 비었으면 dio base다.
2. 메서드 경로(`@Path` 치환 후)는 1단계 결과에 위 **단순 문자열 연결**로 붙는다(RFC 3986이
   아니다). 1단계 결과의 경로가 확정되면(절대 URL 리터럴, 또는 `/`로 시작하는 어노테이션 base)
   base 리터럴 행을, 확정되지 않으면(어노테이션 base 없음, 생성자가 `baseUrl`을 넘김, 미상 dio
   base에 대한 상대 어노테이션 base) base 미상 행을 따른다.

예: `@RestApi(baseUrl: 'https://api.example.com/rv1')` + `@GET('/users/{id}')`는 `/rv1/users/11`을
요청한다(템플릿 `/rv1/users/{}`, root — RFC 3986이었다면 `/users/{}`). 같은 base에서
`@POST('items')`는 `/rv1items`다. `@RestApi(baseUrl: '/rv2/')`는 dio base와 무관하게 경로가
`/rv2/`로 확정되어 `@GET('/orders/{id}')`가 `/rv2/orders/{}` root다. 이 규칙은 retrofit_generator
10.2.11 소스와 실제 dio 5.11.1 요청을 기록한 모의 서버 오라클(dartograph)로 확인했다.

base 없이 전체 URL 리터럴을 쓰면 host 뒤 경로를 root로 쓴다. host가 동적이면 base다.

### 제거와 마스킹

- `compose.strip`: 전체 URL에서 scheme·userinfo·query·fragment를 떼고, host는 소문자
  `authority`(`host[:port]`)로만 싣는다.
- `compose.mask`: 퍼센트 디코드한 리터럴 세그먼트가 **16자 이상이고 ASCII 글자와 숫자를 모두
  담으면** `{}`로 바꾼다. 알려진 웹훅 host는 경로 세그먼트를 모두(`hooks.slack.com`) 또는
  `/api/webhooks` 뒤를(`discord.com`·`discordapp.com`) `{}`로 바꾼다. 바꾼 세그먼트 수를
  `maskedSegments`에 싣는다. 마스킹은 `channel`뿐 아니라 `channelPrefix`·호출 측 limitation
  문구에도 똑같이 적용한다. 이 기준보다 더 가리는 것은 허용한다(마스킹된 호출은 isthmus에서
  error 근거가 되지 않으므로 거짓 error를 만들지 않는다).

### 동사와 인자 바인딩 (`wrapper.*`)

1. **인자 찾기** (`wrapper.method`): `label`이 있으면 같은 레이블(이름 붙은 인자)을 먼저 찾는다.
   없으면 `index` 위치의 인자를 쓰되, 그 인자가 다른 레이블을 달고 있으면 쓰지 않는다. Kotlin의
   이름 붙은 인자는 순서가 바뀌어도(`request(path = p, auth = a, method = "GET")`) 레이블로 묶인다.
2. **생략과 기본값**: 동사 인자를 찾지 못하면 `defaultMethod`를 쓴다. 없으면 `methodDynamic: true`다.
   인자가 있는데 값이 리터럴·enum이 아니면 기본값을 쓰지 않고 `methodDynamic: true`다.
3. **enum → 동사**: 인자가 enum case(Swift 암시적 멤버 `.get`, Kotlin `HttpMethod.GET`)면
   `methodEnum`으로 바꾼다. 매핑이 없으면 `methodDynamic: true`다. 문자열 리터럴은 계약 동사와
   정확히 같을 때만 동사다(`"get"`은 매핑 없이 동사가 아니다).
4. **보고 줄** (`wrapper.location`): 여러 줄에 걸친 호출은 **호출식이 시작하는 줄**을
   `location`으로 싣는다(경로 인자 줄이 아니다). 열은 그 줄의 UTF-8 바이트 기준이다.

## 적합성 벡터

- 파일: [`conformance/url-compose.json`](../conformance/url-compose.json)(이 문서의 규칙),
  [`conformance/http-template.json`](../conformance/http-template.json)(정규 문법·정규화·
  프레임워크 변환·소비자 매칭). 파일별 sha256은 [`conformance/SHA256SUMS`](../conformance/SHA256SUMS)에 있다.
- 형식과 provenance 등급은 [GRAPH-EXCHANGE의 공유 적합성 벡터](GRAPH-EXCHANGE.md#공유-적합성-벡터) 절을 따른다.
- 생산자는 두 파일을 벤더링하고 `conformance.lock`에 isthmus 커밋과 sha256을 적는다. 자기 언어
  러너로 `appliesTo`에 `producer`(또는 `producer:<이름>`)가 있는 케이스를 모두 통과해야 한다.
  isthmus의 `npm run verify`는 같은 벡터를 제품 매처와 참조 구현으로 실행한다.
