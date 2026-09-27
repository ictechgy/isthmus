import { compareStrings } from '../compare.ts';
import { isJsonObject, isSafeNonEmptyString } from './parse.ts';
import {
  compareReached,
  MAX_TRAVERSAL_DEPTH,
  MAX_TRAVERSAL_REACHED,
  MAX_TRAVERSAL_RELATIONSHIPS,
  parseLanguageTraversal,
  traversalGraphFromDocument,
  TraversalValidationError,
  validateTraversalGraph,
  type TraversalGraph,
  type TraversalReached,
} from './language-traversal.ts';

/**
 * schemagraph impact를 trace의 DB 의존자 순회로 받는 어댑터다.
 *
 * 새 형식은 `language-traversal` v1(`platform: "sql"`, `direction: "dependents"`)이고 그대로
 * 파싱한다. 대체 경로로 schemagraph main의 `schemagraph-impact` v1(`subject` 하나와
 * `impacted[].{id, via, distance, edges, kind}`)을 받아 같은 숲으로 바꾼다. 정점 id는
 * schemagraph VertexId이며 facts의 `relation-decl` `symbol.usr`와 같은 문자열이다.
 */
export function adaptSchemagraphImpact(raw: unknown): TraversalGraph {
  if (isJsonObject(raw) && raw.format === 'language-traversal') {
    const document = parseLanguageTraversal(raw);
    if (document.platform !== 'sql' || document.direction !== 'dependents') {
      fail('Schemagraph traversals must be sql dependents traversals.');
    }
    return traversalGraphFromDocument(document);
  }
  return adaptLegacyImpact(raw);
}

/**
 * `schemagraph-impact` v1을 순회 숲으로 바꾼다.
 *
 * schemagraph는 선택적 키를 계속 더하므로(complete·visited 등) 알려진 키만 읽고 나머지는
 * 무시한다. 단 읽는 키의 타입·그래프 불변식은 fail-closed로 검사한다. root는 subject 하나라
 * root 출처는 항상 완전하다.
 */
function adaptLegacyImpact(raw: unknown): TraversalGraph {
  if (!isJsonObject(raw) || raw.format !== 'schemagraph-impact' || raw.version !== 1) {
    fail('Expected schemagraph-impact version 1 or a sql language-traversal.');
  }
  const subject = isJsonObject(raw.subject) ? raw.subject : fail('Invalid schemagraph impact subject.');
  const subjectId = safe(subject.id, 'Invalid schemagraph impact subject id.');
  if (!Array.isArray(raw.impacted) || raw.impacted.length > MAX_TRAVERSAL_REACHED) {
    fail('Invalid schemagraph impacted vertices.');
  }
  // subject 자신으로 돌아오는 순환은 root 자신만의 도달이라 language-traversal v1처럼 싣지 않는다.
  const reached = raw.impacted.map(parseImpacted).filter(({ symbol }) => symbol.usr !== subjectId).sort(compareReached);
  if (typeof raw.truncated !== 'boolean') fail('Invalid schemagraph impact truncation flag.');
  const truncationReasons = raw.truncationReasons === undefined ? []
    : strings(raw.truncationReasons, 'Invalid schemagraph truncation reasons.');
  const limitations = strings(raw.limitations, 'Invalid schemagraph impact limitations.');
  const roots = [{ id: subjectId, symbol: { usr: subjectId,
    ...(isSafeNonEmptyString(subject.kind) ? { kind: subject.kind } : {}) } }];
  validateTraversalGraph(roots, reached, { rootsTruncated: false, truncated: raw.truncated });
  return {
    source: 'schemagraph-impact', platform: 'sql', direction: 'dependents', roots, reached,
    rootsTruncated: false, rootProvenance: 'complete', truncated: raw.truncated,
    truncationReasons: [...new Set(truncationReasons)].sort(compareStrings), limitations,
  };
}

/** `impacted[]` 항목 하나를 도달 정점으로 바꾼다. `distance`가 depth, `edges`가 관계다. */
function parseImpacted(input: unknown): TraversalReached {
  if (!isJsonObject(input)) fail('Invalid schemagraph impacted vertex.');
  const usr = safe(input.id, 'Invalid schemagraph impacted vertex id.');
  const via = safe(input.via, 'Schemagraph impacted vertices require via; use schemagraph with via support.');
  if (!Number.isSafeInteger(input.distance) || (input.distance as number) < 1 ||
    (input.distance as number) > MAX_TRAVERSAL_DEPTH) {
    fail(`Schemagraph impact distance must be between 1 and ${MAX_TRAVERSAL_DEPTH}.`);
  }
  const edges = input.edges === undefined ? [] : strings(input.edges, 'Invalid schemagraph impacted edges.')
    .filter((edge) => edge.length > 0);
  const relationships = [...new Set(edges)].sort(compareStrings);
  if (relationships.length > MAX_TRAVERSAL_RELATIONSHIPS) fail('Schemagraph impacted edges exceed their limit.');
  return {
    symbol: { usr, ...(isSafeNonEmptyString(input.kind) ? { kind: input.kind } : {}) },
    via,
    depth: input.distance as number,
    roots: [0],
    ...(relationships.length === 0 ? {} : { relationships }),
  };
}

function strings(input: unknown, message: string): string[] {
  if (!Array.isArray(input) || input.length > 50_000 || !input.every((item) => typeof item === 'string')) fail(message);
  return [...input] as string[];
}

function safe(input: unknown, message: string): string {
  if (!isSafeNonEmptyString(input)) fail(message);
  return input;
}

function fail(message: string): never {
  throw new TraversalValidationError(message);
}
