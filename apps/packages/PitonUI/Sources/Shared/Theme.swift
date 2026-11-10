import PitonKit
import SwiftUI

/// Piton's look: a dark canvas with a faint grid, panels with hairline borders and chamfered corners, one neon-cyan
/// accent, and three type voices (small uppercase labels, monospaced data, plain content). Every view takes its colors,
/// fonts, and shapes from here.
enum Theme {
    /// #272B30.
    static let canvas = Color(red: 39 / 255, green: 43 / 255, blue: 48 / 255)
    static let grid = Color.white.opacity(0.018)
    /// #2D3238: a step lighter than the canvas, for tool cards, the composer, and buttons.
    static let panel = Color(red: 45 / 255, green: 50 / 255, blue: 56 / 255)
    /// #34393F: another step lighter, for the user's messages and dialogs.
    static let raised = Color(red: 52 / 255, green: 57 / 255, blue: 63 / 255)
    static let hairline = Color.white.opacity(0.13)
    static let accent = Color(red: 0.0, green: 0.94, blue: 1.0)
    static let ok = Color(red: 0.30, green: 0.88, blue: 0.56)
    static let alert = Color(red: 1.0, green: 0.30, blue: 0.43)
    /// Needs input, host mode, a connection being retried.
    static let warning = Color.yellow
    static let text = Color.white.opacity(0.92)
    static let secondary = Color.white.opacity(0.58)
    static let dim = Color.white.opacity(0.36)
    static let cut: CGFloat = 9
    /// Extra space between lines of wrapped text: about 1.5× line height at body size, for reading long replies.
    static let lineSpacing: CGFloat = 5

    static func status(_ status: SessionStatus) -> Color {
        switch status {
        case .needsInput: warning
        case .working: accent
        case .idle: dim
        case .stopping: alert
        }
    }

    static func notice(_ level: NoticeLevel) -> Color {
        switch level {
        case .info: dim
        case .warning: warning
        case .error: alert
        }
    }
}

extension SessionStatus {
    /// How the apps name the status.
    var label: String {
        switch self {
        case .needsInput: "Needs input"
        case .working: "Working"
        case .idle: "Idle"
        case .stopping: "Stopping"
        }
    }
}

// MARK: Typography

/// A font the user chose: the system's, or an installed (or, on the phone, imported) family. A device setting.
public enum FontChoice: Hashable, Sendable, RawRepresentable {
    case system
    case family(String)

    static let textKey = "appearance.font.text"
    static let codeKey = "appearance.font.code"

    public init?(rawValue: String) {
        if rawValue == "system" {
            self = .system
        } else if rawValue.hasPrefix("family:"), rawValue.count > "family:".count {
            self = .family(String(rawValue.dropFirst("family:".count)))
        } else {
            return nil
        }
    }

    public var rawValue: String {
        switch self {
        case .system: "system"
        case .family(let name): "family:\(name)"
        }
    }
}

/// The sizes the UI uses, each tied to a Dynamic Type style so custom fonts scale with the system setting.
enum TextSize {
    case headline, body, callout, footnote, caption, label

    var points: CGFloat {
        switch self {
        case .headline: 17
        case .body: 16
        case .callout: 15
        case .footnote: 13
        case .caption: 12
        case .label: 10
        }
    }

    var style: Font.TextStyle {
        switch self {
        case .headline: .headline
        case .body: .body
        case .callout: .callout
        case .footnote: .footnote
        case .caption: .caption
        case .label: .caption2
        }
    }
}

/// The two font voices: `text` for content and titles, `code` for data, labels, and tool output.
struct Typography: Equatable {
    var text: FontChoice
    var code: FontChoice

    static let standard = Typography(text: .system, code: .system)

    func content(_ size: TextSize = .body) -> Font { font(text, size, design: .default) }
    func data(_ size: TextSize = .footnote) -> Font { font(code, size, design: .monospaced) }

    private func font(_ choice: FontChoice, _ size: TextSize, design: Font.Design) -> Font {
        switch choice {
        case .system: .system(size: size.points, design: design)
        case .family(let name): .custom(name, size: size.points, relativeTo: size.style)
        }
    }
}

extension EnvironmentValues {
    @Entry var typography: Typography = .standard
}

/// Applies the theme to a whole scene: dark, accent tint, the user's fonts in the environment. Settings forms keep the
/// system's type; conversation views opt into the reading type with `readingType()`.
struct PitonTheme: ViewModifier {
    @AppStorage(FontChoice.textKey) private var text: FontChoice = .system
    @AppStorage(FontChoice.codeKey) private var code: FontChoice = .system

    func body(content: Content) -> some View {
        let typography = Typography(text: text, code: code)
        content
            .environment(\.typography, typography)
            .tint(Theme.accent)
            .preferredColorScheme(.dark)
    }
}

struct ReadingType: ViewModifier {
    @Environment(\.typography) private var typography

    func body(content: Content) -> some View {
        content
            .font(typography.content())
            .lineSpacing(Theme.lineSpacing)
    }
}

extension View {
    /// Piton's theme for a scene's root view.
    public func pitonTheme() -> some View { modifier(PitonTheme()) }

    /// The user's text font and roomier line spacing, for the session list and conversations.
    func readingType() -> some View { modifier(ReadingType()) }

    /// The Mac's window toolbar in the canvas color, so the window reads as one surface. Apply to each column's root
    /// view. Nothing on iOS: its bar is already transparent over the grid, and forcing a bar background there hid the
    /// large navigation title.
    @ViewBuilder func canvasBars() -> some View {
        #if os(macOS)
            self
                .toolbarBackground(Theme.canvas, for: .windowToolbar)
                .toolbarBackgroundVisibility(.visible, for: .windowToolbar)
        #else
            self
        #endif
    }

    /// A panel: fill, hairline border, chamfered corners, and an optional marker on the leading edge.
    func panel(border: Color = Theme.hairline, fill: Color = Theme.panel, marker: Color? = nil, padding: CGFloat = 12)
        -> some View
    {
        self
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(ChamferedRectangle().fill(fill))
            .overlay(ChamferedRectangle().stroke(border, lineWidth: 1))
            .overlay(alignment: .leading) {
                if let marker {
                    Rectangle().fill(marker).frame(width: 2, height: 16)
                }
            }
    }
}

// MARK: Shapes and pieces

/// A rectangle with its top-trailing and bottom-leading corners cut at 45°.
struct ChamferedRectangle: Shape {
    var cut: CGFloat = Theme.cut

    func path(in rect: CGRect) -> Path {
        let c = min(cut, rect.width / 2, rect.height / 2)
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX - c, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.minY + c))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
        path.addLine(to: CGPoint(x: rect.minX + c, y: rect.maxY))
        path.addLine(to: CGPoint(x: rect.minX, y: rect.maxY - c))
        path.closeSubpath()
        return path
    }
}

/// A small uppercase, letter-spaced label in the code font: `AGENT`, `TOOL CALL`.
struct SectionLabel: View {
    let text: String
    var color: Color = Theme.dim
    @Environment(\.typography) private var typography

    init(_ text: String, color: Color = Theme.dim) {
        self.text = text
        self.color = color
    }

    var body: some View {
        Text(text.uppercased())
            .font(typography.data(.label))
            .tracking(1.6)
            .foregroundStyle(color)
            .lineLimit(1)
    }
}

/// The canvas behind every screen: near-black with a faint grid.
struct GridBackground: View {
    var body: some View {
        Canvas { context, size in
            let step: CGFloat = 28
            var path = Path()
            for x in stride(from: 0, through: size.width, by: step) {
                path.move(to: CGPoint(x: x, y: 0))
                path.addLine(to: CGPoint(x: x, y: size.height))
            }
            for y in stride(from: 0, through: size.height, by: step) {
                path.move(to: CGPoint(x: 0, y: y))
                path.addLine(to: CGPoint(x: size.width, y: y))
            }
            context.stroke(path, with: .color(Theme.grid), lineWidth: 0.5)
        }
        .background(Theme.canvas)
        .ignoresSafeArea()
    }
}

/// A dashed hairline between turns.
struct DashedRule: View {
    var body: some View {
        Line()
            .stroke(Theme.hairline, style: StrokeStyle(lineWidth: 1, dash: [3, 4]))
            .frame(height: 1)
    }

    private struct Line: Shape {
        func path(in rect: CGRect) -> Path {
            var path = Path()
            path.move(to: CGPoint(x: rect.minX, y: rect.midY))
            path.addLine(to: CGPoint(x: rect.maxX, y: rect.midY))
            return path
        }
    }
}

/// Outlined, chamfered buttons; `prominent` fills with the accent.
struct OutlineButtonStyle: ButtonStyle {
    var prominent = false
    var color: Color = Theme.accent
    @Environment(\.typography) private var typography
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(typography.data(.caption))
            .tracking(1.2)
            .textCase(.uppercase)
            .foregroundStyle(prominent ? Theme.canvas : color)
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(ChamferedRectangle(cut: 6).fill(prominent ? color : Theme.panel))
            .overlay(ChamferedRectangle(cut: 6).stroke(color.opacity(prominent ? 0 : 0.7), lineWidth: 1))
            .opacity(isEnabled ? (configuration.isPressed ? 0.6 : 1) : 0.35)
    }
}

/// A square icon button: hairline outline, colored glyph.
struct IconButtonStyle: ButtonStyle {
    var color: Color = Theme.accent
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .labelStyle(.iconOnly)
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(color)
            .frame(width: 38, height: 38)
            .background(ChamferedRectangle(cut: 6).fill(Theme.panel))
            .overlay(ChamferedRectangle(cut: 6).stroke(color.opacity(0.6), lineWidth: 1))
            .opacity(isEnabled ? (configuration.isPressed ? 0.6 : 1) : 0.35)
    }
}
