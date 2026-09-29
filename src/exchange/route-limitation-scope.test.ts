import assert from 'node:assert/strict';
import test from 'node:test';

import { MAX_SCOPED_CHANNELS, parseBridgeFactsDocument } from './parse.ts';

/** http 서버 문서 골격이다. 합성 경로만 쓴다. */
function serverDocument(limitationScopes: unknown, limitations = ['framework-provided-routes: synthetic starter']): Record<string, unknown> {
  return {
    format: 'bridge-facts', version: 1, tool: { name: 'synthetic', version: '0.0.0' },
    generatedAt: '2026-09-29T00:00:00Z', platform: 'kotlin', target: 'http', project: '/work/example',
    roles: ['server'], dispatch: 'specificity', facts: [], limitations,
    ...(limitationScopes === undefined ? {} : { limitationScopes }),
  };
}

test('http 스코프는 경로 필드를 중복 제거·문자열 순으로 정규화하고 모르는 필드 없이 복사한다', () => {
  const parsed = parseBridgeFactsDocument(serverDocument([{
    limitationIndex: 0,
    templates: ['/error', '/error', '/a/{}'],
    templatePrefixes: ['/webjars', '/'],
    templateSuffixes: ['/items/{}'],
    methods: ['HEAD', 'GET'],
  }]));
  assert.deepEqual(parsed.limitationScopes, [{
    limitationIndex: 0,
    templates: ['/a/{}', '/error'],
    templatePrefixes: ['/', '/webjars'],
    templateSuffixes: ['/items/{}'],
    methods: ['GET', 'HEAD'],
  }]);
  // 경로 필드 하나만 있어도 되고, 빈 스코프 배열은 추가 범위가 없다는 뜻이다.
  assert.deepEqual(parseBridgeFactsDocument(serverDocument([{ limitationIndex: 0, templates: ['/error'] }])).limitationScopes,
    [{ limitationIndex: 0, templates: ['/error'] }]);
  assert.deepEqual(parseBridgeFactsDocument(serverDocument([])).limitationScopes, []);
});

const invalidScopes: ReadonlyArray<readonly [string, unknown, RegExp]> = [
  ['채널 형태', [{ limitationIndex: 0, channels: ['/error'] }], /instead of channels/],
  ['경로 필드 없음', [{ limitationIndex: 0 }], /require at least one of/],
  ['method만 있음', [{ limitationIndex: 0, methods: ['GET'] }], /require at least one of/],
  ['모르는 키', [{ limitationIndex: 0, templates: ['/a'], hosts: ['x'] }], /accept only limitationIndex/],
  ['빈 배열', [{ limitationIndex: 0, templates: [] }], /non-empty array/],
  ['문자열이 아닌 원소', [{ limitationIndex: 0, templatePrefixes: [1] }], /path template strings/],
  ['정규형이 아닌 템플릿', [{ limitationIndex: 0, templates: ['/a/{id}'] }], /non-canonical path template \(stray-brace\)/],
  ['상대 경로', [{ limitationIndex: 0, templates: ['error'] }], /\(not-rooted\)/],
  ['제어 문자', [{ limitationIndex: 0, templates: ['/a\nb'] }], /\(invalid-character\)/],
  ['소문자 hex', [{ limitationIndex: 0, templates: ['/a%2f'] }], /\(lowercase-percent-hex\)/],
  ['너무 긴 템플릿', [{ limitationIndex: 0, templates: [`/${'a'.repeat(2_048)}`] }], /\(too-long\)/],
  ['접두사의 {**}', [{ limitationIndex: 0, templatePrefixes: ['/files/{**}'] }], /must not contain \{\*\*\}/],
  ['접미사의 {**}', [{ limitationIndex: 0, templateSuffixes: ['/files/{**}'] }], /must not contain \{\*\*\}/],
  ['끝 슬래시 접두사', [{ limitationIndex: 0, templatePrefixes: ['/actuator/'] }], /must not end with "\/"/],
  ['루트 접미사', [{ limitationIndex: 0, templateSuffixes: ['/'] }], /must not be "\/"/],
  ['ANY method', [{ limitationIndex: 0, templates: ['/a'], methods: ['ANY'] }], /distinct HTTP methods/],
  ['중복 method', [{ limitationIndex: 0, templates: ['/a'], methods: ['GET', 'GET'] }], /distinct HTTP methods/],
  ['빈 method 배열', [{ limitationIndex: 0, templates: ['/a'], methods: [] }], /distinct HTTP methods/],
  ['소문자 method', [{ limitationIndex: 0, templates: ['/a'], methods: ['get'] }], /distinct HTTP methods/],
  ['인덱스 범위 밖', [{ limitationIndex: 1, templates: ['/a'] }], /Invalid or duplicate limitation scope index/],
  ['중복 인덱스', [{ limitationIndex: 0, templates: ['/a'] }, { limitationIndex: 0, templates: ['/b'] }],
    /Invalid or duplicate limitation scope index/],
  ['원소 합계 상한', [{
    limitationIndex: 0,
    templates: Array.from({ length: MAX_SCOPED_CHANNELS }, () => '/a'),
    templatePrefixes: ['/b'],
  }], /Too many scoped channels or path templates/],
];

for (const [label, scopes, message] of invalidScopes) {
  test(`잘못된 http 스코프는 빈 공백으로 읽지 않고 거부한다: ${label}`, () => {
    assert.throws(() => parseBridgeFactsDocument(serverDocument(scopes)), message);
  });
}

test('경로 스코프 필드는 http 문서 전용이고 채널 스코프와 섞이지 않는다', () => {
  const bridge = {
    format: 'bridge-facts', version: 1, tool: { name: 'synthetic', version: '0.0.0' },
    generatedAt: '2026-09-29T00:00:00Z', platform: 'swift', target: 'flutter', project: '/work/example',
    facts: [{ kind: 'channel-register', channel: 'A', dynamic: false, location: { path: 'a.swift', line: 1, column: 1 } }],
    limitations: ['objective-c-sources: synthetic'],
  };
  for (const field of ['templates', 'templatePrefixes', 'templateSuffixes', 'methods']) {
    assert.throws(() => parseBridgeFactsDocument({ ...bridge, limitationScopes: [{ limitationIndex: 0, channels: ['A'], [field]: ['/a'] }] }),
      /require the http target/);
  }
});
