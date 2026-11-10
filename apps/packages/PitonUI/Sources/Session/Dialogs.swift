import PitonKit
import SwiftUI

/// A pending extension dialog: select, confirm, input, or editor.
struct DialogCard: View {
    let dialog: Dialog
    let answer: (DialogAnswer) -> Void
    @State private var text = ""
    @Environment(\.typography) private var typography

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel("Needs input", color: Theme.accent)
            Text(dialog.title ?? "Pi is asking").font(typography.content(.headline))
            if let message = dialog.message {
                Text(message).font(typography.content(.callout)).foregroundStyle(Theme.secondary)
            }
            switch dialog.method {
            case .select:
                ForEach(dialog.options ?? [], id: \.self) { option in
                    Button(option) { answer(.value(option)) }
                        .buttonStyle(OutlineButtonStyle())
                }
            case .confirm:
                HStack {
                    Button("Yes") { answer(.confirmed(true)) }.buttonStyle(OutlineButtonStyle(prominent: true))
                    Button("No") { answer(.confirmed(false)) }.buttonStyle(OutlineButtonStyle())
                }
            case .input, .editor:
                TextField(dialog.placeholder ?? "Answer", text: $text, axis: .vertical)
                    .lineLimit(dialog.method == .editor ? 4...12 : 1...3)
                    .font(typography.content())
                    .textFieldStyle(.plain)
                    .padding(10)
                    .background(Theme.canvas)
                    .overlay(Rectangle().stroke(Theme.hairline, lineWidth: 1))
                    .onAppear { text = dialog.prefill ?? "" }
                Button("Send") { answer(.value(text)) }.buttonStyle(OutlineButtonStyle(prominent: true))
            }
            Button("Dismiss") { answer(.cancelled) }
                .buttonStyle(OutlineButtonStyle(color: Theme.secondary))
        }
        .panel(border: Theme.accent.opacity(0.7), fill: Theme.raised, marker: Theme.accent)
    }
}
