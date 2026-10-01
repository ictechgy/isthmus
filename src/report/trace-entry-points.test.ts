import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { parseBridgeFactsDocument } from '../exchange/parse.ts';
import { normalizeTraceAnalysis, parseTraceContext } from '../exchange/trace-context.ts';
import { createTraceReport } from './trace.ts';
import { encodeSortedJson } from './sorted-json.ts';
import { limitTraceReport } from './trace-view.ts';

/** 기존 합성 HTTP/DB fixture에 페이지와 액션 관찰만 더한다. */
const read = async (name: string) => JSON.parse(await readFile(new URL(`../../fixtures/trace/${name}`, import.meta.url), 'utf8'));
const fixture = {
  context: await read('context.json'),
  documents: await Promise.all(['server.http.json', 'server.persistence.json', 'db.sql.json', 'android.http.json'].map(read)),
  reverse: await read('server-reverse.json'),
  analyses: await Promise.all(['server-forward.json', 'db-dependents.json', 'android-reverse.json'].map(read)),
};
const repository = 'ts:repo/users.findById';
const page = 'ts:pages/Profile';
const action = 'ts:actions/updateProfile';

/** 이름을 추정하지 않고 생산자가 표식을 실은 역방향 정점이다. */
function entryRow(usr: string, entries: string[], roots = [1], evidence = 'bound'): any {
  return { symbol: { usr, qualifiedName: usr, entries, location: { path: 'server/profile.ts', line: 3 } },
    via: roots.includes(1) ? repository : 'ts:repo/audit.write', depth: 1, roots, evidence, relationships: ['call'] };
}

/** 문서·분석 모두 실제 파서를 통과시켜 보고서를 만든다. */
function build(mutate: (input: typeof fixture) => void = () => {}) {
  const input = structuredClone(fixture);
  input.context.selection = { relations: ['users'] };
  mutate(input);
  const context = parseTraceContext(input.context);
  const documents = input.documents.map(parseBridgeFactsDocument);
  const values = [input.reverse, ...input.analyses];
  const analyses = context.analyses.map((reference) => normalizeTraceAnalysis(
    values.find((value) => value.direction === (reference.role === 'forward' ? 'dependencies' : 'dependents') &&
      value.platform === reference.platform && (reference.id !== 'server-reverse' || value === input.reverse)),
    reference, context.project!));
  return { context, documents, analyses };
}

/** 후보 정점을 기존 순회에 추가하고 계약의 결정적 순서를 유지한다. */
function addEntries(input: typeof fixture, rows = [entryRow(action, ['server-action']), entryRow(page, ['page'])]) {
  input.reverse.reached.push(...rows);
  input.reverse.reached.sort((a: any, b: any) => a.depth - b.depth || (a.symbol.usr < b.symbol.usr ? -1 : 1));
}

test('DB 변경의 API 영향과 페이지·서버 액션 영향을 함께 보고한다', () => {
  const input = build(addEntries);
  const result = createTraceReport(input);
  const chain = result.chains[0]! as any;
  assert.deepEqual(chain.routes.map((route: any) => route.method), ['POST', 'GET']);
  assert.deepEqual(chain.entryPoints.map((entry: any) => [entry.usr, entry.entries, entry.location, entry.reachedFrom]), [
    [action, ['server-action'], { path: 'server/profile.ts', line: 3 }, [{ from: repository, analysis: 'server-reverse',
      depth: 1, path: [repository, action], evidence: 'bound' }]],
    [page, ['page'], { path: 'server/profile.ts', line: 3 }, [{ from: repository, analysis: 'server-reverse',
      depth: 1, path: [repository, page], evidence: 'bound' }]],
  ]);
  assert.equal((result.summary as any).entryPoints, 2);
  assert.equal(result.complete, false);
  assert.equal(result.summary.evidence.bound, 2);
  assert.equal(encodeSortedJson(result), encodeSortedJson(createTraceReport({ ...input, analyses: [...input.analyses].reverse() })));
});

test('HTTP 핸들러 없이 알려진 페이지·액션에 닿으면 명시적 영향으로 보고한다', () => {
  const result = createTraceReport(build((input) => {
    input.reverse.reached = [entryRow(action, ['server-action']), entryRow(page, ['page'])];
  }));
  assert.deepEqual(result.chains[0]!.routes, []);
  assert.equal((result.chains[0] as any).entryPoints.length, 2);
  assert.ok(!result.gaps.some(({ code }) => code === 'non-http-entry'));
});

test('선택한 진입점 자신은 depth 0이고 표식 없는 옛 입력의 모양은 유지한다', () => {
  const old = createTraceReport(build());
  assert.equal('entryPoints' in old.chains[0]!, false);
  assert.equal('entryPoints' in old.summary, false);
  const result = createTraceReport(build((input) => {
    input.context.selection = { symbols: [{ platform: 'js', usr: page }] };
    input.reverse.roots = [{ id: page, symbol: { usr: page, entries: ['page'] } }];
    input.reverse.reached = [];
  }));
  assert.deepEqual((result.chains[0] as any).entryPoints, [{ platform: 'js', usr: page, entries: ['page'],
    reachedFrom: [{ from: page, depth: 0, path: [page], evidence: 'direct' }] }]);
});

test('다른 root에서만 닿은 표식은 이 선택의 영향이 아니다', () => {
  const result = createTraceReport(build((input) => addEntries(input, [entryRow(page, ['page'], [0])])));
  assert.equal('entryPoints' in result.chains[0]!, false);
});

test('candidate·잘림 공백은 진입점 표식이 있어도 보존한다', () => {
  const result = createTraceReport(build((input) => {
    input.reverse.reached = [entryRow(page, ['page'], [1], 'candidate')];
    input.reverse.truncated = true;
    input.reverse.truncationReasons = ['depth'];
  }));
  assert.equal((result.chains[0] as any).entryPoints[0].reachedFrom[0].evidence, 'candidate');
  assert.ok(result.gaps.some(({ code }) => code === 'candidate-dispatch'));
  assert.ok(result.gaps.some(({ code }) => code === 'analysis-truncated'));
});

test('entryPoints와 도달 근거 목록도 출력 상한과 생략 증거를 지킨다', () => {
  const result = createTraceReport(build(addEntries));
  const limited = limitTraceReport(result, { maxChains: 1, maxRows: 1 });
  assert.equal((limited.chains[0] as any).entryPoints.length, 1);
  assert.ok(limited.truncation.omitted.some(({ path }) => path === 'chains[0].entryPoints'));
  assert.equal((limited.summary as any).entryPoints, 2);
});

test('공유 진입점은 중복 없이 시작점별 목격 경로를 보존하고 근거 목록도 자른다', () => {
  const result = createTraceReport(build((input) => {
    input.documents[1].facts.push({ ...input.documents[1].facts[2], channel: 'users' });
    addEntries(input, [entryRow(page, ['page'], [0, 1])]);
  }));
  const entry = result.chains[0]!.entryPoints![0]!;
  assert.equal(entry.usr, page);
  assert.equal(entry.reachedFrom.length, 2);
  assert.deepEqual(entry.reachedFrom.map((reach) => [reach.from, reach.witnessRoot]), [
    ['ts:repo/audit.write', repository], [repository, undefined],
  ]);
  const limited = limitTraceReport(result, { maxChains: 1, maxRows: 1 });
  assert.equal(limited.chains[0]!.entryPoints![0]!.reachedFrom.length, 1);
  assert.ok(limited.truncation.omitted.some(({ path }) => path === 'chains[0].entryPoints[0].reachedFrom'));
});

test('파일 선택도 페이지 영향을 보고하며 route-handler 표식만으로 비HTTP 진입점을 만들지 않는다', () => {
  const input = build((value) => {
    value.context.selection = { files: ['server/db/users.ts'] };
    addEntries(value);
    value.reverse.reached.find((row: any) => row.symbol.usr === 'ts:api/users.get').symbol.entries = ['route-handler'];
  });
  const result = createTraceReport(input);
  assert.deepEqual(result.chains[0]!.entryPoints!.map(({ usr }) => usr), [action, page]);
  assert.ok(result.notices.some(({ code }) => code === 'file-selection-coarse'));
});

test('workspace의 같은 id는 다른 member에서 가져와 잇지 않는다', () => {
  const base = structuredClone(fixture);
  base.reverse.reached = [entryRow(page, ['page'])];
  const makeMember = (name: string, project: string) => ({ name, project, revision: 'rev-1',
    documents: [`${name}/persistence.json`], analyses: [{ id: `${name}-reverse`, platform: 'js', role: 'reverse', path: `${name}/reverse.json` }],
  });
  const context = parseTraceContext({ format: 'isthmus-trace-context', version: 1,
    members: [makeMember('one', '/work/one'), makeMember('two', '/work/two')], links: [],
    selection: { symbols: [{ member: 'one', platform: 'js', usr: repository }] },
  });
  const documents = ['one', 'two'].map((name) => parseBridgeFactsDocument({ ...base.documents[1], project: `/work/${name}` }));
  const analyses = context.analyses.map((reference) => normalizeTraceAnalysis({ ...base.reverse,
    project: `/work/${reference.member}`, reached: reference.member === 'one' ? [] : base.reverse.reached,
  }, reference, `/work/${reference.member}`));
  const result = createTraceReport({ context, documents, analyses });
  assert.equal(result.chains[0]!.entryPoints, undefined);
  assert.ok(result.gaps.some(({ code, member }) => code === 'non-http-entry' && member === 'one'));
});
