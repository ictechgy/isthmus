import type { BridgeTarget } from '../exchange/parse.ts';
import type {
  BridgeEndpoint,
  BridgeJoinResult,
  JoinLimitation,
} from '../join/join.ts';

/** check 결과 개수를 빠르게 판단할 요약이다. */
export interface CheckSummary {
  readonly errors: number;
  readonly warnings: number;
  readonly matchedChannels: number;
  readonly matchedMethods: number;
}

/** check가 보고하는 안정적인 진단 종류다. */
export type CheckIssueCode =
  | 'unhandled-invocation'
  | 'unregistered-channel-creation'
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
  return `${JSON.stringify(sortJson(report), null, 2)}\n`;
}

/** JSON 배열 순서는 보존하고 객체 키만 모든 깊이에서 정렬한다. */
function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortJson(item)]),
  );
}

/** 조인 결과를 정책 심각도가 포함된 check 문서로 바꾼다. */
export function createCheckReport(joined: BridgeJoinResult): CheckReport {
  return {
    format: 'isthmus-check',
    version: 1,
    summary: {
      errors:
        joined.unhandledInvocations.length +
        joined.unregisteredChannelCreations.length,
      warnings: joined.handlersWithoutInvocations.length,
      matchedChannels: joined.matchedChannels.length,
      matchedMethods: joined.matchedMethods.length,
    },
    issues: [
      ...joined.unhandledInvocations.map<CheckIssue>((item) => ({
        severity: 'error',
        code: 'unhandled-invocation',
        target: item.target,
        channel: item.channel,
        method: item.method,
        evidence: item.invocations,
      })),
      ...joined.unregisteredChannelCreations.map<CheckIssue>((item) => ({
        severity: 'error',
        code: 'unregistered-channel-creation',
        target: item.target,
        channel: item.channel,
        evidence: item.creations,
      })),
      ...joined.handlersWithoutInvocations.map<CheckIssue>((item) => ({
        severity: 'warning',
        code: 'handler-without-invocation',
        target: item.target,
        channel: item.channel,
        method: item.method,
        evidence: item.handlers,
      })),
    ],
    limitations: joined.limitations,
  };
}
