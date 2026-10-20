import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { runTaskCommand } from './task-command.ts';
import { runTraceCommand } from './trace-command.ts';

const root = resolve('task-fixture');
const contextPath = resolve(root, 'context.json');
const manifestPath = resolve(root, 'evidence.json');
const commit = 'a'.repeat(40);
const state = { captureId: 'capture-1', repository: 'https://github.com/example/app', commit, dirty: true,
  sourceDigest: 'b'.repeat(64), sourceDigestScheme: 'explicit-source-membership-v1',
  toolchainDigest: 'c'.repeat(64), buildConfigurationDigest: 'd'.repeat(64) };
const fixture = new URL('../../fixtures/trace/', import.meta.url);
const context = JSON.parse(await readFile(new URL('context-relation.json', fixture), 'utf8'));
context.revision = commit;
const fixtureFiles = new Map<string, string>([['context.json', JSON.stringify(context)]]);
for (const name of [...context.documents, ...context.analyses.map((item: { path: string }) => item.path)]) {
  const text = await readFile(new URL(name, fixture), 'utf8');
  fixtureFiles.set(name, text.replaceAll('"rev-1"', JSON.stringify(commit)));
}
const validation = { format: 'isthmus-task-validation', version: 1, tool: { name: 'fixture-runner', version: '1' },
  tests: [
    { id: 'get-users', platform: 'js', usr: 'ts:api/users.get', outcome: 'passed' },
    { id: 'create-users', platform: 'js', usr: 'ts:api/users.create', outcome: 'failed' },
    { id: 'other-platform', platform: 'kotlin', usr: 'ts:api/users.get', outcome: 'failed' },
  ], limitations: [] };

function setup() {
  const files = new Map(fixtureFiles);
  files.set('validation.json', JSON.stringify(validation));
  const artifacts = [...files].map(([path, text], index) => {
    const raw = JSON.parse(text);
    const role = path === 'context.json' ? 'trace-context' : path === 'validation.json' ? 'validation'
      : context.documents.includes(path) ? 'bridge-facts' : 'traversal';
    return { id: `artifact-${index}`, path, role, sha256: digest(text), input: { ...state },
      ...(raw.tool === undefined ? {} : { producer: raw.tool }) };
  });
  const manifest = { format: 'isthmus-evidence-manifest', version: 1, expected: { ...state }, artifacts };
  const reads = new Map<string, number>();
  const read = async (path: string) => {
    const key = resolve(path);
    reads.set(key, (reads.get(key) ?? 0) + 1);
    if (key === manifestPath) return JSON.stringify(manifest);
    const found = [...files].find(([name]) => resolve(root, name) === key)?.[1];
    if (found === undefined) throw new Error('missing');
    return found;
  };
  return { files, manifest, reads, read };
}

function digest(text: string) { return createHash('sha256').update(text, 'utf8').digest('hex'); }
const args = ['task', contextPath, '--evidence', manifestPath];

test('task reuses trace/check, binds every consumed byte, and never promotes manual claims to verified', async () => {
  const { read, reads } = setup();
  const result = await runTaskCommand(args, read);
  assert.equal(result.exitCode, 0);
  const report = JSON.parse(result.standardOutput);
  assert.equal(report.format, 'isthmus-task');
  assert.equal(report.evidence.alignment, 'matched');
  assert.equal(report.evidence.verification, 'unverified');
  assert.deepEqual(report.evidence.expected, state);
  assert.equal(report.evidence.artifacts.items[0].observed.sha256, digest(fixtureFiles.get('context.json')!));
  assert.equal(report.complete, false);
  assert.equal(report.requiresReview, true);
  assert.ok(report.unknown.items.some((item: { code: string }) => item.code === 'input-binding-unverified'));
  assert.deepEqual(report.trace.selection, { relations: ['users'] });
  assert.deepEqual(report.tests.items.map((item: { id: string }) => item.id), ['create-users', 'get-users']);
  assert.equal(report.tests.items[0].observedOutcome, 'failed');
  assert.equal(report.tests.items[0].verification, 'unverified');
  assert.ok(report.tests.items[0].reason.chain >= 0);
  assert.equal(report.tests.items[0].reason.reach.witnessRoot, 'ts:repo/audit.write');
  assert.ok(report.rules.summary.observedFacts > 0);
  for (const count of reads.values()) assert.equal(count, 1, 'analysis and hashing must consume the same read');
  const standalone = JSON.parse((await runTraceCommand(['trace', contextPath], setup().read)).standardOutput);
  assert.deepEqual(report.trace.summary, standalone.summary);
  assert.deepEqual(report.trace.chains, standalone.chains);
});

test('dirty content, commit, repository, capture, toolchain and configuration mismatches stay stale', async () => {
  for (const [field, value] of Object.entries({ captureId: 'other', repository: 'https://github.com/example/other',
    commit: 'e'.repeat(40), dirty: false, sourceDigest: 'f'.repeat(64), toolchainDigest: '0'.repeat(64),
    buildConfigurationDigest: '1'.repeat(64) })) {
    const data = setup();
    Object.assign(data.manifest.artifacts[1]!.input, { [field]: value });
    const result = await runTaskCommand([...args, '--strict', '--limit', '1'], data.read);
    assert.equal(result.exitCode, 1, field);
    const report = JSON.parse(result.standardOutput);
    assert.equal(report.evidence.alignment, 'stale', field);
    assert.ok(report.evidence.summary.stale > 0, field);
    assert.ok(report.unknown.total > report.unknown.items.length);
    assert.equal(report.requiresReview, true);
  }
});

test('mixed artifact bytes, producer metadata and actual revision disagree even when timestamps match', async () => {
  for (const change of ['bytes', 'producer', 'revision', 'role']) {
    const data = setup();
    const entry = data.manifest.artifacts.find(({ path }) => path === 'server-forward.json')!;
    if (change === 'bytes') data.files.set(entry.path, data.files.get(entry.path)! + '\n');
    if (change === 'producer') entry.producer = { name: 'different', version: '1' };
    if (change === 'role') entry.role = 'bridge-facts';
    if (change === 'revision') {
      data.files.set(entry.path, data.files.get(entry.path)!.replaceAll(commit, 'e'.repeat(40)));
      entry.sha256 = digest(data.files.get(entry.path)!);
    }
    const report = JSON.parse((await runTaskCommand(args, data.read)).standardOutput);
    assert.equal(report.evidence.alignment, 'stale', change);
  }
});

test('missing provenance, absent manifest and incomparable source schemes stay unknown', async () => {
  const noManifest = JSON.parse((await runTaskCommand(['task', contextPath], setup().read)).standardOutput);
  assert.equal(noManifest.evidence.alignment, 'missing');
  assert.ok(noManifest.unknown.items.some((item: { code: string }) => item.code === 'test-mapping-missing'));
  for (const change of ['input', 'producer', 'scheme', 'unlisted', 'unused']) {
    const data = setup();
    const entry = data.manifest.artifacts[1]!;
    if (change === 'input') Reflect.deleteProperty(entry, 'input');
    if (change === 'producer') Reflect.deleteProperty(entry, 'producer');
    if (change === 'scheme') entry.input.sourceDigestScheme = 'different-scheme';
    if (change === 'unlisted') data.manifest.artifacts.splice(1, 1);
    if (change === 'unused') data.manifest.artifacts.push({ ...entry, id: 'unused', path: 'not-read.json' });
    const result = await runTaskCommand([...args, '--strict'], data.read);
    assert.equal(result.exitCode, 1, change);
    assert.notEqual(JSON.parse(result.standardOutput).evidence.alignment, 'matched', change);
    assert.ok(!data.reads.has(resolve(root, 'not-read.json')));
  }
});

test('bounded output retains full unknown/rule/test counts and full-state strict verdict', async () => {
  const full = JSON.parse((await runTaskCommand(args, setup().read)).standardOutput);
  const bounded = await runTaskCommand([...args, '--limit', '1', '--strict', '--compact'], setup().read);
  const report = JSON.parse(bounded.standardOutput);
  assert.equal(bounded.exitCode, 1);
  assert.equal(bounded.standardOutput.trim().split('\n').length, 1);
  assert.equal(report.tests.total, full.tests.total);
  assert.equal(report.tests.omitted, 1);
  assert.equal(report.unknown.total, full.unknown.total);
  assert.equal(report.evidence.artifacts.total, full.evidence.artifacts.total);
  assert.deepEqual(report.trace.summary, full.trace.summary);
  assert.equal(report.trace.truncation.truncated, true);
  assert.equal(report.requiresReview, true);
});

test('stale validation retains observed outcomes, exact mapping and limitations without claiming execution', async () => {
  const data = setup();
  const entry = data.manifest.artifacts.find(({ path }) => path === 'validation.json')!;
  entry.input.buildConfigurationDigest = '0'.repeat(64);
  data.files.set(entry.path, JSON.stringify({ ...validation, tests: [...validation.tests,
    { id: 'uncertain', platform: 'js', usr: 'ts:api/users.get', outcome: 'unknown' }],
    limitations: ['runner scope is incomplete'] }));
  entry.sha256 = digest(data.files.get(entry.path)!);
  const report = JSON.parse((await runTaskCommand(args, data.read)).standardOutput);
  assert.deepEqual(report.tests.items.map((item: { id: string }) => item.id), ['create-users', 'uncertain', 'get-users']);
  assert.ok(report.tests.items.every((item: { inputAlignment: string }) => item.inputAlignment === 'stale'));
  assert.equal(report.tests.items[2].observedOutcome, 'passed');
  assert.equal(report.tests.items[2].verification, 'unverified');
  assert.ok(report.unknown.items.some((item: { code: string }) => item.code === 'validation-limitation'));
});

test('invalid options and invalid or unreadable evidence return 64/2 without partial output', async () => {
  for (const extra of [['--limit', '0'], ['--limit', '1.5'], ['--limit', '101'], ['--unknown'], ['extra.json']]) {
    assert.equal((await runTaskCommand([...args, ...extra], setup().read)).exitCode, 64);
  }
  for (const change of ['version', 'path', 'duplicate-id', 'duplicate-path', 'digest', 'validation', 'validation-read', 'limit']) {
    const data = setup();
    const entry = data.manifest.artifacts[1]!;
    if (change === 'version') data.manifest.version = 2;
    if (change === 'path') entry.path = '../outside.json';
    if (change === 'duplicate-id') entry.id = data.manifest.artifacts[0]!.id;
    if (change === 'duplicate-path') entry.path = data.manifest.artifacts[0]!.path;
    if (change === 'digest') entry.sha256 = 'invalid';
    if (change === 'validation') data.files.set('validation.json', '{}');
    if (change === 'validation-read') data.files.delete('validation.json');
    if (change === 'limit') data.manifest.artifacts[0]!.id = 'a'.repeat(1025);
    const result = await runTaskCommand(args, data.read);
    assert.equal(result.exitCode, 2, change);
    assert.equal(result.standardOutput, '', change);
    assert.ok(!result.standardError.includes(root), 'errors must not reveal paths');
  }
  const missing = await runTaskCommand(args, async () => { throw new Error('missing'); });
  assert.equal(missing.exitCode, 2);
});

test('actual Windows/native CLI exposes task and preserves trace output', async () => {
  const main = fileURLToPath(new URL('./main.ts', import.meta.url));
  const path = fileURLToPath(new URL('context-relation.json', fixture));
  const { stdout, stderr } = await promisify(execFile)(process.execPath, [main, 'task', path, '--limit', '1']);
  assert.equal(stderr, '');
  const report = JSON.parse(stdout);
  assert.equal(report.format, 'isthmus-task');
  assert.equal(report.evidence.alignment, 'missing');
  assert.equal(report.trace.summary.routes, 2);
  assert.equal(basename(path), 'context-relation.json');
});

test('native CLI hashes exactly the artifact bytes it analyzed and detects replacement', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'isthmus-task-evidence-'));
  try {
    const data = setup();
    for (const [name, text] of data.files) await writeFile(join(directory, name), text, 'utf8');
    await writeFile(join(directory, 'evidence.json'), JSON.stringify(data.manifest), 'utf8');
    const main = fileURLToPath(new URL('./main.ts', import.meta.url));
    const invoke = () => promisify(execFile)(process.execPath, [main, 'task', join(directory, 'context.json'),
      '--evidence', join(directory, 'evidence.json')]);
    assert.equal(JSON.parse((await invoke()).stdout).evidence.alignment, 'matched');
    await writeFile(join(directory, 'server.http.json'), data.files.get('server.http.json')! + '\n', 'utf8');
    const report = JSON.parse((await invoke()).stdout);
    assert.equal(report.evidence.alignment, 'stale');
    const stale = report.evidence.artifacts.items.find((item: { alignment: string }) => item.alignment === 'stale');
    assert.notEqual(stale.observed.sha256, stale.declared.sha256);
    assert.equal(report.evidence.verification, 'unverified');
  } finally {
    assert.equal(dirname(directory), resolve(tmpdir()));
    await rm(directory, { recursive: true, force: true });
  }
});

test('legacy Kartograph extra tool metadata is ignored consistently with the existing adapter', async () => {
  for (const tool of [null, 1, 'unvalidated', {}, { name: 'spoof', version: '9' }]) {
    const data = setup();
    const path = 'android-reverse.json';
    const raw = { format: 'kartograph-impact', version: 1, status: 'found', tool,
      inputs: { current: {} }, changed: [{ usr: 'kt:UsersApi.get', qualifiedName: 'UsersApi.get',
        presentIn: ['current'], location: null }], affected: [], unresolved: [], limitations: [],
      truncated: { results: false, depth: false, budget: false } };
    data.files.set(path, JSON.stringify(raw));
    const artifact = data.manifest.artifacts.find((entry) => entry.path === path)!;
    artifact.sha256 = digest(data.files.get(path)!);
    const result = await runTaskCommand(args, data.read);
    assert.equal(result.exitCode, 0, JSON.stringify(tool));
    const report = JSON.parse(result.standardOutput);
    const evidence = report.evidence.artifacts.items.find((entry: { id: string }) => entry.id === `artifact:${artifact.id}`);
    assert.equal(evidence.alignment, 'unverified');
    assert.equal(evidence.observed.producer, undefined);
    assert.ok(evidence.reasons.includes('producer-unverified'));
  }
});

test('optional receipt preserves recorded native state, checks actual bytes, and never verifies current manual claims', async () => {
  const data = setup();
  const target = data.manifest.artifacts.find(entry => entry.path === 'android-reverse.json')!;
  const raw = JSON.parse(data.files.get(target.path)!);
  raw.tool = { name: 'kartograph', version: '0.25.1' };
  data.files.set(target.path, JSON.stringify(raw));
  target.producer = raw.tool;
  target.sha256 = digest(data.files.get(target.path)!);
  const native = { format: 'kartograph-freshness', version: 1, status: 'matched', reasons: [] };
  const receipt = { format: 'isthmus-kartograph-receipt', version: 1, producer: raw.tool,
    scope: 'fixture:main', snapshotSha256: 'a'.repeat(64), producerSha256: 'b'.repeat(64), witnessCount: 1,
    stableSnapshot: true, stableProducer: true, before: native, after: native, limitations: [],
    artifacts: [{ id: target.id, role: 'traversal', sha256: target.sha256 }] };
  data.files.set('receipt.json', JSON.stringify(receipt));
  const reference = { path: 'receipt.json', sha256: digest(data.files.get('receipt.json')!) };
  Object.assign(data.manifest, { kartographReceipt: reference });
  const invoke = async () => JSON.parse((await runTaskCommand(args, data.read)).standardOutput);
  const matched = await invoke();
  assert.equal(matched.evidence.kartograph.nativeAtCapture, 'matched');
  assert.equal(matched.evidence.kartograph.artifacts.items[0].alignment, 'matched');
  assert.equal(matched.evidence.kartograph.currentVerification, 'unverified');
  assert.equal(matched.evidence.verification, 'unverified');
  data.files.set(target.path, data.files.get(target.path)! + '\n');
  assert.equal((await invoke()).evidence.kartograph.artifacts.items[0].alignment, 'stale');
  reference.sha256 = '0'.repeat(64);
  assert.equal((await invoke()).evidence.kartograph.integrity, 'stale');
  data.files.delete('receipt.json');
  assert.equal((await runTaskCommand(args, data.read)).exitCode, 2);
});

test('partial trace keeps rule composition unavailable as unknown instead of an internal error', async () => {
  const data = setup();
  const partial = JSON.parse(data.files.get('context.json')!);
  partial.documents = ['server.persistence.json'];
  data.files.set('context.json', JSON.stringify(partial));
  data.manifest.artifacts[0]!.sha256 = digest(data.files.get('context.json')!);
  const result = await runTaskCommand(args, data.read);
  assert.equal(result.exitCode, 0, result.standardError);
  const report = JSON.parse(result.standardOutput);
  assert.equal(report.rules.status, 'unverified');
  assert.equal(report.rules.summary, undefined);
  assert.ok(report.unknown.items.some((entry: { code: string }) => entry.code === 'rules-unverified'));
  assert.ok(report.trace.gaps.length > 0);
  assert.equal(report.requiresReview, true);
});
