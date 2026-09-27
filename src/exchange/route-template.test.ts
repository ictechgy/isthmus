import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatRouteTemplate,
  isCanonicalRouteTemplate,
  MAX_ROUTE_TEMPLATE_LENGTH,
  parseRouteTemplate,
} from './route-template.ts';

test('정규 템플릿의 세그먼트 구조를 보존해 해석한다', () => {
  assert.deepEqual(parseRouteTemplate('/'), { ok: true, segments: [{ kind: 'literal', value: '' }] });
  assert.deepEqual(parseRouteTemplate('/api//items/'), {
    ok: true,
    segments: [
      { kind: 'literal', value: 'api' },
      { kind: 'literal', value: '' },
      { kind: 'literal', value: 'items' },
      { kind: 'literal', value: '' },
    ],
  });
  assert.deepEqual(parseRouteTemplate('/files/{}.json/{}/v{}/{**}'), {
    ok: true,
    segments: [
      { kind: 'literal', value: 'files' },
      { kind: 'partial', prefix: '', suffix: '.json' },
      { kind: 'param' },
      { kind: 'partial', prefix: 'v', suffix: '' },
      { kind: 'catch-all' },
    ],
  });
});

test('pchar 리터럴과 대문자 퍼센트 인코딩을 받는다', () => {
  for (const template of [
    "/a:b@c!$&'()*+,;=-._~", '/%7B%7D', '/caf%C3%A9', '/{**}', '/Items/ID', '/%2F',
  ]) {
    assert.equal(isCanonicalRouteTemplate(template), true, template);
  }
});

test('문법을 어긴 템플릿은 다시 정규화하지 않고 사유와 함께 거부한다', () => {
  const cases: Array<[string, string]> = [
    ['items', 'not-rooted'],
    ['', 'not-rooted'],
    ['/a b', 'invalid-character'],
    ['/café', 'invalid-character'],
    ['/a?x=1', 'invalid-character'],
    ['/a#frag', 'invalid-character'],
    ['/%zz', 'malformed-percent'],
    ['/%2', 'malformed-percent'],
    ['/%2f', 'lowercase-percent-hex'],
    ['/%41', 'encoded-unreserved'],
    ['/%7e', 'lowercase-percent-hex'],
    ['/%7E', 'encoded-unreserved'],
    ['/{', 'stray-brace'],
    ['/}', 'stray-brace'],
    ['/{id}', 'stray-brace'],
    ['/v{}.n{}', 'multiple-parameters'],
    ['/a{**}', 'catch-all-partial'],
    ['/{**}/a', 'catch-all-not-last'],
    ['/{**}/', 'catch-all-not-last'],
    [`/${'a'.repeat(MAX_ROUTE_TEMPLATE_LENGTH)}`, 'too-long'],
  ];
  for (const [template, reason] of cases) {
    assert.deepEqual(parseRouteTemplate(template), { ok: false, reason }, template);
  }
});

test('세그먼트 목록을 원래 템플릿 문자열로 되돌린다', () => {
  for (const template of ['/', '/a//b/', '/files/{}.json/{}/{**}', '/x{}y']) {
    const parsed = parseRouteTemplate(template);
    assert.ok(parsed.ok);
    assert.equal(formatRouteTemplate(parsed.segments), template);
  }
});
