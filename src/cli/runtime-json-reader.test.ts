import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_TOTAL_INPUT_TEXT_LENGTH } from './command-support.ts';
import { RuntimeInputError, RuntimeJsonReader } from './runtime-json-reader.ts';

test('이미 읽은 정적 context도 runtime 전체 입력 예산에 포함한다', async () => {
  const reader = new RuntimeJsonReader(async () => '{}', MAX_TOTAL_INPUT_TEXT_LENGTH - 1);
  await assert.rejects(reader.read('not-disclosed'), (error: unknown) =>
    error instanceof RuntimeInputError && error.message.includes('size limit') && !error.message.includes('not-disclosed'));
});
