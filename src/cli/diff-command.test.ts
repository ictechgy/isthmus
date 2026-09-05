import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runDiffCommand } from './diff-command.ts';

test('diff는 실제 CLI에서 핸들러 삭제의 호출 근거와 새 오류를 보고한다', async () => {
  const root = await mkdtemp(join(tmpdir(), 'isthmus-diff-'));
  try {
    const docs = [document('dart'), document('swift'), document('dart'), document('swift', false)];
    const paths = docs.map((_, index) => join(root, `${index}.json`));
    await Promise.all(docs.map((doc, index) => writeFile(paths[index]!, JSON.stringify(doc))));
    const cli = fileURLToPath(new URL('./main.ts', import.meta.url));
    const result = spawnSync(process.execPath, [cli, 'diff', '--before', ...paths.slice(0, 2),
      '--after', ...paths.slice(2), '--strict'], { encoding: 'utf8', timeout: 10_000 });
    assert.equal(result.status, 1, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.format, 'isthmus-diff');
    assert.equal(report.removedMethods[0].method, 'capture');
    assert.equal(report.removedMethods[0].invocations[0].location.path, 'lib/camera.dart');
    assert.equal(report.introducedIssues[0].code, 'unhandled-invocation');
    assert.equal(report.summary.introducedErrors, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

const diffArgs = ['diff', '--before', 'old-dart', 'old-swift', '--after', 'new-dart', 'new-swift'];

async function compare(before = [document('dart'), document('swift')], after = before, strict = false) {
  const contents = new Map(['old-dart', 'old-swift', 'new-dart', 'new-swift']
    .map((path, index) => [path, JSON.stringify([...before, ...after][index])]));
  return runDiffCommand([...diffArgs, ...(strict ? ['--strict'] : [])], async (path) => contents.get(path)!);
}

test('줄 이동과 입력 순서 변화는 논리 연결 변경을 만들지 않는다', async () => {
  const before = [document('dart'), document('swift')];
  const after = before.map((doc) => ({ ...doc, facts: [...doc.facts].reverse().map((fact) => ({
    ...fact, location: { ...fact.location, line: fact.location.line + 10 },
  })) })).reverse();
  const result = await compare(before, after, true);
  assert.equal(result.exitCode, 0);
  const report = JSON.parse(result.standardOutput);
  assert.deepEqual(report.summary, { addedMethods: 0, removedMethods: 0, introducedErrors: 0,
    introducedWarnings: 0, resolvedIssues: 0 });
});

test('기존 오류는 strict를 실패시키지 않고 복구는 추가 연결과 resolved issue로 보고한다', async () => {
  const broken = [document('dart'), document('swift', false)];
  assert.equal((await compare(broken, broken, true)).exitCode, 0);
  const result = await compare(broken, [document('dart'), document('swift')], true);
  const report = JSON.parse(result.standardOutput);
  assert.equal(result.exitCode, 0);
  assert.equal(report.addedMethods[0].method, 'capture');
  assert.equal(report.resolvedIssues[0].code, 'unhandled-invocation');
});

test('호출 삭제는 경고이며 기본 diff는 새 오류가 있어도 성공한다', async () => {
  const result = await compare(undefined, [document('dart', false), document('swift')], true);
  const report = JSON.parse(result.standardOutput);
  assert.equal(result.exitCode, 0);
  assert.equal(report.summary.introducedWarnings, 1);
  assert.equal(report.introducedIssues[0].code, 'handler-without-invocation');
  assert.equal((await compare(undefined, [document('dart'), document('swift', false)])).exitCode, 0);
});

test('동적 전환은 분석 한계를 양 시점과 차이로 남기며 안전 판정을 하지 않는다', async () => {
  const old = document('dart');
  const current = { ...old, limitations: ['dynamic-method-names: 1'],
    facts: old.facts.map((fact) => ({ ...fact, dynamic: true })) };
  const result = await compare([old, document('swift')], [current, document('swift')]);
  const report = JSON.parse(result.standardOutput);
  assert.equal(report.removedMethods.length, 1);
  assert.ok(report.limitations.after.length > 0);
  assert.ok(report.limitations.added.some((item: {message: string}) => item.message.includes('dynamic-method-names')));
  assert.equal(report.safeToDelete, undefined);
  const reverse = JSON.parse((await compare([current, document('swift')], [old, document('swift')])).standardOutput);
  assert.ok(reverse.limitations.removed.length > 0);
});

test('project와 producer 구성 차이 및 혼합 target은 코드 삭제로 오인하지 않는다', async () => {
  const swift = document('swift');
  for (const changed of [
    { ...swift, project: '/other' },
    { ...swift, tool: { ...swift.tool, name: 'other' } },
    { ...swift, limitations: ['mixed-targets: flutter and react-native'] },
    { ...swift, target: 'react-native' },
    document('dart'),
  ]) {
    const result = await compare(undefined, [document('dart'), changed]);
    assert.equal(result.exitCode, 2);
    assert.equal(result.standardOutput, '');
  }
});

test('producer 버전 변화는 검토할 수 있도록 출력한다', async () => {
  const after = [document('dart'), document('swift')].map((doc) => ({ ...doc,
    tool: { ...doc.tool, version: '2.0.0' } }));
  const result = await compare(undefined, after);
  const report = JSON.parse(result.standardOutput);
  assert.equal(report.producers.before[0].version, '1.0.0');
  assert.equal(report.producers.after[0].version, '2.0.0');
  assert.equal(report.producers.before[0].generatedAt, '2026-09-05T00:00:00.000Z');
});

test('중복 호출·핸들러 개수 변화는 같은 논리 연결을 제거하지 않는다', async () => {
  const base = [document('dart'), document('swift')];
  const duplicate = base.map((doc) => ({ ...doc, facts: [...doc.facts, ...doc.facts.map((fact) => ({
    ...fact, location: { ...fact.location, line: 20 },
  }))] }));
  const report = JSON.parse((await compare(duplicate, base, true)).standardOutput);
  assert.equal(report.summary.removedMethods, 0);
  assert.equal(report.summary.addedMethods, 0);
  assert.deepEqual(report.introducedIssues, []);
  const reversed = JSON.parse((await compare(base, duplicate, true)).standardOutput);
  assert.deepEqual(reversed.summary, report.summary);
});

test('생성 시각이 revision 순서와 달라도 방향을 추측하지 않고 두 시각을 제공한다', async () => {
  const laterGenerated = [document('dart'), document('swift')].map((doc) => ({ ...doc,
    generatedAt: '2026-09-06T00:00:00.000Z' }));
  const result = await compare(laterGenerated, [document('dart'), document('swift', false)], true);
  const report = JSON.parse(result.standardOutput);
  assert.equal(result.exitCode, 1);
  assert.equal(report.producers.before[0].generatedAt, '2026-09-06T00:00:00.000Z');
  assert.equal(report.producers.after[0].generatedAt, '2026-09-05T00:00:00.000Z');
});

test('완전히 빈 수신 문서도 producer가 명시돼 있으면 제거를 비교한다', async () => {
  const empty = { ...document('swift'), target: null, facts: [] };
  const result = await runDiffCommand(diffArgs, async (path) => JSON.stringify(
    path === 'new-swift' ? empty : document(path.endsWith('dart') ? 'dart' : 'swift'),
  ));
  const report = JSON.parse(result.standardOutput);
  assert.equal(result.exitCode, 0);
  assert.equal(report.removedMethods.length, 1);
  assert.equal(report.summary.introducedErrors, 2);
});

test('다른 수신 플랫폼이 Swift 핸들러 삭제를 가리지 않도록 혼합 플랫폼을 거부한다', async () => {
  const args = ['diff', '--before', 'a', 'b', 'k', '--after', 'a', 'b', 'k'];
  const result = await runDiffCommand(args, async (path) => JSON.stringify(path === 'k'
    ? { ...document('swift'), platform: 'kotlin', tool: { name: 'kartograph', version: '1.0.0' } }
    : document(path === 'a' ? 'dart' : 'swift')));
  assert.equal(result.exitCode, 2);
  assert.equal(result.standardOutput, '');
});

test('--strict은 마지막이 아닌 인자 위치에서도 새 오류를 실패로 만든다', async () => {
  const before = [document('dart'), document('swift')];
  const after = [document('dart'), document('swift', false)];
  const contents = new Map(['old-dart', 'old-swift', 'new-dart', 'new-swift']
    .map((path, index) => [path, JSON.stringify([...before, ...after][index])]));
  const result = await runDiffCommand(
    ['diff', '--strict', '--before', 'old-dart', 'old-swift', '--after', 'new-dart', 'new-swift'],
    async (path) => contents.get(path)!,
  );
  assert.equal(result.exitCode, 1);
  assert.equal(JSON.parse(result.standardOutput).summary.introducedErrors, 1);
});

test('project 불일치는 diff 전용 구성 오류와 다른 원인 메시지를 낸다', async () => {
  const before = [document('dart'), document('swift')];
  const after = [{ ...document('dart'), project: '/other' }, document('swift')];
  const contents = new Map(['old-dart', 'old-swift', 'new-dart', 'new-swift']
    .map((path, index) => [path, JSON.stringify([...before, ...after][index])]));
  const result = await runDiffCommand(diffArgs, async (path) => contents.get(path)!);
  assert.equal(result.exitCode, 2);
  assert.ok(result.standardError.startsWith('Diff requires the same project'));
});

test('mixed-targets diff는 보류된 조인 메시지로 진단한다', async () => {
  const before = [document('dart'), document('swift')];
  const after = [document('dart'),
    { ...document('swift'), limitations: ['mixed-targets: flutter and react-native'] }];
  const contents = new Map(['old-dart', 'old-swift', 'new-dart', 'new-swift']
    .map((path, index) => [path, JSON.stringify([...before, ...after][index])]));
  const result = await runDiffCommand(diffArgs, async (path) => contents.get(path)!);
  assert.equal(result.exitCode, 2);
  assert.equal(result.standardOutput, '');
  assert.ok(result.standardError.startsWith('Cannot compare deferred bridge joins'));
});

test('잘못된 diff 인자와 총 파일 수 초과는 읽기 전에 거부한다', async () => {
  for (const args of [[], ['check', ...diffArgs.slice(1)], ['diff'],
    ['diff', '--before', 'one', '--after', 'two', 'three'],
    [...diffArgs, '--unknown'], [...diffArgs, '--strict', '--strict'],
    [...diffArgs, ''], [...diffArgs, ...Array(253).fill('extra')]]) {
    const result = await runDiffCommand(args, async () => { assert.fail('unexpected read'); });
    assert.equal(result.exitCode, 64);
  }
});

test('읽기·JSON 실패는 민감한 경로를 출력하지 않고 원인을 구분한다', async () => {
  const readFailure = await runDiffCommand(diffArgs, async () => {
    throw new Error('/secret/path');
  });
  assert.equal(readFailure.exitCode, 2);
  assert.equal(readFailure.standardOutput, '');
  assert.equal(readFailure.standardError.includes('/secret'), false);
  assert.ok(readFailure.standardError.startsWith('Unable to read bridge facts input 1'));

  const jsonFailure = await runDiffCommand(diffArgs, async () => '{private');
  assert.equal(jsonFailure.exitCode, 2);
  assert.equal(jsonFailure.standardOutput, '');
  assert.equal(jsonFailure.standardError.includes('private'), false);
  assert.ok(jsonFailure.standardError.startsWith('Bridge facts input 1 is not valid JSON'));

  const result = await runDiffCommand(diffArgs, async () => undefined as unknown as string);
  assert.equal(result.exitCode, 2);
  assert.ok(result.standardError.startsWith('Internal'));
});

test('큰 입력은 다음 파일을 읽지 않는다', async () => {
  let reads = 0;
  const result = await runDiffCommand(diffArgs, async () => {
    reads++;
    return ' '.repeat(16 * 1024 * 1024 + 1);
  });
  assert.equal(result.exitCode, 2);
  assert.equal(reads, 1);
});

function document(platform: 'dart' | 'swift', handler = true) {
  return {
    format: 'bridge-facts', version: 1, platform, target: 'flutter', project: '/fixture',
    tool: { name: platform === 'dart' ? 'dartograph' : 'cartograph', version: '1.0.0' },
    generatedAt: '2026-09-05T00:00:00.000Z', limitations: [] as string[],
    facts: [
      { kind: platform === 'dart' ? 'channel-create' : 'channel-register', channel: 'camera',
        dynamic: false, location: { path: 'channel.txt', line: 1, column: 1 } },
      ...(handler ? [{ kind: platform === 'dart' ? 'method-invoke' : 'method-handle',
        channel: 'camera', method: 'capture', dynamic: false,
        location: { path: platform === 'dart' ? 'lib/camera.dart' : 'Camera.swift', line: 2, column: 1 } }] : []),
    ],
  };
}
