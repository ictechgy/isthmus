import 'dart:collection';
import 'dart:convert';

import 'package:analyzer/dart/analysis/utilities.dart';
import 'package:analyzer/dart/ast/ast.dart';
import 'package:analyzer/dart/ast/visitor.dart';
import 'package:analyzer/source/line_info.dart';

/// GRAPH-EXCHANGE 문서를 결정적인 JSON 문자열로 인코딩한다.
String encodeBridgeFactsJson(Map<String, Object?> document) {
  const encoder = JsonEncoder.withIndent('  ');
  return '${encoder.convert(_sortJson(document))}\n';
}

/// JSON 객체는 키로, 배열은 원래 순서대로 재귀 정렬한다.
Object? _sortJson(Object? value) {
  if (value is Map<String, Object?>) {
    return SplayTreeMap<String, Object?>.from(
      value.map((key, item) => MapEntry(key, _sortJson(item))),
    );
  }
  if (value is List<Object?>) return value.map(_sortJson).toList();
  return value;
}

/// 교환 형식의 브리지 사실 하나를 표현한다.
final class BridgeFact {
  /// 직렬화 가능한 필드를 보존해 Phase 0 계약과 직접 대조한다.
  const BridgeFact(this.fields);

  /// 브리지 사실의 JSON 필드다.
  final Map<String, Object?> fields;

  /// 결정적인 JSON 출력을 위해 새 맵으로 반환한다.
  Map<String, Object?> toJson() => Map.unmodifiable(fields);
}

/// Dart 소스에서 Flutter 플랫폼 채널 사실을 추출한다.
List<BridgeFact> extractDartBridgeFacts({
  required String source,
  required String relativePath,
}) {
  final parseResult = parseString(content: source, throwIfDiagnostics: true);
  final visitor = _BridgeFactVisitor(relativePath, parseResult.lineInfo);
  parseResult.unit.accept(visitor);
  return List.unmodifiable(visitor.facts);
}

/// 추출 사실을 GRAPH-EXCHANGE 문서로 감싼다.
Map<String, Object?> createDartBridgeFactsDocument({
  required List<BridgeFact> facts,
  required DateTime generatedAt,
  required String project,
}) => {
  'format': 'bridge-facts',
  'version': 0,
  'tool': {'name': 'isthmus-phase0-dart', 'version': '0.0.0'},
  'generatedAt': generatedAt.toUtc().toIso8601String(),
  'platform': 'dart',
  'target': 'flutter',
  'project': project,
  'facts': facts.map((fact) => fact.toJson()).toList(growable: false),
  'limitations': _dynamicLimitations(facts),
};

/// 동적 채널과 메서드 사실을 종류별 한계 문장으로 센다.
List<String> _dynamicLimitations(List<BridgeFact> facts) {
  final channelCount = _dynamicCount(facts, 'channel-create');
  final methodCount = _dynamicCount(facts, 'method-invoke');
  return [
    if (channelCount > 0)
      'dynamic-channel-names: $channelCount channel constructors use a non-literal name',
    if (methodCount > 0)
      'dynamic-method-names: $methodCount method invocations use a non-literal name',
  ];
}

/// 주어진 종류에서 동적 사실만 센다.
int _dynamicCount(List<BridgeFact> facts, String kind) => facts
    .where((fact) => fact.fields['kind'] == kind)
    .where((fact) => fact.fields['dynamic'] == true)
    .length;

/// MethodChannel 생성 지점을 방문해 사실로 바꾼다.
final class _BridgeFactVisitor extends RecursiveAstVisitor<void> {
  /// 파일 위치를 포함하는 방문자를 만든다.
  _BridgeFactVisitor(this.relativePath, this.lineInfo);

  /// 공개 가능한 프로젝트 상대 경로다.
  final String relativePath;

  /// 소스 오프셋을 줄과 열로 바꾼다.
  final LineInfo lineInfo;

  /// 소스에서 찾은 브리지 사실이다.
  final List<BridgeFact> facts = [];

  /// 변수 이름별 리터럴 채널 이름이다.
  final Map<String, String> channelByVariable = {};

  /// 한 단계 추적할 문자열 상수다.
  final Map<String, String> stringConstantByVariable = {};

  /// MethodChannel을 담는 변수와 리터럴 이름을 연결한다.
  @override
  void visitVariableDeclaration(VariableDeclaration node) {
    _recordStringConstant(node);
    final initializer = node.initializer;
    if (initializer is MethodInvocation &&
        _isUnresolvedMethodChannel(initializer)) {
      _recordChannelVariable(node, initializer);
    }
    super.visitVariableDeclaration(node);
  }

  /// 리터럴 문자열 상수만 이름으로 보존한다.
  void _recordStringConstant(VariableDeclaration declaration) {
    final initializer = declaration.initializer;
    if (!declaration.isConst || initializer is! SimpleStringLiteral) return;
    stringConstantByVariable[declaration.name.lexeme] = initializer.value;
  }

  /// 리터럴 MethodChannel 생성만 Phase 0 사실로 기록한다.
  @override
  void visitInstanceCreationExpression(InstanceCreationExpression node) {
    if (_isMethodChannel(node)) {
      _recordChannelCreation(node);
    }
    super.visitInstanceCreationExpression(node);
  }

  /// 미해석 AST의 MethodChannel 호출도 생성 사실로 기록한다.
  @override
  void visitMethodInvocation(MethodInvocation node) {
    if (_isUnresolvedMethodChannel(node)) {
      _recordUnresolvedChannelCreation(node);
    } else if (node.methodName.name == 'invokeMethod') {
      _recordMethodInvocation(node);
    }
    super.visitMethodInvocation(node);
  }

  /// 생성자 타입이 Flutter MethodChannel인지 확인한다.
  bool _isMethodChannel(InstanceCreationExpression node) =>
      node.constructorName.type.name.lexeme == 'MethodChannel';

  /// 대상 없는 MethodChannel 호출이 미해석 생성자 표현인지 확인한다.
  bool _isUnresolvedMethodChannel(MethodInvocation node) =>
      node.target == null && node.methodName.name == 'MethodChannel';

  /// 변수 선언의 채널 이름이 리터럴이면 후속 호출을 위해 보존한다.
  void _recordChannelVariable(
    VariableDeclaration declaration,
    MethodInvocation initializer,
  ) {
    final arguments = initializer.argumentList.arguments;
    if (arguments.isEmpty) return;
    final channel = _bridgeName(arguments.first);
    if (channel.isDynamic) return;
    channelByVariable[declaration.name.lexeme] = channel.value;
  }

  /// 첫 인자가 리터럴일 때 채널 생성 사실을 추가한다.
  void _recordChannelCreation(InstanceCreationExpression node) {
    final arguments = node.argumentList.arguments;
    if (arguments.isEmpty) return;
    final channel = _bridgeName(arguments.first);
    facts.add(_channelCreationFact(node, channel));
  }

  /// 미해석 생성자의 채널 이름과 동적 여부를 기록한다.
  void _recordUnresolvedChannelCreation(MethodInvocation node) {
    final arguments = node.argumentList.arguments;
    if (arguments.isEmpty) return;
    final channel = _bridgeName(arguments.first);
    facts.add(
      _fact(
        node.offset,
        'channel-create',
        channel.value,
        isDynamic: channel.isDynamic,
      ),
    );
  }

  /// 리터럴 메서드 호출을 수신 변수의 채널과 연결한다.
  void _recordMethodInvocation(MethodInvocation node) {
    final target = node.target;
    final arguments = node.argumentList.arguments;
    if (target is! SimpleIdentifier || arguments.isEmpty) return;
    final channel = channelByVariable[target.name];
    if (channel == null) return;
    final method = _bridgeName(arguments.first);
    facts.add(
      _fact(
        node.methodName.offset,
        'method-invoke',
        channel,
        method: method.value,
        isDynamic: method.isDynamic,
      ),
    );
  }

  /// 교환 형식에 맞는 채널 생성 사실을 만든다.
  BridgeFact _channelCreationFact(
    InstanceCreationExpression node,
    ({String value, bool isDynamic}) channel,
  ) {
    return _fact(
      node.offset,
      'channel-create',
      channel.value,
      isDynamic: channel.isDynamic,
    );
  }

  /// 리터럴은 값으로, 그 밖의 표현식은 원문으로 보존한다.
  ({String value, bool isDynamic}) _bridgeName(AstNode argument) {
    if (argument is SimpleStringLiteral) {
      return (value: argument.value, isDynamic: false);
    }
    if (argument is SimpleIdentifier) {
      final value = stringConstantByVariable[argument.name];
      if (value != null) return (value: value, isDynamic: false);
    }
    return (value: argument.toSource(), isDynamic: true);
  }

  /// 공통 위치 필드를 포함하는 브리지 사실을 만든다.
  BridgeFact _fact(
    int offset,
    String kind,
    String channel, {
    String? method,
    bool isDynamic = false,
  }) {
    final location = lineInfo.getLocation(offset);
    return BridgeFact({
      'kind': kind,
      'channel': channel,
      if (method != null) 'method': method,
      'dynamic': isDynamic,
      'location': {
        'path': relativePath,
        'line': location.lineNumber,
        'column': location.columnNumber,
      },
    });
  }
}
