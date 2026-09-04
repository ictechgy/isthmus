import type { BridgeTarget } from '../exchange/parse.ts';
import type {
  BridgeEndpoint,
  BridgeJoinResult,
  JoinLimitation,
} from '../join/join.ts';
import { encodeSortedJson } from './sorted-json.ts';

/** query가 식별한 채널 또는 메서드 키다. */
export interface BridgeQuerySubject {
  readonly name: string;
  readonly qualifiedName: string;
  readonly kind: 'channel' | 'method';
}

/** 한 브리지 키에서 본 호출 측과 수신 측 증거다. */
export interface BridgeQueryResult {
  readonly subject: BridgeQuerySubject;
  readonly usedBy: readonly BridgeEndpoint[];
  readonly dependsOn: readonly BridgeEndpoint[];
}

/** cartograph query와 같은 상태 외피를 쓰는 브리지 질의 문서다. */
export interface BridgeQueryDocument {
  readonly status: 'found' | 'ambiguous' | 'notFound';
  readonly requested: string;
  readonly level: 'bridge';
  readonly limitations: readonly JoinLimitation[];
  readonly result?: BridgeQueryResult;
  readonly candidates?: ReadonlyArray<{
    readonly qualifiedName: string;
  }>;
}

/** query 문서를 결정적인 JSON 문자열로 인코딩한다. */
export function encodeBridgeQuery(document: BridgeQueryDocument): string {
  return encodeSortedJson(document);
}

/** 조인된 브리지에서 채널 또는 메서드 문자열을 질의한다. */
export function createBridgeQuery(
  joined: BridgeJoinResult,
  requested: string,
): BridgeQueryDocument {
  const channels = channelResults(joined, requested);
  const channel = channels[0];
  if (channel !== undefined) {
    return {
      status: 'found',
      requested,
      level: 'bridge',
      limitations: joined.limitations,
      result: channel,
    };
  }
  const methods = methodResults(joined, requested);
  if (methods.length > 1) {
    return {
      status: 'ambiguous',
      requested,
      level: 'bridge',
      limitations: joined.limitations,
      candidates: methods
        .map(({ subject }) => ({ qualifiedName: subject.qualifiedName }))
        .sort((left, right) => left.qualifiedName.localeCompare(right.qualifiedName)),
    };
  }
  const method = methods[0];
  if (method !== undefined) {
    return {
      status: 'found',
      requested,
      level: 'bridge',
      limitations: joined.limitations,
      result: method,
    };
  }
  return {
    status: 'notFound',
    requested,
    level: 'bridge',
    limitations: joined.limitations,
  };
}

/** 요청 문자열과 정확히 같은 논리 메서드 결과를 만든다. */
function methodResults(
  joined: BridgeJoinResult,
  requested: string,
): BridgeQueryResult[] {
  const matched = joined.matchedMethods
    .filter(({ method }) => method === requested)
    .map(({ target, channel, method, invocations, handlers }) =>
      makeMethodResult(target, channel, method, invocations, handlers),
    );
  const unhandled = joined.unhandledInvocations
    .filter(({ method }) => method === requested)
    .map(({ target, channel, method, invocations }) =>
      makeMethodResult(target, channel, method, invocations, []),
    );
  const handlers = joined.handlersWithoutInvocations
    .filter(({ method }) => method === requested)
    .map(({ target, channel, method, handlers }) =>
      makeMethodResult(target, channel, method, [], handlers),
    );
  return [...matched, ...unhandled, ...handlers];
}

/** 메서드 키와 양쪽 증거를 query result로 바꾼다. */
function makeMethodResult(
  target: BridgeTarget,
  channel: string,
  method: string,
  usedBy: readonly BridgeEndpoint[],
  dependsOn: readonly BridgeEndpoint[],
): BridgeQueryResult {
  return {
    subject: {
      name: method,
      qualifiedName: `${target}:${channel}#${method}`,
      kind: 'method',
    },
    usedBy,
    dependsOn,
  };
}

/** 요청 문자열과 정확히 같은 논리 채널 결과를 만든다. */
function channelResults(
  joined: BridgeJoinResult,
  requested: string,
): BridgeQueryResult[] {
  const matched = joined.matchedChannels
    .filter(({ channel }) => channel === requested)
    .map(({ target, channel, creations, registrations }) =>
      makeQueryResult(target, channel, 'channel', creations, registrations),
    );
  const unregistered = joined.unregisteredChannelCreations
    .filter(({ channel }) => channel === requested)
    .map(({ target, channel, creations }) =>
      makeQueryResult(target, channel, 'channel', creations, []),
    );
  return [...matched, ...unregistered];
}

/** 조인 키와 양쪽 증거를 query result 골격으로 바꾼다. */
function makeQueryResult(
  target: BridgeTarget,
  name: string,
  kind: 'channel' | 'method',
  usedBy: readonly BridgeEndpoint[],
  dependsOn: readonly BridgeEndpoint[],
): BridgeQueryResult {
  return {
    subject: {
      name,
      qualifiedName: `${target}:${name}`,
      kind,
    },
    usedBy,
    dependsOn,
  };
}
