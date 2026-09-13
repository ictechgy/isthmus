import assert from 'node:assert/strict';
import test from 'node:test';
import { parseBridgeFactsDocument } from '../exchange/parse.ts';
import type { PreflightContext } from '../exchange/preflight-context.ts';
import { createPreflightReport, type PreflightSubject } from './preflight.ts';

const at = (path: string, line: number) => ({ path, line, column: 1 });
const symbol = (id: string, path: string, line = 1) => ({ id, qualifiedName: id, location: at(path, line) });
const caller = symbol('dart:Bridge.photo', 'lib/bridge.dart', 3);
const handler = symbol('s:handle', 'ios/Handler.swift');
const helper = symbol('s:helper', 'ios/Helper.swift');
const service = symbol('dart:Service.snap', 'lib/service.dart');
const screen = symbol('dart:Screen.capture', 'lib/screen.dart');
const bridges = [
  parseBridgeFactsDocument({ format: 'bridge-facts', version: 1, project: '/app',
    platform: 'dart', target: 'flutter', generatedAt: '2026-09-14T00:00:00Z', tool: { name: 'dartograph', version: '1' },
    limitations: [], facts: [
      { kind: 'channel-create', channel: 'camera', dynamic: false, location: at('lib/bridge.dart', 10), symbol: { qualifiedName: 'Bridge.photo' } },
      { kind: 'method-invoke', channel: 'camera', method: 'photo', dynamic: false, location: at('lib/bridge.dart', 20), symbol: { qualifiedName: 'Bridge.photo' } },
    ] }),
  parseBridgeFactsDocument({ format: 'bridge-facts', version: 1, project: '/app',
    platform: 'swift', target: 'flutter', generatedAt: '2026-09-14T00:00:00Z', tool: { name: 'cartograph', version: '1' },
    limitations: [], facts: [
      { kind: 'channel-register', channel: 'camera', dynamic: false, location: at('ios/Register.swift', 5), symbol: { qualifiedName: 'Register', usr: 's:register' } },
      { kind: 'method-handle', channel: 'camera', method: 'photo', dynamic: false, location: at('ios/Handler.swift', 8), symbol: { qualifiedName: 'Handler', usr: 's:handle' } },
    ] }),
];
const context: PreflightContext = {
  format: 'isthmus-preflight-context', version: 1, project: '/app', revision: 'revision',
  selection: { swift: { files: ['ios/Helper.swift'], symbols: [] } }, bridges,
  bindings: [10, 20].map((line) => ({ platform: 'dart' as const, location: at('lib/bridge.dart', line), requested: 'Bridge.photo', symbol: caller })),
  analyses: [
    { id: 'native', platform: 'swift', tool: { name: 'cartograph', version: '1' },
      requested: { files: ['ios/Helper.swift'], symbols: [] }, roots: [helper],
      affected: [{ symbol: handler, depth: 1, via: helper.id, relationships: ['call'] }], limitations: [], truncated: false },
    { id: 'callers', platform: 'dart', tool: { name: 'dartograph', version: '1' },
      trigger: caller.id, requested: { files: [], symbols: [caller.id] }, roots: [caller],
      affected: [
        { symbol: service, depth: 1, via: caller.id, relationships: ['call'] },
        { symbol: screen, depth: 2, via: service.id, relationships: ['reference'] },
      ], limitations: [], truncated: false },
  ], limitations: [],
};

test('Swift helper에서 브리지를 거쳐 Dart 화면까지 전이 소비자 경로를 연결한다', () => {
  const report = createPreflightReport(context);
  assert.equal(report.status, 'observed');
  assert.equal(report.summary.selectedSymbols, 1);
  assert.equal(report.summary.affectedSymbols, 4);
  assert.equal(report.summary.bridgeBoundaries, 1);
  const affected = report.affected.find(({ subject }) => subject.kind === 'symbol' && subject.symbol.id === screen.id);
  assert.ok(affected);
  type PathNode = { subject: PreflightSubject; via: string | undefined };
  const nodes = new Map<string, PathNode>([...report.roots.map((subject) => [subject.key, { subject, via: undefined } ] as const),
    ...report.affected.map((item) => [item.subject.key, item] as const)]);
  const path: string[] = [];
  let current: PathNode | undefined = affected;
  while (current !== undefined) {
    path.push(current.subject.kind === 'symbol' ? current.subject.symbol.id : current.subject.channel);
    current = current.via === undefined ? undefined : nodes.get(current.via);
  }
  assert.deepEqual(path, [screen.id, service.id, caller.id, 'camera', handler.id, helper.id]);
  assert.ok(report.reviewFiles.includes('lib/screen.dart'));
  assert.equal(report.complete, false);
});

test('Dart 변경의 네이티브 의존성은 검토하되 그 핸들러의 다른 소비자까지 전파하지 않는다', () => {
  const local = { ...context, selection: { dart: { files: ['lib/bridge.dart'], symbols: [] } },
    analyses: [{ ...context.analyses[1]!, trigger: undefined, requested: { files: ['lib/bridge.dart'], symbols: [] } }] };
  const { trigger: _, ...initial } = local.analyses[0]!;
  const report = createPreflightReport({ ...local, analyses: [initial] });
  assert.equal(report.affected.some(({ subject }) => subject.kind === 'symbol' && subject.platform === 'swift'), false);
  assert.equal(report.boundaries[0]?.relationship, 'dependency');
  assert.ok(report.reviewFiles.includes('ios/Handler.swift'));
});

test('등록 함수 변경도 같은 채널의 Dart 호출자를 영향 범위에 포함한다', () => {
  const register = symbol('s:register', 'ios/Register.swift');
  const report = createPreflightReport({ ...context, selection: { swift: { files: ['ios/Register.swift'], symbols: [] } },
    analyses: [{ ...context.analyses[0]!, requested: { files: ['ios/Register.swift'], symbols: [] }, roots: [register], affected: [] }, context.analyses[1]!] });
  assert.ok(report.affected.some(({ subject }) => subject.kind === 'symbol' && subject.symbol.id === screen.id));
});

test('caller binding이나 후속 producer 분석 부재는 한계로 남고 정체성을 지어내지 않는다', () => {
  const missing = createPreflightReport({ ...context, bindings: [] });
  assert.ok(missing.limitations.some(({ code }) => code === 'unresolved-bridge-binding'));
  assert.equal(missing.affected.some(({ subject }) => subject.kind === 'symbol' && subject.platform === 'dart'), false);
  const noContinuation = createPreflightReport({ ...context, analyses: [context.analyses[0]!] });
  assert.ok(noContinuation.limitations.some(({ code }) => code === 'missing-language-continuation'));
});

test('알 수 없는 초기 선택과 잘린 producer 결과를 깨끗한 성공으로 바꾸지 않는다', () => {
  const report = createPreflightReport({ ...context, analyses: [{ ...context.analyses[0]!, roots: [], affected: [], truncated: true,
    limitations: ['selection-not-found'] }] });
  assert.equal(report.status, 'unobserved');
  assert.ok(report.limitations.some(({ code }) => code === 'producer-truncated'));
  assert.ok(report.limitations.some(({ code }) => code === 'unobserved-selection'));
});

test('문서 순서가 바뀌어도 같은 최단 근거를 선택한다', () => {
  assert.deepEqual(createPreflightReport(context), createPreflightReport({ ...context,
    analyses: [...context.analyses].reverse(), bridges: [...context.bridges].reverse(), bindings: [...context.bindings].reverse() }));
});

test('선택이 없는 CI 입력은 영향 없음 판정과 구분되는 noChanges다', () => {
  const report = createPreflightReport({ ...context, selection: {}, analyses: [] });
  assert.equal(report.status, 'noChanges');
  assert.deepEqual(report.affected, []);
  assert.equal(report.complete, false);
});
