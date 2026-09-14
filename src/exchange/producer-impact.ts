import { isProjectRelativePath, isSafeNonEmptyString } from './parse.ts';
import { parseImpactSelection } from './impact-selection.ts';
import type { ImpactSelection } from './impact-selection.ts';
import {
  validateLanguageImpact,
  PreflightValidationError,
  type ImpactSymbol,
  type LanguageImpact,
} from './preflight-context.ts';
import type { BridgeLocation } from './parse.ts';

/** producer 영향 문서에 주입할 isthmus 실행 문맥이다. */
export interface ProducerImpactMetadata {
  readonly id: string;
  readonly project: string;
  readonly requested: ImpactSelection;
  readonly tool: Readonly<{ name: string; version: string }>;
  readonly trigger?: string;
}

/** Cartograph `change-impact` v1을 isthmus 공통 영향 형식으로 투영한다. */
export function adaptCartographImpact(raw: unknown, metadata: ProducerImpactMetadata): LanguageImpact {
  const value = object(raw, 'Cartograph impact must be a JSON object.');
  if (value.format !== 'change-impact' || value.version !== 1 || value.level !== 'symbol') {
    fail('Expected Cartograph change-impact version 1 at symbol level.');
  }
  const context = normalizeMetadata(metadata, 'swift');
  const limitations = textStrings(value.limitations, 'Invalid Cartograph limitations.');
  for (const [field, code] of [['selectionIssues', 'selection-issues'], ['runtimeReview', 'runtime-review'],
    ['runtimeDependencies', 'runtime-dependencies']] as const) {
    if (value[field] === undefined) continue;
    const rows = rawArray(value[field], `Invalid Cartograph ${field}.`);
    if (rows.length > 0) limitations.push(`cartograph-${code}: ${rows.length} item(s) require review in the producer report`);
  }
  let outsideLocations = 0;
  const roots = rawArray(value.changeScope, 'Invalid Cartograph change scope.').map((item) => {
    const parsed = parseCartographSymbol(item, context.project, () => outsideLocations++);
    return parsed;
  });
  const affected = rawArray(value.affected, 'Invalid Cartograph affected symbols.').map((item) => {
    const row = object(item, 'Invalid Cartograph affected symbol.');
    const symbol = parseCartographSymbol(row.symbol, context.project, () => outsideLocations++);
    const via = safe(row.via, 'Invalid Cartograph affected parent.');
    const depth = positiveDepth(row.depth);
    const relationship = safe(row.relationship, 'Invalid Cartograph relationship.');
    const edges = row.edges === undefined ? [] : rawStrings(row.edges, 'Invalid Cartograph edges.');
    const relationships = [...new Set([relationship, ...edges])];
    if (relationships.length > 32) fail('Cartograph relationships exceed their limit.');
    return { symbol, via, depth, relationships };
  });
  if (outsideLocations > 0) {
    limitations.push(`cartograph-location-outside-project: ${outsideLocations} symbol location(s) omitted`);
  }
  const result = {
    ...context,
    roots,
    affected,
    limitations,
    truncated: truncation(value.truncated),
  } satisfies LanguageImpact;
  return validateLanguageImpact(result);
}

/** Dartograph `_document` v1을 isthmus 공통 영향 형식으로 투영한다. */
export function adaptDartographImpact(raw: unknown, metadata: ProducerImpactMetadata): LanguageImpact {
  const value = object(raw, 'Dartograph impact must be a JSON object.');
  if (value.version !== 1) fail('Expected Dartograph impact version 1.');
  const context = normalizeMetadata(metadata, 'dart');
  const changed = object(value.changed, 'Invalid Dartograph changed scope.');
  const changedSymbols = rawStrings(changed.symbols, 'Invalid Dartograph changed symbols.');
  const changedLibraries = changed.libraries === undefined ? [] : rawStrings(changed.libraries, 'Invalid Dartograph changed libraries.');
  if (changed.sources !== undefined) {
    rawStrings(changed.sources, 'Invalid Dartograph changed sources.').forEach(dartSource);
  }
  const roots: ImpactSymbol[] = [
    ...changedLibraries.map((id) => ({ id, qualifiedName: id, kind: 'library' })),
    ...changedSymbols.map((id) => ({ id, qualifiedName: id, kind: 'declaration' })),
  ];
  const rootIds = new Set(roots.map(({ id }) => id));
  const impacted = rawArray(value.impacted, 'Invalid Dartograph impacted symbols.');
  const rows = impacted.map((item) => {
    const row = object(item, 'Invalid Dartograph impacted symbol.');
    const id = safe(row.id, 'Invalid Dartograph impacted symbol id.');
    const depth = positiveDepth(row.depth);
    const path = rawStrings(row.path, 'Invalid Dartograph impact path.');
    if (path.length !== depth + 1 || path[0] !== id || !rootIds.has(path[path.length - 1]!) ||
      new Set(path).size !== path.length) {
      fail('Dartograph impact path is not a complete parent-safe path.');
    }
    const location = dartLocation(row);
    if (row.source !== undefined) dartSource(row.source);
    return {
      symbol: { id, qualifiedName: id, ...(location === undefined ? {} : { location }),
        ...(row.kind === undefined ? {} : { kind: safe(row.kind, 'Invalid Dartograph impacted kind.') }) },
      via: path[1] as string,
      depth,
      relationships: [],
      path,
    };
  });
  const known = new Set([...roots.map((root) => root.id), ...rows.map((row) => row.symbol.id)]);
  for (const row of rows) {
    if (row.path.some((id) => !known.has(id))) fail('Dartograph impact path contains an omitted intermediate symbol.');
  }
  const limitations = textStrings(value.limitations, 'Invalid Dartograph limitations.');
  const missing = value.missingSymbols === undefined ? [] : rawStrings(value.missingSymbols, 'Invalid Dartograph missing symbols.');
  const unattributed = changed.unattributedSources === undefined ? [] : rawStrings(changed.unattributedSources, 'Invalid Dartograph unattributed sources.');
  unattributed.forEach(dartSource);
  if (missing.length > 0) limitations.push(`dartograph-missing-symbols: ${missing.length} requested symbol(s) were not found`);
  if (unattributed.length > 0) limitations.push(`dartograph-unattributed-sources: ${unattributed.length} changed source(s) could not be attributed`);
  const result: LanguageImpact = {
    ...context,
    roots,
    affected: rows.map(({ path: _path, ...row }) => row),
    limitations,
    truncated: dartTruncation(value.truncated),
  };
  return validateLanguageImpact(result);
}

type AdapterContext = {
  readonly id: string;
  readonly project: string;
  readonly requested: ImpactSelection;
  readonly tool: Readonly<{ name: string; version: string }>;
  readonly trigger?: string;
  readonly platform: 'dart' | 'swift';
};

function normalizeMetadata(metadata: ProducerImpactMetadata, platform: 'dart' | 'swift'): AdapterContext {
  const id = safe(metadata.id, 'Invalid producer impact id.');
  const project = safe(metadata.project, 'Invalid producer impact project.');
  const tool = {
    name: safe(metadata.tool?.name, 'Invalid producer impact tool name.'),
    version: safe(metadata.tool?.version, 'Invalid producer impact tool version.'),
  };
  let requested: ImpactSelection;
  try {
    requested = parseImpactSelection({ format: 'isthmus-changes', version: 1, ...metadata.requested });
  } catch {
    fail('Invalid producer impact selection.');
  }
  return { id, project, requested, tool, ...(metadata.trigger === undefined ? {} : { trigger: safe(metadata.trigger, 'Invalid producer impact trigger.') }), platform };
}

function parseCartographSymbol(input: unknown, project: string, outside: () => void): ImpactSymbol {
  const value = object(input, 'Invalid Cartograph symbol.');
  const id = safe(value.usr, 'Cartograph symbols require a stable usr identity.');
  const qualifiedName = safe(value.qualifiedName, 'Invalid Cartograph symbol qualified name.');
  const kind = value.kind === undefined ? undefined : safe(value.kind, 'Invalid Cartograph symbol kind.');
  const rawLocation = value.location;
  if (rawLocation === undefined || rawLocation === null) return { id, qualifiedName, ...(kind === undefined ? {} : { kind }) };
  const location = rebaseLocation(rawLocation, project, outside);
  return location === undefined ? { id, qualifiedName, ...(kind === undefined ? {} : { kind }) } : { id, qualifiedName, ...(kind === undefined ? {} : { kind }), location };
}

function rebaseLocation(input: unknown, project: string, outside: () => void): BridgeLocation | undefined {
  const value = object(input, 'Invalid Cartograph symbol location.');
  const path = safe(value.path, 'Invalid Cartograph symbol location path.');
  if (!Number.isSafeInteger(value.line) || (value.line as number) < 1 ||
    !Number.isSafeInteger(value.column) || (value.column as number) < 1) {
    fail('Invalid Cartograph symbol location coordinates.');
  }
  if (!path.startsWith('/')) fail('Cartograph symbol locations must be absolute paths.');
  const root = project === '/' ? '/' : project.replace(/\/+$/u, '');
  if (path === root) {
    outside();
    return undefined;
  }
  const prefix = root === '/' ? '/' : `${root}/`;
  if (!path.startsWith(prefix)) {
    outside();
    return undefined;
  }
  const relative = path.slice(prefix.length);
  if (!isProjectRelativePath(relative)) fail('Invalid rebased Cartograph symbol location.');
  return { path: relative, line: value.line as number, column: value.column as number };
}

function dartLocation(value: Record<string, unknown>): BridgeLocation | undefined {
  if (value.line === undefined && value.column === undefined) return undefined;
  if (!Number.isSafeInteger(value.line) || (value.line as number) < 1 ||
    !Number.isSafeInteger(value.column) || (value.column as number) < 1) {
    fail('Invalid Dartograph impact location.');
  }
  // producer가 GraphNode에서 실은 선언 위치만 사용하며 경로나 좌표를 추측하지 않는다.
  return value.source === undefined ? undefined
    : { path: dartSource(value.source), line: value.line as number, column: value.column as number };
}

function dartTruncation(input: unknown): boolean {
  if (!Number.isSafeInteger(input) || (input as number) < 0) fail('Invalid Dartograph truncation count.');
  return (input as number) > 0;
}

function dartSource(input: unknown): string {
  const source = safe(input, 'Invalid Dartograph impact source.');
  const path = source.startsWith('project:') ? source.slice('project:'.length) : source;
  if (!isProjectRelativePath(path)) fail('Dartograph impact source must be project-relative.');
  return path;
}

function truncation(input: unknown): boolean {
  if (typeof input === 'boolean') return input;
  const value = object(input, 'Invalid impact truncation.');
  if (typeof value.depth !== 'boolean' || typeof value.output !== 'boolean' || !Array.isArray(value.sections) ||
    !value.sections.every((section) => isSafeNonEmptyString(section))) fail('Invalid impact truncation.');
  return value.depth || value.output || value.sections.length > 0;
}

function positiveDepth(input: unknown): number {
  if (!Number.isSafeInteger(input) || (input as number) < 1 || (input as number) > 128) fail('Impact depth must be between 1 and 128.');
  return input as number;
}

function object(input: unknown, message: string): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) fail(message);
  return input as Record<string, unknown>;
}

function rawArray(input: unknown, message: string): unknown[] {
  if (!Array.isArray(input) || input.length > 50_000) fail(message);
  return input;
}

function rawStrings(input: unknown, message: string): string[] {
  if (!Array.isArray(input) || input.length > 50_000 || !input.every((item) => isSafeNonEmptyString(item))) fail(message);
  return [...input] as string[];
}

function textStrings(input: unknown, message: string): string[] {
  if (!Array.isArray(input) || input.length > 50_000 || !input.every((item) => typeof item === 'string')) fail(message);
  return [...input] as string[];
}

function safe(input: unknown, message: string): string {
  if (!isSafeNonEmptyString(input)) fail(message);
  return input;
}

function fail(message: string): never {
  throw new PreflightValidationError(message);
}
