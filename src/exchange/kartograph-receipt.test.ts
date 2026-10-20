import assert from 'node:assert/strict';
import test from 'node:test';
import { parseKartographReceipt } from './kartograph-receipt.ts';
import { compareKartographReceipt } from '../report/kartograph-receipt.ts';

const freshness = { format: 'kartograph-freshness', version: 1, status: 'matched', reasons: [] };
const receipt = { format: 'isthmus-kartograph-receipt', version: 1, producer: { name: 'kartograph', version: '0.25.1' },
  scope: 'fixture:main', snapshotSha256: 'a'.repeat(64), producerSha256: 'b'.repeat(64), witnessCount: 1,
  before: freshness, after: freshness, stableSnapshot: true, stableProducer: true, limitations: [],
  artifacts: [{ id: 'server', role: 'bridge-facts', sha256: 'c'.repeat(64) }] };

test('recorded native matching is distinct from offline integrity and current verification', () => {
  const parsed = parseKartographReceipt(receipt);
  const result = compareKartographReceipt(parsed, true, [{ id: 'artifact:server', role: 'bridge-facts',
    sha256: 'c'.repeat(64), producer: { name: 'kartograph', version: '0.25.1' } }]);
  assert.equal(result.nativeAtCapture, 'matched');
  assert.equal(result.artifacts[0]!.alignment, 'matched');
  assert.equal(result.currentVerification, 'unverified');
  assert.equal(compareKartographReceipt(parsed, false, []).integrity, 'stale');
});

test('changed source/config/classes and missing native evidence cannot become matched', () => {
  for (const reason of ['changed-sources', 'changed-buildConfig', 'changed-classes']) {
    const result = compareKartographReceipt(parseKartographReceipt({ ...receipt,
      after: { ...freshness, status: 'stale', reasons: [reason] } }), true, []);
    assert.equal(result.nativeAtCapture, 'stale');
    assert.ok(result.reasons.includes(reason));
  }
  for (const extra of [{ witnessCount: 0 }, { limitations: ['no-persistence-symbol-roots'] },
    { after: { ...freshness, status: 'unverified', reasons: ['missing-external-input'] } }]) {
    assert.equal(compareKartographReceipt(parseKartographReceipt({ ...receipt, ...extra }), true, []).nativeAtCapture, 'unverified');
  }
  for (const extra of [{ stableSnapshot: false }, { stableProducer: false }]) {
    assert.equal(compareKartographReceipt(parseKartographReceipt({ ...receipt, ...extra }), true, []).nativeAtCapture, 'stale');
  }
});

test('artifact bytes, role, producer version and missing selection remain bounded evidence gaps', () => {
  const parsed = parseKartographReceipt(receipt);
  for (const extra of [{ sha256: 'd'.repeat(64) }, { role: 'traversal' },
    { producer: { name: 'kartograph', version: 'old' } }]) {
    const result = compareKartographReceipt(parsed, true, [{ id: 'artifact:server', role: 'bridge-facts',
      sha256: 'c'.repeat(64), producer: receipt.producer, ...extra } as any]);
    assert.equal(result.artifacts[0]!.alignment, 'stale');
  }
  assert.equal(compareKartographReceipt(parsed, true, []).artifacts[0]!.alignment, 'missing');
});

test('unsupported or contradictory receipts fail closed without accepting a matched label', () => {
  for (const value of [null, {}, { ...receipt, version: 2 }, { ...receipt, witnessCount: -1 },
    { ...receipt, producer: { name: 'other', version: '1' } }, { ...receipt, snapshotSha256: 'bad' },
    { ...receipt, stableSnapshot: 'true' }, { ...receipt, artifacts: [receipt.artifacts[0], receipt.artifacts[0]] },
    { ...receipt, after: { ...freshness, status: 'clean' } },
    { ...receipt, after: { ...freshness, reasons: ['changed-sources'] } }]) {
    assert.throws(() => parseKartographReceipt(value));
  }
});
