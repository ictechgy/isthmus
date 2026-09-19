import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChild } from './run-child.mjs';

// 실제 Clang USR이 bridge-facts와 그래프에 함께 있고, JS 호출 근거가 dead까지 가는지 검증한다.
const [cartograph, ...extra] = process.argv.slice(2);
if (!cartograph || extra.length || process.platform !== 'darwin') {
  process.stderr.write('Usage (macOS): node scripts/verify-objective-c-retention.mjs <cartograph-bin>\n');
  process.exit(64);
}
const cli = fileURLToPath(new URL('../dist/cli/main.js', import.meta.url));
const work = await realpath(await mkdtemp(join(tmpdir(), 'isthmus-objc-roundtrip-')));
try {
  const source = join(work, 'CameraPlugin.m');
  const index = join(work, 'index');
  await mkdir(index);
  await writeFile(source, `#define RCT_EXPORT_MODULE(name)
#define RCT_EXPORT_METHOD(method) + (const char *)exportMetadata { return #method; } - (void)method
__attribute__((objc_root_class))
@interface CameraPlugin
- (void)takePhoto;
@end
@implementation CameraPlugin
RCT_EXPORT_MODULE(Camera)
RCT_EXPORT_METHOD(takePhoto) {}
@end
`);
  await writeFile(join(work, 'caller.ts'), "import { NativeModules } from 'react-native';\nNativeModules.Camera.takePhoto();\n");
  const execute = (command, args) => {
    const result = runChild(command, args, { timeout: 60_000 });
    assert.equal(result.status, 0, `${command}: ${result.stderr}`);
    return result.stdout;
  };
  execute('xcrun', ['clang', '-c', '-index-store-path', index, source, '-o', join(work, 'CameraPlugin.o')]);
  const common = ['--project', work, '--index-store', index];
  const graph = JSON.parse(execute(cartograph, ['graph', ...common, '--level', 'symbol', '--format', 'json']));
  const nativeText = execute(cartograph, ['bridges', ...common]);
  const native = JSON.parse(nativeText);
  const handler = native.facts.find((fact) => fact.kind === 'method-handle');
  assert.equal(handler.sourceLanguage, 'objective-c');
  assert.equal(handler.symbol.usr, 'c:objc(cs)CameraPlugin(im)takePhoto');
  assert.ok(graph.nodes.some((node) => node.usr === handler.symbol.usr));
  assert.equal(native.project, work);
  const nativePath = join(work, 'native.json');
  const jsPath = join(work, 'js.json');
  const retentionPath = join(work, 'retentions.json');
  await writeFile(nativePath, nativeText);
  await writeFile(jsPath, execute(process.execPath, [cli, 'extract-js', join(work, 'caller.ts'), '--project', work]));
  const retainedText = execute(process.execPath, [cli, 'retentions', jsPath, nativePath, '--for', 'cartograph']);
  const retained = JSON.parse(retainedText).retentions.find((item) => item.symbol.usr === handler.symbol.usr);
  assert.equal(retained.evidence.caller.path, 'caller.ts');
  assert.equal(retained.evidence.caller.line, 2);
  assert.equal(retained.evidence.method, 'takePhoto');
  await writeFile(retentionPath, retainedText);
  const explanation = execute(cartograph, ['dead', ...common, '--external-retentions', retentionPath,
    '--explain', handler.symbol.usr]);
  assert.match(explanation, /called from another platform across a bridge/i);
  assert.match(explanation, /caller\.ts:2/);
  assert.match(explanation, /takePhoto/);
  process.stdout.write('PASS: Clang graph identity → JS bridge join → Objective-C retention → dead explanation\n');
} finally {
  await rm(work, { recursive: true, force: true });
}
