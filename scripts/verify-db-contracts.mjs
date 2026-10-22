import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { runChild } from './run-child.mjs';

// 실제 scan → facts → 계약 diff를 검사한다. 호출 측은 추출 정확도를 주장하지 않는 명시 fixture다.
const usage = 'Usage: node scripts/verify-db-contracts.mjs <schemagraph-executable> [isthmus-dist-cli]\n';
if (process.argv.length < 3 || process.argv.length > 4) {
  process.stderr.write(usage);
  process.exit(64);
}
const executable = (path, label) => {
  const real = realpathSync(path);
  assert.ok(statSync(real).isFile(), `${label} must be a file`);
  return real;
};
const producer = executable(process.argv[2], 'schemagraph executable');
const consumer = executable(process.argv[3] ?? join(dirname(fileURLToPath(import.meta.url)), '../dist/cli/main.js'), 'Isthmus CLI');
const python = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
const digest = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const tools = { schemagraph: digest(producer), isthmusCli: digest(consumer) };
const temporaryRoot = realpathSync(tmpdir());
const project = realpathSync(mkdtempSync(join(temporaryRoot, 'isthmus-db-contracts-')));
const start = performance.now();

const execute = (command, args, expected = 0) => {
  const result = runChild(command, args, { cwd: project, timeout: 120_000 });
  assert.equal(result.error, undefined, `${basename(command)} could not run: ${result.error?.message}`);
  assert.equal(result.status, expected, `${basename(command)} ${args[0]}: ${result.stderr}`);
  return result.stdout;
};
const save = (name, value) => {
  const path = join(project, name);
  writeFileSync(path, JSON.stringify(value), { mode: 0o600 });
  return path;
};

// 새 임시 DB 하나만 사용한다. 같은 경로에서 전후를 캡처하므로 source_id도 비교 가능하다.
// 타입·NOT NULL 변경과 새 FK는 SQLite가 직접 실행하고 PRAGMA로 독립 확인한다.
const sqliteFixture = String.raw`
from contextlib import closing
from pathlib import Path
import json, sqlite3, sys
database, phase = Path(sys.argv[1]), sys.argv[2]
assert phase in ('before', 'after')
assert (not database.exists()) if phase == 'before' else database.is_file()
with closing(sqlite3.connect(database)) as connection:
    connection.enable_load_extension(False)
    connection.set_authorizer(lambda action, *_: sqlite3.SQLITE_DENY
                              if action in (sqlite3.SQLITE_ATTACH, sqlite3.SQLITE_DETACH)
                              else sqlite3.SQLITE_OK)
    connection.execute('PRAGMA foreign_keys = ON')
    if phase == 'before':
        connection.executescript('''
            CREATE TABLE "Accounts" ("Id" INTEGER PRIMARY KEY);
            CREATE TABLE "Users" ("Id" INTEGER PRIMARY KEY, "Email" TEXT);
            INSERT INTO "Accounts" VALUES (7);
            INSERT INTO "Users" VALUES (1, '7');
        ''')
    else:
        connection.executescript('''
            BEGIN;
            ALTER TABLE "Users" RENAME TO "Users_before";
            CREATE TABLE "Users" ("Id" INTEGER PRIMARY KEY, "Email" INTEGER NOT NULL,
                                  FOREIGN KEY ("Email") REFERENCES "Accounts" ("Id"));
            INSERT INTO "Users" SELECT "Id", CAST("Email" AS INTEGER) FROM "Users_before";
            DROP TABLE "Users_before";
            COMMIT;
        ''')
    assert connection.execute('PRAGMA foreign_key_check').fetchone() is None
    connection.commit()
    print(json.dumps({'sqliteVersion': sqlite3.sqlite_version,
                      'columns': connection.execute('PRAGMA table_info("Users")').fetchall(),
                      'foreignKeys': connection.execute('PRAGMA foreign_key_list("Users")').fetchall(),
                      'rows': connection.execute('SELECT "Id", "Email" FROM "Users"').fetchall()}))
`;

try {
  chmodSync(project, 0o700);
  const producerVersion = execute(producer, ['--version']).trim();
  const consumerVersion = execute(process.execPath, [consumer, '--version']).trim();
  const version = /\b(\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?)$/u.exec(producerVersion)?.[1];
  assert.ok(version, `Unrecognized schemagraph version: ${producerVersion}`);
  assert.ok(consumerVersion.length > 0, 'Isthmus version must be reported');
  const database = join(project, 'isolated.sqlite');
  const capture = (side) => {
    const oracle = JSON.parse(execute(python, ['-c', sqliteFixture, database, side]));
    const catalog = join(project, `${side}.catalog.json`);
    const graph = join(project, `${side}.graph.json`);
    const facts = join(project, `${side}.facts.json`);
    execute(producer, ['scan', `sqlite:${database.replaceAll('\\', '/')}`, '--emit-document', catalog, '-o', graph]);
    execute(producer, ['facts', '--document', catalog, '--project', project, '-o', facts]);
    const document = JSON.parse(readFileSync(facts, 'utf8'));
    assert.equal(document.format, 'bridge-facts');
    assert.equal(document.version, 1);
    assert.equal(document.project, project);
    assert.equal(document.platform, 'sql');
    assert.equal(document.target, 'persistence');
    assert.deepEqual(document.tool, { name: 'schemagraph', version });
    return { oracle, document, facts, catalog };
  };
  const before = capture('before');
  const after = capture('after');
  assert.deepEqual(before.oracle.columns.find((row) => row[1] === 'Email').slice(2, 4), ['TEXT', 0]);
  assert.deepEqual(after.oracle.columns.find((row) => row[1] === 'Email').slice(2, 4), ['INTEGER', 1]);
  assert.equal(before.oracle.foreignKeys.length, 0);
  assert.equal(after.oracle.foreignKeys.length, 1);
  assert.deepEqual(after.oracle.foreignKeys[0].slice(2, 5), ['Accounts', 'Email', 'Id']);
  assert.deepEqual(after.oracle.rows, [[1, 7]]);

  const declaration = (side, method) => side.document.facts.find((fact) =>
    fact.kind === 'relation-decl' && fact.channel === 'main.Users' && fact.method === method);
  const oldRelation = declaration(before, undefined), newRelation = declaration(after, undefined);
  const oldColumn = declaration(before, 'Email'), newColumn = declaration(after, 'Email');
  assert.ok(oldRelation && newRelation && oldColumn && newColumn, 'Actual producer must preserve relation and column declarations');
  assert.deepEqual(oldRelation.symbol, newRelation.symbol);
  assert.deepEqual(oldColumn.symbol, newColumn.symbol);
  const oldField = { in: 'column', path: 'Email', type: 'TEXT', nullable: true };
  const newField = { in: 'column', path: 'Email', type: 'INTEGER', nullable: false };
  assert.deepEqual(oldColumn.dataContract.fields, [oldField]);
  assert.deepEqual(newColumn.dataContract.fields, [newField]);
  const constraint = newRelation.dataContract.fields.find((field) => field.in === 'constraint' && field.path === 'Users_fk_0');
  assert.ok(constraint, 'SQLite FK must reach the actual producer contract');
  assert.match(constraint.type, /^sha256:[a-f0-9]{64}$/u);
  assert.ok(!oldRelation.dataContract.fields.some((field) => field.in === 'constraint' && field.path === constraint.path));

  const client = { format: 'bridge-facts', version: 1, tool: { name: 'db-contract-fixture', version: '1' },
    generatedAt: '2026-10-22T00:00:00Z', project, platform: 'go', target: 'persistence',
    facts: [
      { kind: 'relation-use', channel: 'main.users', dynamic: false,
        location: { path: 'db/client.go', line: 1, column: 1 }, symbol: { usr: 'fixture::loadUsers' } },
      { kind: 'relation-use', channel: 'main.users', method: 'email', dynamic: false,
        location: { path: 'db/client.go', line: 2, column: 1 }, symbol: { usr: 'fixture::loadEmail' } },
    ], limitations: ['Declared client fixture only; no Go source extraction or runtime query coverage is claimed.'] };
  const clients = save('client.facts.json', client);
  const prepared = performance.now();
  const report = JSON.parse(execute(process.execPath, [consumer, 'diff', '--contracts', '--before', before.facts,
    '--after', after.facts, '--clients', clients, '--strict', '--compact'], 1));
  assert.equal(report.format, 'isthmus-contract-diff');
  assert.equal(report.version, 1);
  assert.equal(report.complete, false);
  assert.equal(report.status, 'review-required');
  assert.deepEqual({ total: report.summary.total, shown: report.summary.shown, omitted: report.summary.omitted,
    fields: report.summary.fieldChanges }, { total: 2, shown: 2, omitted: 0, fields: 3 });
  assert.equal(report.truncated, false);
  const changed = (symbol) => report.changes.find((row) => row.evidence.after.some((endpoint) => endpoint.symbol?.usr === symbol.usr));
  const relation = changed(newRelation.symbol), column = changed(newColumn.symbol);
  assert.ok(relation && column, 'Both actual producer declaration identities must remain visible');
  for (const [row, old, current, caller] of [[relation, oldRelation, newRelation, 'fixture::loadUsers'],
    [column, oldColumn, newColumn, 'fixture::loadEmail']]) {
    assert.equal(row.reason, 'contract-changed');
    const change = row.changes.find((field) => field.reason === 'field-changed' &&
      field.before?.in === 'column' && field.before.path === 'Email');
    assert.ok(change, 'Type/nullability field change must survive comparison');
    assert.deepEqual(change.before, oldField);
    assert.deepEqual(change.after, newField);
    for (const side of ['before', 'after']) {
      assert.equal(row.reviewCallers[side].length, 1);
      assert.equal(row.reviewCallers[side][0].symbol.usr, caller);
      assert.equal(row.reviewCallers[side][0].location.path, 'db/client.go');
      assert.equal(row.callersOmitted[side], 0);
      const expected = side === 'before' ? old : current;
      assert.deepEqual(row.evidence[side][0].symbol, expected.symbol);
      assert.deepEqual(row.contractObservations[side][0].contract.fields, expected.dataContract.fields);
    }
    assert.ok(row.limitations.length > 0, 'Producer contract limitations must survive comparison');
  }
  assert.ok(relation.changes.some((field) => field.reason === 'field-added' &&
    field.before === undefined && field.after?.in === 'constraint' && field.after.path === constraint.path && field.after.type === constraint.type));
  assert.equal(report.scope.runtimeCompatibility, 'not-assessed');
  assert.equal(report.scope.testPrediction, 'not-assessed');
  assert.equal(report.scope.freshness, 'unknown-source-build-alignment');
  assert.ok(report.limitations.contracts.length > 0);
  assert.deepEqual(report.limitations.clients, client.limitations);
  for (const side of ['before', 'after']) for (const note of (side === 'before' ? before : after).document.limitations) {
    assert.ok(report.limitations[side].includes(note));
  }
  assert.equal(report.provenance.inputTextSha256.length, 3);
  assert.equal(digest(producer), tools.schemagraph, 'Producer binary changed during verification');
  assert.equal(digest(consumer), tools.isthmusCli, 'Consumer CLI changed during verification');
  console.log(JSON.stringify({ status: 'verified', fixture: 'sqlite-same-relation-type-nullability-fk',
    producerVersion, consumerVersion, toolsSha256: tools, sqliteVersion: after.oracle.sqliteVersion,
    clientEvidence: 'declared-fixture', factsSha256: { before: digest(before.facts), after: digest(after.facts), clients: digest(clients) },
    changes: report.summary, evidence: { column: column.changes, relation: relation.changes },
    reviewCallers: { relation: relation.reviewCallers, column: column.reviewCallers }, complete: report.complete,
    freshness: report.scope.freshness, limitations: report.limitations,
    preparationMs: prepared - start, comparisonMs: performance.now() - prepared, totalMs: performance.now() - start }));
} finally {
  // 직접 만든 실제 임시 디렉터리만 정리한다. 실행 입력/설치 디렉터리는 건드리지 않는다.
  const checked = resolve(project);
  assert.ok(checked.startsWith(temporaryRoot + sep) && checked !== temporaryRoot &&
    basename(checked).startsWith('isthmus-db-contracts-'));
  rmSync(checked, { recursive: true, force: true });
}
