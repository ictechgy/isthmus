import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
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

test('workspace: member별 사실·순회, 사전 계산 artifact의 sha256, catalog graphSha, contract 문서 경로를 context에 싣는다', async (t) => {
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
      /tsograph fail exited with status 64/u],
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
