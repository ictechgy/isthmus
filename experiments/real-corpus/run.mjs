import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { capturePreflight } from '../../scripts/capture-preflight.mjs';
import { runChild } from '../../scripts/run-child.mjs';

// 실사용 코퍼스 실행기: 고정 pub.dev 아카이브를 sha256 검증·스테이징한 뒤
// capture-preflight로 예측을 만들고 manifest의 수동 정답과 비교한다.
// Flutter SDK가 없으므로 Swift는 FlutterMacOS 스텁 하네스로 실컴파일하고,
// Dart는 수동 package_config로 해석한다. Kotlin은 producer가 없어 미측정이다.

const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(await readFile(join(here, 'manifest.json'), 'utf8'));
const [cartographBin, dartographBin, ...rest] = process.argv.slice(2);
if (cartographBin === undefined || dartographBin === undefined || rest.length > 0 || process.platform !== 'darwin') {
  process.stderr.write('Usage (macOS): node experiments/real-corpus/run.mjs <cartograph-bin> <dartograph-bin>\n');
  process.exit(64);
}

const cartographReal = await realpath(cartographBin);
const dartographReal = await realpath(dartographBin);
const work = await realpath(await mkdtemp(join(tmpdir(), 'isthmus-real-corpus-')));
const sourceDir = join(work, 'src');
const resultsDir = join(here, 'results');
await mkdir(sourceDir, { recursive: true });
await mkdir(resultsDir, { recursive: true });

const flutterStub = join(here, 'harness', 'flutter_stub');
const swiftStub = join(here, 'harness', 'swift', 'FlutterMacOS.swift');
const vendoredStubNames = new Set();

/** 고정 아카이브를 받아 sha256을 확인하고 풀어둔다. */
async function fetchArchive(id) {
  const meta = manifest.archives[id];
  assert.ok(meta, `unknown archive ${id}`);
  const target = join(sourceDir, `${meta.package}-${meta.version}`);
  const tarball = join(work, `${meta.package}-${meta.version}.tar.gz`);
  const got = runChild('curl', ['-fsSL', meta.archiveUrl, '-o', tarball], { timeout: 120_000 });
  assert.equal(got.status, 0, `archive download failed: ${id}`);
  const bytes = await readFile(tarball);
  const hash = createHash('sha256').update(bytes).digest('hex');
  assert.equal(hash, meta.sha256, `archive sha256 mismatch: ${id}`);
  await mkdir(target, { recursive: true });
  const untar = runChild('tar', ['-xzf', tarball, '-C', target], { timeout: 120_000 });
  assert.equal(untar.status, 0, `archive extract failed: ${id}`);
  return { path: target, sha256: hash };
}

/** manifest의 staging 규칙대로 프로젝트 디렉터리를 만든다. */
async function stageProject(name, definition, archiveOverride) {
  const project = join(work, `project-${name}`);
  await mkdir(project, { recursive: true });
  const staged = [];
  for (const rule of definition.staging) {
    const archiveId = archiveOverride?.archive ?? rule.archive;
    const archive = archives[archiveId];
    for (const relative of rule.paths) {
      const from = join(archive.path, relative);
      const to = join(project, relative);
      await mkdir(dirname(to), { recursive: true });
      await cp(from, to, { recursive: true });
      staged.push({ from: `${archiveId}:${relative}`, to: relative });
    }
  }
  // 네이티브 하네스: FlutterMacOS 스텁 + 프로젝트 루트 Package.swift.
  const stubDir = join(project, '.isthmus-corpus', 'FlutterMacOS');
  await mkdir(stubDir, { recursive: true });
  await cp(swiftStub, join(stubDir, 'FlutterMacOS.swift'));
  const targets = [{ name: 'FlutterMacOS', path: '.isthmus-corpus/FlutterMacOS' },
    ...definition.swiftTargets.map((target) => ({ ...target, dependencies: ['FlutterMacOS'] }))];
  const targetText = targets.map((target) => {
    const deps = target.dependencies === undefined ? '' :
      `,\n            dependencies: [${target.dependencies.map((d) => `"${d}"`).join(', ')}]`;
    const exclude = target.exclude === undefined ? '' :
      `,\n            exclude: [${target.exclude.map((e) => `"${e}"`).join(', ')}]`;
    return `        .target(\n            name: "${target.name}"${deps},\n            path: "${target.path}"${exclude}\n        )`;
  }).join(',\n');
  await writeFile(join(project, 'Package.swift'),
    `// swift-tools-version: 6.0\nimport PackageDescription\n\nlet package = Package(\n    name: "IsthmusCorpus${name.replace(/[^A-Za-z0-9]/g, '')}",\n    platforms: [.macOS(.v12)],\n    targets: [\n${targetText},\n    ],\n    swiftLanguageModes: [.v5]\n)\n`);

  // Dart 해석: Flutter 스텁 + pub 의존성을 vendor하고 package_config를 직접 쓴다.
  const vendor = join(project, '.corpus', 'vendor');
  const dartTool = join(project, '.dart_tool');
  await mkdir(join(vendor, 'flutter'), { recursive: true });
  await cp(flutterStub, join(vendor, 'flutter'), { recursive: true });
  const rootName = (await readFile(join(project, 'pubspec.yaml'), 'utf8')).match(/^name:\s*(\S+)/m)[1];
  const packages = [
    { name: rootName, rootUri: '../', packageUri: 'lib/' },
    { name: 'flutter', rootUri: '../.corpus/vendor/flutter', packageUri: 'lib/' },
  ];
  for (const depId of definition.dartDeps ?? []) {
    const dep = manifest.archives[depId];
    const dest = join(vendor, dep.package);
    await cp(archives[depId].path, dest, { recursive: true });
    packages.push({ name: dep.package, rootUri: `../.corpus/vendor/${dep.package}`, packageUri: 'lib/' });
    vendoredStubNames.add(dep.package);
  }
  await mkdir(dartTool, { recursive: true });
  await writeFile(join(dartTool, 'package_config.json'), JSON.stringify({
    configVersion: 2,
    packages: packages.map((p) => ({ ...p, languageVersion: '3.4' })),
  }));
  return { project: await realpath(project), staged, rootName };
}

const archives = {};
for (const id of Object.keys(manifest.archives)) archives[id] = await fetchArchive(id);

const projects = {};
for (const [name, definition] of Object.entries(manifest.projects)) {
  projects[name] = await stageProject(name, definition);
}

function git(project, args, label) {
  const result = runChild('git', ['-C', project, ...args], { timeout: 60_000 });
  assert.equal(result.status, 0, `${label}: ${result.stderr}`);
  return result.stdout.trim();
}

/** diff 케이스: 기저를 커밋하고 새 아카이브의 staging 경로를 덮어쓴다. */
async function applyDiff(project, apply) {
  git(project, ['init', '--quiet'], 'git init');
  git(project, ['-c', 'user.email=corpus@localhost', '-c', 'user.name=corpus', 'add', '-A'], 'git add');
  git(project, ['-c', 'user.email=corpus@localhost', '-c', 'user.name=corpus',
    'commit', '--quiet', '--no-verify', '-m', 'base'], 'git commit');
  const archive = archives[apply.archive];
  for (const relative of apply.paths) {
    await rm(join(project, relative), { recursive: true, force: true });
    await mkdir(dirname(join(project, relative)), { recursive: true });
    await cp(join(archive.path, relative), join(project, relative), { recursive: true });
  }
}

/** 경계 예측을 비교 가능한 키 집합으로 정규화한다. */
function predictedKeys(report) {
  const methods = new Set();
  const prefixes = new Set();
  const channels = new Set();
  for (const boundary of report.boundaries ?? []) {
    const subject = boundary.subject;
    if (subject.transport === 'basic-message-channel') {
      // 동적 채널명은 "...\(<suffix>)" 형태의 리터럴로 남는다 — 접두부로 정규화한다.
      const raw = (subject.channel ?? '').replace(/^"|"$/g, '').replace(/\\?\([^)]*\)$/u, '');
      prefixes.add(raw);
    } else {
      channels.add(subject.channel);
      if (subject.method !== undefined) methods.add(`${subject.channel}/${subject.method}`);
    }
  }
  return { methods, prefixes, channels };
}

const rows = [];
for (const corpusCase of manifest.cases) {
  const started = performance.now();
  const project = projects[corpusCase.project];
  const contextOut = join(resultsDir, `${corpusCase.id}.context.json`);
  const cacheOut = join(resultsDir, `${corpusCase.id}.cache.json`);
  const config = {
    project: project.project,
    inputs: ['lib', 'pubspec.yaml', '.dart_tool/package_config.json', 'Package.swift',
      ...project.staged.map(({ to }) => to.split('/')[0])].filter((v, i, a) => a.indexOf(v) === i),
    toolInputs: [cartographReal, dartographReal],
    prepare: [['swift', 'build', '--package-path', project.project]],
    dartograph: [dartographReal],
    cartograph: [cartographReal],
    messages: true,
    output: contextOut,
    cache: cacheOut,
  };
  if (corpusCase.applyArchive !== undefined) {
    await applyDiff(project.project, corpusCase.applyArchive);
    config.since = 'HEAD';
    delete config.selection;
  } else {
    config.selection = corpusCase.selection;
  }
  let outcome;
  try {
    outcome = await capturePreflight(config);
  } catch (error) {
    rows.push({ id: corpusCase.id, error: error.message });
    continue;
  }
  const report = outcome.report;
  const predicted = predictedKeys(report);
  const projectMeta = manifest.projects[corpusCase.project];
  const expectedMethods = new Set(corpusCase.expectedMethods ?? []);
  const expectedPrefixes = new Set(corpusCase.expectedPrefixes === 'ALL'
    ? projectMeta.channelPrefixes ?? [] : corpusCase.expectedPrefixes ?? []);
  const expectedChannels = new Set(corpusCase.expectedChannels ?? []);
  const tp = [...expectedMethods].filter((m) => predicted.methods.has(m)).length
    + [...expectedPrefixes].filter((p) => [...predicted.prefixes].some((q) => q === p || p.startsWith(q) || q.startsWith(p))).length;
  const fn = expectedMethods.size + expectedPrefixes.size - tp;
  const fp = [...predicted.methods].filter((m) => !expectedMethods.has(m)).length
    + [...predicted.prefixes].filter((q) => ![...expectedPrefixes].some((p) => q === p || p.startsWith(q) || q.startsWith(p))).length;
  rows.push({
    id: corpusCase.id,
    project: corpusCase.project,
    status: report.status,
    predicted: { methods: [...predicted.methods].sort(), prefixes: [...predicted.prefixes].sort(), channels: [...predicted.channels].sort() },
    expected: { methods: [...expectedMethods].sort(), prefixes: [...expectedPrefixes].sort(), channels: [...expectedChannels].sort() },
    truePositives: tp, falseNegatives: fn, falsePositives: fp,
    summary: report.summary,
    limitations: [...(report.limitations ?? []), ...(report.bridgeLimitations ?? []), ...(report.messageLimitations ?? [])]
      .map((l) => (typeof l === 'string' ? l : l.code ?? l.message)),
    reviewFiles: report.reviewFiles?.length ?? 0,
    cached: outcome.cached,
    milliseconds: Math.round(performance.now() - started),
  });
}

const totals = rows.filter((r) => r.error === undefined).reduce(
  (acc, r) => ({ tp: acc.tp + r.truePositives, fn: acc.fn + r.falseNegatives, fp: acc.fp + r.falsePositives }),
  { tp: 0, fn: 0, fp: 0 });
const document = {
  format: 'isthmus-real-corpus-results', version: 1,
  runtimeExecution: false, flutterSdk: false, kotlinCoverage: false,
  note: 'Stub-compiled Swift index + manual package_config. EventChannel·Kotlin·런타임 실행은 범위 밖.',
  tools: { cartograph: cartographReal, dartograph: dartographReal },
  totals, cases: rows,
};
await writeFile(join(resultsDir, 'results.json'), JSON.stringify(document, null, 2));
process.stdout.write(`${JSON.stringify({ work, totals, cases: rows.map(({ id, status, truePositives, falseNegatives, falsePositives, error }) =>
  ({ id, status, tp: truePositives, fn: falseNegatives, fp: falsePositives, error })) }, null, 2)}\n`);
