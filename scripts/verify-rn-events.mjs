import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChild } from './run-child.mjs';

// React API 스텁을 실제 Swift 컴파일러로 인덱싱한다. 앱/엔진 실행 검증은 아니다.
const [cartograph, kartograph, ...extra] = process.argv.slice(2);
if (!cartograph || extra.length || process.platform !== 'darwin') {
  process.stderr.write('Usage (macOS): node scripts/verify-rn-events.mjs <cartograph-bin> [kartograph-bin]\n');
  process.exit(64);
}
const cli = fileURLToPath(new URL('../dist/cli/main.js', import.meta.url));
const work = await realpath(await mkdtemp(join(tmpdir(), 'isthmus-rn-event-roundtrip-')));
try {
  await mkdir(join(work, 'Sources/React'), { recursive: true });
  await mkdir(join(work, 'Sources/Events'), { recursive: true });
  await writeFile(join(work, 'Package.swift'), `// swift-tools-version: 5.9
import PackageDescription
let package = Package(name: "RNEventFixture", targets: [
  .target(name: "React"), .target(name: "Events", dependencies: ["React"])
])
`);
  await writeFile(join(work, 'Sources/React/Emitter.swift'), `open class RCTEventEmitter {
  public init() {}
  public func sendEvent(withName name: String, body: Any?) {}
}
`);
  await writeFile(join(work, 'Sources/Events/Events.swift'), `import React
class Events: RCTEventEmitter {
  func notify() { sendEvent(withName: "ready", body: nil) }
}
`);
  await writeFile(join(work, 'caller.ts'), "import { DeviceEventEmitter as E } from 'react-native';\nE.addListener('ready', () => {});\n");
  const execute = (command, args) => {
    const result = runChild(command, args, { timeout: 120_000,
      env: { ...process.env, LLVM_PROFILE_FILE: join(work, 'profile-%p.profraw') } });
    assert.equal(result.status, 0, `${command}: ${result.stderr}`);
    return result.stdout;
  };
  execute('swift', ['build', '--package-path', work, '--disable-automatic-resolution', '--disable-netrc', '--disable-keychain']);
  const swiftPath = join(work, 'swift.json');
  const jsPath = join(work, 'js.json');
  const nativeText = execute(cartograph, ['bridges', '--project', work, '--rn-events']);
  const native = JSON.parse(nativeText);
  assert.equal(native.transport, 'react-native-event');
  assert.equal(native.facts.length, 1);
  assert.equal(native.facts[0].kind, 'event-emit');
  assert.ok(native.facts[0].symbol.usr.startsWith('s:'));
  await writeFile(swiftPath, nativeText);
  await writeFile(jsPath, execute(process.execPath, [cli, 'extract-js', join(work, 'caller.ts'), '--events', '--project', work]));
  const inputs = [jsPath, swiftPath];
  if (kartograph) {
    await mkdir(join(work, 'android'));
    await writeFile(join(work, 'android/Events.kt'), `import com.facebook.react.modules.core.DeviceEventManagerModule
class Events {
  fun notify() {
    context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("ready", null)
  }
}
`);
    const kotlinPath = join(work, 'kotlin.json');
    const kotlin = execute(kartograph, ['bridges', '--project', work, '--rn-events']);
    assert.equal(JSON.parse(kotlin).facts[0].kind, 'event-emit');
    await writeFile(kotlinPath, kotlin);
    inputs.push(kotlinPath);
  }
  const report = JSON.parse(execute(process.execPath, [cli, 'check', ...inputs, '--strict']));
  assert.equal(report.summary.matchedEvents, 1);
  assert.equal(report.summary.errors, 0);
  const query = JSON.parse(execute(process.execPath, [cli, 'query', 'react-native:event:ready', ...inputs]));
  assert.equal(query.result.dependsOn.length, kartograph ? 2 : 1);
  const retentionPath = join(work, 'retentions.json');
  await writeFile(retentionPath, execute(process.execPath, [cli, 'retentions', ...inputs, '--for', 'cartograph']));
  const explained = execute(cartograph, ['dead', '--project', work, '--external-retentions', retentionPath,
    '--explain', native.facts[0].symbol.usr]);
  assert.match(explained, /caller\.ts:2/);
  assert.match(explained, /called from another platform across a bridge/);
  process.stdout.write(`PASS: JS subscriptions + indexed Swift emissions${kartograph ? ' + Kotlin source emissions' : ''} → event join → Swift retention explanation\n`);
} finally {
  await rm(work, { recursive: true, force: true });
}
