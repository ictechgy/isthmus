import Foundation

// 실제 FlutterMacOS 프레임워크는 Cocoa/AppKit 심볼을 노출한다.
@_exported import AppKit

public protocol FlutterBinaryMessenger: AnyObject {}
public typealias FlutterResult = (Any?) -> Void
public typealias FlutterEventSink = (Any?) -> Void
public typealias FlutterReply = (Any?) -> Void
public let FlutterMethodNotImplemented: Any = NSObject()

public final class FlutterError: NSObject, Error {
    public let code: String
    public let message: String?
    public let details: Any?
    public init(code: String, message: String?, details: Any?) {
        self.code = code
        self.message = message
        self.details = details
    }
}

public struct FlutterMethodCall {
    public let method: String
    public let arguments: Any?
    public init(method: String, arguments: Any?) {
        self.method = method
        self.arguments = arguments
    }
}

public protocol FlutterPlugin: AnyObject {
    static func register(with registrar: FlutterPluginRegistrar)
}

public final class FlutterPluginRegistrar {
    public var messenger: FlutterBinaryMessenger { fatalError() }
    public func addMethodCallDelegate(_ delegate: FlutterPlugin, channel: FlutterMethodChannel) {}
}

public final class FlutterMethodChannel {
    public init(name: String, binaryMessenger: FlutterBinaryMessenger) {}
    public func setMethodCallHandler(_ handler: ((FlutterMethodCall, @escaping FlutterResult) -> Void)?) {}
}

public protocol FlutterStreamHandler: AnyObject {
    func onListen(withArguments arguments: Any?, eventSink events: @escaping FlutterEventSink) -> FlutterError?
    func onCancel(withArguments arguments: Any?) -> FlutterError?
}

public final class FlutterEventChannel {
    public init(name: String, binaryMessenger: FlutterBinaryMessenger) {}
    public func setStreamHandler(_ handler: FlutterStreamHandler?) {}
}

open class FlutterStandardReader {
    public init(data: Data) {}
    open func readValue() -> Any? { nil }
    open func readValue(ofType type: UInt8) -> Any? { nil }
}

open class FlutterStandardWriter {
    public init(data: NSMutableData) {}
    open func writeByte(_ byte: UInt8) {}
    open func writeValue(_ value: Any) {}
}

open class FlutterStandardReaderWriter {
    public init() {}
    open func reader(with data: Data) -> FlutterStandardReader { FlutterStandardReader(data: data) }
    open func writer(with data: NSMutableData) -> FlutterStandardWriter { FlutterStandardWriter(data: data) }
}

open class FlutterStandardMessageCodec: NSObject {
    public init(readerWriter: FlutterStandardReaderWriter) {}
}

public final class FlutterBasicMessageChannel {
    public init(name: String, binaryMessenger: FlutterBinaryMessenger, codec: FlutterStandardMessageCodec) {}
    public func setMessageHandler(_ handler: ((Any?, @escaping FlutterReply) -> Void)?) {}
    public func sendMessage(_ message: Any?, reply: ((Any?) -> Void)? = nil) {}
}
