import 'dart:convert';
import 'dart:io';

import 'package:test/test.dart';

void main() {
  test('소스 파일을 bridge-facts JSON 문서로 출력한다', () async {
    final result = await Process.run(Platform.resolvedExecutable, [
      'run',
      'bin/extract_bridges.dart',
      '../fixture/lib/camera_bridge.dart',
      '--project',
      '/fixture',
      '--path',
      'lib/camera_bridge.dart',
      '--generated-at',
      '2026-09-04T12:00:00Z',
    ]);

    expect(result.exitCode, 0, reason: result.stderr as String);
    expect(result.stderr, isEmpty);
    final document =
        jsonDecode(result.stdout as String) as Map<String, Object?>;
    expect(document['format'], 'bridge-facts');
    expect(document['project'], '/fixture');
    expect(document['generatedAt'], '2026-09-04T12:00:00.000Z');
    expect(document['facts'], hasLength(5));
    expect(result.stdout, isNot(contains(Directory.current.parent.path)));
    final expected = await File('../expected/dart.json').readAsString();
    expect(result.stdout, expected);
  });

  test('잘못된 인자는 사용법과 종료 코드 64로 거부한다', () async {
    final result = await Process.run(Platform.resolvedExecutable, [
      'run',
      'bin/extract_bridges.dart',
    ]);

    expect(result.exitCode, 64);
    expect(result.stdout, isEmpty);
    expect(result.stderr, startsWith('Usage: extract_bridges.dart'));
    expect(result.stderr, isNot(contains(Directory.current.path)));
  });

  test('안전하지 않은 프로젝트·상대 경로·생성 시각은 읽기 전에 거부한다', () async {
    final invalidMetadata = [
      ('relative', 'lib/source.dart', '2026-09-04T12:00:00Z'),
      ('/fixture', '../private.dart', '2026-09-04T12:00:00Z'),
      ('/fixture', '/private.dart', '2026-09-04T12:00:00Z'),
      ('/fixture', r'C:\private.dart', '2026-09-04T12:00:00Z'),
      ('/fixture', 'lib/source.dart', '2026-02-31T12:00:00Z'),
    ];

    for (final (project, relativePath, generatedAt) in invalidMetadata) {
      final result = await Process.run(Platform.resolvedExecutable, [
        'run',
        'bin/extract_bridges.dart',
        'does-not-exist.dart',
        '--project',
        project,
        '--path',
        relativePath,
        '--generated-at',
        generatedAt,
      ]);

      expect(result.exitCode, 64);
      expect(result.stdout, isEmpty);
      expect(result.stderr, startsWith('Usage: extract_bridges.dart'));
      expect(result.stderr, isNot(contains('does-not-exist.dart')));
    }
  });

  test('읽을 수 없는 소스는 경로를 노출하지 않고 종료 코드 2를 낸다', () async {
    final result = await Process.run(Platform.resolvedExecutable, [
      'run',
      'bin/extract_bridges.dart',
      'does-not-exist.dart',
      '--project',
      '/fixture',
      '--path',
      'lib/missing.dart',
      '--generated-at',
      '2026-09-04T12:00:00Z',
    ]);

    expect(result.exitCode, 2);
    expect(result.stdout, isEmpty);
    expect(
      result.stderr,
      'Unable to read the source file; check its path and permissions.\n',
    );
    expect(result.stderr, isNot(contains('does-not-exist.dart')));
  });

  test('Dart 구문 오류는 스택과 경로 없는 종료 코드 2로 보고한다', () async {
    final result = await Process.run(Platform.resolvedExecutable, [
      'run',
      'bin/extract_bridges.dart',
      'test/fixtures/invalid_dart.txt',
      '--project',
      '/fixture',
      '--path',
      'lib/private_source.dart',
      '--generated-at',
      '2026-09-04T12:00:00Z',
    ]);

    expect(result.exitCode, 2);
    expect(result.stdout, isEmpty);
    expect(
      result.stderr,
      'Unable to parse the source file; fix syntax errors and retry.\n',
    );
    expect(result.stderr, isNot(contains('invalid_dart.txt')));
    expect(result.stderr, isNot(contains('package:analyzer')));
  });
}
