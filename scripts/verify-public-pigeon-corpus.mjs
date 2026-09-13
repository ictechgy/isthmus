import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir, tmpdir } from 'node:os';

import { capturePreflight } from './capture-preflight.mjs';
import { runChild } from './run-child.mjs';

const [flutterArg, impactArg, messagesArg, dartArg, ...unexpected] = process.argv.slice(2);
if (!flutterArg || !impactArg || !messagesArg || !dartArg || unexpected.length > 0 || process.platform !== 'darwin') {
  process.stderr.write('Usage (macOS): verify-public-pigeon-corpus.mjs <flutter> <cartograph-impact> <cartograph-messages> <dartograph-aot>\n');
  process.exit(64);
}

const evidence = await realpath(await mkdtemp(join(tmpdir(), 'isthmus-public-foundation-evidence-')));
const workspace = await realpath(await mkdtemp(join(tmpdir(), 'isthmus-public-foundation-corpus-')));
const packages = [
  {
    name: 'path_provider_foundation', version: '2.4.1',
    nativeRelative: 'darwin/path_provider_foundation/Sources/path_provider_foundation',
    nativeFile: 'darwin/path_provider_foundation/Sources/path_provider_foundation/PathProviderPlugin.swift',
    expected: {
      native: 'getDirectoryPath', generated: 'PathProviderApi.getDirectoryPath', wrapper: 'PathProviderFoundation.getTemporaryPath',
    },
  },
  {
    name: 'shared_preferences_foundation', version: '2.5.4',
    nativeRelative: 'darwin/shared_preferences_foundation/Sources/shared_preferences_foundation',
    nativeFile: 'darwin/shared_preferences_foundation/Sources/shared_preferences_foundation/SharedPreferencesPlugin.swift',
    expected: {
      native: 'getValue', generated: 'UserDefaultsApi.getValue', wrapper: 'SharedPreferencesAsyncFoundation.getString',
    },
  },
];

try {
  const flutter = await realpath(flutterArg);
  const impact = await realpath(impactArg);
  const messages = await realpath(messagesArg);
  const dart = await realpath(dartArg);
  const versionResult = runChild(flutter, ['--no-version-check', '--version', '--machine'], { timeout: 60_000 });
  assert.equal(versionResult.status, 0, 'Flutter version');
  const version = JSON.parse(versionResult.stdout);
  const framework = join(version.flutterRoot, 'bin/cache/artifacts/engine/darwin-x64/FlutterMacOS.xcframework/macos-arm64_x86_64');
  const pubCache = process.env.PUB_CACHE ?? join(homedir(), '.pub-cache');
  const results = [];
  for (const definition of packages) {
    results.push(await verifyPackage(definition, { flutter, impact, messages, dart, framework,
      flutterRoot: version.flutterRoot, pubCache }));
  }
  const summary = { format: 'isthmus-public-pigeon-corpus-verification', version: 1,
    runtimeExecution: false, userDefaultsAccess: false, flutter: version.frameworkVersion, dart: version.dartSdkVersion,
    tools: { cartographImpact: impact, cartographMessages: messages, dartograph: dart }, packages: results };
  await writeFile(join(evidence, 'verification.json'), JSON.stringify(summary, null, 2), { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ verified: true, evidence, packages: results.map(({ name, revision, milliseconds }) => ({ name, revision, milliseconds })) })}\n`);
} catch (error) {
  process.stderr.write(`Public Foundation corpus verification failed: ${error.message}\nEvidence: ${evidence}\n`);
  process.exitCode = 1;
} finally {
  await rm(workspace, { recursive: true, force: true });
}

async function verifyPackage(definition, tools) {
  const source = await realpath(join(tools.pubCache, 'hosted/pub.dev', `${definition.name}-${definition.version}`));
  const packageRoot = join(workspace, definition.name);
  const preserved = ['lib', definition.nativeRelative, 'LICENSE'];
  // 분석에 필요한 production source만 선언된 입력으로 복사한다. SDK가 없는 테스트 트리를
  // 함께 복사하고 dev dependency를 제거하면 검증 하네스가 스스로 분석 오류를 만든다.
  for (const relative of [...preserved, 'pubspec.yaml']) {
    await mkdir(dirname(join(packageRoot, relative)), { recursive: true });
    await cp(join(source, relative), join(packageRoot, relative), { recursive: true });
  }
  const sourceProof = [];
  for (const relative of [
    definition.nativeFile,
    definition.name === 'path_provider_foundation' ? 'lib/messages.g.dart' : 'lib/src/messages.g.dart',
    'LICENSE',
  ]) {
    const original = await readFile(join(source, relative));
    const staged = await readFile(join(packageRoot, relative));
    assert.deepEqual(staged, original, `${definition.name} source must remain byte-identical: ${relative}`);
    sourceProof.push({ path: relative, sha256: createHash('sha256').update(original).digest('hex') });
  }
  await assertTreeEqual(source, packageRoot, 'lib');
  await assertTreeEqual(source, packageRoot, definition.nativeRelative);
  const sourceManifest = await readFile(join(source, 'pubspec.yaml'), 'utf8');
  assert.match(sourceManifest, new RegExp(`(?:^|\\n)name:\\s*${definition.name}\\s*(?:\\n|$)`, 'u'));
  assert.match(sourceManifest, new RegExp(`(?:^|\\n)version:\\s*${definition.version.replaceAll('.', '\\.') }\\s*(?:\\n|$)`, 'u'));
  // 생성기·테스트는 이번 production source 범위 밖이다. 원본 구현은 그대로 두고
  // 검증용 manifest에서 dev dependency만 제외해 offline pub 해석을 사용한다.
  const stagedManifest = sourceManifest.replace(/\ndev_dependencies:\n[\s\S]*?(?=\n\S|$)/u, '\n');
  await writeFile(join(packageRoot, 'pubspec.yaml'), stagedManifest, { mode: 0o600 });
  await writeFile(join(packageRoot, 'Package.swift'), swiftManifest(definition, tools.framework), { mode: 0o600 });
  const pub = runChild(tools.flutter, ['--no-version-check', 'pub', 'get', '--offline'], {
    cwd: packageRoot, timeout: 120_000, env: { ...process.env, CI: 'true', FLUTTER_SUPPRESS_ANALYTICS: 'true' },
  });
  assert.equal(pub.status, 0, `${definition.name} offline pub get`);
  const project = await realpath(packageRoot);
  const nativePath = definition.nativeRelative;
  const config = {
    project,
    inputs: ['lib', nativePath, 'pubspec.yaml', 'pubspec.lock', 'Package.swift', '.dart_tool/package_config.json', 'LICENSE'],
    toolInputs: [tools.impact, tools.messages, tools.dart, join(tools.flutterRoot, 'version'),
      join(tools.flutterRoot, 'bin/cache/dart-sdk/version')],
    prepare: [['swift', 'build', '--package-path', project], swiftIndexCommand(definition, project, tools.framework)],
    dartograph: [tools.dart], cartograph: [tools.impact], messages: { cartograph: [tools.messages] },
    selection: { swift: { files: [definition.nativeFile], symbols: [] } },
    indexStore: join(project, '.build/index/manual'),
    output: join(evidence, `${definition.name}.context.json`), cache: join(evidence, `${definition.name}.cache.json`),
  };
  await mkdir(config.indexStore, { recursive: true });
  const captured = await capturePreflight(config);
  const nativeRoots = captured.context.analyses.filter(({ platform }) => platform === 'swift')
    .flatMap(({ roots }) => roots).filter(({ qualifiedName }) => qualifiedName.includes(definition.expected.native));
  assert.equal(nativeRoots.length, 1, `${definition.name} native implementation selector must be unique.`);
  const precise = await capturePreflight({ ...config,
    selection: { swift: { files: [], symbols: [nativeRoots[0].id] } },
    output: join(evidence, `${definition.name}.precise.context.json`), cache: join(evidence, `${definition.name}.precise.cache.json`),
  });
  await access(join(config.indexStore, 'v5', 'records'));
  assert.ok([...precise.context.bridges, ...precise.context.messages].every(({ project: documentProject }) =>
    documentProject === precise.context.project), `${definition.name} producer projects must agree.`);
  const path = evidencePath(precise.report, definition.expected);
  assert.ok(path !== undefined, `${definition.name} must have a source-backed native→generated→wrapper path.`);
  const messageFacts = precise.context.messages.flatMap(({ facts }) => facts);
  const nativePrefix = `dev.flutter.pigeon.${definition.name}.`;
  assert.ok(messageFacts.some(({ kind, channelPrefix, channel }) => kind === 'message-send' &&
    (channelPrefix?.startsWith(nativePrefix) || channel?.startsWith(nativePrefix))), `${definition.name} Dart message facts`);
  assert.ok(messageFacts.some(({ kind, channelPrefix, channel }) => kind === 'message-handle' &&
    (channelPrefix?.startsWith(nativePrefix) || channel?.startsWith(nativePrefix))), `${definition.name} Swift message facts`);
  const raw = JSON.parse(await readFile(join(evidence, `${definition.name}.precise.context.json.sources.json`)));
  const verification = {
    name: definition.name, version: definition.version, project: precise.context.project, revision: precise.context.revision,
    broadRevision: captured.context.revision,
    runtimeExecution: false, userDefaultsAccess: false, sourceProof, copiedInputs: preserved,
    sourceScope: 'production-lib-and-native-sources',
    validationManifest: 'SwiftPM and direct compiler index using real FlutterMacOS; Dart dev dependencies excluded',
    expected: definition.expected, path, summary: precise.report.summary,
    broadSummary: captured.report.summary,
    messages: precise.context.messages.map(({ platform, facts, limitations }) => ({ platform, facts: facts.length, limitations })),
    limitations: precise.report.limitations, bridgeLimitations: precise.report.bridgeLimitations,
    sourceEvidence: { fingerprintScope: raw.fingerprintScope, inputCount: raw.inputs.length }, milliseconds: captured.milliseconds,
    compilerIndex: { path: config.indexStore, recordsRoot: 'v5/records' }, preciseMilliseconds: precise.milliseconds,
  };
  await writeFile(join(evidence, `${definition.name}.verification.json`), JSON.stringify(verification, null, 2), { mode: 0o600 });
  return verification;
}

function swiftManifest(definition, framework) {
  const module = definition.name;
  return `// swift-tools-version: 5.9\nimport PackageDescription\nlet package = Package(name: "${module}", platforms: [.macOS(.v12)], products: [.library(name: "${module}", targets: ["${module}"])], targets: [.target(name: "${module}", path: "${definition.nativeRelative.split('/Sources/')[0]}/Sources/${definition.name}", swiftSettings: [.unsafeFlags(["-F", ${JSON.stringify(framework)}])], linkerSettings: [.unsafeFlags(["-F", ${JSON.stringify(framework)}, "-framework", "FlutterMacOS"])])])\n`;
}

/** SwiftPM은 Xcode build system에서 index store 경로를 무시할 수 있어, 실제 swiftc 호출을 별도로 기록한다. */
function swiftIndexCommand(definition, project, framework) {
  const indexStore = join(project, '.build/index/manual');
  const modulePath = join(project, '.build', `${definition.name}.swiftmodule`);
  const sources = [definition.nativeFile, `${definition.nativeRelative}/messages.g.swift`]
    .map((relative) => join(project, relative));
  return ['swiftc', '-F', framework, '-index-store-path', indexStore, '-module-name', definition.name,
    '-parse-as-library', '-emit-module', '-emit-module-path', modulePath, '-framework', 'FlutterMacOS', ...sources];
}

/** 복사한 public source tree가 변형되지 않았는지 파일 단위로 비교한다. */
async function assertTreeEqual(sourceRoot, destinationRoot, relativeRoot) {
  const sourceDirectory = join(sourceRoot, relativeRoot);
  const destinationDirectory = join(destinationRoot, relativeRoot);
  const sourceEntries = await readdir(sourceDirectory, { withFileTypes: true });
  const destinationEntries = (await readdir(destinationDirectory, { withFileTypes: true })).map((entry) => entry.name).sort();
  assert.deepEqual(destinationEntries, sourceEntries.map(({ name }) => name).sort(), `Copied source tree changed: ${relativeRoot}`);
  for (const entry of sourceEntries) {
    const name = entry.name;
    const child = relativeRoot + '/' + name;
    const sourcePath = join(sourceRoot, child);
    const destinationPath = join(destinationRoot, child);
    if (entry.isDirectory()) await assertTreeEqual(sourceRoot, destinationRoot, child);
    else assert.deepEqual(await readFile(sourcePath), await readFile(destinationPath), `Copied source changed: ${child}`);
  }
}

function evidencePath(report, expected) {
  const subjects = new Map([...report.roots.map((subject) => [subject.key, { subject }]), ...report.affected.map((row) => [row.subject.key, row])]);
  const candidates = [...subjects.values()].filter(({ subject }) => subject.kind === 'symbol' &&
    subject.platform === 'dart' && subject.symbol.qualifiedName.endsWith(`::${expected.wrapper}`));
  for (const candidate of candidates) {
    const chain = [];
    for (let row = candidate; row; row = subjects.get(row.via)) chain.push(row.subject);
    const root = chain.at(-1);
    if (root?.kind === 'symbol' && root.platform === 'swift' && root.symbol.qualifiedName.includes(expected.native) &&
      chain.some((subject) => subject.kind === 'bridge') &&
      chain.some((subject) => subject.kind === 'symbol' && subject.platform === 'dart' &&
        subject.symbol.qualifiedName.endsWith(`::${expected.generated}`))) {
      return chain.reverse().map((subject) => subject.kind === 'bridge' ? subject.channel : subject.symbol.qualifiedName);
    }
  }
  return undefined;
}
