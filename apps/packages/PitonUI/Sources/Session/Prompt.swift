import PitonKit
import SwiftUI

#if os(macOS)
    import AppKit
#else
    import UIKit
#endif

/// The prompt: a multi-line field that sends, steers, or follows up, and aborts a working session.
struct Composer: View {
    @Binding var draft: String
    let working: Bool
    let send: (SendMode) -> Void
    let abort: () -> Void
    @Environment(\.typography) private var typography

    var body: some View {
        HStack(alignment: .bottom, spacing: 8) {
            TextField(working ? "Steer or follow up…" : "Message", text: $draft, axis: .vertical)
                .lineLimit(1...6)
                // Return on a hardware keyboard (Mac, iPad) submits a vertical field; Option+Return breaks the line.
                // The on-screen keyboard's Return keeps inserting a newline.
                .onSubmit { send(working ? .steer : .prompt) }
                // Shift+Return also breaks the line, as in chat apps. Lock and keypad state aren't held modifiers.
                .onKeyPress(keys: [.return]) { press in
                    press.modifiers.subtracting([.capsLock, .numericPad]) == .shift ? insertNewline() : .ignored
                }
                .font(typography.content())
                .textFieldStyle(.plain)
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .background(ChamferedRectangle(cut: 6).fill(Theme.panel))
                .overlay(ChamferedRectangle(cut: 6).stroke(Theme.hairline, lineWidth: 1))
            if working {
                Menu {
                    Button("Steer now", systemImage: "arrow.turn.up.right") { send(.steer) }
                    Button("Follow up after", systemImage: "text.append") { send(.followUp) }
                } label: {
                    Label("Send", systemImage: "arrow.up")
                } primaryAction: {
                    send(.steer)
                }
                .menuIndicator(.hidden)
                .buttonStyle(IconButtonStyle())
                .disabled(draft.isEmpty)
                Button("Abort", systemImage: "stop.fill", action: abort)
                    .buttonStyle(IconButtonStyle(color: Theme.alert))
            } else {
                Button("Send", systemImage: "arrow.up") { send(.prompt) }
                    .buttonStyle(IconButtonStyle())
                    .disabled(draft.isEmpty)
            }
        }
    }

    /// Inserts a line break at the caret through the platform's text editing, so the caret and undo stay native.
    private func insertNewline() -> KeyPress.Result {
        #if os(macOS)
            // A field editor ends editing on a plain newline; this is the action Option+Return sends.
            NSApp.sendAction(#selector(NSResponder.insertNewlineIgnoringFieldEditor(_:)), to: nil, from: nil)
            return .handled
        #else
            // UIKit's text input takes the newline as typed text from the first responder.
            UIApplication.shared.sendAction(#selector(UIKeyInput.insertText(_:)), to: nil, from: "\n", for: nil)
            return .handled
        #endif
    }
}

/// A message the daemon hasn't confirmed: sending (or waiting for the connection), or refused.
struct OutgoingView: View {
    let message: Store.Outgoing
    let store: Store
    @Environment(\.typography) private var typography

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            switch message.state {
            case .sending:
                SectionLabel(store.link == .connected ? "User · sending" : "User · waiting for connection")
            case .failed:
                SectionLabel("User · not sent", color: Theme.alert)
            }
            Text(message.text).font(typography.content()).foregroundStyle(Theme.secondary)
            switch message.state {
            case .sending:
                EmptyView()
            case .failed(let error):
                Text(error).font(typography.data(.caption)).foregroundStyle(Theme.alert).lineLimit(2)
                HStack(spacing: 8) {
                    Button("Retry") { store.retry(message.id) }.buttonStyle(OutlineButtonStyle())
                    Button("Discard") { store.discard(message.id) }
                        .buttonStyle(OutlineButtonStyle(color: Theme.alert))
                }
            }
        }
        .panel(border: Theme.hairline.opacity(0.6), fill: Theme.panel.opacity(0.6))
    }
}
