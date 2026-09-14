import { BridgeFactsValidationError, isBridgeTimestamp, isSafeNonEmptyString, MAX_FACTS_PER_DOCUMENT,
  validateLocation, validateSourceLanguage, validateSymbol } from './parse.ts';
import type { BridgeLocation, BridgeSourceLanguage, BridgeSymbol } from './parse.ts';

/** producer가 관찰한 사용 관계를 귀속한 실제 native handler 범위다. */
export interface BridgeHandlerScope {
  readonly start: BridgeLocation;
  readonly end: BridgeLocation;
  readonly complete: boolean;
}

/** 실제 참조 위치와 대상, index의 overrides로 확인한 dispatch 후보를 보존한다. */
export interface BridgeHandlerDependency {
  readonly kind: 'call' | 'reference';
  readonly scope: 'handler' | 'registration';
  readonly location: BridgeLocation;
  readonly symbol: BridgeSymbol & { readonly usr: string };
  readonly dispatchTargets?: readonly (BridgeSymbol & { readonly usr: string })[];
}

/** Basic 채널의 send·handler 사실이며 MethodChannel 메서드를 합성하지 않는다. */
export interface BridgeMessageFact {
  readonly kind: 'message-send' | 'message-handle';
  readonly channel: string | null;
  readonly dynamic: boolean;
  readonly channelPrefix?: string;
  readonly location: BridgeLocation;
  readonly symbol?: BridgeSymbol;
  readonly sourceLanguage?: BridgeSourceLanguage;
  readonly handlerScope?: BridgeHandlerScope;
  readonly dependencies?: readonly BridgeHandlerDependency[];
}

/** v1 전용 소비자가 조용히 무시하지 못하도록 별도 버전으로 전달하는 Basic 문서다. */
export interface BridgeMessageDocument {
  readonly format: 'bridge-facts';
  readonly version: 2;
  readonly transport: 'basic-message-channel';
  readonly platform: 'dart' | 'swift' | 'kotlin';
  readonly target: 'flutter' | null;
  readonly project: string;
  readonly generatedAt: string;
  readonly tool: { readonly name: string; readonly version: string };
  readonly facts: readonly BridgeMessageFact[];
  readonly limitations: readonly string[];
}

/** 입력 묶음의 역할·프로젝트 범위를 값 조인 없이 검증한다. */
export function validateMessageDocuments(documents: readonly BridgeMessageDocument[], project: string): void {
  if (documents.length === 0) return;
  if (documents.length > 256 || documents.some((document) => document.project !== project) ||
    !documents.some(({ platform }) => platform === 'dart') || !documents.some(({ platform }) => platform === 'swift' || platform === 'kotlin')) {
    fail('Message inputs require Dart and native documents for the same project.');
  }
}

/** Basic 전용 v2를 검증하고 알려진 필드만 복사한다. v1 입력 파서는 그대로 유지한다. */
export function parseMessageBridgeDocument(input: unknown): BridgeMessageDocument {
  const value = object(input);
  if (value.format !== 'bridge-facts' || value.version !== 2 || value.transport !== 'basic-message-channel') {
    fail('Expected bridge-facts version 2 for basic-message-channel.');
  }
  if (value.platform !== 'dart' && value.platform !== 'swift' && value.platform !== 'kotlin') fail('Unsupported message bridge platform.');
  if (!Array.isArray(value.facts) || value.facts.length > MAX_FACTS_PER_DOCUMENT) fail('Invalid message bridge fact count.');
  if (value.target !== (value.facts.length ? 'flutter' : null)) fail('Invalid message bridge target.');
  if (!isBridgeTimestamp(value.generatedAt)) fail('Invalid message bridge timestamp.');
  const project = safe(value.project);
  const tool = object(value.tool);
  const limitations = value.limitations;
  if (!Array.isArray(limitations) || !limitations.every((item) => typeof item === 'string')) fail('Invalid message bridge limitations.');
  let dependencyCount = 0;
  const consumeDependencies = (count: number): void => {
    dependencyCount += count;
    if (dependencyCount > 1_000_000) fail('Message dependency budget exceeded.');
  };
  const facts = value.facts.map((item, index): BridgeMessageFact => {
    const fact = object(item);
    const expectedKind = value.platform === 'dart' ? 'message-send' : 'message-handle';
    if (fact.kind !== expectedKind || fact.method !== undefined) fail('Invalid message bridge fact kind or method.');
    if (fact.channel === null ? fact.kind !== 'message-handle' : !isSafeNonEmptyString(fact.channel)) fail('Invalid message bridge channel.');
    if (typeof fact.dynamic !== 'boolean') fail('Invalid message bridge dynamic flag.');
    if (fact.channelPrefix !== undefined && (!fact.dynamic || fact.channel === null || !isSafeNonEmptyString(fact.channelPrefix))) {
      fail('Message prefix requires a dynamic channel and a non-empty proven prefix.');
    }
    validateLocation(fact.location, index);
    validateSymbol(fact.symbol, index);
    const location = fact.location as BridgeLocation;
    const symbol = fact.symbol as BridgeSymbol | undefined;
    validateSourceLanguage(fact.sourceLanguage, value.platform, location, symbol, index);
    let handlerScope: BridgeHandlerScope | undefined;
    let dependencies: readonly BridgeHandlerDependency[] | undefined;
    if (fact.handlerScope !== undefined || fact.dependencies !== undefined) {
      if (expectedKind !== 'message-handle' || fact.sourceLanguage !== undefined) fail('Handler dependencies require a native message handler.');
      const scope = object(fact.handlerScope);
      const start = copyLocation(scope.start, index);
      const end = copyLocation(scope.end, index);
      if (typeof scope.complete !== 'boolean' || start.path !== location.path || end.path !== location.path ||
        position(start, end) > 0 || (scope.complete && symbol?.usr === undefined)) fail('Invalid message handler scope.');
      handlerScope = { start, end, complete: scope.complete };
      const raw = dependencyArray(fact.dependencies);
      consumeDependencies(raw.length);
      dependencies = raw.map((input): BridgeHandlerDependency => {
        const row = object(input);
        if ((row.kind !== 'call' && row.kind !== 'reference') || (row.scope !== 'handler' && row.scope !== 'registration')) {
          fail('Invalid message dependency kind or scope.');
        }
        const at = copyLocation(row.location, index);
        const inside = position(start, at) <= 0 && position(at, end) <= 0;
        if (at.path !== location.path || inside !== (row.scope === 'handler')) fail('Message dependency is outside its declared scope.');
        const dispatch = row.dispatchTargets === undefined ? undefined : dependencyArray(row.dispatchTargets);
        consumeDependencies(dispatch?.length ?? 0);
        return { kind: row.kind, scope: row.scope, location: at, symbol: indexedSymbol(row.symbol, index),
          ...(dispatch === undefined ? {} : { dispatchTargets: dispatch.map((target) => indexedSymbol(target, index)) }) };
      });
    }
    return { kind: expectedKind, channel: fact.channel as string | null, dynamic: fact.dynamic,
      location: { path: location.path, line: location.line, column: location.column },
      ...(fact.channelPrefix === undefined ? {} : { channelPrefix: fact.channelPrefix as string }),
      ...(symbol === undefined ? {} : { symbol: { qualifiedName: symbol.qualifiedName, ...(symbol.usr === undefined ? {} : { usr: symbol.usr }) } }),
      ...(fact.sourceLanguage === undefined ? {} : { sourceLanguage: fact.sourceLanguage as BridgeSourceLanguage }),
      ...(handlerScope === undefined ? {} : { handlerScope, dependencies: dependencies! }),
    };
  });
  if (facts.some((fact) => fact.channel === null) && !limitations.some((item) => item.startsWith('unattributed-message-handles:'))) {
    fail('Unattributed message handles require a limitation.');
  }
  return { format: 'bridge-facts', version: 2, transport: 'basic-message-channel', platform: value.platform,
    target: facts.length ? 'flutter' : null, project, generatedAt: value.generatedAt,
    tool: { name: safe(tool.name), version: safe(tool.version) }, facts, limitations: [...limitations] };
}

function copyLocation(input: unknown, index: number): BridgeLocation {
  validateLocation(input, index);
  const at = input as BridgeLocation;
  return { path: at.path, line: at.line, column: at.column };
}
function indexedSymbol(input: unknown, index: number): BridgeSymbol & { readonly usr: string } {
  validateSymbol(input, index);
  const symbol = object(input);
  return { qualifiedName: safe(symbol.qualifiedName), usr: safe(symbol.usr) };
}
function dependencyArray(input: unknown): unknown[] {
  if (!Array.isArray(input) || input.length > 10_000) fail('Invalid message dependency count.');
  return input;
}
function position(a: BridgeLocation, b: BridgeLocation): number {
  return a.line - b.line || a.column - b.column;
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('Message bridge input must be a JSON object.');
  return value as Record<string, unknown>;
}
function safe(value: unknown): string {
  if (!isSafeNonEmptyString(value)) fail('Invalid message bridge metadata.');
  return value as string;
}
function fail(message: string): never { throw new BridgeFactsValidationError(message); }
