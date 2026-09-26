import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runChild } from './run-child.mjs';

const binaryPath = fileURLToPath(new URL('../dist/cli/main.js', import.meta.url));
const dartPath = fileURLToPath(
  new URL('../experiments/phase-0/expected/dart.json', import.meta.url),
);
const swiftPath = fileURLToPath(
  new URL('../experiments/phase-0/expected/swift.json', import.meta.url),
);
const packageDocument = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);

verifyUsageError();
verifyHelp();
verifyVersion();
verifyInputError();
verifyCompositionError();
verifySuccessfulCheck();
verifyStrictFindings();
verifyMessageCheck();
verifyBaselineRoundtrip();
verifyRetentions();
verifyQuery();
verifyMissingQuery();
verifyPersistencePairs();
verifyRelationQuery();
verifyRelationPrefixedBridgeQuery();
verifyGraph();
verifyDiff();
verifyImpact();
verifyRuntime();
verifyPreflight();
verifyServe();
verifyExtractJs();
verifyDoctorInit();
verifyMessageViews();
verifyReactNativeEvents();
process.stdout.write('CLI contract verified: 0/1/2/64\n');

/** 합성 언어 영향 입력이 빌드된 CLI에서 브리지 너머 화면까지 연결되는지 확인한다. */
function verifyPreflight() {
  const fixture = fileURLToPath(new URL('../fixtures/preflight/context.json', import.meta.url));
  const args = ['preflight', fixture, '--strict', '--compact'];
  const result = run(args);
  verify(result.status === 0, 'preflight observed exit code');
  const report = JSON.parse(result.stdout);
  verify(report.format === 'isthmus-preflight' && report.reviewFiles.includes('lib/screen.dart'), 'preflight transitive consumer');
  verify(report.complete === false, 'preflight scope');
  const summary = run(['preflight', fixture, '--summary', '--limit', '1', '--compact']);
  const summaryDocument = JSON.parse(summary.stdout);
  verify(summary.status === 0 && summaryDocument.format === 'isthmus-preflight-summary', 'preflight bounded summary');
  verify(summaryDocument.affected.items.length <= 1 && summaryDocument.affected.omitted >= 0, 'preflight summary limit');
  const explanation = run(['preflight', fixture, '--explain', 'dart:screen', '--compact']);
  verify(explanation.status === 0 && JSON.parse(explanation.stdout).status === 'found', 'preflight explanation');
  const missingExplanation = run(['preflight', fixture, '--explain', 'missing-subject', '--compact']);
  verify(missingExplanation.status === 64 && JSON.parse(missingExplanation.stdout).status === 'notFound', 'preflight missing explanation');
  verify(run(['preflight', fixture, '--summary', '--explain', 'dart:screen']).status === 64, 'preflight view exclusivity');
  verify(run(['preflight', fixture, '--limit', '1']).status === 64, 'preflight limit scope');
  verify(run([...args, '--revision', 'other']).status === 1, 'preflight stale context');
  verify(run(['preflight', dartPath]).status === 2, 'preflight invalid context');
  verify(run(['preflight']).status === 64, 'preflight usage');
  verify(run(['help', 'preflight']).stdout.startsWith('Usage: isthmus preflight'), 'preflight help');
  const runtime = fileURLToPath(new URL('../fixtures/preflight/runtime.json', import.meta.url));
  const expectations = fileURLToPath(new URL('../fixtures/preflight/expectations.json', import.meta.url));
  const verified = run([...args, runtime, '--expectations', expectations]);
  verify(verified.status === 0, 'preflight runtime success');
  verify(JSON.parse(verified.stdout).runtime.aligned === true && JSON.parse(verified.stdout).runtime.verification.status === 'passed',
    'preflight runtime alignment');
  verify(run([...args, '--expectations', expectations]).status === 1, 'preflight absent runtime observations');
}

/** 빌드 산출물의 변경 사전 점검이 증거·공백·종료 코드를 보존하는지 확인한다. */
function verifyImpact() {
  const args = ['impact', '--file', 'ios/Runner/CameraPlugin.swift', dartPath, swiftPath];
  const result = run([...args, '--compact']);
  verify(result.status === 0, 'impact exit code');
  const report = JSON.parse(result.stdout);
  verify(report.format === 'isthmus-impact' && report.status === 'observed', 'impact document');
  verify(report.methods.some(({ method }) => method === 'takePhoto'), 'impact caller evidence');
  verify(report.reviewFiles.includes('lib/camera_bridge.dart'), 'impact review files');
  verify(report.complete === false && report.limitations.length > 0, 'impact limitations');
  verify(run([...args, '--strict']).status === 1, 'impact strict gaps');
  verify(run(['impact', '--file', 'deleted.dart', dartPath, swiftPath, '--strict']).status === 1,
    'impact unobserved selection');
  verify(run(['help', 'impact']).stdout.startsWith('Usage: isthmus impact'), 'impact help');
}

/** 합성 런타임 기록으로 빌드된 소비자의 성공·실패·문서 범위를 검증한다. */
function verifyRuntime() {
  const fixture = (name) => fileURLToPath(new URL(`../fixtures/runtime/${name}.json`, import.meta.url));
  const args = ['verify-runtime', '--expectations', fixture('expectations'), '--strict', '--compact'];
  const success = run([...args, fixture('success')]);
  verify(success.status === 0, 'runtime success exit code');
  const report = JSON.parse(success.stdout);
  verify(report.status === 'passed' && report.scope === 'declared-scenarios' && report.complete === false,
    'runtime scoped result');
  const failure = run([...args, fixture('success'), fixture('missing-handler')]);
  verify(failure.status === 1 && JSON.parse(failure.stdout).summary.failedCalls === 1,
    'runtime observed failure');
}

/** 인자 없는 호출이 사용 오류 64인지 검증한다. */
function verifyUsageError() {
  const result = run([]);
  verify(result.status === 64, 'usage exit code');
  verify(result.stdout === '', 'usage stdout');
  verify(result.stderr.startsWith('Usage: isthmus <command>'), 'usage stderr');
}

/** 루트 도움말이 성공으로 출력되는지 검증한다. */
function verifyHelp() {
  const result = run(['--help']);
  verify(result.status === 0, 'help exit code');
  verify(result.stderr === '', 'help stderr');
  verify(result.stdout.includes('retentions'), 'help stdout');
}

/** package metadata의 버전이 성공으로 출력되는지 검증한다. */
function verifyVersion() {
  const result = run(['--version']);
  verify(result.status === 0, 'version exit code');
  verify(result.stderr === '', 'version stderr');
  verify(result.stdout === `${packageDocument.version}\n`, 'version stdout');
}

/** 읽을 수 없는 입력이 원인별 메시지와 도구 실패 2인지 검증한다. */
function verifyInputError() {
  const result = run(['check', 'missing-dart.json', swiftPath]);
  verify(result.status === 2, 'input exit code');
  verify(result.stdout === '', 'input stdout');
  verify(
    result.stderr.startsWith('Unable to read bridge facts input 1'),
    'input stderr',
  );
}

/** 호출 측 문서만 있는 입력이 조인 거부 2인지 검증한다. */
function verifyCompositionError() {
  const result = run(['check', dartPath, dartPath]);
  verify(result.status === 2, 'composition exit code');
  verify(result.stdout === '', 'composition stdout');
  verify(
    result.stderr.startsWith('Bridge documents must include'),
    'composition stderr',
  );
}

/** 기본 check가 보고서와 성공 0을 내는지 검증한다. */
function verifySuccessfulCheck() {
  const result = run(['check', dartPath, swiftPath]);
  verify(result.status === 0, 'success exit code');
  verify(result.stderr === '', 'success stderr');
  verify(JSON.parse(result.stdout).format === 'isthmus-check', 'success JSON');
}

/** strict check가 같은 보고서와 발견 1을 내는지 검증한다. */
function verifyStrictFindings() {
  const result = run(['check', dartPath, swiftPath, '--strict']);
  verify(result.status === 1, 'strict exit code');
  verify(result.stderr === '', 'strict stderr');
  verify(JSON.parse(result.stdout).summary.errors === 1, 'strict JSON');
}

/** check가 실빌드에서 bridge-facts v2를 transport 진단으로 소비하는지 검증한다. */
function verifyMessageCheck() {
  const directory = mkdtempSync(join(tmpdir(), 'isthmus-cli-messages-'));
  try {
    const message = (platform, facts) => JSON.stringify({
      format: 'bridge-facts', version: 2, transport: 'basic-message-channel',
      platform, target: facts.length > 0 ? 'flutter' : null, project: '/app',
      generatedAt: '2026-09-18T00:00:00Z',
      tool: { name: platform === 'dart' ? 'dartograph' : 'cartograph', version: 'test' },
      facts, limitations: [],
    });
    const messageDart = join(directory, 'dart.json');
    const messageSwift = join(directory, 'swift.json');
    writeFileSync(messageDart, message('dart', [{
      kind: 'message-send', channel: 'example/basic', dynamic: false,
      location: { path: 'lib/api.dart', line: 10, column: 1 },
    }]));
    writeFileSync(messageSwift, message('swift', []));

    const missing = run(['check', messageDart, messageSwift, '--strict']);
    verify(missing.status === 1, 'message strict exit code');
    verify(JSON.parse(missing.stdout).issues[0].code === 'unhandled-message-send',
      'message diagnostic code');

    writeFileSync(messageSwift, message('swift', [{
      kind: 'message-handle', channel: 'example/basic', dynamic: false,
      location: { path: 'macos/Setup.swift', line: 5, column: 1 },
    }]));
    const matched = run(['check', messageDart, messageSwift]);
    verify(matched.status === 0 && JSON.parse(matched.stdout).summary.matchedMessages === 1,
      'message matched summary');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** 베이스라인 기록과 재입력이 발행 CLI에서도 종료 코드 계약을 지키는지 검증한다. */
function verifyBaselineRoundtrip() {
  const directory = mkdtempSync(join(tmpdir(), 'isthmus-cli-contract-'));
  try {
    const baselinePath = join(directory, 'baseline.json');
    const update = run([
      'check', dartPath, swiftPath, '--update-baseline', baselinePath,
    ]);
    verify(update.status === 0, 'baseline update exit code');
    verify(update.stderr === '', 'baseline update stderr');
    verify(
      JSON.parse(update.stdout).summary.errors === 1,
      'baseline update reports unsuppressed findings',
    );
    const document = JSON.parse(readFileSync(baselinePath, 'utf8'));
    verify(document.format === 'isthmus-baseline', 'baseline format');
    verify(document.version === 1, 'baseline version');
    verify(document.entries.length === 3, 'baseline entries');

    const applied = run([
      'check', dartPath, swiftPath, '--strict', '--baseline', baselinePath,
    ]);
    verify(applied.status === 0, 'baseline strict exit code');
    const summary = JSON.parse(applied.stdout).summary;
    verify(
      summary.errors === 0 && summary.suppressed === 3,
      'baseline suppressed summary',
    );
    verify(summary.staleBaselineEntries === 0, 'baseline stale count');

    writeFileSync(baselinePath, '{invalid');
    const invalid = run(['check', dartPath, swiftPath, '--baseline', baselinePath]);
    verify(invalid.status === 2, 'baseline invalid exit code');
    verify(invalid.stdout === '', 'baseline invalid stdout');
    verify(
      invalid.stderr.startsWith('The baseline file is not valid JSON'),
      'baseline invalid stderr',
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** retentions가 cartograph용 보존 문서를 내는지 검증한다. */
function verifyRetentions() {
  const result = run([
    'retentions',
    dartPath,
    swiftPath,
    '--for',
    'cartograph',
  ]);
  verify(result.status === 0, 'retentions exit code');
  verify(result.stderr === '', 'retentions stderr');
  const document = JSON.parse(result.stdout);
  verify(document.format === 'external-retentions', 'retentions JSON');
  verify(document.retentions.length === 1, 'retentions count');
}

/** query가 찾은 bridge subject를 JSON으로 내는지 검증한다. */
function verifyQuery() {
  const result = run(['query', 'takePhoto', dartPath, swiftPath]);
  verify(result.status === 0, 'query exit code');
  verify(result.stderr === '', 'query stderr');
  verify(JSON.parse(result.stdout).status === 'found', 'query JSON');
}

/** 없는 query subject가 notFound JSON과 64를 내는지 검증한다. */
function verifyMissingQuery() {
  const result = run(['query', 'missingMethod', dartPath, swiftPath]);
  verify(result.status === 64, 'missing query exit code');
  verify(
    result.stderr.startsWith('No bridge channel or method matches'),
    'missing query stderr',
  );
  verify(JSON.parse(result.stdout).status === 'notFound', 'missing query JSON');
}

/** persistence 쌍·관계 질의 검사가 함께 쓰는 고정 입력(kotlin 사용 + sql 선언)이다. */
function persistenceInputs() {
  const fixture = (name) => fileURLToPath(new URL(`../fixtures/domain-composition/${name}`, import.meta.url));
  return [fixture('kotlin-persistence.json'), fixture('sql.json')];
}

/** 빌드된 CLI가 persistence 쌍(check --pairs)을 기본 문서에 덧붙이는 계약을 지키는지 검증한다. */
function verifyPersistencePairs() {
  const inputs = persistenceInputs();
  const plain = run(['check', ...inputs]);
  const paired = run(['check', ...inputs, '--pairs']);
  verify(paired.status === plain.status && paired.stderr === '', 'check pairs exit code');
  const { matches, ...rest } = JSON.parse(paired.stdout);
  verify(JSON.stringify(rest) === JSON.stringify(JSON.parse(plain.stdout)), 'check pairs additive');
  verify(matches.length === 2 && matches.every(({ domain }) => domain === 'persistence'), 'check pairs matches');
  verify(matches[0].uses[0].symbol.usr === 'com.example.Repo#find()V', 'check pairs keeps use symbol');
  verify(matches[0].decls[0].symbol.qualifiedName === 'public.users', 'check pairs keeps decl symbol');
  verify(run(['check', ...inputs, '--pairs', '--format', 'sarif']).status === 64, 'check pairs sarif usage');
  verify(run(['help', 'check']).stdout.includes('[--pairs]'), 'check pairs help');
}

/** 빌드된 CLI가 relation 주체 query를 persistence 조인 규칙과 64 의미로 내는지 검증한다. */
function verifyRelationQuery() {
  const inputs = persistenceInputs();
  const relation = run(['query', 'relation:users', ...inputs]);
  const relationDocument = JSON.parse(relation.stdout);
  verify(relation.status === 0 && relationDocument.level === 'persistence', 'relation query exit code');
  verify(relationDocument.result.subject.qualifiedName === 'relation:public.users', 'relation query subject');
  const missing = run(['query', 'relation:payments', ...inputs]);
  verify(missing.status === 64 && JSON.parse(missing.stdout).status === 'notFound', 'relation query notFound');
  verify(run(['help', 'query']).stdout.includes('relation:<name>'), 'relation query help');
}

/**
 * 이름이 `relation:`으로 시작하는 bridge 채널을 같은 이름의 관계가 없을 때 이전처럼 찾는지 검증한다.
 * relation 주체 도입 전에는 이 이름이 bridge 채널 이름 그대로 질의됐다.
 */
function verifyRelationPrefixedBridgeQuery() {
  const directory = mkdtempSync(join(tmpdir(), 'isthmus-cli-relation-channel-'));
  try {
    const channelFacts = (platform) => JSON.stringify({
      format: 'bridge-facts', version: 1, platform, target: 'flutter', project: '/app',
      generatedAt: '2026-09-26T00:00:00Z', tool: { name: 'fixture', version: 'test' }, limitations: [],
      facts: [{
        kind: platform === 'dart' ? 'channel-create' : 'channel-register', channel: 'relation:foo',
        dynamic: false, location: { path: platform === 'dart' ? 'lib/a.dart' : 'ios/A.swift', line: 1, column: 1 },
      }],
    });
    const dart = join(directory, 'dart.json');
    const swift = join(directory, 'swift.json');
    writeFileSync(dart, channelFacts('dart'));
    writeFileSync(swift, channelFacts('swift'));
    const result = run(['query', 'relation:foo', dart, swift]);
    const document = JSON.parse(result.stdout);
    verify(result.status === 0 && document.level === 'bridge' && document.result.subject.name === 'relation:foo',
      'relation-prefixed bridge channel query');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** graph가 요청한 Mermaid 문서를 내는지 검증한다. */
function verifyGraph() {
  const result = run([
    'graph',
    dartPath,
    swiftPath,
    '--format',
    'mermaid',
  ]);
  verify(result.status === 0, 'graph exit code');
  verify(result.stderr === '', 'graph stderr');
  verify(result.stdout.startsWith('flowchart LR\n'), 'graph Mermaid');
}

/** 같은 snapshot의 기존 오류는 diff strict에서 새 오류로 세지 않는다. */
function verifyDiff() {
  const result = run(['diff', '--before', dartPath, swiftPath, '--after', dartPath, swiftPath, '--strict']);
  verify(result.status === 0, 'diff unchanged exit code');
  verify(result.stderr === '', 'diff stderr');
  const document = JSON.parse(result.stdout);
  verify(document.format === 'isthmus-diff', 'diff format');
  verify(document.summary.introducedErrors === 0, 'diff existing errors');
  verify(
    run(['diff', '--strict', '--before', dartPath, swiftPath, '--after', dartPath, swiftPath])
      .status === 0,
    'diff leading strict',
  );
  verify(run(['diff', '--help']).status === 0, 'diff help');
  verify(run(['diff']).status === 64, 'diff usage');
  verify(run(['diff', '--before', 'missing.json', swiftPath, '--after', dartPath, swiftPath]).status === 2,
    'diff input failure');
}

/** 발행 CLI의 MCP stdio 세션이 초기화·도구 호출·알림 무시를 지키는지 검증한다. */
function verifyServe() {
  const messages = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'query',
        arguments: { name: 'takePhoto', documents: [dartPath, swiftPath] },
      },
    },
  ];
  const result = runChild(process.execPath, [binaryPath, 'serve'], {
    input: `${messages.map((m) => JSON.stringify(m)).join('\n')}\n`,
  });
  verify(result.status === 0, 'serve exit code');
  const lines = result.stdout.trim().split('\n').map((line) => JSON.parse(line));
  verify(lines.length === 2, 'serve notification produces no response');
  verify(lines[0].result.serverInfo.name === 'isthmus', 'serve initialize');
  verify(lines[0].result.protocolVersion === '2025-06-18', 'serve protocol negotiation');
  const query = JSON.parse(lines[1].result.content[0].text);
  verify(query.status === 'found', 'serve tools/call query');
  verify(run(['serve', '--verbose']).status === 64, 'serve usage');
  verify(run(['help', 'serve']).stdout.startsWith('Usage: isthmus serve'), 'serve help');
}

/** extract-js가 발행 CLI에서 bridge-facts 문서를 내는지 검증한다. */
function verifyExtractJs() {
  const directory = mkdtempSync(join(tmpdir(), 'isthmus-extract-js-'));
  try {
    const source = join(directory, 'src', 'app.ts');
    mkdirSync(join(directory, 'src'), { recursive: true });
    writeFileSync(source,
      "import { requireNativeModule as loadModule } from 'expo-modules-core';\nconst M = loadModule('Cam');\nM.shoot();\nrequireNativeComponent('Grid');\n");
    const result = run(['extract-js', directory]);
    verify(result.status === 0, 'extract-js exit code');
    verify(result.stderr === '', 'extract-js stderr');
    const document = JSON.parse(result.stdout);
    verify(document.format === 'bridge-facts' && document.version === 1, 'extract-js format');
    verify(document.platform === 'js' && document.target === 'react-native', 'extract-js identity');
    const keys = document.facts.map((fact) => `${fact.kind}:${fact.channel}`);
    verify(keys.includes('module-import:Cam') && keys.includes('method-invoke:Cam')
      && keys.includes('component-require:Grid'), 'extract-js facts');
    verify(document.facts.every((fact) => fact.location.path === 'src/app.ts'), 'extract-js locations');
    verify(run(['extract-js']).status === 64, 'extract-js usage');
    verify(run(['extract-js', join(directory, 'missing')]).status === 2, 'extract-js missing input');
    verify(run(['help', 'extract-js']).stdout.startsWith('Usage: isthmus extract-js'), 'extract-js help');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** doctor·init이 설정 JSON 검증과 scaffold 쓰기를 실제 CLI에서 수행하는지 검증한다. */
function verifyDoctorInit() {
  const directory = mkdtempSync(join(tmpdir(), 'isthmus-cli-doctor-'));
  try {
    const capturePath = join(directory, 'capture.json');
    const init = run(['init', capturePath]);
    verify(init.status === 0, 'init exit code');
    verify(JSON.parse(init.stdout).format === 'isthmus-init', 'init JSON');
    const scaffold = JSON.parse(readFileSync(capturePath, 'utf8'));
    verify(scaffold.project.length > 0 && Array.isArray(scaffold.prepare), 'init scaffold');
    verify(run(['init', capturePath]).status === 2, 'init existing config');
    verify(run(['init', capturePath, '--force']).status === 0, 'init force overwrite');

    const doctor = run(['doctor', capturePath]);
    verify(doctor.status === 1, 'doctor incomplete exit code');
    const report = JSON.parse(doctor.stdout);
    verify(report.format === 'isthmus-doctor' && report.status === 'incomplete', 'doctor JSON');
    verify(report.checks.some(({ status }) => status === 'missing'), 'doctor missing check');
    verify(run(['doctor', join(directory, 'missing.json')]).status === 2, 'doctor missing input');
    verify(run(['help', 'doctor']).stdout.startsWith('Usage: isthmus doctor'), 'doctor help');
    verify(run(['help', 'init']).stdout.startsWith('Usage: isthmus init'), 'init help');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** 빌드된 CLI가 v2 입력으로 query·graph를 처리하는지 검증한다. */
function verifyMessageViews() {
  const directory = mkdtempSync(join(tmpdir(), 'isthmus-cli-msg-views-'));
  try {
    const message = (platform, facts) => JSON.stringify({
      format: 'bridge-facts', version: 2, transport: 'basic-message-channel',
      platform, target: facts.length > 0 ? 'flutter' : null, project: '/app',
      generatedAt: '2026-09-18T00:00:00Z',
      tool: { name: platform === 'dart' ? 'dartograph' : 'cartograph', version: 'test' },
      facts, limitations: [],
    });
    const messageDart = join(directory, 'dart.json');
    const messageSwift = join(directory, 'swift.json');
    writeFileSync(messageDart, message('dart', [{
      kind: 'message-send', channel: 'example/basic', dynamic: false,
      location: { path: 'lib/api.dart', line: 5, column: 1 },
    }]));
    writeFileSync(messageSwift, message('swift', [{
      kind: 'message-handle', channel: 'example/basic', dynamic: false,
      location: { path: 'macos/Setup.swift', line: 9, column: 1 },
      symbol: { qualifiedName: 'Setup.register' },
    }]));

    const query = run(['query', 'example/basic', messageDart, messageSwift]);
    verify(query.status === 0 && JSON.parse(query.stdout).result.subject.kind === 'message',
      'query message boundary');
    const graph = run(['graph', messageDart, messageSwift]);
    verify(graph.status === 0 && JSON.parse(graph.stdout).edges[0].kind === 'message',
      'graph message edge');
    const retentions = run(['retentions', '--for', 'cartograph', messageDart, messageSwift]);
    const retentionDocument = JSON.parse(retentions.stdout);
    verify(retentions.status === 0 && retentionDocument.retentions.length === 1 &&
      retentionDocument.retentions[0].evidence.method === undefined &&
      retentionDocument.retentions[0].evidence.channel === 'example/basic',
      'v2 retention evidence');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** 빌드된 CLI를 동기 실행해 세 스트림을 수집한다. */
function verifyReactNativeEvents() {
  const directory = mkdtempSync(join(tmpdir(), 'isthmus-rn-events-cli-'));
  try {
    const source = join(directory, 'events.ts');
    const jsPath = join(directory, 'js.json');
    const kotlinPath = join(directory, 'kotlin.json');
    writeFileSync(source, "import { DeviceEventEmitter as E } from 'react-native'; E.addListener('ready', () => {});");
    const extracted = run(['extract-js', source, '--project', directory, '--events']);
    verify(extracted.status === 0, 'event extraction status');
    const caller = JSON.parse(extracted.stdout);
    verify(caller.transport === 'react-native-event' && caller.facts[0].kind === 'event-listen', 'event extraction');
    writeFileSync(jsPath, extracted.stdout);
    const native = { ...caller, platform: 'kotlin', tool: { name: 'kartograph', version: 'test' }, limitations: [],
      facts: [{ kind: 'event-emit', channel: 'ready', dynamic: false,
        location: { path: 'android/Events.kt', line: 8, column: 1 },
        symbol: { usr: 'method:sample/Events#notify()V', qualifiedName: 'Events.notify' } }] };
    writeFileSync(kotlinPath, JSON.stringify(native));
    const checked = run(['check', jsPath, kotlinPath, '--strict']);
    verify(checked.status === 0 && JSON.parse(checked.stdout).summary.matchedEvents === 1, 'event check join');
    const query = run(['query', 'react-native:event:ready', jsPath, kotlinPath]);
    verify(query.status === 0 && JSON.parse(query.stdout).result.subject.kind === 'event', 'event query');
    const retained = run(['retentions', jsPath, kotlinPath, '--for', 'kartograph']);
    verify(retained.status === 0 && JSON.parse(retained.stdout).retentions[0].symbol.usr === native.facts[0].symbol.usr,
      'kartograph event retention');
    writeFileSync(kotlinPath, JSON.stringify({ ...native, target: null, facts: [] }));
    const missing = run(['check', jsPath, kotlinPath, '--strict']);
    verify(missing.status === 0 && JSON.parse(missing.stdout).issues[0].code === 'event-listen-without-emit',
      'unmatched event warning');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** 빌드된 CLI를 동기 실행해 세 스트림을 수집한다. */
function run(arguments_) {
  return runChild(process.execPath, [binaryPath, ...arguments_]);
}

/** 계약 위반이면 민감정보 없는 검사 이름으로 실패한다. */
function verify(condition, name) {
  if (!condition) throw new Error(`CLI contract failed: ${name}`);
}
