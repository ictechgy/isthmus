# HTTP 래퍼 선언과 호출 조립 규칙 (`http-wrappers` v1·v2)

_상태: 개발 중 계약(v1). isthmus는 이 파일을 읽지 않는다. 호출 측 생산자(cartograph·kartograph·
dartograph·TS 생산자·gartograph·rustograph·pythograph 등)가 읽는 입력 스키마와, 그 생산자들이 함께 지켜야 하는
해석 규칙이다._

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
      "language": "swift",                 // swift | kotlin | dart | js | go | rust | python (호출 측 생산자 언어)
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
  Kotlin 매개변수 이름, JS 객체 속성 이름, Python 키워드 인자 이름) 중 하나 이상을 적는다. Go·Rust는 이름 붙은 인자가
  없어 `index`만 쓴다(구조체 필드로 넘기는 래퍼는 선언 대상이 아니다 — 필드 흐름을 증명하지 못하면 `http-wrapper-undeclared:`). 둘 다 적으면 아래 바인딩
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

### v2의 선택적 경로 suffix

v2는 v1 필드를 유지하고 선택적 `pathSuffix`를 더한다. HTTP 사실 출력은 계속
bridge-facts v1이다. suffix 없는 v1 입력은 이전 동작과 같아야 한다. v1 파일에 새 필드를
넣으면 선언 오류이며, v2를 지원하지 않는 생산자는 명시적으로 버전을 거부한다.

```jsonc
{
  "format": "http-wrappers",
  "version": 2,
  "wrappers": [{
    "language": "swift", "kind": "constructor", "owner": "CatalogEndpoint", "name": "init",
    "pathArg": {"label": "route"}, "defaultMethod": "GET", "pathAnchor": "root",
    "pathSuffix": [
      {"literal": "details"},
      {"argument": {"label": "slug"}, "shape": "scalar"},
      {"argument": {"label": "segments"}, "shape": "array"}
    ]
  }]
}
```

- 선언 하나에 최대 32개 suffix 항목을 둔다. 항목은 `literal` 하나 또는 `argument`와
  `shape` 두 필드로만 이뤄진다. `argument`는 기존 index/label 바인딩이다.
- `scalar`는 해당 값이 decoded 경로 segment 하나라는 작성자의 명시적인 모델 선언이다.
  알려진 문자열은 하나의 segment로 인코딩하고, 미상 scalar·숫자·Bool은 `{}`다.
  인자 부재·nil·명백한 비scalar는 dynamic이다. segment 보장을 할 수 없는 래퍼에는 쓰지 않는다.
- `array`는 길이를 아는 bounded array literal만 펼친다. 빈 배열은 아무것도 붙이지 않는다.
  런타임 길이·spread·비scalar 원소·해석하지 못한 배열은 dynamic이다.
- 한 호출에서 최대 64개 segment를 펼친다. 빈 문자열·`.`·`..`·제어 문자를 가진
  literal segment는 정적 경로로 만들지 않는다.
- segment는 decoded 데이터다. RFC 3986 unreserved만 그대로 두고 나머지는 UTF-8
  대문자 퍼센트 인코딩한다. `/`는 `%2F`, `%`는 `%25`다. 기존 escape로 해석하거나
  데이터의 slash를 segment 경계로 쓰지 않는다. 미상 scalar 하나만 `{}`로 표현한다.
- 정규화된 main 경로 뒤에 경계 slash 하나로 붙이고, 제거된 query/fragment 상태·authority·
  pathAnchor·마스킹 정책을 보존한다. main의 기존 `{}`나 escape는 다시 인코딩하지 않는다.
- main이 dynamic이면 suffix로 정적으로 승격하지 않는다. suffix가 불확실하거나 상한을 넘으면
  `dynamic: true`이며 기존에 증명한 main 템플릿만 `channelPrefix`로 남긴다. 호출 사실은
  그대로 내보내고, 발생 수를 기존 `http-wrapper-unresolved:` 접두사 아래에 보고한다.
- 선언 JSON 파일은 최대 1 MiB다. IO 구현은 가능하면 상한+1 byte까지만 읽어 판정한다.

생산자 지원은 단계적으로 배포한다. 구현과 conformance 검증을 마친 생산자만 v2를 받으며,
지원 전에는 각 생산자에 v1/v2 파일을 따로 전달한다. suffix가 있는 v2의 v1 down-convert는
데이터를 잃으므로 허용하지 않는다. 공유 벡터는 지원 생산자별 `appliesTo`를 명시한다.

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
   Dart `${expr}`, JS 템플릿 `${expr}`, Go `fmt.Sprintf`의 동사(`%s`·`%d`·`%v` 등, 폭·플래그 포함)와 `+` 연결,
   Rust `format!`의 `{}`·`{name}`, Python f-string `{expr}`·`%` 서식·`str.format`의 `{}`)은 **세그먼트 전체를 채울 때만** `{}`가 된다.
   `%%`·`{{`·`}}` 같은 이스케이프는 리터럴이다. 즉 앞이 `/`로
   끝나고 뒤가 `/`로 시작하거나 경로 끝이어야 한다. 세그먼트 일부만 채우거나(`/files/${name}.json`)
   한 세그먼트에 둘 이상이면 호출은 dynamic이다. 서버 템플릿의 부분 세그먼트(`p{}s`)와 달리
   호출 쪽 부분 보간은 값 경계를 증명할 수 없기 때문이다.
4. **dynamic과 channelPrefix**: dynamic 호출은 `channel`에 원문 식(길이 상한 2,048)이나 `null`을
   싣고, 문제 되는 첫 보간 앞까지의 조립 결과가 `/`로 시작하면 그 정규 템플릿을 `channelPrefix`로
   싣는다(`/files/`, `/api/v1/articles`). `channelPrefix`는 query의 `prefix-candidate` 표시에만 쓰인다.
5. **같은 파일 상수**: 경로 인자나 보간이 같은 파일의 컴파일 타임 상수(Kotlin `const val`, Swift
   `static let` 리터럴, Dart `const`, JS `const` 리터럴, Go `const`, Rust `const`·`static`의 `&str` 리터럴, Python은 모듈
   최상위에서 한 번만 대입되고 파일 안에서 다시 대입되지 않는 문자열 리터럴)이면 값을 치환한다. Python의 대문자 이름
   관례는 증명이 아니다. 파일 밖 상수는 생산자가
   증명할 수 있을 때만 치환하고, 아니면 dynamic이다.
6. **정규화** (`compose.normalize`): 조립한 리터럴은 [정규 경로 템플릿](GRAPH-EXCHANGE.md#정규-경로-템플릿)
   표기로 쓴다. 비ASCII와 금지 문자는 UTF-8 대문자 퍼센트 인코딩, unreserved 인코딩은 디코드,
   리터럴 중괄호는 `%7B`·`%7D`다. 중복 슬래시·끝 슬래시·대소문자는 보존한다.

### base 결합

`compose.base-join`. base URL과 경로의 결합은 라이브러리 의미를 따른다.

| 결합 방식 | 예 | 경로 `/x` | 경로 `x` |
|---|---|---|---|
| RFC 3986 상대 해석(`rfc3986`), base 미상 | Retrofit·Ktor·`URL(string:relativeTo:)`, Go `ResolveReference`, Rust `Url::join` | root | base(`..`가 있으면 dynamic + `ambiguous-base-join:`) |
| RFC 3986 상대 해석(`rfc3986`), base 리터럴 | 같음 | `x`(base 경로를 바꾼다), root | base 경로의 마지막 `/`까지 + `x`, 점 세그먼트 제거, root |
| Go `url.JoinPath`(`go-join-path`) | `(*url.URL).JoinPath`·`url.JoinPath` | base 경로 + `/x`(`path.Join`), 리터럴이면 root, 미상이면 base | 같음 |
| resty `SetBaseURL`(`resty-base-url`) | go-resty v2·v3 | 끝 `/`를 뗀 base 경로 + `/x`, 리터럴이면 root, 미상이면 base | base 경로 + `/` + `x`, 같음 |
| httpx `base_url`(`httpx-base-url`) | `httpx.Client(base_url=)` | base 경로(끝 `/` 보장) + `x`, 점 세그먼트 제거, 리터럴이면 root, 미상이면 base | 같음 |
| aiohttp `base_url`(`aiohttp-base-url`) | `aiohttp.ClientSession(base_url=)` | RFC 3986과 같다(root) | RFC 3986과 같다(3.11+, base 경로는 `/`로 끝나야 한다) |
| axios `baseURL`(`axios-base-url`) | axios 1.20.0 | base 경로 + `/x`, 리터럴이면 root, 미상이면 base | 같음 |
| ky 1 `prefixUrl`(`ky-prefix-url`) | ky 1.10.0 | 요청 생성 오류(dynamic) | prefix에 끝 `/` 보장 후 `x`, 리터럴이면 root, 미상이면 base |
| ky 2 `prefix`(`ky-prefix`) | ky 2.1.0 | 경계의 `/`를 모두 뗀 뒤 `/` 하나로 결합, 리터럴이면 root, 미상이면 base | 같음 |
| ky 2 `baseUrl`(`ky-base-url`) | ky 2.1.0 | RFC 상대 해석(root) | RFC 상대 해석(base 리터럴이면 root, 미상이면 base) |
| 슬래시 결합 | chopper·Moya·openapi-fetch | base | base |
| 단순 문자열 연결, base 리터럴 | dio, retrofit.dart 메서드 경로 | 연결 결과의 경로, root | 연결 결과의 경로, root |
| 단순 문자열 연결, base 미상 | dio, retrofit.dart 메서드 경로 | base | dynamic + `ambiguous-base-join:` |
| 연결 + 중복 슬래시 축약, base 리터럴 | Spring `DefaultUriBuilderFactory`(RestClient·WebClient `baseUrl`, `@HttpExchange` 어댑터) | `base경로 + /x`(`//`→`/`), root | `base경로 + x`, root(base `http://h`는 `/x`) |
| 연결 + 중복 슬래시 축약, base 미상 | 같음 | base | dynamic + `ambiguous-base-join:` |
| `/` 접두 템플릿에만 root 연결 | Spring Boot `RestTemplateBuilder.rootUri` | 리터럴이면 `root경로 + /x` root, 미상이면 base | root가 붙지 않아 요청 불가 — dynamic |

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

**Spring은 dio와 다른 단순 연결이다.** `DefaultUriBuilderFactory`는 host 없는 템플릿이면 base 빌더를 복제해 템플릿 경로를
슬래시 없이 잇고(`UriComponentsBuilder.FullPathComponentBuilder.append`), 빌드할 때 **경로 전체의** `//`를 `/`로 줄인다
(`getSanitizedPath`). dio와 달리 (1) 점 세그먼트를 지우지 않고(`/api` + `/users/./me/../self`는 그대로 전송된다), (2) `//` 축약을
scheme 뒤 한 곳이 아니라 경로 전체에 적용하며(base 없이 쓴 템플릿의 `//`도 줄어든다), (3) base에 경로가 없으면 URI 문자열이
host 뒤에 `/`를 넣는다(`http://h` + `users` → `/users`, dio는 host `husers`라 dynamic). `/api` + `users`는 dio처럼 `/apiusers`다.
host가 있는 템플릿(`http://…`)은 base를 쓰지 않는다. Spring Boot `RestTemplateBuilder.rootUri`는 `/`로 시작하는 템플릿에만 root를
문자열로 앞에 붙이고(`RootUriTemplateHandler.apply`) 그 결과를 base 없는 `DefaultUriBuilderFactory`가 파싱하므로 `//` 축약도
적용된다. `/`로 시작하지 않는 템플릿은 host 없이 남아 요청할 수 없으므로 경로를 주장하지 않는다(dynamic).

**`@HttpExchange`는 타입·메서드 url을 먼저 잇는다.** 둘 다 있으면 타입 url이 `/`로 끝나지 않고 메서드 url이 `/`로 시작하지 않을
때만 `/`를 넣어 잇고, 하나만 있으면 그것이다(`HttpServiceMethod.initUrl`). 그 결과가 어댑터 클라이언트의 템플릿이 되어 위
`DefaultUriBuilderFactory` 결합을 따른다(`/api/` + `/users` → `/api//users` → `/api/users`). 어노테이션의 `${…}`는 embedded value
resolver가 있을 때만 풀리므로 생산자는 dynamic으로 낸다. 이 규칙들은 Spring Framework 6.2.19·Spring Boot 3.5.16 소스와 합성 앱
오라클(kartograph, 32개 호출 일치)로 확인했고 url-compose 벡터 `base-join/spring-*`(`producer:kartograph`)가 고정한다.

base 없이 전체 URL 리터럴을 쓰면 host 뒤 경로를 root로 쓴다. host가 동적이면 base다.

### JavaScript 웹·React Native 클라이언트

tsograph의 `routes --role client`는 전역 `fetch`(웹·React Native), provenance로 확인한 axios·ky import 및
`create`/`extend` 인스턴스의 요청을 `route-call`로 낸다. 요청 위치는 호출식 시작의 UTF-8 바이트 열,
`symbol.usr`는 감싸는 함수·화면 콜백의 tsograph 그래프 id다. 테스트 소스는 기본으로 제외한다.

- axios 1.20.0의 [buildFullPath](https://github.com/axios/axios/blob/v1.20.0/lib/core/buildFullPath.js)와
  [combineURLs](https://github.com/axios/axios/blob/v1.20.0/lib/helpers/combineURLs.js): 상대 URL이면 base 끝과
  path 앞의 `/`를 모두 뗀 뒤 `/` 하나로 잇는다. `/x`도 base 경로를 유지한다. 절대 URL·`//host/x`는 기본으로
  base를 대체하며 `allowAbsoluteUrls: false`이면 base 뒤에 붙인다. 빈 path는 base 그대로다.
- ky 1.10.0의 [Ky](https://github.com/sindresorhus/ky/blob/v1.10.0/source/core/Ky.ts): `prefixUrl`은 끝 `/`를
  보장하고 input을 그대로 잇는다. input이 `/`로 시작하면 오류다. 절대 input도 prefix 뒤에 붙는다.
- ky 2.1.0의 [Ky](https://github.com/sindresorhus/ky/blob/v2.1.0/source/core/Ky.ts): `prefixUrl`은 오류이고
  `prefix`는 경계 `/`를 모두 떼고 `/` 하나로 결합한다. `baseUrl`은 그 결과가 상대 URL일 때
  WHATWG `new URL(input, baseUrl)`로 해석한다. prefix와 baseUrl 동시 사용은 현재 tsograph limitation이다.
- 실제 HTTP URL 파싱 단계의 점 세그먼트 제거를 적용한다. fetch의 `/x`는 root, 상대 `x`는 실행 환경의
  document base를 모르므로 base다. 모르는 base의 `..`·역슬래시·scheme 접두사는 dynamic으로 남긴다. axios의 malformed HTTP URL과
  HTTP 외 절대 URL도 기본 결합에서는 요청 경로로 주장하지 않는다.
- 미상 설정 전개, 설정 변경, axios interceptor, ky hook, 사용자 adapter/fetch 및 증명하지 못한 동사는
  정적 요청으로 추측하지 않는다. 원문 식·userinfo·query·fragment 값은 출력하지 않으며 공유 경로 마스킹을 적용한다.

공식 소스 조회와 실제 axios 1.20.0·ky 1.10.0/2.1.0의 로컬 모의 HTTP 서버 오라클은 2026-10-01 기준이다.
공유 벡터의 `base-join/js-*`(`producer:tsograph`)가 결합 의미를 고정한다.

### Go, Rust, Python 클라이언트

gartograph(Go)·rustograph(Rust)·pythograph(Python)가 `route-call`을 낼 때 따르는 결합 규칙이다. 결과는 각 라이브러리 소스와
실행 기록으로 확인했고(2026-09-30, 아래 버전) url-compose 벡터 `base-join/go-*`·`resty-*`·`rust-*`·`rfc3986-unknown-*`·`httpx-*`·
`aiohttp-*`가 고정한다. 결합 방식 이름(`join`)은 벡터 입력과 같다. 결과 경로의 정규화(퍼센트 인코딩 등)는 위 `compose.normalize`다.

**base가 없는 라이브러리** — 호출 식의 URL이 곧 요청 URL이다. 전체 URL 리터럴은 `compose.strip`, 문자열 조립은 위 보간 규칙을 쓴다.

- Go `net/http`: `http.Client`에는 base URL이 없다(필드는 `Transport`·`CheckRedirect`·`Jar`·`Timeout`). `http.NewRequest`·
  `http.Get` 등은 전체 URL을 받는다.
- Rust reqwest(0.13.5): `Client`·`ClientBuilder`에 base URL 설정이 없고 요청은 `IntoUrl`을 받는다
  ([client.rs](https://github.com/seanmonstar/reqwest/blob/v0.13.5/src/async_impl/client.rs#L2596-L2599)).
- Python requests(2.34.2): `Session`에 base URL이 없다([sessions.py](https://github.com/psf/requests/blob/v2.34.2/src/requests/sessions.py#L427-L440)).

**RFC 3986 해석(`rfc3986`)** — 참조를 base에 대해 해석한다(RFC 3986 5.2.2 → 5.2.3 merge → 5.2.4 점 세그먼트 제거).

- Go `(*url.URL).ResolveReference`([url.go](https://github.com/golang/go/blob/go1.23.0/src/net/url/url.go#L1116-L1153), go1.23.0
  소스와 go1.27.1 실행이 같다).
- Rust `url::Url::join`(url 2.5.8, [lib.rs](https://github.com/servo/rust-url/blob/v2.5.8/url/src/lib.rs#L413-L473)) — WHATWG URL
  파서에 base를 준 것이고, http(s)의 이 입력들에서 결과가 RFC 3986 해석과 같다. reqwest 코드가 `Url::join`을 부를 때만 해당한다.
- 규칙: `/`로 시작하는 참조는 base 경로 전체를 바꾼다. 상대 참조는 base 경로의 마지막 `/`까지를 남기고 붙인다 — 끝 `/` 없는
  base(`…/api`)에 `users`를 붙이면 `/users`다. `//host/p`는 authority까지 바꾸는 참조라 그 host와 `/p`(없으면 `/`)다.
- base 리터럴이면 결과 경로는 root다. base가 미상이면 `/`로 시작하는 참조는 root(점 세그먼트 제거 후), 상대 참조는 알 수 없는
  base 디렉터리 뒤라 base(`./`는 지운다)이고, `..`가 있거나 빈 참조면 지울 세그먼트를 알 수 없어 dynamic + `ambiguous-base-join:`이다.

**Go `url.JoinPath`(`go-join-path`, Go 1.19+)** — [url.go](https://github.com/golang/go/blob/go1.23.0/src/net/url/url.go#L1237-L1256).
base 경로와 원소를 `path.Join`으로 잇는다: `/`를 넣고, `//`를 줄이고, `.`·`..`를 지운다(`..`는 base 경로 밖으로도 나간다 —
`…/api` + `../x` → `/x`). 원소의 앞 `/`는 경로를 바꾸지 않는다(`/users` → `/api/users`). 마지막 원소가 `/`로 끝나면 끝 슬래시
하나를 남긴다. base가 미상이면 정리한 원소 경로가 base 앵커 꼬리이고, `..`가 있으면 dynamic + `ambiguous-base-join:`이다.

**go-resty(`resty-base-url`)** — v2.17.2 `SetBaseURL`은 끝 `/`를 모두 떼고
([client.go](https://github.com/go-resty/resty/blob/v2.17.2/client.go#L193-L197)), 요청 URL이 절대 URL이 아니면 `/`로 시작하지
않을 때 `/`를 붙여 문자열로 잇는다([middleware.go](https://github.com/go-resty/resty/blob/v2.17.2/middleware.go#L103-L126)). v3.0.0-rc.4는
base를 그대로 두고 조립할 때 끝 `/`를 뗀다([middleware.go](https://github.com/go-resty/resty/blob/v3.0.0-rc.4/middleware.go#L130-L153)).
두 버전 모두 `//`·점 세그먼트를 그대로 보낸다(로컬 서버가 받은 RequestURI로 확인: `…/api` + `//users` → `/api//users`, `./users` →
`/api/./users`). 요청 URL이 절대 URL(scheme 있음)이면 base를 쓰지 않는다(`compose.strip`). 경로가 빈 문자열이면 v2는 끝 `/`를 뗀
base 경로, v3(rc)는 base 원문 경로라 끝 슬래시가 갈린다 — base가 `/`로 끝나고 major 버전을 모르면 dynamic +
`ambiguous-base-join:`으로 낸다. base가 미상이면 `/`를 붙인 경로가 base 앵커 꼬리다(`rfc3986`과 달리 `/`로 시작해도 root가 아니다).

**httpx(`httpx-base-url`)** — 0.28.1. `base_url` 설정이 경로 끝 `/`를 보장하고
([_client.py](https://github.com/encode/httpx/blob/0.28.1/httpx/_client.py#L234-L237)), `_merge_url`이 상대 URL 경로의 앞 `/`를
**모두** 떼어 붙인다([_client.py](https://github.com/encode/httpx/blob/0.28.1/httpx/_client.py#L391-L411)). 합친 URL은 다시 파싱되며
점 세그먼트를 지운다([_urlparse.py](https://github.com/encode/httpx/blob/0.28.1/httpx/_urlparse.py#L447-L475)) — `..`는 base 경로
밖으로도 나간다. 가운데 `//`는 줄이지 않는다(`a//b` → `/api/a//b`). 그래서 `…/api`·`…/api/` 어느 쪽이든 `users`·`/users`는
`/api/users`다. `//`로 시작하는 경로는 host로 파싱되어 경로가 사라지므로(`//users` → base 경로 그대로) 주장하지 않고 dynamic +
`ambiguous-base-join:`이다. 절대 URL(scheme과 host)은 base를 쓰지 않는다. base가 미상이면 앞 `/`를 뗀 경로가 base 앵커 꼬리이고,
`..`가 있으면 dynamic + `ambiguous-base-join:`이다.

**aiohttp(`aiohttp-base-url`)** — `ClientSession(base_url=)`는 상대 URL을 yarl `URL.join`(RFC 3986)으로 합친다
([client.py](https://github.com/aio-libs/aiohttp/blob/v3.14.3/aiohttp/client.py#L531-L535), 3.14.3·yarl 1.25.1 실행 확인). 결과는
`rfc3986`과 같고 다음 제약이 더해진다.

- 버전: 3.8.0에서 `base_url`이 생겼고 그때는 base가 경로 없는 origin이어야 하고 요청 경로가 `/`로 시작해야 했다(assert). 3.11.0부터
  base에 경로를 쓸 수 있고(`/`로 끝나야 함) `/` 없는 상대 경로를 받는다. 3.12.0부터 절대 URL 요청이 base를 건너뛴다. 생산자는
  aiohttp 3.11 이상을 증명하지 못하면 `/` 없는 상대 경로와 경로 있는 base를 dynamic + `ambiguous-base-join:`으로, 3.12 이상을
  증명하지 못하면 base 세션의 절대 URL 요청을 dynamic으로 낸다(그 버전에서는 요청이 실패한다).
- 경로가 있는 base가 `/`로 끝나지 않으면 세션 생성이 `ValueError`로 실패한다
  ([client.py](https://github.com/aio-libs/aiohttp/blob/v3.14.3/aiohttp/client.py#L355-L363)) — dynamic + `ambiguous-base-join:`.
- aiohttp 문서대로 요청 경로가 `/`로 시작하면 base 경로를 버린다(`…/api/` + `/users` → `/users`).
- `//`로 시작하는 경로는 yarl이 절대 URL로 읽는다 — 주장하지 않고 dynamic + `ambiguous-base-join:`이다.

**그 밖**: 벡터가 없는 결합(`urllib.parse.urljoin`, requests-toolbelt `BaseUrlSession`, 사용자 정의 base 헬퍼 등)은 결합 결과를
주장하지 않는다. base 뒤 경로가 `/`로 시작하는 리터럴이면 base 앵커 꼬리로만, 아니면 dynamic + `ambiguous-base-join:`으로 낸다.
`urljoin`은 대부분의 입력에서 RFC 3986과 같지만 `rfc3986`으로 묶지 않는다 — 상대 참조를 합칠 때 빈 세그먼트를 지워
`…/api/` + `a//b`가 `/api/a/b`(RFC 3986은 `/api/a//b`)이고 base 경로의 `//`도 줄인다(CPython 3.14.7 실행 확인).
새 라이브러리는 공식 소스를 확인해 이 절과 벡터에 결합 방식을 더한 뒤 쓴다.

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
- `compose.base-join` 입력의 `join`은 `rfc3986`·`slash-join`·`dio-concat`·`spring-uri-builder`·`spring-root-uri`·
  `spring-http-exchange`(메서드 url은 `path`, 타입 url은 `typeUrl`)·`go-join-path`·`resty-base-url`·`httpx-base-url`·
  `aiohttp-base-url`이다. 기대값의 `authority`는 base 리터럴(또는 network-path 참조)에서 온 소문자 authority다. `rfc3986`의 base
  리터럴 케이스와 Go·Rust·Python 케이스는 `producer:gartograph`·`producer:rustograph`·`producer:pythograph`로 좁혀 두었다 —
  같은 방식을 쓰는 다른 생산자는 자기 이름을 `appliesTo`에 더하자고 요청한다. `versionRange`는 그 라이브러리 버전이다.
  Spring 케이스는 `producer:kartograph`라 다른 생산자의 러너는 고르지 않는다 — Spring 클라이언트를 읽는 다른 JVM 생산자는 자기
  이름을 `appliesTo`에 더하자고 요청한다.
  isthmus의 `npm run verify`는 같은 벡터를 제품 매처와 참조 구현으로 실행한다.
