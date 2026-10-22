import assert from 'node:assert/strict';
import test from 'node:test';
import { parseBridgeFactsDocument } from '../exchange/parse.ts';
import { createContractDiff, MAX_CONTRACT_DECLARATIONS } from './contract-diff.ts';
import { runDiffCommand } from '../cli/diff-command.ts';
import { createMcpSession } from '../cli/mcp-server.ts';

const contract = (type = 'text', nullable = false) => ({ version: 1,
  fields: [{ in: 'column', path: 'email', type, nullable }], limitations: [] });
const sql = (dataContract: unknown = contract(), channel = 'public.users') => ({ kind: 'relation-decl', channel,
  dynamic: false, symbol: { qualifiedName: channel, usr: channel }, ...(dataContract === null ? {} : { dataContract }) });
const doc = (platform: string, target: string | null, facts: unknown[], extra: Record<string, unknown> = {}) => parseBridgeFactsDocument({
  format: 'bridge-facts', version: 1, tool: { name: platform === 'sql' ? 'schemagraph' : platform === 'openapi' ? 'tsograph' : 'synthetic', version: '1.0.0' },
  generatedAt: '2026-10-22T00:00:00Z', platform, target, project: '/repo', facts, limitations: [],
  ...(platform === 'openapi' && target === 'http' ? { roles: ['server'] } : {}), ...extra,
});
const catalog = (facts: unknown[], extra: Record<string, unknown> = {}) => doc('sql', facts.length ? 'persistence' : null, facts, extra);
const users = doc('js', 'persistence', [{ kind: 'relation-use', channel: 'public.users', dynamic: false,
  location: { path: 'app.ts', line: 10, column: 4 }, symbol: { qualifiedName: 'loadUsers', usr: 'app:loadUsers' } }]);
const route = (path: string, type = 'string') => ({ kind: 'route-contract', method: 'GET', channel: path,
  dynamic: false, pathAnchor: 'root', location: { path: 'openapi.json', line: 1, column: 1 },
  symbol: { qualifiedName: 'users' }, dataContract: { version: 1,
    fields: [{ in: 'response-body', path: '200/application~1json/email', type, nullable: false, required: true }], limitations: [] } });
const spec = (facts: unknown[]) => doc('openapi', facts.length ? 'http' : null, facts);
const callers = doc('js', 'http', [{ kind: 'route-call', method: 'GET', channel: '/users', dynamic: false, pathAnchor: 'root',
  location: { path: 'client.ts', line: 4, column: 1 }, symbol: { qualifiedName: 'fetchUsers', usr: 'client:fetchUsers' } }], { roles: ['client'] });

test('same-name column type/nullability changes retain exact field evidence and actual relation callers', () => {
  const report = createContractDiff([catalog([sql()])], [catalog([sql(contract('integer', true))])], [users]);
  assert.equal(report.summary.total, 1);
  assert.deepEqual(report.changes[0]!.changes[0], { reason: 'field-changed', before: contract().fields[0], after: contract('integer', true).fields[0] });
  assert.equal(report.changes[0]!.reviewCallers.before[0]!.symbol!.usr, 'app:loadUsers');
  assert.equal(report.changes[0]!.reviewCallers.after[0]!.symbol!.usr, 'app:loadUsers');
  assert.equal(report.complete, false);
  assert.equal(report.scope.testPrediction, 'not-assessed');
});

test('deletion retains old callers, rename does not mix before/after bindings', () => {
  const report = createContractDiff([spec([route('/users')])], [spec([route('/people')])], [callers]);
  const removed = report.changes.find((row) => row.reason === 'declaration-removed')!;
  const added = report.changes.find((row) => row.reason === 'declaration-added')!;
  assert.equal(removed.reviewCallers.before[0]!.symbol!.usr, 'client:fetchUsers');
  assert.deepEqual(removed.reviewCallers.after, []);
  assert.deepEqual(added.reviewCallers.before, []);
  assert.deepEqual(added.reviewCallers.after, []);
  const columnRemoval = createContractDiff([catalog([sql()])], [catalog([])], [users]);
  assert.equal(columnRemoval.changes[0]!.reason, 'declaration-removed');
  assert.equal(columnRemoval.changes[0]!.reviewCallers.before.length, 1);
});

test('unchanged HTTP route still exposes changed response field and connected client', () => {
  const report = createContractDiff([spec([route('/users')])], [spec([route('/users', 'number')])], [callers]);
  assert.equal(report.changes[0]!.reason, 'contract-changed');
  assert.equal(report.changes[0]!.changes[0]!.after!.type, 'number');
  assert.equal(report.changes[0]!.reviewCallers.after[0]!.location!.path, 'client.ts');
});

test('empty legacy OpenAPI snapshot reports deletion and retains historical caller', () => {
  const report = createContractDiff([spec([route('/users')])], [spec([])], [callers]);
  assert.equal(report.changes[0]!.reason, 'declaration-removed');
  assert.equal(report.changes[0]!.reviewCallers.before.length, 1);
  assert.equal(report.changes[0]!.reviewCallers.after.length, 0);
});

test('producer scan scopes are preserved and incompatible test-source scope is rejected', () => {
  const server = doc('js', 'http', [{ ...route('/users'), kind: 'route-decl', symbol: { qualifiedName: 'users', usr: 'app:users' } }],
    { roles: ['server'], dispatch: 'specificity', sourceSets: { tests: 'excluded' } });
  const report = createContractDiff([server], [server], [callers]);
  assert.deepEqual(report.inputs.before[0]!.sourceSets, { tests: 'excluded' });
  assert.equal(report.inputs.before[0]!.dispatch, 'specificity');
  assert.equal(report.inputs.before[0]!.project, '/repo');
  assert.throws(() => createContractDiff([server], [{ ...server, sourceSets: { tests: 'included' } }], [callers]), /inventories/);
});

test('unknown/ambiguous contracts are review gaps, limits retain full totals', () => {
  const missing = createContractDiff([catalog([sql(null)])], [catalog([sql(null)])], []);
  assert.equal(missing.changes[0]!.reason, 'contract-unavailable');
  assert.deepEqual(missing.limitations.contracts, ['contract-not-collected']);
  const ambiguous = createContractDiff([catalog([sql(), sql(contract('int'))])], [catalog([sql()])], []);
  assert.equal(ambiguous.changes[0]!.reason, 'contract-ambiguous');
  const limited = createContractDiff([catalog([sql(null), sql(null, 'public.posts')])],
    [catalog([sql(null), sql(null, 'public.posts')])], [], 1);
  assert.equal(limited.truncated, true);
  assert.equal(limited.summary.omitted, 1);
  const same = createContractDiff([catalog([sql()])], [catalog([sql()])], []);
  assert.equal(same.status, 'no-changes-observed');
  assert.equal(same.scope.freshness, 'unknown-source-build-alignment');
  assert.equal(same.complete, false);
});

test('field addition/removal and producer limitations survive without claiming failure', () => {
  const before = { version: 1, fields: [{ in: 'query', path: 'old', type: 'string' }], limitations: ['nested schema omitted'] };
  const after = { version: 1, fields: [{ in: 'header', path: 'new', type: 'string', required: true }], limitations: [] };
  const report = createContractDiff([doc('openapi', 'http', [{ ...route('/users'), dataContract: before }], { limitations: ['contract-coverage: partial'] })],
    [spec([{ ...route('/users'), dataContract: after }])], []);
  assert.deepEqual(report.changes[0]!.changes.map((item) => item.reason).sort(), ['field-added', 'field-removed']);
  assert.deepEqual(report.limitations.before, ['contract-coverage: partial']);
  assert.deepEqual(report.limitations.contracts, ['nested schema omitted']);
});

test('different source scopes and excess preparation budgets fail instead of returning empty success', () => {
  const a = catalog([sql()]);
  for (const [before, after] of [[[], [a]], [[a], [{ ...a, project: '/other' }]], [[a], [{ ...a, tool: { name: 'other', version: '1' } }]]]) {
    assert.throws(() => createContractDiff(before!, after!, []), /requires|inventories/);
  }
  assert.throws(() => createContractDiff([a], [a], [], 0), /limit/);
  assert.throws(() => createContractDiff([{ ...a, facts: Array(MAX_CONTRACT_DECLARATIONS).fill(a.facts[0]) }], [a], []), /budget/);
});

test('CLI and MCP use identical bounded reports and preserve input text identity', async () => {
  const files = new Map([['old.json', JSON.stringify(catalog([sql()]))], ['new.json', JSON.stringify(catalog([sql(contract('int'))]))],
    ['client.json', JSON.stringify(users)]]);
  const read = async (path: string) => { const value = files.get(path); if (value === undefined) throw new Error('missing'); return value; };
  const args = ['diff', '--contracts', '--before', 'old.json', '--after', 'new.json', '--clients', 'client.json', '--compact', '--strict'];
  const cli = await runDiffCommand(args, read);
  assert.equal(cli.exitCode, 1);
  const session = createMcpSession({ readTextFile: read, producerVersion: 'test' });
  const response = JSON.parse((await session.handleLine(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call',
    params: { name: 'contract_diff', arguments: { before: ['old.json'], after: ['new.json'], clients: ['client.json'], compact: true, strict: true } } })))!);
  assert.deepEqual(JSON.parse(response.result.content[0].text), JSON.parse(cli.standardOutput));
  assert.equal(JSON.parse(cli.standardOutput).provenance.inputTextSha256.length, 3);
  for (const bad of [['--limit', '0'], ['--limit', '1001'], ['--fail-on', 'error'], ['--limit', '2', '--limit', '3']]) {
    assert.equal((await runDiffCommand([...args, ...bad], read)).exitCode, 64);
  }
  assert.equal((await runDiffCommand(['diff', '--contracts', '--before', 'missing.json', '--after', 'new.json'], read)).exitCode, 2);
});
