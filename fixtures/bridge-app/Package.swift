// swift-tools-version: 5.9
import PackageDescription

// 컴파일러 인덱스를 만들기 위한 최소 SwiftPM 패키지다. FlutterMacOS는 실제
// 프레임워크가 아니라 같은 표면 형태를 가진 스텁이다.
let package = Package(
    name: "cold-cache-swift-app",
    targets: [
        .target(name: "FlutterMacOS", path: "Sources/FlutterMacOS"),
        .target(name: "CameraBridge", dependencies: ["FlutterMacOS"], path: "Sources/CameraBridge"),
    ]
)
