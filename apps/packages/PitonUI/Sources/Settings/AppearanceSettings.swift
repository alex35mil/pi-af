import SwiftUI
import UniformTypeIdentifiers

/// The Appearance settings section: the text and code fonts. A device setting, stored on each device.
public struct AppearanceSettings: View {
    @AppStorage(FontChoice.textKey) private var text: FontChoice = .system
    @AppStorage(FontChoice.codeKey) private var code: FontChoice = .system
    @State private var importing = false
    @State private var imported: [String] = []
    @State private var problem: String?
    @Environment(\.typography) private var typography

    public init() {}

    public var body: some View {
        Form {
            Section {
                NavigationLink {
                    FontList(title: "Text Font", selection: $text, design: .default)
                } label: {
                    LabeledContent {
                        Text(name(text))
                    } label: {
                        Text("Text")
                        Text("Messages and titles.")
                    }
                }
                NavigationLink {
                    FontList(title: "Code Font", selection: $code, design: .monospaced)
                } label: {
                    LabeledContent {
                        Text(name(code))
                    } label: {
                        Text("Code")
                        Text("Labels, tool calls, and output.")
                    }
                }
            } header: {
                Text("Fonts")
            }
            Section("Preview") {
                VStack(alignment: .leading, spacing: 8) {
                    SectionLabel("Tool call", color: Theme.accent)
                    Text("Let me check the issue.").font(typography.content())
                    Text("gh issue view 1052 --repo nolabs-ai/nono")
                        .font(typography.data())
                        .foregroundStyle(Theme.secondary)
                }
                .panel()
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
            }
            Section {
                LabeledContent {
                    Button("Import…") { importing = true }
                } label: {
                    Text("Font Files")
                    Text(
                        "For fonts you own that aren't installed here (Berkeley Mono, say): pick their .otf or .ttf files. They're copied into Piton on this device only."
                    )
                }
                if !imported.isEmpty {
                    LabeledContent("Imported", value: imported.joined(separator: ", "))
                    Button("Remove Imported Fonts", role: .destructive) {
                        FontLibrary.removeImported()
                        imported = []
                        for key in [FontChoice.textKey, FontChoice.codeKey] {
                            UserDefaults.standard.removeObject(forKey: key)
                        }
                    }
                }
                if let problem {
                    Text(problem).foregroundStyle(Theme.alert)
                }
            }
        }
        .formStyle(.grouped)
        .navigationTitle("Appearance")
        .onAppear { imported = FontLibrary.importedFamilies() }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.font], allowsMultipleSelection: true) { result in
            switch result {
            case .success(let urls):
                do throws(FontLibrary.ImportError) {
                    _ = try FontLibrary.importFiles(urls)
                    imported = FontLibrary.importedFamilies()
                    problem = nil
                } catch {
                    switch error {
                    case .notAFont(let file): problem = "\(file) isn't a font file."
                    case .storage(let file, let code): problem = "Couldn't import \(file) (error \(code))."
                    }
                }
            case .failure:
                problem = "Couldn't open the files."
            }
        }
    }

    private func name(_ choice: FontChoice) -> String {
        switch choice {
        case .system: "System"
        case .family(let family): family
        }
    }
}

/// Every available family, each shown in its own face; a search field narrows the list.
struct FontList: View {
    let title: String
    @Binding var selection: FontChoice
    let design: Font.Design
    @State private var families: [String] = []
    @State private var query = ""
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        List {
            row(.system, label: "System")
            ForEach(filtered, id: \.self) { family in
                row(.family(family), label: family)
            }
        }
        .searchable(text: $query)
        .navigationTitle(title)
        .onAppear { families = FontLibrary.availableFamilies() }
    }

    private var filtered: [String] {
        query.isEmpty ? families : families.filter { $0.localizedCaseInsensitiveContains(query) }
    }

    private func row(_ choice: FontChoice, label: String) -> some View {
        Button {
            selection = choice
            dismiss()
        } label: {
            HStack {
                Text(label).font(font(choice))
                Spacer()
                if choice == selection {
                    Image(systemName: "checkmark").foregroundStyle(Theme.accent)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func font(_ choice: FontChoice) -> Font {
        switch choice {
        case .system: .system(.body, design: design)
        case .family(let family): .custom(family, size: 16, relativeTo: .body)
        }
    }
}
