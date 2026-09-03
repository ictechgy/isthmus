import 'dart:io';

import 'package:isthmus_phase0_dart/dart_bridge_extractor.dart';
import 'package:test/test.dart';

void main() {
  test('리터럴 MethodChannel 생성 지점을 추출한다', () async {
    final source = await File('../fixture/lib/camera_bridge.dart')
        .readAsString();

    final facts = extractDartBridgeFacts(
      source: source,
      relativePath: 'lib/camera_bridge.dart',
    );

    expect(
      facts.map((fact) => fact.toJson()),
      contains(
        equals({
          'kind': 'channel-create',
          'channel': 'dev.isthmus/camera',
          'dynamic': false,
          'location': {
            'path': 'lib/camera_bridge.dart',
            'line': 3,
            'column': 23,
          },
        }),
      ),
    );
  });

  test('invokeMethod 호출을 선언된 채널과 연결한다', () async {
    final source = await File('../fixture/lib/camera_bridge.dart')
        .readAsString();

    final facts = extractDartBridgeFacts(
      source: source,
      relativePath: 'lib/camera_bridge.dart',
    );

    expect(
      facts.map((fact) => fact.toJson()),
      contains(
        equals({
          'kind': 'method-invoke',
          'channel': 'dev.isthmus/camera',
          'method': 'takePhoto',
          'dynamic': false,
          'location': {
            'path': 'lib/camera_bridge.dart',
            'line': 6,
            'column': 23,
          },
        }),
      ),
    );
  });
}
