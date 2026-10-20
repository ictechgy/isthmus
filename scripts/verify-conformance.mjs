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
    'compose.wrapper-suffix': runWrapperSuffix,
    'compose.normalize': runCompose,
    'compose.base-join': runBaseJoin,
    'compose.strip': runStrip,
    'compose.mask': runMask,
    'wrapper.method': runWrapperMethod,
    'wrapper.location': runWrapperLocation,
    'relations.function-from': runSqlRelations,
    'relations.cte': runSqlRelations,
    'relations.distinct-from': runSqlRelations,
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
/** v2 명시 suffix segment의 참조 실행기이며 transport 구현을 추측하지 않는다. */
function runWrapperSuffix({ main, channelPrefix, segments = [], unresolved = false }) {
  const dynamic = () => ({ dynamic: true, ...(main == null ? channelPrefix === undefined ? {} : { channelPrefix } : { channelPrefix: main }) });
  if (main == null || unresolved || segments.length > 64) return dynamic();
  let template = main;
  for (const [index, segment] of segments.entries()) {
    let encoded;
    if ('value' in segment) encoded = '{}';
    else {
      const value = segment.literal;
      if (typeof value !== 'string' || value === '' || value === '.' || value === '..' || !value.isWellFormed()
          || /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/u.test(value)) return dynamic();
      encoded = encodeURIComponent(value).replace(/[!'()*]/gu, (character) => '%' + character.charCodeAt(0).toString(16).toUpperCase());
    }
    template += (index > 0 || !template.endsWith('/') ? '/' : '') + encoded;
  }
  return template.length > 2048 ? dynamic() : { template };
}

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
 * base + path 결합 갈래다(HTTP-WRAPPERS "base 결합"). RFC 3986(`rfc3986` — Retrofit·Ktor, Go `ResolveReference`, Rust
 * `Url::join`), 슬래시 결합, dio 단순 연결, Spring 연결 + `//` 축약(`spring-uri-builder`·`spring-root-uri`·
 * `spring-http-exchange`), Go `url.JoinPath`(`go-join-path`), resty `SetBaseURL`(`resty-base-url`), httpx `base_url`
 * (`httpx-base-url`), aiohttp `base_url`(`aiohttp-base-url`)이다.
 */
function runBaseJoin({ join, base, path, typeUrl }) {
  if (['axios-base-url', 'ky-prefix-url', 'ky-prefix', 'ky-base-url'].includes(join)) return jsClientJoin(join, base, path);
  if (join === 'spring-uri-builder') return springUriBuilder(base, path);
  if (join === 'spring-http-exchange') return springUriBuilder(base, httpExchangeUrl(typeUrl, path));
  if (join === 'spring-root-uri') return springRootUri(base, path);
  if (join === 'rfc3986') return rfc3986Join(base, path);
  if (join === 'go-join-path') return goJoinPath(base, path);
  if (join === 'resty-base-url') return restyBaseUrl(base, path);
  if (join === 'httpx-base-url') return httpxBaseUrl(base, path);
  if (join === 'aiohttp-base-url') return aiohttpBaseUrl(base, path);
  const rooted = path.startsWith('/');
  const relativeTemplate = normalizeLiteral(`/${path.replace(/^\/+/u, '')}`);
  if (join === 'slash-join') return { template: relativeTemplate, pathAnchor: 'base' };
  if (base !== null) return { template: runStrip({ url: `${base}${path}` }).template, pathAnchor: 'root' };
  return rooted ? { template: normalizeLiteral(path), pathAnchor: 'base' } : { dynamic: true, limitation: 'ambiguous-base-join:' };
}

/** JS 라이브러리의 base 결합 참조 구현이다. HTTP URL 파싱 단계의 점 세그먼트 제거도 반영한다. */
function jsClientJoin(join, base, path) {
  const absolute = (text) => /^[A-Za-z][A-Za-z0-9+.-]*:\/\//u.test(text) || text.startsWith('//');
  if (join === 'axios-base-url' && /^https?:(?!\/\/)/iu.test(path)) return { dynamic: true };
  let text = path;
  if (join === 'ky-prefix-url' && base !== '' && path.startsWith('/')) return { dynamic: true };
  if (base === null && !(join === 'axios-base-url' && absolute(path)) && !(join === 'ky-base-url' && path.startsWith('/'))) {
    if (path === '' || /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(path) || /(?:^|\/)\.{1,2}(?:\/|$)|%2e|\\/iu.test(path)) return { dynamic: true };
    return { template: normalizeLiteral(`/${path.replace(/^\/+/, '')}`), pathAnchor: 'base' };
  }
  if (join === 'axios-base-url' && base && !absolute(path)) text = path === '' ? base : `${base.replace(/\/+$/u, '')}/${path.replace(/^\/+/, '')}`;
  if (join === 'ky-prefix-url' && base) text = `${base}${base.endsWith('/') ? '' : '/'}${path}`;
  if (join === 'ky-prefix' && base) text = `${base.replace(/\/+$/u, '')}/${path.replace(/^\/+/, '')}`;
  const placeholder = 'https://unknown.invalid';
  const parsed = new URL(text.startsWith('//') ? `https:${text}` : text, join === 'ky-base-url' && base ? base : placeholder);
  if (!['http:', 'https:'].includes(parsed.protocol)) return { dynamic: true };
  return { template: normalizeLiteral(parsed.pathname), pathAnchor: 'root',
    ...(parsed.host === 'unknown.invalid' ? {} : { authority: parsed.host.toLowerCase() }) };
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

/** base를 알 수 없어 결합 결과를 주장하지 않는 결과다(검증기 본문이 먼저 실행되므로 상수 대신 함수로 둔다). */
function ambiguousJoin() {
  return { dynamic: true, limitation: 'ambiguous-base-join:' };
}

/** 경로에 `..` 세그먼트가 있는지다. base를 모르면 어느 세그먼트를 지우는지 알 수 없다. */
function hasDotDot(path) {
  return path.split('/').includes('..');
}

/**
 * RFC 3986 5.2.2(참조 해석)·5.2.3(merge)·5.2.4(점 세그먼트 제거)를 경로에만 적용한다. `//`로 시작하는 참조는 authority를
 * 바꾸는 network-path 참조라 그 authority와 경로(없으면 `/`)를 쓴다. base를 모르면 `/`로 시작하는 참조만 root이고, 상대
 * 참조는 알 수 없는 base 디렉터리 뒤라 base 앵커다(`..`가 있으면 지울 세그먼트를 몰라 dynamic).
 */
function rfc3986Join(base, path) {
  if (path.startsWith('//')) {
    const parsed = parseBase(`http:${path}`);
    return { template: normalizeLiteral(removeDotSegments(parsed.path) || '/'), pathAnchor: 'root', authority: parsed.authority };
  }
  if (path.startsWith('/')) {
    return { template: normalizeLiteral(removeDotSegments(path)), pathAnchor: 'root',
      ...(base === null ? {} : { authority: parseBase(base).authority }) };
  }
  if (base === null) {
    if (path === '' || hasDotDot(path)) return ambiguousJoin();
    return { template: normalizeLiteral(removeDotSegments(`/${path}`)), pathAnchor: 'base' };
  }
  const parsed = parseBase(base);
  const merged = path === '' ? parsed.path
    : parsed.path === '' ? `/${path}` : `${parsed.path.slice(0, parsed.path.lastIndexOf('/') + 1)}${path}`;
  return { template: normalizeLiteral(removeDotSegments(merged) || '/'), pathAnchor: 'root', authority: parsed.authority };
}

/** RFC 3986 5.2.4 `remove_dot_segments`다. */
function removeDotSegments(input) {
  let rest = input;
  let output = '';
  while (rest.length > 0) {
    if (rest.startsWith('../')) rest = rest.slice(3);
    else if (rest.startsWith('./')) rest = rest.slice(2);
    else if (rest.startsWith('/./')) rest = rest.slice(2);
    else if (rest === '/.') rest = '/';
    else if (rest.startsWith('/../') || rest === '/..') {
      rest = rest === '/..' ? '/' : rest.slice(3);
      output = output.slice(0, Math.max(0, output.lastIndexOf('/')));
    } else if (rest === '.' || rest === '..') rest = '';
    else {
      const next = rest.indexOf('/', rest.startsWith('/') ? 1 : 0);
      const segment = next < 0 ? rest : rest.slice(0, next);
      output += segment;
      rest = next < 0 ? '' : rest.slice(next);
    }
  }
  return output;
}

/**
 * Go `(*url.URL).JoinPath`(Go 1.19+)다. base 경로와 원소를 `path.Join`으로 잇는다 — `/`를 넣고, `//`를 줄이고, `.`·`..`를
 * 지운다(`..`는 base 경로 밖으로도 나간다). 원소의 앞 `/`는 무시되고, 마지막 원소가 `/`로 끝나면 끝 슬래시 하나를 남긴다.
 */
function goJoinPath(base, path) {
  const trailing = path.endsWith('/');
  if (base === null) {
    if (hasDotDot(path)) return ambiguousJoin();
    return { template: normalizeLiteral(withTrailing(goCleanPath(`/${path}`), trailing)), pathAnchor: 'base' };
  }
  const parsed = parseBase(base);
  const joined = goCleanPath(`${parsed.path.startsWith('/') ? '' : '/'}${parsed.path}/${path}`);
  return { template: normalizeLiteral(withTrailing(joined, trailing)), pathAnchor: 'root', authority: parsed.authority };
}

/** Go `path.Clean`을 `/`로 시작하는 경로에 적용한다. */
function goCleanPath(path) {
  const segments = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') segments.pop();
    else segments.push(segment);
  }
  return `/${segments.join('/')}`;
}

/** 끝 슬래시를 하나 붙인다(이미 있으면 그대로). */
function withTrailing(path, trailing) {
  return trailing && !path.endsWith('/') ? `${path}/` : path;
}

/**
 * go-resty `SetBaseURL`(v2)·v3 결합이다. base의 끝 `/`를 모두 떼고, 경로가 `/`로 시작하지 않으면 `/`를 붙여 문자열로 잇는다.
 * `//`·점 세그먼트는 그대로 남는다. base를 모르면 그 결과 경로가 알 수 없는 base 뒤의 꼬리다.
 */
function restyBaseUrl(base, path) {
  const tail = path.startsWith('/') ? path : `/${path}`;
  if (base === null) return { template: normalizeLiteral(tail), pathAnchor: 'base' };
  const parsed = parseBase(base);
  return { template: normalizeLiteral(`${parsed.path.replace(/\/+$/u, '')}${tail}`), pathAnchor: 'root', authority: parsed.authority };
}

/**
 * httpx `Client(base_url=)` 결합이다. base 경로가 `/`로 끝나게 하고(`_enforce_trailing_slash`), 상대 URL 경로의 앞 `/`를 모두
 * 떼어 잇고(`_merge_url`), 점 세그먼트를 지운다(`normalize_path`). `//`로 시작하는 경로는 host로 파싱되어 경로가 사라지므로
 * 주장하지 않는다. base를 모르면 `..`가 없을 때만 base 앵커 꼬리다.
 */
function httpxBaseUrl(base, path) {
  if (path.startsWith('//')) return ambiguousJoin();
  const relative = path.replace(/^\/+/u, '');
  if (base === null) {
    if (relative === '' || hasDotDot(relative)) return ambiguousJoin();
    return { template: normalizeLiteral(removeDotSegments(`/${relative}`)), pathAnchor: 'base' };
  }
  const parsed = parseBase(base);
  const directory = parsed.path.endsWith('/') ? parsed.path : `${parsed.path}/`;
  return { template: normalizeLiteral(removeDotSegments(`${directory}${relative}`) || '/'), pathAnchor: 'root',
    authority: parsed.authority };
}

/**
 * aiohttp `ClientSession(base_url=)`(3.11+) 결합이다. yarl `URL.join`이라 RFC 3986과 같다. 경로가 있는 base가 `/`로 끝나지
 * 않으면 세션 생성이 실패하고(`ValueError`), `//`로 시작하는 경로는 절대 URL로 읽혀 base를 쓰지 않으므로 둘 다 주장하지 않는다.
 */
function aiohttpBaseUrl(base, path) {
  if (path.startsWith('//')) return ambiguousJoin();
  if (base !== null) {
    const { path: basePath } = parseBase(base);
    if (basePath !== '' && basePath !== '/' && !basePath.endsWith('/')) return ambiguousJoin();
  }
  return rfc3986Join(base, path);
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
 * SQL 텍스트에서 relation-use로 낼 관계 이름 집합의 참조 구현이다(GRAPH-EXCHANGE "SQL 텍스트의 관계 이름" R1~R3).
 * 생산자 스캐너를 옮긴 것이 아니라 세 규칙을 확인하는 데 필요한 만큼만 읽는다.
 *
 * 1) 어휘: 인용하지 않은 이름, 인용 식별자(`"…"`·`` `…` ``·`[…]`), 기호 `. , ( ) ;`만 토큰이다. 주석과 문자열은
 *    건너뛰고, 숫자·연산자는 생산자 스캐너처럼 토큰을 만들지 않는다. `;`로 문장을 나눈다.
 * 2) `FROM`·`JOIN`·`INTO` 뒤의 (한정) 이름과 별칭 뒤 쉼표로 이어지는 이름을 관계로 읽는다. 이름 대신 `(`가 오면
 *    하위 질의라 아무것도 내지 않고, 그 안은 바깥 순회가 계속 읽는다.
 * 3) R1은 괄호 스택, R2는 문장의 CTE 이름 집합, R3는 `FROM` 앞 토큰으로 판정한다.
 * GRANT/REVOKE, 다른 관계 키워드(UPDATE·TRUNCATE 등), 절 키워드 거르기, 테이블 값 함수, 자리표시자, 이름 escape,
 * 컬럼 참조는 각 생산자의 기존 규칙이라 다루지 않는다. 비교기는 배열을 정렬해 비교하지만 중복은 다르게 보므로
 * 중복 없는 집합을 돌려준다.
 */
function runSqlRelations({ sql }) {
  const relations = new Set();
  for (const statement of sqlStatements(lexSql(sql))) {
    for (const name of statementRelations(statement)) relations.add(name);
  }
  return { relations: [...relations] };
}

/**
 * SQL 텍스트를 `{ text, quoted }` 토큰으로 나눈다. 인용 식별자는 내용만 담고, 문자열의 `''`는 escape다.
 * 닫히지 않은 인용·주석·문자열은 텍스트 끝까지다.
 */
function lexSql(text) {
  const tokens = [];
  const namePattern = /[\p{L}_][\p{L}\p{N}_$]*/uy;
  let index = 0;
  while (index < text.length) {
    const character = text[index];
    namePattern.lastIndex = index;
    const name = namePattern.exec(text)?.[0];
    if (name !== undefined) {
      tokens.push({ text: name, quoted: false });
      index += name.length;
    } else if (character === '"' || character === '`' || character === '[') {
      const end = indexOrEnd(text, character === '[' ? ']' : character, index + 1);
      tokens.push({ text: text.slice(index + 1, end), quoted: true });
      index = end + 1;
    } else if (text.startsWith('--', index)) {
      index = indexOrEnd(text, '\n', index);
    } else if (text.startsWith('/*', index)) {
      index = indexOrEnd(text, '*/', index + 2) + 2;
    } else if (character === "'") {
      index = stringLiteralEnd(text, index + 1);
    } else {
      if ('.,();'.includes(character)) tokens.push({ text: character, quoted: false });
      index += 1;
    }
  }
  return tokens;
}

/** `from`부터 찾은 `needle`의 위치다. 없으면 텍스트 끝이다. */
function indexOrEnd(text, needle, from) {
  const found = text.indexOf(needle, from);
  return found < 0 ? text.length : found;
}

/** 문자열 리터럴 본문 시작 `from`에서 닫는 따옴표 다음 위치를 찾는다. `''`는 따옴표 하나다. */
function stringLiteralEnd(text, from) {
  let index = from;
  for (;;) {
    const quote = indexOrEnd(text, "'", index);
    if (text[quote + 1] !== "'") return Math.min(quote + 1, text.length);
    index = quote + 2;
  }
}

/** 토큰을 `;` 문장 단위로 나눈다. R2의 CTE 이름은 문장 안에서만 유효하다. */
function sqlStatements(tokens) {
  const statements = [[]];
  for (const token of tokens) {
    if (isSqlSymbol(token, ';')) statements.push([]);
    else statements.at(-1).push(token);
  }
  return statements;
}

/**
 * 한 문장의 관계 이름이다. CTE 이름(R2)은 문장 전체에서 먼저 모으고, 괄호마다 함수 인자 그룹인지(R1)를 쌓아
 * 가장 안쪽 그룹으로 `FROM`을 판정한다.
 */
function statementRelations(statement) {
  const cteNames = statementCteNames(statement);
  const functionGroups = [];
  const relations = [];
  for (const [index, token] of statement.entries()) {
    if (isSqlSymbol(token, '(')) functionGroups.push(isFunctionArgumentGroup(statement, index));
    else if (isSqlSymbol(token, ')')) functionGroups.pop();
    else if (isRelationKeyword(token) && !isSuppressedFrom(statement, index, functionGroups.at(-1) === true)) {
      relations.push(...relationOperands(statement, index + 1, cteNames));
    }
  }
  return relations;
}

/** 뒤에 관계 이름이 오는 키워드(`FROM`·`JOIN`·`INTO`)인지 본다. */
function isRelationKeyword(token) {
  return ['from', 'join', 'into'].some((word) => isSqlWord(token, word));
}

/** 관계를 내지 않는 `FROM`인지 본다: 함수 인자 그룹 안(R1)이거나 `IS [NOT] DISTINCT FROM`(R3)이다. */
function isSuppressedFrom(statement, index, insideFunctionArguments) {
  return isSqlWord(statement[index], 'from') && (insideFunctionArguments || isDistinctFromOperator(statement, index));
}

/**
 * R1: `(` 바로 앞 토큰이 식별자(함수 이름)이고 그룹의 첫 토큰이 SELECT·WITH·VALUES가 아니면 함수 인자 그룹이다.
 * 하위 질의 그룹(`(SELECT …)`, `IN (SELECT …)`)은 첫 토큰으로 가려져 그 안의 `FROM`은 관계를 낸다.
 */
function isFunctionArgumentGroup(statement, openIndex) {
  const subquery = ['select', 'with', 'values'].some((word) => isSqlWord(statement[openIndex + 1], word));
  return isSqlName(statement[openIndex - 1]) && !subquery;
}

/** R3: `FROM` 바로 앞이 인용하지 않은 `distinct`이고 그 앞이 `is` 또는 `is not`이면 비교 연산자의 일부다. */
function isDistinctFromOperator(statement, fromIndex) {
  if (!isSqlWord(statement[fromIndex - 1], 'distinct')) return false;
  const before = statement[fromIndex - 2];
  return isSqlWord(before, 'is') || (isSqlWord(before, 'not') && isSqlWord(statement[fromIndex - 3], 'is'));
}

/**
 * R2: 문장의 CTE 이름 비교 키 집합이다. `WITH [RECURSIVE] name …`와 `, name …` 뒤가
 * `[(cols)] AS [NOT] [MATERIALIZED] (`인 name을 모은다.
 */
function statementCteNames(statement) {
  const names = new Set();
  for (const [index, token] of statement.entries()) {
    const withClause = isSqlWord(token, 'with');
    if (!withClause && !isSqlSymbol(token, ',')) continue;
    const nameIndex = withClause && isSqlWord(statement[index + 1], 'recursive') ? index + 2 : index + 1;
    if (isCteDefinition(statement, nameIndex)) names.add(cteKey(statement[nameIndex]));
  }
  return names;
}

/** `nameIndex`에서 `name [(cols)] AS [NOT] [MATERIALIZED] (`가 시작하는지 본다. */
function isCteDefinition(statement, nameIndex) {
  if (!isSqlName(statement[nameIndex])) return false;
  let cursor = nameIndex + 1;
  if (isSqlSymbol(statement[cursor], '(')) cursor = closingParenIndex(statement, cursor) + 1;
  if (!isSqlWord(statement[cursor], 'as')) return false;
  cursor += 1;
  if (isSqlWord(statement[cursor], 'not')) cursor += 1;
  if (isSqlWord(statement[cursor], 'materialized')) cursor += 1;
  return isSqlSymbol(statement[cursor], '(');
}

/** `openIndex`의 여는 괄호와 짝인 닫는 괄호 위치다. 닫히지 않으면 문장 끝이다. */
function closingParenIndex(statement, openIndex) {
  let depth = 0;
  for (let index = openIndex; index < statement.length; index++) {
    if (isSqlSymbol(statement[index], '(')) depth += 1;
    else if (isSqlSymbol(statement[index], ')') && --depth === 0) return index;
  }
  return statement.length;
}

/**
 * CTE 이름과 한정자 없는 피연산자의 비교 키다. 인용하지 않은 이름만 소문자로 접고 인용한 이름은 그대로 둔다.
 * 계약이 정하지 않은 부분이라 SQL 표준·Postgres의 식별자 규칙을 골랐다(공유 사례는 같은 표기만 쓴다).
 */
function cteKey(token) {
  return token.quoted ? token.text : token.text.toLowerCase();
}

/**
 * 관계 키워드 뒤의 이름을 읽는다. (한정) 이름 하나를 읽고, 별칭 뒤에 쉼표가 오면 다음 이름을 잇는다.
 * 이름이 아닌 토큰(`(` 등)에서 멈춘다. 한정자 없는 이름이 같은 문장의 CTE 이름이면 내지 않는다(R2).
 */
function relationOperands(statement, start, cteNames) {
  const names = [];
  let cursor = start;
  while (isSqlName(statement[cursor])) {
    const parts = [statement[cursor]];
    cursor += 1;
    while (isSqlSymbol(statement[cursor], '.') && isSqlName(statement[cursor + 1])) {
      parts.push(statement[cursor + 1]);
      cursor += 2;
    }
    if (parts.length > 1 || !cteNames.has(cteKey(parts[0]))) names.push(parts.map(({ text }) => text).join('.'));
    cursor = skipSqlAlias(statement, cursor);
    if (!isSqlSymbol(statement[cursor], ',')) break;
    cursor += 1;
  }
  return names;
}

/**
 * 관계 이름 뒤의 별칭을 건너뛴다. 별칭은 내지 않으므로 쉼표 목록을 잇는 데 필요한 꼴(`AS 이름`, 쉼표 바로 앞의
 * 이름 하나)만 본다 — 절 키워드를 별칭으로 잘못 넘겨도 뒤에 쉼표가 없으면 목록을 잇지 않는다.
 */
function skipSqlAlias(statement, cursor) {
  if (isSqlWord(statement[cursor], 'as') && isSqlName(statement[cursor + 1])) return cursor + 2;
  if (isSqlName(statement[cursor]) && isSqlSymbol(statement[cursor + 1], ',')) return cursor + 1;
  return cursor;
}

/** 인용하지 않은 키워드 토큰인지 본다(대소문자 무시). 인용 식별자는 키워드가 아니다. */
function isSqlWord(token, word) {
  return token !== undefined && !token.quoted && token.text.toLowerCase() === word;
}

/** 기호 토큰인지 본다. */
function isSqlSymbol(token, symbol) {
  return token !== undefined && !token.quoted && token.text === symbol;
}

/** 이름 토큰(인용하지 않은 이름, 또는 비어 있지 않은 인용 식별자)인지 본다. */
function isSqlName(token) {
  return token !== undefined && (token.quoted ? token.text !== '' : /^[\p{L}_]/u.test(token.text));
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
