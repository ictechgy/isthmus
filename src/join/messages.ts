import { compareStrings } from '../compare.ts';
import type { BridgeHandlerDependency, BridgeHandlerScope, BridgeMessageDocument } from '../exchange/messages.ts';
import { validateMessageDocuments } from '../exchange/messages.ts';
import type { BridgeEndpoint, JoinLimitation } from './join.ts';
import { BridgeJoinValidationError } from './join.ts';
import { MessageAddressIndex } from './message-address.ts';

/** 동적 접두사의 원래 표현식도 근거에 보존한다. */
export interface MessageEndpoint extends BridgeEndpoint {
  readonly channelExpression?: string;
  readonly handlerScope?: BridgeHandlerScope;
  readonly dependencies?: readonly BridgeHandlerDependency[];
}

/** literal 주소와 prefix 후보를 다른 키로 연결한다. */
export interface MessageBridgeRoute {
  readonly channel: string;
  readonly matching: 'literal' | 'prefix';
  readonly senders: readonly MessageEndpoint[];
  readonly handlers: readonly MessageEndpoint[];
}

/** Basic 범위에서 관찰한 경계와 끝내 연결하지 못한 사실이다. */
export interface MessageBridgeJoin {
  readonly routes: readonly MessageBridgeRoute[];
  readonly unresolved: readonly MessageEndpoint[];
  readonly limitations: readonly JoinLimitation[];
}

/** 서로 같은 project의 양쪽 Basic 문서만 조인하며 MethodChannel 키 공간을 사용하지 않는다. */
export function joinMessageBridges(documents: readonly BridgeMessageDocument[], project: string): MessageBridgeJoin {
  if (documents.length === 0) return { routes: [], unresolved: [], limitations: [] };
  validateMessageDocuments(documents, project);
  const groups = new Map<string, { channel: string; matching: 'literal' | 'prefix';
    senders: Map<string, MessageEndpoint>; handlers: Map<string, MessageEndpoint> }>();
  const unresolved = new Map<string, MessageEndpoint>();
  const limitations: JoinLimitation[] = [];
  for (const document of documents) {
    for (const message of document.limitations) limitations.push({ platform: document.platform,
      target: document.target, tool: document.tool.name, message });
    for (const fact of document.facts) {
      const endpoint: MessageEndpoint = { platform: document.platform, location: fact.location,
        ...(fact.symbol === undefined ? {} : { symbol: fact.symbol }),
        ...(fact.sourceLanguage === undefined ? {} : { sourceLanguage: fact.sourceLanguage }),
        ...(fact.handlerScope === undefined ? {} : { handlerScope: fact.handlerScope, dependencies: fact.dependencies! }),
        ...(fact.dynamic && fact.channel !== null ? { channelExpression: fact.channel } : {}) };
      const identity = JSON.stringify([document.platform, fact.location.path, fact.location.line, fact.location.column,
        fact.symbol?.usr ?? null, fact.symbol?.qualifiedName ?? null, fact.sourceLanguage ?? null,
        fact.dynamic, fact.channel, fact.channelPrefix ?? null, fact.handlerScope ?? null, fact.dependencies ?? null]);
      const channel = fact.dynamic ? fact.channelPrefix : fact.channel;
      if (!channel) { unresolved.set(identity, endpoint); continue; }
      const matching = fact.dynamic ? 'prefix' : 'literal';
      const key = JSON.stringify([matching, channel]);
      let group = groups.get(key);
      if (group === undefined) {
        group = { channel, matching, senders: new Map(), handlers: new Map() };
        groups.set(key, group);
      }
      (fact.kind === 'message-send' ? group.senders : group.handlers).set(identity, endpoint);
    }
  }
  const endpoints = (values: Map<string, MessageEndpoint>) => [...values.entries()]
    .sort(([a], [b]) => compareStrings(a, b)).map(([, value]) => value);
  // 전파로 추가한 literal을 더 좁은 prefix로 다시 복사하면 서로 다른 주소가 연결된다.
  // 원래 prefix 사실만 스냅샷으로 두고, 교집합 범위에 한 번씩 투영한다.
  const prefixes = [...groups.values()].filter(({ matching }) => matching === 'prefix').map((group) => ({
    group, senders: new Map(group.senders), handlers: new Map(group.handlers),
  }));
  const prefixIndex = new MessageAddressIndex<(typeof prefixes)[number]>();
  for (const prefix of prefixes) prefixIndex.add(prefix.group.channel, 'prefix', prefix);
  let projections = 0;
  const merge = (target: Map<string, MessageEndpoint>, source: Map<string, MessageEndpoint>) => {
    for (const [key, endpoint] of source) if (!target.has(key)) {
      if (++projections > 1_000_000) throw new BridgeJoinValidationError('Message prefix projection budget exceeded.');
      target.set(key, endpoint);
    }
  };
  for (const group of groups.values()) {
    for (const prefix of prefixIndex.matching(group.channel)) {
      if (prefix.group === group) continue;
      if (group.matching === 'literal') {
        merge(prefix.group.senders, group.senders); merge(prefix.group.handlers, group.handlers);
      } else {
        merge(group.senders, prefix.senders); merge(group.handlers, prefix.handlers);
      }
    }
  }
  return {
    routes: [...groups.entries()].sort(([a], [b]) => compareStrings(a, b)).map(([, group]) => ({
      channel: group.channel, matching: group.matching, senders: endpoints(group.senders), handlers: endpoints(group.handlers),
    })), unresolved: endpoints(unresolved), limitations,
  };
}
