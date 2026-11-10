import Foundation
import Testing

@testable import PitonKit

// PitonKit's Connection against a real daemon and real pi (faux model, host mode). Runs when PITON_BIN names a built piton
// binary: `mise run apps:e2e` (or `PITON_BIN=$PWD/daemon/target/debug/piton swift test` in apps/).

private let pitonBin = ProcessInfo.processInfo.environment["PITON_BIN"]

/// A daemon in a scratch directory, stopped when the test ends.
private final class Daemon: @unchecked Sendable {
    // @unchecked: `process` is replaced only by `restart`, which tests call from one task.
    let dir: URL
    let workspace: URL
    let socket: String
    let log: URL
    private var process = Process()
    private var environment: [String: String] = [:]

    init() throws {
        let tmp = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true).resolvingSymlinksInPath()
        dir = tmp.appendingPathComponent("pitonkit-\(UUID().uuidString.prefix(8))")
        // Native apps start sessions only in checkouts under a root.
        let root = dir.appendingPathComponent("Projects")
        workspace = root.appendingPathComponent("ws")
        let agent = dir.appendingPathComponent("agent")
        try FileManager.default.createDirectory(
            at: workspace.appendingPathComponent(".git"), withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: agent, withIntermediateDirectories: true)
        socket = dir.appendingPathComponent("piton.sock").path
        let fixtures = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()  // Tests
            .deletingLastPathComponent()  // PitonKit
            .deletingLastPathComponent()  // packages
            .deletingLastPathComponent()  // apps
            .deletingLastPathComponent()  // repo
            .appendingPathComponent("daemon/tests/fixtures")
        let ext = fixtures.appendingPathComponent("faux-extension.ts").path
        // The tailnet listener on loopback, with a fake `tailscale` that says the client is the owner's phone.
        let tailscale = fixtures.appendingPathComponent("fake-tailscale.sh").path
        let whois = dir.appendingPathComponent("whois.json")
        try
            #"{"Node":{"StableID":"iphone","Name":"iphone.tail.ts.net.","User":1},"UserProfile":{"ID":1,"LoginName":"me@example.com"}}"#
            .write(to: whois, atomically: true, encoding: .utf8)
        log = dir.appendingPathComponent("piton.log")
        let config = dir.appendingPathComponent("config.toml")
        try """
        socket = "\(socket)"
        log = "\(log.path)"
        attach_mode = "host"
        empty_grace_ms = 60000
        keep_awake = false
        roots = ["\(root.path)"]
        [pi]
        args = ["-e", "\(ext)", "--model", "faux/faux-1"]
        [env]
        login_shell = false
        mise = false
        [stop]
        grace_ms = 3000
        term_grace_ms = 1000
        [tailnet]
        port = 0
        cli = "\(tailscale)"
        """.write(to: config, atomically: true, encoding: .utf8)
        var env = ProcessInfo.processInfo.environment
        env["PITON_CONFIG"] = config.path
        env["PI_CODING_AGENT_DIR"] = agent.path
        env["PITON_FAUX_TPS"] = "40"
        env["PITON_FAKE_WHOIS"] = whois.path
        environment = env
        try launch()
    }

    private func launch() throws {
        process = Process()
        process.executableURL = URL(fileURLWithPath: pitonBin!)
        process.arguments = ["daemon"]
        process.environment = environment
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        try process.run()
    }

    /// Freezes the daemon: its connections stay open but nothing answers, like a connection that died behind a proxy.
    func freeze() { kill(process.processIdentifier, SIGSTOP) }
    func thaw() { kill(process.processIdentifier, SIGCONT) }

    /// Stops the daemon (ending its sessions) and starts it again with the same socket and pi agent dir.
    func restart() throws {
        process.terminate()
        process.waitUntilExit()
        try launch()
    }

    func connect(_ client: String) async throws -> Connection {
        let deadline = Date().addingTimeInterval(10)
        while true {
            do {
                return try await Connection(transport: try UnixSocketTransport(path: socket), client: client)
            } catch {
                if Date() > deadline { throw error }
                try await Task.sleep(for: .milliseconds(50))
            }
        }
    }

    /// The tailnet WebSocket's URL (on loopback here).
    func webSocketURL() async throws -> URL {
        let deadline = Date().addingTimeInterval(10)
        while true {
            let text = (try? String(contentsOf: log, encoding: .utf8)) ?? ""
            if let match = text.firstMatch(of: /tailnet: listening on 127\.0\.0\.1:(\d+)/) {
                return URL(string: "ws://127.0.0.1:\(match.1)")!
            }
            if Date() > deadline { throw CancellationError() }
            try await Task.sleep(for: .milliseconds(50))
        }
    }

    /// A connection over the tailnet WebSocket (on loopback here).
    func connectWebSocket(_ client: String) async throws -> Connection {
        let url = try await webSocketURL()
        return try await Connection(transport: try await WebSocketTransport.connect(to: url), client: client)
    }

    func stop() {
        process.terminate()
        process.waitUntilExit()
        try? FileManager.default.removeItem(at: dir)
    }
}

struct TimedOut: Error, CustomStringConvertible {
    let line: Int
    let state: String
    var description: String { "timed out waiting (line \(line)): \(state)" }
}

/// Polls a main-actor condition; on timeout, reports `state()`.
@MainActor
private func eventually(
    _ timeout: Duration = .seconds(20), line: Int = #line, state: @MainActor () -> String = { "" },
    _ condition: @MainActor () -> Bool
) async throws {
    let clock = ContinuousClock()
    let deadline = clock.now + timeout
    while !condition() {
        if clock.now > deadline { throw TimedOut(line: line, state: state()) }
        try await Task.sleep(for: .milliseconds(25))
    }
}

/// Waits for an event matching `predicate`.
private func next<T: Sendable>(
    _ events: AsyncStream<Connection.Event>, timeout: Duration = .seconds(20),
    _ predicate: @escaping @Sendable (Connection.Event) -> T?
) async throws -> T {
    try await withThrowingTaskGroup(of: T?.self) { group in
        group.addTask {
            for await event in events {
                if let value = predicate(event) { return value }
            }
            return nil
        }
        group.addTask {
            try await Task.sleep(for: timeout)
            return nil
        }
        let result = try await group.next() ?? nil
        group.cancelAll()
        guard let result else { throw CancellationError() }
        return result
    }
}

private func settledModel(_ key: SessionKey, where check: @escaping @Sendable (SessionModel) -> Bool)
    -> @Sendable (Connection.Event) -> SessionModel?
{
    { event in
        guard case .session(let model) = event, model.session == key, model.state?.status == .idle, check(model)
        else { return nil }
        return model
    }
}

private func assistantText(_ model: SessionModel) -> String? {
    for item in model.items.reversed() {
        if case .assistant(let message) = item, !message.streaming {
            return message.content.compactMap { $0["text"]?.string }.joined()
        }
    }
    return nil
}

@Suite(.enabled(if: pitonBin != nil, "set PITON_BIN to a built piton binary"), .serialized)
struct IntegrationTests {
    @Test func startStreamAndSettle() async throws {
        let daemon = try Daemon()
        defer { daemon.stop() }
        let connection = try await daemon.connect("pitonkit-test")
        try await connection.subscribeSessions()
        let session = try await connection.start(workspace: daemon.workspace.path, mode: .host)
        let listed = try await next(connection.events) { event -> [SessionInfo]? in
            guard case .sessions(let list) = event, list.contains(where: { $0.key == session.key }) else { return nil }
            return list
        }
        // The daemon reports the workspace as pi sees it: with symlinks resolved (/var -> /private/var).
        let realWorkspace = try #require(
            realpath(daemon.workspace.path, nil).map { p in
                defer { free(p) }
                return String(cString: p)
            })
        #expect(listed.first { $0.key == session.key }?.workspace == realWorkspace)

        try await connection.watch(session.key)
        try await connection.sendMessage(session.key, text: "slow 20")
        let model = try await next(connection.events, settledModel(session.key) { assistantText($0) != nil })
        #expect(assistantText(model) == (0..<20).map { "word\($0)" }.joined(separator: " "))
        #expect(model.state?.title == "slow 20")
        await connection.close()
    }

    @Test func dialogsAndTools() async throws {
        let daemon = try Daemon()
        defer { daemon.stop() }
        let connection = try await daemon.connect("pitonkit-test")
        let session = try await connection.start(workspace: daemon.workspace.path, mode: .host)
        try await connection.watch(session.key)
        try await connection.sendMessage(session.key, text: "ask")
        let dialog = try await next(connection.events) { event -> Dialog? in
            guard case .session(let model) = event, let dialog = model.state?.dialogs.first else { return nil }
            return dialog
        }
        #expect(dialog.method == .select)
        try await connection.answer(session.key, dialog: dialog.id, with: .value("beta"))
        await #expect(throws: Connection.RequestError.self) {
            try await connection.answer(session.key, dialog: dialog.id, with: .value("alpha"))
        }
        let model = try await next(
            connection.events,
            settledModel(session.key) { m in
                m.items.contains { if case .tool(let t) = $0 { t.status == .done } else { false } }
            })
        let tool = model.items.compactMap { if case .tool(let t) = $0 { t } else { nil } }.first
        #expect(tool?.preview == "picked beta")
        let output = try await connection.toolOutput(session.key, callID: tool!.callID)
        #expect(output["content"]?[0]?["text"]?.string == "picked beta")
        await connection.close()
    }

    @Test func resumeAfterADrop() async throws {
        let daemon = try Daemon()
        defer { daemon.stop() }
        var connection = try await daemon.connect("pitonkit-test")
        let session = try await connection.start(workspace: daemon.workspace.path, mode: .host, prompt: "first")
        try await connection.watch(session.key)
        let before = try await next(connection.events, settledModel(session.key) { assistantText($0) != nil })
        await connection.close()

        // Something happens while this client is away.
        let other = try await daemon.connect("other")
        try await other.sendMessage(session.key, text: "while away")
        try await Task.sleep(for: .seconds(1.5))

        connection = try await daemon.connect("pitonkit-test")
        try await connection.resume(before)
        let after = try await next(
            connection.events, settledModel(session.key) { assistantText($0) == "echo: while away" })
        // The resumed model equals what a fresh watcher gets.
        let fresh = try await daemon.connect("fresh")
        try await fresh.watch(session.key)
        let snapshot = try await next(fresh.events) { event -> SessionModel? in
            guard case .session(let m) = event, m.session == session.key else { return nil }
            return m
        }
        #expect(after.items == snapshot.items)
        #expect(after.seq == snapshot.seq)
        await connection.close()
        await other.close()
        await fresh.close()
    }

    @Test func refusalsAreTyped() async throws {
        let daemon = try Daemon()
        defer { daemon.stop() }
        let connection = try await daemon.connect("pitonkit-test")
        await #expect(throws: Connection.RequestError.refused("no live session 424242")) {
            try await connection.watch(424242)
        }
        await connection.close()
    }

    /// The phone's path: the same protocol over the tailnet WebSocket, sharing a session with a local client.
    @Test func overTheWebSocket() async throws {
        let daemon = try Daemon()
        defer { daemon.stop() }
        let local = try await daemon.connect("mac")
        let session = try await local.start(workspace: daemon.workspace.path, mode: .host, prompt: "from the mac")

        let phone = try await daemon.connectWebSocket("iphone")
        try await phone.subscribeSessions()
        // The title appears once the first prompt is in the conversation; the list is pushed again then.
        let listed = try await next(phone.events) { event -> SessionInfo? in
            guard case .sessions(let list) = event else { return nil }
            return list.first { $0.key == session.key && $0.title != nil }
        }
        #expect(listed.title == "from the mac")
        try await phone.watch(session.key)
        _ = try await next(phone.events, settledModel(session.key) { assistantText($0) == "echo: from the mac" })
        try await phone.sendMessage(session.key, text: "from the phone")
        let model = try await next(
            phone.events, settledModel(session.key) { assistantText($0) == "echo: from the phone" })
        #expect(model.items.count == 4)
        let log = try String(contentsOf: daemon.log, encoding: .utf8)
        #expect(log.contains("view client connected over the tailnet: iphone"))
        await phone.close()
        await local.close()
    }

    /// URLSession keeps its delegate even after a task fails, until invalidateAndCancel is called. Every failed
    /// reconnect used to retain a transport/session. Exercise the real Foundation ownership behavior, not just flags.
    @Test @MainActor func failedWebSocketReleasesItsSessionDelegate() async throws {
        let daemon = try Daemon()
        defer { daemon.stop() }
        let url = try await daemon.webSocketURL()
        try Data("not JSON".utf8).write(to: daemon.dir.appendingPathComponent("whois.json"))
        for _ in 0..<3 {
            var transport: WebSocketTransport? = WebSocketTransport(url: url)
            weak var released = transport
            await #expect(throws: WebSocketTransport.WebSocketError.self) {
                try await transport!.open()
            }
            transport = nil
            try await eventually(.seconds(5)) { released == nil }
        }
    }

    @Test @MainActor func closedWebSocketReleasesItsSessionDelegate() async throws {
        let daemon = try Daemon()
        defer { daemon.stop() }
        var transport: WebSocketTransport? = WebSocketTransport(url: try await daemon.webSocketURL())
        weak var released = transport
        try await transport!.open()
        await transport!.close()
        // Repeated terminal callbacks/close must be harmless.
        await transport!.close()
        transport = nil
        try await eventually(.seconds(5)) { released == nil }
    }

    /// The app's Store: list, watch, send, answer; reconnect after a daemon restart.
    @Test @MainActor func storeReconnects() async throws {
        let daemon = try Daemon()
        defer { daemon.stop() }
        let store = Store(endpoint: .local(socket: daemon.socket), client: "store-test")
        store.start()
        defer { store.stop() }
        let describe = { @MainActor in
            "link=\(store.link) sessions=\(store.sessions.map { "\($0.key):\($0.status):\($0.title ?? "-")" }) "
                + "models=\(store.models.mapValues { m in "\(m.state?.status as Any) items=\(m.items.count)" }) "
                + "error=\(store.lastError ?? "-")"
        }
        try await eventually(state: describe) { store.link == .connected }

        let key = try #require(
            await store.startSession(workspace: daemon.workspace.path, mode: .host, prompt: "hello store"))
        store.watch(key)
        try await eventually(state: describe) { store.models[key].flatMap(assistantText) == "echo: hello store" }
        try await eventually(state: describe) { store.sessions.first { $0.key == key }?.title == "hello store" }

        store.send(key, text: "ask")
        try await eventually(state: describe) { store.models[key]?.state?.dialogs.isEmpty == false }
        #expect(store.outbox.isEmpty, "confirmed messages leave the outbox")
        let dialog = try #require(store.models[key]?.state?.dialogs.first)
        #expect(await store.answer(key, dialog: dialog.id, with: .value("alpha")))
        try await eventually(state: describe) {
            store.models[key]?.state?.status == .idle && store.models[key]?.state?.dialogs.isEmpty == true
        }

        // The daemon restarts: its sessions end, the store reconnects and sees an empty list.
        try daemon.restart()
        try await eventually(state: describe) { if case .retrying = store.link { true } else { false } }
        try await eventually(state: describe) { store.link == .connected }
        try await eventually(state: describe) { store.sessions.isEmpty && store.models[key] == nil }
        // And it works again.
        let again = try #require(
            await store.startSession(workspace: daemon.workspace.path, mode: .host, prompt: "after restart"))
        store.watch(again)
        try await eventually { store.models[again].flatMap(assistantText) == "echo: after restart" }
    }

    /// A message sent while disconnected waits in the outbox and goes out once the store reconnects; a message the
    /// daemon refuses stays there as failed until retried or discarded.
    @Test @MainActor func outboxSurvivesADrop() async throws {
        let daemon = try Daemon()
        defer { daemon.stop() }
        let local = try await daemon.connect("seed")
        let session = try await local.start(workspace: daemon.workspace.path, mode: .host)
        let store = Store(endpoint: .local(socket: daemon.socket), client: "outbox")
        store.start()
        defer { store.stop() }
        try await eventually { store.link == .connected }
        store.watch(session.key)
        try await eventually { store.models[session.key]?.awaitingSnapshot == false }

        // Disconnected: the message waits.
        store.stop()
        store.send(session.key, text: "while offline")
        try await Task.sleep(for: .milliseconds(300))
        #expect(store.outbox.map(\.state) == [.sending])
        store.start()
        try await eventually(
            state: { "\(store.outbox)" },
            { store.outbox.isEmpty && store.models[session.key].flatMap(assistantText) == "echo: while offline" })
        let users = store.models[session.key]?.items.filter { if case .user = $0 { true } else { false } }
        #expect(users?.count == 1, "sent once")

        // Several messages written quickly reach pi in the order they were written.
        for text in ["slow 20", "second", "third"] { store.send(session.key, text: text) }
        try await eventually(
            state: { "\(store.outbox)" },
            { store.outbox.isEmpty && store.models[session.key].flatMap(assistantText) == "echo: third" })
        let texts = store.models[session.key]?.items.compactMap { item -> String? in
            if case .user(let user) = item {
                user.content.array?.first?["text"]?.string ?? user.content.string
            } else {
                nil
            }
        }
        #expect(texts == ["while offline", "slow 20", "second", "third"])

        // Refused: the session isn't live.
        store.send(424242, text: "nowhere")
        try await eventually(
            state: { "\(store.outbox)" },
            { if case .failed = store.outbox.first?.state { true } else { false } })
        let failed = try #require(store.outbox.first)
        store.discard(failed.id)
        #expect(store.outbox.isEmpty)
        await local.close()
    }

    /// Keep-awake from the app: the daemon's state is pushed, the toggle changes it, and the phone sees it too.
    @Test @MainActor func keepAwakeToggle() async throws {
        let daemon = try Daemon()
        defer { daemon.stop() }
        let mac = Store(endpoint: .local(socket: daemon.socket), client: "mac")
        let phone = Store(endpoint: .remote(url: try await daemon.webSocketURL()), client: "phone")
        mac.start()
        phone.start()
        defer {
            mac.stop()
            phone.stop()
        }
        // The test daemon's config has keep-awake off.
        try await eventually { mac.daemon?.keepAwake == false && phone.daemon?.keepAwake == false }
        #expect(await mac.setKeepAwake(true))
        try await eventually { phone.daemon?.keepAwake == true && phone.daemon?.awake == false }
        _ = try #require(await mac.startSession(workspace: daemon.workspace.path, mode: .host, prompt: nil))
        try await eventually(
            state: { "\(String(describing: phone.daemon))" },
            { phone.daemon?.awake == true && phone.daemon?.sessions == 1 })
        #expect(await phone.setKeepAwake(false))
        try await eventually { mac.daemon?.keepAwake == false && mac.daemon?.awake == false }
    }

    /// Host logging from the app: the daemon holds it, every client sees the switch, and the Mac app's own capture
    /// follows it (`AppLogging.shared` is the host-controlled source on macOS).
    @Test @MainActor func hostLoggingSwitch() async throws {
        let daemon = try Daemon()
        defer { daemon.stop() }
        let mac = Store(endpoint: .local(socket: daemon.socket), client: "mac")
        let phone = Store(endpoint: .remote(url: try await daemon.webSocketURL()), client: "phone")
        mac.start()
        phone.start()
        defer {
            mac.stop()
            phone.stop()
        }
        try await eventually { mac.daemon?.logging == HostLogging(policy: .info, default: .info) }
        #expect(await mac.setHostLogging(.debug(expiration: .manual)))
        try await eventually { phone.daemon?.logging.policy == .debug(expiration: .manual) }
        #expect(AppLogging.shared.policy == .debug(expiration: .manual))
        #expect(await phone.setHostLogging(.info))
        try await eventually { mac.daemon?.logging.policy == .info }
        #expect(AppLogging.shared.policy == .info)
    }

    /// A connection that died unnoticed (open, but nothing answers) is found by `verifyConnection` within its deadline,
    /// not after the regular ping interval plus its timeout; the store reconnects once the daemon answers again.
    @Test @MainActor func verifyFindsADeadConnection() async throws {
        let daemon = try Daemon()
        defer {
            daemon.thaw()
            daemon.stop()
        }
        let store = Store(endpoint: .remote(url: try await daemon.webSocketURL()), client: "verify")
        store.start()
        defer { store.stop() }
        try await eventually { store.link == .connected }

        // Alive: the check changes nothing.
        store.verifyConnection(reason: "test")
        try await Task.sleep(for: .milliseconds(500))
        #expect(store.link == .connected)

        daemon.freeze()
        let started = ContinuousClock.now
        store.verifyConnection(reason: "test")
        try await eventually(.seconds(5), state: { "\(store.link)" }, { store.link != .connected })
        #expect(started.duration(to: .now) < .seconds(4), "found by the check, not the 15 s pinger")

        daemon.thaw()
        store.verifyConnection(reason: "test")
        try await eventually(state: { "\(store.link)" }, { store.link == .connected })
    }

    /// A quiet WebSocket stays up past the old 10 s request timeout, with pings running. (On macOS loopback the old
    /// timeout didn't drop it either, so this guards the pinger, not the iOS behavior.)
    @Test @MainActor func idleWebSocketStaysUp() async throws {
        let daemon = try Daemon()
        defer { daemon.stop() }
        let store = Store(endpoint: .remote(url: try await daemon.webSocketURL()), client: "idle")
        store.start()
        defer { store.stop() }
        try await eventually { store.link == .connected }
        try await Task.sleep(for: .seconds(14))
        #expect(store.link == .connected)
        let log = try String(contentsOf: daemon.log, encoding: .utf8)
        #expect(log.components(separatedBy: "view client connected over the tailnet").count - 1 == 1, "one connection")
    }

    /// Opening a session, going back to the list, and opening it again (the UI's onDisappear/onAppear): the model must
    /// come back each time, over the Unix socket and the WebSocket.
    @Test @MainActor func reopenASession() async throws {
        let daemon = try Daemon()
        defer { daemon.stop() }
        let local = try await daemon.connect("seed")
        let session = try await local.start(workspace: daemon.workspace.path, mode: .host, prompt: "seed")
        let url = try await daemon.webSocketURL()
        for endpoint in [Endpoint.local(socket: daemon.socket), .remote(url: url)] {
            let store = Store(endpoint: endpoint, client: "reopen")
            store.start()
            defer { store.stop() }
            try await eventually { store.link == .connected && !store.sessions.isEmpty }
            for round in 1...3 {
                store.watch(session.key)
                try await eventually(
                    state: { "\(endpoint) round \(round): models=\(store.models.keys)" },
                    { store.models[session.key]?.awaitingSnapshot == false })
                store.unwatch(session.key)
                #expect(store.models[session.key] == nil)
            }
            // Back, then straight back in (old screen's unwatch, then the new screen's watch) on an idle session: no
            // new changes will come, so the model has to come from a snapshot after the re-watch.
            store.watch(session.key)
            try await eventually { store.models[session.key]?.awaitingSnapshot == false }
            for _ in 1...5 {
                store.unwatch(session.key)
                store.watch(session.key)
            }
            try await eventually(
                state: { "\(endpoint): unwatch+watch left models=\(store.models.keys)" },
                { store.models[session.key]?.awaitingSnapshot == false })
            store.unwatch(session.key)
            // SwiftUI can show the new screen (watch) before it removes the old one (unwatch) for the same session.
            store.watch(session.key)
            try await eventually { store.models[session.key]?.awaitingSnapshot == false }
            store.watch(session.key)
            store.unwatch(session.key)
            try await Task.sleep(for: .milliseconds(300))
            #expect(
                store.models[session.key] != nil,
                "\(endpoint): the newer screen's watch survives the older one's unwatch")
            store.send(session.key, text: "still watched")
            try await eventually(
                state: { "\(endpoint): \(store.models[session.key].flatMap(assistantText) ?? "-")" },
                { store.models[session.key].flatMap(assistantText) == "echo: still watched" })
            store.unwatch(session.key)
        }
        await local.close()
    }
}
