import 'dart:async';
import 'dart:convert';

import 'package:flutter/services.dart';

/// A source location supplied by the application or generated test harness.
///
/// The recorder never infers a location from a stack trace. [path] must be
/// project relative when the JSON document is consumed by isthmus.
class RuntimeCaller {
  /// Creates a caller location from an explicitly supplied source position.
  const RuntimeCaller({
    required this.path,
    required this.line,
    required this.column,
  });

  /// Project-relative source path.
  final String path;

  /// One-based source line.
  final int line;

  /// One-based source column.
  final int column;

  /// Converts this location to the runtime JSON object.
  Map<String, Object> toJson() => <String, Object>{
    'path': path,
    'line': line,
    'column': column,
  };
}

/// A method channel and the codec required to decode its outgoing calls and replies.
class RuntimeMethodChannel {
  /// Creates an exact MethodChannel observation configuration.
  const RuntimeMethodChannel({
    required this.channel,
    required this.codec,
    this.caller,
    this.callerForMethod,
  });

  /// Exact channel name.
  final String channel;

  /// Codec used to decode method calls and reply envelopes.
  final MethodCodec codec;

  /// Optional caller location shared by all methods.
  final RuntimeCaller? caller;

  /// Optional explicit method-to-caller resolver.
  final RuntimeCaller? Function(String method)? callerForMethod;
}

/// A BasicMessageChannel route and the codec required to decode its replies.
///
/// Pigeon commonly returns a list containing an error code and message. A
/// generated API can supply [replyOutcome] to classify that envelope without
/// exposing the payload in the runtime document.
class RuntimeBasicMessageChannel {
  /// Creates an exact BasicMessageChannel observation configuration.
  const RuntimeBasicMessageChannel({
    required this.channel,
    required this.replyCodec,
    this.caller,
    required this.replyOutcome,
  });

  /// Exact channel name.
  final String channel;

  /// Codec used to decode the host reply.
  final MessageCodec<Object?> replyCodec;

  /// Optional explicitly supplied caller location.
  final RuntimeCaller? caller;

  /// Classifies the decoded reply, including an explicit null policy.
  final RuntimeOutcome Function(Object? decodedReply) replyOutcome;
}

/// Resolves a channel whose exact runtime name is known by the caller.
typedef RuntimeMethodChannelResolver =
    RuntimeMethodChannel? Function(String channel);

/// Resolves a Pigeon/basic channel whose exact runtime name is known by the caller.
typedef RuntimeBasicMessageChannelResolver =
    RuntimeBasicMessageChannel? Function(String channel);

/// Outcomes written to bridge-runtime v1.
enum RuntimeOutcome {
  /// The host returned a successful reply.
  success,

  /// No host handler returned a reply.
  missingHandler,

  /// The host or codec reported an error.
  error,

  /// Observation exceeded its configured timeout.
  timeout,

  /// The run ended before a reply was observed.
  pending,
}

/// A v1 runtime event. Payloads and exception text are deliberately absent.
class RuntimeEvent {
  /// Creates an immutable runtime event.
  const RuntimeEvent({
    required this.sequence,
    required this.instance,
    required this.transport,
    required this.channel,
    required this.outcome,
    this.method,
    this.caller,
  });

  /// Positive sequence number within a run.
  final int sequence;

  /// Explicit engine or app instance identifier.
  final String instance;

  /// Contract transport identifier.
  final String transport;

  /// Exact channel name.
  final String channel;

  /// Decoded method name for MethodChannel events.
  final String? method;

  /// Fixed outcome classification.
  final RuntimeOutcome outcome;

  /// Optional caller location supplied by the harness.
  final RuntimeCaller? caller;

  /// Converts this event to the bridge-runtime v1 JSON object.
  Map<String, Object> toJson() => <String, Object>{
    'sequence': sequence,
    'instance': instance,
    'transport': transport,
    'channel': channel,
    if (method != null) 'method': method!,
    'outcome':
        outcome.name == 'missingHandler' ? 'missing-handler' : outcome.name,
    if (caller != null) 'caller': caller!.toJson(),
  };
}

/// The JSON-compatible runtime document produced by [IsthmusRuntimeRecorder].
class BridgeRuntimeDocument {
  /// Creates a runtime document.
  const BridgeRuntimeDocument({
    required this.project,
    required this.revision,
    required this.toolName,
    required this.toolVersion,
    required this.runId,
    required this.scenario,
    required this.platform,
    required this.status,
    required this.startedAt,
    required this.finishedAt,
    required this.droppedEvents,
    required this.events,
  });

  /// Producing project identifier.
  final String project;

  /// Source revision under test.
  final String revision;

  /// Producer tool name.
  final String toolName;

  /// Producer tool version.
  final String toolVersion;

  /// Unique run identifier.
  final String runId;

  /// Executed scenario name.
  final String scenario;

  /// Declared runtime platform.
  final String platform;

  /// `completed` or conservative `incomplete`.
  final String status;

  /// Run start time.
  final DateTime startedAt;

  /// Run finish time, omitted when a clock regression was observed.
  final DateTime? finishedAt;

  /// Number of observations omitted by the recorder.
  final int droppedEvents;

  /// Recorded events in sequence order.
  final List<RuntimeEvent> events;

  /// Converts this document to bridge-runtime v1 JSON.
  Map<String, Object> toJson() => <String, Object>{
    'format': 'bridge-runtime',
    'version': 1,
    'project': project,
    'revision': revision,
    'tool': <String, String>{'name': toolName, 'version': toolVersion},
    'run': <String, Object>{
      'id': runId,
      'scenario': scenario,
      'platform': platform,
      'status': status,
      'startedAt': startedAt.toUtc().toIso8601String(),
      if (finishedAt != null)
        'finishedAt': finishedAt!.toUtc().toIso8601String(),
    },
    'droppedEvents': droppedEvents,
    'events': events.map((event) => event.toJson()).toList(growable: false),
  };

  /// Encodes this document without including payloads or exception text.
  String encode({bool compact = false}) {
    // jsonEncode emits no whitespace; retain the option for callers that share
    // the CLI's compact flag without changing the document shape.
    return jsonEncode(toJson());
  }
}

/// Wraps an injected [BinaryMessenger] and records explicitly configured routes.
///
/// The wrapper delegates handlers and platform messages directly. Null futures,
/// response bytes, and exceptions retain their application semantics; a
/// non-null response is observed through a forwarding Future so unhandled
/// errors are not swallowed by the recorder.
class IsthmusRuntimeRecorder {
  /// Creates a recorder around an injected platform messenger.
  IsthmusRuntimeRecorder({
    required BinaryMessenger messenger,
    required this.project,
    required this.revision,
    required this.scenario,
    required this.platform,
    this.instance = 'main',
    this.toolName = 'isthmus-runtime-flutter',
    this.toolVersion = '0.1.0',
    String? runId,
    Iterable<RuntimeMethodChannel> methodChannels =
        const <RuntimeMethodChannel>[],
    Iterable<RuntimeBasicMessageChannel> basicMessageChannels =
        const <RuntimeBasicMessageChannel>[],
    this.methodChannelResolver,
    this.basicMessageChannelResolver,
    this.maxEvents = 100000,
    this.observationTimeout,
    DateTime Function()? clock,
  }) : _messenger = messenger,
       _clock = clock ?? (() => DateTime.now().toUtc()),
       startedAt = (clock ?? (() => DateTime.now().toUtc()))().toUtc(),
       runId = runId ?? _newRunId(),
       _methodChannels = _indexMethods(methodChannels),
       _basicChannels = _indexBasics(basicMessageChannels) {
    if (maxEvents < 1 || maxEvents > 100000) {
      throw ArgumentError.value(
        maxEvents,
        'maxEvents',
        'must be between 1 and 100000',
      );
    }
    if (!_safeString(project) ||
        !_safeString(revision) ||
        !_safeString(scenario) ||
        !_safeString(instance)) {
      throw ArgumentError('runtime metadata must be safe non-empty strings');
    }
    if (!_platforms.contains(platform)) {
      throw ArgumentError.value(platform, 'platform');
    }
    if (!_safeString(toolName) ||
        !_safeString(toolVersion) ||
        !_safeString(this.runId)) {
      throw ArgumentError(
        'runtime tool metadata must be safe non-empty strings',
      );
    }
    if (_methodChannels.keys.any(_basicChannels.containsKey)) {
      throw ArgumentError(
        'A channel cannot be configured as both method and basic message transport.',
      );
    }
  }

  static const Set<String> _platforms = <String>{
    'ios',
    'macos',
    'android',
    'linux',
    'windows',
  };
  static int _runCounter = 0;

  final BinaryMessenger _messenger;

  /// Project identifier written to the runtime document.
  final String project;

  /// Source revision written to the runtime document.
  final String revision;

  /// Scenario name written to the runtime document.
  final String scenario;

  /// Declared runtime platform.
  final String platform;

  /// Explicit engine or app instance name.
  final String instance;

  /// Producer name written to the runtime document.
  final String toolName;

  /// Producer version written to the runtime document.
  final String toolVersion;

  /// Unique identifier for this run.
  final String runId;

  /// Maximum number of events retained in memory.
  final int maxEvents;

  /// Optional observation-only timeout for pending replies.
  final Duration? observationTimeout;

  /// Timestamp at which this recorder was created.
  final DateTime startedAt;
  final DateTime Function() _clock;
  final Map<String, RuntimeMethodChannel> _methodChannels;
  final Map<String, RuntimeBasicMessageChannel> _basicChannels;

  /// Resolves exact runtime MethodChannel names, when needed.
  final RuntimeMethodChannelResolver? methodChannelResolver;

  /// Resolves exact runtime BasicMessageChannel names, when needed.
  final RuntimeBasicMessageChannelResolver? basicMessageChannelResolver;
  final List<_MutableEvent> _events = <_MutableEvent>[];
  int _nextSequence = 0;
  int _droppedEvents = 0;
  bool _unsupportedDecoding = false;
  bool _clockRegression = false;
  bool _interrupted = false;
  bool _finished = false;

  /// The messenger to inject into [MethodChannel] and [BasicMessageChannel].
  BinaryMessenger get binaryMessenger => _RecordingMessenger(this, _messenger);

  /// Marks the run as interrupted; pending and subsequent uncertainty remain visible.
  void interrupt() {
    if (!_finished) _interrupted = true;
  }

  /// Finishes the run. Pending, dropped, unsupported, or interrupted work makes it incomplete.
  BridgeRuntimeDocument finish() {
    if (_finished) return _document;
    _finished = true;
    for (final event in _events) {
      event.timer?.cancel();
      event.timer = null;
    }
    _document = _makeDocument();
    return _document;
  }

  /// Returns a non-closing view of the current run.
  ///
  /// An open run is always reported as `incomplete`, even when no call is
  /// pending at the instant of the snapshot. Use [finish] after the scenario
  /// has actually ended to produce a completed document.
  BridgeRuntimeDocument snapshot() =>
      _finished ? _document : _makeDocument(forceIncomplete: true);

  late BridgeRuntimeDocument _document;

  BridgeRuntimeDocument _makeDocument({bool forceIncomplete = false}) {
    final observedFinished = _clock().toUtc();
    final clockRegression = observedFinished.isBefore(startedAt);
    if (clockRegression) _clockRegression = true;
    final finished = clockRegression ? null : observedFinished;
    final incomplete =
        forceIncomplete ||
        _interrupted ||
        _unsupportedDecoding ||
        _clockRegression ||
        _droppedEvents > 0 ||
        _events.any(
          (event) =>
              event.awaitingReply || event.outcome == RuntimeOutcome.pending,
        );
    return BridgeRuntimeDocument(
      project: project,
      revision: revision,
      toolName: toolName,
      toolVersion: toolVersion,
      runId: runId,
      scenario: scenario,
      platform: platform,
      status: incomplete ? 'incomplete' : 'completed',
      startedAt: startedAt,
      finishedAt: finished,
      droppedEvents: _droppedEvents,
      events: _events
          .map(
            (event) => RuntimeEvent(
              sequence: event.sequence,
              instance: instance,
              transport: event.transport,
              channel: event.channel,
              method: event.method,
              outcome: event.outcome,
              caller: event.caller,
            ),
          )
          .toList(growable: false),
    );
  }

  Future<ByteData?>? _send(
    String channel,
    ByteData? message,
    Future<ByteData?>? Function() delegate,
  ) {
    if (_finished) return _invokeUnobserved(delegate);
    RuntimeMethodChannel? method;
    RuntimeBasicMessageChannel? basic;
    try {
      method = _methodChannels[channel];
      basic = _basicChannels[channel];
      if (method == null && basic == null) {
        method = methodChannelResolver?.call(channel);
        if (method == null) {
          basic = basicMessageChannelResolver?.call(channel);
        }
      }
      if (method != null &&
          (method.channel != channel || !_safeString(method.channel))) {
        _unsupportedDecoding = true;
        _dropObservation();
        method = null;
      }
      if (basic != null &&
          (basic.channel != channel || !_safeString(basic.channel))) {
        _unsupportedDecoding = true;
        _dropObservation();
        basic = null;
      }
    } catch (_) {
      _unsupportedDecoding = true;
      _dropObservation();
      return _invokeUnobserved(delegate);
    }
    if (method != null) {
      final methodConfig = method;
      MethodCall call;
      try {
        call = methodConfig.codec.decodeMethodCall(message);
      } catch (_) {
        _unsupportedDecoding = true;
        // Still execute the delegate; observation must never alter application behavior.
        return _invokeUnobserved(delegate);
      }
      RuntimeCaller? caller;
      try {
        caller =
            methodConfig.callerForMethod?.call(call.method) ??
            methodConfig.caller;
      } catch (_) {
        _unsupportedDecoding = true;
      }
      caller = _sanitizeCaller(caller);
      if (!_safeString(call.method)) {
        _unsupportedDecoding = true;
        _dropObservation();
        return _invokeUnobserved(delegate);
      }
      final event = _begin('method-channel', channel, call.method, caller);
      if (event.dropped) return _invoke(delegate, event, null);
      return _invoke(
        delegate,
        event,
        (reply) => _decodeMethodReply(methodConfig.codec, reply),
      );
    }
    if (basic != null) {
      final basicConfig = basic;
      final event = _begin(
        'basic-message-channel',
        channel,
        null,
        _sanitizeCaller(basicConfig.caller),
      );
      if (event.dropped) return _invoke(delegate, event, null);
      return _invoke(
        delegate,
        event,
        (reply) => _decodeBasicReply(basicConfig, reply),
      );
    }
    return _invokeUnobserved(delegate);
  }

  Future<ByteData?>? _invokeUnobserved(Future<ByteData?>? Function() delegate) {
    try {
      return delegate();
    } catch (_) {
      rethrow;
    }
  }

  Future<ByteData?>? _invoke(
    Future<ByteData?>? Function() delegate,
    _MutableEvent event,
    RuntimeOutcome Function(ByteData? reply)? classify,
  ) {
    Future<ByteData?>? response;
    try {
      response = delegate();
    } catch (error, stack) {
      event.awaitingReply = false;
      _complete(event, RuntimeOutcome.error);
      Error.throwWithStackTrace(error, stack);
    }
    if (response == null) {
      event.awaitingReply = false;
      if (event.dropped || classify == null) return response;
      _complete(event, classify(null));
      return response;
    }
    if (event.dropped || classify == null) return response;
    final timeout = observationTimeout;
    if (timeout != null) {
      event.timer = Timer(timeout, () {
        if (!_finished && event.outcome == RuntimeOutcome.pending) {
          _complete(event, RuntimeOutcome.timeout);
        }
      });
    }
    return response.then<ByteData?>(
      (reply) {
        event.awaitingReply = false;
        if (!_finished && event.outcome == RuntimeOutcome.pending) {
          _complete(event, classify(reply));
        }
        return reply;
      },
      onError: (Object error, StackTrace stack) {
        event.awaitingReply = false;
        if (!_finished && event.outcome == RuntimeOutcome.pending) {
          _complete(event, RuntimeOutcome.error);
        }
        Error.throwWithStackTrace(error, stack);
      },
    );
  }

  RuntimeOutcome _decodeMethodReply(MethodCodec codec, ByteData? reply) {
    if (reply == null) return RuntimeOutcome.missingHandler;
    try {
      codec.decodeEnvelope(reply);
      return RuntimeOutcome.success;
    } catch (error) {
      if (error is! PlatformException) _unsupportedDecoding = true;
      return RuntimeOutcome.error;
    }
  }

  RuntimeOutcome _decodeBasicReply(
    RuntimeBasicMessageChannel config,
    ByteData? reply,
  ) {
    try {
      final decoded = config.replyCodec.decodeMessage(reply);
      return config.replyOutcome(decoded);
    } catch (_) {
      _unsupportedDecoding = true;
      return RuntimeOutcome.error;
    }
  }

  _MutableEvent _begin(
    String transport,
    String channel,
    String? method,
    RuntimeCaller? caller,
  ) {
    final sequence = ++_nextSequence;
    if (_events.length >= maxEvents) {
      _droppedEvents++;
      return _MutableEvent.dropped(sequence);
    }
    final event = _MutableEvent(
      sequence: sequence,
      transport: transport,
      channel: channel,
      method: method,
      caller: caller,
    );
    _events.add(event);
    return event;
  }

  void _complete(_MutableEvent event, RuntimeOutcome outcome) {
    if (event.dropped || _finished) return;
    event.outcome = outcome;
    event.timer?.cancel();
    event.timer = null;
  }

  void _dropObservation() {
    _droppedEvents++;
  }

  RuntimeCaller? _sanitizeCaller(RuntimeCaller? caller) {
    if (caller == null) return null;
    if (!_safeString(caller.path) ||
        caller.path.startsWith('/') ||
        caller.path.startsWith('\\') ||
        RegExp(r'^[A-Za-z]:').hasMatch(caller.path) ||
        caller.path.split(RegExp(r'[/\\]')).contains('..') ||
        !_safePosition(caller.line) ||
        !_safePosition(caller.column)) {
      _unsupportedDecoding = true;
      return null;
    }
    return caller;
  }

  static Map<String, RuntimeMethodChannel> _indexMethods(
    Iterable<RuntimeMethodChannel> values,
  ) {
    final result = <String, RuntimeMethodChannel>{};
    for (final value in values) {
      if (!_safeString(value.channel) || result.containsKey(value.channel)) {
        throw ArgumentError(
          'Method channel configurations must have unique non-empty names.',
        );
      }
      result[value.channel] = value;
    }
    return result;
  }

  static Map<String, RuntimeBasicMessageChannel> _indexBasics(
    Iterable<RuntimeBasicMessageChannel> values,
  ) {
    final result = <String, RuntimeBasicMessageChannel>{};
    for (final value in values) {
      if (!_safeString(value.channel) || result.containsKey(value.channel)) {
        throw ArgumentError(
          'Basic message channel configurations must have unique non-empty names.',
        );
      }
      result[value.channel] = value;
    }
    return result;
  }

  static String _newRunId() {
    final now = DateTime.now().toUtc().microsecondsSinceEpoch;
    return 'flutter-$now-${++_runCounter}';
  }

  static bool _safeString(String value) {
    if (value.trim().isEmpty || _controlCharacterPattern.hasMatch(value)) {
      return false;
    }
    for (var index = 0; index < value.length; index++) {
      final unit = value.codeUnitAt(index);
      if (unit >= 0xdc00 && unit <= 0xdfff) return false;
      if (unit >= 0xd800 && unit <= 0xdbff) {
        if (++index >= value.length) return false;
        final next = value.codeUnitAt(index);
        if (next < 0xdc00 || next > 0xdfff) return false;
      }
    }
    return true;
  }

  static final RegExp _controlCharacterPattern = RegExp(
    r'[\u0000-\u001f\u007f-\u009f\u2028\u2029]',
  );

  static bool _safePosition(int value) =>
      value >= 1 && value <= 9007199254740991;
}

class _MutableEvent {
  _MutableEvent({
    required this.sequence,
    required this.transport,
    required this.channel,
    this.method,
    this.caller,
  }) : dropped = false;
  _MutableEvent.dropped(this.sequence)
    : transport = '',
      channel = '',
      method = null,
      caller = null,
      dropped = true;

  final int sequence;
  final String transport;
  final String channel;
  final String? method;
  final RuntimeCaller? caller;
  final bool dropped;
  RuntimeOutcome outcome = RuntimeOutcome.pending;
  // A timed-out observation does not mean the application's future has settled.
  bool awaitingReply = true;
  Timer? timer;
}

class _RecordingMessenger implements BinaryMessenger {
  const _RecordingMessenger(this.recorder, this.delegate);
  final IsthmusRuntimeRecorder recorder;
  final BinaryMessenger delegate;

  @Deprecated(
    'Use channel buffers directly; retained to preserve BinaryMessenger delegation.',
  )
  @override
  Future<void> handlePlatformMessage(
    String channel,
    ByteData? data,
    PlatformMessageResponseCallback? callback,
  ) {
    // The wrapper must forward this legacy interface for injected test
    // messengers; no channel buffer is available on the delegate abstraction.
    // ignore: deprecated_member_use
    return delegate.handlePlatformMessage(channel, data, callback);
  }

  @override
  Future<ByteData?>? send(String channel, ByteData? message) {
    return recorder._send(
      channel,
      message,
      () => delegate.send(channel, message),
    );
  }

  @override
  void setMessageHandler(String channel, MessageHandler? handler) =>
      delegate.setMessageHandler(channel, handler);
}
