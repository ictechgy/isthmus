// 실제 Defaults 패키지가 Foundation 계층을 re-export하듯, 소비 파일이 AppKit을
// 별도 import 없이 쓸 수 있게 그대로 노출한다.
@_exported import AppKit

// sindresorhus/Defaults의 코퍼스용 최소 표면이다. 실제 라이브러리는 Keys를
// 비제네릭 _AnyKey의 typealias로 두고 Key<Value>가 상속하게 해 extension
// 정적 키가 `Defaults[.x]`의 implicit member로 해석된다 — 같은 상속 구조를
// 유지한다. 값은 저장·관찰하지 않고 소비 측 호출 형태만 컴파일한다.
public enum Defaults {
    public class _AnyKey {
        public typealias Key = Defaults.Key
        public init() {}
    }

    public typealias Keys = _AnyKey

    public final class Key<Value>: _AnyKey {
        public init(_ name: String, default defaultValue: Value, suite: UserDefaults = .standard) {
            super.init()
        }
    }

    public struct Observation {}

    public static subscript<Value>(key: Key<Value>) -> Value {
        get { fatalError("stub") }
        set {}
    }

    public static func observe<Value>(_ key: Key<Value>, handler: @escaping (Any) -> Void) -> Observation {
        Observation()
    }
}
