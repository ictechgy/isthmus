import { compareStrings } from '../compare.ts';
import { isBridgeTimestamp, isJsonObject, isProjectRelativePath, isSafeNonEmptyString } from './parse.ts';
import type { LanguageImpact } from './preflight-context.ts';

/**
 * `language-traversal` v1 — 생산자가 내는 언어 그래프 순회 결과의 공유 형식이다.
 *
 * 정방향(`dependencies`)과 역방향(`dependents`) 순회를 같은 모양으로 담고, 도달 정점마다
 * 어느 root에서 닿았는지(`roots`)를 보존한다. isthmus trace는 이 숲을 생산자 id 정확 일치로만
 * 잇는다. 정본 계약은 docs/LANGUAGE-TRAVERSAL.md다. 검증은 fail-closed다 — 모르는 필드,
 * 부모 없는 정점, depth 불일치, 정렬 위반을 조용히 고치지 않고 거부한다.
 */

/** 순회 문서를 낼 수 있는 플랫폼이다. openapi는 언어 그래프가 없어 제외한다. */
export type TraversalPlatform = 'dart' | 'swift' | 'kotlin' | 'js' | 'go' | 'rust' | 'python' | 'sql';

/** 순회 방향이다. `dependencies`는 root가 기대는 쪽, `dependents`는 root에 기대는 쪽이다. */
export type TraversalDirection = 'dependencies' | 'dependents';

/**
 * 도달 근거의 등급이다. 간선 집합이 `direct ⊂ bound ⊂ candidate`로 포개진다.
 *
 * - `direct`: 컴파일러·구문이 해석한 간선만으로 닿는다.
 * - `bound`: 주입된 구현의 전체 프로그램 흐름으로 해석한 dispatch 간선을 포함한다(인터페이스 자리로 들어오는
 *   관찰된 흐름이 모두 알려진 프로젝트 구현이다).
 * - `candidate`: 가능성만 있는 구현 간선을 하나 이상 포함한다.
 *
 * 생산자가 dispatch를 해석할수록 경로가 늘어나므로, 소비자가 과장 없이 "확실히 닿는다"와 "닿을 수도 있다"를
 * 구분하게 하려고 둔다.
 */
export type TraversalEvidence = 'direct' | 'bound' | 'candidate';

/** 생산자가 관찰한 소스 위치다. JVM처럼 줄·열이 없을 수 있어 부분 위치를 허용한다. */
export interface TraversalLocation {
  readonly path: string;
  readonly line?: number;
  readonly column?: number;
}

/** 순회 정점의 신원이다. `usr`는 그 생산자의 안정 id이며 bridge-facts의 `symbol.usr`와 같은 문자열이다. */
export interface TraversalSymbol {
  readonly usr: string;
  readonly qualifiedName?: string;
  readonly kind?: string;
  readonly location?: TraversalLocation;
}

/**
 * 순회의 시작점이다. `id`는 생산자 id이고, 심볼 root면 `symbol.usr`가 `id`와 같다.
 * 파일 선택처럼 심볼이 아닌 root나 생산자가 해석하지 못한 요청(`root-not-found:`)은 `symbol`을
 * 생략한다. trace는 `symbol`이 있는 root만 생산자 id로 잇는다.
 */
export interface TraversalRoot {
  readonly id: string;
  readonly symbol?: TraversalSymbol;
  /** root 자신의 나가는 호출 지점 중 생산자가 잇지 못한 수(1 이상, 0이면 생략)다. */
  readonly unresolvedCalls?: number;
}

/** 순회가 도달한 정점 하나다. */
export interface TraversalReached {
  readonly symbol: TraversalSymbol;
  /** 가장 짧은 경로 하나의 직전 정점(도달 정점의 usr 또는 root id)이다. */
  readonly via: string;
  /** 가장 가까운 root까지의 간선 수다(root는 0). */
  readonly depth: number;
  /**
   * 이 정점에 닿는 모든 root의 인덱스(오름차순)다. 64개를 넘으면 가장 작은 인덱스 64개만 싣고
   * 문서에 `rootsTruncated: true`를 단다.
   */
  readonly roots: readonly number[];
  readonly relationships?: readonly string[];
  /**
   * 나열된 root 각각에서 이 정점에 닿는 가장 강한 등급 중 가장 약한 것이다(root마다 성립하는 하한).
   * depth·via·roots는 여전히 허용된 전체 그래프 기준이다. 없으면 문서 수준 규칙(`reachedEvidence`)을 따른다.
   */
  readonly evidence?: TraversalEvidence;
  /** 이 정점 자신의 나가는 호출 지점 중 생산자가 잇지 못한 수(1 이상, 0이면 생략)다. */
  readonly unresolvedCalls?: number;
}

/** 검증된 `language-traversal` v1 문서다. */
export interface LanguageTraversal {
  readonly format: 'language-traversal';
  readonly version: 1;
  readonly tool: Readonly<{ name: string; version: string }>;
  readonly generatedAt: string;
  readonly platform: TraversalPlatform;
  readonly project: string;
  readonly revision?: string;
  readonly graphRevision?: string;
  /**
   * 생산자가 정한 dispatch 해석 방식 표식(tsograph는 `direct`·`bound`·`candidates`)이다. isthmus는 값을
   * 해석하지 않지만, 이 필드가 있으면 문서가 근거 등급을 분류하고 잇지 못한 호출을 신고한다는 선언이다.
   */
  readonly dispatch?: string;
  readonly direction: TraversalDirection;
  readonly roots: readonly TraversalRoot[];
  readonly reached: readonly TraversalReached[];
  readonly rootsTruncated?: boolean;
  readonly truncated: boolean;
  readonly truncationReasons?: readonly string[];
  readonly limitations: readonly string[];
}

/**
 * 형식과 무관하게 trace가 소비하는 정규화된 순회 숲이다.
 *
 * `rootProvenance`가 `witness`면 어댑터가 root 출처를 via 사슬의 대표 root 하나로만 복원했다는
 * 뜻이다(옛 역방향 형식은 정점별 root 목록이 없다). 이때 root가 둘 이상이면 다른 root의 도달은
 * 빠질 수 있으므로 소비자가 gap으로 밝혀야 한다.
 */
export interface TraversalGraph {
  readonly source: TraversalSource;
  readonly platform: TraversalPlatform;
  readonly direction: TraversalDirection;
  readonly tool?: Readonly<{ name: string; version: string }>;
  readonly revision?: string;
  readonly graphRevision?: string;
  readonly dispatch?: string;
  readonly roots: readonly TraversalRoot[];
  readonly reached: readonly TraversalReached[];
  readonly rootsTruncated: boolean;
  readonly rootProvenance: 'complete' | 'witness';
  /**
   * 문서가 근거 등급을 분류하는지다(`dispatch`가 있거나 `evidence`를 실은 정점이 하나라도 있다).
   * 참이면 `evidence`가 없는 정점은 `direct`다. 거짓이면 생산자가 분류하지 않았다는 뜻이다.
   */
  readonly evidenceReported: boolean;
  /**
   * 문서가 잇지 못한 호출 수를 신고하는지다(`dispatch`가 있거나 `unresolvedCalls`를 실은 root·정점이 하나라도
   * 있다). 참이면 없는 값은 0이다. 거짓이면 0인지 모르는 것이므로 소비자가 완전성을 주장하면 안 된다.
   */
  readonly unresolvedCallsReported: boolean;
  readonly truncated: boolean;
  readonly truncationReasons: readonly string[];
  readonly limitations: readonly string[];
}

/** 정규화 전 원본 형식이다. 출력의 분석 메타데이터에 실어 출처를 밝힌다. */
export type TraversalSource =
  | 'language-traversal' | 'kartograph-impact' | 'change-impact' | 'dartograph-impact' | 'schemagraph-impact';

/** 순회 입력이 계약을 어겼음을 나타낸다. 입력 원문을 메시지에 넣지 않는다. */
export class TraversalValidationError extends Error {
  /** 입력 내용을 노출하지 않는 고정 문구만 보존한다. */
  constructor(message: string) {
    super(message);
    this.name = 'TraversalValidationError';
  }
}

/** 한 문서의 root 상한이다. */
export const MAX_TRAVERSAL_ROOTS = 10_000;
/** 한 문서의 도달 정점 상한이다. */
export const MAX_TRAVERSAL_REACHED = 100_000;
/** depth 상한이다. preflight의 producer depth 상한과 같다. */
export const MAX_TRAVERSAL_DEPTH = 128;
/** 정점 하나가 싣는 root 인덱스 상한이다. 넘으면 64개만 싣고 `rootsTruncated`다. */
export const MAX_ROOTS_PER_REACHED = 64;
/** 정점 하나의 관계 문자열 상한이다. */
export const MAX_TRAVERSAL_RELATIONSHIPS = 32;
/** 정점 하나가 신고하는 잇지 못한 호출 수 상한이다. 한 함수의 호출 지점이 이보다 많을 수 없다고 본다. */
export const MAX_UNRESOLVED_CALLS = 1_000_000;

const platforms = new Set<string>(['dart', 'swift', 'kotlin', 'js', 'go', 'rust', 'python', 'sql']);
const topKeys = new Set(['format', 'version', 'tool', 'generatedAt', 'platform', 'project', 'revision',
  'graphRevision', 'dispatch', 'direction', 'roots', 'reached', 'rootsTruncated', 'truncated', 'truncationReasons',
  'limitations']);
const rootKeys = new Set(['id', 'symbol', 'unresolvedCalls']);
const reachedKeys = new Set(['symbol', 'via', 'depth', 'roots', 'relationships', 'evidence', 'unresolvedCalls']);
const evidenceTiers = new Set<string>(['direct', 'bound', 'candidate']);
const symbolKeys = new Set(['usr', 'qualifiedName', 'kind', 'location']);

/** 값이 순회 플랫폼인지 확인한다. */
export function isTraversalPlatform(value: unknown): value is TraversalPlatform {
  return typeof value === 'string' && platforms.has(value);
}

/** 신뢰하지 않는 JSON을 검증된 `language-traversal` v1 문서로 바꾼다. */
export function parseLanguageTraversal(input: unknown): LanguageTraversal {
  const value = object(input, 'Language traversal must be a JSON object.');
  if (value.format !== 'language-traversal' || value.version !== 1) {
    fail('Expected language-traversal version 1.');
  }
  onlyKeys(value, topKeys, 'Language traversal has an unknown field.');
  const toolValue = object(value.tool, 'Invalid language traversal tool.');
  onlyKeys(toolValue, new Set(['name', 'version']), 'Invalid language traversal tool.');
  const tool = { name: safe(toolValue.name, 'Invalid language traversal tool name.'),
    version: safe(toolValue.version, 'Invalid language traversal tool version.') };
  if (!isBridgeTimestamp(value.generatedAt)) fail('Invalid language traversal generatedAt.');
  if (!isTraversalPlatform(value.platform)) fail('Unsupported language traversal platform.');
  const project = safe(value.project, 'Invalid language traversal project.');
  const revision = optionalSafe(value.revision, 'Invalid language traversal revision.');
  const graphRevision = optionalSafe(value.graphRevision, 'Invalid language traversal graphRevision.');
  const dispatch = optionalSafe(value.dispatch, 'Invalid language traversal dispatch label.');
  if (value.direction !== 'dependencies' && value.direction !== 'dependents') {
    fail('Invalid language traversal direction.');
  }
  if (value.rootsTruncated !== undefined && typeof value.rootsTruncated !== 'boolean') {
    fail('Invalid language traversal rootsTruncated flag.');
  }
  if (typeof value.truncated !== 'boolean') fail('Invalid language traversal truncation flag.');
  const truncationReasons = value.truncationReasons === undefined ? undefined
    : sortedUniqueStrings(value.truncationReasons, 1_000, 'Invalid language traversal truncation reasons.');
  if (!value.truncated && (truncationReasons?.length ?? 0) > 0) {
    fail('Truncation reasons require truncated: true.');
  }
  const limitations = textStrings(value.limitations, 'Invalid language traversal limitations.');
  const roots = array(value.roots, MAX_TRAVERSAL_ROOTS, 'Invalid language traversal roots.').map(parseRoot);
  const reached = array(value.reached, MAX_TRAVERSAL_REACHED, 'Invalid language traversal reached symbols.')
    .map(parseReached);
  requireSortedReached(reached);
  validateTraversalGraph(roots, reached, { rootsTruncated: value.rootsTruncated === true, truncated: value.truncated });
  return {
    format: 'language-traversal', version: 1, tool, generatedAt: value.generatedAt, platform: value.platform, project,
    ...(revision === undefined ? {} : { revision }), ...(graphRevision === undefined ? {} : { graphRevision }),
    ...(dispatch === undefined ? {} : { dispatch }), direction: value.direction, roots, reached,
    ...(value.rootsTruncated === undefined ? {} : { rootsTruncated: value.rootsTruncated }),
    truncated: value.truncated, ...(truncationReasons === undefined ? {} : { truncationReasons }), limitations,
  };
}

/** 검증된 문서를 형식 무관 순회 숲으로 바꾼다. */
export function traversalGraphFromDocument(document: LanguageTraversal): TraversalGraph {
  return {
    source: 'language-traversal', platform: document.platform, direction: document.direction, tool: document.tool,
    ...(document.revision === undefined ? {} : { revision: document.revision }),
    ...(document.graphRevision === undefined ? {} : { graphRevision: document.graphRevision }),
    ...(document.dispatch === undefined ? {} : { dispatch: document.dispatch }),
    roots: document.roots, reached: document.reached, rootsTruncated: document.rootsTruncated === true,
    rootProvenance: 'complete',
    evidenceReported: document.dispatch !== undefined || document.reached.some(({ evidence }) => evidence !== undefined),
    unresolvedCallsReported: document.dispatch !== undefined ||
      [...document.roots, ...document.reached].some(({ unresolvedCalls }) => unresolvedCalls !== undefined),
    truncated: document.truncated,
    truncationReasons: document.truncationReasons ?? [], limitations: document.limitations,
  };
}

/**
 * preflight 어댑터가 만든 역방향 영향(kartograph·cartograph·dartograph)을 순회 숲으로 바꾼다.
 *
 * 옛 형식은 정점별 root 목록이 없어 via 사슬의 대표 root 하나만 복원한다. root가 둘 이상이면
 * `rootProvenance: "witness"`로 표시해 소비자가 부분 귀속을 gap으로 밝히게 한다. 새 id를 만들지 않는다.
 */
export function traversalGraphFromImpact(impact: LanguageImpact, source: TraversalSource): TraversalGraph {
  const roots = [...impact.roots].sort((left, right) => compareStrings(left.id, right.id)).map((root) => ({
    id: root.id,
    symbol: symbolFromImpact(root),
  }));
  const rootIndex = new Map(roots.map(({ id }, index) => [id, index]));
  const parents = new Map(impact.affected.map((row) => [row.symbol.id, row.via]));
  const reached = impact.affected.map((row): TraversalReached => ({
    symbol: symbolFromImpact(row.symbol),
    via: row.via,
    depth: row.depth,
    roots: [witnessRoot(row.symbol.id, parents, rootIndex)],
    ...(row.relationships.length === 0 ? {} : { relationships: [...new Set(row.relationships)].sort(compareStrings) }),
  })).sort(compareReached);
  validateTraversalGraph(roots, reached, { rootsTruncated: false, truncated: impact.truncated });
  return {
    source, platform: impact.platform, direction: 'dependents', roots, reached, rootsTruncated: false,
    rootProvenance: roots.length > 1 ? 'witness' : 'complete',
    // 옛 역방향 형식은 근거 등급과 잇지 못한 호출을 신고하지 않는다. 없음을 0·direct로 읽지 않는다.
    evidenceReported: false, unresolvedCallsReported: false, truncated: impact.truncated,
    truncationReasons: [], limitations: impact.limitations,
  };
}

/**
 * root·도달 정점의 그래프 불변식을 검사한다. 파서와 어댑터가 같은 규칙을 쓴다.
 *
 * - root id와 도달 usr는 각각 유일하다. 다른 root에서 닿은 root도 도달 정점으로 싣는다 — 이때
 *   `roots`에는 자기 인덱스를 넣지 않는다(자기 자신에서만 닿는 순환 root는 싣지 않는다).
 * - `via`는 root id거나 다른 도달 정점이다. via가 root id면 depth는 1이고 그 root 인덱스를
 *   포함한다(`rootsTruncated` 문서에서 64개로 잘린 목록은 큰 인덱스가 빠질 수 있어 예외). 그 밖에는 부모 depth + 1이다.
 *   단 root 항목은 depth가 기준이고 via는 그 root를 거쳐 돌아올 수 있는 목격이라 depth 관계를 보지 않는다.
 * - `roots`는 비어 있지 않은 오름차순 인덱스이고 64개 이하다.
 * - 잘리지 않은 순회(`truncated`·`rootsTruncated` 모두 거짓)에서는 부모에 닿는 root(부모가 root면
 *   그 root와, 그 root가 다른 root에서 닿았다면 그 root들)가 자기 자신을 빼고 모두 자식에 포함된다.
 * - 다른 root에서 닿은 root 항목의 `unresolvedCalls`는 같은 정점의 `roots[]` 항목 값과 같다(둘 다 없거나 같은 수).
 *   근거 등급의 via 관계는 검사하지 않는다 — via는 전체 그래프 기준 최단 경로의 목격이고 간선 등급을 싣지 않으므로
 *   등급별 경로가 via 사슬과 다를 수 있다(생산자 보장으로 문서화한다).
 */
export function validateTraversalGraph(
  roots: readonly TraversalRoot[],
  reached: readonly TraversalReached[],
  flags: Readonly<{ rootsTruncated: boolean; truncated: boolean }>,
): void {
  const rootIndex = new Map<string, number>();
  roots.forEach(({ id }, index) => {
    if (rootIndex.has(id)) fail('Traversal root ids must be unique.');
    rootIndex.set(id, index);
  });
  const rows = new Map<string, TraversalReached>();
  for (const row of reached) {
    if (rows.has(row.symbol.usr)) fail('Traversal symbol ids must be unique.');
    rows.set(row.symbol.usr, row);
  }
  const checkSubset = !flags.truncated && !flags.rootsTruncated;
  for (const row of reached) {
    if (row.roots.length === 0 || row.roots.length > MAX_ROOTS_PER_REACHED ||
      row.roots.some((index, position) => !Number.isSafeInteger(index) || index < 0 || index >= roots.length ||
        (position > 0 && index <= row.roots[position - 1]!))) {
      fail('Traversal root indices must be sorted, unique and in range.');
    }
    const own = rootIndex.get(row.symbol.usr);
    if (own !== undefined && row.roots.includes(own)) fail('A reached root must not list its own root index.');
    if (own !== undefined && row.unresolvedCalls !== roots[own]!.unresolvedCalls) {
      fail('A reached root must report the same unresolvedCalls as its root entry.');
    }
    if (row.via === row.symbol.usr) fail('Traversal via must differ from the reached symbol.');
    const viaRoot = rootIndex.get(row.via);
    let inherited: readonly number[];
    if (viaRoot !== undefined) {
      const capped = flags.rootsTruncated && row.roots.length === MAX_ROOTS_PER_REACHED &&
        viaRoot > row.roots[row.roots.length - 1]!;
      if (row.depth !== 1 || (!row.roots.includes(viaRoot) && !capped)) {
        fail('Traversal depth or roots do not match the via root.');
      }
      inherited = [viaRoot, ...(rows.get(row.via)?.roots ?? [])];
    } else {
      const parent = rows.get(row.via);
      // root 항목의 depth는 다른 root 기준이고 부모의 depth는 모든 root(이 root 포함) 기준이다. 부모에
      // 닿는 가장 짧은 경로가 이 root를 거치면(순환) depth 관계가 성립하지 않으므로 root 항목은 보지 않는다.
      if (parent === undefined || (own === undefined && parent.depth + 1 !== row.depth)) {
        fail('Traversal depth does not match its observed parent.');
      }
      inherited = parent.roots;
    }
    if (checkSubset && inherited.some((index) => index !== own && !row.roots.includes(index))) {
      fail('Traversal roots must include every root of the parent.');
    }
  }
}

/**
 * 도달 정점의 대표 경로(root부터 그 정점까지의 id)를 복원한다.
 *
 * 경로는 생산자가 준 `via` 목격만 따른다. 여러 root가 닿는 정점이면 첫 원소가 호출자가 묻는
 * root와 다를 수 있다 — 대표 경로는 가장 가까운 root 하나의 것이다.
 */
export function traversalPath(graph: TraversalGraph, usr: string): string[] {
  return traversalWitness(graph, usr).path;
}

/**
 * 대표 경로와 그 경로가 온전한지다.
 *
 * via가 root id면 거기서 멈춘다(그 root가 다른 root에서도 닿았더라도 목격 경로는 그 root에서 시작한다).
 * root 항목의 via 사슬은 그 root 자신으로 돌아올 수 있다(순환). 이때 돌아오기 직전까지의 경로만
 * 돌려주고 `partial: true`로 표시한다 — 다른 root에서 시작하는 경로를 지어내지 않는다.
 */
export function traversalWitness(graph: TraversalGraph, usr: string): { path: string[]; partial: boolean } {
  const rows = rowIndex(graph);
  const rootIds = rootIdSet(graph);
  const path = [usr];
  const seen = new Set(path);
  let current = rows.get(usr);
  while (current !== undefined) {
    if (seen.has(current.via)) return { path: path.reverse(), partial: true };
    path.push(current.via);
    seen.add(current.via);
    current = rootIds.has(current.via) ? undefined : rows.get(current.via);
  }
  return { path: path.reverse(), partial: false };
}

/** 순회 숲의 root id 집합을 한 번만 만든다. */
const rootIdSets = new WeakMap<TraversalGraph, Set<string>>();

/** root id 집합이다. */
function rootIdSet(graph: TraversalGraph): Set<string> {
  let ids = rootIdSets.get(graph);
  if (ids === undefined) {
    ids = new Set(graph.roots.map(({ id }) => id));
    rootIdSets.set(graph, ids);
  }
  return ids;
}

/** 순회 숲의 usr별 도달 정점 색인을 한 번만 만든다. */
const rowIndexes = new WeakMap<TraversalGraph, Map<string, TraversalReached>>();

/** usr별 도달 정점 색인이다. */
export function rowIndex(graph: TraversalGraph): Map<string, TraversalReached> {
  let index = rowIndexes.get(graph);
  if (index === undefined) {
    index = new Map(graph.reached.map((row) => [row.symbol.usr, row]));
    rowIndexes.set(graph, index);
  }
  return index;
}

/** 소비자가 보는 정점의 근거 등급이다. 생산자가 분류하지 않은 언어 그래프는 `unassessed`다. */
export type TraversalEvidenceQuality = TraversalEvidence | 'unassessed';

/**
 * 정점의 유효 근거 등급이다.
 *
 * - 정점이 `evidence`를 실으면 그 값이다.
 * - 문서가 등급을 분류하면(`evidenceReported`) 없는 값은 `direct`다.
 * - sql(schemagraph) 순회는 FK·뷰 정의처럼 스키마에 선언된 간선만 있으므로 없는 값을 `direct`로 본다.
 * - 그 밖(옛 역방향 어댑터, 분류하지 않는 생산자)은 `unassessed`다 — 가능성 간선이 섞였는지 모르므로
 *   `direct`로 부풀리지 않는다.
 */
export function reachedEvidence(graph: TraversalGraph, row: TraversalReached): TraversalEvidenceQuality {
  if (row.evidence !== undefined) return row.evidence;
  return graph.evidenceReported || graph.platform === 'sql' ? 'direct' : 'unassessed';
}

/** 결정적 도달 정점 순서다: depth, 그다음 usr. */
export function compareReached(left: TraversalReached, right: TraversalReached): number {
  return left.depth - right.depth || compareStrings(left.symbol.usr, right.symbol.usr);
}

/** 어댑터가 복원한 via 사슬의 대표 root 인덱스다. 검증이 사슬 무결성을 다시 확인한다. */
function witnessRoot(id: string, parents: ReadonlyMap<string, string>, rootIndex: ReadonlyMap<string, number>): number {
  let current = id;
  for (let step = 0; step <= MAX_TRAVERSAL_DEPTH; step++) {
    const index = rootIndex.get(current);
    if (index !== undefined) return index;
    const parent = parents.get(current);
    if (parent === undefined) break;
    current = parent;
  }
  return fail('Traversal via chain does not reach a root.');
}

/** preflight 심볼을 순회 심볼로 옮긴다. 이름·종류·위치는 있는 것만 복사한다. */
function symbolFromImpact(symbol: LanguageImpact['roots'][number]): TraversalSymbol {
  return {
    usr: symbol.id,
    qualifiedName: symbol.qualifiedName,
    ...(symbol.kind === undefined ? {} : { kind: symbol.kind }),
    ...(symbol.location === undefined ? {} : { location: symbol.location }),
  };
}

/** root 항목을 검증한다. 심볼 root면 usr가 id와 같아야 한다. */
function parseRoot(input: unknown): TraversalRoot {
  const value = object(input, 'Invalid traversal root.');
  onlyKeys(value, rootKeys, 'Traversal root has an unknown field.');
  const id = safe(value.id, 'Invalid traversal root id.');
  const unresolvedCalls = optionalUnresolvedCalls(value.unresolvedCalls);
  const extra = unresolvedCalls === undefined ? {} : { unresolvedCalls };
  if (value.symbol === undefined) return { id, ...extra };
  const symbol = parseTraversalSymbol(value.symbol);
  if (symbol.usr !== id) fail('Traversal root symbol usr must equal the root id.');
  return { id, symbol, ...extra };
}

/** 도달 정점 항목을 검증한다. 그래프 불변식은 `validateTraversalGraph`가 본다. */
function parseReached(input: unknown): TraversalReached {
  const value = object(input, 'Invalid traversal reached symbol.');
  onlyKeys(value, reachedKeys, 'Traversal reached symbol has an unknown field.');
  const symbol = parseTraversalSymbol(value.symbol);
  const via = safe(value.via, 'Invalid traversal via.');
  if (!Number.isSafeInteger(value.depth) || (value.depth as number) < 1 || (value.depth as number) > MAX_TRAVERSAL_DEPTH) {
    fail(`Traversal depth must be between 1 and ${MAX_TRAVERSAL_DEPTH}.`);
  }
  const roots = array(value.roots, MAX_ROOTS_PER_REACHED, 'Invalid traversal root indices.') as number[];
  const relationships = value.relationships === undefined ? undefined
    : sortedUniqueStrings(value.relationships, MAX_TRAVERSAL_RELATIONSHIPS, 'Invalid traversal relationships.');
  if (value.evidence !== undefined && (typeof value.evidence !== 'string' || !evidenceTiers.has(value.evidence))) {
    fail('Traversal evidence must be direct, bound or candidate.');
  }
  const unresolvedCalls = optionalUnresolvedCalls(value.unresolvedCalls);
  return { symbol, via, depth: value.depth as number, roots: [...roots],
    ...(relationships === undefined ? {} : { relationships }),
    ...(value.evidence === undefined ? {} : { evidence: value.evidence as TraversalEvidence }),
    ...(unresolvedCalls === undefined ? {} : { unresolvedCalls }) };
}

/** 잇지 못한 호출 수를 검증한다. 0은 생략해야 하므로 거부한다(없음과 0을 두 모양으로 쓰지 않는다). */
function optionalUnresolvedCalls(input: unknown): number | undefined {
  if (input === undefined) return undefined;
  if (!Number.isSafeInteger(input) || (input as number) < 1 || (input as number) > MAX_UNRESOLVED_CALLS) {
    fail(`Traversal unresolvedCalls must be an integer between 1 and ${MAX_UNRESOLVED_CALLS}; omit it when zero.`);
  }
  return input as number;
}

/** 순회 심볼을 검증한다. */
export function parseTraversalSymbol(input: unknown): TraversalSymbol {
  const value = object(input, 'Invalid traversal symbol.');
  onlyKeys(value, symbolKeys, 'Traversal symbol has an unknown field.');
  const usr = safe(value.usr, 'Invalid traversal symbol usr.');
  const qualifiedName = optionalSafe(value.qualifiedName, 'Invalid traversal symbol qualified name.');
  const kind = optionalSafe(value.kind, 'Invalid traversal symbol kind.');
  const location = value.location === undefined ? undefined : parseTraversalLocation(value.location);
  return { usr, ...(qualifiedName === undefined ? {} : { qualifiedName }), ...(kind === undefined ? {} : { kind }),
    ...(location === undefined ? {} : { location }) };
}

/** 프로젝트 상대 부분 위치를 검증한다. 열은 줄이 있을 때만 올 수 있다. */
function parseTraversalLocation(input: unknown): TraversalLocation {
  const value = object(input, 'Invalid traversal symbol location.');
  onlyKeys(value, new Set(['path', 'line', 'column']), 'Invalid traversal symbol location.');
  if (!isProjectRelativePath(value.path) || (value.line !== undefined && !positive(value.line)) ||
    (value.column !== undefined && (value.line === undefined || !positive(value.column)))) {
    fail('Invalid traversal symbol location.');
  }
  return { path: value.path, ...(value.line === undefined ? {} : { line: value.line as number }),
    ...(value.column === undefined ? {} : { column: value.column as number }) };
}

/** 도달 정점이 (depth, usr) 엄격한 오름차순인지 검사한다. */
function requireSortedReached(reached: readonly TraversalReached[]): void {
  for (let index = 1; index < reached.length; index++) {
    if (compareReached(reached[index - 1]!, reached[index]!) >= 0) {
      fail('Traversal reached symbols must be sorted by depth, then usr.');
    }
  }
}

function positive(value: unknown): boolean {
  return Number.isSafeInteger(value) && (value as number) >= 1;
}

function onlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, message: string): void {
  if (Object.keys(value).some((key) => !allowed.has(key))) fail(message);
}

function object(input: unknown, message: string): Record<string, unknown> {
  if (!isJsonObject(input)) fail(message);
  return input;
}

function array(input: unknown, maximum: number, message: string): unknown[] {
  if (!Array.isArray(input) || input.length > maximum) fail(message);
  return input;
}

function sortedUniqueStrings(input: unknown, maximum: number, message: string): string[] {
  const values = array(input, maximum, message);
  if (!values.every(isSafeNonEmptyString) ||
    values.some((item, index) => index > 0 && compareStrings(values[index - 1] as string, item) >= 0)) fail(message);
  return [...values] as string[];
}

function textStrings(input: unknown, message: string): string[] {
  const values = array(input, 50_000, message);
  if (!values.every((item) => typeof item === 'string')) fail(message);
  return [...values] as string[];
}

function safe(input: unknown, message: string): string {
  if (!isSafeNonEmptyString(input)) fail(message);
  return input;
}

function optionalSafe(input: unknown, message: string): string | undefined {
  return input === undefined ? undefined : safe(input, message);
}

function fail(message: string): never {
  throw new TraversalValidationError(message);
}
