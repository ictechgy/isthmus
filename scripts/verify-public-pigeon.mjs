import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { capturePreflight } from './capture-preflight.mjs';
import { runChild } from './run-child.mjs';

const [flutterArg, impactArg, messagesArg, dartArg, pluginArg] = process.argv.slice(2);
if (!flutterArg || !impactArg || !messagesArg || !dartArg || !pluginArg) {
  process.stderr.write('Usage: verify-public-pigeon.mjs <flutter> <cartograph-impact> <cartograph-messages> <dartograph-entry-or-exe> <public-plugin-root>\n');
  process.exit(64);
}
const root = await realpath(await mkdtemp(join(tmpdir(), 'isthmus-public-pigeon-')));
const evidence = await realpath(await mkdtemp(join(tmpdir(), 'isthmus-pigeon-evidence-')));
try {
  const flutter = await realpath(flutterArg);
  const impact = await realpath(impactArg);
  const messages = await realpath(messagesArg);
  const dart = await realpath(dartArg);
  const original = await realpath(pluginArg);
  const nativePath = 'macos/url_launcher_macos/Sources/url_launcher_macos';
  for (const path of ['lib', nativePath, 'LICENSE']) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await cp(join(original, path), join(root, path), { recursive: true });
  }
  for (const path of ['lib/src/messages.g.dart', `${nativePath}/messages.g.swift`, `${nativePath}/UrlLauncherPlugin.swift`]) {
    assert.deepEqual(await readFile(join(root, path)), await readFile(join(original, path)), 'Public source must remain byte-identical.');
  }
  const pubspec = (await readFile(join(original, 'pubspec.yaml'), 'utf8')).replace(/\ndev_dependencies:\n[\s\S]*?(?=\n\S|$)/u, '\n');
  await writeFile(join(root, 'pubspec.yaml'), pubspec, { mode: 0o600 });
  const versionResult = runChild(flutter, ['--no-version-check', '--version', '--machine']);
  assert.equal(versionResult.status, 0, 'Flutter version');
  const version = JSON.parse(versionResult.stdout);
  const framework = join(version.flutterRoot, 'bin/cache/artifacts/engine/darwin-x64/FlutterMacOS.xcframework/macos-arm64_x86_64');
  // 실제 Flutter framework로 공개 Swift source를 컴파일한다. 검증용 manifest만 별도로 둔다.
  await writeFile(join(root, 'Package.swift'), `// swift-tools-version: 5.9
import PackageDescription
let package = Package(name: "PublicPigeon", platforms: [.macOS(.v12)], products: [.library(name: "PublicPigeon", targets: ["PublicPigeon"])],
  targets: [.target(name: "PublicPigeon", path: ${JSON.stringify(nativePath)},
    swiftSettings: [.unsafeFlags(["-F", ${JSON.stringify(framework)}])],
    linkerSettings: [.unsafeFlags(["-F", ${JSON.stringify(framework)}, "-framework", "FlutterMacOS"])])])
`, { mode: 0o600 });
  const pub = runChild(flutter, ['--no-version-check', 'pub', 'get', '--offline'], { cwd: root,
    env: { ...process.env, CI: 'true', FLUTTER_SUPPRESS_ANALYTICS: 'true' }, timeout: 120_000 });
  assert.equal(pub.status, 0, 'Offline public runtime dependency setup');
  const config = { project: root, inputs: ['lib', nativePath, 'pubspec.yaml', 'pubspec.lock', 'Package.swift', '.dart_tool/package_config.json'],
    toolInputs: [impact, messages, dart, join(version.flutterRoot, 'version'),
      ...(dart.endsWith('.dart') ? [join(dirname(dirname(dart)), 'lib'), join(dirname(dirname(dart)), '.dart_tool/package_config.json')] : [])],
    prepare: [['swift', 'build', '--package-path', root]], cartograph: [impact],
    dartograph: dart.endsWith('.dart') || dart.endsWith('.snapshot') ? ['dart', dart] : [dart],
    messages: { cartograph: [messages] }, selection: { swift: { files: [`${nativePath}/UrlLauncherPlugin.swift`], symbols: [] } },
    output: join(evidence, 'context.json'), cache: join(evidence, 'cache.json') };
  const captured = await capturePreflight(config);
  assert.equal(captured.context.messages.length, 2);
  const facts = captured.context.messages.flatMap(({ facts }) => facts);
  assert.equal(facts.filter(({ kind }) => kind === 'message-send').length, 2);
  assert.equal(facts.filter(({ kind }) => kind === 'message-handle').length, 2);
  assert.ok(facts.every(({ dynamic, channelPrefix }) => dynamic && channelPrefix.startsWith('dev.flutter.pigeon.url_launcher_macos.UrlLauncherApi.')));
  assert.ok(facts.filter(({ kind }) => kind === 'message-handle').every(({ symbol }) => typeof symbol?.usr === 'string'));
  const symbols = captured.report.affected.filter(({ subject }) => subject.kind === 'symbol' && subject.platform === 'dart').map(({ subject }) => subject.symbol.id);
  assert.ok(symbols.some((name) => name.includes('UrlLauncherApi.canLaunchUrl')), 'Native implementation must reach generated Dart API.');
  assert.ok(symbols.some((name) => name.endsWith('::UrlLauncherMacOS.canLaunch')), 'Generated API must reach public Dart consumer.');
  assert.ok(captured.report.limitations.some(({ code }) => code === 'dynamic-message-address'), 'Pigeon suffix remains unproven.');
  const verification = { scope: 'public-pigeon-source-real-producers', publicPlugin: 'url_launcher_macos@3.2.2',
    runtimeExecution: false, validationManifest: 'SwiftPM using real Flutter framework; Dart dev dependencies excluded',
    revision: captured.context.revision, milliseconds: captured.milliseconds, timings: captured.timings,
    summary: captured.report.summary, dartSymbols: symbols, messages: captured.context.messages.map(({ platform, facts }) => ({ platform, facts: facts.length })) };
  await writeFile(join(evidence, 'verification.json'), JSON.stringify(verification, null, 2), { mode: 0o600 });
  // 전체 파일 선택만으로는 공통 등록 함수가 서로 독립적인 handler를 합치는 오탐을 볼 수 없다.
  // 실제 producer가 확인한 한 구현 USR만 다시 선택해 Dart 소비자가 해당 API로 좁혀지는지 검사한다.
  const launch = captured.context.analyses.filter(({ platform }) => platform === 'swift').flatMap(({ roots }) => roots)
    .filter(({ qualifiedName }) => qualifiedName === 'PublicPigeon.launch(url:)');
  assert.equal(launch.length, 1, 'Public native implementation must have one producer identity.');
  const precise = await capturePreflight({ ...config,
    selection: { swift: { files: [], symbols: [launch[0].id] } },
    output: join(evidence, 'launch-context.json'), cache: join(evidence, 'launch-cache.json') });
  const preciseSymbols = precise.report.affected.filter(({ subject }) => subject.kind === 'symbol' && subject.platform === 'dart')
    .map(({ subject }) => subject.symbol.id);
  await writeFile(join(evidence, 'launch-verification.json'), JSON.stringify({
    selected: launch[0], summary: precise.report.summary, dartSymbols: preciseSymbols,
  }, null, 2), { mode: 0o600 });
  assert.ok(preciseSymbols.some((name) => name.endsWith('::UrlLauncherMacOS.launch')), 'A native launch change must reach Dart launch.');
  assert.ok(!preciseSymbols.some((name) => name.endsWith('::UrlLauncherMacOS.canLaunch')),
    'A native launch change must not reach the independent canLaunch handler through shared setup.');
  const canLaunch = captured.context.analyses.filter(({ platform }) => platform === 'swift').flatMap(({ roots }) => roots)
    .filter(({ qualifiedName }) => qualifiedName === 'PublicPigeon.canLaunch(url:)');
  assert.equal(canLaunch.length, 1);
  const setupIds = [...new Set(facts.filter(({ kind }) => kind === 'message-handle').map(({ symbol }) => symbol.usr))];
  assert.equal(setupIds.length, 1, 'Both handlers share one actual setup declaration.');
  for (const scenario of [
    { name: 'can-launch', id: canLaunch[0].id, expected: ['canLaunch'] },
    { name: 'setup', id: setupIds[0], expected: ['canLaunch', 'launch'] },
  ]) {
    const result = await capturePreflight({ ...config, selection: { swift: { files: [], symbols: [scenario.id] } },
      output: join(evidence, `${scenario.name}-context.json`), cache: join(evidence, `${scenario.name}-cache.json`) });
    const wrappers = result.report.affected.filter(({ subject }) => subject.kind === 'symbol' && subject.platform === 'dart')
      .map(({ subject }) => subject.symbol.id).filter((id) => id.includes('::UrlLauncherMacOS.')).map((id) => id.split('.').at(-1)).sort();
    assert.deepEqual(wrappers, scenario.expected, 'Independent method and shared setup changes must retain their distinct impact.');
    await writeFile(join(evidence, `${scenario.name}-verification.json`), JSON.stringify({
      selected: scenario.id, wrappers, summary: result.report.summary, milliseconds: result.milliseconds,
    }, null, 2), { mode: 0o600 });
  }
  process.stdout.write(`${JSON.stringify({ verified: true, evidence, milliseconds: captured.milliseconds, summary: captured.report.summary })}\n`);
} catch (error) {
  process.stderr.write(`Public Pigeon verification failed: ${error.message}\nEvidence: ${evidence}\n`);
  process.exitCode = 1;
} finally { await rm(root, { recursive: true, force: true }); }
