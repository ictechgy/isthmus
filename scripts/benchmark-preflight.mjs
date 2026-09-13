import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { runChild } from './run-child.mjs';

// 실제 CLI의 시작·읽기·파싱·조인/대조·직렬화까지 측정한다. producer/앱 빌드는 별도다.
const binary = fileURLToPath(new URL('../dist/cli/main.js', import.meta.url));
const root = await mkdtemp(join(tmpdir(), 'isthmus-preflight-benchmark-'));
const channels = 10_000;
const eventCount = 100_000;
const checks = 1_000;
const consumers = 20_000;
const repetitions = 5;
const timeBudgetMs = 5_000;
try {
  const dart = bridgeDocument('dart');
  const swift = bridgeDocument('swift');
  const runtime = runtimeDocument();
  const expectations = { format: 'bridge-expectations', version: 1, project: '/benchmark', revision: 'benchmark',
    checks: Array.from({ length: checks }, (_, index) => ({ id: `check-${index}`, scenario: 'read',
      platform: 'ios', transport: 'method-channel', channel: 'runtime/channel', method: 'read' })) };
  const preflight = JSON.parse(await readFile(new URL('../fixtures/preflight/context.json', import.meta.url), 'utf8'));
  // fixture는 합성 자료다. 벤치마크 문서 모두의 합성 project/revision을 동일하게 생성한다.
  preflight.project = '/benchmark'; preflight.revision = 'benchmark';
  for (const document of preflight.bridges) document.project = preflight.project;
  preflight.analyses[1].affected = Array.from({ length: consumers }, (_, index) => ({
    symbol: { id: `dart:consumer:${index}`, qualifiedName: `Consumer${index}.read`,
      location: { path: `lib/consumer${index}.dart`, line: 1, column: 1 } },
    via: 'dart:photo', depth: 1, relationships: ['call'],
  }));
  const preflightRuntime = runtimeDocument('camera', 'photo');
  const preflightExpectations = { ...expectations,
    checks: expectations.checks.map((check) => ({ ...check, channel: 'camera', method: 'photo' })) };
  const inputs = { dart, swift, runtime, expectations, preflight, preflightRuntime, preflightExpectations };
  for (const [name, value] of Object.entries(inputs)) {
    await writeFile(join(root, `${name}.json`), JSON.stringify(value), { mode: 0o600 });
  }
  const impact = measure(['impact', '--file', 'ios/Handlers.swift', join(root, 'dart.json'),
    join(root, 'swift.json'), '--compact'], (report) => {
    assert.equal(report.summary.observedFacts, 40_000);
    assert.equal(report.summary.affectedMethods, channels);
    assert.equal(report.summary.selectedFacts, 20_000);
    assert.equal(report.relevantLimitations.length, 0);
  });
  const runtimeResult = measure(['verify-runtime', '--expectations', join(root, 'expectations.json'),
    join(root, 'runtime.json'), '--strict', '--compact'], (report) => {
    assert.equal(report.status, 'passed');
    assert.equal(report.summary.passedChecks, checks);
    assert.equal(report.checks[0].observedCalls, eventCount);
    assert.equal(report.checks[0].evidenceOmitted, eventCount - 20);
  });
  const preflightResult = measure(['preflight', join(root, 'preflight.json'), join(root, 'preflightRuntime.json'),
    '--expectations', join(root, 'preflightExpectations.json'), '--strict', '--compact'], (report) => {
    assert.equal(report.summary.affectedSymbols, consumers + 2);
    assert.equal(report.summary.evidenceGaps, 0);
    assert.equal(report.runtime.verification.status, 'passed');
    assert.equal(report.runtime.verification.summary.passedChecks, checks);
    assert.equal(report.runtime.routes[0].observedCalls, eventCount);
    assert.equal(report.runtime.unobservedBoundaries.length, 0);
  });
  process.stdout.write(`${JSON.stringify({
    scope: 'consumer-cli-only', node: process.version, platform: process.platform, arch: process.arch,
    repetitions, timeBudgetMs,
    impact: { facts: 40_000, channels, scopedLimitations: 1_000, ...impact },
    runtime: { events: eventCount, expectations: checks, ...runtimeResult },
    preflightWithRuntime: { consumers, events: eventCount, expectations: checks, ...preflightResult },
  }, null, 2)}\n`);
  assert.ok(impact.p95Ms < timeBudgetMs && runtimeResult.p95Ms < timeBudgetMs && preflightResult.p95Ms < timeBudgetMs,
    'Consumer preflight exceeded the documented time budget.');
} finally {
  await rm(root, { recursive: true, force: true });
}

/** 명령마다 새 프로세스를 사용하고 매번 독립적인 집계를 확인한다. */
function measure(args, verify) {
  const times = [];
  let outputBytes = 0;
  for (let iteration = 0; iteration < repetitions; iteration++) {
    const started = performance.now();
    const result = runChild(process.execPath, [binary, ...args], {
      timeout: 30_000, maxBuffer: 32 * 1024 * 1024,
    });
    times.push(performance.now() - started);
    assert.equal(result.status, 0, 'Benchmark command must succeed.');
    verify(JSON.parse(result.stdout));
    outputBytes = Buffer.byteLength(result.stdout);
  }
  times.sort((a, b) => a - b);
  return { medianMs: Math.round(times[2]), p95Ms: Math.round(times[4]),
    samplesMs: times.map(Math.round), outputBytes };
}

/** 채널 배선 전체 변경과 무관한 분석 한계가 함께 있는 독립 입력이다. */
function bridgeDocument(platform) {
  const facts = [];
  for (let index = 0; index < channels; index++) {
    const common = { channel: `channel/${index}`, dynamic: false,
      location: { path: platform === 'dart' ? 'lib/calls.dart' : 'ios/Handlers.swift', line: index + 1, column: 1 } };
    facts.push({ ...common, kind: platform === 'dart' ? 'channel-create' : 'channel-register' });
    facts.push({ ...common, kind: platform === 'dart' ? 'method-invoke' : 'method-handle', method: 'read' });
  }
  return { format: 'bridge-facts', version: 1, platform, target: 'flutter', project: '/benchmark',
    tool: { name: platform, version: '1' }, generatedAt: '2026-09-14T00:00:00Z', facts,
    limitations: platform === 'swift'
      ? Array.from({ length: 1000 }, (_, index) => `opaque-handler-bodies: unrelated ${index}`) : [],
    limitationScopes: platform === 'swift'
      ? Array.from({ length: 1000 }, (_, index) => ({ limitationIndex: index, channels: [`other/${index}`] })) : [],
  };
}

/** 같은 라우팅의 반복 기대가 이벤트 전체 재순회를 일으키는지도 측정한다. */
function runtimeDocument(channel = 'runtime/channel', method = 'read') {
  return { format: 'bridge-runtime', version: 1, project: '/benchmark', revision: 'benchmark',
    tool: { name: 'synthetic-benchmark', version: '1' },
    run: { id: 'benchmark-run', scenario: 'read', platform: 'ios', status: 'completed',
      startedAt: '2026-09-14T00:00:00Z', finishedAt: '2026-09-14T00:00:01Z' },
    droppedEvents: 0,
    events: Array.from({ length: eventCount }, (_, index) => ({ sequence: index + 1, instance: 'main',
      transport: 'method-channel', channel, method, outcome: 'success' })),
  };
}
