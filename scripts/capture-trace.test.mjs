import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { captureTrace, CaptureTraceError } from './capture-trace.mjs';
import { runChild } from './run-child.mjs';

// 가짜 생산자(node 스크립트)가 합성 fixture를 내보낸다. Swift·JVM 없이 capture의 모든 단계를 실제 자식 실행으로 검사한다.
const repository = dirname(dirname(fileURLToPath(import.meta.url)));
const fake = join(repository, 'scripts/fixtures/capture-trace/fake-producer.mjs');
const isthmus = join(repository, 'dist/cli/main.js');
const fixture = (path) => ({ root: 'repo', path: `fixtures/${path}` });
const tool = (name) => ({ command: [process.execPath, fake, name] });
const baseTools = { tsograph: tool('tsograph'), schemagraph: tool('schemagraph'), kartograph: tool('kartograph') };

/** 전용 임시 디렉터리를 만들고 테스트 끝에 그 디렉터리만 지운다. */
async function workspace(t) {
  const work = await realpath(await mkdtemp(join(tmpdir(), 'isthmus-capture-trace-')));
  t.after(() => rm(work, { recursive: true, force: true }));
  return work;
}

/** fixture의 project를 바꿔 CI가 내려받은 사전 계산 artifact처럼 둔다. */
async function precomputedCopy(work, source, project, target) {
  const document = JSON.parse(await readFile(join(repository, 'fixtures', source), 'utf8'));
  const path = join(work, 'ci', target);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({ ...document, ...(document.format === 'change-impact' ? {} : { project }) }));
  return { root: 'work', path: `ci/${target}` };
}

/** 참조 context를 isthmus trace로 실행한 결과다. */
function referenceTrace(context) {
  const result = runChild(process.execPath, [isthmus, 'trace', join(repository, context)]);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

/** fixtures/trace(단일 project)를 capture 설정으로 옮긴다. */
async function singleProjectConfig(t, overrides = {}) {
  const work = await workspace(t);
  await mkdir(join(work, 'app'));
  const project = join(work, 'app');
  const androidFacts = await precomputedCopy(work, 'trace/android.http.json', project, 'android.http.json');
  const emit = (name) => ['emit', fixture(`trace/${name}`), '--project', '{project}'];
  const traverse = (name) => ['traverse', fixture(`trace/${name}`), '--project', '{project}'];
  const config = {
    format: 'isthmus-trace-capture', version: 1,
    roots: { work, repo: repository },
    output: { root: 'work', path: 'out' },
    generatedAt: '2026-09-27T00:00:00Z',
    tools: structuredClone(baseTools),
    members: [{
      name: 'app', project: { root: 'work', path: 'app' }, revision: 'rev-1',
      documents: [
        { name: 'server.http.json', tool: 'tsograph', args: emit('server.http.json') },
        { name: 'server.persistence.json', tool: 'tsograph', args: emit('server.persistence.json') },
        { name: 'db.sql.json', tool: 'schemagraph', args: emit('db.sql.json') },
        { name: 'android.http.json', precomputed: androidFacts },
      ],
      analyses: [
        { id: 'server-forward', platform: 'js', role: 'forward', tool: 'tsograph', args: traverse('server-forward.json'), roots: 'arguments' },
        { id: 'server-reverse', platform: 'js', role: 'reverse', tool: 'tsograph', args: traverse('server-reverse.json'), roots: 'separator' },
        { id: 'db', platform: 'sql', role: 'db-dependents', tool: 'schemagraph', args: traverse('db-dependents.json'), roots: 'arguments' },
        { id: 'android-reverse', platform: 'kotlin', role: 'reverse', tool: 'kartograph', args: traverse('android-reverse.json'), roots: 'roots-from' },
      ],
    }],
    selection: { routes: [{ method: 'GET', template: '/api/users/{}' }] },
    ...overrides,
  };
  return { work, project, config };
}

/** 인자 기록을 켠다. 자식은 부모 환경을 그대로 물려받는다. */
function recordArguments(t, work) {
  const log = join(work, 'argv.log');
  process.env.FAKE_PRODUCER_LOG = log;
  t.after(() => { delete process.env.FAKE_PRODUCER_LOG; });
  return async () => (await readFile(log, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
}

/** 실패가 원하는 단계에서 CaptureTraceError로 났는지 본다. */
async function rejectsAt(promise, step, pattern) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof CaptureTraceError, error.stack);
    assert.equal(error.step, step);
    if (pattern) assert.match(error.message, pattern);
    return true;
  });
}

test('단일 project: 사실·쌍·순회를 모아 참조 trace와 같은 체인을 만든다', async (t) => {
  const { work, project, config } = await singleProjectConfig(t);
  const calls = recordArguments(t, work);
  const result = await captureTrace(config);
  const out = join(work, 'out');
  assert.equal(result.output, out);

  const context = JSON.parse(await readFile(join(out, 'trace-context.json'), 'utf8'));
  assert.equal(context.project, project);
  assert.equal(context.revision, 'rev-1');
  assert.deepEqual(context.documents, ['app/documents/server.http.json', 'app/documents/server.persistence.json',
    'app/documents/db.sql.json', 'app/documents/android.http.json']);
  assert.deepEqual(context.analyses.map(({ id }) => id), ['server-forward', 'server-reverse', 'db', 'android-reverse']);

  const trace = JSON.parse(await readFile(join(out, 'trace.json'), 'utf8'));
  const reference = referenceTrace('fixtures/trace/context.json');
  assert.deepEqual(trace.chains, reference.chains);
  assert.deepEqual(trace.summary, reference.summary);
  assert.deepEqual(trace.gaps, []);
  assert.deepEqual(result.trace.gapCodes, {});

  // root는 사실에서 뽑은 선택 무관 상위 집합이고, 전달 방식마다 그대로 넘어간다.
  const argv = await calls();
  const traversal = (name, fixtureName) => argv.find((entry) => entry[0] === name && entry[1] === 'traverse' && entry[2].endsWith(fixtureName));
  assert.deepEqual(traversal('tsograph', 'server-forward.json').slice(5), ['ts:api/users.create', 'ts:api/users.get']);
  assert.deepEqual(traversal('tsograph', 'server-reverse.json').slice(5), ['--', 'ts:repo/audit.write', 'ts:repo/users.findById']);
  assert.deepEqual(traversal('schemagraph', 'db-dependents.json').slice(5), ['main.audit_log', 'main.users', 'main.users.email']);
  const android = traversal('kartograph', 'android-reverse.json');
  assert.deepEqual(android.slice(5, 6), ['--roots-from']);
  assert.deepEqual(JSON.parse(await readFile(android[6], 'utf8')), ['kt:UsersApi.create', 'kt:UsersApi.get']);

  const manifest = JSON.parse(await readFile(join(out, 'capture-manifest.json'), 'utf8'));
  assert.equal(manifest.status, 'complete');
  assert.deepEqual(Object.keys(manifest.tools), ['kartograph', 'schemagraph', 'tsograph']);
  assert.equal(manifest.tools.tsograph.version, 'tsograph 9.9.9');
  assert.deepEqual(manifest.members, [{ name: 'app', project, revision: 'rev-1', revisionSource: 'config' }]);
  for (const artifact of manifest.artifacts) {
    const bytes = await readFile(join(out, artifact.path));
    assert.equal(artifact.sha256, createHash('sha256').update(bytes).digest('hex'), artifact.path);
    assert.equal(artifact.bytes, bytes.length);
  }
  assert.equal(manifest.artifacts.find(({ path }) => path.endsWith('android.http.json')).source, 'precomputed');
  const pairs = manifest.steps.find(({ step }) => step === 'pairs:app');
  assert.deepEqual(pairs.pairs, { http: 2, persistence: 3 });
  assert.ok(existsSync(join(out, 'pairs/app.json')));
  assert.equal(manifest.steps.find(({ step }) => step === 'analysis:db').roots, 3);
});

test('인자는 셸을 거치지 않는다: 셸 메타 문자가 그대로 전달되고 실행되지 않는다', async (t) => {
  const { work, config } = await singleProjectConfig(t);
  const calls = recordArguments(t, work);
  const hostile = `$(touch ${join(work, 'pwned')}); touch ${join(work, 'pwned2')} | cat`;
  config.members[0].documents[0].args.push(hostile);
  await captureTrace({ ...config, trace: false });
  assert.equal(existsSync(join(work, 'pwned')), false);
  assert.equal(existsSync(join(work, 'pwned2')), false);
  assert.ok((await calls()).some((entry) => entry.includes(hostile)));
  assert.equal(existsSync(join(work, 'out/trace.json')), false);
});

/** fixtures/trace-workspace(분리된 두 저장소)를 capture 설정으로 옮긴다. */
async function workspaceCaptureConfig(t) {
  const work = await workspace(t);
  await mkdir(join(work, 'server'));
  await mkdir(join(work, 'client'));
  await writeFile(join(work, 'graph.json'), '{"synthetic":"graph"}');
  const client = join(work, 'client');
  const ios = await precomputedCopy(work, 'trace-workspace/client/ios-reverse.json', client, 'ios-reverse.json');
  const emit = (name) => ['emit', fixture(`trace-workspace/${name}`), '--project', '{project}'];
  const traverse = (name, extra = []) => ['traverse', fixture(`trace-workspace/${name}`), '--project', '{project}', ...extra];
  const config = {
    format: 'isthmus-trace-capture', version: 1, roots: { work, repo: repository },
    output: { root: 'work', path: 'capture/out' }, generatedAt: '2026-09-27T00:00:00Z', tools: structuredClone(baseTools),
    members: [
      { name: 'server', project: { root: 'work', path: 'server' }, revision: 'srv-7f3c2a1',
        catalog: { graph: { root: 'work', path: 'graph.json' }, source: 'server/migrations' },
        documents: [
          { name: 'server.http.json', tool: 'tsograph', args: emit('server/server.http.json') },
          { name: 'server.persistence.json', tool: 'tsograph', args: emit('server/server.persistence.json') },
          { name: 'db.sql.json', tool: 'schemagraph', args: emit('server/db.sql.json') },
        ],
        analyses: [
          { id: 'server-forward', platform: 'js', role: 'forward', tool: 'tsograph', args: traverse('server/server-forward.json'), roots: 'arguments' },
          { id: 'server-reverse', platform: 'js', role: 'reverse', tool: 'tsograph', args: traverse('server/server-reverse.json'), roots: 'arguments' },
          { id: 'server-db', platform: 'sql', role: 'db-dependents', tool: 'schemagraph',
            args: traverse('server/db-dependents.json', ['--graph', { root: 'work', path: 'graph.json' }]), roots: 'arguments' },
        ] },
      { name: 'server-spec', project: { root: 'work', path: 'server' }, revision: 'srv-7f3c2a1',
        documents: [{ name: 'api.openapi.json', tool: 'tsograph', args: emit('server/api.openapi.json') }] },
      { name: 'client', project: { root: 'work', path: 'client' }, revision: 'cli-41d9e0b',
        documents: [
          { name: 'android.http.json', tool: 'kartograph', args: emit('client/android.http.json') },
          { name: 'ios.http.json', precomputed: await precomputedCopy(work, 'trace-workspace/client/ios.http.json', client, 'ios.http.json') },
        ],
        analyses: [
          { id: 'android-reverse', platform: 'kotlin', role: 'reverse', tool: 'kartograph', args: traverse('client/android-reverse.json'), roots: 'roots-from' },
          { id: 'ios-reverse', platform: 'swift', role: 'reverse', precomputed: { path: ios, generatedAt: '2026-09-26T21:00:00Z' } },
        ] },
    ],
    links: [{ name: 'mobile->api', client: 'client', server: 'server',
      match: { hosts: ['api.example.com'], services: ['example-api'], baseRefs: [{ ref: 'kt:NetworkModule.baseUrl' }] },
      contract: { member: 'server-spec', documents: ['api.openapi.json'], authoritative: true } }],
    selection: { routes: [{ method: 'GET', template: '/api/orders/{}' }] },
  };
  return { work, config };
}

test('workspace: member별 사실·순회, 사전 계산 artifact의 sha256, catalog graphSha, contract 문서 경로를 context에 싣는다', async (t) => {
  const { work, config } = await workspaceCaptureConfig(t);
  await captureTrace(config);
  const out = join(work, 'capture/out');
  const context = JSON.parse(await readFile(join(out, 'trace-context.json'), 'utf8'));
  const graphSha = createHash('sha256').update('{"synthetic":"graph"}').digest('hex');
  assert.deepEqual(context.members[0].catalog, { graphSha, source: 'server/migrations' });
  assert.deepEqual(context.links[0].contract.documents, ['server-spec/documents/api.openapi.json']);
  const iosEntry = context.members[2].analyses.find(({ id }) => id === 'ios-reverse');
  const iosBytes = await readFile(join(work, 'ci/ios-reverse.json'));
  assert.deepEqual(iosEntry.precomputed, { sha256: createHash('sha256').update(iosBytes).digest('hex'),
    revision: 'cli-41d9e0b', generatedAt: '2026-09-26T21:00:00Z' });
  assert.equal(context.members[1].analyses, undefined);

  const trace = JSON.parse(await readFile(join(out, 'trace.json'), 'utf8'));
  const reference = referenceTrace('fixtures/trace-workspace/context.json');
  assert.deepEqual(trace.chains, reference.chains);
  assert.deepEqual(trace.summary, reference.summary);
  assert.deepEqual(trace.gaps, []);
  const manifest = JSON.parse(await readFile(join(out, 'capture-manifest.json'), 'utf8'));
  // 서버 member는 persistence 양쪽 측만 있어 그 문서만 check에 넘기고, 한쪽 측뿐인 member는 건너뛴다.
  const serverPairs = manifest.steps.find(({ step }) => step === 'pairs:server');
  assert.deepEqual(serverPairs.pairs, { http: 0, persistence: 2 });
  assert.deepEqual(serverPairs.command.slice(-2).map((path) => path.slice(out.length + 1)),
    ['server/documents/server.persistence.json', 'server/documents/db.sql.json']);
  for (const step of ['pairs:server-spec', 'pairs:client']) {
    assert.match(manifest.steps.find((entry) => entry.step === step).skipped, /both sides/u);
  }
});

test('옛 형식 사전 계산 artifact는 revision 증언을 요구하고, 있으면 attested로 싣는다', async (t) => {
  const { work, project, config } = await singleProjectConfig(t);
  const android = await precomputedCopy(work, 'trace/android-reverse.json', project, 'android-reverse.json');
  const legacy = await precomputedCopy(work, 'trace-workspace/client/ios-reverse.change-impact.json', project, 'ios.change-impact.json');
  config.members[0].analyses[3] = { id: 'android-reverse', platform: 'kotlin', role: 'reverse', precomputed: { path: android } };
  config.members[0].analyses.push({ id: 'ios', platform: 'swift', role: 'reverse', precomputed: { path: legacy } });
  await rejectsAt(captureTrace(config), 'analysis:ios', /precomputed\.revision/u);
  const manifest = JSON.parse(await readFile(join(work, 'out/capture-manifest.json'), 'utf8'));
  assert.equal(manifest.status, 'failed');
  assert.equal(manifest.failure.step, 'analysis:ios');

  config.output = { root: 'work', path: 'out2' };
  config.members[0].analyses[4].precomputed.revision = 'rev-1';
  await captureTrace(config);
  const context = JSON.parse(await readFile(join(work, 'out2/trace-context.json'), 'utf8'));
  assert.equal(context.analyses.find(({ id }) => id === 'android-reverse').precomputed.revision, 'rev-1');
  const trace = JSON.parse(await readFile(join(work, 'out2/trace.json'), 'utf8'));
  assert.equal(trace.analyses.find(({ id }) => id === 'ios').revisionSource, 'attested');
});

test('단계마다 실패하면 단계 이름과 명령을 밝히고 stderr는 logs/에만 남긴다', async (t) => {
  const cases = [
    ['version', (config) => { config.members[0].documents[0].tool = 'broken'; config.tools.broken = { command: [process.execPath, fake, 'broken', 'fail', '5'] }; },
      'version:broken', /broken --version exited with status 5; stderr saved/u],
    ['fact status', (config) => { config.members[0].documents[0].args = ['fail', '2']; }, 'fact:app/server.http.json',
      /tsograph fail exited with status 2; stderr saved to logs\/\d{3}-fact_app_server\.http\.json\.stderr\.txt/u],
    ['fact json', (config) => { config.members[0].documents[1].args = ['garbage']; }, 'fact:app/server.persistence.json',
      /did not print a JSON document/u],
    ['fact contract', (config) => { config.members[0].documents[2].args = ['emit', fixture('trace/server-forward.json'), '--project', '{project}']; },
      'fact:app/db.sql.json', /violates the bridge-facts contract/u],
    ['fact project', (config) => { config.members[0].documents[2].args = ['emit', fixture('trace/db.sql.json'), '--project', '/elsewhere']; },
      'fact:app/db.sql.json', /different project/u],
    ['traversal status', (config) => { config.members[0].analyses[0].args = ['fail', '64']; }, 'analysis:server-forward',
      /tsograph fail exited with status 64; stderr saved to logs\/\d{3}-analysis_server-forward\.stderr\.txt; it printed no traversal document\./u],
    ['traversal roots', (config) => { config.members[0].analyses[0].args = ['traverse', fixture('trace/server-reverse.json'), '--project', '{project}']; },
      'analysis:server-forward', /exited with status 3/u],
    ['traversal contract', (config) => { config.members[0].analyses[1].args = ['emit', fixture('trace/server-forward.json'), '--project', '{project}']; },
      'analysis:server-reverse', /violates the traversal contract: A reverse analysis must be a dependents traversal/u],
    ['traversal timeout', (config) => { Object.assign(config.members[0].analyses[2], { args: ['hang'], timeoutSeconds: 1 }); },
      'analysis:db', /schemagraph hang timed out after 1s/u],
    ['spawn', (config) => { config.tools.kartograph = { command: [join(repository, 'missing-producer')] }; }, 'version:kartograph',
      /could not be started/u],
  ];
  for (const [name, mutate, step, pattern] of cases) {
    await t.test(name, async (st) => {
      const { work, config } = await singleProjectConfig(st);
      mutate(config);
      await rejectsAt(captureTrace(config), step, pattern);
      const manifest = JSON.parse(await readFile(join(work, 'out/capture-manifest.json'), 'utf8'));
      assert.equal(manifest.failure.step, step);
      assert.doesNotMatch(manifest.failure.message, /fake producer failure detail/u);
      const logs = existsSync(join(work, 'out/logs')) ? await readdir(join(work, 'out/logs')) : [];
      if (name === 'fact status') {
        assert.match(await readFile(join(work, 'out/logs', logs[0]), 'utf8'), /fake producer failure detail/u);
      }
    });
  }
});

test('isthmus 단계(check --pairs, trace)의 실패도 단계 이름으로 보고한다', async (t) => {
  for (const [command, step] of [['check', 'pairs:app'], ['trace', 'trace']]) {
    await t.test(command, async (st) => {
      const { config } = await singleProjectConfig(st);
      const execute = (file, args, options) => (args[1] === command
        ? { status: 2, stdout: '', stderr: 'injected\n' } : runChild(file, args, options));
      await rejectsAt(captureTrace(config, { execute }), step, new RegExp(`isthmus ${command}`, 'u'));
    });
  }
});

test('설정 경로는 선언한 root 밖으로 나갈 수 없다', async (t) => {
  const cases = [
    ['dot-dot', (config) => { config.members[0].project = { root: 'work', path: '../app' }; }, 'config', /without \.\./u],
    ['absolute', (config) => { config.output = { root: 'work', path: '/tmp/out' }; }, 'config', /relative to its root/u],
    ['secret', (config) => { config.members[0].documents[3].precomputed = { root: 'work', path: 'app/.env' }; }, 'config', /secret-like/u],
    ['git config', (config) => { config.members[0].documents[3].precomputed = { root: 'work', path: 'app/.git/config' }; }, 'config', /secret-like/u],
    ['undeclared root', (config) => { config.output = { root: 'elsewhere', path: 'out' }; }, 'config', /undeclared root/u],
    ['relative root', (config) => { config.roots.extra = 'relative/dir'; }, 'config', /absolute POSIX/u],
    ['control', (config) => { config.members[0].documents[0].args.push('a\u0007b'); }, 'config', /control characters/u],
  ];
  for (const [name, mutate, step, pattern] of cases) {
    await t.test(name, async (st) => {
      const { config } = await singleProjectConfig(st);
      mutate(config);
      await rejectsAt(captureTrace(config), step, pattern);
    });
  }

  await t.test('symlink escape in an input path', async (st) => {
    const { work, config } = await singleProjectConfig(st);
    const outside = await realpath(await mkdtemp(join(tmpdir(), 'isthmus-capture-outside-')));
    st.after(() => rm(outside, { recursive: true, force: true }));
    await writeFile(join(outside, 'facts.json'), '{}');
    await symlink(join(outside, 'facts.json'), join(work, 'ci', 'link.json'));
    config.members[0].documents[3].precomputed = { root: 'work', path: 'ci/link.json' };
    await rejectsAt(captureTrace(config), 'fact:app/android.http.json', /resolves outside it through a symbolic link/u);
  });

  await t.test('symlink escape in the output path', async (st) => {
    const { work, config } = await singleProjectConfig(st);
    const outside = await realpath(await mkdtemp(join(tmpdir(), 'isthmus-capture-outside-')));
    st.after(() => rm(outside, { recursive: true, force: true }));
    await symlink(outside, join(work, 'escape'));
    config.output = { root: 'work', path: 'escape/out' };
    await rejectsAt(captureTrace(config), 'output', /outside root work/u);
    assert.deepEqual(await readdir(outside), []);
  });

  await t.test('dangling symlink in the output path', async (st) => {
    const { work, config } = await singleProjectConfig(st);
    await symlink(join(work, 'nowhere'), join(work, 'dangling'));
    config.output = { root: 'work', path: 'dangling/out' };
    await rejectsAt(captureTrace(config), 'output', /dangling symbolic link/u);
  });

  await t.test('precomputed path that is not a regular file (FIFO) fails without blocking', async (st) => {
    const { work, config } = await singleProjectConfig(st);
    assert.equal(runChild('mkfifo', [join(work, 'ci', 'pipe.json')]).status, 0);
    config.members[0].documents[3].precomputed = { root: 'work', path: 'ci/pipe.json' };
    await rejectsAt(captureTrace(config), 'fact:app/android.http.json', /not a regular file/u);
  });

  await t.test('non-empty output', async (st) => {
    const { work, config } = await singleProjectConfig(st);
    await mkdir(join(work, 'out'));
    await writeFile(join(work, 'out', 'keep.txt'), 'user file');
    await rejectsAt(captureTrace(config), 'output', /must not exist or must be empty/u);
    assert.equal(await readFile(join(work, 'out', 'keep.txt'), 'utf8'), 'user file');
  });

  await t.test('missing root', async (st) => {
    const { work, config } = await singleProjectConfig(st);
    config.roots.extra = join(work, 'missing');
    await rejectsAt(captureTrace(config), 'roots', /root extra does not exist/u);
  });

  await t.test('root id that looks like a flag', async (st) => {
    const { work, project, config } = await singleProjectConfig(st);
    const facts = JSON.parse(await readFile(join(repository, 'fixtures/trace/server.http.json'), 'utf8'));
    facts.facts[0].symbol.usr = '--delete-everything';
    await writeFile(join(work, 'ci', 'flag.http.json'), JSON.stringify({ ...facts, project }));
    config.members[0].documents[0] = { name: 'server.http.json', precomputed: { root: 'work', path: 'ci/flag.http.json' } };
    await rejectsAt(captureTrace(config), 'analysis:server-forward', /could be read as a producer flag/u);
  });
});

test('인자 상한을 넘는 root id는 그 분석 단계의 오류다', async (t) => {
  const { work, project, config } = await singleProjectConfig(t);
  const facts = JSON.parse(await readFile(join(repository, 'fixtures/trace/server.http.json'), 'utf8'));
  facts.facts[0].symbol.usr = `ts:${'x'.repeat(130 * 1024)}`;
  await writeFile(join(work, 'ci', 'long.http.json'), JSON.stringify({ ...facts, project }));
  config.members[0].documents[0] = { name: 'server.http.json', precomputed: { root: 'work', path: 'ci/long.http.json' } };
  await rejectsAt(captureTrace(config), 'analysis:server-forward', /per-run argument budget\. Use roots "roots-from"\./u);
});

test('root가 많으면 나눠 실행하고 같은 역할의 분석 여럿으로 싣는다', async (t) => {
  const { work, config } = await singleProjectConfig(t);
  const calls = recordArguments(t, work);
  // 가짜 생산자는 fixture root가 모두 넘어와야 받으므로, 첫 묶음(root 하나)에서 종료 코드 3으로 멈춘다 —
  // 나눈 id(`.1`)와 묶음의 root가 실제 인자에 나타나는지만 본다.
  config.members[0].analyses[0].maxRootsPerRun = 1;
  await rejectsAt(captureTrace(config), 'analysis:server-forward.1', /exited with status 3/u);
  const argv = await calls();
  assert.deepEqual(argv.filter((entry) => entry[1] === 'traverse' && entry[2].endsWith('server-forward.json')).map((entry) => entry.slice(5)),
    [['ts:api/users.create']]);
});

test('root가 하나도 없는 분석은 실행하지 않고 manifest에 이유를 남긴다', async (t) => {
  const { work, config } = await singleProjectConfig(t);
  config.members[0].analyses.push({ id: 'dart-reverse', platform: 'dart', role: 'reverse', tool: 'tsograph', args: ['fail', '9'], roots: 'arguments' });
  await captureTrace(config);
  const manifest = JSON.parse(await readFile(join(work, 'out/capture-manifest.json'), 'utf8'));
  assert.match(manifest.steps.find(({ step }) => step === 'analysis:dart-reverse').skipped, /no roots/u);
  const context = JSON.parse(await readFile(join(work, 'out/trace-context.json'), 'utf8'));
  assert.equal(context.analyses.some(({ id }) => id === 'dart-reverse'), false);
});

test('심볼 선택의 usr는 역방향 root에 더해지고 git revision은 manifest에 기록된다', async (t) => {
  const { work, project, config } = await singleProjectConfig(t);
  for (const args of [['init', '-q'], ['-c', 'user.email=a@example.invalid', '-c', 'user.name=a', 'commit', '-q', '--allow-empty', '-m', 'x']]) {
    assert.equal(runChild('git', ['-C', project, ...args]).status, 0);
  }
  const head = runChild('git', ['-C', project, 'rev-parse', 'HEAD']).stdout.trim();
  const calls = recordArguments(t, work);
  config.members[0].revision = { git: true };
  config.selection = { symbols: [{ platform: 'js', usr: 'ts:repo/users.findById' }, { platform: 'kotlin', usr: 'kt:Extra.symbol' }] };
  config.trace = false;
  // 선택한 kotlin 심볼은 android 역방향 root에 더해진다(가짜 생산자는 fixture root를 포함하면 받는다).
  await captureTrace(config);
  const manifest = JSON.parse(await readFile(join(work, 'out/capture-manifest.json'), 'utf8'));
  assert.deepEqual(manifest.members[0], { name: 'app', project, revision: head, revisionSource: 'git', dirty: false });
  const android = (await calls()).find((entry) => entry[0] === 'kartograph' && entry[1] === 'traverse');
  assert.deepEqual(JSON.parse(await readFile(android[6], 'utf8')), ['kt:Extra.symbol', 'kt:UsersApi.create', 'kt:UsersApi.get']);
  const context = JSON.parse(await readFile(join(work, 'out/trace-context.json'), 'utf8'));
  assert.equal(context.revision, head);
});

test('CLI는 사용법·설정 오류를 종료 코드 2와 단계 문구로 알린다', async (t) => {
  const script = join(repository, 'scripts/capture-trace.mjs');
  const usage = runChild(process.execPath, [script]);
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /Usage: node scripts\/capture-trace\.mjs <capture\.json>/u);
  const work = await workspace(t);
  await writeFile(join(work, 'bad.json'), '{"format":"isthmus-trace-capture","version":2}');
  const bad = runChild(process.execPath, [script, join(work, 'bad.json')]);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /Capture step config failed: Expected isthmus-trace-capture version 1\./u);
  const missing = runChild(process.execPath, [script, join(work, 'missing.json')]);
  assert.match(missing.stderr, /the capture config could not be read/u);

  const { config } = await singleProjectConfig(t);
  await writeFile(join(work, 'good.json'), JSON.stringify(config));
  const good = runChild(process.execPath, [script, join(work, 'good.json')]);
  assert.equal(good.status, 0, good.stderr);
  assert.deepEqual(JSON.parse(good.stdout).trace.gapCodes, {});
});

/** 2단계 수집 fixture(scripts/fixtures/capture-trace/) 경로 참조다. */
const stageFixture = (name) => ({ root: 'repo', path: `scripts/fixtures/capture-trace/${name}` });
/** 사실이 없는 헬퍼 파일이다. 헬퍼 users.load는 GET 핸들러가 부른다. */
const helperFile = 'server/service/users.ts';

/** 헬퍼 파일을 고른 단일 project 설정이다. 역방향 순회는 헬퍼까지 root로 받아야 하는 fixture를 쓴다. */
async function fileSelectionConfig(t) {
  const setup = await singleProjectConfig(t);
  const [member] = setup.config.members;
  setup.config.selection = { files: [helperFile] };
  member.analyses[1].args = ['traverse', stageFixture('server-reverse-files.json'), '--project', '{project}'];
  return setup;
}

test('파일 선택 2단계: 생산자 목록의 파일 심볼을 역방향 root에 더하고 context fileSymbols로 싣는다', async (t) => {
  const { work, config } = await fileSelectionConfig(t);
  config.members[0].listings = [{ platform: 'js', tool: 'tsograph',
    args: ['emit', stageFixture('listing.tsograph-graph.json'), '--project', '{project}'] }];
  const calls = recordArguments(t, work);
  await captureTrace(config);
  const out = join(work, 'out');
  const context = JSON.parse(await readFile(join(out, 'trace-context.json'), 'utf8'));
  assert.deepEqual(context.fileSymbols, [{ path: helperFile, platform: 'js', usrs: ['ts:service/users.load'] }]);
  // context의 분석 순서는 실행 순서(역방향이 나중)가 아니라 설정 순서다.
  assert.deepEqual(context.analyses.map(({ id }) => id), ['server-forward', 'server-reverse', 'db', 'android-reverse']);
  const reverse = (await calls()).find((entry) => entry[1] === 'traverse' && entry[2].endsWith('server-reverse-files.json'));
  assert.deepEqual(reverse.slice(5), ['--', 'ts:repo/audit.write', 'ts:repo/users.findById', 'ts:service/users.load']);

  const trace = JSON.parse(await readFile(join(out, 'trace.json'), 'utf8'));
  const codes = trace.gaps.map(({ code }) => code);
  for (const code of ['file-selection-fact-fallback', 'file-without-symbols', 'analysis-missing']) assert.equal(codes.includes(code), false, code);
  assert.deepEqual(trace.chains[0].routes.map(({ method, template }) => [method, template]), [['GET', '/api/users/{}']]);
  assert.match(trace.notices[0].detail, /1 more listed in fileSymbols/u);

  const manifest = JSON.parse(await readFile(join(out, 'capture-manifest.json'), 'utf8'));
  const order = (name) => manifest.steps.findIndex(({ step }) => step === name);
  assert.ok(order('analysis:server-forward') < order('listing:app/js'));
  assert.ok(order('listing:app/js') < order('analysis:server-reverse'));
  assert.deepEqual(manifest.fileSelection.find(({ platform }) => platform === 'js'), { platform: 'js', files: 1, source: 'listing',
    listing: 'tsograph-graph', complete: true, skipped: 0, symbols: 1, reverseRoots: 1 });
  const kotlin = manifest.fileSelection.find(({ platform }) => platform === 'kotlin');
  assert.equal(kotlin.source, 'traversal');
  assert.equal(kotlin.complete, false);
  assert.match(kotlin.notes[0], /No symbol listing for this platform/u);
  assert.equal(manifest.artifacts.find(({ path }) => path === 'app/listings/js.json').source, 'captured');
});

test('파일 선택 2단계: 목록이 없으면 1단계 순회가 위치시킨 파일 심볼을 root에 더하고 불완전하다고 적는다', async (t) => {
  const { work, config } = await fileSelectionConfig(t);
  config.members[0].analyses[0].args = ['traverse', stageFixture('server-forward-located.json'), '--project', '{project}'];
  await captureTrace(config);
  const context = JSON.parse(await readFile(join(work, 'out/trace-context.json'), 'utf8'));
  // 순회가 이미 위치를 실었으므로 fileSymbols는 쓰지 않는다(trace가 분석 위치로 본다).
  assert.equal('fileSymbols' in context, false);
  const trace = JSON.parse(await readFile(join(work, 'out/trace.json'), 'utf8'));
  assert.equal(trace.gaps.some(({ code }) => ['file-selection-fact-fallback', 'analysis-missing'].includes(code)), false);
  assert.deepEqual(trace.chains[0].routes.map(({ template }) => template), ['/api/users/{}']);
  const manifest = JSON.parse(await readFile(join(work, 'out/capture-manifest.json'), 'utf8'));
  const js = manifest.fileSelection.find(({ platform }) => platform === 'js');
  assert.deepEqual({ ...js, notes: undefined }, { platform: 'js', files: 1, source: 'traversal', complete: false, symbols: 1,
    reverseRoots: 1, notes: undefined });
});

test('파일 선택 2단계: 찾은 심볼이 없으면 fallback을 그대로 두고, 다시 돌릴 역방향이 없으면 그렇다고 적는다', async (t) => {
  await t.test('심볼 없음', async (st) => {
    const { work, config } = await singleProjectConfig(st);
    config.selection = { files: [helperFile] };
    await captureTrace(config);
    const trace = JSON.parse(await readFile(join(work, 'out/trace.json'), 'utf8'));
    assert.deepEqual(trace.gaps.map(({ code }) => code), ['file-without-symbols']);
    const manifest = JSON.parse(await readFile(join(work, 'out/capture-manifest.json'), 'utf8'));
    assert.deepEqual(manifest.fileSelection.map(({ platform, symbols, reverseRoots }) => [platform, symbols, reverseRoots]),
      [['js', 0, 0], ['kotlin', 0, 0]]);
  });
  await t.test('사전 계산 역방향뿐', async (st) => {
    const { work, project, config } = await fileSelectionConfig(st);
    config.members[0].listings = [{ platform: 'js', tool: 'tsograph',
      args: ['emit', stageFixture('listing.tsograph-graph.json'), '--project', '{project}'] }];
    const reverse = await precomputedCopy(work, 'trace/server-reverse.json', project, 'server-reverse.json');
    config.members[0].analyses[1] = { id: 'server-reverse', platform: 'js', role: 'reverse', precomputed: { path: reverse } };
    await captureTrace(config);
    const manifest = JSON.parse(await readFile(join(work, 'out/capture-manifest.json'), 'utf8'));
    const js = manifest.fileSelection.find(({ platform }) => platform === 'js');
    assert.equal(js.reverseRoots, 0);
    assert.match(js.notes[0], /No reverse analysis with a producer command/u);
    const trace = JSON.parse(await readFile(join(work, 'out/trace.json'), 'utf8'));
    assert.ok(trace.gaps.some(({ code }) => code === 'analysis-missing'));
  });
});

test('심볼 목록은 파일 선택에서만 실행하고, 잘못된 목록은 그 단계의 오류다', async (t) => {
  await t.test('파일 선택이 아니면 건너뛴다', async (st) => {
    const { work, config } = await singleProjectConfig(st);
    const calls = recordArguments(st, work);
    config.members[0].listings = [{ platform: 'js', tool: 'tsograph', args: ['fail', '9'] }];
    await captureTrace({ ...config, trace: false });
    const manifest = JSON.parse(await readFile(join(work, 'out/capture-manifest.json'), 'utf8'));
    assert.match(manifest.steps.find(({ step }) => step === 'listing:app/js').skipped, /only by a files selection/u);
    assert.equal(manifest.fileSelection, undefined);
    assert.equal((await calls()).some((entry) => entry[1] === 'fail'), false);
  });
  const cases = [
    ['다른 project', ['emit', stageFixture('listing.tsograph-graph.json'), '--project', '/elsewhere'], /different project/u],
    ['모르는 형식', ['emit', fixture('trace/server.http.json'), '--project', '{project}'], /Unsupported symbol listing/u],
    ['JSON 아님', ['garbage'], /did not print a JSON document/u],
  ];
  for (const [name, args, pattern] of cases) {
    await t.test(name, async (st) => {
      const { config } = await fileSelectionConfig(st);
      config.members[0].listings = [{ platform: 'js', tool: 'tsograph', args }];
      await rejectsAt(captureTrace(config), 'listing:app/js', pattern);
    });
  }
  await t.test('파일 심볼이 fileSymbols 상한을 넘으면 역방향 순회 전에 목록 단계에서 멈춘다', async (st) => {
    const { work, project, config } = await fileSelectionConfig(st);
    const nodes = Array.from({ length: 10_001 }, (_, index) => ({ id: `ts:gen/${index}`, location: { path: helperFile, line: 1, column: 1 } }));
    await writeFile(join(work, 'ci', 'big.json'), JSON.stringify({ format: 'tsograph-graph', version: 1, project, nodes }));
    config.members[0].listings = [{ platform: 'js', precomputed: { root: 'work', path: 'ci/big.json' } }];
    await rejectsAt(captureTrace(config), 'listing:app/js', /10001 listed symbols, above the fileSymbols limit of 10000/u);
    const manifest = JSON.parse(await readFile(join(work, 'out/capture-manifest.json'), 'utf8'));
    assert.equal(manifest.steps.some(({ step }) => step === 'analysis:server-reverse'), false);
  });
  await t.test('사전 계산 목록', async (st) => {
    const { work, project, config } = await fileSelectionConfig(st);
    const listing = JSON.parse(await readFile(join(repository, 'scripts/fixtures/capture-trace/listing.tsograph-graph.json'), 'utf8'));
    await writeFile(join(work, 'ci', 'listing.json'), JSON.stringify({ ...listing, project }));
    config.members[0].listings = [{ platform: 'js', precomputed: { root: 'work', path: 'ci/listing.json' } }];
    await captureTrace(config);
    const manifest = JSON.parse(await readFile(join(work, 'out/capture-manifest.json'), 'utf8'));
    assert.equal(manifest.artifacts.find(({ path }) => path === 'app/listings/js.json').source, 'precomputed');
  });
  await t.test('사전 계산 목록 digest-only는 파일을 복사하지 않고 같은 선택과 SHA-256을 남긴다', async (st) => {
    const { work, project, config } = await fileSelectionConfig(st);
    const listing = JSON.parse(await readFile(join(repository, 'scripts/fixtures/capture-trace/listing.tsograph-graph.json'), 'utf8'));
    const content = JSON.stringify({ ...listing, project });
    await writeFile(join(work, 'ci', 'listing.json'), content);
    config.members[0].listings = [{ platform: 'js', precomputed: { root: 'work', path: 'ci/listing.json' }, artifact: 'digest-only' }];
    await captureTrace(config);
    const manifest = JSON.parse(await readFile(join(work, 'out/capture-manifest.json'), 'utf8'));
    assert.equal(existsSync(join(work, 'out/app/listings/js.json')), false);
    assert.equal(manifest.artifacts.some(({ path }) => path === 'app/listings/js.json'), false);
    assert.deepEqual(manifest.listingInputs, [{ member: 'app', platform: 'js', source: 'precomputed',
      sha256: createHash('sha256').update(content).digest('hex'), bytes: Buffer.byteLength(content), tool: listing.tool }]);
    assert.ok(manifest.steps.some(({ step }) => step === 'analysis:server-reverse'));
  });
});

test('workspace 파일 선택: 선택한 파일이 없는 member의 목록은 실행하지 않고 그 이유를 적는다', async (t) => {
  const { work, config } = await workspaceCaptureConfig(t);
  const calls = recordArguments(t, work);
  config.tools.lister = { command: [process.execPath, fake, 'lister'] };
  config.members[2].listings = [{ platform: 'kotlin', tool: 'lister', args: ['fail', '9'] }];
  config.selection = { files: [{ member: 'server', path: 'src/db/orders.ts' }] };
  await captureTrace({ ...config, trace: false });
  const manifest = JSON.parse(await readFile(join(work, 'capture/out/capture-manifest.json'), 'utf8'));
  assert.equal(manifest.tools.lister, undefined);
  assert.equal((await calls()).some((entry) => entry[0] === 'lister'), false);
  assert.match(manifest.steps.find(({ step }) => step === 'listing:client/kotlin').skipped, /selects no file of this member/u);
  assert.deepEqual(manifest.fileSelection.map(({ member, platform }) => [member, platform]), [['server', 'js']]);
});

/**
 * tsograph `schema`처럼 선언 쪽 relation-use(`#model:`·`#typedsql:`)를 섞은 persistence 문서를 사전 계산 파일로 둔다.
 * `extraUses`는 코드 쪽 사용 usr다. 채널은 db.sql.json이 선언한 users·users.email이라 check --pairs가 그대로 선다.
 */
async function schemaFactsCopy(work, project, { tool = 'tsograph', extraUses = [] } = {}) {
  const document = JSON.parse(await readFile(join(repository, 'fixtures/trace/server.persistence.json'), 'utf8'));
  const use = (usr, path, extra = {}) => ({ kind: 'relation-use', channel: 'users', dynamic: false,
    location: { path, line: 1, column: 1 }, symbol: { qualifiedName: usr, usr }, ...extra });
  document.facts.push(
    use('prisma/schema.prisma#model:User', 'prisma/schema.prisma'),
    use('prisma/schema.prisma#model:User.email', 'prisma/schema.prisma', { method: 'email' }),
    use('prisma/sql/byEmail.sql#typedsql:byEmail', 'prisma/sql/byEmail.sql'),
    ...extraUses.map((usr) => use(usr, 'server/db/extra.ts')),
  );
  await writeFile(join(work, 'ci', 'schema.persistence.json'), JSON.stringify({ ...document, project, tool: { name: tool, version: '0.1.0' } }));
  return { name: 'server.persistence.json', precomputed: { root: 'work', path: 'ci/schema.persistence.json' } };
}

test('root 위생: 생산자가 밝힌 선언 이름공간 relation-use는 역방향 root로 넘기지 않고 manifest에 센다', async (t) => {
  const { work, project, config } = await singleProjectConfig(t);
  config.members[0].documents[1] = await schemaFactsCopy(work, project);
  const calls = recordArguments(t, work);
  const result = await captureTrace(config);
  const reverse = (await calls()).find((entry) => entry[1] === 'traverse' && entry[2].endsWith('server-reverse.json'));
  assert.deepEqual(reverse.slice(5), ['--', 'ts:repo/audit.write', 'ts:repo/users.findById']);
  const manifest = JSON.parse(await readFile(join(work, 'out/capture-manifest.json'), 'utf8'));
  assert.deepEqual(manifest.rootFilters, [{ analysis: 'server-reverse', platform: 'js', role: 'reverse', declarationNamespace: 3 }]);
  // 노드가 아님을 이미 아는 id라 경고하지 않는다. trace는 어느 순회에도 없는 id를 닿지 않음으로 읽는다.
  assert.equal(manifest.warnings, undefined);
  assert.equal(result.warnings, undefined);
  const trace = JSON.parse(await readFile(join(work, 'out/trace.json'), 'utf8'));
  assert.deepEqual(trace.chains, referenceTrace('fixtures/trace/context.json').chains);
});

test('root 위생: 파일 선택에서 받은 생산자 목록에 없는 사실 usr는 root로 넘기지 않고 경고한다', async (t) => {
  const { work, project, config } = await fileSelectionConfig(t);
  config.members[0].documents[1] = await schemaFactsCopy(work, project, { tool: 'synthetic-trace', extraUses: ['ts:repo/orphan'] });
  config.members[0].listings = [{ platform: 'js', tool: 'tsograph',
    args: ['emit', stageFixture('listing.tsograph-graph.json'), '--project', '{project}'] }];
  const calls = recordArguments(t, work);
  const result = await captureTrace(config);
  const reverse = (await calls()).find((entry) => entry[1] === 'traverse' && entry[2].endsWith('server-reverse-files.json'));
  // 다른 생산자 문서라 선언 이름공간 표식은 쓰지 않지만, 목록(그래프 노드 전체)에 없어 모두 빠진다.
  assert.deepEqual(reverse.slice(5), ['--', 'ts:repo/audit.write', 'ts:repo/users.findById', 'ts:service/users.load']);
  const manifest = JSON.parse(await readFile(join(work, 'out/capture-manifest.json'), 'utf8'));
  assert.deepEqual(manifest.rootFilters, [{ analysis: 'server-reverse', platform: 'js', role: 'reverse', declarationNamespace: 0,
    notInListing: ['prisma/schema.prisma#model:User', 'prisma/schema.prisma#model:User.email',
      'prisma/sql/byEmail.sql#typedsql:byEmail', 'ts:repo/orphan'] }]);
  assert.deepEqual(manifest.warnings.map(({ step, code, roots }) => [step, code, roots]),
    [['analysis:server-reverse', 'roots-not-in-listing', 4]]);
  assert.deepEqual(result.warnings, manifest.warnings);
});

/** 역방향 순회가 모르는 root 하나를 root-not-found로 돌려주게 한다(심볼 선택으로 그 id를 root에 넣는다). */
function unknownRootConfig(config, extra) {
  config.selection = { symbols: [{ platform: 'js', usr: 'ts:ghost/symbol' }] };
  config.members[0].analyses[1].args.push(...extra);
}

test('종료 코드 64: root-not-found를 기록한 순회 문서는 부분 성공으로 받고 manifest·trace에 드러낸다', async (t) => {
  const { work, config } = await singleProjectConfig(t);
  unknownRootConfig(config, ['--unknown', 'ts:ghost/symbol', '--exit', '64']);
  const result = await captureTrace(config);
  const manifest = JSON.parse(await readFile(join(work, 'out/capture-manifest.json'), 'utf8'));
  assert.equal(manifest.status, 'complete');
  const step = manifest.steps.find(({ step: name }) => name === 'analysis:server-reverse');
  assert.equal(step.exitCode, 64);
  assert.deepEqual(step.rootsNotFound, ['ts:ghost/symbol']);
  assert.equal(step.acceptedPartial, 'root-not-found');
  assert.deepEqual(manifest.warnings.map(({ step: name, code, roots }) => [name, code, roots]),
    [['analysis:server-reverse', 'root-not-found', 1]]);
  assert.deepEqual(result.warnings, manifest.warnings);
  const trace = JSON.parse(await readFile(join(work, 'out/trace.json'), 'utf8'));
  assert.ok(trace.analysisLimitations.some(({ analysis, message }) => analysis === 'server-reverse' && /^root-not-found:/u.test(message)));
  // 못 찾은 root는 trace에서 그 심볼의 analysis-root-not-found gap으로 보인다(trace는 symbol 있는 root만 잇는다).
  assert.ok(trace.gaps.some(({ code, symbol }) => code === 'analysis-root-not-found' && symbol?.usr === 'ts:ghost/symbol'));
  assert.equal(result.trace.gapCodes['analysis-root-not-found'], 1);
  // 찾은 root의 hop은 root-not-found 때문에 잘린 것으로 보지 않는다.
  assert.equal(result.trace.gapCodes['analysis-truncated'], undefined);

  // CLI는 같은 경고를 stderr에 한 줄로 알리고 성공(0)으로 끝난다.
  config.output = { root: 'work', path: 'out-cli' };
  await writeFile(join(work, 'partial.json'), JSON.stringify(config));
  const cli = runChild(process.execPath, [join(repository, 'scripts/capture-trace.mjs'), join(work, 'partial.json')]);
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stderr, /Capture warning \(analysis:server-reverse, root-not-found\)/u);
});

test('종료 코드 64: 문서가 없거나 root-not-found를 기록하지 않으면 이전처럼 실패하고, 설정이 받은 64도 기록한다', async (t) => {
  await t.test('root-not-found 기록 없음', async (st) => {
    const { config } = await singleProjectConfig(st);
    config.members[0].analyses[1].args.push('--exit', '64');
    await rejectsAt(captureTrace(config), 'analysis:server-reverse',
      /tsograph traverse exited with status 64; its document records no root-not-found root among the roots it was given\./u);
  });
  await t.test('계약 위반 문서', async (st) => {
    const { config } = await singleProjectConfig(st);
    config.members[0].analyses[1].args = ['emit', fixture('trace/server-forward.json'), '--project', '{project}', '--exit', '64'];
    await rejectsAt(captureTrace(config), 'analysis:server-reverse', /exited with status 64; its output violates the traversal contract/u);
  });
  await t.test('넘기지 않은 id를 못 찾았다는 문서(계약 위반)', async (st) => {
    const { config } = await singleProjectConfig(st);
    unknownRootConfig(config, ['--unknown', 'ts:ghost/symbol', '--phantom', 'ts:never/passed', '--exit', '64']);
    await rejectsAt(captureTrace(config), 'analysis:server-reverse',
      /exited with status 64; its document reports 1 root-not-found id\(s\) that were never passed as roots/u);
  });
  await t.test('종료 코드 0의 계약 위반은 받되 경고한다', async (st) => {
    const { work, config } = await singleProjectConfig(st);
    config.members[0].analyses[1].args.push('--phantom', 'ts:never/passed');
    await captureTrace({ ...config, trace: false });
    const manifest = JSON.parse(await readFile(join(work, 'out/capture-manifest.json'), 'utf8'));
    const step = manifest.steps.find(({ step: name }) => name === 'analysis:server-reverse');
    assert.equal(step.rootsNotFound, undefined);
    assert.deepEqual(step.rootsNotFoundUnrequested, ['ts:never/passed']);
    assert.match(manifest.warnings[0].detail, /never passed as roots/u);
  });
  await t.test('acceptExitCodes에 64를 둔 설정', async (st) => {
    const { work, config } = await singleProjectConfig(st);
    unknownRootConfig(config, ['--unknown', 'ts:ghost/symbol', '--exit', '64']);
    config.members[0].analyses[1].acceptExitCodes = [0, 64];
    await captureTrace({ ...config, trace: false });
    const manifest = JSON.parse(await readFile(join(work, 'out/capture-manifest.json'), 'utf8'));
    const step = manifest.steps.find(({ step: name }) => name === 'analysis:server-reverse');
    assert.deepEqual(step.rootsNotFound, ['ts:ghost/symbol']);
    assert.equal(step.acceptedPartial, undefined);
    assert.equal(manifest.warnings[0].code, 'root-not-found');
  });
  await t.test('종료 코드 0이어도 root-not-found는 경고한다', async (st) => {
    const { work, config } = await singleProjectConfig(st);
    unknownRootConfig(config, ['--unknown', 'ts:ghost/symbol']);
    await captureTrace({ ...config, trace: false });
    const manifest = JSON.parse(await readFile(join(work, 'out/capture-manifest.json'), 'utf8'));
    assert.deepEqual(manifest.steps.find(({ step: name }) => name === 'analysis:server-reverse').rootsNotFound, ['ts:ghost/symbol']);
  });
});

/** 가져온 surface fixture의 파일 sha256이다(fixtures/trace-library/context.json이 고정한 값). */
const surfaceSha256 = '6ad0a3bbfc35ef56bccb0b745c9d5e2ea0057a76cb393a2f0ce69060f14ff183';
const sdkOrder = 'kt:com.example.sdk.OrdersSdk#order(String)';
const sdkPlaceOrder = 'kt:com.example.sdk.OrdersSdk#placeOrder(Order)';

/**
 * fixtures/trace-library(surface로 가져온 API, SDK provider, shared·symbol-map consumer 앱 둘)를 capture 설정으로 옮긴다.
 * app-b의 대응표는 root 아래 JSON 파일로 준다(파일 참조 경로 검사).
 */
async function libraryCaptureConfig(t) {
  const work = await workspace(t);
  for (const name of ['sdk', 'app-a', 'app-b']) await mkdir(join(work, name));
  await writeFile(join(work, 'app-b.symbol-map.json'), JSON.stringify([
    { provider: sdkOrder, consumer: 'kt:shaded.orders.OrdersSdk#order(String)' },
    { provider: sdkPlaceOrder, consumer: 'kt:shaded.orders.OrdersSdk#placeOrder(Order)' },
  ]));
  const traverse = (name, extra = []) => ['traverse', fixture(`trace-library/${name}`), '--project', '{project}', ...extra];
  const reverse = (id, name, roots) => ({ id, platform: 'kotlin', role: 'reverse', tool: 'kartograph', args: traverse(name), roots });
  const config = {
    format: 'isthmus-trace-capture', version: 1, roots: { work, repo: repository },
    output: { root: 'work', path: 'out' }, generatedAt: '2026-09-30T00:00:00Z', tools: { kartograph: tool('kartograph') },
    members: [
      { name: 'api', surface: { path: fixture('http-surface/surfaces/example-api-2.4.surface.json'), sha256: surfaceSha256 } },
      { name: 'sdk', project: { root: 'work', path: 'sdk' }, revision: 'sdk-1.8.0',
        documents: [{ name: 'sdk.http.json', tool: 'kartograph', args: ['emit', fixture('trace-library/sdk/sdk.http.json'), '--project', '{project}'] }],
        analyses: [reverse('sdk-reverse', 'sdk/sdk-reverse.json', 'roots-from')] },
      { name: 'app-a', project: { root: 'work', path: 'app-a' }, revision: 'a-5.0.0', documents: [],
        analyses: [reverse('app-a-reverse', 'app-a/app-a-reverse.json', 'roots-from')] },
      { name: 'app-b', project: { root: 'work', path: 'app-b' }, revision: 'b-2.1.0', documents: [],
        analyses: [reverse('app-b-reverse', 'app-b/app-b-reverse.json', 'separator')] },
    ],
    links: [{ name: 'sdk->api', client: 'sdk', server: 'api', match: { hosts: ['api.example.com'] } }],
    libraries: [
      { name: 'app-a<-sdk', consumer: 'app-a', provider: 'sdk', ids: 'shared', publicSymbols: [sdkOrder, sdkPlaceOrder] },
      { name: 'app-b<-sdk', consumer: 'app-b', provider: 'sdk', ids: 'symbol-map', symbolMap: { root: 'work', path: 'app-b.symbol-map.json' } },
    ],
    selection: { routes: [{ method: 'GET', template: '/api/orders/{}' }, { method: 'POST', template: '/api/orders' }] },
  };
  return { work, config };
}

/** 출력의 JSON 파일 하나를 읽는다. */
async function readOutput(work, path, out = 'out') {
  return JSON.parse(await readFile(join(work, out, path), 'utf8'));
}

test('library·surface 가져오기: provider 도달에서 옮긴 SDK id로 consumer를 root하고 참조 trace와 같은 체인을 만든다', async (t) => {
  const { work, config } = await libraryCaptureConfig(t);
  const calls = recordArguments(t, work);
  const result = await captureTrace(config);
  assert.equal(result.warnings, undefined);
  const context = await readOutput(work, 'trace-context.json');
  assert.deepEqual(context.members.map(({ name }) => name), ['api', 'sdk', 'app-a', 'app-b']);
  assert.deepEqual(context.members[0], { name: 'api', surface: { path: 'api/http-surface.json', sha256: surfaceSha256 } });
  assert.deepEqual(context.members[2].documents, []);
  assert.deepEqual(context.libraries[0], { name: 'app-a<-sdk', consumer: 'app-a', provider: 'sdk', ids: 'shared',
    publicSymbols: [sdkOrder, sdkPlaceOrder] });
  assert.equal(context.libraries[1].symbolMap.length, 2);
  const copied = await readFile(join(work, 'out/api/http-surface.json'));
  assert.equal(createHash('sha256').update(copied).digest('hex'), surfaceSha256);

  // consumer root = provider 호출부에서 닿은 SDK 공개 심볼을 선언대로 옮긴 것(shared는 그대로, symbol-map은 대응표로).
  const argv = await calls();
  const traversal = (fixtureName) => argv.find((entry) => entry[1] === 'traverse' && entry[2].endsWith(fixtureName));
  assert.deepEqual(JSON.parse(await readFile(traversal('app-a-reverse.json')[6], 'utf8')), [sdkOrder, sdkPlaceOrder]);
  assert.deepEqual(traversal('app-b-reverse.json').slice(5),
    ['--', 'kt:shaded.orders.OrdersSdk#order(String)', 'kt:shaded.orders.OrdersSdk#placeOrder(Order)']);
  // consumer 순회는 provider 순회 뒤에 실행한다.
  const order = argv.filter((entry) => entry[1] === 'traverse').map((entry) => entry[2].split('/').pop());
  assert.deepEqual(order, ['sdk-reverse.json', 'app-a-reverse.json', 'app-b-reverse.json']);

  const trace = await readOutput(work, 'trace.json');
  const reference = referenceTrace('fixtures/trace-library/context.json');
  assert.deepEqual(trace.chains, reference.chains);
  assert.deepEqual(trace.summary, reference.summary);
  assert.deepEqual(trace.gaps.map(({ code }) => code), reference.gaps.map(({ code }) => code));
  assert.ok(!trace.gaps.some(({ code }) => code.startsWith('library-')));

  const manifest = await readOutput(work, 'capture-manifest.json');
  assert.deepEqual(manifest.members.find(({ name }) => name === 'api').surface,
    { source: 'imported', sha256: surfaceSha256, name: 'example-api', revision: 'v2.4', privacy: { handlers: 'opaque', limitations: 'prefix-only' } });
  assert.equal(manifest.artifacts.find(({ path }) => path === 'api/http-surface.json').source, 'precomputed');
  const [shared, mapped] = manifest.libraries;
  assert.deepEqual(shared.inputs, { publicSymbols: { source: 'config', entries: 2 } });
  assert.equal(mapped.inputs.symbolMap.source, 'file');
  assert.equal(mapped.inputs.symbolMap.entries, 2);
  // 후보 = 호출부 2 + 닿은 SDK 공개 심볼 2. 호출부(내부 클래스)는 공개 API 밖이라 옮기지 않는다.
  assert.deepEqual(shared.platforms, [{ platform: 'kotlin', callSites: 2, candidates: 4, roots: 2, notPublic: 2,
    providerAnalyses: 1, delivered: true }]);
  assert.equal(manifest.steps.find(({ step }) => step === 'analysis:app-a-reverse').roots, 2);
  assert.match(manifest.steps.find(({ step }) => step === 'pairs:app-a').skipped, /both sides/u);
});

test('surface 가져오기: sha256이 고정 값과 다르거나 계약을 어기면 그 단계의 오류다', async (t) => {
  await t.test('sha256 불일치', async (st) => {
    const { work, config } = await libraryCaptureConfig(st);
    config.members[0].surface.sha256 = 'f'.repeat(64);
    await rejectsAt(captureTrace(config), 'surface:api', /does not match its pinned sha256/u);
    const manifest = await readOutput(work, 'capture-manifest.json');
    assert.equal(manifest.failure.step, 'surface:api');
    // 긴 순회 전에 실패한다.
    assert.ok(!manifest.steps.some(({ step }) => step.startsWith('analysis:')));
    assert.equal(existsSync(join(work, 'out/api/http-surface.json')), false);
  });
  await t.test('digest를 다시 계산하지 않고 고친 surface', async (st) => {
    const { work, config } = await libraryCaptureConfig(st);
    const surface = JSON.parse(await readFile(join(repository, 'fixtures/http-surface/surfaces/example-api-2.4.surface.json'), 'utf8'));
    const tampered = `${JSON.stringify({ ...surface, revision: 'v9' })}\n`;
    await writeFile(join(work, 'tampered.surface.json'), tampered);
    config.members[0].surface = { path: { root: 'work', path: 'tampered.surface.json' },
      sha256: createHash('sha256').update(tampered).digest('hex') };
    await rejectsAt(captureTrace(config), 'surface:api', /violates the isthmus-http-surface contract/u);
  });
  await t.test('root 밖 심링크', async (st) => {
    const { work, config } = await libraryCaptureConfig(st);
    await symlink(join(repository, 'fixtures/http-surface/surfaces/example-api-2.4.surface.json'), join(work, 'linked.surface.json'));
    config.members[0].surface.path = { root: 'work', path: 'linked.surface.json' };
    await rejectsAt(captureTrace(config), 'surface:api', /symbolic link/u);
  });
});

/**
 * 게시 fixture를 현재 package 버전의 CLI로 다시 내보냈을 때의 바이트다.
 *
 * fixture는 isthmus 0.9.0으로 내보냈고, 버전마다 달라지는 값은 `exporter.version`과 그것을 덮는 `digest`뿐이다.
 * 두 값만 현재 버전으로 다시 계산해 버전을 올려도 "같은 서버 문서에서 CLI로 내보낸 결과와 바이트가 같다"는 검사를
 * 유지한다. 키 순서와 들여쓰기는 fixture 그대로다(`encodeSortedJson`의 정렬·2칸 들여쓰기와 같다).
 * digest를 다시 계산하는 코드가 테스트 대상과 같으므로, 게시 fixture의 바이트 sha256과 저장된 digest를 먼저 외부
 * 고정값으로 대조해 fixture 변조와 digest 규칙 변경을 버전과 무관하게 잡는다.
 */
async function surfaceFixtureAtPackageVersion() {
  const { computeSurfaceDigest } = await import(pathToFileURL(join(repository, 'dist/exchange/http-surface.js')).href);
  const { version } = JSON.parse(await readFile(join(repository, 'package.json'), 'utf8'));
  const bytes = await readFile(join(repository, 'fixtures/http-surface/surfaces/example-api-2.4.surface.json'));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), surfaceSha256);
  const published = JSON.parse(bytes.toString('utf8'));
  assert.equal(computeSurfaceDigest(published), published.digest);
  const current = { ...published, exporter: { ...published.exporter, version } };
  current.digest = computeSurfaceDigest(current);
  return `${JSON.stringify(current, null, 2)}\n`;
}

test('surface 내보내기: 캡처한 서버 member로 isthmus surface export를 실행하고 surface member로 잇는다', async (t) => {
  const setup = async (st) => {
    const work = await workspace(st);
    for (const name of ['server', 'client']) await mkdir(join(work, name));
    const emit = (name) => ['emit', fixture(`http-surface/${name}`), '--project', '{project}'];
    const config = {
      format: 'isthmus-trace-capture', version: 1, roots: { work, repo: repository },
      output: { root: 'work', path: 'out' }, generatedAt: '2026-09-30T00:00:00Z', tools: structuredClone(baseTools),
      members: [
        { name: 'server', project: { root: 'work', path: 'server' }, revision: 'v2.4',
          documents: [
            { name: 'server.http.json', tool: 'tsograph', args: emit('server/release-2.4/server.http.json') },
            { name: 'api.openapi.json', tool: 'tsograph', args: emit('server/release-2.4/api.openapi.json') },
          ] },
        { name: 'api', surface: { export: { member: 'server', name: 'example-api' } } },
        { name: 'client', project: { root: 'work', path: 'client' }, revision: 'cli-3.2.0',
          documents: [{ name: 'android.http.json', tool: 'kartograph', args: emit('client/android.http.json') }],
          analyses: [{ id: 'android-reverse', platform: 'kotlin', role: 'reverse', tool: 'kartograph',
            args: ['traverse', fixture('http-surface/client/android-reverse.json'), '--project', '{project}'], roots: 'arguments' }] },
      ],
      links: [{ name: 'mobile->api', client: 'client', server: 'api', match: { hosts: ['api.example.com'] },
        contract: { member: 'api', authoritative: true } }],
      selection: { routes: [{ method: 'GET', template: '/api/orders/{}' }] },
    };
    return { work, config };
  };
  await t.test('기본 공개 수준', async (st) => {
    const { work, config } = await setup(st);
    await captureTrace(config);
    // 같은 서버 문서에서 CLI로 내보낸 게시 fixture와 바이트가 같다(project·위치는 surface에 실리지 않는다).
    const exported = await readFile(join(work, 'out/api/http-surface.json'));
    assert.equal(exported.toString('utf8'), await surfaceFixtureAtPackageVersion());
    const exportedSha256 = createHash('sha256').update(exported).digest('hex');
    const context = await readOutput(work, 'trace-context.json');
    assert.deepEqual(context.members[1], { name: 'api', surface: { path: 'api/http-surface.json', sha256: exportedSha256 } });
    assert.deepEqual(context.links[0].contract, { member: 'api', authoritative: true });
    const manifest = await readOutput(work, 'capture-manifest.json');
    const step = manifest.steps.find(({ step: name }) => name === 'surface:api');
    assert.deepEqual(step.command.slice(2, 9), ['surface', 'export', '--name', 'example-api', '--revision', 'v2.4', '--']);
    assert.deepEqual(step.command.slice(9).map((path) => path.slice(join(work, 'out').length + 1)),
      ['server/documents/server.http.json', 'server/documents/api.openapi.json']);
    assert.deepEqual(manifest.members.find(({ name }) => name === 'api').surface.source, 'exported');
    assert.equal(manifest.artifacts.find(({ path }) => path === 'api/http-surface.json').source, 'isthmus');
    const trace = await readOutput(work, 'trace.json');
    const reference = referenceTrace('fixtures/http-surface/client/context.json');
    assert.deepEqual(trace.chains, reference.chains);
    assert.ok(trace.gaps.some(({ code, member }) => code === 'server-surface-opaque' && member === 'api'));
  });
  await t.test('공개 수준 플래그와 revision을 그대로 넘긴다', async (st) => {
    const { work, config } = await setup(st);
    config.members[1].surface.export = { member: 'server', revision: 'v2.4-rc1', includeHandlerUsrs: true, includeLimitationText: true };
    await captureTrace({ ...config, trace: false });
    const surface = await readOutput(work, 'api/http-surface.json');
    assert.equal(surface.name, 'api');
    assert.equal(surface.revision, 'v2.4-rc1');
    assert.deepEqual(surface.privacy, { handlers: 'usr', limitations: 'full' });
    const manifest = await readOutput(work, 'capture-manifest.json');
    const { command } = manifest.steps.find(({ step }) => step === 'surface:api');
    assert.ok(command.includes('--include-handler-usrs') && command.includes('--include-limitation-text'));
  });
  await t.test('선언 측 문서가 없는 member', async (st) => {
    const { config } = await setup(st);
    config.members[1].surface.export.member = 'client';
    await rejectsAt(captureTrace(config), 'surface:api', /member client has no http server or openapi document/u);
  });
  await t.test('surface revision으로 쓸 수 없는 member revision', async (st) => {
    const { config } = await setup(st);
    config.members[0].revision = '-v2.4';
    await rejectsAt(captureTrace(config), 'surface:api', /set export\.revision/u);
  });
});

test('library 오류 경로: 대응표 누락·root 없음·전달 불가는 경고로 드러나고 trace gap으로 이어진다', async (t) => {
  await t.test('symbol-map 누락 항목', async (st) => {
    const { work, config } = await libraryCaptureConfig(st);
    // 대응표에서 placeOrder를 빼고, capture 전용 publicSymbols로 공개 API를 밝힌다.
    await writeFile(join(work, 'app-b.symbol-map.json'), JSON.stringify([{ provider: sdkOrder, consumer: 'kt:shaded.orders.OrdersSdk#order(String)' }]));
    config.libraries[1].publicSymbols = [sdkOrder, sdkPlaceOrder];
    config.members[3].analyses[0].args.push('--subset');
    const result = await captureTrace(config);
    assert.deepEqual(result.warnings.map(({ step, code, roots }) => [step, code, roots]),
      [['library:app-b<-sdk', 'library-map-entry-missing', 1]]);
    const manifest = await readOutput(work, 'capture-manifest.json');
    assert.deepEqual(manifest.libraries[1].platforms[0].missingMapEntries, [sdkPlaceOrder]);
    // capture 전용 publicSymbols는 context에 싣지 않는다(trace는 symbol-map에서 받지 않는다).
    const context = await readOutput(work, 'trace-context.json');
    assert.equal(context.libraries[1].publicSymbols, undefined);
    assert.deepEqual(context.libraries[1].symbolMap, [{ provider: sdkOrder, consumer: 'kt:shaded.orders.OrdersSdk#order(String)' }]);
    const trace = await readOutput(work, 'trace.json');
    const post = trace.chains.find(({ selector }) => selector.route.method === 'POST');
    const hop = post.routes[0].calls[0].consumers.find(({ member }) => member === 'app-b');
    assert.deepEqual([hop.entries, hop.notPublic], [[], 2]);
  });
  await t.test('consumer에 맞는 root 없음', async (st) => {
    const { work, config } = await libraryCaptureConfig(st);
    config.libraries[0].publicSymbols = ['kt:com.example.sdk.OrdersSdk#cancel(String)'];
    const result = await captureTrace(config);
    assert.deepEqual(result.warnings.map(({ step, code }) => [step, code]), [['library:app-a<-sdk', 'library-no-roots']]);
    assert.match(result.warnings[0].detail, /None of the 4 kotlin SDK id\(s\).*4 outside the declared public API/u);
    const manifest = await readOutput(work, 'capture-manifest.json');
    assert.match(manifest.steps.find(({ step }) => step === 'analysis:app-a-reverse').skipped, /library providers/u);
    const trace = await readOutput(work, 'trace.json');
    assert.ok(trace.gaps.some(({ code, member }) => code === 'library-ids-unmatched' && member === 'app-a'));
  });
  await t.test('provider에 호출부 심볼이 없음', async (st) => {
    const { work, config } = await libraryCaptureConfig(st);
    const facts = JSON.parse(await readFile(join(repository, 'fixtures/trace-library/sdk/sdk.http.json'), 'utf8'));
    await writeFile(join(work, 'sdk.nosymbol.json'), JSON.stringify({ ...facts,
      facts: facts.facts.map(({ symbol, ...fact }) => fact) }));
    config.members[1].documents[0].args[1] = { root: 'work', path: 'sdk.nosymbol.json' };
    config.members[1].analyses = [];
    const result = await captureTrace({ ...config, trace: false });
    assert.deepEqual(result.warnings.map(({ code }) => code), ['library-no-roots', 'library-no-roots']);
    assert.match(result.warnings[0].detail, /carries no route-call symbol/u);
  });
  await t.test('생산자 명령 없는 consumer', async (st) => {
    const { work, config } = await libraryCaptureConfig(st);
    const project = join(work, 'app-b');
    const partial = JSON.parse(await readFile(join(repository, 'fixtures/trace-library/app-b/app-b-reverse.json'), 'utf8'));
    await writeFile(join(work, 'app-b-reverse.json'), JSON.stringify({ ...partial, project,
      roots: partial.roots.slice(0, 1), reached: partial.reached.filter(({ roots }) => roots.includes(0)) }));
    config.members[3].analyses = [{ id: 'app-b-reverse', platform: 'kotlin', role: 'reverse',
      precomputed: { path: { root: 'work', path: 'app-b-reverse.json' } } }];
    const result = await captureTrace(config);
    // 사전 계산 분석이 이미 가진 root(order)는 빼고, 가지지 않은 root(placeOrder)만 경고한다.
    assert.deepEqual(result.warnings.map(({ code, roots }) => [code, roots]), [['library-roots-undelivered', 1]]);
    const manifest = await readOutput(work, 'capture-manifest.json');
    assert.deepEqual(manifest.libraries[1].platforms[0].delivered, false);
    assert.equal(manifest.libraries[1].platforms[0].undelivered, 1);
    const trace = await readOutput(work, 'trace.json');
    assert.ok(trace.gaps.some(({ code, member }) => code === 'library-continuation-unrooted' && member === 'app-b'));
  });
  await t.test('대응표 파일 오류', async (st) => {
    const { work, config } = await libraryCaptureConfig(st);
    await writeFile(join(work, 'app-b.symbol-map.json'), JSON.stringify([{ provider: sdkOrder }]));
    await rejectsAt(captureTrace(config), 'library:app-b<-sdk', /symbolMap entries must be \{provider, consumer\}/u);
    config.output = { root: 'work', path: 'out2' };
    config.libraries[1].symbolMap = { root: 'work', path: 'missing.json' };
    await rejectsAt(captureTrace(config), 'library:app-b<-sdk', /does not exist/u);
  });
});

test('파일 선택과 library: consumer 역방향은 파일 심볼과 library root를 함께 받아 마지막에 한 번 실행한다', async (t) => {
  const { work, config } = await libraryCaptureConfig(t);
  const calls = recordArguments(t, work);
  config.selection = { files: [{ member: 'app-a', path: 'app/src/main/kotlin/com/example/appa/OrderScreen.kt' }] };
  await captureTrace({ ...config, trace: false });
  const traversals = (await calls()).filter((entry) => entry[1] === 'traverse');
  assert.deepEqual(traversals.map((entry) => entry[2].split('/').pop()), ['sdk-reverse.json', 'app-a-reverse.json', 'app-b-reverse.json']);
  const manifest = await readOutput(work, 'capture-manifest.json');
  assert.equal(manifest.fileSelection.find(({ member }) => member === 'app-a').source, 'traversal');
  assert.equal(manifest.libraries[0].platforms[0].delivered, true);
});
