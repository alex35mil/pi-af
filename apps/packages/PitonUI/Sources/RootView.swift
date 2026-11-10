import PitonKit
import SwiftUI

/// What the app's split view shows: the sessions (list and conversation) or the settings (sections and the chosen one).
public enum RootMode: Hashable, Sendable {
    case sessions
    case settings
}

/// The app: a sidebar and the content beside it. On the Mac and the iPhone it shows sessions only; their settings live
/// elsewhere (the Settings window, the phone's Settings tab). On the iPad (`settings` set) a switcher at the bottom of
/// the sidebar flips it between sessions and settings; each keeps its selection while the other is shown.
public struct RootView: View {
    let store: Store
    let settings: DeviceSettings?
    @State private var mode = RootMode.sessions
    @State private var selection: SessionKey?
    @State private var section: SettingsSection?
    /// The image viewer, for every image strip in the app.
    @State private var viewer = ImageViewerModel()

    /// What the iPad's settings mode needs: the Mac's address, a device setting.
    public struct DeviceSettings {
        let host: Binding<String>
        let port: Binding<Int>

        public init(host: Binding<String>, port: Binding<Int>) {
            self.host = host
            self.port = port
        }
    }

    /// `store` is owned by the app, which starts and stops it (on the Mac it's shared with the menu bar item). With
    /// `settings`, the sidebar can switch to the settings (the iPad).
    public init(store: Store, settings: DeviceSettings? = nil) {
        self.store = store
        self.settings = settings
    }

    public var body: some View {
        NavigationSplitView {
            sidebar
                // Room for a title and the workspace/status line; the user can still drag it.
                .navigationSplitViewColumnWidth(min: 260, ideal: 320, max: 480)
                .canvasBars()
                #if os(iOS)
                    .toolbar {
                        if settings != nil {
                            ToolbarItem(placement: .bottomBar) {
                                Picker("Show", selection: $mode) {
                                    Label("Sessions", systemImage: "bubble.left.and.text.bubble.right")
                                    .tag(RootMode.sessions)
                                    Label("Settings", systemImage: "gearshape").tag(RootMode.settings)
                                }
                                .pickerStyle(.segmented)
                                .fixedSize()
                            }
                        }
                    }
                #endif
        } detail: {
            detail
        }
        .readingType()
        .environment(viewer)
        #if os(iOS)
            // Over the whole app, without a sheet: the conversation shows through as a swipe down fades the backdrop.
            .overlay {
                if let gallery = viewer.gallery {
                    ImageViewer(gallery: gallery) { viewer.close() }
                    .transition(.opacity)
                }
            }
            .animation(.easeInOut(duration: 0.2), value: viewer.gallery == nil)
        #endif
        // The selection is the source of truth for which session is watched: it changes only when the user navigates
        // (on iPhone, going back clears it). View appear/disappear events aren't reliable for this on iPhone. It stays
        // watched while the iPad shows the settings, so switching back finds it current.
        .onChange(of: selection, initial: true) { old, new in
            guard old != new else { return }
            if let old { store.unwatch(old) }
            if let new { store.watch(new) }
        }
    }

    @ViewBuilder private var sidebar: some View {
        switch (mode, settings) {
        case (.sessions, _), (.settings, nil):
            SessionListView(store: store, selection: $selection)
        case (.settings, .some):
            #if os(iOS)
                SettingsSidebar(sections: deviceSections, section: $section)
            #else
                SessionListView(store: store, selection: $selection)
            #endif
        }
    }

    @ViewBuilder private var detail: some View {
        switch (mode, settings) {
        case (.sessions, _), (.settings, nil):
            sessionDetail
        case (.settings, .some(let device)):
            #if os(iOS)
                NavigationStack {
                    DeviceSettingsSection(
                        section: section ?? .general, store: store, host: device.host, port: device.port)
                }
            #else
                sessionDetail
            #endif
        }
    }

    @ViewBuilder private var sessionDetail: some View {
        if let selection, store.sessions.contains(where: { $0.key == selection }) {
            SessionView(store: store, session: selection)
                .id(selection)
                .canvasBars()
                #if os(iOS)
                    // The phone's tab bar belongs to the top level (Sessions | Settings), not to a conversation.
                    .toolbar(.hidden, for: .tabBar)
                #endif
        } else {
            ContentUnavailableView("Select a session", systemImage: "bubble.left.and.text.bubble.right")
                .foregroundStyle(Theme.dim)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(GridBackground())
                .canvasBars()
        }
    }
}
