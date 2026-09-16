import assert from 'node:assert/strict';
import test from 'node:test';
import { parseBridgeFactsDocument } from '../exchange/parse.ts';
import {
  type ExtractJsFileSystem,
  runExtractJsCommand,
} from './extract-js-command.ts';

/** 가상 파일시스템 — 경로 → 파일 텍스트, 디렉터리 → 자식 이름 목록. */
function fakeFs(
  files: ReadonlyMap<string, string>,
  directories: ReadonlyMap<string, readonly string[]>,
): ExtractJsFileSystem {
  return {
    statPath: async (path) =>
      directories.has(path) ? 'directory'
        : files.has(path) ? 'file' : 'missing',
    listDirectory: async (path) => {
      const children = directories.get(path);
      if (children === undefined) throw new Error('not a directory');
      return children.map((name) => {
        const child = `${path}/${name}`;
        return {
          name,
          isFile: files.has(child),
          isDirectory: directories.has(child),
        };
      });
    },
    realPath: async (path) => path,
  };
}

const fixedNow = () => new Date('2026-01-01T00:00:00.000Z');

const readerFor = (files: ReadonlyMap<string, string>) =>
  async (path: string) => {
    const text = files.get(path);
    if (text === undefined) throw new Error('private path');
    return text;
  };

test('디렉터리 입력을 걸어 bridge-facts 문서를 stdout에 쓴다', async () => {
  const files = new Map([
    ['/proj/src/app.ts', "const M = requireNativeModule('Cam');\nM.shoot();"],
    ['/proj/src/skip.md', "requireNativeModule('NotScanned');"],
    ['/proj/node_modules/pkg/index.js', "requireNativeModule('Dep');"],
    ['/proj/.hidden/x.ts', "requireNativeModule('Hidden');"],
  ]);
  const dirs = new Map<string, readonly string[]>([
    ['/proj', ['src', 'node_modules', '.hidden']],
    ['/proj/src', ['app.ts', 'skip.md']],
    ['/proj/node_modules', ['pkg']],
    ['/proj/node_modules/pkg', ['index.js']],
    ['/proj/.hidden', ['x.ts']],
  ]);
  const result = await runExtractJsCommand(
    ['extract-js', '/proj'], fakeFs(files, dirs), readerFor(files),
    fixedNow, '1.0.0',
  );
  assert.equal(result.exitCode, 0);
  const document = parseBridgeFactsDocument(JSON.parse(result.standardOutput));
  assert.equal(document.platform, 'js');
  assert.equal(document.target, 'react-native');
  // node_modules·숨김 디렉터리·비JS 파일은 걸리지 않는다.
  assert.deepEqual(
    document.facts.map((fact) => [fact.kind, fact.channel, fact.method ?? null]),
    [
      ['module-import', 'Cam', null],
      ['method-invoke', 'Cam', 'shoot'],
    ],
  );
  assert.equal(document.facts[0]?.location.path, 'src/app.ts');
});

test('파일 입력과 --project 루트를 함께 지원한다', async () => {
  const files = new Map([
    ['/repo/app/src/main.ts', "requireNativeComponent('Grid');"],
  ]);
  const dirs = new Map<string, readonly string[]>([['/repo', []]]);
  const result = await runExtractJsCommand(
    ['extract-js', '/repo/app/src/main.ts', '--project', '/repo'],
    fakeFs(files, dirs), readerFor(files), fixedNow, '1.0.0',
  );
  assert.equal(result.exitCode, 0);
  const document = parseBridgeFactsDocument(JSON.parse(result.standardOutput));
  assert.equal(document.facts[0]?.location.path, 'app/src/main.ts');
});

test('잘못된 호출은 사용법과 코드 64다', async () => {
  for (const args of [
    ['extract-js'],
    ['extract-js', 'x.ts', '--unknown'],
    ['extract-js', 'x.ts', '--project'],
  ]) {
    const result = await runExtractJsCommand(
      args, fakeFs(new Map(), new Map()), async () => '', fixedNow, '1.0.0',
    );
    assert.equal(result.exitCode, 64);
    assert.ok(result.standardError.includes('extract-js'));
    assert.equal(result.standardOutput, '');
  }
});

test('없는 경로·비JS 파일·루트 탈출은 코드 2다', async () => {
  const empty = fakeFs(new Map(), new Map());
  const missing = await runExtractJsCommand(
    ['extract-js', '/none'], empty, async () => '', fixedNow, '1.0.0',
  );
  assert.equal(missing.exitCode, 2);
  assert.ok(missing.standardError.includes('exists'));

  const notJs = new Map([['/p/note.md', 'text']]);
  const notJsResult = await runExtractJsCommand(
    ['extract-js', '/p/note.md'],
    fakeFs(notJs, new Map([['/p', ['note.md']]])),
    readerFor(notJs), fixedNow, '1.0.0',
  );
  assert.equal(notJsResult.exitCode, 2);
  assert.ok(notJsResult.standardError.includes('JS/TS'));

  const files = new Map([['/outside/a.ts', "requireNativeModule('A');"]]);
  const escaped = await runExtractJsCommand(
    ['extract-js', '/outside/a.ts', '--project', '/repo'],
    fakeFs(files, new Map([['/repo', []]])),
    readerFor(files), fixedNow, '1.0.0',
  );
  assert.equal(escaped.exitCode, 2);
  assert.ok(escaped.standardError.includes('project root'));
});

test('읽기 실패는 입력 본문 없이 코드 2다', async () => {
  const files = new Map([['/p/a.ts', 'x']]);
  const result = await runExtractJsCommand(
    ['extract-js', '/p/a.ts'],
    fakeFs(files, new Map([['/p', ['a.ts']]])),
    async () => { throw new Error('denied'); },
    fixedNow, '1.0.0',
  );
  assert.equal(result.exitCode, 2);
  assert.ok(result.standardError.includes('readable'));
  assert.ok(!result.standardError.includes('denied'));
});

test('realpath 실패·비디렉터리 --project·버전 부재를 코드 2로 분류한다', async () => {
  const files = new Map([['/p/a.ts', 'x']]);
  const dirs = new Map<string, readonly string[]>([['/p', ['a.ts']]]);
  const throwingFs: ExtractJsFileSystem = {
    ...fakeFs(files, dirs),
    realPath: async () => { throw new Error('no such file'); },
  };
  const unresolvable = await runExtractJsCommand(
    ['extract-js', '/p/a.ts'], throwingFs, readerFor(files), fixedNow, '1.0.0',
  );
  assert.equal(unresolvable.exitCode, 2);

  const fileProject = await runExtractJsCommand(
    ['extract-js', '/p/a.ts', '--project', '/p/a.ts'],
    fakeFs(files, dirs), readerFor(files), fixedNow, '1.0.0',
  );
  assert.equal(fileProject.exitCode, 2);
  assert.ok(fileProject.standardError.includes('--project'));

  const noVersion = await runExtractJsCommand(
    ['extract-js', '/p/a.ts'],
    fakeFs(files, dirs), readerFor(files), fixedNow, undefined,
  );
  assert.equal(noVersion.exitCode, 2);
  assert.ok(noVersion.standardError.includes('package metadata'));
});

test('여러 입력의 공통 조상 디렉터리가 프로젝트 루트다', async () => {
  const files = new Map([
    ['/repo/app/x/a.ts', "requireNativeModule('A');"],
    ['/repo/app/y/b.ts', "requireNativeModule('B');"],
  ]);
  const dirs = new Map<string, readonly string[]>([
    ['/repo/app/x', ['a.ts']],
    ['/repo/app/y', ['b.ts']],
  ]);
  const result = await runExtractJsCommand(
    ['extract-js', '/repo/app/x', '/repo/app/y'],
    fakeFs(files, dirs), readerFor(files), fixedNow, '1.0.0',
  );
  assert.equal(result.exitCode, 0);
  const document = parseBridgeFactsDocument(JSON.parse(result.standardOutput));
  assert.deepEqual(
    document.facts.map((fact) => fact.location.path),
    ['x/a.ts', 'y/b.ts'],
  );
});

test('디렉터리 나열 실패는 코드 2로 분류된다', async () => {
  const fs: ExtractJsFileSystem = {
    statPath: async () => 'directory',
    listDirectory: async () => { throw new Error('denied'); },
    realPath: async (path) => path,
  };
  const result = await runExtractJsCommand(
    ['extract-js', '/locked'], fs, async () => '', fixedNow, '1.0.0',
  );
  assert.equal(result.exitCode, 2);
  assert.ok(result.standardError.includes('list'));
});

test('파일 수 상한을 넘는 트리는 조기에 멈추고 코드 2다', async () => {
  const names = Array.from({ length: 10_001 }, (_, index) => `f${index}.ts`);
  const files = new Map(names.map((name) => [`/big/${name}`, 'x']));
  const dirs = new Map<string, readonly string[]>([['/big', names]]);
  const result = await runExtractJsCommand(
    ['extract-js', '/big'], fakeFs(files, dirs), readerFor(files),
    fixedNow, '1.0.0',
  );
  assert.equal(result.exitCode, 2);
  assert.ok(result.standardError.includes('files'));
});

test('POSIX 파일명의 백슬래시를 경로 구분자로 바꾸지 않는다', async () => {
  const files = new Map([['/p/a\\b.ts', "requireNativeModule('B');"]]);
  const dirs = new Map<string, readonly string[]>([['/p', ['a\\b.ts']]]);
  const result = await runExtractJsCommand(
    ['extract-js', '/p'], fakeFs(files, dirs), readerFor(files),
    fixedNow, '1.0.0',
  );
  assert.equal(result.exitCode, 0);
  const document = parseBridgeFactsDocument(JSON.parse(result.standardOutput));
  assert.equal(document.facts[0]?.location.path, 'a\\b.ts');
});
