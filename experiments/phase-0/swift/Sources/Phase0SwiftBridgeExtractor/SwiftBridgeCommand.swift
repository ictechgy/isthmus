/// Swift 추출 명령의 프로세스 경계 결과다.
public struct SwiftBridgeCommandResult: Equatable, Sendable {
    /// 표준 출력·오류와 종료 코드를 보존한다.
    public init(
        standardOutput: String,
        standardError: String,
        exitCode: Int32
    ) {
        self.standardOutput = standardOutput
        self.standardError = standardError
        self.exitCode = exitCode
    }

    /// 성공 시 GRAPH-EXCHANGE JSON이다.
    public let standardOutput: String

    /// 실패 시 경로를 포함하지 않는 안내다.
    public let standardError: String

    /// CLI 종료 코드 계약 값이다.
    public let exitCode: Int32
}

/// 인자와 파일 읽기 경계를 받아 Swift 추출 명령을 실행한다.
public func runSwiftBridgeCommand(
    arguments: [String],
    readSource: (String) throws -> String
) throws -> SwiftBridgeCommandResult {
    let source = try readSource(arguments[0])
    let facts = SwiftBridgeFactExtractor().extract(
        source: source,
        relativePath: arguments[4]
    )
    let document = makeSwiftBridgeFactsDocument(
        facts: facts,
        generatedAt: arguments[6],
        project: arguments[2]
    )
    return try SwiftBridgeCommandResult(
        standardOutput: encodeSwiftBridgeFactsDocument(document),
        standardError: "",
        exitCode: 0
    )
}

/// 프로세스 경계에서 인자 오류를 종료 코드로 바꾼다.
public func executeSwiftBridgeCommand(
    arguments: [String],
    readSource: (String) throws -> String
) -> SwiftBridgeCommandResult {
    guard isValidSwiftBridgeArguments(arguments) else {
        return SwiftBridgeCommandResult(
            standardOutput: "",
            standardError: swiftBridgeUsage + "\n",
            exitCode: 64
        )
    }
    do {
        return try runSwiftBridgeCommand(
            arguments: arguments,
            readSource: readSource
        )
    } catch {
        return SwiftBridgeCommandResult(
            standardOutput: "",
            standardError: "Unable to read the source file; check its path and permissions.\n",
            exitCode: 2
        )
    }
}

/// Phase 0 명령의 고정 인자와 UTC 시각을 검증한다.
private func isValidSwiftBridgeArguments(_ arguments: [String]) -> Bool {
    arguments.count == 7
        && arguments[1] == "--project"
        && arguments[3] == "--path"
        && arguments[5] == "--generated-at"
        && arguments[6].hasSuffix("Z")
}

/// 절대 로컬 경로를 포함하지 않는 사용법이다.
private let swiftBridgeUsage = "Usage: extract-swift-bridges <source> "
    + "--project <absolute-root> --path <relative-path> "
    + "--generated-at <utc-iso8601>"
