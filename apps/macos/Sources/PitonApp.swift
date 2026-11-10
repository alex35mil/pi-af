import PitonKit
import PitonUI
import SwiftUI

/// The macOS app: a window with the session list and conversations, a Settings window (⌘,), and a menu bar item with
/// keep-awake, on this Mac's daemon socket. (Daemon registration and the sleep helper come later.)
@main
struct PitonApp: App {
    /// The app's one connection to the daemon, for as long as the app runs.
    @State private var store: Store

    init() {
        let store = Store(endpoint: .defaultLocal, client: "mac")
        store.start()
        _store = State(initialValue: store)
    }

    var body: some Scene {
        WindowGroup {
            RootView(store: store)
                .frame(minWidth: 720, minHeight: 480)
                .pitonTheme()
        }
        Settings {
            MacSettings(store: store)
        }
        // The window follows MacSettings' fixed width; only its height resizes.
        .windowResizability(.contentSize)
        MenuBarExtra {
            MenuBarContent(store: store)
        } label: {
            Image(systemName: menuBarSymbol)
        }
        .menuBarExtraStyle(.window)
    }

    /// Filled while the Mac is held awake.
    private var menuBarSymbol: String {
        store.daemon?.awake == true ? "cup.and.saucer.fill" : "cup.and.saucer"
    }
}

struct MenuBarContent: View {
    let store: Store
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            KeepAwakeToggle(store: store)
            Divider()
            HStack {
                Text("\(store.sessions.count) live session\(store.sessions.count == 1 ? "" : "s")")
                    .foregroundStyle(.secondary)
                Spacer()
                SettingsLink {
                    Text("Settings…")
                }
                Button("Open Piton") {
                    NSApp.activate()
                }
            }
            .font(.callout)
            if let version = store.daemon?.version {
                Text("piton \(version)")
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
            }
        }
        .padding()
        .frame(width: 280)
    }
}
