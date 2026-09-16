/// Flutter SDK 없이 공개 플러그인 소스를 분석하기 위한 최소 services 스텁이다.
/// 실제 플러그인 코드가 참조하는 타입·메서드 표면만 제공하며 동작은 구현하지 않는다.
library;

/// 플랫폼 측과의 바이너리 메시지 전송을 나타내는 추상 서비스다.
abstract class BinaryMessenger {}

/// 바이너리 메시지 코덱의 최소 계약이다.
abstract class MessageCodec<T> {
  /// 인코딩 없이 값을 그대로 돌려주는 스텁이다.
  ByteData? encode(T message) => null;

  /// 디코딩 없이 null을 돌려주는 스텁이다.
  T? decode(ByteData? message) => null;
}

/// 메서드 호출 코덱의 최소 계약이다.
abstract class MethodCodec {
  /// 호출을 인코딩한다.
  ByteData encodeMethodCall(MethodCall call);

  /// 바이트를 호출로 디코딩한다.
  MethodCall decodeMethodCall(ByteData? methodCall);

  /// 성공 envelope를 인코딩한다.
  ByteData encodeSuccessEnvelope(Object? result);

  /// 오류 envelope를 인코딩한다.
  ByteData encodeErrorEnvelope({
    required String code,
    String? message,
    Object? details,
  });

  /// envelope를 디코딩한다.
  Object? decodeEnvelope(ByteData envelope);
}

/// Pigeon 생성 코드가 서브클래싱하는 표준 메시지 코덱이다.
class StandardMessageCodec extends MessageCodec<Object?> {
  /// 기본 인스턴스를 만든다.
  const StandardMessageCodec();

  /// 생성 코드가 참조하는 공유 인스턴스다.
  static const StandardMessageCodec instance = StandardMessageCodec();

  /// 서브클래스가 재정의하는 값 직렬화 훅이다.
  void writeValue(WriteBuffer buffer, Object? value) {}

  /// 서브클래스가 재정의하는 값 역직렬화 훅이다.
  Object? readValueOfType(int type, ReadBuffer buffer) => null;
}

/// 표준 메서드 코덱 스텁이다.
class StandardMethodCodec extends MethodCodec {
  /// 기본 인스턴스를 만든다.
  const StandardMethodCodec([this.messageCodec = const StandardMessageCodec()]);

  /// 공유 인스턴스다.
  static const StandardMethodCodec instance = StandardMethodCodec();

  /// payload 직렬화에 쓰는 메시지 코덱이다.
  final StandardMessageCodec messageCodec;

  @override
  ByteData encodeMethodCall(MethodCall call) => ByteData(0);

  @override
  MethodCall decodeMethodCall(ByteData? methodCall) =>
      const MethodCall('', null);

  @override
  ByteData encodeSuccessEnvelope(Object? result) => ByteData(0);

  @override
  ByteData encodeErrorEnvelope({
    required String code,
    String? message,
    Object? details,
  }) =>
      ByteData(0);

  @override
  Object? decodeEnvelope(ByteData envelope) => null;
}

/// 플랫폼 메서드 호출 표현이다.
class MethodCall {
  /// 호출 이름과 인자를 담는다.
  const MethodCall(this.method, [this.arguments]);

  /// 호출된 메서드 이름이다.
  final String method;

  /// 호출 인자다.
  final Object? arguments;
}

/// 플랫폼 채널의 결과 콜백이다.
typedef MethodCallHandler = Future<Object?> Function(MethodCall call);

/// 이름 기반 메서드 채널 스텁이다.
class MethodChannel {
  /// 채널 이름과 선택적 messenger/codec을 담는다.
  const MethodChannel(this.name,
      [this.binaryMessenger, this.codec = const StandardMethodCodec()]);

  /// 채널 이름이다.
  final String name;

  /// 선택적 messenger다.
  final BinaryMessenger? binaryMessenger;

  /// 사용되는 코덱이다.
  final MethodCodec codec;

  /// 네이티브 메서드를 호출한다.
  Future<T?> invokeMethod<T>(String method, [Object? arguments]) async => null;

  /// 목록 결과를 돌려주는 호출이다.
  Future<List<T>?> invokeListMethod<T>(String method,
          [Object? arguments]) async =>
      null;

  /// 맵 결과를 돌려주는 호출이다.
  Future<Map<K, V>?> invokeMapMethod<K, V>(String method,
          [Object? arguments]) async =>
      null;

  /// 핸들러를 등록한다.
  void setMethodCallHandler(MethodCallHandler? handler) {}

  /// 등록된 핸들러의 호출 가능 여부를 확인한다.
  Future<bool> checkMethodCallHandler(MethodCallHandler? handler) async => false;
}

/// 네이티브 스트림을 노출하는 채널 스텁이다.
class EventChannel {
  /// 채널 이름과 선택적 messenger/codec을 담는다.
  const EventChannel(this.name,
      [this.binaryMessenger, this.codec = const StandardMethodCodec()]);

  /// 채널 이름이다.
  final String name;

  /// 선택적 messenger다.
  final BinaryMessenger? binaryMessenger;

  /// 사용되는 코덱이다.
  final MethodCodec codec;

  /// 네이티브 이벤트 스트림을 연다.
  Stream<Object?> receiveBroadcastStream([Object? arguments]) =>
      const Stream.empty();
}

/// Pigeon이 생성하는 이름 기반 메시지 채널 스텁이다.
class BasicMessageChannel<T> {
  /// 채널 이름·messenger·codec을 담는다.
  const BasicMessageChannel(this.name, this.binaryMessenger, this.codec);

  /// 채널 이름이다.
  final String name;

  /// 사용되는 messenger다.
  final BinaryMessenger binaryMessenger;

  /// 사용되는 코덱이다.
  final MessageCodec<T> codec;

  /// 메시지를 보내고 응답을 돌려준다.
  Future<T?> send(T message) async => null;

  /// 핸들러를 등록한다.
  void setMessageHandler(Future<T> Function(T? message)? handler) {}
}

/// 플랫폼 예외 표현이다.
class PlatformException implements Exception {
  /// 오류 코드·메시지·상세를 담는다.
  PlatformException({
    required this.code,
    this.message,
    this.details,
    this.stacktrace,
  });

  /// 오류 코드다.
  final String code;

  /// 오류 메시지다.
  final String? message;

  /// 부가 정보다.
  final Object? details;

  /// 스택 추적 문자열이다.
  final String? stacktrace;

  @override
  String toString() => 'PlatformException($code)';
}

/// 플러그인 미등록 예외다.
class MissingPluginException implements Exception {
  /// 선택적 메시지를 담는다.
  MissingPluginException([this.message]);

  /// 예외 메시지다.
  final String? message;

  @override
  String toString() => 'MissingPluginException($message)';
}

/// Dart 측 오류 표현이다.
class FlutterError extends Error {
  /// 오류 메시지를 담는다.
  FlutterError(this.message);

  /// 오류 메시지다.
  final String message;
}

/// dart:typed_data의 ByteData를 재수출해 스텁 내부 타입을 맞춘다.
export 'dart:typed_data' show ByteData;

/// foundation의 버퍼 타입을 services 사용자에게도 노출한다.
export 'foundation.dart' show ReadBuffer, WriteBuffer;
