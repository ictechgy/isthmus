import { createHash } from 'node:crypto';

import { baselineEntryKey } from './baseline.ts';
import type {
  CheckIssue,
  CheckIssueCode,
  CheckReport,
} from './check-report.ts';
import { checkIssueCodes } from './check-report.ts';
import { encodeSortedJson } from './sorted-json.ts';

/** GitHub code scanning이 받아들이는 SARIF 2.1.0 스키마 식별자다. */
export const sarifSchema = 'https://json.schemastore.org/sarif-2.1.0.json';

/** 도구 소개 문서의 안정적인 위치다. */
export const sarifInformationUri = 'https://github.com/ictechgy/isthmus';

/** SARIF 물리 위치다. 경로는 프로젝트 루트 기준 상대 경로를 그대로 쓴다. */
interface SarifPhysicalLocation {
  readonly artifactLocation: { readonly uri: string };
  readonly region: { readonly startLine: number; readonly startColumn: number };
}

/** 결과 하나가 위치(규칙·수준·메시지·근거)를 다 담는 형태다. */
interface SarifResult {
  readonly ruleId: CheckIssueCode;
  readonly ruleIndex: number;
  readonly level: 'error' | 'warning';
  readonly message: { readonly text: string };
  readonly locations: ReadonlyArray<{
    readonly physicalLocation: SarifPhysicalLocation;
  }>;
  readonly relatedLocations?: ReadonlyArray<{
    readonly id: number;
    readonly physicalLocation: SarifPhysicalLocation;
  }>;
  readonly suppressions?: ReadonlyArray<{
    readonly kind: 'external';
    readonly status: 'accepted';
  }>;
  readonly properties: {
    readonly target: string;
    readonly channel: string;
    readonly method?: string;
  };
  readonly partialFingerprints: { readonly isthmusIssueV1: string };
}

/** check가 보고하는 진단 종류의 SARIF 규칙 문구다. */
const ruleDescriptions: Record<CheckIssueCode, string> = {
  'unhandled-invocation':
    'A caller-side bridge method invocation has no matching handler on any receiver-side document.',
  'unhandled-invocation-unverified':
    'A caller-side bridge method invocation has no matching handler, and a receiver-side analysis gap may be hiding it.',
  'unregistered-channel-creation':
    'A caller-side bridge channel creation has no matching registration on any receiver-side document.',
  'unregistered-channel-creation-unverified':
    'A caller-side bridge channel creation has no matching registration, and a receiver-side analysis gap may be hiding it.',
  'registration-without-creation':
    'A receiver-side channel registration has no matching caller-side channel creation.',
  'handler-without-invocation':
    'A receiver-side bridge method handler has no matching caller-side invocation.',
};

/** SARIF 2.1.0 로그 문서다. 결정적 정렬로 인코딩한다. */
export interface SarifLog {
  readonly $schema: string;
  readonly version: '2.1.0';
  readonly runs: ReadonlyArray<{
    readonly tool: {
      readonly driver: {
        readonly name: 'isthmus';
        readonly informationUri: string;
        readonly version?: string;
        readonly rules: ReadonlyArray<{
          readonly id: CheckIssueCode;
          readonly shortDescription: { readonly text: string };
        }>;
      };
    };
    readonly results: readonly SarifResult[];
  }>;
}

/** check 보고서를 SARIF 2.1.0 로그로 바꾼다. */
export function createSarifLog(
  report: CheckReport,
  toolVersion?: string,
): SarifLog {
  const rules = [...checkIssueCodes].sort().map((id) => ({
    id,
    shortDescription: { text: ruleDescriptions[id] },
  }));
  const ruleIndex = new Map(rules.map(({ id }, index) => [id, index]));
  return {
    $schema: sarifSchema,
    version: '2.1.0',
    runs: [{
      tool: {
        driver: {
          name: 'isthmus',
          informationUri: sarifInformationUri,
          ...(toolVersion ? { version: toolVersion } : {}),
          rules,
        },
      },
      results: report.issues.map((issue) => sarifResult(issue, ruleIndex)),
    }],
  };
}

/** SARIF 로그를 결정적인 JSON 문자열로 인코딩한다. */
export function encodeSarifLog(log: SarifLog): string {
  return encodeSortedJson(log);
}

/** 논리 이슈 하나를 규칙 참조와 물리 근거를 갖춘 결과로 바꾼다. */
function sarifResult(
  issue: CheckIssue,
  ruleIndex: Map<string, number>,
): SarifResult {
  const [primary, ...related] = issue.evidence;
  if (primary === undefined) {
    throw new Error('Cannot create a SARIF result without evidence.');
  }
  const index = ruleIndex.get(issue.code);
  if (index === undefined) {
    throw new Error('Cannot create a SARIF result for an unknown rule.');
  }
  const subject = issue.method === undefined
    ? `${issue.code} on channel '${issue.channel}'`
    : `${issue.code} on channel '${issue.channel}' for method '${issue.method}'`;
  return {
    ruleId: issue.code,
    ruleIndex: index,
    level: issue.severity,
    message: { text: subject },
    locations: [{ physicalLocation: physicalLocation(primary) }],
    ...(related.length === 0 ? {} : {
      relatedLocations: related.map((endpoint, order) => ({
        id: order + 1,
        physicalLocation: physicalLocation(endpoint),
      })),
    }),
    ...(issue.suppressed === true
      ? { suppressions: [{ kind: 'external' as const, status: 'accepted' as const }] }
      : {}),
    properties: {
      target: issue.target,
      channel: issue.channel,
      ...(issue.method === undefined ? {} : { method: issue.method }),
    },
    partialFingerprints: {
      isthmusIssueV1: issueFingerprint(issue),
    },
  };
}

/** 증거 끝점을 SARIF 물리 위치로 바꾼다. 줄·열은 계약과 같은 1 기반이다. */
function physicalLocation(endpoint: {
  readonly location: { readonly path: string; readonly line: number; readonly column: number };
}): SarifPhysicalLocation {
  const { line, column } = endpoint.location;
  if (line < 1 || column < 1) {
    throw new Error('Cannot create a SARIF region before the first line or column.');
  }
  return {
    artifactLocation: { uri: sarifUri(endpoint.location.path) },
    region: { startLine: line, startColumn: column },
  };
}

/**
 * 경로를 URI 참조로 만든다. 구분자 `/`는 보존하고 각 세그먼트를 RFC 3986으로
 * 인코딩해 공백·`#`·비ASCII 파일명이 GitHub 업로드를 깨지 않게 한다.
 */
export function sarifUri(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

/** 베이스라인과 같은 논리 키의 안정 지문으로 소스 줄 이동에도 중복을 막는다. */
function issueFingerprint(issue: {
  readonly code: string;
  readonly target: string;
  readonly channel: string;
  readonly method?: string;
}): string {
  return createHash('sha256').update(baselineEntryKey(issue)).digest('hex');
}
