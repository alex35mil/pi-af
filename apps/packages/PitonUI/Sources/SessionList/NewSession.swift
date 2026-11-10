import PitonKit
import SwiftUI

/// Starting a session: pick a workspace under the daemon's roots, the launch mode, and an optional first prompt.
struct NewSessionView: View {
    let store: Store
    let done: (SessionKey?) -> Void
    @State private var workspace = ""
    @State private var prompt = ""
    @State private var host = false
    @State private var busy = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Workspace") {
                    NavigationLink {
                        WorkspaceBrowser(store: store, path: nil) { picked in workspace = picked }
                    } label: {
                        if workspace.isEmpty {
                            Text("Choose…").foregroundStyle(.secondary)
                        } else {
                            Text(URL(fileURLWithPath: workspace).lastPathComponent)
                        }
                    }
                }
                Toggle("Run on the host (no sandbox)", isOn: $host)
                TextField("First prompt (optional)", text: $prompt, axis: .vertical)
                    .lineLimit(3...8)
                if let error = store.lastError {
                    Text(error).foregroundStyle(.red).font(.caption)
                }
            }
            .navigationTitle("New session")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { done(nil) }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Start") {
                        busy = true
                        Task {
                            let key = await store.startSession(
                                workspace: workspace, mode: host ? .host : .sandbox,
                                prompt: prompt.isEmpty ? nil : prompt)
                            busy = false
                            if key != nil { done(key) }
                        }
                    }
                    .disabled(workspace.isEmpty || busy)
                }
            }
        }
    }
}

/// Browses the daemon's workspace roots one level at a time; picking a checkout pops back to the sheet.
struct WorkspaceBrowser: View {
    let store: Store
    let path: String?
    let pick: (String) -> Void
    @State private var load = Load.loading
    @Environment(\.dismiss) private var dismiss

    enum Load {
        case loading
        case loaded([WorkspaceEntry])
        /// The daemon refused (for example, no roots configured) or the connection failed.
        case failed(String)
    }

    var body: some View {
        List {
            switch load {
            case .loading:
                ProgressView()
            case .failed(let message):
                Label(message, systemImage: "exclamationmark.triangle")
                    .foregroundStyle(.secondary)
            case .loaded(let entries):
                if entries.isEmpty {
                    Text("Nothing here").foregroundStyle(.secondary)
                }
                ForEach(entries) { entry in
                    switch entry {
                    case .group(let name, let path):
                        NavigationLink {
                            WorkspaceBrowser(store: store, path: path) { picked in
                                pick(picked)
                                dismiss()
                            }
                        } label: {
                            Label(name, systemImage: "folder")
                        }
                    case .workspace(let name, let path, let source):
                        Button {
                            pick(path)
                            dismiss()
                        } label: {
                            Label {
                                VStack(alignment: .leading) {
                                    Text(name)
                                    if let source {
                                        Text("worker of \(URL(fileURLWithPath: source).lastPathComponent)")
                                            .font(.caption).foregroundStyle(.secondary)
                                    }
                                }
                            } icon: {
                                Image(systemName: "shippingbox")
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle(path.map { URL(fileURLWithPath: $0).lastPathComponent } ?? "Workspaces")
        .task {
            do {
                load = .loaded(try await store.browse(path))
            } catch {
                load = .failed(String(describing: error))
            }
        }
    }
}
