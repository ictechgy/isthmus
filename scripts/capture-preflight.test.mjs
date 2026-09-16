import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { capturePreflight } from './capture-preflight.mjs';
import { runChild } from './run-child.mjs';

const fixture = JSON.parse(await readFile(new URL('../fixtures/preflight/context.json', import.meta.url), 'utf8'));

async function setup(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'isthmus-capture-test-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'lib'));
  await mkdir(join(root, 'ios'));
  await writeFile(join(root, 'lib/bridge.dart'), 'source');
  await writeFile(join(root, 'ios/Helper.swift'), 'source');
  await writeFile(join(root, 'producer.txt'), 'producer implementation');
  const calls = [];
  const config = { project: root, inputs: ['lib', 'ios'], toolInputs: [join(root, 'producer.txt')],
    prepare: [['prepare']], dartograph: ['dartograph'], cartograph: ['cartograph'],
    selection: fixture.selection, output: join(root, 'context.json'), cache: join(root, 'cache.json') };
  const execute = (command, args) => {
    calls.push([command, ...args]);
    if (command === 'prepare') return { status: 0, stdout: '' };
    if (args[0] === '--version') return { status: 0, stdout: command === 'dartograph' ? 'dartograph 1.0.0\n' : '1.0.0\n' };
    let document;
    if (args[0] === 'bridges') document = { ...fixture.bridges[command === 'dartograph' ? 0 : 1], project: root };
    if (args[0] === 'query') document = { format: 'symbol-query-batch', version: 1, results: [{ status: 'found', requested: 'Bridge.photo', limitations: [],
      result: { subject: { usr: 'dart:photo', qualifiedName: 'dart:photo', location: { path: 'project:lib/bridge.dart', line: 2, column: 1 } } } }] };
    if (args[0] === 'impact' && command === 'cartograph') {
      assert.ok(Number(args[args.indexOf('--limit') + 1]) <= 10000, 'Cartograph result limit');
      document = {
      format: 'change-impact', version: 1, level: 'symbol', selectionIssues: [], runtimeReview: [], runtimeDependencies: [],
      changeScope: [{ usr: 's:helper', qualifiedName: 'Helper.read', location: { path: `${root}/ios/Helper.swift`, line: 1, column: 1 } }],
      affected: [{ symbol: { usr: 's:handler', qualifiedName: 'Handler.handle', location: { path: `${root}/ios/Handler.swift`, line: 1, column: 1 } }, depth: 1, via: 's:helper', relationship: 'call', edges: ['call'] }],
      limitations: [], truncated: { depth: false, output: false, sections: [] } };
    }
    if (args[0] === 'impact' && command === 'dartograph') document = {
      version: 1, changed: { symbols: ['dart:photo'], libraries: [], sources: [], unattributedSources: [] },
      impacted: [{ id: 'dart:screen', depth: 1, kind: 'declaration', path: ['dart:screen', 'dart:photo'], source: 'lib/screen.dart', line: 5, column: 1 }],
      limitations: [], missingSymbols: [], truncated: 0 };
    assert.ok(document, `unexpected command: ${command} ${args[0]}`);
    return { status: 0, stdout: JSON.stringify(document) };
  };
  return { root, config, calls, execute };
}

test('수집 workflow는 실제 명령 인자로 전이 입력을 만들고 동일 입력에서 캐시를 재사용한다', async (t) => {
  const f = await setup(t);
  const first = await capturePreflight(f.config, { execute: f.execute });
  assert.equal(first.cached, false);
  assert.ok(first.report.reviewFiles.includes('lib/screen.dart'));
  assert.ok(first.context.bindings.every(({ symbol }) => symbol.id === 'dart:photo'));
  assert.ok(f.calls.some(([command, operation]) => command === 'dartograph' && operation === 'impact'));
  await rm(`${f.config.output}.sources.json`);
  f.calls.length = 0;
  const second = await capturePreflight(f.config, { execute: f.execute });
  assert.equal(second.cached, true);
  assert.equal(second.context.revision, first.context.revision);
  assert.equal(JSON.parse(await readFile(`${f.config.output}.sources.json`, 'utf8')).revision, second.context.revision);
  assert.ok(f.calls.every(([, operation]) => operation === '--version'));
});

test('같은 이름의 Dart 후보는 정확한 ID를 재조회해 관찰한 파일에서만 바인딩한다', async (t) => {
  const f = await setup(t);
  const execute = async (command, args, options) => {
    if (args[0] !== 'query') return f.execute(command, args, options);
    f.calls.push([command, ...args]);
    const requests = JSON.parse(await readFile(args[args.indexOf('--batch') + 1], 'utf8'));
    const results = requests.map((requested) => requested === 'Bridge.photo'
      ? { requested, status: 'ambiguous', candidates: [
        { usr: 'dart:photo', qualifiedName: 'Bridge.photo' }, { usr: 'test:photo', qualifiedName: 'Bridge.photo' },
      ] }
      : { requested, status: 'found', result: { subject: { usr: requested, qualifiedName: requested,
        location: { path: requested === 'dart:photo' ? 'project:lib/bridge.dart' : 'project:test/bridge.dart', line: 2, column: 1 } } } });
    return { status: requests[0] === 'Bridge.photo' ? 64 : 0,
      stdout: JSON.stringify({ format: 'symbol-query-batch', version: 1, results }) };
  };
  const result = await capturePreflight(f.config, { execute });
  assert.ok(result.context.bindings.length > 0);
  assert.ok(result.context.bindings.every(({ symbol }) => symbol.id === 'dart:photo'));
  assert.ok(result.report.reviewFiles.includes('lib/screen.dart'));
  const sources = JSON.parse(await readFile(`${f.config.output}.sources.json`, 'utf8'));
  assert.ok(sources.artifacts['bindings-candidates-0']);
  await writeFile(join(f.root, 'producer.txt'), 'ambiguous producer revision');
  const conflicting = await capturePreflight(f.config, { execute: async (command, args, options) => {
    const response = await execute(command, args, options);
    if (args[0] !== 'query') return response;
    const document = JSON.parse(response.stdout);
    for (const row of document.results) if (row.status === 'found') row.result.subject.location.path = 'project:lib/bridge.dart';
    return { ...response, stdout: JSON.stringify(document) };
  } });
  assert.deepEqual(conflicting.context.bindings, [], 'Two identities in the same fact file remain unresolved.');
  await writeFile(join(f.root, 'producer.txt'), 'candidate resolution revision');
  const disappeared = await capturePreflight(f.config, { execute: async (command, args, options) => {
    const response = await execute(command, args, options);
    if (args[0] !== 'query') return response;
    const document = JSON.parse(response.stdout);
    for (const row of document.results) if (row.status === 'found') { row.status = 'notFound'; row.result = null; }
    return { ...response, stdout: JSON.stringify(document) };
  } });
  assert.deepEqual(disappeared.context.bindings, []);
  assert.ok(disappeared.context.limitations.some((value) => value.startsWith('unresolved-dart-candidates: 2 ')));
  const cached = await capturePreflight(f.config, { execute: f.execute });
  assert.equal(cached.cached, true);
  assert.deepEqual(cached.context.limitations, disappeared.context.limitations);
});

test('Android만 설정해도 Kotlin snapshot과 bridge를 수집하고 snapshot 변경 시 캐시를 버린다', async (t) => {
  const f = await setup(t);
  await mkdir(join(f.root, 'android'));
  await writeFile(join(f.root, 'android/Helper.kt'), 'class Helper');
  const snapshot = join(f.root, 'kotlin.snapshot.json');
  await writeFile(snapshot, '{"revision":"first"}');
  const config = { ...f.config, cartograph: undefined, kartograph: ['kartograph'], kartographSnapshot: snapshot,
    selection: { kotlin: { files: ['android/Helper.kt'], symbols: [] } }, inputs: ['lib', 'android'] };
  const kotlin = JSON.parse(JSON.stringify(fixture.bridges[1]).replaceAll('swift', 'kotlin')
    .replaceAll('.kotlin', '.kt').replaceAll('ios/', 'android/').replaceAll('s:', 'jvm:'));
  const node = (id, name) => ({ usr: id, qualifiedName: `${name}.read`, kind: 'method',
    location: { path: `android/${name}.kt`, line: 1, column: 1 }, presentIn: ['current'], paths: [] });
  const execute = (command, args, options) => {
    if (command !== 'kartograph') return f.execute(command, args, options);
    f.calls.push([command, ...args]);
    if (args[0] === '--version') return { status: 0, stdout: 'kartograph 1.0.0\n' };
    assert.ok(args.includes('--graph-file'));
    assert.equal(args[args.indexOf('--graph-file') + 1], snapshot);
    if (args[0] === 'bridges') return { status: 0, stdout: JSON.stringify({ ...kotlin, project: f.root }) };
    assert.equal(args[0], 'impact');
    assert.equal(args[args.indexOf('--file') + 1], 'android/Helper.kt');
    return { status: 0, stdout: JSON.stringify({ format: 'kartograph-impact', version: 1, status: 'found',
      inputs: { current: {} }, changed: [node('jvm:helper', 'Helper')], affected: [{ ...node('jvm:handler', 'Handler'),
        qualifiedName: 'Handler.handle', paths: [{ revision: 'current', changed: 'jvm:helper',
          nodes: ['jvm:handler', 'jvm:helper'], edges: [{ source: 'jvm:handler', target: 'jvm:helper',
            kind: 'call', origin: 'bytecode', traversal: 'dependency' }] }] }], unresolved: [], limitations: [],
      truncated: { results: false, depth: false, budget: false } }) };
  };
  const first = await capturePreflight(config, { execute });
  assert.equal(first.cached, false);
  assert.ok(first.report.reviewFiles.includes('lib/screen.dart'));
  assert.ok(first.context.analyses.some(({ platform }) => platform === 'kotlin'));
  assert.ok(!f.calls.some(([command]) => command === 'cartograph'));
  f.calls.length = 0;
  const second = await capturePreflight(config, { execute });
  assert.equal(second.cached, true);
  assert.ok(f.calls.every(([, operation]) => operation === '--version'));
  await writeFile(snapshot, '{"revision":"second"}');
  const third = await capturePreflight(config, { execute });
  assert.equal(third.cached, false);
  assert.notEqual(third.context.revision, first.context.revision);
  const messages = await capturePreflight({ ...config, messages: true }, { execute: (command, args, options) => {
    if (args[0] !== 'bridges' || !args.includes('--messages')) return execute(command, args, options);
    const native = command === 'kartograph';
    return { status: 0, stdout: JSON.stringify({ format: 'bridge-facts', version: 2,
      transport: 'basic-message-channel', platform: native ? 'kotlin' : 'dart', target: 'flutter', project: f.root,
      generatedAt: '2026-09-14T00:00:00Z', tool: { name: command, version: '1.0.0' }, limitations: [],
      facts: [{ kind: native ? 'message-handle' : 'message-send', channel: 'camera.basic', dynamic: false,
        location: { path: native ? 'android/Handler.kt' : 'lib/bridge.dart', line: 4, column: 1 },
        symbol: native ? { qualifiedName: 'Handler.handle', usr: 'jvm:handler' } : { qualifiedName: 'Bridge.photo' } }] }) };
  } });
  assert.equal(messages.cached, false);
  assert.deepEqual(messages.context.messages.map(({ platform }) => platform), ['dart', 'kotlin']);
  assert.ok(messages.report.boundaries.some(({ subject }) => subject.transport === 'basic-message-channel'));
  const events = await capturePreflight({ ...config, events: true }, { execute: async (command, args, options) => {
    if (args[0] === 'query' && command === 'dartograph') {
      const requests = JSON.parse(await readFile(args[args.indexOf('--batch') + 1], 'utf8'));
      return { status: 0, stdout: JSON.stringify({ format: 'symbol-query-batch', version: 1,
        results: requests.map((requested) => ({ requested, status: 'found', limitations: [],
          result: { subject: { usr: `dart:${requested}`, qualifiedName: `dart:${requested}`,
            location: { path: 'project:lib/bridge.dart', line: 2, column: 1 } } } })) }) };
    }
    if (args[0] === 'impact' && command === 'dartograph' && args.includes('--symbol')) {
      const trigger = args[args.indexOf('--symbol') + 1];
      return { status: 0, stdout: JSON.stringify({ version: 1,
        changed: { symbols: [trigger], libraries: [], sources: [], unattributedSources: [] },
        impacted: [], limitations: [], missingSymbols: [], truncated: 0 }) };
    }
    if (args[0] !== 'bridges' || !args.includes('--events')) return execute(command, args, options);
    const native = command === 'kartograph';
    return { status: 0, stdout: JSON.stringify({ format: 'bridge-facts', version: 2,
      transport: 'event-channel', platform: native ? 'kotlin' : 'dart', target: 'flutter', project: f.root,
      generatedAt: '2026-09-14T00:00:00Z', tool: { name: command, version: '1.0.0' }, limitations: [],
      facts: [{ kind: native ? 'stream-handle' : 'stream-listen', channel: 'charging', dynamic: false,
        location: { path: native ? 'android/Handler.kt' : 'lib/stream.dart', line: 4, column: 1 },
        symbol: native ? { qualifiedName: 'Handler.handle', usr: 'jvm:handler' } : { qualifiedName: 'Stream.states' } }] }) };
  } });
  assert.equal(events.cached, false);
  assert.deepEqual(events.context.messages.map(({ platform }) => platform), ['dart', 'kotlin']);
  assert.ok(events.report.boundaries.some(({ subject }) => subject.transport === 'event-channel' && subject.channel === 'charging'));
  await assert.rejects(capturePreflight({ ...config, kartographSnapshot: undefined }, { execute }), /snapshot/i);
});

test('코드·producer 변경과 소스 삭제는 이전 근거를 재사용하지 않는다', async (t) => {
  const f = await setup(t);
  let previous = await capturePreflight(f.config, { execute: f.execute });
  for (const change of [
    () => writeFile(join(f.root, 'lib/bridge.dart'), 'changed source'),
    () => writeFile(join(f.root, 'producer.txt'), 'changed producer'),
    () => rm(join(f.root, 'lib/bridge.dart')),
  ]) {
    await change();
    const next = await capturePreflight(f.config, { execute: f.execute });
    assert.equal(next.cached, false);
    assert.notEqual(next.context.revision, previous.context.revision);
    previous = next;
  }
});

test('수집 도중 입력이 바뀌거나 producer가 실패하면 이전 결과를 덮어쓰지 않는다', async (t) => {
  const f = await setup(t);
  await capturePreflight(f.config, { execute: f.execute });
  const before = await readFile(f.config.output, 'utf8');
  await writeFile(join(f.root, 'lib/bridge.dart'), 'changed');
  await assert.rejects(capturePreflight(f.config, { execute: () => ({ status: 2, stdout: 'private', stderr: 'private' }) }), /producer|version/i);
  const execute = async (command, args, options) => {
    const result = f.execute(command, args, options);
    if (args[0] === 'query') await writeFile(join(f.root, 'lib/bridge.dart'), 'changed during capture');
    return result;
  };
  await assert.rejects(capturePreflight(f.config, { execute }), /changed during capture/);
  assert.equal(await readFile(f.config.output, 'utf8'), before);
});

test('변조된 캐시와 다른 파일의 caller query는 근거로 쓰지 않는다', async (t) => {
  const f = await setup(t);
  await capturePreflight(f.config, { execute: f.execute });
  const cache = JSON.parse(await readFile(f.config.cache, 'utf8'));
  cache.context.revision = 'tampered';
  await writeFile(f.config.cache, JSON.stringify(cache));
  const execute = (command, args, options) => {
    const result = f.execute(command, args, options);
    if (args[0] === 'query') {
      const doc = JSON.parse(result.stdout);
      doc.results[0].result.subject.location.path = 'project:lib/other.dart';
      return { ...result, stdout: JSON.stringify(doc) };
    }
    return result;
  };
  const result = await capturePreflight(f.config, { execute });
  assert.equal(result.cached, false);
  assert.equal(result.context.bindings.length, 0);
  assert.ok(result.report.limitations.some(({ code }) => code === 'unresolved-bridge-binding'));
});

test('CI git 선택은 rename 양쪽·추적되지 않은 소스를 포함하고 설정 변경을 검토로 남긴다', async (t) => {
  const f = await setup(t);
  const { selection: _selection, ...rest } = f.config;
  const config = { ...rest, since: 'HEAD~1' };
  const execute = (command, args, options) => {
    if (command !== 'git') return f.execute(command, args, options);
    if (args[0] === 'rev-parse') {
      assert.ok(args.includes('--end-of-options'));
      return { status: 0, stdout: `${'a'.repeat(40)}\n` };
    }
    if (args[0] === 'diff') return { status: 0, stdout: 'M\0ios/Helper.swift\0R100\0lib/old.dart\0lib/bridge.dart\0M\0README.md\0' };
    if (args[0] === 'ls-files') return { status: 0, stdout: 'lib/new.dart\0' };
    assert.fail('unexpected git call');
  };
  const result = await capturePreflight(config, { execute });
  assert.deepEqual(result.context.selection.dart.files, ['lib/bridge.dart', 'lib/new.dart', 'lib/old.dart']);
  assert.deepEqual(result.context.selection.swift.files, ['ios/Helper.swift']);
  assert.ok(result.report.limitations.some(({ message }) => message.includes('unmodeled-changes')));
});

test('실제 Git 작업 트리의 변경 목록을 CI 수집 선택으로 사용한다', async (t) => {
  const f = await setup(t);
  const git = (args) => {
    const result = runChild('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false',
      '-c', 'user.name=Isthmus Fixture', '-c', 'user.email=fixture@isthmus.invalid', ...args],
    { cwd: f.root, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
    assert.equal(result.status, 0, `git ${args[0]}`);
    return result;
  };
  git(['init', '--template=', '--initial-branch=fixture']);
  await mkdir(join(f.root, 'android'));
  await writeFile(join(f.root, 'android/Before.kt'), 'class Before');
  git(['add', 'lib', 'ios', 'android']);
  git(['commit', '-m', 'fixture']);
  git(['mv', 'lib/bridge.dart', 'lib/renamed.dart']);
  git(['mv', 'android/Before.kt', 'android/After.kt']);
  await writeFile(join(f.root, 'lib/new.dart'), 'new source');
  await writeFile(join(f.root, 'ios/Helper.swift'), 'changed native');
  const { selection: _selection, ...rest } = f.config;
  const result = await capturePreflight({ ...rest, since: 'HEAD' }, { execute: (command, args, options) =>
    command === 'git' ? git(args) : f.execute(command, args, options) });
  assert.deepEqual(result.context.selection.dart.files, ['lib/bridge.dart', 'lib/new.dart', 'lib/renamed.dart']);
  assert.deepEqual(result.context.selection.swift.files, ['ios/Helper.swift']);
  assert.equal(result.context.selection.kotlin, undefined);
  assert.ok(result.context.limitations.some((value) => value.startsWith('unconfigured-platform-changes: 2 kotlin')));
});

test('선택한 v2 message producer는 같은 capture에 포함되고 캐시 설정을 구분한다', async (t) => {
  const f = await setup(t);
  const execute = (command, args, options) => {
    if (args[0] === 'bridges' && args.includes('--messages')) {
      const platform = command === 'dartograph' ? 'dart' : 'swift';
      const source = fixture.bridges[platform === 'dart' ? 0 : 1];
      return { status: 0, stdout: JSON.stringify({ ...source, project: f.root, version: 2,
        transport: 'basic-message-channel', facts: source.facts.filter(({ kind }) => kind.startsWith('method-')).map(({ method, ...fact }) => ({
          ...fact, kind: platform === 'dart' ? 'message-send' : 'message-handle',
        })) }) };
    }
    return f.execute(command, args, options);
  };
  const before = await capturePreflight(f.config, { execute });
  const result = await capturePreflight({ ...f.config, messages: true }, { execute });
  assert.equal(result.cached, false);
  assert.notEqual(result.context.revision, before.context.revision);
  assert.equal(result.context.messages.length, 2);
  assert.ok(result.report.boundaries.some(({ subject }) => subject.transport === 'basic-message-channel'));
  assert.equal((await capturePreflight({ ...f.config, messages: true }, { execute })).cached, true);
  await assert.rejects(capturePreflight({ ...f.config, messages: { kotlin: ['ignored'] } }, { execute }));
});

test('Cartograph가 미인덱스 선택에 64와 부분 문서를 돌려주면 한계로 수집한다', async (t) => {
  const f = await setup(t);
  const execute = (command, args, options) => {
    if (command === 'cartograph' && args[0] === 'impact') {
      return { status: 64, stdout: JSON.stringify({
        format: 'change-impact', version: 1, level: 'symbol', status: 'incomplete',
        selectionIssues: [{ kind: 'file', requested: `${f.root}/ios/Helper.swift`, status: 'unindexed' }],
        runtimeReview: [], runtimeDependencies: [], changeScope: [], affected: [],
        limitations: ['objective-c-sources: 1 file(s) are not analysed'],
        truncated: { depth: false, output: false, sections: [] } }) };
    }
    return f.execute(command, args, options);
  };
  const result = await capturePreflight(f.config, { execute });
  const analysis = result.context.analyses.find(({ platform }) => platform === 'swift');
  assert.ok(analysis, 'Swift analysis must exist');
  assert.ok(analysis.limitations.some((value) => value.startsWith('cartograph-selection-issues')));
  assert.equal(analysis.roots.length, 0);
});
