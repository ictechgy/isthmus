import { compareStrings } from '../compare.ts';
import type { BridgeFact, BridgeFactsDocument, BridgeTarget } from '../exchange/parse.ts';
import { isBridgeDomainDocument } from '../exchange/parse.ts';
import type { ImpactSelection } from '../exchange/impact-selection.ts';
import { parseImpactSelection } from '../exchange/impact-selection.ts';
import { BridgeJoinValidationError, createRelationResolver, joinBridgeDocuments } from '../join/join.ts';
import type { BridgeEndpoint, JoinLimitation, MatchedChannel, MatchedMethod, RelationResolver } from '../join/join.ts';
import { createCheckReport, persistenceIssueKeys } from './check-report.ts';
import type { CheckIssue } from './check-report.ts';
import { encodeSortedJson } from './sorted-json.ts';
import { collectRuntimeImpact, hasRuntimeImpactGaps } from './runtime-impact.ts';
import type { ImpactRuntimeInput, RuntimeImpactEvidence } from './runtime-impact.ts';

/** 선택된 원본 사실. 조인 불가 사실도 위치·식별자와 함께 보존한다. */
export interface SelectedBridgeFact extends BridgeEndpoint {
  readonly target: BridgeTarget | null;
  readonly kind: BridgeFact['kind'];
  readonly channel: string | null;
  readonly method?: string;
  readonly dynamic: boolean;
}

/** 채널 배선 변경은 같은 채널의 모든 메서드에 영향을 준다. */
export type ImpactReason = 'channel-wiring' | 'method' | 'runtime-observation';

/** 변경과 관련된 채널 생성·등록 위치다. */
export interface ImpactChannel extends MatchedChannel {
  readonly reason: ImpactReason;
}

/** 변경과 관련된 메서드의 호출자·핸들러다. 실행 가능성을 판정하지 않는다. */
export interface ImpactMethod extends MatchedMethod {
  readonly reason: ImpactReason;
}

/** 변경 전 확인할 브리지 관계와 공백을 기계적으로 소비하는 문서다. */
export interface BridgeImpactReport {
  readonly format: 'isthmus-impact';
  readonly version: 1;
  /** 증거 상대 경로의 기준이다. CLI를 실행한 디렉터리와 같다고 추측하지 않는다. */
  readonly project: string;
  readonly status: 'observed' | 'unobserved';
  readonly scope: 'bridge';
  /** 전체 프로그램·런타임 도달성의 완전성을 주장하지 않는다. */
  readonly complete: false;
  readonly selection: ImpactSelection;
  readonly unmatchedSelectors: ImpactSelection;
  readonly summary: {
    readonly observedFacts: number;
    readonly selectedFacts: number;
    readonly unresolvedSelectedFacts: number;
    readonly unmatchedSelectors: number;
    readonly affectedChannels: number;
    readonly affectedMethods: number;
    readonly reviewFiles: number;
    readonly errors: number;
    readonly warnings: number;
  };
  readonly selectedFacts: readonly SelectedBridgeFact[];
  readonly channels: readonly ImpactChannel[];
  readonly methods: readonly ImpactMethod[];
  readonly reviewFiles: readonly string[];
  readonly issues: readonly CheckIssue[];
  readonly limitations: readonly JoinLimitation[];
  readonly relevantLimitations: readonly JoinLimitation[];
  readonly inputs: ReadonlyArray<Pick<BridgeFactsDocument, 'tool' | 'platform' | 'target' | 'generatedAt' | 'sourceModifiedAt'>>;
  readonly runtime?: RuntimeImpactEvidence;
}

/** 파일·심볼에서 관련 브리지 키를 역탐색하고 채널 배선 변경의 범위를 확장한다. */
export function createBridgeImpact(
  documents: readonly BridgeFactsDocument[],
  requested: ImpactSelection,
  runtimeInput?: ImpactRuntimeInput,
): BridgeImpactReport {
  const selection = parseImpactSelection({ format: 'isthmus-changes', version: 1, ...requested });
  const joined = joinBridgeDocuments(documents);
  if (joined.deferred) {
    throw new BridgeJoinValidationError(
      'Bridge impact could not be computed; split mixed bridge targets and retry. '
      + `The inputs observed ${joined.observedFacts} facts across ${documents.length} documents.`,
    );
  }
  const { selectedFacts, unmatchedSelectors } = selectFacts(documents, selection);
  const channelKeys = new Set<string>();
  const wiringKeys = new Set<string>();
  const methodKeys = new Set<string>();
  const persistenceFacts: PersistenceSelectedFact[] = [];
  let unresolvedSelectedFacts = 0;
  for (const fact of selectedFacts) {
    if (fact.dynamic || fact.channel === null || fact.target === null) {
      unresolvedSelectedFacts++;
      continue;
    }
    // persistence 사실은 원문 채널이 아니라 조인이 해석한 관계로 진단과 대조한다.
    if (fact.target === 'persistence') {
      persistenceFacts.push({ ...fact, channel: fact.channel });
      continue;
    }
    const key = channelKey(fact.target, fact.channel);
    channelKeys.add(key);
    if (fact.kind === 'channel-create' || fact.kind === 'channel-register') {
      wiringKeys.add(key);
    } else if (fact.method !== undefined) {
      methodKeys.add(methodKey(fact.target, fact.channel, fact.method));
    }
  }
  const staticChannelKeys = new Set(channelKeys);
  const runtime = runtimeInput === undefined ? undefined
    : collectRuntimeImpact(joined, documents[0]?.project, selection, selectedFacts, runtimeInput,
      // 런타임 주소의 정적 후보는 bridge 문서가 분석한 플랫폼만 인정한다 — 같은 플랫폼의
      // persistence 문서가 있다고 네이티브 핸들러를 분석했다고 읽으면 안 된다.
      new Set(documents.filter(isBridgeDomainDocument).map(({ platform }) => platform)));
  const runtimeNative = runtimeInput?.document.run.platform === 'android' ? 'kotlin' : 'swift';
  const runtimeMethodKeys = new Set<string>();
  for (const route of runtime?.routes ?? []) {
    if (route.staticStatus !== 'candidates' || route.method === undefined) continue;
    channelKeys.add(channelKey('flutter', route.channel));
    runtimeMethodKeys.add(methodKey('flutter', route.channel, route.method));
  }
  const methods: ImpactMethod[] = [
    ...joined.matchedMethods,
    ...joined.unhandledInvocations.map((item) => ({ ...item, handlers: [] })),
    ...joined.handlersWithoutInvocations.map((item) => ({ ...item, invocations: [] })),
  ].filter(({ target, channel, method }) => wiringKeys.has(channelKey(target, channel)) ||
    methodKeys.has(methodKey(target, channel, method)) || runtimeMethodKeys.has(methodKey(target, channel, method)))
    .map((item) => {
      const reason = impactReason(wiringKeys, item, !methodKeys.has(methodKey(item.target, item.channel, item.method)));
      return { ...item, reason, handlers: reason === 'runtime-observation'
        ? item.handlers.filter(({ platform }) => platform === runtimeNative) : item.handlers };
    })
    .sort(compareLogicalKeys);
  const channelMap = new Map<string, MatchedChannel>([
    ...joined.matchedChannels,
    ...joined.unregisteredChannelCreations.map((item) => ({ ...item, registrations: [] })),
    ...joined.registrationsWithoutCreations.map((item) => ({ ...item, creations: [] })),
  ].map((item) => [channelKey(item.target, item.channel), item]));
  // 생성·등록을 놓친 채널에서도 메서드의 존재 근거가 사라지지 않아야 한다.
  for (const { target, channel } of methods) {
    const key = channelKey(target, channel);
    if (!channelMap.has(key)) channelMap.set(key, { target, channel, creations: [], registrations: [] });
  }
  const channels = [...channelMap.values()]
    .filter(({ target, channel }) => channelKeys.has(channelKey(target, channel)))
    .map((item) => {
      const reason = impactReason(wiringKeys, item, !staticChannelKeys.has(channelKey(item.target, item.channel)));
      return { ...item, reason, registrations: reason === 'runtime-observation'
        ? item.registrations.filter(({ platform }) => platform === runtimeNative) : item.registrations };
    })
    .sort(compareLogicalKeys);
  const persistence = collectPersistenceSelection(documents, persistenceFacts);
  const issues = createCheckReport(joined).issues.filter((issue) => {
    const { target, channel, method } = issue;
    if (target === 'persistence') return isSelectedPersistenceIssue(issue, persistence);
    return channelKeys.has(channelKey(target, channel)) &&
      (method === undefined || wiringKeys.has(channelKey(target, channel)) ||
        methodKeys.has(methodKey(target, channel, method)) || runtimeMethodKeys.has(methodKey(target, channel, method)));
  });
  const reviewFiles = [...new Set([
    ...selectedFacts,
    ...channels.flatMap(({ creations, registrations }) => [...creations, ...registrations]),
    ...methods.flatMap(({ invocations, handlers }) => [...invocations, ...handlers]),
    ...(runtime?.reviewFiles ?? []).map((path) => ({ location: { path } })),
  ].flatMap(({ location }) => location === undefined ? [] : [location.path]))].sort(compareStrings);
  const unmatchedCount = unmatchedSelectors.files.length + unmatchedSelectors.symbols.length;
  const relevantLimitations = joined.limitations.filter((limitation) =>
    unresolvedSelectedFacts > 0 || unmatchedCount > 0 || channels.some(({ target, channel }) =>
      (limitation.target === null || limitation.target === target) &&
      (limitation.channels === undefined || limitation.channels.includes(channel))));
  return {
    // 조인이 호출·수신 문서의 존재와 동일 project를 이미 검증했다.
    format: 'isthmus-impact', version: 1, project: documents[0]!.project,
    status: selectedFacts.length > 0 ? 'observed' : 'unobserved', scope: 'bridge', complete: false,
    selection, unmatchedSelectors,
    summary: {
      observedFacts: joined.observedFacts, selectedFacts: selectedFacts.length,
      unresolvedSelectedFacts, unmatchedSelectors: unmatchedCount,
      affectedChannels: channels.length, affectedMethods: methods.length,
      reviewFiles: reviewFiles.length,
      errors: issues.filter(({ severity }) => severity === 'error').length,
      warnings: issues.filter(({ severity }) => severity === 'warning').length,
    },
    selectedFacts, channels, methods, reviewFiles, issues,
    ...(runtime === undefined ? {} : { runtime }),
    limitations: joined.limitations, relevantLimitations,
    inputs: documents.map(({ tool, platform, target, generatedAt, sourceModifiedAt }) => ({
      tool, platform, target, generatedAt,
      ...(sourceModifiedAt === undefined ? {} : { sourceModifiedAt }),
    })).sort((a, b) => compareStrings(encodeSortedJson(a), encodeSortedJson(b))),
  };
}

/**
 * 0을 전체 안전 판정으로 해석하지 않고, 관련 오류·공백을 CI 실패 조건으로 계산한다.
 *
 * 선택한 persistence 사실에 걸린 진단은 심각도와 무관하게 blocker다. impact는
 * bridge 채널·메서드만 확장하고 관계의 DB 내부 의존자나 다른 사용처는 계산하지
 * 않으므로(`scope: 'bridge'`), 경고(모호한 비한정 사용, 미사용 선언)를 통과시키면
 * 검토가 필요한 스키마 변경이 조용한 성공으로 보인다.
 */
export function hasImpactBlockers(report: BridgeImpactReport): boolean {
  return report.summary.errors > 0 || report.summary.unresolvedSelectedFacts > 0 ||
    report.summary.unmatchedSelectors > 0 || report.relevantLimitations.length > 0 ||
    report.issues.some(({ code, target }) => code.endsWith('-unverified') || target === 'persistence') ||
    (report.runtime !== undefined && hasRuntimeImpactGaps(report.runtime));
}

/** 같은 문서를 사람이 읽는 JSON 또는 정보 손실 없는 컴팩트 JSON으로 인코딩한다. */
export function encodeBridgeImpact(report: BridgeImpactReport, compact = false): string {
  return encodeSortedJson(report, compact);
}

/** 선택 집합과 사실을 한 번씩 읽어 선택 수×사실 수의 곱을 피한다. */
function selectFacts(documents: readonly BridgeFactsDocument[], selection: ImpactSelection): {
  selectedFacts: SelectedBridgeFact[]; unmatchedSelectors: ImpactSelection;
} {
  const files = new Set(selection.files);
  const symbols = new Set(selection.symbols);
  const foundFiles = new Set<string>();
  const foundSymbols = new Set<string>();
  const selected = new Map<string, SelectedBridgeFact>();
  for (const { platform, target, facts } of documents) {
    for (const fact of facts) {
      const fileMatches = fact.location !== undefined && files.has(fact.location.path);
      const names = fact.symbol === undefined ? [] : [fact.symbol.qualifiedName, fact.symbol.usr];
      const matchedNames = names.filter((name): name is string => name !== undefined && symbols.has(name));
      if (!fileMatches && matchedNames.length === 0) continue;
      if (fileMatches && fact.location !== undefined) foundFiles.add(fact.location.path);
      for (const name of matchedNames) foundSymbols.add(name);
      const item = { ...fact, platform, target };
      selected.set(encodeSortedJson(item), item);
    }
  }
  return {
    selectedFacts: [...selected.entries()].sort(([a], [b]) => compareStrings(a, b)).map(([, item]) => item),
    unmatchedSelectors: {
      files: selection.files.filter((path) => !foundFiles.has(path)),
      symbols: selection.symbols.filter((name) => !foundSymbols.has(name)),
    },
  };
}

/** 채널이 확정된 선택 persistence 사실이다. */
type PersistenceSelectedFact = SelectedBridgeFact & { readonly channel: string };

/** 선택한 persistence 사실이 가리키는 논리 관계·(관계, 컬럼) 키와 그 해석기다. */
interface PersistenceSelection {
  readonly resolver: RelationResolver;
  readonly relations: ReadonlySet<string>;
  readonly columns: ReadonlySet<string>;
}

/**
 * 선택한 persistence 사실을 조인과 같은 해석 규칙의 관계 키로 바꾼다.
 * 선택이 없으면 해석기를 만들지 않는다 — bridge만 고른 실행에 비용을 더하지 않는다.
 */
function collectPersistenceSelection(
  documents: readonly BridgeFactsDocument[], facts: readonly PersistenceSelectedFact[],
): PersistenceSelection | undefined {
  if (facts.length === 0) return undefined;
  const resolver = createRelationResolver(documents);
  const relations = new Set<string>();
  const columns = new Set<string>();
  for (const fact of facts) {
    const key = fact.kind === 'relation-decl' ? resolver.declKey : resolver.useKey;
    relations.add(key(fact.channel));
    if (fact.method !== undefined) columns.add(key(fact.channel, fact.method));
  }
  return { resolver, relations, columns };
}

/**
 * persistence 진단이 선택한 관계에 속하는지 원문이 아니라 해석된 관계로 판정한다.
 *
 * 원문 문자열을 비교하면 비한정 사용('users')이 닿는 한정 선언 이름('public.users')을
 * 싣는 컬럼 진단이 빠진다. 관계 수준 진단은 관계가 선택되면, 컬럼 진단은 같은
 * (관계, 컬럼)이 선택되면 싣는다 — bridge의 채널·메서드 규칙과 같다. 모호한 사용은
 * 후보 선언 중 하나가 선택돼도 관련 진단이다.
 */
function isSelectedPersistenceIssue(issue: CheckIssue, selection: PersistenceSelection | undefined): boolean {
  if (selection === undefined) return false;
  const keys = persistenceIssueKeys(issue, selection.resolver);
  return keys.relations.some((key) => selection.relations.has(key)) &&
    (keys.column === undefined || selection.columns.has(keys.column));
}

/** 구분 문자 포함 이름도 서로 충돌하지 않는 채널 키다. */
function channelKey(target: BridgeTarget, channel: string): string {
  return JSON.stringify([target, channel]);
}

/** 채널 내부에서만 유일한 메서드 키다. */
function methodKey(target: BridgeTarget, channel: string, method: string): string {
  return JSON.stringify([target, channel, method]);
}

/** 생성·등록이 선택됐는지에 따라 검토 범위가 넓어진 이유를 설명한다. */
function impactReason(
  wiringKeys: ReadonlySet<string>, item: MatchedChannel | MatchedMethod, runtimeOnly = false,
): ImpactReason {
  return wiringKeys.has(channelKey(item.target, item.channel)) ? 'channel-wiring'
    : runtimeOnly ? 'runtime-observation' : 'method';
}

/** 입력 파일 순서와 locale에 의존하지 않는 논리 키 정렬이다. */
function compareLogicalKeys(
  a: { target: BridgeTarget; channel: string; method?: string },
  b: { target: BridgeTarget; channel: string; method?: string },
): number {
  return compareStrings(a.target, b.target) || compareStrings(a.channel, b.channel) ||
    compareStrings(a.method ?? '', b.method ?? '');
}
