import { compareStrings } from '../compare.ts';
import type { BridgeEndpoint } from '../join/join.ts';
import { compareEndpoints } from '../join/join.ts';
import type { RouteSideOutcome } from '../join/route-index.ts';
import type {
  RouteCallResult,
  RouteDeclarationFact,
  RouteJoinResult,
  RouteScope,
} from '../join/route-join.ts';
import {
  clientRouteGapPrefixes,
  contractRouteGapPrefixes,
  serverRouteGapPrefixes,
} from '../join/route-limitation-scope.ts';
import type { CheckIssue, CheckIssueCode } from './check-report.ts';

/**
 * http 조인 결과를 check 진단으로 바꾸는 심각도 정책이다.
 *
 * error는 계약의 전제 (a)~(f)가 모두 증명될 때만 낸다. (a) 귀속은 조인이 이미 걸렀고
 * (f)는 scope에 route-decl을 스캔한 문서가 없으면 decl 기반 진단을 아예 평가하지 않는
 * 것으로 지킨다. 하나라도 빠지면 `-unverified` warning이다. 한계 접두사 목록은 닫혀 있어
 * 모르는 접두사는 공백으로 읽지 않는다(그 진단은 error로 남는 안전한 방향). 스코프가 있는 한계는 조인 층이
 * 호출·선언마다 적용 여부를 계산해 두었고, 이 층은 그 목록(`serverLimitations`·`clientLimitations`)만 본다.
 */

export { clientRouteGapPrefixes, contractRouteGapPrefixes, serverRouteGapPrefixes };

/**
 * 체인 전용 접두사다. check 심각도에 영향이 없다(trace 공백 근거). 닫힌 목록을 문서와
 * 맞추려고 둔다.
 */
export const chainOnlyRouteLimitationPrefixes = [
  'missing-route-usrs:',
  'missing-relation-usrs:',
  'framework-dispatch-unmodeled:',
] as const;

/**
 * 매니페스트 link의 `contract.authoritative` 선언이다. 이 버전은 workspace 매니페스트를 받지
 * 않으므로 항상 거짓이고, `route-call-without-contract`는 항상 `-unverified`다.
 */
const contractAuthoritative = false;

/**
 * scope 하나의 한계 문구와 무관한 공백이다. 한계 접두사 공백은 호출·선언마다 따로 본다(스코프).
 */
interface ScopeGaps {
  /** dynamic decl(`unjoined-dynamic-routes`)이 있다 — 스코프로 좁히지 않는다. */
  readonly dynamicDecls: boolean;
  readonly dynamicContracts: boolean;
  /** dynamic 호출·미귀속 호출·닿을 수 있는 client 문서 없음 중 하나다. */
  readonly client: boolean;
}

/** 조립 중인 진단이다. 같은 신원의 증거를 합친다. */
interface MutableIssue {
  readonly issue: Omit<CheckIssue, 'evidence'>;
  readonly evidence: BridgeEndpoint[];
}

/** http 조인 결과 전체의 진단을 결정적 순서로 만든다. */
export function createRouteIssues(routes: RouteJoinResult): CheckIssue[] {
  const issues = new Map<string, MutableIssue>();
  for (const scope of routes.scopes) {
    const gaps = scopeGaps(scope);
    for (const call of scope.calls) {
      if (call.decl !== undefined) addDeclOutcome(issues, scope, gaps, call, call.decl);
      if (call.contract !== undefined) addContractOutcome(issues, scope, gaps, call, call.contract);
    }
    if (!routes.driftOnly) {
      addWithoutCall(issues, scope, scope.decls, gaps, 'route-decl-without-call');
      addWithoutCall(issues, scope, scope.contracts, gaps, 'route-contract-without-call');
    }
    addConflicts(issues, scope);
    addShadows(issues, scope);
    if (scope.declScanned && scope.contractDocuments > 0) addDrift(issues, scope);
  }
  return [...issues.values()]
    .map(({ issue, evidence }) => ({ ...issue, evidence: uniqueSorted(evidence) }))
    .sort(compareRouteIssues);
}

/**
 * match된 귀속 호출 키 수다. 같은 (scope, method, 템플릿, 앵커)의 호출은 하나로 센다.
 */
export function countMatchedRoutes(routes: RouteJoinResult): number {
  const keys = new Set<string>();
  for (const scope of routes.scopes) {
    for (const call of scope.calls) {
      if (call.decl?.status === 'matched' || call.contract?.status === 'matched') {
        keys.add(JSON.stringify([scope.scope, call.method ?? null, call.template, call.anchor]));
      }
    }
  }
  return keys.size;
}

/**
 * scope의 한계 문구와 무관한 공백을 계산한다.
 *
 * dynamic decl·dynamic contract는 템플릿을 몰라 스코프로 좁히지 않는다. 호출 측 공백 중 dynamic 호출, 이 scope를
 * 불렀을 수 있는 귀속되지 않은 호출, 귀속될 수 있는 client 문서 없음도 선언과 무관하게 적용된다.
 */
function scopeGaps(scope: RouteScope): ScopeGaps {
  return {
    dynamicDecls: scope.dynamicDecls > 0,
    dynamicContracts: scope.dynamicContracts > 0,
    client: scope.dynamicCalls > 0 || scope.unboundCalls > 0 || scope.clientDocuments === 0,
  };
}

/** 한계 문구 중 하나라도 주어진 공백 접두사로 시작하는지다. */
function hasGapPrefix(messages: readonly string[], prefixes: readonly string[]): boolean {
  return messages.some((message) => prefixes.some((prefix) => message.startsWith(prefix)));
}

/** 호출 하나에 서버 측 공백이 있는지다: 이 호출에 적용되는 서버 접두사 한계나 dynamic decl. */
function callServerGap(gaps: ScopeGaps, call: RouteCallResult): boolean {
  return gaps.dynamicDecls || hasGapPrefix(call.serverLimitations, serverRouteGapPrefixes);
}

/** 호출 하나에 계약 측 공백이 있는지다: 이 호출에 적용되는 계약 접두사 한계나 dynamic contract. */
function callContractGap(gaps: ScopeGaps, call: RouteCallResult): boolean {
  return gaps.dynamicContracts || hasGapPrefix(call.serverLimitations, contractRouteGapPrefixes);
}

/** 선언 하나에 호출 측 공백이 있는지다: 이 선언에 적용되는 호출 측 접두사 한계나 scope 전체 공백. */
function declarationClientGap(gaps: ScopeGaps, fact: RouteDeclarationFact): boolean {
  return gaps.client || hasGapPrefix(fact.clientLimitations, clientRouteGapPrefixes);
}

/**
 * 호출 하나의 decl 쪽 결과를 진단으로 옮긴다.
 *
 * error 전제: (b) root 앵커, (c) 이 호출에 적용되는 서버 공백 없음(스코프 있는 한계는 스코프가 호출과 겹칠
 * 때만, 스코프 없는 한계는 항상), (d) dynamic decl 없음, (e) 테스트 소스 아님. 마스킹된 호출과 동사가
 * 동적인 호출도 error 근거가 아니다. method 불일치는 모든 경로 후보가 증명 가능할 때만이다.
 */
function addDeclOutcome(
  issues: Map<string, MutableIssue>,
  scope: RouteScope,
  gaps: ScopeGaps,
  call: RouteCallResult,
  outcome: RouteSideOutcome,
): void {
  const eligible = call.anchor === 'root' && !callServerGap(gaps, call) && !call.testSource && !call.masked;
  if (outcome.status === 'missing') {
    const error = eligible && call.method !== undefined;
    addIssue(issues, scope, call, error ? 'route-call-without-decl' : 'route-call-without-decl-unverified', error, []);
  } else if (outcome.status === 'method-mismatch') {
    const error = eligible && outcome.provable;
    addIssue(issues, scope, call, error ? 'route-method-mismatch' : 'route-method-mismatch-unverified', error,
      targetsEvidence(scope.decls, outcome.candidates));
  } else {
    addSharedOutcome(issues, scope, call, outcome, scope.decls);
  }
}

/**
 * 호출 하나의 contract 쪽 결과를 진단으로 옮긴다. 스펙에 같은 (method, 경로)가 없으면
 * method만 다른 operation이 있어도 `route-call-without-contract`다. error는 link가
 * contract를 authoritative로 선언해야 하므로 이 버전에서는 항상 `-unverified`다.
 */
function addContractOutcome(
  issues: Map<string, MutableIssue>,
  scope: RouteScope,
  gaps: ScopeGaps,
  call: RouteCallResult,
  outcome: RouteSideOutcome,
): void {
  if (outcome.status === 'missing' || outcome.status === 'method-mismatch') {
    const error = contractAuthoritative && call.anchor === 'root' && !callContractGap(gaps, call) && !call.testSource;
    addIssue(issues, scope, call, error ? 'route-call-without-contract' : 'route-call-without-contract-unverified',
      error, outcome.status === 'method-mismatch' ? targetsEvidence(scope.contracts, outcome.candidates) : []);
    return;
  }
  addSharedOutcome(issues, scope, call, outcome, scope.contracts);
}

/** 양쪽이 같은 코드를 쓰는 결과(모호·끝 슬래시·대소문자)를 옮긴다. match는 진단이 없다. */
function addSharedOutcome(
  issues: Map<string, MutableIssue>,
  scope: RouteScope,
  call: RouteCallResult,
  outcome: Extract<RouteSideOutcome, { status: 'matched' | 'ambiguous' | 'near-miss' }>,
  facts: readonly RouteDeclarationFact[],
): void {
  if (outcome.status === 'matched') return;
  if (outcome.status === 'ambiguous') {
    addIssue(issues, scope, call, 'ambiguous-route-call', false, targetsEvidence(facts, outcome.targets));
    return;
  }
  addIssue(issues, scope, call,
    outcome.reason === 'trailing-slash' ? 'route-trailing-slash-mismatch' : 'route-case-mismatch',
    false, targetsEvidence(facts, outcome.candidates));
}

/** 선언 번호로 증거 끝점을 찾는다. */
function targetsEvidence(
  facts: readonly RouteDeclarationFact[],
  targets: ReadonlyArray<{ readonly id: number }>,
): BridgeEndpoint[] {
  return targets.map(({ id }) => facts[id]!.endpoint);
}

/** 호출 측 진단 하나를 추가한다. channel은 호출 템플릿, method는 호출 동사다. */
function addIssue(
  issues: Map<string, MutableIssue>,
  scope: RouteScope,
  call: RouteCallResult,
  code: CheckIssueCode,
  error: boolean,
  related: readonly BridgeEndpoint[],
): void {
  mergeIssue(issues, {
    severity: error ? 'error' : 'warning',
    code,
    target: 'http',
    channel: call.template,
    ...(call.method === undefined ? {} : { method: call.method }),
    scope: scope.scope,
  }, [call.endpoint, ...related]);
}

/**
 * 호출이 닿지 않은 선언 측 사실을 warning으로 옮긴다. 문구는 "스캔한 클라이언트 기준
 * 미관찰"이다. 호출 측 공백이 있거나 base 앵커 선언이면 `-unverified`다 — 잇지 않은 base
 * 호출이 그 경로를 불렀을 수 있다. catch-all 접두사 decl(원본이 대표)과 테스트 소스 decl은
 * 싣지 않는다. 경로와 method가 모두 가려진 registration-order decl은 호출을 받을 수 없으므로
 * `route-decl-shadowed`가 대신한다.
 */
function addWithoutCall(
  issues: Map<string, MutableIssue>,
  scope: RouteScope,
  facts: readonly RouteDeclarationFact[],
  gaps: ScopeGaps,
  code: 'route-decl-without-call' | 'route-contract-without-call',
): void {
  for (const fact of facts) {
    if (fact.called || fact.declaration.catchAllPrefix || fact.testSource || fact.shadow?.kind === 'full') continue;
    const unverified = declarationClientGap(gaps, fact) || fact.declaration.anchor === 'base';
    mergeIssue(issues, declarationIssue(scope, fact, unverified ? `${code}-unverified` : code), [fact.endpoint]);
  }
}

/**
 * 같은 키 decl의 중복을 warning으로 옮긴다. narrowed decl, 경로 제약만 다른 decl, catch-all
 * 접두사 decl, 테스트 소스 decl은 충돌로 보지 않는다. 같은 registration-order group에서 앞 등록에 완전히 가려진
 * decl도 뺀다 — 어느 쪽이 받는지 정해져 있으므로 `route-decl-shadowed`가 더 정확한 진단이다.
 */
function addConflicts(issues: Map<string, MutableIssue>, scope: RouteScope): void {
  const groups = new Map<string, RouteDeclarationFact[]>();
  for (const fact of scope.decls) {
    if (fact.narrowed || fact.declaration.catchAllPrefix || fact.testSource || fact.shadow?.kind === 'full') continue;
    const key = JSON.stringify([fact.declaration.anchor, fact.declaration.method, fact.declaration.template,
      fact.constraintsKey]);
    groups.set(key, [...(groups.get(key) ?? []), fact]);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    mergeIssue(issues, declarationIssue(scope, group[0]!, 'route-decl-conflict'), group.map(({ endpoint }) => endpoint));
  }
}

/**
 * 가려진 registration-order decl을 warning으로 옮긴다. 증거는 가려진 decl과 가장 먼저 등록한 가린 decl이다.
 *
 * `route-decl-shadowed`는 경로와 method가 모두 가려져 어떤 디스패치에서도 호출을 받지 않는 decl, `route-decl-path-shadowed`는
 * 경로만 가려진 decl이다(경로를 먼저 고르는 프레임워크에서는 405로 끝나고 method를 보는 라우터에서는 다른 method로 닿는다).
 * 가림은 조인 층이 건전하게만 판정하므로 이 진단은 거짓 error를 만들지 않는 warning이다.
 */
function addShadows(issues: Map<string, MutableIssue>, scope: RouteScope): void {
  for (const fact of scope.decls) {
    if (fact.shadow === undefined) continue;
    const code = fact.shadow.kind === 'full' ? 'route-decl-shadowed' : 'route-decl-path-shadowed';
    mergeIssue(issues, declarationIssue(scope, fact, code), [fact.endpoint, scope.decls[fact.shadow.by]!.endpoint]);
  }
}

/**
 * 같은 scope의 decl과 contract를 비교한 드리프트 warning이다. root 앵커 정적 사실만
 * 템플릿 문자열과 method(decl `ANY`는 모든 method)로 비교한다. base 앵커는 접두사를 몰라
 * 비교하지 않는다.
 */
function addDrift(issues: Map<string, MutableIssue>, scope: RouteScope): void {
  const rootDecls = scope.decls.filter(({ declaration }) => declaration.anchor === 'root');
  const rootContracts = scope.contracts.filter(({ declaration }) => declaration.anchor === 'root');
  const covers = (decl: RouteDeclarationFact, contract: RouteDeclarationFact): boolean =>
    decl.declaration.template === contract.declaration.template &&
    (decl.declaration.method === contract.declaration.method || decl.declaration.method === 'ANY');
  for (const contract of rootContracts) {
    if (rootDecls.some((decl) => covers(decl, contract))) continue;
    mergeIssue(issues, declarationIssue(scope, contract, 'route-contract-without-decl'), [contract.endpoint]);
  }
  for (const decl of rootDecls) {
    if (decl.declaration.catchAllPrefix || decl.testSource) continue;
    if (rootContracts.some((contract) => covers(decl, contract))) continue;
    mergeIssue(issues, declarationIssue(scope, decl, 'route-decl-without-contract'), [decl.endpoint]);
  }
}

/** 선언 측 진단의 신원이다. channel은 선언 템플릿, method는 선언 method다. */
function declarationIssue(scope: RouteScope, fact: RouteDeclarationFact, code: CheckIssueCode): Omit<CheckIssue, 'evidence'> {
  return {
    severity: 'warning',
    code,
    target: 'http',
    channel: fact.declaration.template,
    method: fact.declaration.method,
    scope: scope.scope,
  };
}

/** 같은 신원(code·scope·channel·method)의 진단을 하나로 합친다. */
function mergeIssue(
  issues: Map<string, MutableIssue>,
  issue: Omit<CheckIssue, 'evidence'>,
  evidence: readonly BridgeEndpoint[],
): void {
  const key = JSON.stringify([issue.code, issue.scope, issue.channel, issue.method ?? null]);
  const existing = issues.get(key) ?? { issue, evidence: [] };
  existing.evidence.push(...evidence);
  issues.set(key, existing);
}

/** 증거를 조인과 같은 순서로 정렬하고 중복을 없앤다. */
function uniqueSorted(endpoints: readonly BridgeEndpoint[]): BridgeEndpoint[] {
  const sorted = [...endpoints].sort(compareEndpoints);
  return sorted.filter((endpoint, index) => index === 0 || compareEndpoints(sorted[index - 1]!, endpoint) !== 0);
}

/** http 진단을 scope·템플릿·method·코드 순으로 고정한다. */
function compareRouteIssues(left: CheckIssue, right: CheckIssue): number {
  return compareStrings(left.scope ?? '', right.scope ?? '') ||
    compareStrings(left.channel, right.channel) ||
    compareStrings(left.method ?? '', right.method ?? '') ||
    compareStrings(left.code, right.code);
}
