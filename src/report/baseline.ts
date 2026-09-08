import {
  isBridgeTarget,
  isBridgeTimestamp,
  isJsonObject,
  isSafeNonEmptyString,
  type BridgeTarget,
} from '../exchange/parse.ts';
import { compareStrings } from '../compare.ts';
import type {
  CheckIssue,
  CheckIssueCode,
  CheckReport,
} from './check-report.ts';
import { checkIssueCodes } from './check-report.ts';
import { encodeSortedJson } from './sorted-json.ts';

/**
 * 베이스라인이 억제하는 논리 이슈 하나의 식별자다.
 *
 * 위치가 아니라 논리 키(code+target+channel+method)다. 소스 줄 이동이나
 * 증거 위치 변화는 억제를 깨지 않고, 새 채널·메서드 불일치는 새 키라
 * 억제되지 않는다. diff가 논리 연결을 비교하는 키와 같은 철학이다.
 */
export interface BaselineEntry {
  readonly code: CheckIssueCode;
  readonly target: BridgeTarget;
  readonly channel: string;
  readonly method?: string;
}

/** check 실행 사이에서 인정된 이슈를 보존하는 isthmus 소유 문서다. */
export interface BaselineDocument {
  readonly format: 'isthmus-baseline';
  readonly version: 1;
  readonly generatedAt: string;
  readonly entries: readonly BaselineEntry[];
}

/** 한 베이스라인 문서가 담을 수 있는 최대 항목 수다. */
export const MAX_BASELINE_ENTRIES = 10_000;

/** 외부 베이스라인 문서가 v1 계약을 어겼음을 나타낸다. */
export class BridgeBaselineValidationError extends Error {
  /** 입력 내용을 노출하지 않는 안전한 메시지를 보존한다. */
  constructor(message: string) {
    super(message);
    this.name = 'BridgeBaselineValidationError';
  }
}

/** 신뢰하지 않는 JSON 값을 검증된 isthmus-baseline v1 문서로 바꾼다. */
export function parseBaselineDocument(input: unknown): BaselineDocument {
  if (!isJsonObject(input)) fail('Baseline must be a JSON object.');
  if (input.format !== 'isthmus-baseline') {
    fail('Expected format "isthmus-baseline".');
  }
  // 숫자 비교라 `1.0`도 통과한다. bridge-facts의 version 검증과 같은 의도적 관용이다.
  if (input.version !== 1) {
    fail('Unsupported isthmus-baseline version; expected version 1.');
  }
  if (!isBridgeTimestamp(input.generatedAt)) {
    fail('Invalid generatedAt timestamp.');
  }
  if (!Array.isArray(input.entries)) fail('Entries must be an array.');
  if (input.entries.length > MAX_BASELINE_ENTRIES) {
    fail(`Entries exceed the ${MAX_BASELINE_ENTRIES} item limit.`);
  }
  const entries: BaselineEntry[] = [];
  const seen = new Set<string>();
  for (const [index, value] of input.entries.entries()) {
    const entry = normalizeEntry(value, index);
    const key = baselineEntryKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(entry);
  }
  entries.sort(compareEntries);
  return {
    format: 'isthmus-baseline',
    version: 1,
    generatedAt: input.generatedAt,
    entries,
  };
}

/**
 * 현재 보고서의 이슈 전체를 새 베이스라인 문서로 만든다.
 *
 * 읽기 상한과 같은 상한을 쓰기에도 적용한다. 상한 없이 쓰면 도구가
 * 스스로 소비할 수 없는 산출물을 만들고, 그 파일은 다음 `--baseline`
 * 실행에서 거부된다.
 */
export function createBaselineDocument(
  issues: readonly CheckIssue[],
  generatedAt: string,
): BaselineDocument {
  const entries: BaselineEntry[] = [];
  const seen = new Set<string>();
  for (const issue of issues) {
    const entry: BaselineEntry = issue.method === undefined
      ? { code: issue.code, target: issue.target, channel: issue.channel }
      : {
          code: issue.code,
          target: issue.target,
          channel: issue.channel,
          method: issue.method,
        };
    const key = baselineEntryKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(entry);
  }
  if (entries.length > MAX_BASELINE_ENTRIES) {
    fail(
      `Baseline entries exceed the ${MAX_BASELINE_ENTRIES} item limit; `
      + 'narrow the join inputs.',
    );
  }
  entries.sort(compareEntries);
  return { format: 'isthmus-baseline', version: 1, generatedAt, entries };
}

/** 베이스라인 문서를 결정적인 JSON 문자열로 인코딩한다. */
export function encodeBaselineDocument(document: BaselineDocument): string {
  return encodeSortedJson(document);
}

/**
 * 베이스라인 항목과 맞는 이슈를 표시한 보고서와 남은 항목 수를 만든다.
 *
 * 억제된 이슈는 목록에서 지우지 않는다. 사실·증거·심각도는 보존되고
 * 요약의 error·warning과 `--strict` 판단에서만 빠진다. 어떤 항목도 맞지
 * 않는 이슈를 만들지 않으며, 맞지 않는 항목은 오래된 것으로 센다 —
 * 해결된 이슈가 베이스라인에 남으면 다음 악화를 가릴 수 있기 때문이다.
 *
 * 판정은 전부 논리 키 교집합이라 이미 억제 표시가 있는 보고서에 다시
 * 적용해도 결과가 같다(멱등). suppressed 표시가 아닌 키로 세어야 stale과
 * suppressed 계수가 이중 적용에 흔들리지 않는다.
 */
export function applyBaseline(
  report: CheckReport,
  entries: readonly BaselineEntry[],
): CheckReport {
  const entryKeys = new Set(entries.map(baselineEntryKey));
  const issueKeys = new Set(report.issues.map(baselineEntryKey));
  const issues = report.issues.map((issue) =>
    entryKeys.has(baselineEntryKey(issue))
      ? { ...issue, suppressed: true as const }
      : issue,
  );
  const suppressed = issues.filter(
    (issue) => issue.suppressed === true,
  ).length;
  const staleBaselineEntries = [...entryKeys].filter(
    (key) => !issueKeys.has(key),
  ).length;
  return {
    ...report,
    summary: {
      ...report.summary,
      errors: countUnsuppressed(issues, 'error'),
      warnings: countUnsuppressed(issues, 'warning'),
      suppressed,
      staleBaselineEntries,
    },
    issues,
  };
}

/** 논리 이슈 식별자를 충돌 없는 JSON 문자열 키로 만든다. */
export function baselineEntryKey(issue: {
  readonly code: string;
  readonly target: string;
  readonly channel: string;
  readonly method?: string;
}): string {
  return JSON.stringify([
    issue.code,
    issue.target,
    issue.channel,
    issue.method ?? null,
  ]);
}

/** 억제되지 않은 이슈 중 주어진 심각도의 수를 센다. */
function countUnsuppressed(
  issues: readonly CheckIssue[],
  severity: 'error' | 'warning',
): number {
  return issues.filter(
    (issue) => issue.severity === severity && issue.suppressed !== true,
  ).length;
}

/** 항목 하나의 종류·키 필드를 검증하고 계약 필드만 복사한다. */
function normalizeEntry(value: unknown, index: number): BaselineEntry {
  if (!isJsonObject(value)) {
    fail(`Baseline entry at index ${index} must be a JSON object.`);
  }
  if (typeof value.code !== 'string' || !checkIssueCodeSet.has(value.code)) {
    fail(`Unknown issue code in baseline entry at index ${index}.`);
  }
  if (!isBridgeTarget(value.target)) {
    fail(`Unsupported bridge target in baseline entry at index ${index}.`);
  }
  if (!isSafeNonEmptyString(value.channel)) {
    fail(`Invalid channel in baseline entry at index ${index}.`);
  }
  if (
    value.method !== undefined &&
    !isSafeNonEmptyString(value.method)
  ) {
    fail(`Invalid method in baseline entry at index ${index}.`);
  }
  const code = value.code as CheckIssueCode;
  return value.method === undefined
    ? { code, target: value.target, channel: value.channel }
    : { code, target: value.target, channel: value.channel, method: value.method };
}

/** 항목을 code·target·channel·method 순으로 고정한다. */
function compareEntries(left: BaselineEntry, right: BaselineEntry): number {
  return (
    compareStrings(left.code, right.code) ||
    compareStrings(left.target, right.target) ||
    compareStrings(left.channel, right.channel) ||
    compareStrings(left.method ?? '', right.method ?? '')
  );
}

/** 입력 값을 포함하지 않는 검증 오류를 던진다. */
function fail(message: string): never {
  throw new BridgeBaselineValidationError(message);
}

/** 배열과 null을 제외한 JSON 객체 확인은 exchange/parse의 검증을 재사용한다. */

/** 검증에 쓰는 진단 코드 집합이다. */
const checkIssueCodeSet = new Set<string>(checkIssueCodes);
