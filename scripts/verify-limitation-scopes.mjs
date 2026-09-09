import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runChild } from './run-child.mjs';

const opaqueChannel = 'demo.example/opaque';
const inlineChannel = 'demo.example/inline';
const ghostChannel = 'demo.example/ghost';

const [cartographBinary, dartographBinary, isthmusOverride] =
  process.argv.slice(2);
if (cartographBinary === undefined || dartographBinary === undefined) {
  process.stderr.write(
    'Usage: verify-limitation-scopes.mjs '
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
  '0.9.0',
);
const dartographVersion = verifyToolVersion(
  dartographBinary,
  'dartograph',
  '0.1.1',
);
const isthmusVersion = verifyNodeToolVersion(isthmusBinary, '0.2.0');

const dogfoodDirectory = await mkdtemp(
  join(repositoryRoot, '.isthmus-limitation-scopes-'),
);
const swiftFactsPath = join(dogfoodDirectory, 'swift-facts.json');
const dartFactsPath = join(dogfoodDirectory, 'dart-facts.json');
for (const [signal, exitCode] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  process.once(signal, () => {
    void cleanupDogfoodDirectory().finally(() => process.exit(exitCode));
  });
}

try {
  await installFixture();
  runStep(
    'swift',
    ['build', '--package-path', dogfoodDirectory],
    'Swift fixture build',
    10 * 60_000,
  );

  const swiftFacts = run(cartographBinary, [
    'bridges',
    '--format',
    'json',
    '--target',
    'flutter',
    '--project',
    dogfoodDirectory,
  ]);
  verify(swiftFacts.status === 0, 'cartograph bridges');
  const dartFacts = run(dartographBinary, [
    'bridges',
    '--format',
    'json',
    '--',
    dogfoodDirectory,
  ]);
  verify(dartFacts.status === 0, 'dartograph bridges');

  const swiftDocument = parseDocument(
    swiftFacts.stdout,
    'Swift bridge facts JSON',
  );
  const dartDocument = parseDocument(dartFacts.stdout, 'Dart bridge facts JSON');
  verifySwiftDocument(swiftDocument);
  verifyDartDocument(dartDocument);

  await Promise.all([
    writePrivateFile(swiftFactsPath, swiftFacts.stdout),
    writePrivateFile(dartFactsPath, dartFacts.stdout),
  ]);

  const checkResult = run(process.execPath, [
    isthmusBinary,
    'check',
    dartFactsPath,
    swiftFactsPath,
  ]);
  verify(checkResult.status === 0, 'isthmus check');
  verifyCheckReport(parseDocument(checkResult.stdout, 'isthmus check JSON'));

  const strictResult = run(process.execPath, [
    isthmusBinary,
    'check',
    dartFactsPath,
    swiftFactsPath,
    '--strict',
  ]);
  verify(strictResult.status === 1, 'isthmus strict exit');

  process.stdout.write(
    `Limitation scopes dogfood verified `
      + `(cartograph ${cartographVersion}, dartograph ${dartographVersion}, `
      + `isthmus ${isthmusVersion}).\n`,
  );
} finally {
  await cleanupDogfoodDirectory();
}

/** 인덱스를 만들 수 있는 최소 Swift 패키지와 호출 측 Dart 소스를 만든다. */
async function installFixture() {
  await Promise.all([
    mkdir(join(dogfoodDirectory, 'Stub', 'Flutter'), { recursive: true }),
    mkdir(join(dogfoodDirectory, 'Sources', 'Bridges'), { recursive: true }),
    mkdir(join(dogfoodDirectory, 'lib'), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(dogfoodDirectory, 'Package.swift'), packageManifest(), {
      encoding: 'utf8',
      flag: 'wx',
    }),
    writeFile(
      join(dogfoodDirectory, 'Stub', 'Flutter', 'FlutterStub.swift'),
      flutterStub(),
      { encoding: 'utf8', flag: 'wx' },
    ),
    writeFile(
      join(dogfoodDirectory, 'Sources', 'Bridges', 'Bridges.swift'),
      swiftBridges(),
      { encoding: 'utf8', flag: 'wx' },
    ),
    writeFile(join(dogfoodDirectory, 'lib', 'bridges.dart'), dartBridges(), {
      encoding: 'utf8',
      flag: 'wx',
    }),
  ]);
}

/**
 * 실제 생산자가 스코프를 발행하는 문서인지 확인한다.
 *
 * 위임 참조 핸들러는 스캐너가 본문을 볼 수 없지만 채널 이름은 리터럴로 알고 있어,
 * 계약의 `limitationScopes`가 붙는 유일한 양성 형태다.
 */
function verifySwiftDocument(document) {
  verify(document.format === 'bridge-facts', 'swift bridge facts format');
  verify(document.version === 1, 'swift bridge facts version');
  verify(document.platform === 'swift', 'swift bridge facts platform');
  verify(document.target === 'flutter', 'swift bridge facts target');
  verify(document.project === dogfoodDirectory, 'swift bridge facts project');
  verify(
    Array.isArray(document.limitations)
      && document.limitations.length === 1
      && document.limitations[0].startsWith('opaque-handler-bodies: '),
    'single scoped limitation',
  );
  const scopes = document.limitationScopes;
  verify(Array.isArray(scopes) && scopes.length === 1, 'single limitation scope');
  verify(scopes[0].limitationIndex === 0, 'limitation scope index');
  verify(
    JSON.stringify(scopes[0].channels) === JSON.stringify([opaqueChannel]),
    'limitation scope channels',
  );
  const registered = document.facts
    .filter((fact) => fact.kind === 'channel-register')
    .map((fact) => fact.channel);
  verify(registered.includes(opaqueChannel), 'opaque channel registration');
  verify(registered.includes(inlineChannel), 'inline channel registration');
  verify(!registered.includes(ghostChannel), 'ghost channel stays unregistered');
  verify(
    document.facts.every((fact) => fact.method !== 'hidden'),
    'opaque handler body not inspected',
  );
}

/** 호출 측 문서가 세 채널의 관찰을 그대로 실었는지 확인한다. */
function verifyDartDocument(document) {
  verify(document.format === 'bridge-facts', 'dart bridge facts format');
  verify(document.platform === 'dart', 'dart bridge facts platform');
  verify(document.project === dogfoodDirectory, 'dart bridge facts project');
  const created = document.facts
    .filter((fact) => fact.kind === 'channel-create')
    .map((fact) => fact.channel);
  for (const channel of [opaqueChannel, inlineChannel, ghostChannel]) {
    verify(created.includes(channel), `dart channel creation ${channel === ghostChannel ? 'ghost' : 'expected'}`);
  }
  const invoked = document.facts
    .filter((fact) => fact.kind === 'method-invoke')
    .map((fact) => `${fact.channel}/${fact.method}`);
  for (const name of [
    `${opaqueChannel}/hidden`,
    `${inlineChannel}/known`,
    `${inlineChannel}/missing`,
  ]) {
    verify(invoked.includes(name), 'dart method invocation');
  }
}

/**
 * 스코프 완화가 채널 단위로만 일어나는지 확인한다.
 *
 * opaque 채널의 미검증 호출은 경고로 낮아야 하고, 같은 target의 다른 채널 호출과
 * 등록 없는 채널 생성은 그대로 error여야 한다. 핸들러만 가리는 한계라는 계약의
 * 구분도 이 대조로 종단에서 확인된다.
 */
function verifyCheckReport(report) {
  verify(report.format === 'isthmus-check', 'isthmus check format');
  verify(report.version === 1, 'isthmus check version');
  const issues = report.issues.map((issue) => ({
    severity: issue.severity,
    code: issue.code,
    channel: issue.channel,
    method: issue.method ?? null,
  }));
  const expected = [
    {
      severity: 'error',
      code: 'unhandled-invocation',
      channel: inlineChannel,
      method: 'missing',
    },
    {
      severity: 'warning',
      code: 'unhandled-invocation-unverified',
      channel: opaqueChannel,
      method: 'hidden',
    },
    {
      severity: 'error',
      code: 'unregistered-channel-creation',
      channel: ghostChannel,
      method: null,
    },
  ];
  verify(
    JSON.stringify(issues) === JSON.stringify(expected),
    'scoped relaxation issue set',
  );
  verify(
    report.summary.errors === 2 && report.summary.warnings === 1,
    'summary severities',
  );
  verify(report.summary.matchedChannels === 2, 'matched channels');
  verify(report.summary.matchedMethods === 1, 'matched methods');
}

/** 사실 문서는 소유자만 읽을 수 있게 새 파일로 쓴다. */
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
  const pattern = tool === 'cartograph'
    ? /^(\d+\.\d+\.\d+)$/u
    : /^dartograph (\d+\.\d+\.\d+)$/u;
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

/** 생산자와 소비자를 제한 시간 및 고정 버퍼로 실행한다. */
function run(command, arguments_) {
  return runChild(command, arguments_, { timeout: 5 * 60_000 });
}

/** 검증 실패 시 입력 경로나 자식 출력 대신 단계 이름만 보고한다. */
function verify(condition, step) {
  if (!condition) throw new Error(`Limitation scopes dogfood failed: ${step}`);
}

/** 전용 접두사와 부모를 다시 확인한 디렉터리만 재귀 정리한다. */
async function cleanupDogfoodDirectory() {
  const safe = dirname(dogfoodDirectory) === repositoryRoot
    && basename(dogfoodDirectory).startsWith('.isthmus-limitation-scopes-');
  if (!safe) {
    process.stderr.write('Limitation scopes dogfood cleanup refused.\n');
    process.exitCode = 2;
    return;
  }
  await rm(dogfoodDirectory, { recursive: true, force: true }).catch(() => {
    process.stderr.write('Limitation scopes dogfood cleanup failed.\n');
    process.exitCode = 2;
  });
}

function packageManifest() {
  return `// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "IsthmusLimitationScopesDogfood",
    platforms: [.macOS(.v12)],
    targets: [
        .target(
            name: "FlutterStub",
            path: "Stub/Flutter"
        ),
        .target(
            name: "Bridges",
            dependencies: ["FlutterStub"],
            path: "Sources/Bridges"
        ),
    ],
    swiftLanguageModes: [.v5]
)
`;
}

function flutterStub() {
  return `import Foundation

public final class FlutterMethodChannel {
    public init(name: String, binaryMessenger: AnyObject) {}
    public func setMethodCallHandler(_ handler: ((FlutterMethodCall, (Any?) -> Void) -> Void)?) {}
}

public struct FlutterMethodCall {
    public let method: String
}
`;
}

function swiftBridges() {
  return `import FlutterStub

/// 위임 핸들러. 등록점이 감싸는 타입의 self 메서드가 아니므로 스캐너가 본문을
/// 볼 수 없고, 채널 이름은 등록 호출에서 리터럴로 알려진다. 본문에 메서드 분기가
/// 없어 귀속 없는 method-handle 사실도 만들지 않는다.
final class HandlerDelegate {
    func handleCall(_ call: FlutterMethodCall, result: (Any?) -> Void) {
        result(nil)
    }
}

final class OpaqueBridge {
    init(messenger: AnyObject) {
        let channel = FlutterMethodChannel(name: "${opaqueChannel}", binaryMessenger: messenger)
        channel.setMethodCallHandler(HandlerDelegate().handleCall)
    }
}

final class InlineBridge {
    init(messenger: AnyObject) {
        let channel = FlutterMethodChannel(name: "${inlineChannel}", binaryMessenger: messenger)
        channel.setMethodCallHandler { call, result in
            switch call.method {
            case "known": result(nil)
            default: result(nil)
            }
        }
    }
}
`;
}

function dartBridges() {
  return `import 'package:flutter/services.dart';

const opaqueChannel = MethodChannel('${opaqueChannel}');
const inlineChannel = MethodChannel('${inlineChannel}');
const ghostChannel = MethodChannel('${ghostChannel}');

Future<void> invokeHidden() => opaqueChannel.invokeMethod('hidden');
Future<void> invokeKnown() => inlineChannel.invokeMethod('known');
Future<void> invokeMissing() => inlineChannel.invokeMethod('missing');
`;
}
