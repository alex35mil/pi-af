import Foundation

/// A `view` connection to the daemon: request/reply, the session list, and watched sessions.
///
/// One `Connection` is one transport. When it drops, `events` finishes; make a new connection and re-watch each
/// session with `watch(_:from:)` using the model's `seq`, which gets the missed changes or a fresh snapshot.
public actor Connection {
    public enum Event: Sendable, Hashable {
        /// The session list (after `subscribeSessions`, then on every change).
        case sessions([SessionInfo])
        /// Daemon-wide state (after `subscribeSessions`, then on every change).
        case daemon(DaemonState)
        /// A watched session's model changed.
        case session(SessionModel)
        /// A watched session's stream had a gap or an unknown item; it's being re-watched for a snapshot.
        case resyncing(SessionKey)
    }

    public enum RequestError: Error, Equatable, CustomStringConvertible {
        /// The daemon refused the request.
        case refused(String)
        /// The connection closed before the reply.
        case disconnected
        case badReply(String)

        public var description: String {
            switch self {
            case .refused(let message): message
            case .disconnected: "disconnected from piton"
            case .badReply(let detail): "unexpected reply: \(detail)"
            }
        }
    }

    private let transport: any Transport
    private let diagnostics: Diagnostics
    private var nextID = 0
    private var waiting: [RequestID: CheckedContinuation<JSON, Error>] = [:]
    /// When each waiting request was made, for the reply's latency in diagnostics.
    private var sentAt: [RequestID: ContinuousClock.Instant] = [:]
    private var models: [SessionKey: SessionModel] = [:]
    private var limits: [SessionKey: Int] = [:]
    private var finished = false
    private let continuation: AsyncStream<Event>.Continuation
    public nonisolated let events: AsyncStream<Event>
    /// Requests in the order they were made, written by one task: separate writes could reach the daemon in any order,
    /// and two messages to pi would then arrive swapped.
    private let outgoing: AsyncStream<(id: RequestID, line: Data)>.Continuation

    /// Opens a connection over `transport` and sends the hello. `client` names this client in the daemon's log.
    public init(transport: any Transport, client: String, diagnosticID: String = UUID().uuidString) async throws {
        self.transport = transport
        diagnostics = Diagnostics(id: diagnosticID)
        let (events, continuation) = AsyncStream<Event>.makeStream()
        self.events = events
        self.continuation = continuation
        let (lines, outgoing) = AsyncStream<(id: RequestID, line: Data)>.makeStream()
        self.outgoing = outgoing
        diagnostics.record("rpc.hello_sending")
        try await transport.send(JSONEncoder().encode(viewHello(client: client)))
        diagnostics.record("rpc.hello_sent")
        Task { await self.readLoop() }
        Task { await self.writeLoop(lines) }
    }

    /// Checks that the daemon still answers; a dead connection is closed and `events` finishes.
    public func probe(within timeout: Duration, reason: String) async -> Bool {
        await transport.probe(within: timeout, reason: reason)
    }

    public func close() async {
        diagnostics.record("rpc.close_requested pending_requests=\(waiting.count)")
        await transport.close()
    }

    // MARK: Requests

    /// Sends `request` and waits for its reply's data.
    @discardableResult
    public func send(_ request: Request) async throws -> JSON {
        guard !finished else { throw RequestError.disconnected }
        nextID += 1
        let id = "c\(nextID)"
        let json = request.json(id: id)
        let line = try JSONEncoder().encode(json)
        let started = ContinuousClock.now
        // Only the request type: other fields can carry message text or paths.
        let type = json["type"]?.string ?? "unknown"
        diagnostics.record("rpc.request id=\(id) type=\(type)")
        return try await withCheckedThrowingContinuation { continuation in
            waiting[.string(id)] = continuation
            sentAt[.string(id)] = started
            outgoing.yield((.string(id), line))
        }
    }

    private func writeLoop(_ lines: AsyncStream<(id: RequestID, line: Data)>) async {
        for await (id, line) in lines {
            do {
                try await transport.send(line)
                diagnostics.record("rpc.written id=\(Self.name(id))")
            } catch {
                diagnostics.record("rpc.write_failed request=\(Self.name(id)) error=\(Diagnostics.failure(error))")
                fail(id, with: RequestError.disconnected)
            }
        }
    }

    public func sessions() async throws -> [SessionInfo] {
        try decode(try await send(.sessionsList)["sessions"], as: [SessionInfo].self)
    }

    public func subscribeSessions() async throws {
        try await send(.sessionsSubscribe)
    }

    /// Turns keep-awake on or off until the daemon restarts; returns the new state.
    @discardableResult
    public func setKeepAwake(_ on: Bool) async throws -> DaemonState {
        try decode(try await send(.daemonKeepAwake(on))["state"], as: DaemonState.self)
    }

    /// Switches host logging until the policy expires or the daemon restarts; returns the new state.
    @discardableResult
    public func setLogging(_ policy: LoggingPolicy) async throws -> DaemonState {
        try decode(try await send(.daemonLogging(policy))["state"], as: DaemonState.self)
    }

    /// One level of the daemon's workspace roots (the roots when `path` is nil).
    public func browse(_ path: String? = nil) async throws -> [WorkspaceEntry] {
        try decode(try await send(.workspacesBrowse(path: path))["entries"], as: [WorkspaceEntry].self)
    }

    public func start(workspace: String, mode: LaunchMode = .sandbox, prompt: String? = nil) async throws -> SessionInfo
    {
        try decode(
            try await send(.sessionStart(workspace: workspace, mode: mode, prompt: prompt))["session"],
            as: SessionInfo.self)
    }

    /// Watches a session. With `from` (a model's `seq` from an earlier connection) the daemon sends only the missed
    /// changes when it still has them.
    public func watch(_ session: SessionKey, from: UInt64? = nil, limit: Int? = nil) async throws {
        limits[session] = limit
        if models[session] == nil || from == nil {
            models[session] = SessionModel(session: session)
        }
        try await send(.sessionWatch(session, from: from, limit: limit))
    }

    /// Re-watches with a model carried over from an earlier connection.
    public func resume(_ model: SessionModel, limit: Int? = nil) async throws {
        limits[model.session] = limit
        models[model.session] = model
        try await send(.sessionWatch(model.session, from: model.awaitingSnapshot ? nil : model.seq, limit: limit))
    }

    public func unwatch(_ session: SessionKey) async throws {
        models[session] = nil
        try await send(.sessionUnwatch(session))
    }

    public func model(_ session: SessionKey) -> SessionModel? {
        models[session]
    }

    /// Loads older items into the watched model.
    public func loadEarlier(_ session: SessionKey, limit: Int? = nil) async throws {
        guard let first = models[session]?.items.first else { return }
        let history = try decode(
            try await send(.sessionHistory(session, before: first.id, limit: limit)), as: History.self)
        models[session]?.prepend(history)
        if let model = models[session] { continuation.yield(.session(model)) }
    }

    public func toolOutput(_ session: SessionKey, callID: String) async throws -> JSON {
        try await send(.sessionToolOutput(session, callID: callID))
    }

    public func image(_ session: SessionKey, id: ImageID) async throws -> ImageData {
        try decode(try await send(.sessionImage(session, image: id)), as: ImageData.self)
    }

    /// Sends a message. Repeating it with the same `id` (after a lost reply) reaches pi only once.
    public func sendMessage(
        _ session: SessionKey, text: String, mode: SendMode = .prompt, id: String = UUID().uuidString
    ) async throws {
        try await send(.sessionSend(session, messageID: id, text: text, mode: mode))
    }

    public func abort(_ session: SessionKey) async throws {
        try await send(.sessionAbort(session))
    }

    public func answer(_ session: SessionKey, dialog: String, with answer: DialogAnswer) async throws {
        try await send(.sessionAnswer(session, requestID: dialog, answer: answer))
    }

    public func stop(_ session: SessionKey) async throws {
        try await send(.sessionStop(session))
    }

    // MARK: Incoming

    private func readLoop() async {
        let decoder = JSONDecoder()
        do {
            for try await line in transport.lines {
                let incoming: Incoming
                do {
                    incoming = try decoder.decode(Incoming.self, from: line)
                } catch {
                    // Do not log the decoding error: it can include daemon-provided content.
                    diagnostics.record("rpc.decode_failed bytes=\(line.count)")
                    // A line this client can't read (newer daemon): fail loudly in debug builds, skip otherwise.
                    assertionFailure("undecodable line from piton: \(error)")
                    continue
                }
                handle(incoming)
            }
        } catch {
            diagnostics.record("rpc.read_failed error=\(Diagnostics.failure(error))")
        }
        diagnostics.record("rpc.stream_ended pending_requests=\(waiting.count)")
        finish()
    }

    private func handle(_ incoming: Incoming) {
        switch incoming {
        case .reply(.ok(let id, let data)):
            recordReply(id, ok: true)
            waiting.removeValue(forKey: id)?.resume(returning: data)
        case .reply(.failed(let id, let error)):
            recordReply(id, ok: false)
            waiting.removeValue(forKey: id)?.resume(throwing: RequestError.refused(error))
        case .sessions(let list):
            continuation.yield(.sessions(list))
        case .daemon(let state):
            continuation.yield(.daemon(state))
        case .snapshot(let snapshot):
            diagnostics.record(
                "watch.snapshot_received session=\(snapshot.session) seq=\(snapshot.seq) items=\(snapshot.items.count)")
            guard var model = models[snapshot.session] else { return }
            do {
                try model.apply(snapshot)
                models[snapshot.session] = model
                continuation.yield(.session(model))
            } catch {
                resync(snapshot.session)
            }
        case .change(let line):
            guard var model = models[line.session] else { return }
            // Before its first snapshot (or after a reset) a model takes nothing but the snapshot.
            guard !model.awaitingSnapshot else { return }
            do {
                try model.apply(line)
                models[line.session] = model
                continuation.yield(.session(model))
            } catch {
                resync(line.session)
            }
        }
    }

    /// A gap or an unknown item: drop the model and ask for a fresh snapshot.
    private func resync(_ session: SessionKey) {
        diagnostics.record("watch.resync session=\(session) seq=\(models[session]?.seq ?? 0)")
        models[session] = SessionModel(session: session)
        continuation.yield(.resyncing(session))
        let limit = limits[session] ?? nil
        Task { try? await self.send(.sessionWatch(session, from: nil, limit: limit)) }
    }

    private func recordReply(_ id: RequestID, ok: Bool) {
        let elapsed = sentAt.removeValue(forKey: id).map { "\($0.duration(to: .now))" } ?? "unknown"
        diagnostics.record("rpc.reply id=\(Self.name(id)) ok=\(ok) elapsed=\(elapsed)")
    }

    private static func name(_ id: RequestID) -> String {
        switch id {
        case .string(let s): s
        case .number(let n): String(n)
        }
    }

    private func fail(_ id: RequestID, with error: Error) {
        sentAt[id] = nil
        waiting.removeValue(forKey: id)?.resume(throwing: error)
    }

    private func finish() {
        finished = true
        for continuation in waiting.values { continuation.resume(throwing: RequestError.disconnected) }
        waiting.removeAll()
        sentAt.removeAll()
        continuation.finish()
        outgoing.finish()
    }

    private func decode<T: Decodable>(_ value: JSON?, as type: T.Type) throws -> T {
        guard let value else { throw RequestError.badReply("missing data for \(T.self)") }
        do {
            return try value.decode(type)
        } catch {
            throw RequestError.badReply("\(T.self): \(error)")
        }
    }
}
