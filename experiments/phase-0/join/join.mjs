/**
 * Dart와 Swift 교환 문서의 정적 브리지 사실을 연결한다.
 *
 * @param {Record<string, unknown>} dartDocument Dart bridge-facts 문서
 * @param {Record<string, unknown>} swiftDocument Swift bridge-facts 문서
 * @returns {Record<string, unknown>} Phase 0 손 조인 보고서
 */
export function joinBridgeFacts(dartDocument, swiftDocument) {
  const creations = staticFacts(dartDocument, 'channel-create');
  const registrations = staticFacts(swiftDocument, 'channel-register');
  const invocations = staticFacts(dartDocument, 'method-invoke');
  const handlers = staticFacts(swiftDocument, 'method-handle');
  return {
    matchedChannels: creations.flatMap((creation) =>
      registrations
        .filter((registration) => registration.channel === creation.channel)
        .map((registration) => ({
          channel: creation.channel,
          creator: creation.location,
          registration: registration.location,
        })),
    ),
    unregisteredChannelCreations: creations
      .filter(
        (creation) =>
          !registrations.some(
            (registration) => registration.channel === creation.channel,
          ),
      )
      .map((creation) => ({
        channel: creation.channel,
        creator: creation.location,
      })),
    matchedMethods: invocations.flatMap((invocation) =>
      handlers
        .filter((handler) => sameMethod(invocation, handler))
        .map((handler) => ({
          channel: invocation.channel,
          method: invocation.method,
          caller: invocation.location,
          handler: handler.location,
          handlerSymbol: handler.symbol,
        })),
    ),
    unhandledInvocations: invocations
      .filter(
        (invocation) =>
          !handlers.some((handler) => sameMethod(invocation, handler)),
      )
      .map((invocation) => ({
        channel: invocation.channel,
        method: invocation.method,
        caller: invocation.location,
      })),
    handlersWithoutInvocations: handlers
      .filter(
        (handler) =>
          !invocations.some((invocation) => sameMethod(handler, invocation)),
      )
      .map((handler) => ({
        channel: handler.channel,
        method: handler.method,
        handler: handler.location,
        handlerSymbol: handler.symbol,
      })),
    limitations: [
      ...platformLimitations(dartDocument),
      ...platformLimitations(swiftDocument),
    ],
  };
}

/** 입력 한계에 출처 플랫폼을 붙인다. */
function platformLimitations(document) {
  return document.limitations.map((message) => ({
    platform: document.platform,
    message,
  }));
}

/** 두 사실의 채널과 메서드 키가 같은지 확인한다. */
function sameMethod(left, right) {
  return left.channel === right.channel && left.method === right.method;
}

/**
 * 동적 이름을 제외하고 한 종류의 사실만 고른다.
 *
 * @param {Record<string, unknown>} document bridge-facts 문서
 * @param {string} kind 사실 종류
 * @returns {Array<Record<string, any>>} 정적으로 조인 가능한 사실
 */
function staticFacts(document, kind) {
  return document.facts.filter(
    (fact) => fact.kind === kind && fact.dynamic === false,
  );
}
