import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChild } from './run-child.mjs';

const [flutterBinary, isthmusOverride] = process.argv.slice(2);
if (flutterBinary === undefined || process.platform !== 'darwin') {
  process.stderr.write('Usage (macOS): verify-flutter-runtime.mjs <flutter-bin> [isthmus-js]\n');
  process.exit(64);
}
const repository = dirname(dirname(fileURLToPath(import.meta.url)));
const packageRoot = join(repository, 'packages/isthmus_runtime');
const isthmus = isthmusOverride ?? join(repository, 'dist/cli/main.js');
const scratch = await mkdtemp(join(tmpdir(), 'isthmus-native-runtime-'));
const artifacts = await mkdtemp(join(tmpdir(), 'isthmus-native-evidence-'));
const appRoot = join(scratch, 'runtime_probe');
const started = performance.now();
const steps = [];
const commandEnvironment = { ...process.env, CI: 'true', FLUTTER_SUPPRESS_ANALYTICS: 'true',
  COCOAPODS_DISABLE_STATS: 'true' };

async function verifyNativeRuntime() {
try {
  if (isthmusOverride === undefined) step('npm', ['run', 'build'], 'isthmus build', repository);
  const version = JSON.parse(step(flutterBinary, ['--version', '--machine'], 'Flutter version').stdout);
  step(flutterBinary, ['create', '--platforms=macos', '--project-name=isthmus_runtime_probe',
    '--no-pub', '--offline', appRoot], 'Flutter app creation');
  const project = await realpath(appRoot);
  await writeFile(join(appRoot, 'pubspec.yaml'), `name: isthmus_runtime_probe\nversion: 1.0.0+1\n`
    + `environment:\n  sdk: '>=3.7.0 <4.0.0'\ndependencies:\n  flutter:\n    sdk: flutter\n`
    + `  isthmus_runtime:\n    path: ${JSON.stringify(packageRoot)}\n`
    + '  url_launcher_macos: 3.2.2\n');
  await writeFile(join(appRoot, 'lib/main.dart'), dartSource);
  await writeFile(join(appRoot, 'macos/Runner/MainFlutterWindow.swift'), swiftSource);
  // 현대 Xcode가 빌드할 수 있는 최소 버전을 전용 앱과 CocoaPods 타깃에 함께 적용한다.
  const projectFile = join(appRoot, 'macos/Runner.xcodeproj/project.pbxproj');
  const originalProject = await readFile(projectFile, 'utf8');
  const updatedProject = originalProject.replace(/MACOSX_DEPLOYMENT_TARGET = [^;]+;/gu, 'MACOSX_DEPLOYMENT_TARGET = 12.0;');
  assert.notEqual(originalProject, updatedProject, 'Fixture deployment targets must be found.');
  await writeFile(projectFile, updatedProject);
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
  const hash = createHash('sha256').update(dartSource).update(swiftSource).update(JSON.stringify({
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
  await writeFile(join(artifacts, 'expectations.json'), JSON.stringify({
    format: 'bridge-expectations', version: 1, project, revision,
    checks: [
      { id: 'method-echo', scenario: 'success', platform: 'macos', instance: 'main',
        transport: 'method-channel', channel: 'example/native-runtime', method: 'echo' },
      { id: 'pigeon-echo', scenario: 'success', platform: 'macos', instance: 'main',
        transport: 'basic-message-channel', channel: 'dev.flutter.pigeon.runtime_probe.Api.echo' },
      { id: 'public-pigeon', scenario: 'success', platform: 'macos', instance: 'main',
        transport: 'basic-message-channel', channel: 'dev.flutter.pigeon.url_launcher_macos.UrlLauncherApi.canLaunchUrl' },
    ],
  }, null, 2), { mode: 0o600 });
  const buildArguments = ['build', 'macos', '--debug', '--no-pub',
    `--dart-define=ISTHMUS_PROJECT=${project}`, `--dart-define=ISTHMUS_REVISION=${revision}`,
    `--dart-define=ISTHMUS_OUTPUT=${artifacts}`];
  step(flutterBinary, buildArguments, 'Native Flutter app build', appRoot, 600_000);
  step(flutterBinary, buildArguments, 'Native Flutter repeat build', appRoot, 600_000);
  const executable = join(appRoot, 'build/macos/Build/Products/Debug/isthmus_runtime_probe.app/Contents/MacOS/isthmus_runtime_probe');
  step(executable, [], 'Native Flutter app execution', appRoot, 60_000);
  const verify = (...names) => runChild(process.execPath, [isthmus, 'verify-runtime',
    '--expectations', join(artifacts, 'expectations.json'), '--strict', '--compact',
    ...names.map((name) => join(artifacts, `${name}.json`))], { timeout: 30_000 });
  const positive = verify('success');
  assert.equal(positive.status, 0, 'Native successful calls must satisfy expectations.');
  const good = JSON.parse(positive.stdout);
  assert.equal(good.summary.passedChecks, 3);
  const negative = verify('success', 'failure', 'timeout');
  assert.equal(negative.status, 1, 'Native failures must fail the CI gate.');
  const bad = JSON.parse(negative.stdout);
  assert.deepEqual(bad.failures.map(({ event }) => event.outcome).sort(), ['error', 'missing-handler', 'timeout'],
    'Missing handler, native error and slow reply must retain distinct outcomes.');
  const incomplete = verify('success', 'pending');
  assert.equal(incomplete.status, 1, 'Unfinished native communication must fail the CI gate.');
  const pending = JSON.parse(incomplete.stdout);
  assert.ok(pending.summary.pendingCalls > 0 || pending.summary.incompleteRuns > 0);
  for (const name of ['success', 'failure', 'timeout', 'pending']) {
    const text = await readFile(join(artifacts, `${name}.json`), 'utf8');
    assert.equal(text.includes('fixture-private-payload'), false, 'Payload must not enter runtime evidence.');
  }
  const summary = { scope: 'real-flutter-macos-native-channels', flutter: version.frameworkVersion,
    dart: version.dartSdkVersion, publicPlugin: 'url_launcher_macos@3.2.2', deploymentTarget: '12.0',
    revision, artifacts, elapsedMs: Math.round(performance.now() - started), steps,
    success: good.summary, failure: bad.summary, pending: pending.summary };
  await writeFile(join(artifacts, 'verification.json'), JSON.stringify(summary, null, 2), { mode: 0o600 });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} finally {
  await rm(scratch, { recursive: true, force: true });
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

IsthmusRuntimeRecorder recorder(String scenario, {Duration? timeout}) => IsthmusRuntimeRecorder(
  messenger: ServicesBinding.instance.defaultBinaryMessenger,
  project: const String.fromEnvironment('ISTHMUS_PROJECT'),
  revision: const String.fromEnvironment('ISTHMUS_REVISION'),
  scenario: scenario, platform: 'macos', runId: scenario, observationTimeout: timeout,
  methodChannels: [
    RuntimeMethodChannel(channel: methodName, codec: const StandardMethodCodec(), callerForMethod: methodCaller),
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
  final basic = BasicMessageChannel<Object?>(basicName, const StandardMessageCodec(),
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
      case "echo": result("ok")
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

// 우리가 생성하는 fixture의 명시된 호출 표현식 위치만 기록한다. 임의 앱의 스택을 추측하지 않는다.
const dartSource = locateCallers(dartSourceTemplate);

function locateCallers(template) {
  const lines = template.split('\n');
  let result = template;
  for (const [name, expression] of [
    ['ECHO', 'channel.invokeMethod<String>(method'],
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
