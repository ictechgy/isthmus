import { parseImpactSelection } from './impact-selection.ts';
import type { ImpactSelection } from './impact-selection.ts';
import { createJsonGuards } from './json-guards.ts';
import { isProjectRelativePath } from './parse.ts';
import type { BridgeLocation } from './parse.ts';

/**
 * 옛 역방향 영향 형식(`LanguageImpact`)의 공유 계약이다.
 *
 * preflight context의 `analyses`와, trace가 받는 옛 역방향 형식(kartograph-impact, cartograph change-impact,
 * dartograph impact)의 어댑터 출력이 모두 이 모양이다. 예전에는 preflight-context 안에 있어 trace 쪽 어댑터·
 * language-traversal이 preflight 모듈에 기대었다. 이제 두 명령이 이 모듈을 함께 쓰고, preflight-context는
 * context 수준 규칙(선택 범위, bridge·message 문서, 호출자 binding)만 가진다. 검증은 fail-closed이며 입력 원문을
 * 오류 문구에 넣지 않는다.
 */

/** 영향 분석에서 사용하는, 생산자가 증명한 심볼 식별자다. */
export interface ImpactSymbol {
  readonly id: string;
  readonly qualifiedName: string;
  readonly kind?: string;
  readonly location?: Readonly<{ path: string; line?: number; column?: number }>;
}

/** 한 언어 producer가 한 선택에 대해 관찰한 영향 범위다. */
export interface LanguageImpact {
  readonly id: string;
  readonly platform: 'dart' | 'swift' | 'kotlin';
  readonly tool: Readonly<{ name: string; version: string }>;
  readonly requested: ImpactSelection;
  readonly trigger?: string;
  readonly roots: readonly ImpactSymbol[];
  readonly affected: readonly {
    readonly symbol: ImpactSymbol;
    readonly via: string;
    readonly depth: number;
    readonly relationships: readonly string[];
  }[];
  readonly limitations: readonly string[];
  readonly truncated: boolean;
}

/**
 * 영향 입력(preflight context와 옛 역방향 어댑터)이 계약을 어겼음을 나타내며 원문 데이터를 오류에 넣지 않는다.
 *
 * 공유 모듈로 옮겼지만 클래스 이름은 공개 API(`dist/exchange/preflight-context.js`의 export와 오류 `name`)를
 * 바꾸지 않으려고 유지한다.
 */
export class PreflightValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PreflightValidationError';
  }
}

/** 한 영향 그래프(root + affected)의 항목 상한이자 preflight context 전체 합계 상한이다. */
export const MAX_IMPACT_GRAPH_ITEMS = 50_000;
/** 영향·순회 depth 상한이다. `language-traversal` v1의 depth 상한도 이 값을 쓴다. */
export const MAX_IMPACT_DEPTH = 128;
/** 영향 정점 하나의 관계 문자열 상한이다. `language-traversal` v1의 관계 상한도 이 값을 쓴다. */
export const MAX_IMPACT_RELATIONSHIPS = 32;

/** producer adapter가 만든 분석도 context parser와 같은 그래프 규칙을 사용하게 한다. */
export function validateLanguageImpact(input: unknown): LanguageImpact {
  const value = object(input, 'Language impact must be a JSON object.');
  const id = safe(value.id, 'Invalid language impact id.');
  if (value.platform !== 'dart' && value.platform !== 'swift' && value.platform !== 'kotlin') {
    fail('Unsupported language impact platform.');
  }
  const toolValue = object(value.tool, 'Invalid language impact tool.');
  const tool = {
    name: safe(toolValue.name, 'Invalid language impact tool name.'),
    version: safe(toolValue.version, 'Invalid language impact tool version.'),
  };
  let requested: ImpactSelection;
  try {
    requested = parseImpactSelection({ format: 'isthmus-changes', version: 1, ...object(value.requested, 'Invalid language impact selection.') });
  } catch (error) {
    if (error instanceof PreflightValidationError) throw error;
    fail('Invalid language impact selection.');
  }
  const trigger = value.trigger === undefined
    ? undefined
    : safe(value.trigger, 'Invalid language impact trigger.');
  const roots = array(value.roots, MAX_IMPACT_GRAPH_ITEMS, 'Invalid language impact roots.')
    .map((item) => parseImpactSymbol(item, value.platform === 'kotlin'));
  const affectedRaw = array(value.affected, MAX_IMPACT_GRAPH_ITEMS, 'Invalid language impact affected symbols.');
  const affected = affectedRaw.map((item) => parseAffected(item, value.platform === 'kotlin'));
  const limitations = textStrings(value.limitations, Number.POSITIVE_INFINITY, 'Invalid language impact limitations.');
  if (typeof value.truncated !== 'boolean') fail('Invalid language impact truncation flag.');
  if (roots.length + affected.length > MAX_IMPACT_GRAPH_ITEMS) {
    fail('Language impact graph exceeds its item limit.');
  }
  validateGraph(roots, affected);
  if (trigger !== undefined && (value.platform !== 'dart' || requested.files.length !== 0 ||
    requested.symbols.length !== 1 || requested.symbols[0] !== trigger ||
    !roots.some((root) => root.id === trigger))) {
    fail('Continuation impact must be a Dart analysis rooted at its trigger symbol.');
  }
  return {
    id, platform: value.platform, tool, requested,
    ...(trigger === undefined ? {} : { trigger }), roots, affected, limitations,
    truncated: value.truncated,
  };
}

function parseAffected(input: unknown, partialLocation = false): LanguageImpact['affected'][number] {
  const value = object(input, 'Invalid affected symbol.');
  const symbol = parseImpactSymbol(value.symbol, partialLocation);
  const via = safe(value.via, 'Invalid affected symbol parent.');
  if (!Number.isSafeInteger(value.depth) || (value.depth as number) < 1 || (value.depth as number) > MAX_IMPACT_DEPTH) {
    fail(`Affected symbol depth must be between 1 and ${MAX_IMPACT_DEPTH}.`);
  }
  const relationships = safeStrings(value.relationships, Number.POSITIVE_INFINITY, 'Invalid affected symbol relationships.');
  if (relationships.length > MAX_IMPACT_RELATIONSHIPS) fail('Affected symbol relationships exceed their limit.');
  return { symbol, via, depth: value.depth as number, relationships };
}

function validateGraph(
  roots: readonly ImpactSymbol[], affected: readonly LanguageImpact['affected'][number][],
): void {
  const depths = new Map<string, number>();
  for (const root of roots) {
    if (depths.has(root.id)) fail('Language impact symbol ids must be unique.');
    depths.set(root.id, 0);
  }
  for (const row of affected) {
    if (depths.has(row.symbol.id)) fail('Language impact symbol ids must be unique.');
    depths.set(row.symbol.id, row.depth);
  }
  for (const row of affected) {
    const parentDepth = depths.get(row.via);
    if (parentDepth === undefined || parentDepth + 1 !== row.depth) {
      fail('Affected symbol depth does not match its observed parent.');
    }
  }
}

/**
 * 생산자 심볼을 검증한다. preflight의 호출자 binding도 같은 규칙을 쓴다.
 *
 * @param partialLocation JVM line table처럼 줄·열이 없을 수 있는 Kotlin 위치를 허용할지다.
 */
export function parseImpactSymbol(input: unknown, partialLocation = false): ImpactSymbol {
  const value = object(input, 'Invalid impact symbol.');
  const result: ImpactSymbol = {
    id: safe(value.id, 'Invalid impact symbol id.'),
    qualifiedName: safe(value.qualifiedName, 'Invalid impact symbol qualified name.'),
    ...(value.kind === undefined ? {} : { kind: safe(value.kind, 'Invalid impact symbol kind.') }),
    ...(value.location === undefined ? {} : { location: partialLocation ? parseKotlinLocation(value.location)
      : parseImpactLocation(value.location, 'Invalid impact symbol location.') }),
  };
  return result;
}

/** JVM line tables가 제공하지 않은 좌표를 1로 채워 넣지 않는다. */
function parseKotlinLocation(input: unknown): NonNullable<ImpactSymbol['location']> {
  const value = object(input, 'Invalid Kotlin symbol location.');
  if (!isProjectRelativePath(value.path) ||
    (value.line !== undefined && (!Number.isSafeInteger(value.line) || (value.line as number) < 1)) ||
    (value.column !== undefined && (value.line === undefined || !Number.isSafeInteger(value.column) || (value.column as number) < 1))) {
    fail('Invalid Kotlin symbol location.');
  }
  return { path: value.path, ...(value.line === undefined ? {} : { line: value.line as number }),
    ...(value.column === undefined ? {} : { column: value.column as number }) };
}

/** 줄·열이 모두 있는 프로젝트 상대 위치를 검증한다. 실패 문구는 호출 지점이 정한다. */
export function parseImpactLocation(input: unknown, message: string): BridgeLocation {
  const value = object(input, message);
  if (!isProjectRelativePath(value.path) || !Number.isSafeInteger(value.line) || (value.line as number) < 1 ||
    !Number.isSafeInteger(value.column) || (value.column as number) < 1) fail(message);
  return { path: value.path as string, line: value.line as number, column: value.column as number };
}

function fail(message: string): never {
  throw new PreflightValidationError(message);
}

const { object, array, textStrings, safeStrings, safe } = createJsonGuards(fail);
