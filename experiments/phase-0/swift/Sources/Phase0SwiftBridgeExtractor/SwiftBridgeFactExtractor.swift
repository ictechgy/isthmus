import Foundation
import SwiftParser
import SwiftSyntax

/// 공개 가능한 소스 위치다.
public struct BridgeLocation: Codable, Equatable, Sendable {
    /// 상대 경로와 1부터 시작하는 줄·열을 보존한다.
    public init(path: String, line: Int, column: Int) {
        self.path = path
        self.line = line
        self.column = column
    }

    /// 프로젝트 상대 경로다.
    public let path: String

    /// 1부터 시작하는 줄이다.
    public let line: Int

    /// 1부터 시작하는 UTF-8 열이다.
    public let column: Int
}

/// 브리지 사실을 감싸는 Swift 선언의 식별자다.
public struct BridgeSymbol: Codable, Equatable, Sendable {
    /// 구문에서 얻은 이름과 선택적인 컴파일러 USR을 보존한다.
    public init(qualifiedName: String, usr: String? = nil) {
        self.qualifiedName = qualifiedName
        self.usr = usr
    }

    /// 타입과 함수를 점으로 이은 선언 이름이다.
    public let qualifiedName: String

    /// cartograph 인덱스 결합 뒤 채워질 컴파일러 USR이다.
    public let usr: String?
}

/// GRAPH-EXCHANGE의 Swift 브리지 사실이다.
public struct BridgeFact: Codable, Equatable, Sendable {
    /// Phase 0에서 검증할 공통 필드를 만든다.
    public init(
        kind: String,
        channel: String,
        method: String? = nil,
        dynamic: Bool,
        location: BridgeLocation,
        symbol: BridgeSymbol? = nil
    ) {
        self.kind = kind
        self.channel = channel
        self.method = method
        self.dynamic = dynamic
        self.location = location
        self.symbol = symbol
    }

    /// 사실 종류다.
    public let kind: String

    /// 리터럴 값 또는 동적 원문 표현식이다.
    public let channel: String

    /// 메서드 사실에만 있는 이름이다.
    public let method: String?

    /// 이름을 정적으로 조인할 수 없는지 나타낸다.
    public let dynamic: Bool

    /// 사실이 나타난 소스 위치다.
    public let location: BridgeLocation

    /// 사실을 감싸는 선언이다.
    public let symbol: BridgeSymbol?
}

/// SwiftSyntax로 Flutter 브리지 사실을 추출한다.
public struct SwiftBridgeFactExtractor: Sendable {
    /// 상태 없는 추출기를 만든다.
    public init() {}

    /// Swift 소스 하나에서 브리지 사실을 찾는다.
    public func extract(source: String, relativePath: String) throws -> [BridgeFact] {
        let tree = Parser.parse(source: source)
        guard !tree.hasError else { throw SwiftBridgeExtractionError.invalidSyntax }
        let importDetector = FlutterImportDetector()
        importDetector.walk(tree)
        guard importDetector.hasFlutterImport else { return [] }
        let converter = SourceLocationConverter(fileName: relativePath, tree: tree)
        let collector = BridgeFactCollector(
            relativePath: relativePath,
            converter: converter
        )
        collector.walk(tree)
        return collector.facts
    }
}

/// SwiftParser가 복구 노드를 만든 잘못된 소스를 나타낸다.
public enum SwiftBridgeExtractionError: Error, Sendable {
    case invalidSyntax
}

/// 파일이 실제 Flutter 모듈을 가져오는지 구문으로 확인한다.
private final class FlutterImportDetector: SyntaxVisitor {
    private(set) var hasFlutterImport = false

    init() {
        super.init(viewMode: .sourceAccurate)
    }

    override func visit(_ node: ImportDeclSyntax) -> SyntaxVisitorContinueKind {
        if node.path.trimmedDescription == "Flutter" {
            hasFlutterImport = true
        }
        return .skipChildren
    }
}

/// Swift 추출 사실의 GRAPH-EXCHANGE 문서다.
public struct BridgeFactsDocument: Encodable, Sendable {
    /// 고정 외피와 호출자가 제공한 사실을 결합한다.
    init(
        generatedAt: String,
        project: String,
        facts: [BridgeFact],
        limitations: [String]
    ) {
        self.generatedAt = generatedAt
        self.project = project
        self.facts = facts
        self.target = facts.isEmpty ? nil : "flutter"
        self.limitations = limitations
    }

    /// 교환 문서 종류다.
    public let format = "bridge-facts"

    /// Flutter↔Swift 코퍼스로 검증한 형식 버전이다.
    public let version = 1

    /// 문서를 만든 실험 도구다.
    public let tool = BridgeTool(
        name: "isthmus-phase0-swift",
        version: "0.0.0"
    )

    /// 입력을 읽은 UTC 시각이다.
    public let generatedAt: String

    /// 추출한 소스 플랫폼이다.
    public let platform = "swift"

    /// 사실이 있을 때 검증 중인 브리지 메커니즘이다.
    public let target: String?

    /// 분석 대상의 절대 경로다.
    public let project: String

    /// SwiftSyntax에서 얻은 사실이다.
    public let facts: [BridgeFact]

    /// 동적 이름으로 생긴 분석 한계다.
    public let limitations: [String]

    /// 선택 target도 빈 문서에서는 명시적인 JSON null로 인코딩한다.
    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(format, forKey: .format)
        try container.encode(version, forKey: .version)
        try container.encode(tool, forKey: .tool)
        try container.encode(generatedAt, forKey: .generatedAt)
        try container.encode(platform, forKey: .platform)
        if let target {
            try container.encode(target, forKey: .target)
        } else {
            try container.encodeNil(forKey: .target)
        }
        try container.encode(project, forKey: .project)
        try container.encode(facts, forKey: .facts)
        try container.encode(limitations, forKey: .limitations)
    }

    private enum CodingKeys: String, CodingKey {
        case format
        case version
        case tool
        case generatedAt
        case platform
        case target
        case project
        case facts
        case limitations
    }
}

/// 교환 문서를 만든 도구의 신원이다.
public struct BridgeTool: Encodable, Sendable {
    /// 도구 이름과 버전을 보존한다.
    public init(name: String, version: String) {
        self.name = name
        self.version = version
    }

    /// 도구 이름이다.
    public let name: String

    /// 도구 버전이다.
    public let version: String
}

/// Swift 교환 문서를 결정적인 JSON 문자열로 인코딩한다.
public func encodeSwiftBridgeFactsDocument(
    _ document: BridgeFactsDocument
) throws -> String {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
    let data = try encoder.encode(document)
    return String(decoding: data, as: UTF8.self) + "\n"
}

/// Swift 사실을 교환 문서로 감싼다.
public func makeSwiftBridgeFactsDocument(
    facts: [BridgeFact],
    generatedAt: String,
    project: String
) -> BridgeFactsDocument {
    let dynamicChannels = facts.filter {
        $0.kind == "channel-register" && $0.dynamic
    }.count
    let dynamicMethods = facts.filter {
        $0.kind == "method-handle" && $0.dynamic
    }.count
    let missingHandlerUSRs = facts.filter {
        $0.kind == "method-handle" && $0.symbol?.usr == nil
    }.count
    var limitations: [String] = []
    if dynamicChannels > 0 {
        limitations.append(
            "dynamic-channel-names: \(dynamicChannels) channel constructors use a non-literal name"
        )
    }
    if dynamicMethods > 0 {
        limitations.append(
            "dynamic-method-names: \(dynamicMethods) method handlers use a non-literal name"
        )
    }
    if missingHandlerUSRs > 0 {
        limitations.append(
            "missing-handler-usrs: \(missingHandlerUSRs) method handlers have only a qualified name"
        )
    }
    return BridgeFactsDocument(
        generatedAt: generatedAt,
        project: project,
        facts: facts,
        limitations: limitations
    )
}

/// 변수 선언을 따라 FlutterMethodChannel 생성 사실을 모은다.
private final class BridgeFactCollector: SyntaxVisitor {
    /// 공개할 경로와 위치 변환기를 보존한다.
    init(relativePath: String, converter: SourceLocationConverter) {
        self.relativePath = relativePath
        self.converter = converter
        super.init(viewMode: .sourceAccurate)
    }

    /// 추출된 브리지 사실이다.
    private(set) var facts: [BridgeFact] = []

    /// 어휘 범위별 한 단계 문자열 상수다.
    private var stringConstantScopes: [[String: String]] = [[:]]

    /// 어휘 범위별 채널 변수의 값과 동적 여부다.
    private var channelScopes: [[String: BridgeName]] = [[:]]

    /// 바깥 범위의 같은 이름을 가리는 선언 이름이다.
    private var declaredNameScopes: [Set<String>] = [[]]

    /// 현재 순회 중인 setMethodCallHandler의 채널·호출 매개변수 문맥이다.
    private var handlerContexts: [HandlerContext] = []

    /// 중첩 switch가 call.method를 대상으로 하는지 보존한다.
    private var methodSwitches: [Bool] = []

    /// 현재 사실을 감싸는 타입과 함수 이름이다.
    private var declarationNames: [String] = []

    /// 공개 가능한 프로젝트 상대 경로다.
    private let relativePath: String

    /// 구문 위치를 줄과 열로 바꾼다.
    private let converter: SourceLocationConverter

    /// 클래스 이름을 하위 사실의 선언 문맥에 추가한다.
    override func visit(_ node: ClassDeclSyntax) -> SyntaxVisitorContinueKind {
        declarationNames.append(node.name.text)
        pushScope()
        return .visitChildren
    }

    /// 클래스 순회가 끝나면 선언 문맥을 제거한다.
    override func visitPost(_ node: ClassDeclSyntax) {
        popScope()
        declarationNames.removeLast()
    }

    /// 구조체 이름을 하위 사실의 선언 문맥에 추가한다.
    override func visit(_ node: StructDeclSyntax) -> SyntaxVisitorContinueKind {
        declarationNames.append(node.name.text)
        pushScope()
        return .visitChildren
    }

    /// 구조체 순회가 끝나면 선언 문맥을 제거한다.
    override func visitPost(_ node: StructDeclSyntax) {
        popScope()
        declarationNames.removeLast()
    }

    /// 열거형 이름을 하위 사실의 선언 문맥에 추가한다.
    override func visit(_ node: EnumDeclSyntax) -> SyntaxVisitorContinueKind {
        declarationNames.append(node.name.text)
        pushScope()
        return .visitChildren
    }

    /// 열거형 순회가 끝나면 선언 문맥을 제거한다.
    override func visitPost(_ node: EnumDeclSyntax) {
        popScope()
        declarationNames.removeLast()
    }

    /// actor 이름을 하위 사실의 선언 문맥에 추가한다.
    override func visit(_ node: ActorDeclSyntax) -> SyntaxVisitorContinueKind {
        declarationNames.append(node.name.text)
        pushScope()
        return .visitChildren
    }

    /// actor 순회가 끝나면 선언 문맥을 제거한다.
    override func visitPost(_ node: ActorDeclSyntax) {
        popScope()
        declarationNames.removeLast()
    }

    /// 확장 대상 타입을 하위 사실의 선언 문맥에 추가한다.
    override func visit(_ node: ExtensionDeclSyntax) -> SyntaxVisitorContinueKind {
        declarationNames.append(node.extendedType.trimmedDescription)
        pushScope()
        return .visitChildren
    }

    /// extension 순회가 끝나면 선언 문맥을 제거한다.
    override func visitPost(_ node: ExtensionDeclSyntax) {
        popScope()
        declarationNames.removeLast()
    }

    /// 함수 이름을 하위 사실의 선언 문맥에 추가한다.
    override func visit(_ node: FunctionDeclSyntax) -> SyntaxVisitorContinueKind {
        declarationNames.append(node.name.text)
        pushScope()
        for parameter in node.signature.parameterClause.parameters {
            declare((parameter.secondName ?? parameter.firstName).text)
        }
        return .visitChildren
    }

    /// 함수 순회가 끝나면 선언 문맥을 제거한다.
    override func visitPost(_ node: FunctionDeclSyntax) {
        popScope()
        declarationNames.removeLast()
    }

    /// 중첩 코드 블록의 지역 이름을 바깥 범위와 분리한다.
    override func visit(_ node: CodeBlockSyntax) -> SyntaxVisitorContinueKind {
        pushScope()
        return .visitChildren
    }

    /// 코드 블록을 벗어나면 지역 이름을 제거한다.
    override func visitPost(_ node: CodeBlockSyntax) {
        popScope()
    }

    /// 클로저 매개변수와 지역 선언을 독립된 범위에 둔다.
    override func visit(_ node: ClosureExprSyntax) -> SyntaxVisitorContinueKind {
        pushScope()
        declareClosureParameters(node)
        return .visitChildren
    }

    /// 클로저를 벗어나면 그 범위를 제거한다.
    override func visitPost(_ node: ClosureExprSyntax) {
        popScope()
    }

    /// 문자열 상수와 채널 생성 변수를 소스 순서대로 기록한다.
    override func visit(_ node: VariableDeclSyntax) -> SyntaxVisitorContinueKind {
        for binding in node.bindings {
            guard let pattern = binding.pattern.as(IdentifierPatternSyntax.self) else {
                continue
            }
            let name = pattern.identifier.text
            declare(name)
            guard let initializer = binding.initializer?.value else { continue }
            recordConstant(
                name: name,
                expression: initializer,
                isImmutable: node.bindingSpecifier.text == "let"
            )
            recordChannelCreation(
                variableName: name,
                expression: initializer
            )
        }
        return .visitChildren
    }

    /// 핸들러 호출에 들어갈 때 수신 채널 문맥을 쌓는다.
    override func visit(_ node: FunctionCallExprSyntax) -> SyntaxVisitorContinueKind {
        if let channel = handlerChannel(node) {
            recordChannelRegistration(node, channel: channel)
            handlerContexts.append(HandlerContext(
                channel: channel,
                callParameterName: handlerCallParameterName(node)
            ))
        }
        return .visitChildren
    }

    /// 핸들러 호출 순회가 끝나면 해당 채널 문맥을 제거한다.
    override func visitPost(_ node: FunctionCallExprSyntax) {
        if handlerChannel(node) != nil { handlerContexts.removeLast() }
    }

    /// call.method switch 여부를 중첩 문맥에 기록한다.
    override func visit(_ node: SwitchExprSyntax) -> SyntaxVisitorContinueKind {
        methodSwitches.append(
            handlerContexts.last.map {
                isMethodSubject(
                    node.subject,
                    callParameterName: $0.callParameterName
                )
            } ?? false
        )
        return .visitChildren
    }

    /// switch 순회가 끝나면 해당 문맥을 제거한다.
    override func visitPost(_ node: SwitchExprSyntax) {
        methodSwitches.removeLast()
    }

    /// call.method의 문자열 case를 method-handle 사실로 기록한다.
    override func visit(_ node: SwitchCaseSyntax) -> SyntaxVisitorContinueKind {
        guard methodSwitches.last == true,
              let channel = handlerContexts.last?.channel,
              case let .case(label) = node.label
        else { return .visitChildren }
        for item in label.caseItems {
            recordHandledMethod(pattern: item.pattern, channel: channel)
        }
        return .visitChildren
    }

    /// 보간 없는 문자열 선언만 상수 후보로 보존한다.
    private func recordConstant(
        name: String,
        expression: ExprSyntax,
        isImmutable: Bool
    ) {
        guard isImmutable,
              let literal = expression.as(StringLiteralExprSyntax.self),
              let value = literal.representedLiteralValue
        else { return }
        stringConstantScopes[stringConstantScopes.count - 1][name] = value
    }

    /// FlutterMethodChannel의 name 인자를 변수의 채널 값으로 보존한다.
    private func recordChannelCreation(variableName: String, expression: ExprSyntax) {
        guard let call = expression.as(FunctionCallExprSyntax.self),
              isFlutterMethodChannel(call),
              let argument = call.arguments.first(where: { $0.label?.text == "name" })
        else { return }
        let channel = bridgeName(argument.expression)
        channelScopes[channelScopes.count - 1][variableName] = channel
    }

    /// 호출 대상이 FlutterMethodChannel 생성자인지 구문으로 확인한다.
    private func isFlutterMethodChannel(_ call: FunctionCallExprSyntax) -> Bool {
        call.calledExpression.as(DeclReferenceExprSyntax.self)?.baseName.text
            == "FlutterMethodChannel"
    }

    /// setMethodCallHandler의 수신 변수에서 채널 문맥을 찾는다.
    private func handlerChannel(
        _ call: FunctionCallExprSyntax
    ) -> (value: String, isDynamic: Bool)? {
        guard let member = call.calledExpression.as(MemberAccessExprSyntax.self),
              member.declName.baseName.text == "setMethodCallHandler",
              call.arguments.first?.expression.as(NilLiteralExprSyntax.self) == nil,
              let receiver = member.base?.as(DeclReferenceExprSyntax.self)
        else { return nil }
        return channel(named: receiver.baseName.text)
    }

    /// 실제 setMethodCallHandler 호출을 channel-register 사실로 만든다.
    private func recordChannelRegistration(
        _ call: FunctionCallExprSyntax,
        channel: (value: String, isDynamic: Bool)
    ) {
        guard let member = call.calledExpression.as(MemberAccessExprSyntax.self) else { return }
        facts.append(BridgeFact(
            kind: "channel-register",
            channel: channel.value,
            dynamic: channel.isDynamic,
            location: location(of: member.declName)
        ))
    }

    /// 핸들러 클로저의 첫 번째 호출 매개변수 이름을 얻는다.
    private func handlerCallParameterName(_ call: FunctionCallExprSyntax) -> String? {
        let closure = call.trailingClosure
            ?? call.arguments.first?.expression.as(ClosureExprSyntax.self)
        guard let parameters = closure?.signature?.parameterClause else { return nil }
        let name: String?
        switch parameters {
        case let .simpleInput(list):
            name = list.first?.name.text
        case let .parameterClause(clause):
            name = clause.parameters.first.map { ($0.secondName ?? $0.firstName).text }
        }
        return name == "_" ? nil : name
    }

    /// switch 대상이 해당 핸들러 매개변수의 method인지 확인한다.
    private func isMethodSubject(
        _ subject: ExprSyntax,
        callParameterName: String?
    ) -> Bool {
        guard let callParameterName,
              let member = subject.as(MemberAccessExprSyntax.self),
              member.declName.baseName.text == "method",
              let receiver = member.base?.as(DeclReferenceExprSyntax.self)
        else { return false }
        return receiver.baseName.text == callParameterName
    }

    /// 문자열 case 하나를 현재 채널의 처리 사실로 바꾼다.
    private func recordHandledMethod(
        pattern: PatternSyntax,
        channel: (value: String, isDynamic: Bool)
    ) {
        guard let expression = pattern.as(ExpressionPatternSyntax.self)?.expression else { return }
        let method = bridgeName(expression)
        facts.append(BridgeFact(
            kind: "method-handle",
            channel: channel.value,
            method: method.value,
            dynamic: channel.isDynamic || method.isDynamic,
            location: location(of: expression),
            symbol: enclosingSymbol()
        ))
    }

    /// 현재 타입·함수 문맥을 qualifiedName으로 만든다.
    private func enclosingSymbol() -> BridgeSymbol? {
        guard !declarationNames.isEmpty else { return nil }
        return BridgeSymbol(qualifiedName: declarationNames.joined(separator: "."))
    }

    /// 리터럴과 한 단계 상수 참조를 정적 이름으로 해석한다.
    private func bridgeName(_ expression: ExprSyntax) -> (value: String, isDynamic: Bool) {
        if let literal = expression.as(StringLiteralExprSyntax.self),
           let value = literal.representedLiteralValue {
            return (value, false)
        }
        if let name = referencedName(expression), let value = stringConstant(named: name) {
            return (value, false)
        }
        return (expression.trimmedDescription, true)
    }

    /// 단순 참조와 Self 멤버 참조에서 마지막 이름을 얻는다.
    private func referencedName(_ expression: ExprSyntax) -> String? {
        if let reference = expression.as(DeclReferenceExprSyntax.self) {
            return reference.baseName.text
        }
        return expression.as(MemberAccessExprSyntax.self)?.declName.baseName.text
    }

    /// 구문 노드의 시작점을 공개 위치로 바꾼다.
    private func location(of node: some SyntaxProtocol) -> BridgeLocation {
        let sourceLocation = node.startLocation(converter: converter)
        return BridgeLocation(
            path: relativePath,
            line: sourceLocation.line,
            column: sourceLocation.column
        )
    }

    /// 새 어휘 범위를 만든다.
    private func pushScope() {
        stringConstantScopes.append([:])
        channelScopes.append([:])
        declaredNameScopes.append([])
    }

    /// 현재 어휘 범위를 제거한다.
    private func popScope() {
        stringConstantScopes.removeLast()
        channelScopes.removeLast()
        declaredNameScopes.removeLast()
    }

    /// 현재 범위에 이름을 선언해 바깥 바인딩을 가린다.
    private func declare(_ name: String) {
        guard name != "_" else { return }
        declaredNameScopes[declaredNameScopes.count - 1].insert(name)
    }

    /// 클로저의 명시적 매개변수 이름을 현재 범위에 선언한다.
    private func declareClosureParameters(_ closure: ClosureExprSyntax) {
        guard let parameters = closure.signature?.parameterClause else { return }
        switch parameters {
        case let .simpleInput(list):
            for parameter in list { declare(parameter.name.text) }
        case let .parameterClause(clause):
            for parameter in clause.parameters {
                declare((parameter.secondName ?? parameter.firstName).text)
            }
        }
    }

    /// 가장 가까운 선언 범위에서 문자열 상수를 찾는다.
    private func stringConstant(named name: String) -> String? {
        for index in stringConstantScopes.indices.reversed() {
            if let value = stringConstantScopes[index][name] { return value }
            if declaredNameScopes[index].contains(name) { return nil }
        }
        return nil
    }

    /// 가장 가까운 선언 범위에서 채널 변수를 찾는다.
    private func channel(named name: String) -> BridgeName? {
        for index in channelScopes.indices.reversed() {
            if let value = channelScopes[index][name] { return value }
            if declaredNameScopes[index].contains(name) { return nil }
        }
        return nil
    }
}

/// 인라인 핸들러를 채널과 첫 번째 호출 매개변수에 묶는 문맥이다.
private struct HandlerContext {
    let channel: BridgeName
    let callParameterName: String?
}

/// 정적 값 또는 동적 원문을 함께 보존하는 브리지 이름이다.
private typealias BridgeName = (value: String, isDynamic: Bool)
