import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { checkedJson, verifyPythonProducer, assertPythonForward, assertPythonTrace } from './verify-python-producer.mjs';
import { runChild } from './run-child.mjs';

test('자식 CLI 실패·잘못된 JSON을 성공으로 취급하거나 원문을 노출하지 않는다', () => {
  assert.deepEqual(checkedJson({ status: 0, stdout: '{"ok":true}' }, 'step'), { ok: true });
  for (const result of [{ status: 1, stdout: 'private source' },
    { status: 0, error: new Error('private path'), stdout: '{}' }, { status: 0, stdout: 'private source' }]) {
    assert.throws(() => checkedJson(result, 'contract'), (error) =>
      error instanceof Error && error.message.includes('contract') && !error.message.includes('private'));
  }
});

test('생산자가 실패해도 소유한 임시 fixture를 정리한다', () => {
  let project;
  assert.throws(() => verifyPythonProducer('/unused/main.js', '/unused/producer', (_command, args) => {
    project = args[args.indexOf('--project') + 1];
    assert.equal(existsSync(project), true);
    return { status: 2, stdout: '', stderr: 'private source' };
  }));
  assert.equal(existsSync(dirname(project)), false);
});

test('CLI는 입력 누락을 64로 구분한다', () => {
  const result = runChild(process.execPath, ['scripts/verify-python-producer.mjs']);
  assert.equal(result.status, 64);
  assert.match(result.stderr, /Usage:/u);
});

test('다른 handler의 분석과 실제 선택 handler를 독립 개수만으로 통과시키지 않는다', () => {
  const forward = { direction: 'dependencies', truncated: false,
    roots: [{ id: 'app.py#get_item', symbol: { usr: 'app.py#get_item' } }],
    reached: [{ symbol: { usr: 'app.py#load_item' }, via: 'app.py#get_item', depth: 1, roots: [0], evidence: 'direct' }] };
  assertPythonForward(forward);
  assert.throws(() => assertPythonForward({ ...forward, roots: [{ id: 'app.py#unrelated', symbol: { usr: 'app.py#unrelated' } }] }));
  assert.throws(() => assertPythonForward({ ...forward, reached: [] }));
  assert.throws(() => assertPythonForward({ ...forward, truncated: true }));
  const trace = { analyses: [{ id: 'python-forward', platform: 'python', reached: 1 }],
    chains: [{ handlers: [{ usr: 'app.py#get_item' }] }], gaps: [] };
  assertPythonTrace(trace);
  assert.throws(() => assertPythonTrace({ ...trace, gaps: [{ code: 'analysis-missing', symbol: { platform: 'python', usr: 'app.py#get_item' } }] }));
});

test('실행 오류를 삼키더라도 대상 소스의 실행 흔적은 실패로 처리한다', () => {
  assert.throws(() => verifyPythonProducer('/unused/main.js', '/unused/producer', (_command, args) => {
    const project = args[args.indexOf('--project') + 1];
    writeFileSync(join(project, 'executed'), 'executed');
    return { status: 0, stdout: '{}' };
  }), /analyzed source was executed/u);
});
