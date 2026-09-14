/** 직접 detached로 시작한 프로세스 그룹만 종료하고, 종료 확인 뒤에 임시 파일을 정리하게 한다. */
export async function stopDetachedProcess(child, { graceMs = 4000, killMs = 2000 } = {}) {
  if (child?.pid === undefined) return { stopped: true, forced: false };
  const signal = (name) => {
    try { process.kill(-child.pid, name); return true; }
    catch (error) {
      if (error.code === 'ESRCH') return false;
      // signal 0의 EPERM은 종료 증거가 아니다. 다음 probe까지 기다리되
      // 실제 종료 신호의 권한 오류는 호출자에게 그대로 전달한다.
      if (name === 0 && error.code === 'EPERM') return true;
      throw error;
    }
  };
  const wait = async (milliseconds) => {
    const deadline = Date.now() + milliseconds;
    while (signal(0)) {
      if (Date.now() >= deadline) return false;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return true;
  };
  if (!signal('SIGTERM') || await wait(graceMs)) return { stopped: true, forced: false };
  signal('SIGKILL');
  return { stopped: await wait(killMs), forced: true };
}
