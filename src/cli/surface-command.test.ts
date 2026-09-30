import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { runHttpDiffCommand } from './http-diff-command.ts';
import { runSurfaceCommand, surfaceUsage } from './surface-command.ts';
import { runTraceCommand } from './trace-command.ts';

/**
 * 조직 경계 CLI — `surface export`(문서 목록·workspace member), surface를 가져오는 trace·`diff --http`의 sha256 고정과
 * 입력 오류(2)·사용 오류(64)를 고정한다. 파일은 `/fx/` 아래 합성 fixture만 읽는 가짜 파일시스템으로 준다.
 */

const root = new URL('../../fixtures/', import.meta.url);
const names = ['http-surface/server/release-2.3/server.http.json', 'http-surface/server/release-2.3/api.openapi.json',
  'http-surface/server/release-2.4/server.http.json', 'http-surface/server/release-2.4/api.openapi.json',
  'http-surface/surfaces/example-api-2.3.surface.json', 'http-surface/surfaces/example-api-2.4.surface.json',
  'http-surface/client/android.http.json', 'http-surface/client/android-reverse.json', 'http-surface/client/context.json',
  'http-surface/client/before.workspace.json', 'http-surface/client/after.workspace.json',
  'trace-library/context.json', 'trace-library/sdk/sdk.http.json', 'trace-library/sdk/sdk-reverse.json',
  'trace-library/app-a/app-a-reverse.json', 'trace-library/app-b/app-b-reverse.json'];
const files = new Map<string, string>();
for (const name of names) files.set(name, await readFile(new URL(name, root), 'utf8'));

/** `/fx/` 아래 경로만 fixture로 읽는다. overrides가 이긴다. */
function reader(overrides: Record<string, string> = {}) {
  return async (path: string) => {
    const name = path.startsWith('/fx/') ? path.slice('/fx/'.length) : undefined;
    const text = name === undefined ? undefined : overrides[name] ?? files.get(name);
    if (text === undefined) throw new Error('missing');
    return text;
  };
}

const release = (version: string) => [`/fx/http-surface/server/release-${version}/server.http.json`,
  `/fx/http-surface/server/release-${version}/api.openapi.json`];

test('surface export는 fixture artifact와 같은 바이트를 결정적으로 낸다', async () => {
  // fixture artifact는 isthmus 0.9.0으로 내보냈다. exporter 버전을 같게 주면 바이트까지 같다.
  const result = await runSurfaceCommand(['surface', 'export', '--name', 'example-api', '--revision', 'v2.4', ...release('2.4')],
    reader(), '0.9.0');
  assert.equal(result.exitCode, 0);
  assert.equal(result.standardError, '');
  assert.equal(result.standardOutput, files.get('http-surface/surfaces/example-api-2.4.surface.json'));
  const compact = await runSurfaceCommand(['surface', 'export', '--compact', '--name', 'example-api', '--revision', 'v2.4',
    '--include-handler-usrs', '--include-limitation-text', ...release('2.4')], reader(), '0.9.0');
  assert.equal(compact.standardOutput.trim().split('\n').length, 1);
  assert.deepEqual(JSON.parse(compact.standardOutput).privacy, { handlers: 'usr', limitations: 'full' });
});

test('surface export는 workspace member의 선언 측 문서만 쓰고 이름·revision 기본값을 member에서 가져온다', async () => {
  const manifest = JSON.stringify({ format: 'isthmus-workspace', version: 1, members: [
    { name: 'example-api', project: '/work/example-server', revision: 'srv-2.4',
      documents: ['release-2.4/server.http.json', 'release-2.4/api.openapi.json'] },
    { name: 'mixed', project: '/work/example-server', revision: 'r',
      documents: ['release-2.3/server.http.json', '../client/android.http.json'] }], links: [] });
  const read = reader({ 'http-surface/server/manifest.json': manifest });
  const result = await runSurfaceCommand(['surface', 'export', '--workspace', '/fx/http-surface/server/manifest.json',
    '--member', 'example-api'], read, '0.9.0');
  assert.equal(result.exitCode, 0, result.standardError);
  // member project와 다른 문서(다른 저장소의 클라이언트 문서)는 걸러 내지 않고 거부한다.
  assert.match((await runSurfaceCommand(['surface', 'export', '--workspace', '/fx/http-surface/server/manifest.json',
    '--member', 'mixed'], read, '0.9.0')).standardError, /member project/u);
  const surface = JSON.parse(result.standardOutput);
  assert.deepEqual([surface.name, surface.revision, surface.documents.length], ['example-api', 'srv-2.4', 2]);
  const renamed = await runSurfaceCommand(['surface', 'export', '--workspace', '/fx/http-surface/server/manifest.json',
    '--member', 'example-api', '--name', 'orders-api', '--revision', 'v2.4'], read, '0.9.0');
  assert.deepEqual([JSON.parse(renamed.standardOutput).name, JSON.parse(renamed.standardOutput).revision], ['orders-api', 'v2.4']);
  const missing = await runSurfaceCommand(['surface', 'export', '--workspace', '/fx/http-surface/server/manifest.json',
    '--member', 'nobody'], read, '0.9.0');
  assert.equal(missing.exitCode, 2);
  assert.match(missing.standardError, /document member/u);
  const clientOnly = reader({ 'http-surface/server/manifest.json': JSON.stringify({ format: 'isthmus-workspace', version: 1,
    members: [{ name: 'c', project: '/work/example-client', revision: 'r', documents: ['../client/android.http.json'] },
      { name: 's', surface: { path: 'x.surface.json', sha256: '0'.repeat(64) } }], links: [] }) });
  assert.match((await runSurfaceCommand(['surface', 'export', '--workspace', '/fx/http-surface/server/manifest.json',
    '--member', 's'], clientOnly, '0.9.0')).standardError, /not a surface member/u);
  assert.match((await runSurfaceCommand(['surface', 'export', '--workspace', '/fx/http-surface/server/manifest.json',
    '--member', 'c'], clientOnly, '0.9.0')).standardError, /no http server or openapi document/u);
});

test('surface export 사용 오류는 64, 입력 오류는 경로 없는 원인 문구와 2다', async () => {
  const usage = [
    ['surface'], ['surface', 'import', 'a.json'], ['surface', 'export', '--name', 'x', '--revision', 'y'],
    ['surface', 'export', '--name', 'x', 'a.json'], ['surface', 'export', '--workspace', 'w.json'],
    ['surface', 'export', '--workspace', 'w.json', '--member', 'm', 'extra.json'], ['surface', 'export', '--bogus'],
  ];
  for (const argumentsList of usage) {
    const result = await runSurfaceCommand(argumentsList, reader(), '0.9.0');
    assert.deepEqual([result.exitCode, result.standardError], [64, `${surfaceUsage}\n`], argumentsList.join(' '));
  }
  const args = ['surface', 'export', '--name', 'example-api', '--revision', 'v1', ...release('2.4')];
  assert.match((await runSurfaceCommand(args, reader(), undefined)).standardError, /package metadata/u);
  const client = await runSurfaceCommand(['surface', 'export', '--name', 'n', '--revision', 'r',
    '/fx/http-surface/client/android.http.json'], reader(), '0.9.0');
  assert.equal(client.exitCode, 2);
  assert.match(client.standardError, /violates its contract: surface export takes only http server documents/u);
  const badName = await runSurfaceCommand(['surface', 'export', '--name', ' x', '--revision', 'r', ...release('2.4')], reader(), '0.9.0');
  assert.match(badName.standardError, /Invalid http surface name/u);
  const unreadable = await runSurfaceCommand(['surface', 'export', '--name', 'n', '--revision', 'r', '/fx/none.json'], reader(), '0.9.0');
  assert.match(unreadable.standardError, /Unable to read bridge facts input 1/u);
  for (const [text, pattern] of [['{', /not valid JSON/u], ['x'.repeat(16 * 1024 * 1024 + 1), /size limit/u],
    [JSON.stringify({ format: 'isthmus-workspace', version: 2 }), /isthmus-workspace version 1/u]] as const) {
    const result = await runSurfaceCommand(['surface', 'export', '--workspace', '/fx/w.json', '--member', 'm'],
      reader({ 'w.json': text }), '0.9.0');
    assert.equal(result.exitCode, 2);
    assert.match(result.standardError, pattern);
  }
  assert.match((await runSurfaceCommand(['surface', 'export', '--workspace', '/fx/none.json', '--member', 'm'], reader(), '0.9.0'))
    .standardError, /Unable to read the workspace manifest/u);
});

test('trace는 surface 파일을 고정한 sha256과 대조하고, 다르면 부분 결과 없이 2다', async () => {
  const ok = await runTraceCommand(['trace', '/fx/http-surface/client/context.json', '--compact'], reader());
  assert.equal(ok.exitCode, 0, ok.standardError);
  assert.deepEqual(JSON.parse(ok.standardOutput).gaps.map(({ code }: { code: string }) => code), ['server-surface-opaque']);
  const strict = await runTraceCommand(['trace', '/fx/http-surface/client/context.json', '--strict'], reader());
  assert.equal(strict.exitCode, 1);
  const tampered = files.get('http-surface/surfaces/example-api-2.4.surface.json')!.replace('"v2.4"', '"v2.5"');
  const mismatch = await runTraceCommand(['trace', '/fx/http-surface/client/context.json'],
    reader({ 'http-surface/surfaces/example-api-2.4.surface.json': tampered }));
  assert.deepEqual([mismatch.exitCode, mismatch.standardOutput], [2, '']);
  assert.match(mismatch.standardError, /trace http surface 1 does not match its pinned sha256/iu);
  assert.ok(!mismatch.standardError.includes('surfaces/'));
  const context = JSON.parse(files.get('http-surface/client/context.json')!);
  const repinned = structuredClone(context);
  const { createHash } = await import('node:crypto');
  repinned.members[0].surface.sha256 = createHash('sha256').update(tampered, 'utf8').digest('hex');
  const edited = await runTraceCommand(['trace', '/fx/http-surface/client/context.json'], reader({
    'http-surface/client/context.json': JSON.stringify(repinned), 'http-surface/surfaces/example-api-2.4.surface.json': tampered }));
  assert.equal(edited.exitCode, 2);
  assert.match(edited.standardError, /digest does not match its content/u);
  const missing = await runTraceCommand(['trace', '/fx/http-surface/client/context.json'], reader({
    'http-surface/client/context.json': JSON.stringify({ ...context, members: [{ ...context.members[0],
      surface: { ...context.members[0].surface, path: 'none.json' } }, context.members[1]] }) }));
  assert.match(missing.standardError, /Unable to read trace http surface 1/u);
  for (const text of ['{', 'x'.repeat(16 * 1024 * 1024 + 1)]) {
    const repin = structuredClone(context);
    repin.members[0].surface.sha256 = createHash('sha256').update(text, 'utf8').digest('hex');
    const result = await runTraceCommand(['trace', '/fx/http-surface/client/context.json'], reader({
      'http-surface/client/context.json': JSON.stringify(repin), 'http-surface/surfaces/example-api-2.4.surface.json': text }));
    assert.equal(result.exitCode, 2);
    assert.match(result.standardError, /not valid JSON|size limits/u);
  }
  const library = await runTraceCommand(['trace', '/fx/trace-library/context.json', '--compact'], reader());
  assert.equal(library.exitCode, 0, library.standardError);
  assert.equal(JSON.parse(library.standardOutput).summary.clientSymbols, 7);
});

test('diff --http는 surface artifact 두 개와 surface member 매니페스트를 받고, 종류가 섞이면 2다', async () => {
  const surfaces = ['diff', '--http', '--before', '/fx/http-surface/surfaces/example-api-2.3.surface.json',
    '--after', '/fx/http-surface/surfaces/example-api-2.4.surface.json', '--clients', '/fx/http-surface/client/android.http.json'];
  const direct = await runHttpDiffCommand([...surfaces, '--fail-on', 'error'], reader());
  assert.equal(direct.exitCode, 1);
  assert.match(direct.standardError, /removed-bound-route \(1\)/u);
  assert.equal(JSON.parse(direct.standardOutput).surface.before.revision, 'v2.3');
  const workspace = await runHttpDiffCommand(['diff', '--http', '--before', '/fx/http-surface/client/before.workspace.json',
    '--after', '/fx/http-surface/client/after.workspace.json', '--strict'], reader());
  assert.equal(workspace.exitCode, 1);
  assert.match(workspace.standardError, /removed-bound-route \(2\)/u);
  const mixed = await runHttpDiffCommand(['diff', '--http', '--before', '/fx/http-surface/surfaces/example-api-2.3.surface.json',
    '--after', '/fx/http-surface/client/after.workspace.json'], reader());
  assert.equal(mixed.exitCode, 2);
  assert.match(mixed.standardError, /different kinds/u);
  const repinned = JSON.parse(files.get('http-surface/client/after.workspace.json')!);
  repinned.members[0].surface.sha256 = '0'.repeat(64);
  const stale = await runHttpDiffCommand(['diff', '--http', '--before', '/fx/http-surface/client/before.workspace.json',
    '--after', '/fx/http-surface/client/after.workspace.json'], reader({ 'http-surface/client/after.workspace.json': JSON.stringify(repinned) }));
  assert.equal(stale.exitCode, 2);
  assert.match(stale.standardError, /after http surface 1 does not match its pinned sha256/iu);
});
