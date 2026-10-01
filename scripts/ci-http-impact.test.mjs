import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  changedRouteSelection, childEnvironment, CiStepError, describeExit, classifyContextDocuments, isDeclarationSide, isHttpDiffDocument,
  logUntrusted, MAX_TRACE_ROUTES, OUTPUT_ROOT_NAME, parseInputs, requireNodeVersion, resolveBaseSha, retargetTraceContext,
  rewriteCaptureConfig, runCiHttpImpact, workspaceManifestFromContext, writeActionOutputs,
} from './ci-http-impact.mjs';
import { makeDemoRepository } from './fixtures/ci/make-demo-repo.mjs';
import { runChild } from './run-child.mjs';

// GitHub Action 오케스트레이터 회귀 테스트다. 합성 git 저장소로 capture 모드를 끝까지 돌리고(생산자 없이 사전 계산
// 문서만 복사), 미리 만든 문서 모드와 실패 경로, 입력 검증·경로 변환을 단위로 확인한다.

/** 저장소 루트(빌드된 isthmus checkout — isthmus-path로 쓴다)다. */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** 40자 SHA 예시다. */
const SHA_A = 'a'.repeat(40);

/** 전용 임시 디렉터리에서 본문을 실행하고 항상 지운다. */
function withTemporaryDirectory(body) {
  const directory = mkdtempSync(join(tmpdir(), 'isthmus-ci-test-'));
  try { return body(directory); } finally { rmSync(directory, { recursive: true, force: true }); }
}

/** Action이 넘기는 환경 변수 모양을 만든다. */
function actionEnvironment(directory, overrides) {
  const summary = join(directory, 'summary.md');
  const output = join(directory, 'output.txt');
  writeFileSync(summary, '');
  writeFileSync(output, '');
  return { PATH: process.env.PATH, HOME: process.env.HOME, GITHUB_WORKSPACE: root, RUNNER_TEMP: directory,
    GITHUB_STEP_SUMMARY: summary, GITHUB_OUTPUT: output, ISTHMUS_CI_ISTHMUS_PATH: root,
    ISTHMUS_CI_OUTPUT_DIR: join(directory, 'out'), ...overrides };
}

/** GITHUB_OUTPUT 파일을 표로 읽는다. */
function readOutputs(env) {
  return Object.fromEntries(readFileSync(env.GITHUB_OUTPUT, 'utf8').trim().split('\n').map((line) => {
    const index = line.indexOf('=');
    return [line.slice(0, index), line.slice(index + 1)];
  }));
}

/** 합성 git 명령이다(사용자 설정을 읽지 않는다). */
function git(directory, args) {
  const result = runChild('git', ['-C', directory, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...args],
    { env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test('capture 모드: base·head를 같은 checkout에서 수집해 깨짐·trace·댓글·출력을 남기고 원래 commit으로 되돌린다', () => withTemporaryDirectory((directory) => {
  const demo = makeDemoRepository(join(directory, 'repo'));
  const env = actionEnvironment(directory, { GITHUB_WORKSPACE: demo.path, ISTHMUS_CI_CAPTURE_CONFIG: '.isthmus/capture.json',
    ISTHMUS_CI_BASE_SHA: demo.base, ISTHMUS_CI_HEAD_SHA: demo.head, ISTHMUS_CI_FAIL_ON: 'error', ISTHMUS_CI_PR_NUMBER: '7',
    ISTHMUS_CI_PR_HEAD_SHA: demo.head });
  const lines = [];
  const result = runCiHttpImpact(env, { log: (line) => lines.push(line) });
  assert.equal(result.failed, true, JSON.stringify(result.meta));
  assert.deepEqual(result.meta.errors, []);
  assert.deepEqual(result.meta.revisions, { base: demo.base, head: demo.head });
  assert.deepEqual(result.meta.pullRequest, { number: 7, headSha: demo.head });
  assert.equal(result.meta.trace.status, 'ran');
  assert.equal(result.meta.trace.side, 'base');
  const outputs = readOutputs(env);
  assert.equal(outputs.failed, 'true');
  assert.equal(outputs['diff-exit-code'], '1');
  assert.equal(outputs['broken-calls'], '1');
  assert.equal(outputs['proven-broken-calls'], '1');
  assert.equal(outputs['call-impact'], 'breaks-found');
  const comment = readFileSync(outputs['comment-file'], 'utf8');
  assert.match(comment, /`android\/app\/src\/main\/java\/example\/UsersApi\.kt:12` `UsersApi\.get`/u);
  assert.match(comment, /- Tables and columns: `main\.users`, `main\.users\.email`/u);
  assert.match(comment, /- DB dependents: `main\.active_users \(view\)`, `main\.orders \(table\)`/u);
  assert.equal(readFileSync(env.GITHUB_STEP_SUMMARY, 'utf8'), comment);
  const traceContext = JSON.parse(readFileSync(join(env.ISTHMUS_CI_OUTPUT_DIR, 'trace-context.json'), 'utf8'));
  assert.deepEqual(traceContext.selection, { routes: [{ method: 'GET', template: '/api/users/{}', scope: 'default' }] });
  assert.equal(git(demo.path, ['rev-parse', 'HEAD']), demo.head, '원래 commit으로 되돌린다');
  assert.equal(git(demo.path, ['symbolic-ref', '--short', 'HEAD']), 'main', 'detached HEAD가 아니라 원래 브랜치로 되돌린다');
}));

test('예상하지 못한 예외도 meta·댓글·출력을 남긴다', () => withTemporaryDirectory((directory) => {
  const env = actionEnvironment(directory, {
    ISTHMUS_CI_BEFORE: 'fixtures/http-diff/surface/before.server.json', ISTHMUS_CI_AFTER: 'fixtures/http-diff/surface/after.server.json' });
  const lines = [];
  const result = runCiHttpImpact(env, { log: (line) => lines.push(line), execute: () => { throw new TypeError('boom /secret/path'); } });
  assert.equal(result.failed, true);
  assert.deepEqual(result.meta.errors, [{ step: 'internal', message: 'Unexpected failure in the action; see the step log.' }]);
  assert.match(readFileSync(result.outputs['comment-file'], 'utf8'), /Unexpected failure in the action/u);
  assert.doesNotMatch(readFileSync(result.outputs['comment-file'], 'utf8'), /secret/u);
  assert.match(lines.join(''), /::stop-commands::[0-9a-f]{32}\n[^]*boom/u);
}));

test('describeExit: 시간 초과·출력 상한·명령 없음·신호를 밝힌다', () => {
  assert.equal(describeExit({ status: 2 }), 'status 2');
  assert.equal(describeExit({ status: null, error: { code: 'ETIMEDOUT' } }), 'no status (timed out)');
  assert.equal(describeExit({ status: null, error: { code: 'ENOBUFS' } }), 'no status (output exceeded the buffer limit)');
  assert.equal(describeExit({ status: null, error: { code: 'ENOENT' } }), 'no status (the command was not found)');
  assert.equal(describeExit({ status: null, signal: 'SIGKILL' }), 'no status (SIGKILL)');
  assert.equal(describeExit({ status: null }), 'no status (unknown)');
});

test('capture 모드: 추적 파일이 바뀐 checkout은 revision을 바꾸지 않고 실패를 댓글에 싣는다', () => withTemporaryDirectory((directory) => {
  const demo = makeDemoRepository(join(directory, 'repo'));
  writeFileSync(join(demo.path, 'facts', 'db.sql.json'), '{}\n');
  const env = actionEnvironment(directory, { GITHUB_WORKSPACE: demo.path, ISTHMUS_CI_CAPTURE_CONFIG: '.isthmus/capture.json',
    ISTHMUS_CI_BASE_SHA: demo.base, ISTHMUS_CI_HEAD_SHA: demo.head });
  const result = runCiHttpImpact(env, { log: () => {} });
  assert.equal(result.failed, true);
  assert.equal(result.meta.errors[0].step, 'checkout');
  assert.match(readFileSync(result.outputs['comment-file'], 'utf8'), /The isthmus run did not finish/u);
  assert.equal(result.outputs['diff-json'], undefined);
}));

test('미리 만든 surface 문서: trace context 없이 diff만 돌리고 fail-on이 없으면 실패하지 않는다', () => withTemporaryDirectory((directory) => {
  const env = actionEnvironment(directory, {
    ISTHMUS_CI_BEFORE: 'fixtures/http-diff/surface/before.server.json', ISTHMUS_CI_AFTER: 'fixtures/http-diff/surface/after.server.json',
    ISTHMUS_CI_CLIENTS: 'fixtures/http-diff/surface/clients.json', ISTHMUS_CI_FAIL_ON: 'none' });
  const result = runCiHttpImpact(env, { log: () => {} });
  assert.equal(result.failed, false);
  assert.equal(result.meta.trace.status, 'no-context');
  assert.equal(readOutputs(env)['incompleteness'], '1');
  assert.match(readFileSync(result.outputs['comment-file'], 'utf8'), /Trace skipped: no trace context was given/u);
}));

test('미리 만든 workspace 매니페스트와 trace context: scope를 link 이름으로 싣고 trace를 돌린다', () => withTemporaryDirectory((directory) => {
  const env = actionEnvironment(directory, {
    ISTHMUS_CI_BEFORE: 'fixtures/http-diff/workspace/before.workspace.json', ISTHMUS_CI_AFTER: 'fixtures/http-diff/workspace/after.workspace.json',
    ISTHMUS_CI_TRACE_CONTEXT: 'fixtures/trace-workspace/context.json', ISTHMUS_CI_FAIL_ON: 'error' });
  const result = runCiHttpImpact(env, { log: () => {} });
  assert.equal(result.failed, true);
  assert.equal(result.meta.trace.status, 'ran', JSON.stringify(result.meta));
  const context = JSON.parse(readFileSync(join(env.ISTHMUS_CI_OUTPUT_DIR, 'trace-context.json'), 'utf8'));
  assert.deepEqual(context.selection.routes, [{ method: 'DELETE', template: '/api/orders/{}', scope: 'mobile->api' }]);
  assert.ok(context.members.every((member) => (member.documents ?? []).every((path) => path.startsWith('/'))));
}));

test('diff 사용 오류(모르는 fail-on 토큰)는 단계 오류로 댓글에 싣고 실패한다', () => withTemporaryDirectory((directory) => {
  const env = actionEnvironment(directory, {
    ISTHMUS_CI_BEFORE: 'fixtures/http-diff/surface/before.server.json', ISTHMUS_CI_AFTER: 'fixtures/http-diff/surface/after.server.json',
    ISTHMUS_CI_FAIL_ON: 'no-such-token' });
  const result = runCiHttpImpact(env, { log: () => {} });
  assert.equal(result.failed, true);
  assert.equal(result.meta.errors[0].step, 'diff');
  assert.match(result.meta.errors[0].message, /exited with status 64 \(usage error/u);
}));

test('trace 실패는 meta.errors와 trace 상태에 싣는다', () => withTemporaryDirectory((directory) => {
  const context = join(directory, 'bad-context.json');
  writeFileSync(context, JSON.stringify({ format: 'isthmus-trace-context', version: 1, project: '/elsewhere', documents: ['x.json'],
    selection: { routes: [{ method: 'GET', template: '/' }] } }));
  const env = actionEnvironment(directory, {
    ISTHMUS_CI_BEFORE: 'fixtures/http-diff/surface/before.server.json', ISTHMUS_CI_AFTER: 'fixtures/http-diff/surface/after.server.json',
    ISTHMUS_CI_TRACE_CONTEXT: context, ISTHMUS_CI_FAIL_ON: '' });
  const result = runCiHttpImpact(env, { log: () => {} });
  assert.equal(result.meta.trace.status, 'error');
  assert.equal(result.meta.errors[0].step, 'trace');
  assert.equal(result.failed, true);
}));

test('파일 trace 실패도 파일 선택의 모드와 개수를 정확히 남긴다', () => withTemporaryDirectory((directory) => {
  const context = join(directory, 'bad-context.json');
  writeFileSync(context, JSON.stringify({ format: 'isthmus-trace-context', version: 1, project: '/elsewhere', documents: ['missing.json'],
    selection: { routes: [{ method: 'GET', template: '/' }] } }));
  const env = actionEnvironment(directory, { ISTHMUS_CI_BEFORE: 'fixtures/http-diff/surface/before.server.json',
    ISTHMUS_CI_AFTER: 'fixtures/http-diff/surface/after.server.json', ISTHMUS_CI_TRACE_CONTEXT: context,
    ISTHMUS_CI_TRACE_FILES: '["src/query.ts"]', ISTHMUS_CI_FAIL_ON: '' });
  const result = runCiHttpImpact(env, { log: () => {} });
  assert.equal(result.meta.trace.status, 'error');
  assert.equal(result.meta.trace.mode, 'files');
  assert.equal(result.meta.trace.selected, 1);
  assert.equal(result.meta.trace.omittedRoutes, undefined);
}));

test('파일 선택은 non-info route가 있어도 우선하며 없는 파일은 공백으로 남긴다', () => withTemporaryDirectory((directory) => {
  const env = actionEnvironment(directory, { ISTHMUS_CI_BEFORE: 'fixtures/http-diff/surface/before.server.json',
    ISTHMUS_CI_AFTER: 'fixtures/http-diff/surface/after.server.json', ISTHMUS_CI_TRACE_CONTEXT: 'fixtures/trace/context.json',
    ISTHMUS_CI_TRACE_FILES: '["missing.ts"]', ISTHMUS_CI_FAIL_ON: '' });
  const result = runCiHttpImpact(env, { log: () => {} });
  assert.equal(result.meta.trace.mode, 'files');
  assert.equal(result.meta.trace.status, 'ran');
  const context = JSON.parse(readFileSync(join(env.ISTHMUS_CI_OUTPUT_DIR, 'trace-context.json'), 'utf8'));
  assert.deepEqual(context.selection, { files: ['missing.ts'] });
  const trace = JSON.parse(readFileSync(join(env.ISTHMUS_CI_OUTPUT_DIR, 'trace.json'), 'utf8'));
  assert.ok(trace.gaps.some(({ code }) => code === 'file-without-symbols'));
}));

test('입력 오류와 비어 있지 않은 출력 디렉터리는 출력 없이 실패한다', () => withTemporaryDirectory((directory) => {
  const lines = [];
  const both = runCiHttpImpact(actionEnvironment(directory, { ISTHMUS_CI_CAPTURE_CONFIG: 'c.json', ISTHMUS_CI_BEFORE: 'b.json' }),
    { log: (line) => lines.push(line) });
  assert.equal(both.failed, true);
  assert.equal(both.outputs, undefined);
  assert.match(lines.join(''), /Give either capture-config/u);
  const out = join(directory, 'busy');
  mkdirSync(out);
  writeFileSync(join(out, 'old.json'), '{}');
  const busy = runCiHttpImpact(actionEnvironment(directory, { ISTHMUS_CI_BEFORE: 'b.json', ISTHMUS_CI_AFTER: 'a.json', ISTHMUS_CI_OUTPUT_DIR: out }),
    { log: () => {} });
  assert.equal(busy.meta.errors[0].step, 'output');
}));

test('parseInputs: 모드·SHA·버전·fail-on·정수 입력을 검증한다', () => {
  const base = { GITHUB_WORKSPACE: '/w', ISTHMUS_CI_BEFORE: 'b.json', ISTHMUS_CI_AFTER: 'a.json' };
  const parsed = parseInputs({ ...base, ISTHMUS_CI_FAIL_ON: ' error , incomplete ', ISTHMUS_CI_CLIENTS: 'c1.json\n c2.json' });
  assert.equal(parsed.failOn, 'error,incomplete');
  assert.deepEqual(parsed.clients, ['c1.json', 'c2.json']);
  assert.equal(parsed.outputDir, '/w/isthmus-ci');
  assert.equal(parsed.maxRows, 20);
  const rejects = [
    {}, { ISTHMUS_CI_AFTER: 'a.json' }, { ...base, ISTHMUS_CI_CAPTURE_CONFIG: 'c.json' },
    { ISTHMUS_CI_CAPTURE_CONFIG: '../c.json' }, { ISTHMUS_CI_CAPTURE_CONFIG: '/abs/c.json' },
    { ...base, ISTHMUS_CI_BASE_SHA: 'main' }, { ...base, ISTHMUS_CI_ISTHMUS_VERSION: '^0.9.0' },
    { ...base, ISTHMUS_CI_ISTHMUS_VERSION: 'latest' }, { ...base, ISTHMUS_CI_FAIL_ON: 'error;rm -rf /' },
    { ...base, ISTHMUS_CI_MAX_ROWS: '0' }, { ...base, ISTHMUS_CI_TRACE: 'yes' }, { ...base, ISTHMUS_CI_TRACE_SIDE: 'middle' },
  ];
  for (const env of rejects) assert.throws(() => parseInputs(env), CiStepError, JSON.stringify(env));
  assert.equal(parseInputs({ ...base, ISTHMUS_CI_ISTHMUS_VERSION: '0.10.0-rc.1' }).isthmusVersion, '0.10.0-rc.1');
  assert.equal(parseInputs({ ...base, ISTHMUS_CI_PR_NUMBER: 'x' }).pullRequest, undefined);
});

test('rewriteCaptureConfig: 상대 root·출력·trace·선택을 바꾸고 예약 root와 ..를 거부한다', () => {
  const config = { format: 'isthmus-trace-capture', version: 1, roots: { repo: '.', sub: 'packages/api', abs: '/opt/ci', blank: '', side: '../client-app' },
    output: { root: 'repo', path: 'x' }, members: [], selection: { files: ['a.ts'] }, trace: true };
  const rewritten = rewriteCaptureConfig(config, { repositoryPath: '/checkout', outputRoot: '/tmp/out', side: 'head' });
  assert.deepEqual(rewritten.roots, { repo: '/checkout', sub: '/checkout/packages/api', abs: '/opt/ci', blank: '/checkout',
    side: '/client-app', [OUTPUT_ROOT_NAME]: '/tmp/out' });
  assert.deepEqual(rewritten.output, { root: OUTPUT_ROOT_NAME, path: 'head' });
  assert.equal(rewritten.trace, false);
  assert.deepEqual(rewritten.selection, { routes: [{ method: 'GET', template: '/' }] });
  assert.equal(config.trace, true, '원본을 바꾸지 않는다');
  const options = { repositoryPath: '/checkout', outputRoot: '/o', side: 'base' };
  assert.throws(() => rewriteCaptureConfig({ ...config, roots: { win: 'a\\b' } }, options), CiStepError);
  assert.throws(() => rewriteCaptureConfig({ ...config, roots: { [OUTPUT_ROOT_NAME]: '/x' } }, options), CiStepError);
  assert.throws(() => rewriteCaptureConfig({ format: 'isthmus-workspace' }, options), CiStepError);
  assert.throws(() => rewriteCaptureConfig({ ...config, roots: [] }, options), CiStepError);
});

test('파일 영향: JSON 선택을 검증하고 capture의 2단계 root 수집과 fileSymbols를 보존한다', () => {
  const files = [{ member: 'server', path: 'src/query.ts' }];
  const env = { ISTHMUS_CI_BEFORE: 'a.json', ISTHMUS_CI_AFTER: 'b.json', ISTHMUS_CI_TRACE_FILES: JSON.stringify(files) };
  assert.deepEqual(parseInputs(env).traceFiles, files);
  assert.equal(parseInputs({ ...env, ISTHMUS_CI_TRACE_FILES: '[]' }).traceFiles, undefined);
  for (const value of ['broken', '{}', '[1]', '["../private.ts"]', '["/outside.ts"]', '["a\\\\b.ts"]',
    '[{"member":"s","path":"a.ts","extra":true}]', '[{"member":"","path":"a.ts"}]',
    JSON.stringify(Array(1001).fill('a.ts'))]) {
    assert.throws(() => parseInputs({ ...env, ISTHMUS_CI_TRACE_FILES: value }), CiStepError);
  }
  const config = { format: 'isthmus-trace-capture', roots: { repo: '.' }, members: [] };
  assert.deepEqual(rewriteCaptureConfig(config, { repositoryPath: '/checkout', outputRoot: '/out', side: 'base', files }).selection,
    { files });
  const context = { format: 'isthmus-trace-context', documents: ['schema.json'], analyses: [],
    fileSymbols: [{ path: 'src/query.ts', platform: 'js', usrs: ['query'] }], selection: { routes: [] } };
  const retargeted = retargetTraceContext(context, '/ctx', [], files);
  assert.deepEqual(retargeted.selection, { files });
  assert.deepEqual(retargeted.fileSymbols, context.fileSymbols);
  assert.deepEqual(retargeted.documents, ['/ctx/schema.json']);
});

test('파일 영향: API 표면 변화가 없어도 실제 CLI로 페이지·액션까지 보고한다', () => withTemporaryDirectory((directory) => {
  const fixture = join(root, 'fixtures/trace');
  const context = JSON.parse(readFileSync(join(fixture, 'context.json'), 'utf8'));
  context.documents = context.documents.map((path) => join(fixture, path));
  context.analyses = context.analyses.map((reference) => ({ ...reference, path: join(fixture, reference.path) }));
  context.fileSymbols = [{ path: 'server/db/users.ts', platform: 'js', usrs: ['ts:repo/users.findById'] }];
  const reverse = JSON.parse(readFileSync(join(fixture, 'server-reverse.json'), 'utf8'));
  reverse.reached = ['page', 'server-action'].map((kind) => ({ symbol: { usr: `ts:entry/${kind}`, entries: [kind] },
    via: 'ts:repo/users.findById', depth: 1, roots: [1], evidence: 'bound' }));
  const reversePath = join(directory, 'reverse.json');
  writeFileSync(reversePath, JSON.stringify(reverse));
  context.analyses.find(({ id }) => id === 'server-reverse').path = reversePath;
  const contextPath = join(directory, 'context.json');
  writeFileSync(contextPath, JSON.stringify(context));
  const env = actionEnvironment(directory, { ISTHMUS_CI_BEFORE: 'fixtures/http-diff/surface/before.server.json',
    ISTHMUS_CI_AFTER: 'fixtures/http-diff/surface/before.server.json', ISTHMUS_CI_TRACE_CONTEXT: contextPath,
    ISTHMUS_CI_TRACE_FILES: '["server/db/users.ts"]', ISTHMUS_CI_FAIL_ON: '' });
  const result = runCiHttpImpact(env, { log: () => {} });
  assert.equal(result.failed, false, JSON.stringify(result.meta.errors));
  assert.equal(result.meta.trace.mode, 'files');
  const trace = JSON.parse(readFileSync(join(env.ISTHMUS_CI_OUTPUT_DIR, 'trace.json'), 'utf8'));
  assert.equal(trace.summary.entryPoints, 2);
  const comment = readFileSync(join(env.ISTHMUS_CI_OUTPUT_DIR, 'comment.md'), 'utf8');
  assert.match(comment, /server\/db\/users\.ts/);
  assert.match(comment, /Entry points/);
  assert.match(comment, /server-action/);
}));

test('capture 파일 모드는 양쪽 HTTP 문서를 보존하고 목록·fileSymbols·진입점까지 연결한다', () => withTemporaryDirectory((directory) => {
  const demo = makeDemoRepository(join(directory, 'repo'));
  const configPath = join(demo.path, '.isthmus/capture.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const listing = JSON.parse(readFileSync(join(root, 'scripts/fixtures/capture-trace/listing.tsograph-graph.json'), 'utf8'));
  listing.project = demo.path;
  const reversePath = join(demo.path, 'facts/server-reverse.json');
  const reverse = JSON.parse(readFileSync(reversePath, 'utf8'));
  reverse.reached.push({ symbol: { usr: 'ts:entry/Profile', entries: ['page'] },
    via: 'ts:repo/users.findById', depth: 1, roots: [1], evidence: 'bound' });
  reverse.reached.sort((a, b) => a.depth - b.depth || (a.symbol.usr < b.symbol.usr ? -1 : 1));
  writeFileSync(reversePath, JSON.stringify(reverse));
  writeFileSync(join(demo.path, 'facts/listing.json'), JSON.stringify(listing));
  config.members[0].listings = [{ platform: 'js', precomputed: { root: 'repo', path: 'facts/listing.json' } }];
  writeFileSync(configPath, JSON.stringify(config));
  git(demo.path, ['add', 'facts', '.isthmus']); git(demo.path, ['commit', '-qm', 'file capture setup']);
  const head = git(demo.path, ['rev-parse', 'HEAD']);
  const env = actionEnvironment(directory, { GITHUB_WORKSPACE: demo.path, ISTHMUS_CI_CAPTURE_CONFIG: '.isthmus/capture.json',
    ISTHMUS_CI_BASE_SHA: demo.head, ISTHMUS_CI_HEAD_SHA: head,
    ISTHMUS_CI_TRACE_FILES: '["server/db/users.ts"]', ISTHMUS_CI_FAIL_ON: '' });
  // 양쪽에 목록·진입점을 준비한 뒤 HTTP 추가만 head에 두어 파일 선택이 HTTP 문서를 줄이지 않는지 검증한다.
  const serverPath = join(demo.path, 'facts/server.http.json');
  const server = JSON.parse(readFileSync(serverPath, 'utf8'));
  server.facts.push({ ...server.facts[0], channel: '/api/additional', symbol: { qualifiedName: 'extra', usr: 'ts:extra' } });
  writeFileSync(serverPath, JSON.stringify(server));
  git(demo.path, ['add', 'facts/server.http.json']); git(demo.path, ['commit', '-qm', 'HTTP change']);
  env.ISTHMUS_CI_BASE_SHA = head; env.ISTHMUS_CI_HEAD_SHA = git(demo.path, ['rev-parse', 'HEAD']);
  const result = runCiHttpImpact(env, { log: () => {} });
  assert.deepEqual(result.meta.errors, []);
  assert.equal(result.meta.trace.mode, 'files');
  const diff = JSON.parse(readFileSync(join(env.ISTHMUS_CI_OUTPUT_DIR, 'diff.json'), 'utf8'));
  assert.ok(diff.summary.routesAdded > 0);
  for (const side of ['base', 'head']) {
    const capture = join(env.ISTHMUS_CI_OUTPUT_DIR, 'capture', side);
    const manifest = JSON.parse(readFileSync(join(capture, 'capture-manifest.json'), 'utf8'));
    assert.ok(manifest.fileSelection.some((entry) => entry.source === 'listing' && entry.symbols > 0));
    const context = JSON.parse(readFileSync(join(capture, 'trace-context.json'), 'utf8'));
    assert.ok(context.fileSymbols.some((entry) => entry.path === 'server/db/users.ts'));
    const source = JSON.parse(git(demo.path, ['show', `${side === 'base' ? head : env.ISTHMUS_CI_HEAD_SHA}:facts/server.http.json`]));
    const document = context.documents.find((path) => path.endsWith('/server.http.json'));
    assert.deepEqual(JSON.parse(readFileSync(join(capture, document), 'utf8')).facts, source.facts);
  }
  const trace = JSON.parse(readFileSync(join(env.ISTHMUS_CI_OUTPUT_DIR, 'trace.json'), 'utf8'));
  assert.equal(trace.chains[0].entryPoints[0].usr, 'ts:entry/Profile');
}));

test('workspace의 fileSymbols 경로는 context 디렉터리가 아닌 member 프로젝트 상대 신원이다', () => {
  const files = [{ member: 'server', path: 'src/query.ts' }];
  const context = { members: [{ name: 'server', documents: ['s/doc.json'], analyses: [{ path: 's/reverse.json' }] }],
    fileSymbols: [{ member: 'server', platform: 'js', path: 'src/query.ts', usrs: ['query'] }] };
  const moved = retargetTraceContext(context, '/artifacts', [], files);
  assert.deepEqual(moved.fileSymbols, context.fileSymbols);
  assert.equal(moved.members[0].documents[0], '/artifacts/s/doc.json');
  assert.equal(moved.members[0].analyses[0].path, '/artifacts/s/reverse.json');
});

test('changedRouteSelection: info를 빼고 중복을 합치며 scope 포함 여부와 상한을 지킨다', () => {
  const finding = (severity, method, template, scope = 's') => ({ severity, scope, route: { method, template, pathAnchor: 'root' } });
  const diff = { findings: [finding('info', 'GET', '/added'), finding('warning', 'GET', '/a'), finding('error', 'GET', '/a'),
    finding('warning', 'GET', '/a', 't'), { severity: 'warning', code: 'calls-dynamic' }, finding('warning', 'POST', '/b')] };
  assert.deepEqual(changedRouteSelection(diff, true).routes, [{ method: 'GET', template: '/a', scope: 's' },
    { method: 'GET', template: '/a', scope: 't' }, { method: 'POST', template: '/b', scope: 's' }]);
  assert.deepEqual(changedRouteSelection(diff, false).routes, [{ method: 'GET', template: '/a' }, { method: 'POST', template: '/b' }]);
  const many = { findings: Array.from({ length: MAX_TRACE_ROUTES + 5 }, (_, index) => finding('warning', 'GET', `/r/${index}`)) };
  const capped = changedRouteSelection(many, false);
  assert.equal(capped.routes.length, MAX_TRACE_ROUTES);
  assert.equal(capped.omitted, 5);
  assert.deepEqual(changedRouteSelection({}, false), { routes: [], omitted: 0 });
});

test('retargetTraceContext: 단일·workspace context의 상대 경로를 절대 경로로 바꾸고 fileSymbols를 뺀다', () => {
  const routes = [{ method: 'GET', template: '/x' }];
  const single = retargetTraceContext({ format: 'isthmus-trace-context', version: 1, project: '/p', documents: ['a.json', '/abs/b.json'],
    analyses: [{ id: 'f', path: 'f.json' }], selection: { files: ['x'] }, fileSymbols: [] }, '/ctx', routes);
  assert.deepEqual(single.documents, ['/ctx/a.json', '/abs/b.json']);
  assert.equal(single.analyses[0].path, '/ctx/f.json');
  assert.equal('fileSymbols' in single, false);
  assert.deepEqual(single.selection, { routes });
  const workspace = retargetTraceContext({ format: 'isthmus-trace-context', version: 1,
    members: [{ name: 's', documents: ['s/a.json'], analyses: [{ id: 'r', path: 's/r.json' }] }, { name: 'api', surface: { path: 'v/api.json', sha256: 'x' } }],
    links: [{ name: 'l', contract: { member: 's', documents: ['s/a.json'] } }, { name: 'm' }] }, '/ctx', routes);
  assert.deepEqual(workspace.members[0].documents, ['/ctx/s/a.json']);
  assert.equal(workspace.members[0].analyses[0].path, '/ctx/s/r.json');
  assert.equal(workspace.members[1].surface.path, '/ctx/v/api.json');
  assert.deepEqual(workspace.links[0].contract.documents, ['/ctx/s/a.json']);
  assert.deepEqual(workspace.links[1], { name: 'm' });
});

test('workspaceManifestFromContext: trace workspace context를 diff가 받는 매니페스트로 바꾼다', () => withTemporaryDirectory((directory) => {
  const contextPath = join(root, 'fixtures', 'trace-workspace', 'context.json');
  const manifest = workspaceManifestFromContext(JSON.parse(readFileSync(contextPath, 'utf8')));
  assert.equal(manifest.format, 'isthmus-workspace');
  assert.ok(manifest.members.every((member) => !('analyses' in member) && !('catalog' in member)));
  // 매니페스트의 상대 경로는 매니페스트 디렉터리 기준이라, 임시 디렉터리에 쓰기 전에 fixture 기준 절대 경로로 바꾼다.
  const fixtureDirectory = dirname(contextPath);
  const absolute = (paths) => paths.map((path) => resolve(fixtureDirectory, path));
  const located = { ...manifest, members: manifest.members.map((member) => ({ ...member, documents: absolute(member.documents) })),
    links: manifest.links.map((link) => ({ ...link, contract: { ...link.contract, documents: absolute(link.contract.documents) } })) };
  const path = join(directory, 'ci.workspace.json');
  writeFileSync(path, JSON.stringify(located));
  const result = runChild(process.execPath, [join(root, 'dist', 'cli', 'main.js'), 'diff', '--http', '--before', path, '--after', path]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).mode, 'workspace');
  assert.deepEqual(workspaceManifestFromContext({ members: [], libraries: [{ name: 'x' }] }).libraries, [{ name: 'x' }]);
}));

test('문서 분류: http diff 문서·선언 측·호출 측(BFF는 양쪽)', () => withTemporaryDirectory((directory) => {
  const documents = {
    'server.json': { target: 'http', roles: ['server'], facts: [] },
    'bff.json': { target: 'http', roles: ['server', 'client'], facts: [] },
    'client.json': { target: 'http', roles: ['client'], facts: [] },
    'spec.json': { target: null, platform: 'openapi', facts: [] },
    'decl-only.json': { target: 'http', facts: [{ kind: 'route-decl' }] },
    'db.json': { target: 'persistence', roles: ['client'], facts: [] },
  };
  for (const [name, document] of Object.entries(documents)) writeFileSync(join(directory, name), JSON.stringify(document));
  writeFileSync(join(directory, 'context.json'), JSON.stringify({ documents: Object.keys(documents) }));
  const { declarations, clients } = classifyContextDocuments(join(directory, 'context.json'));
  assert.deepEqual(declarations.map((path) => path.slice(directory.length + 1)), ['server.json', 'bff.json', 'spec.json', 'decl-only.json']);
  assert.deepEqual(clients.map((path) => path.slice(directory.length + 1)), ['bff.json', 'client.json']);
  assert.equal(isHttpDiffDocument({ target: null, platform: 'js' }), false);
  assert.equal(isDeclarationSide({ platform: 'kotlin', roles: ['client'] }), false);
}));

test('resolveBaseSha: 입력 SHA, PR 병합 commit의 첫째 부모, 이벤트 base 순이다', () => withTemporaryDirectory((directory) => {
  git(directory, ['init', '--quiet', '--initial-branch=main']);
  writeFileSync(join(directory, 'a'), '1');
  git(directory, ['add', '-A']);
  git(directory, ['commit', '--quiet', '-m', 'base']);
  const base = git(directory, ['rev-parse', 'HEAD']);
  git(directory, ['checkout', '--quiet', '-b', 'topic']);
  writeFileSync(join(directory, 'b'), '1');
  git(directory, ['add', '-A']);
  git(directory, ['commit', '--quiet', '-m', 'topic']);
  const prHead = git(directory, ['rev-parse', 'HEAD']);
  git(directory, ['checkout', '--quiet', 'main']);
  writeFileSync(join(directory, 'c'), '1');
  git(directory, ['add', '-A']);
  git(directory, ['commit', '--quiet', '-m', 'main moved']);
  const mainTip = git(directory, ['rev-parse', 'HEAD']);
  git(directory, ['merge', '--quiet', '--no-ff', '-m', 'merge', 'topic']);
  const merge = git(directory, ['rev-parse', 'HEAD']);
  const execute = (command, args, options) => runChild(command, args, options);
  const options = { repositoryPath: directory, headSha: merge, pullRequest: { number: 1, headSha: prHead }, eventBaseSha: base };
  assert.equal(resolveBaseSha(execute, options), mainTip);
  assert.equal(resolveBaseSha(execute, { ...options, baseSha: SHA_A }), SHA_A);
  assert.equal(resolveBaseSha(execute, { ...options, headSha: prHead }), base);
  assert.throws(() => resolveBaseSha(execute, { ...options, headSha: prHead, eventBaseSha: undefined }), CiStepError);
}));

test('자식 환경에서 워크플로 파일 명령 경로·토큰을 뺀다', () => {
  const env = childEnvironment({ PATH: '/bin', GITHUB_ENV: 'x', GITHUB_OUTPUT: 'x', GITHUB_PATH: 'x', GITHUB_STEP_SUMMARY: 'x',
    GITHUB_TOKEN: 't', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 't', ACTIONS_RUNTIME_TOKEN: 't', ISTHMUS_CI_GITHUB_TOKEN: 't', GITHUB_SHA: 's' });
  assert.deepEqual(env, { PATH: '/bin', GITHUB_SHA: 's' });
});

test('신뢰하지 않는 로그는 stop-commands로 감싸고, 출력 값의 줄바꿈은 쓰지 않는다', () => withTemporaryDirectory((directory) => {
  const lines = [];
  logUntrusted((line) => lines.push(line), 'label', '::add-mask::x\n::error::y');
  const [text] = lines;
  const token = /::stop-commands::([0-9a-f]{32})/u.exec(text)?.[1];
  assert.ok(token);
  assert.ok(text.indexOf('::add-mask::x') > text.indexOf(`::stop-commands::${token}`));
  assert.ok(text.trimEnd().endsWith(`::${token}::`));
  logUntrusted((line) => lines.push(line), 'label', '');
  assert.equal(lines.length, 1);
  const file = join(directory, 'out.txt');
  writeFileSync(file, '');
  writeActionOutputs(file, { good: 'v', bad: 'a\nb=c', missing: undefined, number: 3 });
  assert.equal(readFileSync(file, 'utf8'), 'good=v\nnumber=3\n');
  writeActionOutputs('', { ignored: 'x' });
}));

test('Node 최소 버전 검사', () => {
  requireNodeVersion('22.18.0');
  requireNodeVersion('24.0.0');
  assert.throws(() => requireNodeVersion('22.17.9'), CiStepError);
  assert.throws(() => requireNodeVersion('20.19.0'), CiStepError);
});
