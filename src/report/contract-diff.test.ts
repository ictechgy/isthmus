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

test('MCP contract_diff path arrays cannot introduce CLI options before any input read', async () => {
  const reads: string[] = [];
  const local = createMcpSession({ readTextFile: async (path) => {
    reads.push(path);
    return JSON.stringify(path === 'client.json' ? callers : spec([route('/users')]));
  } });
  for (const key of ['before', 'after', 'clients']) {
    for (const paths of [['old.json', '--clients', 'client.json'], ['--strict'], ['--'], ['']]) {
      const args = { before: ['old.json'], after: ['new.json'], strict: false, [key]: paths };
      const response = JSON.parse((await local.handleLine(JSON.stringify({
        jsonrpc: '2.0', id: 101, method: 'tools/call',
        params: { name: 'contract_diff', arguments: args },
      })))!);
      assert.equal(response.error?.code, -32602, JSON.stringify({ key, paths, response }));
      assert.deepEqual(reads, [], 'invalid MCP paths must be rejected before file IO');
    }
  }
});

test('MCP contract_diff enforces every advertised path-array minItems before input reads', async () => {
  const reads: string[] = [];
  const local = createMcpSession({ readTextFile: async (path) => {
    reads.push(path);
    return JSON.stringify(spec([route('/users')]));
  } });
  for (const key of ['before', 'after', 'clients']) {
    const response = JSON.parse((await local.handleLine(JSON.stringify({
      jsonrpc: '2.0', id: 102, method: 'tools/call', params: {
        name: 'contract_diff', arguments: { before: ['old.json'], after: ['new.json'], [key]: [] },
      },
    })))!);
    assert.equal(response.error?.code, -32602, JSON.stringify({ key, response }));
    assert.deepEqual(reads, []);
  }
});

test('MCP contract_diff retains optional clients and literal non-option path spellings', async () => {
  for (const withClients of [false, true]) {
    const reads: string[] = [];
    const local = createMcpSession({ readTextFile: async (path) => {
      reads.push(path);
      return JSON.stringify(path === 'client facts.json' ? callers :
        spec([route('/users', path === './--old.json' ? 'string' : 'number')]));
    } });
    const response = JSON.parse((await local.handleLine(JSON.stringify({
      jsonrpc: '2.0', id: 103, method: 'tools/call', params: { name: 'contract_diff', arguments: {
        before: ['./--old.json'], after: ['new facts.json'],
        ...(withClients ? { clients: ['client facts.json'] } : {}),
      } },
    })))!);
    assert.equal(response.error, undefined);
    assert.equal(response.result.isError, false);
    const report = JSON.parse(response.result.content[0].text);
    assert.deepEqual(reads, ['./--old.json', 'new facts.json', ...(withClients ? ['client facts.json'] : [])]);
    assert.equal(report.summary.total, 1);
    assert.equal(report.inputs.clients.length, withClients ? 1 : 0);
    assert.equal(report.changes[0].reviewCallers.after.length, withClients ? 1 : 0);
    assert.equal(report.complete, false);
    assert.equal(report.scope.runtimeCompatibility, 'not-assessed');
  }
});

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

test('SQL case-normalized joins keep the exact declaration caller identity', () => {
  const column = (type: string) => ({ ...sql(contract(type)), method: 'Email', symbol: { qualifiedName: 'public.users.Email', usr: 'public.users.Email' } });
  const client = doc('js', 'persistence', [{ kind: 'relation-use', channel: 'PUBLIC.USERS', method: 'email', dynamic: false,
    location: { path: 'client.ts', line: 1, column: 1 },
    symbol: { qualifiedName: 'readEmail', usr: 'app:readEmail' } }]);
  const report = createContractDiff([catalog([sql(), column('text')])], [catalog([sql(), column('int')])], [client]);
  assert.equal(report.changes[0]!.reviewCallers.after[0]?.symbol?.usr, 'app:readEmail');
  const bare = (channel: string, type: string) => ({ kind: 'relation-decl', channel, dynamic: false,
    symbol: { qualifiedName: 'sharedCatalogCollector' }, dataContract: contract(type) });
  const separate = createContractDiff([catalog([bare('public.users', 'text'), bare('public.audit', 'text')])],
    [catalog([bare('public.users', 'int'), bare('public.audit', 'int')])], [users]);
  assert.equal(separate.changes.find((row) => row.key.includes('public.users'))!.reviewCallers.after.length, 1);
  assert.equal(separate.changes.find((row) => row.key.includes('public.audit'))!.reviewCallers.after.length, 0);
});

test('added and removed declarations retain field deltas; unknown counterparts retain known observations only', () => {
  const removed = createContractDiff([spec([route('/users')])], [spec([])], []);
  assert.equal(removed.changes[0]!.changes[0]?.reason, 'field-removed');
  assert.equal(removed.changes[0]!.contractObservations.before[0]!.contract!.fields[0]!.type, 'string');
  const added = createContractDiff([spec([])], [spec([route('/users')])], []);
  assert.equal(added.changes[0]!.changes[0]?.reason, 'field-added');
  const unknown = createContractDiff([catalog([sql()])], [catalog([sql(null)])], []);
  assert.deepEqual(unknown.changes[0]!.changes, []);
  assert.equal(unknown.changes[0]!.contractObservations.before[0]!.contract!.fields[0]!.type, 'text');
  assert.equal(unknown.changes[0]!.contractObservations.after[0]!.contract, null);
});

test('ambiguous SQL callers remain explicit unresolved evidence instead of zero observed callers', () => {
  const before = catalog([sql(contract(), 'public.users'), sql(contract(), 'archive.users')]);
  const after = catalog([sql(contract('int'), 'public.users'), sql(contract('int'), 'archive.users')]);
  const client = doc('js', 'persistence', [{ kind: 'relation-use', channel: 'users', dynamic: false,
    location: { path: 'client.ts', line: 1, column: 1 },
    symbol: { qualifiedName: 'loadUsers', usr: 'app:loadUsers' } }]);
  const report = createContractDiff([before], [after], [client]);
  assert.equal(report.scope.unresolvedCallerBindings.after, 1);
  assert.deepEqual(report.unresolvedCallers.after[0]!.candidates, ['archive.users', 'public.users']);
  assert.equal(report.unresolvedCallers.after[0]!.uses[0]!.symbol!.usr, 'app:loadUsers');
  const many = catalog(Array.from({ length: 61 }, (_, i) => sql(contract(), `schema${i}.users`)));
  const limited = createContractDiff([many], [many], [client]);
  assert.equal(limited.summary.total, 0);
  assert.equal(limited.unresolvedCallers.after[0]!.candidates.length, 50);
  assert.equal(limited.unresolvedCallers.after[0]!.candidatesOmitted, 11);
  assert.equal(limited.truncated, true);
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
