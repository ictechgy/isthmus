import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const excluded = ['evidence-manifest.json', 'verification.json'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

/** 닫힌 하네스의 원시 파일을 상대 경로로 지문화한다. 요약/manifest 자체는 순환 참조에서 제외한다. */
export async function writeEvidenceManifest(directory) {
  const document = await inventory(directory);
  await writeFile(join(directory, 'evidence-manifest.json'), document, { mode: 0o600, flag: 'wx' });
  return { sha256: sha(document), files: JSON.parse(document).files.length };
}

/** 보존 bundle을 다른 위치로 복사해도 원시 파일 누락·변조·추가를 확인한다. */
export async function verifyEvidenceManifest(directory) {
  const stored = await readFile(join(directory, 'evidence-manifest.json'), 'utf8');
  if (stored !== await inventory(directory)) throw new Error('Runtime evidence differs from its recorded manifest.');
  return { sha256: sha(stored), files: JSON.parse(stored).files.length };
}

async function inventory(directory) {
  const files = [];
  async function walk(prefix) {
    for (const entry of await readdir(join(directory, prefix), { withFileTypes: true })) {
      const name = prefix ? prefix + '/' + entry.name : entry.name;
      if (entry.isSymbolicLink()) throw new Error('Runtime evidence contains a symbolic or unsupported entry.');
      if (!prefix && excluded.includes(name)) continue;
      if (entry.isDirectory()) await walk(name);
      else if (entry.isFile()) {
        const path = join(directory, name); const hash = createHash('sha256');
        for await (const bytes of createReadStream(path)) hash.update(bytes);
        files.push({ path: name, bytes: (await stat(path)).size, sha256: hash.digest('hex') });
      } else throw new Error('Runtime evidence contains a symbolic or unsupported entry.');
    }
  }
  await walk('');
  return JSON.stringify({ format: 'isthmus-runtime-evidence-manifest', version: 1, excluded,
    files: files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0) }, null, 2) + '\n';
}
