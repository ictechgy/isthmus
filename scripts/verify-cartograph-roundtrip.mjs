import { spawnSync } from 'node:child_process';
import { mkdtemp, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [cartographBinary, cartographFixture] = process.argv.slice(2);
if (cartographBinary === undefined || cartographFixture === undefined) {
  process.stderr.write(
    'Usage: verify-cartograph-roundtrip.mjs <cartograph-bin> <fixture-root>\n',
  );
  process.exit(64);
}

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const isthmusBinary = join(repositoryRoot, 'dist/cli/main.js');
const dartFacts = join(
  repositoryRoot,
  'experiments/phase-0/expected/cartograph-dart.json',
);
const swiftFacts = join(
  repositoryRoot,
  'experiments/phase-0/expected/cartograph-swift.json',
);
const retentionDirectory = await mkdtemp(join(tmpdir(), 'isthmus-retentions-'));
const retentionPath = join(retentionDirectory, 'retentions.json');

try {
  const retentionResult = run(process.execPath, [
    isthmusBinary,
    'retentions',
    dartFacts,
    swiftFacts,
    '--for',
    'cartograph',
  ]);
  verify(retentionResult.status === 0, 'isthmus retentions');
  await writeFile(retentionPath, retentionResult.stdout, {
    mode: 0o600,
    flag: 'wx',
  });

  const before = unusedMessages(runCartograph(['dead', '--report-format', 'json']));
  const after = unusedMessages(
    runCartograph([
      'dead',
      '--report-format',
      'json',
      '--external-retentions',
      retentionPath,
    ]),
  );
  verify(before.includes("class 'Corpus.CameraBridge' is never used"), 'baseline finding');
  verify(!after.includes("class 'Corpus.CameraBridge' is never used"), 'retained finding');

  const explanation = runCartograph([
    'dead',
    '--external-retentions',
    retentionPath,
    '--explain',
    'CameraBridge',
  ]);
  verify(explanation.status === 0, 'cartograph explain');
  verify(
    explanation.stdout.includes(
      "evidence: dart lib/camera.dart:42 invokes 'takePhoto' on channel 'com.example/camera'",
    ),
    'cartograph evidence',
  );
  process.stdout.write('Cartograph retention roundtrip verified.\n');
} finally {
  await unlink(retentionPath).catch(() => undefined);
  await rmdir(retentionDirectory).catch(() => undefined);
}

/** cartograph에 공통 fixture 경로를 붙여 실행한다. */
function runCartograph(arguments_) {
  return run(cartographBinary, [
    ...arguments_,
    '--project',
    cartographFixture,
  ]);
}

/** cartograph JSON에서 미사용 진단 문장만 꺼낸다. */
function unusedMessages(result) {
  verify(result.status === 0, 'cartograph dead');
  const document = JSON.parse(result.stdout);
  return document.diagnostics
    .filter((diagnostic) => diagnostic.ruleIdentifier === 'unused-symbol')
    .map((diagnostic) => diagnostic.message);
}

/** 자식 프로세스를 UTF-8 텍스트 모드로 실행한다. */
function run(command, arguments_) {
  return spawnSync(command, arguments_, { encoding: 'utf8' });
}

/** 검증 실패 시 경로나 자식 출력 없이 단계 이름만 보고한다. */
function verify(condition, step) {
  if (!condition) throw new Error(`Cartograph roundtrip failed: ${step}`);
}
