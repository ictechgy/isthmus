import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runChild } from './run-child.mjs';

const [flutterArg, dartographArg, ...extra] = process.argv.slice(2);
if (!flutterArg || !dartographArg || extra.length) {
  process.stderr.write('Usage: verify-dart-binding-runtime.mjs <flutter> <dartograph-aot>\n'); process.exit(64);
}
const root = await realpath(await mkdtemp(join(tmpdir(), 'isthmus-binding-runtime-')));
const evidence = await realpath(await mkdtemp(join(tmpdir(), 'isthmus-binding-evidence-')));
async function verifyBindingRuntime() {
try {
  const flutter = await realpath(flutterArg);
  const dartograph = await realpath(dartographArg);
  await mkdir(join(root, 'lib')); await mkdir(join(root, 'test'));
  await writeFile(join(root, 'pubspec.yaml'), 'name: binding_probe\nenvironment:\n  sdk: ">=3.7.0 <4.0.0"\ndependencies:\n  flutter:\n    sdk: flutter\ndev_dependencies:\n  flutter_test:\n    sdk: flutter\n');
  await writeFile(join(root, 'lib/bindings.dart'), source);
  await writeFile(join(root, 'test/bindings_test.dart'), runtimeTest);
  const environment = { ...process.env, CI: 'true', FLUTTER_SUPPRESS_ANALYTICS: 'true',
    ISTHMUS_BINDING_TRACE: join(evidence, 'observed.json') };
  const run = async (label, command, args) => {
    const result = runChild(command, args, { cwd: root, env: environment, timeout: 180_000 });
    await writeFile(join(evidence, `${label}.log`), `${result.stdout}\n${result.stderr}`, { mode: 0o600 });
    assert.equal(result.status, 0, label);
    return result.stdout;
  };
  await run('pub', flutter, ['--no-version-check', 'pub', 'get', '--offline']);
  await run('runtime', flutter, ['--no-version-check', 'test', '--reporter', 'expanded']);
  const observed = JSON.parse(await readFile(join(evidence, 'observed.json'), 'utf8'));
  assert.deepEqual(observed, ['a', 'b', 'a', 'b', 'a']);
  const facts = JSON.parse(await run('producer', dartograph, ['bridges', '--messages', '--format', 'json', '--project', root, root]));
  const methodFacts = (name) => facts.facts.filter((fact) => fact.symbol?.qualifiedName === name);
  assert.ok(methodFacts('MutableBridge.go').every((fact) => fact.dynamic),
    'One call site observed on both a and b must not claim one constant mutable field address.');
  assert.ok(facts.limitations.some((message) => message.startsWith('unresolved-basic-message-sends:')));
  for (const [name, channel] of [['FixedBridge.go', 'a'], ['straightLine', 'b'], ['branchElse', 'a']]) {
    assert.deepEqual(methodFacts(name).map(({ channel, dynamic }) => ({ channel, dynamic })), [{ channel, dynamic: false }], name);
  }
  const verification = { scope: 'actual-flutter-basic-binding-state-with-mock-messenger', nativeExecution: false,
    observedChannels: observed, mutableFactCount: methodFacts('MutableBridge.go').length, limitations: facts.limitations };
  await writeFile(join(evidence, 'verification.json'), JSON.stringify(verification, null, 2), { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ verified: true, evidence, ...verification })}\n`);
} catch (error) {
  process.stderr.write(`Dart binding runtime verification failed: ${error.message}\nEvidence: ${evidence}\n`); process.exitCode = 1;
} finally { await rm(root, { recursive: true, force: true }); }
}

const source = `import 'package:flutter/services.dart';
const codec = StandardMessageCodec();
class MutableBridge {
  BasicMessageChannel<Object?> channel = const BasicMessageChannel<Object?>('a', codec);
  void swap() { this.channel = const BasicMessageChannel<Object?>('b', codec); }
  Future<Object?> go() => channel.send(null);
}
class FixedBridge {
  final channel = const BasicMessageChannel<Object?>('a', codec);
  Future<Object?> go() => channel.send(null);
}
Future<void> straightLine() async {
  var channel = const BasicMessageChannel<Object?>('a', codec);
  channel = const BasicMessageChannel<Object?>('b', codec);
  await channel.send(null);
}
Future<void> branchElse(bool flag) async {
  var channel = const BasicMessageChannel<Object?>('a', codec);
  if (flag) { channel = const BasicMessageChannel<Object?>('b', codec); }
  else { await channel.send(null); }
}
`;
const runtimeTest = `import 'dart:convert';
import 'dart:io';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:binding_probe/bindings.dart';
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test('actual channel values across calls and branches', () async {
    final observed = <String>[];
    final messenger = TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    for (final name in ['a', 'b']) {
      messenger.setMockDecodedMessageHandler<Object?>(BasicMessageChannel<Object?>(name, codec), (_) async {
        observed.add(name); return null;
      });
    }
    final changing = MutableBridge();
    await changing.go(); changing.swap(); await changing.go();
    await FixedBridge().go(); await straightLine(); await branchElse(false);
    await File(Platform.environment['ISTHMUS_BINDING_TRACE']!).writeAsString(jsonEncode(observed));
  });
}
`;

await verifyBindingRuntime();
