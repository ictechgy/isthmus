import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import test from 'node:test';

import { runChild } from './run-child.mjs';

// cold-cache workflow는 예약·수동 실행만 하므로 kartograph 무결성 게이트가 빠져도 PR CI는 모른다.
// 그래서 producers job의 실제 run 블록을 GitHub 기본 셸(`bash -e`)로 실행해 그 경계를 확인한다.
// 네트워크와 발행 도구 대신 가짜 curl·node·npm을 PATH 앞에 두고, tar·shasum은 러너처럼 시스템 것을 쓴다.

/** 테스트용 kartograph 버전. 호환 세트와 다른 값이라 경로에 버전을 직접 박는 회귀도 드러난다. */
const version = '0.0.0-test';
/** 설치 단계가 KARTOGRAPH_BIN으로 넘기는 아카이브 안 고정 경로. */
const fixedEntry = `kartograph-${version}/bin/kartograph`;
/** 아카이브와 SHA256SUMS를 함께 받아야 하는 같은 릴리스의 주소. */
const releaseUrl = `https://github.com/ictechgy/kartograph/releases/download/v${version}`;
/** 설치 단계가 넘긴 kartograph를 실행하거나 검증 스크립트에 전달하는 뒤 단계. */
const consumerSteps = ['Record installed versions', 'Verify installed versions', 'Cold-cache producer verification'];

/** 검사 대상 workflow 원문. */
const workflow = readFileSync(new URL('../.github/workflows/cold-cache.yml', import.meta.url), 'utf8');
/** producers job 본문(4칸 이상 들여쓴 줄과 빈 줄이 이어지는 구간). 같은 이름의 step이 다른 job에도 있다. */
const producersJob = /^ {2}producers:\n((?:(?: {4}.*)?\n)*)/mu.exec(workflow)?.[1] ?? '';

/** 가짜 curl: URL 끝 이름의 파일을 FAKE_RELEASE에서 -o 대상으로 복사하고, 없으면 HTTP 404처럼 실패한다. */
const fakeCurl = `#!/bin/sh
output=
url=
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o|--output) output=$2; shift 2 ;;
    https://*) url=$1; shift ;;
    *) shift ;;
  esac
done
echo "$url" >> "$FAKE_LOG/curl"
name=\${url##*/}
if [ -z "$output" ] || [ ! -f "$FAKE_RELEASE/$name" ]; then
  echo "curl: (22) The requested URL returned error: 404" >&2
  exit 22
fi
cp "$FAKE_RELEASE/$name" "$output"
`;

/** 가짜 node: 인자마다 0x1f를 붙여 호출 하나를 한 줄로 기록한다(빈 인자도 구분된다). */
const fakeNode = `#!/bin/sh
for argument in "$@"; do printf '%s\\037' "$argument"; done >> "$FAKE_LOG/node"
echo >> "$FAKE_LOG/node"
`;

/** 가짜 npm: 뒤 단계가 쓰는 'npm root --global'에만 답한다. */
const fakeNpm = `#!/bin/sh
if [ "$1" = root ] && [ "$2" = --global ]; then echo "$FAKE_NPM_ROOT"; exit 0; fi
echo "unexpected npm call in cold-cache workflow test: $*" >&2
exit 1
`;

/** 실행되면 label과 인자를 기록하는 kartograph 대역. 어떤 실행 파일이 불렸는지 구분한다. */
function kartographStub(label) {
  return `#!/bin/sh\necho "${label} $*" >> "$FAKE_LOG/kartograph"\necho "kartograph ${version}"\n`;
}

/** 고정 경로 실행 파일과, 예전 find 탐색이 함께 잡던 다른 디렉터리의 bin/kartograph 미끼. */
const releaseEntries = {
  [fixedEntry]: { body: kartographStub('fixed') },
  'aaa/bin/kartograph': { body: kartographStub('decoy') },
  [`kartograph-${version}/lib/decoy/bin/kartograph`]: { body: kartographStub('decoy') },
};

/**
 * producers job에서 이름이 같은 step의 env와 run 본문을 꺼낸다. YAML 해석기를 들이지 않으려고
 * 이 workflow의 모양(6칸 `- name:`, 8칸 키, 10칸 env 항목과 `run: |` 본문)만 읽고, 모양이 바뀌면 실패한다.
 */
function readProducerStep(name) {
  const header = `      - name: ${name}\n`;
  const start = producersJob.indexOf(header);
  assert.notEqual(start, -1, `cold-cache.yml producers job has no "${name}" step; update scripts/cold-cache-workflow.test.mjs with it`);
  const body = /^(?:(?: {8}.*)?\n)*/u.exec(producersJob.slice(start + header.length))[0];
  const envBlock = /^ {8}env:\n((?: {10}.*\n)*)/mu.exec(body)?.[1] ?? '';
  const env = Object.fromEntries([...envBlock.matchAll(/^ {10}(\w+): (.*)$/gmu)].map(([, key, value]) => [key, value]));
  const run = /^ {8}run: \|\n((?:(?: {10}.*)?\n)*)/mu.exec(body)?.[1]?.replace(/^ {10}/gmu, '');
  assert.ok(run, `"${name}" step has no literal run block; keep "run: |" or update this test`);
  // 러너는 run 안의 식을 스크립트 문자열에 그대로 치환하므로, 값은 env로만 받아야 한다.
  assert.doesNotMatch(run, /\$\{\{/u, `"${name}" run embeds an expression; pass it through the step env`);
  return { env, run };
}

/** 러너가 env 값의 `${{ steps.compatibility.outputs.kartograph }}`를 치환하는 동작. 다른 식은 실패시킨다. */
function expandExpressions(value) {
  return value.replace(/\$\{\{(.*?)\}\}/gu, (_match, expression) => {
    assert.equal(expression.trim(), 'steps.compatibility.outputs.kartograph',
      `unsupported expression in step env: ${value}; teach expandExpressions in this test`);
    return version;
  });
}

/** 부모 디렉터리를 만들고 지정한 권한(기본 실행 가능)으로 스크립트를 쓴다. */
function writeScript(path, body, mode = 0o755) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
  chmodSync(path, mode);
}

/** 시나리오 하나의 러너 디렉터리와 가짜 도구, 뒤 단계가 실행하는 cartograph·dartograph 대역을 만든다. */
function createRunner(root) {
  const fakeBin = join(root, 'fake-bin');
  const runner = { root, runnerTemp: join(root, 'runner-temp'), release: join(root, 'release'),
    log: join(root, 'log'), workspace: join(root, 'workspace'), steps: 0, jobEnv: {} };
  for (const directory of [runner.runnerTemp, runner.release, runner.log, runner.workspace]) mkdirSync(directory);
  const fakeTools = { curl: fakeCurl, node: fakeNode, npm: fakeNpm, isthmus: '#!/bin/sh\necho "isthmus stub"\n' };
  for (const [name, body] of Object.entries(fakeTools)) writeScript(join(fakeBin, name), body);
  writeScript(join(runner.runnerTemp, 'cartograph/cartograph/cartograph'), '#!/bin/sh\necho "cartograph stub"\n');
  writeScript(join(root, 'home/.pub-cache/bin/dartograph'), '#!/bin/sh\necho "dartograph stub"\n');
  runner.baseEnv = { PATH: `${fakeBin}${delimiter}${process.env.PATH}`, HOME: join(root, 'home'),
    RUNNER_TEMP: runner.runnerTemp, FAKE_LOG: runner.log, FAKE_RELEASE: runner.release, FAKE_NPM_ROOT: join(root, 'npm-root') };
  return runner;
}

/** 전용 임시 루트에서 러너 하나로 시나리오를 실행하고, 실패해도 그 루트만 지운다. */
function withRunner(scenario) {
  const root = mkdtempSync(join(tmpdir(), 'isthmus-cold-cache-workflow-'));
  try {
    scenario(createRunner(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** GITHUB_ENV의 `NAME=value` 줄을 객체로 읽는다(이 workflow는 여러 줄 형식을 쓰지 않는다). */
function readEnvFile(path) {
  const lines = readFileSync(path, 'utf8').split('\n').filter(line => line !== '');
  return Object.fromEntries(lines.map((line) => {
    const separator = line.indexOf('=');
    assert.ok(separator > 0, `unsupported GITHUB_ENV line: ${line}`);
    return [line.slice(0, separator), line.slice(separator + 1)];
  }));
}

/** step 하나를 러너처럼 실행한다. env 식을 치환하고, GITHUB_ENV로 내보낸 값은 뒤 단계 env에 더한다. */
function runStep(runner, name) {
  const { env, run } = readProducerStep(name);
  runner.steps += 1;
  const prefix = join(runner.root, `step-${runner.steps}`);
  writeFileSync(`${prefix}.sh`, run);
  for (const file of ['env', 'output']) writeFileSync(`${prefix}.${file}`, '');
  const stepEnv = Object.fromEntries(Object.entries(env).map(([key, value]) => [key, expandExpressions(value)]));
  const result = runChild('bash', ['-e', `${prefix}.sh`], { cwd: runner.workspace, timeout: 30_000,
    env: { ...runner.baseEnv, ...runner.jobEnv, ...stepEnv, GITHUB_ENV: `${prefix}.env`, GITHUB_OUTPUT: `${prefix}.output` } });
  assert.equal(result.error, undefined, `${name}: ${result.error?.message}`);
  assert.equal(result.signal, null, `${name}: terminated by ${result.signal}`);
  const exported = readEnvFile(`${prefix}.env`);
  Object.assign(runner.jobEnv, exported);
  return { status: result.status, stderr: result.stderr, exported };
}

/** 가짜 도구가 남긴 기록을 줄 단위로 읽는다. 기록이 없으면 빈 목록이다. */
function readLog(runner, name) {
  const path = join(runner.log, name);
  return existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(line => line !== '') : [];
}

/** 아카이브 안 상대 경로 → { body, mode } 항목으로 릴리스 tar를 만들고 그 경로를 돌려준다. */
function writeArchive(runner, entries) {
  const tree = join(runner.root, 'archive-tree');
  for (const [entry, { body, mode }] of Object.entries(entries)) writeScript(join(tree, entry), body, mode);
  const archive = join(runner.release, `kartograph-${version}.tar`);
  const topLevels = [...new Set(Object.keys(entries).map(entry => entry.split('/')[0]))];
  // COPYFILE_DISABLE은 macOS tar가 AppleDouble(._*) 항목을 덧붙이지 않게 한다.
  const result = runChild('tar', ['-cf', archive, '-C', tree, ...topLevels],
    { env: { ...process.env, COPYFILE_DISABLE: '1' } });
  assert.equal(result.status, 0, result.stderr);
  return archive;
}

/** 실제 릴리스처럼 받지 않는 자산 줄도 담은 SHA256SUMS를 쓴다(그 줄은 --ignore-missing 대상이다). */
function writeChecksums(runner, archive, { hasArchiveLine = true } = {}) {
  const lines = [`${'0'.repeat(64)}  kartograph-${version}.zip`];
  if (hasArchiveLine) {
    lines.unshift(`${createHash('sha256').update(readFileSync(archive)).digest('hex')}  kartograph-${version}.tar`);
  }
  writeFileSync(join(runner.release, 'SHA256SUMS'), `${lines.join('\n')}\n`);
}

/** 설치 단계를 실행하고, 러너 임시 디렉터리에 무엇이든 풀렸는지 함께 돌려준다. */
function runInstallStep(runner) {
  const result = runStep(runner, 'Install kartograph release');
  const target = join(runner.runnerTemp, 'kartograph');
  return { ...result, isExtracted: existsSync(target) && readdirSync(target).length > 0 };
}

/** 설치 단계가 실패했고, 아무것도 풀지 않았고, 뒤 단계에 실행 파일을 넘기지 않았는지 확인한다. */
function assertRefused(result, scenario) {
  assert.notEqual(result.status, 0, `${scenario}: install step succeeded`);
  assert.equal(result.isExtracted, false, `${scenario}: archive was extracted`);
  assert.equal(Object.hasOwn(result.exported, 'KARTOGRAPH_BIN'), false, `${scenario}: KARTOGRAPH_BIN was exported`);
}

test('같은 릴리스 SHA256SUMS와 맞는 아카이브만 풀고 고정 경로 하나만 KARTOGRAPH_BIN으로 넘긴다', () => withRunner((runner) => {
  writeChecksums(runner, writeArchive(runner, releaseEntries));
  const result = runInstallStep(runner);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.exported, { KARTOGRAPH_BIN: `${runner.runnerTemp}/kartograph/${fixedEntry}` });
  assert.deepEqual(readLog(runner, 'curl').sort(), [`${releaseUrl}/SHA256SUMS`, `${releaseUrl}/kartograph-${version}.tar`]);
}));

test('한 바이트만 다른 아카이브도 풀기 전에 거부한다', () => withRunner((runner) => {
  const archive = writeArchive(runner, releaseEntries);
  writeChecksums(runner, archive);
  const bytes = readFileSync(archive);
  const offset = bytes.indexOf('"fixed $*"');
  assert.notEqual(offset, -1, 'fixed kartograph body not found in the archive');
  bytes[offset + 1] ^= 0x20;
  writeFileSync(archive, bytes);
  assertRefused(runInstallStep(runner), 'tampered archive');
  // 두 자산을 다 받은 뒤 대조에서 멈췄다(다운로드 실패로 거부된 것이 아니다).
  assert.equal(readLog(runner, 'curl').length, 2);
}));

test('SHA256SUMS 자산이나 그 안의 아카이브 줄, 아카이브 자산이 없으면 풀지 않는다', () => {
  const scenarios = {
    'SHA256SUMS asset missing': runner => writeArchive(runner, releaseEntries),
    'archive line missing': runner => writeChecksums(runner, writeArchive(runner, releaseEntries), { hasArchiveLine: false }),
    'archive asset missing': (runner) => {
      const archive = writeArchive(runner, releaseEntries);
      writeChecksums(runner, archive);
      rmSync(archive);
    },
  };
  for (const [scenario, prepare] of Object.entries(scenarios)) {
    withRunner((runner) => {
      prepare(runner);
      assertRefused(runInstallStep(runner), scenario);
    });
  }
});

test('대조를 통과해도 고정 경로에 실행 파일이 없으면 그 경로를 밝히고 실패한다', () => {
  // 첫 경우는 다른 경로에만 bin/kartograph가 있어, 탐색으로 고르는 설치 단계라면 통과해 버린다.
  const archives = {
    'fixed path missing': { 'kartograph/bin/kartograph': { body: kartographStub('moved') } },
    'fixed path not executable': { [fixedEntry]: { body: kartographStub('fixed'), mode: 0o644 } },
  };
  for (const [scenario, entries] of Object.entries(archives)) {
    withRunner((runner) => {
      writeChecksums(runner, writeArchive(runner, entries));
      const result = runInstallStep(runner);
      assert.notEqual(result.status, 0, `${scenario}: install step succeeded`);
      assert.ok(result.stderr.includes(fixedEntry), `${scenario}: ${result.stderr}`);
      assert.equal(Object.hasOwn(result.exported, 'KARTOGRAPH_BIN'), false, `${scenario}: KARTOGRAPH_BIN was exported`);
    });
  }
});

test('뒤 단계는 넘겨받은 KARTOGRAPH_BIN 하나만 실행·전달하고 풀린 트리에서 고르지 않는다', () => withRunner((runner) => {
  // 예전 단계가 find로 고르던 트리에는 미끼만 둔다. find 순서는 파일 시스템마다 달라 고정 경로가 먼저
  // 나올 수도 있으므로, 넘겨받는 실행 파일은 트리 밖에 두어 탐색 회귀가 순서와 관계없이 드러나게 한다.
  for (const decoy of ['aaa/bin/kartograph', `kartograph-${version}/lib/decoy/bin/kartograph`]) {
    writeScript(join(runner.runnerTemp, 'kartograph', decoy), kartographStub('decoy'));
  }
  const handoff = join(runner.root, 'handoff', 'kartograph');
  writeScript(handoff, kartographStub('handoff'));
  runner.jobEnv.KARTOGRAPH_BIN = handoff;
  for (const name of consumerSteps) {
    const result = runStep(runner, name);
    assert.equal(result.status, 0, `${name}: ${result.stderr}`);
  }
  assert.deepEqual(readLog(runner, 'kartograph'), ['handoff --version']);
  const calls = readLog(runner, 'node').map(line => line.split('\x1f').slice(0, -1));
  const compatibility = calls.find(call => call[0] === 'scripts/verify-installed-compatibility.mjs');
  assert.equal(compatibility?.includes(`kartograph=${handoff}`), true, JSON.stringify(calls));
  assert.equal(calls.find(call => call[0] === 'scripts/verify-cold-cache.mjs')?.at(-1), handoff, JSON.stringify(calls));
}));
