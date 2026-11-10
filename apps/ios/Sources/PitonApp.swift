import PitonKit
import PitonUI
import SwiftUI

/// The iOS app: reaches the Mac's daemon over the tailnet WebSocket. The Mac's address is a device setting (Settings >
/// Connection): its MagicDNS name, e.g. `my-mac.example.ts.net`, or its 100.x address.
@main
struct PitonApp: App {
    @AppStorage("macHost") private var macHost = ""
    @AppStorage("macPort") private var macPort = 7357

    init() {
        // Fonts the user imported in Settings > Appearance.
        FontLibrary.registerImported()
    }

    var body: some Scene {
        WindowGroup {
            Group {
                if let url = URL(string: "ws://\(macHost):\(macPort)"), !macHost.isEmpty {
                    RemoteRoot(url: url, host: $macHost, port: $macPort)
                        .id(url)
                } else {
                    // First run: nothing to connect to until the Mac's address is set.
                    NavigationStack {
                        ConnectionSettings(host: $macHost, port: $macPort)
                            .navigationTitle("Piton")
                    }
                }
            }
            .pitonTheme()
        }
    }
}

/// One store per Mac address (a new address makes a new view, hence a new store), connected while the view is shown: a
/// replaced address stops the old store, which would otherwise keep reconnecting to the old Mac.
///
/// The layout follows the window's width. Wide (an iPad, side by side): one split view, its sidebar switching between
/// the sessions and the settings sections (a switcher at its bottom), the content beside it. Compact (the iPhone, a
/// narrow iPad window): two tabs, Sessions and Settings.
struct RemoteRoot: View {
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.horizontalSizeClass) private var width
    @State private var store: Store
    @Binding var host: String
    @Binding var port: Int

    init(url: URL, host: Binding<String>, port: Binding<Int>) {
        _store = State(initialValue: Store(endpoint: .remote(url: url), client: UIDevice.current.name))
        _host = host
        _port = port
    }

    var body: some View {
        layout
            .onAppear { store.start() }
            .onDisappear { store.stop() }
            .onChange(of: scenePhase, initial: true) { _, phase in
                let version =
                    Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "unknown"
                let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "unknown"
                AppLogging.shared.record(
                    "app.phase=\(String(describing: phase)) version=\(version) build=\(build)",
                    category: "lifecycle", detail: .info)
                switch phase {
                // iOS suspends the app in the background, and its connection can die unnoticed meanwhile.
                case .active: store.verifyConnection(reason: "foreground")
                case .inactive, .background: break
                @unknown default: break
                }
            }
    }

    @ViewBuilder private var layout: some View {
        switch width {
        case .regular?:
            RootView(store: store, settings: .init(host: $host, port: $port))
        case .compact?, nil:
            tabs
        @unknown default:
            tabs
        }
    }

    private var tabs: some View {
        TabView {
            Tab("Sessions", systemImage: "bubble.left.and.text.bubble.right") {
                RootView(store: store)
            }
            Tab("Settings", systemImage: "gearshape") {
                NavigationStack {
                    PhoneSettings(store: store, host: $host, port: $port)
                }
            }
        }
    }
}
