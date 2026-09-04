import { access, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runChild } from './run-child.mjs';

const repositoryUrl = 'https://github.com/fluttercommunity/plus_plugins.git';
const repositoryRevision = '13e170479b3c66c890fa401f5fdb3af141faf67a';
const batteryChannel = 'dev.fluttercommunity.plus/battery';
const dartSourcePath =
  'packages/battery_plus/battery_plus_platform_interface/lib/'
  + 'method_channel_battery_plus.dart';
const swiftSourcePath =
  'packages/battery_plus/battery_plus/macos/battery_plus/Sources/'
  + 'battery_plus/BatteryPlusMacosPlugin.swift';
const batteryMethods = [
  'getBatteryLevel',
  'getBatteryState',
  'isInBatterySaveMode',
];

const [cartographBinary, dartographBinary, isthmusOverride] =
  process.argv.slice(2);
if (cartographBinary === undefined || dartographBinary === undefined) {
  process.stderr.write(
    'Usage: verify-public-flutter-plugin.mjs '
      + '<cartograph-bin> <dartograph-bin> [isthmus-js]\n',
  );
  process.exit(64);
}

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const isthmusBinary = isthmusOverride
  ?? join(repositoryRoot, 'dist/cli/main.js');

if (isthmusOverride === undefined) {
  runStep('npm', ['run', 'build'], 'isthmus build', {
    cwd: repositoryRoot,
    timeout: 5 * 60_000,
  });
}
const cartographVersion = verifyToolVersion(
  cartographBinary,
  'cartograph',
  '0.5.3',
);
const dartographVersion = verifyToolVersion(
  dartographBinary,
  'dartograph',
  '0.1.1',
);
const isthmusVersion = verifyNodeToolVersion(isthmusBinary, '0.1.3');

const dogfoodDirectory = await mkdtemp(
  join(repositoryRoot, '.isthmus-public-flutter-plugin-'),
);
const checkoutRoot = join(dogfoodDirectory, 'plus_plugins');
const harnessRoot = join(checkoutRoot, '.isthmus-dogfood');
const emptyGitTemplate = join(dogfoodDirectory, 'empty-git-template');
const swiftFactsPath = join(dogfoodDirectory, 'swift-facts.json');
const dartFactsPath = join(dogfoodDirectory, 'dart-facts.json');
const retentionsPath = join(dogfoodDirectory, 'retentions.json');
for (const [signal, exitCode] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  process.once(signal, () => {
    void cleanupDogfoodDirectory().finally(() => process.exit(exitCode));
  });
}

try {
  await checkoutPublicFixture();
  await installSwiftHarness();
  runStep('swift', ['build', '--package-path', checkoutRoot], 'Swift fixture build', 10 * 60_000);

  const swiftFacts = run(cartographBinary, [
    'bridges',
    '--format',
    'json',
    '--target',
    'flutter',
    '--project',
    checkoutRoot,
  ]);
  verify(swiftFacts.status === 0, 'cartograph bridges');
  const dartFacts = run(dartographBinary, [
    'bridges',
    '--format',
    'json',
    '--',
    checkoutRoot,
  ]);
  verify(dartFacts.status === 0, 'dartograph bridges');

  const swiftDocument = parseDocument(swiftFacts.stdout, 'Swift bridge facts JSON');
  const dartDocument = parseDocument(dartFacts.stdout, 'Dart bridge facts JSON');
  verifyProducerDocument(swiftDocument, 'swift');
  verifyProducerDocument(dartDocument, 'dart');
  verifyBatteryFacts(swiftDocument, 'method-handle', swiftSourcePath);
  verifyBatteryFacts(dartDocument, 'method-invoke', dartSourcePath);

  await Promise.all([
    writePrivateFile(swiftFactsPath, swiftFacts.stdout),
    writePrivateFile(dartFactsPath, dartFacts.stdout),
  ]);
  const retentionResult = run(process.execPath, [
    isthmusBinary,
    'retentions',
    dartFactsPath,
    swiftFactsPath,
    '--for',
    'cartograph',
  ]);
  verify(retentionResult.status === 0, 'isthmus retentions');
  const retentionDocument = parseDocument(
    retentionResult.stdout,
    'isthmus retentions JSON',
  );
  const retentions = verifyBatteryRetentions(retentionDocument);
  await writePrivateFile(retentionsPath, retentionResult.stdout);

  const consumerResult = run(cartographBinary, [
    'dead',
    '--project',
    checkoutRoot,
    '--external-retentions',
    retentionsPath,
    '--report-format',
    'json',
  ]);
  verify(consumerResult.status === 0, 'cartograph retention consumer');
  parseDocument(consumerResult.stdout, 'cartograph dead JSON');

  const retainedSymbol = retentions.get(batteryMethods[0]).symbol;
  const subject = retainedSymbol.usr ?? retainedSymbol.qualifiedName;
  const explanation = run(cartographBinary, [
    'dead',
    '--project',
    checkoutRoot,
    '--external-retentions',
    retentionsPath,
    '--explain',
    subject,
  ]);
  verify(explanation.status === 0, 'cartograph retention explanation');
  verify(
    explanation.stdout.includes(
      expectedEvidence(retentions.get(batteryMethods[0])),
    ),
    'cartograph retention evidence',
  );

  process.stdout.write(
    `Public Flutter plugin dogfood verified at ${repositoryRevision} `
      + `(cartograph ${cartographVersion}, dartograph ${dartographVersion}, `
      + `isthmus ${isthmusVersion}).\n`,
  );
} finally {
  await cleanupDogfoodDirectory();
}

/** 공개 소스는 고정 커밋의 필요한 패키지만 내려받아 재현성을 유지한다. */
async function checkoutPublicFixture() {
  await Promise.all([mkdir(checkoutRoot), mkdir(emptyGitTemplate)]);
  runGit(
    ['init', '--quiet', '--template', emptyGitTemplate, checkoutRoot],
    'fixture git init',
  );
  runGit(
    ['-C', checkoutRoot, 'remote', 'add', 'origin', repositoryUrl],
    'fixture git remote',
  );
  runGit(
    ['-C', checkoutRoot, 'sparse-checkout', 'init', '--cone'],
    'fixture sparse checkout init',
  );
  runGit(
    [
      '-C',
      checkoutRoot,
      'sparse-checkout',
      'set',
      'packages/battery_plus/battery_plus',
      'packages/battery_plus/battery_plus_platform_interface',
    ],
    'fixture sparse checkout paths',
  );
  runGit(
    [
      '-C',
      checkoutRoot,
      'fetch',
      '--quiet',
      '--depth',
      '1',
      'origin',
      repositoryRevision,
    ],
    'fixture git fetch',
    { timeout: 5 * 60_000 },
  );
  runGit(
    ['-C', checkoutRoot, 'checkout', '--quiet', '--detach', 'FETCH_HEAD'],
    'fixture git checkout',
  );
  const revision = runGit(
    ['-C', checkoutRoot, 'rev-parse', 'HEAD'],
    'fixture git revision',
  );
  verify(revision.stdout.trim() === repositoryRevision, 'fixture git revision');
  await Promise.all([
    verifyFixtureSource(dartSourcePath),
    verifyFixtureSource(swiftSourcePath),
  ]);
}

/** 핀은 유지돼도 upstream 경로가 잘못되면 빌드 전에 명확히 실패한다. */
async function verifyFixtureSource(relativePath) {
  try {
    await access(join(checkoutRoot, relativePath));
  } catch {
    verify(false, 'fixture source layout');
  }
}

/** Flutter SDK 없이 원본 macOS Swift 구현을 인덱싱하는 최소 타입 하네스를 둔다. */
async function installSwiftHarness() {
  const stubRoot = join(harnessRoot, 'FlutterMacOS');
  await mkdir(stubRoot, { recursive: true });
  await Promise.all([
    writeFile(join(checkoutRoot, 'Package.swift'), packageManifest(), {
      encoding: 'utf8',
      flag: 'wx',
    }),
    writeFile(join(stubRoot, 'FlutterMacOS.swift'), flutterMacOSStub(), {
      encoding: 'utf8',
      flag: 'wx',
    }),
  ]);
}

/** 양쪽 생산자가 같은 공개 프로젝트와 기대 플랫폼을 선언하는지 확인한다. */
function verifyProducerDocument(document, platform) {
  verify(document.format === 'bridge-facts', `${platform} bridge facts format`);
  verify(document.version === 1, `${platform} bridge facts version`);
  verify(document.platform === platform, `${platform} bridge facts platform`);
  verify(document.target === 'flutter', `${platform} bridge facts target`);
  verify(document.project === checkoutRoot, `${platform} bridge facts project`);
  verify(Array.isArray(document.facts), `${platform} bridge facts array`);
}

/** 공개 플러그인의 세 리터럴 메서드가 생산자 결과에 모두 있는지 확인한다. */
function verifyBatteryFacts(document, kind, expectedPath) {
  for (const method of batteryMethods) {
    const matches = document.facts.filter((fact) =>
      fact.kind === kind
        && fact.channel === batteryChannel
        && fact.method === method,
    );
    verify(matches.length === 1, `${document.platform} ${method}`);
    verify(
      matches[0].location?.path === expectedPath,
      `${document.platform} ${method} provenance`,
    );
  }
  verify(
    document.facts.every((fact) =>
      !fact.location?.path?.startsWith('.isthmus-dogfood/')
        && !fact.location?.path?.startsWith('.build/')),
    `${document.platform} generated-path exclusion`,
  );
}

/** 조인이 세 호출을 Swift 심볼 보존 근거로 돌려줬는지 확인한다. */
function verifyBatteryRetentions(document) {
  verify(document.format === 'external-retentions', 'retentions format');
  verify(document.version === 0, 'retentions version');
  verify(Array.isArray(document.retentions), 'retentions array');
  const retentions = new Map();
  for (const method of batteryMethods) {
    const matches = document.retentions.filter((retention) =>
      retention.evidence?.channel === batteryChannel
        && retention.evidence.method === method,
    );
    verify(matches.length === 1, `retention ${method}`);
    const retention = matches[0];
    verify(
      typeof retention.symbol?.usr === 'string'
        && retention.symbol.usr.length > 0,
      `retention ${method} USR`,
    );
    verify(
      retention.symbol?.qualifiedName?.includes('BatteryPlusMacosPlugin'),
      `retention ${method} qualified name`,
    );
    verify(
      retention.evidence.caller?.platform === 'dart'
        && retention.evidence.caller.path === dartSourcePath,
      `retention ${method} caller provenance`,
    );
    retentions.set(method, retention);
  }
  return retentions;
}

/** cartograph explain이 출력하는 공개 근거 문장을 만든다. */
function expectedEvidence(retention) {
  const { caller, channel, method } = retention.evidence;
  return `evidence: ${caller.platform} ${caller.path}:${caller.line} `
    + `invokes '${method}' on channel '${channel}'`;
}

/** 사실·보존 문서는 소유자만 읽을 수 있게 새 파일로 쓴다. */
function writePrivateFile(path, contents) {
  return writeFile(path, contents, { mode: 0o600, flag: 'wx' });
}

/** JSON 본문을 다시 노출하지 않고 단계 실패로 바꾼다. */
function parseDocument(text, step) {
  try {
    return JSON.parse(text);
  } catch {
    return verify(false, step);
  }
}

/** 한 도구가 dogfood에 필요한 기능을 포함한 최소 버전인지 확인한다. */
function verifyToolVersion(binary, tool, minimum) {
  const result = run(binary, ['--version']);
  verify(result.status === 0, `${tool} version`);
  const pattern = tool === 'dartograph'
    ? /^dartograph (\d+\.\d+\.\d+)$/u
    : /^(\d+\.\d+\.\d+)$/u;
  const match = result.stdout.trim().match(pattern);
  verify(match !== null, `${tool} version`);
  verify(versionAtLeast(match[1], minimum), `${tool} version`);
  return match[1];
}

/** Node로 실행하는 isthmus 산출물의 최소 버전을 검증한다. */
function verifyNodeToolVersion(binary, minimum) {
  const result = run(process.execPath, [binary, '--version']);
  verify(result.status === 0, 'isthmus version');
  const match = result.stdout.trim().match(/^(\d+\.\d+\.\d+)$/u);
  verify(match !== null, 'isthmus version');
  verify(versionAtLeast(match[1], minimum), 'isthmus version');
  return match[1];
}

/** 숫자 SemVer 세 부분을 사전 릴리스 없이 비교한다. */
function versionAtLeast(actual, minimum) {
  const actualParts = actual.split('.').map(Number);
  const minimumParts = minimum.split('.').map(Number);
  for (let index = 0; index < 3; index++) {
    const difference = actualParts[index] - minimumParts[index];
    if (difference !== 0) return difference > 0;
  }
  return true;
}

/** 외부 명령 실패는 경로·자식 출력 없이 단계 이름만 남긴다. */
function runStep(command, arguments_, step, options = {}) {
  const result = runChild(command, arguments_, {
    cwd: options.cwd,
    env: options.env,
    timeout: options.timeout ?? 60_000,
  });
  verify(result.status === 0, step);
  return result;
}

/** Git은 사용자 전역 설정·credential helper·hook을 상속하지 않는다. */
function runGit(arguments_, step, options) {
  return runStep('git', arguments_, step, {
    ...options,
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0',
    },
  });
}

/** 생산자와 소비자를 제한 시간 및 고정 버퍼로 실행한다. */
function run(command, arguments_) {
  return runChild(command, arguments_, { timeout: 5 * 60_000 });
}

/** 검증 실패 시 입력 경로나 자식 출력 대신 단계 이름만 보고한다. */
function verify(condition, step) {
  if (!condition) throw new Error(`Public Flutter dogfood failed: ${step}`);
}

/** 전용 접두사와 부모를 다시 확인한 디렉터리만 재귀 정리한다. */
async function cleanupDogfoodDirectory() {
  const safe = dirname(dogfoodDirectory) === repositoryRoot
    && basename(dogfoodDirectory).startsWith(
      '.isthmus-public-flutter-plugin-',
    );
  if (!safe) {
    process.stderr.write('Public Flutter dogfood cleanup refused.\n');
    process.exitCode = 2;
    return;
  }
  await rm(dogfoodDirectory, { recursive: true, force: true }).catch(() => {
    process.stderr.write('Public Flutter dogfood cleanup failed.\n');
    process.exitCode = 2;
  });
}

function packageManifest() {
  return `// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "IsthmusPublicDogfood",
    platforms: [.macOS(.v12)],
    targets: [
        .target(
            name: "FlutterMacOS",
            path: ".isthmus-dogfood/FlutterMacOS"
        ),
        .target(
            name: "battery_plus",
            dependencies: ["FlutterMacOS"],
            path: "packages/battery_plus/battery_plus/macos/battery_plus/Sources/battery_plus",
            exclude: ["PrivacyInfo.xcprivacy"]
        ),
    ],
    swiftLanguageModes: [.v5]
)
`;
}

function flutterMacOSStub() {
  return `import Foundation

public protocol FlutterBinaryMessenger: AnyObject {}
public typealias FlutterResult = (Any?) -> Void
public typealias FlutterEventSink = (Any?) -> Void
public let FlutterMethodNotImplemented: Any = NSObject()

public final class FlutterError: NSObject, Error {}

public struct FlutterMethodCall {
    public let method: String

    public init(method: String) {
        self.method = method
    }
}

public protocol FlutterPlugin: AnyObject {
    static func register(with registrar: FlutterPluginRegistrar)
    func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult)
}

public final class FlutterPluginRegistrar {
    public var messenger: FlutterBinaryMessenger { fatalError() }

    public func addMethodCallDelegate(
        _ delegate: FlutterPlugin,
        channel: FlutterMethodChannel
    ) {}
}

public final class FlutterMethodChannel {
    public init(name: String, binaryMessenger: FlutterBinaryMessenger) {}
}

public protocol FlutterStreamHandler: AnyObject {
    func onListen(
        withArguments arguments: Any?,
        eventSink events: @escaping FlutterEventSink
    ) -> FlutterError?
    func onCancel(withArguments arguments: Any?) -> FlutterError?
}

public final class FlutterEventChannel {
    public init(name: String, binaryMessenger: FlutterBinaryMessenger) {}
    public func setStreamHandler(_ handler: FlutterStreamHandler?) {}
}
`;
}
