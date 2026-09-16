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

test('입력 limitations를 플랫폼·target·생산 도구 출처와 함께 전달한다', () => {
  const result = joinBridgeDocuments([dartDocument, swiftDocument]);

  assert.deepEqual(result.limitations, [
    {
      platform: 'dart',
      target: 'flutter',
      tool: 'isthmus',
      origin: 'consumer',
      message:
        'unjoined-dynamic-channels: 1 channel facts with a non-literal name were not joined',
    },
    {
      platform: 'dart',
      target: 'flutter',
      tool: 'isthmus',
      origin: 'consumer',
      message:
        'unjoined-dynamic-methods: 1 method facts with a non-literal name were not joined',
    },
    {
      platform: 'dart',
      target: 'flutter',
      tool: 'isthmus-phase0-dart',
      message:
        'dynamic-channel-names: 1 channel constructors use a non-literal name',
    },
    {
      platform: 'dart',
      target: 'flutter',
      tool: 'isthmus-phase0-dart',
      message:
        'dynamic-method-names: 1 method invocations use a non-literal name',
    },
    {
      platform: 'swift',
      target: 'flutter',
      tool: 'isthmus',
      origin: 'consumer',
      message:
        'unjoined-dynamic-channels: 1 channel facts with a non-literal name were not joined',
    },
    {
      platform: 'swift',
      target: 'flutter',
      tool: 'isthmus-phase0-swift',
      message:
        'dynamic-channel-names: 1 channel constructors use a non-literal name',
    },
    {
      platform: 'swift',
      target: 'flutter',
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
        target: 'flutter',
        tool: 'isthmus',
        origin: 'consumer',
        message:
          'unjoined-dynamic-channels: 1 channel facts with a non-literal name were not joined',
      },
      {
        platform: 'dart',
        target: 'flutter',
        tool: 'isthmus',
        origin: 'consumer',
        message:
          'unjoined-dynamic-methods: 1 method facts with a non-literal name were not joined',
      },
      {
        platform: 'swift',
        target: 'flutter',
        tool: 'isthmus',
        origin: 'consumer',
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
        target: 'flutter',
        tool: 'isthmus',
        origin: 'consumer',
        message:
          'unjoined-dynamic-channels: 1 channel facts with a non-literal name were not joined',
      },
      {
        platform: 'dart',
        target: 'flutter',
        tool: 'isthmus',
        origin: 'consumer',
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
        target: 'flutter',
        tool: 'isthmus',
        origin: 'consumer',
        message:
          'unjoined-dynamic-channels: 1 channel facts with a non-literal name were not joined',
      },
      {
        platform: 'dart',
        target: 'flutter',
        tool: 'isthmus',
        origin: 'consumer',
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
        target: 'flutter',
        tool: 'isthmus',
        origin: 'consumer',
        message:
          'unjoined-dynamic-channels: 1 channel facts with a non-literal name were not joined',
      },
      {
        platform: 'dart',
        target: 'flutter',
        tool: 'isthmus',
        origin: 'consumer',
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
        target: 'flutter',
        tool: 'isthmus',
        origin: 'consumer',
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
        target: 'flutter',
        tool: 'isthmus',
        origin: 'consumer',
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
  assert.deepEqual(
    result.limitations
      .filter(({ platform }) => platform === 'swift')
      .map(({ target }) => target),
    [null, null, null, null],
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

test('낱말 안에 붙은 mixed-targets 표기는 보류의 근거로 삼지 않는다', () => {
  const messages = [
    'producer does not support non-mixed-targets workspaces',
    'avoid mixed-targets-like configurations',
  ];

  for (const message of messages) {
    const plainSwiftDocument = parseBridgeFactsDocument({
      ...swiftDocument,
      limitations: [...swiftDocument.limitations, message],
    });
    const result = joinBridgeDocuments([dartDocument, plainSwiftDocument]);

    assert.equal(result.deferred, false, message);
    assert.equal(result.matchedChannels.length > 0, true, message);
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

test('사실이 없는 문서의 한계는 target 귀속 없이 전달한다', () => {
  const emptyReceiver = parseBridgeFactsDocument({
    ...swiftDocument,
    target: null,
    facts: [],
  });

  const result = joinBridgeDocuments([
    dartDocument,
    swiftDocument,
    emptyReceiver,
  ]);

  assert.deepEqual(
    result.limitations
      .filter(({ platform }) => platform === 'swift')
      .map(({ target }) => target),
    ['flutter', 'flutter', 'flutter', null, null],
  );
});

test('같은 플랫폼의 한계는 target 문자열 순으로 정렬한다', () => {
  const flutterSwift = parseBridgeFactsDocument({
    ...swiftDocument,
    limitations: ['opaque-handler-bodies: 1 named-function handler is not read'],
  });
  const reactNativeSwift = parseBridgeFactsDocument({
    ...swiftDocument,
    target: 'react-native',
    limitations: ['opaque-handler-bodies: 1 named-function handler is not read'],
  });

  const result = joinBridgeDocuments([
    dartDocument,
    flutterSwift,
    reactNativeSwift,
  ]);

  assert.deepEqual(
    result.limitations
      .filter(({ message }) => message.startsWith('opaque-handler-bodies:'))
      .map(({ platform, target }) => [platform, target]),
    [
      ['swift', 'flutter'],
      ['swift', 'react-native'],
    ],
  );
});

test('같은 플랫폼이라도 target이 다르면 조인에서 제외한 사실을 따로 센다', () => {
  const reactNativeJs = parseBridgeFactsDocument({
    ...dartDocument,
    platform: 'js',
    target: 'react-native',
    tool: { name: 'isthmus-extract-js', version: '0.1.0' },
    facts: [
      {
        kind: 'method-invoke',
        channel: 'CameraModule',
        method: 'takePhoto',
        dynamic: true,
        location: { path: 'src/camera.js', line: 7, column: 3 },
      },
    ],
    limitations: [],
  });

  const result = joinBridgeDocuments([dartDocument, reactNativeJs, swiftDocument]);

  assert.deepEqual(
    result.limitations.filter(({ message }) =>
      message.startsWith('unjoined-dynamic-methods:'),
    ),
    [
      {
        platform: 'dart',
        target: 'flutter',
        tool: 'isthmus',
        origin: 'consumer',
        message:
          'unjoined-dynamic-methods: 1 method facts with a non-literal name were not joined',
      },
      {
        platform: 'js',
        target: 'react-native',
        tool: 'isthmus',
        origin: 'consumer',
        message:
          'unjoined-dynamic-methods: 1 method facts with a non-literal name were not joined',
      },
    ],
  );
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
        limitation.target === null &&
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

test('RN 모듈·컴포넌트 이름에 호출 측과 수신 측 증거를 함께 연결한다', () => {
  const result = joinBridgeDocuments([
    reactNativeJsDocument,
    reactNativeSwiftDocument,
    reactNativeKotlinDocument,
  ]);

  assert.deepEqual(result.matchedModules, [
    {
      target: 'react-native',
      channel: 'CameraModule',
      callers: [
        {
          platform: 'js',
          location: { path: 'src/camera.ts', line: 2, column: 30 },
        },
      ],
      receivers: [
        {
          platform: 'swift',
          location: { path: 'ios/CameraModule.m', line: 4, column: 1 },
        },
      ],
    },
  ]);
  assert.deepEqual(result.matchedComponents, [
    {
      target: 'react-native',
      channel: 'CameraView',
      callers: [
        {
          platform: 'js',
          location: { path: 'src/Camera.tsx', line: 5, column: 22 },
        },
      ],
      receivers: [
        {
          platform: 'kotlin',
          location: { path: 'android/CameraViewManager.kt', line: 8, column: 5 },
        },
        {
          platform: 'swift',
          location: { path: 'ios/CameraViewManager.m', line: 9, column: 1 },
        },
      ],
    },
  ]);
  assert.deepEqual(result.moduleImportsWithoutExports, []);
  assert.deepEqual(result.moduleExportsWithoutImports, []);
  assert.deepEqual(result.componentRequiresWithoutExports, []);
  assert.deepEqual(result.componentExportsWithoutRequires, []);
});

test('짝 없는 모듈·컴포넌트 이름을 호출 측과 수신 측으로 나누어 남긴다', () => {
  const unmatchedReceiver = parseBridgeFactsDocument({
    ...reactNativeSwiftDocument,
    facts: reactNativeSwiftDocument.facts.map((fact) => ({
      ...fact,
      channel: `Native${fact.channel}`,
    })),
  });
  const unmatchedKotlin = parseBridgeFactsDocument({
    ...reactNativeKotlinDocument,
    facts: [],
    target: null,
  });

  const result = joinBridgeDocuments([
    reactNativeJsDocument,
    unmatchedReceiver,
    unmatchedKotlin,
  ]);

  assert.deepEqual(result.matchedModules, []);
  assert.deepEqual(result.matchedComponents, []);
  assert.deepEqual(
    result.moduleImportsWithoutExports.map(({ channel }) => channel),
    ['CameraModule'],
  );
  assert.deepEqual(
    result.componentRequiresWithoutExports.map(({ channel }) => channel),
    ['CameraView'],
  );
  assert.deepEqual(
    result.moduleExportsWithoutImports.map(({ channel }) => channel),
    ['NativeCameraModule'],
  );
  assert.deepEqual(
    result.componentExportsWithoutRequires.map(({ channel }) => channel),
    ['NativeCameraView'],
  );
});

test('dynamic 모듈·컴포넌트 이름은 조인하지 않고 소비자 한계로 센다', () => {
  const dynamicJs = parseBridgeFactsDocument({
    ...reactNativeJsDocument,
    facts: reactNativeJsDocument.facts.map((fact) => ({ ...fact, dynamic: true })),
  });
  const dynamicSwift = parseBridgeFactsDocument({
    ...reactNativeSwiftDocument,
    facts: reactNativeSwiftDocument.facts.map((fact) => ({ ...fact, dynamic: true })),
  });
  const dynamicKotlin = parseBridgeFactsDocument({
    ...reactNativeKotlinDocument,
    facts: reactNativeKotlinDocument.facts.map((fact) => ({ ...fact, dynamic: true })),
  });

  const result = joinBridgeDocuments([dynamicJs, dynamicSwift, dynamicKotlin]);

  assert.deepEqual(result.matchedModules, []);
  assert.deepEqual(result.matchedComponents, []);
  assert.deepEqual(result.moduleImportsWithoutExports, []);
  assert.deepEqual(result.componentExportsWithoutRequires, []);
  assert.deepEqual(
    result.limitations.filter(({ origin }) => origin === 'consumer'),
    [
      {
        platform: 'js',
        target: 'react-native',
        tool: 'isthmus',
        origin: 'consumer',
        message:
          'unjoined-dynamic-imports: 2 module import or component require facts with a non-literal name were not joined',
      },
      {
        platform: 'kotlin',
        target: 'react-native',
        tool: 'isthmus',
        origin: 'consumer',
        message:
          'unjoined-dynamic-exports: 1 module or component export facts with a non-literal name were not joined',
      },
      {
        platform: 'swift',
        target: 'react-native',
        tool: 'isthmus',
        origin: 'consumer',
        message:
          'unjoined-dynamic-exports: 2 module or component export facts with a non-literal name were not joined',
      },
    ],
  );
});

test('target이 다른 같은 이름의 모듈 사실은 연결하지 않는다', () => {
  const flutterJs = parseBridgeFactsDocument({
    ...reactNativeJsDocument,
    platform: 'dart',
    target: 'flutter',
    tool: { name: 'dartograph', version: '0.1.0' },
  });

  const result = joinBridgeDocuments([flutterJs, reactNativeSwiftDocument, reactNativeKotlinDocument]);

  assert.deepEqual(result.matchedModules, []);
  assert.deepEqual(
    result.moduleImportsWithoutExports.map(({ target, channel }) => [target, channel]),
    [['flutter', 'CameraModule']],
  );
  assert.deepEqual(
    result.moduleExportsWithoutImports.map(({ target, channel }) => [target, channel]),
    [['react-native', 'CameraModule']],
  );
});

/** RN 호출 측 문서다. 실제 extract-js 산출물 형태를 미리 세운 독립 기대값이다. */
const reactNativeJsDocument = parseBridgeFactsDocument({
  format: 'bridge-facts',
  version: 1,
  tool: { name: 'isthmus-extract-js', version: '0.1.0' },
  generatedAt: '2026-09-04T12:00:00Z',
  platform: 'js',
  target: 'react-native',
  project: '/fixture',
  facts: [
    {
      kind: 'module-import',
      channel: 'CameraModule',
      dynamic: false,
      location: { path: 'src/camera.ts', line: 2, column: 30 },
    },
    {
      kind: 'component-require',
      channel: 'CameraView',
      dynamic: false,
      location: { path: 'src/Camera.tsx', line: 5, column: 22 },
    },
  ],
  limitations: [],
});

/** RN iOS 수신 측 문서다. cartograph의 RCT_EXPORT_* 스캔 형태를 따른다. */
const reactNativeSwiftDocument = parseBridgeFactsDocument({
  format: 'bridge-facts',
  version: 1,
  tool: { name: 'cartograph', version: '0.1.0' },
  generatedAt: '2026-09-04T12:00:00Z',
  platform: 'swift',
  target: 'react-native',
  project: '/fixture',
  facts: [
    {
      kind: 'module-export',
      channel: 'CameraModule',
      dynamic: false,
      location: { path: 'ios/CameraModule.m', line: 4, column: 1 },
    },
    {
      kind: 'component-export',
      channel: 'CameraView',
      dynamic: false,
      location: { path: 'ios/CameraViewManager.m', line: 9, column: 1 },
    },
  ],
  limitations: [],
});

/** RN Android 수신 측 문서다. kartograph의 @ReactModule 스캔 형태를 따른다. */
const reactNativeKotlinDocument = parseBridgeFactsDocument({
  format: 'bridge-facts',
  version: 1,
  tool: { name: 'kartograph', version: '0.1.0' },
  generatedAt: '2026-09-04T12:00:00Z',
  platform: 'kotlin',
  target: 'react-native',
  project: '/fixture',
  facts: [
    {
      kind: 'component-export',
      channel: 'CameraView',
      dynamic: false,
      location: { path: 'android/CameraViewManager.kt', line: 8, column: 5 },
    },
  ],
  limitations: [],
});

/** 저장된 JSON을 제품 파서로 검증해 테스트 입력으로 사용한다. */
async function loadDocument(relativePath: string): Promise<BridgeFactsDocument> {
  const text = await readFile(new URL(relativePath, import.meta.url), 'utf8');
  return parseBridgeFactsDocument(JSON.parse(text));
}

/** mechanism 실린 사실을 문서로 만드는 테스트 조립기다. */
function mechanismDocument(
  platform: 'js' | 'swift' | 'kotlin',
  facts: ReadonlyArray<{
    kind: 'module-import' | 'component-require' | 'module-export' | 'component-export';
    channel: string;
    mechanism?: 'core' | 'expo';
    path?: string;
  }>,
): BridgeFactsDocument {
  return parseBridgeFactsDocument({
    format: 'bridge-facts',
    version: 1,
    tool: { name: 'fixture', version: '0.1.0' },
    generatedAt: '2026-09-04T12:00:00Z',
    platform,
    target: 'react-native',
    project: '/fixture',
    facts: facts.map((fact, index) => ({
      kind: fact.kind,
      channel: fact.channel,
      ...(fact.mechanism === undefined ? {} : { mechanism: fact.mechanism }),
      dynamic: false,
      location: { path: fact.path ?? 'src/boundary.ts', line: index + 1, column: 1 },
    })),
    limitations: [],
  });
}

test('Expo module-import는 TurboModule 폴백이 있어 core·expo export 모두와 잇는다', () => {
  const caller = mechanismDocument('js', [
    { kind: 'module-import', channel: 'CoreModule', mechanism: 'expo' },
    { kind: 'module-import', channel: 'ExpoModule', mechanism: 'expo' },
  ]);
  const receiver = mechanismDocument('swift', [
    { kind: 'module-export', channel: 'CoreModule' },
    { kind: 'module-export', channel: 'ExpoModule', mechanism: 'expo' },
  ]);

  const result = joinBridgeDocuments([caller, receiver]);

  assert.deepEqual(
    result.matchedModules.map(({ channel }) => channel),
    ['CoreModule', 'ExpoModule'],
  );
  assert.deepEqual(result.moduleImportsWithoutExports, []);
  assert.deepEqual(result.moduleExportsWithoutImports, []);
});

test('core module-import는 expo export에 도달하지 못해 불일치 증거를 남긴다', () => {
  const caller = mechanismDocument('js', [
    { kind: 'module-import', channel: 'CameraModule' },
  ]);
  const receiver = mechanismDocument('swift', [
    { kind: 'module-export', channel: 'CameraModule', mechanism: 'expo' },
  ]);

  const result = joinBridgeDocuments([caller, receiver]);

  assert.deepEqual(result.matchedModules, []);
  const unexported = result.moduleImportsWithoutExports;
  assert.equal(unexported.length, 1);
  assert.equal(unexported[0]?.channel, 'CameraModule');
  // 같은 이름의 export가 mechanism만 다르게 관찰됐음이 증거에 남는다.
  assert.equal(unexported[0]?.incompatibleReceivers?.length, 1);
  assert.equal(unexported[0]?.incompatibleReceivers?.[0]?.mechanism, 'expo');
  // 도달하지 못한 export도 미호출 경고 재료로 남는다.
  assert.equal(result.moduleExportsWithoutImports.length, 1);
});

test('mechanism 생략은 core로 읽혀 기존 문서와 같은 조인을 만든다', () => {
  const caller = mechanismDocument('js', [
    { kind: 'module-import', channel: 'CameraModule' },
    { kind: 'component-require', channel: 'CameraView' },
  ]);
  const receiver = mechanismDocument('kotlin', [
    { kind: 'module-export', channel: 'CameraModule', mechanism: 'core' },
    { kind: 'component-export', channel: 'CameraView' },
  ]);

  const result = joinBridgeDocuments([caller, receiver]);

  assert.equal(result.matchedModules.length, 1);
  assert.equal(result.matchedComponents.length, 1);
  assert.equal(result.matchedModules[0]?.callers[0]?.mechanism, undefined);
  assert.equal(result.matchedModules[0]?.receivers[0]?.mechanism, 'core');
});

test('Expo component-require는 폴백이 없어 core export와 잇지 않는다', () => {
  const caller = mechanismDocument('js', [
    { kind: 'component-require', channel: 'CameraView', mechanism: 'expo' },
  ]);
  const receiver = mechanismDocument('swift', [
    { kind: 'component-export', channel: 'CameraView' },
  ]);

  const result = joinBridgeDocuments([caller, receiver]);

  assert.deepEqual(result.matchedComponents, []);
  assert.equal(result.componentRequiresWithoutExports.length, 1);
  assert.equal(
    result.componentRequiresWithoutExports[0]?.incompatibleReceivers?.length,
    1,
  );
  assert.equal(result.componentExportsWithoutRequires.length, 1);
});

test('core component-require와 expo component-export는 어느 쪽도 만족하지 않는다', () => {
  const caller = mechanismDocument('js', [
    { kind: 'component-require', channel: 'CameraView' },
  ]);
  const receiver = mechanismDocument('swift', [
    { kind: 'component-export', channel: 'CameraView', mechanism: 'expo' },
  ]);

  const result = joinBridgeDocuments([caller, receiver]);

  assert.deepEqual(result.matchedComponents, []);
  assert.equal(result.componentRequiresWithoutExports.length, 1);
  assert.equal(result.componentExportsWithoutRequires.length, 1);
});

test('같은 이름에 섞인 mechanism 호출자는 만족한 쪽만 매치로 고정한다', () => {
  const caller = mechanismDocument('js', [
    { kind: 'module-import', channel: 'CameraModule', mechanism: 'expo', path: 'src/expo.ts' },
    { kind: 'module-import', channel: 'CameraModule', path: 'src/core.ts' },
  ]);
  const receiver = mechanismDocument('swift', [
    { kind: 'module-export', channel: 'CameraModule', mechanism: 'expo' },
  ]);

  const result = joinBridgeDocuments([caller, receiver]);

  // expo 호출자만 도달해 매치에 실리고, core 호출자는 불일치 미수출로 남는다.
  assert.equal(result.matchedModules.length, 1);
  assert.equal(result.matchedModules[0]?.callers.length, 1);
  assert.equal(result.matchedModules[0]?.callers[0]?.mechanism, 'expo');
  assert.equal(result.moduleImportsWithoutExports.length, 1);
  assert.equal(
    result.moduleImportsWithoutExports[0]?.callers[0]?.location.path,
    'src/core.ts',
  );
  // export는 expo 호출자에게 도달했으므로 미호출 경고가 아니다.
  assert.deepEqual(result.moduleExportsWithoutImports, []);
});
