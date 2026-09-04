import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflowUrl = new URL('../.github/workflows/ci.yml', import.meta.url);
const packageUrl = new URL('../package.json', import.meta.url);

test('공개 CI가 최소 Node 버전에서 검증하고 액션을 고정한다', async () => {
  const workflow = await readFile(workflowUrl, 'utf8');

  assert.equal(workflow.includes('permissions:\n  contents: read'), true);
  assert.equal(workflow.includes('timeout-minutes: 10'), true);
  assert.equal(workflow.includes("node-version: '22.18.0'"), true);
  assert.equal(workflow.includes('run: npm ci'), true);
  assert.equal(workflow.includes('run: npm run verify'), true);
  assert.equal(
    workflow.includes('actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1'),
    true,
  );
  assert.equal(
    workflow.includes('actions/setup-node@820762786026740c76f36085b0efc47a31fe5020'),
    true,
  );
  assert.equal(/actions\/[\w-]+@v\d/u.test(workflow), false);
});

test('표준 verify가 Phase 0 손 조인 회귀 테스트를 포함한다', async () => {
  const packageDocument = JSON.parse(await readFile(packageUrl, 'utf8'));

  assert.equal(
    packageDocument.scripts['test:phase0:join'],
    'node --test experiments/phase-0/join/join.test.mjs',
  );
  assert.equal(
    packageDocument.scripts.verify.includes('npm run test:phase0:join'),
    true,
  );
});
