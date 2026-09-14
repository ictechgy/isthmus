import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChild } from './run-child.mjs';

const harnessArguments = parseHarnessArguments(process.argv.slice(2));
const [flutterBinary, isthmusOverride, cartographBinary, dartographEntry, dartographExecutable] = harnessArguments.positionals;
const messageProducer = harnessArguments.messages;
const messageCartographBinary = messageProducer.cartograph;
const messageDartographEntry = messageProducer.dartograph;
const messageDartographExecutablePath = messageProducer.executable;
const unexpectedArguments = harnessArguments.invalid ? ['invalid'] : [];
const producerArgumentsPresent = cartographBinary !== undefined || dartographEntry !== undefined;
const messageProducerArgumentsPresent = messageCartographBinary !== undefined || messageDartographEntry !== undefined ||
  messageDartographExecutablePath !== undefined;
if (flutterBinary === undefined || process.platform !== 'darwin' || unexpectedArguments.length > 0 ||
  (producerArgumentsPresent && (cartographBinary === undefined || dartographEntry === undefined)) ||
  (messageProducerArgumentsPresent && (!producerArgumentsPresent || messageCartographBinary === undefined))) {
  process.stderr.write('Usage (macOS): verify-flutter-runtime.mjs <flutter-bin> [isthmus-js] '
    + '[cartograph-bin dartograph-entry [dartograph-bin]] '
    + '[--message-cartograph <path> --message-dartograph <path> '
    + '--message-dartograph-executable <path>]\n');
  process.exit(64);
}
const repository = dirname(dirname(fileURLToPath(import.meta.url)));
const packageRoot = join(repository, 'packages/isthmus_runtime');
const basicChannel = 'dev.flutter.pigeon.runtime_probe.Api.echo';
const publicCanLaunchPrefix = 'dev.flutter.pigeon.url_launcher_macos.UrlLauncherApi.canLaunchUrl';
const isthmus = isthmusOverride ?? join(repository, 'dist/cli/main.js');
const scratch = await mkdtemp(join(tmpdir(), 'isthmus-native-runtime-'));
const artifacts = await mkdtemp(join(tmpdir(), 'isthmus-native-evidence-'));
const appRoot = join(scratch, 'runtime_probe');
const started = performance.now();
const steps = [];
const commandEnvironment = { ...process.env, CI: 'true', FLUTTER_SUPPRESS_ANALYTICS: 'true',
  COCOAPODS_DISABLE_STATS: 'true' };

/** 기존 위치 인자를 보존하고 Basic producer 경로는 명시 플래그로 받는다. */
function parseHarnessArguments(arguments_) {
  const positionals = [];
  const values = {};
  let invalid = false;
  for (let index = 0; index < arguments_.length; index++) {
    const flag = arguments_[index];
    if (!flag.startsWith('--')) {
      positionals.push(flag);
      continue;
    }
    const key = flag === '--message-cartograph' ? 'cartograph'
      : flag === '--message-dartograph' ? 'dartograph'
        : flag === '--message-dartograph-executable' ? 'executable' : undefined;
    if (key === undefined || index + 1 >= arguments_.length || arguments_[index + 1].startsWith('-') || values[key] !== undefined) {
      invalid = true;
      continue;
    }
    values[key] = arguments_[++index];
  }
  if (positionals.length > 5) invalid = true;
  return { positionals, messages: values, invalid };
}

async function verifyNativeRuntime() {
try {
  if (isthmusOverride === undefined) step('npm', ['run', 'build'], 'isthmus build', repository);
  const version = JSON.parse(step(flutterBinary, ['--version', '--machine'], 'Flutter version').stdout);
  step(flutterBinary, ['create', '--platforms=macos', '--project-name=isthmus_runtime_probe',
    '--no-pub', '--offline', appRoot], 'Flutter app creation');
  const project = await realpath(appRoot);
  const publicPluginRoot = producerArgumentsPresent ? await stagePublicPlugin(project) : undefined;
  await writeFile(join(appRoot, 'pubspec.yaml'), `name: isthmus_runtime_probe\nversion: 1.0.0+1\n`
    + `environment:\n  sdk: '>=3.7.0 <4.0.0'\ndependencies:\n  flutter:\n    sdk: flutter\n`
    + `  isthmus_runtime:\n    path: ${JSON.stringify(packageRoot)}\n`
    + (publicPluginRoot === undefined ? '  url_launcher_macos: 3.2.2\n'
      : '  url_launcher_macos:\n    path: vendor/url_launcher_macos\n'));
  await writeFile(join(appRoot, 'lib/main.dart'), dartSource);
  await writeFile(join(appRoot, 'macos/Runner/MainFlutterWindow.swift'), swiftSource);
  await writeFile(join(appRoot, 'macos/Runner/NativeRuntimeHelper.swift'), swiftHelperSource);
  // 현대 Xcode가 빌드할 수 있는 최소 버전을 전용 앱과 CocoaPods 타깃에 함께 적용한다.
  const projectFile = join(appRoot, 'macos/Runner.xcodeproj/project.pbxproj');
  const originalProject = await readFile(projectFile, 'utf8');
  const updatedProject = originalProject.replace(/MACOSX_DEPLOYMENT_TARGET = [^;]+;/gu, 'MACOSX_DEPLOYMENT_TARGET = 12.0;');
  assert.notEqual(originalProject, updatedProject, 'Fixture deployment targets must be found.');
  await writeFile(projectFile, addSwiftSourceToProject(updatedProject));
  const podfile = join(appRoot, 'macos/Podfile');
  const originalPods = await readFile(join(version.flutterRoot, 'packages/flutter_tools/templates/cocoapods/Podfile-macos'), 'utf8');
  assert.ok(originalPods.includes('flutter_additional_macos_build_settings(target)'), 'Flutter CocoaPods hook must exist.');
  const updatedPods = originalPods.replace(/platform :osx, '[^']+'/u, "platform :osx, '12.0'")
    .replace('flutter_additional_macos_build_settings(target)',
      "flutter_additional_macos_build_settings(target)\n"
      + "    target.build_configurations.each do |configuration|\n"
      + "      configuration.build_settings['MACOSX_DEPLOYMENT_TARGET'] = '12.0'\n"
      + "    end");
  assert.notEqual(originalPods, updatedPods, 'Fixture CocoaPods targets must be found.');
  await writeFile(podfile, updatedPods);
  // 전용 테스트 앱만 sandbox 없이 실행해 호출자가 지정한 임시 산출물 경로에 쓴다.
  for (const name of ['DebugProfile.entitlements', 'Release.entitlements']) {
    const path = join(appRoot, 'macos/Runner', name);
    const original = await readFile(path, 'utf8');
    const patched = original.replace(/(<key>com\.apple\.security\.app-sandbox<\/key>\s*)<true\s*\/>/u, '$1<false/>');
    assert.notEqual(original, patched, 'Disposable app sandbox entry must be found.');
    await writeFile(path, patched);
  }
  step(flutterBinary, ['pub', 'get'], 'Flutter app dependency resolution', appRoot);
  const hash = createHash('sha256').update(dartSource).update(swiftSource).update(swiftHelperSource).update(JSON.stringify({
    framework: version.frameworkRevision, engine: version.engineRevision, dart: version.dartSdkVersion,
  }));
  for (const relative of (await readdir(join(packageRoot, 'lib'), { recursive: true })).filter((name) => name.endsWith('.dart')).sort()) {
    hash.update(relative).update(await readFile(join(packageRoot, 'lib', relative)));
  }
  hash.update(await readFile(join(packageRoot, 'pubspec.yaml')));
  for (const name of ['pubspec.yaml', 'pubspec.lock', 'macos/Podfile']) {
    hash.update(name).update((await readFile(join(appRoot, name), 'utf8')).replaceAll(packageRoot, '<recorder-package>'));
  }
  const revision = hash.digest('hex');
  let captured;
  if (producerArgumentsPresent) {
    // 먼저 실제 Xcode compiler index를 만들고 그 위치를 producer에 명시한다.
    const indexBuildArguments = ['build', 'macos', '--debug', '--no-pub',
      `--dart-define=ISTHMUS_PROJECT=${project}`];
    step(flutterBinary, indexBuildArguments, 'Native Flutter compiler index preparation', appRoot, 600_000);
    step('xcodebuild', xcodeIndexArguments(appRoot), 'Xcode compiler index preparation', appRoot, 600_000);
    const indexStore = await findIndexStore(join(appRoot, 'build'));
    captured = await captureProducerPreflight({ project, version, indexStore, publicPluginRoot });
  }
  const runtimeRevision = captured?.context.revision ?? revision;
  const runtimeProject = captured?.context.project ?? project;
  await writeFile(join(artifacts, 'expectations.json'), JSON.stringify({
    format: 'bridge-expectations', version: 1, project: runtimeProject, revision: runtimeRevision,
    checks: [
      { id: 'method-echo', scenario: 'success', platform: 'macos', instance: 'main',
        transport: 'method-channel', channel: 'example/native-runtime', method: 'echo' },
      { id: 'transitive-echo', scenario: 'chain', platform: 'macos', instance: 'main',
        transport: 'method-channel', channel: 'example/native-runtime', method: 'echo' },
      { id: 'pigeon-echo', scenario: 'success', platform: 'macos', instance: 'main',
        transport: 'basic-message-channel', channel: 'dev.flutter.pigeon.runtime_probe.Api.echo' },
      { id: 'public-pigeon', scenario: 'success', platform: 'macos', instance: 'main',
        transport: 'basic-message-channel', channel: 'dev.flutter.pigeon.url_launcher_macos.UrlLauncherApi.canLaunchUrl' },
    ],
  }, null, 2), { mode: 0o600 });
  const negativeExpectationsPath = join(artifacts, 'negative-expectations.json');
  await writeFile(negativeExpectationsPath, JSON.stringify({
    format: 'bridge-expectations', version: 1, project: runtimeProject, revision: runtimeRevision,
    checks: [
      { id: 'native-error', scenario: 'failure', platform: 'macos', instance: 'main',
        transport: 'method-channel', channel: 'example/native-runtime', method: 'failure', allowedOutcomes: ['error'] },
      { id: 'native-missing-handler', scenario: 'failure', platform: 'macos', instance: 'main',
        transport: 'method-channel', channel: 'example/missing-runtime', method: 'absent', allowedOutcomes: ['missing-handler'] },
      { id: 'native-timeout', scenario: 'timeout', platform: 'macos', instance: 'main',
        transport: 'method-channel', channel: 'example/native-runtime', method: 'slow', allowedOutcomes: ['timeout'] },
    ],
  }, null, 2), { mode: 0o600 });
  const runtimeBuildArguments = ['build', 'macos', '--debug', '--no-pub',
    `--dart-define=ISTHMUS_PROJECT=${runtimeProject}`, `--dart-define=ISTHMUS_REVISION=${runtimeRevision}`,
    `--dart-define=ISTHMUS_OUTPUT=${artifacts}`];
  step(flutterBinary, runtimeBuildArguments, 'Native Flutter app build', appRoot, 600_000);
  step(flutterBinary, runtimeBuildArguments, 'Native Flutter repeat build', appRoot, 600_000);
  const executable = join(appRoot, 'build/macos/Build/Products/Debug/isthmus_runtime_probe.app/Contents/MacOS/isthmus_runtime_probe');
  step(executable, [], 'Native Flutter app execution', appRoot, 60_000);
  const verify = (expectationsPath, ...names) => runChild(process.execPath, [isthmus, 'verify-runtime',
    '--expectations', expectationsPath, '--strict', '--compact',
    ...names.map((name) => join(artifacts, `${name}.json`))], { timeout: 30_000 });
  const verifyRuntime = (...names) => verify(join(artifacts, 'expectations.json'), ...names);
  const positive = verifyRuntime('success', 'chain');
  assert.equal(positive.status, 0, 'Native successful calls must satisfy expectations.');
  const good = JSON.parse(positive.stdout);
  assert.equal(good.summary.passedChecks, 4);
  await assertRuntimeRevision(['success', 'chain'], runtimeProject, runtimeRevision);
  let preflightRuntime;
  if (captured !== undefined) {
    const preflightResult = runChild(process.execPath, [isthmus, 'preflight',
      join(artifacts, 'preflight-context.json'), join(artifacts, 'success.json'), join(artifacts, 'chain.json'),
      '--expectations', join(artifacts, 'expectations.json'), '--strict', '--compact'], { timeout: 30_000 });
    // 실제 runtime은 맞아도 Basic 정적 경계와 실행하지 않은 실패 경로는 검토 공백으로 남긴다.
    assert.equal(preflightResult.status, 1, 'Preflight must preserve related static/runtime evidence gaps.');
    preflightRuntime = JSON.parse(preflightResult.stdout);
    assert.equal(preflightRuntime.runtime?.aligned, true, 'Preflight runtime must share the capture revision.');
    assert.equal(preflightRuntime.runtime?.verification?.status, 'passed', 'Preflight runtime success must pass.');
    assert.ok(preflightRuntime.runtime?.uncoveredBoundaries?.length > 0, 'Uncovered static boundaries must remain visible.');
    if (messageProducerArgumentsPresent) {
      const basicRoutes = preflightRuntime.runtime?.routes?.filter(({ transport, channel }) =>
        transport === 'basic-message-channel' && channel === basicChannel) ?? [];
      assert.ok(basicRoutes.some(({ staticStatus, observedCalls }) => staticStatus === 'candidates' && observedCalls > 0),
        'Basic runtime success must match a static producer candidate.');
      if (publicPluginRoot !== undefined) {
        const publicRoutes = preflightRuntime.runtime?.routes?.filter(({ transport, channel }) =>
          transport === 'basic-message-channel' && channel === publicCanLaunchPrefix) ?? [];
        assert.ok(publicRoutes.some(({ staticStatus, observedCalls }) => staticStatus === 'candidates' && observedCalls > 0),
          'Local public Pigeon runtime must match a static prefix candidate.');
      }
    }
    await writeFile(join(artifacts, 'preflight-runtime.json'), JSON.stringify(preflightRuntime, null, 2), { mode: 0o600 });
  }
  const negative = verifyRuntime('success', 'chain', 'failure', 'timeout');
  assert.equal(negative.status, 1, 'Native failures must fail the CI gate.');
  const bad = JSON.parse(negative.stdout);
  assert.deepEqual(bad.failures.map(({ event }) => event.outcome).sort(), ['error', 'missing-handler', 'timeout'],
    'Missing handler, native error and slow reply must retain distinct outcomes.');
  const incomplete = verifyRuntime('success', 'chain', 'pending');
  assert.equal(incomplete.status, 1, 'Unfinished native communication must fail the CI gate.');
  const pending = JSON.parse(incomplete.stdout);
  assert.ok(pending.summary.pendingCalls > 0 || pending.summary.incompleteRuns > 0);
  await assertRuntimeRevision(['failure', 'timeout', 'pending'], runtimeProject, runtimeRevision);
  const allowedNegative = verify(negativeExpectationsPath, 'failure', 'timeout');
  assert.equal(allowedNegative.status, 0, 'Declared native error, missing-handler and timeout outcomes must pass.');
  const allowedNegativeReport = JSON.parse(allowedNegative.stdout);
  assert.equal(allowedNegativeReport.status, 'passed');
  assert.equal(allowedNegativeReport.summary.expectedFailedCalls, 3);
  const allowedPending = verify(negativeExpectationsPath, 'pending');
  assert.equal(allowedPending.status, 1, 'Pending native communication must not satisfy terminal expectations.');
  for (const name of ['success', 'chain', 'failure', 'timeout', 'pending']) {
    const text = await readFile(join(artifacts, `${name}.json`), 'utf8');
    assert.equal(text.includes('fixture-private-payload'), false, 'Payload must not enter runtime evidence.');
  }
  const summary = { scope: 'real-flutter-macos-native-channels', flutter: version.frameworkVersion,
    dart: version.dartSdkVersion, publicPlugin: 'url_launcher_macos@3.2.2', deploymentTarget: '12.0',
    revision: runtimeRevision, sourceRevision: revision, artifacts, elapsedMs: Math.round(performance.now() - started), steps,
    ...(captured === undefined ? {} : {
      preflight: { context: join(artifacts, 'preflight-context.json'), sources: join(artifacts, 'preflight-context.json.sources.json'),
        runtime: join(artifacts, 'preflight-runtime.json'), cached: captured.cached, fingerprintScope: captured.fingerprintScope,
        report: captured.report.summary, runtimeAligned: preflightRuntime?.runtime?.aligned ?? false },
    }),
    ...(publicPluginRoot === undefined ? {} : {
      publicPluginCopy: { package: 'url_launcher_macos', version: '3.2.2', source: publicPluginRoot.source,
        vendorRelative: 'vendor/url_launcher_macos', files: publicPluginRoot.files },
    }),
    success: good.summary, failure: bad.summary, pending: pending.summary,
    allowedNegative: allowedNegativeReport.summary,
  };
  await writeFile(join(artifacts, 'verification.json'), JSON.stringify(summary, null, 2), { mode: 0o600 });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} finally {
  await rm(scratch, { recursive: true, force: true });
}
}

/** 공개 plugin의 실제 package source를 disposable app 안에 복사해 producer와 runtime이 같은 root를 보게 한다. */
async function stagePublicPlugin(project) {
  const pubCache = process.env.PUB_CACHE ?? join(homedir(), '.pub-cache');
  const source = await realpath(join(pubCache, 'hosted/pub.dev/url_launcher_macos-3.2.2'));
  const sourceManifest = await readFile(join(source, 'pubspec.yaml'), 'utf8');
  assert.match(sourceManifest, /(?:^|\n)name:\s*url_launcher_macos\s*(?:\n|$)/u, 'Public plugin package name must match.');
  assert.match(sourceManifest, /(?:^|\n)version:\s*3\.2\.2\s*(?:\n|$)/u, 'Public plugin package version must match.');
  const destination = join(project, 'vendor/url_launcher_macos');
  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true, errorOnExist: false, force: true });
  const preservedFiles = [
    'lib/src/messages.g.dart',
    'macos/url_launcher_macos/Sources/url_launcher_macos/messages.g.swift',
    'macos/url_launcher_macos/Sources/url_launcher_macos/UrlLauncherPlugin.swift',
    'LICENSE',
  ];
  const files = [];
  for (const relative of preservedFiles) {
    const original = await readFile(join(source, relative));
    assert.deepEqual(original, await readFile(join(destination, relative)),
      `Public plugin source changed while staging: ${relative}`);
    files.push({ path: relative, sha256: createHash('sha256').update(original).digest('hex') });
  }
  return {
    root: destination,
    source,
    files,
  };
}

/** 실제 producer를 지정한 경우, 동일한 생성 앱·compiler index에서 정적 preflight를 수집한다. */
async function captureProducerPreflight({ project, version, indexStore, publicPluginRoot }) {
  const cartograph = await realpath(cartographBinary);
  const dartograph = await realpath(dartographEntry);
  const executable = dartographExecutable === undefined ? undefined : await realpath(dartographExecutable);
  const dartographRoot = dirname(dirname(dartograph));
  const dartographCommand = executable === undefined ? ['dart', dartograph] : [executable];
  const messageDartograph = messageDartographEntry === undefined ? dartograph : await realpath(messageDartographEntry);
  const messageDartographExecutable = messageDartographExecutablePath === undefined
    ? undefined : await realpath(messageDartographExecutablePath);
  const messageDartographCommand = messageDartographExecutable === undefined
    ? messageDartographEntry === undefined ? dartographCommand : ['dart', messageDartograph]
    : [messageDartographExecutable];
  const messageCartograph = messageCartographBinary === undefined ? undefined : await realpath(messageCartographBinary);
  const messageDartographRoot = dirname(dirname(messageDartograph));
  // Flutter build와 index 경로 발견은 capture 호출 직전에 끝냈다. capture의 prepare는
  // 같은 DerivedData를 다시 인덱싱해 producer가 읽은 index가 최신임을 확인한다.
  const prepare = [['xcodebuild', ...xcodeIndexArguments(appRoot)]];
  const { capturePreflight } = await import('./capture-preflight.mjs');
  const config = {
    project,
    inputs: ['lib', 'macos/Runner', 'macos/Runner.xcodeproj/project.pbxproj', 'macos/Podfile',
      'pubspec.yaml', 'pubspec.lock', '.dart_tool/package_config.json',
      ...(producerArgumentsPresent ? ['vendor/url_launcher_macos/lib', 'vendor/url_launcher_macos/macos',
        'vendor/url_launcher_macos/pubspec.yaml', 'vendor/url_launcher_macos/LICENSE'] : [])],
    toolInputs: [cartograph, dartograph, ...(executable === undefined ? [] : [executable]),
      ...(messageCartograph === undefined ? [] : [messageCartograph]),
      ...(messageDartographExecutable === undefined ? [] : [messageDartographExecutable]),
      join(dartographRoot, 'lib'), join(dartographRoot, '.dart_tool/package_config.json'),
      ...(messageDartographEntry === undefined ? [] : [messageDartograph, join(messageDartographRoot, 'lib'),
        join(messageDartographRoot, '.dart_tool/package_config.json')]),
      join(version.flutterRoot, 'version'), join(version.flutterRoot, 'bin/cache/dart-sdk/version'),
      join(packageRoot, 'lib'), join(packageRoot, 'pubspec.yaml')],
    prepare,
    dartograph: dartographCommand,
    cartograph: [cartograph],
    ...(messageCartograph === undefined ? {} : { messages: { cartograph: [messageCartograph], dartograph: messageDartographCommand } }),
    selection: { swift: { files: ['macos/Runner/NativeRuntimeHelper.swift'], symbols: [] } },
    indexStore,
    output: join(artifacts, 'preflight-context.json'),
    cache: join(artifacts, 'preflight-cache.json'),
  };
  const result = await capturePreflight(config);
  assert.equal(result.context.project, project, 'Producer and runtime projects must match.');
  assert.match(result.context.revision, /^sha256:[a-f0-9]{64}$/u, 'Producer revision must be a source fingerprint.');
  const screen = result.report.affected.find(({ subject }) => subject.kind === 'symbol' && subject.symbol.id.endsWith('::runtimeScreen'));
  assert.ok(screen, 'Real compiler/producer path must reach the Dart screen consumer.');
  const nodes = new Map([...result.report.roots.map((subject) => [subject.key, { subject }]),
    ...result.report.affected.map((row) => [row.subject.key, row])]);
  const chain = [];
  for (let row = screen; row; row = nodes.get(row.via)) chain.push(row.subject.kind === 'bridge' ? row.subject.channel : row.subject.symbol.qualifiedName);
  for (const name of ['runtimeNativeValue', 'awakeFromNib', 'example/native-runtime', 'runtimeBridge', 'runtimeService', 'runtimeScreen']) {
    assert.ok(chain.some((item) => item.includes(name)), `Real cross-language path must include ${name}.`);
  }
  if (messageProducerArgumentsPresent) {
    const messageDocuments = result.context.messages ?? [];
    assert.equal(messageDocuments.length, 2, 'Basic capture must include Dart and Swift v2 documents.');
    const messageFacts = messageDocuments.flatMap(({ facts }) => facts);
    assert.ok(messageFacts.some(({ kind, channel }) => kind === 'message-send' && channel === basicChannel),
      'Dart Basic producer must emit a literal message-send fact.');
    assert.ok(messageFacts.some(({ kind, channel }) => kind === 'message-handle' && channel === basicChannel),
      'Swift Basic producer must emit a literal message-handle fact.');
    assert.ok(messageFacts.filter(({ channel }) => channel === basicChannel).every(({ dynamic }) => !dynamic),
      'The fixture Basic address must remain a literal in both producer documents.');
    if (publicPluginRoot !== undefined) {
      const publicFacts = messageFacts.filter(({ channelPrefix }) =>
        typeof channelPrefix === 'string' && channelPrefix.startsWith(publicCanLaunchPrefix));
      assert.ok(publicFacts.some(({ kind, dynamic }) => kind === 'message-send' && dynamic),
        'Local public Dart Pigeon source must emit a dynamic prefix fact.');
      assert.ok(publicFacts.some(({ kind, dynamic }) => kind === 'message-handle' && dynamic),
        'Local public Swift Pigeon source must emit a dynamic prefix fact.');
    }
    const messageBoundary = result.report.boundaries.find(({ subject }) =>
      subject.transport === 'basic-message-channel' && subject.channel === basicChannel);
    assert.ok(messageBoundary, 'Static Basic producer facts must create a preflight boundary.');
  }
  await writeFile(join(artifacts, 'preflight-path.json'), JSON.stringify(chain, null, 2), { mode: 0o600 });
  const sourcesPath = `${config.output}.sources.json`;
  await access(sourcesPath);
  return result;
}

/** Flutter 산출물을 유지하면서 Xcode가 실제 compiler index를 남기게 한다. */
function xcodeIndexArguments(root) {
  return ['-workspace', join(root, 'macos/Runner.xcworkspace'), '-scheme', 'Runner',
    '-configuration', 'Debug', '-derivedDataPath', join(root, 'build/macos/Build'),
    'COMPILER_INDEX_STORE_ENABLE=YES', 'CODE_SIGNING_ALLOWED=NO', 'build'];
}

/** Xcode가 생성한 Index.noindex/DataStore만 사용하며, 비슷한 이름의 산출물을 추측하지 않는다. */
async function findIndexStore(buildRoot) {
  const pending = [buildRoot];
  const matches = [];
  while (pending.length > 0) {
    const directory = pending.shift();
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch { continue; }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (!entry.isDirectory()) continue;
      if (entry.name === 'DataStore' && directory.endsWith('/Index.noindex')) {
        await access(path);
        matches.push(path);
        continue;
      }
      pending.push(path);
    }
  }
  if (matches.length !== 1) throw new Error(`Flutter build produced ${matches.length} compiler index stores; refusing to guess.`);
  return matches[0];
}

/** 모든 runtime 파일이 같은 capture project/revision을 선언하는지 확인한다. */
async function assertRuntimeRevision(names, project, revision) {
  for (const name of names) {
    const value = JSON.parse(await readFile(join(artifacts, `${name}.json`), 'utf8'));
    assert.equal(value.project, project, `${name} runtime project must match preflight capture.`);
    assert.equal(value.revision, revision, `${name} runtime revision must match preflight capture.`);
  }
}

/** SDK와 네이티브 프로세스는 인수 배열로 실행하고 실패를 단계명으로 구분한다. */
function step(command, args, label, cwd = repository, timeout = 180_000) {
  const started = performance.now();
  const effectiveArguments = command === flutterBinary ? ['--no-version-check', ...args] : args;
  const result = runChild(command, effectiveArguments, { cwd, timeout, env: commandEnvironment,
    maxBuffer: 16 * 1024 * 1024 });
  steps.push({ name: label, elapsedMs: Math.round(performance.now() - started) });
  if (result.status !== 0 || result.error !== undefined) {
    // 전용 생성 앱의 도구 진단만 파일로 보존한다. 제품 호출 payload는 앱이 출력하지 않는다.
    process.stderr.write(`${label} failed; native evidence directory: ${artifacts}\n`);
    const diagnostic = label === 'Native Flutter app execution'
      ? `${label} returned ${result.status ?? 'unavailable'}; application output omitted.\n`
      : `${result.stdout}\n${result.stderr}`.replace(/https?:\/\/[^\s]+/gu, '[URL omitted]')
        .replace(/^\{ platform:macOS,.*$/gmu, '[Xcode destination omitted]');
    writeFileSync(join(artifacts, 'failure.log'), diagnostic, { mode: 0o600 });
    throw new Error(`${label} failed (exit ${result.status ?? 'unavailable'}).`);
  }
  return result;
}

/** Flutter가 만든 Xcode project에 별도 helper를 실제 Sources build phase로 등록한다. */
function addSwiftSourceToProject(project) {
  const buildFileId = 'A1B2C3D4E5F60718293A4B5C';
  const fileReferenceId = 'A1B2C3D4E5F60718293A4B5D';
  const buildFile = `\t\t${buildFileId} /* NativeRuntimeHelper.swift in Sources */ = {isa = PBXBuildFile; fileRef = ${fileReferenceId} /* NativeRuntimeHelper.swift */; };\n`;
  const fileReference = `\t\t${fileReferenceId} /* NativeRuntimeHelper.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = NativeRuntimeHelper.swift; sourceTree = "<group>"; };\n`;
  const withBuildFile = project.replace(
    '\t\t33CC11132044BFA00003C045 /* MainFlutterWindow.swift in Sources */ = {isa = PBXBuildFile; fileRef = 33CC11122044BFA00003C045 /* MainFlutterWindow.swift */; };\n',
    (match) => match + buildFile,
  );
  const withReference = withBuildFile.replace(
    '\t\t33CC11122044BFA00003C045 /* MainFlutterWindow.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = MainFlutterWindow.swift; sourceTree = "<group>"; };\n',
    (match) => match + fileReference,
  );
  const withGroup = withReference.replace(
    '\t\t\t\t33CC11122044BFA00003C045 /* MainFlutterWindow.swift */,\n',
    (match) => match + `\t\t\t\t${fileReferenceId} /* NativeRuntimeHelper.swift */,\n`,
  );
  const result = withGroup.replace(
    '\t\t\t\t33CC11132044BFA00003C045 /* MainFlutterWindow.swift in Sources */,\n',
    (match) => match + `\t\t\t\t${buildFileId} /* NativeRuntimeHelper.swift in Sources */,\n`,
  );
  assert.notEqual(result, project, 'Native helper must be registered in the Xcode project.');
  assert.equal(result.match(/NativeRuntimeHelper\.swift/gu)?.length, 6, 'Native helper Xcode entries must be complete.');
  return result;
}

const dartSourceTemplate = String.raw`
import 'dart:async';
import 'dart:io';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:isthmus_runtime/isthmus_runtime.dart';
import 'package:url_launcher_macos/src/messages.g.dart' as public_plugin;

const methodName = 'example/native-runtime';
const basicName = 'dev.flutter.pigeon.runtime_probe.Api.echo';
RuntimeCaller? methodCaller(String method) => switch (method) {
  'echo' => const RuntimeCaller(path: 'lib/main.dart', line: __ECHO_LINE__, column: __ECHO_COLUMN__),
  'failure' => const RuntimeCaller(path: 'lib/main.dart', line: __FAILURE_LINE__, column: __FAILURE_COLUMN__),
  'absent' => const RuntimeCaller(path: 'lib/main.dart', line: __ABSENT_LINE__, column: __ABSENT_COLUMN__),
  'slow' => const RuntimeCaller(path: 'lib/main.dart', line: __SLOW_LINE__, column: __SLOW_COLUMN__),
  'never' => const RuntimeCaller(path: 'lib/main.dart', line: __NEVER_LINE__, column: __NEVER_COLUMN__),
  _ => null,
};

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const Directionality(textDirection: TextDirection.ltr, child: SizedBox.shrink()));
  try {
    await probe();
    exit(0);
  } catch (_) {
    stderr.writeln('Native runtime probe did not preserve channel behavior.');
    exit(1);
  }
}

IsthmusRuntimeRecorder recorder(String scenario, {Duration? timeout, RuntimeCaller? Function(String)? callerForMethod}) => IsthmusRuntimeRecorder(
  messenger: ServicesBinding.instance.defaultBinaryMessenger,
  project: const String.fromEnvironment('ISTHMUS_PROJECT'),
  revision: const String.fromEnvironment('ISTHMUS_REVISION'),
  scenario: scenario, platform: 'macos', runId: scenario, observationTimeout: timeout,
  methodChannels: [
    RuntimeMethodChannel(channel: methodName, codec: const StandardMethodCodec(), callerForMethod: callerForMethod ?? methodCaller),
    RuntimeMethodChannel(channel: 'example/missing-runtime', codec: const StandardMethodCodec(), callerForMethod: methodCaller),
  ],
  basicMessageChannels: [RuntimeBasicMessageChannel(channel: basicName,
    replyCodec: const StandardMessageCodec(),
    caller: const RuntimeCaller(path: 'lib/main.dart', line: __BASIC_LINE__, column: __BASIC_COLUMN__),
    replyOutcome: pigeonOutcome),
    RuntimeBasicMessageChannel(
      channel: 'dev.flutter.pigeon.url_launcher_macos.UrlLauncherApi.canLaunchUrl',
      replyCodec: public_plugin.UrlLauncherApi.pigeonChannelCodec,
      caller: const RuntimeCaller(path: 'lib/main.dart', line: __PUBLICPIGEON_LINE__, column: __PUBLICPIGEON_COLUMN__),
      replyOutcome: pigeonOutcome),
  ],
);

RuntimeOutcome pigeonOutcome(Object? reply) => reply == null ? RuntimeOutcome.missingHandler
  : reply is List && reply.length == 1 ? RuntimeOutcome.success : RuntimeOutcome.error;

Future<void> save(String name, IsthmusRuntimeRecorder value) async {
  final output = const String.fromEnvironment('ISTHMUS_OUTPUT');
  await File('$output/$name.json').writeAsString(value.finish().encode(), flush: true);
}

Future<void> probe() async {
  final success = recorder('success');
  final channel = MethodChannel(methodName, const StandardMethodCodec(), success.binaryMessenger);
  // 메서드 이름이 실행 중 값이어도 관찰 주소는 실제로 보낸 문자열이다.
  final method = ['e', 'cho'].join();
  if (await channel.invokeMethod<String>(method, 'fixture-private-payload') != 'ok') {
    throw StateError('Method response changed.');
  }
  // 정적 producer가 native helper 변경에서 Dart 소비자까지 전파하는지 확인할 호출 체인이다.
  final chain = recorder('chain', callerForMethod: (method) => method == 'echo'
    ? const RuntimeCaller(path: 'lib/main.dart', line: __STATIC_ECHO_LINE__, column: __STATIC_ECHO_COLUMN__) : null);
  if (await runtimeScreen(chain.binaryMessenger) != 'ok') throw StateError('Dart consumer response changed.');
  await save('chain', chain);
  final basic = BasicMessageChannel<Object?>('dev.flutter.pigeon.runtime_probe.Api.echo', const StandardMessageCodec(),
    binaryMessenger: success.binaryMessenger);
  final reply = await basic.send('fixture-private-payload');
  if (reply is! List || reply.single != 'ok') throw StateError('Basic response changed.');
  // 공개 플러그인의 실제 Pigeon 생성 코드와 네이티브 등록을 사용한다. URL을 열지 않는다.
  final publicApi = public_plugin.UrlLauncherApi(binaryMessenger: success.binaryMessenger);
  final publicResult = await publicApi.canLaunchUrl('https://example.com');
  if (publicResult.error != null) throw StateError('Public Pigeon plugin failed.');
  await save('success', success);

  final failure = recorder('failure');
  final failing = MethodChannel(methodName, const StandardMethodCodec(), failure.binaryMessenger);
  var nativeError = false;
  try { await failing.invokeMethod<void>('failure'); }
  on PlatformException catch (error) { nativeError = error.code == 'fixture-error'; }
  if (!nativeError) throw StateError('Native error was changed.');
  final missing = MethodChannel('example/missing-runtime', const StandardMethodCodec(), failure.binaryMessenger);
  var missingError = false;
  try { await missing.invokeMethod<void>('absent'); }
  on MissingPluginException { missingError = true; }
  if (!missingError) throw StateError('Missing handler was changed.');
  await save('failure', failure);
  final timeout = recorder('timeout', timeout: const Duration(milliseconds: 20));
  final delayed = MethodChannel(methodName, const StandardMethodCodec(), timeout.binaryMessenger);
  // 관찰 timeout이 실제 앱의 Future를 취소하거나 예외로 바꾸면 실패한다.
  if (await delayed.invokeMethod<String>('slow') != 'ok') throw StateError('Delayed response changed.');
  await save('timeout', timeout);

  final pending = recorder('pending');
  final unfinished = MethodChannel(methodName, const StandardMethodCodec(), pending.binaryMessenger);
  unawaited(unfinished.invokeMethod<void>('never'));
  await save('pending', pending);
}

Future<String?> runtimeBridge(BinaryMessenger messenger) {
  final channel = MethodChannel(methodName, const StandardMethodCodec(), messenger);
  return channel.invokeMethod<String>('echo');
}
Future<String?> runtimeService(BinaryMessenger messenger) => runtimeBridge(messenger);
Future<String?> runtimeScreen(BinaryMessenger messenger) => runtimeService(messenger);
`;

const swiftSource = String.raw`
import Cocoa
import FlutterMacOS

class MainFlutterWindow: NSWindow {
  override func awakeFromNib() {
    let controller = FlutterViewController()
    let originalFrame = frame
    contentViewController = controller
    setFrame(originalFrame, display: true)
    RegisterGeneratedPlugins(registry: controller)
    let channel = FlutterMethodChannel(name: "example/native-runtime", binaryMessenger: controller.engine.binaryMessenger)
    channel.setMethodCallHandler { call, result in
      switch call.method {
      case "echo": result(runtimeNativeValue())
      case "failure": result(FlutterError(code: "fixture-error", message: "fixture-private-payload", details: nil))
      case "slow": DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(120)) { result("ok") }
      case "never": break
      default: result(FlutterMethodNotImplemented)
      }
    }
    let basic = FlutterBasicMessageChannel(name: "dev.flutter.pigeon.runtime_probe.Api.echo",
      binaryMessenger: controller.engine.binaryMessenger)
    basic.setMessageHandler { _, reply in reply(["ok"]) }
    super.awakeFromNib()
  }
}
`;

// 브리지 핸들러가 별도 Swift 선언을 호출하는 실제 compiler-index 경계를 만든다.
const swiftHelperSource = String.raw`
func runtimeNativeValue() -> String { "ok" }
`;

// 우리가 생성하는 fixture의 명시된 호출 표현식 위치만 기록한다. 임의 앱의 스택을 추측하지 않는다.
const dartSource = locateCallers(dartSourceTemplate);

function locateCallers(template) {
  const lines = template.split('\n');
  let result = template;
  for (const [name, expression] of [
    ['ECHO', 'channel.invokeMethod<String>(method'],
    ['STATIC_ECHO', "channel.invokeMethod<String>('echo')"],
    ['FAILURE', "failing.invokeMethod<void>('failure')"],
    ['ABSENT', "missing.invokeMethod<void>('absent')"],
    ['SLOW', "delayed.invokeMethod<String>('slow')"],
    ['NEVER', "unfinished.invokeMethod<void>('never')"],
    ['BASIC', 'basic.send('],
    ['PUBLICPIGEON', "publicApi.canLaunchUrl('https://example.com')"],
  ]) {
    const index = lines.findIndex((line) => line.includes(expression));
    assert.ok(index >= 0, 'Fixture caller must exist.');
    const column = Buffer.byteLength(lines[index].slice(0, lines[index].indexOf(expression))) + 1;
    result = result.replaceAll(`__${name}_LINE__`, String(index + 1))
      .replaceAll(`__${name}_COLUMN__`, String(column));
  }
  return result;
}

await verifyNativeRuntime();
