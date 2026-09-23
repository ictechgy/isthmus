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
  'unhandled-message-send':
    'A Dart BasicMessageChannel send has no matching native message handler on any receiver-side document.',
  'unhandled-message-send-unverified':
    'A Dart BasicMessageChannel send has no matching native message handler, and a receiver-side analysis gap may be hiding it.',
  'message-handler-without-send':
    'A native BasicMessageChannel handler has no matching Dart send.',
  'unhandled-stream-listen':
    'A Dart EventChannel stream listener has no matching native stream handler on any receiver-side document.',
  'unhandled-stream-listen-unverified':
    'A Dart EventChannel stream listener has no matching native stream handler, and a receiver-side analysis gap may be hiding it.',
  'stream-handler-without-listen':
    'A native EventChannel stream handler has no matching Dart stream listener.',
  'event-listen-without-emit':
    'A JavaScript React Native event subscription has no observed native emission with the same global event name.',
  'event-listen-without-emit-unverified':
    'A JavaScript React Native event subscription has no observed native emission, and native analysis gaps may hide it.',
  'event-emit-without-listen':
    'A native React Native event emission has no observed JavaScript subscription with the same global event name.',
  'relation-use-without-decl':
    'A code-side relation reference has no matching declaration in the observed schema catalog.',
  'relation-use-without-decl-unverified':
    'A code-side relation reference has no matching declaration, and the schema catalog coverage is known to be incomplete.',
  'ambiguous-relation-use':
    'An unqualified code-side relation reference matches more than one declared relation, so it could not be joined.',
  'relation-decl-without-use':
    'A schema relation declaration has no observed code-side reference; it is a dead-schema candidate, not a deletion verdict.',
  'relation-decl-without-use-unverified':
    'A schema relation declaration has no observed code-side reference, and dynamic relation uses may be hiding it.',
  'column-use-without-decl':
    'A code-side column reference has no matching column declaration on the resolved relation.',
  'column-use-without-decl-unverified':
    'A code-side column reference has no matching column declaration, and the schema catalog coverage is known to be incomplete.',
};
