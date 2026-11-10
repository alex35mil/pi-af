import Foundation

/// The daemon's `view` protocol over WebSocket: the phone and other devices reach the Mac on its tailnet address
/// (`ws://<mac>:7357`). One text frame per message. Tailscale encrypts the traffic; the daemon checks the device's
/// Tailscale identity before the handshake and closes the connection when it isn't one of the owner's devices.
public final class WebSocketTransport: NSObject, Transport, URLSessionWebSocketDelegate, @unchecked Sendable {
    // @unchecked: session/task are set during init before callbacks start, then only read. URLSession is thread-safe;
    // handshake/lifecycle state is guarded by lock. Every terminal path invalidates the session to release its delegate.
    private let diagnostics: Diagnostics
    private let started = ContinuousClock.now
    private var session: URLSession?
    private var task: URLSessionWebSocketTask?
    private let lock = NSLock()
    private var opened: CheckedContinuation<Void, Error>?
    private var openResult: Result<Void, Error>?
    private enum Lifecycle {
        case active(pinger: Task<Void, Never>?)
        case finished
    }
    private var lifecycle: Lifecycle = .active(pinger: nil)
    public let lines: AsyncThrowingStream<Data, Error>
    private let continuation: AsyncThrowingStream<Data, Error>.Continuation

    public enum WebSocketError: Error, Equatable, CustomStringConvertible {
        /// The connection failed or closed before the handshake: piton not reachable, or the device isn't allowed.
        case refused(String)
        case closed

        public var description: String {
            switch self {
            case .refused(let detail): "piton refused the connection: \(detail)"
            case .closed: "connection closed"
            }
        }
    }

    /// How often to ping: keeps the connection alive through idle periods and notices a dead one (Wi-Fi to cellular,
    /// the Mac asleep) instead of waiting forever.
    static let pingInterval: Duration = .seconds(15)
    /// How long a ping may go unanswered. On a dead link (out of signal) URLSession may never call the pong handler,
    /// so without a deadline a dead connection would look alive.
    static let pongTimeout: Duration = .seconds(10)

    /// Connects to `url` and waits for the handshake, at most `timeout`.
    public static func connect(
        to url: URL, timeout: Duration = .seconds(10), diagnosticID: String = UUID().uuidString
    ) async throws -> WebSocketTransport {
        let transport = WebSocketTransport(url: url, diagnosticID: diagnosticID)
        try await transport.open(timeout: timeout)
        return transport
    }

    /// System proxy settings apply as for any app; diagnostics record which proxy iOS picks (see `systemProxies`).
    static func configuration() -> URLSessionConfiguration {
        let configuration = URLSessionConfiguration.ephemeral
        // A request timeout is an idle timeout on WebSockets; use separate handshake and pong deadlines instead.
        configuration.timeoutIntervalForRequest = .infinity
        configuration.timeoutIntervalForResource = .infinity
        configuration.waitsForConnectivity = false
        return configuration
    }

    func open(timeout: Duration = .seconds(10)) async throws {
        let proxies = task?.originalRequest?.url.map(Self.systemProxies(for:)) ?? "unknown"
        diagnostics.record("ws.handshake_begin timeout=\(timeout) system_proxies=\(proxies)")
        task?.resume()
        receive()
        let deadline = Task {
            try await Task.sleep(for: timeout)
            self.diagnostics.record(
                "ws.handshake_timeout elapsed=\(self.started.duration(to: .now))", detail: .info)
            self.finish(.refused("no answer within \(timeout)"))
        }
        defer { deadline.cancel() }
        do {
            try await withTaskCancellationHandler {
                try await waitOpen()
            } onCancel: {
                self.finish(.closed)
            }
            startPinging()
        } catch {
            finish(.closed)
            throw error
        }
    }

    /// Pings and waits for the pong, at most `timeout`. A connection that doesn't answer is closed: the stream
    /// finishing tells the Connection (and the Store) to reconnect.
    @discardableResult
    private func ping(timeout: Duration, reason: String) async -> Bool {
        guard let task else { return false }
        let pingStarted = ContinuousClock.now
        diagnostics.record("ws.ping_sent reason=\(reason)")
        let alive = await withCheckedContinuation { (continuation: CheckedContinuation<Bool, Never>) in
            // URLSession can call the pong handler more than once when the connection drops while a ping is in
            // flight (a daemon restart); resuming twice would crash, so only the first call counts.
            let once = Once(continuation)
            let deadline = Task {
                do { try await Task.sleep(for: timeout) } catch { return }
                if once.resume(returning: false) {
                    self.diagnostics.record(
                        "ws.pong_timeout reason=\(reason) elapsed=\(pingStarted.duration(to: .now))", detail: .info)
                }
            }
            task.sendPing { error in
                let won = once.resume(returning: error == nil)
                deadline.cancel()
                if won {
                    if let error {
                        self.diagnostics.record(
                            "ws.ping_failed reason=\(reason) error=\(Diagnostics.failure(error))", detail: .info)
                    } else {
                        self.diagnostics.record("ws.pong reason=\(reason) elapsed=\(pingStarted.duration(to: .now))")
                    }
                }
            }
        }
        if !alive { finish(.closed) }
        return alive
    }

    public func probe(within timeout: Duration, reason: String) async -> Bool {
        await ping(timeout: timeout, reason: reason)
    }

    private func startPinging() {
        let pinger = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: Self.pingInterval)
                guard let self, !Task.isCancelled else { return }
                guard await self.ping(timeout: Self.pongTimeout, reason: "interval") else { return }
            }
        }
        lock.lock()
        switch lifecycle {
        case .active(let previous):
            lifecycle = .active(pinger: pinger)
            lock.unlock()
            previous?.cancel()
        case .finished:
            lock.unlock()
            pinger.cancel()
        }
    }

    /// A continuation that ignores every resume after the first.
    final class Once<T: Sendable>: @unchecked Sendable {
        // @unchecked: `continuation` is only touched under `lock`.
        private let lock = NSLock()
        private var continuation: CheckedContinuation<T, Never>?

        init(_ continuation: CheckedContinuation<T, Never>) {
            self.continuation = continuation
        }

        /// Returns true only for the call that resumed the continuation.
        @discardableResult
        func resume(returning value: T) -> Bool {
            lock.lock()
            let waiting = continuation
            continuation = nil
            lock.unlock()
            guard let waiting else { return false }
            waiting.resume(returning: value)
            return true
        }
    }

    init(url: URL, diagnosticID: String = UUID().uuidString) {
        diagnostics = Diagnostics(id: diagnosticID)
        let (stream, continuation) = AsyncThrowingStream<Data, Error>.makeStream()
        lines = stream
        self.continuation = continuation
        super.init()
        let session = URLSession(configuration: Self.configuration(), delegate: self, delegateQueue: nil)
        self.session = session
        let task = session.webSocketTask(with: url)
        task.maximumMessageSize = Self.maximumMessageSize
        self.task = task
    }

    /// The largest message the app accepts. URLSession's default is 1 MiB, and a larger one fails the whole connection
    /// (ENOBUFS, error 40), not just the request: a `session.image` reply for one screenshot (pi keeps prompt images
    /// up to about 4.5 MB of base64) exceeded it on 2026-11-10, and the app reconnected and failed on every retry.
    static let maximumMessageSize = 16 * 1024 * 1024

    /// URLSession retains its delegate until invalidated, even after its task fails. Idempotent cleanup is required
    /// on failure/timeout/cancellation/remote close too, not just the explicit close button.
    private func finish(_ error: WebSocketError, code: URLSessionWebSocketTask.CloseCode = .goingAway) {
        let pinger: Task<Void, Never>?
        lock.lock()
        switch lifecycle {
        case .finished:
            lock.unlock()
            return
        case .active(let running):
            pinger = running
            lifecycle = .finished
            lock.unlock()
        }
        pinger?.cancel()
        settleOpen(.failure(error))
        task?.cancel(with: code, reason: nil)
        session?.invalidateAndCancel()
        continuation.finish()
    }

    private func waitOpen() async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            lock.lock()
            if let result = openResult {
                lock.unlock()
                continuation.resume(with: result)
            } else {
                opened = continuation
                lock.unlock()
            }
        }
    }

    private func settleOpen(_ result: Result<Void, Error>) {
        lock.lock()
        guard openResult == nil else {
            lock.unlock()
            return
        }
        openResult = result
        let waiting = opened
        opened = nil
        lock.unlock()
        waiting?.resume(with: result)
    }

    private func receive() {
        task?.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .success(.string(let text)):
                self.continuation.yield(Data(text.utf8))
                self.receive()
            case .success(.data(let data)):
                self.continuation.yield(data)
                self.receive()
            case .success:
                self.receive()
            case .failure(let error):
                self.diagnostics.record("ws.receive_failed error=\(Diagnostics.failure(error))", detail: .info)
                self.finish(.refused(error.localizedDescription))
            }
        }
    }

    public func send(_ line: Data) async throws {
        guard let task else { throw WebSocketError.closed }
        do {
            try await task.send(.string(String(decoding: line, as: UTF8.self)))
        } catch {
            finish(.closed)
            throw error
        }
    }

    public func close() async {
        diagnostics.record("ws.close_requested elapsed=\(started.duration(to: .now))")
        finish(.closed, code: .normalClosure)
    }

    // MARK: URLSessionWebSocketDelegate

    public func urlSession(
        _ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?
    ) {
        diagnostics.record("ws.handshake_open elapsed=\(started.duration(to: .now))")
        settleOpen(.success(()))
    }

    public func urlSession(
        _ session: URLSession, webSocketTask: URLSessionWebSocketTask,
        didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?
    ) {
        // Close reason bytes are server-provided content, so only the standard code is logged.
        diagnostics.record(
            "ws.closed code=\(closeCode.rawValue) elapsed=\(started.duration(to: .now))", detail: .info)
        finish(.closed)
    }

    public func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        diagnostics.record(
            "ws.task_completed elapsed=\(started.duration(to: .now)) error=\(error.map(Diagnostics.failure) ?? "none")",
            detail: .info)
        finish(.refused(error?.localizedDescription ?? "closed"))
    }

    public func urlSession(_ session: URLSession, taskIsWaitingForConnectivity task: URLSessionTask) {
        diagnostics.record("ws.waiting_for_connectivity")
    }

    public func urlSession(
        _ session: URLSession, task: URLSessionTask, didFinishCollecting metrics: URLSessionTaskMetrics
    ) {
        for transaction in metrics.transactionMetrics {
            let status = (transaction.response as? HTTPURLResponse)?.statusCode
            diagnostics.record(
                "ws.metrics dns_ms=\(Self.milliseconds(transaction.domainLookupStartDate, transaction.domainLookupEndDate)) connect_ms=\(Self.milliseconds(transaction.connectStartDate, transaction.connectEndDate)) http_status=\(status.map(String.init) ?? "none") proxy=\(transaction.isProxyConnection) reused=\(transaction.isReusedConnection)"
            )
        }
    }

    /// The proxies the system configuration gives for `url`, in the order CFNetwork tries them: `none` (direct),
    /// `http:host:port`, `pac:<script URL>`, etc. A PAC script isn't evaluated here, so its result isn't known.
    static func systemProxies(for url: URL) -> String {
        // CFNetwork resolves proxies for HTTP(S); a WebSocket upgrade uses the HTTP(S) proxy of the same URL.
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        switch components?.scheme {
        case "ws": components?.scheme = "http"
        case "wss": components?.scheme = "https"
        default: break
        }
        guard let lookup = components?.url,
            let settings = CFNetworkCopySystemProxySettings()?.takeRetainedValue()
        else { return "unknown" }
        let proxies = CFNetworkCopyProxiesForURL(lookup as CFURL, settings).takeRetainedValue()
        return describeProxies(proxies as? [[CFString: Any]] ?? [])
    }

    private static let proxyTypeNames: [String: String] = [
        kCFProxyTypeNone as String: "none",
        kCFProxyTypeHTTP as String: "http",
        kCFProxyTypeHTTPS as String: "https",
        kCFProxyTypeSOCKS as String: "socks",
        kCFProxyTypeAutoConfigurationURL as String: "pac",
        kCFProxyTypeAutoConfigurationJavaScript as String: "pac-script",
    ]

    static func describeProxies(_ proxies: [[CFString: Any]]) -> String {
        guard !proxies.isEmpty else { return "none" }
        return proxies.map { proxy in
            let type = proxy[kCFProxyTypeKey] as? String ?? "unknown"
            // An external value: CFNetwork may add types; an unlisted one is logged raw.
            let name = proxyTypeNames[type] ?? type
            if let host = proxy[kCFProxyHostNameKey] as? String {
                let port = (proxy[kCFProxyPortNumberKey] as? NSNumber).map { ":\($0)" } ?? ""
                return "\(name):\(host)\(port)"
            }
            if let script = proxy[kCFProxyAutoConfigurationURLKey] as? URL {
                return "\(name):\(script.absoluteString)"
            }
            return name
        }.joined(separator: ",")
    }

    private static func milliseconds(_ start: Date?, _ end: Date?) -> String {
        guard let start, let end else { return "none" }
        return String(Int(end.timeIntervalSince(start) * 1000))
    }
}
