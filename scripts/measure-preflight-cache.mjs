import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { capturePreflight } from './capture-preflight.mjs';

// 사용자 캐시를 지우지 않고 같은 소스·도구에서 첫 수집과 재사용을 측정한다.
const [configurationPath, outputPath, ...extra] = process.argv.slice(2);
if (!configurationPath || extra.length) {
  process.stderr.write('Usage: node scripts/measure-preflight-cache.mjs <capture-config.json> [measurement.json]\n');
  process.exit(64);
}
const work = await mkdtemp(join(tmpdir(), 'isthmus-cache-measurement-'));
try {
  const config = { ...JSON.parse(await readFile(configurationPath, 'utf8')),
    cache: join(work, 'cache.json'), output: join(work, 'context.json') };
  const first = await capturePreflight(config);
  const second = await capturePreflight(config);
  assert.equal(first.cached, false, 'The first capture must use the isolated empty cache.');
  assert.equal(second.cached, true, 'Unchanged declared inputs must reuse the captured evidence.');
  assert.deepEqual(second.report, first.report, 'Cache reuse must preserve the complete report.');
  const document = {
    format: 'isthmus-cache-measurement', version: 1,
    generatedAt: new Date().toISOString(),
    note: 'Two captures of unchanged declared inputs with an isolated isthmus cache. SDK, build and producer caches are not cleared. This does not measure full app builds or runtime accuracy.',
    tools: [...new Map([...first.context.bridges, ...(first.context.messages ?? [])]
      .map(({ tool }) => [tool.name, tool])).values()],
    uncached: { cached: first.cached, milliseconds: first.milliseconds, timings: first.timings },
    reused: { cached: second.cached, milliseconds: second.milliseconds, timings: second.timings },
    identicalReports: true,
    summary: first.report.summary,
  };
  const text = JSON.stringify(document, null, 2) + '\n';
  if (outputPath) await writeFile(outputPath, text);
  process.stdout.write(text);
} catch (error) {
  process.stderr.write(error instanceof assert.AssertionError
    ? 'Cache measurement failed: cache reuse or report equivalence was not established.\n'
    : 'Cache measurement failed: check the capture configuration, declared inputs and producer commands.\n');
  process.exitCode = 2;
} finally {
  await rm(work, { recursive: true, force: true });
}
