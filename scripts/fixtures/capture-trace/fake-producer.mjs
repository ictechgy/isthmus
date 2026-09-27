#!/usr/bin/env node
// capture-trace 테스트용 가짜 생산자다. Swift·JVM 없이 미리 만든 합성 문서를 내보낸다.
// 사용: fake-producer.mjs <tool-name> <mode> ...
//   --version                          → "<tool-name> 9.9.9"
//   emit <fixture> --project <P>       → fixture의 project를 P로 바꿔 출력
//   traverse <fixture> --project <P> [--revision R] [--graph G] [--roots-from F | -- ids... | ids...]
//       → 넘겨받은 root 순서로 fixture의 root 인덱스를 다시 매겨 출력한다. fixture root가 빠지면 종료 코드 3.
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
    if (['--project', '--revision', '--graph', '--roots-from'].includes(argument)) values[argument] = args[++index];
    else positionals.push(argument);
  }
  return { values, positionals };
}

if (mode === '--version') {
  process.stdout.write(`${tool} 9.9.9\n`);
} else if (mode === 'emit') {
  const { values, positionals } = options(rest);
  const document = JSON.parse(readFileSync(positionals[0], 'utf8'));
  process.stdout.write(`${JSON.stringify({ ...document, project: values['--project'] })}\n`);
} else if (mode === 'traverse') {
  const { values, positionals } = options(rest);
  const document = JSON.parse(readFileSync(positionals[0], 'utf8'));
  const passed = values['--roots-from'] ? JSON.parse(readFileSync(values['--roots-from'], 'utf8')) : positionals.slice(1);
  const index = new Map(passed.map((id, position) => [id, position]));
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
    roots: passed.map((id) => byId.get(id) ?? { id, symbol: { usr: id } }),
    reached: document.reached.map((entry) => ({ ...entry, roots: entry.roots.map(remap).sort((a, b) => a - b) })),
  };
  process.stdout.write(`${JSON.stringify(output)}\n`);
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
