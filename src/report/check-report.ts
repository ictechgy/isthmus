import type { BridgeTarget } from '../exchange/parse.ts';
import { isBridgeReceiverDocument, isReceiverPlatform } from '../exchange/parse.ts';
import type { BridgeMessageTransport } from '../exchange/messages.ts';
import { messageTarget } from '../exchange/messages.ts';
import type {
  BridgeEndpoint,
  BridgeJoinResult,
  JoinLimitation,
} from '../join/join.ts';
import { compareLimitations, isBridgeJoinDeferred } from '../join/join.ts';
import type { MessageBridgeJoin } from '../join/messages.ts';
import { encodeSortedJson } from './sorted-json.ts';

/** check 결과 개수를 빠르게 판단할 요약이다. */
export interface CheckSummary {
  readonly errors: number;
  readonly warnings: number;
  readonly matchedChannels: number;
  readonly matchedMethods: number;
  readonly matchedModules: number;
  readonly matchedComponents: number;
  /**
   * persistence 도메인 입력이 있을 때만 실리는, 양쪽이 관찰된 관계·컬럼 수다.
   * bridge만 입력하면 키가 빠져 기존 소비자의 요약 비교를 깨지 않는다.
   */
  readonly matchedRelations?: number;
  readonly matchedColumns?: number;
  /**
   * v2 BasicMessageChannel 입력이 있을 때만 실린다 — 양쪽이 관찰된 채널 수다.
   *
   * v1만 입력하면 필드 자체가 없어 기존 소비자의 요약 비교를 깨지 않는다.
   */
  readonly matchedMessages?: number;
  /** v2 EventChannel 입력이 있을 때만 실리는, 양쪽이 관찰된 스트림 수다. */
  readonly matchedStreams?: number;
  /** RN 전역 이벤트에서 구독과 방출이 모두 관찰된 이름 수다. */
  readonly matchedEvents?: number;
  /** 입력 문서 전체가 관찰한 fact 수다. 0이면 아무것도 관찰하지 못한 실행이다. */
  readonly observedFacts: number;
  /** 이 실행에 보고된 분석 한계 수다. */
  readonly observedLimitations: number;
  /** 베이스라인이 적용된 실행에서만 실리는 억제된 이슈 수다. */
  readonly suppressed?: number;
  /** 베이스라인이 적용된 실행에서만 실리는, 현재 이슈와 맞지 않는 항목 수다. */
  readonly staleBaselineEntries?: number;
}

/**
 * check가 보고하는 안정적인 진단 종류다.
 *
 * `-unverified` 종류는 수신 측이 스스로 분석 공백을 신고해, 핸들러가 없는 것인지
 * 보지 못한 것인지 구분할 수 없는 경우다. 사실과 증거는 같지만 판정이 아니다.
 */
export const checkIssueCodes = [
  'unhandled-invocation',
  'unhandled-invocation-unverified',
  'unregistered-channel-creation',
  'unregistered-channel-creation-unverified',
  'registration-without-creation',
  'handler-without-invocation',
  'module-import-without-export',
  'module-import-without-export-unverified',
  'module-import-without-export-optional',
  'module-import-mechanism-mismatch',
  'module-export-without-import',
  'module-export-mechanism-mismatch',
  'component-require-without-export',
  'component-require-without-export-unverified',
  'component-require-mechanism-mismatch',
  'component-export-without-require',
  'component-export-mechanism-mismatch',
  'unhandled-message-send',
  'unhandled-message-send-unverified',
  'message-handler-without-send',
  'unhandled-stream-listen',
  'unhandled-stream-listen-unverified',
  'stream-handler-without-listen',
  'event-listen-without-emit',
  'event-listen-without-emit-unverified',
  'event-emit-without-listen',
  'relation-use-without-decl',
  'relation-use-without-decl-unverified',
  'ambiguous-relation-use',
  'relation-decl-without-use',
  'relation-decl-without-use-unverified',
  'column-use-without-decl',
  'column-use-without-decl-unverified',
] as const;

/** check가 보고하는 안정적인 진단 종류다. */
export type CheckIssueCode = (typeof checkIssueCodes)[number];

/**
 * channel에 선언 측 이름(해석된 선언의 철자)을 싣는 persistence 진단 코드다.
 *
 * 나머지 persistence 진단(`relation-use-without-decl*`, `ambiguous-relation-use`)은
 * 생산자가 쓴 사용 측 이름을 싣는다. 선택한 사실과 진단을 같은 관계로 대조하는
 * 소비자(impact)는 어느 쪽 이름인지 알아야 조인과 같은 해석 규칙을 적용할 수 있다.
 */
export const declNamedPersistenceIssueCodes: ReadonlySet<CheckIssueCode> = new Set<CheckIssueCode>([
  'column-use-without-decl',
  'column-use-without-decl-unverified',
  'relation-decl-without-use',
  'relation-decl-without-use-unverified',
]);

/** 삭제 판정 없이 경계 불일치 사실과 증거만 전달한다. */
export interface CheckIssue {
  readonly severity: 'error' | 'warning';
  readonly code: CheckIssueCode;
  readonly target: BridgeTarget;
  readonly channel: string;
  readonly method?: string;
  readonly evidence: readonly BridgeEndpoint[];
  /**
   * `ambiguous-relation-use`에서 비한정 이름이 닿을 수 있는 선언 측 한정
   * 이름 후보다. 다른 코드에는 없다.
   */
  readonly candidates?: readonly string[];
  /**
   * 베이스라인이 이 이슈를 인정된 상태로 억제했다는 표시다.
   *
   * 사실·증거·심각도는 그대로 보존하고, 요약의 error·warning 계산과
   * `--strict`에서만 빼는다. 억제 자체를 지우면 베이스라인이 무엇을
   * 삼켰는지 보고서에서 사라진다.
   */
  readonly suppressed?: true;
}

/** 에이전트와 CI가 소비할 check 문서다. */
export interface CheckReport {
  readonly format: 'isthmus-check';
  readonly version: 1;
  readonly summary: CheckSummary;
  readonly issues: readonly CheckIssue[];
  readonly limitations: readonly JoinLimitation[];
}

/** check 문서를 결정적인 JSON 문자열로 인코딩한다. */
export function encodeCheckReport(report: CheckReport): string {
  return encodeSortedJson(report);
}

/**
 * v1 조인 결과와 선택적 v2 메시지 조인을 정책 심각도가 포함된 check 문서로 바꾼다.
 *
 * `messages`를 주면 transport별 진단 코드와 수신 공백 완화를 함께 싣고,
 * 요약에 `matchedMessages`/`matchedStreams`를 더한다. v1만 쓰는 호출자의
 * 출력은 그대로 유지된다.
 */
export function createCheckReport(
  joined: BridgeJoinResult,
  messages?: MessageBridgeJoin,
): CheckReport {
  if (isBridgeJoinDeferred(joined)) {
    throw new Error('Cannot create a check report from a deferred bridge join.');
  }
  const limitations = messages === undefined
    ? joined.limitations
    : [...joined.limitations, ...messages.limitations,
        ...messageConsumerLimitations(messages)].sort(compareLimitations);
  const gaps = receiverCoverageGaps(limitations);
  const issues: CheckIssue[] = [
    ...joined.unhandledInvocations.map<CheckIssue>((item) => ({
      severity: gaps.hidesHandlers(item.target, item.channel) ? 'warning' : 'error',
      code: gaps.hidesHandlers(item.target, item.channel)
        ? 'unhandled-invocation-unverified'
        : 'unhandled-invocation',
      target: item.target,
      channel: item.channel,
      method: item.method,
      evidence: item.invocations,
    })),
    ...joined.unregisteredChannelCreations.map<CheckIssue>((item) => ({
      severity: gaps.hidesRegistrations(item.target, item.channel) ? 'warning' : 'error',
      code: gaps.hidesRegistrations(item.target, item.channel)
        ? 'unregistered-channel-creation-unverified'
        : 'unregistered-channel-creation',
      target: item.target,
      channel: item.channel,
      evidence: item.creations,
    })),
    ...joined.registrationsWithoutCreations.map<CheckIssue>((item) => ({
      severity: 'warning',
      code: 'registration-without-creation',
      target: item.target,
      channel: item.channel,
      evidence: item.registrations,
    })),
    ...joined.handlersWithoutInvocations.map<CheckIssue>((item) => ({
      severity: 'warning',
      code: 'handler-without-invocation',
      target: item.target,
      channel: item.channel,
      method: item.method,
      evidence: item.handlers,
    })),
    ...joined.moduleImportsWithoutExports.map<CheckIssue>((item) => {
      // 같은 이름의 export가 mechanism만 다르게 관찰됐다면 진짜 공백이 아니라
      // 해석 경로 불일치다 — 코어 호출×Expo export의 상호운용 여부가 미해결이므로
      // error가 아니라 별도 warning으로 내린다. optional 판정보다 앞서야 한다 —
      // 수신 측 export가 관찰된 상황에 "미검증" 문구를 붙이면 틀리다.
      const mismatched = item.incompatibleReceivers !== undefined;
      // 호출자 전부가 부재 허용 API(requireOptionalNativeModule·Registry.get)를
      // 썼다면 미수출은 크래시가 아니라 null 반환이다 — 호출자가 감당하므로
      // warning으로 내린다. 하나라도 던지는 호출자가 있으면 error를 유지한다.
      const allOptional = item.callers.length > 0 &&
        item.callers.every((caller) => caller.optional === true);
      return {
        severity: mismatched || allOptional || gaps.hidesExports(item.target)
          ? 'warning'
          : 'error',
        code: mismatched
          ? 'module-import-mechanism-mismatch'
          : allOptional
            ? 'module-import-without-export-optional'
            : gaps.hidesExports(item.target)
              ? 'module-import-without-export-unverified'
              : 'module-import-without-export',
        target: item.target,
        channel: item.channel,
        // 불일치 수신 측 위치까지 실어야 어느 export가 다른 경로로
        // 해석되는지 보고서에서 보인다.
        evidence: [...item.callers, ...(item.incompatibleReceivers ?? [])],
      };
    }),
    ...joined.moduleExportsWithoutImports.map<CheckIssue>((item) => ({
      severity: 'warning',
      // 같은 이름의 호출이 mechanism만 다르게 관찰됐다면 미호출이 아니라
      // 해석 경로 불일치다.
      code: item.incompatibleCallers !== undefined
        ? 'module-export-mechanism-mismatch'
        : 'module-export-without-import',
      target: item.target,
      channel: item.channel,
      evidence: [...item.receivers, ...(item.incompatibleCallers ?? [])],
    })),
    ...joined.componentRequiresWithoutExports.map<CheckIssue>((item) => {
      const mismatched = item.incompatibleReceivers !== undefined;
      // Expo 측 requireNativeViewManager에는 코어 폴백이 없어, 관찰된 export가
      // 모두 코어라면 호출은 확정된 미수출 error다. 코어 호출×Expo export만은
      // 상호운용이 미해결이므로 warning으로 내린다.
      const allExpoCallers = item.callers.length > 0 &&
        item.callers.every((caller) => caller.mechanism === 'expo');
      const unresolved = mismatched && !allExpoCallers;
      return {
        severity: unresolved || gaps.hidesExports(item.target)
          ? 'warning'
          : 'error',
        code: unresolved
          ? 'component-require-mechanism-mismatch'
          : gaps.hidesExports(item.target)
            ? 'component-require-without-export-unverified'
            : 'component-require-without-export',
        target: item.target,
        channel: item.channel,
        evidence: [...item.callers, ...(item.incompatibleReceivers ?? [])],
      };
    }),
    ...joined.componentExportsWithoutRequires.map<CheckIssue>((item) => ({
      severity: 'warning',
      code: item.incompatibleCallers !== undefined
        ? 'component-export-mechanism-mismatch'
        : 'component-export-without-require',
      target: item.target,
      channel: item.channel,
      evidence: [...item.receivers, ...(item.incompatibleCallers ?? [])],
    })),
    ...joined.relationUsesWithoutDecls.map<CheckIssue>((item) => ({
      severity: gaps.hidesDecls(item.target) ? 'warning' : 'error',
      code: gaps.hidesDecls(item.target)
        ? 'relation-use-without-decl-unverified'
        : 'relation-use-without-decl',
      target: item.target,
      channel: item.channel,
      evidence: item.uses,
    })),
    ...joined.columnUsesWithoutDecls.map<CheckIssue>((item) => ({
      severity: gaps.hidesDecls(item.target) ? 'warning' : 'error',
      code: gaps.hidesDecls(item.target)
        ? 'column-use-without-decl-unverified'
        : 'column-use-without-decl',
      target: item.target,
      channel: item.channel,
      method: item.column,
      evidence: item.uses,
    })),
    ...joined.ambiguousRelationUses.map<CheckIssue>((item) => ({
      severity: 'warning',
      code: 'ambiguous-relation-use',
      target: item.target,
      channel: item.channel,
      evidence: item.uses,
      candidates: item.candidates,
    })),
    ...joined.relationDeclsWithoutUses.map<CheckIssue>((item) => ({
      severity: 'warning',
      code: gaps.hidesRelationUses(item.target)
        ? 'relation-decl-without-use-unverified'
        : 'relation-decl-without-use',
      target: item.target,
      channel: item.channel,
      evidence: item.decls,
    })),
    ...(messages === undefined ? [] : createMessageIssues(messages, gaps)),
  ];
  return {
    format: 'isthmus-check',
    version: 1,
    summary: {
      errors: issues.filter(({ severity }) => severity === 'error').length,
      warnings: issues.filter(({ severity }) => severity === 'warning').length,
      matchedChannels: joined.matchedChannels.length,
      matchedMethods: joined.matchedMethods.length,
      matchedModules: joined.matchedModules.length,
      matchedComponents: joined.matchedComponents.length,
      // persistence 입력이 있을 때만 실린다 — bridge만 있는 요약을 깨지 않는다.
      ...(joined.matchedRelations.length > 0 ||
          joined.relationUsesWithoutDecls.length > 0 ||
          joined.relationDeclsWithoutUses.length > 0 ||
          joined.ambiguousRelationUses.length > 0 ||
          joined.matchedColumns.length > 0 ||
          joined.columnUsesWithoutDecls.length > 0
        ? {
          matchedRelations: joined.matchedRelations.length,
          matchedColumns: joined.matchedColumns.length,
        }
        : {}),
      ...(messages === undefined ? {} : {
        matchedMessages: matchedMessageRoutes(messages, 'basic-message-channel'),
        matchedStreams: matchedMessageRoutes(messages, 'event-channel'),
        ...(messages.routes.some(({ transport }) => transport === 'react-native-event') ? {
          matchedEvents: matchedMessageRoutes(messages, 'react-native-event'),
        } : {}),
      }),
      observedFacts: joined.observedFacts + (messages?.observedFacts ?? 0),
      observedLimitations: limitations.length,
    },
    issues,
    limitations,
  };
}

/** v2 transport별 check 진단 코드·수신 공백 접두사·미대응 한계 이름이다. */
const messageTransportPolicies = {
  'basic-message-channel': {
    send: 'unhandled-message-send',
    sendUnverified: 'unhandled-message-send-unverified',
    handler: 'message-handler-without-send',
    gap: 'unattributed-message-handles:',
    dynamic: 'dynamic-message-address',
    unmatched: 'unmatched-message-boundary',
    subject: 'message',
  },
  'event-channel': {
    send: 'unhandled-stream-listen',
    sendUnverified: 'unhandled-stream-listen-unverified',
    handler: 'stream-handler-without-listen',
    gap: 'unattributed-stream-handles:',
    dynamic: 'dynamic-stream-address',
    unmatched: 'unmatched-stream-boundary',
    subject: 'stream',
  },
  'react-native-event': {
    send: 'event-listen-without-emit',
    sendUnverified: 'event-listen-without-emit-unverified',
    handler: 'event-emit-without-listen',
    gap: 'unattributed-event-emits:',
    dynamic: 'dynamic-event-address',
    unmatched: 'unmatched-event-boundary',
    subject: 'event',
  },
} as const satisfies Record<BridgeMessageTransport, {
  send: CheckIssueCode;
  sendUnverified: CheckIssueCode;
  handler: CheckIssueCode;
  gap: string;
  dynamic: string;
  unmatched: string;
  subject: string;
}>;

/** 같은 transport에서 literal channel을 덮는 prefix 후보를 찾는다. */
function coveredByPrefix(
  messages: MessageBridgeJoin,
  route: { readonly channel: string; readonly transport: BridgeMessageTransport },
  side: 'senders' | 'handlers',
): boolean {
  return messages.routes.some((candidate) =>
    candidate.matching === 'prefix' && candidate.transport === route.transport &&
    route.channel.startsWith(candidate.channel) && candidate[side].length > 0);
}

/** v1과 같은 짝 규칙으로 v2 메시지·스트림 경계 진단을 만든다. */
function createMessageIssues(
  messages: MessageBridgeJoin,
  gaps: ReceiverCoverageGaps,
): CheckIssue[] {
  const issues: CheckIssue[] = [];
  for (const route of messages.routes) {
    const policy = messageTransportPolicies[route.transport];
    const target = messageTarget(route.transport);
    const hasSenders = route.senders.length > 0;
    const hasHandlers = route.handlers.length > 0;
    // 양쪽이 관찰됐거나 dynamic prefix 후보뿐이면 error/warning을 내지 않는다.
    // prefix 후보의 미대응은 아래 소비자 한계로 남긴다. literal 경계라도
    // 그 prefix 후보가 빠진 쪽을 채우면 후보로 강등해 오탐을 만들지 않는다.
    if ((hasSenders && hasHandlers) || route.matching === 'prefix') continue;
    if (hasSenders && coveredByPrefix(messages, route, 'handlers')) continue;
    if (hasHandlers && coveredByPrefix(messages, route, 'senders')) continue;
    if (hasSenders) {
      const hidden = gaps.hidesHandlers(target, route.channel) ||
        messages.limitations.some(({ platform, message }) =>
          isReceiverPlatform(platform) && message.startsWith(policy.gap)) ||
        (route.transport === 'react-native-event' && messages.unresolved.some((endpoint) =>
          endpoint.transport === 'react-native-event' && isReceiverPlatform(endpoint.platform)));
      issues.push({
        severity: hidden || route.transport === 'react-native-event' ? 'warning' : 'error',
        code: hidden ? policy.sendUnverified : policy.send,
        target,
        channel: route.channel,
        evidence: route.senders,
      });
    } else {
      issues.push({
        severity: 'warning',
        code: policy.handler,
        target,
        channel: route.channel,
        evidence: route.handlers,
      });
    }
  }
  return issues;
}

/** 한 transport에서 literal로 발신·수신이 모두 관찰된 경계 수를 센다. */
function matchedMessageRoutes(
  messages: MessageBridgeJoin,
  transport: BridgeMessageTransport,
): number {
  return messages.routes.filter((route) =>
    route.transport === transport && route.matching === 'literal' &&
    route.senders.length > 0 && route.handlers.length > 0,
  ).length;
}

/**
 * 이음매 없는 v2 입력에서 소비자가 직접 센 한계를 만든다.
 *
 * literal로 확정되지 않은 dynamic prefix 후보와, literal도 prefix도 없는
 * 미해석 주소를 관찰량으로 남긴다. 이들은 error가 아니라 한계다 —
 * 실제 suffix/instance가 맞는지는 정적 사실로 확정할 수 없다.
 */
function messageConsumerLimitations(
  messages: MessageBridgeJoin,
): JoinLimitation[] {
  const limitations: JoinLimitation[] = [];
  for (const route of messages.routes) {
    if (route.matching !== 'prefix') continue;
    const policy = messageTransportPolicies[route.transport];
    limitations.push({
      platform: 'cross-platform',
      target: messageTarget(route.transport),
      tool: 'isthmus',
      origin: 'consumer',
      message: `${policy.dynamic}: ${policy.subject} channel prefix ${route.channel} `
        + 'describes possible routes; suffix and instance wiring are not resolved',
      channels: [route.channel],
    });
    if (route.senders.length > 0 && route.handlers.length > 0) continue;
    limitations.push({
      platform: 'cross-platform',
      target: messageTarget(route.transport),
      tool: 'isthmus',
      origin: 'consumer',
      message: `${policy.unmatched}: a related ${policy.subject} boundary has no observed `
        + `counterpart for the proven prefix ${route.channel}`,
      channels: [route.channel],
    });
  }
  for (const target of ['flutter', 'react-native'] as const) {
    const count = messages.unresolved.filter(({ transport }) =>
      (transport === 'react-native-event' ? 'react-native' : 'flutter') === target).length;
    if (count === 0) continue;
    limitations.push({
      platform: 'cross-platform',
      target,
      tool: 'isthmus',
      origin: 'consumer',
      message: target === 'react-native'
        ? `unresolved-event-names: ${count} event facts have no literal name and were not joined`
        : `unresolved-message-addresses: ${count} message facts have no literal or proven prefix and were not joined`,
    });
  }
  return limitations;
}

/** 수신 측이 스스로 알린 분석 공백이 target별로 무엇을 가리는지 나타낸다. */
interface ReceiverCoverageGaps {
  hidesHandlers(target: BridgeTarget, channel: string): boolean;
  hidesRegistrations(target: BridgeTarget, channel: string): boolean;
  /**
   * 동적 export 계수는 소비자만 세며 소비자 한계는 채널 범위를 갖지 않으므로
   * 이 공백은 target 단위로만 적용된다.
   */
  hidesExports(target: BridgeTarget): boolean;
  /**
   * persistence 수신 측(sql 문서)이 카탈로그 커버리지 공백을 신고했는지다.
   * 스캔 범위를 벗어난 스키마를 못 봤을 수 있으면 미선언 진단은 판정 불가다.
   */
  hidesDecls(target: BridgeTarget): boolean;
  /**
   * 호출 측이 관계 사용을 동적으로 숨겼는지다 — 소비자가 직접 센
   * `unjoined-dynamic-relations` 한계다. 미참조 선언 진단을 무른다.
   */
  hidesRelationUses(target: BridgeTarget): boolean;
}

/**
 * 수신 측이 핸들러나 등록을 놓쳤을 수 있다고 스스로 알렸는지 target별로 확인한다.
 *
 * 이때 "핸들러 없는 호출"은 경계 불일치가 아니라 판정 불가다. Objective-C로 쓰인
 * Flutter 핸들러처럼 수신 측 분석에 아예 나타나지 않는 코드가 실제로 있어서,
 * error로 단정하면 이 도구가 없애려던 오탐을 이 도구가 만든다.
 *
 * 공백의 종류는 구분한다. 이름이 리터럴이 아닌 채널 등록 하나가 무관한 메서드
 * 진단까지 무르게 하면 안 된다. 호출 측 한계는 네이티브 코드를 가리지 않으므로
 * 수신 측 플랫폼의 한계만 본다.
 *
 * 완화 단위는 진단의 target이다. 사실은 target별로만 조인되므로, 다른 target의
 * 수신 문서가 신고한 공백은 현재 target의 핸들러를 가릴 수 없다. target이 없는
 * (사실이 없는) 수신 문서는 어느 target을 분석했는지 특정할 수 없어 모든 target에
 * 적용한다. 같은 target에 귀속된 수신 문서가 사실과 함께 존재해도 마찬가지다.
 * 수신 문서 여러 개가 소스 트리를 나누어 가졌을 수 있으므로, 귀속 없는 문서가
 * 본 소스가 해당 target의 핸들러를 가릴 가능성을 배제할 수 없기 때문이다.
 *
 * `unjoined-` 접두사는 isthmus가 직접 세어 자신을 출처로 밝힌 한계만 인정한다.
 * 생산자 문자열은 신뢰의 근거가 아니므로, 같은 접두사를 차용한 생산자 신고는
 * 완화 근거가 되지 못한다.
 */
function receiverCoverageGaps(
  limitations: readonly JoinLimitation[],
): ReceiverCoverageGaps {
  // persistence 도메인의 수신 측은 sql이다 — sql 문서가 스스로 신고한
  // 카탈로그 공백도 수신 측 한계로 모은다. bridge 수신 측은 명시 규칙으로 가려
  // kotlin·swift persistence 문서의 한계가 bridge 수신 공백으로 읽히지 않게 한다.
  const receiverLimitations = limitations.filter((limitation) =>
    isBridgeReceiverDocument(limitation) || limitation.platform === 'sql',
  );
  const memoized = new Map<BridgeTarget, {
    allHandlers: boolean; allRegistrations: boolean; allExports: boolean;
    allDecls: boolean; allRelationUses: boolean;
    handlerChannels: Set<string>; registrationChannels: Set<string>;
  }>();
  const gapsFor = (target: BridgeTarget) => {
    const existing = memoized.get(target);
    if (existing !== undefined) return existing;
    const gaps = {
      allHandlers: false, allRegistrations: false, allExports: false,
      allDecls: false, allRelationUses: false,
      handlerChannels: new Set<string>(), registrationChannels: new Set<string>(),
    };
    for (const { platform, target: gapTarget, tool, message, channels, origin } of receiverLimitations) {
      if (gapTarget !== null && gapTarget !== target) continue;
      const handlers = startsWithAny(producerHandlerGapPrefixes)(message) ||
        (origin === 'consumer' && tool === 'isthmus' && startsWithAny(isthmusHandlerGapPrefixes)(message));
      const registrations = startsWithAny(sourceCoverageGapPrefixes)(message) ||
        (origin === 'consumer' && tool === 'isthmus' && startsWithAny(isthmusRegistrationGapPrefixes)(message));
      const exports = origin === 'consumer' && tool === 'isthmus' &&
        startsWithAny(isthmusExportGapPrefixes)(message);
      // 카탈로그 커버리지 공백은 sql 문서의 자기 신고만 인정한다 — 다른
      // 플랫폼 문서가 같은 접두사를 달아도 스키마 스캔 범위의 근거가 아니다.
      const decls = platform === 'sql' && startsWithAny(schemaDeclGapPrefixes)(message);
      // 하나라도 범위가 불명확한 공백이 있으면 같은 target의 좁은 범위로 덮지 않는다.
      if (channels === undefined) {
        gaps.allHandlers ||= handlers;
        gaps.allRegistrations ||= registrations;
        gaps.allExports ||= exports;
        gaps.allDecls ||= decls;
      } else {
        for (const channel of channels) {
          if (handlers) gaps.handlerChannels.add(channel);
          if (registrations) gaps.registrationChannels.add(channel);
        }
      }
    }
    // 호출 측이 관계 사용을 숨긴 공백은 수신 측 한계가 아니라 소비자가 직접 센
    // 계수다 — 플랫폼과 무관하게 같은 target의 미참조 선언 진단만 무른다.
    for (const { target: gapTarget, tool, message, origin } of limitations) {
      if (gapTarget !== null && gapTarget !== target) continue;
      if (origin === 'consumer' && tool === 'isthmus' &&
        startsWithAny(isthmusRelationUseGapPrefixes)(message)) {
        gaps.allRelationUses = true;
      }
    }
    memoized.set(target, gaps);
    return gaps;
  };
  return {
    hidesHandlers: (target, channel) => {
      const gaps = gapsFor(target);
      return gaps.allHandlers || gaps.handlerChannels.has(channel);
    },
    hidesRegistrations: (target, channel) => {
      const gaps = gapsFor(target);
      return gaps.allRegistrations || gaps.registrationChannels.has(channel);
    },
    hidesExports: (target) => gapsFor(target).allExports,
    hidesDecls: (target) => gapsFor(target).allDecls,
    hidesRelationUses: (target) => gapsFor(target).allRelationUses,
  };
}

/** 주어진 접두사 중 하나로 시작하는지 검사하는 술어를 만든다. */
function startsWithAny(
  prefixes: readonly string[],
): (message: string) => boolean {
  return (message) => prefixes.some((prefix) => message.startsWith(prefix));
}

/**
 * 수신 측 소스 자체가 분석되지 않아 등록과 핸들러를 모두 가리는 한계다.
 *
 * 알려진 접두사만 인정한다. 모르는 한계를 공백으로 넓게 해석하면 진짜 불일치가
 * 경고로 묻힌다.
 */
const sourceCoverageGapPrefixes = [
  'objective-c-sources:',
  'shadowed-flutter-method-channel:',
];

/** 생산자가 신고하는, 핸들러 본문만 가리는 한계다. */
const handlerBodyCoverageGapPrefixes = ['opaque-handler-bodies:'];

/** 생산자 신고 중 핸들러를 가릴 수 있는 한계 전체다. */
const producerHandlerGapPrefixes = [
  ...sourceCoverageGapPrefixes,
  ...handlerBodyCoverageGapPrefixes,
];

/**
 * isthmus가 직접 센 한계 중 핸들러를 가리는 접두사다.
 *
 * 생산자의 신고 개수에 의존하지 않으므로 `tool`이 `isthmus`인 항목만 인정한다.
 */
const isthmusHandlerGapPrefixes = [
  'unjoined-dynamic-methods:',
  'unjoined-unattributed-handlers:',
];

/** isthmus가 직접 센 한계 중 채널 등록을 가리는 접두사다. */
const isthmusRegistrationGapPrefixes = ['unjoined-dynamic-channels:'];

/**
 * isthmus가 직접 센 한계 중 모듈·컴포넌트 export를 가리는 접두사다.
 *
 * RN의 export 사실은 이름이 리터럴일 때만 조인되므로, 동적 이름을 가진
 * 수신 측 사실이 곧 가려진 export의 상한이다.
 */
const isthmusExportGapPrefixes = ['unjoined-dynamic-exports:'];

/**
 * sql 문서가 스스로 신고하는 카탈로그 커버리지 공백이다 — 스캔 범위 밖
 * 스키마를 못 봤을 수 있어 미선언 진단을 판정 불가로 내린다.
 */
const schemaDeclGapPrefixes = ['catalog-coverage:'];

/**
 * 호출 측 관계 참조가 동적이라 조인하지 못한 소비자 계수다 — 미참조 선언이
 * 진짜 미참조인지 판정할 수 없게 하는 호출 측 공백이다.
 */
const isthmusRelationUseGapPrefixes = ['unjoined-dynamic-relations:'];
