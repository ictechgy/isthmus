import {
  isProjectRelativePath,
  isSafeNonEmptyString,
  parseBridgeFactsDocument,
  BridgeFactsValidationError,
} from './parse.ts';
import type {
  BridgeFactsDocument,
  BridgeLocation,
} from './parse.ts';
import { parseImpactSelection } from './impact-selection.ts';
import type { ImpactSelection } from './impact-selection.ts';
import { joinBridgeDocuments } from '../join/join.ts';
import { compareStrings } from '../compare.ts';
import { parseMessageBridgeDocument, validateMessageDocuments } from './messages.ts';
import type { BridgeMessageDocument } from './messages.ts';

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

/** Dart fact와 query symbol을 추측 없이 연결하는 호출자 근거다. */
export interface CallerBinding {
  readonly platform: 'dart';
  readonly location: BridgeLocation;
  readonly requested: string;
  readonly symbol: ImpactSymbol;
}

/** 변경 사전 점검이 재사용할 입력·분석·호출자 근거를 묶은 문서다. */
export interface PreflightContext {
  readonly format: 'isthmus-preflight-context';
  readonly version: 1;
  readonly project: string;
  readonly revision: string;
  readonly selection: Readonly<{
    readonly dart?: ImpactSelection;
    readonly swift?: ImpactSelection;
    readonly kotlin?: ImpactSelection;
  }>;
  readonly bridges: readonly BridgeFactsDocument[];
  readonly messages?: readonly BridgeMessageDocument[];
  readonly bindings: readonly CallerBinding[];
  readonly analyses: readonly LanguageImpact[];
  readonly limitations: readonly string[];
}

/** preflight 입력이 계약을 어겼음을 나타내며 원문 데이터를 오류에 넣지 않는다. */
export class PreflightValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PreflightValidationError';
  }
}

export const MAX_PREFLIGHT_ANALYSES = 256;
export const MAX_PREFLIGHT_GRAPH_ITEMS = 50_000;
export const MAX_PREFLIGHT_BINDINGS = 100_000;
export const MAX_PREFLIGHT_DEPTH = 128;
export const MAX_PREFLIGHT_RELATIONSHIPS = 32;

/** 신뢰하지 않는 JSON을 정규화된 preflight-context v1으로 검증한다. */
export function parsePreflightContext(input: unknown): PreflightContext {
  const value = object(input, 'Preflight context must be a JSON object.');
  if (value.format !== 'isthmus-preflight-context' || value.version !== 1) {
    fail('Expected isthmus-preflight-context version 1.');
  }
  const project = safeString(value.project, 'Invalid preflight project.');
  const revision = safeString(value.revision, 'Invalid preflight revision.');
  const selection = parseSelectionMap(value.selection);
  const bridges = parseBridges(value.bridges, project);
  const messages = value.messages === undefined ? undefined : parseMessages(value.messages, project);
  const analyses = parseAnalyses(value.analyses);
  validateSelectionCoverage(selection, analyses);
  const bindings = parseBindings(value.bindings, [...bridges, ...(messages ?? [])]);
  const limitations = strings(value.limitations, 'Invalid preflight limitations.');
  return {
    format: 'isthmus-preflight-context', version: 1, project, revision,
    selection, bridges, ...(messages === undefined ? {} : { messages }), bindings, analyses, limitations,
  };
}

function parseMessages(input: unknown, project: string): readonly BridgeMessageDocument[] {
  try {
    const documents = array(input, 256, 'Invalid preflight message documents.').map(parseMessageBridgeDocument);
    if (documents.some(({ transport }) => transport === 'react-native-event')) {
      fail('Preflight does not yet support React Native event documents; use check or query.');
    }
    validateMessageDocuments(documents, project);
    return documents;
  } catch (error) {
    if (error instanceof BridgeFactsValidationError) fail(`Invalid preflight messages: ${error.message}`);
    throw error;
  }
}

/** producer adapter가 만든 분석도 context parser와 같은 그래프 규칙을 사용하게 한다. */
export function validateLanguageImpact(input: unknown): LanguageImpact {
  const value = object(input, 'Language impact must be a JSON object.');
  const id = safeString(value.id, 'Invalid language impact id.');
  if (value.platform !== 'dart' && value.platform !== 'swift' && value.platform !== 'kotlin') {
    fail('Unsupported language impact platform.');
  }
  const toolValue = object(value.tool, 'Invalid language impact tool.');
  const tool = {
    name: safeString(toolValue.name, 'Invalid language impact tool name.'),
    version: safeString(toolValue.version, 'Invalid language impact tool version.'),
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
    : safeString(value.trigger, 'Invalid language impact trigger.');
  const roots = array(value.roots, MAX_PREFLIGHT_GRAPH_ITEMS, 'Invalid language impact roots.')
    .map((item) => parseSymbol(item, value.platform === 'kotlin'));
  const affectedRaw = array(value.affected, MAX_PREFLIGHT_GRAPH_ITEMS, 'Invalid language impact affected symbols.');
  const affected = affectedRaw.map((item) => parseAffected(item, value.platform === 'kotlin'));
  const limitations = strings(value.limitations, 'Invalid language impact limitations.');
  if (typeof value.truncated !== 'boolean') fail('Invalid language impact truncation flag.');
  if (roots.length + affected.length > MAX_PREFLIGHT_GRAPH_ITEMS) {
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

function parseSelectionMap(input: unknown): PreflightContext['selection'] {
  const value = object(input, 'Preflight selection must be a JSON object.');
  for (const key of Object.keys(value)) {
    if (key !== 'dart' && key !== 'swift' && key !== 'kotlin') fail('Unsupported preflight selection platform.');
  }
  const selection: { dart?: ImpactSelection; swift?: ImpactSelection; kotlin?: ImpactSelection } = {};
  for (const platform of ['dart', 'swift', 'kotlin'] as const) {
    if (value[platform] === undefined) continue;
    try {
      selection[platform] = parseImpactSelection({
        format: 'isthmus-changes', version: 1,
        ...object(value[platform], 'Invalid preflight platform selection.'),
      });
    } catch (error) {
      if (error instanceof PreflightValidationError) throw error;
      fail('Invalid preflight platform selection.');
    }
  }
  return selection;
}

function parseBridges(input: unknown, project: string): BridgeFactsDocument[] {
  const raw = array(input, 256, 'Invalid preflight bridges.');
  const bridges = raw.map((item) => {
    const candidate = object(item, 'Invalid preflight bridge document.');
    if (candidate.platform !== 'dart' && candidate.platform !== 'swift' && candidate.platform !== 'kotlin') {
      fail('Preflight context supports only Dart, Swift and Kotlin bridge documents.');
    }
    try {
      const parsed = parseBridgeFactsDocument(candidate);
      if (parsed.project !== project) fail('Bridge project differs from preflight project.');
      return parsed;
    } catch (error) {
      if (error instanceof PreflightValidationError) throw error;
      fail('Invalid preflight bridge document.');
    }
  });
  try {
    const joined = joinBridgeDocuments(bridges);
    if (joined.deferred) fail('Mixed bridge targets cannot be used in preflight context.');
  } catch (error) {
    if (error instanceof PreflightValidationError) throw error;
    fail('Bridge documents cannot be joined for preflight.');
  }
  return bridges;
}

function parseAnalyses(input: unknown): LanguageImpact[] {
  const raw = array(input, MAX_PREFLIGHT_ANALYSES, 'Invalid preflight analyses.');
  const ids = new Set<string>();
  let graphItems = 0;
  const analyses = raw.map((item) => {
    const analysis = validateLanguageImpact(item);
    if (ids.has(analysis.id)) fail('Language impact ids must be unique.');
    ids.add(analysis.id);
    graphItems += analysis.roots.length + analysis.affected.length;
    if (graphItems > MAX_PREFLIGHT_GRAPH_ITEMS) fail('Preflight impact graphs exceed their total item limit.');
    return analysis;
  });
  return analyses;
}

function validateSelectionCoverage(
  selection: PreflightContext['selection'], analyses: readonly LanguageImpact[],
): void {
  for (const platform of ['dart', 'swift', 'kotlin'] as const) {
    const initial = analyses.filter((analysis) => analysis.platform === platform && analysis.trigger === undefined);
    const declared = selection[platform];
    if (initial.length === 0) {
      if (declared !== undefined) fail('Declared selection has no initial analysis.');
      continue;
    }
    const files = [...new Set(initial.flatMap(({ requested }) => requested.files))].sort(compareStrings);
    const symbols = [...new Set(initial.flatMap(({ requested }) => requested.symbols))].sort(compareStrings);
    if (declared === undefined || files.length !== declared.files.length || symbols.length !== declared.symbols.length ||
      files.some((file, index) => file !== declared.files[index]) || symbols.some((symbol, index) => symbol !== declared.symbols[index])) {
      fail('Initial impact selections must exactly cover the declared platform selections.');
    }
  }
  if (analyses.length === 0 && Object.keys(selection).length !== 0) {
    fail('An empty analysis set requires an empty selection.');
  }
}

function parseBindings(input: unknown, bridges: readonly (BridgeFactsDocument | BridgeMessageDocument)[]): CallerBinding[] {
  const raw = array(input, MAX_PREFLIGHT_BINDINGS, 'Invalid preflight bindings.');
  const facts = new Map<string, { path: string; qualifiedName: string }[]>();
  for (const document of bridges) {
    if (document.platform !== 'dart') continue;
    for (const fact of document.facts) {
      if (fact.symbol === undefined) continue;
      const key = locationKey(fact.location);
      const entries = facts.get(key) ?? [];
      entries.push({ path: fact.location.path, qualifiedName: fact.symbol.qualifiedName });
      facts.set(key, entries);
    }
  }
  const used = new Map<string, string>();
  return raw.map((item) => {
    const value = object(item, 'Invalid caller binding.');
    if (value.platform !== 'dart') fail('Caller bindings must be Dart bindings.');
    const location = parseLocation(value.location, 'Invalid caller binding location.');
    const requested = safeString(value.requested, 'Invalid caller binding request.');
    const symbol = parseSymbol(value.symbol);
    // requested는 AST의 짧은 이름이고 query qualifiedName은 producer의 전체 ID일 수 있다.
    if (symbol.location === undefined || symbol.location.path !== location.path) {
      fail('Caller binding symbol does not match its fact path.');
    }
    const matches = (facts.get(locationKey(location)) ?? []).filter((fact) => fact.qualifiedName === requested);
    if (matches.length === 0) fail('Caller binding does not reference an observed Dart fact.');
    const key = locationKey(location);
    const identity = `${requested}\u0000${symbol.id}`;
    const prior = used.get(key);
    if (prior !== undefined && prior !== identity) fail('Conflicting caller bindings share one fact location.');
    used.set(key, identity);
    return { platform: 'dart', location, requested, symbol };
  });
}

function parseAffected(input: unknown, partialLocation = false): LanguageImpact['affected'][number] {
  const value = object(input, 'Invalid affected symbol.');
  const symbol = parseSymbol(value.symbol, partialLocation);
  const via = safeString(value.via, 'Invalid affected symbol parent.');
  if (!Number.isSafeInteger(value.depth) || (value.depth as number) < 1 || (value.depth as number) > MAX_PREFLIGHT_DEPTH) {
    fail('Affected symbol depth must be between 1 and 128.');
  }
  const relationships = safeStrings(value.relationships, 'Invalid affected symbol relationships.');
  if (relationships.length > MAX_PREFLIGHT_RELATIONSHIPS) fail('Affected symbol relationships exceed their limit.');
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

function parseSymbol(input: unknown, partialLocation = false): ImpactSymbol {
  const value = object(input, 'Invalid impact symbol.');
  const result: ImpactSymbol = {
    id: safeString(value.id, 'Invalid impact symbol id.'),
    qualifiedName: safeString(value.qualifiedName, 'Invalid impact symbol qualified name.'),
    ...(value.kind === undefined ? {} : { kind: safeString(value.kind, 'Invalid impact symbol kind.') }),
    ...(value.location === undefined ? {} : { location: partialLocation ? parseKotlinLocation(value.location)
      : parseLocation(value.location, 'Invalid impact symbol location.') }),
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

function parseLocation(input: unknown, message: string): BridgeLocation {
  const value = object(input, message);
  if (!isProjectRelativePath(value.path) || !Number.isSafeInteger(value.line) || (value.line as number) < 1 ||
    !Number.isSafeInteger(value.column) || (value.column as number) < 1) fail(message);
  return { path: value.path as string, line: value.line as number, column: value.column as number };
}

function object(input: unknown, message: string): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) fail(message);
  return input as Record<string, unknown>;
}

function array(input: unknown, maximum: number, message: string): unknown[] {
  if (!Array.isArray(input) || input.length > maximum) fail(message);
  return input;
}

function strings(input: unknown, message: string): string[] {
  if (!Array.isArray(input) || !input.every((item) => typeof item === 'string')) fail(message);
  return [...input] as string[];
}

function safeStrings(input: unknown, message: string): string[] {
  if (!Array.isArray(input) || !input.every(isSafeNonEmptyString)) fail(message);
  return [...input] as string[];
}

function safeString(input: unknown, message: string): string {
  if (!isSafeNonEmptyString(input)) fail(message);
  return input;
}

function locationKey(location: BridgeLocation): string {
  return `${location.path}\u0000${location.line}\u0000${location.column}`;
}

function fail(message: string): never {
  throw new PreflightValidationError(message);
}
