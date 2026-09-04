import Foundation

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
    guard isValidSwiftBridgeArguments(arguments) else {
        return invalidSwiftBridgeArgumentsResult()
    }
    let source = try readSource(arguments[0])
    let facts = try SwiftBridgeFactExtractor().extract(
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
    do {
        return try runSwiftBridgeCommand(
            arguments: arguments,
            readSource: readSource
        )
    } catch is SwiftBridgeExtractionError {
        return SwiftBridgeCommandResult(
            standardOutput: "",
            standardError: "Unable to parse the source file; fix syntax errors and retry.\n",
            exitCode: 2
        )
    } catch {
        return SwiftBridgeCommandResult(
            standardOutput: "",
            standardError: "Unable to read the source file; check its path and permissions.\n",
            exitCode: 2
        )
    }
}

/// 잘못된 공개 API·CLI 인자를 안전한 사용법 결과로 바꾼다.
private func invalidSwiftBridgeArgumentsResult() -> SwiftBridgeCommandResult {
    SwiftBridgeCommandResult(
        standardOutput: "",
        standardError: swiftBridgeUsage + "\n",
        exitCode: 64
    )
}

/// Phase 0 명령의 고정 인자와 UTC 시각을 검증한다.
private func isValidSwiftBridgeArguments(_ arguments: [String]) -> Bool {
    guard arguments.count == 7 else { return false }
    return arguments[1] == "--project"
        && arguments[3] == "--path"
        && arguments[5] == "--generated-at"
        && isAbsoluteProjectPath(arguments[2])
        && isProjectRelativePath(arguments[4])
        && isValidUTCTimestamp(arguments[6])
}

/// 프로젝트 경로가 제어 문자 없는 절대 경로인지 확인한다.
private func isAbsoluteProjectPath(_ value: String) -> Bool {
    isSafeNonEmptyString(value) && (value as NSString).isAbsolutePath
}

/// 출력할 위치가 상위 이동과 절대 표기를 포함하지 않는지 확인한다.
private func isProjectRelativePath(_ value: String) -> Bool {
    guard isSafeNonEmptyString(value), !(value as NSString).isAbsolutePath else {
        return false
    }
    if value.hasPrefix("\\") { return false }
    if value.count >= 2 && value[value.index(after: value.startIndex)] == ":" {
        return false
    }
    return !value.split(whereSeparator: { $0 == "/" || $0 == "\\" }).contains("..")
}

/// 비어 있지 않고 ASCII 제어 문자가 없는 문자열인지 확인한다.
private func isSafeNonEmptyString(_ value: String) -> Bool {
    !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        && !value.unicodeScalars.contains { $0.value <= 0x1F || $0.value == 0x7F }
}

/// 실제 달력 날짜와 UTC 표기를 갖는 ISO 8601 생성 시각인지 확인한다.
private func isValidUTCTimestamp(_ value: String) -> Bool {
    let range = NSRange(value.startIndex ..< value.endIndex, in: value)
    guard let match = utcTimestampPattern.firstMatch(in: value, range: range) else {
        return false
    }
    let components = (1 ... 6).compactMap { index -> Int? in
        guard let range = Range(match.range(at: index), in: value) else { return nil }
        return Int(value[range])
    }
    guard components.count == 6 else { return false }
    let year = components[0]
    let month = components[1]
    let day = components[2]
    return (1 ... 12).contains(month)
        && (1 ... daysInMonth(year: year, month: month)).contains(day)
        && (0 ... 23).contains(components[3])
        && (0 ... 59).contains(components[4])
        && (0 ... 59).contains(components[5])
}

/// 윤년을 포함한 달의 실제 일수를 반환한다.
private func daysInMonth(year: Int, month: Int) -> Int {
    if month == 2 {
        let isLeapYear = year.isMultiple(of: 4)
            && (!year.isMultiple(of: 100) || year.isMultiple(of: 400))
        return isLeapYear ? 29 : 28
    }
    return [4, 6, 9, 11].contains(month) ? 30 : 31
}

private let utcTimestampPattern = try! NSRegularExpression(
    pattern: #"^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$"#
)

/// 절대 로컬 경로를 포함하지 않는 사용법이다.
private let swiftBridgeUsage = "Usage: extract-swift-bridges <source> "
    + "--project <absolute-root> --path <relative-path> "
    + "--generated-at <utc-iso8601>"
