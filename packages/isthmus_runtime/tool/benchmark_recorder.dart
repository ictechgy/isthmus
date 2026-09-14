import 'dart:convert';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:isthmus_runtime/isthmus_runtime.dart';

void main() {
  test('measure recorder cost on fixed-payload messenger calls', () async {
    const count = 20000;
    final baseline = <int>[];
    final observed = <int>[];
    var bytes = 0;
    for (var iteration = 0; iteration < 6; iteration++) {
      final delegate = _EchoMessenger();
      final plain = await _measure(delegate, count);
      final recorder = IsthmusRuntimeRecorder(
        messenger: delegate,
        project: '/benchmark',
        revision: 'benchmark',
        scenario: 'hot-path',
        platform: 'macos',
        methodChannels: const [
          RuntimeMethodChannel(
            channel: 'benchmark/channel',
            codec: StandardMethodCodec(),
          ),
        ],
      );
      final traced = await _measure(recorder.binaryMessenger, count);
      final document = recorder.finish();
      expect(document.events.length, count);
      expect(document.status, 'completed');
      expect(document.droppedEvents, 0);
      bytes = utf8.encode(document.encode(compact: true)).length;
      if (iteration > 0) {
        baseline.add(plain);
        observed.add(traced);
      }
    }
    baseline.sort();
    observed.sort();
    // 디버그 Flutter 테스트의 fake messenger다. 실제 디바이스 IPC 성능으로 해석하지 않는다.
    // ignore: avoid_print
    print(
      'ISTHMUS_RECORDER_BENCHMARK ${jsonEncode({'scope': 'fake-messenger-fixed-payload-debug', 'callsPerSample': count, 'samples': baseline.length, 'baselineMedianUs': baseline[2], 'observedMedianUs': observed[2], 'observedMaxUs': observed.last, 'addedMedianUsPerCall': (observed[2] - baseline[2]) / count, 'compactTraceBytes': bytes})}',
    );
  });
}

Future<int> _measure(BinaryMessenger messenger, int count) async {
  final bytes = const StandardMethodCodec().encodeMethodCall(
    const MethodCall('read'),
  );
  final watch = Stopwatch()..start();
  for (var index = 0; index < count; index++) {
    await messenger.send('benchmark/channel', bytes);
  }
  return watch.elapsedMicroseconds;
}

class _EchoMessenger implements BinaryMessenger {
  final ByteData reply = const StandardMethodCodec().encodeSuccessEnvelope(
    null,
  );

  @override
  Future<ByteData?>? send(String channel, ByteData? message) =>
      Future.value(reply);

  @override
  void setMessageHandler(String channel, MessageHandler? handler) {}

  @override
  Future<void> handlePlatformMessage(
    String channel,
    ByteData? data,
    PlatformMessageResponseCallback? callback,
  ) async {
    callback?.call(null);
  }
}
