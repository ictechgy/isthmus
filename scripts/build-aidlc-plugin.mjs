import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const assets = ['.aidlc-plugin/plugin.json', 'sensors/aidlc-isthmus-task.md',
  'contributions/inception/delivery-planning.md', 'contributions/construction/build-and-test.md',
  'tools/aidlc-sensor-isthmus-task.ts'];

/** 배포 빌드의 기존 bounded reader와 adapter만 새 plugin 디렉터리에 복사한다. 기존 설치는 수정하지 않는다. */
export async function buildAidlcPlugin(output) {
  const target = resolve(output);
  const modules = ['report/aidlc-task', 'cli/bounded-text-file'];
  for (const name of modules) await readFile(join(root, `dist/${name}.js`));
  await mkdir(target);
  for (const path of assets) {
    await mkdir(dirname(join(target, path)), { recursive: true });
    await copyFile(join(root, 'integrations/aidlc', path), join(target, path));
  }
  for (const name of modules) for (const suffix of ['.js', '.js.map']) {
    await copyFile(join(root, `dist/${name}${suffix}`), join(target, 'tools', `${name.split('/').pop()}${suffix}`));
  }
  return target;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) { process.stderr.write('Usage: node build-aidlc-plugin.mjs <new-directory>\n'); process.exitCode = 64; }
  else { try { await buildAidlcPlugin(process.argv[2]); }
    catch { process.stderr.write('Plugin build failed; build Isthmus first and select a new output directory.\n'); process.exitCode = 2; } }
}
