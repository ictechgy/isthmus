import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { capturePreflight } from './capture-preflight.mjs';
import {
  fixtureEnvironment, initHostileRepository, initPartialCloneWithPromisorMarker,
  initSuperprojectWithHostileSubmodule, markerKit, runGitWithoutLazyFetchControl,
} from './fixtures/git-isolation/hostile-repository.mjs';
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

test('스냅샷 없는 kartograph는 소스 스캔 bridge만 수집하고 Kotlin 선택은 스냅샷을 요구한다', async (t) => {
  const f = await setup(t);
  const config = { ...f.config, kartograph: ['kartograph'] };
  const kotlin = JSON.parse(JSON.stringify(fixture.bridges[1]).replaceAll('swift', 'kotlin')
    .replaceAll('.kotlin', '.kt').replaceAll('ios/', 'android/').replaceAll('s:', 'jvm:'));
  const execute = (command, args, options) => {
    if (command !== 'kartograph') return f.execute(command, args, options);
    f.calls.push([command, ...args]);
    if (args[0] === '--version') return { status: 0, stdout: 'kartograph 1.0.0\n' };
    assert.equal(args[0], 'bridges');
    assert.ok(!args.includes('--graph-file'));
    return { status: 0, stdout: JSON.stringify({ ...kotlin, project: f.root }) };
  };
  const scanned = await capturePreflight(config, { execute });
  assert.equal(scanned.cached, false);
  assert.ok(scanned.context.bridges.some(({ platform }) => platform === 'kotlin'));
  assert.ok(!scanned.context.analyses.some(({ platform }) => platform === 'kotlin'));
  await assert.rejects(capturePreflight({ ...config,
    selection: { kotlin: { files: ['android/Helper.kt'], symbols: [] } } }, { execute }), /snapshot/i);
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
  const gitCalls = [];
  // 하위 명령은 격리 설정(`-c` 쌍) 뒤에 온다.
  const subcommand = (args) => args.find((argument, index) => argument !== '-c' && args[index - 1] !== '-c');
  const execute = (command, args, options) => {
    if (command !== 'git') return f.execute(command, args, options);
    gitCalls.push(args);
    if (subcommand(args) === 'config') return { status: 0, stdout: 'core.bare\0filter.lfs.clean\0filter.lfs.required\0' };
    if (subcommand(args) === 'rev-parse') {
      assert.ok(args.includes('--end-of-options'));
      return { status: 0, stdout: `${'a'.repeat(40)}\n` };
    }
    if (subcommand(args) === 'diff') return { status: 0, stdout: 'M\0ios/Helper.swift\0R100\0lib/old.dart\0lib/bridge.dart\0M\0README.md\0' };
    if (subcommand(args) === 'ls-files') return { status: 0, stdout: 'lib/new.dart\0' };
    assert.fail('unexpected git call');
  };
  const result = await capturePreflight(config, { execute });
  assert.deepEqual(result.context.selection.dart.files, ['lib/bridge.dart', 'lib/new.dart', 'lib/old.dart']);
  assert.deepEqual(result.context.selection.swift.files, ['ios/Helper.swift']);
  assert.ok(result.report.limitations.some(({ message }) => message.includes('unmodeled-changes')));
  // 조회마다 바로 앞에서 설정 키를 다시 읽고, 그 순간의 드라이버를 빈 명령으로 덮는다.
  assert.deepEqual(gitCalls.map(subcommand), ['config', 'rev-parse', 'config', 'diff', 'config', 'ls-files']);
  for (const argument of ['core.fsmonitor=false', 'filter.lfs.clean=', 'filter.lfs.process=', 'filter.lfs.required=false',
    'diff.autoRefreshIndex=false', '--no-ext-diff', '--no-textconv', '--ignore-submodules=dirty']) {
    assert.ok(gitCalls[3].includes(argument), argument);
  }
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

/** git만 전역·시스템 설정 없이 실제로 실행하고 나머지 명령은 가짜 producer에 넘긴다. */
function realGit(f) {
  return (command, args, options) => (command === 'git'
    ? runChild(command, args, { ...options, env: fixtureEnvironment(options.env) }) : f.execute(command, args, options));
}

test('since의 git 조회는 분석 대상 저장소의 filter·fsmonitor·hook 설정을 실행하지 않는다', async (t) => {
  for (const attributes of ['tree', 'info']) {
    const f = await setup(t);
    const kit = await markerKit(t);
    await initHostileRepository(f.root, kit, { attributes, stale: ['lib/bridge.dart'] });
    await writeFile(join(f.root, 'ios/Helper.swift'), 'changed native');
    const { selection: _selection, ...rest } = f.config;
    const result = await capturePreflight({ ...rest, since: 'HEAD' }, { execute: realGit(f) });
    assert.deepEqual(await kit.found(), [], `${attributes} attributes`);
    assert.deepEqual(result.context.selection.swift.files, ['ios/Helper.swift']);
    // 격리한 diff는 index를 고쳐 쓰지 않으므로 stat만 바뀐 파일도 변경으로 고른다(빠뜨리지 않는 쪽).
    assert.deepEqual(result.context.selection.dart.files, ['lib/bridge.dart']);
  }
});

test('since는 명령줄로 덮을 수 없는 filter 드라이버 이름이 있으면 분석 조회 없이 실패한다', async (t) => {
  // '='는 git이 -c 값을 첫 '='에서 나누고, 잘못된 UTF-8은 같은 바이트로 인자에 되돌릴 수 없다.
  for (const driver of ['a=b', Buffer.from([0xff, 0xfe])]) {
    const f = await setup(t);
    const kit = await markerKit(t);
    await initHostileRepository(f.root, kit, { driver, stale: ['lib/bridge.dart'] });
    const { selection: _selection, ...rest } = f.config;
    await assert.rejects(capturePreflight({ ...rest, since: 'HEAD' }, { execute: realGit(f) }),
      /git cannot override a configured filter driver/u);
    assert.deepEqual(await kit.found(), []);
    assert.deepEqual(f.calls, [], 'No producer runs after the isolation failure.');
  }
});

test('since는 서브모듈에서 git을 띄우지 않고 기록된 commit 차이만 설정 변경으로 남긴다', async (t) => {
  const f = await setup(t);
  const kit = await markerKit(t);
  const moveSubmodule = await initSuperprojectWithHostileSubmodule(f.root, join(kit.scratch, 'origin'), kit);
  await writeFile(join(f.root, 'ios/Helper.swift'), 'changed native');
  const { selection: _selection, ...rest } = f.config;
  const first = await capturePreflight({ ...rest, since: 'HEAD' }, { execute: realGit(f) });
  assert.deepEqual(await kit.found(), []);
  assert.deepEqual(first.context.selection.swift.files, ['ios/Helper.swift']);
  assert.ok(!first.context.limitations.some((value) => value.startsWith('unmodeled-changes')));
  moveSubmodule();
  const second = await capturePreflight({ ...rest, since: 'HEAD' }, { execute: realGit(f) });
  assert.deepEqual(await kit.found(), []);
  assert.ok(second.context.limitations.includes('unmodeled-changes: 1 tracked configuration/resource change(s) require separate review'));
});

test('since는 부분 clone의 promisor lazy fetch로 저장소 설정의 명령을 실행하지 않고 실패한다', async (t) => {
  const f = await setup(t);
  const kit = await markerKit(t);
  const project = join(kit.scratch, 'project');
  const { base } = await initPartialCloneWithPromisorMarker(project, join(kit.scratch, 'origin'), kit);
  const { selection: _selection, ...rest } = f.config;
  // 빠진 base blob을 읽어야 rename을 알 수 있어 git이 promisor remote에서 lazy fetch를 띄우려 하지만, 격리가 fetch를
  // 막으므로 그 설정의 uploadpack 마커가 생기지 않고 조회가 실패한다(fail-closed).
  const config = { ...rest, project, since: base, output: join(project, 'context.json'),
    cache: join(project, 'cache.json'), toolInputs: [join(project, 'producer.txt')] };
  await assert.rejects(capturePreflight(config, { execute: realGit(f) }), /Preflight producer step failed: git-changes\./u);
  assert.deepEqual(await kit.found(), []);
  assert.deepEqual(f.calls, [], 'No producer runs after the isolation failure.');
});

test('since는 lazy fetch를 끄지 못하는 git(2.45 미만)에서 부분 clone이면 조회를 시작하지 않고, 아니면 그대로 조회한다', async (t) => {
  // git 2.45 미만은 GIT_NO_LAZY_FETCH를 무시한다. promisor 설정이 보이는 저장소는 --no-lazy-fetch를 붙여 그 git이 모르는
  // 옵션으로 바로 끝나게 하므로, 환경 변수만으로는 막히지 않던 lazy fetch(uploadpack 마커)가 돌지 않는다.
  const oldGit = (f, gitCalls) => (command, args, options) => {
    if (command !== 'git') return f.execute(command, args, options);
    gitCalls.push(args);
    return runGitWithoutLazyFetchControl(command, args, options);
  };
  const f = await setup(t);
  const kit = await markerKit(t);
  const project = join(kit.scratch, 'project');
  const { base } = await initPartialCloneWithPromisorMarker(project, join(kit.scratch, 'origin'), kit);
  const { selection: _selection, ...rest } = f.config;
  const config = { ...rest, project, since: base, output: join(project, 'context.json'),
    cache: join(project, 'cache.json'), toolInputs: [join(project, 'producer.txt')] };
  const partialCalls = [];
  await assert.rejects(capturePreflight(config, { execute: oldGit(f, partialCalls) }),
    /Preflight producer step failed: git-base\./u);
  assert.deepEqual(await kit.found(), []);
  assert.deepEqual(f.calls, [], 'No producer runs after the isolation failure.');
  assert.deepEqual(partialCalls.map((args) => args[0]), ['config', '--no-lazy-fetch']);
  // promisor 설정이 없는 저장소에는 옵션을 붙이지 않아 같은 git에서도 수집한다.
  const plain = await setup(t);
  await initHostileRepository(plain.root, kit, { stale: ['lib/bridge.dart'] });
  await writeFile(join(plain.root, 'ios/Helper.swift'), 'changed native');
  const { selection: _plainSelection, ...plainRest } = plain.config;
  const plainCalls = [];
  const result = await capturePreflight({ ...plainRest, since: 'HEAD' }, { execute: oldGit(plain, plainCalls) });
  assert.deepEqual(await kit.found(), []);
  assert.deepEqual(result.context.selection.swift.files, ['ios/Helper.swift']);
  assert.ok(plainCalls.length === 6 && !plainCalls.some((args) => args.includes('--no-lazy-fetch')));
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
