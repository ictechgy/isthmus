import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runChild } from './run-child.mjs';

// cold-cache 재현 검증: 발행된 isthmus 실행 파일 하나만으로 고정 fixture의
// check·retentions·preflight가 계약대로 동작하는지 확인한다. producer 경로를
// 주면 fixtures/bridge-app을 소스 스캔해 Dart↔Swift↔Kotlin 3방향 조인까지
// 실제 실행한다. 원격 CI의 첫 구축과 로컬 개발 checkout 모두에서 같은
// 단계를 검사한다.

const [isthmusMain, ...producerBins] = process.argv.slice(2);
if (isthmusMain === undefined || (producerBins.length !== 0 && producerBins.length !== 3)) {
  process.stderr.write(
    'Usage: verify-cold-cache.mjs <isthmus-main.js> [<cartograph-bin> <dartograph-bin> <kartograph-bin>]\n',
  );
  process.exit(64);
}

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const fixtures = join(repositoryRoot, 'fixtures');
const bridgeApp = join(fixtures, 'bridge-app');
const work = await mkdtemp(join(tmpdir(), 'isthmus-cold-cache-'));

try {
  // 고정 문서 쌍 — 발행 패키지만으로 재현되는 조인 경로다.
  const dartDoc = join(fixtures, 'bridge', 'dart.json');
  const swiftDoc = join(fixtures, 'bridge', 'swift.json');
  const mismatchDoc = join(fixtures, 'bridge', 'swift-mismatch.json');

  const matched = isthmus(['check', dartDoc, swiftDoc, '--strict']);
  verify(matched.status === 0, 'check matched pair');
  const matchedReport = parseDocument(matched.stdout, 'check JSON');
  verify(matchedReport.format === 'isthmus-check', 'check format');
  verify(matchedReport.summary?.matchedChannels >= 1, 'matched channels');
  verify(matchedReport.summary?.errors === 0, 'matched errors');

  const mismatch = isthmus(['check', dartDoc, mismatchDoc, '--strict']);
  verify(mismatch.status === 1, 'check mismatch exit');
  const mismatchReport = parseDocument(mismatch.stdout, 'check mismatch JSON');
  verify(
    mismatchReport.issues?.some((issue) => issue.code === 'unhandled-invocation' && issue.severity === 'error'),
    'mismatch issue',
  );

  const retentions = isthmus(['retentions', dartDoc, swiftDoc, '--for', 'cartograph']);
  verify(retentions.status === 0, 'retentions');
  const retentionDocument = parseDocument(retentions.stdout, 'retentions JSON');
  verify(retentionDocument.format === 'external-retentions', 'retentions format');
  verify(retentionDocument.version === 0, 'retentions version');
  verify(retentionDocument.retentions?.length >= 1, 'retentions entries');

  const preflight = isthmus(['preflight', join(fixtures, 'preflight', 'context.json'), '--summary', '--compact']);
  verify(preflight.status === 0 || preflight.status === 1, 'preflight summary exit');
  const summary = parseDocument(preflight.stdout, 'preflight summary JSON');
  verify(summary.format === 'isthmus-preflight-summary', 'preflight summary format');

  if (producerBins.length === 3) {
    const [cartograph, dartograph, kartograph] = producerBins;
    // cartograph는 소스 스캔과 별개로 컴파일러 인덱스를 요구한다 — fixture를 직접 빌드한다.
    const build = run('swift', ['build', '--package-path', bridgeApp]);
    verify(build.status === 0, 'swift build fixture');

    const dart = run(dartograph, ['bridges', '--format', 'json', '--project', bridgeApp, bridgeApp]);
    verify(dart.status === 0, 'dartograph bridges');
    const swift = run(cartograph, ['bridges', '--project', bridgeApp, '--target', 'flutter', '--format', 'json']);
    verify(swift.status === 0, 'cartograph bridges');
    const kotlin = run(kartograph, ['bridges', '--project', bridgeApp, '--target', 'flutter', '--format', 'json']);
    verify(kotlin.status === 0, 'kartograph bridges');

    const paths = { dart: 'dart.json', swift: 'swift.json', kotlin: 'kotlin.json' };
    for (const [result, platform] of [[dart, 'dart'], [swift, 'swift'], [kotlin, 'kotlin']]) {
      const document = parseDocument(result.stdout, `${platform} bridges JSON`);
      verify(document.format === 'bridge-facts', `${platform} bridges format`);
      verify(document.facts?.length >= 1, `${platform} bridges facts`);
      await writePrivateFile(join(work, paths[platform]), result.stdout);
    }

    const joined = isthmus(['check', join(work, 'dart.json'), join(work, 'swift.json'), join(work, 'kotlin.json'), '--strict']);
    verify(joined.status === 0, 'three-way check');
    const joinedReport = parseDocument(joined.stdout, 'three-way check JSON');
    verify(joinedReport.summary?.matchedChannels >= 1, 'three-way channels');
    verify(joinedReport.summary?.errors === 0, 'three-way errors');

    const liveRetentions = isthmus([
      'retentions', join(work, 'dart.json'), join(work, 'swift.json'), join(work, 'kotlin.json'), '--for', 'cartograph',
    ]);
    verify(liveRetentions.status === 0, 'three-way retentions');
    verify(
      parseDocument(liveRetentions.stdout, 'three-way retentions JSON').retentions?.length >= 1,
      'three-way retentions entries',
    );
  }

  process.stdout.write('cold-cache verification passed\n');
} finally {
  await rm(work, { recursive: true, force: true });
}

/** 설치본 진입점을 Node로 실행한다. */
function isthmus(arguments_) {
  return run(process.execPath, [isthmusMain, ...arguments_]);
}

/** 자식 프로세스를 UTF-8 텍스트 모드로 실행한다. */
function run(command, arguments_) {
  return runChild(command, arguments_, { timeout: 5 * 60_000 });
}

/** stdout이 하나의 JSON 문서인지 확인하고 반환한다. */
function parseDocument(stdout, step) {
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(`Cold-cache verification failed: ${step}`);
  }
}

/** 생성 문서를 소유자만 읽을 수 있게 새 파일로 쓴다. */
function writePrivateFile(path, contents) {
  return writeFile(path, contents, { mode: 0o600, flag: 'wx' });
}

/** 검증 실패 시 경로나 자식 출력 없이 단계 이름만 보고한다. */
function verify(condition, step) {
  if (!condition) throw new Error(`Cold-cache verification failed: ${step}`);
}
