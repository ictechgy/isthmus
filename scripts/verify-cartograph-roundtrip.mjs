import { mkdtemp, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runChild } from './run-child.mjs';

const [cartographBinary, dartographBinary, fixtureRoot, isthmusOverride] =
  process.argv.slice(2);
if (
  cartographBinary === undefined ||
  dartographBinary === undefined ||
  fixtureRoot === undefined
) {
  process.stderr.write(
    'Usage: verify-cartograph-roundtrip.mjs '
      + '<cartograph-bin> <dartograph-bin> <fixture-root> [isthmus-js]\n',
  );
  process.exit(64);
}

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const isthmusBinary = isthmusOverride
  ?? join(repositoryRoot, 'dist/cli/main.js');

verifyToolVersion(cartographBinary, 'cartograph', '0.5.3');
verifyToolVersion(dartographBinary, 'dartograph', '0.1.0');

const roundtripDirectory = await mkdtemp(
  join(tmpdir(), 'isthmus-producer-roundtrip-'),
);
const dartFactsPath = join(roundtripDirectory, 'dart-facts.json');
const swiftFactsPath = join(roundtripDirectory, 'swift-facts.json');
const retentionPath = join(roundtripDirectory, 'retentions.json');

try {
  const swiftFacts = runCartograph([
    'bridges',
    '--target',
    'flutter',
  ]);
  verify(swiftFacts.status === 0, 'cartograph bridges');
  const dartFacts = run(dartographBinary, [
    'bridges',
    '--format',
    'json',
    fixtureRoot,
  ]);
  verify(dartFacts.status === 0, 'dartograph bridges');
  verifyProducerDocument(swiftFacts.stdout, 'swift');
  verifyProducerDocument(dartFacts.stdout, 'dart');

  await Promise.all([
    writePrivateFile(swiftFactsPath, swiftFacts.stdout),
    writePrivateFile(dartFactsPath, dartFacts.stdout),
  ]);

  const retentionResult = run(process.execPath, [
    isthmusBinary,
    'retentions',
    dartFactsPath,
    swiftFactsPath,
    '--for',
    'cartograph',
  ]);
  verify(retentionResult.status === 0, 'isthmus retentions');
  const retentionDocument = parseDocument(
    retentionResult.stdout,
    'isthmus retentions JSON',
  );
  await writePrivateFile(retentionPath, retentionResult.stdout);

  const before = unusedMessages(
    runCartograph(['dead', '--report-format', 'json']),
  );
  const after = unusedMessages(
    runCartograph([
      'dead',
      '--report-format',
      'json',
      '--external-retentions',
      retentionPath,
    ]),
  );
  verify(
    before.includes("class 'Corpus.CameraBridge' is never used"),
    'baseline finding',
  );
  verify(
    !after.includes("class 'Corpus.CameraBridge' is never used"),
    'retained finding',
  );

  const explanation = runCartograph([
    'dead',
    '--external-retentions',
    retentionPath,
    '--explain',
    'CameraBridge',
  ]);
  verify(explanation.status === 0, 'cartograph explain');
  verify(
    explanation.stdout.includes(expectedEvidence(retentionDocument)),
    'cartograph evidence',
  );
  process.stdout.write(
    'Cartograph and dartograph retention roundtrip verified.\n',
  );
} finally {
  await Promise.all([
    unlink(dartFactsPath).catch(() => undefined),
    unlink(swiftFactsPath).catch(() => undefined),
    unlink(retentionPath).catch(() => undefined),
  ]);
  await rmdir(roundtripDirectory).catch(() => undefined);
}

/** 생성된 사실 문서가 실제 생산자와 기대 플랫폼을 밝히는지 확인한다. */
function verifyProducerDocument(text, platform) {
  const document = parseDocument(text, `${platform} bridge facts JSON`);
  verify(document.format === 'bridge-facts', `${platform} bridge facts format`);
  verify(document.version === 1, `${platform} bridge facts version`);
  verify(document.platform === platform, `${platform} bridge facts platform`);
  verify(document.target === 'flutter', `${platform} bridge facts target`);
  verify(Array.isArray(document.facts), `${platform} bridge facts array`);
}

/** retentions 첫 근거를 cartograph explain의 계약 문장으로 바꾼다. */
function expectedEvidence(document) {
  const evidence = document.retentions?.[0]?.evidence;
  const caller = evidence?.caller;
  verify(caller !== undefined, 'retention caller evidence');
  return `evidence: ${caller.platform} ${caller.path}:${caller.line} `
    + `invokes '${evidence.method}' on channel '${evidence.channel}'`;
}

/** JSON 오류를 입력 본문이나 경로 없는 단계 실패로 바꾼다. */
function parseDocument(text, step) {
  try {
    return JSON.parse(text);
  } catch {
    return verify(false, step);
  }
}

/** 한 도구가 필요한 기능을 포함한 최소 버전인지 확인한다. */
function verifyToolVersion(binary, tool, minimum) {
  const result = run(binary, ['--version']);
  verify(result.status === 0, `${tool} version`);
  const match = result.stdout.match(/\d+\.\d+\.\d+/u);
  verify(match !== null, `${tool} version`);
  verify(versionAtLeast(match[0], minimum), `${tool} version`);
}

/** 숫자 SemVer 세 부분을 사전 릴리스 없이 비교한다. */
function versionAtLeast(actual, minimum) {
  const actualParts = actual.split('.').map(Number);
  const minimumParts = minimum.split('.').map(Number);
  for (let index = 0; index < 3; index++) {
    const difference = actualParts[index] - minimumParts[index];
    if (difference !== 0) return difference > 0;
  }
  return true;
}

/** 사실·보존 문서를 소유자만 읽을 수 있게 새 파일로 쓴다. */
function writePrivateFile(path, contents) {
  return writeFile(path, contents, { mode: 0o600, flag: 'wx' });
}

/** cartograph에 공통 fixture 경로를 붙여 실행한다. */
function runCartograph(arguments_) {
  return run(cartographBinary, [
    ...arguments_,
    '--project',
    fixtureRoot,
  ]);
}

/** cartograph JSON에서 미사용 진단 문장만 꺼낸다. */
function unusedMessages(result) {
  verify(result.status === 0, 'cartograph dead');
  const document = parseDocument(result.stdout, 'cartograph dead JSON');
  return document.diagnostics
    .filter((diagnostic) => diagnostic.ruleIdentifier === 'unused-symbol')
    .map((diagnostic) => diagnostic.message);
}

/** 자식 프로세스를 UTF-8 텍스트 모드로 실행한다. */
function run(command, arguments_) {
  return runChild(command, arguments_, { timeout: 5 * 60_000 });
}

/** 검증 실패 시 경로나 자식 출력 없이 단계 이름만 보고한다. */
function verify(condition, step) {
  if (!condition) throw new Error(`Cartograph roundtrip failed: ${step}`);
}
