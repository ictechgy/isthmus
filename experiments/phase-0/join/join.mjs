import { parseBridgeFactsDocument } from '../../../src/exchange/parse.ts';
import { joinBridgeDocuments } from '../../../src/join/join.ts';

/**
 * Dart와 Swift 교환 문서의 정적 브리지 사실을 연결한다.
 *
 * @param {Record<string, unknown>} dartDocument Dart bridge-facts 문서
 * @param {Record<string, unknown>} swiftDocument Swift bridge-facts 문서
 * @returns {Record<string, unknown>} Phase 0 손 조인 보고서
 */
export function joinBridgeFacts(dartDocument, swiftDocument) {
  const joined = joinBridgeDocuments([
    parseBridgeFactsDocument(dartDocument),
    parseBridgeFactsDocument(swiftDocument),
  ]);
  return {
    matchedChannels: joined.matchedChannels.flatMap((match) =>
      match.creations.flatMap((creation) =>
        match.registrations.map((registration) => ({
          channel: match.channel,
          creator: legacyLocation(creation.location),
          registration: legacyLocation(registration.location),
        })),
      ),
    ),
    unregisteredChannelCreations: joined.unregisteredChannelCreations.flatMap(
      (unregistered) =>
        unregistered.creations.map((creation) => ({
          channel: unregistered.channel,
          creator: legacyLocation(creation.location),
        })),
    ),
    matchedMethods: joined.matchedMethods.flatMap((match) =>
      match.invocations.flatMap((invocation) =>
        match.handlers.map((handler) => ({
          channel: match.channel,
          method: match.method,
          caller: legacyLocation(invocation.location),
          handler: legacyLocation(handler.location),
          handlerSymbol: handler.symbol,
        })),
      ),
    ),
    unhandledInvocations: joined.unhandledInvocations.flatMap((unhandled) =>
      unhandled.invocations.map((invocation) => ({
        channel: unhandled.channel,
        method: unhandled.method,
        caller: legacyLocation(invocation.location),
      })),
    ),
    handlersWithoutInvocations: joined.handlersWithoutInvocations.flatMap(
      (unhandled) =>
        unhandled.handlers.map((handler) => ({
          channel: unhandled.channel,
          method: unhandled.method,
          handler: legacyLocation(handler.location),
          handlerSymbol: handler.symbol,
        })),
    ),
    limitations: joined.limitations.map(({ platform, message }) => ({
      platform,
      message,
    })),
  };
}

/** 기존 Phase 0 golden의 결정적인 위치 키 순서를 유지한다. */
function legacyLocation({ path, line, column }) {
  return { column, line, path };
}
