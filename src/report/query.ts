import type { BridgeTarget } from '../exchange/parse.ts';
import { compareStrings } from '../compare.ts';
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
  const results = [...channelResults(joined), ...methodResults(joined)];
  const exact = results.filter(
    ({ subject }) => subject.qualifiedName === requested,
  );
  if (exact.length > 1) return ambiguousQuery(joined, requested, exact);
  if (exact[0] !== undefined) return foundQuery(joined, requested, exact[0]);

  const named = results.filter(({ subject }) => subject.name === requested);
  if (named.length > 1) return ambiguousQuery(joined, requested, named);
  if (named[0] !== undefined) return foundQuery(joined, requested, named[0]);
  return {
    status: 'notFound',
    requested,
    level: 'bridge',
    limitations: joined.limitations,
  };
}

/** 유일하게 식별된 논리 키와 증거를 found 문서로 감싼다. */
function foundQuery(
  joined: BridgeJoinResult,
  requested: string,
  result: BridgeQueryResult,
): BridgeQueryDocument {
  return {
    status: 'found',
    requested,
    level: 'bridge',
    limitations: joined.limitations,
    result,
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
      .sort((left, right) => compareStrings(left.qualifiedName, right.qualifiedName)),
  };
}

/** 요청 문자열과 정확히 같은 논리 메서드 결과를 만든다. */
function methodResults(
  joined: BridgeJoinResult,
): BridgeQueryResult[] {
  const matched = joined.matchedMethods
    .map(({ target, channel, method, invocations, handlers }) =>
      makeMethodResult(target, channel, method, invocations, handlers),
    );
  const unhandled = joined.unhandledInvocations
    .map(({ target, channel, method, invocations }) =>
      makeMethodResult(target, channel, method, invocations, []),
    );
  const handlers = joined.handlersWithoutInvocations
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
      qualifiedName:
        `${target}:${encodeSubjectComponent(channel)}#${encodeSubjectComponent(method)}`,
      kind: 'method',
    },
    usedBy,
    dependsOn,
  };
}

/** 요청 문자열과 정확히 같은 논리 채널 결과를 만든다. */
function channelResults(
  joined: BridgeJoinResult,
): BridgeQueryResult[] {
  const matched = joined.matchedChannels
    .map(({ target, channel, creations, registrations }) =>
      makeQueryResult(target, channel, 'channel', creations, registrations),
    );
  const unregistered = joined.unregisteredChannelCreations
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
      qualifiedName: `${target}:${encodeSubjectComponent(name)}`,
      kind,
    },
    usedBy,
    dependsOn,
  };
}

/** qualifiedName 구분자와 이스케이프 문자를 가역적인 퍼센트 표기로 바꾼다. */
function encodeSubjectComponent(value: string): string {
  return value.replaceAll('%', '%25').replaceAll('#', '%23');
}
