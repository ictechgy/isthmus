import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { runTraceCommand, traceUsage } from './trace-command.ts';
import { MAX_INPUT_TEXT_LENGTH } from './command-support.ts';

const directory = new URL('../../fixtures/trace/', import.meta.url);
const files = new Map<string, string>();
for (const name of ['context.json', 'context-relation.json', 'server.http.json', 'server.persistence.json', 'db.sql.json',
  'android.http.json', 'server-forward.json', 'server-reverse.json', 'db-dependents.json', 'android-reverse.json']) {
  files.set(name, await readFile(new URL(name, directory), 'utf8'));
}

/** `/fx/` 아래 경로만 fixture로 읽는 가짜 파일시스템이다. 덮어쓴 파일은 overrides가 이긴다. */
function reader(overrides: Record<string, string> = {}, seen: string[] = []) {
  return async (path: string) => {
    seen.push(path);
    const name = path.startsWith('/fx/') ? path.slice('/fx/'.length) : undefined;
    const text = name === undefined ? undefined : overrides[name] ?? files.get(name);
    if (text === undefined) throw new Error('missing');
    return text;
  };
}

const context = JSON.parse(files.get('context.json')!);

test('trace는 context 기준 상대 경로를 읽고 결정적 JSON과 종료 코드를 낸다', async () => {
  const seen: string[] = [];
  const first = await runTraceCommand(['trace', '/fx/context.json', '--strict'], reader({}, seen));
  const second = await runTraceCommand(['trace', '--strict', '/fx/context.json'], reader());
  assert.equal(first.exitCode, 0);
  assert.equal(first.standardError, '');
  assert.equal(first.standardOutput, second.standardOutput);
  assert.ok(seen.includes('/fx/server-forward.json') && seen.includes('/fx/db.sql.json'));
  const compact = await runTraceCommand(['trace', '/fx/context.json', '--compact'], reader());
  assert.equal(compact.standardOutput.trim().split('\n').length, 1);
  assert.deepEqual(JSON.parse(compact.standardOutput), JSON.parse(first.standardOutput));
  const absolute = { ...context, documents: context.documents.map((path: string) => `/fx/${path}`) };
  const moved = await runTraceCommand(['trace', '/other/context.json'], async (path) =>
    path === '/other/context.json' ? JSON.stringify({ ...absolute, analyses: absolute.analyses.map((entry: any) =>
      ({ ...entry, path: `/fx/${entry.path}` })) }) : reader()(path));
  assert.equal(moved.standardOutput, first.standardOutput);
});

test('strict는 gap이 있으면 1이고 보고서를 그대로 낸다', async () => {
  const withoutForward = { ...context, analyses: context.analyses.filter(({ id }: { id: string }) => id !== 'server-forward') };
  const read = reader({ 'context.json': JSON.stringify(withoutForward) });
  const strict = await runTraceCommand(['trace', '/fx/context.json', '--strict'], read);
  assert.equal(strict.exitCode, 1);
  assert.match(strict.standardError, /gaps/);
  assert.equal(JSON.parse(strict.standardOutput).gaps[0].code, 'analysis-missing');
  assert.equal((await runTraceCommand(['trace', '/fx/context.json'], read)).exitCode, 0);
});

test('사용 오류는 64, 입력 오류는 원인과 함께 2다', async () => {
  for (const args of [['trace'], ['trace', 'a.json', 'b.json'], ['trace', 'a.json', '--unknown']]) {
    const result = await runTraceCommand(args, reader());
    assert.equal(result.exitCode, 64);
    assert.equal(result.standardError, `${traceUsage}\n`);
  }
  const cases: Array<[Record<string, string>, RegExp]> = [
    [{ 'context.json': '{' }, /not valid JSON/],
    [{ 'context.json': 'x'.repeat(MAX_INPUT_TEXT_LENGTH + 1) }, /size limit/],
    [{ 'context.json': JSON.stringify({ format: 'isthmus-workspace', version: 1 }) }, /Phase 3/],
    [{ 'context.json': JSON.stringify({ ...context, analyses: [...context.analyses, { id: 'x', platform: 'js', role: 'reverse',
      path: 'missing.json' }] }) }, /Unable to read trace analysis 5/],
    [{ 'server-forward.json': '[' }, /analysis 1 is not valid JSON/],
    [{ 'server-forward.json': ' '.repeat(MAX_INPUT_TEXT_LENGTH + 1) }, /analysis 1 exceeds/],
    [{ 'server-forward.json': JSON.stringify({ format: 'language-traversal', version: 2 }) }, /violates its contract/],
    [{ 'db.sql.json': '{}' }, /Bridge facts input 3 violates/],
    [{ 'android.http.json': files.get('android.http.json')!.replace('/work/trace-example', '/work/other') }, /same project|trace context project/],
  ];
  for (const [overrides, pattern] of cases) {
    const result = await runTraceCommand(['trace', '/fx/context.json'], reader(overrides));
    assert.equal(result.exitCode, 2, pattern.source);
    assert.equal(result.standardOutput, '');
    assert.match(result.standardError, pattern);
  }
  const unreadable = await runTraceCommand(['trace', '/missing/context.json'], reader());
  assert.match(unreadable.standardError, /Unable to read the trace context/);
});

test('실제 CLI 프로세스가 fixture 디렉터리 기준으로 trace를 실행한다', async () => {
  const mainPath = fileURLToPath(new URL('./main.ts', import.meta.url));
  const contextPath = fileURLToPath(new URL('context-relation.json', directory));
  const { stdout, stderr } = await promisify(execFile)(process.execPath, [mainPath, 'trace', contextPath, '--strict', '--compact']);
  assert.equal(stderr, '');
  const report = JSON.parse(stdout);
  assert.equal(report.format, 'isthmus-trace');
  assert.equal(report.summary.routes, 2);
  assert.equal(basename(contextPath), 'context-relation.json');
});
