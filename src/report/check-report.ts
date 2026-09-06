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
}

/**
 * check가 보고하는 안정적인 진단 종류다.
 *
 * `-unverified` 종류는 수신 측이 스스로 분석 공백을 신고해, 핸들러가 없는 것인지
 * 보지 못한 것인지 구분할 수 없는 경우다. 사실과 증거는 같지만 판정이 아니다.
 */
export type CheckIssueCode =
  | 'unhandled-invocation'
  | 'unhandled-invocation-unverified'
  | 'unregistered-channel-creation'
  | 'unregistered-channel-creation-unverified'
  | 'registration-without-creation'
  | 'handler-without-invocation';

/** 삭제 판정 없이 경계 불일치 사실과 증거만 전달한다. */
export interface CheckIssue {
  readonly severity: 'error' | 'warning';
  readonly code: CheckIssueCode;
  readonly target: BridgeTarget;
  readonly channel: string;
  readonly method?: string;
  readonly evidence: readonly BridgeEndpoint[];
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
      severity: gaps.hidesHandlers ? 'warning' : 'error',
      code: gaps.hidesHandlers
        ? 'unhandled-invocation-unverified'
        : 'unhandled-invocation',
      target: item.target,
      channel: item.channel,
      method: item.method,
      evidence: item.invocations,
    })),
    ...joined.unregisteredChannelCreations.map<CheckIssue>((item) => ({
      severity: gaps.hidesRegistrations ? 'warning' : 'error',
      code: gaps.hidesRegistrations
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
    },
    issues,
    limitations: joined.limitations,
  };
}

/** 수신 측이 스스로 알린 분석 공백이 무엇을 가리는지 나눈 결과다. */
interface ReceiverCoverageGaps {
  readonly hidesHandlers: boolean;
  readonly hidesRegistrations: boolean;
}

/**
 * 수신 측이 핸들러나 등록을 놓쳤을 수 있다고 스스로 알렸는지 확인한다.
 *
 * 이때 "핸들러 없는 호출"은 경계 불일치가 아니라 판정 불가다. Objective-C로 쓰인
 * Flutter 핸들러처럼 수신 측 분석에 아예 나타나지 않는 코드가 실제로 있어서,
 * error로 단정하면 이 도구가 없애려던 오탐을 이 도구가 만든다.
 *
 * 공백의 종류는 구분한다. 이름이 리터럴이 아닌 채널 등록 하나가 무관한 메서드
 * 진단까지 무르게 하면 안 된다. 호출 측 한계는 네이티브 코드를 가리지 않으므로
 * 수신 측 플랫폼의 한계만 본다.
 */
function receiverCoverageGaps(
  limitations: readonly JoinLimitation[],
): ReceiverCoverageGaps {
  const messages = limitations
    .filter(({ platform }) => isReceiverPlatform(platform))
    .map(({ message }) => message);
  return {
    hidesHandlers: messages.some(startsWithAny(handlerCoverageGapPrefixes)),
    hidesRegistrations: messages.some(
      startsWithAny(registrationCoverageGapPrefixes),
    ),
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

/**
 * 핸들러를 가릴 수 있는 한계다.
 *
 * `unjoined-`는 isthmus가 직접 센 값이라 생산자의 신고 개수에 의존하지 않는다.
 */
const handlerCoverageGapPrefixes = [
  ...sourceCoverageGapPrefixes,
  'opaque-handler-bodies:',
  'unjoined-dynamic-methods:',
  'unjoined-unattributed-handlers:',
];

/** 채널 등록을 가릴 수 있는 한계다. */
const registrationCoverageGapPrefixes = [
  ...sourceCoverageGapPrefixes,
  'unjoined-dynamic-channels:',
];
