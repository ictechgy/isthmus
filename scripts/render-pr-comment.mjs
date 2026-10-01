#!/usr/bin/env node
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * `isthmus diff --http`·`isthmus trace` JSON을 PR 댓글용 Markdown으로 바꾸는 렌더러다.
 *
 * 제품(`isthmus`)은 JSON만 읽고 쓴다(AGENTS.md). Markdown은 교환 형식이 아니라 표현이므로 CLI 하위 명령이 아니라
 * capture-trace와 같은 배포 스크립트로 둔다. 입력은 다음 셋이다.
 * - `isthmus-http-diff` v1 보고서(필수)
 * - `isthmus-trace` v1 보고서(선택 — 바뀐 route의 핸들러·테이블·DB 의존자·클라이언트 코드)
 * - CI 메타(`isthmus-ci-meta` v1, 선택 — 종료 코드·fail-on·trace 상태). GitHub Action 오케스트레이터가 쓴다.
 *
 * 세 입력 모두 신뢰하지 않는다. PR 코드가 생산자로 돌았으므로 사실 문자열(경로·심볼·템플릿·detail)은 공격자가 고를 수
 * 있다. 그래서 모든 외부 문자열을 코드 스팬(표 안이면 `|` 이스케이프)이나 HTML 이스케이프로만 싣고, 숫자는 안전한
 * 정수만 쓴다. 출력은 같은 입력이면 바이트 단위로 같다(시각·환경을 읽지 않는다).
 *
 * 사용: `node scripts/render-pr-comment.mjs --diff diff.json [--trace trace.json] [--meta meta.json]
 *        [--max-rows <1..1000>] [--max-chars <2000..65536>] [--key <comment-key>]`
 */

/** GitHub 이슈·PR 댓글 본문 상한(문자)이다. 렌더러 기본 상한은 여유를 둔 값이다. */
export const GITHUB_COMMENT_LIMIT = 65536;
/** 기본 문자 상한이다. GitHub는 문자 수로 세고 JS length(UTF-16 단위)는 그 이상이므로 length로 자르면 안전하다. */
export const DEFAULT_MAX_CHARS = 65000;
/** 표마다 싣는 기본 행 수다. */
export const DEFAULT_MAX_ROWS = 20;
/** 외부 문자열 하나에 싣는 최대 길이다. 긴 경로·심볼이 표를 깨지 않게 자른다. */
const MAX_VALUE_LENGTH = 160;
/** 입력 파일 하나의 최대 바이트다(isthmus 입력 상한과 같은 크기). */
const MAX_INPUT_BYTES = 64 * 1024 * 1024;
/** 스티키 댓글을 찾는 표식의 접두사다. 게시기는 이 표식으로 시작하는 봇 댓글만 고친다. */
export const COMMENT_MARKER_PREFIX = '<!-- isthmus-http-impact:';
/** 심각도 표시 순서다. */
const SEVERITY_RANK = { error: 0, warning: 1, info: 2 };
/** 호출 깨짐을 싣는 impact finding 코드다. */
const BROKEN_CODES = new Set([
  'removed-bound-route', 'removed-bound-route-unverified', 'changed-bound-route', 'changed-bound-route-unverified',
]);

/** 렌더러 입력 형식 오류다. 입력 원문은 싣지 않는다. */
export class RenderInputError extends Error {
  /** 원인 문구를 보존한다. */
  constructor(message) {
    super(message);
    this.name = 'RenderInputError';
  }
}

// ── 이스케이프 ────────────────────────────────────────────────────────────────

/**
 * 외부 문자열을 한 줄 표시용으로 정리한다. 제어 문자·줄바꿈은 공백으로, 긴 값은 말줄임으로 자른다.
 * 줄바꿈이 남으면 표 행이 끊기고 새 Markdown 블록이 시작되므로(주입 경로) 반드시 먼저 거친다.
 * 양방향 재배치(bidi)·폭 없는 문자는 지운다 — 코드 스팬 안에서도 보이지 않게 주변 글을 뒤집어 보이게 할 수 있다.
 */
export function singleLine(value, maxLength = MAX_VALUE_LENGTH) {
  const text = String(value).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/gu, ' ')
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/gu, '');
  const points = [...text];
  return points.length <= maxLength ? text : `${points.slice(0, maxLength - 1).join('')}…`;
}

/**
 * 외부 문자열을 Markdown 코드 스팬으로 감싼다. 코드 스팬 안은 강조·링크·HTML·멘션·자동 링크가 해석되지 않는다.
 * 값에 든 가장 긴 backtick 연속보다 긴 울타리를 쓰고, 값이 backtick이나 공백으로 시작·끝나면 공백으로 감싼다
 * (CommonMark 코드 스팬 규칙). `inTable`이면 GFM 표 셀 구분자 `|`를 `\|`로 바꾼다 — 표 파싱은 코드 스팬보다 먼저라
 * 이스케이프하지 않으면 셀이 갈라진다.
 */
export function inlineCode(value, { inTable = false } = {}) {
  let text = singleLine(value);
  if (text.length === 0) return '`(empty)`';
  if (inTable) text = text.replace(/\|/gu, '\\|');
  const longestRun = Math.max(0, ...(text.match(/`+/gu) ?? []).map((run) => run.length));
  const fence = '`'.repeat(longestRun + 1);
  const pad = /^[` ]|[` ]$/u.test(text) ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}

/**
 * HTML 요소 안(예: `<summary><code>`)에 싣는 외부 문자열을 이스케이프한다. HTML 특수 문자에 더해 Markdown·멘션·
 * 자동 링크에 쓰이는 구두점(`` ` `` `@` `:` `[` `]` `|` `*` `_` `~` `\`)도 숫자 엔티티로 바꾼다 — HTML 블록 안은
 * Markdown으로 해석되지 않지만, 렌더러 차이에 기대지 않기 위해서다.
 */
export function escapeHtml(value) {
  return singleLine(value).replace(/[&<>"'`@:[\]|*_~\\]/gu, (character) => `&#${character.codePointAt(0)};`);
}

/**
 * 외부 문자열을 일반 Markdown 텍스트로 이스케이프한다. 코드 스팬을 쓸 수 없는 곳의 대비책이다:
 * HTML 특수 문자는 엔티티로, Markdown 구두점은 백슬래시로, `@`는 폭 없는 공백을 끼워 멘션을 막는다.
 */
export function escapeMarkdownText(value) {
  return singleLine(value)
    .replace(/[&<>]/gu, (character) => `&#${character.codePointAt(0)};`)
    .replace(/[\\`*_{}[\]()#+\-.!|~:]/gu, (character) => `\\${character}`)
    .replace(/@/gu, '@\u200b');
}

/** 안전한 음이 아닌 정수면 그 값, 아니면 `?`다(외부 JSON 숫자를 그대로 싣지 않는다). */
function count(value) {
  return Number.isSafeInteger(value) && value >= 0 ? String(value) : '?';
}

/** 값이 안전한 음이 아닌 정수인지다. */
function isCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

/** JSON 객체(배열 아님)인지다. */
function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 배열이면 그대로, 아니면 빈 배열이다(외부 JSON의 모양을 가정하지 않는다). */
function list(value) {
  return Array.isArray(value) ? value : [];
}

/** 문자열이면 그대로, 아니면 undefined다. */
function text(value) {
  return typeof value === 'string' ? value : undefined;
}

// ── 공용 표현 ──────────────────────────────────────────────────────────────────

/** route 키 `{method, template}`를 `METHOD /template` 코드 스팬으로 쓴다. */
function routeLabel(route, inTable) {
  if (!isObject(route)) return '`?`';
  return inlineCode(`${text(route.method) ?? '?'} ${text(route.template) ?? '?'}`, { inTable });
}

/** 끝점 위치를 `[member:]path:line`으로 쓴다(경로는 생산자가 준 project 상대 경로). */
function locationText(endpoint, member) {
  const location = isObject(endpoint?.location) ? endpoint.location : undefined;
  const path = text(location?.path);
  if (path === undefined) return undefined;
  const line = isCount(location.line) ? `:${location.line}` : '';
  return `${member === undefined ? '' : `${member}:`}${path}${line}`;
}

/** 끝점 심볼 이름(qualifiedName, 없으면 usr)이다. */
function symbolText(endpoint) {
  const symbol = isObject(endpoint?.symbol) ? endpoint.symbol : undefined;
  return text(symbol?.qualifiedName) ?? text(symbol?.usr);
}

/** 끝점을 위치와 심볼 코드 스팬으로 쓴다. 표 셀이면 `inTable`로 `|`를 이스케이프한다. */
function endpointCell(endpoint, member, inTable = true) {
  const parts = [locationText(endpoint, member), symbolText(endpoint)].filter((part) => part !== undefined);
  return parts.length === 0 ? '(no location)' : parts.map((part) => inlineCode(part, { inTable })).join(' ');
}

/** 행 목록을 상한까지 자르고 넘친 수를 알린다. */
function capRows(rows, maxRows) {
  if (rows.length <= maxRows) return { shown: rows, note: [] };
  return { shown: rows.slice(0, maxRows), note: [`_… ${rows.length - maxRows} more row(s) omitted; see the JSON artifact._`] };
}

/** GFM 표를 만든다. 셀은 이미 이스케이프된 값이어야 한다. */
function table(header, rows, maxRows) {
  const { shown, note } = capRows(rows, maxRows);
  return [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...shown.map((row) => `| ${row.join(' | ')} |`),
    ...(note.length === 0 ? [] : ['', ...note]),
  ];
}

/** 심각도 순(error, warning, info)으로 안정 정렬한다. diff의 원래 순서를 같은 심각도 안에서 지킨다. */
function bySeverity(findings) {
  const rank = (finding) => SEVERITY_RANK[finding.severity] ?? 3;
  return findings.map((finding, index) => ({ finding, index }))
    .sort((left, right) => rank(left.finding) - rank(right.finding) || left.index - right.index)
    .map(({ finding }) => finding);
}

// ── 입력 검증 ──────────────────────────────────────────────────────────────────

/** diff 보고서의 형식·버전을 확인한다. 모르는 형식을 추측해 그리지 않는다. */
export function validateDiff(diff) {
  if (!isObject(diff) || diff.format !== 'isthmus-http-diff' || diff.version !== 1) {
    throw new RenderInputError('The diff input is not an isthmus-http-diff version 1 report; pass the stdout of '
      + '`isthmus diff --http`.');
  }
  if (!Array.isArray(diff.findings) || !isObject(diff.summary)) {
    throw new RenderInputError('The diff report has no findings list or summary; regenerate it with isthmus diff --http.');
  }
}

/** trace 보고서의 형식·버전을 확인한다. */
export function validateTrace(trace) {
  if (!isObject(trace) || trace.format !== 'isthmus-trace' || trace.version !== 1 || !Array.isArray(trace.chains)) {
    throw new RenderInputError('The trace input is not an isthmus-trace version 1 report; pass the stdout of `isthmus trace`.');
  }
}

/** 댓글 키(여러 Action 인스턴스를 한 PR에서 구분)를 검증한다. */
export function validateCommentKey(key) {
  if (typeof key !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/u.test(key)) {
    throw new RenderInputError('The comment key must be 1 to 64 letters, digits, dots, underscores or hyphens.');
  }
  return key;
}

// ── 섹션 ───────────────────────────────────────────────────────────────────────

/** scope(workspace link 이름) → client member 이름 표다. workspace 호출 위치 앞에 member를 붙이는 데 쓴다. */
function linkClients(diff) {
  const clients = new Map();
  for (const link of list(diff.workspace?.links)) {
    if (typeof link?.name === 'string' && typeof link.client === 'string') clients.set(link.name, link.client);
  }
  return clients;
}

/** fail-on 토큰이 finding 하나에 걸리는지다(`isthmus diff --http --fail-on`과 같은 규칙). */
export function matchesFailOn(finding, tokens) {
  return tokens.some((token) => token === finding.code
    || (token === 'error' && finding.severity === 'error')
    || (token === 'warning' && (finding.severity === 'warning' || finding.severity === 'error'))
    || (token === 'incomplete' && finding.category === 'incompleteness'));
}

/** 쉼표 목록 fail-on을 토큰 배열로 나눈다. 빈 값·`none`은 정책 없음이다. */
export function parseFailOn(value) {
  if (typeof value !== 'string') return [];
  const trimmed = value.trim();
  if (trimmed === '' || trimmed === 'none') return [];
  return trimmed.split(',').map((token) => token.trim()).filter((token) => token.length > 0);
}

/** 제목 줄과 결과 한 줄이다. 깨짐이 없어도 "안전"이라고 쓰지 않는다. */
function headline(diff) {
  const { summary } = diff;
  const broken = summary.brokenCalls;
  const proven = summary.provenBrokenCalls;
  if (isCount(broken) && broken > 0) {
    // 입력(artifact)이 모순이면(증명된 수 > 전체) 음수를 쓰지 않고 모름으로 둔다.
    const unverified = isCount(proven) && proven <= broken ? broken - proven : undefined;
    return ['> [!CAUTION]', `> **${count(broken)} client call(s) stop binding at head** — ${count(proven)} proven, `
      + `${unverified === undefined ? '?' : unverified} unverified.`];
  }
  if (summary.callImpact === 'not-assessed') {
    return ['> [!WARNING]', '> **Call impact was not assessed** — no client documents were available to evaluate.'];
  }
  return ['> [!NOTE]', '> **No broken client call was observed.** This is an observed difference, not a proof that '
    + 'no client breaks.'];
}

/** incompleteness finding 코드별 수를 센다. */
function incompletenessCounts(findings) {
  const counts = new Map();
  for (const finding of findings) {
    if (finding.category !== 'incompleteness') continue;
    const code = text(finding.code) ?? '?';
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return [...counts].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
}

/**
 * 불완전성 배너다. incompleteness finding이 있거나 호출 영향을 평가하지 못했으면 반드시 싣는다.
 * 빈 결과가 "깨지는 클라이언트 없음"으로 읽히지 않게 하는 것이 이 렌더러의 핵심 불변 조건이다.
 */
function incompletenessBanner(diff) {
  const counts = incompletenessCounts(diff.findings);
  const notAssessed = diff.summary.callImpact === 'not-assessed';
  if (counts.length === 0 && !notAssessed) return [];
  const total = counts.reduce((sum, [, value]) => sum + value, 0);
  const breakdown = counts.map(([code, value]) => `${inlineCode(code)} ×${value}`).join(', ');
  return ['', '> [!WARNING]', '> **Incomplete analysis — an empty or short list below is not evidence that no client breaks.**',
    ...(total > 0 ? [`> ${total} incompleteness finding(s): ${breakdown}.`] : []),
    ...(notAssessed ? ['> No client document reached the changed scopes, so calls were not evaluated.'] : []),
    '> Calls that isthmus could not attribute, scan or evaluate are counted here, not listed as broken.'];
}

/** 범위 알림이다. field·query·header 호환성은 판정하지 않는다는 것을 항상 밝힌다. */
function scopeNote() {
  return ['', '<sub>Route-level comparison only: request/response fields, query parameters and headers are not assessed. '
    + 'Exit code 0 or an empty list is not a completeness claim.</sub>'];
}

/** fail-on 정책 결과 한 줄이다. 판정은 CLI 종료 코드(meta)가 정본이고, 렌더러는 걸린 finding 수만 센다. */
function policyLine(diff, meta) {
  const tokens = parseFailOn(meta?.failOn);
  if (tokens.length === 0) return ['', '**fail-on:** not set (report only).'];
  const matched = diff.findings.filter((finding) => matchesFailOn(finding, tokens)).length;
  const exitCode = meta?.diff?.exitCode;
  const verdict = exitCode === 1 ? '**failed**' : exitCode === 0 ? 'passed' : 'not evaluated';
  return ['', `**fail-on** ${inlineCode(tokens.join(','))}: ${verdict} — ${matched} matching finding(s).`];
}

/** 심각도·표면·호출 요약 표다. */
function summaryTable(diff) {
  const { summary } = diff;
  return ['', '| Findings | error | warning | info | Routes +/−/~ | Broken calls (proven) | Rebound calls |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    `| ${count(summary.findings)} | ${count(summary.errors)} | ${count(summary.warnings)} | ${count(summary.info)} | `
    + `${count(summary.routesAdded)} / ${count(summary.routesRemoved)} / ${count(summary.routesChanged)} | `
    + `${count(summary.brokenCalls)} (${count(summary.provenBrokenCalls)}) | ${count(summary.reboundCalls)} |`];
}

/** 호출의 head 상태 셀이다. 다른 route에 다시 결합했으면 그 route를 붙인다. */
function afterCell(call) {
  const status = text(call?.after?.status) ?? '?';
  const routes = list(call?.after?.routes).slice(0, 3).map((route) => routeLabel(route, true));
  return [inlineCode(status, { inTable: true }), ...routes].join(' ');
}

/** 깨짐 호출 표의 행들이다. finding 하나에 호출 여러 개면 호출마다 행이다. */
function brokenCallRows(diff) {
  const clients = linkClients(diff);
  const findings = bySeverity(diff.findings.filter((finding) => BROKEN_CODES.has(finding.code)));
  return findings.flatMap((finding) => list(finding.calls).map((call) => [
    inlineCode(finding.severity ?? '?', { inTable: true }),
    inlineCode(finding.code, { inTable: true }),
    `${routeLabel(finding.route, true)} ${inlineCode(`${finding.scope ?? '?'} · ${finding.side ?? '?'}`, { inTable: true })}`,
    endpointCell(call?.call, clients.get(finding.scope)),
    afterCell(call),
    list(call?.reasons).map((reason) => inlineCode(reason, { inTable: true })).join(' ') || '—',
  ]));
}

/** 깨짐 호출 섹션이다. */
function brokenCallsSection(diff, maxRows) {
  const rows = brokenCallRows(diff);
  if (rows.length === 0) return [];
  return ['', `#### Client calls that stop binding (${rows.length})`, '',
    ...table(['Severity', 'Finding', 'Route (scope · side)', 'Client call (file:line, symbol)', 'Head result',
      'Unproven premises'], rows, maxRows)];
}

/** 다른 route에 다시 결합한 호출 섹션이다(다른 핸들러가 받는다). */
function reboundSection(diff, maxRows) {
  const clients = linkClients(diff);
  const rows = diff.findings.filter((finding) => finding.code === 'rebound-route-calls')
    .flatMap((finding) => list(finding.calls).map((call) => [
      routeLabel(finding.route, true), endpointCell(call?.call, clients.get(finding.scope)), afterCell(call)]));
  if (rows.length === 0) return [];
  return ['', `#### Calls now served by a different route (${rows.length})`, '',
    ...table(['Base route', 'Client call', 'Head route'], rows, maxRows)];
}

/** incompleteness finding 한 행이다. */
function incompletenessRow(finding) {
  const counts = isObject(finding.counts)
    ? ['before', 'after'].filter((key) => key in finding.counts).map((key) => `${key} ${count(finding.counts[key])}`).join(', ')
    : '';
  return [
    inlineCode(finding.code, { inTable: true }),
    finding.scope === undefined ? '—' : inlineCode(finding.scope, { inTable: true }),
    finding.snapshot === undefined ? '—' : inlineCode(finding.snapshot, { inTable: true }),
    counts || '—',
    finding.detail === undefined ? '—' : inlineCode(finding.detail, { inTable: true }),
  ];
}

/** incompleteness 섹션이다. */
function incompletenessSection(diff, maxRows) {
  const rows = diff.findings.filter((finding) => finding.category === 'incompleteness').map(incompletenessRow);
  if (rows.length === 0) return [];
  return ['', `#### Incompleteness (${rows.length})`, '',
    ...table(['Finding', 'Scope', 'Snapshot', 'Counts', 'Detail'], rows, maxRows)];
}

/** 표면 변화의 속성 값 목록(before → after)이다. */
function changeCell(finding) {
  if (!isObject(finding.change)) return '—';
  const values = (key) => list(finding.change[key]).slice(0, 5).map((value) => String(value)).join(', ') || '∅';
  return inlineCode(`${values('before')} → ${values('after')}`, { inTable: true });
}

/** 표면 finding의 선언 위치(head 우선, 없으면 base)다. */
function declarationCell(finding) {
  const endpoint = list(finding.evidence?.after)[0] ?? list(finding.evidence?.before)[0];
  return endpoint === undefined ? '—' : endpointCell(endpoint);
}

/** 표면 변화 섹션이다. info(`route-added`)는 개수만 싣는다. */
function surfaceSection(diff, maxRows) {
  const surface = diff.findings.filter((finding) => finding.category === 'surface');
  const notable = bySeverity(surface.filter((finding) => finding.severity !== 'info'));
  const added = surface.length - notable.length;
  if (surface.length === 0) return [];
  const rows = notable.map((finding) => [
    inlineCode(finding.severity ?? '?', { inTable: true }), inlineCode(finding.code, { inTable: true }),
    `${routeLabel(finding.route, true)} ${inlineCode(finding.scope ?? '?', { inTable: true })}`,
    changeCell(finding), declarationCell(finding)]);
  return ['', `#### Route surface changes (${notable.length})`,
    ...(rows.length === 0 ? [] : ['', ...table(['Severity', 'Finding', 'Route (scope)', 'Change', 'Declaration'], rows, maxRows)]),
    ...(added > 0 ? ['', `_${added} informational finding(s) (for example \`route-added\`) are in the JSON artifact._`] : [])];
}

/** diff 조인 한계 수다(두 시점). */
function limitationsLine(diff) {
  const before = list(diff.limitations?.before).length;
  const after = list(diff.limitations?.after).length;
  if (before + after === 0) return [];
  return ['', `_Join limitations reported by the producers: base ${before}, head ${after} (see the JSON artifact)._`];
}

// ── trace ─────────────────────────────────────────────────────────────────────

/** trace chain의 테이블·컬럼 목록(해석된 relation[.column], 중복 제거, 정렬)이다. */
function chainTables(chain) {
  const names = new Set();
  for (const use of list(chain.relationUses)) {
    const relation = text(use?.resolved?.relation) ?? text(use?.relation);
    if (relation === undefined) continue;
    const column = text(use?.resolved?.column) ?? text(use?.column);
    names.add(column === undefined ? relation : `${relation}.${column}`);
  }
  return [...names].sort();
}

/** trace chain의 DB 의존자 목록(`usr (kind)`, 중복 제거, 정렬)이다. */
function chainDependents(chain) {
  const names = new Set();
  for (const vertex of list(chain.database)) {
    for (const dependent of list(vertex?.dependents)) {
      const usr = text(dependent?.usr);
      if (usr !== undefined) names.add(text(dependent.kind) === undefined ? usr : `${usr} (${dependent.kind})`);
    }
  }
  return [...names].sort();
}

/** trace chain의 핸들러 이름 목록이다. */
function chainHandlers(chain) {
  return list(chain.handlers).map((handler) => text(handler?.qualifiedName) ?? text(handler?.usr)).filter(Boolean);
}

/** trace chain route의 클라이언트 호출 hop 목록이다. */
function chainCalls(chain) {
  return list(chain.routes).flatMap((route) => list(route?.calls).map((call) => ({ call, member: text(call?.call?.member) })));
}

/** 클라이언트 호출 hop 한 줄이다: 호출 위치, 그 호출에서 역방향으로 닿은 클라이언트 심볼, upstream route. */
function callHopLine(hop) {
  const location = endpointCell(hop.call?.call, hop.member, false);
  const affected = list(hop.call?.affected).map((entry) => text(entry?.qualifiedName) ?? text(entry?.usr)).filter(Boolean);
  const upstream = list(hop.call?.upstreamRoutes).map((route) => routeLabel(route, false));
  return `  - ${location}${affected.length === 0 ? '' : ` → affects ${codeList(affected, 8)}`}`
    + `${upstream.length === 0 ? '' : ` → exposed via ${upstream.slice(0, 5).join(', ')}`}`;
}

/** 문자열 목록을 코드 스팬 목록으로 쓰고 상한을 넘으면 나머지 수를 붙인다. */
function codeList(values, limit) {
  const shown = values.slice(0, limit).map((value) => inlineCode(value));
  return `${shown.join(', ')}${values.length > limit ? ` (+${values.length - limit} more)` : ''}`;
}

/** chain 선택자(route)의 표시 이름이다. */
function selectorLabel(chain) {
  if (typeof chain?.selector?.file === 'string') {
    return `File: ${chain.selector.file}${text(chain.selector.member) === undefined ? '' : ` (${chain.selector.member})`}`;
  }
  const route = chain?.selector?.route;
  const scope = text(route?.scope);
  return `${text(route?.method) ?? '?'} ${text(route?.template) ?? '?'}${scope === undefined ? '' : ` (${scope})`}`;
}

/** trace chain 하나를 접을 수 있는 블록으로 쓴다. `<summary>`는 HTML이라 HTML 이스케이프한다. */
function chainBlock(chain, maxRows) {
  const tables = chainTables(chain);
  const dependents = chainDependents(chain);
  const handlers = chainHandlers(chain);
  const calls = chainCalls(chain);
  const entries = list(chain.entryPoints).filter(isObject).map((entry) => {
    const name = text(entry.qualifiedName) ?? text(entry.usr) ?? '?';
    const kinds = list(entry.entries).filter((kind) => typeof kind === 'string').join(',');
    const path = text(entry.location?.path);
    return `${name} [${kinds}]${path === undefined ? '' : ` (${path})`}`;
  });
  const summary = `<code>${escapeHtml(selectorLabel(chain))}</code> — ${handlers.length} handler(s), ${tables.length} `
    + `table/column(s), ${dependents.length} DB dependent(s), ${calls.length} client call(s)`
    + (entries.length === 0 ? '' : `, ${entries.length} entry point(s)`);
  const { shown, note } = capRows(calls, maxRows);
  return ['', `<details><summary>${summary}</summary>`, '',
    `- Handlers: ${handlers.length === 0 ? '—' : codeList(handlers, maxRows)}`,
    ...(entries.length === 0 ? [] : [`- Entry points: ${codeList(entries, maxRows)}`]),
    `- Tables and columns: ${tables.length === 0 ? '—' : codeList(tables, maxRows)}`,
    `- DB dependents: ${dependents.length === 0 ? '—' : codeList(dependents, maxRows)}`,
    `- Client calls and affected client code:${calls.length === 0 ? ' —' : ''}`,
    ...shown.map(callHopLine), ...note.map((line) => `  - ${line}`), '', '</details>'];
}

/** trace gap 코드별 수 한 줄이다. trace는 항상 `complete: false`다. */
function traceGapLine(trace) {
  const counts = new Map();
  for (const gap of list(trace.gaps)) counts.set(text(gap?.code) ?? '?', (counts.get(text(gap?.code) ?? '?') ?? 0) + 1);
  const total = isCount(trace.summary?.gaps) ? trace.summary.gaps : list(trace.gaps).length;
  if (total === 0) return ['', '_Trace is never complete (`complete: false`); no gap was reported for these routes._'];
  const breakdown = [...counts].sort(([left], [right]) => (left < right ? -1 : 1))
    .map(([code, value]) => `${inlineCode(code)} ×${value}`).join(', ');
  return ['', `> [!WARNING]`, `> **Trace has ${total} gap(s)** — hops it could not follow; missing tables or client code `
    + `below may be hidden by these: ${breakdown}.`];
}

/** trace 출력 상한(`--max-chains`·`--max-rows`)으로 잘린 목록이 있으면 알린다. */
function traceTruncationLine(trace) {
  if (trace.truncation?.truncated !== true) return [];
  return ['', `_The trace report was capped (max chains ${count(trace.truncation.maxChains)}, max rows `
    + `${count(trace.truncation.maxRows)}); lists above can be shorter than the impact._`];
}

/** trace 상태(meta)를 사람이 읽는 한 줄로 바꾼다. */
function traceStatusLine(meta) {
  const trace = meta?.trace;
  if (!isObject(trace)) return [];
  if (trace.status === 'skipped-no-routes') return ['', '_Trace skipped: no route has a non-info finding._'];
  if (trace.status === 'disabled') return ['', '_Trace disabled (`trace: false`)._'];
  if (trace.status === 'no-context') return ['', '_Trace skipped: no trace context was given._'];
  if (trace.status === 'error') {
    return ['', '> [!WARNING]', `> **Trace failed** (exit ${count(trace.exitCode)}): ${inlineCode(trace.message ?? 'unknown error')}`];
  }
  return [];
}

/** trace 섹션이다. */
function traceSection(trace, meta, maxRows) {
  const status = traceStatusLine(meta);
  if (trace === undefined) return status.length === 0 ? [] : ['', '#### Affected server code, data and clients (trace)', ...status];
  const side = text(meta?.trace?.side);
  const omitted = isCount(meta?.trace?.omittedRoutes) && meta.trace.omittedRoutes > 0
    ? [`_${meta.trace.omittedRoutes} changed route(s) exceeded the trace selection limit and were not traced._`] : [];
  return ['', '#### Affected server code, data and clients (trace)', '',
    `Traced ${list(trace.chains).length} ${meta?.trace?.mode === 'files' || list(trace.chains).some((chain) => typeof chain?.selector?.file === 'string')
      ? 'file selection(s)' : 'changed route(s)'}${side === undefined ? '' : ` against the ${side === 'head' ? 'head' : 'base'} capture`}.`,
    ...omitted.flatMap((line) => ['', line]),
    ...traceGapLine(trace), ...list(trace.chains).flatMap((chain) => chainBlock(chain, maxRows)), ...traceTruncationLine(trace)];
}

// ── 오류·머리말·꼬리말 ─────────────────────────────────────────────────────────

/** 실행 오류(meta.errors) 블록이다. 오류가 있으면 결과보다 먼저 싣는다. */
function errorBlock(meta) {
  const errors = list(meta?.errors).filter((error) => isObject(error));
  if (errors.length === 0) return [];
  return ['', '> [!CAUTION]', '> **The isthmus run did not finish; the report below is missing or partial.**',
    ...errors.slice(0, 10).map((error) => `> - ${inlineCode(error.step ?? 'step')}: ${inlineCode(error.message ?? 'unknown error')}`)];
}

/** 비교한 두 commit(짧은 SHA)이다. SHA 모양이 아니면 싣지 않는다. */
function revisionText(meta) {
  const short = (value) => (typeof value === 'string' && /^[0-9a-f]{40,64}$/u.test(value) ? value.slice(0, 10) : undefined);
  const base = short(meta?.revisions?.base);
  const head = short(meta?.revisions?.head);
  return base === undefined || head === undefined ? undefined : `base ${base} → head ${head}`;
}

/** 꼬리말이다: isthmus 버전·모드·비교한 commit·형식. */
function footer(diff, trace, meta) {
  const version = text(meta?.isthmusVersion);
  const parts = [version === undefined ? 'isthmus' : `isthmus ${escapeMarkdownText(version)}`, revisionText(meta),
    diff === undefined ? undefined : `${escapeMarkdownText(diff.mode ?? '?')} mode`,
    'isthmus-http-diff v1', trace === undefined ? undefined : 'isthmus-trace v1'].filter(Boolean);
  return ['', `<sub>${parts.join(' · ')} · full JSON in the workflow artifact.</sub>`];
}

/** 댓글 첫 줄 표식이다. 게시기는 이 줄로 시작하는 댓글만 스티키 댓글로 본다. */
export function commentMarker(key = 'default') {
  return `${COMMENT_MARKER_PREFIX}${validateCommentKey(key)} -->`;
}

// ── 크기 상한 ──────────────────────────────────────────────────────────────────

/**
 * 줄 목록을 문자 상한에 맞춘다. 앞에서부터 줄 단위로 싣고(배너·요약이 앞에 있어 항상 남는다), 넘치면 열린
 * `<details>`를 닫고 잘랐다는 알림을 붙인다. 줄 중간을 자르지 않으므로 코드 스팬·HTML 엔티티가 깨지지 않는다.
 */
export function fitToLimit(lines, maxChars) {
  const whole = `${lines.join('\n')}\n`;
  if (whole.length <= maxChars) return whole;
  const note = (omitted) => ['', `> [!NOTE]`, `> Comment truncated to fit GitHub's ${GITHUB_COMMENT_LIMIT}-character limit: `
    + `${omitted} line(s) omitted. The full report is in the job summary and the JSON artifact.`];
  const kept = [];
  let length = 0;
  let open = 0;
  for (const line of lines) {
    const opens = (line.match(/<details>/gu) ?? []).length - (line.match(/<\/details>/gu) ?? []).length;
    const reserve = (open + Math.max(0, opens)) * '</details>\n'.length + note(lines.length).join('\n').length + 2;
    if (length + line.length + 1 + reserve > maxChars) break;
    kept.push(line);
    length += line.length + 1;
    open += opens;
  }
  const closing = Array.from({ length: open }, () => '</details>');
  return `${[...kept, ...closing, ...note(lines.length - kept.length)].join('\n')}\n`;
}

// ── 진입점 ─────────────────────────────────────────────────────────────────────

/**
 * diff·trace·meta를 Markdown 댓글 본문으로 바꾼다.
 *
 * - `diff`가 없으면(실행 오류) 오류 블록만 싣는다 — 빈 댓글이 "문제 없음"으로 읽히지 않게 한다.
 * - `maxRows`는 표·목록마다 싣는 행 수, `maxChars`는 전체 문자 상한(GitHub 65,536 이하)이다.
 * - 반환값은 첫 줄이 스티키 표식인 문자열이다.
 */
export function renderPrComment({ diff, trace, meta } = {}, { maxRows = DEFAULT_MAX_ROWS, maxChars = DEFAULT_MAX_CHARS, key = 'default' } = {}) {
  if (!Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > 1000) throw new RenderInputError('maxRows must be 1 to 1000.');
  if (!Number.isSafeInteger(maxChars) || maxChars < 2000 || maxChars > GITHUB_COMMENT_LIMIT) {
    throw new RenderInputError(`maxChars must be 2000 to ${GITHUB_COMMENT_LIMIT}.`);
  }
  if (diff !== undefined) validateDiff(diff);
  if (trace !== undefined) validateTrace(trace);
  // 목록 원소가 객체가 아니면(손상·조작된 artifact) 버린다 — 아래 섹션은 원소를 객체로 읽는다.
  if (diff !== undefined) diff = { ...diff, findings: diff.findings.filter(isObject) };
  if (trace !== undefined) trace = { ...trace, chains: trace.chains.filter(isObject) };
  const lines = [commentMarker(key), '### isthmus · HTTP route impact', ...errorBlock(meta)];
  if (diff !== undefined) {
    lines.push('', ...headline(diff), ...incompletenessBanner(diff), ...policyLine(diff, meta), ...summaryTable(diff),
      ...brokenCallsSection(diff, maxRows), ...incompletenessSection(diff, maxRows), ...reboundSection(diff, maxRows),
      ...surfaceSection(diff, maxRows), ...limitationsLine(diff), ...traceSection(trace, meta, maxRows), ...scopeNote());
  } else if (list(meta?.errors).length === 0) {
    lines.push('', '> [!CAUTION]', '> **No diff report was produced**; the result is unknown, not clean.');
  }
  lines.push(...footer(diff, trace, meta));
  return fitToLimit(lines, maxChars);
}

/** JSON 파일을 크기 상한 안에서 읽는다. 없는 선택 입력은 undefined다. */
export function readJsonFile(path, label) {
  let size;
  try { size = statSync(path).size; } catch { throw new RenderInputError(`Cannot read the ${label} input; check the path.`); }
  if (size > MAX_INPUT_BYTES) throw new RenderInputError(`The ${label} input exceeds ${MAX_INPUT_BYTES} bytes.`);
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch { throw new RenderInputError(`The ${label} input is not valid JSON; regenerate it.`); }
}

/** CLI 인자를 읽는다. 모르는 플래그는 사용 오류다. */
export function parseRenderArguments(argv) {
  const options = {};
  const flags = { '--diff': 'diff', '--trace': 'trace', '--meta': 'meta', '--max-rows': 'maxRows', '--max-chars': 'maxChars', '--key': 'key' };
  for (let index = 0; index < argv.length; index += 2) {
    const name = flags[argv[index]];
    if (name === undefined || argv[index + 1] === undefined) throw new RenderInputError(`Unknown or incomplete argument ${argv[index]}.`);
    options[name] = argv[index + 1];
  }
  for (const name of ['maxRows', 'maxChars']) {
    if (options[name] !== undefined) {
      if (!/^\d+$/u.test(options[name])) throw new RenderInputError(`--${name === 'maxRows' ? 'max-rows' : 'max-chars'} must be an integer.`);
      options[name] = Number(options[name]);
    }
  }
  return options;
}

/** CLI 진입점이다. 성공 0, 입력 오류 2, 사용 오류 64. */
function main(argv) {
  let options;
  try { options = parseRenderArguments(argv); }
  catch (error) { process.stderr.write(`${error.message}\n`); return 64; }
  try {
    const inputs = {
      diff: options.diff === undefined ? undefined : readJsonFile(options.diff, 'diff'),
      trace: options.trace === undefined ? undefined : readJsonFile(options.trace, 'trace'),
      meta: options.meta === undefined ? undefined : readJsonFile(options.meta, 'meta'),
    };
    process.stdout.write(renderPrComment(inputs, {
      ...(options.maxRows === undefined ? {} : { maxRows: options.maxRows }),
      ...(options.maxChars === undefined ? {} : { maxChars: options.maxChars }),
      ...(options.key === undefined ? {} : { key: options.key }),
    }));
    return 0;
  } catch (error) {
    if (!(error instanceof RenderInputError)) throw error;
    process.stderr.write(`${error.message}\n`);
    return 2;
  }
}

/** 이 파일이 직접 실행됐는지다(심링크·상대 경로로 실행해도 realpath로 비교한다). */
function isMainModule() {
  if (process.argv[1] === undefined) return false;
  try { return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); }
  catch { return false; }
}

if (isMainModule()) process.exitCode = main(process.argv.slice(2));
