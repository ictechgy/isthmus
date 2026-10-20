import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, copyFile, cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAidlcPlugin } from './build-aidlc-plugin.mjs';
import { runChild } from './run-child.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const upstream = JSON.parse(await readFile(join(root, 'integrations/aidlc/upstream.json'), 'utf8'));
const assets = resolve(process.argv[2]), output = resolve(process.argv[3]);
const executableName = process.platform === 'win32' ? 'aidlc-windows-x64.exe' : 'aidlc-linux-x64';
const archiveName = `aidlc-runtime-${upstream.version}.tar.gz`;
const steps = [];
await mkdir(output);
await mkdir(join(output, 'logs'));
for (const name of [executableName, archiveName]) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(join(assets, name))) hash.update(chunk);
  assert.equal(hash.digest('hex'), upstream.assets[name], `official ${name} bytes`);
}
const executable = join(output, executableName);
await copyFile(join(assets, executableName), executable);
await chmod(executable, 0o755);
const machine = join(output, 'machine');
const env = { ...process.env, AIDLC_INSTALL_ROOT: machine, AIDLC_BIN_DIR: join(machine, 'bin') };
const run = async (label, command, args, cwd = output, expected = 0, extraEnv = {}) => {
  const result = runChild(command, args, { cwd, env: { ...env, ...extraEnv }, timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
  await writeFile(join(output, 'logs', `${label}.log`), (result.stdout ?? '') + (result.stderr ?? ''));
  steps.push({ label, status: result.status });
  await writeFile(join(output, 'verification.json'), JSON.stringify({ upstream, steps }, null, 2));
  assert.equal(result.error, undefined, `${label} process execution`);
  assert.equal(result.status, expected, `${label}: ${(result.stderr ?? '').slice(0, 400)}`);
  return result.stdout;
};
const native = (label, args, cwd, expected = 0, extraEnv = {}) => run(label, executable, ['engine', ...args], cwd, expected, extraEnv);
assert.match(await run('version', executable, ['--version']), /aidlc 2\.11\.1/);
// 고정 해시의 공식 runtime에서 harness 하나만 새 검증 디렉터리에 푼다.
await run('extract-runtime', 'tar', ['-xzf', join(assets, archiveName), '-C', output, 'runtime/claude']);
const project = join(output, 'project');
await cp(join(output, 'runtime/claude'), project, { recursive: true });
const plugin = await buildAidlcPlugin(join(output, 'isthmus-evidence'));
const valid = JSON.parse(await native('validate-plugin', ['plugin', 'validate', plugin, '--json'], project));
assert.equal(valid.valid, true); assert.deepEqual(valid.errors, []);
const projected = join(output, 'projected-plugin');
await native('build-host-plugin', ['plugin', 'build', 'claude', projected, '--plugin-root', plugin, '--json'], project);
await native('compose-plugin', ['plugin', 'sync', '--plugin-root', projected, '--harness-dir', '.claude', '--project-dir', project, '--json'], project);
const graphPath = join(project, '.claude/tools/data/stage-graph.json');
const graph = JSON.parse(await readFile(graphPath, 'utf8'));
for (const slug of ['delivery-planning', 'build-and-test']) {
  const stage = graph.find(row => row.slug === slug);
  assert.ok(stage.sensors_applicable.some(row => row.id === 'isthmus-task' && row.fire_on === 'gate' && row.default_severity === 'advisory'));
}
const stamp = await readFile(join(project, '.claude/tools/data/plugin-compose-isthmus-evidence.json'), 'utf8');
await native('compose-idempotent', ['plugin', 'sync', '--plugin-root', projected, '--harness-dir', '.claude', '--project-dir', project, '--json'], project);
assert.equal(await readFile(join(project, '.claude/tools/data/plugin-compose-isthmus-evidence.json'), 'utf8'), stamp);
const taskText = await run('actual-isthmus-task', process.execPath,
  [join(root, 'dist/cli/main.js'), 'task', join(root, 'fixtures/trace/context-relation.json'), '--limit', '1', '--compact'], root);
const task = JSON.parse(taskText);
assert.equal(task.complete, false); assert.ok(task.unknown.omitted > 0);
await writeFile(join(output, 'task.json'), taskText);

async function gateCase(name, stage, severity, mode = 'task', pass = false) {
  const fixture = join(output, name);
  await mkdir(fixture);
  await cp(join(project, '.claude'), join(fixture, '.claude'), { recursive: true });
  const intents = join(fixture, 'aidlc/spaces/default/intents'), recordName = 'fixture-8000000000000001';
  const record = join(intents, recordName), phase = stage === 'delivery-planning' ? 'inception' : 'construction';
  await mkdir(join(record, 'audit'), { recursive: true });
  await writeFile(join(fixture, 'aidlc/active-space'), 'default\n');
  await writeFile(join(fixture, 'aidlc/.aidlc-clone-id'), 'isthmussmokefix1\n');
  await writeFile(join(intents, 'active-intent'), recordName + '\n');
  await writeFile(join(intents, 'intents.json'), JSON.stringify([{ uuid: '00000000-0000-7000-8000-000000000001',
    slug: 'fixture', dirName: recordName, status: 'in-flight' }]));
  const document = join(record, phase, stage, 'review.md');
  await mkdir(dirname(document), { recursive: true });
  await writeFile(document, '# Review\n');
  if (mode === 'task') await writeFile(`${document}.isthmus-task.json`, taskText);
  if (mode === 'malformed') await writeFile(`${document}.isthmus-task.json`, '{');
  if (mode === 'upstream-timeout') await writeFile(`${document}.isthmus-task.json`, JSON.stringify({
    format: 'isthmus-aidlc-input', version: 1, status: 'timeout', reason: 'upstream capture timed out' }));
  const sensor = join(fixture, '.claude/sensors/aidlc-isthmus-task.md');
  let manifest = (await readFile(sensor, 'utf8')).replace('default_severity: advisory', `default_severity: ${severity}`);
  const worker = join(fixture, '.claude/tools/aidlc-sensor-isthmus-task.ts');
  if (mode === 'timeout') {
    manifest = manifest.replace('timeout_seconds: 10', 'timeout_seconds: 1');
    await writeFile(worker, 'export async function main() { await new Promise(resolve => setTimeout(resolve, 10000)); }\n');
  }
  if (mode === 'pass-control') await writeFile(worker,
    'export function main() { console.log(JSON.stringify({pass:true,findings_count:0})); }\n');
  await writeFile(sensor, manifest);
  const graphFile = join(fixture, 'gate-graph.json');
  await writeFile(graphFile, JSON.stringify([{ slug: stage, number: '2.9', name: 'Evidence smoke', phase,
    execution: 'ALWAYS', lead_agent: 'aidlc-product-agent', support_agents: [], mode: 'inline',
    produces: ['review'], optional_produces: [], consumes: [], requires_stage: [], sensors: ['isthmus-task'],
    scopes: ['feature'], inputs: '', outputs: 'review.md', rules_in_context: [],
    sensors_applicable: [{ id: 'isthmus-task', path: '.claude/sensors/aidlc-isthmus-task.md',
      fire_on: 'gate', default_severity: severity }] }]));
  await writeFile(join(record, 'aidlc-state.md'), '# AI-DLC State Tracking\n\n- **Workflow**: feature\n- **State Version**: 8\n'
    + `- **Scope**: feature\n- **Phase**: ${phase}\n- **Current Stage**: ${stage}\n\n- [-] ${stage} — EXECUTE\n`);
  const gateEnv = { AIDLC_STAGE_GRAPH: graphFile, AIDLC_DISABLE_SENSORS: '0', AIDLC_ALLOW_DIRECT_STATE_TRANSITIONS: '1',
    AIDLC_SKIP_HUMAN_PRESENCE_GUARD: '1', AIDLC_GATE_SENSOR_DISPATCH_TIMEOUT_MS: '15000' };
  await native(name, ['state', 'gate-start', stage, '--project-dir', fixture], fixture, pass ? 0 : 1, gateEnv);
  const files = await readdir(join(record, 'audit'));
  const audit = (await Promise.all(files.filter(file => file.endsWith('.md')).map(file => readFile(join(record, 'audit', file), 'utf8')))).join('\n');
  assert.equal(audit.includes('**Event**: STAGE_AWAITING_APPROVAL'), pass, `${name} gate transition`);
  assert.ok(audit.includes(mode === 'timeout' ? 'SENSOR_BUDGET_OVERRIDE' : mode === 'pass-control' ? 'SENSOR_PASSED' : 'SENSOR_FAILED'), `${name} audit result`);
  if (mode === 'task') {
    const detailDir = join(record, '.aidlc-engine/sensors', stage);
    const detail = (await Promise.all((await readdir(detailDir)).filter(file => file.endsWith('.md')).map(file => readFile(join(detailDir, file), 'utf8')))).join('\n');
    assert.ok(detail.includes('"currentCheckout": "unverified"'));
    assert.ok(detail.includes('"truncated"'));
  }
}
for (const stage of ['delivery-planning', 'build-and-test']) {
  await gateCase(`${stage}-advisory`, stage, 'advisory', 'task', true);
  await gateCase(`${stage}-blocking`, stage, 'blocking');
}
for (const mode of ['missing', 'malformed', 'upstream-timeout', 'timeout']) await gateCase(mode, 'delivery-planning', 'blocking', mode);
await gateCase('verified-pass-control', 'delivery-planning', 'blocking', 'pass-control', true);
console.log('Pinned AI-DLC plugin composition, native sensor and advisory/blocking gates verified.');
