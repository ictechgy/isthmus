/// Flutter SDK 없이 공개 플러그인 소스를 분석하기 위한 최소 foundation 스텁이다.
library;

/// Pigeon 생성 코드가 사용하는 읽기 버퍼 스텁이다.
class ReadBuffer {
  /// 버퍼를 만든다.
  ReadBuffer(this.data);

  /// 내부 바이트다.
  final ByteData data;

  /// 남은 바이트가 있는지 나타낸다.
  bool get hasRemaining => false;

  /// 부호 없는 8비트 정수를 읽는다.
  int getUint8() => 0;

  /// 부호 없는 16비트 정수를 읽는다.
  int getUint16() => 0;

  /// 부호 없는 32비트 정수를 읽는다.
  int getUint32() => 0;

  /// 부호 없는 64비트 정수를 읽는다.
  int getUint64() => 0;

  /// 32비트 정수를 읽는다.
  int getInt32() => 0;

  /// 64비트 정수를 읽는다.
  int getInt64() => 0;

  /// 배정도 부동소수점을 읽는다.
  double getFloat64() => 0;

  /// 바이트 목록을 읽는다.
  Uint8List getUint8List(int length) => Uint8List(0);

  /// 32비트 정수 목록을 읽는다.
  Int32List getInt32List(int length) => Int32List(0);

  /// 64비트 정수 목록을 읽는다.
  Int64List getInt64List(int length) => Int64List(0);

  /// 배정도 부동소수점 목록을 읽는다.
  Float64List getFloat64List(int length) => Float64List(0);
}

/// Pigeon 생성 코드가 사용하는 쓰기 버퍼 스텁이다.
class WriteBuffer {
  /// 부호 없는 8비트 정수를 쓴다.
  void putUint8(int byte) {}

  /// 32비트 정수를 쓴다.
  void putInt32(int value) {}

  /// 64비트 정수를 쓴다.
  void putInt64(int value) {}

  /// 배정도 부동소수점을 쓴다.
  void putFloat64(double value) {}

  /// 바이트 목록을 쓴다.
  void putUint8List(Uint8List list) {}

  /// 32비트 정수 목록을 쓴다.
  void putInt32List(Int32List list) {}

  /// 64비트 정수 목록을 쓴다.
  void putInt64List(Int64List list) {}

  /// 배정도 부동소수점 목록을 쓴다.
  void putFloat64List(Float64List list) {}

  /// 누적된 내용을 완성한다.
  ByteData done() => ByteData(0);
}

/// 변경 불가 표시 애너테이션이다.
const Object immutable = Object();

/// 테스트용 표시 애너테이션이다.
const Object visibleForTesting = Object();

/// 오버라이드 제한 애너테이션이다.
const Object nonVirtual = Object();

/// 하위 클래스 전용 애너테이션이다.
const Object protected = Object();

/// 상위 호출 요구 애너테이션이다.
const Object mustCallSuper = Object();

/// 플랫폼 구분 열거형 스텁이다.
enum TargetPlatform { android, iOS, macOS, linux, windows, fuchsia }

/// 현재 플랫폼 스텁 값이다.
const TargetPlatform defaultTargetPlatform = TargetPlatform.macOS;

/// 디버그 여부 스텁 값이다.
const bool kDebugMode = false;

/// dart:typed_data 타입을 재수출한다.
export 'dart:typed_data'
    show ByteData, Uint8List, Int32List, Int64List, Float64List;
