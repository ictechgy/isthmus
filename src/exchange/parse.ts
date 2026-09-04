/** bridge-facts 생산 플랫폼이다. */
export type BridgePlatform = 'dart' | 'swift' | 'kotlin' | 'js';

/** 언어 경계를 잇는 메커니즘이다. */
export type BridgeTarget = 'flutter' | 'react-native' | 'capacitor';

/** 교환 형식의 사실 종류다. */
export type BridgeFactKind =
  | 'channel-create'
  | 'channel-register'
  | 'method-invoke'
  | 'method-handle'
  | 'module-export'
  | 'module-import'
  | 'component-export'
  | 'component-require';

/** 사실의 프로젝트 상대 소스 위치다. */
export interface BridgeLocation {
  readonly path: string;
  readonly line: number;
  readonly column: number;
}

/** 사실을 감싸는 언어별 선언 식별자다. */
export interface BridgeSymbol {
  readonly qualifiedName: string;
  readonly usr?: string;
}

/** 생산 도구 하나가 관찰한 언어 경계 사실이다. */
export interface BridgeFact {
  readonly kind: BridgeFactKind;
  readonly channel: string | null;
  readonly method?: string;
  readonly dynamic: boolean;
  readonly location: BridgeLocation;
  readonly symbol?: BridgeSymbol;
}

/** bridge-facts 버전 1 문서다. */
export interface BridgeFactsDocument {
  readonly format: 'bridge-facts';
  readonly version: 1;
  readonly tool: Readonly<{ name: string; version: string }>;
  readonly generatedAt: string;
  readonly platform: BridgePlatform;
  readonly target: BridgeTarget | null;
  readonly project: string;
  readonly facts: readonly BridgeFact[];
  readonly limitations: readonly string[];
}

/** 외부 교환 문서가 v1 계약을 어겼음을 나타낸다. */
export class BridgeFactsValidationError extends Error {
  /** 입력 내용을 노출하지 않는 안전한 메시지를 보존한다. */
  constructor(message: string) {
    super(message);
    this.name = 'BridgeFactsValidationError';
  }
}

/** 신뢰하지 않는 JSON 값을 검증된 bridge-facts v1 문서로 바꾼다. */
export function parseBridgeFactsDocument(input: unknown): BridgeFactsDocument {
  if (!isJsonObject(input)) {
    throw new BridgeFactsValidationError(
      'Bridge facts must be a JSON object.',
    );
  }
  if (input.format !== 'bridge-facts') {
    throw new BridgeFactsValidationError('Expected format "bridge-facts".');
  }
  if (input.version !== 1) {
    throw new BridgeFactsValidationError(
      'Unsupported bridge-facts version; expected version 1.',
    );
  }
  validateDocumentMetadata(input);
  return input;
}

/** 문서 수준 필드가 v1 타입과 허용값을 따르는지 검증한다. */
function validateDocumentMetadata(
  document: Record<string, unknown>,
): asserts document is Record<string, unknown> & BridgeFactsDocument {
  validateTool(document.tool);
  if (!isTimestamp(document.generatedAt)) fail('Invalid generatedAt timestamp.');
  if (!bridgePlatforms.has(document.platform)) fail('Unsupported bridge platform.');
  if (document.target !== null && !bridgeTargets.has(document.target)) {
    fail('Unsupported bridge target.');
  }
  if (!isNonEmptyString(document.project)) fail('Invalid project path.');
  if (!Array.isArray(document.facts)) fail('Facts must be an array.');
  document.facts.forEach(validateFact);
  if (!isStringArray(document.limitations)) fail('Limitations must be strings.');
}

/** 사실 하나의 조인 키와 증거 필드를 검증한다. */
function validateFact(value: unknown, index: number): void {
  if (!isJsonObject(value)) fail(`Fact at index ${index} must be a JSON object.`);
  if (!bridgeFactKinds.has(value.kind)) fail(`Invalid fact kind at index ${index}.`);
  if (value.channel !== null && !isSafeNonEmptyString(value.channel)) {
    fail(`Invalid fact channel at index ${index}.`);
  }
  if (methodFactKinds.has(value.kind) && !isSafeNonEmptyString(value.method)) {
    fail(`Method fact at index ${index} requires a method name.`);
  }
  if (typeof value.dynamic !== 'boolean') fail(`Invalid dynamic flag at index ${index}.`);
  validateLocation(value.location, index);
  validateSymbol(value.symbol, index);
}

/** 사실 위치가 상대 경로와 1부터 시작하는 줄·열을 갖는지 검증한다. */
function validateLocation(value: unknown, index: number): void {
  if (
    !isJsonObject(value) ||
    !isProjectRelativePath(value.path) ||
    !isPositiveInteger(value.line) ||
    !isPositiveInteger(value.column)
  ) {
    fail(`Invalid fact location at index ${index}.`);
  }
}

/** 절대·상위 경로와 제어 문자를 제외한 프로젝트 상대 경로인지 확인한다. */
function isProjectRelativePath(value: unknown): value is string {
  if (!isNonEmptyString(value)) return false;
  if (/^(?:[/\\]|[A-Za-z]:)/u.test(value)) return false;
  if (/[\u0000-\u001f\u007f]/u.test(value)) return false;
  return !value.split(/[/\\]/u).includes('..');
}

/** 선택 symbol의 이름과 USR이 비어 있지 않은지 검증한다. */
function validateSymbol(value: unknown, index: number): void {
  if (value === undefined) return;
  if (
    !isJsonObject(value) ||
    !isSafeNonEmptyString(value.qualifiedName) ||
    (value.usr !== undefined && !isSafeNonEmptyString(value.usr))
  ) {
    fail(`Invalid fact symbol at index ${index}.`);
  }
}

/** 생산 도구 이름과 버전이 비어 있지 않은지 검증한다. */
function validateTool(value: unknown): void {
  if (
    !isJsonObject(value) ||
    !isNonEmptyString(value.name) ||
    !isNonEmptyString(value.version)
  ) {
    fail('Invalid tool metadata.');
  }
}

/** ISO 계열 생성 시각으로 해석할 수 있는지 확인한다. */
function isTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    timestampPattern.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

/** 공백만 있지 않은 문자열인지 확인한다. */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** 조인 키를 깨뜨리는 제어 문자가 없는 비어 있지 않은 문자열인지 확인한다. */
function isSafeNonEmptyString(value: unknown): value is string {
  return isNonEmptyString(value) && !controlCharacterPattern.test(value);
}

/** 모든 원소가 문자열인 배열인지 확인한다. */
function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** 1부터 시작하는 정수인지 확인한다. */
function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 1;
}

/** 입력 값을 포함하지 않는 검증 오류를 던진다. */
function fail(message: string): never {
  throw new BridgeFactsValidationError(message);
}

/** 지원하는 생산 플랫폼 집합이다. */
const bridgePlatforms = new Set<unknown>(['dart', 'swift', 'kotlin', 'js']);

/** 지원하는 브리지 메커니즘 집합이다. */
const bridgeTargets = new Set<unknown>([
  'flutter',
  'react-native',
  'capacitor',
]);

/** 버전 1이 정의한 사실 종류 집합이다. */
const bridgeFactKinds = new Set<unknown>([
  'channel-create',
  'channel-register',
  'method-invoke',
  'method-handle',
  'module-export',
  'module-import',
  'component-export',
  'component-require',
]);

/** method 필드가 필수인 사실 종류다. */
const methodFactKinds = new Set<unknown>(['method-invoke', 'method-handle']);

const timestampPattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;
const controlCharacterPattern = /[\u0000-\u001f\u007f]/u;

/** 배열과 null을 제외한 JSON 객체인지 확인한다. */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
