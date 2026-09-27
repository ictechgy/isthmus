import assert from 'node:assert/strict';
import test from 'node:test';

import { isBridgeDomainDocument, parseBridgeFactsDocument } from './parse.ts';

/** http 문서 골격이다. 합성 경로만 쓴다. */
function httpDocument(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    format: 'bridge-facts',
    version: 1,
    tool: { name: 'synthetic', version: '0.0.0' },
    generatedAt: '2026-09-27T00:00:00Z',
    platform: 'kotlin',
    target: 'http',
    project: '/work/example',
    roles: ['client'],
    facts: [],
    limitations: [],
    ...overrides,
  };
}

/** 정적 route 사실이다. */
function route(kind: string, method: string | undefined, channel: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind,
    channel,
    ...(method === undefined ? {} : { method }),
    dynamic: false,
    pathAnchor: 'root',
    location: { path: 'src/Api.kt', line: 3, column: 5 },
    ...extra,
  };
}

const serverDocument = (facts: unknown[], extra: Record<string, unknown> = {}): Record<string, unknown> =>
  httpDocument({ platform: 'js', roles: ['server'], dispatch: 'specificity', facts, ...extra });

test('사실 0건 http 문서는 roles가 있으면 target http를 유지하고 bridge 문서가 아니다', () => {
  const parsed = parseBridgeFactsDocument(httpDocument());
  assert.equal(parsed.target, 'http');
  assert.deepEqual(parsed.roles, ['client']);
  assert.equal(isBridgeDomainDocument(parsed), false);
  assert.throws(() => parseBridgeFactsDocument(httpDocument({ roles: undefined })), /require roles/);
  for (const roles of [[], ['client', 'server'], ['contract'], 'client', ['server', 'server']]) {
    assert.throws(() => parseBridgeFactsDocument(httpDocument({ roles })), /require roles/);
  }
});

test('http 문서 필드는 다른 target 문서에서 거부한다', () => {
  for (const field of ['roles', 'dispatch', 'sourceSets', 'service']) {
    assert.throws(
      () => parseBridgeFactsDocument(httpDocument({ target: null, roles: undefined, [field]: 'x' })),
      new RegExp(`Document field "${field}" requires the http target`),
    );
  }
});

test('역할은 kind로 정하고 (kind, platform) 조합표만 허용한다', () => {
  const call = route('route-call', 'GET', '/api/v1/items');
  for (const platform of ['kotlin', 'swift', 'dart', 'js']) {
    assert.equal(parseBridgeFactsDocument(httpDocument({ platform, facts: [call] })).facts.length, 1);
  }
  const decl = route('route-decl', 'GET', '/api/v1/items');
  for (const platform of ['kotlin', 'js']) {
    assert.equal(parseBridgeFactsDocument(serverDocument([decl], { platform })).facts.length, 1);
  }
  assert.throws(() => parseBridgeFactsDocument(serverDocument([decl], { platform: 'swift' })), /not valid for platform/);
  assert.throws(() => parseBridgeFactsDocument(serverDocument([decl], { platform: 'dart' })), /not valid for platform/);
  // kotlin 문서가 서버와 클라이언트를 겸할 수 있다.
  const both = parseBridgeFactsDocument(serverDocument([decl, call], { platform: 'kotlin', roles: ['server', 'client'] }));
  assert.deepEqual(both.facts.map(({ kind }) => kind), ['route-decl', 'route-call']);
  // kind와 문서 역할이 맞아야 한다.
  assert.throws(() => parseBridgeFactsDocument(httpDocument({ facts: [decl], platform: 'js', dispatch: 'specificity' })),
    /Dispatch requires|matching document role/);
  assert.throws(() => parseBridgeFactsDocument(serverDocument([call], { platform: 'kotlin' })), /matching document role/);
  // bridge kind는 http target에 올 수 없고 route kind는 다른 target에 올 수 없다.
  assert.throws(() => parseBridgeFactsDocument(httpDocument({
    facts: [{ kind: 'method-invoke', channel: 'c', method: 'm', dynamic: false, location: { path: 'a', line: 1, column: 1 } }],
  })), /not valid for platform/);
  assert.throws(() => parseBridgeFactsDocument(httpDocument({ target: 'flutter', roles: undefined, facts: [call] })),
    /not valid for platform/);
});

test('openapi 문서는 null 또는 http target이고 route-contract만, roles는 server만 싣는다', () => {
  const contract = route('route-contract', 'GET', '/api/v1/items', {
    location: { path: 'openapi.yaml', line: 10, column: 7 },
    symbol: { qualifiedName: 'listItems' },
    operationId: 'listItems',
  });
  const parsed = parseBridgeFactsDocument(httpDocument({ platform: 'openapi', roles: ['server'], facts: [contract] }));
  assert.equal(parsed.facts[0]!.operationId, 'listItems');
  assert.equal(parseBridgeFactsDocument(httpDocument({ platform: 'openapi', target: null, roles: undefined })).target, null);
  assert.throws(() => parseBridgeFactsDocument(httpDocument({ platform: 'openapi', roles: ['client'], facts: [contract] })),
    /Openapi documents must declare roles/);
  assert.throws(() => parseBridgeFactsDocument(httpDocument({ platform: 'openapi', target: 'persistence', roles: undefined })),
    /Openapi documents may only carry/);
  assert.throws(() => parseBridgeFactsDocument(httpDocument({
    platform: 'openapi', roles: ['server'], facts: [{ ...contract, symbol: { qualifiedName: 'listItems', usr: 'x' } }],
  })), /without usr/);
  assert.throws(() => parseBridgeFactsDocument(httpDocument({
    platform: 'openapi', roles: ['server'], facts: [{ ...contract, method: 'ANY' }],
  })), /Invalid route method/);
  for (const platform of ['go', 'rust', 'sql']) {
    assert.throws(() => parseBridgeFactsDocument(httpDocument({ platform, facts: [] })), /may only carry|accepts only/);
  }
});

test('정적 route channel은 정규 템플릿이어야 하고 dynamic은 원문을 길이 상한 안에서만 받는다', () => {
  assert.throws(() => parseBridgeFactsDocument(httpDocument({ facts: [route('route-call', 'GET', '/items/%2f')] })),
    /canonical path template \(lowercase-percent-hex\) at index 0/);
  assert.throws(() => parseBridgeFactsDocument(httpDocument({ facts: [route('route-call', 'GET', '/items/{**}')] })),
    /cannot contain \{\*\*\}/);
  assert.throws(() => parseBridgeFactsDocument(httpDocument({ facts: [{ ...route('route-call', 'GET', '/x'), channel: null }] })),
    /path template channel/);
  const dynamic = { ...route('route-call', 'GET', '"/items/" + id + query'), dynamic: true, channelPrefix: '/items/' };
  assert.equal(parseBridgeFactsDocument(httpDocument({ facts: [dynamic, { ...dynamic, channel: null }] })).facts.length, 2);
  assert.throws(() => parseBridgeFactsDocument(httpDocument({ facts: [{ ...dynamic, channel: 'x'.repeat(2049) }] })),
    /Invalid dynamic route channel/);
  assert.throws(() => parseBridgeFactsDocument(httpDocument({ facts: [{ ...route('route-call', 'GET', '/x'), channelPrefix: '/x' }] })),
    /channelPrefix must be a canonical template on a dynamic call/);
  assert.throws(() => parseBridgeFactsDocument(httpDocument({ facts: [{ ...dynamic, channelPrefix: '/x/{**}' }] })),
    /channelPrefix/);
});

test('method 집합과 ANY·methodDynamic 규칙을 kind별로 적용한다', () => {
  const dynamicMethod = route('route-call', undefined, '/items', { methodDynamic: true });
  assert.equal(parseBridgeFactsDocument(httpDocument({ facts: [dynamicMethod] })).facts[0]!.methodDynamic, true);
  assert.throws(() => parseBridgeFactsDocument(httpDocument({ facts: [{ ...dynamicMethod, method: 'GET' }] })), /dynamic route method/);
  assert.throws(() => parseBridgeFactsDocument(httpDocument({ facts: [{ ...dynamicMethod, methodDynamic: false }] })), /dynamic route method/);
  assert.throws(() => parseBridgeFactsDocument(httpDocument({ facts: [route('route-call', undefined, '/items')] })), /Invalid route method/);
  assert.throws(() => parseBridgeFactsDocument(httpDocument({ facts: [route('route-call', 'ANY', '/items')] })), /Invalid route method/);
  assert.throws(() => parseBridgeFactsDocument(httpDocument({ facts: [route('route-call', 'get', '/items')] })), /Invalid route method/);
  const anyDecl = route('route-decl', 'ANY', '/items');
  assert.equal(parseBridgeFactsDocument(serverDocument([anyDecl])).facts[0]!.method, 'ANY');
  assert.throws(() => parseBridgeFactsDocument(serverDocument([{ ...anyDecl, methodDynamic: true }])), /not valid on route-decl/);
});

test('pathAnchor·location은 필수이고 kind 전용 필드는 다른 kind에서 거부한다', () => {
  assert.throws(() => parseBridgeFactsDocument(httpDocument({ facts: [route('route-call', 'GET', '/x', { pathAnchor: undefined })] })),
    /pathAnchor/);
  assert.throws(() => parseBridgeFactsDocument(httpDocument({ facts: [route('route-call', 'GET', '/x', { location: undefined })] })),
    /requires a location/);
  const misplaced: Array<[string, unknown, string]> = [
    ['trailingSlash', 'strict', 'route-call'],
    ['paramConstraints', [{ segment: 0, kind: 'int' }], 'route-call'],
    ['catchAllPrefix', true, 'route-call'],
    ['narrowed', true, 'route-call'],
  ];
  for (const [field, value, kind] of misplaced) {
    assert.throws(() => parseBridgeFactsDocument(httpDocument({ facts: [route(kind, 'GET', '/x', { [field]: value })] })),
      new RegExp(`Route field "${field}" is not valid on route-call`));
  }
  for (const [field, value] of [['baseRef', 'b1'], ['queryTailStripped', true], ['authority', 'api.example.com'], ['maskedSegments', 1]] as const) {
    assert.throws(() => parseBridgeFactsDocument(serverDocument([route('route-decl', 'GET', '/{}', { [field]: value })])),
      new RegExp(`Route field "${field}" is not valid on route-decl`));
  }
  for (const field of ['mechanism', 'optional', 'sourceLanguage', 'handlerScope']) {
    assert.throws(() => parseBridgeFactsDocument(httpDocument({ facts: [route('route-call', 'GET', '/x', { [field]: 'x' })] })),
      new RegExp(`Field "${field}" is not valid on route facts`));
  }
});

test('route 필드가 다른 target 문서에 실리면 버리지 않고 거부한다(channelPrefix는 기존 계약 필드라 예외)', () => {
  const persistence = {
    ...httpDocument({ platform: 'kotlin', target: 'persistence', roles: undefined }),
    facts: [{ kind: 'relation-use', channel: 'users', dynamic: false, location: { path: 'a.kt', line: 1, column: 1 } }],
  };
  for (const field of ['pathAnchor', 'service', 'testSource', 'order', 'authority']) {
    assert.throws(() => parseBridgeFactsDocument({
      ...persistence,
      facts: [{ ...(persistence.facts[0] as object), [field]: 'x' }],
    }), new RegExp(`Route field "${field}" is only valid on route facts`));
  }
  const kept = parseBridgeFactsDocument({
    ...persistence,
    facts: [{ ...(persistence.facts[0] as object), dynamic: true, channelPrefix: 'SELECT ' }],
  });
  assert.equal('channelPrefix' in kept.facts[0]!, false);
});

test('나중 단계의 dispatch·order·limitationScopes·workspace 매니페스트는 원인을 밝혀 거부한다', () => {
  assert.throws(() => parseBridgeFactsDocument(serverDocument([], { dispatch: 'registration-order' })),
    /registration-order" is not supported yet/);
  assert.throws(() => parseBridgeFactsDocument(serverDocument([route('route-decl', 'GET', '/x', { order: { group: 'g', index: 0 } })])),
    /"order" requires registration-order dispatch/);
  assert.throws(() => parseBridgeFactsDocument(httpDocument({
    limitations: ['route-call-coverage: 1 file'],
    limitationScopes: [{ limitationIndex: 0, channels: ['/x'] }],
  })), /Limitation scopes are not supported on http documents yet/);
  assert.throws(() => parseBridgeFactsDocument({ format: 'isthmus-workspace', version: 1 }),
    /isthmus-workspace manifests are not supported yet/);
  assert.throws(() => parseBridgeFactsDocument(serverDocument([], { dispatch: 'first-match' })), /Invalid http dispatch/);
  assert.throws(() => parseBridgeFactsDocument(httpDocument({ dispatch: 'specificity' })), /Dispatch requires/);
  assert.throws(() => parseBridgeFactsDocument(serverDocument([route('route-decl', 'GET', '/x')], { dispatch: undefined })),
    /require dispatch/);
});

test('service는 문서와 사실 양쪽에 둘 수 있고 다르면 입력 오류다', () => {
  const call = route('route-call', 'GET', '/x', { service: 'example-api' });
  assert.equal(parseBridgeFactsDocument(httpDocument({ facts: [call] })).facts[0]!.service, 'example-api');
  assert.equal(parseBridgeFactsDocument(httpDocument({ service: 'example-api', facts: [call] })).service, 'example-api');
  assert.throws(() => parseBridgeFactsDocument(httpDocument({ service: 'other-api', facts: [call] })),
    /differs from the document service/);
  assert.throws(() => parseBridgeFactsDocument(httpDocument({ service: '' })), /Invalid http document service/);
});

test('authority는 userinfo 없는 소문자 host[:port]만 받고 true 전용 표식은 true만 받는다', () => {
  for (const authority of ['api.example.com', 'api.example.com:8443', 'localhost', '[::1]:8080']) {
    assert.equal(parseBridgeFactsDocument(httpDocument({ facts: [route('route-call', 'GET', '/x', { authority })] })).facts[0]!.authority,
      authority);
  }
  for (const authority of ['API.example.com', 'user@api.example.com', 'https://api.example.com', 'api.example.com/v1', 'api..com']) {
    assert.throws(() => parseBridgeFactsDocument(httpDocument({ facts: [route('route-call', 'GET', '/x', { authority })] })),
      /Route authority must be/);
  }
  assert.throws(() => parseBridgeFactsDocument(httpDocument({ facts: [route('route-call', 'GET', '/x', { queryTailStripped: false })] })),
    /may only be true/);
  assert.throws(() => parseBridgeFactsDocument(serverDocument([route('route-decl', 'GET', '/x', { trailingSlash: 'loose' })])),
    /Invalid route trailingSlash/);
  assert.throws(() => parseBridgeFactsDocument(httpDocument({ facts: [route('route-call', 'GET', '/x', { baseRef: '' })] })),
    /Invalid route field "baseRef"/);
});

test('maskedSegments는 템플릿의 {} 수를 넘지 않는 양의 정수다', () => {
  assert.equal(parseBridgeFactsDocument(httpDocument({ facts: [route('route-call', 'POST', '/hooks/{}/{}', { maskedSegments: 2 })] }))
    .facts[0]!.maskedSegments, 2);
  for (const maskedSegments of [0, 3, 1.5, '1']) {
    assert.throws(() => parseBridgeFactsDocument(httpDocument({ facts: [route('route-call', 'POST', '/hooks/{}/{}', { maskedSegments })] })),
      /Invalid route maskedSegments/);
  }
  const dynamic = { ...route('route-call', 'POST', 'hookUrl'), dynamic: true, maskedSegments: 4 };
  assert.equal(parseBridgeFactsDocument(httpDocument({ facts: [dynamic] })).facts[0]!.maskedSegments, 4);
});

test('paramConstraints는 파라미터 세그먼트만 가리키고 세그먼트 순으로 정규화한다', () => {
  const decl = route('route-decl', 'GET', '/users/{}/files/{}.json', {
    paramConstraints: [{ segment: 3, kind: 'regex', pattern: '[a-z]+' }, { segment: 1, kind: 'int' }],
  });
  assert.deepEqual(parseBridgeFactsDocument(serverDocument([decl])).facts[0]!.paramConstraints, [
    { segment: 1, kind: 'int' },
    { segment: 3, kind: 'regex', pattern: '[a-z]+' },
  ]);
  for (const paramConstraints of [
    [], [{ segment: 0, kind: 'int' }], [{ segment: 9, kind: 'int' }], [{ segment: 1, kind: 'date' }],
    [{ segment: 1, kind: 'int', pattern: '\\d+' }], [{ segment: 1, kind: 'int' }, { segment: 1, kind: 'uuid' }],
    [{ segment: '1', kind: 'int' }], [null],
  ]) {
    assert.throws(() => parseBridgeFactsDocument(serverDocument([{ ...decl, paramConstraints }])), /paramConstraints/);
  }
  assert.throws(() => parseBridgeFactsDocument(serverDocument([{ ...decl, dynamic: true, channel: 'x' }])),
    /paramConstraints require/);
});

test('testSource 사실은 sourceSets.tests가 included인 문서에만 올 수 있다', () => {
  const call = route('route-call', 'GET', '/x', { testSource: true });
  assert.equal(parseBridgeFactsDocument(httpDocument({ sourceSets: { tests: 'included' }, facts: [call] })).facts[0]!.testSource, true);
  assert.throws(() => parseBridgeFactsDocument(httpDocument({ sourceSets: { tests: 'excluded' }, facts: [call] })),
    /sourceSets \{"tests": "included"\}/);
  assert.throws(() => parseBridgeFactsDocument(httpDocument({ facts: [call] })), /sourceSets/);
  for (const sourceSets of [{ tests: 'maybe' }, { tests: 'included', main: 'excluded' }, 'included']) {
    assert.throws(() => parseBridgeFactsDocument(httpDocument({ sourceSets })), /Http sourceSets must be/);
  }
  assert.deepEqual(parseBridgeFactsDocument(httpDocument({ sourceSets: { tests: 'excluded' } })).sourceSets, { tests: 'excluded' });
});

test('catch-all 접두사 decl은 같은 문서의 원본 {**} decl과 method·symbol.usr가 맞아야 한다', () => {
  const symbol = { qualifiedName: 'Files.get', usr: 'files-get' };
  const original = route('route-decl', 'GET', '/files/{**}', { symbol });
  const prefix = route('route-decl', 'GET', '/files', { symbol, catchAllPrefix: true });
  assert.equal(parseBridgeFactsDocument(serverDocument([original, prefix])).facts[1]!.catchAllPrefix, true);
  const rootOriginal = route('route-decl', 'GET', '/{**}', { symbol });
  const rootPrefix = route('route-decl', 'GET', '/', { symbol, catchAllPrefix: true });
  assert.equal(parseBridgeFactsDocument(serverDocument([rootOriginal, rootPrefix])).facts.length, 2);
  for (const facts of [
    [prefix],
    [{ ...original, method: 'POST' }, prefix],
    [{ ...original, symbol: { ...symbol, usr: 'other' } }, prefix],
    [route('route-decl', 'GET', '/other/{**}', { symbol }), prefix],
  ]) {
    assert.throws(() => parseBridgeFactsDocument(serverDocument(facts)), /no matching \{\*\*\} declaration/);
  }
  assert.throws(() => parseBridgeFactsDocument(serverDocument([original, { ...prefix, symbol: { qualifiedName: 'Files.get' } }])),
    /carry symbol.usr/);
  assert.throws(() => parseBridgeFactsDocument(serverDocument([original, { ...prefix, channel: '/files/{**}' }])),
    /without \{\*\*\}/);
});

test('정규화는 route 선택 필드와 문서 필드를 계약 필드만 복사한다', () => {
  const parsed = parseBridgeFactsDocument(serverDocument([
    route('route-decl', 'GET', '/items/{}', {
      trailingSlash: 'optional', caseInsensitive: true, narrowed: true, configDefault: true,
      service: 'example-api', unknownField: 'dropped',
    }),
  ], { service: 'example-api', sourceSets: { tests: 'excluded' }, extra: true }));
  assert.deepEqual(parsed.facts[0], {
    kind: 'route-decl', channel: '/items/{}', method: 'GET', dynamic: false,
    location: { path: 'src/Api.kt', line: 3, column: 5 },
    pathAnchor: 'root', service: 'example-api', trailingSlash: 'optional', caseInsensitive: true,
    narrowed: true, configDefault: true,
  });
  assert.equal(parsed.dispatch, 'specificity');
  assert.equal('extra' in parsed, false);
});
