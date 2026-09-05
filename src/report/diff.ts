import type { BridgeFactsDocument, BridgeTarget } from '../exchange/parse.ts';
import { compareStrings } from '../compare.ts';
import { BridgeJoinValidationError, isBridgeJoinDeferred, joinBridgeDocuments } from '../join/join.ts';
import { createCheckReport } from './check-report.ts';

/** 동일 프로젝트의 관찰 결과를 비교하며 삭제 안전성이나 rename을 추측하지 않는다. */
export function createBridgeDiff(
  before: readonly BridgeFactsDocument[],
  after: readonly BridgeFactsDocument[],
) {
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
  const introducedIssues = difference(newReport.issues, oldReport.issues, issueKey);
  const resolvedIssues = difference(oldReport.issues, newReport.issues, issueKey);
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

function issueKey(item: Parameters<typeof logicalKey>[0] & { readonly code: string }): string {
  return JSON.stringify([item.code, logicalKey(item)]);
}

function limitationKey(item: { readonly platform: string; readonly tool: string; readonly message: string }): string {
  return JSON.stringify([item.platform, item.tool, item.message]);
}

/** 키 집합 차이를 안정적으로 정렬하고 원래 증거를 보존한다. */
function difference<T>(left: readonly T[], right: readonly T[], key: (item: T) => string): T[] {
  const existing = new Set(right.map(key));
  return left.filter((item) => !existing.has(key(item)))
    .sort((a, b) => compareStrings(key(a), key(b)));
}
