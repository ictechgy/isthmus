import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChild } from './run-child.mjs';
import { describeBuildFailure, throwHarnessFailures } from './runtime-harness-failures.mjs';

// 소유한 시뮬레이터 또는 명시적으로 선택한 테스트 iPhone에서만 검증한다.
const positional = process.argv.slice(2).filter((value) => !value.startsWith('--'));
const options = process.argv.slice(2).filter((value) => value.startsWith('--'));
const [flutterArg, cliArg] = positional;
const physical = options.includes('--physical');
const release = options.includes('--release');
const teamOption = options.find((value) => value.startsWith('--team='));
const team = teamOption?.slice('--team='.length);
if (!flutterArg || positional.length > 2 || new Set(options).size !== options.length ||
    options.some((value) => !['--physical', '--release', teamOption].includes(value)) ||
    release && !physical || teamOption !== undefined && (!physical || !/^[A-Z0-9]{10}$/u.test(team))) {
  process.stderr.write('Usage: verify-flutter-ios-runtime.mjs <flutter-bin> [isthmus-js] [--physical --release --team=TEAM_ID]\n');
  process.exit(64);
}
const repository = dirname(dirname(fileURLToPath(import.meta.url)));
const flutter = await realpath(flutterArg);
const cli = await realpath(cliArg ?? join(repository, 'dist/cli/main.js'));
const evidence = await realpath(await mkdtemp(join(tmpdir(), 'isthmus-ios-evidence-')));
const scratch = await realpath(await mkdtemp(join(tmpdir(), 'isthmus-ios-runtime-')));
const project = join(scratch, 'app');
const bundle = physical ? 'com.isthmus.iosPhysicalProbe' : 'com.example.isthmusIosProbe';
const method = 'example/ios-runtime';
const basic = 'dev.flutter.pigeon.ios_probe.Api.echo';
const steps = [];
let simulator;
let device;
let installed = false;
let installAttempted = false;
let primaryFailure;
let runtimeVersion;
let summary;
function run(command, args, label, cwd = project, expected = 0, timeout = 180_000) {
  const start = performance.now();
  const result = runChild(command, args, { cwd, timeout, maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, CI: 'true', FLUTTER_SUPPRESS_ANALYTICS: 'true' } });
  steps.push({ label, exit: result.status, milliseconds: Math.round(performance.now() - start) });
  process.stderr.write(`iOS verification: ${label} (${result.status})\n`);
  if (result.status !== expected || result.error) {
    if (command === flutter && physical) return save(join(evidence, 'build-failure.json'), JSON.stringify(describeBuildFailure(label, result))).then(() => {
      throw new Error(`${label} failed; evidence: ${evidence}`);
    });
    // 기기 목록이나 앱의 임의 출력은 진단에 복사하지 않는다.
    if (command === flutter && !physical) {
      const text = (result.stdout + '\n' + result.stderr).replace(/https?:\/\/\S+/gu, '[URL omitted]');
      return writeFile(join(evidence, 'build-failure.log'), text, { mode: 0o600 }).then(() => {
        throw new Error(`${label} failed; evidence: ${evidence}`);
      });
    }
    throw new Error(`${label} failed; evidence: ${evidence}`);
  }
  return result.stdout;
}
async function save(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value, { mode: 0o600 });
}

async function preserveFixture() {
  await cp(project, join(evidence, 'fixture'), { recursive: true,
    filter: (source) => !relative(project, source).split('/').some((part) => ['build', '.dart_tool', '.git', 'Pods', '.symlinks', 'xcuserdata'].includes(part)) });
  if (physical) {
    const archivedPbx = join(evidence, 'fixture/ios/Runner.xcodeproj/project.pbxproj');
    await save(archivedPbx, (await readFile(archivedPbx, 'utf8')).replace(/DEVELOPMENT_TEAM = [^;]+;/gu, 'DEVELOPMENT_TEAM = TEAM_ID;'));
  }
}

const dart = String.raw`import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:isthmus_runtime/isthmus_runtime.dart';

IsthmusRuntimeRecorder recorder(String scenario, {Duration? timeout}) => IsthmusRuntimeRecorder(
  messenger: ServicesBinding.instance.defaultBinaryMessenger,
  project: const String.fromEnvironment('ISTHMUS_PROJECT'), revision: const String.fromEnvironment('ISTHMUS_REVISION'),
  scenario: scenario, platform: 'ios', runId: scenario, observationTimeout: timeout,
  methodChannels: [RuntimeMethodChannel(channel: 'example/ios-runtime', codec: const StandardMethodCodec()),
    RuntimeMethodChannel(channel: 'example/ios-missing', codec: const StandardMethodCodec())],
  basicMessageChannels: [RuntimeBasicMessageChannel(channel: 'dev.flutter.pigeon.ios_probe.Api.echo',
    replyCodec: const StandardMessageCodec(), replyOutcome: (reply) => reply is List && reply.single == 'ios-ok'
      ? RuntimeOutcome.success : RuntimeOutcome.error)],
);
Future<void> save(String name, IsthmusRuntimeRecorder value) async {
  final file = File('$output/$name.json');
  await file.parent.create(recursive: true);
  final pending = File('$output/$name.pending');
  await pending.writeAsString(value.finish().encode(), flush: true);
  await pending.rename(file.path);
}
late String output;
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const Directionality(textDirection: TextDirection.ltr, child: SizedBox.shrink()));
  // 앱이 자기 sandbox 경로를 결정한다. 기기 경로나 식별자를 기록하지 않는다.
  output = await const MethodChannel('example/ios-probe-storage').invokeMethod<String>('path') ?? '';
  if (output.isEmpty) throw StateError('missing output');
  await Directory(output).create(recursive: true);
  await File('$output/build-mode.json').writeAsString(jsonEncode({'product': const bool.fromEnvironment('dart.vm.product')}), flush: true);
  final success = recorder('success');
  final channel = MethodChannel('example/ios-runtime', const StandardMethodCodec(), success.binaryMessenger);
  if (await channel.invokeMethod<String>('echo', 'fixture-private-payload') != 'ios-ok') throw StateError('echo');
  final basic = BasicMessageChannel<Object?>('dev.flutter.pigeon.ios_probe.Api.echo', const StandardMessageCodec(), binaryMessenger: success.binaryMessenger);
  final reply = await basic.send('fixture-private-payload');
  if (reply is! List || reply.single != 'ios-ok') throw StateError('basic');
  await save('success', success);
  final failure = recorder('failure');
  final failing = MethodChannel('example/ios-runtime', const StandardMethodCodec(), failure.binaryMessenger);
  var errorObserved = false;
  try { await failing.invokeMethod<void>('failure'); } on PlatformException catch (error) { errorObserved = error.code == 'fixture-error'; }
  if (!errorObserved) throw StateError('native error');
  final missing = MethodChannel('example/ios-missing', const StandardMethodCodec(), failure.binaryMessenger);
  var missingObserved = false;
  try { await missing.invokeMethod<void>('absent'); } on MissingPluginException { missingObserved = true; }
  if (!missingObserved) throw StateError('missing handler');
  await save('failure', failure);
  final timeout = recorder('timeout', timeout: const Duration(milliseconds: 20));
  final slow = MethodChannel('example/ios-runtime', const StandardMethodCodec(), timeout.binaryMessenger);
  if (await slow.invokeMethod<String>('slow') != 'ios-ok') throw StateError('slow');
  await save('timeout', timeout);
  final pending = recorder('pending');
  final unfinished = MethodChannel('example/ios-runtime', const StandardMethodCodec(), pending.binaryMessenger);
  unawaited(unfinished.invokeMethod<void>('never'));
  await Future<void>.delayed(const Duration(milliseconds: 50));
  await save('pending', pending);
}
`;
const swift = String.raw`import Flutter
import UIKit

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  private var markers: [String] = []
  private var output: URL { FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("isthmus-runtime") }
  private func mark(_ name: String) {
    markers.append(name)
    do {
      try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
      try markers.joined(separator: "\n").write(to: output.appendingPathComponent("swift-handlers.txt"), atomically: true, encoding: .utf8)
    } catch { fatalError("Fixture evidence could not be written") }
  }
  func didInitializeImplicitFlutterEngine(_ bridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: bridge.pluginRegistry)
    let messenger = bridge.applicationRegistrar.messenger()
    FlutterMethodChannel(name: "example/ios-probe-storage", binaryMessenger: messenger).setMethodCallHandler { [self] call, reply in
      reply(call.method == "path" ? output.path : FlutterMethodNotImplemented)
    }
    FlutterMethodChannel(name: "example/ios-runtime", binaryMessenger: messenger).setMethodCallHandler { [self] call, reply in
      mark(call.method)
      switch call.method {
      case "echo": reply("ios-ok")
      case "failure": reply(FlutterError(code: "fixture-error", message: "fixture-private-payload", details: nil))
      case "slow": DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) { reply("ios-ok") }
      case "never": break
      default: reply(FlutterMethodNotImplemented)
      }
    }
    FlutterBasicMessageChannel(name: "dev.flutter.pigeon.ios_probe.Api.echo", binaryMessenger: messenger, codec: FlutterStandardMessageCodec.sharedInstance())
      .setMessageHandler { [self] _, reply in mark("basic"); reply(["ios-ok"]) }
  }
}
`;

try {
  await mkdir(project);
  if (physical) {
    const list = JSON.parse(await run('xcrun', ['devicectl', 'list', 'devices', '--json-output', '-', '--quiet', '--timeout', '20'], 'Discover test iPhone'));
    const candidates = list.result.devices.filter((item) => {
      const hardware = item.properties?.hardware ?? item.hardwareProperties;
      return hardware?.deviceType === 'iPhone' && hardware.reality === 'physical';
    });
    assert.equal(candidates.length, 1, 'Exactly one paired physical iPhone is required.');
    device = candidates[0].identifier;
    const osVersion = (candidates[0].properties?.software ?? candidates[0].deviceProperties).osVersionNumber;
    runtimeVersion = typeof osVersion === 'string' ? osVersion : osVersion?.stringValue;
    assert.ok(typeof runtimeVersion === 'string' && /^\d+(\.\d+)*$/u.test(runtimeVersion), 'Unsupported iPhone OS version metadata.');
    const state = candidates[0].properties?.state ?? candidates[0].deviceProperties;
    assert.ok(state?.developerModeStatus === 'enabled' || state?.developerModeStatus?.enabled?.mode === 1,
      'The test iPhone must have Developer Mode enabled.');
    const apps = JSON.parse(await run('xcrun', ['devicectl', 'device', 'info', 'apps', '--device', device, '--bundle-id', bundle, '--json-output', '-', '--quiet', '--timeout', '20'], 'Check fixture ownership'));
    assert.equal(apps.result.apps.length, 0, 'Refusing to replace a preexisting iPhone fixture.');
  }
  const version = JSON.parse(await run(flutter, ['--version', '--machine'], 'Flutter version'));
  await run(flutter, ['create', '--platforms=ios', '--project-name=isthmus_ios_probe', '--no-pub', '--offline', project], 'Create fixture');
  await save(join(project, 'pubspec.yaml'), `name: isthmus_ios_probe\nversion: 1.0.0+1\nenvironment:\n  sdk: '>=3.7.0 <4.0.0'\ndependencies:\n  flutter:\n    sdk: flutter\n  isthmus_runtime:\n    path: ${JSON.stringify(join(repository, 'packages/isthmus_runtime'))}\nflutter:\n  config:\n    enable-swift-package-manager: false\n`);
  await save(join(project, 'lib/main.dart'), dart);
  await save(join(project, 'ios/Runner/AppDelegate.swift'), swift);
  if (physical) {
    const pbx = join(project, 'ios/Runner.xcodeproj/project.pbxproj');
    let contents = (await readFile(pbx, 'utf8')).replaceAll('com.example.isthmusIosProbe', bundle);
    if (team) contents = contents.replaceAll('PRODUCT_BUNDLE_IDENTIFIER =', `DEVELOPMENT_TEAM = ${team};\n\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER =`);
    await save(pbx, contents);
  }
  const revision = 'sha256:' + createHash('sha256').update(dart).update(swift)
    .update(await readFile(join(repository, 'packages/isthmus_runtime/lib/src/runtime_recorder.dart'))).update(version.frameworkRevision).digest('hex');
  await preserveFixture();
  await run(flutter, ['pub', 'get'], 'Resolve fixture');
  await run(flutter, ['build', 'ios', ...(physical ? [] : ['--simulator']), release ? '--release' : '--debug', '--no-pub', `--dart-define=ISTHMUS_PROJECT=${project}`, `--dart-define=ISTHMUS_REVISION=${revision}`], 'Build iOS fixture', project, 0, 600_000);
  let recordings;
  if (physical) {
    const apps = JSON.parse(await run('xcrun', ['devicectl', 'device', 'info', 'apps', '--device', device, '--bundle-id', bundle, '--json-output', '-', '--quiet', '--timeout', '20'], 'Recheck fixture ownership'));
    assert.equal(apps.result.apps.length, 0, 'Fixture appeared during the build; refusing to replace it.');
    installAttempted = true;
    await run('xcrun', ['devicectl', 'device', 'install', 'app', '--device', device, join(project, 'build/ios/iphoneos/Runner.app'), '--quiet', '--timeout', '120'], 'Install owned iPhone fixture');
    installed = true;
    await run('xcrun', ['devicectl', 'device', 'process', 'launch', '--device', device, bundle, '--quiet', '--timeout', '30'], 'Launch iPhone fixture');
    recordings = join(scratch, 'recordings');
    await mkdir(recordings);
  } else {
    const runtimes = JSON.parse(await run('xcrun', ['simctl', 'list', 'runtimes', '--json'], 'Discover iOS runtime')).runtimes;
    const runtime = runtimes.filter((item) => item.isAvailable && item.identifier.includes('SimRuntime.iOS')).at(-1);
    assert.ok(runtime, 'An installed iOS simulator runtime is required.');
    runtimeVersion = runtime.version;
    const types = JSON.parse(await run('xcrun', ['simctl', 'list', 'devicetypes', '--json'], 'Discover simulator type')).devicetypes;
    const runtimeNumber = runtime.version.split('.').reduce((v, part, index) => v + Number(part) * 2 ** (16 - index * 8), 0);
    const type = types.filter((item) => item.name.startsWith('iPhone') && item.minRuntimeVersion <= runtimeNumber && item.maxRuntimeVersion >= runtimeNumber).at(-1);
    assert.ok(type, 'A compatible iPhone simulator type is required.');
    simulator = (await run('xcrun', ['simctl', 'create', 'isthmus-owned-ios-probe', type.identifier, runtime.identifier], 'Create owned simulator')).trim();
    assert.match(simulator, /^[0-9A-F-]{36}$/iu);
    await run('xcrun', ['simctl', 'boot', simulator], 'Boot owned simulator');
    await run('xcrun', ['simctl', 'bootstatus', simulator, '-b'], 'Wait for simulator', project, 0, 180_000);
    await run('xcrun', ['simctl', 'install', simulator, join(project, 'build/ios/iphonesimulator/Runner.app')], 'Install fixture');
    await run('xcrun', ['simctl', 'launch', simulator, bundle], 'Launch fixture');
    const container = (await run('xcrun', ['simctl', 'get_app_container', simulator, bundle, 'data'], 'Locate fixture data')).trim();
    recordings = join(container, 'Documents/isthmus-runtime');
  }
  const deadline = Date.now() + 120_000;
  for (;;) {
    if (physical) {
      // 테스트 앱의 sandbox만 복사하며 다른 앱/기기 정보는 보존하지 않는다.
      runChild('xcrun', ['devicectl', 'device', 'copy', 'from', '--device', device,
        '--domain-type', 'appDataContainer', '--domain-identifier', bundle,
        '--source', 'Documents/isthmus-runtime/', '--destination', recordings, '--quiet', '--timeout', '10'], { timeout: 15_000 });
    }
    try { await access(join(recordings, 'pending.json')); break; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    assert.ok(Date.now() < deadline, `iOS probe did not complete; evidence: ${evidence}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const documents = {};
  const mode = JSON.parse(await readFile(join(recordings, 'build-mode.json'), 'utf8'));
  assert.equal(mode.product, release, 'Observed Dart product mode must match the requested build mode.');
  await save(join(evidence, 'build-mode.json'), JSON.stringify(mode));
  for (const name of ['success', 'failure', 'timeout', 'pending']) {
    const bytes = await readFile(join(recordings, name + '.json'), 'utf8');
    assert.ok(!bytes.includes('fixture-private-payload'));
    documents[name] = JSON.parse(bytes);
    assert.equal(documents[name].run.platform, 'ios');
    await save(join(evidence, name + '.json'), bytes);
  }
  const markers = await readFile(join(recordings, 'swift-handlers.txt'), 'utf8');
  assert.deepEqual(markers.split('\n'), ['echo', 'basic', 'failure', 'slow', 'never']);
  await save(join(evidence, 'swift-handlers.txt'), markers);
  const checks = [{ id: 'ios-echo', scenario: 'success', platform: 'ios', instance: 'main', transport: 'method-channel', channel: method, method: 'echo' },
    { id: 'ios-basic', scenario: 'success', platform: 'ios', instance: 'main', transport: 'basic-message-channel', channel: basic }];
  const expectations = join(evidence, 'expectations.json');
  await save(expectations, JSON.stringify({ format: 'bridge-expectations', version: 1, project, revision, checks }));
  const verify = async (names, expected) => JSON.parse(await run(process.execPath, [cli, 'verify-runtime', '--expectations', expectations, '--strict', '--compact', ...names.map((name) => join(evidence, name + '.json'))], 'Verify ' + names.join('/'), project, expected));
  const positive = await verify(['success'], 0);
  const negative = await verify(['success', 'failure', 'timeout'], 1);
  assert.deepEqual(negative.failures.map(({ event }) => event.outcome).sort(), ['error', 'missing-handler', 'timeout']);
  const incomplete = await verify(['success', 'pending'], 1);
  assert.ok(incomplete.summary.pendingCalls > 0);
  assert.equal(documents.pending.run.status, 'incomplete');
  await preserveFixture();
  summary = { scope: 'real-flutter-ios-native-channels', flutter: version.frameworkVersion, runtime: runtimeVersion,
    deviceKind: physical ? 'physical' : 'simulator', buildMode: release ? 'release' : 'debug', observedProductMode: mode.product, swiftHandlers: markers.split('\n'), success: positive.summary,
    negativeOutcomes: ['error', 'missing-handler', 'timeout'], pending: 'incomplete',
    limitations: [physical ? 'One physical iPhone and the reported build mode; other devices and lifecycle variants remain untested.' : 'One owned iOS simulator in debug mode; physical iPhone, iOS release and lifecycle variants are untested.',
      'Explicit fixture Method/Basic routes only; no public iOS plugin or static producer completeness claim.'], evidence };
  await save(join(evidence, 'verification.json'), JSON.stringify(summary, null, 2) + '\n');
} catch (error) {
  primaryFailure = error;
} finally {
  const cleanup = {};
  const failures = [];
  if (installAttempted && !installed) {
    try {
      const apps = JSON.parse(await run('xcrun', ['devicectl', 'device', 'info', 'apps', '--device', device, '--bundle-id', bundle, '--json-output', '-', '--quiet', '--timeout', '20'], 'Check interrupted installation'));
      assert.ok(Array.isArray(apps.result.apps), 'Unsupported iPhone app metadata.');
      installed = apps.result.apps.length > 0;
      cleanup.interruptedInstallPresent = installed;
    } catch { failures.push(new Error(`Unable to confirm interrupted iPhone installation; evidence: ${evidence}`)); }
  }
  if (installed) {
    cleanup.uninstall = runChild('xcrun', ['devicectl', 'device', 'uninstall', 'app', '--device', device, bundle, '--quiet', '--timeout', '30'], { timeout: 60_000 }).status;
    if (cleanup.uninstall !== 0) failures.push(new Error(`Owned iPhone fixture cleanup failed; evidence: ${evidence}`));
  }
  if (simulator) {
    for (const action of ['shutdown', 'delete']) cleanup[action] = runChild('xcrun', ['simctl', action, simulator], { timeout: 60_000 }).status;
  }
  if (simulator !== undefined && cleanup.delete !== 0) failures.push(new Error(`Owned iOS simulator cleanup failed; evidence: ${evidence}`));
  try {
    await save(join(evidence, 'steps.json'), JSON.stringify(steps, null, 2));
    await save(join(evidence, 'cleanup.json'), JSON.stringify(cleanup));
    await rm(scratch, { recursive: true, force: true });
  } catch (error) { failures.push(error); }
  throwHarnessFailures(primaryFailure, failures);
}
process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
