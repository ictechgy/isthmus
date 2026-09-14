import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import test from 'node:test';
import { stopDetachedProcess } from './stop-detached-process.mjs';

for (const ignoreTerm of [false, true]) test(`직접 시작한 그룹의 ${ignoreTerm ? '강제' : '정상'} 종료를 확인한다`,
  { skip: process.platform === 'win32' }, async () => {
    const child = spawn(process.execPath, ['-e', `${ignoreTerm ? "process.on('SIGTERM', () => {});" : ''}
process.stdout.write('ready'); setInterval(() => {}, 1000);`], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stopped = false;
    try {
      await once(child.stdout, 'data');
      const result = await stopDetachedProcess(child, { graceMs: 100, killMs: 2000 });
      stopped = result.stopped;
      assert.equal(result.stopped, true);
      assert.equal(result.forced, ignoreTerm);
      assert.throws(() => process.kill(-child.pid, 0), { code: 'ESRCH' });
    } finally {
      if (!stopped) {
        // 핸들이 소유한 단일 자식만 정리한다. 보조 정리가 원래 실패를 가리지 않게 한다.
        child.kill('SIGKILL');
      }
    }
  });

test('시작하지 않은 프로세스는 종료 대상으로 만들지 않는다', async () => {
  assert.deepEqual(await stopDetachedProcess(undefined), { stopped: true, forced: false });
});

test('확인할 수 없는 그룹을 종료 완료로 판정하지 않는다', async (t) => {
  t.mock.method(process, 'kill', (_pid, signal) => {
    if (signal === 0) throw Object.assign(new Error('probe denied'), { code: 'EPERM' });
    return true;
  });
  assert.deepEqual(await stopDetachedProcess({ pid: 123 }, { graceMs: 0, killMs: 0 }),
    { stopped: false, forced: true });
});

test('실제 종료 신호의 권한 오류를 숨기지 않는다', async (t) => {
  t.mock.method(process, 'kill', () => { throw Object.assign(new Error('signal denied'), { code: 'EPERM' }); });
  await assert.rejects(stopDetachedProcess({ pid: 123 }), { code: 'EPERM' });
});
