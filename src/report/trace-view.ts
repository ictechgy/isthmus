import type { TraceChain, TraceReport } from './trace.ts';

/**
 * `trace --max-chains`·`--max-rows`의 출력 상한이다.
 *
 * MCP 응답처럼 한 번에 읽을 크기가 정해진 소비자를 위해 목록을 앞에서부터 자른다. 자른 곳은 최상위
 * `truncation.omitted`에 경로·원래 개수·남긴 개수로 모두 적는다. `summary`는 자르기 전 보고서의 값을 그대로
 * 두어 원래 크기를 알 수 있게 한다. 잘린 보고서의 빈 목록·짧은 목록은 "없다"는 뜻이 아니다.
 */
export interface TraceLimits {
  readonly maxChains: number;
  readonly maxRows: number;
}

/** chain 상한의 범위다. selection 목록 상한(1,000)과 같다. */
export const MAX_TRACE_VIEW_CHAINS = 1_000;
/** 목록 하나의 행 상한 범위다. */
export const MAX_TRACE_VIEW_ROWS = 10_000;
/** `truncation.omitted`에 적는 자른 목록 수의 상한이다. 넘으면 `omittedLists`로 전체 수만 싣는다. */
export const MAX_TRACE_OMITTED_ENTRIES = 1_000;

/** 자른 목록 하나의 기록이다. `path`는 보고서 안의 JSON 경로(예: `chains[0].routes[1].calls[0].affected`)다. */
export interface TraceOmission {
  readonly path: string;
  readonly total: number;
  readonly shown: number;
}

/** 상한을 적용한 보고서다. `isthmus-trace` v1에 `truncation`만 더한다. */
export type LimitedTraceReport = TraceReport & {
  readonly truncation: Readonly<{
    maxChains: number;
    maxRows: number;
    truncated: boolean;
    omittedLists: number;
    omitted: readonly TraceOmission[];
  }>;
};

/**
 * 보고서의 목록을 상한으로 자른다. 순서는 보고서의 결정적 순서를 그대로 따른다.
 *
 * 자르는 목록: `chains`(maxChains), 최상위 `gaps`·`notices`·`limitations`·`analysisLimitations`·`analyses`, chain의
 * `routes`·`handlers`·`relationUses`·`database`, route의 `declarations`·`contracts`·`calls`, 호출의 `affected`, 핸들러의
 * `routes`·`reachedFrom`, relation 사용의 `decls`·`reachedFrom`, DB 정점의 `dependents`(각 maxRows). hop 하나의 증거인
 * `path`·`relationships`와 `selection`은 자르지 않는다 — 잘린 경로는 틀린 증거가 되기 때문이다.
 */
export function limitTraceReport(report: TraceReport, limits: TraceLimits): LimitedTraceReport {
  const omitted: TraceOmission[] = [];
  let omittedLists = 0;
  const take = <T>(items: readonly T[], limit: number, path: string): T[] => {
    if (items.length <= limit) return [...items];
    omittedLists++;
    if (omitted.length < MAX_TRACE_OMITTED_ENTRIES) omitted.push({ path, total: items.length, shown: limit });
    return items.slice(0, limit);
  };
  const rows = <T>(items: readonly T[], path: string): T[] => take(items, limits.maxRows, path);
  const chains = take(report.chains, limits.maxChains, 'chains').map((chain, index): TraceChain => {
    const at = `chains[${index}]`;
    return {
      ...chain,
      routes: rows(chain.routes, `${at}.routes`).map((route, routeIndex) => {
        const routeAt = `${at}.routes[${routeIndex}]`;
        return {
          ...route,
          declarations: rows(route.declarations, `${routeAt}.declarations`),
          contracts: rows(route.contracts, `${routeAt}.contracts`),
          calls: rows(route.calls, `${routeAt}.calls`).map((call, callIndex) => ({
            ...call, affected: rows(call.affected, `${routeAt}.calls[${callIndex}].affected`),
          })),
        };
      }),
      handlers: rows(chain.handlers, `${at}.handlers`).map((handler, handlerIndex) => ({
        ...handler,
        routes: rows(handler.routes, `${at}.handlers[${handlerIndex}].routes`),
        reachedFrom: rows(handler.reachedFrom, `${at}.handlers[${handlerIndex}].reachedFrom`),
      })),
      relationUses: rows(chain.relationUses, `${at}.relationUses`).map((use, useIndex) => ({
        ...use,
        decls: rows(use.decls, `${at}.relationUses[${useIndex}].decls`),
        reachedFrom: rows(use.reachedFrom, `${at}.relationUses[${useIndex}].reachedFrom`),
      })),
      database: rows(chain.database, `${at}.database`).map((vertex, vertexIndex) => ({
        ...vertex, dependents: rows(vertex.dependents, `${at}.database[${vertexIndex}].dependents`),
      })),
    };
  });
  return {
    ...report,
    chains,
    gaps: rows(report.gaps, 'gaps'),
    notices: rows(report.notices, 'notices'),
    limitations: rows(report.limitations, 'limitations'),
    analysisLimitations: rows(report.analysisLimitations, 'analysisLimitations'),
    analyses: rows(report.analyses, 'analyses'),
    truncation: { maxChains: limits.maxChains, maxRows: limits.maxRows, truncated: omittedLists > 0, omittedLists, omitted },
  };
}
