import Foundation

/// The daemon's wire shape; the phone also stores its own capture policy in it. A deadline is absolute, so restarting
/// never extends a debug period.
public enum LoggingExpiration: Sendable, Hashable, Codable {
    case until(unixMS: UInt64)
    case manual

    private enum Keys: String, CodingKey {
        case kind
        case unixMS = "unix_ms"
    }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: Keys.self)
        switch try values.decode(String.self, forKey: .kind) {
        case "until": self = .until(unixMS: try values.decode(UInt64.self, forKey: .unixMS))
        case "manual": self = .manual
        case let kind: throw UnknownVariant(kind: "logging expiration", value: kind)
        }
    }

    public func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: Keys.self)
        switch self {
        case .until(let unixMS):
            try values.encode("until", forKey: .kind)
            try values.encode(unixMS, forKey: .unixMS)
        case .manual:
            try values.encode("manual", forKey: .kind)
        }
    }
}

/// Host logging as the daemon reports it (Mac app, daemon, phone-log collector): the policy in effect and the
/// configured default (`[logging] mode` in config.toml) it returns to when a timed switch expires or the daemon
/// restarts.
public struct HostLogging: Sendable, Hashable, Codable {
    public enum Mode: String, Sendable, Hashable, Codable {
        case info, debug
    }

    public let policy: LoggingPolicy
    public let `default`: Mode

    public init(policy: LoggingPolicy, default: Mode) {
        self.policy = policy
        self.default = `default`
    }
}

public enum LoggingPolicy: Sendable, Hashable, Codable {
    case info
    case debug(expiration: LoggingExpiration)

    public static func forOneHour(now: Date = .now) -> Self {
        .debug(expiration: .until(unixMS: UInt64(now.addingTimeInterval(3600).timeIntervalSince1970 * 1000)))
    }

    public func effective(now: Date = .now) -> Self {
        switch self {
        case .info: return .info
        case .debug(.manual): return self
        case .debug(.until(let deadline)):
            return now.timeIntervalSince1970 * 1000 < Double(deadline) ? self : .info
        }
    }

    private enum Keys: String, CodingKey { case mode, expiration }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: Keys.self)
        switch try values.decode(String.self, forKey: .mode) {
        case "info": self = .info
        case "debug":
            self = .debug(expiration: try values.decode(LoggingExpiration.self, forKey: .expiration))
        case let mode: throw UnknownVariant(kind: "logging mode", value: mode)
        }
    }

    public func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: Keys.self)
        switch self {
        case .info:
            try values.encode("info", forKey: .mode)
        case .debug(let expiration):
            try values.encode("debug", forKey: .mode)
            try values.encode(expiration, forKey: .expiration)
        }
    }
}
