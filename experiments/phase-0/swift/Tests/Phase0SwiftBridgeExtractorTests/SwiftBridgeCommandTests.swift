import Foundation
import Phase0SwiftBridgeExtractor
import Testing

@Test("Swift 소스 파일을 bridge-facts JSON 문서로 변환한다")
func convertsSwiftSourceToExchangeDocument() throws {
    let result = try runSwiftBridgeCommand(
        arguments: [
            "../fixture/ios/Runner/CameraPlugin.swift",
            "--project", "/fixture",
            "--path", "ios/Runner/CameraPlugin.swift",
            "--generated-at", "2026-09-04T12:00:00.000Z",
        ],
        readSource: { path in
            try String(contentsOfFile: path, encoding: .utf8)
        }
    )

    #expect(result.exitCode == 0)
    #expect(result.standardError.isEmpty)
    let data = try #require(result.standardOutput.data(using: .utf8))
    let json = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
    #expect(json["format"] as? String == "bridge-facts")
    #expect(json["project"] as? String == "/fixture")
    #expect((json["facts"] as? [Any])?.count == 5)
    let expected = try String(
        contentsOfFile: "../expected/swift.json",
        encoding: .utf8
    )
    #expect(result.standardOutput == expected)
}

@Test("잘못된 Swift CLI 인자는 사용법과 종료 코드 64를 반환한다")
func rejectsInvalidSwiftArguments() throws {
    let result = executeSwiftBridgeCommand(
        arguments: [],
        readSource: { _ in "" }
    )

    #expect(result.exitCode == 64)
    #expect(result.standardOutput.isEmpty)
    #expect(result.standardError.hasPrefix("Usage: extract-swift-bridges"))
}

@Test("읽기 실패는 경로를 노출하지 않고 종료 코드 2를 반환한다")
func reportsSwiftSourceReadFailure() throws {
    let result = executeSwiftBridgeCommand(
        arguments: [
            "private-source.swift",
            "--project", "/fixture",
            "--path", "ios/Runner/Missing.swift",
            "--generated-at", "2026-09-04T12:00:00.000Z",
        ],
        readSource: { _ in throw CocoaError(.fileReadNoSuchFile) }
    )

    #expect(result.exitCode == 2)
    #expect(result.standardOutput.isEmpty)
    #expect(
        result.standardError
            == "Unable to read the source file; check its path and permissions.\n"
    )
    #expect(!result.standardError.contains("private-source.swift"))
}
