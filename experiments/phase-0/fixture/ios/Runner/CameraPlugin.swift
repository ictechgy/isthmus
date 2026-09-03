import Flutter

final class CameraPlugin {
    private static let channelName = "dev.isthmus/camera"

    func register(with messenger: FlutterBinaryMessenger) {
        let channel = FlutterMethodChannel(
            name: Self.channelName,
            binaryMessenger: messenger
        )
        channel.setMethodCallHandler { call, result in
            switch call.method {
            case "takePhoto", "captureStill":
                result(nil)
            case "recordVideo":
                result(nil)
            default:
                result(FlutterMethodNotImplemented)
            }
        }
    }

    func registerDynamic(
        with messenger: FlutterBinaryMessenger,
        feature: String
    ) {
        let channel = FlutterMethodChannel(
            name: "dev.isthmus/\(feature)",
            binaryMessenger: messenger
        )
        channel.setMethodCallHandler { _, _ in }
    }
}
