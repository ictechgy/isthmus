import Foundation
import Phase0SwiftBridgeExtractor
import Testing

@Test("static let으로 전달된 FlutterMethodChannel 생성 지점을 추출한다")
func extractsChannelCreationThroughStaticConstant() throws {
    let source = try String(
        contentsOfFile: "../fixture/ios/Runner/CameraPlugin.swift",
        encoding: .utf8
    )

    let facts = SwiftBridgeFactExtractor().extract(
        source: source,
        relativePath: "ios/Runner/CameraPlugin.swift"
    )

    #expect(facts.contains(BridgeFact(
        kind: "channel-register",
        channel: "dev.isthmus/camera",
        dynamic: false,
        location: BridgeLocation(
            path: "ios/Runner/CameraPlugin.swift",
            line: 7,
            column: 23
        )
    )))
}

@Test("보간된 채널 이름을 원문 표현식과 함께 보존한다")
func preservesDynamicChannelExpression() throws {
    let source = try String(
        contentsOfFile: "../fixture/ios/Runner/CameraPlugin.swift",
        encoding: .utf8
    )

    let facts = SwiftBridgeFactExtractor().extract(
        source: source,
        relativePath: "ios/Runner/CameraPlugin.swift"
    )

    #expect(facts.contains(BridgeFact(
        kind: "channel-register",
        channel: #""dev.isthmus/\(feature)""#,
        dynamic: true,
        location: BridgeLocation(
            path: "ios/Runner/CameraPlugin.swift",
            line: 27,
            column: 23
        )
    )))
}

@Test("setMethodCallHandler 내부 case를 선언된 채널과 연결한다")
func associatesHandledMethodWithChannel() throws {
    let source = try String(
        contentsOfFile: "../fixture/ios/Runner/CameraPlugin.swift",
        encoding: .utf8
    )

    let facts = SwiftBridgeFactExtractor().extract(
        source: source,
        relativePath: "ios/Runner/CameraPlugin.swift"
    )

    #expect(facts.contains(BridgeFact(
        kind: "method-handle",
        channel: "dev.isthmus/camera",
        method: "takePhoto",
        dynamic: false,
        location: BridgeLocation(
            path: "ios/Runner/CameraPlugin.swift",
            line: 13,
            column: 18
        ),
        symbol: BridgeSymbol(qualifiedName: "CameraPlugin.register")
    )))
}

@Test("쉼표로 묶인 모든 문자열 case를 각각 추출한다")
func extractsEveryMethodInCaseLabel() throws {
    let source = try String(
        contentsOfFile: "../fixture/ios/Runner/CameraPlugin.swift",
        encoding: .utf8
    )

    let facts = SwiftBridgeFactExtractor().extract(
        source: source,
        relativePath: "ios/Runner/CameraPlugin.swift"
    )

    #expect(facts.contains(BridgeFact(
        kind: "method-handle",
        channel: "dev.isthmus/camera",
        method: "captureStill",
        dynamic: false,
        location: BridgeLocation(
            path: "ios/Runner/CameraPlugin.swift",
            line: 13,
            column: 31
        ),
        symbol: BridgeSymbol(qualifiedName: "CameraPlugin.register")
    )))
}

@Test("method-handle을 감싸는 타입과 함수에 귀속한다")
func attributesHandledMethodToEnclosingDeclaration() throws {
    let source = try String(
        contentsOfFile: "../fixture/ios/Runner/CameraPlugin.swift",
        encoding: .utf8
    )

    let facts = SwiftBridgeFactExtractor().extract(
        source: source,
        relativePath: "ios/Runner/CameraPlugin.swift"
    )
    let handledMethod = facts.first { $0.kind == "method-handle" }

    #expect(handledMethod?.symbol?.qualifiedName == "CameraPlugin.register")
}

@Test("Swift 문서가 동적 채널 개수를 limitations에 기록한다")
func reportsDynamicChannelLimitation() throws {
    let source = try String(
        contentsOfFile: "../fixture/ios/Runner/CameraPlugin.swift",
        encoding: .utf8
    )
    let facts = SwiftBridgeFactExtractor().extract(
        source: source,
        relativePath: "ios/Runner/CameraPlugin.swift"
    )

    let document = makeSwiftBridgeFactsDocument(
        facts: facts,
        generatedAt: "2026-09-04T12:00:00.000Z",
        project: "/fixture"
    )

    #expect(document.limitations == [
        "dynamic-channel-names: 1 channel constructors use a non-literal name",
    ])
}

@Test("Swift 사실을 GRAPH-EXCHANGE 버전 0 문서로 감싼다")
func wrapsSwiftFactsInExchangeDocument() {
    let document = makeSwiftBridgeFactsDocument(
        facts: [],
        generatedAt: "2026-09-04T12:00:00.000Z",
        project: "/fixture"
    )

    #expect(document.format == "bridge-facts")
    #expect(document.version == 0)
    #expect(document.tool.name == "isthmus-phase0-swift")
    #expect(document.tool.version == "0.0.0")
    #expect(document.generatedAt == "2026-09-04T12:00:00.000Z")
    #expect(document.platform == "swift")
    #expect(document.target == "flutter")
    #expect(document.project == "/fixture")
    #expect(document.facts.isEmpty)
}

@Test("Swift JSON을 중첩 객체까지 정렬하고 마지막 개행을 붙인다")
func encodesDeterministicSwiftDocument() throws {
    let document = makeSwiftBridgeFactsDocument(
        facts: [],
        generatedAt: "2026-09-04T12:00:00.000Z",
        project: "/fixture"
    )

    let encoded = try encodeSwiftBridgeFactsDocument(document)

    let factsIndex = try #require(encoded.range(of: "\"facts\"")?.lowerBound)
    let formatIndex = try #require(encoded.range(of: "\"format\"")?.lowerBound)
    let generatedAtIndex = try #require(encoded.range(of: "\"generatedAt\"")?.lowerBound)
    let limitationsIndex = try #require(encoded.range(of: "\"limitations\"")?.lowerBound)
    #expect(factsIndex < formatIndex)
    #expect(formatIndex < generatedAtIndex)
    #expect(generatedAtIndex < limitationsIndex)
    #expect(encoded.hasSuffix("\n"))
    #expect(encoded == (try encodeSwiftBridgeFactsDocument(document)))
}
