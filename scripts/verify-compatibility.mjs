import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const semver = /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/u;
const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const compatibility = JSON.parse(readFileSync(join(repositoryRoot, 'compatibility.json'), 'utf8'));
const packageDocument = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8'));
const documents = {
  'docs/COMPATIBILITY.md': readFileSync(join(repositoryRoot, 'docs/COMPATIBILITY.md'), 'utf8'),
  'README.md': readFileSync(join(repositoryRoot, 'README.md'), 'utf8'),
  'README.ko.md': readFileSync(join(repositoryRoot, 'README.ko.md'), 'utf8'),
};

verify(compatibility.format === 'isthmus-compatibility' && compatibility.version === 1,
  'manifest format');
verify(semver.test(compatibility.isthmus), 'isthmus version shape');
verify(compatibility.isthmus === packageDocument.version, 'isthmus version matches package');
verify(compatibility.producers !== null && typeof compatibility.producers === 'object' &&
  !Array.isArray(compatibility.producers), 'producer map');
for (const [name, version] of Object.entries(compatibility.producers)) {
  verify(semver.test(version), `${name} version shape`);
  // 문서가 같은 버전을 손으로 적으므로 단일 정본과 어긋나면 실패시킨다.
  verify(documents['docs/COMPATIBILITY.md'].includes(`| ${name} | **${version}**`),
    `${name} in COMPATIBILITY.md`);
  verify(documents['README.md'].includes(`${name} **${version}**`), `${name} in README.md`);
  verify(documents['README.ko.md'].includes(`${name} **${version}**`), `${name} in README.ko.md`);
}
verify(documents['docs/COMPATIBILITY.md'].includes(
  `| isthmus-cli | **${compatibility.isthmus}**`), 'isthmus in COMPATIBILITY.md');
process.stdout.write(`Compatibility verified: isthmus ${compatibility.isthmus}.\n`);

/** 호환 버전 표기 위반을 저장소 경로 없는 검사 이름으로 보고한다. */
function verify(condition, name) {
  if (!condition) throw new Error(`Compatibility contract failed: ${name}`);
}