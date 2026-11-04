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

test('루트가 아닌 lock은 옆에 conformance/ 디렉터리가 있어도 기록 옆의 사본과 대조한다', (t) => {
  // fixture 디렉터리 lock의 사본은 기록 옆에 있다. 무관한 하위 conformance/ 디렉터리로 옮겨 가지 않는다.
  const space = workspace(t);
  const lock = JSON.stringify({ format: 'isthmus-conformance-lock', version: 1, files: { 'a.json': sha('a-v2') } });
  space.write('nested/fixtures/isthmus-conformance/conformance.lock', lock);
  space.write('nested/fixtures/isthmus-conformance/a.json', 'a-v2');
  space.write('nested/fixtures/isthmus-conformance/conformance/a.json', 'unrelated');
  const canonical = readCanonical(space.path('canonical'));

  const checkout = compareProducer(canonical, readProducerRecord(space.path('nested')));
  const direct = compareProducer(canonical, readProducerRecord(space.path('nested/fixtures/isthmus-conformance/conformance.lock')));

  assert.equal(checkout.suites[0]?.status, 'current');
  assert.equal(direct.suites[0]?.status, 'current');
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

/** 케이스 목록으로 적합성 벡터 JSON 문자열을 만든다. */
function vector(cases, header = {}) {
  return `${JSON.stringify({ format: 'isthmus-conformance', version: 1, suite: 'v', description: 'd', contract: 'c', ...header, cases }, null, 2)}\n`;
}

/** 정본 v.json과 그 이전 사본을 벤더링한 생산자 checkout을 만든다. */
function appliesWorkspace(t, oldCases, newCases, header = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'isthmus-conformance-applies-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const write = (path, text) => {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), text);
  };
  const canonicalText = vector(newCases, header);
  const vendoredText = vector(oldCases);
  write('canonical/conformance/v.json', canonicalText);
  write('canonical/conformance/SHA256SUMS', `${sha(canonicalText)}  v.json\n`);
  write('producer/conformance.lock', JSON.stringify({ format: 'isthmus-conformance-lock', version: 1, files: { 'v.json': sha(vendoredText) } }));
  write('producer/conformance/v.json', vendoredText);
  const canonicalRoot = join(directory, 'canonical');
  const report = (producer) => compareProducer(readCanonical(canonicalRoot), readProducerRecord(join(directory, 'producer')),
    { producer, root: canonicalRoot });
  return { report, status: (producer) => report(producer).suites[0].status };
}

const kase = (id, appliesTo, expect = { valid: true }) => ({ id, appliesTo, input: { id }, expect });

test('생산자에게 적용되지 않는 케이스만 바뀌었으면 stale-consumer-only로 보고하고 드리프트로 센다', (t) => {
  // 생산자도 consumer 전용 케이스를 테스트에서 실행할 수 있다(tsograph의 dispatch.validate). 그래서 생산자
  // 동작에 영향이 없을 수 있다는 것만 구분하고, current로 단정하지 않는다.
  const base = [kase('p/1', ['consumer', 'producer'])];
  const space = appliesWorkspace(t, base, [...base, kase('c/1', ['consumer']), kase('k/1', ['producer:kartograph'])]);
  assert.equal(space.status('gartograph'), 'stale-consumer-only');
  assert.equal(space.report('gartograph').drift, true);
});

test('consumer 전용 케이스의 기대값만 바뀐 정본도 --strict에서 실패한다', (t) => {
  // 검토 재현: 정본 http-dispatch.json에서 consumer 전용 validate/strict-slash-prefix의 expect만 뒤집는다.
  // 이 케이스를 실행하는 생산자는 사본을 다시 받아야 하므로 드리프트다.
  const directory = mkdtempSync(join(tmpdir(), 'isthmus-conformance-consumer-only-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const original = readFileSync(join(root, 'conformance', 'http-dispatch.json'), 'utf8');
  const vector = JSON.parse(original);
  const target = vector.cases.find(({ id }) => id === 'validate/strict-slash-prefix');
  assert.deepEqual(target.appliesTo, ['consumer']);
  target.expect = { ...target.expect, valid: !target.expect.valid };
  const flipped = `${JSON.stringify(vector, null, 2)}\n`;
  mkdirSync(join(directory, 'canonical', 'conformance'), { recursive: true });
  writeFileSync(join(directory, 'canonical', 'conformance', 'http-dispatch.json'), flipped);
  writeFileSync(join(directory, 'canonical', 'conformance', 'SHA256SUMS'), `${sha(flipped)}  http-dispatch.json\n`);
  mkdirSync(join(directory, 'tsograph', 'conformance'), { recursive: true });
  writeFileSync(join(directory, 'tsograph', 'conformance', 'http-dispatch.json'), original);
  writeFileSync(join(directory, 'tsograph', 'conformance', 'SHA256SUMS'), `${sha(original)}  http-dispatch.json\n`);

  const result = runDrift(['--strict', '--json', `tsograph=${join(directory, 'tsograph')}`], { root: join(directory, 'canonical') });

  assert.equal(result.exitCode, 1);
  const [producer] = JSON.parse(result.stdout).producers;
  assert.equal(producer.drift, true);
  assert.deepEqual(producer.suites, [{ suite: 'http-dispatch.json', status: 'stale-consumer-only' }]);
});

test('생산자에게 적용되는 케이스가 더해지거나 바뀌면 stale이다', (t) => {
  const base = [kase('p/1', ['producer'])];
  assert.equal(appliesWorkspace(t, base, [...base, kase('p/2', ['consumer', 'producer'])]).status('gartograph'), 'stale');
  assert.equal(appliesWorkspace(t, base, [kase('p/1', ['producer'], { valid: false })]).status('gartograph'), 'stale');
  assert.equal(appliesWorkspace(t, base, []).status('gartograph'), 'stale');
  // 이름을 지정한 생산자 케이스는 그 생산자에게만 적용된다.
  const named = appliesWorkspace(t, base, [...base, kase('k/1', ['producer:kartograph'])]);
  assert.equal(named.status('kartograph'), 'stale');
  assert.equal(named.status('rustograph'), 'stale-consumer-only');
  // 계열 생산자 이름이 아닌 한정자(producer:openapi)는 어느 생산자에게 적용되는지 몰라 보수적으로 적용된다고 본다.
  assert.equal(appliesWorkspace(t, base, [...base, kase('o/1', ['producer:openapi'])]).status('tsograph'), 'stale');
  // 생산자 이름을 모르면(기록 파일만 받은 경우 등) 케이스 단위로 판정하지 않는다.
  assert.equal(appliesWorkspace(t, base, [...base, kase('c/1', ['consumer'])]).status(undefined), 'stale');
  // 계열 생산자가 아닌 이름(오타 포함)은 producer:<이름> 케이스를 그 이름과 맞출 수 없어 케이스 단위로 판정하지 않는다.
  const cartographOnly = appliesWorkspace(t, base, [...base, kase('s/1', ['producer:cartograph'])]);
  assert.equal(cartographOnly.status('cartograph'), 'stale');
  assert.equal(cartographOnly.status('cartograf'), 'stale');
  assert.equal(cartographOnly.status('swift'), 'stale');
});

test('벡터 머리(format·version·suite)가 바뀌면 케이스와 무관하게 stale이다', (t) => {
  const base = [kase('p/1', ['producer'])];
  assert.equal(appliesWorkspace(t, base, base, { version: 2 }).status('gartograph'), 'stale');
  // 설명·계약 링크 문구만 바뀐 것은 생산자 동작이 아니다.
  assert.equal(appliesWorkspace(t, base, base, { description: 'reworded' }).status('gartograph'), 'stale-consumer-only');
});

test('stale-consumer-only는 표에 싣고 드리프트로 세되 생산자 케이스 차이와 구분해 설명한다', () => {
  const markdown = renderDriftMarkdown({
    revision: null,
    canonical: [{ suite: 'v.json', sha256: 'x' }],
    producers: [{ name: 'gartograph', source: 'conformance.lock', commit: null, drift: true, suites: [{ suite: 'v.json', status: 'stale-consumer-only' }] }],
  });
  assert.match(markdown, /\| gartograph \| conformance\.lock \| - \| stale-consumer-only \|/u);
  assert.match(markdown, /Drift: gartograph\./u);
  assert.match(markdown, /Only consumer cases changed for: gartograph\. Producer behavior may be unaffected, but a producer whose tests run these cases must re-vendor\./u);
});
