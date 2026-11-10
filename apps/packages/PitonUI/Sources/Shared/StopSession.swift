import PitonKit
import SwiftUI

extension View {
    /// Asks before stopping `session` (set it to show the dialog). Stopping ends pi for every client attached to the
    /// session, pi.nvim included; the conversation stays in its file and can be resumed. An alert, centered: a
    /// confirmation dialog would anchor to its button as a popover.
    func stopSessionConfirmation(store: Store, session: Binding<SessionInfo?>) -> some View {
        alert(
            "Stop this session?",
            isPresented: Binding(
                get: { session.wrappedValue != nil },
                set: { if !$0 { session.wrappedValue = nil } }),
            presenting: session.wrappedValue
        ) { info in
            Button("Stop Session", role: .destructive) {
                Task { _ = await store.stopSession(info.key) }
            }
            Button("Cancel", role: .cancel) {}
        } message: { info in
            Text(
                "\(info.title.map { "“\($0)”" } ?? "It") stops for every client attached to it, Neovim included. "
                    + "The conversation is kept and can be resumed.")
        }
    }
}
