import assert from 'node:assert/strict';
import test from 'node:test';

import type { TraceReport } from './trace.ts';
import { limitTraceReport, MAX_TRACE_OMITTED_ENTRIES } from './trace-view.ts';

/** 목록마다 개수를 정한 합성 보고서다. 행 내용은 자르기 검사에 필요 없어 번호만 싣는다. */
function report(size: number, chains = 2): TraceReport {
  const list = (prefix: string) => Array.from({ length: size }, (_, index) => ({ id: `${prefix}${index}` }));
  const chain = {
    selector: { route: { method: 'GET', template: '/a' } },
    routes: Array.from({ length: size }, () => ({
      scope: 'default', method: 'GET', template: '/a', declarations: list('d'), contracts: list('c'),
      calls: Array.from({ length: size }, () => ({ call: {}, side: 'decl', quality: 'exact', affected: list('a') })),
    })),
    handlers: Array.from({ length: size }, () => ({ platform: 'js', usr: 'h', routes: list('r'), reachedFrom: list('f') })),
    relationUses: Array.from({ length: size }, () => ({ use: {}, relation: 'users', decls: list('x'), reachedFrom: list('y') })),
    database: Array.from({ length: size }, () => ({ vertex: 'v', dependents: list('p') })),
  };
  return {
    format: 'isthmus-trace', version: 1, complete: false,
    chains: Array.from({ length: chains }, () => chain),
    gaps: list('g'), notices: list('n'), limitations: list('l'), analysisLimitations: list('m'), analyses: list('s'),
    summary: { chains },
  } as unknown as TraceReport;
}

test('모든 행 목록을 상한으로 자르고 자른 곳을 경로로 적는다', () => {
  const limited = limitTraceReport(report(3), { maxChains: 1, maxRows: 2 });
  assert.equal(limited.chains.length, 1);
  const [chain] = limited.chains;
  assert.equal(chain!.routes.length, 2);
  assert.equal(chain!.routes[0]!.calls[0]!.affected.length, 2);
  assert.equal(chain!.handlers[1]!.reachedFrom.length, 2);
  assert.equal(chain!.relationUses[0]!.decls.length, 2);
  assert.equal(chain!.database[0]!.dependents.length, 2);
  assert.equal(limited.gaps.length, 2);
  assert.deepEqual(limited.summary, { chains: 2 });
  const paths = limited.truncation.omitted.map(({ path }) => path);
  assert.deepEqual(limited.truncation.omitted[0], { path: 'chains', total: 2, shown: 1 });
  for (const path of ['chains[0].routes', 'chains[0].routes[1].declarations', 'chains[0].routes[0].calls[1].affected',
    'chains[0].handlers[0].routes', 'chains[0].relationUses[1].reachedFrom', 'chains[0].database[0].dependents',
    'gaps', 'notices', 'limitations', 'analysisLimitations', 'analyses']) {
    assert.ok(paths.includes(path), path);
  }
  assert.equal(limited.truncation.omittedLists, limited.truncation.omitted.length);
  assert.equal(limited.truncation.truncated, true);
});

test('상한 안의 보고서는 그대로이고 기록 목록 자체도 상한을 지킨다', () => {
  const untouched = limitTraceReport(report(2), { maxChains: 5, maxRows: 5 });
  const { truncation, ...rest } = untouched;
  assert.deepEqual(rest, report(2));
  assert.deepEqual(truncation, { maxChains: 5, maxRows: 5, truncated: false, omittedLists: 0, omitted: [] });
  const huge = limitTraceReport(report(2, 100), { maxChains: 100, maxRows: 1 });
  assert.equal(huge.truncation.omitted.length, MAX_TRACE_OMITTED_ENTRIES);
  assert.ok(huge.truncation.omittedLists > MAX_TRACE_OMITTED_ENTRIES);
});
