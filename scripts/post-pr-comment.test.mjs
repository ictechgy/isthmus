import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { DEFAULT_COMMENT_AUTHOR, postFromEnvironment, PostCommentError, renderFromResults, upsertStickyComment } from './post-pr-comment.mjs';
import { commentMarker } from './render-pr-comment.mjs';

// 스티키 댓글 게시기 회귀 테스트다. 네트워크 없이 가짜 fetch로 GitHub REST 응답을 흉내 낸다.

/** 기본 본문(표식으로 시작)이다. */
const BODY = `${commentMarker()}\nbody\n`;
/** head SHA 예시다. */
const HEAD = 'c'.repeat(40);

/**
 * 가짜 GitHub API다. 댓글 목록(쪽당 100개)·PR·POST·PATCH를 흉내 내고 요청을 기록한다.
 * `status`로 특정 메서드의 실패 상태를 강제한다.
 */
function fakeGitHub({ comments = [], pullHead = HEAD, pullRepo = 'fork-owner/repo', pullRef = 'topic', status = {} } = {}) {
  const requests = [];
  const fetchImpl = async (url, init) => {
    const { pathname, searchParams } = new URL(url);
    requests.push({ method: init.method, pathname, body: init.body, authorization: init.headers.authorization });
    const forced = status[init.method];
    if (forced !== undefined) return { ok: false, status: forced, json: async () => ({}) };
    if (init.method === 'GET' && pathname.endsWith('/comments')) {
      const page = Number(searchParams.get('page'));
      return { ok: true, status: 200, json: async () => comments.slice((page - 1) * 100, page * 100) };
    }
    if (init.method === 'GET') {
      return { ok: true, status: 200, json: async () => ({ head: { sha: pullHead, ref: pullRef, repo: { full_name: pullRepo } } }) };
    }
    return { ok: true, status: init.method === 'POST' ? 201 : 200, json: async () => ({ id: 99 }) };
  };
  return { fetchImpl, requests };
}

/** 기본 호출 인자다. */
function call(overrides) {
  return { token: 'secret-token', repository: 'owner/repo', prNumber: 5, body: BODY, ...overrides };
}

test('표식 댓글이 없으면 만들고, 봇 작성자의 표식 댓글이 있으면 고친다', async () => {
  const created = fakeGitHub();
  assert.deepEqual(await upsertStickyComment(call({ fetchImpl: created.fetchImpl })), { status: 'created', id: 99 });
  assert.equal(created.requests.at(-1).method, 'POST');
  assert.equal(created.requests.at(-1).pathname, '/repos/owner/repo/issues/5/comments');
  assert.equal(created.requests.at(-1).authorization, 'Bearer secret-token');
  const filler = Array.from({ length: 100 }, (_, index) => ({ id: index + 1, body: 'other', user: { login: 'someone' } }));
  const updated = fakeGitHub({ comments: [...filler, { id: 500, body: `${BODY}old`, user: { login: DEFAULT_COMMENT_AUTHOR } }] });
  assert.deepEqual(await upsertStickyComment(call({ fetchImpl: updated.fetchImpl })), { status: 'updated', id: 99 });
  assert.equal(updated.requests.at(-1).method, 'PATCH');
  assert.equal(updated.requests.at(-1).pathname, '/repos/owner/repo/issues/comments/500');
  assert.equal(updated.requests.filter(({ method }) => method === 'GET').length, 2, '두 번째 쪽까지 훑는다');
});

test('다른 작성자가 표식을 흉내 낸 댓글은 고치지 않는다', async () => {
  const github = fakeGitHub({ comments: [{ id: 1, body: BODY, user: { login: 'attacker' } }] });
  assert.equal((await upsertStickyComment(call({ fetchImpl: github.fetchImpl }))).status, 'created');
  const custom = fakeGitHub({ comments: [{ id: 2, body: BODY, user: { login: 'my-app[bot]' } }] });
  assert.equal((await upsertStickyComment(call({ fetchImpl: custom.fetchImpl, author: 'my-app[bot]' }))).status, 'updated');
});

test('쓰기 권한이 없으면(403) forbidden, 다른 실패는 오류다', async () => {
  assert.equal((await upsertStickyComment(call({ fetchImpl: fakeGitHub({ status: { POST: 403 } }).fetchImpl }))).status, 'forbidden');
  assert.equal((await upsertStickyComment(call({ fetchImpl: fakeGitHub({ status: { GET: 403 } }).fetchImpl }))).status, 'forbidden');
  await assert.rejects(upsertStickyComment(call({ fetchImpl: fakeGitHub({ status: { POST: 422 } }).fetchImpl })), /HTTP 422/u);
  await assert.rejects(upsertStickyComment(call({ fetchImpl: fakeGitHub({ status: { GET: 500 } }).fetchImpl })), /HTTP 500/u);
});

test('기대 head SHA와 PR head가 다르면 댓글을 달지 않는다', async () => {
  const github = fakeGitHub({ pullHead: 'd'.repeat(40) });
  await assert.rejects(upsertStickyComment(call({ fetchImpl: github.fetchImpl, expectedHeadSha: HEAD })), /does not point at the analysed head/u);
  assert.ok(github.requests.every(({ method }) => method === 'GET'));
  assert.equal((await upsertStickyComment(call({ fetchImpl: fakeGitHub().fetchImpl, expectedHeadSha: HEAD }))).status, 'created');
  await assert.rejects(upsertStickyComment(call({ fetchImpl: fakeGitHub({ status: { GET: 404 } }).fetchImpl, expectedHeadSha: HEAD })), /HTTP 404/u);
});

test('같은 head SHA라도 head 저장소·브랜치가 다르면(남의 commit으로 연 PR) 댓글을 달지 않는다', async () => {
  const expected = { expectedHeadSha: HEAD, expectedHeadRepository: 'attacker/repo', expectedHeadBranch: 'topic' };
  const spoofed = fakeGitHub({ pullRepo: 'victim/repo' });
  await assert.rejects(upsertStickyComment(call({ fetchImpl: spoofed.fetchImpl, ...expected })), /commit, repository and branch/u);
  assert.ok(spoofed.requests.every(({ method }) => method === 'GET'));
  await assert.rejects(upsertStickyComment(call({ fetchImpl: fakeGitHub({ pullRepo: 'attacker/repo', pullRef: 'other' }).fetchImpl, ...expected })),
    /commit, repository and branch/u);
  const genuine = fakeGitHub({ pullRepo: 'Attacker/Repo' });
  assert.equal((await upsertStickyComment(call({ fetchImpl: genuine.fetchImpl, ...expected }))).status, 'created');
});

test('댓글이 5,000개를 넘어 스티키 댓글을 찾지 못하면 새로 만들지 않고 오류다', async () => {
  const comments = Array.from({ length: 5000 }, (_, index) => ({ id: index + 1, body: 'x', user: { login: 'someone' } }));
  const github = fakeGitHub({ comments });
  await assert.rejects(upsertStickyComment(call({ fetchImpl: github.fetchImpl })), /more than 5000 comments/u);
  assert.ok(github.requests.every(({ method }) => method === 'GET'));
});

test('성공 응답의 본문이 JSON이 아니어도 게시 결과를 돌려준다', async () => {
  const fetchImpl = async (url, init) => (init.method === 'GET'
    ? { ok: true, status: 200, json: async () => [] }
    : { ok: true, status: 201, json: async () => { throw new SyntaxError('not json'); } });
  assert.deepEqual(await upsertStickyComment(call({ fetchImpl })), { status: 'created', id: undefined });
});

test('입력 검증: 토큰·저장소·PR 번호·표식·크기·API URL', async () => {
  const { fetchImpl } = fakeGitHub();
  for (const overrides of [{ token: '' }, { repository: 'owner/repo/../x' }, { prNumber: 0 }, { body: 'no marker' },
    { body: `${BODY}${'x'.repeat(70000)}` }, { apiUrl: 'http://api.example' }, { apiUrl: 'not a url' }]) {
    await assert.rejects(upsertStickyComment(call({ fetchImpl, ...overrides })), PostCommentError, JSON.stringify(Object.keys(overrides)));
  }
  const ghes = fakeGitHub();
  await upsertStickyComment(call({ fetchImpl: ghes.fetchImpl, apiUrl: 'https://ghe.example/api/v3/' }));
  assert.ok(ghes.requests.every(({ pathname }) => pathname.startsWith('/api/v3/repos/owner/repo/')));
});

test('results 디렉터리를 다시 렌더링하고, artifact의 PR 번호는 기대 head SHA가 있어야 쓴다', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'isthmus-post-'));
  try {
    writeFileSync(join(directory, 'diff.json'), JSON.stringify({ format: 'isthmus-http-diff', version: 1, mode: 'surface', findings: [],
      summary: { callImpact: 'no-breaks-observed' } }));
    writeFileSync(join(directory, 'meta.json'), JSON.stringify({ pullRequest: { number: 12 }, errors: [] }));
    writeFileSync(join(directory, 'comment.md'), `${commentMarker()}\n[phish](https://evil.example)\n`);
    const { body } = renderFromResults(directory, { key: 'default' });
    assert.doesNotMatch(body, /phish/u, 'artifact의 comment.md를 쓰지 않는다');
    const env = { ISTHMUS_CI_RESULTS_DIR: directory, ISTHMUS_CI_GITHUB_TOKEN: 't', GITHUB_REPOSITORY: 'owner/repo' };
    await assert.rejects(postFromEnvironment(env, { fetchImpl: fakeGitHub().fetchImpl, log: () => {} }), /set expected-head-sha/u);
    await assert.rejects(postFromEnvironment({ ...env, ISTHMUS_CI_EXPECTED_HEAD_SHA: HEAD }, { fetchImpl: fakeGitHub().fetchImpl, log: () => {} }),
      /expected-head-repository/u);
    const github = fakeGitHub();
    const logs = [];
    const result = await postFromEnvironment({ ...env, ISTHMUS_CI_EXPECTED_HEAD_SHA: HEAD, ISTHMUS_CI_EXPECTED_HEAD_REPOSITORY: 'fork-owner/repo',
      ISTHMUS_CI_EXPECTED_HEAD_BRANCH: 'topic' }, { fetchImpl: github.fetchImpl, log: (line) => logs.push(line) });
    assert.equal(result.status, 'created');
    assert.equal(github.requests.at(-1).pathname, '/repos/owner/repo/issues/12/comments');
    assert.match(logs.join(''), /comment created/u);
    const forbidden = await postFromEnvironment({ ...env, ISTHMUS_CI_PR_NUMBER: '3' },
      { fetchImpl: fakeGitHub({ status: { POST: 403 } }).fetchImpl, log: (line) => logs.push(line) });
    assert.equal(forbidden.status, 'forbidden');
    assert.match(logs.at(-1), /^::warning title=isthmus comment::/u);
    const bodyFile = join(directory, 'body.md');
    writeFileSync(bodyFile, BODY);
    const direct = fakeGitHub();
    await postFromEnvironment({ ISTHMUS_CI_BODY_FILE: bodyFile, ISTHMUS_CI_PR_NUMBER: '4', ISTHMUS_CI_GITHUB_TOKEN: 't', GITHUB_REPOSITORY: 'owner/repo' },
      { fetchImpl: direct.fetchImpl, log: () => {} });
    assert.equal(JSON.parse(direct.requests.at(-1).body).body, BODY);
    await assert.rejects(postFromEnvironment({ GITHUB_REPOSITORY: 'owner/repo' }, { fetchImpl: direct.fetchImpl, log: () => {} }), /results-dir/u);
    const empty = join(directory, 'empty');
    mkdirSync(empty);
    await assert.rejects(postFromEnvironment({ ISTHMUS_CI_RESULTS_DIR: empty, ISTHMUS_CI_GITHUB_TOKEN: 't', GITHUB_REPOSITORY: 'owner/repo' },
      { fetchImpl: direct.fetchImpl, log: () => {} }), /no meta\.json/u);
    await assert.rejects(postFromEnvironment({ ISTHMUS_CI_BODY_FILE: bodyFile, ISTHMUS_CI_GITHUB_TOKEN: 't', GITHUB_REPOSITORY: 'owner/repo' },
      { fetchImpl: direct.fetchImpl, log: () => {} }), /set pr-number/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
