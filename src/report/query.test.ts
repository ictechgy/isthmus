import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  parseBridgeFactsDocument,
  type BridgeFactsDocument,
} from '../exchange/parse.ts';
import { joinBridgeDocuments } from '../join/join.ts';
import { createBridgeQuery, encodeBridgeQuery } from './query.ts';

const dartDocument = await loadDocument(
  '../../experiments/phase-0/expected/dart.json',
);
const swiftDocument = await loadDocument(
  '../../experiments/phase-0/expected/swift.json',
);

test('채널 질의가 생성 위치와 등록 위치를 양방향으로 답한다', () => {
  const joined = joinBridgeDocuments([dartDocument, swiftDocument]);

  const document = createBridgeQuery(joined, 'dev.isthmus/camera');

  assert.equal(document.status, 'found');
  assert.equal(document.requested, 'dev.isthmus/camera');
  assert.equal(document.level, 'bridge');
  assert.deepEqual(document.result?.subject, {
    name: 'dev.isthmus/camera',
    qualifiedName: 'flutter:dev.isthmus/camera',
    kind: 'channel',
  });
  assert.deepEqual(document.result?.usedBy, [
    {
      platform: 'dart',
      location: {
        path: 'lib/camera_bridge.dart',
        line: 3,
        column: 23,
      },
    },
  ]);
  assert.deepEqual(document.result?.dependsOn, [
    {
      platform: 'swift',
      location: {
        path: 'ios/Runner/CameraPlugin.swift',
        line: 11,
        column: 17,
      },
    },
  ]);
  assert.deepEqual(document.limitations, joined.limitations);
});

test('메서드 질의가 호출 위치와 핸들러 위치를 양방향으로 답한다', () => {
  const joined = joinBridgeDocuments([dartDocument, swiftDocument]);

  const document = createBridgeQuery(joined, 'takePhoto');

  assert.equal(document.status, 'found');
  assert.deepEqual(document.result?.subject, {
    name: 'takePhoto',
    qualifiedName: 'flutter:dev.isthmus/camera#takePhoto',
    kind: 'method',
  });
  assert.deepEqual(document.result?.usedBy, [
    {
      platform: 'dart',
      location: {
        path: 'lib/camera_bridge.dart',
        line: 6,
        column: 23,
      },
    },
  ]);
  assert.deepEqual(document.result?.dependsOn, [
    {
      platform: 'swift',
      location: {
        path: 'ios/Runner/CameraPlugin.swift',
        line: 13,
        column: 18,
      },
      symbol: { qualifiedName: 'CameraPlugin.register' },
    },
  ]);
});

test('같은 메서드가 여러 채널에 있으면 후보를 주고 추측하지 않는다', () => {
  const dartWithSecondChannel = parseBridgeFactsDocument({
    ...dartDocument,
    facts: [
      ...dartDocument.facts,
      {
        kind: 'method-invoke',
        channel: 'dev.isthmus/secondary',
        method: 'takePhoto',
        dynamic: false,
        location: { path: 'lib/secondary.dart', line: 8, column: 19 },
      },
    ],
  });
  const swiftWithSecondChannel = parseBridgeFactsDocument({
    ...swiftDocument,
    facts: [
      ...swiftDocument.facts,
      {
        kind: 'method-handle',
        channel: 'dev.isthmus/secondary',
        method: 'takePhoto',
        dynamic: false,
        location: { path: 'ios/SecondaryPlugin.swift', line: 12, column: 18 },
        symbol: { qualifiedName: 'SecondaryPlugin.register' },
      },
    ],
  });
  const joined = joinBridgeDocuments([
    dartWithSecondChannel,
    swiftWithSecondChannel,
  ]);

  const document = createBridgeQuery(joined, 'takePhoto');

  assert.equal(document.status, 'ambiguous');
  assert.equal(document.result, undefined);
  assert.deepEqual(document.candidates, [
    {
      qualifiedName: 'flutter:dev.isthmus/camera#takePhoto',
    },
    {
      qualifiedName: 'flutter:dev.isthmus/secondary#takePhoto',
    },
  ]);

  const selected = createBridgeQuery(
    joined,
    'flutter:dev.isthmus/secondary#takePhoto',
  );

  assert.equal(selected.status, 'found');
  assert.equal(
    selected.result?.subject.qualifiedName,
    'flutter:dev.isthmus/secondary#takePhoto',
  );
});

test('같은 채널이 여러 target에 있으면 후보를 주고 qualifiedName으로 고른다', () => {
  const reactNativeCaller = parseBridgeFactsDocument({
    ...dartDocument,
    platform: 'js',
    target: 'react-native',
  });
  const reactNativeReceiver = parseBridgeFactsDocument({
    ...swiftDocument,
    target: 'react-native',
  });
  const joined = joinBridgeDocuments([
    dartDocument,
    swiftDocument,
    reactNativeCaller,
    reactNativeReceiver,
  ]);

  const ambiguous = createBridgeQuery(joined, 'dev.isthmus/camera');

  assert.equal(ambiguous.status, 'ambiguous');
  assert.deepEqual(ambiguous.candidates, [
    { qualifiedName: 'flutter:dev.isthmus/camera' },
    { qualifiedName: 'react-native:dev.isthmus/camera' },
  ]);

  const selected = createBridgeQuery(
    joined,
    'react-native:dev.isthmus/camera',
  );
  assert.equal(selected.status, 'found');
  assert.equal(
    selected.result?.subject.qualifiedName,
    'react-native:dev.isthmus/camera',
  );
});

test('query JSON 키를 재귀 정렬하고 마지막 개행을 붙인다', () => {
  const joined = joinBridgeDocuments([dartDocument, swiftDocument]);
  const document = createBridgeQuery(joined, 'takePhoto');

  const encoded = encodeBridgeQuery(document);

  assert.ok(encoded.indexOf('"level"') < encoded.indexOf('"limitations"'));
  assert.ok(encoded.indexOf('"limitations"') < encoded.indexOf('"requested"'));
  assert.ok(encoded.indexOf('"requested"') < encoded.indexOf('"result"'));
  assert.ok(encoded.indexOf('"result"') < encoded.indexOf('"status"'));
  assert.equal(encoded.endsWith('\n'), true);
  assert.equal(encoded, encodeBridgeQuery(document));
});

/** 저장된 교환 JSON을 제품 파서로 검증한다. */
async function loadDocument(relativePath: string): Promise<BridgeFactsDocument> {
  const text = await readFile(new URL(relativePath, import.meta.url), 'utf8');
  return parseBridgeFactsDocument(JSON.parse(text));
}
