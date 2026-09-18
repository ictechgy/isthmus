import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runChild } from './run-child.mjs';

// cold-cache workflow가 설치한 도구의 실제 --version을 compatibility.json 정본과
// 대조한다. producer 실행은 scripts/ 검증 작업의 책임이며 제품 CLI는 실행하지 않는다.

const semver = /(\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?)\s*$/u;
const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const compatibility = JSON.parse(readFileSync(join(repositoryRoot, 'compatibility.json'), 'utf8'));
const expected = { isthmus: compatibility.isthmus, ...compatibility.producers };

const pairs = process.argv.slice(2);
if (pairs.length === 0) {
  process.stderr.write('Usage: node scripts/verify-installed-compatibility.mjs <name>=<executable> [more...]\n');
  process.exit(64);
}

let failed = false;
for (const pair of pairs) {
  const separator = pair.indexOf('=');
  if (separator <= 0 || separator === pair.length - 1) {
    process.stderr.write('Usage: node scripts/verify-installed-compatibility.mjs <name>=<executable> [more...]\n');
    process.exit(64);
  }
  const name = pair.slice(0, separator);
  const executable = pair.slice(separator + 1);
  const want = expected[name];
  if (want === undefined) throw new Error(`Unknown tool in compatibility.json: ${name}`);
  const result = runChild(executable, ['--version'], { timeout: 30_000 });
  if (result.error !== undefined || result.status !== 0) {
    failed = true;
    process.stderr.write(`${name}: could not run ${executable} --version\n`);
    continue;
  }
  const got = semver.exec(String(result.stdout).trim())?.[1];
  if (got !== want) {
    failed = true;
    process.stderr.write(`${name}: installed ${got ?? 'unknown'} does not match compatible ${want}\n`);
  }
}
if (failed) process.exit(1);
process.stdout.write('Installed versions match compatibility.json.\n');