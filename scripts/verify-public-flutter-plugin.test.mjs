import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./verify-public-flutter-plugin.mjs', import.meta.url), 'utf8');
const helpers = [...source.matchAll(/^function runStep\([\s\S]*?^\}/gmu)];
const builds = [...source.matchAll(/runStep\('swift',\s*\['build',[\s\S]*?'Swift fixture build',[\s\S]*?\);/gu)];
assert.equal(helpers.length, 1, 'one actual runStep helper');
assert.equal(builds.length, 1, 'one actual Swift fixture build call');

// Execute the actual call and helper with only the child-process boundary replaced.
// No compiler, checkout or real child is needed to observe the forwarded timeout.
function injectedStep(runChild) {
  return new Function('runChild', 'verify', `${helpers[0][0]}; return runStep;`)(
    runChild, (condition, label) => assert.ok(condition, label),
  );
}

test('the public Swift fixture build forwards its intended ten-minute timeout', () => {
  const calls = [];
  const step = injectedStep((...args) => {
    calls.push(args);
    return { status: 0 };
  });
  new Function('runStep', 'checkoutRoot', builds[0][0])(step, '/fixture/public-plugin');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ['swift', ['build', '--package-path', '/fixture/public-plugin'],
    { cwd: undefined, env: undefined, timeout: 600_000 }]);
});

test('the helper preserves default and explicit unrelated command bounds', () => {
  const calls = [];
  const result = { status: 0 };
  const step = injectedStep((...args) => { calls.push(args); return result; });
  assert.equal(step('tool', ['version'], 'default'), result);
  assert.equal(step('tool', ['build'], 'explicit', {
    cwd: '/fixture', env: { FIXTURE: 'yes' }, timeout: 300_000,
  }), result);
  assert.deepEqual(calls, [
    ['tool', ['version'], { cwd: undefined, env: undefined, timeout: 60_000 }],
    ['tool', ['build'], { cwd: '/fixture', env: { FIXTURE: 'yes' }, timeout: 300_000 }],
  ]);
});

test('a failed child still rejects the fixture step', () => {
  for (const status of [1, null]) {
    const step = injectedStep(() => ({ status, stderr: 'not forwarded' }));
    assert.throws(() => step('swift', ['build'], 'Swift fixture build', { timeout: 600_000 }),
      /Swift fixture build/u);
  }
});
