import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { importHttpSurface, type ImportedHttpSurface } from '../exchange/http-surface.ts';
import { parseBridgeFactsDocument } from '../exchange/parse.ts';
import { analysisProject, normalizeTraceAnalysis, parseTraceContext } from '../exchange/trace-context.ts';
import { createHttpSurface } from './http-surface-export.ts';
import { createTraceReport, TraceInputError, type TraceReport } from './trace.ts';
import { limitTraceReport } from './trace-view.ts';

/**
 * 조직 경계 trace — 가져온 http surface(서버 내부 비공개)와 공유 SDK library(두 consumer 앱)를 합성 fixture
 * `fixtures/trace-library`로 검증한다. SDK와 앱 A는 같은 JVM 기술자 id(`shared`), 앱 B는 재배치된 패키지라 대응표
 * (`symbol-map`)를 쓴다.
 */

type Json = Record<string, any>;
const root = new URL('../../fixtures/trace-library/', import.meta.url);
const readJson = async (path: string) => JSON.parse(await readFile(new URL(path, root), 'utf8'));
const baseContext = await readJson('context.json');
const files: Json = {};
for (const member of baseContext.members) {
  for (const path of [...(member.documents ?? []), ...(member.analyses ?? []).map(({ path: value }: Json) => value)]) {
    files[path] = await readJson(path);
  }
}
const surfaceJson = await readJson('../http-surface/surfaces/example-api-2.4.surface.json');
const serverRoot = new URL('../../fixtures/http-surface/server/release-2.4/', import.meta.url);
const serverDocuments = await Promise.all(['server.http.json', 'api.openapi.json'].map(async (name) =>
  parseBridgeFactsDocument(JSON.parse(await readFile(new URL(name, serverRoot), 'utf8')))));

const GET = 'kt:com.example.sdk.internal.OrdersClient#get(String)';
const ORDER = 'kt:com.example.sdk.OrdersSdk#order(String)';
const PLACE = 'kt:com.example.sdk.OrdersSdk#placeOrder(Order)';

/** fixture를 복제·변형해 trace를 만든다. surface는 기본으로 fixture artifact다. */
function trace(mutate: (value: { context: Json; files: Json }) => void = () => {},
  surface: ImportedHttpSurface | null = importHttpSurface(surfaceJson)): TraceReport {
  const value = structuredClone({ context: baseContext, files });
  mutate(value);
  const context = parseTraceContext(value.context);
  return createTraceReport({
    context,
    documents: context.documents.map((path) => parseBridgeFactsDocument(value.files[path])),
    analyses: context.analyses.map((reference) =>
      normalizeTraceAnalysis(value.files[reference.path], reference, analysisProject(context, reference))),
    surfaces: surface === null ? new Map() : new Map([['api', surface]]),
  });
}

const codes = (report: TraceReport) => [...new Set(report.gaps.map(({ code }) => code))].sort();
const callOf = (report: TraceReport, template: string) =>
  report.chains.flatMap(({ routes }) => routes).find((route) => route.template === template)!.calls[0]!;

test('SDK 호출에서 두 consumer 앱의 코드로 이어 가고, surface 서버는 route에서 멈춘다', () => {
  const report = trace();
  assert.deepEqual(codes(report), ['server-surface-opaque']);
  assert.equal(report.gaps.length, 2);
  const get = callOf(report, '/api/orders/{}');
  assert.equal(get.call.member, 'sdk');
  assert.deepEqual(get.affected.map(({ usr }) => usr), [ORDER]);
  assert.deepEqual(get.consumers?.map(({ library, member, ids, entries, notInConsumerGraph, notPublic }) =>
    [library, member, ids, entries, notInConsumerGraph, notPublic]), [
    ['app-a<-sdk', 'app-a', 'shared', [{ provider: ORDER, consumer: ORDER }], 0, 1],
    ['app-b<-sdk', 'app-b', 'symbol-map', [{ provider: ORDER, consumer: 'kt:shaded.orders.OrdersSdk#order(String)' }], 0, 1],
  ]);
  assert.deepEqual(get.consumers?.[0]?.affected.map(({ usr, member, depth, path }) => [usr, member, depth, path]), [
    ['kt:com.example.appa.OrderScreen#load()', 'app-a', 1, [ORDER, 'kt:com.example.appa.OrderScreen#load()']],
    ['kt:com.example.appa.OrderActivity#onResume()', 'app-a', 2,
      [ORDER, 'kt:com.example.appa.OrderScreen#load()', 'kt:com.example.appa.OrderActivity#onResume()']],
  ]);
  assert.deepEqual(callOf(report, '/api/orders').consumers?.[1]?.affected.map(({ usr }) => usr), ['kt:com.example.appb.CheckoutActivity#pay()']);
  assert.equal(report.summary.clientSymbols, 7);
  // surface 선언 끝점에는 위치·심볼이 없다. 핸들러가 비공개라 handlers도 비어 있다.
  const route = report.chains[0]!.routes[0]!;
  assert.deepEqual(route.declarations.map(({ member, location, symbol }) => [member, location, symbol]), [['api', undefined, undefined]]);
  assert.deepEqual(report.chains.flatMap(({ handlers }) => handlers), []);
  assert.deepEqual(report.workspace?.members[0], { name: 'api', surface: { name: 'example-api', revision: 'v2.4',
    sha256: baseContext.members[0].surface.sha256, privacy: { handlers: 'opaque', limitations: 'prefix-only' } } });
  assert.deepEqual(report.workspace?.libraries?.map(({ name, publicSymbols, symbolMapEntries }) => [name, publicSymbols, symbolMapEntries]),
    [['app-a<-sdk', 2, undefined], ['app-b<-sdk', undefined, 2]]);
  assert.ok(!report.gaps.some(({ code }) => code === 'persistence-unscanned'));
});

test('consumer 그래프에 없는 SDK id(root-not-found)는 개수만 싣고, root로 받지 않은 id는 gap이다', () => {
  const notFound = trace((value) => {
    const appA = value.files['app-a/app-a-reverse.json'];
    appA.roots[1] = { id: PLACE };
    appA.reached = appA.reached.filter(({ roots }: Json) => roots[0] !== 1);
    Object.assign(appA, { truncated: true, truncationReasons: ['root-not-found'], limitations: [`root-not-found: ${PLACE}`] });
  });
  const create = callOf(notFound, '/api/orders').consumers![0]!;
  assert.deepEqual([create.entries, create.notInConsumerGraph, create.affected], [[], 1, []]);
  assert.ok(!notFound.gaps.some(({ code }) => code === 'library-continuation-unrooted'));
  // root-not-found는 그 요청 root만의 사유라 찾은 root(GET SDK 심볼)의 hop에는 analysis-truncated를 남기지 않는다.
  assert.ok(!notFound.gaps.some(({ code }) => code === 'analysis-truncated' || code === 'analysis-root-not-found'));
  assert.ok(callOf(notFound, '/api/orders/{}').consumers![0]!.affected.length > 0);

  const unrooted = trace((value) => {
    delete value.context.libraries[0].publicSymbols;
  });
  const gap = unrooted.gaps.find(({ code, symbol }) => code === 'library-continuation-unrooted' && symbol?.usr === GET)!;
  assert.equal(gap.library, 'app-a<-sdk');
  assert.equal(gap.member, 'app-a');
  assert.deepEqual(gap.symbol, { platform: 'kotlin', usr: GET });
  assert.match(gap.detail, /1 library symbol id\(s\)/u);
  assert.equal(callOf(unrooted, '/api/orders/{}').consumers![0]!.notPublic, undefined);
});

test('id가 하나도 맞지 않으면 library-ids-unmatched이고, consumer 분석이 없어도 같다', () => {
  const shared = trace((value) => {
    value.context.libraries[1] = { name: 'app-b<-sdk', consumer: 'app-b', provider: 'sdk', ids: 'shared' };
  });
  const gap = shared.gaps.find(({ code }) => code === 'library-ids-unmatched')!;
  assert.deepEqual([gap.library, gap.member], ['app-b<-sdk', 'app-b']);
  assert.ok(!shared.gaps.some(({ code, library }) => code === 'library-ids-unmatched' && library === 'app-a<-sdk'));
  const noAnalysis = trace((value) => { value.context.members[2].analyses = []; });
  assert.match(noAnalysis.gaps.find(({ code, library }) => code === 'library-ids-unmatched' && library === 'app-a<-sdk')!.detail,
    /among its publicSymbols/u);
  const mapped = trace((value) => { value.context.libraries[1].symbolMap[0].consumer = 'kt:elsewhere'; value.context.libraries[1].symbolMap[1].consumer = 'kt:elsewhere2'; });
  assert.match(mapped.gaps.find(({ code }) => code === 'library-ids-unmatched')!.detail, /through the symbolMap/u);
});

test('consumer 영향의 candidate 근거는 library를 밝힌 candidate-dispatch gap이고 출력 상한이 consumer 목록도 자른다', () => {
  const report = trace((value) => {
    const appA = value.files['app-a/app-a-reverse.json'];
    appA.dispatch = 'candidates';
    appA.reached[0].evidence = 'candidate';
  });
  const gap = report.gaps.find(({ code }) => code === 'candidate-dispatch')!;
  assert.equal(gap.library, 'app-a<-sdk');
  assert.equal(report.summary.evidence.candidate, 1);
  const limited = limitTraceReport(report, { maxChains: 5, maxRows: 1 });
  const call = limited.chains.flatMap(({ routes }) => routes).find(({ template }) => template === '/api/orders/{}')!.calls[0]!;
  assert.equal(call.consumers?.length, 1);
  assert.equal(call.consumers?.[0]?.affected.length, 1);
  assert.ok(limited.truncation.omitted.some(({ path }) => path.endsWith('.consumers')));
  assert.ok(limited.truncation.omitted.some(({ path }) => path.endsWith('.consumers[0].affected')));
});

test('핸들러 usr를 공개한 surface는 핸들러 hop과 gap symbol을 싣지만 정방향으로 따라가지 않는다', () => {
  const published = createHttpSurface(serverDocuments, { name: 'example-api', revision: 'v2.4', exporterVersion: '0.0.0',
    includeHandlerUsrs: true });
  const report = trace((value) => { value.context.links[0].contract = { member: 'api', authoritative: true }; },
    importHttpSurface(JSON.parse(JSON.stringify(published))));
  const handlers = report.chains.flatMap((chain) => chain.handlers);
  assert.deepEqual(handlers.map(({ usr, member, qualifiedName, reachedFrom }) => [usr, member, qualifiedName, reachedFrom]),
    [['ts:api/orders.create', 'api', undefined, []], ['ts:api/orders.get', 'api', undefined, []]]);
  assert.deepEqual(report.gaps.filter(({ code }) => code === 'server-surface-opaque').map(({ symbol }) => symbol?.usr).sort(),
    ['ts:api/orders.create', 'ts:api/orders.get']);
  assert.ok(!report.gaps.some(({ code }) => code === 'analysis-missing'));
  assert.deepEqual(report.chains[0]!.routes[0]!.contracts.map(({ member, symbol }) => [member, symbol?.qualifiedName]),
    [['api', 'createOrder']]);
});

test('surface를 읽지 않았거나 계약으로 쓸 스펙이 없으면 입력 오류다', () => {
  assert.throws(() => trace(() => {}, null), (error: unknown) =>
    error instanceof TraceInputError && /needs its imported http surface/u.test(error.message));
  const declOnly = createHttpSurface(serverDocuments.slice(0, 1), { name: 'example-api', revision: 'v2.4', exporterVersion: '0.0.0' });
  assert.throws(() => trace((value) => { value.context.links[0].contract = { member: 'api' }; },
    importHttpSurface(JSON.parse(JSON.stringify(declOnly)))), (error: unknown) =>
    error instanceof TraceInputError && /carries no openapi document/u.test(error.message));
});
