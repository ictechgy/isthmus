import assert from 'node:assert/strict';
import test from 'node:test';

import { parseBridgeFactsDocument } from '../exchange/parse.ts';
import { createBridgeImpact, encodeBridgeImpact, hasImpactBlockers } from './impact.ts';
import { parseImpactSelection } from '../exchange/impact-selection.ts';

const location = (path: string, line: number) => ({ path, line, column: 1 });
const fact = (kind: string, path: string, line: number, method?: string,
  name?: string, channel = 'camera') => ({
  kind, channel, dynamic: false, location: location(path, line),
  ...(method === undefined ? {} : { method }),
  ...(name === undefined ? {} : { symbol: { qualifiedName: name, usr: `s:${name}` } }),
});
const document = (platform: string, facts: unknown[], limitations: string[] = []) =>
  parseBridgeFactsDocument({
    format: 'bridge-facts', version: 1, tool: { name: platform, version: '1.0.0' },
    generatedAt: '2026-09-14T00:00:00Z', project: '/project', platform,
    target: facts.length === 0 ? null : 'flutter', facts, limitations,
  });
const dart = document('dart', [
  fact('channel-create', 'lib/camera.dart', 1),
  fact('method-invoke', 'lib/photo.dart', 5, 'takePhoto'),
  fact('method-invoke', 'lib/video.dart', 8, 'recordVideo'),
  fact('method-invoke', 'lib/other.dart', 4, 'missing', undefined, 'other'),
]);
const swift = document('swift', [
  fact('channel-register', 'ios/Registration.swift', 2, undefined, 'Camera.register'),
  fact('method-handle', 'ios/Camera.swift', 10, 'takePhoto', 'Camera.photo'),
  fact('method-handle', 'ios/Camera.swift', 20, 'recordVideo', 'Camera.video'),
]);
const select = (files: string[] = [], symbols: string[] = []) =>
  parseImpactSelection({ format: 'isthmus-changes', version: 1, files, symbols });

test('Swift 파일 변경은 모든 관련 Dart 호출자와 기존 진단을 찾고 다른 채널은 제외한다', () => {
  const report = createBridgeImpact([dart, swift], select(['ios/Camera.swift']));
  assert.equal(report.status, 'observed');
  assert.equal(report.project, '/project');
  assert.deepEqual(report.methods.map(({ method }) => method), ['recordVideo', 'takePhoto']);
  assert.deepEqual(report.methods.find(({ method }) => method === 'takePhoto')?.invocations,
    [{ platform: 'dart', location: location('lib/photo.dart', 5) }]);
  assert.deepEqual(report.reviewFiles,
    ['ios/Camera.swift', 'ios/Registration.swift', 'lib/camera.dart', 'lib/photo.dart', 'lib/video.dart']);
  assert.equal(report.summary.errors, 0);
  assert.equal(report.summary.selectedFacts, 2);
  assert.equal(report.scope, 'bridge');
  assert.equal(report.complete, false);
});

test('심볼 이름 또는 USR은 해당 메서드에만 영향을 좁힌다', () => {
  for (const name of ['Camera.photo', 's:Camera.photo']) {
    const report = createBridgeImpact([dart, swift], select([], [name]));
    assert.deepEqual(report.methods.map(({ method }) => method), ['takePhoto']);
    assert.equal(report.reviewFiles.includes('lib/video.dart'), false);
    assert.deepEqual(report.unmatchedSelectors, { files: [], symbols: [] });
  }
});

test('채널 등록 변경은 그 채널의 모든 메서드까지 영향을 확장한다', () => {
  const report = createBridgeImpact([dart, swift], select(['ios/Registration.swift']));
  assert.deepEqual(report.methods.map(({ method }) => method), ['recordVideo', 'takePhoto']);
  assert.deepEqual(report.channels.map(({ reason }) => reason), ['channel-wiring']);
});

test('Dart 호출자 변경은 상대 Swift 핸들러와 등록을 찾는다', () => {
  const report = createBridgeImpact([dart, swift], select(['lib/photo.dart']));
  assert.deepEqual(report.methods.map(({ method }) => method), ['takePhoto']);
  assert.equal(report.methods[0]?.handlers[0]?.symbol?.usr, 's:Camera.photo');
});

test('대응 핸들러가 없는 호출도 영향과 error 근거를 보존한다', () => {
  const report = createBridgeImpact([dart, swift], select(['lib/other.dart']));
  assert.equal(report.methods[0]?.method, 'missing');
  assert.deepEqual(report.methods[0]?.handlers, []);
  assert.equal(report.issues[0]?.code, 'unhandled-invocation');
  assert.equal(report.summary.errors, 1);
});

test('삭제됐거나 관찰되지 않은 파일·심볼을 영향 없음으로 단정하지 않는다', () => {
  const selection = select(['ios/Deleted.swift'], ['Missing.handler']);
  const report = createBridgeImpact([dart, swift], selection);
  assert.equal(report.status, 'unobserved');
  assert.deepEqual(report.unmatchedSelectors, selection);
  assert.equal(report.complete, false);
  assert.equal(report.summary.unmatchedSelectors, 2);
});

test('미해석 동적·미귀속 사실도 선택 근거에 남는다', () => {
  const dynamic = document('swift', [
    { ...fact('method-handle', 'ios/Dynamic.swift', 3, 'name'), dynamic: true },
    { ...fact('method-handle', 'ios/Dynamic.swift', 8, 'read'), channel: null },
  ], ['unattributed-method-handles: 1']);
  const report = createBridgeImpact([dart, swift, dynamic], select(['ios/Dynamic.swift']));
  assert.equal(report.status, 'observed');
  assert.equal(report.summary.unresolvedSelectedFacts, 2);
  assert.equal(report.selectedFacts.length, 2);
  assert.ok(report.limitations.some(({ message }) => message.startsWith('unjoined-')));
  assert.deepEqual(report.methods, []);
});

test('입력 순서·중복 선택·중복 사실이 보고서 의미와 순서를 바꾸지 않는다', () => {
  const selection = select(['ios/Camera.swift', 'lib/photo.dart', 'ios/Camera.swift']);
  const report = createBridgeImpact([dart, swift], selection);
  const duplicated = { ...swift, facts: [...swift.facts].reverse().concat(swift.facts) };
  const reordered = createBridgeImpact([duplicated, dart], selection);
  assert.deepEqual(reordered.selectedFacts, report.selectedFacts);
  assert.deepEqual(reordered.methods, report.methods);
  assert.deepEqual(reordered.channels, report.channels);
  assert.equal(reordered.summary.selectedFacts, report.summary.selectedFacts);
  assert.equal(encodeBridgeImpact(report), encodeBridgeImpact(createBridgeImpact([swift, dart], selection)));
});

test('스코프 없는 입력 공백과 생산 시점·버전을 결과에서 잃지 않는다', () => {
  const gap = document('swift', [], ['opaque-handler-bodies: unknown scope']);
  const report = createBridgeImpact([dart, swift, gap], select(['lib/other.dart']));
  assert.equal(report.issues[0]?.code, 'unhandled-invocation-unverified');
  assert.equal(report.summary.warnings, 1);
  assert.equal(report.inputs.length, 3);
  assert.equal(report.inputs[0]?.generatedAt, '2026-09-14T00:00:00Z');
  assert.ok(report.relevantLimitations.length > 0);
});

test('다른 채널에만 귀속된 한계는 원문을 보존하면서 관련 한계와 구분한다', () => {
  const scoped = parseBridgeFactsDocument({ ...swift,
    limitations: ['opaque-handler-bodies: elsewhere'],
    limitationScopes: [{ limitationIndex: 0, channels: ['unrelated'] }],
  });
  const report = createBridgeImpact([dart, scoped], select(['lib/photo.dart']));
  assert.equal(report.limitations.length, 1);
  assert.deepEqual(report.relevantLimitations, []);
});

test('혼합 target이나 다른 project 입력으로 부분 정상 보고서를 만들지 않는다', () => {
  assert.throws(() => createBridgeImpact([dart, { ...swift, limitations: ['mixed-targets: flutter and RN'] }],
    select(['ios/Camera.swift'])), /mixed bridge targets/);
  assert.throws(() => createBridgeImpact([dart, { ...swift, project: '/different' }],
    select(['ios/Camera.swift'])), /same project/);
});

test('컴팩트 출력은 공백만 줄이고 근거와 한계는 같은 JSON으로 보존한다', () => {
  const report = createBridgeImpact([dart, swift], select(['ios/Camera.swift']));
  const compact = encodeBridgeImpact(report, true);
  assert.deepEqual(JSON.parse(compact), JSON.parse(encodeBridgeImpact(report)));
  assert.ok(compact.length < encodeBridgeImpact(report).length);
});

/** persistence 사실 하나다. 선언은 카탈로그라 위치 없이 심볼만 싣는다. */
const relation = (kind: 'relation-use' | 'relation-decl', channel: string, method?: string, path?: string, name?: string) => ({
  kind, channel, dynamic: false,
  ...(method === undefined ? {} : { method }),
  ...(path === undefined ? {} : { location: location(path, 1) }),
  ...(name === undefined ? {} : { symbol: { qualifiedName: name } }),
});
const persistence = (platform: string, facts: unknown[]) => parseBridgeFactsDocument({
  format: 'bridge-facts', version: 1, tool: { name: platform, version: '1.0.0' },
  generatedAt: '2026-09-14T00:00:00Z', project: '/project', platform, target: 'persistence',
  facts, limitations: [],
});
const repository = persistence('kotlin', [
  relation('relation-use', 'Users', undefined, 'src/Users.kt', 'Users.find'),
  relation('relation-use', 'users', 'nickname', 'src/Users.kt', 'Users.find'),
  relation('relation-use', 'users', 'email', 'src/Mail.kt', 'Mail.send'),
  relation('relation-use', 'orders', undefined, 'src/Orders.kt', 'Orders.list'),
  relation('relation-use', 'events', undefined, 'src/Events.kt', 'Events.list'),
]);
const catalog = persistence('sql', [
  relation('relation-decl', 'public.users', undefined, undefined, 'public.users'),
  relation('relation-decl', 'public.users', 'email', undefined, 'public.users.email'),
  relation('relation-decl', 'public.events', undefined, undefined, 'public.events'),
  relation('relation-decl', 'audit.events', undefined, undefined, 'audit.events'),
]);
const issueKeys = (report: ReturnType<typeof createBridgeImpact>) =>
  report.issues.map(({ code, channel, method }) => [code, channel, method ?? null]);

test('비한정·대소문자 변형 사용도 해석된 한정 선언의 컬럼 진단으로 귀속한다', () => {
  const report = createBridgeImpact([repository, catalog], select(['src/Users.kt']));
  // 'users'.nickname의 진단 채널은 선언 측 'public.users'다 — 원문 비교면 빠진다.
  assert.deepEqual(issueKeys(report), [['column-use-without-decl', 'public.users', 'nickname']]);
  assert.equal(report.summary.errors, 1);
  assert.equal(hasImpactBlockers(report), true);
  // bridge 확장 대상은 아니다.
  assert.deepEqual(report.channels, []);
  assert.deepEqual(report.methods, []);
});

test('관계만 고른 선택은 그 관계의 다른 컬럼 진단까지 넓히지 않는다', () => {
  const onlyRelation = persistence('kotlin', [relation('relation-use', 'USERS', undefined, 'src/Other.kt')]);
  const report = createBridgeImpact([repository, onlyRelation, catalog], select(['src/Other.kt']));
  assert.deepEqual(issueKeys(report), []);
  assert.equal(hasImpactBlockers(report), false);
  // 매치된 컬럼만 고르면 진단도 blocker도 없다.
  const matched = createBridgeImpact([repository, catalog], select(['src/Mail.kt']));
  assert.deepEqual(issueKeys(matched), []);
  assert.equal(hasImpactBlockers(matched), false);
});

test('모호한 비한정 사용과 미사용 선언 경고도 선택되면 --strict blocker다', () => {
  const ambiguous = createBridgeImpact([repository, catalog], select(['src/Events.kt']));
  assert.deepEqual(issueKeys(ambiguous), [['ambiguous-relation-use', 'events', null]]);
  assert.equal(ambiguous.summary.errors, 0);
  assert.equal(hasImpactBlockers(ambiguous), true);
  // 모호한 사용의 후보 선언을 고르면 그 모호성도 관련 진단이다.
  const candidate = createBridgeImpact([repository, catalog], select([], ['audit.events']));
  assert.deepEqual(issueKeys(candidate), [
    ['ambiguous-relation-use', 'events', null],
    ['relation-decl-without-use', 'audit.events', null],
  ]);
  assert.equal(hasImpactBlockers(candidate), true);
});

test('선언이 없는 관계 사용은 사용 측 이름 그대로 귀속하고 bridge 선택과 섞지 않는다', () => {
  const report = createBridgeImpact([dart, swift, repository, catalog], select(['src/Orders.kt', 'lib/photo.dart']));
  assert.deepEqual(issueKeys(report), [['relation-use-without-decl', 'orders', null]]);
  assert.deepEqual(report.methods.map(({ method }) => method), ['takePhoto']);
  // bridge만 고르면 persistence 진단은 싣지 않는다.
  const bridgeOnly = createBridgeImpact([dart, swift, repository, catalog], select(['lib/photo.dart']));
  assert.deepEqual(bridgeOnly.issues.filter(({ target }) => target === 'persistence'), []);
});
