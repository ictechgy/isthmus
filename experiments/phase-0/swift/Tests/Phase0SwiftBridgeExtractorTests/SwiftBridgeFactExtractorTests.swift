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
        )
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
        )
    )))
}
