import 'dart:io';

import 'package:isthmus_phase0_dart/dart_bridge_extractor.dart';

/// Phase 0 Dart 소스 하나를 GRAPH-EXCHANGE JSON으로 변환한다.
Future<void> main(List<String> arguments) async {
  final options = _parseArgumentsOrReport(arguments);
  if (options == null) return;
  final source = await _readSourceOrReport(options.sourcePath);
  if (source == null) return;
  final extraction = _extractFactsOrReport(
    source: source,
    relativePath: options.relativePath,
  );
  if (extraction == null) return;
  final document = createDartBridgeFactsDocument(
    facts: extraction.facts,
    generatedAt: options.generatedAt,
    project: options.project,
    extractionLimitations: extraction.limitations,
  );
  stdout.write(encodeBridgeFactsJson(document));
}

/// 구문·추출 오류를 스택과 경로 없는 종료 코드 2로 변환한다.
DartBridgeExtraction? _extractFactsOrReport({
  required String source,
  required String relativePath,
}) {
  try {
    return extractDartBridgeAnalysis(
      source: source,
      relativePath: relativePath,
    );
  } on Object {
    stderr.writeln(
      'Unable to parse the source file; fix syntax errors and retry.',
    );
    exitCode = 2;
    return null;
  }
}

/// 파일 오류를 경로 없는 메시지와 종료 코드 2로 변환한다.
Future<String?> _readSourceOrReport(String sourcePath) async {
  try {
    return await File(sourcePath).readAsString();
  } on FileSystemException {
    stderr.writeln(
      'Unable to read the source file; check its path and permissions.',
    );
    exitCode = 2;
    return null;
  }
}

/// 인자 오류를 사용법과 종료 코드 64로 변환한다.
_ExtractionOptions? _parseArgumentsOrReport(List<String> arguments) {
  try {
    return _parseArguments(arguments);
  } on FormatException {
    stderr.writeln(_usage);
    exitCode = 64;
    return null;
  }
}

/// 고정된 Phase 0 인자 형식을 검증해 내부 옵션으로 바꾼다.
_ExtractionOptions _parseArguments(List<String> arguments) {
  if (arguments.length != 7) throw const FormatException();
  if (arguments[1] != '--project' ||
      arguments[3] != '--path' ||
      arguments[5] != '--generated-at') {
    throw const FormatException();
  }
  if (!_isAbsoluteProjectPath(arguments[2]) ||
      !_isProjectRelativePath(arguments[4]) ||
      !_isTimestamp(arguments[6])) {
    throw const FormatException();
  }
  final generatedAt = DateTime.parse(arguments[6]);
  return _ExtractionOptions(
    sourcePath: arguments[0],
    project: arguments[2],
    relativePath: arguments[4],
    generatedAt: generatedAt,
  );
}

/// 프로젝트 경로가 제어 문자 없는 현재 플랫폼의 절대 경로인지 확인한다.
bool _isAbsoluteProjectPath(String value) =>
    _isSafeNonEmptyString(value) && Directory(value).isAbsolute;

/// 출력할 위치가 절대·상위 경로와 제어 문자를 포함하지 않는지 확인한다.
bool _isProjectRelativePath(String value) {
  if (!_isSafeNonEmptyString(value) || File(value).isAbsolute) return false;
  if (value.startsWith(r'\')) return false;
  if (RegExp(r'^[A-Za-z]:').hasMatch(value)) return false;
  return !value.split(RegExp(r'[/\\]')).contains('..');
}

/// 비어 있지 않고 ASCII 제어 문자가 없는 문자열인지 확인한다.
bool _isSafeNonEmptyString(String value) =>
    value.trim().isNotEmpty &&
    !RegExp(r'[\x00-\x1f\x7f-\x9f\u2028\u2029]').hasMatch(value);

/// 실제 달력 날짜와 명시적 timezone을 갖는 ISO 8601 시각인지 확인한다.
bool _isTimestamp(String value) {
  final match = _timestampPattern.firstMatch(value);
  if (match == null || DateTime.tryParse(value) == null) return false;
  final year = int.parse(match.group(1)!);
  final month = int.parse(match.group(2)!);
  final day = int.parse(match.group(3)!);
  final hour = int.parse(match.group(4)!);
  final minute = int.parse(match.group(5)!);
  final second = int.parse(match.group(6)!);
  final offsetHour = int.tryParse(match.group(7) ?? '0') ?? 24;
  final offsetMinute = int.tryParse(match.group(8) ?? '0') ?? 60;
  return month >= 1 &&
      month <= 12 &&
      day >= 1 &&
      day <= _daysInMonth(year, month) &&
      hour <= 23 &&
      minute <= 59 &&
      second <= 59 &&
      offsetHour <= 23 &&
      offsetMinute <= 59;
}

/// 윤년을 포함한 달의 실제 일수를 반환한다.
int _daysInMonth(int year, int month) {
  if (month == 2) {
    final isLeapYear = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    return isLeapYear ? 29 : 28;
  }
  return const [4, 6, 9, 11].contains(month) ? 30 : 31;
}

final _timestampPattern = RegExp(
  r'^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})'
  r'(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$',
);

/// CLI에서 검증을 마친 추출 입력이다.
final class _ExtractionOptions {
  /// 검증된 입력을 보존한다.
  const _ExtractionOptions({
    required this.sourcePath,
    required this.project,
    required this.relativePath,
    required this.generatedAt,
  });

  /// 읽을 실제 Dart 소스 경로다.
  final String sourcePath;

  /// 교환 문서에 기록할 분석 프로젝트다.
  final String project;

  /// 사실 위치에 기록할 공개 가능한 상대 경로다.
  final String relativePath;

  /// 재현 가능한 UTC 생성 시각이다.
  final DateTime generatedAt;
}

/// 잘못된 호출에서 절대 경로를 노출하지 않는 사용법이다.
const _usage =
    'Usage: extract_bridges.dart <source> --project <absolute-root> '
    '--path <relative-path> --generated-at <utc-iso8601>';
