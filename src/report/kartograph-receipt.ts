import type { KartographReceipt } from '../exchange/kartograph-receipt.ts';
import type { EvidenceObservation } from './task-evidence.ts';

/** 저장된 native 판독·현재 artifact 일치·live 재검증 부재를 각각 보고한다. */
export function compareKartographReceipt(receipt: KartographReceipt, integrity: boolean, observations: readonly EvidenceObservation[]) {
  const reasons = [...receipt.before.reasons, ...receipt.after.reasons, ...receipt.limitations];
  if (!receipt.stableSnapshot) reasons.push('snapshot-changed-during-capture');
  if (!receipt.stableProducer) reasons.push('producer-changed-during-capture');
  if (receipt.witnessCount === 0) reasons.push('missing-build-witness');
  if (!integrity) reasons.push('receipt-digest-mismatch');
  const stale = !receipt.stableSnapshot || !receipt.stableProducer || receipt.before.status === 'stale' || receipt.after.status === 'stale';
  const nativeAtCapture = stale ? 'stale' : reasons.length > 0 || receipt.before.status === 'unverified'
    || receipt.after.status === 'unverified' ? 'unverified' : 'matched';
  const byId = new Map(observations.map((entry) => [entry.id, entry]));
  const artifacts = receipt.artifacts.map((artifact) => {
    const observed = byId.get(`artifact:${artifact.id}`);
    const alignment = !integrity ? 'stale' : observed === undefined ? 'missing' : observed.sha256 !== artifact.sha256
      || observed.role !== artifact.role ? 'stale' : observed.producer === undefined ? 'unverified'
      : observed.producer.name !== receipt.producer.name || observed.producer.version !== receipt.producer.version ? 'stale' : 'matched';
    return { id: artifact.id, alignment };
  });
  return { nativeAtCapture: integrity ? nativeAtCapture : 'unverified', integrity: integrity ? 'matched' : 'stale', currentVerification: 'unverified' as const,
    nativeBefore: receipt.before, nativeAfter: receipt.after,
    scope: receipt.scope, snapshotSha256: receipt.snapshotSha256, producerSha256: receipt.producerSha256,
    reasons: [...new Set(reasons)], artifacts };
}
