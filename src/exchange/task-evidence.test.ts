import assert from 'node:assert/strict';
import test from 'node:test';

import { parseEvidenceManifest, parseTaskValidation, TaskEvidenceError } from './task-evidence.ts';
import { compareTaskEvidence } from '../report/task-evidence.ts';

const state = { captureId: 'one', repository: 'example', commit: 'a'.repeat(40), dirty: false,
  sourceDigest: 'a'.repeat(64), sourceDigestScheme: 'bytes-membership-v1', toolchainDigest: 'b'.repeat(64),
  buildConfigurationDigest: 'c'.repeat(64) };
const tool = { name: 'producer', version: '1' };
const artifact = { id: 'one', path: 'facts.json', role: 'bridge-facts', sha256: 'd'.repeat(64), input: state, producer: tool };
const manifest = { format: 'isthmus-evidence-manifest', version: 1, expected: state, artifacts: [artifact] };
const validation = { format: 'isthmus-task-validation', version: 1, tool,
  tests: [{ id: 'one', platform: 'swift', usr: 's:one', outcome: 'unknown' }], limitations: [] };

test('manifest normalizes supported fields without inheriting absent evidence or trusting extras', () => {
  const result = parseEvidenceManifest({ ...manifest, verified: true, generatedAt: 'same', artifacts: [
    { id: 'context', path: 'context.json', role: 'trace-context', sha256: artifact.sha256, verified: true }, artifact,
  ] });
  assert.equal(result.artifacts[0]!.input, undefined);
  assert.ok(!('verified' in result.artifacts[0]!));
  assert.deepEqual(result.expected, state);
  assert.deepEqual(parseTaskValidation(validation), { tool, tests: validation.tests, limitations: [] });
  assert.equal(parseEvidenceManifest({ ...manifest, expected: { ...state, commit: 'a'.repeat(64) } }).expected.commit.length, 64);
});

test('malformed and excessive evidence is rejected before use', () => {
  const invalid: unknown[] = [null, [], {}, { ...manifest, version: 2 }, { ...manifest, artifacts: Array(513).fill(artifact) },
    { ...manifest, artifacts: [null] }, { ...manifest, artifacts: [artifact, artifact] }];
  for (const [field, value] of Object.entries({ captureId: '', repository: '\nsecret', commit: 'main', dirty: 'false',
    sourceDigest: 'A'.repeat(64), sourceDigestScheme: '\ud800', toolchainDigest: '', buildConfigurationDigest: 1 })) {
    invalid.push({ ...manifest, expected: { ...state, [field]: value } });
  }
  for (const [field, value] of Object.entries({ id: 'x'.repeat(1025), path: '/secret', role: 'unknown', sha256: '',
    input: {}, producer: { name: '', version: '1' } })) {
    invalid.push({ ...manifest, artifacts: [{ ...artifact, [field]: value }] });
  }
  for (const value of invalid) assert.throws(() => parseEvidenceManifest(value), TaskEvidenceError);
});

test('validation rejects ambiguous ids, unsupported outcomes/platforms and excessive observations', () => {
  const invalid: unknown[] = [null, {}, { ...validation, version: 2 }, { ...validation, tool: null },
    { ...validation, tests: Array(1001).fill(validation.tests[0]) }, { ...validation, tests: [null] },
    { ...validation, tests: [...validation.tests, ...validation.tests] }, { ...validation, limitations: [1] },
    { ...validation, limitations: ['x'.repeat(1025)] }];
  for (const [field, value] of Object.entries({ id: '', platform: 'not-a-platform', usr: '', outcome: 'clean' })) {
    invalid.push({ ...validation, tests: [{ ...validation.tests[0], [field]: value }] });
  }
  for (const value of invalid) assert.throws(() => parseTaskValidation(value), TaskEvidenceError);
});

test('comparison preserves simultaneous stale/missing/unverified reasons and never verifies claims', () => {
  const parsed = parseEvidenceManifest(manifest);
  const entry = parsed.artifacts[0]!;
  const observation = { id: entry.id, artifact: entry, role: entry.role, sha256: entry.sha256, producer: tool };
  const matched = compareTaskEvidence(parsed, [observation]);
  assert.equal(matched.alignment, 'matched');
  assert.equal(matched.verification, 'unverified');
  const { producer: ignoredProducer, ...withoutProducer } = observation;
  const mixed = compareTaskEvidence(parsed, [
    { ...observation, sha256: '0'.repeat(64) },
    { id: 'missing', role: entry.role, sha256: entry.sha256 },
    { ...withoutProducer, id: 'no-tool' },
  ]);
  assert.deepEqual(mixed.summary, { matched: 0, stale: 1, missing: 1, unverified: 1 });
  assert.equal(mixed.alignment, 'stale');
  assert.equal(compareTaskEvidence(undefined, []).alignment, 'missing');
  assert.equal(compareTaskEvidence(parsed, []).alignment, 'unverified');
  const absent = { id: entry.id, role: entry.role, sha256: entry.sha256,
    artifact: { id: entry.id, path: entry.path, role: entry.role, sha256: entry.sha256 } };
  const missing = compareTaskEvidence(parsed, [absent]);
  assert.equal(missing.alignment, 'missing');
  assert.deepEqual(missing.artifacts[0]!.reasons, ['artifact-input-missing', 'producer-unverified']);
});
