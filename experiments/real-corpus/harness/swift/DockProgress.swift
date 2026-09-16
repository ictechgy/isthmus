import AppKit

// sindresorhus/DockProgress의 코퍼스용 최소 표면이다.
public enum DockProgress {
    public enum Style {
        case squircle(color: NSColor)
    }

    public static var style: Style = .squircle(color: .black)
    public static var progress: Double = 0
}
