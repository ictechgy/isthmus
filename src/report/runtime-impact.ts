import { compareStrings } from '../compare.ts';
import type { ImpactSelection } from '../exchange/impact-selection.ts';
import { isSafeNonEmptyString } from '../exchange/parse.ts';
import type { BridgeLocation } from '../exchange/parse.ts';
import { RuntimeValidationError } from '../exchange/runtime.ts';
import type { BridgeRuntimeDocument, RuntimeEvent, RuntimeRoute } from '../exchange/runtime.ts';
import type { BridgeJoinResult } from '../join/join.ts';
import type { SelectedBridgeFact } from './impact.ts';

/** CLI/CI 호출자가 선언한 현재 분석 revision과 실제 실행 기록이다. */
export interface ImpactRuntimeInput {
  readonly document: BridgeRuntimeDocument;
  readonly revision: string;
}

/** 인스턴스별 실제 주소. 정적 핸들러는 실행 대상 확정이 아닌 검토 후보다. */
export interface RuntimeImpactRoute extends RuntimeRoute {
  readonly instance: string;
  readonly observedCalls: number;
  readonly failedCalls: number;
  readonly pendingCalls: number;
  readonly callers: readonly BridgeLocation[];
  readonly callersOmitted: number;
  readonly staticStatus: 'candidates' | 'unobserved' | 'unsupported';
}

/** 정적 사실과 구분해서 보존하는 변경 관련 런타임 증거다. */
export interface RuntimeImpactEvidence {
  readonly run: BridgeRuntimeDocument['run'];
  readonly tool: BridgeRuntimeDocument['tool'];
  readonly revision: string;
  readonly stale: boolean;
  readonly incomplete: boolean;
  readonly droppedEvents: number;
  readonly selectedEvents: number;
  readonly failedCalls: number;
  readonly pendingCalls: number;
  readonly routes: readonly RuntimeImpactRoute[];
  readonly reviewFiles: readonly string[];
}

/** 정적 선택에서 놓친 동적 호출을 실제 실행 주소로 찾되 다른 플랫폼을 추측하지 않는다. */
export function collectRuntimeImpact(
  joined: BridgeJoinResult, project: string | undefined, selection: ImpactSelection,
  selected: readonly SelectedBridgeFact[], input: ImpactRuntimeInput,
): RuntimeImpactEvidence {
  const { document, revision } = input;
  if (document.project !== project) throw new RuntimeValidationError('Runtime and static inputs must describe the same project.');
  if (!isSafeNonEmptyString(revision)) throw new RuntimeValidationError('Expected a current analysis revision.');
  const stale = document.revision !== revision;
  const files = new Set(selection.files);
  const locations = new Set(selected.map(({ location }) => locationKey(location)));
  const selectedChannels = new Set<string>();
  const selectedMethods = new Set<string>();
  for (const fact of selected) {
    if (fact.dynamic || fact.channel === null || fact.target !== 'flutter') continue;
    if (fact.method === undefined) selectedChannels.add(fact.channel);
    else selectedMethods.add(methodKey(fact.channel, fact.method));
  }
  const candidates = new Set([...joined.matchedMethods, ...joined.handlersWithoutInvocations]
    .filter(({ target, handlers }) => target === 'flutter' && handlers.some(({ platform }) => platform === 'swift'))
    .map(({ channel, method }) => methodKey(channel, method)));
  const groups = new Map<string, {
    event: RuntimeEvent; observedCalls: number; failedCalls: number; pendingCalls: number;
    callers: Map<string, BridgeLocation>;
  }>();
  const reviewFiles = new Set<string>();
  if (!stale) for (const event of document.events) {
    const selectedCaller = event.caller !== undefined &&
      (files.has(event.caller.path) || locations.has(locationKey(event.caller)));
    const selectedRoute = event.transport === 'method-channel' &&
      (selectedChannels.has(event.channel) || selectedMethods.has(methodKey(event.channel, event.method)));
    if (!selectedCaller && !selectedRoute) continue;
    const key = JSON.stringify([event.transport, event.channel, event.method ?? null, event.instance]);
    let group = groups.get(key);
    if (group === undefined) {
      group = { event, observedCalls: 0, failedCalls: 0, pendingCalls: 0, callers: new Map() };
      groups.set(key, group);
    }
    group.observedCalls++;
    if (event.outcome === 'error' || event.outcome === 'missing-handler' || event.outcome === 'timeout') group.failedCalls++;
    if (event.outcome === 'pending') group.pendingCalls++;
    if (event.caller !== undefined) {
      group.callers.set(locationKey(event.caller), event.caller);
      reviewFiles.add(event.caller.path);
    }
  }
  const routes = [...groups.entries()].sort(([a], [b]) => compareStrings(a, b))
    .map(([, group]): RuntimeImpactRoute => {
      const { event, observedCalls, failedCalls, pendingCalls } = group;
      const supported = (document.run.platform === 'ios' || document.run.platform === 'macos') &&
        event.transport === 'method-channel';
      return {
        transport: event.transport, channel: event.channel,
        ...(event.method === undefined ? {} : { method: event.method }),
        instance: event.instance, observedCalls, failedCalls, pendingCalls,
        callers: [...group.callers.entries()].sort(([a], [b]) => compareStrings(a, b))
          .slice(0, 20).map(([, caller]) => caller),
        callersOmitted: Math.max(0, group.callers.size - 20),
        staticStatus: !supported ? 'unsupported' : candidates.has(methodKey(event.channel, event.method))
          ? 'candidates' : 'unobserved',
      };
    });
  return {
    run: document.run, tool: document.tool, revision: document.revision, stale,
    incomplete: document.run.status !== 'completed', droppedEvents: document.droppedEvents,
    selectedEvents: routes.reduce((count, route) => count + route.observedCalls, 0),
    failedCalls: routes.reduce((count, route) => count + route.failedCalls, 0),
    pendingCalls: routes.reduce((count, route) => count + route.pendingCalls, 0), routes,
    reviewFiles: [...reviewFiles].sort(compareStrings),
  };
}

/** 기록의 부재·실패·불완전성 또는 정적 후보를 찾지 못한 주소는 검토가 필요하다. */
export function hasRuntimeImpactGaps(runtime: RuntimeImpactEvidence): boolean {
  return runtime.stale || runtime.incomplete || runtime.droppedEvents > 0 || runtime.selectedEvents === 0 ||
    runtime.failedCalls > 0 || runtime.pendingCalls > 0 ||
    runtime.routes.some(({ staticStatus }) => staticStatus !== 'candidates');
}

/** 메서드 이름의 구분자와 undefined를 실제 문자열과 혼동하지 않는다. */
function methodKey(channel: string, method: string | undefined): string {
  return JSON.stringify([channel, method ?? null]);
}

/** 명시된 호출 지점만 연결하고 주변 선언·인접 줄을 추측하지 않는다. */
function locationKey(location: BridgeLocation): string {
  return JSON.stringify([location.path, location.line, location.column]);
}
