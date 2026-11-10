import PitonKit
import SwiftUI

/// One history item: a user message, an agent message, a tool call, a summary, or a notice.
struct ItemView: View {
    let item: Item
    let store: Store
    let session: SessionKey
    let images: ImageLibrary
    @Environment(\.typography) private var typography

    var body: some View {
        switch item {
        case .user(let user):
            UserView(blocks: user.blocks, images: images)
        case .assistant(let message):
            AssistantView(message: message)
        case .tool(let tool):
            ToolView(tool: tool, store: store, session: session, images: images)
        case .summary(let summary):
            SummaryView(summary: summary)
        case .notice(let notice):
            HStack(spacing: 8) {
                Rectangle().fill(Theme.notice(notice.level)).frame(width: 2, height: 12)
                Text(notice.text)
                    .font(typography.data(.caption))
                    .foregroundStyle(Theme.notice(notice.level))
            }
        case .other(let other):
            SectionLabel(other.role)
        }
    }
}

struct UserView: View {
    let blocks: [ContentBlock]
    let images: ImageLibrary
    @Environment(\.typography) private var typography

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            SectionLabel("User", color: Theme.accent)
            let body = blocks.text()
            if !body.isEmpty {
                Text(body)
                    .font(typography.content())
                    .foregroundStyle(Theme.text)
                    .textSelection(.enabled)
            }
            let refs = blocks.images
            if !refs.isEmpty {
                ImageStrip(refs: refs, library: images)
            }
        }
        .panel(border: Theme.accent.opacity(0.45), fill: Theme.raised)
    }
}

struct SummaryView: View {
    let summary: SummaryItem
    @State private var expanded = false
    @Environment(\.typography) private var typography

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button {
                expanded.toggle()
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: expanded ? "chevron.down" : "chevron.right").font(.system(size: 9))
                    SectionLabel(title)
                }
                .foregroundStyle(Theme.dim)
            }
            .buttonStyle(.plain)
            if expanded {
                Text(summary.text)
                    .font(typography.content(.callout))
                    .foregroundStyle(Theme.secondary)
                    .textSelection(.enabled)
            }
        }
        .panel(fill: Theme.panel.opacity(0.6))
    }

    private var title: String {
        switch summary.kind {
        case .compaction: "Compacted"
        case .branch: "Branch summary"
        }
    }
}

/// An assistant message's header and text. Thinking is never shown: while the model thinks, the header carries an
/// indicator, and it leaves no trace once the message moves on.
struct AssistantView: View {
    let message: AssistantItem
    @Environment(\.typography) private var typography

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: "diamond").font(.system(size: 9, weight: .bold)).foregroundStyle(Theme.accent)
                SectionLabel(message.model.map { "Agent · \($0)" } ?? "Agent")
                switch message.activity {
                case .thinking:
                    Image(systemName: "ellipsis.bubble")
                        .font(.system(size: 11))
                        .foregroundStyle(Theme.dim)
                        .symbolEffect(.variableColor.iterative, options: .repeating)
                        .accessibilityLabel("Thinking")
                case .responding:
                    ProgressView().controlSize(.mini).tint(Theme.accent)
                case .finished:
                    EmptyView()
                }
            }
            let text = message.text
            if !text.isEmpty {
                Text(markdown(text))
                    .font(typography.content())
                    .foregroundStyle(Theme.text)
                    .textSelection(.enabled)
            }
            if let error = message.error {
                Text(error).font(typography.data(.caption)).foregroundStyle(Theme.alert)
            }
        }
        .padding(.vertical, 4)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// A tool call: its status, name, and most telling argument; expanded, the output's preview, and the full output (with
/// its images) on request.
struct ToolView: View {
    let tool: ToolItem
    let store: Store
    let session: SessionKey
    let images: ImageLibrary
    @State private var expanded = false
    /// The full output, once fetched (the preview is a bounded, text-only tail).
    @State private var full: [ContentBlock]?
    @Environment(\.typography) private var typography

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button {
                expanded.toggle()
            } label: {
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 8) {
                            SectionLabel(statusLabel, color: statusColor)
                            if case .running = tool.status {
                                ProgressView().controlSize(.mini).tint(Theme.accent)
                            }
                        }
                        Text(tool.name).font(typography.data(.callout)).foregroundStyle(Theme.text)
                        if let summary = argsSummary {
                            Text(summary)
                                .font(typography.data(.caption))
                                .foregroundStyle(Theme.secondary)
                                .lineLimit(expanded ? nil : 1)
                                .textSelection(.enabled)
                        }
                    }
                    Spacer(minLength: 0)
                    Image(systemName: expanded ? "chevron.down" : "chevron.right")
                        .font(.system(size: 10))
                        .foregroundStyle(Theme.dim)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if expanded {
                if let output = full?.text() ?? tool.preview.map(ImageNotes.strip), !output.isEmpty {
                    ScrollView(.horizontal) {
                        Text(output)
                            .font(typography.data(.caption))
                            .foregroundStyle(Theme.secondary)
                            .textSelection(.enabled)
                            .padding(10)
                    }
                    .background(Theme.canvas)
                    .overlay(Rectangle().stroke(Theme.hairline, lineWidth: 1))
                }
                if let refs = full?.images, !refs.isEmpty {
                    ImageStrip(refs: refs, library: images)
                }
                if tool.truncated && full == nil {
                    Button("Show full output") {
                        Task {
                            if let result = await store.toolOutput(session, callID: tool.callID) {
                                full = ContentBlock.blocks(of: result["content"] ?? result)
                            }
                        }
                    }
                    .buttonStyle(OutlineButtonStyle())
                }
            }
        }
        .panel(border: statusColor.opacity(0.4), marker: statusColor)
    }

    private var statusLabel: String {
        switch tool.status {
        case .pending: "Tool call · pending"
        case .running: "Tool call · running"
        case .done: "Tool result"
        case .error: "Tool error"
        }
    }

    private var statusColor: Color {
        switch tool.status {
        case .pending: Theme.dim
        case .running: Theme.accent
        case .done: Theme.ok
        case .error: Theme.alert
        }
    }

    /// The most telling argument: a command, a path, or a query.
    private var argsSummary: String? {
        for key in ["command", "path", "file_path", "pattern", "query", "url"] {
            if let value = tool.args[key]?.string { return value }
        }
        return nil
    }
}

/// Inline Markdown (bold, code, links); falls back to plain text.
func markdown(_ text: String) -> AttributedString {
    (try? AttributedString(
        markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
        ?? AttributedString(text)
}
