// swift-tools-version: 6.0
import Foundation
import PackageDescription

let swiftSyntaxDependency: Package.Dependency
if let localPath = ProcessInfo.processInfo.environment["SWIFT_SYNTAX_PATH"] {
    swiftSyntaxDependency = .package(path: localPath)
} else {
    swiftSyntaxDependency = .package(
        url: "https://github.com/swiftlang/swift-syntax.git",
        "600.0.0" ..< "605.0.0"
    )
}

let package = Package(
    name: "IsthmusPhase0Swift",
    platforms: [.macOS(.v14)],
    products: [
        .library(
            name: "Phase0SwiftBridgeExtractor",
            targets: ["Phase0SwiftBridgeExtractor"]
        ),
        .executable(
            name: "extract-swift-bridges",
            targets: ["ExtractSwiftBridges"]
        ),
    ],
    dependencies: [swiftSyntaxDependency],
    targets: [
        .target(
            name: "Phase0SwiftBridgeExtractor",
            dependencies: [
                .product(name: "SwiftParser", package: "swift-syntax"),
                .product(name: "SwiftSyntax", package: "swift-syntax"),
            ]
        ),
        .executableTarget(
            name: "ExtractSwiftBridges",
            dependencies: ["Phase0SwiftBridgeExtractor"]
        ),
        .testTarget(
            name: "Phase0SwiftBridgeExtractorTests",
            dependencies: ["Phase0SwiftBridgeExtractor"]
        ),
    ]
)
