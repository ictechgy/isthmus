import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { runCheckCommand } from './check-command.ts';
import type { CommandResult } from './command-support.ts';
import { runDiffCommand } from './diff-command.ts';
import { runGraphCommand } from './graph-command.ts';
import { runImpactCommand } from './impact-command.ts';
import { runPreflightCommand } from './preflight-command.ts';
import { runQueryCommand } from './query-command.ts';
import { runRetentionsCommand } from './retentions-command.ts';

/**
 * bridge 도메인 판정을 명시 규칙으로 바꾼 뒤에도 기존 입력 구성의 출력이 그대로인지 고정한다.
 *
 * `expected.json`은 규칙을 바꾸기 전 origin/main(e45ef2b)의 실제 출력이다. bridge 전용,
 * persistence 전용, 혼합, 사실 0건 bridge 문서 입력마다 stdout 바이트(SHA-256)와 stderr,
 * 종료 코드를 비교한다. 의도한 동작 변경(원인 문구, 새 거부, impact 이슈 귀속)은 이 표에
 * 넣지 않고 아래 개별 테스트로 기대값을 적는다.
 */
const fixtureRoot = new URL('../../fixtures/domain-composition/', import.meta.url);
const read = (path: string): Promise<string> => readFile(new URL(path, fixtureRoot), 'utf8');
const clock = (): Date => new Date('2026-09-26T00:00:00.000Z');
const version = '0.0.0-fixture';

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

for (const scenario of scenarios) {
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
  });
}
