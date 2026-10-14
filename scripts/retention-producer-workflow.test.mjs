import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { runChild } from './run-child.mjs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';

const workflow = await readFile(new URL('../.github/workflows/retention-producers.yml', import.meta.url), 'utf8');
const scripts = [...workflow.matchAll(/node --input-type=module <<'JS'\n([\s\S]*?)\n          JS/gu)];
assert.equal(scripts.length, 1, 'one serial workflow runner');
const body = scripts[0][1].split('\n').map(line => line.slice(10)).join('\n')
  .replace(/^import .*;\n/gmu, '');
const execute = new Function('assert', 'createHash', 'readFileSync', 'realpathSync',
  'writeFileSync', 'resolve', 'runChild', 'process', 'performance', 'console', body);

function scenario(override = () => undefined) {
  const calls = [];
  const files = new Map();
  const process = { execPath: '/node', env: { CARTOGRAPH: '/fixture/bin/cartograph', RUNNER_TEMP: '/fixture/tmp' } };
  const runChild = (command, args, options) => {
    calls.push({ command, args, options });
    const changed = override(command, args);
    if (changed) return changed;
    let stdout = '';
    if (args[0] === '--version') {
      stdout = command === '/node' ? 'v22.18.0\n'
        : command === 'dart' ? 'Dart SDK version: 3.13.3 (stable)\n'
          : command.endsWith('/dartograph') ? 'dartograph 0.16.1\n' : '0.25.1\n';
    } else if (args[1] === '--version') stdout = '0.13.1\n';
    return { status: 0, signal: null, stdout, stderr: '' };
  };
  return { calls, files, process, run() {
    execute(assert, createHash, () => Buffer.from('fixture bytes'), p => resolve('/fixture', p),
      (path, bytes) => files.set(path, bytes), (...args) => resolve('/fixture', ...args),
      runChild, process, performance, { log() {} });
  } };
}

function observations(result) {
  return JSON.parse(result.files.get('/fixture/retention-report/commands.json'));
}

const gateNames = ['roundtrip', 'public-plugin', 'limitation-scopes'];

test('all three actual gate commands run once in order after versions and corpus', () => {
  const result = scenario();
  result.run();
  assert.equal(result.process.exitCode, 0);
  assert.deepEqual(observations(result).map(x => x.name), [
    'node-version', 'dart-version', 'cartograph-version', 'dartograph-version', 'isthmus-version',
    'false-positive-corpus', ...gateNames,
  ]);
  assert.equal(result.calls.length, 9);
  for (const call of result.calls) assert.equal(call.options.maxBuffer, 1024 * 1024);
  for (const call of result.calls.slice(-3)) {
    assert.equal(call.command, '/node');
    assert.equal(call.options.timeout, 720_000);
    assert.equal(call.args.at(-1), '/fixture/isthmus/dist/cli/main.js');
  }
});

for (const gate of gateNames) {
  test(`original ${gate} failure survives later successful gates`, () => {
    const result = scenario((_command, args) => args[0]?.endsWith(
      gate === 'roundtrip' ? 'verify-cartograph-roundtrip.mjs'
        : gate === 'public-plugin' ? 'verify-public-flutter-plugin.mjs' : 'verify-limitation-scopes.mjs',
    ) ? { status: 7, signal: null, stdout: 'original stdout', stderr: 'original stderr' } : undefined);
    result.run();
    assert.equal(result.process.exitCode, 1);
    const rows = observations(result);
    assert.deepEqual(rows.slice(-3).map(x => x.name), gateNames);
    assert.equal(rows.find(x => x.name === gate).status, 7);
    assert.equal(result.files.get(`/fixture/retention-report/${gate}.stdout`), 'original stdout');
    assert.equal(result.files.get(`/fixture/retention-report/${gate}.stderr`), 'original stderr');
  });
}

test('timeout retains null status, signal and error instead of inventing an exit code', () => {
  const result = scenario((_command, args) => args[0]?.endsWith('verify-public-flutter-plugin.mjs')
    ? { status: null, signal: 'SIGTERM', error: { code: 'ETIMEDOUT' }, stdout: 'partial', stderr: '' } : undefined);
  result.run();
  assert.equal(result.process.exitCode, 1);
  const row = observations(result).find(x => x.name === 'public-plugin');
  assert.equal(row.status, null);
  assert.equal(row.signal, 'SIGTERM');
  assert.equal(row.errorCode, 'ETIMEDOUT');
  assert.equal(result.files.get('/fixture/retention-report/public-plugin.stdout'), 'partial');
});

test('version mismatch refuses before any fixture or producer gate', () => {
  const result = scenario((command, args) => command.endsWith('/cartograph') && args[0] === '--version'
    ? { status: 0, signal: null, stdout: '0.0.0\n', stderr: '' } : undefined);
  assert.throws(() => result.run(), /cartograph-version: expected source version/u);
  assert.equal(result.calls.length, 3);
  assert.equal(observations(result).at(-1).status, 0);
});

test('corpus failure stops dependent producer gates and retains original exit', () => {
  const result = scenario(command => command === 'bash'
    ? { status: 2, signal: null, stdout: 'corpus partial', stderr: 'corpus refused' } : undefined);
  assert.throws(() => result.run(), /corpus: child exit/u);
  assert.equal(result.calls.length, 6);
  assert.equal(observations(result).at(-1).status, 2);
});


test('interruption before a child result leaves an explicit incomplete command', () => {
  const interruption = new Error('simulated caller interruption');
  const result = scenario((_command, args) => {
    if (args[0]?.endsWith('verify-public-flutter-plugin.mjs')) throw interruption;
  });
  assert.throws(() => result.run(), error => error === interruption);
  const rows = observations(result);
  assert.equal(rows.at(-1).name, 'public-plugin');
  assert.equal(rows.at(-1).state, 'started');
  assert.equal(rows.at(-1).status, null);
  assert.equal(Object.hasOwn(rows.at(-1), 'wallMilliseconds'), false);
  assert.equal(result.process.exitCode, undefined);
  assert.equal(rows.find(x => x.name === 'roundtrip').state, 'completed');
});


test('the actual dispatch guard rejects malformed or different source SHAs', () => {
  const guards = [...workflow.matchAll(/python3 - <<'PY'\n([\s\S]*?)\n          PY/gu)];
  assert.equal(guards.length, 1);
  const guard = guards[0][1].split('\n').map(line => line.slice(10)).join('\n');
  const actual = 'a'.repeat(40);
  for (const expected of [actual, 'b'.repeat(40), 'a'.repeat(39), 'A'.repeat(40)]) {
    const directory = mkdtempSync(resolve(tmpdir(), 'retention-dispatch-test-'));
    try {
      const result = runChild('python3', ['-c', guard], { cwd: directory, timeout: 5_000,
        env: { ...process.env, INTENDED_SHA: expected, GITHUB_SHA: actual,
          CARTOGRAPH_SHA: 'c'.repeat(40), DARTOGRAPH_SHA: 'd'.repeat(40) } });
      assert.equal(result.error, undefined);
      assert.equal(result.status, expected === actual ? 0 : 1);
      const record = JSON.parse(readFileSync(resolve(directory, 'retention-report/dispatch.json'), 'utf8'));
      assert.deepEqual(record, { expected, actual, cartograph: 'c'.repeat(40), dartograph: 'd'.repeat(40) });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }
});
