#!/usr/bin/env node
import { mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runChild } from '../../run-child.mjs';

/**
 * Action capture 모드 자체 시험용 합성 git 저장소를 만든다(`node scripts/fixtures/ci/make-demo-repo.mjs <빈 디렉터리>`).
 *
 * `fixtures/trace/`(합성 단일 project: 서버 route·persistence·sql·안드로이드 호출·순회)를 복사하고, 문서의
 * `project`를 이 저장소의 realpath로 바꾼다 — capture가 문서 project를 member project(realpath)와 대조하기 때문이다.
 * base commit은 fixture 그대로, head commit은 안드로이드가 부르는 `GET /api/users/{}` route-decl을 지운다. 그래서
 * diff는 `removed-bound-route`(error)를, base capture trace는 그 route의 테이블·DB 의존자·클라이언트 코드를 낸다.
 * capture 설정(`.isthmus/capture.json`)은 생산자 없이 사전 계산 문서·분석만 복사한다(합성 fixture라 실제 앱이 아니다).
 * stdout에 `{path, base, head}` JSON을 쓴다.
 */

/** 저장소 루트다. */
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
/** 원본 합성 fixture 디렉터리다. */
const fixtureDirectory = join(repositoryRoot, 'fixtures', 'trace');
/** fixture 문서의 원래 project다. */
const FIXTURE_PROJECT = '/work/trace-example';
/** head에서 지우는 route다(안드로이드 `UsersApi.get`이 부른다). */
const REMOVED_ROUTE = { method: 'GET', channel: '/api/users/{}' };
/** capture 설정이 복사하는 문서 이름이다. */
const DOCUMENTS = ['server.http.json', 'server.persistence.json', 'db.sql.json', 'android.http.json'];
/** capture 설정이 복사하는 사전 계산 분석(id, platform, role, 파일)이다. */
const ANALYSES = [
  ['server-forward', 'js', 'forward', 'server-forward.json'],
  ['server-reverse', 'js', 'reverse', 'server-reverse.json'],
  ['db', 'sql', 'db-dependents', 'db-dependents.json'],
  ['android-reverse', 'kotlin', 'reverse', 'android-reverse.json'],
];

/** 합성 저장소의 capture 설정이다. root `repo`는 상대 경로라 Action이 checkout 경로로 바꾼다. */
export function demoCaptureConfig() {
  return {
    format: 'isthmus-trace-capture', version: 1, roots: { repo: '.' }, output: { root: 'repo', path: 'unused' },
    generatedAt: '2026-09-27T00:00:00Z', tools: {},
    members: [{
      name: 'app', project: { root: 'repo' }, revision: 'rev-1',
      documents: DOCUMENTS.map((name) => ({ name, precomputed: { root: 'repo', path: `facts/${name}` } })),
      analyses: ANALYSES.map(([id, platform, role, file]) => ({ id, platform, role, precomputed: { path: { root: 'repo', path: `facts/${file}` } } })),
    }],
    selection: { routes: [{ method: 'GET', template: '/api/users/{}' }] },
  };
}

/** git을 합성 신원으로 실행한다(사용자 설정·hook을 읽지 않는다). */
function git(directory, args) {
  const result = runChild('git', ['-C', directory, '-c', 'user.name=isthmus-ci', '-c', 'user.email=ci@example.invalid',
    '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], {
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
  });
  if (result.status !== 0) throw new Error(`git ${args[0]} failed while building the demo repository.`);
  return result.stdout.trim();
}

/** fixture JSON을 읽어 project를 바꾼 사본을 쓴다. */
function copyFixture(file, target, project) {
  const document = JSON.parse(readFileSync(join(fixtureDirectory, file), 'utf8'));
  if (document.project === FIXTURE_PROJECT) document.project = project;
  writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`);
  return document;
}

/** head 변경: 지정한 route-decl을 서버 문서에서 지운다. */
function removeRoute(path) {
  const document = JSON.parse(readFileSync(path, 'utf8'));
  document.facts = document.facts.filter((fact) => !(fact.kind === 'route-decl' && fact.method === REMOVED_ROUTE.method
    && fact.channel === REMOVED_ROUTE.channel));
  writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`);
}

/** 빈 디렉터리에 합성 저장소를 만들고 base·head commit id를 돌려준다. */
export function makeDemoRepository(directory) {
  mkdirSync(directory, { recursive: true });
  if (readdirSync(directory).length > 0) throw new Error('The demo repository directory must be empty.');
  const project = realpathSync(directory);
  mkdirSync(join(project, 'facts'));
  mkdirSync(join(project, '.isthmus'));
  for (const file of [...DOCUMENTS, ...ANALYSES.map(([, , , name]) => name)]) copyFixture(file, join(project, 'facts', file), project);
  writeFileSync(join(project, '.isthmus', 'capture.json'), `${JSON.stringify(demoCaptureConfig(), null, 2)}\n`);
  git(project, ['init', '--quiet', '--initial-branch=main']);
  git(project, ['add', '-A']);
  git(project, ['commit', '--quiet', '-m', 'base']);
  const base = git(project, ['rev-parse', 'HEAD']);
  removeRoute(join(project, 'facts', 'server.http.json'));
  git(project, ['commit', '--quiet', '-am', 'head: remove GET /api/users/{}']);
  return { path: project, base, head: git(project, ['rev-parse', 'HEAD']) };
}

if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) {
    process.stderr.write('Usage: node scripts/fixtures/ci/make-demo-repo.mjs <empty directory>\n');
    process.exitCode = 64;
  } else {
    process.stdout.write(`${JSON.stringify(makeDemoRepository(resolve(process.argv[2])))}\n`);
  }
}
