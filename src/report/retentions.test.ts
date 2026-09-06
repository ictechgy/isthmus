import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  parseBridgeFactsDocument,
  type BridgeFactsDocument,
} from '../exchange/parse.ts';
import { joinBridgeDocuments } from '../join/join.ts';
import {
  createCartographRetentionsDocument,
  encodeCartographRetentionsDocument,
  validateCartographRetentionInputs,
} from './retentions.ts';

const dartDocument = await loadDocument(
  '../../experiments/phase-0/expected/dart.json',
);
const swiftDocument = await loadDocument(
  '../../experiments/phase-0/expected/swift.json',
);

test('매치된 Swift 심볼에 Dart 호출 근거를 붙여 보존 문서를 만든다', () => {
  const swiftWithUSRs = parseBridgeFactsDocument({
    ...swiftDocument,
    facts: swiftDocument.facts.map((fact) =>
      fact.kind === 'method-handle'
        ? {
            ...fact,
            symbol: { ...fact.symbol, usr: 's:CameraPlugin.register' },
          }
        : fact,
    ),
  });
  const joined = joinBridgeDocuments([dartDocument, swiftWithUSRs]);

  const document = createCartographRetentionsDocument(
    joined,
    '2026-09-04T13:00:00Z',
    '1.2.3',
  );

  assert.deepEqual(document, {
    format: 'external-retentions',
    version: 0,
    producedBy: { name: 'isthmus', version: '1.2.3' },
    generatedAt: '2026-09-04T13:00:00Z',
    retentions: [
      {
        symbol: {
          usr: 's:CameraPlugin.register',
          qualifiedName: 'CameraPlugin.register',
        },
        reason: 'bridge',
        evidence: {
          channel: 'dev.isthmus/camera',
          method: 'takePhoto',
          caller: {
            platform: 'dart',
            path: 'lib/camera_bridge.dart',
            line: 6,
          },
        },
      },
    ],
  });
});

test('같은 심볼의 여러 핸들러 위치를 보존 근거 하나로 합친다', () => {
  const factsWithUSRs = swiftDocument.facts.map((fact) =>
    fact.kind === 'method-handle'
      ? {
          ...fact,
          symbol: { ...fact.symbol, usr: 's:CameraPlugin.register' },
        }
      : fact,
  );
  const swiftWithDuplicate = parseBridgeFactsDocument({
    ...swiftDocument,
    facts: [
      ...factsWithUSRs,
      {
        kind: 'method-handle',
        channel: 'dev.isthmus/camera',
        method: 'takePhoto',
        dynamic: false,
        location: {
          path: 'ios/Generated/CameraPlugin.swift',
          line: 5,
          column: 9,
        },
        symbol: {
          qualifiedName: 'CameraPlugin.register',
          usr: 's:CameraPlugin.register',
        },
      },
    ],
  });
  const joined = joinBridgeDocuments([dartDocument, swiftWithDuplicate]);

  const document = createCartographRetentionsDocument(
    joined,
    '2026-09-04T13:00:00Z',
    '0.0.0',
  );

  assert.equal(document.retentions.length, 1);
});

test('USR과 qualifiedName dedup namespace가 충돌하지 않는다', () => {
  const swiftWithCollidingSymbols = parseBridgeFactsDocument({
    ...swiftDocument,
    facts: [
      ...swiftDocument.facts,
      {
        kind: 'method-handle',
        channel: 'dev.isthmus/camera',
        method: 'takePhoto',
        dynamic: false,
        location: {
          path: 'ios/Generated/OtherPlugin.swift',
          line: 5,
          column: 9,
        },
        symbol: {
          qualifiedName: 'OtherPlugin.handle',
          usr: 'name:CameraPlugin.register',
        },
      },
    ],
  });
  const joined = joinBridgeDocuments([dartDocument, swiftWithCollidingSymbols]);

  const document = createCartographRetentionsDocument(
    joined,
    '2026-09-04T13:00:00Z',
    '0.0.0',
  );

  assert.equal(document.retentions.length, 2);
  assert.deepEqual(
    document.retentions.map(({ symbol }) => symbol.qualifiedName),
    ['OtherPlugin.handle', 'CameraPlugin.register'],
  );
});

test('외부 보존 JSON 키를 재귀 정렬하고 마지막 개행을 붙인다', () => {
  const joined = joinBridgeDocuments([dartDocument, swiftDocument]);
  const document = createCartographRetentionsDocument(
    joined,
    '2026-09-04T13:00:00Z',
    '0.0.0',
  );

  const encoded = encodeCartographRetentionsDocument(document);

  assert.ok(encoded.indexOf('"format"') < encoded.indexOf('"generatedAt"'));
  assert.ok(encoded.indexOf('"generatedAt"') < encoded.indexOf('"producedBy"'));
  assert.ok(encoded.indexOf('"producedBy"') < encoded.indexOf('"retentions"'));
  assert.ok(encoded.indexOf('"retentions"') < encoded.lastIndexOf('"version"'));
  assert.equal(encoded.endsWith('\n'), true);
  assert.equal(encoded, encodeCartographRetentionsDocument(document));
});

test('조인이 보류된 결과로 빈 보존 문서를 만들지 않는다', () => {
  const joined = joinBridgeDocuments([
    dartDocument,
    parseBridgeFactsDocument({
      ...swiftDocument,
      limitations: [...swiftDocument.limitations, 'mixed-targets: multiple bridges'],
    }),
  ]);

  assert.throws(
    () => createCartographRetentionsDocument(
      joined,
      '2026-09-04T13:00:00Z',
      '0.0.0',
    ),
    /Cannot create retentions from a deferred bridge join\./,
  );
});

test('심볼 없는 매치 Swift 핸들러를 조용히 빼지 않는다', () => {
  const swiftWithoutSymbols = parseBridgeFactsDocument({
    ...swiftDocument,
    facts: swiftDocument.facts.map(({ symbol: _symbol, ...fact }) => fact),
    limitations: swiftDocument.limitations.filter(
      (message) => !message.startsWith('missing-handler-usrs:'),
    ),
  });
  const joined = joinBridgeDocuments([dartDocument, swiftWithoutSymbols]);

  assert.equal(joined.matchedMethods.length, 1);
  assert.throws(
    () => createCartographRetentionsDocument(
      joined,
      '2026-09-04T13:00:00Z',
      '0.0.0',
    ),
    /Cannot produce retention evidence for 1 matched swift handlers without a symbol; regenerate the swift document with a producer that attaches handler symbols\./,
  );
});

test('호출자 없는 핸들러는 심볼이 없어도 보존 실패로 보지 않는다', () => {
  const swiftWithoutSymbols = parseBridgeFactsDocument({
    ...swiftDocument,
    facts: swiftDocument.facts.map((fact) =>
      fact.kind === 'method-handle' && fact.method === 'takePhoto'
        ? fact
        : Object.fromEntries(
            Object.entries(fact).filter(([key]) => key !== 'symbol'),
          ),
    ),
  });
  const joined = joinBridgeDocuments([dartDocument, swiftWithoutSymbols]);

  const document = createCartographRetentionsDocument(
    joined,
    '2026-09-04T13:00:00Z',
    '0.0.0',
  );

  assert.equal(document.retentions.length, 1);
});

test('cartograph 보존은 수신 측 Swift 문서를 요구한다', () => {
  const kotlinDocument = parseBridgeFactsDocument({
    ...swiftDocument,
    platform: 'kotlin',
    tool: { name: 'kartograph', version: '0.1.0' },
    facts: swiftDocument.facts.map((fact) => ({
      ...fact,
      location: { ...fact.location, path: 'android/src/CameraPlugin.kt' },
    })),
  });

  assert.throws(
    () => validateCartographRetentionInputs([dartDocument, kotlinDocument]),
    /Retentions for cartograph require at least one swift bridge facts document; run a swift producer for the receiver side\./,
  );
  assert.equal(
    validateCartographRetentionInputs([dartDocument, swiftDocument]),
    undefined,
  );
});

/** 저장된 교환 JSON을 제품 파서로 검증한다. */
async function loadDocument(relativePath: string): Promise<BridgeFactsDocument> {
  const text = await readFile(new URL(relativePath, import.meta.url), 'utf8');
  return parseBridgeFactsDocument(JSON.parse(text));
}
