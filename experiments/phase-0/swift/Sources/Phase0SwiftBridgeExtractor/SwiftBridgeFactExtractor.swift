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
    public func extract(source: String, relativePath: String) -> [BridgeFact] {
        let tree = Parser.parse(source: source)
        let converter = SourceLocationConverter(fileName: relativePath, tree: tree)
        let collector = BridgeFactCollector(
            relativePath: relativePath,
            converter: converter
        )
        collector.walk(tree)
        return collector.facts
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

    /// 검증 중인 브리지 메커니즘이다.
    public let target = "flutter"

    /// 분석 대상의 절대 경로다.
    public let project: String

    /// SwiftSyntax에서 얻은 사실이다.
    public let facts: [BridgeFact]

    /// 동적 이름으로 생긴 분석 한계다.
    public let limitations: [String]
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
    let missingHandlerUSRs = facts.filter {
        $0.kind == "method-handle" && $0.symbol?.usr == nil
    }.count
    var limitations: [String] = []
    if dynamicChannels > 0 {
        limitations.append(
            "dynamic-channel-names: \(dynamicChannels) channel constructors use a non-literal name"
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

    /// 한 단계 추적할 문자열 상수다.
    private var stringConstants: [String: String] = [:]

    /// 변수 이름별 채널 값과 동적 여부다.
    private var channelsByVariable: [String: (value: String, isDynamic: Bool)] = [:]

    /// 현재 순회 중인 setMethodCallHandler의 채널 문맥이다.
    private var handlerChannels: [(value: String, isDynamic: Bool)] = []

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
        return .visitChildren
    }

    /// 클래스 순회가 끝나면 선언 문맥을 제거한다.
    override func visitPost(_ node: ClassDeclSyntax) {
        declarationNames.removeLast()
    }

    /// 함수 이름을 하위 사실의 선언 문맥에 추가한다.
    override func visit(_ node: FunctionDeclSyntax) -> SyntaxVisitorContinueKind {
        declarationNames.append(node.name.text)
        return .visitChildren
    }

    /// 함수 순회가 끝나면 선언 문맥을 제거한다.
    override func visitPost(_ node: FunctionDeclSyntax) {
        declarationNames.removeLast()
    }

    /// 문자열 상수와 채널 생성 변수를 소스 순서대로 기록한다.
    override func visit(_ node: VariableDeclSyntax) -> SyntaxVisitorContinueKind {
        for binding in node.bindings {
            guard let pattern = binding.pattern.as(IdentifierPatternSyntax.self),
                  let initializer = binding.initializer?.value
            else { continue }
            recordConstant(name: pattern.identifier.text, expression: initializer)
            recordChannelCreation(
                variableName: pattern.identifier.text,
                expression: initializer
            )
        }
        return .visitChildren
    }

    /// 핸들러 호출에 들어갈 때 수신 채널 문맥을 쌓는다.
    override func visit(_ node: FunctionCallExprSyntax) -> SyntaxVisitorContinueKind {
        if let channel = handlerChannel(node) {
            recordChannelRegistration(node, channel: channel)
            handlerChannels.append(channel)
        }
        return .visitChildren
    }

    /// 핸들러 호출 순회가 끝나면 해당 채널 문맥을 제거한다.
    override func visitPost(_ node: FunctionCallExprSyntax) {
        if handlerChannel(node) != nil { handlerChannels.removeLast() }
    }

    /// call.method switch 여부를 중첩 문맥에 기록한다.
    override func visit(_ node: SwitchExprSyntax) -> SyntaxVisitorContinueKind {
        methodSwitches.append(!handlerChannels.isEmpty && isMethodSubject(node.subject))
        return .visitChildren
    }

    /// switch 순회가 끝나면 해당 문맥을 제거한다.
    override func visitPost(_ node: SwitchExprSyntax) {
        methodSwitches.removeLast()
    }

    /// call.method의 문자열 case를 method-handle 사실로 기록한다.
    override func visit(_ node: SwitchCaseSyntax) -> SyntaxVisitorContinueKind {
        guard methodSwitches.last == true,
              let channel = handlerChannels.last,
              case let .case(label) = node.label
        else { return .visitChildren }
        for item in label.caseItems {
            recordHandledMethod(pattern: item.pattern, channel: channel)
        }
        return .visitChildren
    }

    /// 보간 없는 문자열 선언만 상수 후보로 보존한다.
    private func recordConstant(name: String, expression: ExprSyntax) {
        guard let literal = expression.as(StringLiteralExprSyntax.self),
              let value = literal.representedLiteralValue
        else { return }
        stringConstants[name] = value
    }

    /// FlutterMethodChannel의 name 인자를 변수의 채널 값으로 보존한다.
    private func recordChannelCreation(variableName: String, expression: ExprSyntax) {
        guard let call = expression.as(FunctionCallExprSyntax.self),
              isFlutterMethodChannel(call),
              let argument = call.arguments.first(where: { $0.label?.text == "name" })
        else { return }
        let channel = bridgeName(argument.expression)
        channelsByVariable[variableName] = channel
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
              let receiver = member.base?.as(DeclReferenceExprSyntax.self)
        else { return nil }
        return channelsByVariable[receiver.baseName.text]
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

    /// switch 대상이 call.method 형태인지 확인한다.
    private func isMethodSubject(_ subject: ExprSyntax) -> Bool {
        subject.as(MemberAccessExprSyntax.self)?.declName.baseName.text == "method"
    }

    /// 문자열 case 하나를 현재 채널의 처리 사실로 바꾼다.
    private func recordHandledMethod(
        pattern: PatternSyntax,
        channel: (value: String, isDynamic: Bool)
    ) {
        guard let expression = pattern.as(ExpressionPatternSyntax.self)?.expression else { return }
        let method = bridgeName(expression)
        guard !method.isDynamic else { return }
        facts.append(BridgeFact(
            kind: "method-handle",
            channel: channel.value,
            method: method.value,
            dynamic: channel.isDynamic,
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
        if let name = referencedName(expression), let value = stringConstants[name] {
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
}
