import assert from 'node:assert/strict';
import { readFile, realpath } from 'node:fs/promises';
import test from 'node:test';

const skillUrl = new URL('../Skills/isthmus/SKILL.md', import.meta.url);
const packageUrl = new URL('../package.json', import.meta.url);

test('Codex가 발견하는 스킬과 npm 배포 스킬은 같은 원문이다', async () => {
  const discovered = new URL('../.agents/skills/isthmus/SKILL.md', import.meta.url);
  assert.equal(await realpath(discovered), await realpath(skillUrl));
  assert.ok((await readFile(discovered, 'utf8')).length > 0);
});

test('npm 패키지가 검토 가능한 skill 원문을 포함한다', async () => {
  const packageDocument = JSON.parse(await readFile(packageUrl, 'utf8'));
  assert.equal(packageDocument.files.includes('Skills'), true);
});
