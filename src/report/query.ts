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
  if (channels.length > 1) {
    return ambiguousQuery(joined, requested, channels);
  }
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
    return ambiguousQuery(joined, requested, methods);
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

/** 여러 논리 키가 같은 요청과 맞을 때 선택 가능한 정규화 이름을 돌려준다. */
function ambiguousQuery(
  joined: BridgeJoinResult,
  requested: string,
  results: readonly BridgeQueryResult[],
): BridgeQueryDocument {
  return {
    status: 'ambiguous',
    requested,
    level: 'bridge',
    limitations: joined.limitations,
    candidates: results
      .map(({ subject }) => ({ qualifiedName: subject.qualifiedName }))
      .sort((left, right) => left.qualifiedName.localeCompare(right.qualifiedName)),
  };
}

/** 요청 문자열과 정확히 같은 논리 메서드 결과를 만든다. */
function methodResults(
  joined: BridgeJoinResult,
  requested: string,
): BridgeQueryResult[] {
  const matched = joined.matchedMethods
    .map(({ target, channel, method, invocations, handlers }) =>
      makeMethodResult(target, channel, method, invocations, handlers),
    )
    .filter((result) => matchesRequested(result, requested));
  const unhandled = joined.unhandledInvocations
    .map(({ target, channel, method, invocations }) =>
      makeMethodResult(target, channel, method, invocations, []),
    )
    .filter((result) => matchesRequested(result, requested));
  const handlers = joined.handlersWithoutInvocations
    .map(({ target, channel, method, handlers }) =>
      makeMethodResult(target, channel, method, [], handlers),
    )
    .filter((result) => matchesRequested(result, requested));
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
    .map(({ target, channel, creations, registrations }) =>
      makeQueryResult(target, channel, 'channel', creations, registrations),
    )
    .filter((result) => matchesRequested(result, requested));
  const unregistered = joined.unregisteredChannelCreations
    .map(({ target, channel, creations }) =>
      makeQueryResult(target, channel, 'channel', creations, []),
    )
    .filter((result) => matchesRequested(result, requested));
  return [...matched, ...unregistered];
}

/** 짧은 이름 또는 모호성 해소용 qualifiedName과 정확히 일치하는지 확인한다. */
function matchesRequested(
  result: BridgeQueryResult,
  requested: string,
): boolean {
  return (
    result.subject.name === requested ||
    result.subject.qualifiedName === requested
  );
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
