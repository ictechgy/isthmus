import assert from 'node:assert/strict';
import test from 'node:test';
import { parseBridgeFactsDocument } from '../exchange/parse.ts';
import type { PreflightContext } from '../exchange/preflight-context.ts';
import { createPreflightReport, type PreflightSubject } from './preflight.ts';
import { parsePreflightContext } from '../exchange/preflight-context.ts';
import { createPreflightExplanation } from './preflight-view.ts';

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

const basicCaller = symbol('dart:Basic.send', 'lib/basic.dart', 2);
const basicScreen = symbol('dart:BasicScreen.show', 'lib/basic_screen.dart', 4);
function withMessages(prefix = false): PreflightContext {
  const messages = ['dart', 'swift'].map((platform) => ({ format: 'bridge-facts', version: 2,
    transport: 'basic-message-channel', project: context.project, generatedAt: '2026-09-14T00:00:00Z',
    platform, target: 'flutter', tool: { name: platform, version: 'dev' }, limitations: [], facts: [{
      kind: platform === 'dart' ? 'message-send' : 'message-handle',
      channel: prefix ? 'channelNameWithSuffix' : 'camera', dynamic: prefix,
      ...(prefix ? { channelPrefix: 'camera' } : {}),
      location: platform === 'dart' ? at('lib/basic.dart', 10) : at('ios/Handler.swift', 20),
      symbol: platform === 'dart' ? { qualifiedName: 'Basic.send' } : { qualifiedName: 'Handler', usr: handler.id },
      ...(platform !== 'swift' ? {} : { handlerScope: { start: at('ios/Handler.swift', 20), end: at('ios/Handler.swift', 30), complete: true },
        dependencies: [{ kind: 'call', scope: 'handler', location: at('ios/Handler.swift', 22), symbol: { qualifiedName: helper.id, usr: helper.id } }] }),
    }] }));
  return parsePreflightContext({ ...context, messages,
    bindings: [...context.bindings, { platform: 'dart', location: at('lib/basic.dart', 10), requested: 'Basic.send', symbol: basicCaller }],
    analyses: [...context.analyses, { id: 'basic', platform: 'dart', tool: { name: 'dart', version: 'dev' },
      requested: { files: [], symbols: [basicCaller.id] }, trigger: basicCaller.id, roots: [basicCaller],
      affected: [{ symbol: basicScreen, depth: 1, via: basicCaller.id, relationships: ['call'] }], limitations: [], truncated: false }],
  });
}

test('동일 주소의 Basic과 Method를 분리하고 실제 message 심볼로 전이 경로를 잇는다', () => {
  const report = createPreflightReport(withMessages());
  const basic = report.boundaries.find(({ subject }) => subject.transport === 'basic-message-channel');
  assert.ok(basic);
  assert.equal(basic.subject.channel, 'camera');
  assert.equal(basic.subject.method, undefined);
  assert.equal(basic.subject.matching, 'literal');
  assert.ok(report.affected.some(({ subject }) => subject.kind === 'symbol' && subject.symbol.id === basicScreen.id));
  assert.equal(report.summary.evidenceGaps, 0);
  assert.ok(report.boundaries.some(({ subject }) => subject.method === 'photo' && subject.key !== basic.subject.key));
});

test('Dart 영향 root에 위치가 없어도 실제 호출자 바인딩의 선언 위치를 보존한다', () => {
  const input = withMessages();
  const report = createPreflightReport({ ...input, analyses: input.analyses.map((analysis) => analysis.platform !== 'dart'
    ? analysis : { ...analysis, roots: analysis.roots.map(({ location: _location, ...symbol }) => ({ ...symbol, kind: 'declaration' })) }) });
  for (const expected of [caller, basicCaller]) {
    const found = report.affected.find(({ subject }) => subject.kind === 'symbol' && subject.symbol.id === expected.id)?.subject;
    assert.ok(found?.kind === 'symbol');
    assert.deepEqual(found.symbol.location, expected.location);
    assert.equal(found.symbol.kind, 'declaration');
  }
  const explanation = createPreflightExplanation(report, basicScreen.id);
  assert.equal(explanation.status, 'found');
  if (explanation.status === 'found') {
    assert.ok(explanation.result);
    const bound = explanation.result.path.find(({ subject }) => subject.kind === 'symbol' && subject.symbol.id === basicCaller.id)?.subject;
    assert.ok(bound?.kind === 'symbol');
    assert.deepEqual(bound.symbol.location, basicCaller.location);
  }
});

test('동일 Dart ID의 바인딩과 분석 위치가 충돌하면 임의로 한쪽을 선택하지 않는다', () => {
  const input = withMessages();
  assert.throws(() => createPreflightReport({ ...input, bindings: input.bindings.map((binding) =>
    binding.symbol.id === basicCaller.id ? { ...binding, symbol: { ...binding.symbol, location: at('lib/basic.dart', 99) } } : binding) }),
  /Conflicting symbol identities/);
});

test('Dart 브리지 USR과 실제 query 바인딩의 ID가 다르면 조인을 거부한다', () => {
  const input = withMessages();
  const messages = input.messages!.map((document) => document.platform !== 'dart' ? document : {
    ...document, facts: document.facts.map((fact) => ({ ...fact, symbol: { ...fact.symbol!, usr: 'dart:different' } })),
  });
  assert.throws(() => createPreflightReport(parsePreflightContext({ ...input, messages })), /Conflicting symbol identities/);
});

test('Pigeon prefix 경로는 후보로 연결하며 실제 suffix를 추측하지 않는다', () => {
  const report = createPreflightReport(withMessages(true));
  assert.ok(report.affected.some(({ subject }) => subject.kind === 'symbol' && subject.symbol.id === basicScreen.id));
  assert.equal(report.boundaries.find(({ subject }) => subject.transport === 'basic-message-channel')?.subject.matching, 'prefix');
  assert.ok(report.limitations.some(({ code }) => code === 'dynamic-message-address'));
});

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

function sharedMessageSetup(selected: 'launch' | 'setup' | 'shared' | 'helper', precision: 'complete' | 'incomplete' | 'absent' = 'complete'): PreflightContext {
  const setup = symbol('s:setup', 'ios/Setup.swift');
  const launch = symbol('s:launch', 'ios/Plugin.swift');
  const chosen = selected === 'setup' ? setup : selected === 'launch' ? launch : symbol(`s:${selected}`, 'ios/Helpers.swift');
  const affected = selected === 'setup' ? [] : selected === 'helper'
    ? [{ symbol: launch, via: chosen.id, depth: 1, relationships: ['call'] }, { symbol: setup, via: launch.id, depth: 2, relationships: ['dispatchCaller'] }]
    : [{ symbol: setup, via: chosen.id, depth: 1, relationships: ['call'] }];
  const names = ['launch', 'canLaunch'];
  const location = (name: string) => at(`lib/${name}.dart`, 5);
  const sendSymbol = (name: string) => symbol(`dart:${name}`, `lib/${name}.dart`);
  return parsePreflightContext({ ...context,
    selection: { swift: { files: [], symbols: [chosen.id] } },
    bridges: bridges.map((document) => ({ ...document, target: null, facts: [] })),
    messages: ['dart', 'swift'].map((platform) => ({ format: 'bridge-facts', version: 2, transport: 'basic-message-channel',
      platform, target: 'flutter', project: '/app', generatedAt: '2026-09-14T00:00:00Z', tool: { name: platform, version: 'dev' }, limitations: [],
      facts: names.map((name, index) => platform === 'dart'
        ? { kind: 'message-send', channel: name, dynamic: false, location: location(name), symbol: { qualifiedName: name } }
        : { kind: 'message-handle', channel: name, dynamic: false, location: at('ios/Setup.swift', 10 + index * 20),
          symbol: { qualifiedName: 'Setup.register', usr: setup.id },
          ...(precision === 'absent' ? {} : { handlerScope: { start: at('ios/Setup.swift', 10 + index * 20),
            end: at('ios/Setup.swift', 20 + index * 20), complete: precision === 'complete' },
          dependencies: [
            { kind: 'call', scope: 'handler', location: at('ios/Setup.swift', 12 + index * 20),
              symbol: { qualifiedName: `Api.${name}`, usr: `s:protocol-${name}` },
              dispatchTargets: [{ qualifiedName: `Plugin.${name}`, usr: `s:${name}` }] },
            { kind: 'reference', scope: 'registration', location: at('ios/Setup.swift', 5),
              symbol: { qualifiedName: 'Shared.configuration', usr: 's:shared' } },
          ] }) }) })),
    bindings: names.map((name) => ({ platform: 'dart', location: location(name), requested: name, symbol: sendSymbol(name) })),
    analyses: [{ id: 'swift', platform: 'swift', tool: { name: 'cartograph', version: 'dev' },
      requested: { files: [], symbols: [chosen.id] }, roots: [chosen], affected, limitations: [], truncated: false },
      ...names.map((name) => ({ id: name, platform: 'dart', tool: { name: 'dartograph', version: 'dev' },
        requested: { files: [], symbols: [`dart:${name}`] }, trigger: `dart:${name}`, roots: [sendSymbol(name)],
        affected: [], limitations: [], truncated: false }))],
  });
}

test('공통 setup의 독립 handler는 실제 dispatch 의존 근거로만 전파한다', () => {
  for (const selected of ['launch', 'helper'] as const) {
    const report = createPreflightReport(sharedMessageSetup(selected));
    assert.deepEqual(report.boundaries.map(({ subject }) => subject.channel), ['launch']);
    assert.ok(report.affected.some(({ subject }) => subject.kind === 'symbol' && subject.symbol.id === 'dart:launch'));
    assert.equal(report.affected.some(({ subject }) => subject.kind === 'symbol' && subject.symbol.id === 'dart:canLaunch'), false);
    assert.equal(report.reviewFiles.includes('lib/canLaunch.dart'), false);
    const boundary = report.affected.find(({ subject }) => subject.kind === 'bridge');
    assert.equal(boundary?.via, JSON.stringify(['swift', 's:launch']));
    assert.equal(boundary?.relations[0]?.kind, 'bridge-message-dependency');
    const explanation = createPreflightExplanation(report, 'dart:launch');
    const relation = explanation.result?.path.find(({ subject }) => subject.kind === 'bridge')?.relations.items[0];
    assert.equal(relation?.kind, 'bridge-message-dependency');
    if (relation?.kind === 'bridge-message-dependency') {
      assert.equal(relation.dependency.symbol.usr, 's:protocol-launch');
      assert.equal(relation.dispatchTarget?.usr, 's:launch');
      assert.equal('dependencies' in relation.evidence, false);
    }
  }
});

test('setup 직접 변경과 closure 밖 공유 의존 변경은 모든 handler에 전파한다', () => {
  for (const selected of ['setup', 'shared'] as const) {
    const report = createPreflightReport(sharedMessageSetup(selected));
    assert.deepEqual(report.boundaries.map(({ subject }) => subject.channel), ['canLaunch', 'launch']);
    assert.equal(report.summary.evidenceGaps, 0);
  }
});

test('handler 의존 근거가 없거나 불완전하면 넓은 후보와 정밀도 공백을 보존한다', () => {
  for (const precision of ['absent', 'incomplete'] as const) {
    const report = createPreflightReport(sharedMessageSetup('launch', precision));
    assert.deepEqual(report.boundaries.map(({ subject }) => subject.channel), ['canLaunch', 'launch']);
    assert.ok(report.limitations.some(({ code }) => code === 'unresolved-message-handler-scope'));
  }
});

test('USR가 같은 fact의 표시 이름을 graph 이름으로 덮어쓰지 않고 근거에 보존한다', () => {
  const value = sharedMessageSetup('launch');
  const messages = value.messages!.map((document) => document.platform === 'dart' ? document : { ...document,
    facts: document.facts.map((fact) => ({ ...fact, symbol: { ...fact.symbol!, qualifiedName: 'Different.Spelling.setup' } })) });
  const report = createPreflightReport({ ...value, messages });
  assert.ok(report.affected.some(({ subject }) => subject.kind === 'symbol' && subject.symbol.id === 'dart:launch'));
  assert.equal(report.boundaries[0]?.receivers[0]?.symbol?.qualifiedName, 'Different.Spelling.setup');
});

test('영향 숲에 없는 의존 근거도 관련 boundary의 원본 receiver에 남긴다', () => {
  const report = createPreflightReport(sharedMessageSetup('setup'));
  const rawReport = JSON.parse(JSON.stringify(report));
  const receiver = rawReport.boundaries.find((boundary: { subject: { channel: string } }) => boundary.subject.channel === 'canLaunch').receivers[0];
  assert.equal(receiver.dependencies[0].symbol.usr, 's:protocol-canLaunch');
  assert.equal(receiver.dependencies[0].dispatchTargets[0].usr, 's:canLaunch');
  assert.equal(report.summary.evidenceGaps, 0, 'Unchanged dependencies absent from an impact forest are not missing analysis.');
});

test('같은 boundary의 불완전한 추가 관찰은 완전한 관찰에 가려지지 않는다', () => {
  const value = sharedMessageSetup('launch');
  const messages = value.messages!.map((document) => document.platform === 'dart' ? document : { ...document,
    facts: [...document.facts, { ...document.facts[1]!, handlerScope: { ...document.facts[1]!.handlerScope!, complete: false } }] });
  const report = createPreflightReport({ ...value, messages });
  assert.deepEqual(report.boundaries.map(({ subject }) => subject.channel), ['canLaunch', 'launch']);
  assert.ok(report.limitations.some(({ code }) => code === 'unresolved-message-handler-scope'));
});
