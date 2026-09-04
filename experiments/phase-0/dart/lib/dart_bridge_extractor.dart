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
}) =>
    extractDartBridgeAnalysis(source: source, relativePath: relativePath).facts;

/// 사실과 함께 구문만으로 해석하지 못한 후보 수를 반환한다.
DartBridgeExtraction extractDartBridgeAnalysis({
  required String source,
  required String relativePath,
}) {
  final parseResult = parseString(content: source, throwIfDiagnostics: true);
  final flutterPrefixes = _flutterServicesPrefixes(parseResult.unit);
  if (flutterPrefixes.isEmpty) {
    return const DartBridgeExtraction(facts: [], limitations: []);
  }
  final visitor = _BridgeFactVisitor(
    relativePath,
    source,
    parseResult.lineInfo,
    flutterPrefixes,
    _topLevelDeclaredNames(parseResult.unit),
  );
  parseResult.unit.accept(visitor);
  final facts = List<BridgeFact>.unmodifiable(visitor.facts);
  if (!_isSafeBridgeString(relativePath) || facts.any(_hasUnsafeBridgeValue)) {
    throw const FormatException('Unsafe bridge fact value.');
  }
  final limitations = [
    if (visitor.unresolvedReceiverInvocations > 0)
      'unresolved-receiver-invocations: ${visitor.unresolvedReceiverInvocations} '
          '${visitor.unresolvedReceiverInvocations == 1 ? 'invokeMethod call has' : 'invokeMethod calls have'} '
          'an unresolved receiver',
  ];
  return DartBridgeExtraction(
    facts: facts,
    limitations: List.unmodifiable(limitations),
  );
}

/// Phase 0 추출 사실과 해석하지 못한 후보 limitation이다.
final class DartBridgeExtraction {
  /// 불변 사실과 limitation을 보존한다.
  const DartBridgeExtraction({required this.facts, required this.limitations});

  /// 교환 문서에 넣을 브리지 사실이다.
  final List<BridgeFact> facts;

  /// 누락을 정상 부재와 구분하는 분석 한계다.
  final List<String> limitations;
}

/// 위치와 사실 문자열이 교환 계약의 출력 안전 문자를 따르는지 확인한다.
bool _hasUnsafeBridgeValue(BridgeFact fact) => [
  fact.fields['channel'],
  fact.fields['method'],
].whereType<String>().any((value) => !_isSafeBridgeString(value));

/// 비어 있지 않고 출력 문법을 깨뜨리는 제어 문자가 없는 문자열인지 확인한다.
bool _isSafeBridgeString(String value) =>
    value.trim().isNotEmpty &&
    !RegExp(r'[\x00-\x1f\x7f-\x9f\u2028\u2029]').hasMatch(value);

/// 소스 순서와 무관하게 import 이름을 가리는 top-level 선언을 모은다.
Set<String> _topLevelDeclaredNames(CompilationUnit unit) {
  final names = <String>{};
  for (final declaration in unit.declarations) {
    if (declaration is FunctionDeclaration) {
      names.add(declaration.name.lexeme);
    } else if (declaration is ClassDeclaration) {
      names.add(declaration.namePart.typeName.lexeme);
    } else if (declaration is TopLevelVariableDeclaration) {
      names.addAll(
        declaration.variables.variables.map((variable) => variable.name.lexeme),
      );
    }
  }
  return names;
}

/// Flutter services가 MethodChannel을 노출하는 import 접두사를 모은다.
Set<String?> _flutterServicesPrefixes(CompilationUnit unit) => unit.directives
    .whereType<ImportDirective>()
    .where(
      (directive) =>
          directive.uri.stringValue == 'package:flutter/services.dart' &&
          _exposesMethodChannel(directive.combinators),
    )
    .map((directive) => directive.prefix?.name)
    .toSet();

/// import 조합자가 MethodChannel 이름을 현재 파일에 노출하는지 확인한다.
bool _exposesMethodChannel(NodeList<Combinator> combinators) {
  final hidesMethodChannel = combinators.whereType<HideCombinator>().any(
    (combinator) =>
        combinator.hiddenNames.any((name) => name.name == 'MethodChannel'),
  );
  if (hidesMethodChannel) return false;
  final showCombinators = combinators.whereType<ShowCombinator>();
  return showCombinators.isEmpty ||
      showCombinators.any(
        (combinator) =>
            combinator.shownNames.any((name) => name.name == 'MethodChannel'),
      );
}

/// 추출 사실을 GRAPH-EXCHANGE 문서로 감싼다.
Map<String, Object?> createDartBridgeFactsDocument({
  required List<BridgeFact> facts,
  required DateTime generatedAt,
  required String project,
  List<String> extractionLimitations = const [],
}) => {
  'format': 'bridge-facts',
  'version': 1,
  'tool': {'name': 'isthmus-phase0-dart', 'version': '0.0.0'},
  'generatedAt': _utcMillisecondsTimestamp(generatedAt),
  'platform': 'dart',
  'target': facts.isEmpty ? null : 'flutter',
  'project': project,
  'facts': facts.map((fact) => fact.toJson()).toList(growable: false),
  'limitations': [..._dynamicLimitations(facts), ...extractionLimitations],
};

/// 생성 시각을 UTC 밀리초 세 자리의 결정적 ISO 8601 문자열로 만든다.
String _utcMillisecondsTimestamp(DateTime value) =>
    DateTime.fromMillisecondsSinceEpoch(
      value.millisecondsSinceEpoch,
      isUtc: true,
    ).toIso8601String();

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
  _BridgeFactVisitor(
    this.relativePath,
    this.source,
    this.lineInfo,
    this.flutterPrefixes,
    Set<String> rootDeclaredNames,
  ) : _declaredNameScopes = [rootDeclaredNames];

  /// 공개 가능한 프로젝트 상대 경로다.
  final String relativePath;

  /// UTF-8 열을 계산할 원본 소스다.
  final String source;

  /// 소스 오프셋을 줄과 열로 바꾼다.
  final LineInfo lineInfo;

  /// MethodChannel을 노출하는 Flutter import 접두사다.
  final Set<String?> flutterPrefixes;

  /// 소스에서 찾은 브리지 사실이다.
  final List<BridgeFact> facts = [];

  /// 수신 채널을 구문만으로 연결하지 못한 invokeMethod 후보 수다.
  int unresolvedReceiverInvocations = 0;

  /// 어휘 범위별 변수 이름과 리터럴 채널 이름이다.
  final List<Map<String, _BridgeName>> _channelScopes = [{}];

  /// 어휘 범위별 한 단계 문자열 상수다.
  final List<Map<String, String>> _stringConstantScopes = [{}];

  /// 바깥 범위의 같은 이름을 가리는 선언 이름이다.
  final List<Set<String>> _declaredNameScopes;

  /// 클래스 필드를 다른 타입의 같은 이름과 분리한다.
  @override
  void visitClassDeclaration(ClassDeclaration node) {
    _pushScope();
    try {
      super.visitClassDeclaration(node);
    } finally {
      _popScope();
    }
  }

  /// 중첩 블록의 지역 이름을 바깥 범위와 분리한다.
  @override
  void visitBlock(Block node) {
    _pushScope();
    try {
      for (final statement in node.statements) {
        if (statement is FunctionDeclarationStatement) {
          _declare(statement.functionDeclaration.name.lexeme);
        }
      }
      super.visitBlock(node);
    } finally {
      _popScope();
    }
  }

  /// 지역 함수 이름을 현재 범위에 선언한다.
  @override
  void visitFunctionDeclaration(FunctionDeclaration node) {
    _declare(node.name.lexeme);
    super.visitFunctionDeclaration(node);
  }

  /// catch 매개변수를 해당 절의 어휘 범위에 선언한다.
  @override
  void visitCatchClause(CatchClause node) {
    _pushScope();
    try {
      final exceptionName = node.exceptionParameter?.name.lexeme;
      final stackTraceName = node.stackTraceParameter?.name.lexeme;
      if (exceptionName != null) _declare(exceptionName);
      if (stackTraceName != null) _declare(stackTraceName);
      super.visitCatchClause(node);
    } finally {
      _popScope();
    }
  }

  /// for 문의 선언 변수를 루프 범위에만 둔다.
  @override
  void visitForStatement(ForStatement node) {
    _pushScope();
    try {
      final parts = node.forLoopParts;
      if (parts is ForEachPartsWithDeclaration) {
        _declare(parts.loopVariable.name.lexeme);
      }
      super.visitForStatement(node);
    } finally {
      _popScope();
    }
  }

  /// 클래스 메서드 매개변수를 필드와 분리된 범위에 둔다.
  @override
  void visitMethodDeclaration(MethodDeclaration node) {
    _visitParameterScope(
      node.parameters,
      () => super.visitMethodDeclaration(node),
    );
  }

  /// 생성자 매개변수를 클래스 필드와 분리된 범위에 둔다.
  @override
  void visitConstructorDeclaration(ConstructorDeclaration node) {
    _visitParameterScope(
      node.parameters,
      () => super.visitConstructorDeclaration(node),
    );
  }

  /// 함수·클로저 매개변수와 지역 이름을 독립된 범위에 둔다.
  @override
  void visitFunctionExpression(FunctionExpression node) {
    _visitParameterScope(
      node.parameters,
      () => super.visitFunctionExpression(node),
    );
  }

  /// 매개변수 이름을 선언한 임시 어휘 범위에서 노드를 순회한다.
  void _visitParameterScope(
    FormalParameterList? parameters,
    void Function() visitChildren,
  ) {
    _pushScope();
    try {
      for (final parameter in parameters?.parameters ?? const []) {
        final name = parameter.name?.lexeme;
        if (name != null) _declare(name);
      }
      visitChildren();
    } finally {
      _popScope();
    }
  }

  /// MethodChannel을 담는 변수와 리터럴 이름을 연결한다.
  @override
  void visitVariableDeclaration(VariableDeclaration node) {
    _declare(node.name.lexeme);
    _recordStringConstant(node);
    final initializer = node.initializer;
    if (initializer is MethodInvocation &&
        _isUnresolvedMethodChannel(initializer)) {
      _recordChannelVariable(node, initializer.argumentList);
    } else if (initializer is InstanceCreationExpression &&
        _isMethodChannel(initializer)) {
      _recordChannelVariable(node, initializer.argumentList);
    }
    super.visitVariableDeclaration(node);
  }

  /// 단순 변수 재할당은 최신 채널 생성으로 갱신하거나 기존 연결을 지운다.
  @override
  void visitAssignmentExpression(AssignmentExpression node) {
    final left = node.leftHandSide;
    if (node.operator.lexeme == '=' && left is SimpleIdentifier) {
      _assignChannel(left.name, _channelCreatedBy(node.rightHandSide));
    }
    super.visitAssignmentExpression(node);
  }

  /// 리터럴 문자열 상수만 이름으로 보존한다.
  void _recordStringConstant(VariableDeclaration declaration) {
    final initializer = declaration.initializer;
    if (!declaration.isConst || initializer is! SimpleStringLiteral) return;
    _stringConstantScopes.last[declaration.name.lexeme] = initializer.value;
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
      node.constructorName.type.name.lexeme == 'MethodChannel' &&
      _isFlutterPrefix(node.constructorName.type.importPrefix?.name.lexeme);

  /// 대상 없는 MethodChannel 호출이 미해석 생성자 표현인지 확인한다.
  bool _isUnresolvedMethodChannel(MethodInvocation node) =>
      node.methodName.name == 'MethodChannel' &&
      (node.target == null && _isFlutterPrefix(null) ||
          node.target is SimpleIdentifier &&
              _isFlutterPrefix((node.target! as SimpleIdentifier).name));

  /// 명시적 Flutter prefix이거나 shadow되지 않은 unprefixed import인지 확인한다.
  bool _isFlutterPrefix(String? prefix) =>
      flutterPrefixes.contains(prefix) &&
      (prefix != null || !_isDeclared('MethodChannel'));

  /// 변수 선언의 채널 이름이 리터럴이면 후속 호출을 위해 보존한다.
  void _recordChannelVariable(
    VariableDeclaration declaration,
    ArgumentList arguments,
  ) {
    if (arguments.arguments.isEmpty) return;
    final channel = _bridgeName(arguments.arguments.first);
    _channelScopes.last[declaration.name.lexeme] = channel;
  }

  /// 생성자 표현식이면 첫 인자의 채널 이름을 반환한다.
  _BridgeName? _channelCreatedBy(Expression expression) {
    final ArgumentList? arguments;
    if (expression is MethodInvocation &&
        _isUnresolvedMethodChannel(expression)) {
      arguments = expression.argumentList;
    } else if (expression is InstanceCreationExpression &&
        _isMethodChannel(expression)) {
      arguments = expression.argumentList;
    } else {
      return null;
    }
    if (arguments.arguments.isEmpty) return null;
    return _bridgeName(arguments.arguments.first);
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
    final target = node.realTarget;
    final arguments = node.argumentList.arguments;
    if (target == null || arguments.isEmpty) return;
    final channel = target is SimpleIdentifier
        ? _channel(named: target.name)
        : _channelCreatedBy(target);
    if (channel == null) {
      unresolvedReceiverInvocations++;
      return;
    }
    final method = _bridgeName(arguments.first);
    facts.add(
      _fact(
        node.methodName.offset,
        'method-invoke',
        channel.value,
        method: method.value,
        isDynamic: channel.isDynamic || method.isDynamic,
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
      final value = _stringConstant(named: argument.name);
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
    final lineOffset = lineInfo.getOffsetOfLine(location.lineNumber - 1);
    final utf8Column =
        utf8.encode(source.substring(lineOffset, offset)).length + 1;
    return BridgeFact({
      'kind': kind,
      'channel': channel,
      if (method != null) 'method': method,
      'dynamic': isDynamic,
      'location': {
        'path': relativePath,
        'line': location.lineNumber,
        'column': utf8Column,
      },
    });
  }

  /// 새 어휘 범위를 만든다.
  void _pushScope() {
    _channelScopes.add({});
    _stringConstantScopes.add({});
    _declaredNameScopes.add({});
  }

  /// 현재 어휘 범위를 제거한다.
  void _popScope() {
    _channelScopes.removeLast();
    _stringConstantScopes.removeLast();
    _declaredNameScopes.removeLast();
  }

  /// 현재 범위에 이름을 선언해 바깥 바인딩을 가린다.
  void _declare(String name) => _declaredNameScopes.last.add(name);

  /// 가장 가까운 범위 중 하나가 이름을 선언했는지 확인한다.
  bool _isDeclared(String name) =>
      _declaredNameScopes.reversed.any((scope) => scope.contains(name));

  /// 선언된 가장 가까운 범위의 채널 바인딩을 갱신한다.
  void _assignChannel(String name, _BridgeName? channel) {
    for (var index = _channelScopes.length - 1; index >= 0; index--) {
      if (!_declaredNameScopes[index].contains(name)) continue;
      if (channel == null) {
        _channelScopes[index].remove(name);
      } else {
        _channelScopes[index][name] = channel;
      }
      return;
    }
  }

  /// 가장 가까운 선언 범위에서 채널 변수를 찾는다.
  _BridgeName? _channel({required String named}) {
    for (var index = _channelScopes.length - 1; index >= 0; index--) {
      final value = _channelScopes[index][named];
      if (value != null) return value;
      if (_declaredNameScopes[index].contains(named)) return null;
    }
    return null;
  }

  /// 가장 가까운 선언 범위에서 문자열 상수를 찾는다.
  String? _stringConstant({required String named}) {
    for (var index = _stringConstantScopes.length - 1; index >= 0; index--) {
      final value = _stringConstantScopes[index][named];
      if (value != null) return value;
      if (_declaredNameScopes[index].contains(named)) return null;
    }
    return null;
  }
}

/// 정적 값 또는 동적 원문을 함께 보존하는 브리지 이름이다.
typedef _BridgeName = ({String value, bool isDynamic});
