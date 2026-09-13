import { isBridgeTimestamp, isProjectRelativePath, isSafeNonEmptyString } from './parse.ts';
import type { BridgeLocation } from './parse.ts';

/** 실제 실행에서 관찰한 플랫폼이다. Dart/Swift 같은 소스 언어와 혼동하지 않는다. */
export type RuntimePlatform = 'ios' | 'macos' | 'android' | 'linux' | 'windows';
/** 메시지 형태가 다른 채널을 이름만으로 합치지 않도록 구분한다. */
export type RuntimeTransport = 'method-channel' | 'basic-message-channel';
/** 원문 예외나 payload 없이 통신 결과만 분류한다. */
export type RuntimeOutcome = 'success' | 'missing-handler' | 'error' | 'timeout' | 'pending';

/** 실제 라우팅 주소다. BasicMessageChannel에는 가상의 method를 만들지 않는다. */
export interface RuntimeRoute {
  readonly transport: RuntimeTransport;
  readonly channel: string;
  readonly method?: string;
}

/** 실행 순서와 엔진 인스턴스를 가진 호출 관찰이다. */
export interface RuntimeEvent extends RuntimeRoute {
  readonly sequence: number;
  readonly instance: string;
  readonly outcome: RuntimeOutcome;
  readonly caller?: BridgeLocation;
}

/** 한 시나리오 실행의 폐쇄 여부와 코드 revision을 선언하는 생산 문서다. */
export interface BridgeRuntimeDocument {
  readonly format: 'bridge-runtime';
  readonly version: 1;
  readonly project: string;
  readonly revision: string;
  readonly tool: { readonly name: string; readonly version: string };
  readonly run: {
    readonly id: string;
    readonly scenario: string;
    readonly platform: RuntimePlatform;
    readonly status: 'completed' | 'incomplete';
    readonly startedAt: string;
    readonly finishedAt?: string;
  };
  readonly droppedEvents: number;
  readonly events: readonly RuntimeEvent[];
}

/** 지정한 시나리오·플랫폼에서 관찰해야 하는 통신이다. instance 생략은 모든 인스턴스다. */
export interface RuntimeExpectation extends RuntimeRoute {
  readonly id: string;
  readonly scenario: string;
  readonly platform: RuntimePlatform;
  readonly instance?: string;
}

/** CI가 실행해야 하는 검증 목록. 런타임 로그에서 기대값을 역생성하지 않는다. */
export interface RuntimeExpectations {
  readonly format: 'bridge-expectations';
  readonly version: 1;
  readonly project: string;
  readonly revision: string;
  readonly checks: readonly RuntimeExpectation[];
}

/** 입력 계약 실패를 원문 데이터 없는 메시지로 전달한다. */
export class RuntimeValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'RuntimeValidationError'; }
}

/** 신뢰하지 않는 런타임 JSON에서 라우팅·관측 결과·생산 문맥만 보존한다. */
export function parseBridgeRuntime(input: unknown): BridgeRuntimeDocument {
  const value = document(input, 'bridge-runtime');
  const tool = object(value.tool);
  const run = object(value.run);
  const status = run.status;
  if (status !== 'completed' && status !== 'incomplete') fail('Invalid runtime run status.');
  if (!isBridgeTimestamp(run.startedAt) ||
    (run.finishedAt !== undefined && !isBridgeTimestamp(run.finishedAt)) ||
    (status === 'completed' && run.finishedAt === undefined) ||
    (typeof run.finishedAt === 'string' && Date.parse(run.finishedAt) < Date.parse(run.startedAt))) {
    fail('Invalid runtime run timestamps.');
  }
  const droppedEvents = nonnegativeInteger(value.droppedEvents);
  const rawEvents = array(value.events, 100_000);
  const sequences = new Set<number>();
  let maximumSequence = 0;
  const events = rawEvents.map((item): RuntimeEvent => {
    const event = object(item);
    const sequence = nonnegativeInteger(event.sequence);
    if (sequence === 0 || sequences.has(sequence)) fail('Runtime sequences must be positive and unique.');
    sequences.add(sequence);
    maximumSequence = Math.max(maximumSequence, sequence);
    return {
      ...route(event), sequence, instance: safeString(event.instance), outcome: outcome(event.outcome),
      ...(event.caller === undefined ? {} : { caller: location(event.caller) }),
    };
  }).sort((a, b) => a.sequence - b.sequence);
  if (maximumSequence - events.length > droppedEvents) {
    fail('Missing runtime sequences must be counted in droppedEvents.');
  }
  return {
    format: 'bridge-runtime', version: 1,
    project: safeString(value.project), revision: safeString(value.revision),
    tool: { name: safeString(tool.name), version: safeString(tool.version) },
    run: { id: safeString(run.id), scenario: safeString(run.scenario),
      platform: platform(run.platform), status, startedAt: run.startedAt,
      ...(run.finishedAt === undefined ? {} : { finishedAt: run.finishedAt as string }),
    }, droppedEvents, events,
  };
}

/** 기대 목록의 빈 통과와 중복 식별자를 거부한다. */
export function parseRuntimeExpectations(input: unknown): RuntimeExpectations {
  const value = document(input, 'bridge-expectations');
  const items = array(value.checks, 10_000);
  if (items.length === 0) fail('Runtime expectations require at least one check.');
  const ids = new Set<string>();
  const checks = items.map((item): RuntimeExpectation => {
    const check = object(item);
    const id = safeString(check.id);
    if (ids.has(id)) fail('Runtime expectation ids must be unique.');
    ids.add(id);
    return {
      ...route(check), id, scenario: safeString(check.scenario), platform: platform(check.platform),
      ...(check.instance === undefined ? {} : { instance: safeString(check.instance) }),
    };
  });
  return { format: 'bridge-expectations', version: 1,
    project: safeString(value.project), revision: safeString(value.revision), checks };
}

/** 실행 문서와 기대 문서가 공유하는 버전 경계다. */
function document(input: unknown, format: string): Record<string, unknown> {
  const value = object(input);
  if (value.format !== format || value.version !== 1) fail('Unsupported runtime document format or version.');
  return value;
}

/** 외부 JSON 객체의 구조만 검증한다. */
function object(input: unknown): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) fail('Expected a runtime JSON object.');
  return input as Record<string, unknown>;
}

/** 상한 검사를 순회보다 먼저 수행한다. */
function array(input: unknown, maximum: number): unknown[] {
  if (!Array.isArray(input) || input.length > maximum) fail('Invalid runtime array or item limit exceeded.');
  return input;
}

/** 채널 이름·문맥 식별자에 기존 교환 문자열 규칙을 적용한다. */
function safeString(input: unknown): string {
  if (!isSafeNonEmptyString(input)) fail('Expected a non-empty safe runtime string.');
  return input;
}

/** 유실 개수와 순서를 부동소수점이나 음수로 위조할 수 없게 한다. */
function nonnegativeInteger(input: unknown): number {
  if (!Number.isSafeInteger(input) || Number(input) < 0) fail('Expected a nonnegative runtime integer.');
  return input as number;
}

/** 플랫폼을 소스 경로나 실행 파일 이름에서 추측하지 않는다. */
function platform(input: unknown): RuntimePlatform {
  if (input !== 'ios' && input !== 'macos' && input !== 'android' && input !== 'linux' && input !== 'windows') {
    fail('Unsupported runtime platform.');
  }
  return input;
}

/** 런타임 채널별 주소 형태를 검증한다. */
function route(input: Record<string, unknown>): RuntimeRoute {
  const transport = input.transport;
  if (transport !== 'method-channel' && transport !== 'basic-message-channel') fail('Unsupported runtime transport.');
  const channel = safeString(input.channel);
  if (transport === 'method-channel') return { transport, channel, method: safeString(input.method) };
  if (input.method !== undefined) fail('Basic message routes cannot declare a method.');
  return { transport, channel };
}

/** 예외 텍스트 대신 고정된 통신 결과만 허용한다. */
function outcome(input: unknown): RuntimeOutcome {
  if (input !== 'success' && input !== 'missing-handler' && input !== 'error' && input !== 'timeout' && input !== 'pending') {
    fail('Unsupported runtime outcome.');
  }
  return input;
}

/** 자동 추측한 호출 스택 대신 생산자가 선언한 상대 소스 위치를 검증한다. */
function location(input: unknown): BridgeLocation {
  const value = object(input);
  if (!isProjectRelativePath(value.path) || !Number.isSafeInteger(value.line) || Number(value.line) < 1 ||
    !Number.isSafeInteger(value.column) || Number(value.column) < 1) fail('Invalid runtime caller location.');
  return { path: value.path, line: value.line as number, column: value.column as number };
}

/** 입력 값이나 예외 payload를 메시지에 포함하지 않는다. */
function fail(message: string): never { throw new RuntimeValidationError(message); }
