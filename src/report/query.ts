import type { BridgeTarget } from '../exchange/parse.ts';
import { compareStrings } from '../compare.ts';
import type {
  BridgeEndpoint,
  BridgeJoinResult,
  JoinLimitation,
  MatchedBoundaryName,
  UnexportedBoundaryName,
  UnrequiredBoundaryName,
} from '../join/join.ts';
import { isBridgeJoinDeferred } from '../join/join.ts';
import { encodeSortedJson } from './sorted-json.ts';

/** query가 식별한 채널·메서드·모듈·컴포넌트 키다. */
export interface BridgeQuerySubject {
  readonly name: string;
  readonly qualifiedName: string;
  readonly kind: 'channel' | 'method' | 'module' | 'component';
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
  if (isBridgeJoinDeferred(joined)) {
    throw new Error('Cannot query a deferred bridge join.');
  }
  const results = [
    ...channelResults(joined),
    ...methodResults(joined),
    ...nameResults(joined.matchedModules, joined.moduleImportsWithoutExports,
      joined.moduleExportsWithoutImports, 'module'),
    ...nameResults(joined.matchedComponents, joined.componentRequiresWithoutExports,
      joined.componentExportsWithoutRequires, 'component'),
  ];
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
    candidates: [
      ...new Map(
        results.map(({ subject }) => [
          subject.qualifiedName,
          { qualifiedName: subject.qualifiedName },
        ]),
      ).values(),
    ].sort((left, right) => compareStrings(left.qualifiedName, right.qualifiedName)),
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
  const registrations = joined.registrationsWithoutCreations
    .map(({ target, channel, registrations }) =>
      makeQueryResult(target, channel, 'channel', [], registrations),
    );
  return [...matched, ...unregistered, ...registrations];
}

/**
 * 요청 문자열과 정확히 같은 논리 모듈·컴포넌트 이름 결과를 만든다.
 *
 * mechanism이 섞인 이름은 매치·미수출·미호출 컬렉션에 동시에 나타날 수
 * 있으므로 (target, 이름)별로 합친다 — 같은 qualifiedName의 결과가 여럿이면
 * 재질의로도 풀리지 않는 영구 모호 상태가 된다.
 */
function nameResults(
  matched: readonly MatchedBoundaryName[],
  unexported: readonly UnexportedBoundaryName[],
  unrequired: readonly UnrequiredBoundaryName[],
  kind: 'module' | 'component',
): BridgeQueryResult[] {
  const merged = new Map<string, {
    target: BridgeTarget;
    name: string;
    usedBy: BridgeEndpoint[];
    dependsOn: BridgeEndpoint[];
  }>();
  const merge = (
    target: BridgeTarget,
    name: string,
    usedBy: readonly BridgeEndpoint[],
    dependsOn: readonly BridgeEndpoint[],
  ): void => {
    const key = `${target}\u0000${name}`;
    const entry = merged.get(key) ??
      { target, name, usedBy: [], dependsOn: [] };
    entry.usedBy.push(...usedBy);
    entry.dependsOn.push(...dependsOn);
    merged.set(key, entry);
  };
  for (const { target, channel, callers, receivers } of matched) {
    merge(target, channel, callers, receivers);
  }
  for (const { target, channel, callers } of unexported) {
    merge(target, channel, callers, []);
  }
  for (const { target, channel, receivers } of unrequired) {
    merge(target, channel, [], receivers);
  }
  return [...merged.values()].map(({ target, name, usedBy, dependsOn }) =>
    makeQueryResult(target, name, kind, usedBy, dependsOn));
}

/** 조인 키와 양쪽 증거를 query result 골격으로 바꾼다. */
function makeQueryResult(
  target: BridgeTarget,
  name: string,
  kind: 'channel' | 'method' | 'module' | 'component',
  usedBy: readonly BridgeEndpoint[],
  dependsOn: readonly BridgeEndpoint[],
): BridgeQueryResult {
  return {
    subject: {
      name,
      // 모듈·컴포넌트는 kind 세그먼트를 넣어야 같은 이름의 채널·서로 다른 종류와
      // qualifiedName이 충돌하지 않아 모호성을 재질의로 풀 수 있다.
      qualifiedName: kind === 'channel'
        ? `${target}:${encodeSubjectComponent(name)}`
        : `${target}:${kind}:${encodeSubjectComponent(name)}`,
      kind,
    },
    usedBy,
    dependsOn,
  };
}

/**
 * qualifiedName 구분자(:와 #)와 이스케이프 문자(%)를 가역적인 퍼센트 표기로
 * 바꾼다. 세 문자를 모두 이스케이프하므로 첫 `:`와 `#` 기준으로 나눠 되돌릴 수
 * 있다 — 채널·메서드 이름에 `:`가 들어도 소비자의 분해가 모호해지지 않는다.
 */
function encodeSubjectComponent(value: string): string {
  return value
    .replaceAll('%', '%25')
    .replaceAll('#', '%23')
    .replaceAll(':', '%3A');
}
