import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, openSync, writeFileSync } from 'node:fs';
import { access, cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, tmpdir } from 'node:os';
import { runChild } from './run-child.mjs';
import { stopDetachedProcess } from './stop-detached-process.mjs';

// This is an Android counterpart to verify-flutter-runtime.mjs. It deliberately
// owns a disposable fixture app and observes only explicitly configured routes.
const parsedArguments = parseArguments(process.argv.slice(2));
const [flutterBinary, adbBinary, isthmusOverride, requestedDevice] = parsedArguments.positionals;
const kartographArgument = parsedArguments.options.kartograph;
const dartographArgument = parsedArguments.options.dartograph;
if (flutterBinary === undefined || adbBinary === undefined || parsedArguments.invalid ||
  (kartographArgument !== undefined) !== (dartographArgument !== undefined)) {
  process.stderr.write('Usage (Android): verify-flutter-android-runtime.mjs <flutter-bin> <adb> [isthmus-js] [device-id] '
    + '[--kartograph <bin> --dartograph <AOT>]\n');
  process.exit(64);
}
const kartographBinary = kartographArgument === undefined ? undefined : await realpath(kartographArgument);
const dartographBinary = dartographArgument === undefined ? undefined : await realpath(dartographArgument);

function parseArguments(arguments_) {
  const positionals = [];
  const options = {};
  let invalid = false;
  for (let index = 0; index < arguments_.length; index++) {
    const value = arguments_[index];
    if (!value.startsWith('--')) { positionals.push(value); continue; }
    const key = value === '--kartograph' ? 'kartograph' : value === '--dartograph' ? 'dartograph' : undefined;
    if (key === undefined || options[key] !== undefined || index + 1 >= arguments_.length || arguments_[index + 1].startsWith('-')) {
      invalid = true;
      continue;
    }
    options[key] = arguments_[++index];
  }
  if (positionals.length < 2 || positionals.length > 4) invalid = true;
  return { positionals, options, invalid };
}

const repository = dirname(dirname(fileURLToPath(import.meta.url)));
const packageRoot = join(repository, 'packages/isthmus_runtime');
const publicPluginSource = process.env.ISTHMUS_SHARED_PREFERENCES_ANDROID ??
  join(process.env.PUB_CACHE ?? join(homedir(), '.pub-cache'), 'hosted/pub.dev/shared_preferences_android-2.4.1');
const isthmus = isthmusOverride ?? join(repository, 'dist/cli/main.js');
const packageName = 'com.example.isthmus_runtime_probe';
const activity = `${packageName}/.MainActivity`;
const basicName = 'dev.flutter.pigeon.runtime_probe.Api.echo';
const methodName = 'example/native-runtime';
const publicPigeonChannel = 'dev.flutter.pigeon.shared_preferences_android.SharedPreferencesAsyncApi.getBool.data_store';
const inferredSdkRoot = dirname(dirname(adbBinary));
const sdkRoot = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? inferredSdkRoot;
const emulatorBinary = join(sdkRoot, 'emulator/emulator');
const avdManager = join(sdkRoot, 'cmdline-tools/latest/bin/avdmanager');
const javaHome = process.env.JAVA_HOME;
const commandEnvironment = {
  ...process.env,
  ANDROID_HOME: sdkRoot,
  ANDROID_SDK_ROOT: sdkRoot,
  ...(javaHome === undefined ? {} : { JAVA_HOME: javaHome }),
  PATH: `${javaHome === undefined ? '' : `${javaHome}/bin:`}${sdkRoot}/platform-tools:${sdkRoot}/emulator:${process.env.PATH ?? ''}`,
  CI: 'true',
  FLUTTER_SUPPRESS_ANALYTICS: 'true',
};
const started = performance.now();
const steps = [];
const scratch = await mkdtemp(join(tmpdir(), 'isthmus-android-runtime-'));
const artifacts = await mkdtemp(join(tmpdir(), 'isthmus-android-evidence-'));
let emulatorProcess;
let emulatorId;
let ownedAvdName;
let ownedEmulator = false;
let installedByHarness = false;
let deviceProfile;

function step(command, args, label, cwd = repository, timeout = 180_000) {
  const begin = performance.now();
  const result = runChild(command, args, { cwd, timeout, env: commandEnvironment, maxBuffer: 32 * 1024 * 1024 });
  const elapsedMs = Math.round(performance.now() - begin);
  steps.push({ name: label, executable: command, arguments: [...args], elapsedMs, exitCode: result.status });
  writeDiagnostic(join(artifacts, 'steps.json'), JSON.stringify(steps, null, 2));
  process.stderr.write(`Android verification: ${label} (${elapsedMs} ms)\n`);
  if (result.status !== 0 || result.error !== undefined) {
    const diagnostic = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.replace(/https?:\/\/[^\s]+/gu, '[URL omitted]');
    writeDiagnostic(join(artifacts, `${safeName(label)}.log`), diagnostic);
    throw new Error(`${label} failed (exit ${result.status ?? 'unavailable'}). Evidence: ${artifacts}`);
  }
  return result;
}

function writeDiagnostic(path, value) {
  try {
    writeFileSync(path, value, { mode: 0o600 });
  } catch {
    process.stderr.write(`Could not preserve Android diagnostic; evidence directory: ${artifacts}\n`);
  }
}

function safeName(value) { return value.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, ''); }

function adb(args, label, timeout = 60_000) {
  return step(adbBinary, (emulatorId === undefined ? [] : ['-s', emulatorId]).concat(args), label, repository, timeout);
}

function adbRaw(args, label, timeout = 60_000) {
  return step(adbBinary, args, label, repository, timeout);
}

function availableDevices() {
  const result = step(adbBinary, ['devices'], 'ADB device discovery');
  return result.stdout.split(/\r?\n/u).slice(1)
    .map((line) => line.trim().split(/\s+/u))
    .filter((parts) => parts.length >= 2 && parts[1] === 'device')
    .map(([id]) => id);
}

async function waitFor(predicate, label, timeout = 180_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error(`${label} timed out. Evidence: ${artifacts}`);
}

async function findAvailableEmulatorPort() {
  for (let port = 5554; port <= 5584; port += 2) {
    const servers = [createServer(), createServer()];
    try {
      for (const [index, server] of servers.entries()) await new Promise((resolve, reject) => {
        server.once('error', reject); server.listen(port + index, '127.0.0.1', resolve);
      });
      return port;
    } catch (error) {
      if (error.code !== 'EADDRINUSE') throw error;
    } finally {
      await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
    }
  }
  throw new Error('No available Android emulator port in 5554..5584.');
}

async function createAndStartEmulator() {
  if (process.platform !== 'darwin' && process.platform !== 'linux') throw new Error('Android fixture requires macOS or Linux host.');
  const androidUserHome = join(scratch, 'android-user');
  const avdHome = join(androidUserHome, 'avd');
  const avdName = `isthmus-disposable-${basename(scratch).slice(-8)}`;
  ownedAvdName = avdName;
  const env = { ...commandEnvironment, ANDROID_USER_HOME: androidUserHome, ANDROID_AVD_HOME: avdHome };
  const abi = process.arch === 'arm64' ? 'arm64-v8a' : 'x86_64';
  const image = process.env.ISTHMUS_ANDROID_SYSTEM_IMAGE ?? `system-images;android-36;google_apis_playstore;${abi}`;
  const made = spawnSync(avdManager, ['create', 'avd', '--name', avdName, '--package', image, '--device', 'pixel_2'], {
    env, cwd: repository, timeout: 120_000, maxBuffer: 8 * 1024 * 1024, input: 'no\n', encoding: 'utf8',
  });
  if (made.status !== 0) throw new Error(`Disposable Android AVD creation failed. ${made.stderr ?? ''}`);
  const avdConfig = join(avdHome, `${avdName}.avd/config.ini`);
  const configText = await readFile(avdConfig, 'utf8');
  const boundedConfig = configText.includes('disk.dataPartition.size=')
    ? configText.replace(/^disk\.dataPartition\.size=.*$/mu, 'disk.dataPartition.size=4096M')
    : `${configText}\ndisk.dataPartition.size=4096M\n`;
  await writeFile(avdConfig, boundedConfig, { mode: 0o600 });
  const port = await findAvailableEmulatorPort();
  emulatorId = `emulator-${port}`;
  const logPath = join(artifacts, 'emulator.log');
  const output = openSync(logPath, 'w', 0o600);
  emulatorProcess = spawn(emulatorBinary, ['-avd', avdName, '-no-snapshot', '-no-boot-anim', '-no-window', '-gpu', 'swiftshader_indirect', '-port', String(port)], {
    env, cwd: repository, detached: true, stdio: ['ignore', output, output],
  });
  closeSync(output);
  emulatorProcess.unref();
}

async function selectDevice() {
  adbRaw(['start-server'], 'ADB server start');
  const devices = availableDevices();
  if (requestedDevice !== undefined) {
    if (!devices.includes(requestedDevice)) {
      const listed = step(adbBinary, ['devices'], 'Requested Android device check').stdout.trim();
      throw new Error(`Requested Android device is unavailable: ${requestedDevice}. ${listed}`);
    }
    emulatorId = requestedDevice;
  } else if (devices.length > 0) {
    emulatorId = devices[0];
  } else {
    await createAndStartEmulator();
    await waitFor(() => {
      const result = runChild(adbBinary, ['devices'], { env: commandEnvironment, cwd: repository, timeout: 10_000 });
      return result.stdout.split(/\r?\n/u).some((line) => line.startsWith(`${emulatorId}\tdevice`));
    }, 'Android emulator connection', 180_000);
  }
  await waitFor(() => {
    const result = runChild(adbBinary, ['-s', emulatorId, 'shell', 'getprop', 'sys.boot_completed'], { env: commandEnvironment, cwd: repository, timeout: 10_000 });
    return result.status === 0 && result.stdout.trim() === '1';
  }, 'Android boot completion', 180_000);
  if (emulatorProcess !== undefined) {
    const avd = adb(['shell', 'getprop', 'ro.boot.qemu.avd_name'], 'Confirm disposable Android AVD ownership').stdout.trim();
    await writeFile(join(artifacts, 'avd-identity.json'), JSON.stringify({ expected: ownedAvdName,
      matched: avd === ownedAvdName, observedNamePresent: avd.length > 0,
      observedNameHash: createHash('sha256').update(avd).digest('hex') }, null, 2), { mode: 0o600 });
    if (avd !== ownedAvdName) {
      await cp(join(scratch, 'android-user/avd', `${ownedAvdName}.avd/config.ini`), join(artifacts, 'owned-avd-config.ini'));
      throw new Error('Android emulator identity did not match the disposable AVD; refusing device operations.');
    }
    ownedEmulator = true;
  }
  const profile = adb(['shell', 'getprop'], 'Android device profile').stdout;
  const property = (name) => profile.match(new RegExp(`^\\[${name}\\]: \\[(.*?)\\]$`, 'mu'))?.[1] ?? 'unknown';
  deviceProfile = { apiLevel: property('ro.build.version.sdk'), release: property('ro.build.version.release'), abi: property('ro.product.cpu.abi') };
}

const dartTemplate = String.raw`
import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:isthmus_runtime/isthmus_runtime.dart';
import 'package:shared_preferences_android/src/messages_async.g.dart' as shared_preferences;

const methodName = 'example/native-runtime';
const basicName = 'dev.flutter.pigeon.runtime_probe.Api.echo';
const publicPigeonName = 'dev.flutter.pigeon.shared_preferences_android.SharedPreferencesAsyncApi.getBool.data_store';

RuntimeCaller? callerForMethod(String method) => switch (method) {
  'echo' => const RuntimeCaller(path: 'lib/main.dart', line: __ECHO_LINE__, column: __ECHO_COLUMN__),
  'failure' => const RuntimeCaller(path: 'lib/main.dart', line: __FAILURE_LINE__, column: __FAILURE_COLUMN__),
  'absent' => const RuntimeCaller(path: 'lib/main.dart', line: __ABSENT_LINE__, column: __ABSENT_COLUMN__),
  'slow' => const RuntimeCaller(path: 'lib/main.dart', line: __SLOW_LINE__, column: __SLOW_COLUMN__),
  'never' => const RuntimeCaller(path: 'lib/main.dart', line: __NEVER_LINE__, column: __NEVER_COLUMN__),
  _ => null,
};

IsthmusRuntimeRecorder recorder(String scenario, {Duration? timeout}) => IsthmusRuntimeRecorder(
  messenger: ServicesBinding.instance.defaultBinaryMessenger,
  project: const String.fromEnvironment('ISTHMUS_PROJECT'),
  revision: const String.fromEnvironment('ISTHMUS_REVISION'),
  scenario: scenario, platform: 'android', runId: scenario, observationTimeout: timeout,
  methodChannels: [RuntimeMethodChannel(channel: methodName, codec: const StandardMethodCodec(), callerForMethod: callerForMethod),
    RuntimeMethodChannel(channel: 'example/missing-runtime', codec: const StandardMethodCodec(), callerForMethod: callerForMethod)],
  basicMessageChannels: [RuntimeBasicMessageChannel(channel: basicName,
    replyCodec: const StandardMessageCodec(), caller: const RuntimeCaller(path: 'lib/main.dart', line: __BASIC_LINE__, column: __BASIC_COLUMN__), replyOutcome: pigeonOutcome),
    RuntimeBasicMessageChannel(channel: publicPigeonName,
      replyCodec: shared_preferences.SharedPreferencesAsyncApi.pigeonChannelCodec,
      caller: const RuntimeCaller(path: 'lib/main.dart', line: __PUBLIC_PIGEON_LINE__, column: __PUBLIC_PIGEON_COLUMN__),
      replyOutcome: publicPigeonOutcome)],
);

RuntimeOutcome pigeonOutcome(Object? reply) => reply == null ? RuntimeOutcome.missingHandler
  : reply is List && reply.length == 1 && reply.single == 'android-ok' ? RuntimeOutcome.success : RuntimeOutcome.error;
RuntimeOutcome publicPigeonOutcome(Object? reply) => reply == null ? RuntimeOutcome.missingHandler
  : reply is List && reply.length == 1 ? RuntimeOutcome.success : RuntimeOutcome.error;

Future<void> save(String name, IsthmusRuntimeRecorder value) async {
  final output = const String.fromEnvironment('ISTHMUS_OUTPUT');
  final file = File('$output/$name.json');
  await file.parent.create(recursive: true);
  await file.writeAsString(value.finish().encode(), flush: true);
}

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const Directionality(textDirection: TextDirection.ltr, child: SizedBox.shrink()));
  try {
    final success = recorder('success');
    final channel = MethodChannel(methodName, const StandardMethodCodec(), success.binaryMessenger);
    final method = ['e', 'cho'].join();
    if (await channel.invokeMethod<String>(method, 'fixture-private-payload') != 'android-ok') throw StateError('method');
    final basic = BasicMessageChannel<Object?>(basicName, const StandardMessageCodec(), binaryMessenger: success.binaryMessenger);
    final reply = await basic.send('fixture-private-payload');
    if (reply is! List || reply.single != 'android-ok') throw StateError('basic');
    final publicApi = shared_preferences.SharedPreferencesAsyncApi(
      binaryMessenger: success.binaryMessenger, messageChannelSuffix: 'data_store');
    final publicValue = await publicApi.getBool(
      'isthmus_runtime_probe_unique_key',
      shared_preferences.SharedPreferencesPigeonOptions(fileName: 'isthmus_runtime_probe_unique_file', useDataStore: false));
    if (publicValue != null) throw StateError('public Pigeon value');
    await save('success', success);

    final failure = recorder('failure');
    final failing = MethodChannel(methodName, const StandardMethodCodec(), failure.binaryMessenger);
    var nativeError = false;
    try { await failing.invokeMethod<void>('failure'); } on PlatformException catch (error) { nativeError = error.code == 'fixture-error'; }
    if (!nativeError) throw StateError('error');
    final missing = MethodChannel('example/missing-runtime', const StandardMethodCodec(), failure.binaryMessenger);
    var missingError = false;
    try { await missing.invokeMethod<void>('absent'); } on MissingPluginException { missingError = true; }
    if (!missingError) throw StateError('missing');
    await save('failure', failure);

    final timeout = recorder('timeout', timeout: const Duration(milliseconds: 20));
    final delayed = MethodChannel(methodName, const StandardMethodCodec(), timeout.binaryMessenger);
    if (await delayed.invokeMethod<String>('slow') != 'android-ok') throw StateError('slow');
    await save('timeout', timeout);

    final pending = recorder('pending');
    final unfinished = MethodChannel(methodName, const StandardMethodCodec(), pending.binaryMessenger);
    unawaited(unfinished.invokeMethod<void>('never'));
    await save('pending', pending);
    exit(0);
  } catch (_) {
    stderr.writeln('Android runtime probe failed.');
    exit(1);
  }
}
`;

const kotlinSource = `package com.example.isthmus_runtime_probe

import android.os.Handler
import android.os.Looper
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.BasicMessageChannel
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import io.flutter.plugin.common.StandardMessageCodec
import io.flutter.plugin.common.StandardMethodCodec
import java.io.File

class MainActivity : FlutterActivity() {
  private val methodName = "${methodName}"
  private val basicName = "${basicName}"

  private fun mark(name: String) {
    File(applicationContext.filesDir, "kotlin-handler-evidence.txt")
      .appendText("kotlin-handler-v1|$name\\n")
  }

  override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
    super.configureFlutterEngine(flutterEngine)
    MethodChannel(flutterEngine.dartExecutor.binaryMessenger, methodName, StandardMethodCodec.INSTANCE)
      .setMethodCallHandler { call: MethodCall, result: MethodChannel.Result ->
        when (call.method) {
          "echo" -> { mark("echo"); result.success("android-ok") }
          "failure" -> { mark("failure"); result.error("fixture-error", "private-payload", null) }
          "slow" -> { mark("slow"); Handler(Looper.getMainLooper()).postDelayed({ result.success("android-ok") }, 120) }
          "never" -> { mark("never") }
          else -> result.notImplemented()
        }
      }
    BasicMessageChannel<Any?>(flutterEngine.dartExecutor.binaryMessenger, basicName, StandardMessageCodec.INSTANCE)
      .setMessageHandler { _, reply -> mark("basic"); reply.reply(listOf("android-ok")) }
  }
}
`;

function locateCallers(template) {
  const lines = template.split('\n');
  let result = template;
  for (const [name, expression] of [
    ['ECHO', "channel.invokeMethod<String>(method"], ['FAILURE', "failing.invokeMethod<void>('failure')"],
    ['ABSENT', "missing.invokeMethod<void>('absent')"], ['SLOW', "delayed.invokeMethod<String>('slow')"],
    ['NEVER', "unfinished.invokeMethod<void>('never')"], ['BASIC', 'basic.send('],
    ['PUBLIC_PIGEON', 'publicApi.getBool('],
  ]) {
    const line = lines.findIndex((value) => value.includes(expression));
    assert.ok(line >= 0, `Android fixture caller missing: ${name}`);
    const column = Buffer.byteLength(lines[line].slice(0, lines[line].indexOf(expression))) + 1;
    result = result.replaceAll(`__${name}_LINE__`, String(line + 1)).replaceAll(`__${name}_COLUMN__`, String(column));
  }
  return result;
}

async function pullJson(name) {
  const result = adb(['exec-out', 'run-as', packageName, 'cat', `files/isthmus-runtime/${name}.json`], `Read ${name} runtime evidence`);
  const value = JSON.parse(result.stdout);
  await writeFile(join(artifacts, `${name}.json`), JSON.stringify(value, null, 2), { mode: 0o600 });
  return value;
}

/** 앱이 중간에 종료돼도 이미 완료해 기록한 시나리오는 기기 정리 전에 보존한다. */
async function preserveAvailableRuntime() {
  if (!installedByHarness || emulatorId === undefined) return;
  const recordings = [];
  for (const name of ['success', 'failure', 'timeout', 'pending']) {
    const path = join(artifacts, `${name}.json`);
    try { await access(path); continue; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const result = runChild(adbBinary, ['-s', emulatorId, 'exec-out', 'run-as', packageName, 'cat', `files/isthmus-runtime/${name}.json`],
      { env: commandEnvironment, cwd: repository, timeout: 10_000, maxBuffer: 16 * 1024 * 1024 });
    if (result.status !== 0 || result.error) { recordings.push({ name, status: 'unavailable' }); continue; }
    try {
      const value = JSON.parse(result.stdout);
      await writeFile(path, JSON.stringify(value, null, 2), { mode: 0o600 });
      recordings.push({ name, status: 'preserved' });
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      recordings.push({ name, status: 'invalid-json' });
    }
  }
  if (recordings.length) await writeFile(join(artifacts, 'partial-recordings.json'), JSON.stringify(recordings, null, 2), { mode: 0o600 });
}

const snapshotWriterSource = String.raw`import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const [kartograph, project, output, sourceRoot, ...classes] = process.argv.slice(2);
if ([kartograph, project, output, sourceRoot].some((value) => value === undefined) || classes.length === 0) process.exit(64);
const result = spawnSync(kartograph, ['snapshot', ...classes.flatMap((value) => ['--classes', value]), '--project', project,
  '--include-paths', '--source-root', sourceRoot, '--source-root', 'vendor/shared_preferences_android/android/src/main',
  '--include-private-members', '--compact'], { encoding: 'utf8', timeout: 240000, maxBuffer: 64 * 1024 * 1024 });
if (result.status !== 0 || result.error !== undefined) {
  process.stderr.write('Kartograph snapshot preparation failed.\\n');
  process.exit(result.status ?? 2);
}
JSON.parse(result.stdout);
writeFileSync(output, result.stdout, { mode: 0o600 });
`;

function isPublicPluginNonProductionPath(path) {
  return /(?:^|\/)(?:example|test|\.dart_tool|\.gradle|\.git|build)(?:\/|$)/u.test(path);
}

async function findClassRoots(appRoot, includePublicPlugin) {
  const roots = [];
  const candidates = [
    join(appRoot, 'build/app/tmp/kotlin-classes/debug'),
    join(appRoot, 'build/app/intermediates/javac/debug/classes'),
  ];
  if (includePublicPlugin) candidates.push(
    join(appRoot, 'build/shared_preferences_android/tmp/kotlin-classes/debug'),
    join(appRoot, 'build/shared_preferences_android/intermediates/javac/debug/classes'),
    join(appRoot, 'build/shared_preferences_android/intermediates/classes/debug'),
  );
  for (const candidate of candidates) {
    try { await access(candidate); roots.push(candidate); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const appRootFound = roots.some((root) => root.startsWith(join(appRoot, 'build/app/')));
  const pluginRootFound = roots.some((root) => root.startsWith(join(appRoot, 'build/shared_preferences_android/')));
  if (!appRootFound || (includePublicPlugin && !pluginRootFound)) {
    throw new Error(`Android build did not produce the expected Kotlin/JVM class roots. Evidence: ${artifacts}`);
  }
  return roots;
}

async function hashDirectory(root) {
  const files = (await readdir(root, { recursive: true })).filter((name) => typeof name === 'string')
    .filter((name) => !isPublicPluginNonProductionPath(name)).sort();
  const entries = [];
  for (const relative of files) {
    const path = join(root, relative);
    const stat = await lstat(path);
    if (stat.isDirectory()) continue;
    assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'Public fixture hash requires regular files.');
    const content = await readFile(path);
    entries.push({ path: relative, sha256: createHash('sha256').update(content).digest('hex') });
  }
  return entries;
}

async function verify() {
  await access(isthmus);
  await selectDevice();
  const existing = runChild(adbBinary, ['-s', emulatorId, 'shell', 'pm', 'path', packageName], { env: commandEnvironment, cwd: repository, timeout: 10_000 });
  if (existing.status === 0 && existing.stdout.trim() !== '') throw new Error(`Refusing to overwrite existing Android package ${packageName}.`);
  const flutterVersion = JSON.parse(step(flutterBinary, ['--version', '--machine'], 'Flutter version').stdout);
  const dartSource = locateCallers(dartTemplate);
  await access(publicPluginSource);
  const pluginPubspec = await readFile(join(publicPluginSource, 'pubspec.yaml'), 'utf8');
  assert.match(pluginPubspec, /^name:\s*shared_preferences_android\s*$/mu, 'The public fixture must be shared_preferences_android.');
  assert.match(pluginPubspec, /^version:\s*2\.4\.1\s*$/mu, 'The public fixture version must match the recorded 2.4.1 contract.');
  const publicPluginManifest = { package: 'shared_preferences_android', version: '2.4.1', files: await hashDirectory(publicPluginSource) };
  const sourceHash = createHash('sha256').update(dartSource).update(kotlinSource)
    .update(await readFile(join(packageRoot, 'pubspec.yaml')))
    .update(await readFile(join(packageRoot, 'lib/src/runtime_recorder.dart')))
    .update(JSON.stringify(publicPluginManifest))
    .update(flutterVersion.frameworkRevision).digest('hex');
  const appRoot = join(scratch, 'runtime_probe');
  step(flutterBinary, ['create', '--platforms=android', '--project-name=isthmus_runtime_probe', '--no-pub', '--offline', appRoot], 'Flutter Android app creation');
  const vendorRoot = join(appRoot, 'vendor/shared_preferences_android');
  await cp(publicPluginSource, vendorRoot, { recursive: true, filter: (source) =>
    !isPublicPluginNonProductionPath(relative(publicPluginSource, source).replaceAll('\\', '/')) });
  assert.deepEqual(publicPluginManifest.files, await hashDirectory(vendorRoot), 'Public plugin vendor must remain byte-identical.');
  await writeFile(join(appRoot, 'public-plugin-manifest.json'), JSON.stringify(publicPluginManifest, null, 2), { mode: 0o600 });
  await writeFile(join(appRoot, 'pubspec.yaml'), `name: isthmus_runtime_probe\nversion: 1.0.0+1\nenvironment:\n  sdk: '>=3.7.0 <4.0.0'\ndependencies:\n  flutter:\n    sdk: flutter\n  isthmus_runtime:\n    path: ${JSON.stringify(packageRoot)}\n  shared_preferences_android:\n    path: vendor/shared_preferences_android\ndev_dependencies:\n  flutter_test:\n    sdk: flutter\n`);
  await writeFile(join(appRoot, 'lib/main.dart'), dartSource);
  await writeFile(join(appRoot, 'dartograph.yaml'), 'source_packages:\n  - vendor/shared_preferences_android\n', { mode: 0o600 });
  // 템플릿의 사라진 MyApp 대신 실제 recorder 호출 위치를 검사한다. 두 main은 질의 모호성을 재현한다.
  await mkdir(join(appRoot, 'test'), { recursive: true });
  await writeFile(join(appRoot, 'test/widget_test.dart'), `import 'package:flutter_test/flutter_test.dart';
import 'package:isthmus_runtime_probe/main.dart' as probe;
void main() {
  test('records known call sites and leaves unknown methods unbound', () {
    expect(probe.callerForMethod('echo')?.path, 'lib/main.dart');
    expect(probe.callerForMethod('not-configured'), isNull);
  });
}
`, { mode: 0o600 });
  await writeFile(join(appRoot, 'android/app/src/main/kotlin/com/example/isthmus_runtime_probe/MainActivity.kt'), kotlinSource);
  // Flutter's template may request an absent default NDK. Pin only this disposable
  // app to an already installed SDK package; never mutate the user's SDK settings.
  const appGradle = join(appRoot, 'android/app/build.gradle.kts');
  const gradleSource = await readFile(appGradle, 'utf8');
  const installedNdk = join(sdkRoot, 'ndk/29.0.14033849');
  if (gradleSource.includes('ndkVersion = flutter.ndkVersion')) {
    try {
      await access(installedNdk);
      await writeFile(appGradle, gradleSource.replace('ndkVersion = flutter.ndkVersion', 'ndkVersion = "29.0.14033849"'));
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  step(flutterBinary, ['pub', 'get'], 'Flutter Android dependency resolution', appRoot, 300_000);
  step(flutterBinary, ['test', '--no-pub'], 'Flutter fixture caller mapping test', appRoot, 180_000);
  const project = await realpath(appRoot);
  const sourceProject = process.env.ISTHMUS_PROJECT ?? project;
  assert.equal(sourceProject, project, 'Android runtime project must identify the actual disposable app root.');
  assert.match(project, /^[^\u0000-\u001f\u007f-\u009f]+$/u);
  let revision = process.env.ISTHMUS_REVISION ?? `sha256:${sourceHash}`;
  let capture;
  let cacheReuse;
  let captureConfig;
  const nativeFile = 'android/app/src/main/kotlin/com/example/isthmus_runtime_probe/MainActivity.kt';
  step(flutterBinary, ['build', 'apk', '--debug', '--no-pub'], 'Android preflight APK build', appRoot, 600_000);
  const classRoots = await findClassRoots(appRoot, true);
  if (kartographBinary !== undefined) {
    const snapshotRelative = 'preflight/kartograph-snapshot.json';
    const helperRelative = 'preflight/write-kartograph-snapshot.mjs';
    await mkdir(join(appRoot, 'preflight'), { recursive: true });
    await writeFile(join(appRoot, helperRelative), snapshotWriterSource, { mode: 0o600 });
    const capturePreflight = (await import('./capture-preflight.mjs')).capturePreflight;
    const kartographLibraries = join(dirname(dirname(kartographBinary)), 'lib');
    await access(kartographLibraries);
    captureConfig = {
      project,
      inputs: ['lib', 'test', 'dartograph.yaml', 'android/app/src/main', 'android/app/build.gradle.kts', 'android/settings.gradle.kts', 'android/gradle.properties', 'pubspec.yaml', 'pubspec.lock', '.dart_tool/package_config.json', helperRelative,
        'public-plugin-manifest.json', 'vendor/shared_preferences_android/lib', 'vendor/shared_preferences_android/android', 'vendor/shared_preferences_android/pubspec.yaml', 'vendor/shared_preferences_android/LICENSE'],
      toolInputs: [kartographBinary, kartographLibraries, dartographBinary, ...classRoots,
        join(packageRoot, 'lib'), join(packageRoot, 'pubspec.yaml')],
      prepare: [[process.execPath, helperRelative, kartographBinary, project, snapshotRelative, join(project, 'android/app/src/main'), ...classRoots]],
      dartograph: [dartographBinary],
      kartograph: [kartographBinary],
      kartographSnapshot: snapshotRelative,
      selection: { kotlin: { files: [nativeFile], symbols: [] } },
      messages: true,
      output: 'preflight/context.json',
      cache: 'preflight/cache.json',
    };
    capture = await capturePreflight(captureConfig);
    await cp(join(project, 'preflight/context.json'), join(artifacts, 'preflight-context.json'));
    await cp(join(project, 'preflight/context.json.sources.json'), join(artifacts, 'preflight-context.json.sources.json'));
    await writeFile(join(artifacts, 'static-preflight.json'), JSON.stringify(capture.report, null, 2), { mode: 0o600 });
    cacheReuse = await capturePreflight(captureConfig);
    assert.equal(cacheReuse.cached, true, 'Unchanged Android source/build inputs must reuse the capture.');
    assert.equal(cacheReuse.context.revision, capture.context.revision);
    assert.ok(capture.report.affected.some(({ subject }) => subject.kind === 'symbol' && subject.platform === 'dart'),
      `A Kotlin change must reach a real Dart caller through the bridge. Evidence: ${artifacts}`);
    const ownMethods = capture.context.bridges.filter(({ platform }) => platform === 'kotlin')
      .flatMap(({ facts }) => facts).filter(({ kind, channel }) => kind === 'method-handle' && channel === methodName);
    assert.equal(ownMethods.length, 4);
    assert.ok(ownMethods.every(({ symbol }) => symbol?.usr), 'Kotlin Method handlers must retain actual snapshot identities.');
    revision = capture.context.revision;
    assert.equal(capture.context.project, project);
  }
  // Use the app-private files directory so `run-as` can retrieve evidence without
  // requesting storage permissions or depending on scoped-storage behavior.
  const buildArgs = ['build', 'apk', '--debug', '--no-pub', `--dart-define=ISTHMUS_PROJECT=${project}`, `--dart-define=ISTHMUS_REVISION=${revision}`, `--dart-define=ISTHMUS_OUTPUT=/data/user/0/${packageName}/files/isthmus-runtime`];
  step(flutterBinary, buildArgs, 'Android Flutter APK build', appRoot, 600_000);
  step(flutterBinary, buildArgs, 'Android Flutter repeat build', appRoot, 600_000);
  if (captureConfig !== undefined) {
    const { capturePreflight } = await import('./capture-preflight.mjs');
    const confirmed = await capturePreflight(captureConfig);
    assert.equal(confirmed.cached, true, 'The final APK build must not change the captured native inputs.');
    assert.equal(confirmed.context.revision, revision);
  }
  const apk = join(appRoot, 'build/app/outputs/flutter-apk/app-debug.apk');
  await access(apk);
  step(adbBinary, ['-s', emulatorId, 'install', '-r', apk], 'Android APK install', repository, 180_000);
  installedByHarness = true;
  adb(['shell', 'pm', 'clear', packageName], 'Clear disposable Android app data');
  step(adbBinary, ['-s', emulatorId, 'shell', 'am', 'start', '-n', activity], 'Android runtime probe launch');
  await waitFor(async () => {
    const result = runChild(adbBinary, ['-s', emulatorId, 'shell', 'run-as', packageName, 'test', '-f', 'files/isthmus-runtime/pending.json'], { env: commandEnvironment, cwd: repository, timeout: 10_000 });
    return result.status === 0;
  }, 'Android runtime evidence', 180_000);
  const success = await pullJson('success');
  const failure = await pullJson('failure');
  const timeout = await pullJson('timeout');
  const pending = await pullJson('pending');
  const evidenceResult = adb(['exec-out', 'run-as', packageName, 'cat', 'files/kotlin-handler-evidence.txt'], 'Read Kotlin execution evidence');
  await writeFile(join(artifacts, 'kotlin-handler-evidence.txt'), evidenceResult.stdout, { mode: 0o600 });
  for (const name of ['echo', 'basic', 'failure', 'slow', 'never']) assert.match(evidenceResult.stdout, new RegExp(`kotlin-handler-v1\\|${name}\\n`, 'u'));
  assert.equal(success.run.platform, 'android');
  assert.equal(success.events.filter(({ outcome }) => outcome === 'success').length, 3);
  assert.ok(success.events.some(({ channel, transport, outcome }) => channel === publicPigeonChannel && transport === 'basic-message-channel' && outcome === 'success'));
  assert.ok(failure.events.some(({ method, outcome }) => method === 'failure' && outcome === 'error'));
  assert.ok(failure.events.some(({ method, outcome }) => method === 'absent' && outcome === 'missing-handler'));
  assert.ok(timeout.events.some(({ method, outcome }) => method === 'slow' && outcome === 'timeout'));
  assert.equal(pending.run.status, 'incomplete');
  assert.ok(pending.events.some(({ method, outcome }) => method === 'never' && outcome === 'pending'));
  for (const value of [success, failure, timeout, pending]) assert.equal(JSON.stringify(value).includes('fixture-private-payload'), false);
  const expectations = join(artifacts, 'expectations.json');
  await writeFile(expectations, JSON.stringify({ format: 'bridge-expectations', version: 1, project, revision, checks: [
    { id: 'android-method-echo', scenario: 'success', platform: 'android', instance: 'main', transport: 'method-channel', channel: methodName, method: 'echo' },
    { id: 'android-basic-echo', scenario: 'success', platform: 'android', instance: 'main', transport: 'basic-message-channel', channel: basicName },
    { id: 'android-public-pigeon-get-bool', scenario: 'success', platform: 'android', instance: 'main', transport: 'basic-message-channel', channel: publicPigeonChannel },
  ] }, null, 2), { mode: 0o600 });
  const positive = runChild(process.execPath, [isthmus, 'verify-runtime', '--expectations', expectations, '--strict', '--compact', join(artifacts, 'success.json')], { cwd: repository, env: commandEnvironment, timeout: 30_000 });
  assert.equal(positive.status, 0, positive.stderr);
  let preflight;
  if (capture !== undefined) {
    const preflightResult = runChild(process.execPath, [isthmus, 'preflight', join(project, 'preflight/context.json'), join(artifacts, 'success.json'),
      '--expectations', expectations, '--strict', '--compact'], { cwd: repository, env: commandEnvironment, timeout: 30_000 });
    // Static Kotlin gaps remain reviewable even when the declared runtime routes pass.
    assert.ok(preflightResult.status === 0 || preflightResult.status === 1, preflightResult.stderr);
    preflight = JSON.parse(preflightResult.stdout);
    assert.equal(preflight.runtime?.aligned, true);
    assert.equal(preflight.runtime?.verification?.status, 'passed');
    for (const [transport, channel, method] of [
      ['method-channel', methodName, 'echo'], ['basic-message-channel', basicName, undefined],
      ['basic-message-channel', publicPigeonChannel, undefined],
    ]) {
      assert.ok(preflight.runtime.routes.some((route) => route.transport === transport && route.channel === channel &&
        route.method === method && route.staticStatus === 'candidates' && route.observedCalls > 0),
      'Each executed Android route must match a Kotlin static candidate.');
    }
    assert.ok(preflight.runtime.candidates.every(({ handlers }) => handlers.every(({ platform }) => platform === 'kotlin')));
    await writeFile(join(artifacts, 'preflight-runtime.json'), JSON.stringify(preflight, null, 2), { mode: 0o600 });
  }
  const negativeExpectations = join(artifacts, 'negative-expectations.json');
  await writeFile(negativeExpectations, JSON.stringify({ format: 'bridge-expectations', version: 1, project, revision, checks: [
    { id: 'android-error', scenario: 'failure', platform: 'android', instance: 'main', transport: 'method-channel', channel: methodName, method: 'failure', allowedOutcomes: ['error'] },
    { id: 'android-missing', scenario: 'failure', platform: 'android', instance: 'main', transport: 'method-channel', channel: 'example/missing-runtime', method: 'absent', allowedOutcomes: ['missing-handler'] },
    { id: 'android-timeout', scenario: 'timeout', platform: 'android', instance: 'main', transport: 'method-channel', channel: methodName, method: 'slow', allowedOutcomes: ['timeout'] },
  ] }, null, 2), { mode: 0o600 });
  const allowed = runChild(process.execPath, [isthmus, 'verify-runtime', '--expectations', negativeExpectations, '--strict', '--compact', join(artifacts, 'failure.json'), join(artifacts, 'timeout.json')], { cwd: repository, env: commandEnvironment, timeout: 30_000 });
  assert.equal(allowed.status, 0, allowed.stderr);
  let publicPreflight;
  if (captureConfig !== undefined) {
    // 별도 변경 선택은 별도 revision이다. 기존 런타임 기록의 revision을 바꿔 맞추지 않는다.
    const snapshot = join(project, captureConfig.kartographSnapshot);
    await cp(snapshot, join(artifacts, 'kartograph-snapshot.json'));
    const pluginFile = 'vendor/shared_preferences_android/android/src/main/kotlin/io/flutter/plugins/sharedpreferences/SharedPreferencesPlugin.kt';
    const discovery = JSON.parse(step(kartographBinary, ['impact', '--graph-file', snapshot,
      '--file', pluginFile, '--limit', '10000', '--depth', '128'], 'Public Kotlin symbol discovery', project).stdout);
    const changed = discovery.changed.filter(({ qualifiedName }) =>
      qualifiedName === 'io.flutter.plugins.sharedpreferences.SharedPreferencesPlugin.getBool');
    assert.equal(changed.length, 1, 'Select a unique implementation identity emitted by the actual JVM snapshot.');
    await writeFile(join(artifacts, 'public-kotlin-symbols.json'), JSON.stringify(discovery, null, 2), { mode: 0o600 });
    const { capturePreflight } = await import('./capture-preflight.mjs');
    const selected = await capturePreflight({ ...captureConfig,
      selection: { kotlin: { files: [], symbols: [changed[0].usr] } },
      output: 'preflight/public-context.json', cache: 'preflight/public-cache.json' });
    await cp(join(project, 'preflight/public-context.json'), join(artifacts, 'public-preflight-context.json'));
    await cp(join(project, 'preflight/public-context.json.sources.json'), join(artifacts, 'public-preflight-context.json.sources.json'));
    await writeFile(join(artifacts, 'public-static-preflight.json'), JSON.stringify(selected.report, null, 2), { mode: 0o600 });
    const dartSymbols = selected.report.affected.map(({ subject }) => subject)
      .filter(({ kind, platform }) => kind === 'symbol' && platform === 'dart').map(({ symbol }) => symbol);
    const generated = selected.context.bindings.find(({ requested, symbol }) => requested === 'SharedPreferencesAsyncApi.getBool' &&
      symbol.location.path === 'vendor/shared_preferences_android/lib/src/messages_async.g.dart');
    const appCaller = selected.context.bindings.find(({ requested, symbol }) => requested === 'main' && symbol.location.path === 'lib/main.dart');
    assert.ok(generated && dartSymbols.some(({ id }) => id === generated.symbol.id),
    `Public Kotlin getBool must reach the generated Dart API. Evidence: ${artifacts}`);
    assert.deepEqual(dartSymbols.find(({ id }) => id === generated.symbol.id)?.location, generated.symbol.location,
      'The report must preserve the actual generated Dart declaration location.');
    assert.ok(appCaller && dartSymbols.some(({ id }) => id === appCaller.symbol.id),
      `Public Kotlin getBool must transitively reach the app caller. Evidence: ${artifacts}`);
    publicPreflight = { selectedSymbol: changed[0].usr, revision: selected.context.revision,
      captureMs: selected.milliseconds, generatedDartCaller: true, transitiveAppCaller: true,
      summary: selected.report.summary };
  }
  const summary = { scope: 'real-flutter-android-native-channels', flutter: flutterVersion.frameworkVersion, device: emulatorId,
    deviceProfile,
    publicPlugin: publicPluginManifest,
    ...(publicPreflight === undefined ? {} : { publicPreflight }),
    project, revision, sourceRevision: `sha256:${sourceHash}`, artifacts, elapsedMs: Math.round(performance.now() - started), steps,
    nativeExecutionEvidence: { file: join(artifacts, 'kotlin-handler-evidence.txt'), implementation: 'MainActivity.kt', handlers: ['echo', 'basic', 'failure', 'slow', 'never'] },
    runtime: { success: JSON.parse(positive.stdout).summary, allowedNegative: JSON.parse(allowed.stdout).summary, pendingStatus: pending.run.status,
      ...(preflight === undefined ? {} : { preflight: { aligned: preflight.runtime?.aligned, verification: preflight.runtime?.verification?.status,
        report: preflight.summary, captureMs: capture.milliseconds, cachedMs: cacheReuse.milliseconds, cacheReused: cacheReuse.cached } }) },
    limitations: ['The harness verifies declared Flutter channel scenarios and Kotlin handler execution markers; it does not discover undeclared runtime dependencies.', 'One Android emulator profile was exercised; device, API, lifecycle, and release variants remain untested.', 'The public Pigeon fixture uses shared_preferences_android 2.4.1 and its generated SharedPreferencesAsyncApi codec; message suffixes are preserved as observed addresses.'] };
  const preservedFixture = join(artifacts, 'android-fixture');
  await cp(appRoot, preservedFixture, { recursive: true, filter: (source) =>
    !relative(appRoot, source).split(/[\\/]/u).some((part) => ['build', '.dart_tool', '.gradle', '.git'].includes(part)) });
  const preservedClassRoots = [];
  for (const [index, root] of classRoots.entries()) {
    const preserved = join(artifacts, `android-kotlin-classes-${index}`);
    await cp(root, preserved, { recursive: true });
    preservedClassRoots.push(preserved);
  }
  summary.fixture = { root: preservedFixture, kotlin: join(preservedFixture, 'android/app/src/main/kotlin/com/example/isthmus_runtime_probe/MainActivity.kt'), dart: join(preservedFixture, 'lib/main.dart'), kotlinClasses: preservedClassRoots[0], kotlinClassRoots: preservedClassRoots };
  await writeFile(join(artifacts, 'verification.json'), JSON.stringify(summary, null, 2), { mode: 0o600 });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

try {
  await verify();
} finally {
  try { await preserveAvailableRuntime(); }
  catch { process.stderr.write(`Could not preserve partial Android recordings; evidence: ${artifacts}\n`); }
  if (installedByHarness && emulatorId !== undefined) runChild(adbBinary, ['-s', emulatorId, 'uninstall', packageName], { env: commandEnvironment, cwd: repository, timeout: 30_000 });
  let stopped;
  try { stopped = await stopDetachedProcess(emulatorProcess); }
  catch (error) {
    stopped = { stopped: false, error: error.code ?? 'termination-failed' };
    process.stderr.write(`Could not confirm owned Android process termination; evidence: ${artifacts}\n`);
  }
  await writeFile(join(artifacts, 'cleanup.json'), JSON.stringify({ ...stopped, confirmedAvd: ownedEmulator }, null, 2), { mode: 0o600 });
  try {
    if (stopped.stopped) await rm(scratch, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 });
    else { process.exitCode = 1; process.stderr.write(`Owned Android process did not stop; scratch preserved: ${scratch}\n`); }
  } catch (error) {
    // Cleanup races must not turn a verified runtime result into a false failure.
    try {
      await writeFile(join(artifacts, 'cleanup-warning.txt'), String(error).replace(/https?:\/\/[^\s]+/gu, '[URL omitted]'), { mode: 0o600 });
    } catch {
      process.stderr.write(`Could not preserve Android cleanup warning; evidence directory: ${artifacts}\n`);
    }
  }
}
