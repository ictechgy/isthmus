import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runChild } from './run-child.mjs';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const packageDocument = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);

verify(packageDocument.name === 'isthmus-cli', 'package name');
verify(packageDocument.version === '0.1.1', 'package version');
verify(packageDocument.license === 'MIT', 'license');
verify(packageDocument.bin?.isthmus === 'dist/cli/main.js', 'binary');
verify(packageDocument.publishConfig?.access === 'public', 'public access');
verify(
  packageDocument.repository?.url ===
    'git+https://github.com/ictechgy/isthmus.git',
  'repository URL',
);

const pack = runChild(
  'npm',
  ['pack', '--dry-run', '--json', '--ignore-scripts'],
  { cwd: repositoryRoot },
);
verify(pack.status === 0, 'npm pack');
const [artifact] = JSON.parse(pack.stdout);
verify(artifact?.id === 'isthmus-cli@0.1.1', 'artifact identity');
const paths = new Set(artifact.files.map(({ path }) => path));
for (const requiredPath of [
  'LICENSE',
  'README.md',
  'Skills/isthmus/SKILL.md',
  'dist/cli/main.js',
  'package.json',
]) {
  verify(paths.has(requiredPath), `artifact file ${requiredPath}`);
}
verify([...paths].every((path) => !path.startsWith('src/')), 'source exclusion');
const sourceMapPaths = [...paths].filter((path) => path.endsWith('.js.map'));
verify(
  sourceMapPaths.length > 0 && paths.has('dist/cli/main.js.map'),
  'source maps present',
);
for (const sourceMapPath of sourceMapPaths) {
  const sourceMap = JSON.parse(
    readFileSync(join(repositoryRoot, sourceMapPath), 'utf8'),
  );
  verify(
    Array.isArray(sourceMap.sources) &&
      sourceMap.sources.length > 0 &&
      Array.isArray(sourceMap.sourcesContent) &&
      sourceMap.sourcesContent.length === sourceMap.sources.length &&
      sourceMap.sourcesContent.every(
        (source) => typeof source === 'string' && source.length > 0,
      ),
    `inline source map ${sourceMapPath}`,
  );
}

process.stdout.write('Package contract verified: isthmus-cli@0.1.1\n');

/** 패키지 계약 위반을 민감정보 없는 검사 이름으로 보고한다. */
function verify(condition, name) {
  if (!condition) throw new Error(`Package contract failed: ${name}`);
}
