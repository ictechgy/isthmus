import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// 제품 매처와 문법 검증기를 그대로 쓴다. 벡터가 제품 동작과 어긋나면 여기서 실패한다.
import { parseRouteTemplate } from '../src/exchange/route-template.ts';
import { RouteIndex } from '../src/join/route-index.ts';

/**
 * conformance/ 공유 벡터 검증기다.
 *
 * 1) SHA256SUMS가 디렉터리의 모든 벡터 파일과 정확히 맞는지(생산자가 conformance.lock으로
 *    벤더링하는 기준), 2) 벡터 형식(provenance 등급, unverified 케이스 제한, id 유일성),
 * 3) 소비자 케이스(문법·매칭)는 isthmus 구현으로, 생산자 케이스는 이 파일의 참조 구현으로
 * 실행해 기대값과 같은지 확인한다. 참조 구현은 규칙을 기계적으로 읽은 것이며 제품 코드가
 * 아니다(isthmus는 소스를 해석하지 않는다).
 */
const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const conformanceRoot = join(repositoryRoot, 'conformance');
const failures = [];

const provenanceGrades = new Set(['contract', 'verified-run', 'verified-source', 'verified-doc', 'unverified']);
const httpMethods = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'TRACE']);

verifySums();
let caseCount = 0;
for (const name of vectorFiles()) {
  const suite = JSON.parse(readFileSync(join(conformanceRoot, name), 'utf8'));
  verifySuiteShape(name, suite);
  for (const testCase of suite.cases ?? []) {
    caseCount += 1;
    runCase(suite.suite, testCase);
  }
}

if (failures.length > 0) {
  process.stderr.write(`Conformance vectors failed:\n${failures.map((line) => `- ${line}`).join('\n')}\n`);
  process.exit(1);
}
process.stdout.write(`Conformance vectors verified: ${caseCount} cases.\n`);

/** 디렉터리의 벡터 JSON 파일 목록이다. */
function vectorFiles() {
  return readdirSync(conformanceRoot).filter((name) => name.endsWith('.json')).sort();
}

/** SHA256SUMS가 모든 벡터 파일의 실제 해시와 같은지 확인한다. */
function verifySums() {
  const lines = readFileSync(join(conformanceRoot, 'SHA256SUMS'), 'utf8').trim().split('\n');
  const listed = new Map(lines.map((line) => {
    const match = /^([0-9a-f]{64}) {2}(\S+)$/u.exec(line);
    if (match === null) failures.push(`SHA256SUMS line is malformed: ${line}`);
    return match === null ? ['', ''] : [match[2], match[1]];
  }));
  for (const name of vectorFiles()) {
    const actual = createHash('sha256').update(readFileSync(join(conformanceRoot, name))).digest('hex');
    if (listed.get(name) !== actual) failures.push(`SHA256SUMS does not match ${name} (expected ${actual})`);
    listed.delete(name);
  }
  for (const name of listed.keys()) if (name !== '') failures.push(`SHA256SUMS lists a missing file ${name}`);
}

/** 벡터 파일의 공통 형식을 확인한다. */
function verifySuiteShape(name, suite) {
  const expected = name.replace(/\.json$/u, '');
  check(suite.format === 'isthmus-conformance' && suite.version === 1, `${name}: format/version`);
  check(suite.suite === expected, `${name}: suite name must match the file name`);
  check(Array.isArray(suite.cases) && suite.cases.length > 0, `${name}: cases`);
  const ids = new Set();
  for (const testCase of suite.cases ?? []) {
    const label = `${name}#${testCase.id}`;
    check(typeof testCase.id === 'string' && !ids.has(testCase.id), `${label}: id must be unique`);
    ids.add(testCase.id);
    check(typeof testCase.ruleId === 'string' && testCase.ruleId.length > 0, `${label}: ruleId`);
    check(provenanceGrades.has(testCase.provenance), `${label}: provenance grade`);
    check(typeof testCase.source === 'string' && testCase.source.length > 0, `${label}: source`);
    check(Array.isArray(testCase.appliesTo) && testCase.appliesTo.length > 0, `${label}: appliesTo`);
    check(testCase.expect !== undefined || testCase.expectDynamic === true || testCase.expectLimitation !== undefined,
      `${label}: needs expect, expectDynamic, or expectLimitation`);
    // 미검증 케이스는 구체적인 결과를 주장할 수 없다 — dynamic이나 한계만 기대할 수 있다.
    if (testCase.provenance === 'unverified') {
      check(testCase.expect === undefined, `${label}: unverified cases may only use expectDynamic/expectLimitation`);
    }
  }
}

/** 케이스 하나를 규칙별 실행기로 돌린다. */
function runCase(suite, testCase) {
  const label = `${suite}#${testCase.id}`;
  const runners = {
    'template.grammar': runGrammar,
    'template.normalize': runNormalize,
    'framework.openapi.path-templating': runOpenApi,
    'compose.interpolation': runCompose,
    'compose.query-tail': runCompose,
    'compose.suffix': runCompose,
    'compose.normalize': runCompose,
    'compose.base-join': runBaseJoin,
    'compose.strip': runStrip,
    'compose.mask': runMask,
    'wrapper.method': runWrapperMethod,
    'wrapper.location': runWrapperLocation,
  };
  const runner = testCase.ruleId.startsWith('match.') ? runMatch : runners[testCase.ruleId];
  if (runner === undefined) {
    failures.push(`${label}: no runner for ruleId ${testCase.ruleId}`);
    return;
  }
  const actual = runner(testCase.input);
  compareOutcome(label, testCase, actual);
  // 생산자가 내는 템플릿·접두사는 모두 정규 문법을 통과해야 한다.
  for (const template of [actual.template, actual.channelPrefix]) {
    if (template !== undefined) check(parseRouteTemplate(template).ok, `${label}: produced template is not canonical`);
  }
}

/** 기대값과 실행 결과를 비교한다. expect에 적힌 키만 비교한다. */
function compareOutcome(label, testCase, actual) {
  check((actual.dynamic === true) === (testCase.expectDynamic === true), `${label}: dynamic ${actual.dynamic === true}`);
  if (testCase.expectLimitation !== undefined) {
    check(actual.limitation === testCase.expectLimitation, `${label}: limitation ${actual.limitation}`);
  }
  for (const [key, value] of Object.entries(testCase.expect ?? {})) {
    const got = actual[key];
    const same = Array.isArray(value)
      ? JSON.stringify([...(got ?? [])].sort()) === JSON.stringify([...value].sort())
      : JSON.stringify(got) === JSON.stringify(value);
    check(same, `${label}: ${key} expected ${JSON.stringify(value)} but got ${JSON.stringify(got)}`);
  }
}

/** 정규 문법: isthmus 파서의 판정과 사유다. */
function runGrammar({ template }) {
  const parsed = parseRouteTemplate(template);
  return parsed.ok ? { valid: true } : { valid: false, reason: parsed.reason };
}

/** 생산자 정규화: 원문 경로 리터럴을 정규 템플릿으로 바꾼다. 서버 파라미터 문법은 다루지 않는다. */
function runNormalize({ path }) {
  return { template: normalizeLiteral(path) };
}

/** OpenAPI 경로 템플릿: `{name}` 세그먼트를 `{}`로, 한 세그먼트의 파라미터 둘 이상은 dynamic이다. */
function runOpenApi({ path }) {
  const segments = path.slice(1).split('/');
  const converted = [];
  for (const segment of segments) {
    const parameters = segment.match(/\{[^{}]+\}/gu) ?? [];
    if (parameters.length > 1) return { dynamic: true };
    if (parameters.length === 0) {
      converted.push(normalizeLiteral(segment));
      continue;
    }
    const [prefix, suffix] = segment.split(parameters[0]);
    converted.push(`${normalizeLiteral(prefix)}{}${normalizeLiteral(suffix)}`);
  }
  return { template: `/${converted.join('/')}` };
}

/** 소비자 매칭: isthmus 세그먼트 매처로 호출 하나를 선언 목록과 맞춘다. */
function runMatch({ decls, call }) {
  const declarations = decls.map((decl, id) => {
    const parsed = parseRouteTemplate(decl.template);
    return {
      id,
      template: decl.template,
      segments: parsed.ok ? parsed.segments : [],
      method: decl.method,
      anchor: decl.pathAnchor ?? 'root',
      ...(decl.trailingSlash === undefined ? {} : { trailingSlash: decl.trailingSlash }),
      caseInsensitive: decl.caseInsensitive === true,
      catchAllPrefix: decl.catchAllPrefix === true,
      constraints: new Map((decl.paramConstraints ?? []).map(({ segment, kind }) => [segment, kind])),
    };
  });
  const parsed = parseRouteTemplate(call.template);
  const outcome = new RouteIndex(declarations, { remaining: 1_000_000 }).match({
    segments: parsed.ok ? parsed.segments : [],
    anchor: call.pathAnchor,
    ...(call.method === undefined ? {} : { method: call.method }),
  });
  const targets = outcome.targets ?? [];
  return {
    ...outcome,
    ...(outcome.targets === undefined ? {} : { targets: targets.map(({ method, template }) => `${method} ${template}`) }),
    catchAllPrefixTargets: targets.filter(({ catchAllPrefix }) => catchAllPrefix).length,
  };
}

/**
 * 부분 조립 규칙의 참조 구현이다.
 *
 * 1) 리터럴의 첫 `?`·`#`에서 끊고 뒤를 버린다. 2) 끝의 증명된 query 꼬리 지역 변수를 뗀다.
 * 3) 값 보간은 앞이 `/`로 끝나고 뒤가 `/`로 시작하거나 끝일 때만 `{}`다. 그 밖(부분 세그먼트,
 * 중간의 query 꼬리, `/` 앞의 값)은 dynamic이고 앞선 부분이 `/`로 시작하면 channelPrefix다.
 */
function runCompose({ parts }) {
  const kept = [];
  let queryTailStripped = false;
  for (const part of parts) {
    if (part.literal !== undefined) {
      const cut = part.literal.search(/[?#]/u);
      if (cut >= 0) {
        if (cut > 0) kept.push({ literal: part.literal.slice(0, cut) });
        queryTailStripped = true;
        break;
      }
    }
    kept.push(part);
  }
  while (kept.at(-1)?.queryTail !== undefined) {
    kept.pop();
    queryTailStripped = true;
  }
  let text = '';
  for (const [index, part] of kept.entries()) {
    if (part.literal !== undefined) {
      text += part.literal;
      continue;
    }
    const next = kept[index + 1];
    const whole = part.value !== undefined && text.endsWith('/') &&
      (next === undefined || (next.literal !== undefined && next.literal.startsWith('/')));
    if (!whole) {
      return text.startsWith('/') ? { dynamic: true, channelPrefix: normalizeLiteral(text, true) } : { dynamic: true };
    }
    text += '\u0000';
  }
  if (!text.startsWith('/')) return { dynamic: true };
  return { template: normalizeLiteral(text, true), ...(queryTailStripped ? { queryTailStripped } : {}) };
}

/** base + path 결합의 네 갈래(RFC 3986, 슬래시 결합, dio 단순 연결)다. */
function runBaseJoin({ join, base, path }) {
  const rooted = path.startsWith('/');
  const relativeTemplate = normalizeLiteral(`/${path.replace(/^\/+/u, '')}`);
  if (join === 'rfc3986') return rooted ? { template: normalizeLiteral(path), pathAnchor: 'root' } : { template: relativeTemplate, pathAnchor: 'base' };
  if (join === 'slash-join') return { template: relativeTemplate, pathAnchor: 'base' };
  if (base !== null) return { template: runStrip({ url: `${base}${path}` }).template, pathAnchor: 'root' };
  return rooted ? { template: normalizeLiteral(path), pathAnchor: 'base' } : { dynamic: true, limitation: 'ambiguous-base-join:' };
}

/** 전체 URL에서 userinfo·query·fragment를 떼고 소문자 authority와 경로를 얻는다. */
function runStrip({ url }) {
  const match = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/(?:[^@/?#]*@)?([^/?#]*)([^?#]*)([?#].*)?$/u.exec(url);
  const path = match[2] === '' ? '/' : match[2];
  return {
    template: normalizeLiteral(path),
    authority: match[1].toLowerCase(),
    ...(match[3] === undefined ? {} : { queryTailStripped: true }),
  };
}

/**
 * 마스킹: 디코드한 리터럴 세그먼트가 16자 이상이고 ASCII 글자와 숫자를 모두 담으면 `{}`다.
 * 알려진 웹훅 host는 경로 세그먼트 전체(hooks.slack.com) 또는 `/api/webhooks` 뒤
 * (discord.com·discordapp.com)를 마스킹한다.
 */
function runMask({ authority, template }) {
  const segments = template.slice(1).split('/');
  let masked = 0;
  const webhookFrom = authority === 'hooks.slack.com'
    ? 0
    : (authority === 'discord.com' || authority === 'discordapp.com') && segments[0] === 'api' && segments[1] === 'webhooks'
      ? 2
      : Number.POSITIVE_INFINITY;
  const result = segments.map((segment, index) => {
    if (segment === '{}' || segment.includes('{')) return segment;
    const decoded = decodeURIComponent(segment);
    const entropy = decoded.length >= 16 && /[A-Za-z]/u.test(decoded) && /[0-9]/u.test(decoded);
    if (index >= webhookFrom || entropy) {
      masked += 1;
      return '{}';
    }
    return segment;
  });
  return { template: `/${result.join('/')}`, maskedSegments: masked };
}

/** 래퍼 method 인자 바인딩: 레이블 → 위치 순으로 찾고 enum·기본값을 적용한다. */
function runWrapperMethod({ declaration, call }) {
  const binding = declaration.methodArg ?? {};
  const byLabel = binding.label === undefined ? undefined : call.args.find(({ label }) => label === binding.label);
  const positional = binding.index === undefined ? undefined : call.args[binding.index];
  const bound = byLabel ?? (positional !== undefined && (positional.label === undefined || positional.label === binding.label)
    ? positional
    : undefined);
  if (bound === undefined) return declaration.defaultMethod === undefined ? { dynamic: true } : { method: declaration.defaultMethod };
  const verb = bound.value.literal ?? (bound.value.enumCase === undefined ? undefined : declaration.methodEnum?.[bound.value.enumCase]);
  return verb !== undefined && httpMethods.has(verb) ? { method: verb } : { dynamic: true };
}

/** 여러 줄 호출의 보고 줄은 호출식 시작 줄이다. */
function runWrapperLocation({ callStartLine }) {
  return { line: callStartLine };
}

/**
 * 경로 리터럴을 정규 템플릿 표기로 바꾼다. 대문자 hex, unreserved 디코드, 그 밖의 문자는
 * UTF-8 퍼센트 인코딩이다. `withHoles`면 NUL을 `{}`로 되돌린다(조립 중 보간 자리).
 */
function normalizeLiteral(text, withHoles = false) {
  let output = '';
  const bytes = (character) => [...Buffer.from(character, 'utf8')].map((byte) => `%${byte.toString(16).toUpperCase().padStart(2, '0')}`).join('');
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (withHoles && character === '\u0000') {
      output += '{}';
    } else if (character === '%' && /^[0-9A-Fa-f]{2}$/u.test(text.slice(index + 1, index + 3))) {
      const hex = text.slice(index + 1, index + 3).toUpperCase();
      const decoded = String.fromCharCode(Number.parseInt(hex, 16));
      output += /^[A-Za-z0-9\-._~]$/u.test(decoded) ? decoded : `%${hex}`;
      index += 2;
    } else if (/^[A-Za-z0-9\-._~!$&'()*+,;=:@/]$/u.test(character)) {
      output += character;
    } else {
      const codePoint = text.codePointAt(index);
      const full = String.fromCodePoint(codePoint);
      output += bytes(full);
      index += full.length - 1;
    }
  }
  return output;
}

/** 조건이 거짓이면 실패 목록에 남긴다. */
function check(condition, message) {
  if (!condition) failures.push(message);
}
