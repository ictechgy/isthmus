import { isAbsolute, relative, resolve } from 'node:path';

import { isJsonObject, isProjectRelativePath, isSafeNonEmptyString } from './parse.ts';

/**
 * capture workflow 설정이 계약을 어겼음을 나타낸다.
 *
 * 이 설정은 제품이 실행하는 명령 목록이 아니라 `scripts/capture-preflight.mjs`가
 * 실행할 명령 목록이다. 제품은 JSON으로 검증만 하고 자매 도구를 실행하지 않는다.
 */
export class CaptureConfigValidationError extends Error {
  /** 입력 내용을 노출하지 않는 안전한 메시지를 보존한다. */
  constructor(message: string) {
    super(message);
    this.name = 'CaptureConfigValidationError';
  }
}

/** 명령 배열은 비어 있지 않은 안전한 문자열 토큰의 비어 있지 않은 배열이다. */
function isCommand(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length > 0 && value.every(isSafeNonEmptyString);
}

/**
 * capture workflow 설정을 검증한다.
 *
 * `scripts/capture-preflight.mjs`가 실행 전에 적용하는 규칙과 같은 정본이다.
 * 규칙을 여기에 두어 `isthmus doctor`와 수집기가 같은 판정을 내리게 한다.
 * `project`는 이미 realpath로 정규화된 조인 루트다.
 */
export function validateCaptureConfig(config: unknown, project: string): void {
  if (!isJsonObject(config)) fail('Capture config must be a JSON object.');
  if (!isSafeNonEmptyString(config.project)) fail('Capture config requires a project path.');
  const command = isCommand;
  if (!command(config.dartograph) ||
    (config.cartograph === undefined && config.kartograph === undefined) ||
    (config.cartograph !== undefined && !command(config.cartograph)) ||
    (config.kartograph !== undefined && !command(config.kartograph)) ||
    !Array.isArray(config.prepare) || config.prepare.length === 0 ||
    !config.prepare.every(command)) {
    fail('Configure producer commands and a native index preparation command.');
  }
  if (config.messages !== undefined && config.messages !== true &&
    (config.messages === null || typeof config.messages !== 'object' ||
      Array.isArray(config.messages) || Object.entries(config.messages).some(([name, value]) =>
        !['dartograph', 'cartograph', 'kartograph'].includes(name) ||
        config[name] === undefined || !command(value)))) {
    fail('Invalid message producer configuration.');
  }
  if (config.events !== undefined && config.events !== true &&
    (config.events === null || typeof config.events !== 'object' ||
      Array.isArray(config.events) || Object.entries(config.events).some(([name, value]) =>
        !['dartograph', 'cartograph', 'kartograph'].includes(name) ||
        config[name] === undefined || !command(value)))) {
    fail('Invalid event producer configuration.');
  }
  // Kotlin 소스 읽기는 스냅이 없어도 동작한다. 스냅샷은 impact 분석에만
  // 필요하므로 selection.kotlin이 있을 때만 요구한다.
  const selection = config.selection as Record<string, unknown> | undefined;
  const kotlinSelection = typeof selection === 'object' && selection !== null &&
    !Array.isArray(selection) && selection.kotlin !== undefined;
  if (kotlinSelection && config.kartograph === undefined) {
    fail('A Kotlin selection requires its Kartograph producer.');
  }
  if (kotlinSelection && !isSafeNonEmptyString(config.kartographSnapshot)) {
    fail('Configure a Kartograph snapshot produced by the preparation command.');
  }
  if (config.kartograph === undefined && config.kartographSnapshot !== undefined) {
    fail('A Kartograph snapshot requires its producer.');
  }
  if (!Array.isArray(config.inputs) || config.inputs.length === 0 ||
    !config.inputs.every(isProjectRelativePath) ||
    !Array.isArray(config.toolInputs) || config.toolInputs.length === 0 ||
    !config.toolInputs.every(isSafeNonEmptyString)) {
    fail('Declare source/config inputs and producer implementation files for fingerprinting.');
  }
  const explicit = config.selection !== undefined;
  const since = config.since !== undefined;
  if (explicit === since ||
    (explicit && (config.selection === null || typeof config.selection !== 'object' ||
      Array.isArray(config.selection))) ||
    (since && !isSafeNonEmptyString(config.since)) ||
    !isSafeNonEmptyString(config.output) || !isSafeNonEmptyString(config.cache)) {
    fail('Configure exactly one selection or since revision, plus output and cache paths.');
  }
  for (const output of [config.output, `${config.output}.sources.json`, config.cache]) {
    const target = resolve(project, output as string);
    for (const input of [...(config.inputs as string[]), ...(config.toolInputs as string[]),
      ...(config.kartographSnapshot === undefined ? [] : [config.kartographSnapshot as string])]) {
      const part = relative(resolve(project, input), target);
      if (part === '' || (!part.startsWith('..') && !isAbsolute(part))) {
        fail('Keep output and cache outside fingerprint input trees.');
      }
    }
  }
  if (resolve(project, config.output as string) === resolve(project, config.cache as string)) {
    fail('Output and cache paths must differ.');
  }
}

/** 입력 값을 포함하지 않는 검증 오류를 던진다. */
function fail(message: string): never {
  throw new CaptureConfigValidationError(message);
}