import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, readdir, stat, utimes, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { captureKartographEvidence } from './capture-kartograph-evidence.mjs';
import { runChild } from './run-child.mjs';
import { runTaskCommand } from '../dist/cli/task-command.js';

const PRODUCER = '7b3acbbad87184992b39d948844318ba37fb153e';
const sourceRoot = resolve(process.argv[2] ?? '');
const output = resolve(process.argv[3] ?? 'build/kartograph-evidence');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
const stages = [];
mkdirSync(join(output, 'logs'), { recursive: true });
const run = (stage, command, args, cwd, expected = 0) => {
  const result = runChild(command, args, { cwd, timeout: 5 * 60_000 });
  stages.push({ stage, status: result.status, signal: result.signal ?? null });
  writeFileSync(join(output, 'logs', `${stage}.log`), (result.stdout ?? '') + (result.stderr ?? ''));
  if (result.status !== expected || result.error) throw new Error(`${stage} failed`);
  return result.stdout;
};

// 실제 지원 생산자/Gradle/JDK를 갖춘 CI에서만 명시적으로 실행한다. fake fallback은 없다.
assert.equal(run('producer-commit', 'git', ['rev-parse', 'HEAD'], sourceRoot).trim(), PRODUCER);
const version = (await readFile(join(sourceRoot, 'VERSION'), 'utf8')).trim();
run('java-version', join(process.env.JAVA_HOME, 'bin/java'), ['-version'], sourceRoot);
const gradle = join(sourceRoot, 'gradlew');
const plugin = join(sourceRoot, `gradle-plugin/build/libs/kartograph-gradle-plugin-${version}.jar`);
const binary = join(sourceRoot, 'cli/build/install/kartograph/bin/kartograph');
const lib = join(sourceRoot, 'cli/build/install/kartograph/lib');
await mkdir(output, { recursive: true });
const project = join(output, 'project');
await mkdir(join(project, 'src/main/java/p'), { recursive: true });
await mkdir(join(project, 'src/test/java/p'), { recursive: true });
await writeFile(join(project, 'settings.gradle'), "rootProject.name = 'isthmus-receipt-fixture'\n");
const configPath = join(project, 'build.gradle');
const buildConfig = `buildscript { dependencies { classpath files('${plugin.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}') } }
apply plugin: 'java'
apply plugin: 'io.github.ictechgy.kartograph'
kartograph { snapshotsEnabled = true; includeSourcePaths = true }
`;
await writeFile(configPath, buildConfig);
const sourcePath = join(project, 'src/main/java/p/Repository.java');
const sourceBefore = 'package p;\nimport java.sql.Connection;\nimport java.sql.PreparedStatement;\nimport java.sql.SQLException;\n'
  + 'public class Repository {\n  public PreparedStatement load(Connection c) {\n'
  + '    try { return c.prepareStatement("SELECT id FROM users"); }\n'
  + '    catch (SQLException e) { throw new IllegalStateException(e); }\n  }\n}\n';
await writeFile(sourcePath, sourceBefore);
await writeFile(join(project, 'src/test/java/p/RepositoryCheck.java'), 'package p; public class RepositoryCheck { public void check(java.sql.Connection c) throws Exception { new Repository().load(c); } }\n');
const revision = process.env.GITHUB_SHA ?? 'a'.repeat(40);
const compile = stage => run(stage, gradle, ['--no-daemon', '--max-workers=2', '--console=plain', '--project-dir', project,
  `-Pkartograph.revision=${revision}`, 'kartographSnapshot'], project);
compile('actual-compile-snapshot-before');
const snapshot = join(project, 'build/reports/kartograph/jvm-snapshot.json');
const inputBindings = join(project, 'build/kartograph/jvm-input-bindings.json');
const nativeSnapshot = await readJson(snapshot);
assert.ok(nativeSnapshot.provenance.witnesses.length > 0);
assert.ok(nativeSnapshot.provenance.witnesses.every(w => ['javac'].includes(w.compiler)));
const runtimeFiles = [plugin, ...(await readdir(lib)).filter(name => name.endsWith('.jar')).sort().map(name => join(lib, name))];
const capture = async (name, overrides = {}) => {
  const config = { format: 'isthmus-kartograph-capture', version: 1, command: [binary], runtimeFiles,
    project, snapshot, scope: nativeSnapshot.scope, inputBindings, output: join(output, name), ...overrides };
  let step = 0;
  const result = await captureKartographEvidence(config, process.cwd(), (stage, result) => {
    writeFileSync(join(output, 'logs', `${name}-${++step}-${stage}.log`), (result.stdout ?? '') + (result.stderr ?? ''));
  });
  stages.push({ stage: name, nativeAtCapture: result.nativeAtCapture, before: result.receipt.before, after: result.receipt.after,
    snapshotSha256: result.receipt.snapshotSha256, producerSha256: result.receipt.producerSha256 });
  return result;
};
try {
  const base = await capture('matched-before');
  assert.equal(base.nativeAtCapture, 'matched');
  assert.equal(base.receipt.artifacts.length, 2, 'real facts must have compiler USRs for traversal');
  const classPath = join(project, 'build/classes/java/main/p/Repository.class');
  const classesBefore = await readFile(classPath);
  await mkdir(join(output, 'inputs'), { recursive: true });
  await writeFile(join(output, 'inputs/Repository.before.java'), sourceBefore);
  await writeFile(join(output, 'inputs/Repository.before.class'), classesBefore);
  const sourceTime = await stat(sourcePath);
  const sourceAfter = sourceBefore.replace('FROM users', 'FROM audit');
  await writeFile(join(output, 'inputs/Repository.after.java'), sourceAfter);
  assert.equal(sourceAfter.length, sourceBefore.length);
  await writeFile(sourcePath, sourceAfter);
  await utimes(sourcePath, sourceTime.atime, sourceTime.mtime);
  const staleSource = await capture('stale-source');
  assert.equal(staleSource.nativeAtCapture, 'stale');
  assert.ok(staleSource.receipt.before.reasons.includes('changed-sources'));
  assert.deepEqual(await readFile(classPath), classesBefore, 'source edit must not silently rebuild classes');
  compile('actual-recompile-snapshot-after');
  const rebuilt = await capture('matched-after-recompile');
  assert.equal(rebuilt.nativeAtCapture, 'matched');
  assert.notEqual(hash(await readFile(classPath)), hash(classesBefore));
  await writeFile(join(output, 'inputs/Repository.after.class'), await readFile(classPath));
  assert.notEqual(rebuilt.receipt.snapshotSha256, base.receipt.snapshotSha256);

  await writeFile(configPath, buildConfig + '// changed build configuration\n');
  const staleConfig = await capture('stale-config');
  assert.equal(staleConfig.nativeAtCapture, 'stale');
  assert.ok(staleConfig.receipt.before.reasons.includes('changed-buildConfig'));
  await writeFile(configPath, buildConfig);
  const originalClass = await readFile(classPath), changedClass = Buffer.from(originalClass);
  changedClass[changedClass.length - 1] ^= 1;
  await writeFile(classPath, changedClass);
  const staleClass = await capture('stale-classes');
  assert.equal(staleClass.nativeAtCapture, 'stale');
  assert.ok(staleClass.receipt.before.reasons.includes('changed-classes'));
  await writeFile(classPath, originalClass);
  assert.equal((await capture('missing-external-binding', { inputBindings: undefined })).nativeAtCapture, 'unverified');
  const legacyPath = join(output, 'legacy-snapshot.json'), legacy = await readJson(snapshot);
  delete legacy.provenance;
  await writeFile(legacyPath, JSON.stringify(legacy));
  assert.equal((await capture('legacy-without-receipt', { snapshot: legacyPath })).nativeAtCapture, 'unverified');

  // 수집 당시 matched인 실제 receipt도 오프라인 task의 현재 검증으로 승격하지 않는다.
  const contextPath = join(output, 'context.json'), factsPath = join(rebuilt.output, 'persistence.json');
  const traversalPath = join(rebuilt.output, 'reverse.json');
  const context = { format: 'isthmus-trace-context', version: 1, project, revision,
    documents: [factsPath], analyses: [{ id: 'reverse', platform: 'kotlin', role: 'reverse', path: traversalPath }],
    selection: { files: ['src/main/java/p/Repository.java'] } };
  await writeFile(contextPath, JSON.stringify(context));
  const expected = { captureId: 'real-kartograph-fixture', repository: 'https://github.com/ictechgy/isthmus', commit: revision,
    dirty: true, sourceDigestScheme: 'fixture-explicit-files-v1',
    sourceDigest: hash(JSON.stringify(await Promise.all(['src/main/java/p/Repository.java', 'src/test/java/p/RepositoryCheck.java']
      .map(async path => ({ path, sha256: hash(await readFile(join(project, path))) }))))),
    toolchainDigest: hash(JSON.stringify({ producer: rebuilt.receipt.producerSha256,
      compilers: (await readJson(snapshot)).provenance.witnesses.flatMap(w => w.inputs.filter(i => ['compiler', 'options'].includes(i.role))) })),
    buildConfigurationDigest: hash(JSON.stringify([buildConfig, await readFile(join(project, 'settings.gradle'), 'utf8'), nativeSnapshot.scope])) };
  const artifacts = [{ id: 'context', path: 'context.json', role: 'trace-context' },
    { id: 'kartograph-persistence', path: 'matched-after-recompile/persistence.json', role: 'bridge-facts', producer: rebuilt.receipt.producer },
    { id: 'kartograph-reverse', path: 'matched-after-recompile/reverse.json', role: 'traversal', producer: rebuilt.receipt.producer }];
  for (const entry of artifacts) Object.assign(entry, { input: expected, sha256: hash(await readFile(join(output, entry.path))) });
  const manifestPath = join(output, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify({ format: 'isthmus-evidence-manifest', version: 1, expected, artifacts,
    kartographReceipt: { path: 'matched-after-recompile/receipt.json', sha256: hash(await readFile(join(rebuilt.output, 'receipt.json'))) } }));
  await writeFile(sourcePath, sourceBefore); // 현재 소스를 바꿔도 오프라인 결과는 currentVerification=unverified다.
  const task = await runTaskCommand(['task', contextPath, '--evidence', manifestPath, '--limit', '1'], path => readFile(path, 'utf8'));
  assert.equal(task.exitCode, 0, task.standardError);
  const taskReport = JSON.parse(task.standardOutput);
  assert.equal(taskReport.evidence.kartograph.nativeAtCapture, 'matched');
  assert.equal(taskReport.evidence.kartograph.currentVerification, 'unverified');
  assert.equal(taskReport.evidence.verification, 'unverified');
  assert.equal(taskReport.requiresReview, true);
  await writeFile(join(output, 'task.json'), task.standardOutput);
  // 현재 생산자가 throws 선언에 USR을 붙이지 못하는 실제 음성 대조군도 보존한다.
  const unsupported = sourceBefore.replace('load(Connection c) {', 'load(Connection c) throws SQLException {');
  await writeFile(sourcePath, unsupported);
  await writeFile(join(output, 'inputs/Repository.unsupported.java'), unsupported);
  compile('actual-compile-missing-symbol-control');
  const noUsrs = await capture('native-matched-missing-symbols');
  assert.equal(noUsrs.receipt.before.status, 'matched');
  assert.equal(noUsrs.receipt.after.status, 'matched');
  assert.equal(noUsrs.nativeAtCapture, 'unverified');
  assert.ok(noUsrs.receipt.limitations.includes('no-persistence-symbol-roots'));
  console.log('Actual Kartograph receipt/source/config/class binding verified; offline current state remains unverified.');
} finally {
  await writeFile(join(output, 'verification.json'), JSON.stringify({ producerCommit: PRODUCER, version,
    toolchain: 'Temurin 17.0.17+10; producer wrapper Gradle 9.7.1', stages }, null, 2) + '\n');
}
