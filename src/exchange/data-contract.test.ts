import assert from 'node:assert/strict';
import test from 'node:test';
import { parseBridgeFactsDocument } from './parse.ts';

const dataContract = { version: 1, fields: [{ in: 'column', path: 'email', type: 'text', nullable: false }], limitations: [] };
const document = (contract: unknown) => ({
  format: 'bridge-facts', version: 1, tool: { name: 'schemagraph', version: '0.7.1' },
  generatedAt: '2026-10-22T00:00:00Z', platform: 'sql', target: 'persistence', project: '/work/api',
  facts: [{ kind: 'relation-decl', channel: 'public.users', dynamic: false,
    symbol: { qualifiedName: 'public.users', usr: 'public.users' }, dataContract: contract }], limitations: [],
});

test('preserves catalog type/nullability evidence instead of silently losing a same-name contract change', () => {
  const parsed = parseBridgeFactsDocument(document(dataContract));
  assert.deepEqual((parsed.facts[0] as unknown as { dataContract: unknown }).dataContract, dataContract);
});

test('rejects malformed or unbounded contract fields', () => {
  for (const contract of [null, { ...dataContract, version: 2 }, { ...dataContract, fields: Array(513).fill(dataContract.fields[0]) },
    { ...dataContract, fields: [{ in: 'column', path: 'email', nullable: 'unknown' }] },
    { ...dataContract, fields: [dataContract.fields[0], dataContract.fields[0]] }]) {
    assert.throws(() => parseBridgeFactsDocument(document(contract)), /contract/i);
  }
});
