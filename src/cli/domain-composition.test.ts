import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import test from 'node:test';

import { runCheckCommand } from './check-command.ts';
import type { CommandResult } from './command-support.ts';
import { runDiffCommand } from './diff-command.ts';
import { runGraphCommand } from './graph-command.ts';
import { runImpactCommand } from './impact-command.ts';
import { runPreflightCommand } from './preflight-command.ts';
import { runQueryCommand } from './query-command.ts';
import { runRetentionsCommand } from './retentions-command.ts';
import { encodeSortedJson } from '../report/sorted-json.ts';

/**
 * bridge 도메인 판정을 명시 규칙으로 바꾼 뒤에도 기존 입력 구성의 출력이 그대로인지 고정한다.
 *
 * `expected.json`은 규칙을 바꾸기 전 origin/main(e45ef2b)의 실제 출력이다. bridge 전용,
 * persistence 전용, 혼합, 사실 0건 bridge 문서 입력마다 stdout 바이트(SHA-256)와 stderr,
 * 종료 코드를 비교한다. 의도한 동작 변경(원인 문구, 새 거부, impact 이슈 귀속)은 이 표에
 * 넣지 않고 아래 개별 테스트로 기대값을 적는다.
 *
 * 다시 캡처하기: 이 표의 명령 출력을 의도적으로 바꿨다면
 * `UPDATE_DOMAIN_COMPOSITION=1 node --test src/cli/domain-composition.test.ts`로 각 항목의
 * `args`를 현재 코드로 다시 실행해 `expected.json`을 덮어쓴다. 표는 불변 근거이므로 커밋 전에
 * `git diff fixtures/domain-composition/expected.json`의 모든 변경이 의도한 것인지 검토하고,
 * 입력 구성(bridge 판정)과 무관한 변경이 섞였는지 확인한다. 시나리오를 새로 넣을 때는
 * `name`·`args`만 가진 항목을 추가한 뒤 같은 명령으로 나머지 필드를 채운다.
 */
const fixtureRoot = new URL('../../fixtures/domain-composition/', import.meta.url);
const read = (path: string): Promise<string> => readFile(new URL(path, fixtureRoot), 'utf8');
const clock = (): Date => new Date('2026-09-26T00:00:00.000Z');
const version = '0.0.0-fixture';

/**
 * 1이면 비교하지 않고 표를 현재 출력으로 다시 캡처한다.
 *
 * 캡처 도구를 저장소 밖에 두면 의도한 출력 변경마다 파싱본과 해시를 손으로 고쳐야 하므로,
 * 표를 만든 절차를 테스트와 같은 실행 경로(`run`)로 남긴다.
 */
const shouldUpdatePinnedScenarios = process.env.UPDATE_DOMAIN_COMPOSITION === '1';

/** origin/main에서 캡처한 시나리오 한 건이다. stdout은 JSON이면 파싱본, 아니면 원문이다. */
interface PinnedScenario {
  readonly name: string;
  readonly args: readonly string[];
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdoutSha256: string;
  readonly stdout: unknown;
}

const scenarios = JSON.parse(await read('expected.json')) as PinnedScenario[];

/**
 * 명령 결과를 표 항목으로 바꾼다. 키 순서는 표 파일과 같다.
 *
 * JSON 문서(객체·codequality 배열)는 실패 시 차이를 읽기 쉽게 파싱본으로, 그 밖(mermaid,
 * 실패 시 빈 stdout)은 원문으로 싣는다. `{`·`[`로 시작하는데 JSON이 아니면 파싱이 던져
 * 캡처가 실패한다 — 깨진 출력을 원문으로 조용히 고정하지 않기 위해서다.
 */
function toPinnedScenario(name: string, args: readonly string[], result: CommandResult): PinnedScenario {
  const output = result.standardOutput;
  const isJsonDocument = output.startsWith('{') || output.startsWith('[');
  return {
    name,
    args,
    exitCode: result.exitCode,
    stderr: result.standardError,
    stdoutSha256: createHash('sha256').update(output).digest('hex'),
    stdout: isJsonDocument ? JSON.parse(output) as unknown : output,
  };
}

/** 시나리오 인자를 CLI와 같은 명령 함수로 보낸다. 시각·버전은 캡처 때와 같게 고정한다. */
function run(args: readonly string[]): Promise<CommandResult> {
  switch (args[0]) {
    case 'check': return runCheckCommand(args, read, undefined, clock, version);
    case 'graph': return runGraphCommand(args, read);
    case 'diff': return runDiffCommand(args, read);
    case 'query': return runQueryCommand(args, read);
    case 'impact': return runImpactCommand(args, read);
    case 'retentions': return runRetentionsCommand(args, read, clock, version);
    case 'preflight': return runPreflightCommand(args, read);
    default: throw new Error(`Unknown pinned command: ${args[0]}`);
  }
}

test('고정 시나리오 표가 네 가지 입력 구성을 모두 덮는다', () => {
  const groups = new Set(scenarios.map(({ name }) => name.split('/')[0]));
  assert.deepEqual([...groups].sort(), ['bridge', 'mixed', 'persistence', 'zero-fact']);
  assert.equal(new Set(scenarios.map(({ name }) => name)).size, scenarios.length);
});

if (shouldUpdatePinnedScenarios) {
  test('고정 시나리오 표를 현재 출력으로 다시 캡처한다', async () => {
    const captured: PinnedScenario[] = [];
    for (const { name, args } of scenarios) captured.push(toPinnedScenario(name, args, await run(args)));
    await writeFile(new URL('expected.json', fixtureRoot), `${JSON.stringify(captured, null, 2)}\n`);
  });
}

for (const scenario of shouldUpdatePinnedScenarios ? [] : scenarios) {
  test(`입력 구성 불변: ${scenario.name}`, async () => {
    const result = await run(scenario.args);
    assert.equal(result.exitCode, scenario.exitCode);
    assert.equal(result.standardError, scenario.stderr);
    // 파싱본 비교는 실패 시 차이를 읽기 쉽게 하고, 해시는 키 순서·공백까지 같은지 본다.
    if (typeof scenario.stdout === 'string') {
      assert.equal(result.standardOutput, scenario.stdout);
    } else {
      assert.deepEqual(JSON.parse(result.standardOutput), scenario.stdout);
    }
    assert.equal(
      createHash('sha256').update(result.standardOutput).digest('hex'),
      scenario.stdoutSha256,
    );
    // 다시 캡처하는 직렬화가 표 형식(파싱 여부·키)과 어긋나면 재생성 절차가 표를 바꿔 버린다.
    assert.deepEqual(toPinnedScenario(scenario.name, scenario.args, result), scenario);
  });
}

test('check --pairs는 고정된 기본 출력에 matches만 더하고 종료 코드·오류는 그대로다', async () => {
  // 플래그 없는 check가 --pairs 도입 전(origin/main) 바이트와 같은지는 위 표가 확인한다.
  // 여기서는 같은 시나리오에 --pairs를 붙여도 matches 외의 바이트가 흔들리지 않음을 본다.
  const checks = scenarios.filter(({ args }) => args[0] === 'check' && !args.includes('--format'));
  assert.ok(checks.length >= 10);
  for (const scenario of checks) {
    const paired = await run([...scenario.args, '--pairs']);
    assert.equal(paired.exitCode, scenario.exitCode, scenario.name);
    assert.equal(paired.standardError, scenario.stderr, scenario.name);
    if (scenario.exitCode === 2) {
      assert.equal(paired.standardOutput, '', scenario.name);
      continue;
    }
    const { matches, ...rest } = JSON.parse(paired.standardOutput);
    assert.deepEqual(rest, scenario.stdout, scenario.name);
    assert.equal(paired.standardOutput, encodeSortedJson({ ...(scenario.stdout as object), matches }), scenario.name);
    // bridge 전용 입력은 persistence 매치가 없다.
    if (scenario.name.startsWith('bridge/') || scenario.name.startsWith('zero-fact/')) {
      assert.deepEqual(matches, [], scenario.name);
    }
  }
});

// 아래는 platform만 보던 역할 판정이 만들던 결함을 고친 의도한 변경이다.

test('diff는 persistence 문서를 일반 스냅샷 문구가 아니라 원인 문구로 거부한다', async () => {
  const cases = [
    ['diff', '--before', 'dart.json', 'swift.json', 'kotlin-persistence.json', 'sql.json',
      '--after', 'dart.json', 'swift.json', 'kotlin-persistence.json', 'sql.json'],
    ['diff', '--before', 'go-persistence.json', 'sql.json', '--after', 'go-persistence.json', 'sql.json'],
  ];
  for (const args of cases) {
    const result = await run(args);
    assert.equal(result.exitCode, 2);
    assert.equal(result.standardOutput, '');
    assert.match(result.standardError, /^Diff does not support persistence documents yet;/);
  }
  // bridge 문서만 다른 경우는 기존 일반 문구를 유지한다.
  const bridgeOnly = await run(['diff', '--before', 'dart.json', 'swift.json', '--after', 'dart.json', 'kotlin.json']);
  assert.equal(bridgeOnly.exitCode, 2);
  assert.match(bridgeOnly.standardError, /^Diff requires the same project/);
});

test('retentions --for kartograph는 kotlin persistence 문서를 수신 측 근거로 세지 않는다', async () => {
  const result = await run(['retentions', 'dart.json', 'swift.json', 'kotlin-persistence.json', 'sql.json',
    '--for', 'kartograph']);
  assert.equal(result.exitCode, 2);
  assert.equal(result.standardOutput, '');
  assert.match(result.standardError, /require at least one kotlin bridge facts document/);
  assert.match(result.standardError, /persistence documents are not bridge receiver evidence/);
});

test('impact는 비한정 사용이 닿는 한정 선언의 컬럼 진단을 놓치지 않고 --strict에서 막는다', async () => {
  const result = await run(['impact', '--file', 'src/Repo.kt', 'kotlin-persistence.json', 'sql.json', '--strict']);
  assert.equal(result.exitCode, 1);
  const report = JSON.parse(result.standardOutput);
  assert.deepEqual(report.issues.map(({ code, channel, method }: { code: string; channel: string; method?: string }) =>
    [code, channel, method]), [['column-use-without-decl', 'public.users', 'nickname']]);
  assert.equal(report.summary.errors, 1);
});

test('impact --strict는 선택한 persistence 사실의 경고 진단도 blocker로 센다', async () => {
  const result = await run(['impact', '--symbol', 'public.audit', 'kotlin-persistence.json', 'sql.json', '--strict']);
  assert.equal(result.exitCode, 1);
  const report = JSON.parse(result.standardOutput);
  assert.deepEqual(report.issues.map(({ code, severity }: { code: string; severity: string }) => [code, severity]),
    [['relation-decl-without-use', 'warning']]);
  assert.equal(report.summary.errors, 0);
});

test('preflight context는 persistence 문서를 원인 문구로 거부한다', async () => {
  const context = JSON.parse(await read('../preflight/context.json'));
  const persistence = JSON.parse(await read('kotlin-persistence.json'));
  context.bridges.push({ ...persistence, project: context.project });
  const result = await runPreflightCommand(['preflight', 'context.json'], async () => JSON.stringify(context));
  assert.equal(result.exitCode, 2);
  assert.match(result.standardError, /Preflight context supports only bridge documents/);
});

test('사실 없는 bridge 플랫폼 문서만 있는 persistence 입력은 target null 원인을 알린다', async () => {
  const result = await run(['check', 'kotlin-empty.json', 'sql.json']);
  assert.equal(result.exitCode, 2);
  assert.match(result.standardError, /one receiver platform \(swift, kotlin\) document/);
  assert.match(result.standardError, /carries a null target/);
});
