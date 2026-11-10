import Foundation
import Network
import Observation

/// Where the app reaches the daemon.
public enum Endpoint: Sendable, Hashable, Codable {
    /// The daemon's Unix socket (the macOS app on the same Mac).
    case local(socket: String)
    /// The tailnet WebSocket (`ws://<mac>:7357`), for the phone and other devices.
    case remote(url: URL)

    /// The daemon's socket. Fixed: the daemon's `socket` setting is an override for tests and development, and a daemon
    /// using another socket runs without the Mac app (docs/daemon.md).
    public static var defaultLocal: Endpoint {
        .local(socket: NSHomeDirectory() + "/.local/state/piton/piton.sock")
    }

    func transport(diagnosticID: String) async throws -> any Transport {
        switch self {
        case .local(let socket): try UnixSocketTransport(path: socket)
        case .remote(let url): try await WebSocketTransport.connect(to: url, diagnosticID: diagnosticID)
        }
    }

    public var label: String {
        switch self {
        case .local: "This Mac"
        case .remote(let url): url.host() ?? url.absoluteString
        }
    }
}

/// The app's state: one connection to the daemon, the session list, and the sessions being watched. Reconnects with
/// backoff when the connection drops, resuming every watched session from its last `seq`.
@MainActor
@Observable
public final class Store {
    public enum Link: Sendable, Equatable {
        case connecting
        case connected
        /// Waiting before the next attempt; `error` is why the last one failed.
        case retrying(error: String, attempt: Int)
    }

    public private(set) var link: Link = .connecting
    public private(set) var sessions: [SessionInfo] = []
    /// Daemon-wide state (keep-awake); nil until the daemon sends it.
    public private(set) var daemon: DaemonState?
    /// Models of watched sessions, by key.
    public private(set) var models: [SessionKey: SessionModel] = [:]
    /// The last failed request, for the UI to show.
    public var lastError: String?
    /// Messages not yet confirmed by the daemon, oldest first. A message leaves the outbox when the daemon accepts it
    /// (it then appears in the conversation); see `send`.
    public private(set) var outbox: [Outgoing] = []

    public let endpoint: Endpoint
    private let client: String
    private var connection: Connection?
    /// How many screens are watching each session. SwiftUI can show a new screen (watch) before it removes the old
    /// one (unwatch) for the same session, so a set would drop the newer screen's watch.
    private var watchers: [SessionKey: Int] = [:]
    private var watched: Dictionary<SessionKey, Int>.Keys { watchers.keys }
    private var runner: Task<Void, Never>?
    private let diagnostics = Diagnostics()
    private var pathMonitor: NWPathMonitor?
    /// A connection check in flight (`verifyConnection`), so overlapping triggers send one ping.
    private var verifying: Task<Void, Never>?
    /// How long a connection check waits for the daemon: a live tailnet answers in milliseconds.
    static let verifyTimeout: Duration = .seconds(2)

    public init(endpoint: Endpoint, client: String) {
        self.endpoint = endpoint
        self.client = client
    }

    /// Starts connecting (and keeps reconnecting) until `stop`.
    public func start() {
        guard runner == nil else { return }
        diagnostics.record("store.start")
        let monitor = NWPathMonitor()
        let diagnostics = diagnostics
        monitor.pathUpdateHandler = { [weak self] path in
            // Status/interface types only: no IP addresses, Wi-Fi names, or endpoint URLs.
            let interfaces = path.availableInterfaces.filter { path.usesInterfaceType($0.type) }
                .map { String(describing: $0.type) }.joined(separator: ",")
            diagnostics.record(
                "network.path status=\(path.status) interfaces=\(interfaces) expensive=\(path.isExpensive) constrained=\(path.isConstrained)"
            )
            // A network change (Wi-Fi to cellular, a VPN or proxy switching) can leave the connection dead while
            // writes still seem to succeed. The first update is the current path, not a change.
            let signature = "\(path.status) \(interfaces)"
            Task { @MainActor in self?.networkChanged(to: signature) }
        }
        monitor.start(queue: DispatchQueue(label: "piton.network-diagnostics"))
        pathMonitor = monitor
        runner = Task { [weak self] in await self?.run() }
    }

    public func stop() {
        diagnostics.record("store.stop")
        pathMonitor?.cancel()
        pathMonitor = nil
        lastPath = nil
        verifying?.cancel()
        verifying = nil
        runner?.cancel()
        runner = nil
        let connection = connection
        self.connection = nil
        Task { await connection?.close() }
    }

    /// Makes sure the connection works, for when it may have died unnoticed: the app returning to the foreground (iOS
    /// suspends it in the background), or a network change. A connected store pings the daemon and reconnects when it
    /// doesn't answer within `verifyTimeout`, instead of waiting up to the regular ping interval plus its timeout
    /// while requests go nowhere. A store waiting to retry retries now.
    public func verifyConnection(reason: String) {
        guard runner != nil, verifying == nil else { return }
        switch link {
        case .connecting:
            return
        case .retrying:
            diagnostics.record("store.retry_now reason=\(reason)", detail: .info)
            stop()
            start()
        case .connected:
            guard let connection else { return }
            verifying = Task { [weak self] in
                let started = ContinuousClock.now
                let alive = await connection.probe(within: Self.verifyTimeout, reason: reason)
                self?.diagnostics.record(
                    "store.verified reason=\(reason) alive=\(alive) elapsed=\(started.duration(to: .now))",
                    detail: .info)
                self?.verifying = nil
            }
        }
    }

    /// The last network path seen (status and interfaces), to tell a change from a repeat.
    private var lastPath: String?

    private func networkChanged(to path: String) {
        defer { lastPath = path }
        guard let lastPath, lastPath != path else { return }
        verifyConnection(reason: "network")
    }

    // MARK: Sessions

    /// Watch and unwatch requests, in the order screens made them. Separate tasks could reach the daemon in any
    /// order: "watch" before an earlier "unwatch" leaves a screen waiting for a snapshot that never comes.
    private var subscriptions: Task<Void, Never>?

    private func enqueue(_ label: String, _ request: @escaping @MainActor (Connection) async throws -> Void) {
        let previous = subscriptions
        let queued = ContinuousClock.now
        let diagnostics = diagnostics
        diagnostics.record("subscription.queued \(label) behind_previous=\(previous != nil)")
        subscriptions = Task { [weak self] in
            await previous?.value
            // No connection: `run` re-watches every watched session when it reconnects.
            guard let self, let connection = self.connection else {
                diagnostics.record("subscription.deferred \(label) reason=no_connection")
                return
            }
            diagnostics.record("subscription.started \(label) waited=\(queued.duration(to: .now))")
            let ok = await self.attempt { try await request(connection) }
            diagnostics.record("subscription.finished \(label) ok=\(ok) elapsed=\(queued.duration(to: .now))")
        }
    }

    /// A screen starts showing `session`. Balanced by `unwatch` when it goes away.
    public func watch(_ session: SessionKey) {
        let count = watchers[session, default: 0]
        watchers[session] = count + 1
        diagnostics.record("watch.requested session=\(session) watchers=\(count + 1) connected=\(connection != nil)")
        // Already watched by another screen: it shares the model.
        guard count == 0 else { return }
        enqueue("watch session=\(session)") { try await $0.watch(session, from: nil) }
    }

    /// A screen stops showing `session`; the daemon stops sending it when no screen shows it.
    public func unwatch(_ session: SessionKey) {
        guard let count = watchers[session] else { return }
        guard count <= 1 else {
            watchers[session] = count - 1
            return
        }
        watchers[session] = nil
        models[session] = nil
        enqueue("unwatch session=\(session)") { try await $0.unwatch(session) }
    }

    /// Forgets a session that ended or that the daemon refused, whoever was watching it.
    private func forget(_ session: SessionKey) {
        watchers[session] = nil
        models[session] = nil
        for index in outbox.indices where outbox[index].session == session && outbox[index].state == .sending {
            outbox[index].state = .failed("the session ended")
        }
    }

    /// A message the user sent that the daemon hasn't confirmed.
    public struct Outgoing: Sendable, Identifiable, Equatable {
        public enum State: Sendable, Equatable {
            /// On its way, or waiting for the connection to come back; it's re-sent then.
            case sending
            /// The daemon or pi refused it. `retry` sends it again; `discard` drops it.
            case failed(String)
        }

        /// Also the message's id on the wire: the daemon passes a message to pi once, however often it's sent.
        public let id: String
        public let session: SessionKey
        public let text: String
        public let mode: SendMode
        public internal(set) var state: State
    }

    /// The outbox's messages for `session`.
    public func outbox(for session: SessionKey) -> [Outgoing] {
        outbox.filter { $0.session == session }
    }

    /// Sends a message. It waits in the outbox until the daemon confirms it. When the connection drops before the
    /// reply, the message may or may not have reached pi: it's sent again with the same id after reconnecting, and the
    /// daemon passes it on only if it hadn't.
    public func send(_ session: SessionKey, text: String, mode: SendMode = .prompt) {
        let message = Outgoing(id: UUID().uuidString, session: session, text: text, mode: mode, state: .sending)
        outbox.append(message)
        diagnostics.record(
            "outbox.queued message=\(message.id) session=\(session) mode=\(mode.rawValue)", detail: .info)
        deliverOutbox()
    }

    /// Sends a failed message again.
    public func retry(_ message: Outgoing.ID) {
        guard let index = outbox.firstIndex(where: { $0.id == message }) else { return }
        outbox[index].state = .sending
        deliverOutbox()
    }

    public func discard(_ message: Outgoing.ID) {
        outbox.removeAll { $0.id == message }
    }

    /// The task sending the outbox, if one is running.
    private var delivering: Task<Void, Never>?

    /// Sends the outbox's messages one at a time, oldest first, each after the previous one's reply, so pi gets them
    /// in the order the user wrote them. Stops when the connection drops; `run` starts it again after reconnecting.
    private func deliverOutbox() {
        guard delivering == nil else { return }
        delivering = Task { [weak self] in
            while let self, let connection = self.connection,
                let message = self.outbox.first(where: { $0.state == .sending })
            {
                let delivered = await self.deliver(message, over: connection)
                // A connection that dropped meanwhile may already have been replaced: carry on over the new one.
                if !delivered && self.connection === connection { break }
            }
            self?.delivering = nil
        }
    }

    /// Sends one message; false when the connection dropped before the reply.
    private func deliver(_ message: Outgoing, over connection: Connection) async -> Bool {
        let id = message.id
        do {
            diagnostics.record("outbox.sending message=\(id)")
            try await connection.sendMessage(message.session, text: message.text, mode: message.mode, id: id)
            diagnostics.record("outbox.confirmed message=\(id)", detail: .info)
            discard(id)
            return true
        } catch Connection.RequestError.disconnected {
            // Unknown whether it reached pi; it's sent again with the same id after reconnecting.
            diagnostics.record("outbox.unconfirmed message=\(id)", detail: .info)
            return false
        } catch {
            diagnostics.record("outbox.failed message=\(id) error=\(Diagnostics.failure(error))", detail: .info)
            if let index = outbox.firstIndex(where: { $0.id == id }) {
                outbox[index].state = .failed(String(describing: error))
            }
            return true
        }
    }

    public func abort(_ session: SessionKey) async -> Bool {
        await attempt { try await self.require().abort(session) }
    }

    public func answer(_ session: SessionKey, dialog: String, with answer: DialogAnswer) async -> Bool {
        await attempt { try await self.require().answer(session, dialog: dialog, with: answer) }
    }

    /// Turns keep-awake on or off until the daemon restarts.
    public func setKeepAwake(_ on: Bool) async -> Bool {
        do {
            daemon = try await require().setKeepAwake(on)
            return true
        } catch {
            lastError = String(describing: error)
            return false
        }
    }

    /// Switches host logging until the policy expires or the daemon restarts.
    public func setHostLogging(_ policy: LoggingPolicy) async -> Bool {
        do {
            daemon = try await require().setLogging(policy)
            return true
        } catch {
            lastError = String(describing: error)
            return false
        }
    }

    public func stopSession(_ session: SessionKey) async -> Bool {
        await attempt { try await self.require().stop(session) }
    }

    /// Starts a session; returns its key.
    public func startSession(workspace: String, mode: LaunchMode, prompt: String?) async -> SessionKey? {
        do {
            let info = try await require().start(workspace: workspace, mode: mode, prompt: prompt)
            return info.key
        } catch {
            lastError = String(describing: error)
            return nil
        }
    }

    /// One level of the daemon's workspace roots. Throws when the daemon refuses (for example, no roots configured)
    /// or isn't connected; the error describes why.
    public func browse(_ path: String?) async throws -> [WorkspaceEntry] {
        try await require().browse(path)
    }

    public func loadEarlier(_ session: SessionKey) async {
        await attempt { try await self.require().loadEarlier(session) }
    }

    public func toolOutput(_ session: SessionKey, callID: String) async -> JSON? {
        do {
            return try await require().toolOutput(session, callID: callID)
        } catch {
            lastError = String(describing: error)
            return nil
        }
    }

    /// One image's data. Screens keep what they fetched (see PitonUI's ImageLibrary).
    public func image(_ session: SessionKey, id: ImageID) async -> ImageData? {
        do {
            return try await require().image(session, id: id)
        } catch {
            lastError = String(describing: error)
            return nil
        }
    }

    // MARK: Connection

    private func require() throws -> Connection {
        guard let connection else { throw Connection.RequestError.disconnected }
        return connection
    }

    @discardableResult
    private func attempt(_ body: () async throws -> Void) async -> Bool {
        do {
            try await body()
            return true
        } catch {
            lastError = String(describing: error)
            return false
        }
    }

    private func run() async {
        var attempt = 0
        while !Task.isCancelled {
            link = .connecting
            let trace = Diagnostics()
            let started = ContinuousClock.now
            let kind =
                switch endpoint {
                case .local: "local"
                case .remote: "remote"
                }
            trace.record(
                "connect.begin store=\(diagnostics.id) attempt=\(attempt + 1) transport=\(kind)", detail: .info)
            do {
                let connection = try await Connection(
                    transport: try await endpoint.transport(diagnosticID: trace.id), client: client,
                    diagnosticID: trace.id)
                trace.record("connect.transport_ready elapsed=\(started.duration(to: .now))")
                self.connection = connection
                attempt = 0
                link = .connected
                trace.record("connect.subscribing")
                try await connection.subscribeSessions()
                trace.record("connect.subscribed elapsed=\(started.duration(to: .now))", detail: .info)
                // Resume what was watched before the drop: missed changes, or a snapshot. A session that ended
                // meanwhile (for example the daemon restarted) is refused: forget it, don't fail the connection.
                for key in Array(watched) {
                    do {
                        if let model = models[key] {
                            trace.record("watch.resume session=\(key) seq=\(model.seq)")
                            try await connection.resume(model)
                        } else {
                            trace.record("watch.snapshot session=\(key)")
                            try await connection.watch(key)
                        }
                    } catch Connection.RequestError.refused {
                        trace.record("watch.refused session=\(key)")
                        forget(key)
                    }
                }
                // Messages whose reply the drop lost (or sent while disconnected): again, with the same ids.
                deliverOutbox()
                for await event in connection.events {
                    apply(event)
                }
                trace.record(
                    "connect.ended elapsed=\(started.duration(to: .now)) cancelled=\(Task.isCancelled)",
                    detail: .info)
                self.connection = nil
                if Task.isCancelled { return }
                link = .retrying(error: "connection lost", attempt: 1)
            } catch {
                trace.record(
                    "connect.failed elapsed=\(started.duration(to: .now)) error=\(Diagnostics.failure(error)) cancelled=\(Task.isCancelled)",
                    detail: .info)
                self.connection = nil
                if Task.isCancelled { return }
                attempt += 1
                link = .retrying(error: String(describing: error), attempt: attempt)
            }
            // 0.5 s, 1 s, 2 s, ... up to 15 s.
            let delay = min(15.0, 0.5 * pow(2.0, Double(max(attempt - 1, 0))))
            trace.record("connect.retry_scheduled delay_seconds=\(delay)")
            try? await Task.sleep(for: .seconds(delay))
        }
    }

    private func apply(_ event: Connection.Event) {
        switch event {
        case .sessions(let list):
            sessions = list.sorted(by: Self.order)
            // A watched session that ended disappears from the list.
            let live = Set(list.map(\.key))
            for key in Array(watched) where !live.contains(key) {
                forget(key)
            }
        case .session(let model):
            guard watchers[model.session] != nil else { return }
            if models[model.session] == nil {
                diagnostics.record(
                    "watch.model_shown session=\(model.session) seq=\(model.seq) items=\(model.items.count)")
            }
            models[model.session] = model
        case .daemon(let state):
            daemon = state
            #if os(macOS)
                // The Mac app's own file capture follows the host policy.
                AppLogging.shared.follow(state.logging.policy)
            #endif
        case .resyncing:
            break
        }
    }

    /// Needs-input first, then working, then idle; newest (highest key) first within each.
    nonisolated static func order(_ a: SessionInfo, _ b: SessionInfo) -> Bool {
        let (ra, rb) = (rank(a.status), rank(b.status))
        return ra != rb ? ra < rb : a.key > b.key
    }

    nonisolated static func rank(_ status: SessionStatus) -> Int {
        switch status {
        case .needsInput: 0
        case .working: 1
        case .idle: 2
        case .stopping: 3
        }
    }

    /// The sessions grouped by project: the project's own checkout first, then its workers by name; within each, in
    /// `order`. Projects come in the order of their most urgent session, then by name.
    public var projects: [ProjectGroup] {
        Self.group(sessions)
    }

    nonisolated static func group(_ sessions: [SessionInfo]) -> [ProjectGroup] {
        let byProject = Dictionary(grouping: sessions, by: \.project)
        let groups = byProject.map { path, sessions in
            let byCheckout = Dictionary(grouping: sessions, by: \.checkout)
            let checkouts = byCheckout.map { checkout, sessions in
                ProjectGroup.CheckoutGroup(
                    checkout: checkout, workspace: sessions[0].workspace, sessions: sessions.sorted(by: order))
            }
            .sorted { a, b in
                switch (a.checkout, b.checkout) {
                case (.source, .worker): true
                case (.worker, .source), (.source, .source): false
                case (.worker(_, let x), .worker(_, let y)): x < y
                }
            }
            return ProjectGroup(path: path, checkouts: checkouts)
        }
        return groups.sorted { a, b in
            let (ra, rb) = (a.urgency, b.urgency)
            return ra != rb ? ra < rb : a.name.localizedStandardCompare(b.name) == .orderedAscending
        }
    }
}

/// A project's live sessions: in its own checkout and in each of its workers.
public struct ProjectGroup: Sendable, Hashable, Identifiable {
    public struct CheckoutGroup: Sendable, Hashable, Identifiable {
        public let checkout: Checkout
        public let workspace: String
        public let sessions: [SessionInfo]
        public var id: String { workspace }
    }

    /// The project's checkout path.
    public let path: String
    public let checkouts: [CheckoutGroup]

    public var id: String { path }
    public var name: String { URL(fileURLWithPath: path).lastPathComponent }
    public var sessionCount: Int { checkouts.reduce(0) { $0 + $1.sessions.count } }

    /// The rank of the most urgent session (needs input first).
    var urgency: Int {
        checkouts.flatMap(\.sessions).map { Store.rank($0.status) }.min() ?? Int.max
    }
}
