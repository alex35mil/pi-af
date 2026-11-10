import PitonKit
import SwiftUI

/// The settings sections. Each is a view shared by every platform; the containers differ: a sidebar of sections in the
/// Mac's Settings window (`SettingsSplit`) and in the iPad's app window (RootView's settings mode), a list that pushes
/// sections in the phone's Settings tab. Declared in display order.
public enum SettingsSection: String, CaseIterable, Identifiable, Hashable, Sendable {
    /// Daemon state and keep-awake (the Mac).
    case general
    /// The phone's Mac address (device settings).
    case connection
    /// Fonts (device settings).
    case appearance
    case logging

    public var id: Self { self }

    var title: String {
        switch self {
        case .connection: "Connection"
        case .general: "General"
        case .appearance: "Appearance"
        case .logging: "Logging"
        }
    }

    var systemImage: String {
        switch self {
        case .connection: "network"
        case .general: "gearshape"
        case .appearance: "textformat"
        case .logging: "waveform.path.ecg"
        }
    }
}

/// Daemon-wide settings and state: keep-awake and the daemon's version.
public struct GeneralSettings: View {
    let store: Store

    public init(store: Store) {
        self.store = store
    }

    public var body: some View {
        Form {
            Section {
                KeepAwakeToggle(
                    store: store,
                    note: "A switch lasts until the daemon restarts; the default is keep_awake in piton's config.toml.")
            }
            Section("piton") {
                LabeledContent("Connection", value: connection)
                if let version = store.daemon?.version {
                    LabeledContent("Version") {
                        Text(version).font(.callout.monospaced()).textSelection(.enabled)
                    }
                }
                if let daemon = store.daemon {
                    LabeledContent("Live sessions", value: "\(daemon.sessions)")
                }
            }
        }
        .formStyle(.grouped)
        .navigationTitle("General")
    }

    private var connection: String {
        switch store.link {
        case .connected: "Connected to \(store.endpoint.label)"
        case .connecting: "Connecting…"
        case .retrying(let error, _): "Reconnecting: \(error)"
        }
    }
}

/// The sections in a sidebar: the list a split view's sidebar shows. The Mac's Settings window has its own split view
/// (`SettingsSplit`); the iPad shows it in the app's split view, in place of the sessions.
struct SettingsSidebar: View {
    let sections: [SettingsSection]
    @Binding var section: SettingsSection?

    var body: some View {
        List(sections, selection: $section) { section in
            Label(section.title, systemImage: section.systemImage).tag(section)
        }
        .navigationTitle("Settings")
    }
}

/// Settings as a sidebar of sections with the chosen one beside it, as in System Settings. `sections` are the ones this
/// platform has, in order; `content` is a section's view.
struct SettingsSplit<Content: View>: View {
    let sections: [SettingsSection]
    let sidebarWidth: CGFloat
    @ViewBuilder let content: (SettingsSection) -> Content
    @State private var section: SettingsSection?

    var body: some View {
        NavigationSplitView {
            SettingsSidebar(sections: sections, section: $section)
                .navigationSplitViewColumnWidth(sidebarWidth)
                .toolbar(removing: .sidebarToggle)
        } detail: {
            NavigationStack {
                if let section = section ?? sections.first {
                    content(section)
                }
            }
        }
        .navigationSplitViewStyle(.balanced)
    }
}

#if os(macOS)
    /// The Mac's Settings window (⌘,): a sidebar of sections, in System Settings' geometry.
    public struct MacSettings: View {
        let store: Store
        @Environment(\.dismiss) private var dismiss

        public init(store: Store) {
            self.store = store
        }

        public var body: some View {
            SettingsSplit(sections: [.general, .appearance, .logging], sidebarWidth: Self.sidebarWidth) { section in
                switch section {
                case .general: GeneralSettings(store: store)
                case .appearance: AppearanceSettings()
                case .logging: LoggingSettings(scope: .host(store))
                // The Mac reaches its daemon over the local socket: nothing to set.
                case .connection: EmptyView()
                }
            }
            // A fixed width (taller is fine), as System Settings has; the scene sizes the window to it.
            .frame(width: Self.width)
            .frame(minHeight: 460, idealHeight: 620)
            // Esc closes the window, as in System Settings. It arrives as the responder chain's cancel, so a field
            // or open menu that handles Esc itself (clearing a search, closing a picker) gets it first.
            .onExitCommand { dismiss() }
            .pitonTheme()
        }

        /// System Settings' window and sidebar widths (macOS 13 and later).
        private static let width: CGFloat = 715
        private static let sidebarWidth: CGFloat = 215
    }
#endif

#if os(iOS)
    /// The phone's Mac address: where the app reaches the daemon over the tailnet.
    public struct ConnectionSettings: View {
        @Binding var host: String
        @Binding var port: Int
        @State private var draftHost = ""
        @State private var draftPort = 7357

        public init(host: Binding<String>, port: Binding<Int>) {
            _host = host
            _port = port
        }

        public var body: some View {
            Form {
                Section {
                    TextField("my-mac.example.ts.net", text: $draftHost)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                    Stepper("Port \(draftPort)", value: $draftPort, in: 1...65535)
                } header: {
                    Text("Your Mac on Tailscale")
                } footer: {
                    Text(
                        "Its MagicDNS name or 100.x address. piton on the Mac accepts only devices on your Tailscale account."
                    )
                }
                Button(host.isEmpty ? "Connect" : "Save") {
                    host = trimmed
                    port = draftPort
                }
                .disabled(trimmed.isEmpty || (trimmed == host && draftPort == port))
            }
            .navigationTitle("Connection")
            .onAppear {
                draftHost = host
                draftPort = port
            }
        }

        private var trimmed: String { draftHost.trimmingCharacters(in: .whitespaces) }
    }

    /// A device's settings sections (iPhone, iPad): the daemon in General, then the device's own settings.
    let deviceSections: [SettingsSection] = [.general, .connection, .appearance, .logging]

    /// One of a device's settings sections (iPhone, iPad).
    struct DeviceSettingsSection: View {
        let section: SettingsSection
        let store: Store
        @Binding var host: String
        @Binding var port: Int

        var body: some View {
            switch section {
            case .general: GeneralSettings(store: store)
            case .connection: ConnectionSettings(host: $host, port: $port)
            case .appearance: AppearanceSettings()
            case .logging: LoggingSettings(scope: .device)
            }
        }
    }

    /// The phone's Settings: Connection, General (when connected), Logging.
    public struct PhoneSettings: View {
        let store: Store?
        @Binding var host: String
        @Binding var port: Int

        public init(store: Store?, host: Binding<String>, port: Binding<Int>) {
            self.store = store
            _host = host
            _port = port
        }

        public var body: some View {
            List {
                ForEach(sections) { section in
                    NavigationLink(value: section) {
                        Label(section.title, systemImage: section.systemImage)
                    }
                }
            }
            .navigationTitle("Settings")
            .navigationDestination(for: SettingsSection.self) { section in
                switch (section, store) {
                case (.connection, _): ConnectionSettings(host: $host, port: $port)
                case (.general, .some(let store)): GeneralSettings(store: store)
                case (.general, nil): EmptyView()
                case (.appearance, _): AppearanceSettings()
                case (.logging, _): LoggingSettings(scope: .device)
                }
            }
        }

        private var sections: [SettingsSection] {
            switch store {
            case .some: [.general, .connection, .appearance, .logging]
            case nil: [.connection, .appearance, .logging]
            }
        }
    }
#endif
