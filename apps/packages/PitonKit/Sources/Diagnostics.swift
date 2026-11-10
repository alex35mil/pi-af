import Foundation

/// Connection diagnostics use notice level so Release builds retain them in the unified log, subject to OS retention.
/// Never pass protocol payloads or arbitrary error descriptions here: they can contain messages or credentials.
struct Diagnostics: Sendable {
    static let subsystem = "com.alex35mil.piton"
    let id: String

    init(id: String = UUID().uuidString) {
        self.id = id
    }

    func record(_ event: String, detail: AppLogging.Detail = .debug) {
        AppLogging.shared.record("[\(id)] \(event)", detail: detail)
    }

    /// Preserve useful networking error codes, including the underlying POSIX error, without logging userInfo,
    /// localized descriptions, URLs, or daemon-provided text.
    static func failure(_ error: any Error) -> String {
        if let request = error as? Connection.RequestError {
            switch request {
            case .refused: return "daemon_refused"
            case .disconnected: return "disconnected"
            case .badReply: return "bad_reply"
            }
        }
        if let websocket = error as? WebSocketTransport.WebSocketError {
            switch websocket {
            case .refused: return "websocket_open_failed"
            case .closed: return "websocket_closed"
            }
        }
        var current = error as NSError
        var codes: [String] = []
        for _ in 0..<3 {
            codes.append("\(current.domain):\(current.code)")
            guard let underlying = current.userInfo[NSUnderlyingErrorKey] as? NSError else { break }
            current = underlying
        }
        return codes.joined(separator: " <- ")
    }
}
