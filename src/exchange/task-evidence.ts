import { createJsonGuards } from './json-guards.ts';
import { isProjectRelativePath } from './parse.ts';
import { isTraversalPlatform } from './language-traversal.ts';

/** 수동 capture의 선언된 입력 신원이다. 현재 checkout이나 컴파일 성공을 증명하지 않는다. */
export interface EvidenceInput {
  readonly captureId: string;
  readonly repository: string;
  readonly commit: string;
  readonly dirty: boolean;
  readonly sourceDigest: string;
  readonly sourceDigestScheme: string;
  readonly toolchainDigest: string;
  readonly buildConfigurationDigest: string;
}

/** 실제 문서 tool과 대조할 생산자 신원이다. */
export interface EvidenceProducer { readonly name: string; readonly version: string }

/** 입력 역할은 파일 이름이나 시각으로 추측하지 않는다. */
export type EvidenceRole = 'trace-context' | 'bridge-facts' | 'traversal' | 'validation';

/** 원본 artifact 바이트와 입력 선언을 별도 manifest에 묶는다. */
export interface EvidenceArtifact {
  readonly id: string;
  readonly path: string;
  readonly role: EvidenceRole;
  readonly sha256: string;
  readonly input?: EvidenceInput;
  readonly producer?: EvidenceProducer;
}

/** 기존 교환 문서·소비자를 변경하지 않는 opt-in manifest다. */
export interface EvidenceManifest {
  readonly expected: EvidenceInput;
  readonly artifacts: readonly EvidenceArtifact[];
}

/** 테스트 실행기가 관찰했다고 신고한 결과다. 실행 진위는 별도로 검증해야 한다. */
export interface TaskTestObservation {
  readonly id: string;
  readonly platform: string;
  readonly usr: string;
  readonly outcome: 'passed' | 'failed' | 'unknown';
}

/** 검증 결과를 전달하는 작은 입력 계약이다. 테스트/규칙 실행 정책은 포함하지 않는다. */
export interface TaskValidation {
  readonly tool: EvidenceProducer;
  readonly tests: readonly TaskTestObservation[];
  readonly limitations: readonly string[];
}

/** 입력 원문·경로 없이 v1 계약 오류를 전달한다. */
export class TaskEvidenceError extends Error {
  constructor(message: string) { super(message); this.name = 'TaskEvidenceError'; }
}

function fail(message: string): never { throw new TaskEvidenceError(message); }
const guards = createJsonGuards(fail);
const MAX_ARTIFACTS = 512;

function identifier(value: unknown): string {
  const text = guards.safe(value, 'Evidence identifiers must be safe nonempty strings.');
  if (text.length > 1024) fail('Evidence identifiers exceed the length limit.');
  return text;
}

function digest(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) fail('Evidence requires lowercase SHA-256 digests.');
  return value;
}

function producer(value: unknown): EvidenceProducer {
  const raw = guards.object(value, 'Evidence producer must be an object.');
  return { name: identifier(raw.name), version: identifier(raw.version) };
}

function input(value: unknown): EvidenceInput {
  const raw = guards.object(value, 'Evidence input must be an object.');
  if (typeof raw.commit !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(raw.commit)) {
    fail('Evidence commit must be a full lowercase Git object id.');
  }
  if (typeof raw.dirty !== 'boolean') fail('Evidence dirty must be a boolean.');
  return { captureId: identifier(raw.captureId), repository: identifier(raw.repository), commit: raw.commit,
    dirty: raw.dirty, sourceDigest: digest(raw.sourceDigest), sourceDigestScheme: identifier(raw.sourceDigestScheme),
    toolchainDigest: digest(raw.toolchainDigest), buildConfigurationDigest: digest(raw.buildConfigurationDigest) };
}

/** 상한·식별자를 검증하고 모르는 추가 필드를 입력 증명으로 사용하지 않는다. */
export function parseEvidenceManifest(value: unknown): EvidenceManifest {
  const raw = guards.object(value, 'Evidence manifest must be an object.');
  if (raw.format !== 'isthmus-evidence-manifest' || raw.version !== 1) fail('Unsupported evidence manifest format or version.');
  const ids = new Set<string>();
  const paths = new Set<string>();
  const artifacts = guards.array(raw.artifacts, MAX_ARTIFACTS, 'Evidence supports at most 512 artifacts.').map((entry): EvidenceArtifact => {
    const item = guards.object(entry, 'Evidence artifact must be an object.');
    const id = identifier(item.id);
    const path = identifier(item.path);
    if (!isProjectRelativePath(path)) fail('Evidence artifact path must be project-relative.');
    if (ids.has(id) || paths.has(path)) fail('Evidence artifact ids and paths must be unique.');
    ids.add(id); paths.add(path);
    const role = item.role;
    if (role !== 'trace-context' && role !== 'bridge-facts' && role !== 'traversal' && role !== 'validation') {
      fail('Unsupported evidence artifact role.');
    }
    return { id, path, role, sha256: digest(item.sha256),
      ...(item.input === undefined ? {} : { input: input(item.input) }),
      ...(item.producer === undefined ? {} : { producer: producer(item.producer) }) };
  });
  return { expected: input(raw.expected), artifacts };
}

/** 정확한 심볼 신원과 관찰 상태만 받아 이름 휴리스틱으로 테스트를 만들지 않는다. */
export function parseTaskValidation(value: unknown): TaskValidation {
  const raw = guards.object(value, 'Task validation must be an object.');
  if (raw.format !== 'isthmus-task-validation' || raw.version !== 1) fail('Unsupported task validation format or version.');
  const ids = new Set<string>();
  const tests = guards.array(raw.tests, 1000, 'Task validation supports at most 1000 tests.').map((entry): TaskTestObservation => {
    const item = guards.object(entry, 'Task test observation must be an object.');
    const id = identifier(item.id);
    if (ids.has(id)) fail('Task test ids must be unique within a validation artifact.');
    ids.add(id);
    if (!isTraversalPlatform(item.platform)) fail('Task test platform must be supported.');
    const outcome = item.outcome;
    if (outcome !== 'passed' && outcome !== 'failed' && outcome !== 'unknown') fail('Unsupported task test outcome.');
    return { id, platform: item.platform, usr: identifier(item.usr), outcome };
  });
  const limitations = guards.textStrings(raw.limitations, 1000, 'Task validation limitations must be strings.');
  if (limitations.some((text) => text.length > 1024)) fail('Task validation limitations exceed the length limit.');
  return { tool: producer(raw.tool), tests, limitations };
}
