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
  ]);
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
