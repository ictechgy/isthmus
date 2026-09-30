import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  commentMarker, escapeHtml, escapeMarkdownText, fitToLimit, GITHUB_COMMENT_LIMIT, inlineCode, matchesFailOn, parseFailOn,
  parseRenderArguments, RenderInputError, renderPrComment, singleLine, validateCommentKey,
} from './render-pr-comment.mjs';
import { runChild } from './run-child.mjs';

// 렌더러 회귀 테스트다. 실제 CLI 출력(합성 fixture)과 손으로 만든 악성·경계 입력을 함께 쓴다.

/** 저장소 루트다. */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** 빌드된 CLI다(npm run verify는 이 테스트 전에 clean build를 한다). */
const cli = join(root, 'dist', 'cli', 'main.js');
/** 렌더러 스크립트 경로다. */
const renderer = join(root, 'scripts', 'render-pr-comment.mjs');

/** CLI로 fixture diff를 만든다. */
function fixtureDiff(args) {
  const result = runChild(process.execPath, [cli, 'diff', '--http', ...args], { cwd: root });
  assert.ok(result.status === 0 || result.status === 1, result.stderr);
  return JSON.parse(result.stdout);
}

/** 최소 diff 보고서(합성)다. */
function syntheticDiff({ findings = [], summary = {}, mode = 'surface', extra = {} } = {}) {
  return {
    format: 'isthmus-http-diff', version: 1, mode, findings,
    summary: { findings: findings.length, errors: 0, warnings: 0, info: 0, routesAdded: 0, routesRemoved: 0, routesChanged: 0,
      brokenCalls: 0, provenBrokenCalls: 0, reboundCalls: 0, incompleteness: 0, callImpact: 'no-breaks-observed', ...summary },
    limitations: { before: [], after: [] }, ...extra,
  };
}

/**
 * 코드 스팬과 `<code>` 요소 밖의 텍스트만 남긴다(주입 검사용 — 그 안은 Markdown·HTML·멘션으로 해석되지 않는다).
 * `<code>` 안은 렌더러가 HTML 엔티티로 바꾸므로 backtick이 없다. 먼저 지워야 코드 스팬 짝이 어긋나지 않는다.
 */
function outsideCodeSpans(markdown) {
  return markdown.replace(/<code>[^<]*<\/code>/gu, '').replace(/(?<!`)(`+)(?!`)(?:(?!\1)[\s\S])*?(?<!`)\1(?!`)/gu, '');
}

test('surface fixture: 깨짐 호출·불완전성 배너·표면 변화·정책 줄을 결정적으로 싣는다', () => {
  const diff = fixtureDiff(['--before', 'fixtures/http-diff/surface/before.server.json', '--after',
    'fixtures/http-diff/surface/after.server.json', '--clients', 'fixtures/http-diff/surface/clients.json']);
  const meta = { format: 'isthmus-ci-meta', version: 1, failOn: 'error', diff: { exitCode: 1 }, errors: [] };
  const body = renderPrComment({ diff, meta });
  assert.equal(body, renderPrComment({ diff, meta }), '같은 입력이면 같은 출력');
  assert.ok(body.startsWith(`${commentMarker()}\n`));
  assert.match(body, /\*\*4 client call\(s\) stop binding at head\*\* — 3 proven, 1 unverified\./u);
  assert.match(body, /Incomplete analysis — an empty or short list below is not evidence that no client breaks/u);
  assert.match(body, /`calls-dynamic` ×1/u);
  assert.match(body, /\*\*fail-on\*\* `error`: \*\*failed\*\* — 3 matching finding\(s\)\./u);
  assert.match(body, /\| `error` \| `removed-bound-route` \| `POST \/api\/orders` `default · decl` \| `app\/src\/main\/java\/example\/Api\.kt:28` `OrdersApi\.create` \| `missing` \| — \|/u);
  assert.match(body, /`method-dynamic`/u);
  assert.match(body, /#### Calls now served by a different route \(1\)/u);
  assert.match(body, /`2:int → 2:uuid`/u);
  assert.match(body, /2 informational finding\(s\)/u);
  // error가 warning보다 먼저다.
  assert.ok(body.indexOf('`removed-bound-route-unverified`') > body.lastIndexOf('| `error` | `removed-bound-route`'));
});

test('workspace fixture: 호출 위치 앞에 link의 client member를 붙인다', () => {
  const diff = fixtureDiff(['--before', 'fixtures/http-diff/workspace/before.workspace.json', '--after',
    'fixtures/http-diff/workspace/after.workspace.json']);
  const body = renderPrComment({ diff });
  assert.match(body, /`client:app\/src\/main\/java\/example\/Api\.kt:20` `OrdersApi\.cancel`/u);
  assert.match(body, /`mobile->api · contract`/u);
  assert.match(body, /workspace mode/u);
  assert.match(body, /\*\*fail-on:\*\* not set \(report only\)\./u);
});

test('빈 결과지만 불완전: 깨짐 없음 줄과 불완전성 배너를 함께 싣고 안전하다고 쓰지 않는다', () => {
  const diff = syntheticDiff({
    findings: [{ code: 'clients-unscanned', severity: 'warning', category: 'incompleteness', scope: 'default' },
      { code: 'calls-unattributed', severity: 'warning', category: 'incompleteness', scope: 'default', counts: { before: 3, after: 2 } }],
    summary: { warnings: 2, incompleteness: 2 },
  });
  const body = renderPrComment({ diff });
  assert.match(body, /> \[!NOTE\]\n> \*\*No broken client call was observed\.\*\* This is an observed difference, not a proof/u);
  assert.match(body, /> \[!WARNING\]\n> \*\*Incomplete analysis/u);
  assert.match(body, /2 incompleteness finding\(s\): `calls-unattributed` ×1, `clients-unscanned` ×1\./u);
  assert.match(body, /\| `calls-unattributed` \| `default` \| — \| before 3, after 2 \| — \|/u);
  assert.doesNotMatch(body, /\bsafe\b(?! )/iu);
  assert.doesNotMatch(body, /no breaking/iu);
  // 배너는 표보다 먼저다.
  assert.ok(body.indexOf('Incomplete analysis') < body.indexOf('#### Incompleteness'));
});

test('모순된 요약 수(증명 > 전체)는 음수 대신 ?로 싣는다', () => {
  const body = renderPrComment({ diff: syntheticDiff({ summary: { brokenCalls: 1, provenBrokenCalls: 99 } }) });
  assert.match(body, /— 99 proven, \? unverified\./u);
});

test('호출 영향을 평가하지 못했으면(not-assessed) 경고로 싣는다', () => {
  const body = renderPrComment({ diff: syntheticDiff({ summary: { callImpact: 'not-assessed' } }) });
  assert.match(body, /\*\*Call impact was not assessed\*\*/u);
  assert.match(body, /No client document reached the changed scopes/u);
});

test('불완전성이 없고 깨짐도 없으면 배너 없이 관찰 차이라는 알림만 싣는다', () => {
  const body = renderPrComment({ diff: syntheticDiff() });
  assert.doesNotMatch(body, /Incomplete analysis/u);
  assert.match(body, /not a proof that no client breaks/u);
  assert.match(body, /Exit code 0 or an empty list is not a completeness claim/u);
});

test('사실 문자열의 Markdown·HTML·멘션·표 구분자·줄바꿈 주입을 막는다', () => {
  const hostile = 'x|y`<img src=x onerror=alert(1)>` @octocat\n## injected [link](https://evil.example)';
  const call = {
    call: { location: { path: `src/${hostile}.kt`, line: 7 }, symbol: { qualifiedName: `Api.${hostile}` }, platform: 'kotlin' },
    before: { status: 'matched', quality: 'exact' }, after: { status: 'missing' }, reasons: [hostile],
  };
  const diff = syntheticDiff({
    findings: [
      { code: 'removed-bound-route', severity: 'error', category: 'impact', scope: hostile, side: 'decl',
        route: { method: 'GET', template: `/a/${hostile}` }, calls: [call] },
      { code: 'client-coverage-gap', severity: 'warning', category: 'incompleteness', scope: 'default', detail: `<script>${hostile}</script>` },
    ],
    summary: { errors: 1, warnings: 1, brokenCalls: 1, provenBrokenCalls: 1, incompleteness: 1, callImpact: 'breaks-found' },
  });
  const trace = { format: 'isthmus-trace', version: 1, chains: [{ selector: { route: { method: 'GET', template: `/a/${hostile}` } },
    handlers: [{ qualifiedName: hostile }], relationUses: [], database: [], routes: [] }], gaps: [], summary: { gaps: 0 } };
  const body = renderPrComment({ diff, trace, meta: { errors: [{ step: 'capture:base', message: hostile }] } });
  const outside = outsideCodeSpans(body);
  assert.doesNotMatch(body, /\n## injected/u, '줄바꿈이 새 블록을 열지 않는다');
  assert.doesNotMatch(outside, /<img|<script|@octocat|\]\(https/u, '코드 스팬 밖에 원문 HTML·멘션·링크가 없다');
  for (const line of body.split('\n').filter((entry) => entry.startsWith('| `error`'))) {
    // 셀 구분자는 헤더와 같은 6개 열(7개의 이스케이프되지 않은 |)이다.
    assert.equal(line.match(/(?<!\\)\|/gu).length, 7, line);
  }
  assert.match(body, /<summary><code>GET \/a\/x&#124;y&#96;&#60;img src=x onerror=alert\(1\)&#62;&#96; &#64;octocat/u);
});

test('inlineCode: backtick 울타리·여백·표 구분자·제어 문자·길이 상한', () => {
  assert.equal(inlineCode('plain'), '`plain`');
  assert.equal(inlineCode('a`b'), '``a`b``');
  assert.equal(inlineCode('`lead'), '`` `lead ``');
  assert.equal(inlineCode('a|b', { inTable: true }), '`a\\|b`');
  assert.equal(inlineCode('a|b'), '`a|b`');
  assert.equal(inlineCode(''), '`(empty)`');
  assert.equal(inlineCode('a\nb\u0007c'), '`a b c`');
  assert.equal([...singleLine('x'.repeat(500))].length, 160);
  assert.equal(singleLine('line\u2028sep'), 'line sep');
  assert.equal(singleLine('a\u202eb\u2066c\u200bd\ufeff'), 'abcd');
});

test('escapeHtml·escapeMarkdownText는 HTML·Markdown·멘션을 무력화한다', () => {
  assert.equal(escapeHtml('<a href="x">\'&'), '&#60;a href=&#34;x&#34;&#62;&#39;&#38;');
  assert.equal(escapeHtml('`@me` https://x [l]'), '&#96;&#64;me&#96; https&#58;//x &#91;l&#93;');
  const escaped = escapeMarkdownText('**b** <i> [l](u) @me https://x');
  assert.doesNotMatch(escaped, /<i>|\*\*b\*\*|@me/u);
  assert.match(escaped, /\\\*\\\*b\\\*\\\*/u);
  assert.match(escaped, /@\u200bme/u);
  assert.match(escaped, /https\\:/u);
});

test('긴 보고서는 GitHub 상한 안으로 줄 단위로 자르고 details를 닫는다', () => {
  const calls = Array.from({ length: 1000 }, (_, index) => ({
    call: { location: { path: `app/src/Very/Long/Path/Segment/${'x'.repeat(60)}/File${index}.kt`, line: index + 1 },
      symbol: { qualifiedName: `Client${index}.call${'y'.repeat(40)}` } },
    before: { status: 'matched' }, after: { status: 'missing' } }));
  const findings = Array.from({ length: 5 }, (_, index) => ({ code: 'removed-bound-route', severity: 'error', category: 'impact',
    scope: 'default', side: 'decl', route: { method: 'GET', template: `/r/${index}` }, calls }));
  const diff = syntheticDiff({ findings: [...findings, { code: 'calls-dynamic', severity: 'warning', category: 'incompleteness',
    scope: 'default', counts: { before: 1, after: 1 } }], summary: { brokenCalls: 5000, provenBrokenCalls: 5000, incompleteness: 1 } });
  const chains = Array.from({ length: 200 }, (_, index) => ({ selector: { route: { method: 'GET', template: `/r/${index}` } },
    handlers: [], relationUses: [], database: [], routes: [{ calls: calls.slice(0, 50) }] }));
  const trace = { format: 'isthmus-trace', version: 1, chains, gaps: [], summary: { gaps: 0 } };
  const body = renderPrComment({ diff, trace }, { maxRows: 1000 });
  assert.ok(body.length <= 65000, `length ${body.length}`);
  assert.match(body, /Comment truncated to fit GitHub's 65536-character limit: \d+ line\(s\) omitted\./u);
  assert.equal((body.match(/<details>/gu) ?? []).length, (body.match(/<\/details>/gu) ?? []).length);
  assert.ok(body.indexOf('Incomplete analysis') < 2000, '배너는 앞에 남는다');
  const small = renderPrComment({ diff, trace }, { maxRows: 1000, maxChars: 2000 });
  assert.ok(small.length <= 2000);
  assert.ok(renderPrComment({ diff }, { maxRows: 3 }).includes('_… 4997 more row(s) omitted; see the JSON artifact._'));
});

test('fitToLimit: 상한 이하면 그대로, 넘치면 열린 details를 닫는다', () => {
  assert.equal(fitToLimit(['a', 'b'], 100), 'a\nb\n');
  const lines = ['head', '<details><summary>s</summary>', ...Array.from({ length: 200 }, () => 'z'.repeat(50))];
  const fitted = fitToLimit(lines, 2000);
  assert.ok(fitted.length <= 2000);
  assert.match(fitted, /<\/details>\n\n> \[!NOTE\]/u);
});

test('trace: 테이블·DB 의존자·클라이언트 코드·gap·잘림·상태를 싣는다', () => {
  const trace = {
    format: 'isthmus-trace', version: 1,
    chains: [{ selector: { route: { method: 'GET', template: '/api/users/{}', scope: 'mobile->api' } },
      handlers: [{ usr: 'ts:users.get' }],
      relationUses: [{ relation: 'users', resolved: { relation: 'main.users', column: 'email' } }, { relation: 'orders' }],
      database: [{ vertex: 'main.users', dependents: [{ usr: 'main.active_users', kind: 'view' }, { usr: 'main.audit' }] }],
      routes: [{ calls: [{ call: { member: 'client', location: { path: 'app/Api.kt', line: 3 }, symbol: { usr: 'kt:Api.get' } },
        affected: [{ usr: 'kt:Repo.load' }], upstreamRoutes: [{ method: 'GET', template: '/bff/users/{}' }] }] }] }],
    gaps: [{ code: 'analysis-missing' }, { code: 'analysis-missing' }, { code: 'stale-analysis' }], summary: { gaps: 3 },
    truncation: { truncated: true, maxChains: 50, maxRows: 20 },
  };
  const body = renderPrComment({ diff: syntheticDiff(), trace, meta: { trace: { status: 'ran', side: 'base', omittedRoutes: 2 } } });
  assert.match(body, /Traced 1 changed route\(s\) against the base capture\./u);
  assert.match(body, /2 changed route\(s\) exceeded the trace selection limit/u);
  assert.match(body, /\*\*Trace has 3 gap\(s\)\*\*.*`analysis-missing` ×2, `stale-analysis` ×1\./u);
  assert.match(body, /<code>GET \/api\/users\/\{\} \(mobile-&#62;api\)<\/code> — 1 handler\(s\), 2 table\/column\(s\), 2 DB dependent\(s\), 1 client call\(s\)/u);
  assert.match(body, /- Tables and columns: `main\.users\.email`, `orders`/u);
  assert.match(body, /- DB dependents: `main\.active_users \(view\)`, `main\.audit`/u);
  assert.match(body, / {2}- `client:app\/Api\.kt:3` `kt:Api\.get` → affects `kt:Repo\.load` → exposed via `GET \/bff\/users\/\{\}`/u);
  assert.match(body, /The trace report was capped \(max chains 50, max rows 20\)/u);
});

test('trace 상태: 건너뜀·비활성·context 없음·실패', () => {
  const diff = syntheticDiff();
  assert.match(renderPrComment({ diff, meta: { trace: { status: 'skipped-no-routes' } } }), /Trace skipped: no route has a non-info finding/u);
  assert.match(renderPrComment({ diff, meta: { trace: { status: 'disabled' } } }), /Trace disabled/u);
  assert.match(renderPrComment({ diff, meta: { trace: { status: 'no-context' } } }), /no trace context was given/u);
  assert.match(renderPrComment({ diff, meta: { trace: { status: 'error', exitCode: 2, message: 'bad context' } } }),
    /\*\*Trace failed\*\* \(exit 2\): `bad context`/u);
});

test('diff가 없으면 오류 블록이나 "결과 모름"을 싣는다(빈 댓글이 깨끗함으로 읽히지 않게)', () => {
  const failed = renderPrComment({ meta: { errors: [{ step: 'capture:base', message: 'Capture step facts failed' }] } });
  assert.match(failed, /\*\*The isthmus run did not finish; the report below is missing or partial\.\*\*/u);
  assert.match(failed, /`capture:base`: `Capture step facts failed`/u);
  assert.match(renderPrComment({}), /No diff report was produced\*\*; the result is unknown, not clean\./u);
});

test('꼬리말은 SHA 모양일 때만 비교 commit을 싣는다', () => {
  const sha = 'a'.repeat(40);
  assert.match(renderPrComment({ diff: syntheticDiff(), meta: { revisions: { base: sha, head: 'b'.repeat(40) } } }),
    /base aaaaaaaaaa → head bbbbbbbbbb/u);
  assert.doesNotMatch(renderPrComment({ diff: syntheticDiff(), meta: { revisions: { base: '<x>', head: sha } } }), /base </u);
});

test('객체가 아닌 목록 원소(손상된 artifact)는 버리고 렌더링한다', () => {
  const diff = { ...syntheticDiff(), findings: [null, 3, 'x', { code: 'calls-dynamic', severity: 'warning', category: 'incompleteness' }] };
  const body = renderPrComment({ diff, trace: { format: 'isthmus-trace', version: 1, chains: [null, 'x'], gaps: [null] } });
  assert.match(body, /`calls-dynamic` ×1/u);
  assert.match(body, /Traced 0 changed route\(s\)/u);
});

test('입력 검증: 모르는 형식·잘못된 상한·키', () => {
  assert.throws(() => renderPrComment({ diff: { format: 'isthmus-diff', version: 1 } }), RenderInputError);
  assert.throws(() => renderPrComment({ diff: { format: 'isthmus-http-diff', version: 1 } }), RenderInputError);
  assert.throws(() => renderPrComment({ diff: syntheticDiff(), trace: { format: 'isthmus-trace', version: 2 } }), RenderInputError);
  assert.throws(() => renderPrComment({}, { maxRows: 0 }), RenderInputError);
  assert.throws(() => renderPrComment({}, { maxChars: GITHUB_COMMENT_LIMIT + 1 }), RenderInputError);
  assert.throws(() => validateCommentKey('bad key -->'), RenderInputError);
  assert.equal(commentMarker('api.v2'), '<!-- isthmus-http-impact:api.v2 -->');
});

test('fail-on 토큰 규칙은 CLI와 같다', () => {
  const error = { code: 'removed-bound-route', severity: 'error', category: 'impact' };
  const warning = { code: 'calls-dynamic', severity: 'warning', category: 'incompleteness' };
  const info = { code: 'route-added', severity: 'info', category: 'surface' };
  assert.deepEqual(parseFailOn(' error, incomplete '), ['error', 'incomplete']);
  assert.deepEqual(parseFailOn('none'), []);
  assert.deepEqual(parseFailOn(undefined), []);
  assert.ok(matchesFailOn(error, ['error']) && !matchesFailOn(warning, ['error']));
  assert.ok(matchesFailOn(error, ['warning']) && matchesFailOn(warning, ['warning']) && !matchesFailOn(info, ['warning']));
  assert.ok(matchesFailOn(warning, ['incomplete']) && matchesFailOn(info, ['route-added']));
  const policy = renderPrComment({ diff: syntheticDiff({ findings: [warning] }), meta: { failOn: 'incomplete', diff: { exitCode: 0 } } });
  assert.match(policy, /\*\*fail-on\*\* `incomplete`: passed — 1 matching finding\(s\)\./u);
});

test('CLI: 성공 0, 입력 오류 2, 사용 오류 64', () => {
  const directory = mkdtempSync(join(tmpdir(), 'isthmus-render-'));
  try {
    const diffPath = join(directory, 'diff.json');
    writeFileSync(diffPath, JSON.stringify(syntheticDiff()));
    const ok = runChild(process.execPath, [renderer, '--diff', diffPath, '--max-rows', '5', '--key', 'k']);
    assert.equal(ok.status, 0, ok.stderr);
    assert.ok(ok.stdout.startsWith('<!-- isthmus-http-impact:k -->'));
    writeFileSync(join(directory, 'bad.json'), '{');
    assert.equal(runChild(process.execPath, [renderer, '--diff', join(directory, 'bad.json')]).status, 2);
    assert.equal(runChild(process.execPath, [renderer, '--diff', join(directory, 'missing.json')]).status, 2);
    assert.equal(runChild(process.execPath, [renderer, '--unknown', 'x']).status, 64);
    assert.equal(runChild(process.execPath, [renderer, '--max-rows', 'many']).status, 64);
    assert.deepEqual(parseRenderArguments(['--max-chars', '3000']), { maxChars: 3000 });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
