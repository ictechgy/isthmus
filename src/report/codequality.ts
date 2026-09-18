import type { CheckIssue, CheckReport } from './check-report.ts';
import {
  checkIssueRuleDescriptions,
  type IssueFingerprint,
} from './rules.ts';
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
 *
 * 이 형식이 표현하지 못하는 것을 명시한다:
 * - 베이스라인이 받아들인 이슈는 제외한다 — 억제 개념이 없어 위젯이 다시
 *   발견으로 표시하면 안 되기 때문이다(SARIF의 `suppressions`와 다른 결정).
 * - 두 번째 이후 증거 끝점은 실리지 않는다 — CodeClimate의 `other_locations`
 *   선택 필드를 GitLab이 받아들이는지 검증하지 않았다(SARIF의
 *   `relatedLocations`와 다른 범위).
 * - `report.limitations`는 표현되지 않는다 — SARIF와 같은 한계이며, 분석
 *   공백 신호는 `*-unverified` 계열의 minor 발견으로만 전달된다.
 * - `location.path`는 URI 인코딩하지 않은 프로젝트 상대 경로다 — SARIF의
 *   `sarifUri`와 다른 소비자(URI 참조가 아니라 파일 뷰어 경로)라서다.
 *
 * `fingerprint`는 논리 이슈 식별자(code·target·channel·method) 해시다.
 * GitLab은 같은 지문의 발견을 병합하므로, check 보고서가 같은 논리 키의
 * 이슈를 두 개 이상 담으면 안 되는 상류 불변에 의존한다 — 중복이 관찰되면
 * 깨진 아티팩트 대신 명시적으로 실패한다.
 */
export function createCodeQualityFindings(
  report: CheckReport,
  issueFingerprint: IssueFingerprint,
): readonly CodeQualityFinding[] {
  const seen = new Set<string>();
  return report.issues
    .filter((issue) => issue.suppressed !== true)
    .map((issue) => {
      const finding = codeQualityFinding(issue, issueFingerprint);
      if (seen.has(finding.fingerprint)) {
        throw new Error(
          'Cannot create Code Quality findings with duplicate fingerprints.',
        );
      }
      seen.add(finding.fingerprint);
      return finding;
    });
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
  const context = issue.method === undefined
    ? `Channel '${issue.channel}'`
    : `Channel '${issue.channel}', method '${issue.method}'`;
  return {
    description:
      `${checkIssueRuleDescriptions[issue.code]} ${context} (target: ${issue.target})`,
    check_name: `isthmus:${issue.code}`,
    fingerprint: issueFingerprint(issue),
    severity: codeQualitySeverity(issue.severity),
    location: {
      path: primary.location.path,
      lines: { begin: line },
    },
  };
}

/**
 * check 심각도를 Code Quality 어휘로 내린다. `CheckIssue.severity`가 커지면
 * 조용한 minor 폴백 대신 명시적으로 실패한다.
 */
function codeQualitySeverity(
  severity: CheckIssue['severity'],
): CodeQualitySeverity {
  if (severity === 'error') return 'major';
  if (severity === 'warning') return 'minor';
  throw new Error('Cannot map an unknown check severity to Code Quality.');
}
