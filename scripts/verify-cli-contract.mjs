import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const binaryPath = fileURLToPath(new URL('../dist/cli/main.js', import.meta.url));
const dartPath = fileURLToPath(
  new URL('../experiments/phase-0/expected/dart.json', import.meta.url),
);
const swiftPath = fileURLToPath(
  new URL('../experiments/phase-0/expected/swift.json', import.meta.url),
);

verifyUsageError();
verifyInputError();
verifySuccessfulCheck();
verifyStrictFindings();
verifyRetentions();
verifyQuery();
verifyMissingQuery();
verifyGraph();
process.stdout.write('CLI contract verified: 0/1/2/64\n');

/** 인자 없는 호출이 사용 오류 64인지 검증한다. */
function verifyUsageError() {
  const result = run([]);
  verify(result.status === 64, 'usage exit code');
  verify(result.stdout === '', 'usage stdout');
  verify(result.stderr.startsWith('Usage: isthmus check'), 'usage stderr');
}

/** 읽을 수 없는 입력이 도구 실패 2인지 검증한다. */
function verifyInputError() {
  const result = run(['check', 'missing-dart.json', swiftPath]);
  verify(result.status === 2, 'input exit code');
  verify(result.stdout === '', 'input stdout');
  verify(result.stderr.startsWith('Unable to read or validate'), 'input stderr');
}

/** 기본 check가 보고서와 성공 0을 내는지 검증한다. */
function verifySuccessfulCheck() {
  const result = run(['check', dartPath, swiftPath]);
  verify(result.status === 0, 'success exit code');
  verify(result.stderr === '', 'success stderr');
  verify(JSON.parse(result.stdout).format === 'isthmus-check', 'success JSON');
}

/** strict check가 같은 보고서와 발견 1을 내는지 검증한다. */
function verifyStrictFindings() {
  const result = run(['check', dartPath, swiftPath, '--strict']);
  verify(result.status === 1, 'strict exit code');
  verify(result.stderr === '', 'strict stderr');
  verify(JSON.parse(result.stdout).summary.errors === 1, 'strict JSON');
}

/** retentions가 cartograph용 보존 문서를 내는지 검증한다. */
function verifyRetentions() {
  const result = run([
    'retentions',
    dartPath,
    swiftPath,
    '--for',
    'cartograph',
  ]);
  verify(result.status === 0, 'retentions exit code');
  verify(result.stderr === '', 'retentions stderr');
  const document = JSON.parse(result.stdout);
  verify(document.format === 'external-retentions', 'retentions JSON');
  verify(document.retentions.length === 1, 'retentions count');
}

/** query가 찾은 bridge subject를 JSON으로 내는지 검증한다. */
function verifyQuery() {
  const result = run(['query', 'takePhoto', dartPath, swiftPath]);
  verify(result.status === 0, 'query exit code');
  verify(result.stderr === '', 'query stderr');
  verify(JSON.parse(result.stdout).status === 'found', 'query JSON');
}

/** 없는 query subject가 notFound JSON과 64를 내는지 검증한다. */
function verifyMissingQuery() {
  const result = run(['query', 'missingMethod', dartPath, swiftPath]);
  verify(result.status === 64, 'missing query exit code');
  verify(result.stderr === '', 'missing query stderr');
  verify(JSON.parse(result.stdout).status === 'notFound', 'missing query JSON');
}

/** graph가 요청한 Mermaid 문서를 내는지 검증한다. */
function verifyGraph() {
  const result = run([
    'graph',
    dartPath,
    swiftPath,
    '--format',
    'mermaid',
  ]);
  verify(result.status === 0, 'graph exit code');
  verify(result.stderr === '', 'graph stderr');
  verify(result.stdout.startsWith('flowchart LR\n'), 'graph Mermaid');
}

/** 빌드된 CLI를 동기 실행해 세 스트림을 수집한다. */
function run(arguments_) {
  return spawnSync(process.execPath, [binaryPath, ...arguments_], {
    encoding: 'utf8',
  });
}

/** 계약 위반이면 민감정보 없는 검사 이름으로 실패한다. */
function verify(condition, name) {
  if (!condition) throw new Error(`CLI contract failed: ${name}`);
}
