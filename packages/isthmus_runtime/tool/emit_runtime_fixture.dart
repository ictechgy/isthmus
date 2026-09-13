import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:isthmus_runtime/isthmus_runtime.dart';

void main() {
  test('emit a recorder-produced bridge-runtime fixture', () async {
    final messenger = _FixtureMessenger();
    final recorder = IsthmusRuntimeRecorder(
      messenger: messenger,
      project: '/workspace/app',
      revision: 'fixture-revision',
      scenario: 'runtime-fixture',
      platform: 'ios',
      instance: 'main',
      methodChannels: const <RuntimeMethodChannel>[
        RuntimeMethodChannel(
          channel: 'example/camera',
          codec: StandardMethodCodec(),
          caller: RuntimeCaller(path: 'lib/camera.dart', line: 12, column: 5),
        ),
      ],
      basicMessageChannels: const <RuntimeBasicMessageChannel>[
        RuntimeBasicMessageChannel(
          channel: 'dev.flutter.pigeon.ExampleApi.takePhoto',
          replyCodec: StandardMessageCodec(),
          replyOutcome: pigeonOutcome,
        ),
      ],
    );
    final method = MethodChannel(
      'example/camera',
      const StandardMethodCodec(),
      recorder.binaryMessenger,
    );
    final pigeon = BasicMessageChannel<Object?>(
      'dev.flutter.pigeon.ExampleApi.takePhoto',
      const StandardMessageCodec(),
      binaryMessenger: recorder.binaryMessenger,
    );
    await Future.wait<void>(<Future<void>>[
      method.invokeMethod<void>('takePhoto').then<void>((_) {}),
      pigeon.send(<Object?>['takePhoto']).then<void>((_) {}),
    ]).then<void>((_) {
      File(
        '/tmp/isthmus-runtime-recorder.json',
      ).writeAsStringSync(recorder.finish().encode());
    });
  });
}

RuntimeOutcome pigeonOutcome(Object? reply) =>
    reply == null ? RuntimeOutcome.missingHandler : RuntimeOutcome.success;

class _FixtureMessenger implements BinaryMessenger {
  @override
  Future<void> handlePlatformMessage(
    String channel,
    ByteData? data,
    PlatformMessageResponseCallback? callback,
  ) async {
    callback?.call(null);
  }

  @override
  Future<ByteData?>? send(String channel, ByteData? message) {
    if (channel == 'example/camera') {
      return Future<ByteData?>.value(
        const StandardMethodCodec().encodeSuccessEnvelope(null),
      );
    }
    return Future<ByteData?>.value(
      const StandardMessageCodec().encodeMessage(<Object?>[true]),
    );
  }

  @override
  void setMessageHandler(String channel, MessageHandler? handler) {}
}
