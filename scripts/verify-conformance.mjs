import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// 제품 매처와 문법 검증기를 그대로 쓴다. 벡터가 제품 동작과 어긋나면 여기서 실패한다.
import { parseRouteTemplate } from '../src/exchange/route-template.ts';
import { BridgeFactsValidationError, parseBridgeFactsDocument } from '../src/exchange/parse.ts';
import { RouteIndex } from '../src/join/route-index.ts';
import { dynamicDeclarationRange, RouteLimitationScopeIndex } from '../src/join/route-limitation-scope.ts';
import { findRouteShadows } from '../src/join/route-shadow.ts';

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
    'framework.spring.path-pattern': runSpringPathPattern,
    'scope.applies': runScopeApplies,
    'scope.validate': runScopeValidate,
    'scope.dynamic-validate': runDynamicScopeValidate,
    'scope.dynamic-applies': runDynamicScopeApplies,
    'dispatch.validate': runDispatchValidate,
    'dispatch.match': runDispatchMatch,
    'dispatch.shadow': runDispatchShadow,
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
  for (const template of [actual.template, actual.channelPrefix, ...(actual.templates ?? [])]) {
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

/**
 * Spring MVC PathPattern 매핑을 route-decl 템플릿 목록으로 바꾸는 참조 구현이다(Spring Framework 6.x, 벡터의
 * source가 확인한 동작만 옮겼다).
 *
 * 1) 클래스·메서드 매핑 결합: 둘 다 비면 루트, 한쪽이 비면 다른 쪽, 아니면 경계 슬래시 하나로 잇는다.
 * 2) 끝 `**`·`{*x}`는 `{**}`와 catch-all 접두사 decl, 중간 `**`는 dynamic + `route-coverage:`.
 * 3) 세그먼트 전체 변수·중간 `*`는 `{}`. 끝 `*`와 부분 세그먼트의 변수·`*`는 빈 값도 받으므로 빈 값 변형을 함께
 *    펼치고, 16개를 넘으면 dynamic + `route-template-expansion-capped:`다. 한 세그먼트의 변수 둘 이상은 dynamic이다.
 * 4) 끝 슬래시는 `matchOptionalTrailingSeparator`를 켠 경우만 optional, 기본은 strict다.
 */
function runSpringPathPattern({ classMapping, mapping, matchOptionalTrailingSeparator }) {
  const rooted = (value) => (value !== '' && !value.startsWith('/') ? `/${value}` : value);
  const left = classMapping === undefined ? '' : rooted(classMapping);
  const right = rooted(mapping);
  let pattern;
  if (left === '' && right === '') pattern = '/';
  else if (right === '') pattern = left;
  else if (left === '') pattern = right;
  else pattern = left.endsWith('/') && right.startsWith('/') ? left + right.slice(1) : left + right;
  const trailingSlash = matchOptionalTrailingSeparator === true ? 'optional' : 'strict';
  const segments = pattern.slice(1).split('/');
  const last = segments.at(-1);
  const catchAll = last === '**' || /^\{\*[A-Za-z_$][\w$]*\}$/u.test(last);
  if (segments.slice(0, -1).some((segment) => segment.includes('**'))) return { dynamic: true, limitation: 'route-coverage:' };
  const body = catchAll ? segments.slice(0, -1) : segments;
  let variants = [[]];
  for (const [index, segment] of body.entries()) {
    const options = springSegment(segment, !catchAll && index === body.length - 1);
    if (options === undefined) return { dynamic: true, limitation: 'route-coverage:' };
    variants = variants.flatMap((prefix) => options.map((option) => [...prefix, option]));
    if (variants.length > 16) return { dynamic: true, limitation: 'route-template-expansion-capped:' };
  }
  const templates = [];
  const catchAllPrefixTemplates = [];
  for (const variant of variants) {
    const base = `/${variant.join('/')}`;
    if (!catchAll) {
      templates.push(base);
      continue;
    }
    const prefix = variant.length === 0 ? '/' : base;
    templates.push(variant.length === 0 ? '/{**}' : `${base}/{**}`, prefix);
    catchAllPrefixTemplates.push(prefix);
  }
  return { templates, ...(catchAll ? { catchAllPrefixTemplates } : {}), trailingSlash };
}

/**
 * Spring 세그먼트 하나의 정규 표기 후보다. 빈 값을 받는 자리면 빈 값 변형을 함께 돌려준다.
 * 변수가 둘 이상이면 undefined(dynamic)다.
 */
function springSegment(segment, isLast) {
  const tokens = segment.match(/\{[^{}]*\}|\*/gu) ?? [];
  if (tokens.length === 0) return [normalizeLiteral(segment)];
  if (tokens.length > 1) return undefined;
  const [token] = tokens;
  if (segment === token) {
    // 세그먼트 전체 `{x}`는 빈 값을 받지 않는다. `*`는 끝에서만 빈 값을 받는다.
    return token === '*' && isLast ? ['{}', ''] : ['{}'];
  }
  const at = segment.indexOf(token);
  const prefix = normalizeLiteral(segment.slice(0, at));
  const suffix = normalizeLiteral(segment.slice(at + token.length));
  return [`${prefix}{}${suffix}`, `${prefix}${suffix}`];
}

/** limitation 스코프 적용: isthmus 조인 층의 스코프 색인으로 호출·선언 하나에 한계가 적용되는지 본다. */
function runScopeApplies({ scope, probe }) {
  let document;
  try {
    document = parseBridgeFactsDocument(scopeDocument(scope));
  } catch (error) {
    // 잘못된 스코프를 적은 적용 케이스는 검증기를 멈추지 않고 기대값 불일치로 보고한다.
    if (error instanceof BridgeFactsValidationError) return { applies: 'invalid-scope' };
    throw error;
  }
  const parsed = parseRouteTemplate(probe.template);
  const index = new RouteLimitationScopeIndex([document], { remaining: 1_000_000 });
  const applicable = index.applicable({
    segments: parsed.ok ? parsed.segments : [],
    anchor: probe.pathAnchor ?? 'root',
    ...(probe.method === undefined ? {} : { method: probe.method }),
    side: probe.side ?? 'call',
  });
  return { applies: applicable.length > 0 };
}

/** limitation 스코프 검증: isthmus 파서가 스코프 항목을 받는지 본다. */
function runScopeValidate({ scope }) {
  try {
    parseBridgeFactsDocument(scopeDocument(scope));
    return { valid: true };
  } catch (error) {
    // 계약 위반만 "거부"로 읽는다. 그 밖의 예외는 검증기 결함이라 그대로 던진다.
    if (error instanceof BridgeFactsValidationError) return { valid: false };
    throw error;
  }
}

/**
 * dynamic 선언 검증: 선언 조각 하나를 kind에 맞는 합성 http 문서(decl은 서버, contract는 openapi, call은 클라이언트)로
 * 감싸 제품 파서가 받는지 본다.
 */
function runDynamicScopeValidate({ declaration }) {
  try {
    parseBridgeFactsDocument(dynamicDocument(declaration));
    return { valid: true };
  } catch (error) {
    if (error instanceof BridgeFactsValidationError) return { valid: false };
    throw error;
  }
}

/**
 * dynamic 선언 적용: dynamic route-decl 하나를 제품 파서로 검증하고, 조인 층과 같은 상한(`dynamicDeclarationRange`)과
 * 스코프 색인으로 호출 하나에 그 선언의 공백이 적용되는지 본다.
 */
function runDynamicScopeApplies({ declaration, probe }) {
  const document = parseBridgeFactsDocument(dynamicDocument({ kind: 'route-decl', pathAnchor: 'root', dynamic: true, ...declaration }));
  const range = dynamicDeclarationRange(document.facts[0]);
  const parsed = parseRouteTemplate(probe.template);
  const index = new RouteLimitationScopeIndex([{ message: 'unjoined-dynamic-routes', ...(range === undefined ? {} : { range }) }],
    { remaining: 1_000_000 });
  const applicable = index.applicable({
    segments: parsed.ok ? parsed.segments : [],
    anchor: probe.pathAnchor ?? 'root',
    ...(probe.method === undefined ? {} : { method: probe.method }),
    side: 'call',
  });
  return { applies: applicable.length > 0 };
}

/** 선언 조각 하나를 담은 합성 http 문서다. dynamic 선언의 channel은 적지 않으면 null이다. */
function dynamicDocument({ kind, channel, ...fact }) {
  const contract = kind === 'route-contract';
  const client = kind === 'route-call';
  return {
    format: 'bridge-facts', version: 1, tool: { name: 'conformance', version: '0' },
    generatedAt: '2026-09-30T00:00:00Z', platform: contract ? 'openapi' : 'kotlin', target: 'http', project: '/conformance',
    roles: [client ? 'client' : 'server'], ...(contract || client ? {} : { dispatch: 'specificity' }), limitations: [],
    facts: [{
      kind, channel: channel ?? null, ...fact,
      location: { path: contract ? 'openapi.yaml' : 'src/Routes.kt', line: 1, column: 1 },
      symbol: contract ? { qualifiedName: 'operation' } : { qualifiedName: 'handler', usr: 'conformance:handler' },
    }],
  };
}

/** 스코프 하나를 한계 하나에 붙인 합성 http 서버 문서다. */
function scopeDocument(scope) {
  return {
    format: 'bridge-facts', version: 1, tool: { name: 'conformance', version: '0' },
    generatedAt: '2026-09-29T00:00:00Z', platform: 'kotlin', target: 'http', project: '/conformance',
    roles: ['server'], dispatch: 'specificity', facts: [], limitations: ['framework-provided-routes: conformance'],
    limitationScopes: [{ limitationIndex: 0, ...scope }],
  };
}

/**
 * registration-order 검증: 사실 조각을 합성 python 서버 문서로 감싸 제품 파서로 판정한다. 위치를 적지 않은 사실은
 * 순번마다 다른 줄에 둔다(한 index는 한 등록이라 같은 index를 공유하는 케이스는 위치를 적는다).
 */
function runDispatchValidate({ document }) {
  const facts = document.facts.map(({ location, ...fact }, index) => ({
    kind: 'route-decl', dynamic: false, pathAnchor: 'root',
    location: { path: 'shop/urls.py', line: location?.line ?? index + 1, column: location?.column ?? 1 },
    ...fact,
  }));
  try {
    parseBridgeFactsDocument({
      format: 'bridge-facts', version: 1, tool: { name: 'conformance', version: '0' },
      generatedAt: '2026-09-29T00:00:00Z', platform: 'python', target: 'http', project: '/conformance',
      roles: ['server'], dispatch: document.dispatch, facts, limitations: [],
    });
    return { valid: true };
  } catch (error) {
    if (error instanceof BridgeFactsValidationError) return { valid: false };
    throw error;
  }
}

/**
 * 벡터의 decl 목록을 조인 층과 같은 매칭용 선언으로 바꾼다. `dispatch: "specificity"`가 아니면 registration-order
 * decl이고, group 키는 조인 층처럼 문서 순번(`document`, 기본 0)까지 구분한다. 경로·method가 모두 가려진 decl은
 * 조인 층과 같이 `unreachable`을 단다.
 */
function dispatchDeclarations(decls) {
  const declarations = decls.map((decl, id) => {
    const parsed = parseRouteTemplate(decl.template);
    const registration = decl.dispatch === 'specificity' ? undefined
      : decl.order === undefined ? {} : { group: JSON.stringify([decl.document ?? 0, decl.order.group]), index: decl.order.index };
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
      ...(registration === undefined ? {} : { registration }),
      ...(decl.narrowed === true ? { narrowed: true } : {}),
    };
  });
  const shadows = findRouteShadows(declarations.map((declaration, id) => ({
    declaration, narrowed: decls[id].narrowed === true, testSource: false,
  })), { remaining: 1_000_000 });
  return { declarations, shadows };
}

/** registration-order 매칭: 조인 층과 같은 선언으로 제품 매처를 실행한다. */
function runDispatchMatch({ decls, call }) {
  const { declarations, shadows } = dispatchDeclarations(decls);
  const indexed = declarations.map((declaration) =>
    (shadows.get(declaration.id)?.kind === 'full' ? { ...declaration, unreachable: true } : declaration));
  const parsed = parseRouteTemplate(call.template);
  const outcome = new RouteIndex(indexed, { remaining: 1_000_000 }).match({
    segments: parsed.ok ? parsed.segments : [],
    anchor: call.pathAnchor,
    ...(call.method === undefined ? {} : { method: call.method }),
  });
  return {
    ...outcome,
    ...(outcome.targets === undefined ? {} : { targets: outcome.targets.map(({ method, template }) => `${method} ${template}`) }),
  };
}

/** 가림 판정: 가려진 decl을 `METHOD template @index`로 종류별로 돌려준다. */
function runDispatchShadow({ decls }) {
  const { declarations, shadows } = dispatchDeclarations(decls);
  const label = (id) => `${declarations[id].method} ${declarations[id].template} @${decls[id].order?.index}`;
  const of = (kind) => [...shadows].filter(([, shadow]) => shadow.kind === kind).map(([id]) => label(id));
  return { shadowed: of('full'), pathShadowed: of('path') };
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

/**
 * base + path 결합의 다섯 갈래(RFC 3986, 슬래시 결합, dio 단순 연결, Spring 연결 + `//` 축약)다. Spring은
 * `DefaultUriBuilderFactory`(`spring-uri-builder`), Boot `RestTemplateBuilder.rootUri`(`spring-root-uri`), `@HttpExchange`
 * 타입·메서드 url 결합 뒤 `DefaultUriBuilderFactory`(`spring-http-exchange`)다.
 */
function runBaseJoin({ join, base, path, typeUrl }) {
  if (join === 'spring-uri-builder') return springUriBuilder(base, path);
  if (join === 'spring-http-exchange') return springUriBuilder(base, httpExchangeUrl(typeUrl, path));
  if (join === 'spring-root-uri') return springRootUri(base, path);
  const rooted = path.startsWith('/');
  const relativeTemplate = normalizeLiteral(`/${path.replace(/^\/+/u, '')}`);
  if (join === 'rfc3986') return rooted ? { template: normalizeLiteral(path), pathAnchor: 'root' } : { template: relativeTemplate, pathAnchor: 'base' };
  if (join === 'slash-join') return { template: relativeTemplate, pathAnchor: 'base' };
  if (base !== null) return { template: runStrip({ url: `${base}${path}` }).template, pathAnchor: 'root' };
  return rooted ? { template: normalizeLiteral(path), pathAnchor: 'base' } : { dynamic: true, limitation: 'ambiguous-base-join:' };
}

/**
 * Spring `DefaultUriBuilderFactory` 결합이다. base 경로에 템플릿 경로를 슬래시 없이 잇고(`FullPathComponentBuilder.append`),
 * 경로 전체의 `//`를 `/`로 줄인다(`getSanitizedPath`). 점 세그먼트는 지우지 않는다. 경로가 `/`로 시작하지 않으면 URI 문자열이
 * host 뒤에 `/`를 넣는다. base를 모르면 `/`로 시작할 때만 base 앵커, 아니면 dynamic이다.
 */
function springUriBuilder(base, path) {
  if (base === null) {
    return path.startsWith('/') ? { template: normalizeLiteral(collapseSlashes(path)), pathAnchor: 'base' }
      : { dynamic: true, limitation: 'ambiguous-base-join:' };
  }
  const parsed = parseBase(base);
  const joined = collapseSlashes(`${parsed.path}${path}`);
  return { template: normalizeLiteral(joined.startsWith('/') ? joined : `/${joined}`), pathAnchor: 'root', authority: parsed.authority };
}

/** Spring Boot `RootUriTemplateHandler.apply`: `/`로 시작하는 템플릿에만 root를 앞에 붙이고, 결과를 base 없이 파싱한다. */
function springRootUri(base, path) {
  if (!path.startsWith('/')) return { dynamic: true };
  if (base === null) return { template: normalizeLiteral(collapseSlashes(path)), pathAnchor: 'base' };
  const parsed = parseBase(`${base}${path}`);
  return { template: normalizeLiteral(collapseSlashes(parsed.path)), pathAnchor: 'root', authority: parsed.authority };
}

/** `HttpServiceMethod.initUrl`: 둘 다 있으면 경계 슬래시가 모두 없을 때만 `/`를 넣어 잇고, 하나만 있으면 그것이다. */
function httpExchangeUrl(typeUrl, methodUrl) {
  if (!typeUrl) return methodUrl;
  if (!methodUrl) return typeUrl;
  return `${typeUrl}${!typeUrl.endsWith('/') && !methodUrl.startsWith('/') ? '/' : ''}${methodUrl}`;
}

/** 경로의 연속 슬래시를 하나로 줄인다(Spring `getSanitizedPath`). */
function collapseSlashes(path) {
  return path.replace(/\/{2,}/gu, '/');
}

/** 절대 URL base의 소문자 authority와 경로(없으면 빈 문자열)다. */
function parseBase(url) {
  const match = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/(?:[^@/?#]*@)?([^/?#]*)([^?#]*)/u.exec(url);
  return { authority: match[1].toLowerCase(), path: match[2] };
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
