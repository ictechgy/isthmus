import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canonicalJson,
  computeSurfaceDigest,
  HttpSurfaceValidationError,
  importHttpSurface,
  SURFACE_LIMITATION_DETAIL,
  SURFACE_PROJECT_PREFIX,
} from './http-surface.ts';

/**
 * `isthmus-http-surface` v1 가져오기 — digest·공개 수준·surface 전용 규칙과 bridge-facts 규칙 재사용을 검증한다.
 * 모든 값은 합성이다.
 */

type Json = Record<string, any>;

/** 최소 surface다. `mutate`로 고친 뒤 digest를 다시 계산한다(digest 검사 자체를 시험할 때는 `seal: false`). */
function surface(mutate: (value: Json) => void = () => {}, seal = true): Json {
  const value: Json = {
    format: 'isthmus-http-surface', version: 1, name: 'example-api', revision: 'v1.0.0',
    exporter: { name: 'isthmus', version: '0.0.0' }, privacy: { handlers: 'opaque', limitations: 'prefix-only' },
    continuation: 'opaque',
    documents: [{
      platform: 'js', target: 'http', tool: { name: 'synthetic', version: '0.0.0' }, generatedAt: '2026-09-30T00:00:00Z',
      roles: ['server'], dispatch: 'specificity', sourceSets: { tests: 'excluded' }, service: 'example-api',
      facts: [
        { kind: 'route-decl', method: 'GET', channel: '/files/{**}', dynamic: false, pathAnchor: 'root', handler: 'h1' },
        { kind: 'route-decl', method: 'GET', channel: '/files', dynamic: false, pathAnchor: 'root', handler: 'h1', catchAllPrefix: true },
        { kind: 'route-decl', method: 'GET', channel: '/users/{}', dynamic: false, pathAnchor: 'root', handler: 'h2',
          paramConstraints: [{ segment: 1, kind: 'int' }] },
        { kind: 'route-decl', method: 'GET', channel: null, dynamic: true, pathAnchor: 'root' },
      ],
      limitations: [`route-coverage: ${SURFACE_LIMITATION_DETAIL}`],
      limitationScopes: [{ limitationIndex: 0, templatePrefixes: ['/admin'] }],
    }, {
      platform: 'openapi', target: 'http', tool: { name: 'synthetic-openapi', version: '0.0.0' },
      generatedAt: '2026-09-30T00:00:00Z', roles: ['server'], service: 'example-api',
      facts: [{ kind: 'route-contract', method: 'GET', channel: '/users/{}', dynamic: false, pathAnchor: 'root',
        operationId: 'getUser', symbol: { qualifiedName: 'getUser' } }],
      limitations: [],
    }],
  };
  mutate(value);
  if (seal) value.digest = computeSurfaceDigest(value);
  return value;
}

const rejects = (value: unknown, pattern: RegExp) =>
  assert.throws(() => importHttpSurface(value), (error: unknown) => error instanceof HttpSurfaceValidationError && pattern.test(error.message));

test('가져온 surface는 위치·토큰 없는 조인용 bridge-facts 문서가 된다', () => {
  const { surface: parsed, documents } = importHttpSurface(surface());
  assert.equal(parsed.name, 'example-api');
  assert.equal(parsed.revision, 'v1.0.0');
  assert.equal(documents.length, 2);
  const [decls, spec] = documents;
  assert.equal(decls!.project, `${SURFACE_PROJECT_PREFIX}example-api`);
  assert.equal(decls!.format, 'bridge-facts');
  assert.ok(decls!.facts.every((fact) => fact.location === undefined && fact.symbol === undefined));
  assert.deepEqual(decls!.facts.map(({ channel }) => channel), ['/files/{**}', '/files', '/users/{}', null]);
  assert.equal(decls!.facts[1]!.catchAllPrefix, true);
  assert.deepEqual(decls!.limitationScopes, [{ limitationIndex: 0, templatePrefixes: ['/admin'] }]);
  assert.deepEqual(spec!.facts[0]!.symbol, { qualifiedName: 'getUser' });
  assert.equal(spec!.facts[0]!.location, undefined);
});

test('usr 공개 surface의 decl symbol은 usr만 싣는다(이름은 공개하지 않으므로 qualifiedName도 usr다)', () => {
  const { documents } = importHttpSurface(surface((value) => {
    value.privacy.handlers = 'usr';
    for (const fact of value.documents[0].facts.slice(0, 2)) fact.symbol = { usr: 'ts:files.serve' };
  }));
  assert.deepEqual(documents[0]!.facts[0]!.symbol, { qualifiedName: 'ts:files.serve', usr: 'ts:files.serve' });
  assert.equal(documents[0]!.facts[2]!.symbol, undefined);
});

test('digest는 키 순서·공백과 무관하고 내용이 바뀌면 거부한다', () => {
  const value = surface();
  const reordered = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(value).reverse())));
  assert.equal(computeSurfaceDigest(reordered), value.digest);
  assert.equal(canonicalJson({ b: [1, { d: 1, c: 2 }], a: null }), '{"a":null,"b":[1,{"c":2,"d":1}]}');
  rejects(surface((edited) => { edited.documents[0].facts[2].channel = '/users/me'; }, false), /digest/u);
  rejects({ ...value, digest: value.digest.toUpperCase() }, /lowercase hex/u);
});

test('최상위 필드와 공개 수준을 엄격히 검증한다', () => {
  rejects({ format: 'bridge-facts' }, /isthmus-http-surface version 1/u);
  rejects(surface((value) => { value.project = '/work/server'; }), /unknown field/u);
  rejects(surface((value) => { value.continuation = { analyses: [] }; }), /continuation "opaque"/u);
  rejects(surface((value) => { value.privacy.handlers = 'names'; }), /privacy.handlers/u);
  rejects(surface((value) => { value.privacy.limitations = 'none'; }), /privacy.limitations/u);
  rejects(surface((value) => { value.privacy = { handlers: 'opaque' }; }), /privacy.limitations/u);
  rejects(surface((value) => { value.privacy.extra = true; }), /privacy/u);
  rejects(surface((value) => { value.exporter = { name: 'isthmus' }; }), /exporter version/u);
  rejects(surface((value) => { value.exporter.url = 'x'; }), /exporter/u);
  rejects(surface((value) => { value.name = ' padded'; }), /surface name/u);
  rejects(surface((value) => { value.revision = 'r'.repeat(300); }), /revision/u);
  rejects(surface((value) => { value.documents = []; }), /1 to 256/u);
});

test('서버 내부를 드러내는 필드는 문서·사실 어디에도 올 수 없다', () => {
  rejects(surface((value) => { value.documents[0].project = '/work/server'; }), /unknown field/u);
  rejects(surface((value) => { value.documents[0].facts[2].location = { path: 'src/a.ts', line: 1, column: 1 }; }),
    /never published/u);
  rejects(surface((value) => { value.documents[0].facts[2].testSource = true; }), /never published/u);
  rejects(surface((value) => { value.documents[0].facts.push('x'); }), /never published/u);
  rejects(surface((value) => { value.documents[0] = 'x'; }), /unknown field/u);
  rejects(surface((value) => { value.documents[0].facts = {}; }), /facts must be an array/u);
  rejects(surface((value) => { value.documents[0].facts[3].channel = '`${base}/x`'; }), /null channel/u);
  rejects(surface((value) => { value.documents[0].facts[2].symbol = { usr: 'ts:users.get' }; }), /privacy.handlers is "opaque"/u);
  rejects(surface((value) => {
    value.privacy.handlers = 'usr';
    value.documents[0].facts[2].symbol = { qualifiedName: 'users.get', usr: 'ts:users.get' };
  }), /exactly \{usr\}/u);
  rejects(surface((value) => {
    value.privacy.handlers = 'usr';
    delete value.documents[0].facts[2].handler;
    value.documents[0].facts[2].symbol = { usr: 'ts:users.get' };
  }), /without its handler token/u);
  rejects(surface((value) => { value.documents[1].facts[0].symbol = { qualifiedName: 'getUser', usr: 'x' }; }), /operationId/u);
});

test('역할·kind·테스트 소스·토큰·group 규칙을 검증한다', () => {
  rejects(surface((value) => { value.documents[0].roles = ['server', 'client']; }), /roles \["server"\]/u);
  rejects(surface((value) => { value.documents[0].target = null; }), /roles \["server"\]/u);
  rejects(surface((value) => { value.documents[0].sourceSets.tests = 'included'; }), /exclude test sources/u);
  rejects(surface((value) => { value.documents[1].facts[0].kind = 'route-decl'; }), /route-contract fact/u);
  rejects(surface((value) => { value.documents[0].facts[2].handler = 'handler-1'; }), /opaque token such as "h1"/u);
  rejects(surface((value) => { value.documents[1].facts[0].handler = 'h9'; }), /opaque token such as "h1"/u);
  rejects(surface((value) => {
    value.documents[0].dispatch = 'registration-order';
    value.documents[0].facts[2].order = { group: 'django:config.urls', index: 0 };
  }), /opaque token such as "g1"/u);
  rejects(surface((value) => { delete value.documents[0].facts[1].handler; }), /bridge-facts contract.*catch-all prefix/u);
  rejects(surface((value) => {
    value.privacy.handlers = 'usr';
    value.documents[0].facts[0].symbol = { usr: 'ts:a' };
    value.documents[0].facts[1].symbol = { usr: 'ts:b' };
  }), /different handler/u);
  rejects(surface((value) => {
    value.privacy.handlers = 'usr';
    value.documents[0].facts[0].symbol = { usr: 'ts:a' };
    value.documents[0].facts[1].symbol = { usr: 'ts:a' };
    value.documents[0].facts[2].symbol = { usr: 'ts:a' };
  }), /two handler tokens/u);
});

test('등록 순서 surface는 (group, index)마다 한 등록 규칙을 그대로 지킨다', () => {
  const ordered = (mutate: (facts: Json[]) => void) => surface((value) => {
    value.documents[0].dispatch = 'registration-order';
    const facts = value.documents[0].facts;
    facts[0].order = { group: 'g1', index: 0 };
    facts[1].order = { group: 'g1', index: 0 };
    facts[2].order = { group: 'g1', index: 1 };
    mutate(facts);
  });
  assert.equal(importHttpSurface(ordered(() => {})).documents[0]!.facts[2]!.order?.index, 1);
  rejects(ordered((facts) => { facts[2]!.order = { group: 'g1', index: -1 }; }), /non-negative integer/u);
});

test('한계는 서버·계약 측 공백 접두사만, prefix-only면 고정 문구만 받는다', () => {
  rejects(surface((value) => { value.documents[0].limitations = ['route-coverage: src/routes/admin.ts uses a loader']; }),
    /prefix-only/u);
  rejects(surface((value) => { value.documents[0].limitations = [`route-call-coverage: ${SURFACE_LIMITATION_DETAIL}`]; }),
    /outside the server and contract gap prefixes/u);
  const full = importHttpSurface(surface((value) => {
    value.privacy.limitations = 'full';
    value.documents[0].limitations = ['route-coverage: admin routes are mounted by a plugin loader'];
  }));
  assert.deepEqual(full.documents[0]!.limitations, ['route-coverage: admin routes are mounted by a plugin loader']);
  rejects(surface((value) => { value.documents[0].limitations = 'x'; }), /bridge-facts contract/u);
});
