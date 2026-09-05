import type {
  BridgeFactsDocument,
  BridgeLocation,
  BridgePlatform,
  BridgeSymbol,
  BridgeTarget,
} from '../exchange/parse.ts';
import { compareStrings } from '../compare.ts';
import { isCallerPlatform, isReceiverPlatform } from '../exchange/parse.ts';

/** 한 언어 문서가 제공한 브리지 증거 위치다. */
export interface BridgeEndpoint {
  readonly platform: BridgePlatform;
  readonly location: BridgeLocation;
  readonly symbol?: BridgeSymbol;
}

/** 논리 채널 하나에 모인 양쪽 생성·등록 증거다. */
export interface MatchedChannel {
  readonly target: BridgeTarget;
  readonly channel: string;
  readonly creations: readonly BridgeEndpoint[];
  readonly registrations: readonly BridgeEndpoint[];
}

/** 등록을 찾지 못한 논리 채널과 모든 생성 증거다. */
export interface UnregisteredChannelCreation {
  readonly target: BridgeTarget;
  readonly channel: string;
  readonly creations: readonly BridgeEndpoint[];
}

/** 생성을 찾지 못한 논리 채널과 모든 등록 증거다. */
export interface RegistrationWithoutCreation {
  readonly target: BridgeTarget;
  readonly channel: string;
  readonly registrations: readonly BridgeEndpoint[];
}

/** 논리 메서드 하나에 모인 양쪽 호출·핸들러 증거다. */
export interface MatchedMethod {
  readonly target: BridgeTarget;
  readonly channel: string;
  readonly method: string;
  readonly invocations: readonly BridgeEndpoint[];
  readonly handlers: readonly BridgeEndpoint[];
}

/** 핸들러를 찾지 못한 논리 호출과 모든 호출 증거다. */
export interface UnhandledInvocation {
  readonly target: BridgeTarget;
  readonly channel: string;
  readonly method: string;
  readonly invocations: readonly BridgeEndpoint[];
}

/** 호출자를 찾지 못한 논리 핸들러와 모든 네이티브 증거다. */
export interface HandlerWithoutInvocation {
  readonly target: BridgeTarget;
  readonly channel: string;
  readonly method: string;
  readonly handlers: readonly BridgeEndpoint[];
}

/** 생산 문서가 밝힌 분석 한계와 출처다. */
export interface JoinLimitation {
  readonly platform: BridgePlatform | 'cross-platform';
  readonly tool: string;
  readonly message: string;
}

/** 검증된 교환 문서들의 논리 조인 결과다. */
export interface BridgeJoinResult {
  readonly deferred: boolean;
  readonly matchedChannels: readonly MatchedChannel[];
  readonly unregisteredChannelCreations: readonly UnregisteredChannelCreation[];
  readonly registrationsWithoutCreations: readonly RegistrationWithoutCreation[];
  readonly matchedMethods: readonly MatchedMethod[];
  readonly unhandledInvocations: readonly UnhandledInvocation[];
  readonly handlersWithoutInvocations: readonly HandlerWithoutInvocation[];
  readonly limitations: readonly JoinLimitation[];
}

/** 한 번의 조인에서 허용하는 최대 생산 문서 수다. */
export const MAX_DOCUMENTS_PER_JOIN = 256;

/** 함께 조인할 입력 문서 집합이 논리 계약을 위반했음을 나타낸다. */
export class BridgeJoinValidationError extends Error {
  /** 입력 경로를 노출하지 않는 안전한 메시지를 보존한다. */
  constructor(message: string) {
    super(message);
    this.name = 'BridgeJoinValidationError';
  }
}

/** 위치가 아니라 문자열 키로 검증된 교환 문서를 조인한다. */
export function joinBridgeDocuments(
  documents: readonly BridgeFactsDocument[],
): BridgeJoinResult {
  if (documents.length > MAX_DOCUMENTS_PER_JOIN) {
    throw new BridgeJoinValidationError(
      `Bridge join exceeds the ${MAX_DOCUMENTS_PER_JOIN} document limit.`,
    );
  }
  validateProjects(documents);
  validatePlatformComposition(documents);
  const limitations = collectLimitations(documents);
  if (documents.some(hasMixedTargets)) return emptyJoinResult(limitations);
  const groups = collectChannelGroups(documents);
  const matchedChannels = [...groups.values()]
    .filter((group) => group.creations.length > 0 && group.registrations.length > 0)
    .sort(compareChannels);
  const unregisteredChannelCreations = [...groups.values()]
    .filter((group) => group.creations.length > 0 && group.registrations.length === 0)
    .map(({ target, channel, creations }) => ({ target, channel, creations }))
    .sort(compareChannels);
  const registrationsWithoutCreations = [...groups.values()]
    .filter((group) => group.registrations.length > 0 && group.creations.length === 0)
    .map(({ target, channel, registrations }) => ({
      target,
      channel,
      registrations,
    }))
    .sort(compareChannels);
  const methodGroups = collectMethodGroups(documents);
  const matchedMethods = [...methodGroups.values()]
    .filter((group) => group.invocations.length > 0 && group.handlers.length > 0)
    .sort(compareMethodKeys);
  const unhandledInvocations = [...methodGroups.values()]
    .filter((group) => group.invocations.length > 0 && group.handlers.length === 0)
    .map(({ target, channel, method, invocations }) => ({
      target,
      channel,
      method,
      invocations,
    }))
    .sort(compareMethodKeys);
  const handlersWithoutInvocations = [...methodGroups.values()]
    .filter((group) => group.handlers.length > 0 && group.invocations.length === 0)
    .map(({ target, channel, method, handlers }) => ({
      target,
      channel,
      method,
      handlers,
    }))
    .sort(compareMethodKeys);
  return {
    deferred: false,
    matchedChannels,
    unregisteredChannelCreations,
    registrationsWithoutCreations,
    matchedMethods,
    unhandledInvocations,
    handlersWithoutInvocations,
    limitations,
  };
}

/** 입력 한계 때문에 조인 전체가 보류된 결과인지 확인한다. */
export function isBridgeJoinDeferred(joined: BridgeJoinResult): boolean {
  return joined.deferred;
}

/** 한 번의 조인 입력이 정확히 하나의 project를 기술하는지 검증한다. */
function validateProjects(documents: readonly BridgeFactsDocument[]): void {
  if (new Set(documents.map(({ project }) => project)).size > 1) {
    throw new BridgeJoinValidationError(
      'Bridge documents must describe the same project; regenerate them from one project root.',
    );
  }
}

/** 호출 측·수신 측 문서가 모두 있어야 경계 사실로 조인할 수 있다. */
function validatePlatformComposition(
  documents: readonly BridgeFactsDocument[],
): void {
  const hasCaller = documents.some(({ platform }) => isCallerPlatform(platform));
  const hasReceiver = documents.some(({ platform }) =>
    isReceiverPlatform(platform),
  );
  if (!hasCaller || !hasReceiver) {
    throw new BridgeJoinValidationError(
      'Bridge documents must include at least one caller platform (dart, js) document '
      + 'and one receiver platform (swift, kotlin) document; run a producer for the missing side.',
    );
  }
}

/** 사실별 target이 없는 혼합 문서인지 확인한다. */
function hasMixedTargets(document: BridgeFactsDocument): boolean {
  return document.limitations.some((message) =>
    /mixed-targets\b/i.test(message),
  );
}

/** 안전하게 조인을 보류하면서 입력 한계만 전달한다. */
function emptyJoinResult(limitations: readonly JoinLimitation[]): BridgeJoinResult {
  return {
    deferred: true,
    matchedChannels: [],
    unregisteredChannelCreations: [],
    registrationsWithoutCreations: [],
    matchedMethods: [],
    unhandledInvocations: [],
    handlersWithoutInvocations: [],
    limitations,
  };
}

/** 입력 limitation에 생산 플랫폼과 도구 이름을 붙여 정렬한다. */
function collectLimitations(
  documents: readonly BridgeFactsDocument[],
): JoinLimitation[] {
  const limitations: JoinLimitation[] = documents.flatMap((document) =>
    document.limitations.map((message) => ({
      platform: document.platform,
      tool: document.tool.name,
      message,
    })),
  );
  const freshness = freshnessLimitation(documents);
  if (freshness !== undefined) limitations.push(freshness);
  return limitations.sort(compareLimitations);
}

/** 생성 시각 차이가 하루를 넘을 때 교차 입력 한계를 만든다. */
function freshnessLimitation(
  documents: readonly BridgeFactsDocument[],
): JoinLimitation | undefined {
  if (documents.length < 2) return undefined;
  let earliest = Number.POSITIVE_INFINITY;
  let latest = Number.NEGATIVE_INFINITY;
  for (const document of documents) {
    const timestamp = Date.parse(document.generatedAt);
    earliest = Math.min(earliest, timestamp);
    latest = Math.max(latest, timestamp);
  }
  const difference = latest - earliest;
  if (difference <= millisecondsPerDay) return undefined;
  const hours = Math.round(difference / millisecondsPerHour);
  return {
    platform: 'cross-platform',
    tool: 'isthmus',
    message: `input-freshness: bridge documents differ by ${hours} hours`,
  };
}

/** limitation을 플랫폼·도구·문장 순으로 고정한다. */
function compareLimitations(left: JoinLimitation, right: JoinLimitation): number {
  return (
    compareStrings(left.platform, right.platform) ||
    compareStrings(left.tool, right.tool) ||
    compareStrings(left.message, right.message)
  );
}

/** 메서드 키별로 호출과 핸들러 증거를 모은다. */
function collectMethodGroups(
  documents: readonly BridgeFactsDocument[],
): Map<string, MutableMethodGroup> {
  const groups = new Map<string, MutableMethodGroup>();
  for (const document of documents) collectDocumentMethods(document, groups);
  for (const group of groups.values()) {
    sortUniqueEndpoints(group.invocations);
    sortUniqueEndpoints(group.handlers);
  }
  return groups;
}

/** 증거 위치와 심볼을 정렬하고 같은 증거를 한 번만 남긴다. */
function sortUniqueEndpoints(endpoints: BridgeEndpoint[]): void {
  endpoints.sort(compareEndpoints);
  if (endpoints.length < 2) return;
  let writeIndex = 1;
  for (let readIndex = 1; readIndex < endpoints.length; readIndex++) {
    const previous = endpoints[writeIndex - 1];
    const current = endpoints[readIndex];
    if (
      previous !== undefined &&
      current !== undefined &&
      compareEndpoints(previous, current) !== 0
    ) {
      endpoints[writeIndex] = current;
      writeIndex++;
    }
  }
  endpoints.length = writeIndex;
}

/** 증거 위치와 선택 심볼을 완전한 결정 순서로 비교한다. */
function compareEndpoints(left: BridgeEndpoint, right: BridgeEndpoint): number {
  const locationOrder =
    compareStrings(left.platform, right.platform) ||
    compareStrings(left.location.path, right.location.path) ||
    left.location.line - right.location.line ||
    left.location.column - right.location.column;
  if (locationOrder !== 0) return locationOrder;
  if (left.symbol === undefined) return right.symbol === undefined ? 0 : 1;
  if (right.symbol === undefined) return -1;
  return (
    compareStrings(left.symbol.qualifiedName, right.symbol.qualifiedName) ||
    compareOptionalStrings(left.symbol.usr, right.symbol.usr)
  );
}

/** 존재하는 선택 문자열을 없는 값보다 먼저 두고 비교한다. */
function compareOptionalStrings(
  left: string | undefined,
  right: string | undefined,
): number {
  if (left === undefined) return right === undefined ? 0 : 1;
  if (right === undefined) return -1;
  return compareStrings(left, right);
}

/** 문서 하나의 정적 메서드 사실을 그룹에 추가한다. */
function collectDocumentMethods(
  document: BridgeFactsDocument,
  groups: Map<string, MutableMethodGroup>,
): void {
  if (document.target === null) return;
  for (const fact of document.facts) {
    if (!isStaticMethodFact(fact)) continue;
    const key = `${document.target}\u0000${fact.channel}\u0000${fact.method}`;
    const group = groups.get(key) ?? createMethodGroup(document.target, fact.channel, fact.method);
    const endpoints = fact.kind === 'method-invoke' ? group.invocations : group.handlers;
    endpoints.push(toEndpoint(document.platform, fact));
    groups.set(key, group);
  }
}

/** 조인 가능한 정적 메서드 호출·핸들러 사실인지 확인한다. */
function isStaticMethodFact(
  fact: BridgeFactsDocument['facts'][number],
): fact is BridgeFactsDocument['facts'][number] & {
  channel: string;
  method: string;
} {
  return (
    (fact.kind === 'method-invoke' || fact.kind === 'method-handle') &&
    !fact.dynamic &&
    fact.channel !== null &&
    fact.method !== undefined
  );
}

/** 빈 메서드 그룹을 만든다. */
function createMethodGroup(
  target: BridgeTarget,
  channel: string,
  method: string,
): MutableMethodGroup {
  return { target, channel, method, invocations: [], handlers: [] };
}

/** 채널 키별로 생성과 등록 증거를 모은다. */
function collectChannelGroups(
  documents: readonly BridgeFactsDocument[],
): Map<string, MutableChannelGroup> {
  const groups = new Map<string, MutableChannelGroup>();
  for (const document of documents) collectDocumentChannels(document, groups);
  for (const group of groups.values()) {
    sortUniqueEndpoints(group.creations);
    sortUniqueEndpoints(group.registrations);
  }
  return groups;
}

/** 문서 하나의 정적 채널 사실을 그룹에 추가한다. */
function collectDocumentChannels(
  document: BridgeFactsDocument,
  groups: Map<string, MutableChannelGroup>,
): void {
  if (document.target === null) return;
  for (const fact of document.facts) {
    if (!isStaticChannelFact(fact)) continue;
    const key = `${document.target}\u0000${fact.channel}`;
    const group = groups.get(key) ?? createChannelGroup(document.target, fact.channel);
    const endpoints = fact.kind === 'channel-create' ? group.creations : group.registrations;
    endpoints.push(toEndpoint(document.platform, fact));
    groups.set(key, group);
  }
}

/** 조인 가능한 정적 채널 생성·등록 사실인지 확인한다. */
function isStaticChannelFact(
  fact: BridgeFactsDocument['facts'][number],
): fact is BridgeFactsDocument['facts'][number] & { channel: string } {
  return (
    (fact.kind === 'channel-create' || fact.kind === 'channel-register') &&
    !fact.dynamic &&
    fact.channel !== null
  );
}

/** 빈 채널 그룹을 만든다. */
function createChannelGroup(
  target: BridgeTarget,
  channel: string,
): MutableChannelGroup {
  return { target, channel, creations: [], registrations: [] };
}

/** 사실을 플랫폼이 포함된 증거 위치로 바꾼다. */
function toEndpoint(
  platform: BridgePlatform,
  fact: BridgeFactsDocument['facts'][number],
): BridgeEndpoint {
  return fact.symbol === undefined
    ? { platform, location: fact.location }
    : { platform, location: fact.location, symbol: fact.symbol };
}

/** 채널 결과를 target과 이름 순으로 고정한다. */
function compareChannels(left: ChannelKey, right: ChannelKey): number {
  return (
    compareStrings(left.target, right.target) ||
    compareStrings(left.channel, right.channel)
  );
}

/** 결정적 정렬에 필요한 논리 채널 키다. */
type ChannelKey = Pick<MatchedChannel, 'target' | 'channel'>;

/** 메서드 결과를 target·채널·메서드 순으로 고정한다. */
function compareMethodKeys(left: MethodKey, right: MethodKey): number {
  return (
    compareStrings(left.target, right.target) ||
    compareStrings(left.channel, right.channel) ||
    compareStrings(left.method, right.method)
  );
}

/** 결정적 정렬에 필요한 논리 메서드 키다. */
type MethodKey = Pick<MatchedMethod, 'target' | 'channel' | 'method'>;

/** 조립 중인 채널 증거 그룹이다. */
interface MutableChannelGroup extends MatchedChannel {
  readonly creations: BridgeEndpoint[];
  readonly registrations: BridgeEndpoint[];
}

/** 조립 중인 메서드 증거 그룹이다. */
interface MutableMethodGroup extends MatchedMethod {
  readonly invocations: BridgeEndpoint[];
  readonly handlers: BridgeEndpoint[];
}

const millisecondsPerHour = 60 * 60 * 1_000;
const millisecondsPerDay = 24 * millisecondsPerHour;
