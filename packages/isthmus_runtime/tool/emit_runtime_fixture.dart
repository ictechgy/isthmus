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
      final output = _fixtureOutputFile();
      output.writeAsStringSync(recorder.finish().encode());
      // ignore: avoid_print
      print('ISTHMUS_RUNTIME_FIXTURE ${output.path}');
    });
  });
}

RuntimeOutcome pigeonOutcome(Object? reply) =>
    reply == null ? RuntimeOutcome.missingHandler : RuntimeOutcome.success;

/// 기록 JSON을 쓸 파일을 정한다.
///
/// `ISTHMUS_RUNTIME_FIXTURE_OUT`이 있으면 그 경로를 쓴다. 없으면 시스템 임시 디렉터리
/// 아래에 새로 만든 전용 디렉터리의 `runtime-recorder.json`을 쓴다. 공유 `/tmp`의 고정
/// 이름은 다른 로컬 사용자가 미리 만들거나 링크로 심어 둘 수 있기 때문이다.
File _fixtureOutputFile() {
  final configured = Platform.environment['ISTHMUS_RUNTIME_FIXTURE_OUT'];
  if (configured != null && configured.isNotEmpty) {
    return File(configured);
  }
  final directory = Directory.systemTemp.createTempSync('isthmus-runtime-');
  return File(
    '${directory.path}${Platform.pathSeparator}runtime-recorder.json',
  );
}

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
