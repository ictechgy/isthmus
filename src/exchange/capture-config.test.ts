import assert from 'node:assert/strict';
import test from 'node:test';

import { CaptureConfigValidationError, validateCaptureConfig } from './capture-config.ts';

/** 유효한 capture 설정이다. 각 테스트가 한 필드만 바꾼다. */
const valid = {
  project: '/app',
  dartograph: ['/tools/dartograph'],
  cartograph: ['/tools/cartograph'],
  prepare: [['/tools/index', '--build']],
  inputs: ['lib'],
  toolInputs: ['/tools/dartograph'],
  selection: { dart: { files: [], symbols: [] } },
  output: '.isthmus/context.json',
  cache: '.isthmus/cache.json',
};

test('유효한 capture 설정을 통과시킨다', () => {
  validateCaptureConfig(valid, '/app');
});

test('project와 producer·prepare 필수 필드를 거부한다', () => {
  for (const [config, reason] of [
    [null, 'Capture config must be a JSON object.'],
    [{ ...valid, project: '' }, 'Capture config requires a project path.'],
    [{ ...valid, dartograph: [] }, 'Configure producer commands'],
    [{ ...valid, cartograph: undefined, kartograph: undefined }, 'Configure producer commands'],
    [{ ...valid, prepare: [] }, 'Configure producer commands'],
  ] as const) {
    assert.throws(() => validateCaptureConfig(config, '/app'), (error: unknown) =>
      error instanceof CaptureConfigValidationError && error.message.includes(reason));
  }
});

test('messages·events override의 이름과 명령을 검증한다', () => {
  validateCaptureConfig({ ...valid, messages: true, events: { cartograph: ['/other'] } }, '/app');
  for (const value of [
    { messages: { unknown: ['/x'] } },
    { messages: { cartograph: [] } },
    { events: { kartograph: ['/x'] } },
  ]) {
    assert.throws(() => validateCaptureConfig({ ...valid, ...value }, '/app'),
      CaptureConfigValidationError);
  }
});

test('Kotlin 선택은 kartograph producer와 snapshot을 요구한다', () => {
  const kotlin = { ...valid, selection: { kotlin: { files: [], symbols: [] } } };
  assert.throws(() => validateCaptureConfig({ ...kotlin, kartograph: undefined}, '/app'), /Kartograph producer/u);
  assert.throws(() => validateCaptureConfig({ ...kotlin, kartograph: ['/k'] }, '/app'), /snapshot/u);
  validateCaptureConfig({ ...kotlin, kartograph: ['/k'], kartographSnapshot: 'graph.out' }, '/app');
  assert.throws(() => validateCaptureConfig({ ...valid, kartographSnapshot: 'graph.out' }, '/app'),
    /snapshot requires its producer/u);
});

test('fingerprint 입력과 출력·캐시 경로 규칙을 지킨다', () => {
  for (const value of [
    { inputs: [] },
    { inputs: ['../outside'] },
    { toolInputs: [] },
    { since: 'HEAD', selection: { dart: {} } },
    { selection: undefined },
    { output: '' },
  ]) {
    assert.throws(() => validateCaptureConfig({ ...valid, ...value }, '/app'),
      CaptureConfigValidationError);
  }
  assert.throws(() => validateCaptureConfig({ ...valid, output: 'lib/context.json' }, '/app'),
    /outside fingerprint input trees/u);
  assert.throws(() => validateCaptureConfig({ ...valid, output: 'same.json', cache: 'same.json' }, '/app'),
    /must differ/u);
});