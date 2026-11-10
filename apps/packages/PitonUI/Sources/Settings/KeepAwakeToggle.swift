import PitonKit
import SwiftUI

/// Keep-awake on/off: while on, the daemon holds the Mac awake whenever sessions are live (idle ones too), so the phone
/// can reach them. Reverts to the daemon's config when the daemon restarts.
public struct KeepAwakeToggle: View {
    let store: Store
    /// Extra description under the status (Settings explains where the default comes from; the menu bar doesn't).
    let note: String?
    @State private var pending: Bool?

    public init(store: Store, note: String? = nil) {
        self.store = store
        self.note = note
    }

    public var body: some View {
        // Title and description as two label texts: a form styles the second as the row's description, the same as
        // the other settings rows.
        Toggle(isOn: binding) {
            Text("Keep Mac Awake")
            Text(note.map { "\(detail). \($0)" } ?? detail)
        }
        .disabled(store.daemon == nil || pending != nil)
    }

    private var binding: Binding<Bool> {
        Binding(
            get: { pending ?? store.daemon?.keepAwake ?? false },
            set: { on in
                pending = on
                Task {
                    _ = await store.setKeepAwake(on)
                    pending = nil
                }
            })
    }

    private var detail: String {
        guard let state = store.daemon else { return "Not connected to piton" }
        switch (state.keepAwake, state.awake) {
        case (true, true): return "Awake for \(state.sessions) session\(state.sessions == 1 ? "" : "s")"
        case (true, false): return "Will stay awake while sessions run"
        case (false, _): return "The Mac may sleep; the phone loses access"
        }
    }
}
