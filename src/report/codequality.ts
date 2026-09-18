import type { CheckIssue, CheckReport } from './check-report.ts';
import type { IssueFingerprint } from './sarif.ts';
import { encodeSortedJson } from './sorted-json.ts';

/**
 * GitLab Code Quality가 받아들이는 심각도 어휘다. check의 error는 실제
 * 불일치라 major로, warning은 미해결·비대칭 관찰이라 minor로 내린다.
 */
export type CodeQualitySeverity = 'info' | 'minor' | 'major' | 'critical' | 'blocker';

/**
 * GitLab Code Quality 보고서의 발견 항목 하나다. 형식은 CodeClimate 기반이며
 * `fingerprint`가 같은 이슈의 병합 대상 판별에 쓰인다.
 */
export interface CodeQualityFinding {
  readonly description: string;
  readonly check_name: string;
  readonly fingerprint: string;
  readonly severity: CodeQualitySeverity;
  readonly location: {
    readonly path: string;
    readonly lines: { readonly begin: number };
  };
}

/**
 * check 보고서를 GitLab Code Quality 발견 목록으로 바꾼다.
 * 베이스라인이 받아들인 이슈는 위젯이 다시 발견으로 표시하면 안 되므로 제외한다
 * — SARIF의 `suppressions` 표시와 달리 이 형식에는 억제 개념이 없다.
 */
export function createCodeQualityFindings(
  report: CheckReport,
  issueFingerprint: IssueFingerprint,
): readonly CodeQualityFinding[] {
  return report.issues
    .filter((issue) => issue.suppressed !== true)
    .map((issue) => codeQualityFinding(issue, issueFingerprint));
}

/** 발견 목록을 결정적인 JSON 문자열로 인코딩한다. */
export function encodeCodeQualityReport(
  findings: readonly CodeQualityFinding[],
): string {
  return encodeSortedJson(findings);
}

/** 논리 이슈 하나를 Code Quality 발견으로 바꾼다. 위치는 첫 번째 증거 끝점이다. */
function codeQualityFinding(
  issue: CheckIssue,
  issueFingerprint: IssueFingerprint,
): CodeQualityFinding {
  const primary = issue.evidence[0];
  if (primary === undefined) {
    throw new Error('Cannot create a Code Quality finding without evidence.');
  }
  const { line } = primary.location;
  if (line < 1) {
    throw new Error('Cannot create a Code Quality location before the first line.');
  }
  const subject = issue.method === undefined
    ? `${issue.code} on channel '${issue.channel}'`
    : `${issue.code} on channel '${issue.channel}' for method '${issue.method}'`;
  return {
    description: `${subject} (target: ${issue.target})`,
    check_name: `isthmus:${issue.code}`,
    fingerprint: issueFingerprint(issue),
    severity: issue.severity === 'error' ? 'major' : 'minor',
    location: {
      path: primary.location.path,
      lines: { begin: line },
    },
  };
}
