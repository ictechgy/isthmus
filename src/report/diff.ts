import type { BridgeFactsDocument, BridgeTarget } from '../exchange/parse.ts';
import { isCallerPlatform, isReceiverPlatform } from '../exchange/parse.ts';
import { compareStrings } from '../compare.ts';
import type {
  BridgeJoinResult,
  JoinLimitation,
  MatchedBoundaryName,
  MatchedMethod,
} from '../join/join.ts';
import { BridgeJoinValidationError, isBridgeJoinDeferred, joinBridgeDocuments } from '../join/join.ts';
import type { BridgeMessageDocument } from '../exchange/messages.ts';
import type { MessageBridgeJoin, MessageBridgeRoute } from '../join/messages.ts';
import { joinMessageBridges } from '../join/messages.ts';
import type { CheckIssue } from './check-report.ts';
import { baselineEntryKey } from './baseline.ts';
import { createCheckReport } from './check-report.ts';

/** 두 스냅샷의 생산 도구 버전 근거다. */
export interface DiffProducerVersion {
  readonly platform: string;
  readonly name: string;
  readonly version: string;
  readonly generatedAt: string;
  readonly sourceModifiedAt?: string;
}

/**
 * 동일 프로젝트의 전후 관찰을 비교한 isthmus-diff 문서다.
 *
 * added/removed는 키 집합 차이라 소스 줄 이동은 차이가 아니다. introduced와
 * resolved는 논리 이슈 키 기준이라 코드가 바뀌면(-unverified → 본 판정)
 * 해결·추가 한 쌍으로 보인다 — 심각도 상승은 새 관찰이기 때문이다.
 */
export interface BridgeDiffDocument {
  readonly format: 'isthmus-diff';
  readonly version: 1;
  readonly summary: {
    readonly addedMethods: number;
    readonly removedMethods: number;
    readonly addedModules: number;
    readonly removedModules: number;
    readonly addedComponents: number;
    readonly removedComponents: number;
    readonly introducedErrors: number;
    readonly introducedWarnings: number;
    readonly resolvedIssues: number;
    /** `messages` 입력이 있을 때만 실린다 — literal로 확정된 v2 경계 수다. */
    readonly addedMessageBoundaries?: number;
    readonly removedMessageBoundaries?: number;
  };
  readonly addedMethods: readonly MatchedMethod[];
  readonly removedMethods: readonly MatchedMethod[];
  readonly addedModules: readonly MatchedBoundaryName[];
  readonly removedModules: readonly MatchedBoundaryName[];
  readonly addedComponents: readonly MatchedBoundaryName[];
  readonly removedComponents: readonly MatchedBoundaryName[];
  /** `messages` 입력이 있을 때만 실리는 literal v2 경계다. */
  readonly addedMessageBoundaries?: readonly MessageBridgeRoute[];
  readonly removedMessageBoundaries?: readonly MessageBridgeRoute[];
  readonly introducedIssues: readonly CheckIssue[];
  readonly resolvedIssues: readonly CheckIssue[];
  readonly limitations: {
    readonly before: readonly JoinLimitation[];
    readonly after: readonly JoinLimitation[];
    readonly added: readonly JoinLimitation[];
    readonly removed: readonly JoinLimitation[];
  };
  readonly producers: {
    readonly before: readonly DiffProducerVersion[];
    readonly after: readonly DiffProducerVersion[];
  };
}

/**
 * 동일 프로젝트의 관찰 결과를 비교하며 삭제 안전성이나 rename을 추측하지 않는다.
 *
 * `beforeMessages`·`afterMessages`를 주면 Basic·Event v2 경계도 비교한다. 두 스냅샷
 * 모두 있어야 하며 transport 집합이 같아야 한다 — 한쪽만 있으면 관찰 차이가 아니라
 * 입력 구성 차이다.
 */
export function createBridgeDiff(
  before: readonly BridgeFactsDocument[],
  after: readonly BridgeFactsDocument[],
  beforeMessages?: readonly BridgeMessageDocument[],
  afterMessages?: readonly BridgeMessageDocument[],
): BridgeDiffDocument {
  validateSnapshots(before, after);
  validateMessageSnapshots(beforeMessages, afterMessages);
  const project = before[0]?.project ?? after[0]!.project;
  const oldJoin = joinBridgeDocuments(before);
  const newJoin = joinBridgeDocuments(after);
  if (isBridgeJoinDeferred(oldJoin) || isBridgeJoinDeferred(newJoin)) {
    throw new BridgeJoinValidationError(
      'Cannot compare deferred bridge joins; split mixed bridge targets and '
      + `retry. The before inputs observed ${oldJoin.observedFacts} facts across `
      + `${before.length} documents, and the after inputs observed `
      + `${newJoin.observedFacts} facts across ${after.length} documents.`,
    );
  }
  const oldMessages = beforeMessages === undefined
    ? undefined
    : joinMessageBridges(beforeMessages, project);
  const newMessages = afterMessages === undefined
    ? undefined
    : joinMessageBridges(afterMessages, project);
  const oldReport = createCheckReport(oldJoin, oldMessages);
  const newReport = createCheckReport(newJoin, newMessages);
  const addedMethods = difference(newJoin.matchedMethods, oldJoin.matchedMethods, logicalKey);
  const removedMethods = difference(oldJoin.matchedMethods, newJoin.matchedMethods, logicalKey);
  const addedModules = difference(newJoin.matchedModules, oldJoin.matchedModules, logicalKey);
  const removedModules = difference(oldJoin.matchedModules, newJoin.matchedModules, logicalKey);
  const addedComponents = difference(newJoin.matchedComponents, oldJoin.matchedComponents, logicalKey);
  const removedComponents = difference(oldJoin.matchedComponents, newJoin.matchedComponents, logicalKey);
  const introducedIssues = difference(newReport.issues, oldReport.issues, baselineEntryKey);
  const resolvedIssues = difference(oldReport.issues, newReport.issues, baselineEntryKey);
  const messageBoundaries = oldMessages === undefined || newMessages === undefined
    ? {}
    : {
        addedMessageBoundaries: difference(matchedMessageRoutes(newMessages),
          matchedMessageRoutes(oldMessages), messageBoundaryKey),
        removedMessageBoundaries: difference(matchedMessageRoutes(oldMessages),
          matchedMessageRoutes(newMessages), messageBoundaryKey),
      };
  return {
    format: 'isthmus-diff' as const,
    version: 1 as const,
    summary: {
      addedMethods: addedMethods.length,
      removedMethods: removedMethods.length,
      addedModules: addedModules.length,
      removedModules: removedModules.length,
      addedComponents: addedComponents.length,
      removedComponents: removedComponents.length,
      introducedErrors: introducedIssues.filter((issue) => issue.severity === 'error').length,
      introducedWarnings: introducedIssues.filter((issue) => issue.severity === 'warning').length,
      resolvedIssues: resolvedIssues.length,
      ...(oldMessages === undefined || newMessages === undefined ? {} : {
        addedMessageBoundaries: matchedMessageBoundaryCount(newMessages, oldMessages),
        removedMessageBoundaries: matchedMessageBoundaryCount(oldMessages, newMessages),
      }),
    },
    addedMethods,
    removedMethods,
    addedModules,
    removedModules,
    addedComponents,
    removedComponents,
    ...messageBoundaries,
    introducedIssues,
    resolvedIssues,
    limitations: {
      before: oldReport.limitations,
      after: newReport.limitations,
      added: difference(newReport.limitations, oldReport.limitations, limitationKey),
      removed: difference(oldReport.limitations, newReport.limitations, limitationKey),
    },
    producers: { before: producerVersions(before), after: producerVersions(after) },
  };
}

/** literal로 양쪽이 관찰된 v2 경계만 돌려준다 — 후보 prefix는 확정 매치가 아니다. */
function matchedMessageRoutes(messages: MessageBridgeJoin): readonly MessageBridgeRoute[] {
  return messages.routes.filter((route) =>
    route.matching === 'literal' && route.senders.length > 0 && route.handlers.length > 0);
}

/** 두 스냅샷의 literal v2 경계 키를 비교해 추가된 수를 센다. */
function matchedMessageBoundaryCount(
  left: MessageBridgeJoin,
  right: MessageBridgeJoin,
): number {
  return difference(matchedMessageRoutes(left), matchedMessageRoutes(right), messageBoundaryKey).length;
}

/** v2 경계는 transport·주소로만 식별한다 — 같은 채널 이름이라도 transport가 다르다. */
function messageBoundaryKey(route: MessageBridgeRoute): string {
  return JSON.stringify([route.transport, route.channel]);
}

/**
 * v2 입력은 두 스냅샷 모두 있거나 모두 없어야 하며, transport 집합이 같아야 한다.
 *
 * 한쪽에만 v2가 있으면 그 transport의 경계 전부가 추가·삭제로 보인다 — 관찰 차이가
 * 아니라 입력 구성 차이므로 입력 오류로 거부한다.
 */
function validateMessageSnapshots(
  before: readonly BridgeMessageDocument[] | undefined,
  after: readonly BridgeMessageDocument[] | undefined,
): void {
  if (before === undefined && after === undefined) return;
  if (before === undefined || after === undefined) {
    throw new BridgeJoinValidationError(
      'Diff message inputs must be present in both snapshots; rebuild both from one checkout.',
    );
  }
  const transports = (docs: readonly BridgeMessageDocument[]): string =>
    JSON.stringify([...new Set(docs.map(({ transport }) => transport))].sort(compareStrings));
  if (transports(before) !== transports(after)) {
    throw new BridgeJoinValidationError(
      'Diff message inputs must observe the same transports in both snapshots.',
    );
  }
}

/** 플랫폼 누락이나 다른 프로젝트를 코드 삭제로 오해하지 않도록 입력 구성을 고정한다. */
function validateSnapshots(before: readonly BridgeFactsDocument[], after: readonly BridgeFactsDocument[]): void {
  const all = [...before, ...after];
  if (new Set(all.map((doc) => doc.project)).size !== 1 ||
    new Set(all.filter((doc) => isReceiverPlatform(doc.platform)).map((doc) => doc.platform)).size !== 1 ||
    ![before, after].every((docs) => docs.some((doc) => isCallerPlatform(doc.platform)) &&
      docs.some((doc) => isReceiverPlatform(doc.platform))) ||
    JSON.stringify(producerInventory(before)) !== JSON.stringify(producerInventory(after)) ||
    JSON.stringify(snapshotTargets(before)) !== JSON.stringify(snapshotTargets(after)) ||
    all.some((doc) => !isCallerPlatform(doc.platform) && !isReceiverPlatform(doc.platform))) {
    throw new BridgeJoinValidationError(
      'Diff requires the same project, the same bridge targets, and matching '
      + 'caller/native producer inventories in both snapshots; rebuild both '
      + 'snapshots from one checkout.',
    );
  }
}

/**
 * 스냅샷이 관찰한 브리지 target 집합을 정렬해 돌려준다.
 *
 * target 집합이 다른 두 시점을 비교하면 한쪽 target의 사실 전부가 삭제·추가로
 * 보이므로 관찰 차이가 아니라 입력 구성 차이다. 사실이 없는 문서의 null target은
 * 집합에 넣지 않는다.
 */
function snapshotTargets(docs: readonly BridgeFactsDocument[]): BridgeTarget[] {
  return [...new Set(docs.flatMap((doc) => doc.target === null ? [] : [doc.target]))]
    .sort(compareStrings);
}

/** 버전 변화는 출력하되 플랫폼·도구별 문서 개수 변화는 허용하지 않는다. */
function producerInventory(docs: readonly BridgeFactsDocument[]): string[] {
  return docs.map((doc) => JSON.stringify([doc.platform, doc.tool.name])).sort(compareStrings);
}

/** 추출기 업그레이드가 관찰 차이의 원인인지 검토할 버전 근거다. */
function producerVersions(docs: readonly BridgeFactsDocument[]) {
  return docs.map((doc) => ({ platform: doc.platform, ...doc.tool, generatedAt: doc.generatedAt,
    ...(doc.sourceModifiedAt === undefined ? {} : { sourceModifiedAt: doc.sourceModifiedAt }) }))
    .sort((a, b) => compareStrings(JSON.stringify(a), JSON.stringify(b)));
}

/** 충돌 없는 논리 키로 비교해 소스 줄 이동을 추가·삭제로 보고하지 않는다. */
function logicalKey(item: { readonly target: BridgeTarget; readonly channel: string; readonly method?: string }): string {
  return JSON.stringify([item.target, item.channel, item.method ?? null]);
}

function limitationKey(item: { readonly platform: string; readonly target: string | null; readonly tool: string; readonly message: string; readonly channels?: readonly string[]; readonly origin?: 'consumer' }): string {
  return JSON.stringify([item.platform, item.target, item.tool, item.message, item.channels ?? null, item.origin ?? null]);
}

/** 키 집합 차이를 안정적으로 정렬하고 원래 증거를 보존한다. */
function difference<T>(left: readonly T[], right: readonly T[], key: (item: T) => string): T[] {
  const existing = new Set(right.map(key));
  return left.filter((item) => !existing.has(key(item)))
    .sort((a, b) => compareStrings(key(a), key(b)));
}
