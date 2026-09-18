import type { CheckIssueCode } from './check-report.ts';

/**
 * 논리 이슈 키를 안정 지문으로 바꾸는 주입 경계다. 해싱은 cli 계층이 담당한다.
 * SARIF와 Code Quality가 같은 지문을 써야 두 아티팩트의 병합 기준이 일치한다.
 */
export type IssueFingerprint = (issue: {
  readonly code: string;
  readonly target: string;
  readonly channel: string;
  readonly method?: string;
}) => string;

/**
 * check가 보고하는 진단 종류의 산문 설명이다. SARIF 규칙 문구와 Code Quality
 * 발견 설명이 같은 표를 써야 두 형식이 같은 이슈를 다르게 말하지 않는다.
 */
export const checkIssueRuleDescriptions: Record<CheckIssueCode, string> = {
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
  'module-import-without-export':
    'A caller-side native module import has no matching export on any receiver-side document.',
  'module-import-without-export-unverified':
    'A caller-side native module import has no matching export, and a receiver-side analysis gap may be hiding it.',
  'module-import-without-export-optional':
    'A caller-side native module import has no matching export, but every observed caller tolerates absence by receiving null.',
  'module-import-mechanism-mismatch':
    'A caller-side native module import matches an export name, but the observed exports resolve through a different bridge mechanism.',
  'module-export-without-import':
    'A receiver-side native module export has no matching caller-side import.',
  'module-export-mechanism-mismatch':
    'A receiver-side native module export matches an import name, but the observed imports resolve through a different bridge mechanism.',
  'component-require-without-export':
    'A caller-side native component require has no matching export on any receiver-side document.',
  'component-require-without-export-unverified':
    'A caller-side native component require has no matching export, and a receiver-side analysis gap may be hiding it.',
  'component-require-mechanism-mismatch':
    'A caller-side native component require matches an export name, but the observed exports resolve through a different bridge mechanism.',
  'component-export-without-require':
    'A receiver-side native component export has no matching caller-side require.',
  'component-export-mechanism-mismatch':
    'A receiver-side native component export matches a require name, but the observed requires resolve through a different bridge mechanism.',
};
