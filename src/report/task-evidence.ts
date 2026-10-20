import type { EvidenceArtifact, EvidenceInput, EvidenceManifest, EvidenceProducer, EvidenceRole } from '../exchange/task-evidence.ts';
import type { compareKartographReceipt } from './kartograph-receipt.ts';

/** 내용 불일치와 확인 불가능·누락을 구분한다. matched는 선언/바이트 일치만 뜻한다. */
export type EvidenceAlignment = 'matched' | 'stale' | 'missing' | 'unverified';

/** CLI가 실제 소비한 입력의 바이트와 헤더다. 파일 접근·해싱은 CLI가 맡는다. */
export interface EvidenceObservation {
  readonly artifact?: EvidenceArtifact;
  readonly id: string;
  readonly role: EvidenceRole;
  readonly sha256: string;
  readonly producer?: EvidenceProducer;
  readonly revision?: string;
}

/** 경로 대신 manifest id 또는 입력 순번과 불일치 필드를 보고한다. */
export interface EvidenceResult {
  readonly id: string;
  readonly alignment: EvidenceAlignment;
  readonly reasons: readonly string[];
  readonly observed?: Omit<EvidenceObservation, 'artifact' | 'id'>;
  readonly declared?: Omit<EvidenceArtifact, 'path' | 'id'>;
}

/** 전체 결과는 목록이 잘려도 상태·개수가 변하지 않는다. */
export interface TaskEvidenceReport {
  readonly alignment: EvidenceAlignment;
  readonly verification: 'unverified';
  readonly basis: 'caller-declared';
  readonly expected?: EvidenceInput;
  readonly summary: Readonly<Record<EvidenceAlignment, number>>;
  readonly artifacts: readonly EvidenceResult[];
  readonly kartograph?: ReturnType<typeof compareKartographReceipt>;
}

const stateFields: readonly (keyof EvidenceInput)[] = ['captureId', 'repository', 'commit', 'dirty', 'toolchainDigest',
  'buildConfigurationDigest'];

/** 시각을 사용하지 않고 알려진 불일치를 우선하며 빠진 provenance를 상속하지 않는다. */
export function compareTaskEvidence(manifest: EvidenceManifest | undefined,
  observations: readonly EvidenceObservation[], unused: readonly EvidenceArtifact[] = []): TaskEvidenceReport {
  const artifacts = observations.map((observation): EvidenceResult => {
    const { artifact, id, ...observed } = observation;
    const detail = { observed, ...(artifact === undefined ? {} : { declared: declaredEvidence(artifact) }) };
    if (manifest === undefined || artifact === undefined) return { id, alignment: 'missing', reasons: ['artifact-provenance-missing'], ...detail };
    const stale: string[] = [];
    const unknown: string[] = [];
    const missing: string[] = [];
    if (observation.sha256 !== artifact.sha256) stale.push('artifact-digest');
    if (observation.role !== artifact.role) stale.push('artifact-role');
    if (observation.revision !== undefined && observation.revision !== manifest.expected.commit) stale.push('artifact-revision');
    if (artifact.input === undefined) missing.push('artifact-input-missing');
    else {
      for (const field of stateFields) if (artifact.input[field] !== manifest.expected[field]) stale.push(field);
      if (artifact.input.sourceDigestScheme !== manifest.expected.sourceDigestScheme) unknown.push('source-digest-scheme');
      else if (artifact.input.sourceDigest !== manifest.expected.sourceDigest) stale.push('sourceDigest');
    }
    if (observation.role !== 'trace-context') {
      if (observation.producer === undefined || artifact.producer === undefined) unknown.push('producer-unverified');
      else if (observation.producer.name !== artifact.producer.name || observation.producer.version !== artifact.producer.version) {
        stale.push('producer');
      }
    }
    return { id, alignment: stale.length > 0 ? 'stale' : missing.length > 0 ? 'missing' : unknown.length > 0 ? 'unverified' : 'matched',
      reasons: [...stale, ...missing, ...unknown], ...detail };
  });
  for (const artifact of unused) artifacts.push({ id: `artifact:${artifact.id}`, alignment: 'unverified',
    reasons: ['artifact-not-consumed'], declared: declaredEvidence(artifact) });
  const summary: Record<EvidenceAlignment, number> = { matched: 0, stale: 0, missing: 0, unverified: 0 };
  for (const artifact of artifacts) summary[artifact.alignment]++;
  return { alignment: summary.stale > 0 ? 'stale' : manifest === undefined || summary.missing > 0 ? 'missing'
    : summary.unverified > 0 || artifacts.length === 0 ? 'unverified' : 'matched',
    verification: 'unverified', basis: 'caller-declared', ...(manifest === undefined ? {} : { expected: manifest.expected }),
    summary, artifacts };
}

function declaredEvidence(artifact: EvidenceArtifact): Omit<EvidenceArtifact, 'path' | 'id'> {
  const { path: ignoredPath, id: ignoredId, ...declared } = artifact;
  return declared;
}
