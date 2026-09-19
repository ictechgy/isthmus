import { BridgeFactsValidationError, isBridgeTimestamp, isSafeNonEmptyString, MAX_FACTS_PER_DOCUMENT,
  MAX_SCOPE_DEPENDENCIES_PER_DOCUMENT, normalizeScopeEvidence, validateLocation, validateScopeEvidence,
  validateSourceLanguage, validateSymbol } from './parse.ts';
import type { BridgeHandlerDependency, BridgeHandlerScope, BridgeLocation, BridgeSourceLanguage, BridgeSymbol } from './parse.ts';

export type { BridgeHandlerDependency, BridgeHandlerScope } from './parse.ts';

/** v2 문서가 다루는 transport다. Basic은 호출/응답, Event는 네이티브→Dart 스트림이다. */
export type BridgeMessageTransport = 'basic-message-channel' | 'event-channel' | 'react-native-event';

/** Basic·Event 채널의 발신·수신 사실이며 MethodChannel 메서드를 합성하지 않는다. */
export interface BridgeMessageFact {
  readonly kind: 'message-send' | 'message-handle' | 'stream-listen' | 'stream-handle' | 'event-listen' | 'event-emit';
  readonly channel: string | null;
  readonly dynamic: boolean;
  readonly channelPrefix?: string;
  readonly location: BridgeLocation;
  readonly symbol?: BridgeSymbol;
  readonly sourceLanguage?: BridgeSourceLanguage;
  readonly handlerScope?: BridgeHandlerScope;
  readonly dependencies?: readonly BridgeHandlerDependency[];
}

/** v1 전용 소비자가 조용히 무시하지 못하도록 별도 버전으로 전달하는 v2 문서다. */
export interface BridgeMessageDocument {
  readonly format: 'bridge-facts';
  readonly version: 2;
  readonly transport: BridgeMessageTransport;
  readonly platform: 'dart' | 'js' | 'swift' | 'kotlin';
  readonly target: 'flutter' | 'react-native' | null;
  readonly project: string;
  readonly generatedAt: string;
  readonly tool: { readonly name: string; readonly version: string };
  readonly facts: readonly BridgeMessageFact[];
  readonly limitations: readonly string[];
}

/** transport·플랫폼별 허용 사실 종류와 미귀속 한계 접두사다. */
const transportRules = {
  'basic-message-channel': {
    dart: 'message-send', native: 'message-handle', unattributed: 'unattributed-message-handles:',
  },
  'event-channel': {
    dart: 'stream-listen', native: 'stream-handle', unattributed: 'unattributed-stream-handles:',
  },
  'react-native-event': {
    dart: 'event-listen', native: 'event-emit', unattributed: 'unattributed-event-emits:',
  },
} as const;

/** 전송 형식이 선언하는 target을 반환해 Flutter와 RN 이름 공간을 분리한다. */
export function messageTarget(transport: BridgeMessageTransport): 'flutter' | 'react-native' {
  return transport === 'react-native-event' ? 'react-native' : 'flutter';
}

/** 입력 묶음의 역할·프로젝트 범위를 값 조인 없이 검증한다. */
export function validateMessageDocuments(documents: readonly BridgeMessageDocument[], project: string): void {
  if (documents.length === 0) return;
  if (documents.length > 256 || documents.some((document) => document.project !== project) ||
    !documents.some(({ platform }) => platform === 'dart' || platform === 'js') || !documents.some(({ platform }) => platform === 'swift' || platform === 'kotlin')) {
    fail('Message inputs require Dart/JS caller and native documents for the same project.');
  }
  for (const target of new Set(documents.map(({ transport }) => messageTarget(transport)))) {
    const scoped = documents.filter(({ transport }) => messageTarget(transport) === target);
    if (!scoped.some(({ platform }) => platform === (target === 'react-native' ? 'js' : 'dart')) ||
      !scoped.some(({ platform }) => platform === 'swift' || platform === 'kotlin')) {
      fail('Message inputs require caller and native documents for each bridge target.');
    }
  }
}

/** transport별 v2를 검증하고 알려진 필드만 복사한다. v1 입력 파서는 그대로 유지한다. */
export function parseMessageBridgeDocument(input: unknown): BridgeMessageDocument {
  const value = object(input);
  if (value.format !== 'bridge-facts' || value.version !== 2 ||
    (value.transport !== 'basic-message-channel' && value.transport !== 'event-channel' && value.transport !== 'react-native-event')) {
    fail('Expected bridge-facts version 2 for a message transport.');
  }
  const rules = transportRules[value.transport];
  const callerPlatform = value.transport === 'react-native-event' ? 'js' : 'dart';
  if (value.platform !== callerPlatform && value.platform !== 'swift' && value.platform !== 'kotlin') fail('Unsupported message bridge platform.');
  if (!Array.isArray(value.facts) || value.facts.length > MAX_FACTS_PER_DOCUMENT) fail('Invalid message bridge fact count.');
  if (value.target !== (value.facts.length ? messageTarget(value.transport) : null)) fail('Invalid message bridge target.');
  if (!isBridgeTimestamp(value.generatedAt)) fail('Invalid message bridge timestamp.');
  const project = safe(value.project);
  const tool = object(value.tool);
  const limitations = value.limitations;
  if (!Array.isArray(limitations) || !limitations.every((item) => typeof item === 'string')) fail('Invalid message bridge limitations.');
  let dependencyCount = 0;
  const consumeDependencies = (count: number): void => {
    dependencyCount += count;
    if (dependencyCount > MAX_SCOPE_DEPENDENCIES_PER_DOCUMENT) fail('Message dependency budget exceeded.');
  };
  const facts = value.facts.map((item, index): BridgeMessageFact => {
    const fact = object(item);
    const expectedKind = value.platform === callerPlatform ? rules.dart : rules.native;
    if (fact.kind !== expectedKind || fact.method !== undefined) fail('Invalid message bridge fact kind or method.');
    if (fact.channel === null ? fact.kind !== rules.native : !isSafeNonEmptyString(fact.channel)) fail('Invalid message bridge channel.');
    if (typeof fact.dynamic !== 'boolean') fail('Invalid message bridge dynamic flag.');
    if (value.transport === 'react-native-event' && fact.channelPrefix !== undefined) fail('RN event names do not support prefix matching.');
    if (fact.channelPrefix !== undefined && (!fact.dynamic || fact.channel === null || !isSafeNonEmptyString(fact.channelPrefix))) {
      fail('Message prefix requires a dynamic channel and a non-empty proven prefix.');
    }
    validateLocation(fact.location, index);
    validateSymbol(fact.symbol, index);
    const location = fact.location as BridgeLocation;
    const symbol = fact.symbol as BridgeSymbol | undefined;
    validateSourceLanguage(fact.sourceLanguage, value.platform, location, symbol, index);
    let scoped: { handlerScope: BridgeHandlerScope; dependencies: readonly BridgeHandlerDependency[] } | undefined;
    if (fact.handlerScope !== undefined || fact.dependencies !== undefined) {
      if (expectedKind !== rules.native || fact.sourceLanguage !== undefined) fail('Handler dependencies require a native message handler.');
      validateScopeEvidence(fact, location, symbol, index, consumeDependencies);
      scoped = normalizeScopeEvidence(fact.handlerScope as BridgeHandlerScope,
        fact.dependencies as readonly BridgeHandlerDependency[]);
    }
    return { kind: expectedKind, channel: fact.channel as string | null, dynamic: fact.dynamic,
      location: { path: location.path, line: location.line, column: location.column },
      ...(fact.channelPrefix === undefined ? {} : { channelPrefix: fact.channelPrefix as string }),
      ...(symbol === undefined ? {} : { symbol: { qualifiedName: symbol.qualifiedName, ...(symbol.usr === undefined ? {} : { usr: symbol.usr }) } }),
      ...(fact.sourceLanguage === undefined ? {} : { sourceLanguage: fact.sourceLanguage as BridgeSourceLanguage }),
      ...(scoped === undefined ? {} : scoped),
    };
  });
  if (facts.some((fact) => fact.channel === null) && !limitations.some((item) => item.startsWith(rules.unattributed))) {
    fail('Unattributed message handles require a limitation.');
  }
  return { format: 'bridge-facts', version: 2, transport: value.transport, platform: value.platform as BridgeMessageDocument['platform'],
    target: facts.length ? messageTarget(value.transport) : null, project, generatedAt: value.generatedAt,
    tool: { name: safe(tool.name), version: safe(tool.version) }, facts, limitations: [...limitations] };
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
