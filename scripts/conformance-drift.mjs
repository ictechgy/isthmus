import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 생산자 저장소에 벤더링된 공유 적합성 벡터가 이 커밋의 정본(`conformance/SHA256SUMS`)과 같은지 보고한다.
 *
 * 생산자는 `conformance.lock`(isthmus 커밋과 파일별 sha256) 또는 정본 `SHA256SUMS` 사본으로 무엇을
 * 가져왔는지 밝힌다. 기록 위치는 생산자마다 달라 알려진 위치를 차례로 찾고, 기록 파일 경로를 직접 받을 수도 있다. 이 스크립트는 그 기록과 실제 사본 파일을 정본과 대조할 뿐 생산자 테스트를 실행하지
 * 않는다. 생산자에게 필요 없는 suite가 있을 수 있으므로 `not-vendored`는 드리프트로 세지 않는다.
 *
 * 사용: node scripts/conformance-drift.mjs [--json] [--strict] <producer>=<checkout-or-record> ...
 * 종료 코드: 0 보고 완료, 1 `--strict`에서 드리프트 발견, 2 입력을 읽지 못함, 64 사용 오류.
 */

/** 정본 디렉터리다. */
const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));

/** 사용 오류다. 종료 코드 64로 바뀐다. */
export class DriftUsageError extends Error {}

/** 생산자 기록을 읽지 못한 입력 오류다. 종료 코드 2로 바뀐다. */
export class DriftInputError extends Error {}

/** 드리프트로 세는 상태다. `consumer-only`는 생산자에게 적용되는 케이스가 그대로라 세지 않는다. */
const driftStatuses = new Set(['stale', 'modified', 'missing', 'unknown']);

/**
 * 계열 생산자 이름이다. `appliesTo`의 `producer:<이름>` 한정자가 이 중 하나면 그 생산자에게만 적용된다.
 * 계열 이름이 아닌 한정자(`producer:openapi` 등)는 어느 생산자를 뜻하는지 몰라 모두에게 적용된다고 본다.
 */
const familyProducers = new Set([
  'cartograph', 'kartograph', 'dartograph', 'gartograph', 'rustograph', 'pythograph', 'tsograph', 'schemagraph',
]);

/** 생산자 동작을 바꾸는 벡터 머리 필드다. 설명·계약 링크 문구는 동작이 아니다. */
const behavioralHeaderFields = ['format', 'version', 'suite'];

/** `sha256  name` 줄 목록을 파일 이름 → 해시로 읽는다. 형식이 어긋나면 입력 오류다. */
export function parseSums(text, label) {
  const files = new Map();
  // CRLF로 체크아웃된 사본(Windows의 autocrlf 등)도 같은 기록으로 읽는다.
  for (const line of text.split(/\r?\n/u)) {
    if (line.trim() === '') continue;
    const match = /^([0-9a-f]{64}) {2}(\S+)$/u.exec(line);
    if (match === null) throw new DriftInputError(`${label} has a malformed SHA256SUMS line.`);
    files.set(match[2], match[1]);
  }
  return files;
}

/** 인자를 생산자 이름과 checkout 경로로 나눈다. 같은 이름을 두 번 줄 수 없다. */
export function parseDriftArguments(argv) {
  const options = { json: false, strict: false, producers: [] };
  const names = new Set();
  for (const argument of argv) {
    if (argument === '--json') options.json = true;
    else if (argument === '--strict') options.strict = true;
    else {
      const match = /^([a-z][a-z0-9-]*)=(.+)$/u.exec(argument);
      if (match === null) throw new DriftUsageError('Expected <producer>=<checkout-or-record>, got an unrecognized argument.');
      if (names.has(match[1])) throw new DriftUsageError(`Producer ${match[1]} was given more than once.`);
      names.add(match[1]);
      options.producers.push({ name: match[1], checkout: match[2] });
    }
  }
  if (options.producers.length === 0) throw new DriftUsageError('Give at least one <producer>=<checkout-or-record>.');
  return options;
}

/**
 * checkout 안에서 벤더링 기록을 찾는 위치다(앞이 우선). 생산자마다 위치가 다르다 — 저장소 루트의
 * `conformance.lock`(사본은 `conformance/`), `conformance/conformance.lock`, fixture 디렉터리의 lock,
 * lock 없이 정본 `SHA256SUMS`를 함께 복사한 사본 순이다. 기록 파일 경로를 직접 줄 수도 있다.
 */
const recordLocations = [
  'conformance.lock',
  'conformance/conformance.lock',
  'fixtures/isthmus-conformance/conformance.lock',
  'fixtures/isthmus_conformance/conformance.lock',
  'conformance/SHA256SUMS',
];

/** 기록·사본 파일 하나의 최대 크기다. 정본 벡터보다 충분히 크고 특수 파일·거대 입력을 막는다. */
const MAX_RECORD_BYTES = 16 * 1024 * 1024;

/**
 * 생산자 checkout(또는 기록 파일)에서 벤더링 기록과 실제 사본 해시를 읽는다.
 *
 * lock은 `files`(이름 → sha256)가 필수다. `format`·`version`이 있으면 `isthmus-conformance-lock` 1이어야 하고,
 * isthmus 커밋은 `commit`·`isthmus.commit`·`source.commit` 중 있는 값을 쓴다(생산자마다 모양이 다르다).
 * 사본 파일은 기록 옆에서, 루트 lock이면 `conformance/`에서 찾는다. 기록에 있는데 사본이 없으면 `missing`이다.
 * 경로가 없거나 읽을 수 없으면 입력 오류다. 디렉터리에 기록이 없으면 벤더링하지 않은 생산자로 본다.
 */
export function readProducerRecord(location) {
  const entry = statOrNull(location);
  if (entry === null) throw new DriftInputError('The producer path does not exist.');
  let recordPath;
  let source;
  /** checkout 모드에서 기록이 생산자 루트의 lock인지다. 기록 파일을 직접 주면 아래에서 사본 위치로 판정한다. */
  let rootLock;
  if (entry.isDirectory()) {
    const relative = recordLocations.find((candidate) => statOrNull(join(location, candidate))?.isFile() === true);
    if (relative === undefined) {
      return { source: null, commit: null, files: new Map(), actual: new Map(), absent: new Set(), paths: new Map() };
    }
    recordPath = join(location, relative);
    source = relative;
    rootLock = relative === 'conformance.lock';
  } else if (entry.isFile()) {
    recordPath = location;
    source = basename(recordPath);
  } else {
    throw new DriftInputError('The producer path is not a directory or a regular record file.');
  }
  const text = readBounded(recordPath).toString('utf8');
  const isSums = basename(recordPath) === 'SHA256SUMS';
  const { files, commit } = isSums ? { files: parseSums(text, 'SHA256SUMS'), commit: null } : parseLock(text);
  const vendorDirectory = vendorDirectoryFor(recordPath, files, rootLock);
  const actual = new Map();
  const absent = new Set();
  /** 실제로 읽은 사본 파일 경로다. 케이스 단위 비교에 쓴다. */
  const paths = new Map();
  for (const name of files.keys()) {
    // 기록된 이름은 생산자가 쓴 값이다. 디렉터리 밖을 가리키는 이름은 읽지 않는다.
    if (!/^[A-Za-z0-9._-]+$/u.test(name) || name.startsWith('.')) continue;
    const path = join(vendorDirectory, name);
    const file = statOrNull(path);
    if (file === null) absent.add(name);
    else {
      actual.set(name, createHash('sha256').update(readBounded(path)).digest('hex'));
      paths.set(name, path);
    }
  }
  return { source, commit, files, actual, absent, paths };
}

/**
 * 기록이 가리키는 사본 디렉터리다. 생산자 루트의 lock은 `conformance/`, 그 밖의 기록은 기록 옆이다.
 *
 * checkout 모드는 기록을 찾은 위치로 루트 lock인지 안다. 기록 파일을 직접 주면 루트인지 알 수 없으므로,
 * `conformance.lock` 옆에 기록된 사본이 하나도 없고 `conformance/` 디렉터리가 있을 때만 루트 lock으로 본다 —
 * fixture 디렉터리 lock 옆의 무관한 하위 `conformance/`로 옮겨 가지 않게 한다.
 */
function vendorDirectoryFor(recordPath, files, rootLock) {
  const directory = dirname(recordPath);
  const nested = join(directory, 'conformance');
  if (rootLock !== undefined) return rootLock ? nested : directory;
  if (basename(recordPath) !== 'conformance.lock' || statOrNull(nested)?.isDirectory() !== true) return directory;
  const besideRecord = [...files.keys()].some((name) =>
    /^[A-Za-z0-9._-]+$/u.test(name) && !name.startsWith('.') && statOrNull(join(directory, name)) !== null);
  return besideRecord ? directory : nested;
}

/** lock JSON을 파일 이름 → 해시와 isthmus 커밋으로 읽는다. */
function parseLock(text) {
  let lock;
  try {
    lock = JSON.parse(text);
  } catch {
    throw new DriftInputError('conformance.lock is not valid JSON.');
  }
  if (lock === null || typeof lock !== 'object' || Array.isArray(lock) ||
    (lock.format !== undefined && lock.format !== 'isthmus-conformance-lock') ||
    (lock.version !== undefined && lock.version !== 1) ||
    lock.files === null || typeof lock.files !== 'object' || Array.isArray(lock.files)) {
    throw new DriftInputError('conformance.lock is not an isthmus-conformance-lock version 1 document.');
  }
  const files = new Map();
  for (const [name, hash] of Object.entries(lock.files)) {
    if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/u.test(hash)) {
      throw new DriftInputError('conformance.lock has a file entry without a sha256 digest.');
    }
    files.set(name, hash);
  }
  const commit = [lock.commit, lock.isthmus?.commit, lock.source?.commit].find((value) => typeof value === 'string') ?? null;
  return { files, commit };
}

/** 경로의 상태를 읽는다(심볼릭 링크는 따라간다). 없으면 null이다. */
function statOrNull(path) {
  try {
    return statSync(path);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return null;
    throw new DriftInputError('A producer record could not be inspected.');
  }
}

/** 일반 파일만 크기 상한 안에서 읽는다. FIFO·장치·거대 파일은 입력 오류다. */
function readBounded(path) {
  const file = statOrNull(path);
  if (file === null || !file.isFile() || file.size > MAX_RECORD_BYTES) {
    throw new DriftInputError('A producer record or vendored vector is not a regular file within the size limit.');
  }
  try {
    return readFileSync(path);
  } catch {
    throw new DriftInputError('A producer record or vendored vector could not be read.');
  }
}

/**
 * 정본 해시와 생산자 기록을 suite별 상태로 대조한다.
 *
 * - `current`: 기록이 정본과 같고, 사본 파일이 있으면 그 해시도 같다.
 * - `stale`: 기록이 정본과 다르다(이전 정본을 벤더링했다).
 * - `modified`: 기록은 정본과 같지만 사본 파일 해시가 기록과 다르다.
 * - `missing`: 기록은 정본과 같지만 사본 파일이 없다.
 * - `not-vendored`: 정본 suite를 가져오지 않았다. 생산자에게 필요 없는 suite일 수 있다.
 * - `unknown`: 정본에 없는 suite를 기록했다(정본에서 이름이 바뀌었거나 사라졌다).
 */
export function compareProducer(canonical, record, { producer, root } = {}) {
  const suites = [];
  for (const [name, hash] of [...canonical].sort(([left], [right]) => compareNames(left, right))) {
    const recorded = record.files.get(name);
    const actual = record.actual.get(name);
    let status = recorded === undefined
      ? 'not-vendored'
      : recorded !== hash
        ? 'stale'
        : record.absent.has(name)
          ? 'missing'
          : actual !== undefined && actual !== recorded ? 'modified' : 'current';
    if (status === 'stale' && actual === recorded &&
      sameProducerCases(join(root ?? repositoryRoot, 'conformance', name), record.paths?.get(name), producer)) {
      status = 'consumer-only';
    }
    suites.push({ suite: name, status });
  }
  for (const name of [...record.files.keys()].sort(compareNames)) {
    if (!canonical.has(name)) suites.push({ suite: name, status: 'unknown' });
  }
  return {
    source: record.source,
    commit: record.commit,
    drift: suites.some(({ status }) => driftStatuses.has(status)),
    suites,
  };
}

/**
 * 정본과 사본이 이 생산자에게 적용되는 케이스·머리에서 같은지 본다.
 *
 * 사본 해시가 기록과 같을 때(손대지 않은 이전 정본)만 부른다. 생산자 이름을 모르거나, 어느 쪽이든 읽거나 해석할 수
 * 없거나, 케이스 id가 겹치면 같다고 단정하지 않는다(false) — 보수적으로 stale로 남긴다. 케이스 비교는 id별 JSON
 * 직렬화의 일치이고 순서는 보지 않는다.
 */
function sameProducerCases(canonicalPath, vendoredPath, producer) {
  if (producer === undefined || vendoredPath === undefined) return false;
  const canonical = applicableView(canonicalPath, producer);
  const vendored = applicableView(vendoredPath, producer);
  if (canonical === null || vendored === null || canonical.header !== vendored.header) return false;
  if (canonical.cases.size !== vendored.cases.size) return false;
  return [...canonical.cases].every(([id, text]) => vendored.cases.get(id) === text);
}

/** 벡터 파일에서 생산자 동작을 바꾸는 머리와, 이 생산자에게 적용되는 케이스(id → 직렬화)를 읽는다. 실패하면 null이다. */
function applicableView(path, producer) {
  let vector;
  try {
    vector = JSON.parse(readBounded(path).toString('utf8'));
  } catch {
    return null;
  }
  if (vector === null || typeof vector !== 'object' || !Array.isArray(vector.cases)) return null;
  const cases = new Map();
  for (const entry of vector.cases) {
    if (entry === null || typeof entry !== 'object' || typeof entry.id !== 'string' || cases.has(entry.id)) return null;
    if (!Array.isArray(entry.appliesTo)) return null;
    if (appliesToProducer(entry.appliesTo, producer)) cases.set(entry.id, JSON.stringify(entry));
  }
  return { header: JSON.stringify(behavioralHeaderFields.map((field) => vector[field] ?? null)), cases };
}

/** `appliesTo` 하나가 이 생산자에게 적용되는지 본다. 모르는 한정자는 적용된다고 본다. */
function appliesToProducer(appliesTo, producer) {
  return appliesTo.some((target) => {
    if (target === 'producer') return true;
    if (typeof target !== 'string' || !target.startsWith('producer:')) return false;
    const qualifier = target.slice('producer:'.length);
    return qualifier === producer || !familyProducers.has(qualifier);
  });
}

/** 보고서를 GitHub step summary에도 쓸 수 있는 Markdown 표로 만든다. */
export function renderDriftMarkdown(report) {
  const suites = report.canonical.map(({ suite }) => suite);
  const unknown = report.producers.some(({ suites: rows }) => rows.some(({ status }) => status === 'unknown'));
  const header = ['producer', 'record', 'isthmus commit', ...suites, ...(unknown ? ['unknown suites'] : [])];
  const lines = [
    `Conformance drift against ${report.revision ?? 'the working tree'}`,
    '',
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
  ];
  for (const producer of report.producers) {
    const byName = new Map(producer.suites.map(({ suite, status }) => [suite, status]));
    const extra = producer.suites.filter(({ status }) => status === 'unknown').map(({ suite }) => suite);
    lines.push(`| ${[
      producer.name,
      producer.source ?? 'none',
      producer.commit === null ? '-' : producer.commit.slice(0, 12),
      ...suites.map((suite) => byName.get(suite)),
      ...(unknown ? [extra.length === 0 ? '-' : extra.join(', ')] : []),
    ].map(markdownCell).join(' | ')} |`);
  }
  const drifting = report.producers.filter(({ drift }) => drift).map(({ name }) => name);
  const unrecorded = report.producers.filter(({ source }) => source === null).map(({ name }) => name);
  const consumerOnly = report.producers
    .filter(({ drift, suites: rows }) => !drift && rows.some(({ status }) => status === 'consumer-only'))
    .map(({ name }) => name);
  lines.push('', drifting.length === 0
    ? 'No vendored suite differs from the canonical vectors in cases that apply to the producer.'
    : `Drift: ${drifting.join(', ')}. Re-vendor the canonical files and SHA256SUMS, then rerun the producer conformance tests.`);
  if (consumerOnly.length > 0) {
    lines.push(`Consumer-only changes (re-vendor when convenient): ${consumerOnly.join(', ')}.`);
  }
  if (unrecorded.length > 0) {
    lines.push(`No vendored record: ${unrecorded.join(', ')}. Vendor the canonical suites with a conformance.lock.`);
  }
  return `${lines.join('\n')}\n`;
}

/** 표 칸에 들어갈 값에서 표 구조를 깨는 문자를 지운다. */
function markdownCell(value) {
  return String(value).replace(/[|\r\n`]/gu, ' ');
}

/** 로케일과 무관한 코드 단위 순서다. */
function compareNames(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** 정본 SHA256SUMS를 읽는다. */
export function readCanonical(root = repositoryRoot) {
  return parseSums(readFileSync(join(root, 'conformance', 'SHA256SUMS'), 'utf8'), 'canonical SHA256SUMS');
}

/**
 * 인자를 받아 보고서를 만들고 출력·종료 코드를 정한다. 프로세스 I/O는 호출자가 한다.
 *
 * `--strict`는 드리프트뿐 아니라 기록이 없는 생산자도 실패로 본다 — 엄격 검사를 요청한 생산자에 기록이
 * 없으면 대조할 수 없다. 예기치 않은 오류는 드리프트(1)와 섞이지 않게 2로 바꾸고 원문을 싣지 않는다.
 */
export function runDrift(argv, options = {}) {
  try {
    return runDriftUnchecked(argv, options);
  } catch {
    return { exitCode: 2, stdout: '', stderr: 'isthmus conformance drift failed unexpectedly; check the canonical checkout and inputs.\n' };
  }
}

/** `runDrift`의 본체다. 사용·입력 오류만 스스로 종료 코드로 바꾼다. */
function runDriftUnchecked(argv, { root = repositoryRoot, revision = null } = {}) {
  let options;
  try {
    options = parseDriftArguments(argv);
  } catch (error) {
    if (error instanceof DriftUsageError) {
      return { exitCode: 64, stdout: '', stderr: `${error.message}\nUsage: node scripts/conformance-drift.mjs [--json] [--strict] <producer>=<checkout-or-record> ...\n` };
    }
    throw error;
  }
  const canonical = readCanonical(root);
  const producers = [];
  for (const { name, checkout } of options.producers) {
    try {
      producers.push({ name, ...compareProducer(canonical, readProducerRecord(resolve(checkout)), { producer: name, root }) });
    } catch (error) {
      if (error instanceof DriftInputError) {
        return { exitCode: 2, stdout: '', stderr: `Producer ${name}: ${error.message}\n` };
      }
      throw error;
    }
  }
  const report = {
    format: 'isthmus-conformance-drift', version: 1, revision,
    canonical: [...canonical].sort(([left], [right]) => compareNames(left, right)).map(([suite, sha256]) => ({ suite, sha256 })),
    producers,
  };
  const failed = producers.some(({ drift: value, source }) => value || source === null);
  return {
    exitCode: options.strict && failed ? 1 : 0,
    stdout: options.json ? `${JSON.stringify(report, null, 2)}\n` : renderDriftMarkdown(report),
    stderr: '',
  };
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = runDrift(process.argv.slice(2), { revision: process.env.GITHUB_SHA ?? null });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}
