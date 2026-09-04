import Foundation
import Phase0SwiftBridgeExtractor
import Testing

private let phase0Root = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .deletingLastPathComponent()

@Test("Swift 소스 파일을 bridge-facts JSON 문서로 변환한다")
func convertsSwiftSourceToExchangeDocument() throws {
    let sourcePath = phase0Root
        .appendingPathComponent("fixture/ios/Runner/CameraPlugin.swift")
        .path
    let result = try runSwiftBridgeCommand(
        arguments: [
            sourcePath,
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
        contentsOf: phase0Root.appendingPathComponent("expected/swift.json"),
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

@Test("공개 run 함수도 짧은 인자 배열을 안전하게 거부한다")
func publicRunRejectsShortArguments() throws {
    let result = try runSwiftBridgeCommand(
        arguments: [],
        readSource: { _ in Issue.record("invalid arguments must not read a file"); return "" }
    )

    #expect(result.exitCode == 64)
    #expect(result.standardOutput.isEmpty)
}

@Test("안전하지 않은 프로젝트·상대 경로·생성 시각은 읽기 전에 거부한다")
func rejectsUnsafeSwiftMetadata() {
    let invalidMetadata = [
        (project: "relative", path: "ios/Plugin.swift", generatedAt: "2026-09-04T12:00:00Z"),
        (project: "/fixture\nevil", path: "ios/Plugin.swift", generatedAt: "2026-09-04T12:00:00Z"),
        (project: "/fixture", path: "../private.swift", generatedAt: "2026-09-04T12:00:00Z"),
        (project: "/fixture", path: "/private.swift", generatedAt: "2026-09-04T12:00:00Z"),
        (project: "/fixture", path: "\\server\\private.swift", generatedAt: "2026-09-04T12:00:00Z"),
        (project: "/fixture\u{0085}evil", path: "ios/Plugin.swift", generatedAt: "2026-09-04T12:00:00Z"),
        (project: "/fixture", path: "ios/Plugin\u{2028}.swift", generatedAt: "2026-09-04T12:00:00Z"),
        (project: "/fixture", path: "C:/private.swift", generatedAt: "2026-09-04T12:00:00Z"),
        (project: "/fixture", path: "ios/Plugin\n.swift", generatedAt: "2026-09-04T12:00:00Z"),
        (project: "/fixture", path: "ios/Plugin.swift", generatedAt: "2026-02-31T12:00:00Z"),
    ]

    for metadata in invalidMetadata {
        var didReadSource = false
        let result = executeSwiftBridgeCommand(
            arguments: [
                "source.swift",
                "--project", metadata.project,
                "--path", metadata.path,
                "--generated-at", metadata.generatedAt,
            ],
            readSource: { _ in
                didReadSource = true
                return ""
            }
        )

        #expect(result.exitCode == 64)
        #expect(!didReadSource)
    }
}

@Test("timezone offset과 짧은 소수 초를 UTC 밀리초 형식으로 정규화한다")
func normalizesSwiftGeneratedAt() throws {
    let cases = [
        (input: "2026-09-04T21:00:00+09:00", expected: "2026-09-04T12:00:00.000Z"),
        (input: "2026-09-04T12:00:00.5Z", expected: "2026-09-04T12:00:00.500Z"),
    ]

    for item in cases {
        let result = try runSwiftBridgeCommand(
            arguments: [
                "source.swift",
                "--project", "/fixture",
                "--path", "ios/Plugin.swift",
                "--generated-at", item.input,
            ],
            readSource: { _ in "import Flutter\n" }
        )
        let data = try #require(result.standardOutput.data(using: .utf8))
        let document = try #require(
            JSONSerialization.jsonObject(with: data) as? [String: Any]
        )

        #expect(result.exitCode == 0)
        #expect(document["generatedAt"] as? String == item.expected)
    }
}

@Test("named-function handler 본문을 해석하지 못한 사실을 limitation으로 보고한다")
func reportsOpaqueSwiftHandlerBody() throws {
    let source = """
    import Flutter
    func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
        switch call.method {
        case "takePhoto": result(nil)
        default: break
        }
    }
    func register(with messenger: FlutterBinaryMessenger) {
        let channel = FlutterMethodChannel(name: "dev.isthmus/test", binaryMessenger: messenger)
        channel.setMethodCallHandler(handle)
    }
    """

    let result = try runSwiftBridgeCommand(
        arguments: [
            "source.swift",
            "--project", "/fixture",
            "--path", "ios/Plugin.swift",
            "--generated-at", "2026-09-04T12:00:00Z",
        ],
        readSource: { _ in source }
    )
    let data = try #require(result.standardOutput.data(using: .utf8))
    let document = try #require(
        JSONSerialization.jsonObject(with: data) as? [String: Any]
    )

    #expect(result.exitCode == 0)
    #expect(document["limitations"] as? [String] == [
        "opaque-handler-bodies: 1 setMethodCallHandler call uses a non-closure handler",
    ])
}

@Test("로컬 FlutterMethodChannel shadow를 limitation으로 보고한다")
func reportsShadowedSwiftMethodChannel() throws {
    let source = """
    import Flutter
    struct FlutterMethodChannel {}
    """

    let result = try runSwiftBridgeCommand(
        arguments: [
            "source.swift",
            "--project", "/fixture",
            "--path", "ios/Plugin.swift",
            "--generated-at", "2026-09-04T12:00:00Z",
        ],
        readSource: { _ in source }
    )
    let data = try #require(result.standardOutput.data(using: .utf8))
    let document = try #require(
        JSONSerialization.jsonObject(with: data) as? [String: Any]
    )

    #expect(result.exitCode == 0)
    #expect((document["facts"] as? [Any])?.isEmpty == true)
    #expect(document["limitations"] as? [String] == [
        "shadowed-flutter-method-channel: a local declaration hides the imported Flutter type",
    ])
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

@Test("Swift 구문 오류는 경로 없는 종료 코드 2로 보고한다")
func reportsSwiftParseFailure() {
    let result = executeSwiftBridgeCommand(
        arguments: [
            "private-source.swift",
            "--project", "/fixture",
            "--path", "ios/Runner/Private.swift",
            "--generated-at", "2026-09-04T12:00:00.000Z",
        ],
        readSource: { _ in "import Flutter\nfunc broken(" }
    )

    #expect(result.exitCode == 2)
    #expect(result.standardOutput.isEmpty)
    #expect(
        result.standardError
            == "Unable to parse the source file; fix syntax errors and retry.\n"
    )
    #expect(!result.standardError.contains("private-source.swift"))
}

@Test("조건부 Flutter 브리지는 compiler-indexed 추출 안내와 함께 실패한다")
func reportsConditionalSwiftBridgeFailure() {
    let result = executeSwiftBridgeCommand(
        arguments: [
            "private-source.swift",
            "--project", "/fixture",
            "--path", "ios/Runner/Plugin.swift",
            "--generated-at", "2026-09-04T12:00:00.000Z",
        ],
        readSource: { _ in
            "#if ENABLE_FLUTTER\nimport Flutter\n#endif\n"
        }
    )

    #expect(result.exitCode == 2)
    #expect(result.standardOutput.isEmpty)
    #expect(
        result.standardError
            == "Unable to analyze conditional Flutter bridge source; use compiler-indexed extraction.\n"
    )
    #expect(!result.standardError.contains("private-source.swift"))
}
