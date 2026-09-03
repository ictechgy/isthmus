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

  test('동적 채널 이름을 원문 표현식과 함께 보존한다', () async {
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
          'channel': "'dev.isthmus/\$feature'",
          'dynamic': true,
          'location': {
            'path': 'lib/camera_bridge.dart',
            'line': 10,
            'column': 5,
          },
        }),
      ),
    );
  });

  test('동적 메서드 이름을 원문 표현식과 함께 보존한다', () async {
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
          'method': 'method',
          'dynamic': true,
          'location': {
            'path': 'lib/camera_bridge.dart',
            'line': 13,
            'column': 23,
          },
        }),
      ),
    );
  });

  test('상수로 전달된 채널 이름을 한 단계 추적한다', () {
    const source = """
const channelName = 'dev.isthmus/constants';
final channel = MethodChannel(channelName);
void ping() {
  channel.invokeMethod('ping');
}
""";

    final facts = extractDartBridgeFacts(
      source: source,
      relativePath: 'lib/constants.dart',
    );

    expect(
      facts.map((fact) => fact.toJson()),
      contains(
        equals({
          'kind': 'method-invoke',
          'channel': 'dev.isthmus/constants',
          'method': 'ping',
          'dynamic': false,
          'location': {'path': 'lib/constants.dart', 'line': 4, 'column': 11},
        }),
      ),
    );
  });

  test('문서가 동적 이름 개수를 limitations에 기록한다', () async {
    final source = await File('../fixture/lib/camera_bridge.dart')
        .readAsString();
    final facts = extractDartBridgeFacts(
      source: source,
      relativePath: 'lib/camera_bridge.dart',
    );

    final document = createDartBridgeFactsDocument(
      facts: facts,
      generatedAt: DateTime.utc(2026, 9, 4, 12),
      project: '/fixture',
    );

    expect(document['limitations'], [
      'dynamic-channel-names: 1 channel constructors use a non-literal name',
      'dynamic-method-names: 1 method invocations use a non-literal name',
    ]);
  });

  test('추출 사실을 GRAPH-EXCHANGE 버전 0 문서로 감싼다', () {
    const fact = BridgeFact({'kind': 'channel-create'});

    final document = createDartBridgeFactsDocument(
      facts: const [fact],
      generatedAt: DateTime.utc(2026, 9, 4, 12),
      project: '/fixture',
    );

    expect(document, containsPair('format', 'bridge-facts'));
    expect(document, containsPair('version', 0));
    expect(
      document,
      containsPair('tool', {'name': 'isthmus-phase0-dart', 'version': '0.0.0'}),
    );
    expect(document, containsPair('generatedAt', '2026-09-04T12:00:00.000Z'));
    expect(document, containsPair('platform', 'dart'));
    expect(document, containsPair('target', 'flutter'));
    expect(document, containsPair('project', '/fixture'));
    expect(document, containsPair('facts', [fact.toJson()]));
  });

  test('JSON 객체 키를 중첩 수준마다 정렬한다', () {
    final encoded = encodeBridgeFactsJson({
      'z': 2,
      'a': {'z': 1, 'a': 0},
    });

    expect(encoded, '''{
  "a": {
    "a": 0,
    "z": 1
  },
  "z": 2
}
''');
  });
}
