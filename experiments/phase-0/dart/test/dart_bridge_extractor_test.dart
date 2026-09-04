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
import 'package:flutter/services.dart';
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
          'location': {'path': 'lib/constants.dart', 'line': 5, 'column': 11},
        }),
      ),
    );
  });

  test('const와 new MethodChannel 변수의 호출을 채널에 연결한다', () {
    const source = """
import 'package:flutter/services.dart';
final constChannel = const MethodChannel('dev.isthmus/const');
final newChannel = new MethodChannel('dev.isthmus/new');
void ping() {
  constChannel.invokeMethod('constPing');
  newChannel.invokeMethod('newPing');
}
""";

    final facts = extractDartBridgeFacts(
      source: source,
      relativePath: 'lib/explicit.dart',
    );
    final methods = facts
        .map((fact) => fact.toJson())
        .where((fact) => fact['kind'] == 'method-invoke')
        .map((fact) => (fact['channel'], fact['method']))
        .toList();

    expect(methods, [
      ('dev.isthmus/const', 'constPing'),
      ('dev.isthmus/new', 'newPing'),
    ]);
  });

  test('Flutter services import 없는 같은 이름 호출을 브리지로 오인하지 않는다', () {
    const source = """
Object MethodChannel(String name) => Object();
void create() {
  MethodChannel('not-flutter');
}
""";

    final facts = extractDartBridgeFacts(
      source: source,
      relativePath: 'lib/lookalike.dart',
    );

    expect(facts, isEmpty);
  });

  test('다른 함수의 같은 변수 이름을 채널 호출로 연결하지 않는다', () {
    const source = """
import 'package:flutter/services.dart';
void create() {
  final channel = MethodChannel('dev.isthmus/test');
}
void unrelated() {
  channel.invokeMethod('notInScope');
}
""";

    final facts = extractDartBridgeFacts(
      source: source,
      relativePath: 'lib/scopes.dart',
    );

    expect(
      facts.map((fact) => fact.toJson()),
      isNot(contains(containsPair('kind', 'method-invoke'))),
    );
  });

  test('함수 매개변수는 바깥 채널 변수의 같은 이름을 가린다', () {
    const source = """
import 'package:flutter/services.dart';
final channel = MethodChannel('dev.isthmus/test');
void unrelated(Object channel) {
  channel.invokeMethod('notAFlutterCall');
}
""";

    final facts = extractDartBridgeFacts(
      source: source,
      relativePath: 'lib/parameters.dart',
    );

    expect(
      facts.map((fact) => fact.toJson()),
      isNot(contains(containsPair('kind', 'method-invoke'))),
    );
  });

  test('다른 클래스의 같은 필드 이름을 채널 호출로 연결하지 않는다', () {
    const source = """
import 'package:flutter/services.dart';
class Creator {
  final channel = MethodChannel('dev.isthmus/test');
}
class Unrelated {
  void invoke() {
    channel.invokeMethod('notInThisClass');
  }
}
""";

    final facts = extractDartBridgeFacts(
      source: source,
      relativePath: 'lib/classes.dart',
    );

    expect(
      facts.map((fact) => fact.toJson()),
      isNot(contains(containsPair('kind', 'method-invoke'))),
    );
  });

  test('같은 클래스의 채널 필드를 메서드 호출에 연결한다', () {
    const source = """
import 'package:flutter/services.dart';
class Plugin {
  final channel = MethodChannel('dev.isthmus/test');
  void invoke() {
    channel.invokeMethod('inThisClass');
  }
}
""";

    final facts = extractDartBridgeFacts(
      source: source,
      relativePath: 'lib/plugin.dart',
    );

    expect(
      facts.map((fact) => fact.toJson()),
      contains(
        allOf(
          containsPair('kind', 'method-invoke'),
          containsPair('method', 'inThisClass'),
        ),
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

  test('추출 사실을 GRAPH-EXCHANGE 버전 1 문서로 감싼다', () {
    const fact = BridgeFact({'kind': 'channel-create'});

    final document = createDartBridgeFactsDocument(
      facts: const [fact],
      generatedAt: DateTime.utc(2026, 9, 4, 12),
      project: '/fixture',
    );

    expect(document, containsPair('format', 'bridge-facts'));
    expect(document, containsPair('version', 1));
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

  test('사실이 없는 문서는 target을 null로 기록한다', () {
    final document = createDartBridgeFactsDocument(
      facts: const [],
      generatedAt: DateTime.utc(2026, 9, 4, 12),
      project: '/fixture',
    );

    expect(document, containsPair('target', null));
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
