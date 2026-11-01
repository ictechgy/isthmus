import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parsePreflightContext } from '../exchange/preflight-context.ts';
import { parseBridgeRuntime, parseRuntimeExpectations } from '../exchange/runtime.ts';
import { attachPreflightRuntime } from './preflight-runtime.ts';
import { createPreflightReport, type PreflightReport } from './preflight.ts';
import { createPreflightExplanation, createPreflightSummary } from './preflight-view.ts';

const raw = JSON.parse(await readFile(new URL('../../fixtures/preflight/context.json', import.meta.url), 'utf8'));
const context = parsePreflightContext(raw);
const report = createPreflightReport(context);

test('summary bounds a large affected forest and keeps full blocker counts', () => {
  const affected = Array.from({ length: 20_000 }, (_, index) => ({
    subject: { key: `symbol-${index}`, kind: 'symbol' as const, platform: 'dart' as const,
      symbol: { id: `dart:${index}`, qualifiedName: `Screen${index}.build` } },
    depth: index + 1, via: index === 0 ? report.roots[0]!.key : `symbol-${index - 1}`, relations: [],
  }));
  const large: PreflightReport = {
    ...report, affected,
    issues: [...report.issues, { code: 'unhandled-invocation', severity: 'error', target: 'flutter', channel: 'late', method: 'blocked', evidence: [] }],
    summary: { ...report.summary, errors: report.summary.errors + 1, affectedSymbols: 20_000 },
  };
  const view = createPreflightSummary(large, 20);
  assert.equal(view.affected.total, 20_000);
  assert.equal(view.affected.items.length, 20);
  assert.equal(view.affected.omitted, 19_980);
  assert.equal(view.requiresReview, true, 'a blocker outside the displayed slice still requires review');
  assert.ok(JSON.stringify(view).length < 100_000);
  assert.deepEqual(view.affected.items[0], { subject: affected[0]!.subject, depth: 1 });
  assert.equal(large.affected.length, 20_000);
});

test('summary keeps noChanges and bounded global previews', () => {
  const empty: PreflightReport = {
    ...report, status: 'noChanges', roots: [], affected: [], issues: [], limitations: [], bridgeLimitations: [],
    reviewFiles: [], producers: [], summary: { selectedSymbols: 0, affectedSymbols: 0, bridgeBoundaries: 0, reviewFiles: 0, errors: 0, warnings: 0, evidenceGaps: 0 },
  };
  const view = createPreflightSummary(empty, 1);
  assert.equal(view.status, 'noChanges');
  assert.equal(view.requiresReview, false);
  assert.deepEqual(view.roots, { total: 0, items: [], omitted: 0 });
  assert.deepEqual(view.reviewFiles, { total: 0, items: [], omitted: 0 });
});

test('runtime summary counts declared scenario/platform pairs and only nonpassed checks', () => {
  const checks = [
    { id: 'a', scenario: 'one', platform: 'macos', transport: 'method-channel', channel: 'camera', method: 'photo' },
    { id: 'b', scenario: 'one', platform: 'macos', transport: 'method-channel', channel: 'camera', method: 'other', instance: 'background' },
    { id: 'c', scenario: 'two', platform: 'ios', transport: 'method-channel', channel: 'camera', method: 'photo' },
    { id: 'd', scenario: 'two', platform: 'ios', transport: 'method-channel', channel: 'camera', method: 'other' },
  ];
  const expectations = parseRuntimeExpectations({ format: 'bridge-expectations', version: 1, project: context.project,
    revision: context.revision, checks });
  const runtime = parseBridgeRuntime({ format: 'bridge-runtime', version: 1, project: context.project, revision: context.revision,
    tool: { name: 'recorder', version: '1' }, run: { id: 'run', scenario: 'one', platform: 'macos', status: 'completed',
      startedAt: '2026-09-14T00:00:00Z', finishedAt: '2026-09-14T00:00:01Z' }, droppedEvents: 0,
    events: [{ sequence: 1, instance: 'main', transport: 'method-channel', channel: 'camera', method: 'photo', outcome: 'success' }] });
  const withRuntime = attachPreflightRuntime(context, report, expectations, [runtime]);
  const view = createPreflightSummary(withRuntime, 1);
  assert.equal(view.runtime?.verification.declaredScenarioPlatforms, 2);
  assert.equal(view.runtime?.verification.nonpassedChecks.total, 3);
  assert.equal(view.runtime?.verification.nonpassedChecks.items.length, 1);
  assert.equal(view.runtime?.verification.nonpassedChecks.omitted, 2);
  assert.equal(view.runtime?.verification.nonpassedChecks.items[0]?.status, 'unobserved');
  assert.equal(view.runtime?.verification.nonpassedChecks.items[0]?.instance, 'background');
  assert.equal(view.runtime?.routes.items[0]?.instance, 'main');
  const candidate = view.runtime?.candidates.items[0];
  assert.equal(view.runtime?.routes.items[0]?.candidateKey, candidate?.key);
  assert.equal(candidate?.handlers.items[0]?.location?.path, 'ios/Handler.swift');
  const expanded = createPreflightSummary({ ...withRuntime, runtime: { ...withRuntime.runtime!,
    candidates: [{ ...withRuntime.runtime!.candidates[0]!,
      handlers: Array(20).fill(withRuntime.runtime!.candidates[0]!.handlers[0]!), handlersOmitted: 7 }] } }, 2);
  assert.equal(expanded.runtime?.candidates.items[0]?.handlers.total, 27);
  assert.equal(expanded.runtime?.candidates.items[0]?.handlers.items.length, 2);
  assert.equal(expanded.runtime?.candidates.items[0]?.handlers.omitted, 25);
});

test('explanation resolves exact identities and reconstructs the ordered path', () => {
  const target = report.affected.find(({ subject }) => subject.kind === 'symbol' && subject.symbol.id === 'dart:screen');
  assert.ok(target);
  const explanation = createPreflightExplanation(report, 'dart:screen');
  assert.equal(explanation.status, 'found');
  assert.equal(explanation.result?.subject.key, target.subject.key);
  const path = explanation.result?.path ?? [];
  assert.equal(path[0]?.depth, 0);
  assert.equal(path.at(-1)?.subject.key, target.subject.key);
  assert.equal(path.at(-1)?.relations.total, 1);
  assert.equal(path.at(-1)?.relations.items[0]?.kind, 'language');
  assert.deepEqual(createPreflightExplanation(report, 'Screen.capture').status, 'found');
  assert.deepEqual(createPreflightExplanation(report, 'Screen').status, 'notFound', 'selectors are never fuzzy');
});

test('explanation retains every hop in a path longer than the preview limit', () => {
  const affected = Array.from({ length: 24 }, (_, index) => ({
    subject: { key: `long-${index}`, kind: 'symbol' as const, platform: 'dart' as const,
      symbol: { id: `long:${index}`, qualifiedName: `LongPath${index}` } },
    depth: index + 1, via: index === 0 ? report.roots[0]!.key : `long-${index - 1}`, relations: [],
  }));
  const long = { ...report, affected };
  const explanation = createPreflightExplanation(long, 'long:23');
  assert.equal(explanation.status, 'found');
  assert.equal(explanation.result?.path.length, 25);
  assert.equal(explanation.result?.path.at(-1)?.subject.key, 'long-23');
});

test('explanation reports unknown and ambiguous identities with bounded candidates', () => {
  const ambiguous: PreflightReport = { ...report, affected: [
    ...report.affected,
    { subject: { key: 'swift-duplicate', kind: 'symbol', platform: 'swift', symbol: { id: 's:duplicate', qualifiedName: 'Shared.Name' } }, depth: 1, via: report.roots[0]!.key, relations: [] },
    { subject: { key: 'dart-duplicate', kind: 'symbol', platform: 'dart', symbol: { id: 'd:duplicate', qualifiedName: 'Shared.Name' } }, depth: 1, via: report.roots[0]!.key, relations: [] },
  ] };
  const unknown = createPreflightExplanation(ambiguous, 'missing-identity');
  assert.equal(unknown.status, 'notFound');
  const many = createPreflightExplanation(ambiguous, 'Shared.Name');
  assert.equal(many.status, 'ambiguous');
  assert.equal(many.candidates?.total, 2);
  assert.equal(many.candidates?.items.length, 2);
});

test('mechanism 불일치 이슈는 수신 증거가 있으면 불일치 문구로 표시한다', () => {
  const endpoint = (platform: 'js' | 'swift', mechanism?: 'expo') => ({
    platform,
    location: { path: 'src/x.ts', line: 1, column: 1 },
    ...(mechanism === undefined ? {} : { mechanism }),
  });
  const withIssues: PreflightReport = {
    ...report,
    issues: [
      // Expo require가 코어 export만 관찰한 확정 error — 증거에 수신 측이
      // 실렸으므로 "없다"가 아니라 "다른 경로로 해석된다"가 맞다.
      { code: 'component-require-without-export', severity: 'error',
        target: 'react-native', channel: 'ExpoOnly',
        evidence: [endpoint('js', 'expo'), endpoint('swift')] },
      // 같은 코드라도 수신 증거가 없으면 진짜 미관찰이다.
      { code: 'component-require-without-export', severity: 'error',
        target: 'react-native', channel: 'Absent',
        evidence: [endpoint('js', 'expo')] },
      { code: 'module-export-mechanism-mismatch', severity: 'warning',
        target: 'react-native', channel: 'Cam',
        evidence: [endpoint('swift'), endpoint('js')] },
    ],
  };
  const view = createPreflightSummary(withIssues, 10);
  const byChannel = new Map(
    view.issues.items.map((item) => [item.channel, item.message]));

  assert.equal(byChannel.get('ExpoOnly'),
    'Observed component exports for ExpoOnly resolve through a different bridge mechanism.');
  assert.equal(byChannel.get('Absent'),
    'No native component export was verified for Absent.');
  assert.equal(byChannel.get('Cam'),
    'Observed module imports for Cam resolve through a different bridge mechanism.');
});

test('플랫폼별 핸들러 누락 이슈는 빠진 수신 플랫폼을 문구에 밝힌다', () => {
  const withIssues: PreflightReport = {
    ...report,
    issues: [
      { code: 'invocation-unhandled-on-platform', severity: 'warning', target: 'flutter',
        channel: 'camera', method: 'photo', platform: 'kotlin', evidence: [] },
      { code: 'invocation-unhandled-on-platform-unverified', severity: 'warning', target: 'flutter',
        channel: 'camera', method: 'video', platform: 'swift', evidence: [] },
    ],
  };

  const view = createPreflightSummary(withIssues, 10);

  assert.deepEqual(view.issues.items.map(({ method, message }) => [method, message]), [
    ['photo', 'No kotlin native handler was verified for camera.photo; another receiver platform handles it.'],
    ['video', 'No swift native handler was verified for camera.video; another receiver platform handles it.'],
  ]);
  // platform이 없는 이슈(손으로 만든 보고서)에도 "undefined"를 문구에 넣지 않는다.
  const withoutPlatform = createPreflightSummary({ ...withIssues, issues: [
    { code: 'invocation-unhandled-on-platform', severity: 'warning', target: 'flutter', channel: 'camera', method: 'photo', evidence: [] },
  ] }, 10);
  assert.equal(withoutPlatform.issues.items[0]?.message,
    'No native handler was verified on one receiver platform for camera.photo; another receiver platform handles it.');
});

test('MethodChannel·RN 이름 경계 이슈 코드는 원인별 미리보기 문구와 결정적 순서를 갖는다', () => {
  const issue = (code: PreflightReport['issues'][number]['code'], channel: string, method?: string,
    severity: 'error' | 'warning' = 'warning') => ({
    code, severity, target: 'react-native' as const, channel, ...(method === undefined ? {} : { method }), evidence: [],
  });
  const withIssues: PreflightReport = {
    ...report,
    // 입력 순서를 일부러 뒤섞는다. 미리보기는 code·channel·method·severity 순으로 고정된다.
    issues: [
      issue('module-import-without-export', 'Cam', undefined, 'error'),
      issue('component-export-mechanism-mismatch', 'View'),
      issue('handler-without-invocation', 'camera', 'zoom'),
      issue('handler-without-invocation', 'camera', 'focus'),
      issue('component-export-without-require', 'View'),
      issue('module-export-without-import', 'Cam'),
      issue('component-require-mechanism-mismatch', 'View'),
      issue('module-import-mechanism-mismatch', 'Cam'),
      issue('module-import-without-export-optional', 'Cam'),
      issue('module-import-without-export-unverified', 'Cam'),
      issue('registration-without-creation', 'camera'),
      issue('unregistered-channel-creation-unverified', 'camera'),
      issue('unregistered-channel-creation', 'camera', undefined, 'error'),
      issue('unhandled-invocation', 'camera', 'photo', 'error'),
      issue('unhandled-invocation', 'camera', 'photo', 'warning'),
      issue('unhandled-invocation-unverified', 'camera', 'photo'),
    ],
  };

  const view = createPreflightSummary(withIssues, 100);

  assert.equal(view.issues.total, 16);
  assert.deepEqual(view.issues.items.map(({ code, severity, message }) => [code, severity, message]), [
    ['component-export-mechanism-mismatch', 'warning', 'Observed component requires for View resolve through a different bridge mechanism.'],
    ['component-export-without-require', 'warning', 'Native component export has no verified require for View.'],
    ['component-require-mechanism-mismatch', 'warning', 'Observed component exports for View resolve through a different bridge mechanism.'],
    ['handler-without-invocation', 'warning', 'Native handler has no verified invocation for camera.focus.'],
    ['handler-without-invocation', 'warning', 'Native handler has no verified invocation for camera.zoom.'],
    ['module-export-without-import', 'warning', 'Native module export has no verified import for Cam.'],
    ['module-import-mechanism-mismatch', 'warning', 'Observed module exports for Cam resolve through a different bridge mechanism.'],
    ['module-import-without-export', 'error', 'No native module export was verified for Cam.'],
    ['module-import-without-export-optional', 'warning', 'No native module export was verified for Cam, but every caller tolerates absence.'],
    ['module-import-without-export-unverified', 'warning', 'No native module export was verified for Cam.'],
    ['registration-without-creation', 'warning', 'Native registration has no verified channel creation for camera.'],
    // 같은 code·channel·method는 severity 문자열 순(error가 먼저)이다.
    ['unhandled-invocation', 'error', 'No native handler was verified for camera.photo.'],
    ['unhandled-invocation', 'warning', 'No native handler was verified for camera.photo.'],
    ['unhandled-invocation-unverified', 'warning', 'No native handler was verified for camera.photo.'],
    ['unregistered-channel-creation', 'error', 'No native registration was verified for camera.'],
    ['unregistered-channel-creation-unverified', 'warning', 'No native registration was verified for camera.'],
  ]);
  // method가 없는 이슈는 미리보기에도 method 키가 없다.
  assert.equal(Object.hasOwn(view.issues.items[0]!, 'method'), false);
  assert.equal(view.issues.items[3]?.method, 'focus');
});

test('한계 목록은 정렬·제한하고 bridge 한계의 채널 범위도 같은 상한으로 자른다', () => {
  const bridgeLimitation = (platform: 'swift' | 'kotlin' | 'dart', target: 'flutter' | null, tool: string, message: string,
    channels?: readonly string[]) => ({ platform, target, tool, message, ...(channels === undefined ? {} : { channels }) });
  const withLimitations: PreflightReport = {
    ...report,
    limitations: [
      { code: 'producer-gap', message: 'b', analysis: 'swift' },
      { code: 'capture-limitation', message: 'z' },
      { code: 'producer-gap', message: 'a', analysis: 'swift' },
      { code: 'producer-gap', message: 'c', analysis: 'dart' },
    ],
    bridgeLimitations: [
      bridgeLimitation('swift', 'flutter', 'cartograph', 'opaque-handler-bodies: 2', ['ch/c', 'ch/a', 'ch/b']),
      bridgeLimitation('swift', null, 'cartograph', 'objective-c-sources: 1'),
      bridgeLimitation('kotlin', 'flutter', 'kartograph', 'dynamic-methods: 1'),
      bridgeLimitation('swift', 'flutter', 'cartograph', 'dynamic-channels: 1'),
      bridgeLimitation('swift', 'flutter', 'isthmus', 'unjoined-dynamic-methods: 1'),
    ],
    messageLimitations: [
      bridgeLimitation('swift', 'flutter', 'cartograph', 'unattributed-message-handles: 1'),
      bridgeLimitation('dart', 'flutter', 'dartograph', 'dynamic-message-channels: 1'),
    ],
  };

  const view = createPreflightSummary(withLimitations, 2);

  // code, analysis(없으면 빈 문자열), message 순이다.
  assert.deepEqual(view.limitations, { total: 4, omitted: 2, items: [
    { code: 'capture-limitation', message: 'z' },
    { code: 'producer-gap', message: 'c', analysis: 'dart' },
  ] });
  assert.deepEqual(createPreflightSummary(withLimitations, 4).limitations.items.slice(2), [
    { code: 'producer-gap', message: 'a', analysis: 'swift' },
    { code: 'producer-gap', message: 'b', analysis: 'swift' },
  ]);
  // platform, target(null은 빈 문자열로 먼저), tool, message 순이며 채널 범위도 상한 2로 자른다.
  const bridge = createPreflightSummary(withLimitations, 5).bridgeLimitations;
  assert.deepEqual(bridge.items.map(({ platform, target, tool, message }) => [platform, target, tool, message]), [
    ['kotlin', 'flutter', 'kartograph', 'dynamic-methods: 1'],
    ['swift', null, 'cartograph', 'objective-c-sources: 1'],
    ['swift', 'flutter', 'cartograph', 'dynamic-channels: 1'],
    ['swift', 'flutter', 'cartograph', 'opaque-handler-bodies: 2'],
    ['swift', 'flutter', 'isthmus', 'unjoined-dynamic-methods: 1'],
  ]);
  assert.equal(Object.hasOwn(bridge.items[0]!, 'channels'), false);
  assert.deepEqual(view.bridgeLimitations.total, 5);
  assert.deepEqual(createPreflightSummary(withLimitations, 2).bridgeLimitations.items.length, 2);
  const scoped = createPreflightSummary({ ...withLimitations, bridgeLimitations: [withLimitations.bridgeLimitations[0]!] }, 2);
  assert.deepEqual(scoped.bridgeLimitations.items[0]?.channels, { total: 3, items: ['ch/a', 'ch/b'], omitted: 1 });
  assert.deepEqual(view.messageLimitations?.items.map(({ platform, message }) => [platform, message]), [
    ['dart', 'dynamic-message-channels: 1'],
    ['swift', 'unattributed-message-handles: 1'],
  ]);
});

test('runtime 경로 미리보기는 run·channel·method·instance 순으로 정렬한다', () => {
  const expectations = parseRuntimeExpectations({ format: 'bridge-expectations', version: 1, project: context.project,
    revision: context.revision, checks: [
      { id: 'a', scenario: 'one', platform: 'macos', transport: 'method-channel', channel: 'camera', method: 'photo' },
    ] });
  const runtime = parseBridgeRuntime({ format: 'bridge-runtime', version: 1, project: context.project, revision: context.revision,
    tool: { name: 'recorder', version: '1' }, run: { id: 'run', scenario: 'one', platform: 'macos', status: 'completed',
      startedAt: '2026-09-14T00:00:00Z', finishedAt: '2026-09-14T00:00:01Z' }, droppedEvents: 0,
    events: [{ sequence: 1, instance: 'main', transport: 'method-channel', channel: 'camera', method: 'photo', outcome: 'success' }] });
  const withRuntime = attachPreflightRuntime(context, report, expectations, [runtime]);
  const route = withRuntime.runtime!.routes[0]!;
  const { method: _method, ...withoutMethod } = route;
  const routes = [
    { ...route, runId: 'run-b' },
    { ...route, runId: 'run-a', channel: 'zoom' },
    { ...route, runId: 'run-a', instance: 'secondary' },
    { ...withoutMethod, runId: 'run-a' },
    { ...route, runId: 'run-a' },
  ];

  const view = createPreflightSummary({ ...withRuntime, runtime: { ...withRuntime.runtime!, routes } }, 10);

  assert.deepEqual(view.runtime?.routes.items.map(({ runId, channel, method, instance }) => [runId, channel, method, instance]), [
    ['run-a', 'camera', undefined, 'main'],
    ['run-a', 'camera', 'photo', 'main'],
    ['run-a', 'camera', 'photo', 'secondary'],
    ['run-a', 'zoom', 'photo', 'main'],
    ['run-b', 'camera', 'photo', 'main'],
  ]);
  assert.equal(Object.hasOwn(view.runtime!.routes.items[0]!, 'method'), false);
});

test('invalid limits and broken or cyclic paths fail with PreflightGraphError', () => {
  assert.throws(() => createPreflightSummary(report, 0), RangeError);
  assert.throws(() => createPreflightSummary(report, 101), RangeError);
  const broken: PreflightReport = { ...report, affected: [{ ...report.affected[0]!, via: 'missing-node' }] };
  assert.throws(() => createPreflightExplanation(broken, broken.affected[0]!.subject.key), /unknown path node/);
  const cyclic: PreflightReport = { ...report, affected: [
    { ...report.affected[0]!, via: report.affected[0]!.subject.key },
  ] };
  assert.throws(() => createPreflightExplanation(cyclic, cyclic.affected[0]!.subject.key), /cyclic path/);
});
