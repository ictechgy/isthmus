#!/usr/bin/env node
// capture-trace 테스트용 가짜 생산자다. Swift·JVM 없이 미리 만든 합성 문서를 내보낸다.
// 사용: fake-producer.mjs <tool-name> <mode> ...
//   --version                          → "<tool-name> 9.9.9"
//   emit <fixture> --project <P> [--exit N] → fixture의 project를 P로 바꿔 출력(--exit: 출력 뒤 종료 코드)
//   traverse <fixture> --project <P> [--revision R] [--graph G] [--unknown ID] [--exit N] [--roots-from F | -- ids... | ids...]
//       → 넘겨받은 root 순서로 fixture의 root 인덱스를 다시 매겨 출력한다. fixture root가 빠지면 종료 코드 3.
//         --unknown ID: 그 root를 그래프 노드가 아닌 것으로 보고 계약의 root-not-found로 기록한다(symbol 없는 root,
//         truncated, truncationReasons, limitation). --exit N: 문서를 출력한 뒤 N으로 끝난다(tsograph의 64 재현).
//         --phantom ID: 넘기지 않은 id를 root-not-found로 싣는다(계약 위반 재현).
//         --subset: 넘기지 않은 fixture root를 빼고(그 root에서만 닿은 정점도 뺀다) 실패하지 않는다(root 일부만 받는 경우 재현).
//   fail <code> | garbage | hang       → 실패 경로 재현
// FAKE_PRODUCER_LOG가 있으면 받은 argv를 JSON 한 줄로 덧붙인다(셸 없이 인자가 그대로 왔는지 검사용).
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';

const [tool, mode, ...rest] = process.argv.slice(2);
if (process.env.FAKE_PRODUCER_LOG) appendFileSync(process.env.FAKE_PRODUCER_LOG, `${JSON.stringify([tool, mode, ...rest])}\n`);

/** `--flag value` 값을 꺼내고 나머지 위치 인자를 돌려준다. */
function options(args) {
  const values = {};
  const positionals = [];
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--') { positionals.push(...args.slice(index + 1)); break; }
    if (argument === '--subset') { values[argument] = true; continue; }
    if (['--project', '--revision', '--graph', '--roots-from', '--unknown', '--exit', '--phantom'].includes(argument)) values[argument] = args[++index];
    else positionals.push(argument);
  }
  return { values, positionals };
}

/** 넘긴 root만 남긴 fixture다. 도달 정점은 남은 root에서 닿은 것만 두고 root 인덱스를 새로 매긴다. */
function subset(document, index) {
  const kept = document.roots.flatMap((root, old) => (index.has(root.id) ? [old] : []));
  const renumber = new Map(kept.map((old, position) => [old, position]));
  return { ...document, roots: kept.map((old) => document.roots[old]),
    reached: document.reached.flatMap((entry) => {
      const roots = entry.roots.filter((old) => renumber.has(old)).map((old) => renumber.get(old));
      return roots.length === 0 ? [] : [{ ...entry, roots }];
    }) };
}

if (mode === '--version') {
  process.stdout.write(`${tool} 9.9.9\n`);
} else if (mode === 'emit') {
  const { values, positionals } = options(rest);
  const document = JSON.parse(readFileSync(positionals[0], 'utf8'));
  process.stdout.write(`${JSON.stringify({ ...document, project: values['--project'] })}\n`);
  if (values['--exit'] !== undefined) process.exit(Number(values['--exit']));
} else if (mode === 'traverse') {
  const { values, positionals } = options(rest);
  const original = JSON.parse(readFileSync(positionals[0], 'utf8'));
  const passed = values['--roots-from'] ? JSON.parse(readFileSync(values['--roots-from'], 'utf8')) : positionals.slice(1);
  const index = new Map(passed.map((id, position) => [id, position]));
  const document = values['--subset'] ? subset(original, index) : original;
  const missing = document.roots.filter(({ id }) => !index.has(id));
  if (missing.length > 0) {
    process.stderr.write(`fake producer: required roots were not passed: ${missing.map(({ id }) => id).join(', ')}\n`);
    process.exit(3);
  }
  const remap = (old) => index.get(document.roots[old].id);
  const byId = new Map(document.roots.map((root) => [root.id, root]));
  const output = {
    ...document, project: values['--project'],
    ...(values['--revision'] === undefined ? {} : { revision: values['--revision'] }),
    ...(values['--graph'] === undefined ? {} : { graphRevision: createHash('sha256').update(readFileSync(values['--graph'])).digest('hex') }),
    roots: passed.map((id) => (id === values['--unknown'] ? { id } : byId.get(id) ?? { id, symbol: { usr: id } })),
    reached: document.reached.map((entry) => ({ ...entry, roots: entry.roots.map(remap).sort((a, b) => a - b) })),
  };
  if (values['--phantom'] !== undefined) output.roots.push({ id: values['--phantom'] });
  if ((values['--unknown'] !== undefined && index.has(values['--unknown'])) || values['--phantom'] !== undefined) {
    Object.assign(output, { truncated: true, truncationReasons: [...new Set([...(document.truncationReasons ?? []), 'root-not-found'])].sort(),
      limitations: [...document.limitations, 'root-not-found: 1 root id is not a graph node.'] });
  }
  process.stdout.write(`${JSON.stringify(output)}\n`);
  if (values['--exit'] !== undefined) process.exit(Number(values['--exit']));
} else if (mode === 'fail') {
  process.stderr.write('fake producer failure detail\n');
  process.exit(Number(rest[0]));
} else if (mode === 'garbage') {
  process.stdout.write('not json\n');
} else if (mode === 'hang') {
  // SIGTERM을 무시해 capture가 SIGKILL로 시간 제한을 지키는지 본다.
  process.on('SIGTERM', () => {});
  setInterval(() => {}, 1000);
} else {
  process.stderr.write(`fake producer: unknown mode ${mode}\n`);
  process.exit(64);
}
