import { createJsonGuards } from './json-guards.ts';
import { TaskEvidenceError } from './task-evidence.ts';
import type { EvidenceProducer, EvidenceRole } from './task-evidence.ts';

/** Kartograph native verifier의 상태를 바꾸지 않고 전달한다. */
export interface KartographFreshness { readonly status: 'matched' | 'stale' | 'unverified'; readonly reasons: readonly string[] }

/** 실제 수집 경계에서 같은 snapshot으로 실행한 native 결과와 생성 바이트를 묶는다. */
export interface KartographReceipt {
  readonly producer: EvidenceProducer;
  readonly scope: string;
  readonly snapshotSha256: string;
  readonly producerSha256: string;
  readonly witnessCount: number;
  readonly before: KartographFreshness;
  readonly after: KartographFreshness;
  readonly stableSnapshot: boolean;
  readonly stableProducer: boolean;
  readonly limitations: readonly string[];
  readonly artifacts: ReadonlyArray<{ readonly id: string; readonly role: EvidenceRole; readonly sha256: string }>;
}
function fail(message: string): never { throw new TaskEvidenceError(message); }
const guard = createJsonGuards(fail);
const safe = (value: unknown): string => {
  const text = guard.safe(value, 'Invalid Kartograph receipt identifier.');
  if (text.length > 1024) fail('Kartograph receipt identifier exceeds its limit.');
  return text;
};
const digest = (value: unknown): string => {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) fail('Invalid Kartograph receipt digest.');
  return value;
};

/** matched와 실패 원인이 동시에 있는 모순을 허용하지 않는다. */
export function parseKartographFreshness(value: unknown): KartographFreshness {
  const raw = guard.object(value, 'Invalid Kartograph freshness report.');
  if (raw.format !== 'kartograph-freshness' || raw.version !== 1 || typeof raw.status !== 'string' ||
    !['matched', 'stale', 'unverified'].includes(raw.status)) fail('Unsupported Kartograph freshness report.');
  const reasons = guard.array(raw.reasons, 100, 'Too many Kartograph freshness reasons.').map(safe);
  if ((raw.status === 'matched') !== (reasons.length === 0)) fail('Contradictory Kartograph freshness status and reasons.');
  return { status: raw.status as KartographFreshness['status'], reasons };
}

/** snapshot/lifecycle 검증을 복제하지 않고 bounded 수집 영수증만 파싱한다. */
export function parseKartographReceipt(value: unknown): KartographReceipt {
  const raw = guard.object(value, 'Invalid Kartograph capture receipt.');
  if (raw.format !== 'isthmus-kartograph-receipt' || raw.version !== 1) fail('Unsupported Kartograph capture receipt.');
  const producer = guard.object(raw.producer, 'Invalid Kartograph receipt producer.');
  if (producer.name !== 'kartograph') fail('Kartograph receipt producer must be kartograph.');
  if (typeof raw.scope !== 'string' || !/^[A-Za-z0-9_.:-]{1,200}$/u.test(raw.scope)) fail('Invalid Kartograph receipt scope.');
  if (!Number.isSafeInteger(raw.witnessCount) || (raw.witnessCount as number) < 0 || (raw.witnessCount as number) > 512) {
    fail('Invalid Kartograph witness count.');
  }
  if (typeof raw.stableSnapshot !== 'boolean' || typeof raw.stableProducer !== 'boolean') fail('Invalid Kartograph capture boundaries.');
  const ids = new Set<string>();
  const artifacts = guard.array(raw.artifacts, 512, 'Too many Kartograph artifacts.').map((entry) => {
    const item = guard.object(entry, 'Invalid Kartograph receipt artifact.');
    const id = safe(item.id);
    if (ids.has(id)) fail('Duplicate Kartograph receipt artifact.');
    ids.add(id);
    if (item.role !== 'bridge-facts' && item.role !== 'traversal') fail('Invalid Kartograph receipt artifact role.');
    return { id, role: item.role as EvidenceRole, sha256: digest(item.sha256) };
  });
  return { producer: { name: 'kartograph', version: safe(producer.version) }, scope: safe(raw.scope),
    snapshotSha256: digest(raw.snapshotSha256), producerSha256: digest(raw.producerSha256),
    witnessCount: raw.witnessCount as number, before: parseKartographFreshness(raw.before), after: parseKartographFreshness(raw.after),
    stableSnapshot: raw.stableSnapshot, stableProducer: raw.stableProducer,
    limitations: guard.array(raw.limitations, 100, 'Too many Kartograph receipt limitations.').map(safe), artifacts };
}
