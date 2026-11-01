import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  compareProducer, parseDriftArguments, readCanonical, readProducerRecord, renderDriftMarkdown, runDrift,
} from './conformance-drift.mjs';
import { runChild } from './run-child.mjs';

// 생산자 사본 드리프트 보고 회귀 테스트다. 생산자 checkout은 임시 디렉터리에 합성한다.

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha = (text) => createHash('sha256').update(text).digest('hex');

/** 정본과 생산자 사본을 담은 임시 작업 공간을 만들고 테스트 뒤 지운다. */
function workspace(t) {
  const directory = mkdtempSync(join(tmpdir(), 'isthmus-conformance-drift-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const write = (path, text) => {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), text);
  };
  // 정본: a.json(v2), b.json, c.json
  write('canonical/conformance/a.json', 'a-v2');
  write('canonical/conformance/b.json', 'b');
  write('canonical/conformance/c.json', 'c');
  write('canonical/conformance/SHA256SUMS', ['a.json', 'b.json', 'c.json']
    .map((name) => `${sha(name === 'a.json' ? 'a-v2' : name[0])}  ${name}`).join('\n') + '\n');
  return { directory, write, path: (relative) => join(directory, relative) };
}

test('lock 기록과 사본 파일을 정본과 대조해 suite별 상태를 낸다', (t) => {
  const space = workspace(t);
  space.write('lock-producer/conformance.lock', JSON.stringify({
    format: 'isthmus-conformance-lock', version: 1, commit: '1d6683ab2cd4f7804370c85d4869501042bc3dec',
    files: { 'a.json': sha('a-v1'), 'b.json': sha('b'), 'old.json': sha('old') },
  }));
  space.write('lock-producer/conformance/a.json', 'a-v1');
  space.write('lock-producer/conformance/b.json', 'b');

  const report = compareProducer(readCanonical(space.path('canonical')), readProducerRecord(space.path('lock-producer')));

  assert.deepEqual(report, {
    source: 'conformance.lock',
    commit: '1d6683ab2cd4f7804370c85d4869501042bc3dec',
    drift: true,
    suites: [
      { suite: 'a.json', status: 'stale' },
      { suite: 'b.json', status: 'current' },
      // c는 생산자에게 필요 없을 수 있어 드리프트가 아니다.
      { suite: 'c.json', status: 'not-vendored' },
      { suite: 'old.json', status: 'unknown' },
    ],
  });
});

test('기록은 최신이어도 사본 파일이 기록과 다르면 modified다', (t) => {
  const space = workspace(t);
  space.write('edited/conformance.lock', JSON.stringify({
    format: 'isthmus-conformance-lock', version: 1, files: { 'b.json': sha('b') },
  }));
  space.write('edited/conformance/b.json', 'b edited by hand');

  const report = compareProducer(readCanonical(space.path('canonical')), readProducerRecord(space.path('edited')));

  assert.equal(report.commit, null);
  assert.equal(report.drift, true);
  assert.deepEqual(report.suites.find(({ suite }) => suite === 'b.json'), { suite: 'b.json', status: 'modified' });
});

test('lock이 없으면 SHA256SUMS 사본을 쓰고, 둘 다 없으면 벤더링 기록이 없다고 보고한다', (t) => {
  const space = workspace(t);
  space.write('sums/conformance/SHA256SUMS', `${sha('a-v2')}  a.json\n${sha('b')}  b.json\n`);
  space.write('sums/conformance/a.json', 'a-v2');
  space.write('none/README.md', 'no vectors');

  const canonical = readCanonical(space.path('canonical'));
  const sums = compareProducer(canonical, readProducerRecord(space.path('sums')));
  const none = compareProducer(canonical, readProducerRecord(space.path('none')));

  assert.deepEqual(sums, { source: 'conformance/SHA256SUMS', commit: null, drift: true, suites: [
    { suite: 'a.json', status: 'current' },
    // 기록은 정본과 같아도 사본 파일이 없으면 벤더링이 깨진 것이다.
    { suite: 'b.json', status: 'missing' },
    { suite: 'c.json', status: 'not-vendored' },
  ] });
  assert.deepEqual(none, { source: null, commit: null, drift: false, suites: [
    { suite: 'a.json', status: 'not-vendored' },
    { suite: 'b.json', status: 'not-vendored' },
    { suite: 'c.json', status: 'not-vendored' },
  ] });
});

test('생산자마다 다른 lock 위치·모양을 찾아 기록 옆의 사본과 대조한다', (t) => {
  const space = workspace(t);
  // cartograph 모양: conformance/ 안의 lock, format·version 없이 source.commit
  space.write('nested/conformance/conformance.lock', JSON.stringify({
    files: { 'a.json': sha('a-v2') }, source: { commit: 'c'.repeat(40), path: 'conformance/', repository: 'isthmus' },
  }));
  space.write('nested/conformance/a.json', 'a-v2');
  // kartograph·dartograph 모양: fixture 디렉터리의 lock, isthmus.commit
  for (const directory of ['isthmus-conformance', 'isthmus_conformance']) {
    space.write(`fixture-${directory}/fixtures/${directory}/conformance.lock`, JSON.stringify({
      format: 'isthmus-conformance-lock', version: 1, isthmus: { commit: 'k'.repeat(40), source: 'conformance/' },
      files: { 'a.json': sha('a-v2'), 'b.json': sha('b') },
    }));
    space.write(`fixture-${directory}/fixtures/${directory}/a.json`, 'a-v2');
    space.write(`fixture-${directory}/fixtures/${directory}/b.json`, 'b edited');
  }
  const canonical = readCanonical(space.path('canonical'));

  const nested = compareProducer(canonical, readProducerRecord(space.path('nested')));
  const fixtures = ['isthmus-conformance', 'isthmus_conformance']
    .map((directory) => compareProducer(canonical, readProducerRecord(space.path(`fixture-${directory}`))));
  // 기록 파일 경로를 직접 주면 같은 판정이다.
  const direct = compareProducer(canonical,
    readProducerRecord(space.path('fixture-isthmus-conformance/fixtures/isthmus-conformance/conformance.lock')));

  assert.deepEqual(nested, { source: 'conformance/conformance.lock', commit: 'c'.repeat(40), drift: false, suites: [
    { suite: 'a.json', status: 'current' },
    { suite: 'b.json', status: 'not-vendored' },
    { suite: 'c.json', status: 'not-vendored' },
  ] });
  assert.deepEqual(fixtures.map(({ source, commit, suites }) => [source, commit, suites.map(({ status }) => status)]), [
    ['fixtures/isthmus-conformance/conformance.lock', 'k'.repeat(40), ['current', 'modified', 'not-vendored']],
    ['fixtures/isthmus_conformance/conformance.lock', 'k'.repeat(40), ['current', 'modified', 'not-vendored']],
  ]);
  assert.deepEqual({ ...direct, source: undefined }, { ...fixtures[0], source: undefined });
  assert.equal(direct.source, 'conformance.lock');
});

test('루트 lock 파일을 직접 줘도 checkout 모드와 같이 conformance/ 사본과 대조한다', (t) => {
  // gartograph·rustograph·pythograph 모양: 루트 lock, 사본은 conformance/
  const space = workspace(t);
  space.write('root-lock/conformance.lock', JSON.stringify({
    format: 'isthmus-conformance-lock', version: 1, commit: 'r'.repeat(40), files: { 'a.json': sha('a-v2'), 'b.json': sha('b') },
  }));
  space.write('root-lock/conformance/a.json', 'a-v2');
  space.write('root-lock/conformance/b.json', 'b');
  const canonical = readCanonical(space.path('canonical'));

  const direct = compareProducer(canonical, readProducerRecord(space.path('root-lock/conformance.lock')));
  const checkout = compareProducer(canonical, readProducerRecord(space.path('root-lock')));

  assert.deepEqual(direct.suites.map(({ status }) => status), ['current', 'current', 'not-vendored']);
  assert.equal(direct.drift, false);
  assert.deepEqual({ ...direct, source: undefined }, { ...checkout, source: undefined });
  assert.equal(runDrift(['--strict', `p=${space.path('root-lock/conformance.lock')}`], { root: space.path('canonical') }).exitCode, 0);
});

test('CRLF 줄 끝의 SHA256SUMS 사본도 읽는다', (t) => {
  const space = workspace(t);
  space.write('crlf/conformance/SHA256SUMS', `${sha('a-v2')}  a.json\r\n${sha('b')}  b.json\r\n`);
  space.write('crlf/conformance/a.json', 'a-v2');
  space.write('crlf/conformance/b.json', 'b');

  const report = compareProducer(readCanonical(space.path('canonical')), readProducerRecord(space.path('crlf')));

  assert.deepEqual(report.suites.map(({ suite, status }) => [suite, status]),
    [['a.json', 'current'], ['b.json', 'current'], ['c.json', 'not-vendored']]);
});

test('--strict는 기록이 없는 생산자도 실패로 보고, 기본 실행은 보고만 한다', (t) => {
  const space = workspace(t);
  space.write('none/README.md', 'no vectors');
  const options = { root: space.path('canonical'), revision: 'deadbeef' };

  const lenient = runDrift([`none=${space.path('none')}`], options);
  const strict = runDrift(['--strict', `none=${space.path('none')}`], options);

  assert.equal(lenient.exitCode, 0);
  assert.equal(strict.exitCode, 1);
  assert.match(lenient.stdout, /\nNo vendored record: none\. Vendor the canonical suites with a conformance\.lock\.\n$/u);
  assert.match(lenient.stdout, /\| none \| none \| - \| not-vendored \| not-vendored \| not-vendored \|/u);
});

test('예기치 않은 내부 오류는 드리프트(1)와 구분되는 종료 코드 2다', (t) => {
  const space = workspace(t);
  space.write('current/conformance.lock', JSON.stringify({ format: 'isthmus-conformance-lock', version: 1, files: {} }));
  // 정본 SHA256SUMS가 없는 루트를 주면 내부 읽기 오류다.
  const result = runDrift([`p=${space.path('current')}`], { root: space.path('no-canonical') });

  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /^isthmus conformance drift failed unexpectedly; check the canonical checkout and inputs\.\n$/u);
});

test('디렉터리 밖을 가리키는 기록 이름은 읽지 않는다', (t) => {
  const space = workspace(t);
  space.write('escape/conformance.lock', JSON.stringify({
    format: 'isthmus-conformance-lock', version: 1, files: { '../secret.json': sha('x') },
  }));
  space.write('escape/secret.json', 'not x');

  const record = readProducerRecord(space.path('escape'));

  assert.deepEqual([...record.actual], []);
  assert.deepEqual(compareProducer(readCanonical(space.path('canonical')), record).suites.at(-1),
    { suite: '../secret.json', status: 'unknown' });
});

test('잘못된 lock·SHA256SUMS는 입력 오류(2)이고 인자 오류는 사용 오류(64)다', (t) => {
  const space = workspace(t);
  space.write('bad-json/conformance.lock', '{');
  space.write('bad-format/conformance.lock', JSON.stringify({ format: 'other', version: 1, files: {} }));
  space.write('bad-digest/conformance.lock', JSON.stringify({ format: 'isthmus-conformance-lock', version: 1, files: { 'a.json': 'x' } }));
  space.write('bad-sums/conformance/SHA256SUMS', 'not a sum line\n');
  space.write('bad-array/conformance.lock', '[]');
  // 기록된 사본 자리에 디렉터리가 있으면 일반 파일이 아니라 읽지 않는다.
  space.write('not-a-file/conformance.lock', JSON.stringify({ format: 'isthmus-conformance-lock', version: 1, files: { 'a.json': sha('a-v2') } }));
  space.write('not-a-file/conformance/a.json/inner', 'x');
  const options = { root: space.path('canonical') };

  for (const [name, message] of [
    ['bad-json', 'Producer p: conformance.lock is not valid JSON.\n'],
    ['bad-format', 'Producer p: conformance.lock is not an isthmus-conformance-lock version 1 document.\n'],
    ['bad-array', 'Producer p: conformance.lock is not an isthmus-conformance-lock version 1 document.\n'],
    ['bad-digest', 'Producer p: conformance.lock has a file entry without a sha256 digest.\n'],
    ['bad-sums', 'Producer p: SHA256SUMS has a malformed SHA256SUMS line.\n'],
    ['not-a-file', 'Producer p: A producer record or vendored vector is not a regular file within the size limit.\n'],
    // 오타 경로는 "벤더링 없음"으로 조용히 넘기지 않는다.
    ['does-not-exist', 'Producer p: The producer path does not exist.\n'],
  ]) {
    assert.deepEqual(runDrift([`p=${space.path(name)}`], options), { exitCode: 2, stdout: '', stderr: message });
  }
  assert.equal(runDrift([], options).exitCode, 64);
  assert.equal(runDrift(['--verbose'], options).exitCode, 64);
  assert.equal(runDrift([`p=${space.path('none')}`, `p=${space.path('none')}`], options).exitCode, 64);
  assert.deepEqual(parseDriftArguments(['--json', 'a=/x', '--strict', 'b-c=/y=z']), {
    json: true, strict: true, producers: [{ name: 'a', checkout: '/x' }, { name: 'b-c', checkout: '/y=z' }],
  });
});

test('Markdown 표는 suite 열과 드리프트 생산자를 밝히고 --strict만 종료 코드 1을 낸다', (t) => {
  const space = workspace(t);
  space.write('fresh/conformance.lock', JSON.stringify({
    format: 'isthmus-conformance-lock', version: 1, commit: 'abcdef0123456789',
    files: { 'a.json': sha('a-v2'), 'b.json': sha('b'), 'c.json': sha('c') },
  }));
  for (const [name, text] of [['a.json', 'a-v2'], ['b.json', 'b'], ['c.json', 'c']]) space.write(`fresh/conformance/${name}`, text);
  space.write('old/conformance.lock', JSON.stringify({
    format: 'isthmus-conformance-lock', version: 1, commit: 'x|y', files: { 'a.json': sha('a-v1'), 'z|.json': sha('z') },
  }));
  const options = { root: space.path('canonical'), revision: 'deadbeef' };
  const args = [`fresh=${space.path('fresh')}`, `old=${space.path('old')}`];

  const lenient = runDrift(args, options);
  const strict = runDrift(['--strict', ...args], options);
  const clean = runDrift(['--strict', `fresh=${space.path('fresh')}`], options);

  assert.equal(lenient.exitCode, 0);
  assert.equal(strict.exitCode, 1);
  assert.equal(strict.stdout, lenient.stdout);
  assert.equal(lenient.stdout, [
    'Conformance drift against deadbeef',
    '',
    '| producer | record | isthmus commit | a.json | b.json | c.json | unknown suites |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    '| fresh | conformance.lock | abcdef012345 | current | current | current | - |',
    // 표를 깨는 `|`는 칸 안에서 공백으로 바뀐다.
    '| old | conformance.lock | x y | stale | not-vendored | not-vendored | z .json |',
    '',
    'Drift: old. Re-vendor the canonical files and SHA256SUMS, then rerun the producer conformance tests.',
    '',
  ].join('\n'));
  assert.equal(clean.exitCode, 0);
  assert.match(clean.stdout, /No vendored suite differs from the canonical vectors\.\n$/u);
  assert.doesNotMatch(clean.stdout, /unknown suites/u);
  const json = JSON.parse(runDrift(['--json', `old=${space.path('old')}`], options).stdout);
  assert.equal(json.format, 'isthmus-conformance-drift');
  assert.deepEqual(json.canonical.map(({ suite }) => suite), ['a.json', 'b.json', 'c.json']);
  assert.equal(json.producers[0].name, 'old');
  assert.equal(json.producers[0].drift, true);
  assert.equal(renderDriftMarkdown({ ...json, revision: null }).split('\n')[0], 'Conformance drift against the working tree');
});

test('실제 프로세스는 저장소 정본을 읽고 종료 코드를 그대로 돌려준다', (t) => {
  const space = workspace(t);
  const canonical = readCanonical(root);
  space.write('current/conformance.lock', JSON.stringify({
    format: 'isthmus-conformance-lock', version: 1, files: Object.fromEntries(canonical),
  }));
  for (const name of canonical.keys()) {
    space.write(`current/conformance/${name}`, readFileSync(join(root, 'conformance', name), 'utf8'));
  }
  const script = join(root, 'scripts', 'conformance-drift.mjs');

  const result = runChild(process.execPath, [script, '--strict', '--json', `current=${space.path('current')}`]);
  const usage = runChild(process.execPath, [script]);

  assert.equal(result.status, 0);
  const report = JSON.parse(result.stdout);
  assert.equal(report.producers[0].drift, false);
  assert.deepEqual(report.canonical.map(({ suite }) => suite), [...canonical.keys()].sort());
  assert.equal(usage.status, 64);
  assert.match(usage.stderr, /^Give at least one <producer>=<checkout-or-record>\./u);
});
