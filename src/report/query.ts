import type { BridgeTarget } from '../exchange/parse.ts';
import { compareStrings } from '../compare.ts';
import type {
  BridgeEndpoint,
  BridgeJoinResult,
  JoinLimitation,
  MatchedBoundaryName,
  RelationResolver,
  UnexportedBoundaryName,
  UnrequiredBoundaryName,
} from '../join/join.ts';
import {
  compareEndpoints,
  compareLimitations,
  isBridgeJoinDeferred,
  relationDeclKey,
} from '../join/join.ts';
import type { MessageBridgeJoin } from '../join/messages.ts';
import { messageTarget } from '../exchange/messages.ts';
import type { CheckIssue } from './check-report.ts';
import { createCheckReport, persistenceIssueKeys } from './check-report.ts';
import { encodeSortedJson } from './sorted-json.ts';

/**
 * persistence 관계 주체를 요청하는 접두사다(`relation:users`, `relation:public.users`).
 *
 * bridge 주체와 이름 공간을 나눈다. 이름이 `relation:`으로 시작하는 bridge 채널은
 * 인코딩된 qualifiedName(`flutter:relation%3A…`)으로 계속 질의할 수 있다.
 */
export const RELATION_SUBJECT_PREFIX = 'relation:';

/** query가 식별한 채널·메서드·모듈·컴포넌트·메시지·스트림·관계 키다. */
export interface BridgeQuerySubject {
  readonly name: string;
  readonly qualifiedName: string;
  readonly kind: 'channel' | 'method' | 'module' | 'component' | 'message' | 'stream' | 'event' | 'relation';
}

/** relation 주체의 컬럼 하나에서 본 사용·선언 증거다. 사용이 관찰된 컬럼만 싣는다. */
export interface RelationQueryColumn {
  readonly column: string;
  readonly usedBy: readonly BridgeEndpoint[];
  readonly dependsOn: readonly BridgeEndpoint[];
}

/**
 * 한 브리지 키에서 본 호출 측과 수신 측 증거다.
 *
 * relation 주체에서 `usedBy`는 관계 수준 코드 사용, `dependsOn`은 카탈로그 선언이다.
 * `columns`와 `issues`는 relation 주체에만 실린다 — bridge 주체의 출력은 그대로다.
 */
export interface BridgeQueryResult {
  readonly subject: BridgeQuerySubject;
  readonly usedBy: readonly BridgeEndpoint[];
  readonly dependsOn: readonly BridgeEndpoint[];
  readonly columns?: readonly RelationQueryColumn[];
  readonly issues?: readonly CheckIssue[];
}

/** cartograph query와 같은 상태 외피를 쓰는 브리지 질의 문서다. */
export interface BridgeQueryDocument {
  readonly status: 'found' | 'ambiguous' | 'notFound';
  readonly requested: string;
  /** bridge 주체는 `bridge`, relation 주체는 `persistence`다. */
  readonly level: 'bridge' | 'persistence';
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

/**
 * 조인된 브리지에서 채널 또는 메서드 문자열을 질의한다.
 *
 * `messages`를 주면 BasicMessageChannel·EventChannel 경계도 `message`·`stream`
 * 주체로 질의할 수 있다. v1 채널과 이름이 같아도 qualifiedName의 kind 세그먼트로
 * 구분된다.
 */
export function createBridgeQuery(
  joined: BridgeJoinResult,
  requested: string,
  messages?: MessageBridgeJoin,
): BridgeQueryDocument {
  if (isBridgeJoinDeferred(joined)) {
    throw new Error('Cannot query a deferred bridge join.');
  }
  const limitations = messages === undefined
    ? joined.limitations
    : [...joined.limitations, ...messages.limitations].sort(compareLimitations);
  const results = [
    ...channelResults(joined),
    ...methodResults(joined),
    ...nameResults(joined.matchedModules, joined.moduleImportsWithoutExports,
      joined.moduleExportsWithoutImports, 'module'),
    ...nameResults(joined.matchedComponents, joined.componentRequiresWithoutExports,
      joined.componentExportsWithoutRequires, 'component'),
    ...(messages === undefined ? [] : messageResults(messages)),
  ];
  const exact = results.filter(
    ({ subject }) => subject.qualifiedName === requested,
  );
  if (exact.length > 1) return ambiguousQuery(limitations, requested, exact);
  if (exact[0] !== undefined) return foundQuery(limitations, requested, exact[0]);

  const named = results.filter(({ subject }) => subject.name === requested);
  if (named.length > 1) return ambiguousQuery(limitations, requested, named);
  if (named[0] !== undefined) return foundQuery(limitations, requested, named[0]);
  return {
    status: 'notFound',
    requested,
    level: 'bridge',
    limitations,
  };
}

/**
 * persistence 관계 하나를 조인과 같은 해석 규칙으로 질의한다.
 *
 * 한정 이름은 정확히 같은 선언만, 비한정 이름은 마지막 세그먼트가 같은 선언이 하나일
 * 때만 찾고, 여럿이면 추측하지 않고 후보 선언으로 모호함을 돌려준다. 선언이 없어도 같은
 * 이름의 코드 사용이 관찰됐으면 선언 없는 관계로 찾는다(`relation-use-without-decl`).
 * 선언도 사용도 없으면 notFound다. 진단은 check 정책 그대로 이 관계에 속한 것만 싣는다.
 */
export function createRelationQuery(
  joined: BridgeJoinResult,
  resolver: RelationResolver,
  requested: string,
): BridgeQueryDocument {
  if (isBridgeJoinDeferred(joined)) {
    throw new Error('Cannot query a deferred bridge join.');
  }
  const name = requested.slice(RELATION_SUBJECT_PREFIX.length);
  const envelope = { requested, level: 'persistence' as const, limitations: joined.limitations };
  const resolution = resolver.resolveUse(name);
  if (resolution.status === 'ambiguous') {
    return {
      status: 'ambiguous', ...envelope,
      candidates: resolution.candidates.map((candidate) => ({
        qualifiedName: `${RELATION_SUBJECT_PREFIX}${candidate}`,
      })),
    };
  }
  const identity = resolver.useKey(name);
  const issues = createCheckReport(joined).issues.filter((issue) => issue.target === 'persistence' &&
    persistenceIssueKeys(issue, resolver).relations.includes(identity));
  const result = resolution.status === 'resolved'
    ? declaredRelationResult(joined, name, resolution.channel, issues)
    : undeclaredRelationResult(joined, resolver, name, identity, issues);
  return result === undefined ? { status: 'notFound', ...envelope } : { status: 'found', ...envelope, result };
}

/** 선언으로 해석된 관계의 관계·컬럼 사용과 선언을 모은다. 여러 사용 버킷을 합친다. */
function declaredRelationResult(
  joined: BridgeJoinResult,
  name: string,
  declChannel: string,
  issues: readonly CheckIssue[],
): BridgeQueryResult {
  const matched = joined.matchedRelations.filter(({ channel }) => channel === declChannel);
  const decls = matched[0]?.decls ??
    joined.relationDeclsWithoutUses.find(({ channel }) => channel === declChannel)?.decls ?? [];
  const columns = new Map<string, { column: string; usedBy: BridgeEndpoint[]; dependsOn: BridgeEndpoint[] }>();
  const columnEvidence = [
    ...joined.matchedColumns,
    ...joined.columnUsesWithoutDecls.map((item) => ({ ...item, decls: [] })),
  ].filter(({ channel }) => channel === declChannel);
  for (const { column, uses, decls: columnDecls } of columnEvidence) {
    // 대소문자만 다른 컬럼 철자는 조인과 같이 한 컬럼으로 합치고 최소 철자를 보고한다.
    const key = relationDeclKey(declChannel, column);
    const entry = columns.get(key) ?? { column, usedBy: [], dependsOn: [] };
    if (compareStrings(column, entry.column) < 0) entry.column = column;
    entry.usedBy.push(...uses);
    entry.dependsOn.push(...columnDecls);
    columns.set(key, entry);
  }
  return {
    subject: relationSubject(name, declChannel),
    usedBy: uniqueSortedEndpoints(matched.flatMap(({ uses }) => uses)),
    dependsOn: uniqueSortedEndpoints(decls),
    columns: [...columns.values()]
      .map(({ column, usedBy, dependsOn }) => ({
        column, usedBy: uniqueSortedEndpoints(usedBy), dependsOn: uniqueSortedEndpoints(dependsOn),
      }))
      .sort((left, right) => compareStrings(left.column, right.column)),
    issues,
  };
}

/** 선언이 없는 이름이 코드에서 관찰됐으면 그 사용을 결과로, 아니면 undefined를 돌려준다. */
function undeclaredRelationResult(
  joined: BridgeJoinResult,
  resolver: RelationResolver,
  name: string,
  identity: string,
  issues: readonly CheckIssue[],
): BridgeQueryResult | undefined {
  // 사용 버킷(한정 여부 + 접은 이름)이 같은 항목은 조인 결과에 하나뿐이다.
  const undeclared = joined.relationUsesWithoutDecls
    .find(({ channel }) => resolver.useKey(channel) === identity);
  if (undeclared === undefined) return undefined;
  return {
    subject: relationSubject(name, undeclared.channel),
    usedBy: uniqueSortedEndpoints(undeclared.uses),
    dependsOn: [],
    columns: [],
    issues,
  };
}

/** relation 주체다. qualifiedName은 그대로 다시 질의하면 같은 관계로 해석되는 형태다. */
function relationSubject(name: string, channel: string): BridgeQuerySubject {
  return { name, qualifiedName: `${RELATION_SUBJECT_PREFIX}${channel}`, kind: 'relation' };
}

/** 여러 조인 항목에서 모은 끝점을 조인과 같은 순서로 정렬하고 중복을 없앤다. */
function uniqueSortedEndpoints(endpoints: readonly BridgeEndpoint[]): BridgeEndpoint[] {
  const sorted = [...endpoints].sort(compareEndpoints);
  return sorted.filter((endpoint, index) =>
    index === 0 || compareEndpoints(sorted[index - 1]!, endpoint) !== 0);
}

/** 유일하게 식별된 논리 키와 증거를 found 문서로 감싼다. */
function foundQuery(
  limitations: readonly JoinLimitation[],
  requested: string,
  result: BridgeQueryResult,
): BridgeQueryDocument {
  return {
    status: 'found',
    requested,
    level: 'bridge',
    limitations,
    result,
  };
}

/** 여러 논리 키가 같은 요청과 맞을 때 선택 가능한 정규화 이름을 돌려준다. */
function ambiguousQuery(
  limitations: readonly JoinLimitation[],
  requested: string,
  results: readonly BridgeQueryResult[],
): BridgeQueryDocument {
  return {
    status: 'ambiguous',
    requested,
    level: 'bridge',
    limitations,
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

/** v2 메시지·스트림 경계를 query result로 만든다. 양쪽 증거를 그대로 보존한다. */
function messageResults(messages: MessageBridgeJoin): BridgeQueryResult[] {
  return messages.routes.map((route) => {
    const kind = route.transport === 'react-native-event' ? 'event' : route.transport === 'event-channel' ? 'stream' : 'message';
    return {
      subject: {
        name: route.channel,
        qualifiedName: `${messageTarget(route.transport)}:${kind}:${encodeSubjectComponent(route.channel)}`,
        kind,
      },
      usedBy: route.senders,
      dependsOn: route.handlers,
    } satisfies BridgeQueryResult;
  });
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
    // 합침 키의 NUL 구분자는 파서가 이름의 제어문자를 거부한다는 데 의존한다 —
    // parse를 우회해 조립하는 경로가 생기면 이 구분자는 안전하지 않다.
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
