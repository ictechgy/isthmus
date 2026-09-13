import assert from 'node:assert/strict';
import test from 'node:test';

import { parsePreflightContext, PreflightValidationError } from './preflight-context.ts';

const fact = (platform: 'dart' | 'swift', path: string, line: number, kind: string,
  qualifiedName: string, channel = 'com.example/camera') => ({
  kind, channel, method: kind.startsWith('method-') ? 'takePhoto' : undefined,
  dynamic: false, location: { path, line, column: 1 },
  symbol: { qualifiedName },
  ...(platform === 'swift' ? {} : {}),
});

const bridge = (platform: 'dart' | 'swift', facts: unknown[]) => ({
  format: 'bridge-facts', version: 1,
  tool: { name: platform === 'dart' ? 'dartograph' : 'cartograph', version: '1.0.0' },
  generatedAt: '2026-09-14T00:00:00Z', platform, target: facts.length === 0 ? null : 'flutter',
  project: '/project', facts, limitations: [],
});

const context = (overrides: Record<string, unknown> = {}) => ({
  format: 'isthmus-preflight-context', version: 1, project: '/project', revision: 'r1',
  selection: { dart: { files: ['lib/camera.dart'], symbols: [] } },
  bridges: [
    bridge('dart', [fact('dart', 'lib/camera.dart', 3, 'method-invoke', 'Camera.call')]),
    bridge('swift', [fact('swift', 'ios/Camera.swift', 8, 'method-handle', 'Camera.handle')]),
  ],
  bindings: [], analyses: [{
    id: 'dart-1', platform: 'dart', tool: { name: 'dartograph', version: '1.0.0' },
    requested: { files: ['lib/camera.dart'], symbols: [] }, roots: [
      { id: 'Camera.call', qualifiedName: 'Camera.call' },
    ], affected: [], limitations: [], truncated: false,
  }], limitations: [], ...overrides,
});

test('preflight context normalizes supported fields and validates bridge composition', () => {
  const parsed = parsePreflightContext({ ...context(), extra: 'discarded' });
  assert.equal(parsed.format, 'isthmus-preflight-context');
  assert.equal((parsed as unknown as Record<string, unknown>).extra, undefined);
  assert.deepEqual(parsed.selection.dart, { files: ['lib/camera.dart'], symbols: [] });
});

test('empty noChanges context is valid only without initial analyses', () => {
  const value = context({ selection: {}, analyses: [] });
  assert.deepEqual(parsePreflightContext(value).selection, {});
  assert.throws(() => parsePreflightContext(context({ selection: {}, analyses: [context().analyses[0]] })),
    (error: unknown) => error instanceof PreflightValidationError);
});

test('rejects unknown selection platforms, mixed targets, and foreign projects', () => {
  assert.throws(() => parsePreflightContext(context({ selection: { kotlin: { files: ['x'], symbols: [] } } })),
    PreflightValidationError);
  assert.throws(() => parsePreflightContext(context({ bridges: [
    bridge('dart', [fact('dart', 'lib/camera.dart', 3, 'method-invoke', 'Camera.call')]),
    { ...bridge('swift', [fact('swift', 'ios/Camera.swift', 8, 'method-handle', 'Camera.handle')]),
      limitations: ['mixed-targets: flutter and react-native'] },
  ] })), PreflightValidationError);
  assert.throws(() => parsePreflightContext(context({ bridges: [
    bridge('dart', [fact('dart', 'lib/camera.dart', 3, 'method-invoke', 'Camera.call')]),
    { ...bridge('swift', [fact('swift', 'ios/Camera.swift', 8, 'method-handle', 'Camera.handle')]), project: '/elsewhere' },
  ] })), PreflightValidationError);
});

test('validates continuation triggers and parent-safe affected paths', () => {
  const initial = context({
    selection: { dart: { files: ['lib/camera.dart'], symbols: [] } },
    analyses: [{
      id: 'dart-1', platform: 'dart', tool: { name: 'dartograph', version: '1.0.0' },
      requested: { files: ['lib/camera.dart'], symbols: [] },
      roots: [{ id: 'Camera.call', qualifiedName: 'Camera.call' }],
      affected: [{ symbol: { id: 'Widget.build', qualifiedName: 'Widget.build' }, via: 'Camera.call', depth: 1, relationships: ['call'] }],
      limitations: [], truncated: false,
    }],
  });
  assert.equal(parsePreflightContext(initial).analyses[0]?.affected[0]?.via, 'Camera.call');
  const original = initial.analyses[0] as Record<string, unknown>;
  const affected = (initial.analyses[0]?.affected ?? []) as readonly Record<string, unknown>[];
  assert.throws(() => parsePreflightContext({ ...initial,
    analyses: [{ ...original, affected: [{ ...affected[0], via: 'Missing', depth: 2 }] }],
  }), PreflightValidationError);
  assert.throws(() => parsePreflightContext({ ...initial, analyses: [{
    ...original, id: 'dart-cont', trigger: 'Missing', requested: { files: [], symbols: ['Missing'] },
  }] }), PreflightValidationError);
});

test('bindings require an exact Dart fact and reject conflicting reuse', () => {
  const binding = {
    platform: 'dart', location: { path: 'lib/camera.dart', line: 3, column: 1 },
    requested: 'Camera.call', symbol: {
      id: 'Camera.call', qualifiedName: 'Camera.call',
      location: { path: 'lib/camera.dart', line: 20, column: 1 },
    },
  };
  assert.equal(parsePreflightContext(context({ bindings: [binding] })).bindings.length, 1);
  const identified = { ...binding, symbol: { ...binding.symbol,
    id: 'package:app/camera.dart::Camera.call', qualifiedName: 'package:app/camera.dart::Camera.call' } };
  assert.equal(parsePreflightContext(context({ bindings: [identified] })).bindings[0]?.symbol.id,
    'package:app/camera.dart::Camera.call');
  assert.throws(() => parsePreflightContext(context({ bindings: [{ ...binding, requested: 'Other.call' }] })),
    PreflightValidationError);
});
