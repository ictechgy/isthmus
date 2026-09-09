import type { BridgeTarget } from '../exchange/parse.ts';
import { isReceiverPlatform } from '../exchange/parse.ts';
import type {
  BridgeEndpoint,
  BridgeJoinResult,
  JoinLimitation,
} from '../join/join.ts';
import { isBridgeJoinDeferred } from '../join/join.ts';
import { encodeSortedJson } from './sorted-json.ts';

/** check 결과 개수를 빠르게 판단할 요약이다. */
export interface CheckSummary {
  readonly errors: number;
  readonly warnings: number;
  readonly matchedChannels: number;
  readonly matchedMethods: number;
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
] as const;

/** check가 보고하는 안정적인 진단 종류다. */
export type CheckIssueCode = (typeof checkIssueCodes)[number];

/** 삭제 판정 없이 경계 불일치 사실과 증거만 전달한다. */
export interface CheckIssue {
  readonly severity: 'error' | 'warning';
  readonly code: CheckIssueCode;
  readonly target: BridgeTarget;
  readonly channel: string;
  readonly method?: string;
  readonly evidence: readonly BridgeEndpoint[];
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

/** 조인 결과를 정책 심각도가 포함된 check 문서로 바꾼다. */
export function createCheckReport(joined: BridgeJoinResult): CheckReport {
  if (isBridgeJoinDeferred(joined)) {
    throw new Error('Cannot create a check report from a deferred bridge join.');
  }
  const gaps = receiverCoverageGaps(joined.limitations);
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
  ];
  return {
    format: 'isthmus-check',
    version: 1,
    summary: {
      errors: issues.filter(({ severity }) => severity === 'error').length,
      warnings: issues.filter(({ severity }) => severity === 'warning').length,
      matchedChannels: joined.matchedChannels.length,
      matchedMethods: joined.matchedMethods.length,
      observedFacts: joined.observedFacts,
      observedLimitations: joined.limitations.length,
    },
    issues,
    limitations: joined.limitations,
  };
}

/** 수신 측이 스스로 알린 분석 공백이 target별로 무엇을 가리는지 나타낸다. */
interface ReceiverCoverageGaps {
  hidesHandlers(target: BridgeTarget, channel: string): boolean;
  hidesRegistrations(target: BridgeTarget, channel: string): boolean;
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
  const receiverLimitations = limitations.filter(({ platform }) =>
    isReceiverPlatform(platform),
  );
  const memoized = new Map<BridgeTarget, {
    allHandlers: boolean; allRegistrations: boolean;
    handlerChannels: Set<string>; registrationChannels: Set<string>;
  }>();
  const gapsFor = (target: BridgeTarget) => {
    const existing = memoized.get(target);
    if (existing !== undefined) return existing;
    const gaps = {
      allHandlers: false, allRegistrations: false,
      handlerChannels: new Set<string>(), registrationChannels: new Set<string>(),
    };
    for (const { target: gapTarget, tool, message, channels, origin } of receiverLimitations) {
      if (gapTarget !== null && gapTarget !== target) continue;
      const handlers = startsWithAny(producerHandlerGapPrefixes)(message) ||
        (origin === 'consumer' && tool === 'isthmus' && startsWithAny(isthmusHandlerGapPrefixes)(message));
      const registrations = startsWithAny(sourceCoverageGapPrefixes)(message) ||
        (origin === 'consumer' && tool === 'isthmus' && startsWithAny(isthmusRegistrationGapPrefixes)(message));
      // 하나라도 범위가 불명확한 공백이 있으면 같은 target의 좁은 범위로 덮지 않는다.
      if (channels === undefined) {
        gaps.allHandlers ||= handlers;
        gaps.allRegistrations ||= registrations;
      } else {
        for (const channel of channels) {
          if (handlers) gaps.handlerChannels.add(channel);
          if (registrations) gaps.registrationChannels.add(channel);
        }
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
