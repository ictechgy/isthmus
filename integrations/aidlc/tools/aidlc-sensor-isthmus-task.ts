import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adaptAidlcTask, aidlcFailure } from './aidlc-task.js';
import { encodeAidlcVerdict } from './aidlc-output.js';
export { MAX_SENSOR_OUTPUT_BYTES } from './aidlc-output.js';
import { BoundedTextReadError, readBoundedTextFile } from './bounded-text-file.js';

/** 원본 task 상한이다. 넘친 파일을 부분 JSON이나 빈 정상 결과로 바꾸지 않는다. */
export const MAX_TASK_BYTES = 1024 * 1024;

/** 공식 dispatcher가 붙이는 두 인자만 받으며 같은 deliverable의 sidecar 하나만 읽는다. */
export async function evaluate(argv, read = readBoundedTextFile) {
  let stage = 'unsupported';
  try {
    const options = new Map();
    for (let i = 0; i < argv.length; i += 2) {
      const name = argv[i], value = argv[i + 1];
      if (!['--stage', '--output-path'].includes(name) || options.has(name)
        || typeof value !== 'string' || value.length === 0 || /[\x00-\x1f\x7f]/u.test(value)) throw new Error('arguments');
      options.set(name, value);
    }
    stage = options.get('--stage');
    if (!['delivery-planning', 'build-and-test'].includes(stage) || !options.has('--output-path')) throw new Error('stage');
    const text = await read(`${resolve(options.get('--output-path'))}.isthmus-task.json`, MAX_TASK_BYTES);
    if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_TASK_BYTES) return aidlcFailure('truncated', stage);
    return adaptAidlcTask(JSON.parse(text), stage, createHash('sha256').update(text, 'utf8').digest('hex'));
  } catch (error) {
    const reason = error instanceof BoundedTextReadError
      ? error.reason === 'limit' ? 'truncated' : error.reason === 'encoding' ? 'malformed' : 'unavailable'
      : error?.code === 'ETIMEDOUT' ? 'timeout' : 'malformed';
    return aidlcFailure(reason, stage);
  }
}

/** native AI-DLC가 import 후 await하는 worker 진입점이다. 실패 관찰도 JSON 한 줄·종료 코드 0이다. */
export async function main(argv) {
  process.stdout.write(encodeAidlcVerdict(await evaluate(argv)));
}

if (import.meta.main || process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2));
}
