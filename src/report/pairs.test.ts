import assert from 'node:assert/strict';
import test from 'node:test';

import { parseBridgeFactsDocument, type BridgeFactsDocument } from '../exchange/parse.ts';
import { emptyBridgeJoinResult, joinBridgeDocuments } from '../join/join.ts';
import { createPersistenceMatches, MAX_PAIR_ENDPOINTS, PersistencePairsLimitError } from './pairs.ts';

/** persistence 사실 하나의 입력 형태다. 선언은 위치 없이 심볼만 싣는다. */
interface RelationFact {
  readonly kind: 'relation-use' | 'relation-decl';
  readonly channel: string;
  readonly method?: string;
  readonly path?: string;
  readonly line?: number;
  readonly symbol?: { readonly qualifiedName: string; readonly usr?: string };
}

/** persistence 문서를 만든다. 사용 사실은 위치가 필수라 기본 경로를 채운다. */
function persistence(platform: 'go' | 'kotlin' | 'sql', facts: readonly RelationFact[]): BridgeFactsDocument {
  return parseBridgeFactsDocument({
    format: 'bridge-facts', version: 1, tool: { name: 'fixture', version: '0.1.0' },
    generatedAt: '2026-09-26T00:00:00Z', platform, target: 'persistence', project: '/fixture',
    facts: facts.map((fact, index) => ({
      kind: fact.kind, channel: fact.channel, dynamic: false,
      ...(fact.method === undefined ? {} : { method: fact.method }),
      ...(fact.kind === 'relation-decl' ? {} : {
        location: { path: fact.path ?? 'db/access.go', line: fact.line ?? index + 1, column: 1 },
      }),
      ...(fact.symbol === undefined ? {} : { symbol: fact.symbol }),
    })),
    limitations: [],
  });
}

const catalog = persistence('sql', [
  { kind: 'relation-decl', channel: 'public.users', symbol: { qualifiedName: 'public.users' } },
  { kind: 'relation-decl', channel: 'public.users', method: 'email', symbol: { qualifiedName: 'public.users.email' } },
  { kind: 'relation-decl', channel: 'public.audit', symbol: { qualifiedName: 'public.audit' } },
]);

test('같은 선언으로 해석된 비한정·한정 사용을 한 매치로 합치고 심볼을 그대로 싣는다', () => {
  const kotlin = persistence('kotlin', [
    { kind: 'relation-use', channel: 'users', path: 'src/Repo.kt', line: 3,
      symbol: { qualifiedName: 'Repo.find', usr: 'method:com/example/Repo#find()V' } },
    { kind: 'relation-use', channel: 'Users', method: 'Email', path: 'src/Repo.kt', line: 4,
      symbol: { qualifiedName: 'Repo.find', usr: 'method:com/example/Repo#find()V' } },
    { kind: 'relation-use', channel: 'orders', path: 'src/Orders.kt', line: 7 },
  ]);
  const go = persistence('go', [
    { kind: 'relation-use', channel: 'public.users', path: 'db/users.go', line: 12 },
    { kind: 'relation-use', channel: 'public.users', method: 'email', path: 'db/users.go', line: 13 },
  ]);

  const matches = createPersistenceMatches(joinBridgeDocuments([kotlin, go, catalog]));

  assert.deepEqual(matches, [
    {
      domain: 'persistence',
      key: { relation: 'public.users' },
      uses: [
        { platform: 'go', location: { path: 'db/users.go', line: 12, column: 1 } },
        { platform: 'kotlin', location: { path: 'src/Repo.kt', line: 3, column: 1 },
          symbol: { qualifiedName: 'Repo.find', usr: 'method:com/example/Repo#find()V' } },
      ],
      decls: [{ platform: 'sql', symbol: { qualifiedName: 'public.users' } }],
    },
    {
      domain: 'persistence',
      // 대소문자만 다른 컬럼 철자는 한 키로 합치고 최소 철자('Email' < 'email')를 쓴다.
      key: { relation: 'public.users', column: 'Email' },
      uses: [
        { platform: 'go', location: { path: 'db/users.go', line: 13, column: 1 } },
        { platform: 'kotlin', location: { path: 'src/Repo.kt', line: 4, column: 1 },
          symbol: { qualifiedName: 'Repo.find', usr: 'method:com/example/Repo#find()V' } },
      ],
      decls: [{ platform: 'sql', symbol: { qualifiedName: 'public.users.email' } }],
    },
  ]);
});

test('매치 목록은 입력 문서 순서와 중복 문서에 무관하게 같다', () => {
  const go = persistence('go', [
    { kind: 'relation-use', channel: 'users', path: 'db/b.go' },
    { kind: 'relation-use', channel: 'public.audit', path: 'db/a.go' },
  ]);
  const forward = createPersistenceMatches(joinBridgeDocuments([go, catalog]));
  const reversed = createPersistenceMatches(joinBridgeDocuments([catalog, go, go]));
  assert.deepEqual(reversed, forward);
  assert.deepEqual(forward.map(({ key }) => key.relation), ['public.audit', 'public.users']);
});

test('같은 관계의 컬럼 매치는 관계 수준 매치 뒤에 컬럼 이름 순으로 놓인다', () => {
  const columns = persistence('sql', [
    { kind: 'relation-decl', channel: 'public.users', symbol: { qualifiedName: 'public.users' } },
    { kind: 'relation-decl', channel: 'public.users', method: 'name', symbol: { qualifiedName: 'public.users.name' } },
    { kind: 'relation-decl', channel: 'public.users', method: 'email', symbol: { qualifiedName: 'public.users.email' } },
  ]);
  const go = persistence('go', [
    { kind: 'relation-use', channel: 'users', method: 'name' },
    { kind: 'relation-use', channel: 'users', method: 'email' },
    { kind: 'relation-use', channel: 'users' },
  ]);
  assert.deepEqual(createPersistenceMatches(joinBridgeDocuments([go, columns])).map(({ key }) => key), [
    { relation: 'public.users' },
    { relation: 'public.users', column: 'email' },
    { relation: 'public.users', column: 'name' },
  ]);
});

test('매치되지 않은 사용·선언과 bridge 전용 입력은 쌍을 만들지 않는다', () => {
  const go = persistence('go', [{ kind: 'relation-use', channel: 'ghost' }]);
  assert.deepEqual(createPersistenceMatches(joinBridgeDocuments([go, catalog])), []);
  assert.deepEqual(createPersistenceMatches(emptyBridgeJoinResult()), []);
});

test('끝점 총수가 상한을 넘으면 부분 목록 대신 실패한다', () => {
  // 상한은 조인 입력 한계보다 작아 합성 조인 결과로 경계를 확인한다.
  const decl = { platform: 'sql' as const, symbol: { qualifiedName: 'public.users' } };
  const uses = (count: number) => Array.from({ length: count }, (_, index) => ({
    platform: 'go' as const, location: { path: 'db/a.go', line: index + 1, column: 1 },
  }));
  const joined = (count: number) => ({
    ...emptyBridgeJoinResult(),
    matchedRelations: [{ target: 'persistence' as const, channel: 'public.users', uses: uses(count), decls: [decl] }],
  });
  assert.equal(createPersistenceMatches(joined(MAX_PAIR_ENDPOINTS - 1))[0]?.uses.length, MAX_PAIR_ENDPOINTS - 1);
  assert.throws(() => createPersistenceMatches(joined(MAX_PAIR_ENDPOINTS)), PersistencePairsLimitError);
  assert.throws(() => createPersistenceMatches({ ...emptyBridgeJoinResult(), deferred: true }),
    /deferred bridge join/);
});
