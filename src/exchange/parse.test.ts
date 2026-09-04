import assert from 'node:assert/strict';
import test from 'node:test';

import { parseBridgeFactsDocument } from './parse.ts';

const emptyDocument = {
  format: 'bridge-facts',
  version: 1,
  tool: { name: 'dartograph', version: '0.1.0' },
  generatedAt: '2026-09-04T12:00:00Z',
  platform: 'dart',
  target: null,
  project: '/fixture',
  facts: [],
  limitations: [],
};

const validMethodFact = {
  kind: 'method-invoke',
  channel: 'dev.isthmus/camera',
  method: 'takePhoto',
  dynamic: false,
  location: { path: 'lib/camera.dart', line: 13, column: 18 },
  symbol: { qualifiedName: 'Camera.takePhoto', usr: 'dart:takePhoto' },
};

test('완전한 bridge-facts v1 문서를 파싱한다', () => {
  const parsed = parseBridgeFactsDocument(emptyDocument);

  assert.deepEqual(parsed, emptyDocument);
});

test('계약 밖 추가 필드는 검증 경계를 넘어 출력되지 않는다', () => {
  const parsed = parseBridgeFactsDocument({
    ...emptyDocument,
    target: 'flutter',
    privateDocumentField: 'do-not-copy',
    tool: { ...emptyDocument.tool, privateToolField: 'do-not-copy' },
    facts: [
      {
        kind: 'method-invoke',
        channel: 'dev.isthmus/camera',
        method: 'takePhoto',
        dynamic: false,
        privateFactField: 'do-not-copy',
        location: {
          path: 'lib/camera.dart',
          line: 1,
          column: 2,
          privatePath: '/private/source.dart',
        },
        symbol: {
          qualifiedName: 'Camera.takePhoto',
          usr: 'dart:takePhoto',
          privateToken: 'do-not-copy',
        },
      },
    ],
  });

  assert.equal(JSON.stringify(parsed).includes('private'), false);
  assert.deepEqual(parsed.facts[0]?.location, {
    path: 'lib/camera.dart',
    line: 1,
    column: 2,
  });
  assert.deepEqual(parsed.facts[0]?.symbol, {
    qualifiedName: 'Camera.takePhoto',
    usr: 'dart:takePhoto',
  });
});

test('target은 facts 존재 여부와 일치해야 한다', () => {
  assert.throws(
    () => parseBridgeFactsDocument({
      ...emptyDocument,
      facts: [
        {
          kind: 'method-invoke',
          channel: 'dev.isthmus/camera',
          method: 'takePhoto',
          dynamic: false,
          location: { path: 'lib/camera.dart', line: 1, column: 2 },
        },
      ],
    }),
    {
      name: 'BridgeFactsValidationError',
      message: 'Target must be set exactly when facts are present.',
    },
  );
  assert.throws(
    () => parseBridgeFactsDocument({ ...emptyDocument, target: 'flutter' }),
    {
      name: 'BridgeFactsValidationError',
      message: 'Target must be set exactly when facts are present.',
    },
  );
});

test('플랫폼은 자기 역할의 fact kind만 생산할 수 있다', () => {
  const invalidCases = [
    {
      platform: 'dart',
      fact: { ...validMethodFact, kind: 'method-handle' },
    },
    {
      platform: 'swift',
      fact: { ...validMethodFact, kind: 'method-invoke' },
    },
  ];

  for (const { platform, fact } of invalidCases) {
    assert.throws(
      () => parseBridgeFactsDocument({
        ...emptyDocument,
        platform,
        target: 'flutter',
        facts: [fact],
      }),
      {
        name: 'BridgeFactsValidationError',
        message: 'Fact kind is not valid for platform at index 0.',
      },
    );
  }
});

test('method가 아닌 fact에는 method 필드를 허용하지 않는다', () => {
  assert.throws(
    () => parseBridgeFactsDocument({
      ...emptyDocument,
      target: 'flutter',
      facts: [
        {
          kind: 'channel-create',
          channel: 'dev.isthmus/camera',
          method: 'smuggled\nmethod',
          dynamic: false,
          location: { path: 'lib/camera.dart', line: 1, column: 2 },
        },
      ],
    }),
    {
      name: 'BridgeFactsValidationError',
      message: 'Unexpected method at index 0.',
    },
  );
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
    [
      { ...emptyDocument, tool: { name: 'dartograph\nevil', version: '0.1.0' } },
      'Invalid tool metadata.',
    ],
    [
      { ...emptyDocument, tool: { name: 'dartograph', version: '0.1.0\u0000evil' } },
      'Invalid tool metadata.',
    ],
    [{ ...emptyDocument, generatedAt: 'not-a-date' }, 'Invalid generatedAt timestamp.'],
    [
      { ...emptyDocument, generatedAt: '2026-09-04T12:00:00' },
      'Invalid generatedAt timestamp.',
    ],
    [
      { ...emptyDocument, generatedAt: '2026-02-31T12:00:00Z' },
      'Invalid generatedAt timestamp.',
    ],
    [{ ...emptyDocument, platform: 'ruby' }, 'Unsupported bridge platform.'],
    [{ ...emptyDocument, target: 'cordova' }, 'Unsupported bridge target.'],
    [{ ...emptyDocument, project: '' }, 'Invalid project path.'],
    [{ ...emptyDocument, project: '/fixture\u0000other' }, 'Invalid project path.'],
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
      { ...validMethodFact, channel: 'dev.isthmus/\u0000camera' },
      'Invalid fact channel at index 0.',
    ],
    [
      { ...validMethodFact, method: undefined },
      'Method fact at index 0 requires a method name.',
    ],
    [
      { ...validMethodFact, method: 'take\nPhoto' },
      'Method fact at index 0 requires a method name.',
    ],
    [{ ...validMethodFact, dynamic: 'no' }, 'Invalid dynamic flag at index 0.'],
    [
      { ...validMethodFact, location: { path: '', line: 0, column: 0 } },
      'Invalid fact location at index 0.',
    ],
    [
      {
        ...validMethodFact,
        location: { path: '/private/Plugin.swift', line: 1, column: 1 },
      },
      'Invalid fact location at index 0.',
    ],
    [
      {
        ...validMethodFact,
        location: { path: '../private/Plugin.swift', line: 1, column: 1 },
      },
      'Invalid fact location at index 0.',
    ],
    [
      {
        ...validMethodFact,
        location: { path: 'C:\\private\\Plugin.swift', line: 1, column: 1 },
      },
      'Invalid fact location at index 0.',
    ],
    [
      {
        ...validMethodFact,
        location: { path: 'ios/Plugin\nInjected.swift', line: 1, column: 1 },
      },
      'Invalid fact location at index 0.',
    ],
    [
      {
        ...validMethodFact,
        location: {
          path: 'lib/camera.dart',
          line: Number.MAX_SAFE_INTEGER + 1,
          column: 1,
        },
      },
      'Invalid fact location at index 0.',
    ],
    [
      { ...validMethodFact, symbol: { qualifiedName: '' } },
      'Invalid fact symbol at index 0.',
    ],
    [
      { ...validMethodFact, symbol: { qualifiedName: 'Camera\u0000Plugin' } },
      'Invalid fact symbol at index 0.',
    ],
    [
      {
        ...validMethodFact,
        symbol: { qualifiedName: 'CameraPlugin.register', usr: 's:\rregister' },
      },
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
