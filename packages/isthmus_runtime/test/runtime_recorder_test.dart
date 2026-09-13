import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:isthmus_runtime/isthmus_runtime.dart';

void main() {
  test(
    'an exact Basic configuration takes precedence over a dynamic method resolver',
    () async {
      final recorder = IsthmusRuntimeRecorder(
        messenger: _FakeMessenger(
          (_, _) => Future<ByteData?>.value(
            const StandardMessageCodec().encodeMessage([true]),
          ),
        ),
        project: '/app',
        revision: 'revision',
        scenario: 'precedence',
        platform: 'ios',
        methodChannelResolver:
            (name) => RuntimeMethodChannel(
              channel: name,
              codec: const StandardMethodCodec(),
            ),
        basicMessageChannels: [
          RuntimeBasicMessageChannel(
            channel: 'pigeon',
            replyCodec: const StandardMessageCodec(),
            replyOutcome:
                (reply) =>
                    reply is List
                        ? RuntimeOutcome.success
                        : RuntimeOutcome.error,
          ),
        ],
      );
      final channel = BasicMessageChannel<Object?>(
        'pigeon',
        const StandardMessageCodec(),
        binaryMessenger: recorder.binaryMessenger,
      );
      expect(await channel.send([1]), [true]);
      expect(
        recorder.finish().events.single.transport,
        'basic-message-channel',
      );
      expect(recorder.finish().status, 'completed');
    },
  );

  test('a closed snapshot keeps its original completion time and events', () {
    var now = DateTime.utc(2026, 9, 14);
    final recorder = IsthmusRuntimeRecorder(
      messenger: _FakeMessenger((_, _) => null),
      project: '/app',
      revision: 'revision',
      scenario: 'closed',
      platform: 'ios',
      clock: () => now,
    );
    now = now.add(const Duration(seconds: 1));
    final closed = recorder.finish();
    now = now.add(const Duration(seconds: 10));
    expect(recorder.snapshot().toJson(), closed.toJson());
  });

  test(
    'an unawaited delegate error still reaches its error zone once',
    () async {
      final seen = Completer<Object>();
      final failure = StateError('fixture-private-payload');
      var errors = 0;
      runZonedGuarded(
        () {
          final response = Completer<ByteData?>();
          final recorder = IsthmusRuntimeRecorder(
            messenger: _FakeMessenger((_, _) => response.future),
            project: '/app',
            revision: 'revision',
            scenario: 'error-zone',
            platform: 'ios',
            methodChannels: const [
              RuntimeMethodChannel(
                channel: 'errors',
                codec: StandardMethodCodec(),
              ),
            ],
          );
          recorder.binaryMessenger.send(
            'errors',
            const StandardMethodCodec().encodeMethodCall(
              const MethodCall('fail'),
            ),
          );
          response.completeError(failure, StackTrace.current);
        },
        (error, stack) {
          errors++;
          if (!seen.isCompleted) seen.complete(error);
        },
      );
      expect(
        await seen.future.timeout(const Duration(seconds: 2)),
        same(failure),
      );
      await Future<void>.delayed(Duration.zero);
      expect(errors, 1);
    },
  );

  test(
    'Pigeon null replies keep transport semantics and report missing handlers',
    () async {
      for (final asynchronous in [false, true]) {
        final recorder = IsthmusRuntimeRecorder(
          messenger: _FakeMessenger(
            (_, _) => asynchronous ? Future<ByteData?>.value() : null,
          ),
          project: '/app',
          revision: 'revision',
          scenario: 'pigeon-missing',
          platform: 'ios',
          basicMessageChannels: [
            RuntimeBasicMessageChannel(
              channel: 'pigeon',
              replyCodec: const StandardMessageCodec(),
              replyOutcome:
                  (reply) =>
                      reply == null
                          ? RuntimeOutcome.missingHandler
                          : RuntimeOutcome.success,
            ),
          ],
        );
        final response = recorder.binaryMessenger.send(
          'pigeon',
          const StandardMessageCodec().encodeMessage(null),
        );
        if (!asynchronous) expect(response, isNull);
        expect(await response, isNull);
        expect(
          recorder.finish().events.single.outcome,
          RuntimeOutcome.missingHandler,
        );
      }
    },
  );

  test(
    'valid surrogate pairs survive while malformed route names are omitted',
    () async {
      final recorder = IsthmusRuntimeRecorder(
        messenger: _FakeMessenger(
          (_, _) => Future<ByteData?>.value(
            const StandardMethodCodec().encodeSuccessEnvelope(null),
          ),
        ),
        project: '/app',
        revision: 'revision',
        scenario: 'emoji-📷',
        platform: 'ios',
        methodChannels: const [
          RuntimeMethodChannel(channel: 'camera', codec: StandardMethodCodec()),
        ],
      );
      final channel = MethodChannel(
        'camera',
        const StandardMethodCodec(),
        recorder.binaryMessenger,
      );
      await channel.invokeMethod<void>('photo-📷');
      expect(recorder.finish().events.single.method, 'photo-📷');
      expect(
        () => IsthmusRuntimeRecorder(
          messenger: _FakeMessenger((_, _) => null),
          project: '/app',
          revision: 'revision',
          scenario: '\ud800',
          platform: 'ios',
        ),
        throwsArgumentError,
      );
    },
  );

  test(
    'records a successful MethodChannel call without changing bytes',
    () async {
      final messenger = _FakeMessenger((channel, message) {
        expect(channel, 'example/camera');
        return Future<ByteData?>.value(
          const StandardMethodCodec().encodeSuccessEnvelope('ok'),
        );
      });
      final recorder = IsthmusRuntimeRecorder(
        messenger: messenger,
        project: '/tmp/app',
        revision: 'abc',
        scenario: 'take-photo',
        platform: 'ios',
        instance: 'main',
        methodChannels: const <RuntimeMethodChannel>[
          RuntimeMethodChannel(
            channel: 'example/camera',
            codec: StandardMethodCodec(),
          ),
        ],
      );
      final channel = MethodChannel(
        'example/camera',
        const StandardMethodCodec(),
        recorder.binaryMessenger,
      );

      expect(await channel.invokeMethod<String>('takePhoto'), 'ok');
      final document = recorder.finish();
      expect(document.status, 'completed');
      expect(document.events.single.method, 'takePhoto');
      expect(document.events.single.outcome, RuntimeOutcome.success);
      expect(document.events.single.transport, 'method-channel');
      expect(document.events.single.channel, 'example/camera');
      expect(document.toJson().toString(), isNot(contains('arguments')));
      expect(document.toJson().toString(), isNot(contains('stacktrace')));
    },
  );

  test(
    'keeps missing responses, native errors, and thrown exceptions observable',
    () async {
      final completer = Completer<ByteData?>();
      final messenger = _FakeMessenger((channel, message) {
        if (message == null) throw StateError('native call failed');
        final call = const StandardMethodCodec().decodeMethodCall(message);
        if (call.method == 'pending') return completer.future;
        if (call.method == 'missing') return Future<ByteData?>.value();
        return Future<ByteData?>.value(
          const StandardMethodCodec().encodeErrorEnvelope(code: 'failed'),
        );
      });
      final recorder = IsthmusRuntimeRecorder(
        messenger: messenger,
        project: '/tmp/app',
        revision: 'abc',
        scenario: 'errors',
        platform: 'ios',
        methodChannels: const <RuntimeMethodChannel>[
          RuntimeMethodChannel(
            channel: 'example/errors',
            codec: StandardMethodCodec(),
          ),
        ],
      );
      final channel = MethodChannel(
        'example/errors',
        const StandardMethodCodec(),
        recorder.binaryMessenger,
      );
      await expectLater(
        channel.invokeMethod<void>('missing'),
        throwsA(isA<MissingPluginException>()),
      );
      await expectLater(
        channel.invokeMethod<void>('failed'),
        throwsA(isA<PlatformException>()),
      );
      final pending = channel.invokeMethod<void>('pending');
      expect(recorder.finish().events.map((event) => event.outcome), [
        RuntimeOutcome.missingHandler,
        RuntimeOutcome.error,
        RuntimeOutcome.pending,
      ]);
      completer.complete(
        const StandardMethodCodec().encodeSuccessEnvelope(null),
      );
      await pending;
    },
  );

  test(
    'records Pigeon BasicMessageChannel success and supplied reply error classifier',
    () async {
      final codec = const StandardMessageCodec();
      final messenger = _FakeMessenger((channel, message) {
        final decoded = codec.decodeMessage(message);
        expect(decoded, isA<List<Object?>>());
        final isError = (decoded! as List<Object?>).single == 'error';
        return Future<ByteData?>.value(
          codec.encodeMessage(
            isError ? <Object?>['code', 'message', null] : <Object?>[true],
          ),
        );
      });
      final recorder = IsthmusRuntimeRecorder(
        messenger: messenger,
        project: '/tmp/app',
        revision: 'abc',
        scenario: 'pigeon',
        platform: 'ios',
        basicMessageChannels: <RuntimeBasicMessageChannel>[
          RuntimeBasicMessageChannel(
            channel: 'dev.flutter.pigeon.ExampleApi.ok',
            replyCodec: codec,
            replyOutcome:
                (reply) =>
                    reply is List<Object?> && reply.length > 1
                        ? RuntimeOutcome.error
                        : RuntimeOutcome.success,
          ),
          RuntimeBasicMessageChannel(
            channel: 'dev.flutter.pigeon.ExampleApi.error',
            replyCodec: codec,
            replyOutcome:
                (reply) =>
                    reply is List<Object?> && reply.length > 1
                        ? RuntimeOutcome.error
                        : RuntimeOutcome.success,
          ),
        ],
      );
      final ok = BasicMessageChannel<Object?>(
        'dev.flutter.pigeon.ExampleApi.ok',
        codec,
        binaryMessenger: recorder.binaryMessenger,
      );
      final error = BasicMessageChannel<Object?>(
        'dev.flutter.pigeon.ExampleApi.error',
        codec,
        binaryMessenger: recorder.binaryMessenger,
      );
      expect(await ok.send(<Object?>['ok']), <Object?>[true]);
      expect(await error.send(<Object?>['error']), <Object?>[
        'code',
        'message',
        null,
      ]);
      final events = recorder.finish().events;
      expect(
        events.map((event) => event.transport),
        everyElement('basic-message-channel'),
      );
      expect(events.map((event) => event.outcome), <RuntimeOutcome>[
        RuntimeOutcome.success,
        RuntimeOutcome.error,
      ]);
    },
  );

  test(
    'forwards handlers, null futures, dynamic names, and caps events',
    () async {
      Future<ByteData?> handler(ByteData? message) async => message;
      final messenger = _FakeMessenger((channel, message) => null);
      final recorder = IsthmusRuntimeRecorder(
        messenger: messenger,
        project: '/tmp/app',
        revision: 'abc',
        scenario: 'cap',
        platform: 'ios',
        maxEvents: 1,
        methodChannels: const <RuntimeMethodChannel>[
          RuntimeMethodChannel(channel: 'known', codec: StandardMethodCodec()),
        ],
      );
      recorder.binaryMessenger.setMessageHandler('known', handler);
      expect(messenger.handlers['known'], same(handler));
      final direct = recorder.binaryMessenger.send(
        'dynamic/${DateTime.now().microsecondsSinceEpoch}',
        null,
      );
      expect(direct, isNull);
      final known = MethodChannel(
        'known',
        const StandardMethodCodec(),
        recorder.binaryMessenger,
      );
      final first = known.invokeMethod<void>('first');
      await expectLater(first, throwsA(isA<MissingPluginException>()));
      final second = known.invokeMethod<void>('second');
      await second.catchError((_) {});
      final document = recorder.finish();
      expect(document.droppedEvents, 1);
      expect(document.status, 'incomplete');
      expect(document.events.single.sequence, 1);
      expect(document.events.single.outcome, RuntimeOutcome.missingHandler);
    },
  );

  test(
    'records a dynamic name only when an explicit resolver supplies its codec',
    () async {
      const codec = StandardMethodCodec();
      final recorder = IsthmusRuntimeRecorder(
        messenger: _FakeMessenger(
          (channel, message) =>
              Future<ByteData?>.value(codec.encodeSuccessEnvelope(null)),
        ),
        project: '/tmp/app',
        revision: 'abc',
        scenario: 'dynamic',
        platform: 'ios',
        methodChannelResolver:
            (channel) =>
                channel.startsWith('feature/')
                    ? RuntimeMethodChannel(channel: channel, codec: codec)
                    : null,
      );
      final channel = MethodChannel(
        'feature/camera-42',
        codec,
        recorder.binaryMessenger,
      );
      await channel.invokeMethod<void>('takePhoto');
      final document = recorder.finish();
      expect(document.events.single.channel, 'feature/camera-42');
      expect(document.events.single.method, 'takePhoto');
      expect(document.events.single.outcome, RuntimeOutcome.success);
    },
  );

  test(
    'preserves a delegate future and synchronous exception identity',
    () async {
      final expected = StateError('delegate');
      final response = Future<ByteData?>.value(
        const StandardMethodCodec().encodeSuccessEnvelope(null),
      );
      final messenger = _FakeMessenger((channel, message) {
        if (message == null) throw expected;
        if (const StandardMethodCodec().decodeMethodCall(message).method ==
            'throw') {
          throw expected;
        }
        return response;
      });
      final recorder = IsthmusRuntimeRecorder(
        messenger: messenger,
        project: '/tmp/app',
        revision: 'abc',
        scenario: 'identity',
        platform: 'ios',
        methodChannels: const <RuntimeMethodChannel>[
          RuntimeMethodChannel(
            channel: 'identity',
            codec: StandardMethodCodec(),
          ),
        ],
      );
      final call = const StandardMethodCodec().encodeMethodCall(
        const MethodCall('ok'),
      );
      final returned = recorder.binaryMessenger.send('identity', call);
      expect(returned, isNot(same(response)));
      expect(await returned, isNotNull);
      final throwingCall = const StandardMethodCodec().encodeMethodCall(
        const MethodCall('throw'),
      );
      expect(
        () => recorder.binaryMessenger.send('identity', throwingCall),
        throwsA(same(expected)),
      );
      expect(
        recorder.finish().events.map((event) => event.outcome),
        <RuntimeOutcome>[RuntimeOutcome.success, RuntimeOutcome.error],
      );
    },
  );

  test(
    'snapshot is incomplete while open and interrupt remains incomplete',
    () {
      final recorder = IsthmusRuntimeRecorder(
        messenger: _FakeMessenger((channel, message) => null),
        project: '/tmp/app',
        revision: 'abc',
        scenario: 'snapshot',
        platform: 'ios',
      );
      expect(recorder.snapshot().status, 'incomplete');
      recorder.interrupt();
      expect(recorder.finish().status, 'incomplete');
    },
  );

  test('observation timeout does not cancel the application future', () async {
    final reply = Completer<ByteData?>();
    final recorder = IsthmusRuntimeRecorder(
      messenger: _FakeMessenger((channel, message) => reply.future),
      project: '/tmp/app',
      revision: 'abc',
      scenario: 'timeout',
      platform: 'ios',
      observationTimeout: const Duration(milliseconds: 1),
      methodChannels: const <RuntimeMethodChannel>[
        RuntimeMethodChannel(channel: 'timeout', codec: StandardMethodCodec()),
      ],
    );
    final call = const StandardMethodCodec().encodeMethodCall(
      const MethodCall('wait'),
    );
    final applicationFuture = recorder.binaryMessenger.send('timeout', call);
    await Future<void>.delayed(const Duration(milliseconds: 10));
    expect(recorder.snapshot().events.single.outcome, RuntimeOutcome.timeout);
    expect(applicationFuture, isNotNull);
    reply.complete(const StandardMethodCodec().encodeSuccessEnvelope(null));
    await applicationFuture;
    expect(recorder.finish().status, 'incomplete');
  });

  test('rejects unsafe metadata and omits unsafe runtime routes', () async {
    expect(
      () => IsthmusRuntimeRecorder(
        messenger: _FakeMessenger((channel, message) => null),
        project: ' ',
        revision: 'abc',
        scenario: 'unsafe',
        platform: 'ios',
      ),
      throwsA(isA<ArgumentError>()),
    );
    final recorder = IsthmusRuntimeRecorder(
      messenger: _FakeMessenger(
        (channel, message) => Future<ByteData?>.value(
          const StandardMethodCodec().encodeSuccessEnvelope(null),
        ),
      ),
      project: '/tmp/app',
      revision: 'abc',
      scenario: 'unsafe',
      platform: 'ios',
      methodChannels: const <RuntimeMethodChannel>[
        RuntimeMethodChannel(channel: 'unsafe', codec: StandardMethodCodec()),
      ],
    );
    final message = const StandardMethodCodec().encodeMethodCall(
      const MethodCall('\u2028'),
    );
    await recorder.binaryMessenger.send('unsafe', message);
    final document = recorder.finish();
    expect(document.events, isEmpty);
    expect(document.droppedEvents, 1);
    expect(document.status, 'incomplete');
  });
}

typedef _Send = Future<ByteData?>? Function(String channel, ByteData? message);

class _FakeMessenger implements BinaryMessenger {
  _FakeMessenger(this.onSend);
  final _Send onSend;
  final Map<String, MessageHandler?> handlers = <String, MessageHandler?>{};

  @override
  Future<void> handlePlatformMessage(
    String channel,
    ByteData? data,
    PlatformMessageResponseCallback? callback,
  ) async {
    final response = await handlers[channel]?.call(data);
    callback?.call(response);
  }

  @override
  Future<ByteData?>? send(String channel, ByteData? message) =>
      onSend(channel, message);

  @override
  void setMessageHandler(String channel, MessageHandler? handler) {
    handlers[channel] = handler;
  }
}
