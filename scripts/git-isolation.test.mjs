import assert from 'node:assert/strict';
import test from 'node:test';
import { CONFIG_NAMES_QUERY, filterDriverNames, GitIsolationError, isolatedGitArguments } from './git-isolation.mjs';

/** `git config -z --name-only --list` 출력 모양(키마다 NUL로 끝난다)이다. */
const listing = (...keys) => keys.map((key) => `${key}\0`).join('');
const common = ['-c', 'core.fsmonitor=false', '-c', 'log.showSignature=false'];

test('설정 키 목록에서 명령을 가진 filter 드라이버 이름을 점·대소문자·빈 이름 그대로 모은다', () => {
  assert.deepEqual(CONFIG_NAMES_QUERY, ['config', '-z', '--name-only', '--list']);
  assert.deepEqual(filterDriverNames(''), []);
  assert.deepEqual(filterDriverNames(listing('core.bare', 'filter.lfs.clean', 'filter.lfs.smudge', 'filter.lfs.process',
    'filter.lfs.required', 'filter.evil.name.clean', 'filter.Up.smudge', 'filter..clean', 'filter.a.clean.process',
    'filter.only.required', 'filter.clean', 'diff.x.textconv')), ['', 'Up', 'a.clean', 'evil.name', 'lfs']);
});

test('명령줄로 덮을 수 없는 드라이버 이름과 불완전한 목록은 이름 원문 없이 거부한다', () => {
  for (const name of ['a=b', 'x=', '��', 'ok�.name']) {
    assert.throws(() => filterDriverNames(listing('filter.safe.clean', `filter.${name}.process`)), (error) => {
      assert.ok(error instanceof GitIsolationError);
      assert.match(error.message, /^git cannot override a configured filter driver whose name contains "=" or is not valid UTF-8;/u);
      assert.ok(!error.message.includes(name), 'The message does not echo the configured name.');
      return true;
    });
  }
  // 명령이 없는 키의 이름은 무력화 대상이 아니므로 막지 않는다.
  assert.deepEqual(filterDriverNames(listing('filter.a=b.required')), []);
  assert.throws(() => filterDriverNames('filter.evil.clean'), (error) => error instanceof GitIsolationError &&
    /incomplete configuration listing/u.test(error.message));
});

test('하위 명령마다 정한 격리 인자를 하위 명령 앞뒤에 붙이고 정하지 않은 하위 명령은 받지 않는다', () => {
  const neutralized = (name) => ['-c', `filter.${name}.clean=`, '-c', `filter.${name}.smudge=`, '-c', `filter.${name}.process=`,
    '-c', `filter.${name}.required=false`];
  assert.deepEqual(isolatedGitArguments([], 'rev-parse', ['--verify', '--end-of-options', 'HEAD^{commit}']),
    [...common, 'rev-parse', '--verify', '--end-of-options', 'HEAD^{commit}']);
  assert.deepEqual(isolatedGitArguments(['', 'evil.name'], 'diff', ['--name-status', '-z', 'HEAD', '--']),
    [...common, ...neutralized(''), ...neutralized('evil.name'), '-c', 'diff.autoRefreshIndex=false',
      'diff', '--no-ext-diff', '--no-textconv', '--ignore-submodules=dirty', '--name-status', '-z', 'HEAD', '--']);
  assert.deepEqual(isolatedGitArguments(['lfs'], 'status', ['--porcelain', '-z']),
    [...common, ...neutralized('lfs'), 'status', '--ignore-submodules=dirty', '--porcelain', '-z']);
  assert.deepEqual(isolatedGitArguments([], 'ls-files', ['--others']), [...common, 'ls-files', '--others']);
  for (const subcommand of ['log', 'toString', '__proto__']) {
    assert.throws(() => isolatedGitArguments([], subcommand, []), TypeError, subcommand);
  }
});
