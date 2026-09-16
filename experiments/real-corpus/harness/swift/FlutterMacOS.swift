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
    public func invokeMethod(_ method: String, arguments: Any?) {}
    public func invokeMethod(_ method: String, arguments: Any?, result: ((Any?) -> Void)?) {}
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

// 앱 수준 타겟이 쓰는 프레임워크 표면이다. 실제 FlutterMacOS의 앱 델리게이트·
// 뷰 컨트롤러 계층과 동일한 형태만 유지한다.
public protocol FlutterPluginRegistry: AnyObject {}

public final class FlutterEngine: NSObject {
    public var binaryMessenger: FlutterBinaryMessenger { fatalError() }
}

open class FlutterViewController: NSViewController, FlutterPluginRegistry {
    public var engine: FlutterEngine { fatalError() }
}

open class FlutterAppDelegate: NSResponder, NSApplicationDelegate {
    open var mainFlutterWindow: NSWindow?

    // 실제 FlutterAppDelegate가 오버라이드해 두는 NSApplicationDelegate 메서드들이다.
    // 앱 델리게이트가 같은 시그니처로 override할 수 있어야 한다.
    open func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    open func applicationDidFinishLaunching(_ notification: Notification) {}
    open func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { true }
    open func application(_ sender: NSApplication, openFile filename: String) -> Bool { false }
    open func application(_ sender: NSApplication, openFiles filenames: [String]) {}
}

public func RegisterGeneratedPlugins(registry: FlutterPluginRegistry) {}
