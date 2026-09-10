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
  MAX_RETENTION_CALLER_ENTRIES,
  MAX_RETENTION_CALLERS,
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

test('호출이 여럿이면 전체 호출 위치를 결정적 순서로 실는다', () => {
  const dartWithMoreInvocations = parseBridgeFactsDocument({
    ...dartDocument,
    facts: [
      ...dartDocument.facts,
      {
        kind: 'method-invoke',
        channel: 'dev.isthmus/camera',
        method: 'takePhoto',
        dynamic: false,
        location: { path: 'lib/camera_bridge.dart', line: 2, column: 3 },
      },
      {
        kind: 'method-invoke',
        channel: 'dev.isthmus/camera',
        method: 'takePhoto',
        dynamic: false,
        location: { path: 'lib/other.dart', line: 9, column: 5 },
      },
    ],
  });
  const swiftWithUSRs = parseBridgeFactsDocument({
    ...swiftDocument,
    facts: swiftDocument.facts.map((fact) =>
      fact.kind === 'method-handle'
        ? { ...fact, symbol: { ...fact.symbol, usr: 's:CameraPlugin.register' } }
        : fact,
    ),
  });
  const joined = joinBridgeDocuments([dartWithMoreInvocations, swiftWithUSRs]);

  const document = createCartographRetentionsDocument(
    joined,
    '2026-09-04T13:00:00Z',
    '0.0.0',
  );

  const evidence = document.retentions[0]?.evidence;
  assert.deepEqual(evidence?.callers, [
    { platform: 'dart', path: 'lib/camera_bridge.dart', line: 2 },
    { platform: 'dart', path: 'lib/camera_bridge.dart', line: 6 },
    { platform: 'dart', path: 'lib/other.dart', line: 9 },
  ]);
  assert.deepEqual(evidence?.caller, evidence?.callers?.[0]);
  assert.equal(evidence?.callersOmitted, undefined);
});

test('호출 상한을 넘으면 잘린 목록과 계수를 실는다', () => {
  const invocationFacts = Array.from(
    { length: MAX_RETENTION_CALLERS + 5 },
    (_, index) => ({
      kind: 'method-invoke',
      channel: 'dev.isthmus/camera',
      method: 'takePhoto',
      dynamic: false,
      location: {
        path: `lib/file${String(index).padStart(4, '0')}.dart`,
        line: index + 1,
        column: 1,
      },
    }),
  );
  const dartWithMany = parseBridgeFactsDocument({
    ...dartDocument,
    facts: [...dartDocument.facts, ...invocationFacts],
  });
  const swiftWithUSRs = parseBridgeFactsDocument({
    ...swiftDocument,
    facts: swiftDocument.facts.map((fact) =>
      fact.kind === 'method-handle'
        ? { ...fact, symbol: { ...fact.symbol, usr: 's:CameraPlugin.register' } }
        : fact,
    ),
  });
  const joined = joinBridgeDocuments([dartWithMany, swiftWithUSRs]);

  const document = createCartographRetentionsDocument(
    joined,
    '2026-09-04T13:00:00Z',
    '0.0.0',
  );

  const evidence = document.retentions[0]?.evidence;
  assert.equal(evidence?.callers?.length, MAX_RETENTION_CALLERS);
  // 원본 fixture의 호출 1건과 새로 만든 105건을 합쳐 6건이 상한을 넘는다.
  assert.equal(evidence?.callersOmitted, 6);
  assert.deepEqual(
    evidence?.callers?.[MAX_RETENTION_CALLERS - 1],
    { platform: 'dart', path: 'lib/file0098.dart', line: 99 },
  );
  assert.deepEqual(
    evidence?.callers?.[0],
    { platform: 'dart', path: 'lib/camera_bridge.dart', line: 6 },
  );
});

test('문서 전체 호출자 예산을 넘으면 실패한다', () => {
  // 핸들러마다 근거가 하나씩 나오고 각 근거가 호출자를 다시 실으므로,
  // 1,000 메서드 × 핸들러 100 × 호출자 100 = 1,000,000건으로 예산을 넘는다.
  const methodCount = 1_000;
  const callersPerMethod = MAX_RETENTION_CALLERS;
  const handlersPerMethod = 100;
  const invocationFacts = [];
  const handlerFacts = [];
  for (let m = 0; m < methodCount; m++) {
    const channel = `dev.isthmus/c${m}`;
    for (let i = 0; i < callersPerMethod; i++) {
      invocationFacts.push({
        kind: 'method-invoke',
        channel,
        method: 'go',
        dynamic: false,
        location: { path: `lib/f${i}.dart`, line: i + 1, column: 1 },
      });
    }
    for (let h = 0; h < handlersPerMethod; h++) {
      handlerFacts.push({
        kind: 'method-handle',
        channel,
        method: 'go',
        dynamic: false,
        location: { path: `src/P${h}/M${m}.swift`, line: h + 1, column: 3 },
        symbol: { qualifiedName: `P${h}.M${m}.go`, usr: `s:p${h}m${m}` },
      });
    }
  }
  const joined = joinBridgeDocuments([
    parseBridgeFactsDocument({
      ...dartDocument,
      facts: invocationFacts,
    }),
    parseBridgeFactsDocument({
      ...swiftDocument,
      facts: handlerFacts,
    }),
  ]);

  assert.throws(
    () => createCartographRetentionsDocument(joined, '2026-09-10T00:00:00Z', '0.0.0'),
    /caller entries/u,
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
