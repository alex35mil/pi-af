import PitonKit
import SwiftUI

/// The live sessions grouped by project (workers under their project), needs-input first, with a button to start one.
public struct SessionListView: View {
    @Bindable var store: Store
    @Binding var selection: SessionKey?
    @State private var starting = false
    @State private var stopping: SessionInfo?

    public init(store: Store, selection: Binding<SessionKey?>) {
        self.store = store
        self._selection = selection
    }

    public var body: some View {
        ScrollViewReader { proxy in
            List(selection: nativeSelection) {
                if store.sessions.isEmpty {
                    ContentUnavailableView(
                        emptyTitle, systemImage: "terminal",
                        description: Text(emptyDescription))
                }
                ForEach(store.projects) { project in
                    // An ordinary, nonselectable header row: native Section chrome adds another divider and its own
                    // platform-dependent spacing on top of ours.
                    ProjectHeader(project: project)
                        .listRowStyle()
                        .selectionDisabled()
                    ForEach(project.checkouts) { checkout in
                        ForEach(checkout.sessions) { session in
                            row(session)
                        }
                    }
                }
            }
            .listStyle(.plain)
            .environment(\.defaultMinListRowHeight, 0)
            #if os(macOS)
                .onMoveCommand { direction in
                    switch direction {
                    case .up: moveSelection(by: -1)
                    case .down: moveSelection(by: 1)
                    case .left, .right: break
                    @unknown default: break
                    }
                }
            #endif
            .scrollContentBackground(.hidden)
            .background(GridBackground())
            #if os(macOS)
                .onChange(of: selection) { _, key in
                    if let key { proxy.scrollTo(key) }
                }
            #endif
        }
        .safeAreaInset(edge: .top) { LinkBanner(link: store.link, endpoint: store.endpoint) }
        .navigationTitle("Sessions")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("New session", systemImage: "plus") { starting = true }
                    .disabled(store.link != .connected)
            }
        }
        .sheet(isPresented: $starting) {
            NewSessionView(store: store) { key in
                starting = false
                if let key { selection = key }
            }
        }
        .stopSessionConfirmation(store: store, session: $stopping)
    }

    /// iPhone uses List selection to navigate the split view. On the Mac, plain buttons update our selection without
    /// opting into the native blue row highlight; the card's border is the selection indicator.
    private var nativeSelection: Binding<SessionKey?>? {
        #if os(macOS)
            nil
        #else
            $selection
        #endif
    }

    #if os(macOS)
        private func moveSelection(by offset: Int) {
            let keys = store.projects.flatMap(\.checkouts).flatMap(\.sessions).map(\.key)
            guard !keys.isEmpty else { return }
            let index = selection.flatMap { keys.firstIndex(of: $0) }
            let next = index.map { min(max($0 + offset, 0), keys.count - 1) } ?? 0
            selection = keys[next]
        }
    #endif

    private func row(_ session: SessionInfo) -> some View {
        Group {
            #if os(macOS)
                Button {
                    selection = session.key
                } label: {
                    SessionRow(session: session, selected: selection == session.key)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selection == session.key ? .isSelected : [])
            #else
                SessionRow(session: session, selected: selection == session.key)
                    .tag(session.key)
            #endif
        }
        .id(session.key)
        .listRowStyle()
        .contextMenu {
            Button("Stop Session…", systemImage: "xmark", role: .destructive) { stopping = session }
        }
        .swipeActions(edge: .trailing) {
            Button("Stop", systemImage: "xmark") { stopping = session }
                .tint(.red)
        }
    }

    private var emptyTitle: String {
        switch store.link {
        case .connected: "No sessions"
        case .connecting, .retrying: "Not connected"
        }
    }

    private var emptyDescription: String {
        switch store.link {
        case .connected: "Start one here, or with :Pi in Neovim."
        case .connecting: "Connecting to piton on \(store.endpoint.label)…"
        case .retrying(let error, _): error
        }
    }
}

extension View {
    /// A row on the grid: no system background or separator.
    fileprivate func listRowStyle() -> some View {
        self
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
            .listRowInsets(EdgeInsets(top: 4, leading: 12, bottom: 4, trailing: 12))
    }
}

/// A project's name and session count, above its sessions.
struct ProjectHeader: View {
    let project: ProjectGroup
    @Environment(\.typography) private var typography

    var body: some View {
        HStack(spacing: 8) {
            Rectangle().fill(Theme.accent).frame(width: 2, height: 12)
            SectionLabel(project.name, color: Theme.text)
            Rectangle().fill(Theme.hairline).frame(height: 1)
            Text("\(project.sessionCount)")
                .font(typography.data(.label))
                .foregroundStyle(Theme.dim)
        }
        .padding(.top, 16)
        .padding(.bottom, 4)
        .accessibilityAddTraits(.isHeader)
    }
}

struct SessionRow: View {
    let session: SessionInfo
    let selected: Bool
    @Environment(\.typography) private var typography

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                SectionLabel(checkoutLabel, color: Theme.secondary)
                    .layoutPriority(1)
                Spacer(minLength: 8)
                StatusDot(status: session.status)
                SectionLabel(session.status.label, color: Theme.status(session.status))
                    .fixedSize(horizontal: true, vertical: false)
            }
            Text(session.title ?? "New session")
                .font(typography.content())
                .foregroundStyle(Theme.text)
                .lineLimit(1)
            HStack(spacing: 10) {
                switch session.mode {
                case .sandbox: Text("sandbox")
                case .host: Text("host").foregroundStyle(Theme.warning)
                }
                if session.clients > 0 {
                    Label("\(session.clients)", systemImage: "macbook.and.iphone")
                        .labelStyle(.titleAndIcon)
                }
            }
            .font(typography.data(.caption))
            .foregroundStyle(Theme.dim)
        }
        .panel(border: selected ? Theme.accent : Theme.hairline)
    }

    private var checkoutLabel: String {
        switch session.checkout {
        case .source: "origin"
        case .worker(_, let name): name
        }
    }

}

struct StatusDot: View {
    let status: SessionStatus

    var body: some View {
        Circle()
            .fill(Theme.status(status))
            .frame(width: 6, height: 6)
            .shadow(color: Theme.status(status).opacity(0.8), radius: 3)
            .accessibilityLabel(status.label)
    }
}

struct LinkBanner: View {
    let link: Store.Link
    let endpoint: Endpoint
    @Environment(\.typography) private var typography

    var body: some View {
        switch link {
        case .connected:
            EmptyView()
        case .connecting:
            banner("Connecting to \(endpoint.label)…", systemImage: "antenna.radiowaves.left.and.right")
        case .retrying(let error, let attempt):
            banner("Reconnecting (\(attempt)): \(error)", systemImage: "exclamationmark.triangle")
        }
    }

    private func banner(_ text: String, systemImage: String) -> some View {
        Label(text, systemImage: systemImage)
            .font(typography.data(.caption))
            .foregroundStyle(Theme.warning)
            .lineLimit(2)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(8)
            .background(Theme.canvas)
            .overlay(alignment: .bottom) { Rectangle().fill(Theme.warning.opacity(0.4)).frame(height: 1) }
    }
}
