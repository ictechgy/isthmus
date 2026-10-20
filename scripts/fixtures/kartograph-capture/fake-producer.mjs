// 프로세스 계약용 double이다. 컴파일 성공/실제 Kartograph 검증 증거가 아니다.
import { readFileSync, writeFileSync } from 'node:fs';
const control = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const command = process.argv[3];
if (control.failAt === command) process.exit(2);
const tool = { name: 'kartograph', version: '0.25.1' };
const usr = 'method:p/Repo#query()Ljava/lang/String;';
if (command === '--version') process.stdout.write('kartograph 0.25.1\n');
else if (command === 'verify-snapshot') {
  const changed = readFileSync(control.source, 'utf8') !== 'source' ? ['changed-sources'] : [];
  const reasons = control.unknown ? ['missing-external-input'] : changed;
  process.stdout.write(JSON.stringify({ format: 'kartograph-freshness', version: 1,
    status: control.unknown ? 'unverified' : changed.length ? 'stale' : 'matched', reasons }));
  process.exitCode = reasons.length ? 1 : 0;
} else if (command === 'schema') {
  if (control.mutateSnapshot) writeFileSync(control.snapshot, readFileSync(control.snapshot, 'utf8') + '\n');
  process.stdout.write(JSON.stringify({ format: 'bridge-facts', version: 1, tool, platform: 'kotlin',
    target: 'persistence', project: control.project, generatedAt: '2026-10-20T00:00:00Z', limitations: [],
    facts: [{ kind: 'relation-use', channel: 'users', dynamic: false,
      location: { path: 'Repo.java', line: 1, column: 1 }, symbol: { usr, qualifiedName: 'p.Repo.query' } }] }));
} else if (command === 'impact') {
  const at = process.argv.indexOf('--roots-from');
  const roots = JSON.parse(readFileSync(process.argv[at + 1], 'utf8'));
  process.stdout.write(JSON.stringify({ format: 'language-traversal', version: 1, tool, platform: 'kotlin',
    direction: 'dependents', project: control.project, generatedAt: '2026-10-20T00:00:00Z', limitations: [],
    roots: roots.map(id => ({ id, symbol: { usr: id } })), reached: [], truncated: false }));
} else process.exit(64);
