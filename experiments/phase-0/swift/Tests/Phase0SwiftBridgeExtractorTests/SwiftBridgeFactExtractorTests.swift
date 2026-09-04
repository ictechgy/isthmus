import Foundation
import Phase0SwiftBridgeExtractor
import Testing

@Test("static let 채널의 setMethodCallHandler 등록 지점을 추출한다")
func extractsChannelRegistrationThroughStaticConstant() throws {
    let source = try String(
        contentsOfFile: "../fixture/ios/Runner/CameraPlugin.swift",
        encoding: .utf8
    )

    let facts = try SwiftBridgeFactExtractor().extract(
        source: source,
        relativePath: "ios/Runner/CameraPlugin.swift"
    )

    #expect(facts.contains(BridgeFact(
        kind: "channel-register",
        channel: "dev.isthmus/camera",
        dynamic: false,
        location: BridgeLocation(
            path: "ios/Runner/CameraPlugin.swift",
            line: 11,
            column: 17
        )
    )))
}

@Test("보간된 채널 이름을 원문 표현식과 함께 보존한다")
func preservesDynamicChannelExpression() throws {
    let source = try String(
        contentsOfFile: "../fixture/ios/Runner/CameraPlugin.swift",
        encoding: .utf8
    )

    let facts = try SwiftBridgeFactExtractor().extract(
        source: source,
        relativePath: "ios/Runner/CameraPlugin.swift"
    )

    #expect(facts.contains(BridgeFact(
        kind: "channel-register",
        channel: #""dev.isthmus/\(feature)""#,
        dynamic: true,
        location: BridgeLocation(
            path: "ios/Runner/CameraPlugin.swift",
            line: 31,
            column: 17
        )
    )))
}

@Test("setMethodCallHandler 내부 case를 선언된 채널과 연결한다")
func associatesHandledMethodWithChannel() throws {
    let source = try String(
        contentsOfFile: "../fixture/ios/Runner/CameraPlugin.swift",
        encoding: .utf8
    )

    let facts = try SwiftBridgeFactExtractor().extract(
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

@Test("핸들러 매개변수와 무관한 method switch는 추출하지 않는다")
func ignoresUnrelatedMethodSwitch() throws {
    let source = """
    import Flutter
    final class Plugin {
        func register(with messenger: FlutterBinaryMessenger) {
            let channel = FlutterMethodChannel(name: "dev.isthmus/test", binaryMessenger: messenger)
            channel.setMethodCallHandler { call, result in
                switch state.method {
                case "notAFlutterMethod": result(nil)
                default: break
                }
                switch call.method {
                case "realMethod": result(nil)
                default: break
                }
            }
        }
    }
    """

    let facts = try SwiftBridgeFactExtractor().extract(
        source: source,
        relativePath: "ios/Plugin.swift"
    )
    let handledMethods = facts
        .filter { $0.kind == "method-handle" }
        .compactMap(\.method)

    #expect(handledMethods == ["realMethod"])
}

@Test("nil 핸들러는 채널 등록으로 추출하지 않는다")
func ignoresRemovedMethodHandler() throws {
    let source = """
    import Flutter
    func unregister(from messenger: FlutterBinaryMessenger) {
        let channel = FlutterMethodChannel(name: "dev.isthmus/test", binaryMessenger: messenger)
        channel.setMethodCallHandler(nil)
    }
    """

    let facts = try SwiftBridgeFactExtractor().extract(
        source: source,
        relativePath: "ios/Plugin.swift"
    )

    #expect(!facts.contains { $0.kind == "channel-register" })
}

@Test("동적 handler case를 원문과 limitation으로 보존한다")
func preservesDynamicHandledMethod() throws {
    let source = """
    import Flutter
    func register(with messenger: FlutterBinaryMessenger) {
        let channel = FlutterMethodChannel(name: "dev.isthmus/test", binaryMessenger: messenger)
        channel.setMethodCallHandler { call, result in
            switch call.method {
            case makeMethod(): result(nil)
            default: break
            }
        }
    }
    """

    let facts = try SwiftBridgeFactExtractor().extract(
        source: source,
        relativePath: "ios/Plugin.swift"
    )
    let handledMethod = facts.first { $0.kind == "method-handle" }
    let document = makeSwiftBridgeFactsDocument(
        facts: facts,
        generatedAt: "2026-09-04T12:00:00.000Z",
        project: "/fixture"
    )

    #expect(handledMethod?.method == "makeMethod()")
    #expect(handledMethod?.dynamic == true)
    #expect(document.limitations.contains(
        "dynamic-method-names: 1 method handlers use a non-literal name"
    ))
}

@Test("Flutter import 없는 같은 이름의 API를 브리지로 오인하지 않는다")
func ignoresLookalikeChannelWithoutFlutterImport() throws {
    let source = """
    func register(with messenger: Messenger) {
        let channel = FlutterMethodChannel(name: "not-flutter", binaryMessenger: messenger)
        channel.setMethodCallHandler { call, result in
            switch call.method {
            case "fakeMethod": result(nil)
            default: break
            }
        }
    }
    """

    let facts = try SwiftBridgeFactExtractor().extract(
        source: source,
        relativePath: "Sources/Lookalike.swift"
    )

    #expect(facts.isEmpty)
}

@Test("다른 함수의 같은 변수 이름을 채널로 연결하지 않는다")
func isolatesChannelVariablesByFunctionScope() throws {
    let source = """
    import Flutter
    func create(with messenger: FlutterBinaryMessenger) {
        let channel = FlutterMethodChannel(name: "dev.isthmus/test", binaryMessenger: messenger)
    }
    func unrelated() {
        channel.setMethodCallHandler { _, _ in }
    }
    """

    let facts = try SwiftBridgeFactExtractor().extract(
        source: source,
        relativePath: "ios/Plugin.swift"
    )

    #expect(!facts.contains { $0.kind == "channel-register" })
}

@Test("초기화 없는 지역 선언은 바깥 채널 변수를 가린다")
func localDeclarationShadowsOuterChannel() throws {
    let source = """
    import Flutter
    let channel = FlutterMethodChannel(name: "dev.isthmus/test", binaryMessenger: messenger)
    func unrelated() {
        var channel: OtherChannel
        channel.setMethodCallHandler { _, _ in }
    }
    """

    let facts = try SwiftBridgeFactExtractor().extract(
        source: source,
        relativePath: "ios/Plugin.swift"
    )

    #expect(!facts.contains { $0.kind == "channel-register" })
}

@Test("extension의 타입 이름을 handler 심볼에 포함한다")
func attributesHandlerInsideExtension() throws {
    let source = """
    import Flutter
    extension CameraPlugin {
        func register(with messenger: FlutterBinaryMessenger) {
            let channel = FlutterMethodChannel(name: "dev.isthmus/test", binaryMessenger: messenger)
            channel.setMethodCallHandler { call, result in
                switch call.method {
                case "takePhoto": result(nil)
                default: break
                }
            }
        }
    }
    """

    let facts = try SwiftBridgeFactExtractor().extract(
        source: source,
        relativePath: "ios/Plugin+Bridge.swift"
    )
    let handler = try #require(facts.first { $0.kind == "method-handle" })

    #expect(handler.symbol?.qualifiedName == "CameraPlugin.register")
}

@Test("쉼표로 묶인 모든 문자열 case를 각각 추출한다")
func extractsEveryMethodInCaseLabel() throws {
    let source = try String(
        contentsOfFile: "../fixture/ios/Runner/CameraPlugin.swift",
        encoding: .utf8
    )

    let facts = try SwiftBridgeFactExtractor().extract(
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

    let facts = try SwiftBridgeFactExtractor().extract(
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
    let facts = try SwiftBridgeFactExtractor().extract(
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
        "missing-handler-usrs: 3 method handlers have only a qualified name",
    ])
}

@Test("Swift 사실을 GRAPH-EXCHANGE 버전 1 문서로 감싼다")
func wrapsSwiftFactsInExchangeDocument() {
    let document = makeSwiftBridgeFactsDocument(
        facts: [],
        generatedAt: "2026-09-04T12:00:00.000Z",
        project: "/fixture"
    )

    #expect(document.format == "bridge-facts")
    #expect(document.version == 1)
    #expect(document.tool.name == "isthmus-phase0-swift")
    #expect(document.tool.version == "0.0.0")
    #expect(document.generatedAt == "2026-09-04T12:00:00.000Z")
    #expect(document.platform == "swift")
    #expect(document.target == nil)
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
    #expect(encoded.contains(#""target" : null"#))
    #expect(encoded.hasSuffix("\n"))
    #expect(encoded == (try encodeSwiftBridgeFactsDocument(document)))
}
