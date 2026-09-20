import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { chmod, cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative } from 'node:path';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { runChild } from './run-child.mjs';
import { fetchPinnedPackage } from '../experiments/real-corpus/public-archive.mjs';
import { javascript as newJavascript, kotlin as newKotlin, spec, silentWav } from './fixtures/rn-new-architecture.mjs';
import { stopDetachedProcess } from './stop-detached-process.mjs';
import { throwHarnessFailures } from './runtime-harness-failures.mjs';

// 공개 Sound 원본의 이벤트를 실제 RN/Hermes 엔진에서 소비한다.
const [adbArg, ...extra] = process.argv.slice(2);
const newArchitecture = extra.includes('--new-architecture');
const newEmulator = extra.includes('--new-emulator');
if (!adbArg || new Set(extra).size !== extra.length || extra.some((value) => !['--new-architecture', '--new-emulator'].includes(value))) {
  process.stderr.write('Usage: verify-rn-android-runtime.mjs <adb> [--new-architecture] [--new-emulator] (defaults to one physical Android device)\n');
  process.exit(64);
}
const adb = await realpath(adbArg);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const scratch = await realpath(await mkdtemp(join(tmpdir(), 'isthmus-rn-engine-')));
const evidence = await realpath(await mkdtemp(join(tmpdir(), 'isthmus-rn-engine-evidence-')));
const project = join(scratch, 'app');
const appId = newArchitecture ? 'com.isthmus.rnnewarchprobe' : 'com.isthmus.rnprobe';
const resultPath = `/sdcard/Android/data/${appId}/files/rn-probe.json`;
const steps = [];
let device;
let installed = false;
let installAttempted = false;
let primaryFailure;
let emulatorProcess;
let summary;
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const environment = { ...process.env, ANDROID_HOME: dirname(dirname(adb)), CI: 'true' };
async function run(command, args, label, cwd = scratch, expected = 0, timeout = 180_000) {
  const started = performance.now();
  const result = runChild(command, args, { cwd, env: environment, timeout, maxBuffer: 32 * 1024 * 1024 });
  steps.push({ label, exit: result.status, milliseconds: Math.round(performance.now() - started) });
  process.stderr.write(`RN verification: ${label} (${result.status})\n`);
  if (result.status !== expected || result.error) {
    // adb의 목록·임의 앱 로그는 보존하지 않는다.
    if (command !== adb) await writeFile(join(evidence, 'build-failure.log'), (result.stdout + '\n' + result.stderr)
      .replaceAll(device ?? '\u0000', '[selected-device]').replace(/https?:\/\/\S+/gu, '[URL omitted]'), { mode: 0o600 });
    throw new Error(`${label} failed; evidence: ${evidence}`);
  }
  return result.stdout;
}
async function save(path, content) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, content, { mode: 0o600 }); }

async function startOwnedEmulator() {
  const sdk = dirname(dirname(adb));
  const androidUser = join(scratch, 'android-user');
  const avdHome = join(androidUser, 'avd');
  const name = 'isthmus-rn-' + basename(scratch);
  const env = { ...environment, ANDROID_USER_HOME: androidUser, ANDROID_AVD_HOME: avdHome };
  const abi = process.arch === 'arm64' ? 'arm64-v8a' : 'x86_64';
  const made = runChild(join(sdk, 'cmdline-tools/latest/bin/avdmanager'), ['create', 'avd', '--name', name,
    '--package', `system-images;android-36;google_apis_playstore;${abi}`, '--device', 'pixel_2'], { env, input: 'no\n', timeout: 120_000 });
  assert.equal(made.status, 0, 'Owned RN AVD creation failed; an installed API36 system image is required.');
  const config = join(avdHome, name + '.avd/config.ini');
  await save(config, (await readFile(config, 'utf8')).replace(/^disk\.dataPartition\.size=.*$/mu, 'disk.dataPartition.size=4096M'));
  let port;
  for (let candidate = 5554; candidate <= 5584; candidate += 2) {
    const servers = [createServer(), createServer()];
    try {
      for (const [index, server] of servers.entries()) await new Promise((resolve, reject) => {
        server.once('error', reject); server.listen(candidate + index, '127.0.0.1', resolve);
      });
      port = candidate; break;
    } catch (error) { if (error.code !== 'EADDRINUSE') throw error; }
    finally { await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve)))); }
  }
  assert.ok(port, 'No available port for the owned RN emulator.');
  device = `emulator-${port}`;
  const log = openSync(join(evidence, 'emulator.log'), 'w', 0o600);
  emulatorProcess = spawn(join(sdk, 'emulator/emulator'), ['-avd', name, '-no-window', '-no-snapshot', '-no-boot-anim', '-gpu', 'swiftshader_indirect', '-port', String(port)],
    { env, detached: true, stdio: ['ignore', log, log] });
  closeSync(log);
  let launchError;
  emulatorProcess.once('error', (error) => { launchError = error; });
  emulatorProcess.unref();
  const deadline = Date.now() + 180_000;
  for (;;) {
    assert.ok(!launchError && Date.now() < deadline, 'Owned RN emulator did not boot.');
    const boot = runChild(adb, ['-s', device, 'shell', 'getprop', 'sys.boot_completed'], { timeout: 10_000 });
    if (boot.status === 0 && boot.stdout.trim() === '1') break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const identity = runChild(adb, ['-s', device, 'shell', 'getprop', 'ro.boot.qemu.avd_name'], { timeout: 10_000 });
  assert.ok(identity.status === 0 && identity.stdout.trim() === name, 'Owned RN AVD identity mismatch; refusing device operations.');
}
const kotlin = String.raw`package com.zmxv.RNSound

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.*
import com.facebook.react.uimanager.ViewManager
import java.io.File
import org.json.JSONObject

class ProbePackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(ProbeModule(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
class ProbeModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private val sound = Sound(context)
  private var emissions = 0
  override fun getName() = "RNSound"
  // 명시적 fixture adapter: 원본 JS의 준비 callback만 제공하고 미디어를 열지 않는다.
  @ReactMethod fun prepare(name: String, key: Double, options: ReadableMap, callback: Callback) { callback.invoke(null, Arguments.createMap()) }
  @ReactMethod fun release(key: Double) {}
  @ReactMethod fun addListener(name: String) {}
  @ReactMethod fun removeListeners(count: Double) {}
  @ReactMethod fun emitProbe(playing: Boolean, key: Double, promise: Promise) {
    sound.setOnPlay(playing, key)
    emissions += 1
    promise.resolve(null)
  }
  @ReactMethod fun finishProbe(result: String) {
    val value = JSONObject(result)
    value.put("nativeEmissions", emissions)
    value.put("androidDebuggable", context.applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE != 0)
    File(requireNotNull(context.getExternalFilesDir(null)), "rn-probe.json").writeText(value.toString())
  }
}
`;
const javascript = String.raw`import React from 'react';
import {AppRegistry, NativeModules, Platform, Text} from 'react-native';
import Sound from './public-sound/index';
const native = NativeModules.RNSound;
const delay = () => new Promise(resolve => setTimeout(resolve, 120));
async function probe() {
  const checks = [];
  const check = (name, ok) => { if (!ok) throw new Error(name); checks.push(name); };
  const first = await new Promise((resolve, reject) => {
    const item = new Sound('fixture-unused', error => error ? reject(new Error('prepare')) : resolve(item));
  });
  const second = await new Promise((resolve, reject) => {
    const item = new Sound('fixture-unused', error => error ? reject(new Error('prepare')) : resolve(item));
  });
  check('hermes-engine', !!global.HermesInternal);
  check('android-platform', Platform.OS === 'android');
  check('release-js', !__DEV__);
  check('initial-state', !first.isPlaying() && !second.isPlaying());
  await native.emitProbe(true, 0); await delay();
  check('original-subscription-receives', first.isPlaying());
  check('other-player-excluded', !second.isPlaying());
  await native.emitProbe(false, 0); await delay();
  check('payload-state-change', !first.isPlaying());
  first.release();
  await native.emitProbe(true, 0); await delay();
  check('removed-subscription-excluded', !first.isPlaying());
  await native.emitProbe(true, 1); await delay();
  check('remaining-subscription-receives', second.isPlaying());
  second.release();
  native.finishProbe(JSON.stringify({status: 'passed', checks, engine: 'Hermes', reactNative: Platform.constants.reactNativeVersion, architecture: 'legacy-bridge', buildMode: 'release'}));
}
AppRegistry.registerComponent('HelloWorld', () => () => React.createElement(Text, null, 'Isthmus RN probe'));
probe().catch(() => native.finishProbe(JSON.stringify({status: 'failed'})));
`;

try {
  if (newEmulator) await startOwnedEmulator();
  else {
  const devices = (await run(adb, ['devices'], 'Discover Android')).split(/\r?\n/u)
    .map((line) => line.trim().split(/\s+/u)).filter(([id, state]) => state === 'device' && !id.startsWith('emulator-')).map(([id]) => id);
  assert.equal(devices.length, 1, 'Exactly one available physical Android device is required.');
  device = devices[0];
  }
  const existing = await run(adb, ['-s', device, 'shell', 'pm', 'list', 'packages', appId], 'Check fixture ownership');
  assert.ok(!existing.includes(appId), 'Refusing to replace a preexisting fixture package.');
  const abi = (await run(adb, ['-s', device, 'shell', 'getprop', 'ro.product.cpu.abi'], 'Read ABI')).trim();
  assert.ok(['arm64-v8a', 'armeabi-v7a', 'x86_64', 'x86'].includes(abi));
  const templateHash = '30c8abfddb2ae16ec3145a560dd3fe64ffd12c0f0f4d85aab63526c3ed4f9692';
  const archive = join(scratch, 'template.tgz');
  await run('curl', ['-fsSL', '--retry', '3', '-o', archive, '--', 'https://registry.npmjs.org/@react-native-community/template/-/template-0.81.4.tgz'], 'Download pinned template');
  assert.equal(sha(await readFile(archive)), templateHash);
  const listing = await run('tar', ['-tzf', archive], 'Check template members');
  assert.ok(listing.split('\n').filter(Boolean).every((name) => name.startsWith('package/') && !name.split('/').includes('..')));
  const types = await run('tar', ['-tvzf', archive], 'Check template types');
  assert.ok(types.split('\n').filter(Boolean).every((line) => /^[d-]/u.test(line)));
  await run('tar', ['-xzf', archive, '-C', scratch], 'Extract template');
  await cp(join(scratch, 'package/template'), project, { recursive: true });
  const manifest = JSON.parse(await readFile(join(root, 'experiments/real-corpus/manifest.json'), 'utf8')).rnEvents['react-native-sound@0.13.0'];
  const original = await fetchPinnedPackage(manifest, scratch);
  await cp(join(original, 'src'), join(project, 'public-sound'), { recursive: true });
  await cp(join(original, 'android/src/main/java/com/zmxv/RNSound/Sound.kt'), join(project, 'android/app/src/main/java/com/helloworld/Sound.kt'));
  await cp(join(original, 'LICENSE'), join(project, 'public-sound/LICENSE'));
  const sourceHashes = {};
  for (const [from, to] of [[manifest.source, 'public-sound/index.ts'], [manifest.nativeSource, 'android/app/src/main/java/com/helloworld/Sound.kt']]) {
    const bytes = await readFile(join(project, to)); assert.deepEqual(bytes, await readFile(join(original, from))); sourceHashes[from] = sha(bytes);
  }
  const pkg = JSON.parse(await readFile(join(project, 'package.json'), 'utf8'));
  pkg.dependencies = { react: '19.1.0', 'react-native': '0.81.4' };
  if (newArchitecture) {
    // 원본 npm 패키지의 Codegen·native 구현까지 실제로 연결한다.
    await cp(original, join(project, 'sound'), { recursive: true });
    pkg.dependencies['react-native-sound'] = 'file:./sound';
    pkg.codegenConfig = { name: 'IsthmusProbeSpec', type: 'modules', jsSrcsDir: 'specs', android: { javaPackageName: 'com.helloworld' } };
    await save(join(project, 'specs/NativeIsthmusProbe.ts'), spec);
    await save(join(project, 'android/app/src/main/res/raw/isthmus_silence.wav'), silentWav());
    // Sound는 library module에서 컴파일하므로 위의 legacy용 복사본과 중복하지 않는다.
    await rm(join(project, 'android/app/src/main/java/com/helloworld/Sound.kt'));
  }
  pkg.devDependencies = Object.fromEntries(Object.entries(pkg.devDependencies).filter(([name]) => ['@babel/core', '@babel/runtime', '@react-native-community/cli', '@react-native-community/cli-platform-android', '@react-native/babel-preset', '@react-native/metro-config'].includes(name)));
  await save(join(project, 'package.json'), JSON.stringify(pkg, null, 2));
  await save(join(project, 'index.js'), newArchitecture ? newJavascript : javascript);
  await save(join(project, 'android/app/src/main/java/com/helloworld/ProbePackage.kt'), newArchitecture ? newKotlin : kotlin);
  const application = join(project, 'android/app/src/main/java/com/helloworld/MainApplication.kt');
  await save(application, (await readFile(application, 'utf8')).replace('PackageList(this).packages.apply {', `PackageList(this).packages.apply {\n              add(${newArchitecture ? 'com.helloworld' : 'com.zmxv.RNSound'}.ProbePackage())`));
  const properties = join(project, 'android/gradle.properties');
  if (!newArchitecture) await save(properties, (await readFile(properties, 'utf8')).replace('newArchEnabled=true', 'newArchEnabled=false'));
  const build = join(project, 'android/app/build.gradle');
  await save(build, (await readFile(build, 'utf8')).replace('applicationId "com.helloworld"', `applicationId "${appId}"`));
  await save(join(project, 'android/local.properties'), `sdk.dir=${dirname(dirname(adb))}\n`);
  await run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], 'Install pinned RN tooling', project, 0, 600_000);
  await cp(project, join(evidence, 'fixture'), { recursive: true, filter: (path) =>
    !relative(project, path).split('/').some((part) => ['node_modules', 'build', '.gradle', '.git', '.cxx', 'ios'].includes(part)) && !path.endsWith('.keystore') });
  const wrapper = join(project, 'android/gradlew'); await chmod(wrapper, 0o700);
  await run(wrapper, ['--no-daemon', 'assembleRelease', `-PreactNativeArchitectures=${abi}`, '--max-workers=2'], 'Build RN Hermes release', join(project, 'android'), 0, 900_000);
  const codegen = {};
  if (newArchitecture) {
    for (const [name, path] of Object.entries({ probe: 'android/app/build/generated/source/codegen/java/com/helloworld/NativeIsthmusProbeSpec.java',
      sound: 'node_modules/react-native-sound/android/build/generated/source/codegen/java/com/zmxv/RNSound/NativeSoundAndroidSpec.java' })) {
      const bytes = await readFile(join(project, path));
      assert.ok(bytes.toString().includes('TurboModule'), `${name} Codegen output must implement TurboModule`);
      codegen[name] = sha(bytes);
      await save(join(evidence, 'codegen', name + '.java'), bytes);
    }
  }
  const apk = join(project, 'android/app/build/outputs/apk/release/app-release.apk');
  // 기기가 빌드 중 분리되더라도 검증한 원본·설치 입력을 보존한다.
  await cp(apk, join(evidence, 'app-release.apk'));
  await save(join(evidence, 'build.json'), JSON.stringify({ sourceHashes, templateSha256: templateHash, codegen,
    lockfileSha256: sha(await readFile(join(project, 'package-lock.json'))), apkSha256: sha(await readFile(apk)) }, null, 2));
  assert.ok(!(await run(adb, ['-s', device, 'shell', 'pm', 'list', 'packages', appId], 'Recheck fixture ownership')).includes(appId), 'Fixture appeared during the build; refusing to replace it.');
  installAttempted = true;
  await run(adb, ['-s', device, 'install', apk], 'Install owned RN fixture'); installed = true;
  await run(adb, ['-s', device, 'shell', 'am', 'start', '-n', `${appId}/com.helloworld.MainActivity`], 'Launch RN Hermes');
  let observed;
  let lifecycleTriggered = false;
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (newArchitecture && !lifecycleTriggered) {
      const checkpoint = runChild(adb, ['-s', device, 'exec-out', 'cat', resultPath.replace('rn-probe.json', 'rn-checkpoint.json')], { timeout: 10_000 });
      if (checkpoint.status === 0 && checkpoint.stdout.includes('awaiting-background')) {
        await run(adb, ['-s', device, 'shell', 'input', 'keyevent', 'KEYCODE_HOME'], 'Background owned fixture');
        await new Promise((resolve) => setTimeout(resolve, 1500));
        await run(adb, ['-s', device, 'shell', 'am', 'start', '-n', `${appId}/com.helloworld.MainActivity`], 'Resume owned fixture');
        lifecycleTriggered = true;
      }
    }
    const result = runChild(adb, ['-s', device, 'exec-out', 'cat', resultPath], { env: environment, timeout: 10_000 });
    if (result.status === 0) { try { observed = JSON.parse(result.stdout); break; } catch { /* 완료 파일의 atomic하지 않은 짧은 쓰기를 기다린다. */ } }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  await save(join(evidence, 'runtime.json'), JSON.stringify(observed ?? { status: 'unobserved' }, null, 2));
  assert.equal(observed?.status, 'passed', `RN engine probe did not pass; evidence: ${evidence}`);
  assert.equal(observed.androidDebuggable, false);
  assert.deepEqual(observed.reactNative, { major: 0, minor: 81, patch: 4, prerelease: null });
  if (newArchitecture) {
    assert.equal(lifecycleTriggered, true);
    assert.equal(observed.newArchitectureEnabled, true);
    assert.equal(observed.nativeEchoCalls, 2);
    assert.equal(observed.controlEmissions, 1);
    assert.equal(observed.checks.length, 26);
    assert.ok(observed.states.includes('background') && observed.states.includes('active'));
  } else {
    assert.equal(observed.nativeEmissions, 4);
    assert.equal(observed.checks.length, 9);
  }
  summary = { scope: 'public-rn-event-real-engine', reactNative: '0.81.4', engine: 'Hermes', architecture: newArchitecture ? 'new-architecture' : 'legacy-bridge', buildMode: 'release', deviceKind: newEmulator ? 'emulator' : 'physical', abi,
    package: 'react-native-sound@0.13.0', sourceHashes, templateSha256: templateHash,
    lockfileSha256: sha(await readFile(join(project, 'package-lock.json'))), apkSha256: sha(await readFile(apk)), observed,
    ...(newArchitecture ? { codegen, media: '2-second silent PCM decoded and played by the original Sound MediaPlayer implementation' } : {}),
    limitations: newArchitecture ? ['One reported Android device profile with RN 0.81.4, Hermes and release mode; iOS RN and other lifecycle variants remain untested.',
      'Fabric evidence covers a native View layout event. TurboModule evidence covers generated app/public Sound specs, calls, errors and resume.',
      'Silent local PCM playback, completion, pause/resume/stop/release and one background/foreground transition; no audible-output, audio-focus interruption or process-death claim.',
      'This is RN engine evidence, separate from Flutter bridge-runtime schema and its verify-runtime gate.'] : ['One Android device, legacy bridge and release mode; Fabric/TurboModules, iOS and other lifecycle variants remain untested.',
      'Original JS subscription and Kotlin Sound.setOnPlay execute unchanged. A fixture module supplies preparation callbacks; no audio playback or full plugin behavior is claimed.',
      'This is RN engine evidence, separate from Flutter bridge-runtime schema and its verify-runtime gate.'], evidence };
  await save(join(evidence, 'verification.json'), JSON.stringify(summary, null, 2));
} catch (error) {
  primaryFailure = error;
} finally {
  const failures = [];
  if (installAttempted && !installed) {
    try { installed = (await run(adb, ['-s', device, 'shell', 'pm', 'list', 'packages', appId], 'Check interrupted installation')).split(/\r?\n/u).includes(`package:${appId}`); }
    catch { failures.push(new Error(`Unable to confirm interrupted RN installation; evidence: ${evidence}`)); }
  }
  const uninstallExit = installed ? runChild(adb, ['-s', device, 'uninstall', appId], { timeout: 60_000 }).status : undefined;
  let stopped;
  try { stopped = await stopDetachedProcess(emulatorProcess); }
  catch (error) { failures.push(error); }
  if (stopped !== undefined && !stopped.stopped) failures.push(new Error(`Owned RN emulator cleanup failed; evidence: ${evidence}`));
  if (installed && uninstallExit !== 0) failures.push(new Error(`Owned RN fixture cleanup failed; evidence: ${evidence}`));
  try {
    await save(join(evidence, 'cleanup.json'), JSON.stringify({ installed, uninstallExit, emulator: stopped }));
    await save(join(evidence, 'steps.json'), JSON.stringify(steps, null, 2));
    if (stopped?.stopped) await rm(scratch, { recursive: true, force: true });
  } catch (error) { failures.push(error); }
  throwHarnessFailures(primaryFailure, failures);
}
process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
