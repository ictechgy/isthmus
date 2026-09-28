import { httpMethods, parseRouteTemplate, type HttpMethod } from './route-template.ts';

/**
 * http 문서의 limitation 스코프 항목 검증·정규화다.
 *
 * bridge 문서의 스코프는 채널 집합이지만, http 문서의 스코프는 한계가 가릴 수 있는 **요청 경로 집합**의
 * 보수적 상한을 정규 템플릿으로 적는다(`templates`·`templatePrefixes`·`templateSuffixes`, 선택 `methods`).
 * 잘못된 스코프를 빈 공백으로 읽으면 거짓 error가 생기므로 모르는 키·잘못된 원소는 모두 거부한다. 경로
 * 비교(어떤 호출·선언이 스코프 안인지)는 조인 층의 몫이고 이 모듈은 입력 형태만 책임진다. 계약의 정본은
 * GRAPH-EXCHANGE의 "http limitation 스코프" 절이다.
 */

/** http 문서 스코프 항목의 경로 필드 이름이다. 셋 중 하나 이상이 있어야 한다. */
export const routeScopePathFields = ['templates', 'templatePrefixes', 'templateSuffixes'] as const;

/** 경로 필드 이름 하나다. */
export type RouteScopePathField = (typeof routeScopePathFields)[number];

/**
 * 한계 하나가 가릴 수 있는 요청(method, 경로)의 보수적 상한이다.
 *
 * - `templates`: 정확한 정규 템플릿 집합. `{**}`도 쓸 수 있다.
 * - `templatePrefixes`: 세그먼트 경계의 root 접두사. `/actuator`는 `/actuator`와 그 아래 모든 경로, `/`는 모든 경로다.
 * - `templateSuffixes`: 알 수 없는 앞부분(0개 이상 세그먼트) 뒤의 세그먼트 경계 접미사. base 앵커 decl의 알려진 꼬리다.
 * - `methods`: 생략하면 모든 method다. 있으면 그 method의 요청만 가린다(HEAD·OPTIONS 예외는 조인 층이 적용).
 */
export interface RouteLimitationRange {
  readonly templates?: readonly string[];
  readonly templatePrefixes?: readonly string[];
  readonly templateSuffixes?: readonly string[];
  readonly methods?: readonly HttpMethod[];
}

/** http 문서의 스코프 항목이다. `limitationIndex`는 같은 문서 `limitations`의 인덱스다. */
export interface RouteLimitationScope extends RouteLimitationRange {
  readonly limitationIndex: number;
}

/** http 스코프 항목이 가질 수 있는 키다. 그 밖의 키(`channels` 포함)는 거부한다. */
const allowedKeys = new Set<string>(['limitationIndex', ...routeScopePathFields, 'methods']);

/** 계약이 정한 HTTP 동사 집합이다. `ANY`는 스코프에 쓰지 않는다(생략이 모든 method다). */
const methodSet = new Set<string>(httpMethods);

/**
 * http 스코프 항목 하나의 모양을 검증한다. 인덱스 범위·중복은 호출자가 본다.
 *
 * @param entry JSON 객체로 확인된 항목
 * @returns 위반 사유 문구(입력 원문을 담지 않는다). 통과하면 undefined다.
 */
export function routeScopeEntryProblem(entry: Readonly<Record<string, unknown>>): string | undefined {
  if (entry.channels !== undefined) {
    return 'Http limitation scopes use templates, templatePrefixes, or templateSuffixes instead of channels.';
  }
  const unknown = Object.keys(entry).find((key) => !allowedKeys.has(key));
  if (unknown !== undefined) return 'Http limitation scopes accept only limitationIndex, templates, templatePrefixes, templateSuffixes, and methods.';
  if (!routeScopePathFields.some((field) => entry[field] !== undefined)) {
    return 'Http limitation scopes require at least one of templates, templatePrefixes, or templateSuffixes.';
  }
  for (const field of routeScopePathFields) {
    const problem = pathFieldProblem(field, entry[field]);
    if (problem !== undefined) return problem;
  }
  return methodsProblem(entry.methods);
}

/** 항목의 경로 원소 수(정규화 전)다. 문서당 원소 상한 계산에 쓴다. */
export function routeScopeElementCount(entry: Readonly<Record<string, unknown>>): number {
  return routeScopePathFields.reduce((sum, field) => {
    const value = entry[field];
    return sum + (Array.isArray(value) ? value.length : 0);
  }, 0);
}

/** 검증된 항목에서 계약 필드만 복사하고 원소를 중복 제거·문자열 순으로 정규화한다. */
export function normalizeRouteScope(scope: RouteLimitationScope): RouteLimitationScope {
  return {
    limitationIndex: scope.limitationIndex,
    ...normalizeRouteRange(scope),
  };
}

/** 범위만 정규화한다. 출력(조인 한계)과 문서 정규화가 같은 순서를 쓰게 한다. */
export function normalizeRouteRange(range: RouteLimitationRange): RouteLimitationRange {
  const sorted = <T extends string>(values: readonly T[]): T[] => [...new Set(values)].sort();
  return {
    ...(range.templates === undefined ? {} : { templates: sorted(range.templates) }),
    ...(range.templatePrefixes === undefined ? {} : { templatePrefixes: sorted(range.templatePrefixes) }),
    ...(range.templateSuffixes === undefined ? {} : { templateSuffixes: sorted(range.templateSuffixes) }),
    ...(range.methods === undefined ? {} : { methods: sorted(range.methods) }),
  };
}

/**
 * 경로 필드 하나를 검증한다. 비어 있지 않은 배열이고 원소마다 정규 템플릿이어야 한다.
 *
 * 접두사·접미사에는 `{**}`를 쓰지 않는다(접두사는 이미 그 아래 전체를 덮는다). 루트가 아닌 접두사가 빈
 * 끝 세그먼트로 끝나면(`/a/`) 뜻이 모호해 거부하고, 접미사 `/`는 모든 경로를 덮는 뜻이 되어 접두사 `/`로
 * 쓰게 한다.
 */
function pathFieldProblem(field: RouteScopePathField, value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0) return `Http limitation scope ${field} must be a non-empty array.`;
  for (const element of value) {
    if (typeof element !== 'string') return `Http limitation scope ${field} must contain path template strings.`;
    const parsed = parseRouteTemplate(element);
    if (!parsed.ok) return `Http limitation scope ${field} contains a non-canonical path template (${parsed.reason}).`;
    if (field === 'templates') continue;
    if (parsed.segments.some(({ kind }) => kind === 'catch-all')) {
      return `Http limitation scope ${field} must not contain {**}; a prefix already covers every path below it.`;
    }
    const last = parsed.segments.at(-1)!;
    const endsEmpty = last.kind === 'literal' && last.value === '';
    if (field === 'templatePrefixes' && endsEmpty && element !== '/') {
      return 'Http limitation scope templatePrefixes must not end with "/" except the root prefix "/".';
    }
    if (field === 'templateSuffixes' && element === '/') {
      return 'Http limitation scope templateSuffixes must not be "/"; use templatePrefixes ["/"] to cover every path.';
    }
  }
  return undefined;
}

/** `methods`를 검증한다. 선택 필드이며 중복 없는 HTTP 동사의 비어 있지 않은 배열이다. */
function methodsProblem(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0 || value.length > methodSet.size ||
    !value.every((method) => typeof method === 'string' && methodSet.has(method)) ||
    new Set(value).size !== value.length) {
    return 'Http limitation scope methods must be a non-empty array of distinct HTTP methods (GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS, TRACE).';
  }
  return undefined;
}
