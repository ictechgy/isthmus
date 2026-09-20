import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChild } from '../../scripts/run-child.mjs';
import { fetchPinnedPackage } from './public-archive.mjs';

// 공개 원본을 컴파일하되 RN API 스텁과 원본 클래스의 색인 범위를 구분한다.
const [cliArg, kartographArg, gradleArg, androidJarArg, pluginArg, outputArg, ...extra] = process.argv.slice(2);
if (![cliArg, kartographArg, gradleArg, androidJarArg, pluginArg, outputArg].every(Boolean) || extra.length) {
  process.stderr.write('Usage: run-rn-compiled.mjs <isthmus-js> <kartograph> <gradle> <android.jar> <kartograph-plugin.jar> <output-json>\n');
  process.exit(64);
}
const [cli, kartograph, gradle, androidJar, plugin] = await Promise.all([cliArg, kartographArg, gradleArg, androidJarArg, pluginArg].map((path) => realpath(path)));
const here = dirname(fileURLToPath(import.meta.url));
const definition = JSON.parse(await readFile(join(here, 'manifest.json'), 'utf8')).rnEvents['react-native-sound@0.13.0'];
const work = await realpath(await mkdtemp(join(tmpdir(), 'isthmus-rn-compiled-')));
const original = await fetchPinnedPackage(definition, work);
const project = join(work, 'fixture');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function write(relative, content) {
  const path = join(project, relative);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}
for (const path of [definition.source, definition.nativeSource, 'LICENSE']) {
  await mkdir(dirname(join(project, path)), { recursive: true });
  await cp(join(original, path), join(project, path));
  assert.deepEqual(await readFile(join(project, path)), await readFile(join(original, path)));
}
const groovy = (value) => `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
await write('settings.gradle', "pluginManagement { repositories { gradlePluginPortal(); mavenCentral() } }\nrootProject.name='public-rn-retention'\ninclude 'bridge-api'\n");
await write('build.gradle', `buildscript { dependencies { classpath files(${groovy(plugin)}) } }
plugins { id 'org.jetbrains.kotlin.jvm' version '2.4.20' }
apply plugin: 'io.github.ictechgy.kartograph'
repositories { mavenCentral() }
kotlin { jvmToolchain(21); sourceSets.main.kotlin.setSrcDirs(['android/src/main/java']) }
dependencies { compileOnly project(':bridge-api'); compileOnly files(${groovy(androidJar)}) }
def compiler = tasks.named('compileKotlin')
def launcher = javaToolchains.launcherFor { languageVersion = JavaLanguageVersion.of(21) }
dev.kartograph.gradle.KotlinCompilerWitnesses.INSTANCE.kotlinCompile(project, compiler, 'public-rn:main',
    files('android/src/main/java'), files('build.gradle', 'settings.gradle', 'bridge-api/build.gradle'), launcher,
    files(configurations.named('kotlinBuildToolsApiClasspath')))
tasks.register('describeEvidenceInputs') {
    dependsOn compiler
    doLast {
        def task = compiler.get()
        def candidates = new LinkedHashSet(task.inputs.files.files)
        candidates.addAll(task.libraries.files)
        candidates.addAll(task.pluginClasspath.files)
        candidates.addAll(task.friendPaths.files)
        candidates.add(new File(org.jetbrains.kotlin.gradle.tasks.KotlinCompile.protectionDomain.codeSource.location.toURI()).canonicalFile)
        candidates.add(new File(launcher.get().metadata.installationPath.asFile, 'lib/modules').canonicalFile)
        file('input-candidates-local.json').text = groovy.json.JsonOutput.toJson(candidates.findAll { it.isFile() }.collect { it.canonicalPath })
    }
}
`);
await write('bridge-api/build.gradle', `plugins { id 'java-library' }\njava { toolchain { languageVersion = JavaLanguageVersion.of(21) } }\ndependencies { compileOnly files(${groovy(androidJar)}) }\n`);
const api = 'bridge-api/src/main/java/com/facebook/react/bridge/';
const stubs = {
  'ReactApplicationContext.java': 'public class ReactApplicationContext extends android.content.ContextWrapper { public ReactApplicationContext() { super(null); } public <T> T getJSModule(Class<T> type) { return null; } }',
  'BridgeReactContext.java': 'public class BridgeReactContext { public interface RCTDeviceEventEmitter { void emit(String event, Object data); } }',
  'Arguments.java': 'public class Arguments { public static WritableMap createMap() { return new WritableMap(); } }',
  'WritableMap.java': 'public class WritableMap { public void putBoolean(String key, boolean value) {} public void putDouble(String key, double value) {} public void putInt(String key, int value) {} public void putString(String key, String value) {} }',
  'ReadableMap.java': 'public interface ReadableMap { boolean hasKey(String key); double getDouble(String key); boolean getBoolean(String key); }',
  'Callback.java': 'public interface Callback { void invoke(Object... arguments); }',
};
for (const [name, body] of Object.entries(stubs)) await write(api + name, `package com.facebook.react.bridge;\n${body}\n`);
await write('manifest.xml', '<manifest />\n');
await mkdir(join(project, 'res'));
function execute(command, args, expected = 0, timeout = 120_000) {
  const result = runChild(command, args, { cwd: project, timeout });
  assert.equal(result.status, expected, `${command === gradle ? 'public source compilation' : 'compiled corpus command'} failed: ${result.stderr.slice(-3000)}`);
  return result.stdout;
}
const build = execute(gradle, ['--no-daemon', 'describeEvidenceInputs'], 0, 600_000);
await write('build.log', build);
// witness 파일 지문은 raw SHA와 구분하고 로컬 외부 입력에 명시적으로 연결한다.
async function fingerprint(path) {
  const digest = createHash('sha256');
  for (const value of ['file', sha256(await readFile(path))]) {
    const bytes = Buffer.from(value);
    const size = Buffer.alloc(4); size.writeUInt32BE(bytes.length);
    digest.update(size).update(bytes);
  }
  return digest.digest('hex');
}
const witnessPath = join(project, 'build/kartograph/witnesses/compileKotlin/witness.json');
const witness = JSON.parse(await readFile(witnessPath, 'utf8'));
const candidates = new Map();
for (const path of JSON.parse(await readFile(join(project, 'input-candidates-local.json'), 'utf8'))) {
  candidates.set(await fingerprint(path), path);
}
const bindings = witness.inputs.filter(({ path }) => path.startsWith('external/')).flatMap(({ path, sha256: hash }) => {
  assert.ok(candidates.has(hash), `Missing external build input: ${path}`);
  return ['--input', `${path}=${candidates.get(hash)}`];
});
const roots = ['--classes', join(project, 'build/classes/kotlin/main'), '--project', project,
  '--manifest', join(project, 'manifest.xml'), '--resources', join(project, 'res'), '--namespace', 'com.zmxv.RNSound'];
const snapshot = execute(kartograph, ['snapshot', ...roots, '--include-paths', '--scope', 'public-rn:main', '--build-witness', witnessPath]);
await write('snapshot.json', snapshot);
function verify(expected = 0, scope = 'public-rn:main') {
  return JSON.parse(execute(kartograph, ['verify-snapshot', '--project', project, '--graph-file', join(project, 'snapshot.json'), '--scope', scope, ...bindings], expected));
}
assert.equal(verify().status, 'matched');
const caller = execute(process.execPath, [cli, 'extract-js', join(project, definition.source), '--project', project, '--events']);
const native = execute(kartograph, ['bridges', '--project', project, '--rn-events', '--graph-file', join(project, 'snapshot.json')]);
await write('caller.json', caller);
await write('native.json', native);
const fact = JSON.parse(native).facts;
assert.equal(fact.length, 1);
assert.equal(fact[0].symbol?.usr, 'method:com/zmxv/RNSound/Sound#setOnPlay(ZD)V');
assert.equal(fact[0].location.path, definition.nativeSource);
assert.equal(fact[0].location.line, definition.nativeLine);
const inputs = [join(project, 'caller.json'), join(project, 'native.json')];
const check = JSON.parse(execute(process.execPath, [cli, 'check', ...inputs, '--strict']));
assert.equal(check.summary.matchedEvents, 1);
const retentions = execute(process.execPath, [cli, 'retentions', ...inputs, '--for', 'kartograph']);
await write('retentions.json', retentions);
const before = execute(kartograph, ['dead', ...roots]);
const after = execute(kartograph, ['dead', ...roots, '--external-retentions', join(project, 'retentions.json')]);
assert.ok(before.includes('unreachable\tclass:com/zmxv/RNSound/Sound\t'));
assert.ok(!after.includes('unreachable\tclass:com/zmxv/RNSound/Sound\t'));
const explanation = execute(kartograph, ['dead', ...roots, '--external-retentions', join(project, 'retentions.json'), '--explain', fact[0].symbol.usr]);
assert.match(explanation, /EXTERNAL_BRIDGE/u);
assert.ok(explanation.includes(`js:${definition.source}:${definition.callerLine}`));
assert.ok(explanation.includes('onPlayChange'));
const unrelated = execute(kartograph, ['dead', ...roots, '--external-retentions', join(project, 'retentions.json'),
  '--explain', 'method:com/zmxv/RNSound/Sound#setSystemVolume(F)V']);
assert.ok(unrelated.includes('unreachable\tmethod:com/zmxv/RNSound/Sound#setSystemVolume(F)V'));
await write('before.txt', before); await write('after.txt', after); await write('explain.txt', explanation);
const controls = { wrongScope: verify(1, 'public-rn:other').status };
const nativePath = join(project, definition.nativeSource);
const nativeBytes = await readFile(nativePath);
await writeFile(nativePath, Buffer.concat([nativeBytes, Buffer.from('\n// stale input control\n')]));
controls.changedSource = verify(1).status;
await writeFile(nativePath, nativeBytes);
const classPath = join(project, 'build/classes/kotlin/main/com/zmxv/RNSound/Sound.class');
const classBytes = await readFile(classPath);
await writeFile(classPath, Buffer.concat([classBytes, Buffer.from([0])]));
controls.changedClass = verify(1).status;
await writeFile(classPath, classBytes);
assert.equal(verify().status, 'matched');
// 실패한 실제 컴파일은 예전 completed witness를 계속 승인하면 안 된다.
await writeFile(nativePath, Buffer.concat([nativeBytes, Buffer.from('\nthis is not valid Kotlin !!!\n')]));
await write('failed-build.log', execute(gradle, ['--no-daemon', 'compileKotlin'], 1, 600_000));
controls.failedBuild = verify(1).status;
await writeFile(nativePath, nativeBytes);
await write('restored-build.log', execute(gradle, ['--no-daemon', 'compileKotlin'], 0, 600_000));
assert.ok(Object.values(controls).every((status) => status === 'stale'));
await write('witness-controls.json', JSON.stringify(controls, null, 2) + '\n');
// 입력 복원 후 새로 완료된 빌드의 snapshot을 남긴다. 예전 token을 재사용하지 않는다.
await write('snapshot.json', execute(kartograph, ['snapshot', ...roots, '--include-paths', '--scope', 'public-rn:main', '--build-witness', witnessPath]));
assert.equal(verify().status, 'matched');
const sourceHashes = {};
for (const path of [definition.source, definition.nativeSource, 'LICENSE']) sourceHashes[path] = sha256(await readFile(join(project, path)));
const result = {
  format: 'isthmus-public-rn-compiled-results', version: 1,
  package: `${definition.package}@${definition.version}`, archiveSha256: definition.sha256,
  sourceHashes, androidJarSha256: sha256(await readFile(androidJar)),
  compiler: 'Kotlin 2.4.20 / JVM 21',
  buildWitness: { status: 'matched', scope: 'public-rn:main', compiler: witness.compiler,
    externalInputs: bindings.length / 2, controls },
  tools: { isthmus: execute(process.execPath, [cli, '--version']).trim(), kartograph: execute(kartograph, ['--version']).trim() },
  observed: { matchedEvents: 1, nativeJvmId: fact[0].symbol.usr, beforeUnreachable: true, afterRetained: true,
    unrelatedMethodRemainsUnreachable: true, callerExplanation: `${definition.source}:${definition.callerLine}` },
  limitations: ['Original Sound.kt compiled against Android SDK and explicit RN API stubs; no React Native engine or Android app execution.',
    'One Kotlin emission and JS subscription pair; this does not prove all RN code or platform variants are covered.',
    'The completed Gradle witness binds this fixture’s compiler inputs and class outputs; it does not authenticate a producer or prove runtime coverage.',
    ...JSON.parse(native).limitations],
};
await writeFile(outputArg, JSON.stringify(result, null, 2) + '\n');
process.stdout.write(JSON.stringify({ evidence: work, ...result.observed }, null, 2) + '\n');
