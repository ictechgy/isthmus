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
  git(['add', 'lib', 'ios']);
  git(['commit', '-m', 'fixture']);
  git(['mv', 'lib/bridge.dart', 'lib/renamed.dart']);
  await writeFile(join(f.root, 'lib/new.dart'), 'new source');
  await writeFile(join(f.root, 'ios/Helper.swift'), 'changed native');
  const { selection: _selection, ...rest } = f.config;
  const result = await capturePreflight({ ...rest, since: 'HEAD' }, { execute: (command, args, options) =>
    command === 'git' ? git(args) : f.execute(command, args, options) });
  assert.deepEqual(result.context.selection.dart.files, ['lib/bridge.dart', 'lib/new.dart', 'lib/renamed.dart']);
  assert.deepEqual(result.context.selection.swift.files, ['ios/Helper.swift']);
});
