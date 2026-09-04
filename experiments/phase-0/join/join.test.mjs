import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { joinBridgeFacts } from './join.mjs';

const execFileAsync = promisify(execFile);
const joinCliPath = fileURLToPath(new URL('./join-cli.mjs', import.meta.url));
const dartDocumentPath = fileURLToPath(
  new URL('../expected/dart.json', import.meta.url),
);
const swiftDocumentPath = fileURLToPath(
  new URL('../expected/swift.json', import.meta.url),
);

const dartDocument = JSON.parse(
  await readFile(new URL('../expected/dart.json', import.meta.url), 'utf8'),
);
const swiftDocument = JSON.parse(
  await readFile(new URL('../expected/swift.json', import.meta.url), 'utf8'),
);

test('같은 정적 채널의 생성과 등록을 양쪽 위치로 연결한다', () => {
  const report = joinBridgeFacts(dartDocument, swiftDocument);

  assert.deepEqual(report.matchedChannels, [
    {
      channel: 'dev.isthmus/camera',
      creator: {
        path: 'lib/camera_bridge.dart',
        line: 3,
        column: 23,
      },
      registration: {
        path: 'ios/Runner/CameraPlugin.swift',
        line: 11,
        column: 17,
      },
    },
  ]);
  assert.deepEqual(report.unregisteredChannelCreations, []);
  assert.deepEqual(report.registrationsWithoutCreations, []);
});

test('손 조인도 생성 없는 채널 등록을 수신 위치와 함께 남긴다', () => {
  const receiverWithOrphan = structuredClone(swiftDocument);
  receiverWithOrphan.facts.push({
    kind: 'channel-register',
    channel: 'dev.isthmus/native-only',
    dynamic: false,
    location: {
      path: 'ios/NativeOnlyPlugin.swift',
      line: 4,
      column: 9,
    },
  });

  const report = joinBridgeFacts(dartDocument, receiverWithOrphan);

  assert.deepEqual(report.registrationsWithoutCreations, [
    {
      channel: 'dev.isthmus/native-only',
      registration: {
        path: 'ios/NativeOnlyPlugin.swift',
        line: 4,
        column: 9,
      },
    },
  ]);
});

test('같은 채널과 메서드의 호출과 핸들러를 양쪽 위치로 연결한다', () => {
  const report = joinBridgeFacts(dartDocument, swiftDocument);

  assert.deepEqual(report.matchedMethods, [
    {
      channel: 'dev.isthmus/camera',
      method: 'takePhoto',
      caller: {
        path: 'lib/camera_bridge.dart',
        line: 6,
        column: 23,
      },
      handler: {
        path: 'ios/Runner/CameraPlugin.swift',
        line: 13,
        column: 18,
      },
      handlerSymbol: { qualifiedName: 'CameraPlugin.register' },
    },
  ]);
});

test('핸들러 없는 정적 호출을 호출 위치와 함께 남긴다', () => {
  const report = joinBridgeFacts(dartDocument, swiftDocument);

  assert.deepEqual(report.unhandledInvocations, [
    {
      channel: 'dev.isthmus/camera',
      method: 'takePhotos',
      caller: {
        path: 'lib/camera_bridge.dart',
        line: 17,
        column: 23,
      },
    },
  ]);
});

test('호출 없는 정적 핸들러를 핸들러 위치와 함께 남긴다', () => {
  const report = joinBridgeFacts(dartDocument, swiftDocument);

  assert.deepEqual(report.handlersWithoutInvocations, [
    {
      channel: 'dev.isthmus/camera',
      method: 'captureStill',
      handler: {
        path: 'ios/Runner/CameraPlugin.swift',
        line: 13,
        column: 31,
      },
      handlerSymbol: { qualifiedName: 'CameraPlugin.register' },
    },
    {
      channel: 'dev.isthmus/camera',
      method: 'recordVideo',
      handler: {
        path: 'ios/Runner/CameraPlugin.swift',
        line: 15,
        column: 18,
      },
      handlerSymbol: { qualifiedName: 'CameraPlugin.register' },
    },
  ]);
});

test('동적 사실은 조인하지 않고 양쪽 limitations를 보존한다', () => {
  const report = joinBridgeFacts(dartDocument, swiftDocument);

  assert.deepEqual(report.limitations, [
    {
      platform: 'dart',
      message:
        'dynamic-channel-names: 1 channel constructors use a non-literal name',
    },
    {
      platform: 'dart',
      message:
        'dynamic-method-names: 1 method invocations use a non-literal name',
    },
    {
      platform: 'swift',
      message:
        'dynamic-channel-names: 1 channel constructors use a non-literal name',
    },
    {
      platform: 'swift',
      message:
        'missing-handler-usrs: 3 method handlers have only a qualified name',
    },
  ]);
});

test('채널을 모르는 핸들러는 호출 없음으로 판정하지 않는다', () => {
  const swiftWithUnknownChannel = structuredClone(swiftDocument);
  swiftWithUnknownChannel.facts.push({
    kind: 'method-handle',
    channel: null,
    method: 'takePhotos',
    dynamic: false,
    location: {
      path: 'ios/Runner/DetachedHandler.swift',
      line: 4,
      column: 10,
    },
  });
  swiftWithUnknownChannel.limitations.push(
    'unattributed-method-handles: 1 handler has no channel',
  );

  const report = joinBridgeFacts(dartDocument, swiftWithUnknownChannel);

  assert.equal(
    report.handlersWithoutInvocations.some((fact) => fact.channel === null),
    false,
  );
});

test('mixed-targets 문서는 불일치를 만들지 않고 조인을 보류한다', () => {
  const mixedSwiftDocument = structuredClone(swiftDocument);
  mixedSwiftDocument.limitations.push(
    "mixed-targets: facts come from more than one bridge (flutter 5, react-native 2); 'target' is the majority",
  );

  const report = joinBridgeFacts(dartDocument, mixedSwiftDocument);

  assert.deepEqual(report.matchedChannels, []);
  assert.deepEqual(report.matchedMethods, []);
  assert.deepEqual(report.unregisteredChannelCreations, []);
  assert.deepEqual(report.unhandledInvocations, []);
  assert.deepEqual(report.handlersWithoutInvocations, []);
  assert.equal(
    report.limitations.some(
      (limitation) =>
        limitation.platform === 'swift' &&
        limitation.message.startsWith('mixed-targets:'),
    ),
    true,
  );
});

test('서로 다른 target의 같은 문자열 키를 연결하지 않는다', () => {
  const reactNativeSwift = structuredClone(swiftDocument);
  reactNativeSwift.target = 'react-native';

  const report = joinBridgeFacts(dartDocument, reactNativeSwift);

  assert.deepEqual(report.matchedChannels, []);
  assert.deepEqual(report.matchedMethods, []);
});

test('원시 교환 문서와 project 일치를 제품 계약으로 검증한다', () => {
  assert.throws(
    () => joinBridgeFacts({ ...dartDocument, facts: 'invalid' }, swiftDocument),
    { name: 'BridgeFactsValidationError' },
  );
  assert.throws(
    () => joinBridgeFacts(
      dartDocument,
      { ...swiftDocument, project: '/another-project' },
    ),
    { name: 'BridgeJoinValidationError' },
  );
});

test('손 조인 출력은 입력 사실 순서와 중복에 무관하다', () => {
  const expected = joinBridgeFacts(dartDocument, swiftDocument);
  const duplicateDart = {
    ...dartDocument,
    facts: [...dartDocument.facts.toReversed(), ...dartDocument.facts],
  };
  const duplicateSwift = {
    ...swiftDocument,
    facts: [...swiftDocument.facts.toReversed(), ...swiftDocument.facts],
  };

  assert.deepEqual(joinBridgeFacts(duplicateDart, duplicateSwift), expected);
});

test('손 조인도 Cartesian 간선 안전 상한을 넘기 전에 거부한다', () => {
  const callers = {
    ...dartDocument,
    limitations: [],
    facts: Array.from({ length: 317 }, (_, index) => ({
      kind: 'channel-create',
      channel: 'dev.isthmus/large',
      dynamic: false,
      location: { path: `lib/caller-${index}.dart`, line: 1, column: 1 },
    })),
  };
  const receivers = {
    ...swiftDocument,
    limitations: [],
    facts: Array.from({ length: 317 }, (_, index) => ({
      kind: 'channel-register',
      channel: 'dev.isthmus/large',
      dynamic: false,
      location: { path: `ios/receiver-${index}.swift`, line: 1, column: 1 },
    })),
  };

  assert.throws(
    () => joinBridgeFacts(callers, receivers),
    {
      name: 'BridgeGraphLimitError',
      message: 'Bridge graph exceeds the 100000 edge limit.',
    },
  );
});

test('CLI가 두 교환 문서를 손 조인 JSON으로 출력한다', async () => {
  const { stdout, stderr } = await execFileAsync(process.execPath, [
    joinCliPath,
    dartDocumentPath,
    swiftDocumentPath,
  ]);

  assert.equal(stderr, '');
  const report = JSON.parse(stdout);
  assert.equal(report.matchedChannels.length, 1);
  assert.equal(report.matchedMethods.length, 1);
  assert.equal(report.unhandledInvocations.length, 1);
  assert.equal(report.handlersWithoutInvocations.length, 2);
  const expected = await readFile(
    new URL('../expected/join.json', import.meta.url),
    'utf8',
  );
  assert.equal(stdout, expected);
});

test('CLI가 잘못된 인자를 사용법과 종료 코드 64로 거부한다', async () => {
  await assert.rejects(
    execFileAsync(process.execPath, [joinCliPath]),
    (error) => {
      assert.equal(error.code, 64);
      assert.equal(error.stdout, '');
      assert.equal(
        error.stderr,
        'Usage: join-cli.mjs <dart.json> <swift.json>\n',
      );
      return true;
    },
  );
});

test('CLI가 입력 오류를 경로 노출 없이 종료 코드 2로 보고한다', async () => {
  await assert.rejects(
    execFileAsync(process.execPath, [
      joinCliPath,
      'private-dart.json',
      swiftDocumentPath,
    ]),
    (error) => {
      assert.equal(error.code, 2);
      assert.equal(error.stdout, '');
      assert.equal(
        error.stderr,
        'Unable to read bridge facts; check the input paths and JSON.\n',
      );
      assert.doesNotMatch(error.stderr, /private-dart\.json/);
      return true;
    },
  );
});
