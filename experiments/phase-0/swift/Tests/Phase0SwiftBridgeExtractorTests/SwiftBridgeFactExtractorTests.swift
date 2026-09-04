import Foundation
import Phase0SwiftBridgeExtractor
import Testing

private let cameraFixtureURL = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .appendingPathComponent("fixture/ios/Runner/CameraPlugin.swift")

@Test("static let 채널의 setMethodCallHandler 등록 지점을 추출한다")
func extractsChannelRegistrationThroughStaticConstant() throws {
    let source = try String(
        contentsOf: cameraFixtureURL,
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
        contentsOf: cameraFixtureURL,
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
        contentsOf: cameraFixtureURL,
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

@Test("Flutter import와 함께 있어도 로컬 FlutterMethodChannel 타입을 오인하지 않는다")
func localSwiftTypeShadowsFlutterMethodChannel() throws {
    let source = """
    import Flutter
    struct FlutterMethodChannel {
        init(name: String, binaryMessenger: Any) {}
        func setMethodCallHandler(_ handler: (Any, Any) -> Void) {}
    }
    func register(with messenger: Any) {
        let channel = FlutterMethodChannel(name: "not-flutter", binaryMessenger: messenger)
        channel.setMethodCallHandler { _, _ in }
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

@Test("Swift 제어문과 initializer 바인딩은 같은 이름의 채널 프로퍼티를 가린다")
func controlFlowBindingsShadowSwiftChannelProperty() throws {
    let source = """
    import Flutter
    final class Plugin {
        private let channel = FlutterMethodChannel(name: "dev.isthmus/test", binaryMessenger: messenger)
        init(channel: OtherChannel) {
            channel.setMethodCallHandler { _, _ in }
        }
        func optional(_ candidate: OtherChannel?) {
            if let channel = candidate {
                channel.setMethodCallHandler { _, _ in }
            }
        }
        func guarded(_ candidate: OtherChannel?) {
            guard let channel = candidate else { return }
            channel.setMethodCallHandler { _, _ in }
        }
        func loop(_ channels: [OtherChannel]) {
            for channel in channels {
                channel.setMethodCallHandler { _, _ in }
            }
        }
        func real() {
            self.channel.setMethodCallHandler { _, _ in }
        }
    }
    """

    let facts = try SwiftBridgeFactExtractor().extract(
        source: source,
        relativePath: "ios/Plugin.swift"
    )
    let registrations = facts.filter { $0.kind == "channel-register" }

    #expect(registrations.count == 1)
    #expect(registrations.first?.channel == "dev.isthmus/test")
}

@Test("안쪽 비상수 이름은 바깥 문자열 상수를 가린다")
func localNameShadowsOuterStringConstant() throws {
    let source = """
    import Flutter
    let methodName = "outerMethod"
    func register(with messenger: FlutterBinaryMessenger) {
        let methodName = makeMethodName()
        let channel = FlutterMethodChannel(name: "dev.isthmus/test", binaryMessenger: messenger)
        channel.setMethodCallHandler { call, result in
            switch call.method {
            case (methodName): result(nil)
            default: break
            }
        }
    }
    """

    let facts = try SwiftBridgeFactExtractor().extract(
        source: source,
        relativePath: "ios/Plugin.swift"
    )
    let handler = try #require(facts.first { $0.kind == "method-handle" })

    #expect(handler.method == "(methodName)")
    #expect(handler.dynamic)
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

@Test("self 채널 프로퍼티의 handler를 등록과 메서드에 연결한다")
func resolvesSelfChannelReceiver() throws {
    let source = """
    import Flutter
    final class Plugin {
        private let channel = FlutterMethodChannel(name: "dev.isthmus/test", binaryMessenger: messenger)
        func register() {
            self.channel.setMethodCallHandler { call, result in
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
        relativePath: "ios/Plugin.swift"
    )

    #expect(facts.contains { $0.kind == "channel-register" })
    #expect(facts.contains { $0.kind == "method-handle" && $0.method == "takePhoto" })
}

@Test("재할당된 Swift 채널 변수는 최신 이름으로 handler를 연결한다")
func tracksReassignedSwiftChannel() throws {
    let source = """
    import Flutter
    func register(with messenger: FlutterBinaryMessenger) {
        var channel = FlutterMethodChannel(name: "dev.isthmus/first", binaryMessenger: messenger)
        channel = FlutterMethodChannel(name: "dev.isthmus/second", binaryMessenger: messenger)
        channel.setMethodCallHandler { call, result in
            switch call.method {
            case "takePhoto": result(nil)
            default: break
            }
        }
    }
    """

    let facts = try SwiftBridgeFactExtractor().extract(
        source: source,
        relativePath: "ios/Plugin.swift"
    )
    let registration = try #require(
        facts.first { $0.kind == "channel-register" }
    )

    #expect(registration.channel == "dev.isthmus/second")
}

@Test("다른 객체로 재할당된 Swift 변수는 채널 연결을 제거한다")
func clearsReassignedSwiftChannel() throws {
    let source = """
    import Flutter
    func register(with messenger: FlutterBinaryMessenger) {
        var channel = FlutterMethodChannel(name: "dev.isthmus/test", binaryMessenger: messenger)
        channel = OtherChannel()
        channel.setMethodCallHandler { _, _ in }
    }
    """

    let facts = try SwiftBridgeFactExtractor().extract(
        source: source,
        relativePath: "ios/Plugin.swift"
    )

    #expect(!facts.contains { $0.kind == "channel-register" })
}

@Test("handler 내부 재할당 뒤에는 채널 문맥이 다음 switch로 누수되지 않는다")
func handlerContextDoesNotLeakAfterReceiverReassignment() throws {
    let source = """
    import Flutter
    func register(with messenger: FlutterBinaryMessenger) {
        var channel = FlutterMethodChannel(name: "dev.isthmus/test", binaryMessenger: messenger)
        channel.setMethodCallHandler { call, result in
            channel = OtherChannel()
        }
        switch call.method {
        case "notAHandler": break
        default: break
        }
    }
    """

    let facts = try SwiftBridgeFactExtractor().extract(
        source: source,
        relativePath: "ios/Plugin.swift"
    )

    #expect(!facts.contains { $0.kind == "method-handle" })
}

@Test("조건부 컴파일 안의 Flutter 브리지는 활성 구성을 추측하지 않는다")
func rejectsConditionalFlutterBridgeSyntax() {
    let source = """
    #if ENABLE_FLUTTER
    import Flutter
    func register(with messenger: FlutterBinaryMessenger) {
        let channel = FlutterMethodChannel(name: "dev.isthmus/test", binaryMessenger: messenger)
        channel.setMethodCallHandler { _, _ in }
    }
    #endif
    """

    do {
        _ = try SwiftBridgeFactExtractor().extract(
            source: source,
            relativePath: "ios/Plugin.swift"
        )
        Issue.record("조건부 Flutter 브리지는 compiler-indexed 추출이 필요하다")
    } catch SwiftBridgeExtractionError.conditionalCompilation {
        // 기대한 안전한 실패다.
    } catch {
        Issue.record("예상하지 못한 오류: \(error)")
    }
}

@Test("조건부 컴파일 안의 handler case도 활성 구성을 추측하지 않는다")
func rejectsConditionalHandledMethod() {
    let source = """
    import Flutter
    func register(with messenger: FlutterBinaryMessenger) {
        let channel = FlutterMethodChannel(name: "dev.isthmus/test", binaryMessenger: messenger)
        channel.setMethodCallHandler { call, result in
            switch call.method {
            #if DEBUG
            case "debugOnly": result(nil)
            #endif
            default: break
            }
        }
    }
    """

    do {
        _ = try SwiftBridgeFactExtractor().extract(
            source: source,
            relativePath: "ios/Plugin.swift"
        )
        Issue.record("조건부 handler case는 compiler-indexed 추출이 필요하다")
    } catch SwiftBridgeExtractionError.conditionalCompilation {
        // 기대한 안전한 실패다.
    } catch {
        Issue.record("예상하지 못한 오류: \(error)")
    }
}

@Test("Flutter import 없는 조건부 유사 API는 브리지로 오인하지 않는다")
func ignoresConditionalLookalikeWithoutFlutterImport() throws {
    let source = """
    #if DEBUG
    func register() {
        other.setMethodCallHandler { _, _ in }
    }
    #endif
    """

    let facts = try SwiftBridgeFactExtractor().extract(
        source: source,
        relativePath: "Sources/Lookalike.swift"
    )

    #expect(facts.isEmpty)
}

@Test("Swift 소스 위치 column도 1부터 시작하는 UTF-8 바이트로 기록한다")
func recordsSwiftUTF8ByteColumn() throws {
    let source = """
    import Flutter
    func register(with messenger: FlutterBinaryMessenger) {
        let channel = FlutterMethodChannel(name: "dev.isthmus/test", binaryMessenger: messenger)
        /* 😀 */ channel.setMethodCallHandler { _, _ in }
    }
    """

    let facts = try SwiftBridgeFactExtractor().extract(
        source: source,
        relativePath: "ios/Plugin.swift"
    )
    let registration = try #require(
        facts.first { $0.kind == "channel-register" }
    )

    #expect(registration.location.line == 4)
    #expect(registration.location.column == 24)
}

@Test("금지 문자가 든 Swift 채널 값을 교환 사실로 내보내지 않는다")
func rejectsUnsafeSwiftBridgeValue() {
    let source = """
    import Flutter
    func register(with messenger: FlutterBinaryMessenger) {
        let channel = FlutterMethodChannel(name: "dev\\u{0085}camera", binaryMessenger: messenger)
        channel.setMethodCallHandler { _, _ in }
    }
    """

    do {
        _ = try SwiftBridgeFactExtractor().extract(
            source: source,
            relativePath: "ios/Plugin.swift"
        )
        Issue.record("금지 문자가 든 bridge 값은 거부해야 한다")
    } catch is SwiftBridgeExtractionError {
        // 기대한 안전한 실패다.
    } catch {
        Issue.record("예상하지 못한 오류: \(error)")
    }
}

@Test("즉석 생성한 채널의 handler를 등록과 메서드에 연결한다")
func resolvesInlineChannelReceiver() throws {
    let source = """
    import Flutter
    func register(with messenger: FlutterBinaryMessenger) {
        FlutterMethodChannel(name: "dev.isthmus/test", binaryMessenger: messenger)
            .setMethodCallHandler { call, result in
                switch call.method {
                case "takePhoto": result(nil)
                default: break
                }
            }
    }
    """

    let facts = try SwiftBridgeFactExtractor().extract(
        source: source,
        relativePath: "ios/Plugin.swift"
    )

    #expect(facts.contains { $0.kind == "channel-register" })
    #expect(facts.contains { $0.kind == "method-handle" && $0.method == "takePhoto" })
}

@Test("암시적 첫 closure 매개변수의 method switch를 추출한다")
func resolvesImplicitCallParameter() throws {
    let source = """
    import Flutter
    func register(with messenger: FlutterBinaryMessenger) {
        let channel = FlutterMethodChannel(name: "dev.isthmus/test", binaryMessenger: messenger)
        channel.setMethodCallHandler {
            switch $0.method {
            case "takePhoto": break
            default: break
            }
        }
    }
    """

    let facts = try SwiftBridgeFactExtractor().extract(
        source: source,
        relativePath: "ios/Plugin.swift"
    )

    #expect(facts.contains { $0.kind == "method-handle" && $0.method == "takePhoto" })
}

@Test("인자 없는 handler 호출은 채널 등록으로 추출하지 않는다")
func ignoresHandlerCallWithoutArgument() throws {
    let source = """
    import Flutter
    func unregister(with messenger: FlutterBinaryMessenger) {
        let channel = FlutterMethodChannel(name: "dev.isthmus/test", binaryMessenger: messenger)
        channel.setMethodCallHandler()
    }
    """

    let facts = try SwiftBridgeFactExtractor().extract(
        source: source,
        relativePath: "ios/Plugin.swift"
    )

    #expect(!facts.contains { $0.kind == "channel-register" })
}

@Test("쉼표로 묶인 모든 문자열 case를 각각 추출한다")
func extractsEveryMethodInCaseLabel() throws {
    let source = try String(
        contentsOf: cameraFixtureURL,
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
        contentsOf: cameraFixtureURL,
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
        contentsOf: cameraFixtureURL,
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
