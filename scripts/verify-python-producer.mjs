/** 설치된 Python 생산자의 실제 HTTP·호출 그래프를 consumer까지 왕복 검증한다. */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runChild } from './run-child.mjs';

const generatedAt = '2026-10-11T00:00:00.000Z';

/** 자식 오류에서 프로젝트 경로·소스 원문 대신 검증 단계만 노출한다. */
export function checkedJson(result, stage) {
  if (result.error !== undefined || result.status !== 0) throw new Error(`Python producer verification failed: ${stage}`);
  try { return JSON.parse(result.stdout); }
  catch { throw new Error(`Python producer verification failed: ${stage} JSON`); }
}

/** 단순 분석 개수가 아니라 선택한 handler에서 실제 callee까지의 정확한 경로를 검사한다. */
export function assertPythonForward(forward) {
  assert.equal(forward.direction, 'dependencies');
  assert.equal(forward.truncated, false);
  assert.deepEqual(forward.roots.map((root) => [root.id, root.symbol?.usr]),
    [['app.py#get_item', 'app.py#get_item']]);
  assert.deepEqual(forward.reached.map((row) => [row.symbol?.usr, row.via, row.depth, row.roots, row.evidence]),
    [['app.py#load_item', 'app.py#get_item', 1, [0], 'direct']]);
}

/** 소비자가 정확한 handler의 forward 분석을 찾았는지 검사한다. 다른 방향의 gap은 보존한다. */
export function assertPythonTrace(trace) {
  assert.ok(trace.analyses.some((analysis) => analysis.id === 'python-forward'
    && analysis.platform === 'python' && analysis.reached === 1));
  assert.ok(trace.chains.some((chain) => chain.handlers.some((handler) => handler.usr === 'app.py#get_item')));
  assert.ok(!trace.gaps.some((gap) => gap.code === 'analysis-missing'
    && gap.symbol?.platform === 'python' && gap.symbol?.usr === 'app.py#get_item'));
}

/** 실제 CLI 두 개를 임시 합성 프로젝트로 연결한다. 분석 대상은 실행하지 않는다. */
export function verifyPythonProducer(isthmusMain, pythograph, run = runChild) {
  const work = mkdtempSync(join(tmpdir(), 'isthmus-python-'));
  try {
    const project = join(work, 'project');
    mkdirSync(project, { mode: 0o700 });
    writeFileSync(join(project, 'app.py'), [
      'from pathlib import Path', 'Path(__file__).with_name("executed").write_text("executed")',
      'from flask import Flask', 'import requests',
      'raise RuntimeError("analyzed code must never execute")',
      'app = Flask(__name__)', "@app.get('/items/<int:item_id>')",
      'def get_item(item_id):', '    return load_item(item_id)',
      'def load_item(item_id):', "    return {'id': item_id}",
      'def client():', "    return requests.get('https://api.example.test/items/7')", '',
    ].join('\n'), { mode: 0o600 });
    writeFileSync(join(project, 'requirements.txt'), 'Flask>=3,<4\nrequests>=2,<3\n', { mode: 0o600 });
    const produce = (args, stage) => {
      const result = checkedJson(run(pythograph,
        [...args, '--project', project, '--generated-at', generatedAt], { timeout: 60_000 }), stage);
      assert.equal(existsSync(join(project, 'executed')), false, 'analyzed source was executed');
      return result;
    };
    const server = produce(['routes', '--role', 'server'], 'server routes');
    const client = produce(['routes', '--role', 'client'], 'client routes');
    const forward = produce(['reach', '--revision', 'python-contract', 'app.py#get_item'], 'forward traversal');
    assertPythonForward(forward);
    assert.equal(server.platform, 'python');
    assert.equal(client.platform, 'python');
    assert.ok(server.facts.some((fact) => fact.kind === 'route-decl' && fact.channel === '/items/{}'));
    assert.ok(client.facts.some((fact) => fact.kind === 'route-call' && fact.channel === '/items/7'));
    const save = (name, document) => {
      const path = join(work, name);
      writeFileSync(path, JSON.stringify(document), { mode: 0o600, flag: 'wx' });
      return path;
    };
    const serverPath = save('server.json', server);
    const clientPath = save('client.json', client);
    save('forward.json', forward);
    const consumer = (args, stage) => checkedJson(run(process.execPath, [isthmusMain, ...args], { timeout: 60_000 }), stage);
    const matched = consumer(['check', serverPath, clientPath, '--strict'], 'HTTP join');
    assert.equal(matched.summary.matchedRoutes, 1);
    assert.equal(matched.summary.errors, 0);
    const contextPath = save('context.json', {
      format: 'isthmus-trace-context', version: 1, project, revision: 'python-contract',
      documents: ['server.json', 'client.json'],
      analyses: [{ id: 'python-forward', path: 'forward.json', platform: 'python', role: 'forward' }],
      selection: { routes: [{ method: 'GET', template: '/items/{}' }] },
    });
    const trace = consumer(['trace', contextPath], 'route trace');
    assertPythonTrace(trace);
    // 이름이 안 맞는 호출은 정상 조인으로 둔갑하지 않아야 한다. limitation은 그대로 보존한다.
    const changedClient = { ...client, facts: client.facts.map((fact) => ({ ...fact, channel: '/absent' })) };
    const missingPath = save('missing-client.json', changedClient);
    const missing = consumer(['check', serverPath, missingPath], 'negative HTTP join');
    assert.equal(missing.summary.matchedRoutes, 0);
    assert.ok(missing.issues.length > 0);
    return { matchedRoutes: 1, tracedPythonAnalyses: 1, negativeControl: true };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [isthmusMain, pythograph, ...extra] = process.argv.slice(2);
  if (!isthmusMain || !pythograph || extra.length) {
    process.stderr.write('Usage: verify-python-producer.mjs <isthmus-main.js> <pythograph-executable>\n');
    process.exitCode = 64;
  } else {
    try {
      verifyPythonProducer(resolve(isthmusMain), pythograph);
      process.stdout.write('Python producer HTTP join, traversal and negative control passed.\n');
    } catch {
      process.stderr.write('Python producer verification failed; check installed tool versions and the synthetic HTTP/traversal contract.\n');
      process.exitCode = 1;
    }
  }
}
