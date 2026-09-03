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
}
