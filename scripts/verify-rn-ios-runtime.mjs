import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { runChild } from './run-child.mjs';
import { throwHarnessFailures } from './runtime-harness-failures.mjs';
import { writeEvidenceManifest } from './runtime-evidence-manifest.mjs';
import { fetchPinnedPackage } from '../experiments/real-corpus/public-archive.mjs';
import { silentWav } from './fixtures/rn-new-architecture.mjs';
import { appDelegate, spec, header, implementation, javascript } from './fixtures/rn-ios-new-architecture.mjs';

const workaround = process.argv[2] === '--fmt-consteval-workaround';
if (process.argv.length !== (workaround ? 3 : 2) || process.platform !== 'darwin') {
  process.stderr.write('Usage: verify-rn-ios-runtime.mjs [--fmt-consteval-workaround] (macOS, Xcode, CocoaPods and an installed iOS simulator runtime)\n');
  process.exit(64);
}
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const scratch = await realpath(await mkdtemp(join(tmpdir(), 'isthmus-rn-ios-')));
const evidence = await realpath(await mkdtemp(join(tmpdir(), 'isthmus-rn-ios-evidence-')));
const project = join(scratch, 'app');
const appId = 'dev.isthmus.rniosprobe';
const steps = [];
const environment = { ...process.env, CI: 'true', RCT_NEW_ARCH_ENABLED: '1', COCOAPODS_DISABLE_STATS: 'true' };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
let simulator, installed = false, primaryFailure, summary;
async function save(path, value) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, value, { mode: 0o600 }); }
async function run(command, args, label, cwd = scratch, timeout = 180_000) {
  const started = performance.now();
  const result = runChild(command, args, { cwd, env: environment, timeout, maxBuffer: 32 * 1024 * 1024 });
  steps.push({ label, exit: result.status, milliseconds: Math.round(performance.now() - started) });
  process.stderr.write(`RN iOS verification: ${label} (${result.status})\n`);
  await save(join(evidence, `step-${steps.length}.log`), result.stdout + '\n' + result.stderr);
  assert.ok(result.status === 0 && !result.error, `${label} failed; evidence: ${evidence}`);
  return result.stdout;
}

try {
  const archive = join(scratch, 'template.tgz');
  const templateSha256 = '30c8abfddb2ae16ec3145a560dd3fe64ffd12c0f0f4d85aab63526c3ed4f9692';
  await run('curl', ['-fsSL', '--retry', '3', '-o', archive, '--', 'https://registry.npmjs.org/@react-native-community/template/-/template-0.81.4.tgz'], 'Download pinned template');
  assert.equal(sha(await readFile(archive)), templateSha256);
  const listing = await run('tar', ['-tzf', archive], 'Check template members');
  assert.ok(listing.split('\n').filter(Boolean).every(name => name.startsWith('package/') && !name.split('/').includes('..')));
  const types = await run('tar', ['-tvzf', archive], 'Check template types');
  assert.ok(types.split('\n').filter(Boolean).every(line => /^[d-]/u.test(line)));
  await run('tar', ['-xzf', archive, '-C', scratch], 'Extract pinned template');
  const template = join(scratch, 'package/template');
  await cp(template, project, { recursive: true, filter: path => !relative(template, path).split('/').includes('android') });
  const manifest = JSON.parse(await readFile(join(root, 'experiments/real-corpus/manifest.json'), 'utf8')).rnEvents['react-native-sound@0.13.0'];
  const original = await fetchPinnedPackage(manifest, scratch);
  await cp(original, join(project, 'sound'), { recursive: true });
  const sourceHashes = {};
  for (const path of [manifest.source, ...(await readdir(join(original, 'ios'))).filter(name => /\.(?:m|mm|h)$/u.test(name)).map(name => 'ios/' + name)]) {
    const bytes = await readFile(join(original, path));
    assert.deepEqual(await readFile(join(project, 'sound', path)), bytes);
    sourceHashes[path] = sha(bytes);
  }
  const pkg = JSON.parse(await readFile(join(project, 'package.json'), 'utf8'));
  pkg.dependencies = { react: '19.1.0', 'react-native': '0.81.4', 'react-native-sound': 'file:./sound' };
  pkg.devDependencies = Object.fromEntries(Object.entries(pkg.devDependencies).filter(([name]) =>
    ['@babel/core', '@babel/runtime', '@react-native-community/cli', '@react-native-community/cli-platform-ios', '@react-native/babel-preset', '@react-native/metro-config'].includes(name)));
  pkg.codegenConfig = { name: 'IsthmusIOSProbeSpec', type: 'modules', jsSrcsDir: 'specs', ios: { modulesProvider: { IsthmusIOSProbe: 'IsthmusIOSProbe' } } };
  await save(join(project, 'package.json'), JSON.stringify(pkg, null, 2));
  await save(join(project, 'specs/NativeIsthmusIOSProbe.ts'), spec);
  await save(join(project, 'index.js'), javascript);
  await save(join(project, 'ios/HelloWorld/IsthmusIOSProbe.h'), header);
  await save(join(project, 'ios/HelloWorld/IsthmusIOSProbe.mm'), implementation);
  await save(join(project, 'ios/HelloWorld/isthmus_silence.wav'), silentWav());
  await save(join(project, 'ios/HelloWorld/AppDelegate.swift'), appDelegate);
  await run('plutil', ['-insert', 'UIApplicationSceneManifest', '-json', JSON.stringify({ UIApplicationSupportsMultipleScenes: false,
    UISceneConfigurations: { UIWindowSceneSessionRoleApplication: [{ UISceneConfigurationName: 'Default', UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate' }] } }),
  join(project, 'ios/HelloWorld/Info.plist')], 'Configure fixture scene lifecycle');
  // CocoaPods가 로드한 Xcodeproj로 소유한 템플릿에 source/resource를 등록한다.
  const podfile = join(project, 'ios/Podfile');
  await save(podfile, (await readFile(podfile, 'utf8')) + `
probe_project = Xcodeproj::Project.open('HelloWorld.xcodeproj')
probe_target = probe_project.targets.find { |target| target.name == 'HelloWorld' }
probe_group = probe_project.main_group['HelloWorld']
['IsthmusIOSProbe.h', 'IsthmusIOSProbe.mm', 'isthmus_silence.wav'].each do |name|
  ref = probe_group.new_file('HelloWorld/' + name)
  probe_target.source_build_phase.add_file_reference(ref) if name.end_with?('.mm')
  probe_target.resources_build_phase.add_file_reference(ref) if name.end_with?('.wav')
end
probe_target.build_configurations.each do |config|
  config.build_settings['PRODUCT_BUNDLE_IDENTIFIER'] = '${appId}'
  config.build_settings['OTHER_LDFLAGS'] = Array(config.build_settings['OTHER_LDFLAGS'] || '$(inherited)') + ['-framework', 'AVFoundation', '-framework', 'AVFAudio', '-framework', 'AudioToolbox']
end
probe_project.save
`);
  await run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], 'Install pinned RN tooling', project, 600_000);
  await run('pod', ['install'], 'Install CocoaPods and generate native specs', join(project, 'ios'), 900_000);
  let dependencyAdjustment;
  if (workaround) {
    // RN 0.81.4의 fmt 11.0.2와 새 Apple clang의 consteval 충돌: fmtlib/fmt#4740.
    const lock = await readFile(join(project, 'ios/Podfile.lock'), 'utf8');
    assert.match(lock, /fmt \(11\.0\.2\)/u);
    const path = join(project, 'ios/Pods/fmt/include/fmt/base.h');
    const originalHeader = await readFile(path, 'utf8');
    assert.equal(originalHeader.split('#  define FMT_USE_CONSTEVAL 1').length - 1, 2);
    const patched = originalHeader.replaceAll('#  define FMT_USE_CONSTEVAL 1', '#  define FMT_USE_CONSTEVAL 0');
    await save(join(evidence, 'fmt-base-original.h'), originalHeader);
    await save(join(evidence, 'fmt-base-patched.h'), patched);
    // 전역 CocoaPods cache와 hard link를 공유하더라도 소유한 경로만 교체한다.
    await save(path + '.isthmus-pending', patched); await rename(path + '.isthmus-pending', path);
    dependencyAdjustment = { dependency: 'fmt 11.0.2', setting: 'FMT_USE_CONSTEVAL=0',
      originalSha256: sha(originalHeader), patchedSha256: sha(patched), reference: 'https://github.com/fmtlib/fmt/issues/4740' };
  }
  await cp(project, join(evidence, 'fixture'), { recursive: true, filter: path =>
    !relative(project, path).split('/').some(part => ['node_modules', 'Pods', 'build', '.git', 'android'].includes(part)) && !path.endsWith('.keystore') });
  await cp(join(project, 'ios/build/generated/ios'), join(evidence, 'codegen'), { recursive: true });
  const codegen = await readFile(join(evidence, 'codegen/IsthmusIOSProbeSpec/IsthmusIOSProbeSpec.h'), 'utf8');
  assert.ok(codegen.includes('NativeIsthmusIOSProbeSpecJSI'));
  const soundCodegen = await readFile(join(evidence, 'codegen/RNSoundSpec/RNSoundSpec.h'), 'utf8');
  assert.ok(soundCodegen.includes('NativeSoundIOSSpecJSI'));
  await run('xcodebuild', ['-quiet', '-workspace', 'HelloWorld.xcworkspace', '-scheme', 'HelloWorld', '-configuration', 'Release',
    '-sdk', 'iphonesimulator', '-destination', 'generic/platform=iOS Simulator', '-derivedDataPath', join(scratch, 'DerivedData'),
    '-jobs', '2', `ARCHS=${process.arch === 'arm64' ? 'arm64' : 'x86_64'}`, 'CODE_SIGNING_ALLOWED=NO'], 'Build RN iOS release', join(project, 'ios'), 1_800_000);
  const app = join(scratch, 'DerivedData/Build/Products/Release-iphonesimulator/HelloWorld.app');
  await run('tar', ['-czf', join(evidence, 'app-release.tar.gz'), '-C', dirname(app), 'HelloWorld.app'], 'Preserve compiled iOS app');
  const runtimes = JSON.parse(await run('xcrun', ['simctl', 'list', 'runtimes', '--json'], 'Find iOS runtime')).runtimes;
  const runtime = runtimes.filter(value => value.isAvailable && value.identifier.includes('.iOS-')).at(-1);
  assert.ok(runtime, 'An available iOS runtime is required.');
  const deviceTypes = JSON.parse(await run('xcrun', ['simctl', 'list', 'devicetypes', '--json'], 'Find simulator type')).devicetypes;
  const deviceType = deviceTypes.find(value => value.name === 'iPhone 17 Pro') ?? deviceTypes.filter(value => value.name.startsWith('iPhone')).at(-1);
  assert.ok(deviceType);
  const created = (await run('xcrun', ['simctl', 'create', 'Isthmus RN owned fixture', deviceType.identifier, runtime.identifier], 'Create owned iOS simulator')).trim();
  assert.match(created, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu);
  simulator = created;
  await run('xcrun', ['simctl', 'boot', simulator], 'Boot owned iOS simulator');
  await run('xcrun', ['simctl', 'bootstatus', simulator, '-b'], 'Wait for owned simulator');
  await run('xcrun', ['simctl', 'install', simulator, app], 'Install owned iOS fixture'); installed = true;
  const container = (await run('xcrun', ['simctl', 'get_app_container', simulator, appId, 'data'], 'Locate owned app evidence')).trim();
  const observations = [];
  for (const attempt of [0, 1]) {
    await run('xcrun', ['simctl', 'launch', '--stdout=' + join(evidence, `runtime-${attempt}.stdout.log`),
      '--stderr=' + join(evidence, `runtime-${attempt}.stderr.log`), simulator, appId], attempt ? 'Restart owned iOS fixture' : 'Launch owned iOS fixture');
    let observed;
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      try {
        const value = JSON.parse(await readFile(join(container, 'Documents/rn-probe.json'), 'utf8'));
        if (typeof value.runId === 'string' && value.runId !== observations[0]?.runId) { observed = value; break; }
      } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    await save(join(evidence, `runtime-${attempt}.json`), JSON.stringify(observed ?? { status: 'unobserved' }, null, 2));
    if (observed?.status !== 'passed') {
      const log = runChild('xcrun', ['simctl', 'spawn', simulator, 'log', 'show', '--last', '3m', '--style', 'compact', '--predicate', 'process == "HelloWorld"'], { timeout: 30_000 });
      await save(join(evidence, `runtime-${attempt}.system.log`), log.stdout + '\n' + log.stderr);
      await save(join(evidence, `runtime-${attempt}.log-capture.json`), JSON.stringify({ exit: log.status, error: log.error?.code }));
    }
    assert.equal(observed?.status, 'passed', `RN iOS probe failed; evidence: ${evidence}`);
    assert.equal(observed.nativeRelease, true);
    assert.equal(observed.nativeEchoCalls, 1);
    assert.equal(observed.checks.length, 20);
    const { major, minor, patch, prerelease } = observed.reactNative;
    assert.deepEqual({ major, minor, patch }, { major: 0, minor: 81, patch: 4 });
    assert.ok(prerelease == null, 'A release RN version is required.');
    observations.push(observed);
    if (attempt === 0) await run('xcrun', ['simctl', 'terminate', simulator, appId], 'Terminate owned iOS process');
  }
  summary = { scope: 'public-rn-ios-real-engine', reactNative: '0.81.4', engine: 'Hermes', architecture: 'new-architecture',
    buildMode: 'release', deviceKind: 'owned-simulator', runtime: runtime.version, package: 'react-native-sound@0.13.0',
    sourceHashes, templateSha256, codegen: { probe: sha(codegen), sound: sha(soundCodegen) },
    appArchiveSha256: sha(await readFile(join(evidence, 'app-release.tar.gz'))), lockfileSha256: sha(await readFile(join(project, 'package-lock.json'))),
    observations, dependencyAdjustment, processRestart: { termination: 'simctl terminate', freshRun: true },
    limitations: ['One iOS simulator profile; physical iOS RN, incoming calls, audio session interruptions and low-memory kills are untested.',
      'Silent PCM playback and a built-in Fabric View; audible output and arbitrary Fabric components are outside this fixture.',
      'RN engine evidence is separate from Flutter bridge-runtime and static producer completeness.'], evidence };
  await save(join(evidence, 'verification.json'), JSON.stringify(summary, null, 2));
} catch (error) { primaryFailure = error; }
finally {
  const failures = [];
  const cleanup = {};
  if (simulator) {
    for (const action of [...(installed ? ['uninstall'] : []), 'shutdown', 'delete']) {
      const result = runChild('xcrun', ['simctl', action, simulator, ...(action === 'uninstall' ? [appId] : [])], { timeout: 60_000 });
      cleanup[action + 'Exit'] = result.status;
      try { await save(join(evidence, 'cleanup-' + action + '.log'), result.stdout + '\n' + result.stderr); }
      catch (error) { failures.push(error); }
    }
    if (Object.values(cleanup).some(value => value !== 0)) failures.push(new Error(`Owned iOS simulator cleanup failed; evidence: ${evidence}`));
  }
  try {
    await save(join(evidence, 'cleanup.json'), JSON.stringify(cleanup));
    await save(join(evidence, 'steps.json'), JSON.stringify(steps, null, 2));
    await save(join(evidence, 'local-inputs.json'), JSON.stringify({ scratch, project }));
    const manifest = await writeEvidenceManifest(evidence);
    if (summary) {
      summary.cleanup = cleanup; summary.evidenceManifest = manifest;
      await save(join(evidence, 'verification.json'), JSON.stringify(summary, null, 2));
    }
    if (!primaryFailure && failures.length === 0) await rm(scratch, { recursive: true, force: true });
  } catch (error) { failures.push(error); }
  throwHarnessFailures(primaryFailure, failures);
}
process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
