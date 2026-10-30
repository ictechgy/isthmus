import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { runChild } from './run-child.mjs';

// 실제 producer CLI와 소비자 설치 경로를 받아 같은 입력으로 재실행한다.
const producer = realpathSync(process.argv[2]);
const consumer = realpathSync(process.argv[3] ?? join(dirname(fileURLToPath(import.meta.url)), '../dist/cli/main.js'));
const temporaryRoot = realpathSync(tmpdir());
const project = mkdtempSync(join(temporaryRoot, 'isthmus-data-contracts-'));
const start = performance.now();
const execute = (cli, args, expected = 0) => {
  const result = runChild(process.execPath, [cli, ...args], { cwd: project });
  assert.equal(result.status, expected, `${args[0]}: ${result.stderr}`);
  return JSON.parse(result.stdout);
};
const save = (name, value) => { const path = join(project, name); writeFileSync(path, JSON.stringify(value)); return path; };
const spec = (type) => ({ openapi: '3.0.3', info: { title: 'bounded contract fixture', version: '1' },
  servers: [{ url: 'https://example.invalid' }], paths: { '/users': { get: { operationId: 'listUsers',
    parameters: [{ in: 'query', name: 'limit', required: true, schema: { type } }],
    responses: { 200: { description: 'users', content: { 'application/json': { schema: {
      type: 'object', properties: { email: { type, nullable: type === 'integer' } }, required: ['email'],
    } } } } },
  } } } });
try {
  writeFileSync(join(project, 'client.ts'), "export async function loadUsers() { return fetch('https://example.invalid/users'); }\n");
  const before = save('before.facts.json', execute(producer, ['openapi', save('before.json', spec('string')),
    '--service', 'fixture-api', '--project', project, '--data-contracts']));
  const after = save('after.facts.json', execute(producer, ['openapi', save('after.json', spec('integer')),
    '--service', 'fixture-api', '--project', project, '--data-contracts']));
  const clients = save('clients.facts.json', execute(producer, ['routes', '--role', 'client', '--project', project, '--service', 'fixture-api']));
  const prepared = performance.now();
  const report = execute(consumer, ['diff', '--contracts', '--before', before, '--after', after,
    '--clients', clients, '--strict', '--compact'], 1);
  assert.equal(report.summary.total, 1);
  assert.equal(report.summary.fieldChanges, 2);
  assert.equal(report.changes[0].reviewCallers.before.length, 1);
  assert.equal(report.changes[0].reviewCallers.after.length, 1);
  assert.match(report.changes[0].reviewCallers.after[0].symbol.usr, /loadUsers/);
  assert.equal(report.complete, false);
  assert.equal(report.scope.runtimeCompatibility, 'not-assessed');
  assert.ok(report.limitations.contracts.length > 0);
  assert.equal(report.provenance.inputTextSha256.length, 3);
  console.log(JSON.stringify({ status: 'verified', fixture: 'same-route-query-response-change',
    producer: report.inputs.after[0].tool, sourceBuildAlignment: report.scope.freshness,
    changes: report.summary, staticCallers: 1, complete: report.complete,
    preparationMs: prepared - start, comparisonMs: performance.now() - prepared, totalMs: performance.now() - start }));
} finally {
  // mkdtemp가 만든 지정 임시 경로 밖은 정리하지 않는다.
  const checked = resolve(project);
  assert.ok(checked.startsWith(temporaryRoot + sep) && checked !== temporaryRoot);
  rmSync(checked, { recursive: true, force: true });
}
