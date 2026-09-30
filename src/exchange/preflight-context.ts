import {
  isBridgeDomainDocument,
  parseBridgeFactsDocument,
  BridgeFactsValidationError,
} from './parse.ts';
import type {
  BridgeFactsDocument,
  BridgeLocation,
} from './parse.ts';
import { parseImpactSelection } from './impact-selection.ts';
import { createJsonGuards } from './json-guards.ts';
import {
  MAX_IMPACT_DEPTH,
  MAX_IMPACT_GRAPH_ITEMS,
  MAX_IMPACT_RELATIONSHIPS,
  parseImpactLocation,
  parseImpactSymbol,
  PreflightValidationError,
  validateLanguageImpact,
} from './language-impact.ts';
import type { ImpactSymbol, LanguageImpact } from './language-impact.ts';
import type { ImpactSelection } from './impact-selection.ts';
import { joinBridgeDocuments } from '../join/join.ts';
import { compareStrings } from '../compare.ts';
import { parseMessageBridgeDocument, validateMessageDocuments } from './messages.ts';
import type { BridgeMessageDocument } from './messages.ts';

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

// 영향 계약은 language-impact.ts가 소유한다. 기존 import 경로(스크립트·소비자)를 위해 다시 내보낸다.
export { PreflightValidationError, validateLanguageImpact };
export type { ImpactSymbol, LanguageImpact };
export {
  MAX_IMPACT_DEPTH as MAX_PREFLIGHT_DEPTH,
  MAX_IMPACT_GRAPH_ITEMS as MAX_PREFLIGHT_GRAPH_ITEMS,
  MAX_IMPACT_RELATIONSHIPS as MAX_PREFLIGHT_RELATIONSHIPS,
};

export const MAX_PREFLIGHT_ANALYSES = 256;
export const MAX_PREFLIGHT_BINDINGS = 100_000;

/** 신뢰하지 않는 JSON을 정규화된 preflight-context v1으로 검증한다. */
export function parsePreflightContext(input: unknown): PreflightContext {
  const value = object(input, 'Preflight context must be a JSON object.');
  if (value.format !== 'isthmus-preflight-context' || value.version !== 1) {
    fail('Expected isthmus-preflight-context version 1.');
  }
  const project = safe(value.project, 'Invalid preflight project.');
  const revision = safe(value.revision, 'Invalid preflight revision.');
  const selection = parseSelectionMap(value.selection);
  const bridges = parseBridges(value.bridges, project);
  const messages = value.messages === undefined ? undefined : parseMessages(value.messages, project);
  const analyses = parseAnalyses(value.analyses);
  validateSelectionCoverage(selection, analyses);
  const bindings = parseBindings(value.bindings, [...bridges, ...(messages ?? [])]);
  const limitations = textStrings(value.limitations, Number.POSITIVE_INFINITY, 'Invalid preflight limitations.');
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
      // 플랫폼이 dart·swift·kotlin이어도 persistence 문서는 bridge 경계를 기술하지 않는다.
      // 조인 실패의 일반 문구로 흐리지 않고, 원인을 밝혀 거부한다.
      if (parsed.target === 'http') {
        fail('Preflight context supports only bridge documents; remove http documents from the context.');
      }
      if (!isBridgeDomainDocument(parsed)) {
        fail('Preflight context supports only bridge documents; remove persistence documents from the context.');
      }
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
    if (graphItems > MAX_IMPACT_GRAPH_ITEMS) fail('Preflight impact graphs exceed their total item limit.');
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
      if (fact.symbol === undefined || fact.location === undefined) continue;
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
    const location = parseImpactLocation(value.location, 'Invalid caller binding location.');
    const requested = safe(value.requested, 'Invalid caller binding request.');
    const symbol = parseImpactSymbol(value.symbol);
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

function locationKey(location: BridgeLocation): string {
  return `${location.path}\u0000${location.line}\u0000${location.column}`;
}

function fail(message: string): never {
  throw new PreflightValidationError(message);
}

const { object, array, textStrings, safe } = createJsonGuards(fail);
