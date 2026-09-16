// 실제 FlutterMacOS 프레임워크가 제공하는 표면과 같은 형태의 최소 스텁이다.
// 픽스처는 Flutter SDK 없이 컴파일되어 컴파일러 인덱스를 만든다.
import Foundation

public typealias FlutterResult = (Any?) -> Void

public final class FlutterMethodCall: NSObject {
    public let method: String
    public let arguments: Any?

    public init(method: String, arguments: Any?) {
        self.method = method
        self.arguments = arguments
    }
}

public let FlutterMethodNotImplemented = NSObject()

public protocol FlutterBinaryMessenger: AnyObject {}

public final class FlutterMethodChannel {
    public init(name: String, binaryMessenger: FlutterBinaryMessenger) {}
    public func setMethodCallHandler(_ handler: ((FlutterMethodCall, @escaping FlutterResult) -> Void)?) {}
}
