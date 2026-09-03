import { readFile } from 'node:fs/promises';

import { joinBridgeFacts } from './join.mjs';

const inputPaths = process.argv.slice(2);
if (inputPaths.length !== 2) {
  process.stderr.write('Usage: join-cli.mjs <dart.json> <swift.json>\n');
  process.exitCode = 64;
} else {
  try {
    const [dartDocument, swiftDocument] = await Promise.all(
      inputPaths.map(readDocument),
    );
    const report = joinBridgeFacts(dartDocument, swiftDocument);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch {
    process.stderr.write(
      'Unable to read bridge facts; check the input paths and JSON.\n',
    );
    process.exitCode = 2;
  }
}

/** JSON 파일 하나를 교환 문서로 읽는다. */
async function readDocument(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}
