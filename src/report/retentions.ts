import type { BridgePlatform, BridgeSymbol } from '../exchange/parse.ts';
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
  return {
    format: 'external-retentions',
    version: 0,
    producedBy: { name: 'isthmus', version: producerVersion },
    generatedAt,
    retentions: collectCartographRetentions(joined),
  };
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
      const symbolKey = handler.symbol.usr ?? `name:${handler.symbol.qualifiedName}`;
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
