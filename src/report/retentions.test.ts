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
  );

  assert.deepEqual(document, {
    format: 'external-retentions',
    version: 0,
    producedBy: { name: 'isthmus', version: '0.0.0' },
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

  const document = createCartographRetentionsDocument(joined, '2026-09-04T13:00:00Z');

  assert.equal(document.retentions.length, 1);
});

test('외부 보존 JSON 키를 재귀 정렬하고 마지막 개행을 붙인다', () => {
  const joined = joinBridgeDocuments([dartDocument, swiftDocument]);
  const document = createCartographRetentionsDocument(
    joined,
    '2026-09-04T13:00:00Z',
  );

  const encoded = encodeCartographRetentionsDocument(document);

  assert.ok(encoded.indexOf('"format"') < encoded.indexOf('"generatedAt"'));
  assert.ok(encoded.indexOf('"generatedAt"') < encoded.indexOf('"producedBy"'));
  assert.ok(encoded.indexOf('"producedBy"') < encoded.indexOf('"retentions"'));
  assert.ok(encoded.indexOf('"retentions"') < encoded.lastIndexOf('"version"'));
  assert.equal(encoded.endsWith('\n'), true);
  assert.equal(encoded, encodeCartographRetentionsDocument(document));
});

/** 저장된 교환 JSON을 제품 파서로 검증한다. */
async function loadDocument(relativePath: string): Promise<BridgeFactsDocument> {
  const text = await readFile(new URL(relativePath, import.meta.url), 'utf8');
  return parseBridgeFactsDocument(JSON.parse(text));
}
