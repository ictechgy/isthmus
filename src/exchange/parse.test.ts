import assert from 'node:assert/strict';
import test from 'node:test';

import { parseBridgeFactsDocument } from './parse.ts';

const emptyDocument = {
  format: 'bridge-facts',
  version: 1,
  tool: { name: 'dartograph', version: '0.1.0' },
  generatedAt: '2026-09-04T12:00:00Z',
  platform: 'dart',
  target: 'flutter',
  project: '/fixture',
  facts: [],
  limitations: [],
};

const validMethodFact = {
  kind: 'method-handle',
  channel: 'dev.isthmus/camera',
  method: 'takePhoto',
  dynamic: false,
  location: { path: 'ios/Runner/CameraPlugin.swift', line: 13, column: 18 },
  symbol: { qualifiedName: 'CameraPlugin.register', usr: 's:register' },
};

test('완전한 bridge-facts v1 문서를 파싱한다', () => {
  const parsed = parseBridgeFactsDocument(emptyDocument);

  assert.deepEqual(parsed, emptyDocument);
});

test('객체가 아닌 JSON 루트를 안전한 검증 오류로 거부한다', () => {
  assert.throws(() => parseBridgeFactsDocument(null), {
    name: 'BridgeFactsValidationError',
    message: 'Bridge facts must be a JSON object.',
  });
});

test('다른 JSON 문서 형식을 bridge-facts로 오인하지 않는다', () => {
  assert.throws(
    () => parseBridgeFactsDocument({ ...emptyDocument, format: 'graph' }),
    {
      name: 'BridgeFactsValidationError',
      message: 'Expected format "bridge-facts".',
    },
  );
});

test('지원하지 않는 bridge-facts 버전을 거부한다', () => {
  assert.throws(
    () => parseBridgeFactsDocument({ ...emptyDocument, version: 2 }),
    {
      name: 'BridgeFactsValidationError',
      message: 'Unsupported bridge-facts version; expected version 1.',
    },
  );
});

test('잘못된 문서 메타데이터를 필드별 안전한 오류로 거부한다', () => {
  const invalidCases: ReadonlyArray<readonly [unknown, string]> = [
    [{ ...emptyDocument, tool: { name: '', version: '0.1.0' } }, 'Invalid tool metadata.'],
    [{ ...emptyDocument, generatedAt: 'not-a-date' }, 'Invalid generatedAt timestamp.'],
    [{ ...emptyDocument, platform: 'ruby' }, 'Unsupported bridge platform.'],
    [{ ...emptyDocument, target: 'cordova' }, 'Unsupported bridge target.'],
    [{ ...emptyDocument, project: '' }, 'Invalid project path.'],
    [{ ...emptyDocument, facts: {} }, 'Facts must be an array.'],
    [{ ...emptyDocument, limitations: [1] }, 'Limitations must be strings.'],
  ];

  for (const [input, message] of invalidCases) {
    assert.throws(() => parseBridgeFactsDocument(input), {
      name: 'BridgeFactsValidationError',
      message,
    });
  }
});

test('잘못된 사실을 필드별 검증 오류로 거부한다', () => {
  const invalidCases: ReadonlyArray<readonly [unknown, string]> = [
    [null, 'Fact at index 0 must be a JSON object.'],
    [{ ...validMethodFact, kind: 'unknown' }, 'Invalid fact kind at index 0.'],
    [{ ...validMethodFact, channel: '' }, 'Invalid fact channel at index 0.'],
    [
      { ...validMethodFact, method: undefined },
      'Method fact at index 0 requires a method name.',
    ],
    [{ ...validMethodFact, dynamic: 'no' }, 'Invalid dynamic flag at index 0.'],
    [
      { ...validMethodFact, location: { path: '', line: 0, column: 0 } },
      'Invalid fact location at index 0.',
    ],
    [
      { ...validMethodFact, symbol: { qualifiedName: '' } },
      'Invalid fact symbol at index 0.',
    ],
  ];

  for (const [fact, message] of invalidCases) {
    assert.throws(
      () => parseBridgeFactsDocument({ ...emptyDocument, facts: [fact] }),
      { name: 'BridgeFactsValidationError', message },
    );
  }
});
