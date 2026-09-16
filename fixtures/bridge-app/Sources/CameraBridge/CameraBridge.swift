import FlutterMacOS
import Foundation

public final class CameraBridge: NSObject {
    private let channel: FlutterMethodChannel

    public init(messenger: FlutterBinaryMessenger) {
        channel = FlutterMethodChannel(name: "camera", binaryMessenger: messenger)
        super.init()
        channel.setMethodCallHandler { call, result in
            switch call.method {
            case "photo": result(nil)
            default: result(FlutterMethodNotImplemented)
            }
        }
    }
}
