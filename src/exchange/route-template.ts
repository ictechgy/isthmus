/**
 * http 도메인의 정규 경로 템플릿 문법이다.
 *
 * 정규화는 생산자 책임이고 isthmus는 문법만 검증한다. 위반한 템플릿을 다시 정규화하면
 * `%2f`와 `%2F`처럼 다르게 정규화한 생산자끼리 조용히 조인되므로, 이 모듈은 고쳐 쓰지 않고
 * 거부 사유만 돌려준다. 사유 코드는 conformance 벡터(`conformance/http-template.json`)의
 * `expect.reason`과 같은 어휘라 생산자가 같은 판정을 재현할 수 있다.
 */

/** 템플릿 한 세그먼트의 구조다. 이름·정규식은 템플릿에 남지 않는다. */
export type RouteSegment =
  | { readonly kind: 'literal'; readonly value: string }
  | { readonly kind: 'param' }
  | { readonly kind: 'partial'; readonly prefix: string; readonly suffix: string }
  | { readonly kind: 'catch-all' };

/** 템플릿을 거부한 이유다. 벡터와 오류 문구가 같은 코드를 쓴다. */
export type RouteTemplateRejection =
  | 'not-rooted'
  | 'too-long'
  | 'invalid-character'
  | 'malformed-percent'
  | 'lowercase-percent-hex'
  | 'encoded-unreserved'
  | 'stray-brace'
  | 'multiple-parameters'
  | 'catch-all-partial'
  | 'catch-all-not-last';

/** 템플릿 해석 결과다. 성공하면 세그먼트 목록, 실패하면 거부 사유다. */
export type RouteTemplateParse =
  | { readonly ok: true; readonly segments: readonly RouteSegment[] }
  | { readonly ok: false; readonly reason: RouteTemplateRejection };

/**
 * 템플릿 하나의 최대 UTF-16 길이다. dynamic 원문에도 같은 상한을 쓴다.
 *
 * 상한이 없으면 세그먼트 수에 비례하는 매칭·suffix 후보 계산이 입력 크기로 폭주한다.
 */
export const MAX_ROUTE_TEMPLATE_LENGTH = 2_048;

/** 계약이 정한 HTTP 동사다. `ANY`는 route-decl 전용이라 따로 둔다. */
export const httpMethods = [
  'GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'TRACE',
] as const;

/** 계약이 정한 HTTP 동사 하나다. */
export type HttpMethod = (typeof httpMethods)[number];

/** route 사실의 method 값이다. `ANY`는 method 없는 서버 매핑이다. */
export type RouteMethod = HttpMethod | 'ANY';

/**
 * 정규 경로 템플릿을 세그먼트로 해석한다. 문법을 어기면 사유와 함께 실패한다.
 *
 * 템플릿은 `/`로 시작하고 `/`로 나눈 세그먼트의 나열이다. 빈 세그먼트(중복·끝 슬래시)와
 * 대소문자는 보존한다. `/` 하나는 빈 세그먼트 하나인 루트 템플릿이다.
 */
export function parseRouteTemplate(template: string): RouteTemplateParse {
  if (template.length > MAX_ROUTE_TEMPLATE_LENGTH) return rejected('too-long');
  if (!template.startsWith('/')) return rejected('not-rooted');
  const rawSegments = template.slice(1).split('/');
  const segments: RouteSegment[] = [];
  for (const [index, raw] of rawSegments.entries()) {
    const parsed = parseSegment(raw);
    if (typeof parsed === 'string') return rejected(parsed);
    if (parsed.kind === 'catch-all' && index !== rawSegments.length - 1) {
      return rejected('catch-all-not-last');
    }
    segments.push(parsed);
  }
  return { ok: true, segments };
}

/** 문법 검증만 필요한 곳(파서·벡터 검증기)을 위한 술어다. */
export function isCanonicalRouteTemplate(template: string): boolean {
  return parseRouteTemplate(template).ok;
}

/** 세그먼트 목록을 다시 정규 템플릿 문자열로 쓴다. 해석의 역연산이다. */
export function formatRouteTemplate(segments: readonly RouteSegment[]): string {
  return `/${segments.map(formatSegment).join('/')}`;
}

/** 세그먼트 하나를 정규 표기로 쓴다. */
function formatSegment(segment: RouteSegment): string {
  switch (segment.kind) {
    case 'literal': return segment.value;
    case 'param': return '{}';
    case 'partial': return `${segment.prefix}{}${segment.suffix}`;
    case 'catch-all': return '{**}';
  }
}

/**
 * 세그먼트 하나를 해석한다. 실패하면 사유 문자열을 돌려준다.
 *
 * `{**}`는 세그먼트 전체일 때만 토큰이다. `{}`는 세그먼트당 하나이며, 그 앞뒤의 리터럴이
 * 부분 세그먼트의 골격이 된다. 그 밖의 중괄호는 `%7B`·`%7D`로 써야 한다.
 */
function parseSegment(raw: string): RouteSegment | RouteTemplateRejection {
  if (raw === '{**}') return { kind: 'catch-all' };
  let parameterAt = -1;
  let index = 0;
  while (index < raw.length) {
    const character = raw[index]!;
    if (character === '{') {
      if (raw.startsWith('{**}', index)) return 'catch-all-partial';
      if (raw[index + 1] !== '}') return 'stray-brace';
      if (parameterAt >= 0) return 'multiple-parameters';
      parameterAt = index;
      index += 2;
      continue;
    }
    if (character === '}') return 'stray-brace';
    if (character === '%') {
      const problem = percentProblem(raw, index);
      if (problem !== undefined) return problem;
      index += 3;
      continue;
    }
    if (!literalCharacter.test(character)) return 'invalid-character';
    index += 1;
  }
  if (parameterAt < 0) return { kind: 'literal', value: raw };
  const prefix = raw.slice(0, parameterAt);
  const suffix = raw.slice(parameterAt + 2);
  return prefix === '' && suffix === '' ? { kind: 'param' } : { kind: 'partial', prefix, suffix };
}

/**
 * `%XX` 하나가 정규형인지 확인한다. 대문자 hex여야 하고 unreserved 문자를 인코딩하면 안 된다.
 *
 * 두 규칙을 느슨하게 받으면 같은 경로를 다르게 정규화한 생산자끼리 조인되지 않는다.
 */
function percentProblem(raw: string, index: number): RouteTemplateRejection | undefined {
  const hex = raw.slice(index + 1, index + 3);
  if (!/^[0-9A-Fa-f]{2}$/u.test(hex)) return 'malformed-percent';
  if (hex !== hex.toUpperCase()) return 'lowercase-percent-hex';
  const decoded = String.fromCharCode(Number.parseInt(hex, 16));
  return unreservedCharacter.test(decoded) ? 'encoded-unreserved' : undefined;
}

/** 거부 결과를 만든다. */
function rejected(reason: RouteTemplateRejection): RouteTemplateParse {
  return { ok: false, reason };
}

/** RFC 3986 unreserved 문자다. 템플릿에서는 인코딩하지 않는다. */
const unreservedCharacter = /^[A-Za-z0-9\-._~]$/u;

/** 인코딩 없이 쓸 수 있는 pchar 리터럴 문자(unreserved·sub-delims·`:`·`@`)다. */
const literalCharacter = /^[A-Za-z0-9\-._~!$&'()*+,;=:@]$/u;
