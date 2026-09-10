import type { BridgeFactsDocument, BridgeTarget } from '../exchange/parse.ts';
import { compareStrings } from '../compare.ts';
import type {
  BridgeJoinResult,
  JoinLimitation,
  MatchedMethod,
} from '../join/join.ts';
import { BridgeJoinValidationError, isBridgeJoinDeferred, joinBridgeDocuments } from '../join/join.ts';
import type { CheckIssue } from './check-report.ts';
import { baselineEntryKey } from './baseline.ts';
import { createCheckReport } from './check-report.ts';

/** 두 스냅샷의 생산 도구 버전 근거다. */
export interface DiffProducerVersion {
  readonly platform: string;
  readonly name: string;
  readonly version: string;
  readonly generatedAt: string;
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
    readonly introducedErrors: number;
    readonly introducedWarnings: number;
    readonly resolvedIssues: number;
  };
  readonly addedMethods: readonly MatchedMethod[];
  readonly removedMethods: readonly MatchedMethod[];
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

/** 동일 프로젝트의 관찰 결과를 비교하며 삭제 안전성이나 rename을 추측하지 않는다. */
export function createBridgeDiff(
  before: readonly BridgeFactsDocument[],
  after: readonly BridgeFactsDocument[],
): BridgeDiffDocument {
  validateSnapshots(before, after);
  const oldJoin = joinBridgeDocuments(before);
  const newJoin = joinBridgeDocuments(after);
  if (isBridgeJoinDeferred(oldJoin) || isBridgeJoinDeferred(newJoin)) {
    throw new BridgeJoinValidationError(
      'Cannot compare deferred bridge joins; split mixed bridge targets and retry.',
    );
  }
  const oldReport = createCheckReport(oldJoin);
  const newReport = createCheckReport(newJoin);
  const addedMethods = difference(newJoin.matchedMethods, oldJoin.matchedMethods, logicalKey);
  const removedMethods = difference(oldJoin.matchedMethods, newJoin.matchedMethods, logicalKey);
  const introducedIssues = difference(newReport.issues, oldReport.issues, baselineEntryKey);
  const resolvedIssues = difference(oldReport.issues, newReport.issues, baselineEntryKey);
  return {
    format: 'isthmus-diff' as const,
    version: 1 as const,
    summary: {
      addedMethods: addedMethods.length,
      removedMethods: removedMethods.length,
      introducedErrors: introducedIssues.filter((issue) => issue.severity === 'error').length,
      introducedWarnings: introducedIssues.filter((issue) => issue.severity === 'warning').length,
      resolvedIssues: resolvedIssues.length,
    },
    addedMethods,
    removedMethods,
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

/** 플랫폼 누락이나 다른 프로젝트를 코드 삭제로 오해하지 않도록 입력 구성을 고정한다. */
function validateSnapshots(before: readonly BridgeFactsDocument[], after: readonly BridgeFactsDocument[]): void {
  const all = [...before, ...after];
  if (new Set(all.map((doc) => doc.project)).size !== 1 ||
    ![before, after].every((docs) => docs.some((doc) => doc.platform === 'dart') &&
      docs.some((doc) => doc.platform === 'swift')) ||
    JSON.stringify(producerInventory(before)) !== JSON.stringify(producerInventory(after)) ||
    all.some((doc) => (doc.platform !== 'dart' && doc.platform !== 'swift') ||
      (doc.target !== null && doc.target !== 'flutter'))) {
    throw new BridgeJoinValidationError(
      'Diff requires the same project and matching Flutter dart/swift producer '
      + 'inventories in both snapshots; rebuild both snapshots from one checkout.',
    );
  }
}

/** 버전 변화는 출력하되 플랫폼·도구별 문서 개수 변화는 허용하지 않는다. */
function producerInventory(docs: readonly BridgeFactsDocument[]): string[] {
  return docs.map((doc) => JSON.stringify([doc.platform, doc.tool.name])).sort(compareStrings);
}

/** 추출기 업그레이드가 관찰 차이의 원인인지 검토할 버전 근거다. */
function producerVersions(docs: readonly BridgeFactsDocument[]) {
  return docs.map((doc) => ({ platform: doc.platform, ...doc.tool, generatedAt: doc.generatedAt }))
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
