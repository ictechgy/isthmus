import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const skillUrl = new URL('../Skills/isthmus/SKILL.md', import.meta.url);
const packageUrl = new URL('../package.json', import.meta.url);

test('배포 skill이 삭제 전 경계 조회와 한계 확인을 가르친다', async () => {
  const markdown = await readFile(skillUrl, 'utf8');

  assert.equal(markdown.startsWith('---\nname: isthmus\n'), true);
  assert.equal(markdown.includes('isthmus query'), true);
  assert.equal(markdown.includes('usedBy'), true);
  assert.equal(markdown.includes('dependsOn'), true);
  assert.equal(markdown.includes('limitations'), true);
  assert.equal(markdown.includes('not permission to delete'), true);
});

test('npm 패키지가 검토 가능한 skill 원문을 포함한다', async () => {
  const packageDocument = JSON.parse(await readFile(packageUrl, 'utf8'));

  assert.equal(packageDocument.files.includes('Skills'), true);
});
