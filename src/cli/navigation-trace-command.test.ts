import assert from 'node:assert/strict';
import test from 'node:test';
import { runNavigationTraceCommand } from './navigation-trace-command.ts';

const context = { format: 'navigation-trace-context', version: 1, navigation: 'screens.json', documents: [] as string[], analyses: [] as string[] };
const navigation = { format: 'navigation-facts', version: 1, platform: 'js', project: '/work/example',
  tool: { name: 'tsograph', version: 'test' }, generatedAt: '2026-01-01T00:00:00Z', limitations: [],
  facts: [{ kind: 'screen-route', urlTemplate: '/catalog', dynamic: false, location: { path: 'src/routes.ts', line: 1, column: 1 },
    screen: { usr: 'src/screen.ts#Catalog' } }] };

test('navigation trace resolves paths relative to context and strict gaps exit 1', async () => {
  const read = async (path: string) => {
    if (path === '/work/context.json') return JSON.stringify(context);
    if (path === '/work/screens.json') return JSON.stringify(navigation);
    throw new Error('not found');
  };
  const result = await runNavigationTraceCommand(['trace-navigation', '/work/context.json'], read);
  assert.equal(result.exitCode, 0, result.standardError);
  assert.equal(JSON.parse(result.standardOutput).format, 'navigation-trace');
  assert.equal((await runNavigationTraceCommand(['trace-navigation', '/work/context.json', '--strict'], read)).exitCode, 1);
});

test('invalid context, unreadable inputs and usage retain exit contracts without raw content', async () => {
  assert.equal((await runNavigationTraceCommand(['trace-navigation'], async () => '')).exitCode, 64);
  assert.equal((await runNavigationTraceCommand(['trace-navigation', 'missing'], async () => { throw new Error('/private/path'); })).exitCode, 2);
  const bad = await runNavigationTraceCommand(['trace-navigation', 'context'], async () => JSON.stringify({ ...context, extra: true }));
  assert.equal(bad.exitCode, 2);
  assert.ok(!bad.standardError.includes('/private'));
});

test('strict rejects an unassessed forward analysis while preserving matched chains', async () => {
  const analysis = { format: 'language-traversal', version: 1, platform: 'js', project: navigation.project,
    tool: navigation.tool, generatedAt: navigation.generatedAt, direction: 'dependencies',
    roots: [{ id: 'src/screen.ts#Catalog', symbol: { usr: 'src/screen.ts#Catalog' } }],
    reached: [], truncated: false, limitations: [] };
  const inputs: Record<string, unknown> = { '/work/context.json': { ...context, analyses: ['reach.json'] },
    '/work/screens.json': navigation, '/work/reach.json': analysis };
  const result = await runNavigationTraceCommand(['trace-navigation', '/work/context.json', '--strict', '--compact'],
    async (path) => JSON.stringify(inputs[path]));
  assert.equal(result.exitCode, 1);
  assert.ok(JSON.parse(result.standardOutput).gaps.some((gap: { code: string }) => gap.code === 'screen-analysis-evidence-unreported'));
});

test('input failures distinguish read, JSON, navigation, HTTP, traversal and project contract causes', async () => {
  const run = (changes: Record<string, unknown>, next = context) => runNavigationTraceCommand(['trace-navigation', '/work/context.json'],
    async (path) => JSON.stringify(({ '/work/context.json': next, '/work/screens.json': navigation, ...changes } as Record<string, unknown>)[path]));
  const malformed = await runNavigationTraceCommand(['trace-navigation', 'context'], async () => '{');
  assert.equal(malformed.exitCode, 2); assert.match(malformed.standardError, /not valid JSON/);
  const nav = await run({ '/work/screens.json': { ...navigation, platform: 'java' } });
  assert.match(nav.standardError, /Navigation facts violate/);
  const bridge = await run({ '/work/http.json': {} }, { ...context, documents: ['http.json'] });
  assert.match(bridge.standardError, /HTTP facts violate/);
  const traversal = await run({ '/work/reach.json': {} }, { ...context, analyses: ['reach.json'] });
  assert.match(traversal.standardError, /traversal contract/);
  const crossProject = { format: 'bridge-facts', version: 1, platform: 'js', target: 'http', project: '/work/other',
    tool: navigation.tool, generatedAt: navigation.generatedAt, roles: ['client'], facts: [], limitations: [] };
  const mismatch = await run({ '/work/http.json': crossProject }, { ...context, documents: ['http.json'] });
  assert.match(mismatch.standardError, /one project/);
  const failure = await runNavigationTraceCommand(['trace-navigation', 'context'], async () => { throw new Error('sensitive'); });
  assert.match(failure.standardError, /readable regular file/); assert.ok(!failure.standardError.includes('sensitive'));
});

test('every read receives the remaining byte budget and over-limit custom readers are rejected', async () => {
  const observed: number[] = [];
  const result = await runNavigationTraceCommand(['trace-navigation', '/work/context.json'], async (path, limit) => {
    observed.push(limit);
    return JSON.stringify(path.endsWith('context.json') ? context : navigation);
  });
  assert.equal(result.exitCode, 0); assert.ok(observed.every((limit) => limit === 16 * 1024 * 1024));
  const excessive = await runNavigationTraceCommand(['trace-navigation', 'context'], async () => ' '.repeat(16 * 1024 * 1024 + 1));
  assert.equal(excessive.exitCode, 2); assert.match(excessive.standardError, /byte limit/);
});
