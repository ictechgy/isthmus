import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// 드리프트 감시 workflow의 경계(권한·고정 Action·시간 제한·대상 생산자·엄격 모드)를 고정한다.
const workflow = await readFile(new URL('../.github/workflows/conformance-drift.yml', import.meta.url), 'utf8');

test('드리프트 감시는 예약·수동 실행만 하고 읽기 권한과 시간 제한 안에서 돈다', () => {
  assert.match(workflow, /\n {2}schedule:\n {4}- cron: '17 3 \* \* 1'\n {2}workflow_dispatch:\n/u);
  assert.equal(/\n {2}(pull_request|push):/u.test(workflow), false);
  assert.match(workflow, /\npermissions:\n {2}contents: read\n/u);
  assert.match(workflow, /timeout-minutes: 10\n/u);
  assert.equal(/actions\/[\w-]+@v\d/u.test(workflow), false, 'actions are pinned by SHA');
  assert.equal((workflow.match(/persist-credentials: false/gu) ?? []).length, 2);
});

test('벡터를 쓰는 생산자 일곱 곳을 엄격 모드로 대조하고 기록이 없는 schemagraph는 넣지 않는다', () => {
  const producers = [...workflow.matchAll(/- \{ producer: ([a-z]+) \}/gu)].map((match) => match[1]);
  assert.deepEqual(producers, ['cartograph', 'kartograph', 'dartograph', 'gartograph', 'rustograph', 'pythograph', 'tsograph']);
  assert.match(workflow, /node isthmus\/scripts\/conformance-drift\.mjs --strict "\$\{PRODUCER\}=producer"/u);
  assert.match(workflow, /git -C producer rev-parse HEAD/u);
});
