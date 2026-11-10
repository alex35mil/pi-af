import PitonKit
import SwiftUI

/// The Logging settings section. On the phone it's local and works while disconnected. On the Mac it switches the
/// daemon's host level (Mac app, daemon, phone-log collector) until it expires or the daemon restarts; the default is
/// `[logging] mode` in the daemon's config.toml.
public struct LoggingSettings: View {
    public enum Scope {
        /// This device's own capture (the phone).
        case device
        /// The Mac's host level, through the daemon.
        case host(Store)
    }

    private enum Selection: String, CaseIterable, Identifiable {
        case info = "Info"
        case hour = "Debug for one hour"
        case manual = "Debug until disabled"
        var id: Self { self }
    }

    private enum Action {
        case configure(LoggingPolicy)
        case clear
    }

    private enum Activity: Equatable {
        case ready
        case saving
        case failed(String)
    }

    let scope: Scope
    @State private var devicePolicy: LoggingPolicy = .info
    @State private var activity: Activity = .ready

    public init(scope: Scope) {
        self.scope = scope
    }

    /// The policy shown: the daemon's (nil while not connected) or this device's.
    private var policy: LoggingPolicy? {
        switch scope {
        case .device: devicePolicy
        case .host(let store): store.daemon?.logging.policy
        }
    }

    public var body: some View {
        Form {
            // Descriptions sit in the row under its title, as in System Settings.
            Section {
                Picker(selection: selection) {
                    ForEach(Selection.allCases) { Text($0.rawValue).tag($0) }
                } label: {
                    Text("Level")
                    Text(levelDescription)
                }
                .disabled(disabled)
            }
            Section {
                LabeledContent {
                    Button("Clear…", role: .destructive) {
                        change(.clear)
                    }
                } label: {
                    Text("Log Files")
                    Text(
                        "Info keeps essential events in Apple logs and bounded files; Debug adds detailed traces. Files are capped at 10 MB. No message contents or credentials are recorded. Clearing doesn't change the level or remove copies collected on the Mac."
                    )
                }
            }
            switch activity {
            case .ready: EmptyView()
            case .saving: ProgressView()
            case .failed(let message): Text(message).foregroundStyle(.red)
            }
        }
        .formStyle(.grouped)
        .navigationTitle("Logging")
        .task {
            switch scope {
            case .host: return
            case .device: break
            }
            while !Task.isCancelled {
                devicePolicy = AppLogging.shared.policy
                try? await Task.sleep(for: .seconds(2))
            }
        }
    }

    private var disabled: Bool {
        switch (activity, policy) {
        case (.saving, _), (_, nil): true
        case (.ready, .some), (.failed, .some): false
        }
    }

    /// What the level applies to, plus when a timed Debug ends.
    private var levelDescription: String {
        let scopeText =
            switch scope {
            case .device:
                "Applies to this device, even while disconnected. Switch the Mac to Debug as well to collect these files automatically when the paired device is reachable."
            case .host(let store):
                switch store.daemon?.logging.default {
                case nil:
                    "Not connected to piton."
                case .some(let mode):
                    "Applies to this Mac's app, daemon, and phone-log collector, until it expires or the daemon restarts. The default is \(mode.rawValue.capitalized), set by [logging] mode in piton's config.toml. No sessions restart."
                }
            }
        switch policy {
        case .info, .debug(.manual), nil:
            return scopeText
        case .debug(.until(let deadline)):
            let time = Date(timeIntervalSince1970: Double(deadline) / 1000).formatted(date: .omitted, time: .shortened)
            return "Returns to the default at \(time). " + scopeText
        }
    }

    private var selection: Binding<Selection> {
        Binding(
            get: {
                switch policy {
                case .info, nil: .info
                case .debug(.until): .hour
                case .debug(.manual): .manual
                }
            },
            set: { selected in
                let next: LoggingPolicy =
                    switch selected {
                    case .info: .info
                    case .hour: .forOneHour()
                    case .manual: .debug(expiration: .manual)
                    }
                change(.configure(next))
            })
    }

    private func change(_ action: Action) {
        activity = .saving
        Task {
            activity = await perform(action)
            devicePolicy = AppLogging.shared.policy
        }
    }

    private func perform(_ action: Action) async -> Activity {
        switch (action, scope) {
        case (.configure(let policy), .host(let store)):
            return await store.setHostLogging(policy) ? .ready : .failed("Couldn't reach piton.")
        case (.configure(let policy), .device):
            return await storage { () async throws(AppLogging.LoggingError) in
                try await AppLogging.shared.setPolicy(policy)
            }
        case (.clear, .host), (.clear, .device):
            return await storage { () async throws(AppLogging.LoggingError) in try await AppLogging.shared.clear() }
        }
    }

    private func storage(_ body: () async throws(AppLogging.LoggingError) -> Void) async -> Activity {
        do throws(AppLogging.LoggingError) {
            try await body()
            return .ready
        } catch {
            switch error {
            case .storage(let code): return .failed("Couldn't update log files (error \(code)).")
            case .hostControlled: return .failed("Logging on this Mac is switched through piton.")
            }
        }
    }
}
