import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
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
    [{ 'context.json': JSON.stringify({ format: 'isthmus-workspace', version: 1 }) }, /bare isthmus-workspace manifest/],
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

/** candidate 근거를 싣도록 바꾼 정방향 순회 원문이다. */
function candidateForward(): string {
  const forward = JSON.parse(files.get('server-forward.json')!);
  forward.dispatch = 'candidates';
  forward.reached.find(({ symbol }: any) => symbol.usr === 'ts:repo/users.findById').evidence = 'candidate';
  return JSON.stringify(forward);
}

test('candidate-dispatch gap의 evidence 끝점과 hop 등급이 CLI JSON 출력에 그대로 실린다', async () => {
  const assertEmitted = (text: string) => {
    const report = JSON.parse(text);
    const gaps = report.gaps.filter(({ code }: any) => code === 'candidate-dispatch');
    assert.equal(gaps.length, 2);
    assert.deepEqual(gaps.map(({ evidence }: any) => [evidence.platform, evidence.location.path, evidence.symbol.usr]), [
      ['js', 'server/db/users.ts', 'ts:repo/users.findById'], ['js', 'server/db/users.ts', 'ts:repo/users.findById'],
    ]);
    assert.deepEqual(gaps.map(({ symbol }: any) => symbol.usr), ['ts:api/users.get', 'ts:api/users.get']);
    assert.ok(report.chains[0].relationUses.every(({ reachedFrom }: any) => reachedFrom[0].evidence === 'candidate'));
    assert.equal(report.summary.evidence.candidate, 2);
  };
  const result = await runTraceCommand(['trace', '/fx/context.json', '--strict'], reader({ 'server-forward.json': candidateForward() }));
  assert.equal(result.exitCode, 1);
  assertEmitted(result.standardOutput);
  // 실제 프로세스도 같은 필드를 낸다(직렬화 경로 전체).
  const directoryPath = await mkdtemp(join(tmpdir(), 'isthmus-trace-'));
  try {
    for (const [name, text] of files) await writeFile(join(directoryPath, name), text);
    await writeFile(join(directoryPath, 'server-forward.json'), candidateForward());
    const mainPath = fileURLToPath(new URL('./main.ts', import.meta.url));
    const child = await promisify(execFile)(process.execPath, [mainPath, 'trace', join(directoryPath, 'context.json'), '--compact']);
    assertEmitted(child.stdout);
  } finally {
    await rm(directoryPath, { recursive: true, force: true });
  }
});

test('같은 핸들러의 정방향 분석 중 하나라도 잇지 못한 호출을 신고하지 않으면 strict는 1이다', async () => {
  // server-forward는 dispatch로 신고하고 이 핸들러에서 닿는 정점에 잇지 못한 호출이 없다. z-forward는 신고하지 않는다.
  const legacy = JSON.parse(files.get('server-forward.json')!);
  delete legacy.dispatch;
  const withLegacy = { ...context, analyses: [...context.analyses, { id: 'z-forward', platform: 'js', role: 'forward',
    path: 'z-forward.json' }] };
  const read = reader({ 'context.json': JSON.stringify(withLegacy), 'z-forward.json': JSON.stringify(legacy) });
  const strict = await runTraceCommand(['trace', '/fx/context.json', '--strict'], read);
  assert.equal(strict.exitCode, 1);
  assert.deepEqual(JSON.parse(strict.standardOutput).gaps.map(({ code, analysis }: any) => [code, analysis]),
    [['reach-completeness-unknown', 'z-forward']]);
});

const workspaceDirectory = fileURLToPath(new URL('../../fixtures/trace-workspace/', import.meta.url));
const mainPath = fileURLToPath(new URL('./main.ts', import.meta.url));

/** 빌드 전 CLI를 실제 프로세스로 실행하고 종료 코드와 출력을 돌려준다. */
async function runProcess(args: readonly string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await promisify(execFile)(process.execPath, [mainPath, ...args]);
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failed = error as { code: number; stdout: string; stderr: string };
    return { code: failed.code, stdout: failed.stdout, stderr: failed.stderr };
  }
}

/** workspace fixture 전체를 임시 디렉터리에 복사하고 변형한다(분리된 두 저장소 배치 그대로). */
async function copyWorkspace(mutate: (files: Map<string, string>) => void): Promise<string> {
  const directoryPath = await mkdtemp(join(tmpdir(), 'isthmus-trace-workspace-'));
  const names = ['context.json', 'context-relation.json', 'context-files.json',
    ...['server.http.json', 'api.openapi.json', 'server.persistence.json', 'db.sql.json', 'server-forward.json',
      'server-reverse.json', 'db-dependents.json'].map((name) => `server/${name}`),
    ...['android.http.json', 'ios.http.json', 'android-reverse.json', 'ios-reverse.json', 'ios-reverse.change-impact.json'].map((name) => `client/${name}`)];
  const texts = new Map<string, string>();
  for (const name of names) texts.set(name, await readFile(join(workspaceDirectory, name), 'utf8'));
  mutate(texts);
  for (const dir of ['server', 'client']) await mkdir(join(directoryPath, dir), { recursive: true });
  for (const [name, text] of texts) await writeFile(join(directoryPath, name), text);
  return directoryPath;
}

test('분리된 두 저장소 workspace를 실제 CLI가 한 명령으로 잇는다', async () => {
  const route = await runProcess(['trace', join(workspaceDirectory, 'context.json'), '--strict', '--compact']);
  assert.equal(route.code, 0);
  assert.equal(route.stderr, '');
  const report = JSON.parse(route.stdout);
  assert.deepEqual(report.gaps, []);
  const [hop] = report.chains[0].routes;
  assert.equal(hop.template, '/api/orders/{}');
  assert.deepEqual(report.chains[0].database.map(({ vertex }: any) => vertex), ['main.orders', 'main.orders.status']);
  assert.deepEqual(hop.calls.map(({ call }: any) => call.symbol.usr), ['kt:OrdersApi.get', 's:OrdersClient.fetch']);
  assert.ok(hop.calls[1].affected.some(({ usr }: any) => usr === 's:OrderDetailView.body'));
  const again = await runProcess(['trace', join(workspaceDirectory, 'context.json'), '--compact', '--strict']);
  assert.equal(again.stdout, route.stdout);
  const relation = await runProcess(['trace', join(workspaceDirectory, 'context-relation.json'), '--strict', '--compact']);
  assert.equal(relation.code, 0);
  assert.equal(JSON.parse(relation.stdout).summary.routes, 2);
});

test('사전 계산 artifact의 sha256이 선언과 다르면 부분 결과 없이 2다', async () => {
  const directoryPath = await copyWorkspace((texts) => {
    const name = 'client/ios-reverse.json';
    texts.set(name, texts.get(name)!.replace('OrderDetailView.body', 'OrderListView.body'));
  });
  try {
    const result = await runProcess(['trace', join(directoryPath, 'context.json'), '--strict']);
    assert.equal(result.code, 2);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /Trace analysis 5 does not match its precomputed sha256/);
  } finally {
    await rm(directoryPath, { recursive: true, force: true });
  }
});

test('--strict 종료 코드: gap 없음 0, gap 있음 1(보고서 그대로), strict 없으면 0, 알림만 있으면 0, 입력 오류 2, 사용 오류 64', async () => {
  const directoryPath = await copyWorkspace((texts) => {
    const context = JSON.parse(texts.get('context.json')!);
    context.links[0].match.services = ['other-api'];
    texts.set('context-gap.json', JSON.stringify(context));
    texts.set('context-broken.json', JSON.stringify({ ...context, links: [{ ...context.links[0], client: 'nobody' }] }));
  });
  try {
    const at = (name: string) => join(directoryPath, name);
    const clean = await runProcess(['trace', at('context.json'), '--strict']);
    assert.deepEqual([clean.code, clean.stderr], [0, '']);
    const gap = await runProcess(['trace', at('context-gap.json'), '--strict']);
    assert.equal(gap.code, 1);
    assert.match(gap.stderr, /Trace has gaps/);
    const gapReport = JSON.parse(gap.stdout);
    assert.deepEqual(gapReport.gaps.map(({ code }: any) => code), ['unattributed-calls-omitted']);
    const lenient = await runProcess(['trace', at('context-gap.json')]);
    assert.deepEqual([lenient.code, lenient.stderr, lenient.stdout], [0, '', gap.stdout]);
    // 파일 선택의 과대 근사는 알림이라 --strict를 실패시키지 않는다.
    const files = await runProcess(['trace', at('context-files.json'), '--strict', '--compact']);
    assert.deepEqual([files.code, files.stderr], [0, '']);
    const filesReport = JSON.parse(files.stdout);
    assert.deepEqual([filesReport.gaps, filesReport.notices.map(({ code }: any) => code), filesReport.summary.notices],
      [[], ['file-selection-coarse'], 1]);
    const broken = await runProcess(['trace', at('context-broken.json'), '--strict']);
    assert.deepEqual([broken.code, broken.stdout], [2, '']);
    assert.match(broken.stderr, /link client and server must name members/);
    assert.equal((await runProcess(['trace', '--strict'])).code, 64);
  } finally {
    await rm(directoryPath, { recursive: true, force: true });
  }
});

test('사전 계산 sha256은 파일 바이트와 같다: 멀티바이트 UTF-8은 통과하고 UTF-8이 아닌 바이트는 2로 막는다', async () => {
  const name = 'client/ios-reverse.json';
  const directoryPath = await copyWorkspace(() => {});
  try {
    const artifact = JSON.parse(await readFile(join(directoryPath, name), 'utf8'));
    artifact.reached[0].symbol.qualifiedName = 'OrderStore.새로고침()';
    const valid = Buffer.from(`${JSON.stringify(artifact)}\n`, 'utf8');
    // 문자열 안에 UTF-8이 아닌 바이트 하나를 넣는다. 읽기 층이 U+FFFD로 바꾸므로 선언한 바이트 해시와 달라져야 한다.
    const invalid = Buffer.concat([valid.subarray(0, valid.indexOf('OrderStore')), Buffer.from([0xff]),
      valid.subarray(valid.indexOf('OrderStore'))]);
    const context = JSON.parse(await readFile(join(directoryPath, 'context.json'), 'utf8'));
    const declare = async (bytes: Buffer) => {
      context.members[2].analyses[1].precomputed.sha256 = createHash('sha256').update(bytes).digest('hex');
      await writeFile(join(directoryPath, 'context.json'), JSON.stringify(context));
      await writeFile(join(directoryPath, name), bytes);
      return runProcess(['trace', join(directoryPath, 'context.json'), '--strict', '--compact']);
    };
    const passed = await declare(valid);
    assert.equal(passed.code, 0);
    assert.ok(passed.stdout.includes('OrderStore.새로고침()'));
    const blocked = await declare(invalid);
    assert.deepEqual([blocked.code, blocked.stdout], [2, '']);
    assert.match(blocked.stderr, /does not match its precomputed sha256/);
  } finally {
    await rm(directoryPath, { recursive: true, force: true });
  }
});

test('--max-chains·--max-rows는 목록을 자르고 truncation에 적으며 종료 코드와 summary는 그대로다', async () => {
  const full = JSON.parse((await runTraceCommand(['trace', '/fx/context.json'], reader())).standardOutput);
  const limited = await runTraceCommand(['trace', '/fx/context.json', '--max-rows', '1', '--strict'], reader());
  assert.equal(limited.exitCode, 0);
  const report = JSON.parse(limited.standardOutput);
  assert.deepEqual(report.summary, full.summary);
  assert.equal(report.chains[0].relationUses.length, 1);
  assert.equal(report.truncation.maxChains, 1000);
  assert.equal(report.truncation.maxRows, 1);
  assert.equal(report.truncation.truncated, true);
  assert.ok(report.truncation.omitted.some((entry: { path: string; total: number; shown: number }) =>
    entry.path === 'chains[0].relationUses' && entry.total === full.chains[0].relationUses.length && entry.shown === 1));
  const chainsOnly = JSON.parse((await runTraceCommand(['trace', '/fx/context.json', '--max-chains', '5'], reader())).standardOutput);
  assert.deepEqual(chainsOnly.truncation, { maxChains: 5, maxRows: 10000, truncated: false, omittedLists: 0, omitted: [] });
  assert.deepEqual(chainsOnly.chains, full.chains);
  for (const args of [['--max-rows', '0'], ['--max-rows', '10001'], ['--max-chains', '1.5'], ['--max-chains', '2e1'], ['--max-rows', '1', '--max-rows', '2']]) {
    const result = await runTraceCommand(['trace', '/fx/context.json', ...args], reader());
    assert.equal(result.exitCode, 64, args.join(' '));
  }
});

test('--upstream-depth는 1..8 정수만 받고, 1이면 출력이 기본과 같으며 2 이상이면 보고서에 깊이를 싣는다', async () => {
  const full = await runTraceCommand(['trace', '/fx/context.json'], reader());
  const one = await runTraceCommand(['trace', '/fx/context.json', '--upstream-depth', '1'], reader());
  assert.equal(one.standardOutput, full.standardOutput);
  const deeper = JSON.parse((await runTraceCommand(['trace', '/fx/context.json', '--upstream-depth', '8'], reader())).standardOutput);
  assert.equal(deeper.upstreamDepth, 8);
  for (const value of ['0', '9', '1.5', '2e0', '-1', 'two']) {
    const result = await runTraceCommand(['trace', '/fx/context.json', '--upstream-depth', value], reader());
    assert.equal(result.exitCode, 64, value);
    assert.match(result.standardError, /--upstream-depth <1\.\.8>/);
  }
});
