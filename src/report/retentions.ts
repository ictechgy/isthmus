import type {
  BridgeFactsDocument,
  BridgeLocation,
  BridgePlatform,
  BridgeSymbol,
} from '../exchange/parse.ts';
import type { BridgeMessageDocument } from '../exchange/messages.ts';
import {
  isBridgeJoinDeferred,
  type BridgeEndpoint,
  type BridgeJoinResult,
} from '../join/join.ts';
import type { MessageBridgeJoin, MessageEndpoint } from '../join/messages.ts';
import { encodeSortedJson } from './sorted-json.ts';

/** 외부 보존 문서를 소비하는 자매 도구다. */
export type RetentionTarget = 'cartograph' | 'kartograph';

/** 자매 도구가 보존할 선언 식별자다. */
export interface RetentionSymbol extends BridgeSymbol {
  readonly usr?: string;
}

/** 언어 경계 너머 호출자의 증거 위치다. */
export interface RetentionCaller {
  readonly platform: BridgePlatform;
  readonly path: string;
  readonly line: number;
}

/**
 * 보존 판단을 설명할 채널·메서드·호출자 근거다.
 *
 * `method`는 MethodChannel 근거에만 있다. Basic·Event v2 경계는 메서드가 없으므로
 * 생략하며, cartograph의 `ExternalRetention.Evidence.method`도 선택 필드다.
 */
export interface RetentionEvidence {
  readonly channel: string;
  readonly method?: string;
  /** 대표 호출 위치다. 결정적 순서의 첫 호출이며 옛 소비자가 읽는 필드다. */
  readonly caller: RetentionCaller;
  /**
   * 이 보존의 전체 호출 위치(대표 포함)다. 결정적 순서를 유지하고 호출이 둘 이상일
   * 때만 실는다. 옛 소비자는 이 필드를 모르고 대표 `caller`만 읽는다.
   */
  readonly callers?: readonly RetentionCaller[];
  /** 상한 때문에 `callers`에 실지 못한 호출 수다. 0이면 실지 않는다. */
  readonly callersOmitted?: number;
}

/** 대상 네이티브 선언의 외부 보존 근거 하나다. */
export interface ExternalRetention {
  readonly symbol: RetentionSymbol;
  readonly reason: 'bridge';
  readonly evidence: RetentionEvidence;
}

/** 자매 네이티브 도구가 읽는 external-retentions 버전 0 문서다. */
export interface RetentionsDocument {
  readonly format: 'external-retentions';
  readonly version: 0;
  readonly producedBy: Readonly<{ name: 'isthmus'; version: string }>;
  readonly generatedAt: string;
  readonly retentions: readonly ExternalRetention[];
  readonly omittedObjectiveCHandlers?: number;
}

/** 근거 하나가 실을 수 있는 호출 위치 상한이다. */
export const MAX_RETENTION_CALLERS = 100;

/**
 * 문서 전체가 실을 수 있는 호출 위치 총상한이다.
 *
 * 호출자 증거는 (심볼 × 채널 × 메서드)마다 다시 실리므로 건당 상한만으로는 출력이
 * 입력보다 커질 수 있다. 베이스라인의 항목 상한과 같은 자원 거버넌스다.
 */
export const MAX_RETENTION_CALLER_ENTRIES = 1_000_000;

/** 불완전한 조인으로 보존 결정을 만들 수 없음을 나타낸다. */
export class RetentionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetentionValidationError';
  }
}

/**
 * cartograph가 소비할 수 있는 수신 측 문서가 입력에 있는지 검증한다.
 *
 * cartograph는 Swift 심볼만 보존한다. Swift 문서가 없는 입력은 조인 자체는
 * 성공하므로, 검증하지 않으면 보존할 근거가 없다는 사실이 빈 목록과 코드 0으로
 * 사라진다. 사실이 없는 Swift 문서도 그 플랫폼을 분석했다는 근거로 인정한다.
 */
export function validateRetentionInputs(
  documents: readonly BridgeFactsDocument[],
  messageDocuments?: readonly BridgeMessageDocument[],
  target: RetentionTarget = 'cartograph',
): void {
  const receiver = target === 'cartograph' ? 'swift' : 'kotlin';
  if (documents.some(({ platform }) => platform === receiver)) return;
  if (messageDocuments?.some(({ platform }) => platform === receiver)) return;
  throw new RetentionValidationError(
    `Retentions for ${target} require at least one ${receiver} bridge facts document; `
    + `run a ${receiver} producer for the receiver side.`,
  );
}

/** 보존 문서를 결정적인 JSON으로 인코딩한다. */
export function encodeRetentionsDocument(
  document: RetentionsDocument,
): string {
  return encodeSortedJson(document);
}

/**
 * 매치된 브리지 메서드와 v2 Basic·Event 경계를 cartograph 보존 근거로 바꾼다.
 *
 * `messages`를 주면 literal로 확정된 v2 경계의 Swift 핸들러도 보존 근거로 싣는다.
 * v2 근거에는 메서드가 없으므로 `method`를 생략하며, cartograph는 선택 필드로 읽는다.
 */
export function createRetentionsDocument(
  joined: BridgeJoinResult,
  generatedAt: string,
  producerVersion: string,
  messages?: MessageBridgeJoin,
  target: RetentionTarget = 'cartograph',
): RetentionsDocument {
  if (isBridgeJoinDeferred(joined)) {
    throw new RetentionValidationError(
      'Cannot create retentions from a deferred bridge join.',
    );
  }
  const platform = target === 'cartograph' ? 'swift' : 'kotlin';
  rejectUnresolvedHandlers(joined, messages, platform);
  const retentions = [
    ...collectRetentions(joined, platform),
    ...(messages === undefined ? [] : collectMessageRetentions(messages, platform)),
  ];
  if (retentions.reduce((count, item) => count + (item.evidence.callers?.length ?? 1), 0) > MAX_RETENTION_CALLER_ENTRIES) {
    throw new RetentionValidationError(
      `Cannot produce retention evidence with more than ${MAX_RETENTION_CALLER_ENTRIES} caller entries; narrow the join inputs.`,
    );
  }
  return {
    format: 'external-retentions',
    version: 0,
    producedBy: { name: 'isthmus', version: producerVersion },
    generatedAt,
    retentions,
  };
}

/**
 * 심볼이 없어 보존 근거로 바꿀 수 없는 매치 핸들러를 거부한다.
 * Kotlin과 Objective-C는 실제 컴파일러 식별자를 요구하고 이름으로 대체하지 않는다.
 *
 * 교환 계약에서 `symbol`은 선택 필드다. 호출자가 있는데도 근거를 만들지 못한
 * 핸들러를 조용히 빼면 cartograph는 그 핸들러를 계속 미사용으로 보고하고,
 * 소비자는 살아 있는 코드를 지운다. 부분 보존 문서 대신 실패를 돌려준다.
 */
function rejectUnresolvedHandlers(
  joined: BridgeJoinResult,
  messages: MessageBridgeJoin | undefined,
  platform: 'swift' | 'kotlin',
): void {
  const unresolved = new Set<string>();
  let unresolvedObjectiveC = false;
  for (const method of joined.matchedMethods) {
    for (const handler of method.handlers) {
      if (handler.platform !== platform || handler.location === undefined) continue;
      if (handler.symbol !== undefined &&
        (platform === 'swift' && handler.sourceLanguage !== 'objective-c' || handler.symbol.usr !== undefined)) continue;
      const { path, line, column } = handler.location;
      unresolved.add(`${path}\u0000${line}\u0000${column}`);
      unresolvedObjectiveC ||= handler.sourceLanguage === 'objective-c';
    }
  }
  if (messages !== undefined) {
    for (const route of retainedMessageRoutes(messages)) {
      for (const handler of route.handlers) {
        if (handler.platform !== platform || handler.location === undefined) continue;
        if (handler.symbol !== undefined &&
          (platform === 'swift' && handler.sourceLanguage !== 'objective-c' || handler.symbol.usr !== undefined)) continue;
        const { path, line, column } = handler.location;
        unresolved.add(`${path}\u0000${line}\u0000${column}`);
        unresolvedObjectiveC ||= handler.sourceLanguage === 'objective-c';
      }
    }
  }
  if (unresolved.size === 0) return;
  throw new RetentionValidationError(
    `Cannot produce retention evidence for ${unresolved.size} matched ${platform} `
    + `handlers without a ${platform === 'kotlin' ? 'JVM identifier' : unresolvedObjectiveC ? 'required compiler identity' : 'symbol'}; regenerate the ${platform} document with a producer `
    + 'that attaches handler symbols.'
    + (unresolvedObjectiveC ? ' Objective-C handlers require a Clang USR.' : ''),
  );
}

/** 매치별 Dart 호출자와 Swift 심볼을 cartograph 근거로 결합한다. */
function collectRetentions(
  joined: BridgeJoinResult,
  platform: 'swift' | 'kotlin',
): ExternalRetention[] {
  const retentions: ExternalRetention[] = [];
  const seen = new Set<string>();
  let callerEntries = 0;
  for (const method of joined.matchedMethods) {
    if (method.invocations.length === 0) continue;
    // 결정적 순서(플랫폼·경로·줄·열)의 첫 호출이 대표 증거다. 상한 밖 호출까지
    // 객체로 만들지 않도록 먼저 자른다.
    const callers = method.invocations
      .filter(hasLocation)
      .slice(0, MAX_RETENTION_CALLERS)
      .map(toRetentionCaller);
    const callersOmitted = method.invocations.length - callers.length;
    const representative = callers[0];
    if (representative === undefined) continue;
    for (const handler of method.handlers) {
      if (handler.platform !== platform || handler.symbol === undefined) continue;
      const symbolKey = handler.symbol.usr === undefined
        ? `name:${handler.symbol.qualifiedName}`
        : `usr:${handler.symbol.usr}`;
      const retentionKey = `${symbolKey}\u0000${method.channel}\u0000${method.method}`;
      if (seen.has(retentionKey)) continue;
      seen.add(retentionKey);
      callerEntries += callers.length;
      if (callerEntries > MAX_RETENTION_CALLER_ENTRIES) {
        throw new RetentionValidationError(
          `Cannot produce retention evidence with more than `
            + `${MAX_RETENTION_CALLER_ENTRIES} caller entries; narrow the join inputs.`,
        );
      }
      retentions.push({
        symbol: handler.symbol,
        reason: 'bridge',
        evidence: {
          channel: method.channel,
          method: method.method,
          caller: representative,
          ...(callers.length > 1 ? { callers } : {}),
          ...(callersOmitted > 0 ? { callersOmitted } : {}),
        },
      });
    }
  }
  return retentions;
}

/** literal로 확정되고 호출자가 있는 v2 경계만 보존 후보로 돌려준다. */
function retainedMessageRoutes(messages: MessageBridgeJoin) {
  return messages.routes.filter((route) =>
    route.matching === 'literal' && route.senders.length > 0);
}

/** 매치된 v2 경계의 송신자를 Swift 심볼 보존 근거로 결합한다. */
function collectMessageRetentions(
  messages: MessageBridgeJoin,
  platform: 'swift' | 'kotlin',
): ExternalRetention[] {
  const retentions: ExternalRetention[] = [];
  const seen = new Set<string>();
  let callerEntries = 0;
  for (const route of retainedMessageRoutes(messages)) {
    const callers = route.senders
      .slice(0, MAX_RETENTION_CALLERS)
      .map(toRetentionCaller);
    const callersOmitted = route.senders.length - callers.length;
    const representative = callers[0];
    if (representative === undefined) continue;
    for (const handler of route.handlers) {
      if (handler.platform !== platform || handler.symbol === undefined) continue;
      const symbolKey = handler.symbol.usr === undefined
        ? `name:${handler.symbol.qualifiedName}`
        : `usr:${handler.symbol.usr}`;
      // transport까지 키에 넣어 같은 이름의 MethodChannel 보존과 섞이지 않게 한다.
      const retentionKey = `${symbolKey}\u0000${route.transport}\u0000${route.channel}`;
      if (seen.has(retentionKey)) continue;
      seen.add(retentionKey);
      callerEntries += callers.length;
      if (callerEntries > MAX_RETENTION_CALLER_ENTRIES) {
        throw new RetentionValidationError(
          `Cannot produce retention evidence with more than `
            + `${MAX_RETENTION_CALLER_ENTRIES} caller entries; narrow the join inputs.`,
        );
      }
      retentions.push({
        symbol: handler.symbol,
        reason: 'bridge',
        evidence: {
          channel: route.channel,
          caller: representative,
          ...(callers.length > 1 ? { callers } : {}),
          ...(callersOmitted > 0 ? { callersOmitted } : {}),
        },
      });
    }
  }
  return retentions;
}

/** 위치 없는 끝점은 호출자 증거를 만들 수 없다 — 브리지 사실만 호출자가 된다. */
function hasLocation(endpoint: BridgeEndpoint): endpoint is BridgeEndpoint & { readonly location: BridgeLocation } {
  return endpoint.location !== undefined;
}

/** 증거 끝점을 external-retentions의 호출자 형태로 바꾼다. */
function toRetentionCaller(endpoint: {
  readonly platform: BridgePlatform;
  readonly location: { readonly path: string; readonly line: number };
}): RetentionCaller {
  return {
    platform: endpoint.platform,
    path: endpoint.location.path,
    line: endpoint.location.line,
  };
}
