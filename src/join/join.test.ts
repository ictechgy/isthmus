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

  assert.equal(result.deferred, false);
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

test('생성 없는 채널 등록을 논리 채널과 모든 등록 위치로 남긴다', () => {
  const receiverWithOrphan = parseBridgeFactsDocument({
    ...swiftDocument,
    facts: [
      ...swiftDocument.facts,
      {
        kind: 'channel-register',
        channel: 'dev.isthmus/native-only',
        dynamic: false,
        location: {
          path: 'ios/NativeOnlyPlugin.swift',
          line: 4,
          column: 9,
        },
      },
    ],
  });

  const result = joinBridgeDocuments([dartDocument, receiverWithOrphan]);

  assert.deepEqual(result.registrationsWithoutCreations, [
    {
      target: 'flutter',
      channel: 'dev.isthmus/native-only',
      registrations: [
        {
          platform: 'swift',
          location: {
            path: 'ios/NativeOnlyPlugin.swift',
            line: 4,
            column: 9,
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
      tool: 'isthmus',
      message:
        'unjoined-dynamic-channels: 1 channel facts with a non-literal name were not joined',
    },
    {
      platform: 'dart',
      tool: 'isthmus',
      message:
        'unjoined-dynamic-methods: 1 method facts with a non-literal name were not joined',
    },
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
      tool: 'isthmus',
      message:
        'unjoined-dynamic-channels: 1 channel facts with a non-literal name were not joined',
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

test('생산자가 신고하지 않아도 조인하지 못한 dynamic 사실을 센다', () => {
  const silentDart = parseBridgeFactsDocument({
    ...dartDocument,
    limitations: [],
  });
  const silentSwift = parseBridgeFactsDocument({
    ...swiftDocument,
    limitations: swiftDocument.limitations.filter(
      (message) => !message.startsWith('dynamic-'),
    ),
  });

  const result = joinBridgeDocuments([silentDart, silentSwift]);

  assert.deepEqual(
    result.limitations.filter(({ tool }) => tool === 'isthmus'),
    [
      {
        platform: 'dart',
        tool: 'isthmus',
        message:
          'unjoined-dynamic-channels: 1 channel facts with a non-literal name were not joined',
      },
      {
        platform: 'dart',
        tool: 'isthmus',
        message:
          'unjoined-dynamic-methods: 1 method facts with a non-literal name were not joined',
      },
      {
        platform: 'swift',
        tool: 'isthmus',
        message:
          'unjoined-dynamic-channels: 1 channel facts with a non-literal name were not joined',
      },
    ],
  );
});

test('같은 플랫폼 문서 여러 개의 dynamic 사실을 한 한계로 합산한다', () => {
  const dynamicInvocation = {
    kind: 'method-invoke',
    channel: 'dev.isthmus/camera',
    method: 'method',
    dynamic: true,
    location: { path: 'lib/other_bridge.dart', line: 9, column: 3 },
  };
  const secondDart = parseBridgeFactsDocument({
    ...dartDocument,
    facts: [dynamicInvocation],
    limitations: [],
  });

  const result = joinBridgeDocuments([dartDocument, secondDart, swiftDocument]);

  assert.deepEqual(
    result.limitations.filter(
      ({ tool, platform }) => tool === 'isthmus' && platform === 'dart',
    ),
    [
      {
        platform: 'dart',
        tool: 'isthmus',
        message:
          'unjoined-dynamic-channels: 1 channel facts with a non-literal name were not joined',
      },
      {
        platform: 'dart',
        tool: 'isthmus',
        message:
          'unjoined-dynamic-methods: 2 method facts with a non-literal name were not joined',
      },
    ],
  );
});

test('같은 위치의 중복 dynamic 사실을 한 번만 센다', () => {
  const duplicatedDart = parseBridgeFactsDocument({
    ...dartDocument,
    facts: [...dartDocument.facts].reverse().concat([...dartDocument.facts]),
    limitations: [],
  });

  const result = joinBridgeDocuments([duplicatedDart, swiftDocument]);

  assert.deepEqual(
    result.limitations.filter(
      ({ tool, platform }) => tool === 'isthmus' && platform === 'dart',
    ),
    [
      {
        platform: 'dart',
        tool: 'isthmus',
        message:
          'unjoined-dynamic-channels: 1 channel facts with a non-literal name were not joined',
      },
      {
        platform: 'dart',
        tool: 'isthmus',
        message:
          'unjoined-dynamic-methods: 1 method facts with a non-literal name were not joined',
      },
    ],
  );
});

test('서로 다른 문서의 같은 위치 dynamic 사실도 한 번만 센다', () => {
  const sameDart = parseBridgeFactsDocument({
    ...dartDocument,
    facts: dartDocument.facts.filter((fact) => fact.dynamic),
    limitations: [],
  });

  const result = joinBridgeDocuments([dartDocument, sameDart, swiftDocument]);

  assert.deepEqual(
    result.limitations.filter(
      ({ tool, platform }) => tool === 'isthmus' && platform === 'dart',
    ),
    [
      {
        platform: 'dart',
        tool: 'isthmus',
        message:
          'unjoined-dynamic-channels: 1 channel facts with a non-literal name were not joined',
      },
      {
        platform: 'dart',
        tool: 'isthmus',
        message:
          'unjoined-dynamic-methods: 1 method facts with a non-literal name were not joined',
      },
    ],
  );
});

test('생산자가 신고한 개수와 무관하게 미귀속 핸들러를 직접 센다', () => {
  const unattributedSwift = parseBridgeFactsDocument({
    ...swiftDocument,
    facts: [
      ...swiftDocument.facts,
      {
        kind: 'method-handle',
        channel: null,
        method: 'takePhotos',
        dynamic: false,
        location: { path: 'ios/Runner/DetachedHandler.swift', line: 4, column: 10 },
      },
      {
        kind: 'method-handle',
        channel: null,
        method: 'recordVideo',
        dynamic: false,
        location: { path: 'ios/Runner/DetachedHandler.swift', line: 9, column: 10 },
      },
    ],
    limitations: [
      ...swiftDocument.limitations,
      'unattributed-method-handles: 1 handler has no channel',
    ],
  });

  const result = joinBridgeDocuments([dartDocument, unattributedSwift]);

  assert.deepEqual(
    result.limitations.filter(({ message }) =>
      message.startsWith('unjoined-unattributed-handlers:'),
    ),
    [
      {
        platform: 'swift',
        tool: 'isthmus',
        message:
          'unjoined-unattributed-handlers: 2 method handler facts without a channel were not joined',
      },
    ],
  );
});

test('미귀속이면서 dynamic인 핸들러를 두 번 세지 않는다', () => {
  const dynamicUnattributedSwift = parseBridgeFactsDocument({
    ...swiftDocument,
    facts: [
      ...swiftDocument.facts,
      {
        kind: 'method-handle',
        channel: null,
        method: 'takePhotos',
        dynamic: true,
        location: { path: 'ios/Runner/DetachedHandler.swift', line: 4, column: 10 },
      },
    ],
    limitations: [
      ...swiftDocument.limitations,
      'unattributed-method-handles: 1 handler has no channel',
    ],
  });

  const result = joinBridgeDocuments([dartDocument, dynamicUnattributedSwift]);

  assert.equal(
    result.limitations.some(({ message }) =>
      message.startsWith('unjoined-unattributed-handlers:'),
    ),
    false,
  );
  assert.deepEqual(
    result.limitations.filter(
      ({ message, platform }) =>
        platform === 'swift' &&
        message.startsWith('unjoined-dynamic-methods:'),
    ),
    [
      {
        platform: 'swift',
        tool: 'isthmus',
        message:
          'unjoined-dynamic-methods: 1 method facts with a non-literal name were not joined',
      },
    ],
  );
});

test('정적 사실만 있는 입력에는 dynamic 한계를 만들지 않는다', () => {
  const staticDart = parseBridgeFactsDocument({
    ...dartDocument,
    facts: dartDocument.facts.filter((fact) => !fact.dynamic),
    limitations: [],
  });
  const staticSwift = parseBridgeFactsDocument({
    ...swiftDocument,
    facts: swiftDocument.facts.filter((fact) => !fact.dynamic),
    limitations: [],
  });

  const result = joinBridgeDocuments([staticDart, staticSwift]);

  assert.deepEqual(result.limitations, []);
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

  assert.equal(result.deferred, true);
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

test('mixed-targets limitation의 명백한 문구 변형도 보수적으로 보류한다', () => {
  const messages = [
    ' Mixed-Targets: multiple bridges',
    'MIXED-TARGETS multiple bridges',
    'mixed-targets',
    'Detected mixed-targets: dart and swift facts',
    'mixed-targets, dart and swift facts',
    'mixed-targets. Facts span two bridges.',
  ];

  for (const message of messages) {
    const mixedSwiftDocument = parseBridgeFactsDocument({
      ...swiftDocument,
      limitations: [...swiftDocument.limitations, message],
    });

    const result = joinBridgeDocuments([dartDocument, mixedSwiftDocument]);

    assert.equal(result.deferred, true, message);
  }
});

test('channel null handler는 문자열 null 채널과 연결되지 않는다', () => {
  const caller = parseBridgeFactsDocument({
    ...dartDocument,
    limitations: [],
    facts: [
      {
        kind: 'method-invoke',
        channel: 'null',
        method: 'takePhoto',
        dynamic: false,
        location: { path: 'lib/null_channel.dart', line: 1, column: 1 },
      },
    ],
  });
  const receiver = parseBridgeFactsDocument({
    ...swiftDocument,
    limitations: ['unattributed-method-handles: 1 handler has no channel'],
    facts: [
      {
        kind: 'method-handle',
        channel: null,
        method: 'takePhoto',
        dynamic: false,
        location: { path: 'ios/Detached.swift', line: 1, column: 1 },
      },
    ],
  });

  const result = joinBridgeDocuments([caller, receiver]);

  assert.deepEqual(result.matchedMethods, []);
  assert.equal(result.unhandledInvocations[0]?.channel, 'null');
  assert.deepEqual(result.handlersWithoutInvocations, []);
});

test('서로 다른 project 문서는 같은 브리지로 조인하지 않는다', () => {
  const otherProject = parseBridgeFactsDocument({
    ...swiftDocument,
    project: '/another-project',
  });

  assert.throws(
    () => joinBridgeDocuments([dartDocument, otherProject]),
    {
      name: 'BridgeJoinValidationError',
      message:
        'Bridge documents must describe the same project; regenerate them from one project root.',
    },
  );
});

test('호출 측 문서만 있는 조인은 한쪽 관찰을 불일치로 보고하지 않는다', () => {
  assert.throws(
    () => joinBridgeDocuments([dartDocument, dartDocument]),
    {
      name: 'BridgeJoinValidationError',
      message:
        'Bridge documents must include at least one caller platform (dart, js) document '
        + 'and one receiver platform (swift, kotlin) document; run a producer for the missing side.',
    },
  );
});

test('수신 측 문서만 있는 조인도 같은 이유로 거부한다', () => {
  assert.throws(
    () => joinBridgeDocuments([swiftDocument, swiftDocument]),
    {
      name: 'BridgeJoinValidationError',
    },
  );
});

test('사실이 없는 수신 측 문서도 플랫폼 구성 요건을 충족한다', () => {
  const emptyReceiver = parseBridgeFactsDocument({
    ...swiftDocument,
    target: null,
    facts: [],
  });

  const result = joinBridgeDocuments([dartDocument, emptyReceiver]);

  assert.equal(result.deferred, false);
  assert.equal(result.unhandledInvocations.length >= 1, true);
});

test('조인 문서 수가 안전 상한을 넘으면 그룹 생성 전에 거부한다', () => {
  const maximumDocuments = 256;

  assert.throws(
    () => joinBridgeDocuments(Array(maximumDocuments + 1).fill(dartDocument)),
    {
      name: 'BridgeJoinValidationError',
      message: `Bridge join exceeds the ${maximumDocuments} document limit.`,
    },
  );
});

test('한 그룹의 대량 endpoint를 호출 인자 spread 없이 중복 제거한다', () => {
  const makeDocument = (startLine: number): BridgeFactsDocument => ({
    ...dartDocument,
    limitations: [],
    facts: Array.from({ length: 70_000 }, (_, index) => ({
      kind: 'method-invoke',
      channel: 'dev.isthmus/large',
      method: 'invoke',
      dynamic: false,
      location: {
        path: 'lib/large.dart',
        line: startLine + index,
        column: 1,
      },
    })),
  });
  const emptyReceiver: BridgeFactsDocument = {
    ...swiftDocument,
    target: null,
    facts: [],
  };

  const result = joinBridgeDocuments([
    makeDocument(1),
    makeDocument(70_001),
    emptyReceiver,
  ]);

  assert.equal(result.unhandledInvocations[0]?.invocations.length, 140_000);
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
