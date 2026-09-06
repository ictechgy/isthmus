import type {
  BridgeFactsDocument,
  BridgePlatform,
  BridgeSymbol,
} from '../exchange/parse.ts';
import {
  isBridgeJoinDeferred,
  type BridgeJoinResult,
} from '../join/join.ts';
import { encodeSortedJson } from './sorted-json.ts';

/** cartograph가 보존할 Swift 선언 식별자다. */
export interface RetentionSymbol extends BridgeSymbol {
  readonly usr?: string;
}

/** 언어 경계 너머 호출자의 증거 위치다. */
export interface RetentionCaller {
  readonly platform: BridgePlatform;
  readonly path: string;
  readonly line: number;
}

/** 보존 판단을 설명할 채널·메서드·호출자 근거다. */
export interface RetentionEvidence {
  readonly channel: string;
  readonly method: string;
  readonly caller: RetentionCaller;
}

/** cartograph 외부 보존 근거 하나다. */
export interface ExternalRetention {
  readonly symbol: RetentionSymbol;
  readonly reason: 'bridge';
  readonly evidence: RetentionEvidence;
}

/** cartograph가 읽는 external-retentions 버전 0 문서다. */
export interface CartographRetentionsDocument {
  readonly format: 'external-retentions';
  readonly version: 0;
  readonly producedBy: Readonly<{ name: 'isthmus'; version: string }>;
  readonly generatedAt: string;
  readonly retentions: readonly ExternalRetention[];
}

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
export function validateCartographRetentionInputs(
  documents: readonly BridgeFactsDocument[],
): void {
  if (documents.some(({ platform }) => platform === 'swift')) return;
  throw new RetentionValidationError(
    'Retentions for cartograph require at least one swift bridge facts document; '
    + 'run a swift producer for the receiver side.',
  );
}

/** cartograph 보존 문서를 결정적인 JSON으로 인코딩한다. */
export function encodeCartographRetentionsDocument(
  document: CartographRetentionsDocument,
): string {
  return encodeSortedJson(document);
}

/** 매치된 브리지 메서드를 cartograph 보존 근거로 바꾼다. */
export function createCartographRetentionsDocument(
  joined: BridgeJoinResult,
  generatedAt: string,
  producerVersion: string,
): CartographRetentionsDocument {
  if (isBridgeJoinDeferred(joined)) {
    throw new RetentionValidationError(
      'Cannot create retentions from a deferred bridge join.',
    );
  }
  rejectUnresolvedSwiftHandlers(joined);
  return {
    format: 'external-retentions',
    version: 0,
    producedBy: { name: 'isthmus', version: producerVersion },
    generatedAt,
    retentions: collectCartographRetentions(joined),
  };
}

/**
 * 심볼이 없어 보존 근거로 바꿀 수 없는 매치 Swift 핸들러를 거부한다.
 *
 * 교환 계약에서 `symbol`은 선택 필드다. 호출자가 있는데도 근거를 만들지 못한
 * 핸들러를 조용히 빼면 cartograph는 그 핸들러를 계속 미사용으로 보고하고,
 * 소비자는 살아 있는 코드를 지운다. 부분 보존 문서 대신 실패를 돌려준다.
 */
function rejectUnresolvedSwiftHandlers(joined: BridgeJoinResult): void {
  const unresolved = new Set<string>();
  for (const method of joined.matchedMethods) {
    for (const handler of method.handlers) {
      if (handler.platform !== 'swift' || handler.symbol !== undefined) continue;
      const { path, line, column } = handler.location;
      unresolved.add(`${path}\u0000${line}\u0000${column}`);
    }
  }
  if (unresolved.size === 0) return;
  throw new RetentionValidationError(
    `Cannot produce retention evidence for ${unresolved.size} matched swift `
    + 'handlers without a symbol; regenerate the swift document with a producer '
    + 'that attaches handler symbols.',
  );
}

/** 매치별 Dart 호출자와 Swift 심볼을 cartograph 근거로 결합한다. */
function collectCartographRetentions(
  joined: BridgeJoinResult,
): ExternalRetention[] {
  const retentions: ExternalRetention[] = [];
  const seen = new Set<string>();
  for (const method of joined.matchedMethods) {
    const caller = method.invocations[0];
    if (caller === undefined) continue;
    for (const handler of method.handlers) {
      if (handler.platform !== 'swift' || handler.symbol === undefined) continue;
      const symbolKey = handler.symbol.usr === undefined
        ? `name:${handler.symbol.qualifiedName}`
        : `usr:${handler.symbol.usr}`;
      const retentionKey = `${symbolKey}\u0000${method.channel}\u0000${method.method}`;
      if (seen.has(retentionKey)) continue;
      seen.add(retentionKey);
      retentions.push({
        symbol: handler.symbol,
        reason: 'bridge',
        evidence: {
          channel: method.channel,
          method: method.method,
          caller: {
            platform: caller.platform,
            path: caller.location.path,
            line: caller.location.line,
          },
        },
      });
    }
  }
  return retentions;
}
