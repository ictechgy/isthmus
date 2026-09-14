import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { capturePreflight } from './capture-preflight.mjs';
import { runChild } from './run-child.mjs';

const [cartographPath, dartographEntry, flutterPath] = process.argv.slice(2);
if (!cartographPath || !dartographEntry || !flutterPath) {
  process.stderr.write('Usage: verify-preflight-producers.mjs <cartograph-bin> <dartograph.dart> <flutter-bin>\n');
  process.exit(64);
}
const root = await realpath(await mkdtemp(join(tmpdir(), 'isthmus-preflight-corpus-')));
const evidence = await realpath(await mkdtemp(join(tmpdir(), 'isthmus-preflight-evidence-')));
const entry = await realpath(dartographEntry);
const cartograph = await realpath(cartographPath);
const flutter = await realpath(flutterPath);
const sources = {
  'Package.swift': `// swift-tools-version: 6.0
import PackageDescription
let package = Package(name: "PreflightCorpus", targets: [
  .target(name: "Flutter", path: "Stub/Flutter"),
  .target(name: "Bridge", dependencies: ["Flutter"])
])
`,
  'Stub/Flutter/Flutter.swift': `public struct FlutterMethodCall { public let method: String }
public final class FlutterMethodChannel {
  public init(name: String, binaryMessenger: Any) {}
}
public protocol FlutterPluginRegistrar: AnyObject {
  func messenger() -> Any
  func addMethodCallDelegate(_ delegate: AnyObject, channel: FlutterMethodChannel)
}
`,
  'Sources/Bridge/Helper.swift': 'public func loadNativeValue() -> String { "native" }\n',
  'Sources/Bridge/Plugin.swift': `import Flutter
public final class CameraPlugin {
  public static func register(with registrar: FlutterPluginRegistrar) {
    let channel = FlutterMethodChannel(name: "camera", binaryMessenger: registrar.messenger())
    registrar.addMethodCallDelegate(CameraPlugin(), channel: channel)
  }
  public func handle(_ call: FlutterMethodCall, result: (Any?) -> Void) {
    switch call.method {
    case "photo": result(loadNativeValue())
    default: result(nil)
    }
  }
}
`,
  'pubspec.yaml': 'name: preflight_corpus\nversion: 1.0.0\nenvironment:\n  sdk: ">=3.7.0 <4.0.0"\ndependencies:\n  flutter:\n    sdk: flutter\n',
  'lib/bridge.dart': `import 'package:flutter/services.dart';
class CameraBridge {
  Future<String?> photo() {
    const channel = MethodChannel('camera');
    return channel.invokeMethod<String>('photo');
  }
}
`,
  'lib/service.dart': `import 'bridge.dart';
class CameraService {
  Future<String?> snap() => CameraBridge().photo();
}
`,
  'lib/screen.dart': `import 'service.dart';
class CameraScreen {
  Future<String?> capture() => CameraService().snap();
}
`,
};
try {
  for (const [path, text] of Object.entries(sources)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text, { flag: 'wx', mode: 0o600 });
  }
  const pub = runChild(flutter, ['--no-version-check', 'pub', 'get', '--offline'], {
    cwd: root, timeout: 120_000, env: { ...process.env, CI: 'true', FLUTTER_SUPPRESS_ANALYTICS: 'true' },
  });
  assert.equal(pub.status, 0, 'offline Flutter package setup');
  const config = {
    project: root, inputs: ['Sources', 'Stub', 'lib', 'Package.swift', 'pubspec.yaml', 'pubspec.lock', '.dart_tool/package_config.json'],
    toolInputs: [cartograph, entry, join(dirname(dirname(entry)), 'lib'), join(dirname(dirname(entry)), '.dart_tool/package_config.json')],
    prepare: [['swift', 'build', '--package-path', root]], dartograph: ['dart', entry], cartograph: [cartograph],
    selection: { swift: { files: ['Sources/Bridge/Helper.swift'], symbols: [] } },
    output: join(evidence, 'context.json'), cache: join(evidence, 'cache.json'),
  };
  const first = await capturePreflight(config);
  assert.equal(first.cached, false);
  assert.ok(first.context.bridges.every(({ tool }) => tool.name === 'dartograph' || tool.name === 'cartograph'));
  const affected = first.report.affected;
  const screen = affected.find(({ subject }) => subject.kind === 'symbol' && subject.symbol.id.endsWith('::CameraScreen.capture'));
  assert.ok(screen, 'real producer graph reaches the Dart screen method');
  const nodes = new Map([...first.report.roots.map((subject) => [subject.key, { subject }]), ...affected.map((row) => [row.subject.key, row])]);
  const path = [];
  for (let row = screen; row; row = nodes.get(row.via)) path.push(row.subject.kind === 'bridge' ? row.subject.channel : row.subject.symbol.qualifiedName);
  assert.ok(path.some((name) => name.includes('loadNativeValue')), 'path starts at native helper');
  assert.ok(path.some((name) => name.includes('handle')), 'path crosses native handler');
  assert.ok(path.includes('camera'), 'path crosses the channel');
  assert.ok(first.report.reviewFiles.includes('lib/screen.dart'), 'Dart declaration source survives the adapters');
  const repeat = await capturePreflight(config);
  assert.equal(repeat.cached, true);
  assert.equal(repeat.context.revision, first.context.revision);
  await writeFile(join(root, 'Sources/Bridge/Helper.swift'), 'public func loadNativeValue() -> String { "changed" }\n');
  const changed = await capturePreflight(config);
  assert.equal(changed.cached, false);
  assert.notEqual(changed.context.revision, first.context.revision);
  assert.ok(changed.report.reviewFiles.includes('lib/screen.dart'));
  const verification = { verified: true, scope: 'synthetic-source-real-producers', nativeRuntime: false,
    revision: changed.context.revision, firstMilliseconds: first.milliseconds, cachedMilliseconds: repeat.milliseconds,
    changedMilliseconds: changed.milliseconds, path, summary: changed.report.summary,
    limitations: changed.report.limitations, firstTimings: first.timings, changedTimings: changed.timings };
  await writeFile(join(evidence, 'verification.json'), JSON.stringify(verification, null, 2), { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ verified: true, evidence, firstMilliseconds: first.milliseconds,
    cachedMilliseconds: repeat.milliseconds, changedMilliseconds: changed.milliseconds, summary: changed.report.summary })}\n`);
} catch (error) {
  process.stderr.write(`Preflight producer verification failed: ${error.message}\nEvidence directory: ${evidence}\n`);
  process.exitCode = 1;
} finally { await rm(root, { recursive: true, force: true }); }
