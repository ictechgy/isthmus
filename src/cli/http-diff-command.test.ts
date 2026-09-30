import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { runDiffCommand } from './diff-command.ts';
import { httpDiffUsage, parseHttpDiffArguments, runHttpDiffCommand } from './http-diff-command.ts';

/**
 * `diff --http` CLI 경계 — 인수 검증(64), `--fail-on`·`--strict` 종료 코드(0/1), 입력 오류(2), 모드 판별, 상대 경로
 * 해석, 실제 프로세스의 결정적 출력을 고정한다.
 */

const fixtureRoot = new URL('../../fixtures/http-diff/', import.meta.url);
const files = new Map<string, string>();
for (const name of ['surface/before.server.json', 'surface/after.server.json', 'surface/clients.json',
  'workspace/before.workspace.json', 'workspace/after.workspace.json', 'workspace/server-before/server.http.json',
  'workspace/server-before/api.openapi.json', 'workspace/server-after/server.http.json', 'workspace/server-after/api.openapi.json',
  'workspace/client/android.http.json']) {
  files.set(name, await readFile(new URL(name, fixtureRoot), 'utf8'));
}

/** `/fx/` 아래 경로만 fixture로 읽는 가짜 파일시스템이다. overrides가 이긴다. */
function reader(overrides: Record<string, string> = {}, seen: string[] = []) {
  return async (path: string) => {
    seen.push(path);
    const name = path.startsWith('/fx/') ? path.slice('/fx/'.length) : undefined;
    const text = name === undefined ? undefined : overrides[name] ?? files.get(name);
    if (text === undefined) throw new Error('missing');
    return text;
  };
}

const surface = ['diff', '--http', '--before', '/fx/surface/before.server.json', '--after', '/fx/surface/after.server.json',
  '--clients', '/fx/surface/clients.json'];
const workspace = ['diff', '--http', '--before', '/fx/workspace/before.workspace.json', '--after', '/fx/workspace/after.workspace.json'];

test('surface: 기본은 0이고 --fail-on·--strict에 걸리면 1이며 보고서는 그대로다', async () => {
  const plain = await runDiffCommand(surface, reader());
  assert.equal(plain.exitCode, 0);
  assert.equal(plain.standardError, '');
  const report = JSON.parse(plain.standardOutput);
  assert.equal(report.format, 'isthmus-http-diff');
  const strict = await runDiffCommand([...surface, '--strict'], reader());
  assert.equal(strict.exitCode, 1);
  assert.equal(strict.standardOutput, plain.standardOutput);
  assert.equal(strict.standardError, 'Http diff matched --fail-on: changed-bound-route (1), removed-bound-route (2).\n');
  const incomplete = await runDiffCommand([...surface, '--fail-on', 'incomplete'], reader());
  assert.equal(incomplete.exitCode, 1);
  assert.match(incomplete.standardError, /calls-dynamic \(1\)/);
  const unmatched = await runDiffCommand([...surface, '--fail-on', 'route-case-sensitivity-changed,link-service-ambiguous'], reader());
  assert.equal(unmatched.exitCode, 0);
  const warning = await runDiffCommand([...surface, '--fail-on', 'warning'], reader());
  assert.ok(!warning.standardError.includes('route-added'), 'info must not match warning');
  assert.match(warning.standardError, /removed-bound-route \(2\)/);
  const union = await runDiffCommand([...surface, '--fail-on', 'rebound-route-calls', '--strict'], reader());
  assert.match(union.standardError, /rebound-route-calls \(1\)/);
  assert.match(union.standardError, /removed-bound-route \(2\)/);
});

test('surface: 플래그 순서와 무관하게 같은 출력이고 --compact는 한 줄이다', async () => {
  const first = await runDiffCommand(surface, reader());
  const moved = await runDiffCommand(['diff', '--http', '--clients', '/fx/surface/clients.json', '--compact',
    '--after', '/fx/surface/after.server.json', '--before', '/fx/surface/before.server.json'], reader());
  assert.equal(moved.standardOutput.trim().split('\n').length, 1);
  assert.deepEqual(JSON.parse(moved.standardOutput), JSON.parse(first.standardOutput));
});

test('workspace: 매니페스트 기준 상대 경로를 읽고 before는 선언 측 member만 읽는다', async () => {
  const seen: string[] = [];
  const result = await runDiffCommand([...workspace, '--fail-on', 'removed-bound-route'], reader({}, seen));
  assert.equal(result.exitCode, 1, result.standardError);
  assert.equal(JSON.parse(result.standardOutput).mode, 'workspace');
  assert.ok(seen.includes('/fx/workspace/server-before/server.http.json'));
  assert.equal(seen.filter((path) => path === '/fx/workspace/client/android.http.json').length, 1);
});

test('입력 구성 오류는 원인 문구와 코드 2이고 stdout을 비운다', async () => {
  const manifest = JSON.parse(files.get('workspace/before.workspace.json')!);
  const cases: Array<[string[], Record<string, string>, RegExp]> = [
    [[...workspace, '--clients', '/fx/surface/clients.json'], {}, /remove --clients/],
    [['diff', '--http', '--before', '/fx/workspace/before.workspace.json', '--after', '/fx/surface/after.server.json'], {},
      /two workspace manifests, two http surfaces or two document lists/],
    [['diff', '--http', '--before', '/fx/missing.json', '--after', '/fx/surface/after.server.json'], {}, /Unable to read the before input/],
    [['diff', '--http', '--before', '/fx/surface/before.server.json', '--after', '/fx/bad.json'], { 'bad.json': '{' },
      /after input is not valid JSON/],
    [workspace, { 'workspace/after.workspace.json': JSON.stringify({ ...manifest, links: [{ ...manifest.links[0], match: {} }] }) },
      /after workspace manifest violates its contract/],
    [workspace, { 'workspace/client/android.http.json': '[]' }, /Bridge facts input \d+ violates/],
    [['diff', '--http', '--before', '/fx/surface/before.server.json', '/fx/surface/clients.json', '--after',
      '/fx/surface/after.server.json'], {}, /client-only documents/],
    [workspace, { 'workspace/server-after/server.http.json': files.get('workspace/server-after/server.http.json')!
      .replace('/work/example-server', '/work/other') }, /member project/],
    [['diff', '--http', '--before', '/fx/surface/before.server.json', '/fx/named.json', '--after',
      '/fx/surface/after.server.json', '/fx/named.json'], { 'named.json': files.get('surface/after.server.json')!
      .replace('"project"', '"service": "api", "project"') }, /all declare a service or none/],
    [['diff', '--http', '--before', '/fx/surface/before.server.json', '--after', '/fx/big.json'],
      { 'big.json': ' '.repeat(16 * 1024 * 1024 + 1) }, /exceeds the input size limit/],
  ];
  for (const [args, overrides, message] of cases) {
    const result = await runHttpDiffCommand(args, reader(overrides));
    assert.equal(result.exitCode, 2, `${args.join(' ')}: ${result.standardError}`);
    assert.equal(result.standardOutput, '');
    assert.match(result.standardError, message);
  }
});

test('인수 오류는 읽기 전에 64로 거부하고 모르는 --fail-on 토큰은 CI를 통과시키지 않는다', async () => {
  const bad = [
    ['diff', '--http'],
    ['diff', '--http', '--before', 'a.json'],
    ['diff', '--http', '--before', '--after', 'b.json'],
    ['diff', '--http', '--before', 'a.json', '--after', 'b.json', '--clients'],
    ['diff', '--http', 'a.json', '--before', 'b.json', '--after', 'c.json'],
    ['diff', '--http', '--before', 'a.json', '--after', 'b.json', '--fail-on', 'removed-route'],
    ['diff', '--http', '--before', 'a.json', '--after', 'b.json', '--fail-on', 'error,'],
    ['diff', '--http', '--before', 'a.json', '--after', 'b.json', '--fail-on'],
    ['diff', '--http', '--before', 'a.json', '--after', 'b.json', '--fail-on', 'error', '--fail-on', 'warning'],
    ['diff', '--http', '--before', 'a.json', '--after', 'b.json', '--strict', '--strict'],
    ['diff', '--http', '--before', 'a.json', '--before', 'c.json', '--after', 'b.json'],
    ['diff', '--http', '--before', 'a.json', '--after', 'b.json', '--unknown'],
    ['diff', '--http', '--before', ' ', '--after', 'b.json'],
    ['diff', '--http', '--before', ...Array.from({ length: 256 }, (_, index) => `${index}.json`), '--after', 'b.json'],
  ];
  for (const args of bad) {
    const seen: string[] = [];
    const result = await runHttpDiffCommand(args, reader({}, seen));
    assert.equal(result.exitCode, 64, args.join(' '));
    assert.equal(result.standardError, `${httpDiffUsage}\n`);
    assert.deepEqual(seen, []);
  }
  assert.equal(parseHttpDiffArguments(['diff', '--before', '--http']), undefined);
  // `--http`가 diff 바로 다음이 아니면 bridge diff로 가고 `-`로 시작하는 경로로 거부된다.
  const misplaced = await runDiffCommand(['diff', '--before', 'a', 'b', '--http', '--after', 'c', 'd'], reader());
  assert.equal(misplaced.exitCode, 64);
  assert.match(misplaced.standardError, /isthmus diff --http/);
});

test('bridge diff는 http 문서를 받으면 --http를 안내한다', async () => {
  const before = files.get('surface/before.server.json')!;
  const result = await runDiffCommand(['diff', '--before', '/fx/a', '/fx/b', '--after', '/fx/a', '/fx/b'],
    reader({ a: before, b: files.get('surface/clients.json')! }));
  assert.equal(result.exitCode, 2);
  assert.match(result.standardError, /isthmus diff --http/);
});

test('실제 CLI 프로세스는 fixture에서 결정적 출력과 종료 코드를 낸다', () => {
  const cli = fileURLToPath(new URL('./main.ts', import.meta.url));
  const fixture = (path: string) => fileURLToPath(new URL(path, fixtureRoot));
  const args = [cli, 'diff', '--http', '--before', fixture('workspace/before.workspace.json'),
    '--after', fixture('workspace/after.workspace.json'), '--fail-on', 'error'];
  const first = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 10_000 });
  const second = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 10_000 });
  assert.equal(first.status, 1, first.stderr);
  assert.equal(first.stdout, second.stdout);
  assert.equal(JSON.parse(first.stdout).summary.errors, 2);
  const help = spawnSync(process.execPath, [cli, 'help', 'diff'], { encoding: 'utf8', timeout: 10_000 });
  assert.match(help.stdout, /isthmus diff --http/);
});
