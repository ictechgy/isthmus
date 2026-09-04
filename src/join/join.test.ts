import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  parseBridgeFactsDocument,
  type BridgeFactsDocument,
} from '../exchange/parse.ts';
import { joinBridgeDocuments } from './join.ts';

const dartDocument = await loadDocument(
  '../../experiments/phase-0/expected/dart.json',
);
const swiftDocument = await loadDocument(
  '../../experiments/phase-0/expected/swift.json',
);

test('채널 키 하나에 생성과 등록 위치를 모두 연결한다', () => {
  const result = joinBridgeDocuments([dartDocument, swiftDocument]);

  assert.deepEqual(result.matchedChannels, [
    {
      target: 'flutter',
      channel: 'dev.isthmus/camera',
      creations: [
        {
          platform: 'dart',
          location: {
            path: 'lib/camera_bridge.dart',
            line: 3,
            column: 23,
          },
        },
      ],
      registrations: [
        {
          platform: 'swift',
          location: {
            path: 'ios/Runner/CameraPlugin.swift',
            line: 11,
            column: 17,
          },
        },
      ],
    },
  ]);
});

test('채널 증거는 입력 순서와 중복에 무관하게 정렬한다', () => {
  const extraCreation = {
    kind: 'channel-create',
    channel: 'dev.isthmus/camera',
    dynamic: false,
    location: { path: 'lib/a_bridge.dart', line: 2, column: 7 },
  };
  const extraRegistration = {
    kind: 'channel-register',
    channel: 'dev.isthmus/camera',
    dynamic: false,
    location: { path: 'ios/APlugin.swift', line: 4, column: 9 },
  };
  const caller = parseBridgeFactsDocument({
    ...dartDocument,
    facts: [...dartDocument.facts, extraCreation, extraCreation],
  });
  const receiver = parseBridgeFactsDocument({
    ...swiftDocument,
    facts: [...swiftDocument.facts, extraRegistration, extraRegistration],
  });

  const result = joinBridgeDocuments([receiver, caller]);
  const channel = result.matchedChannels[0];

  assert.deepEqual(channel?.creations.map(({ location }) => location.path), [
    'lib/a_bridge.dart',
    'lib/camera_bridge.dart',
  ]);
  assert.deepEqual(channel?.registrations.map(({ location }) => location.path), [
    'ios/APlugin.swift',
    'ios/Runner/CameraPlugin.swift',
  ]);
});

test('메서드 키 하나에 호출과 핸들러 위치를 모두 연결한다', () => {
  const result = joinBridgeDocuments([dartDocument, swiftDocument]);

  assert.deepEqual(result.matchedMethods, [
    {
      target: 'flutter',
      channel: 'dev.isthmus/camera',
      method: 'takePhoto',
      invocations: [
        {
          platform: 'dart',
          location: {
            path: 'lib/camera_bridge.dart',
            line: 6,
            column: 23,
          },
        },
      ],
      handlers: [
        {
          platform: 'swift',
          location: {
            path: 'ios/Runner/CameraPlugin.swift',
            line: 13,
            column: 18,
          },
          symbol: { qualifiedName: 'CameraPlugin.register' },
        },
      ],
    },
  ]);
});

test('핸들러 없는 호출을 논리 메서드와 모든 호출 위치로 남긴다', () => {
  const result = joinBridgeDocuments([dartDocument, swiftDocument]);

  assert.deepEqual(result.unhandledInvocations, [
    {
      target: 'flutter',
      channel: 'dev.isthmus/camera',
      method: 'takePhotos',
      invocations: [
        {
          platform: 'dart',
          location: {
            path: 'lib/camera_bridge.dart',
            line: 17,
            column: 23,
          },
        },
      ],
    },
  ]);
});

test('호출 없는 핸들러를 논리 메서드와 모든 핸들러 위치로 남긴다', () => {
  const result = joinBridgeDocuments([dartDocument, swiftDocument]);

  assert.deepEqual(result.handlersWithoutInvocations, [
    {
      target: 'flutter',
      channel: 'dev.isthmus/camera',
      method: 'captureStill',
      handlers: [
        {
          platform: 'swift',
          location: {
            path: 'ios/Runner/CameraPlugin.swift',
            line: 13,
            column: 31,
          },
          symbol: { qualifiedName: 'CameraPlugin.register' },
        },
      ],
    },
    {
      target: 'flutter',
      channel: 'dev.isthmus/camera',
      method: 'recordVideo',
      handlers: [
        {
          platform: 'swift',
          location: {
            path: 'ios/Runner/CameraPlugin.swift',
            line: 15,
            column: 18,
          },
          symbol: { qualifiedName: 'CameraPlugin.register' },
        },
      ],
    },
  ]);
});

test('등록 없는 채널 생성을 논리 채널과 모든 생성 위치로 남긴다', () => {
  const documentWithOrphan = parseBridgeFactsDocument({
    ...dartDocument,
    facts: [
      ...dartDocument.facts,
      {
        kind: 'channel-create',
        channel: 'dev.isthmus/orphan',
        dynamic: false,
        location: {
          path: 'lib/orphan_bridge.dart',
          line: 2,
          column: 17,
        },
      },
    ],
  });

  const result = joinBridgeDocuments([documentWithOrphan, swiftDocument]);

  assert.deepEqual(result.unregisteredChannelCreations, [
    {
      target: 'flutter',
      channel: 'dev.isthmus/orphan',
      creations: [
        {
          platform: 'dart',
          location: {
            path: 'lib/orphan_bridge.dart',
            line: 2,
            column: 17,
          },
        },
      ],
    },
  ]);
});

test('입력 limitations를 플랫폼과 생산 도구 출처와 함께 전달한다', () => {
  const result = joinBridgeDocuments([dartDocument, swiftDocument]);

  assert.deepEqual(result.limitations, [
    {
      platform: 'dart',
      tool: 'isthmus-phase0-dart',
      message:
        'dynamic-channel-names: 1 channel constructors use a non-literal name',
    },
    {
      platform: 'dart',
      tool: 'isthmus-phase0-dart',
      message:
        'dynamic-method-names: 1 method invocations use a non-literal name',
    },
    {
      platform: 'swift',
      tool: 'isthmus-phase0-swift',
      message:
        'dynamic-channel-names: 1 channel constructors use a non-literal name',
    },
    {
      platform: 'swift',
      tool: 'isthmus-phase0-swift',
      message:
        'missing-handler-usrs: 3 method handlers have only a qualified name',
    },
  ]);
});

test('mixed-targets 문서는 거짓 연결과 불일치를 만들지 않는다', () => {
  const mixedSwiftDocument = parseBridgeFactsDocument({
    ...swiftDocument,
    limitations: [
      ...swiftDocument.limitations,
      "mixed-targets: facts come from more than one bridge; 'target' is the majority",
    ],
  });

  const result = joinBridgeDocuments([dartDocument, mixedSwiftDocument]);

  assert.deepEqual(result.matchedChannels, []);
  assert.deepEqual(result.unregisteredChannelCreations, []);
  assert.deepEqual(result.matchedMethods, []);
  assert.deepEqual(result.unhandledInvocations, []);
  assert.deepEqual(result.handlersWithoutInvocations, []);
  assert.equal(
    result.limitations.some(({ message }) => message.startsWith('mixed-targets:')),
    true,
  );
});

test('입력 생성 시각이 하루 넘게 다르면 신선도 한계를 추가한다', () => {
  const staleDartDocument = parseBridgeFactsDocument({
    ...dartDocument,
    generatedAt: '2026-09-01T12:00:00Z',
  });

  const result = joinBridgeDocuments([staleDartDocument, swiftDocument]);

  assert.equal(
    result.limitations.some(
      (limitation) =>
        limitation.platform === 'cross-platform' &&
        limitation.tool === 'isthmus' &&
        limitation.message ===
          'input-freshness: bridge documents differ by 72 hours',
    ),
    true,
  );
});

test('같은 메서드의 여러 핸들러 위치를 한 논리 매치에 정렬한다', () => {
  const swiftWithDuplicateHandler = parseBridgeFactsDocument({
    ...swiftDocument,
    facts: [
      ...swiftDocument.facts,
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
        symbol: { qualifiedName: 'GeneratedCameraPlugin.handle' },
      },
    ],
  });

  const result = joinBridgeDocuments([
    swiftWithDuplicateHandler,
    dartDocument,
  ]);

  assert.equal(result.matchedMethods.length, 1);
  assert.deepEqual(
    result.matchedMethods[0]?.handlers.map(({ location }) => location),
    [
      {
        path: 'ios/Generated/CameraPlugin.swift',
        line: 5,
        column: 9,
      },
      {
        path: 'ios/Runner/CameraPlugin.swift',
        line: 13,
        column: 18,
      },
    ],
  );
});

/** 저장된 JSON을 제품 파서로 검증해 테스트 입력으로 사용한다. */
async function loadDocument(relativePath: string): Promise<BridgeFactsDocument> {
  const text = await readFile(new URL(relativePath, import.meta.url), 'utf8');
  return parseBridgeFactsDocument(JSON.parse(text));
}
