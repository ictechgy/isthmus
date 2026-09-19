import assert from 'node:assert/strict';
import test from 'node:test';

import type { CaptureFileSystem } from './command-support.ts';
import { runDoctorCommand } from './doctor-command.ts';

/** 존재하는 파일 집합을 가진 가짜 파일시스템이다. */
function fileSystem(files: readonly string[], project = '/app'): CaptureFileSystem {
  const known = new Set(files);
  return {
    statPath: async (path) => (known.has(path) ? 'file' : 'missing'),
    realPath: async (path) => {
      if (path !== project) throw new Error('missing');
      return project;
    },
  };
}

const config = JSON.stringify({
  project: '/app',
  dartograph: ['dartograph'],
  cartograph: ['/tools/cartograph'],
  prepare: [['/tools/prepare']],
  inputs: ['lib'],
  toolInputs: ['/tools/dartograph'],
  selection: { dart: { files: [], symbols: [] } },
  output: '.isthmus/context.json',
  cache: '.isthmus/cache.json',
});

/** 설정 텍스트를 돌려주는 읽기 경계다. */
const read = async (): Promise<string> => config;

test('모든 producer와 prepare가 해결되면 ok 0을 낸다', async () => {
  const result = await runDoctorCommand(
    ['doctor', 'capture.json'],
    read,
    fileSystem(['/bin/dartograph', '/tools/cartograph', '/tools/prepare']),
    '/',
    '/bin',
  );

  assert.equal(result.exitCode, 0);
  const report = JSON.parse(result.standardOutput);
  assert.equal(report.format, 'isthmus-doctor');
  assert.equal(report.status, 'ok');
  assert.deepEqual(report.checks.map(({ name, status }: { name: string; status: string }) => [name, status]), [
    ['dartograph', 'ok'],
    ['cartograph', 'ok'],
    ['prepare-1', 'ok'],
  ]);
});

test('해결되지 않는 명령이 있으면 incomplete 1과 missing 검사를 낸다', async () => {
  const result = await runDoctorCommand(
    ['doctor', 'capture.json'],
    read,
    fileSystem(['/bin/dartograph', '/tools/cartograph']),
    '/',
    '/bin',
  );

  assert.equal(result.exitCode, 1);
  const report = JSON.parse(result.standardOutput);
  assert.equal(report.status, 'incomplete');
  assert.deepEqual(report.checks.find(({ name }: { name: string }) => name === 'prepare-1'),
    { name: 'prepare-1', status: 'missing', command: ['/tools/prepare'] });
});

test('설정 계약 위반과 읽기·JSON 실패를 코드 2로 구분한다', async () => {
  const broken = JSON.stringify({ ...JSON.parse(config), prepare: [] });
  const contract = await runDoctorCommand(
    ['doctor', 'capture.json'],
    async () => broken,
    fileSystem([]),
    '/',
    '',
  );
  assert.equal(contract.exitCode, 2);
  assert.match(contract.standardError, /violates the workflow contract/u);

  const missing = await runDoctorCommand(
    ['doctor', 'capture.json'],
    async () => { throw new Error('missing'); },
    fileSystem([]),
    '/',
    '',
  );
  assert.equal(missing.exitCode, 2);

  const invalidJson = await runDoctorCommand(
    ['doctor', 'capture.json'],
    async () => '{not json',
    fileSystem([]),
    '/',
    '',
  );
  assert.equal(invalidJson.exitCode, 2);
  assert.match(invalidJson.standardError, /not valid JSON/u);
});

test('없는 project와 잘못된 사용법을 구분한다', async () => {
  const noProject = await runDoctorCommand(
    ['doctor', 'capture.json'],
    read,
    fileSystem([], '/other'),
    '/',
    '',
  );
  assert.equal(noProject.exitCode, 2);
  assert.match(noProject.standardError, /project path does not exist/u);

  assert.equal((await runDoctorCommand(['doctor'], read, fileSystem([]), '/', '')).exitCode, 64);
  assert.equal((await runDoctorCommand(['doctor', '--x'], read, fileSystem([]), '/', '')).exitCode, 64);
});