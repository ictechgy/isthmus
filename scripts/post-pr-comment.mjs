#!/usr/bin/env node
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  commentMarker, GITHUB_COMMENT_LIMIT, readJsonFile, RenderInputError, renderPrComment,
} from './render-pr-comment.mjs';

/**
 * PR에 isthmus 스티키 댓글을 만들거나 고친다(GitHub Action `comment` 명령과 `comment-mode: sticky`).
 *
 * 보안 설계:
 * - 이 스크립트만 토큰을 받는다. 생산자(PR 코드)가 도는 분석 단계와 분리해, 권장 구성에서는 checkout도 PR 코드
 *   실행도 없는 별도 job(`pull-requests: write`)에서 돈다.
 * - `--results`로 받으면 artifact의 JSON을 Action 자신의 렌더러로 **다시 렌더링**한다. artifact는 PR 코드가 만든
 *   것이라 comment.md를 그대로 올리면 임의의 Markdown(링크·멘션)을 봇 이름으로 게시하게 된다. 다시 렌더링하면
 *   댓글은 렌더러 틀과 이스케이프를 벗어나지 못한다.
 * - PR 번호를 artifact(meta)에서 읽을 때는(workflow_run) `--expected-head-sha`와 PR head가 같아야 한다 — 공격자가
 *   다른 PR 번호를 적어 그 PR에 댓글을 달게 하지 못하게 한다.
 * - 표식(`<!-- isthmus-http-impact:<key> -->`)으로 시작하고 지정한 작성자(기본 `github-actions[bot]`)가 쓴 댓글만
 *   고친다. 다른 사람이 표식을 흉내 낸 댓글은 건드리지 않는다.
 * - 토큰이 쓰기 권한이 없으면(포크 PR의 `pull_request` 토큰) 경고만 남기고 성공으로 끝난다 — job summary가 남는다.
 */

/** 기본 댓글 작성자다(`GITHUB_TOKEN`의 신원). 다른 토큰(PAT·App)을 쓰면 `comment-author`로 바꾼다. */
export const DEFAULT_COMMENT_AUTHOR = 'github-actions[bot]';
/** 댓글 목록을 훑는 최대 쪽 수다(쪽당 100개). */
const MAX_COMMENT_PAGES = 50;
/** GitHub REST API 버전 머리글이다. */
const API_VERSION = '2022-11-28';

/** 게시 오류다. 토큰·응답 본문은 싣지 않는다. */
export class PostCommentError extends Error {
  /** 원인 문구를 보존한다. */
  constructor(message) {
    super(message);
    this.name = 'PostCommentError';
  }
}

/** `owner/name` 저장소 이름을 검증한다(URL 경로에 끼우므로). */
function validateRepository(repository) {
  if (typeof repository !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)) {
    throw new PostCommentError('The repository must be owner/name.');
  }
}

/** API 기본 URL을 검증한다(https만, GHES 포함). */
function validateApiUrl(apiUrl) {
  let url;
  try { url = new URL(apiUrl); } catch { throw new PostCommentError('The GitHub API URL is invalid.'); }
  if (url.protocol !== 'https:') throw new PostCommentError('The GitHub API URL must use https.');
  return apiUrl.replace(/\/+$/u, '');
}

/** GitHub REST 요청 하나다. 실패하면 상태 코드만 싣는다. */
async function request(context, method, path, body) {
  const response = await context.fetchImpl(`${context.apiUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${context.token}`, accept: 'application/vnd.github+json',
      'x-github-api-version': API_VERSION, 'user-agent': 'isthmus-ci', ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) return { ok: false, status: response.status };
  // 본문이 JSON이 아니어도(프록시·빈 응답) 성공 상태는 그대로 쓰고 값만 비운다.
  try { return { ok: true, status: response.status, json: await response.json() }; }
  catch { return { ok: true, status: response.status, json: undefined }; }
}

/** PR head SHA가 기대값과 같은지 확인한다(workflow_run에서 PR 번호를 artifact로 받을 때). */
async function verifyHead(context, prNumber, expectedHeadSha) {
  const pull = await request(context, 'GET', `/repos/${context.repository}/pulls/${prNumber}`);
  if (!pull.ok) throw new PostCommentError(`Could not read pull request ${prNumber} (HTTP ${pull.status}).`);
  if (pull.json?.head?.sha !== expectedHeadSha) {
    throw new PostCommentError(`Pull request ${prNumber} does not point at the analysed head commit; not commenting.`);
  }
}

/** 기존 스티키 댓글을 찾는다: 표식으로 시작하고 지정 작성자가 쓴 첫 댓글. */
async function findSticky(context, prNumber, marker, author) {
  for (let page = 1; page <= MAX_COMMENT_PAGES; page += 1) {
    const listing = await request(context, 'GET', `/repos/${context.repository}/issues/${prNumber}/comments?per_page=100&page=${page}`);
    if (!listing.ok) return { status: listing.status };
    const comments = Array.isArray(listing.json) ? listing.json : [];
    const found = comments.find((comment) => typeof comment?.body === 'string' && comment.body.startsWith(marker)
      && comment?.user?.login === author && Number.isSafeInteger(comment.id));
    if (found !== undefined) return { id: found.id };
    if (comments.length < 100) return {};
  }
  return {};
}

/**
 * 스티키 댓글을 만들거나 고친다. 반환값 `status`: `created`·`updated`·`forbidden`(쓰기 권한 없음 — 경고).
 * 본문은 표식으로 시작하고 GitHub 상한 이하여야 한다.
 */
export async function upsertStickyComment({
  token, repository, prNumber, body, key = 'default', author = DEFAULT_COMMENT_AUTHOR,
  apiUrl = 'https://api.github.com', expectedHeadSha, fetchImpl = globalThis.fetch,
}) {
  if (typeof token !== 'string' || token.length === 0) throw new PostCommentError('No GitHub token was given; set github-token.');
  validateRepository(repository);
  if (!Number.isSafeInteger(prNumber) || prNumber < 1) throw new PostCommentError('The pull request number is missing or invalid.');
  const marker = commentMarker(key);
  if (typeof body !== 'string' || !body.startsWith(marker)) throw new PostCommentError('The comment body does not start with the isthmus marker.');
  if (body.length > GITHUB_COMMENT_LIMIT) throw new PostCommentError(`The comment body exceeds ${GITHUB_COMMENT_LIMIT} characters.`);
  const context = { token, repository, apiUrl: validateApiUrl(apiUrl), fetchImpl };
  if (expectedHeadSha !== undefined) await verifyHead(context, prNumber, expectedHeadSha);
  const existing = await findSticky(context, prNumber, marker, author);
  if (existing.status === 403) return { status: 'forbidden' };
  if (existing.status !== undefined) throw new PostCommentError(`Listing pull request comments failed (HTTP ${existing.status}).`);
  const result = existing.id === undefined
    ? await request(context, 'POST', `/repos/${repository}/issues/${prNumber}/comments`, { body })
    : await request(context, 'PATCH', `/repos/${repository}/issues/comments/${existing.id}`, { body });
  if (result.status === 403) return { status: 'forbidden' };
  if (!result.ok) throw new PostCommentError(`Posting the comment failed (HTTP ${result.status}).`);
  return { status: existing.id === undefined ? 'created' : 'updated', id: result.json?.id };
}

/** results 디렉터리(artifact)의 JSON을 다시 렌더링한다. meta의 PR 정보도 돌려준다. */
export function renderFromResults(directory, { key = 'default', maxRows } = {}) {
  const optional = (name) => (existsSync(join(directory, name)) ? readJsonFile(join(directory, name), name) : undefined);
  const meta = optional('meta.json');
  const body = renderPrComment({ diff: optional('diff.json'), trace: optional('trace.json'), meta },
    { key, ...(maxRows === undefined ? {} : { maxRows }) });
  return { body, meta };
}

/** meta의 PR 번호(검증 전 — 호출자가 head 대조를 강제한다)다. */
function metaPullRequestNumber(meta) {
  const number = meta?.pullRequest?.number;
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

/**
 * 환경 변수 입력(`ISTHMUS_CI_*`, action.yml이 넘긴다)으로 게시한다.
 * - `ISTHMUS_CI_RESULTS_DIR`(다시 렌더링) 또는 `ISTHMUS_CI_BODY_FILE`(같은 job의 분석 단계가 쓴 본문) 중 하나.
 * - PR 번호: `ISTHMUS_CI_PR_NUMBER`(이벤트), 없으면 meta — 그때는 `ISTHMUS_CI_EXPECTED_HEAD_SHA`가 필수다.
 */
export async function postFromEnvironment(env = process.env, { fetchImpl = globalThis.fetch, log = (line) => process.stdout.write(line) } = {}) {
  const key = env.ISTHMUS_CI_COMMENT_KEY || 'default';
  const maxRows = /^\d+$/u.test(env.ISTHMUS_CI_MAX_ROWS ?? '') ? Number(env.ISTHMUS_CI_MAX_ROWS) : undefined;
  const expectedHeadSha = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(env.ISTHMUS_CI_EXPECTED_HEAD_SHA ?? '') ? env.ISTHMUS_CI_EXPECTED_HEAD_SHA : undefined;
  let body;
  let meta;
  if (env.ISTHMUS_CI_RESULTS_DIR) ({ body, meta } = renderFromResults(resolve(env.GITHUB_WORKSPACE ?? '.', env.ISTHMUS_CI_RESULTS_DIR), { key, maxRows }));
  else if (env.ISTHMUS_CI_BODY_FILE) body = readFileSync(env.ISTHMUS_CI_BODY_FILE, 'utf8');
  else throw new PostCommentError('Give results-dir (recommended) or a comment body file.');
  const eventNumber = /^\d{1,10}$/u.test(env.ISTHMUS_CI_PR_NUMBER ?? '') ? Number(env.ISTHMUS_CI_PR_NUMBER) : undefined;
  const fromMeta = eventNumber === undefined ? metaPullRequestNumber(meta) : undefined;
  if (fromMeta !== undefined && expectedHeadSha === undefined) {
    throw new PostCommentError('The pull request number comes from the artifact; set expected-head-sha to the analysed head commit.');
  }
  const result = await upsertStickyComment({ token: env.ISTHMUS_CI_GITHUB_TOKEN, repository: env.GITHUB_REPOSITORY,
    prNumber: eventNumber ?? fromMeta, body, key, author: env.ISTHMUS_CI_COMMENT_AUTHOR || DEFAULT_COMMENT_AUTHOR,
    apiUrl: env.GITHUB_API_URL || 'https://api.github.com', expectedHeadSha, fetchImpl });
  if (result.status === 'forbidden') {
    log('::warning title=isthmus comment::The token cannot write pull request comments (fork pull requests get a read-only token); '
      + 'the report is in the job summary. See docs/CI.md for the workflow_run setup.\n');
  } else {
    log(`isthmus: pull request comment ${result.status}.\n`);
  }
  return result;
}

/** 이 파일이 직접 실행됐는지다. */
function isMainModule() {
  if (process.argv[1] === undefined) return false;
  try { return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); }
  catch { return false; }
}

if (isMainModule()) {
  try {
    await postFromEnvironment();
  } catch (error) {
    if (!(error instanceof PostCommentError) && !(error instanceof RenderInputError)) throw error;
    process.stderr.write(`isthmus comment: ${error.message}\n`);
    process.exitCode = 1;
  }
}
