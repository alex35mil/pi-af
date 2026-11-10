import PitonKit
import SwiftUI

/// One session: the history, pending dialogs, and the prompt.
public struct SessionView: View {
    let store: Store
    let session: SessionKey
    @State private var draft = ""
    @State private var stopping: SessionInfo?
    /// The session's images, fetched once while the conversation is open.
    @State private var images: ImageLibrary

    public init(store: Store, session: SessionKey) {
        self.store = store
        self.session = session
        _images = State(initialValue: ImageLibrary(store: store, session: session))
    }

    private var model: SessionModel? { store.models[session] }
    private var info: SessionInfo? { store.sessions.first { $0.key == session } }

    public var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 14) {
                    if model?.hasMore == true {
                        Button("Load earlier") { Task { await store.loadEarlier(session) } }
                            .buttonStyle(OutlineButtonStyle(color: Theme.secondary))
                            .frame(maxWidth: .infinity)
                    }
                    if let model {
                        ForEach(model.items) { item in
                            ItemView(item: item, store: store, session: session, images: images)
                                .id(item.id)
                        }
                    } else {
                        ProgressView().frame(maxWidth: .infinity)
                    }
                    ForEach(store.outbox(for: session)) { message in
                        OutgoingView(message: message, store: store)
                    }
                    Color.clear.frame(height: 1).id("bottom")
                }
                .padding()
            }
            .scrollContentBackground(.hidden)
            .background(GridBackground())
            .onChange(of: model?.seq) { proxy.scrollTo("bottom", anchor: .bottom) }
            .onChange(of: store.outbox(for: session).count) { proxy.scrollTo("bottom", anchor: .bottom) }
            .onAppear { proxy.scrollTo("bottom", anchor: .bottom) }
        }
        .safeAreaInset(edge: .bottom) {
            VStack(spacing: 8) {
                ForEach(model?.state?.dialogs ?? []) { dialog in
                    DialogCard(dialog: dialog) { answer in
                        Task { await store.answer(session, dialog: dialog.id, with: answer) }
                    }
                }
                Composer(
                    draft: $draft, working: isWorking,
                    send: { mode in send(mode) },
                    abort: { Task { await store.abort(session) } })
            }
            .padding(.horizontal)
            .padding(.vertical, 8)
            .background(Theme.canvas.opacity(0.94))
        }
        .navigationTitle(info?.title ?? "Session")
        .toolbar {
            ToolbarItem(placement: .destructiveAction) {
                Button("Stop Session", systemImage: "xmark") { stopping = info }
                    .disabled(info == nil)
            }
        }
        .stopSessionConfirmation(store: store, session: $stopping)
        // Watching is driven by the selection in RootView, not by this view's lifecycle: on iPhone the split view
        // reports the detail as gone right after showing it (onDisappear, task cancellation), while it stays visible.
    }

    private var isWorking: Bool {
        switch model?.state?.status ?? info?.status ?? .idle {
        case .working, .needsInput: true
        case .idle, .stopping: false
        }
    }

    private func send(_ mode: SendMode) {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        // The store keeps it until the daemon confirms it, re-sending after a reconnect.
        store.send(session, text: text, mode: mode)
        draft = ""
    }
}
