import Foundation
import OSLog

/// Supplementary bounded log files. Unified logging remains the usual Apple-app log destination. Records are `info`
/// (always kept) or `debug` (kept only while the policy is debug).
/// File work uses a serial queue with a bounded admission semaphore: neither UI nor network callbacks wait for disk.
public final class AppLogging: @unchecked Sendable {
    // @unchecked: policy is under lock; file operations are confined to queue. Other properties are immutable.
    public static let shared = AppLogging()
    public enum Detail: Sendable { case info, debug }
    public enum LoggingError: Error, Equatable {
        case storage(code: Int)
        /// This app follows the daemon's host policy; switch it through the daemon (`Store.setHostLogging`).
        case hostControlled
    }

    /// Where the capture policy comes from.
    public enum Source: Sendable {
        /// A local settings file: the phone, which must work while disconnected.
        case stored(settings: URL)
        /// The daemon's host policy, pushed over the connection (the Mac app). Info until the daemon reports it.
        case host
    }

    public let directory: URL
    public let source: Source
    private let lock = NSLock()
    private var storedPolicy: LoggingPolicy
    private var budgetStarted = ContinuousClock.now
    private var budget = 0
    // Accessed only on queue.
    private var lastFileError: ContinuousClock.Instant?
    private let queue = DispatchQueue(label: "piton.logging", qos: .utility)
    private let slots = DispatchSemaphore(value: 256)
    private let writer: RotatingLog

    private convenience init() {
        #if os(iOS)
            let root = URL.libraryDirectory.appendingPathComponent("Logs/Piton", isDirectory: true)
            self.init(directory: root, source: .stored(settings: root.appendingPathComponent("settings.json")))
        #else
            // Tests and development captures can use an isolated root, as the daemon does.
            let root =
                ProcessInfo.processInfo.environment["PITON_LOGS_DIR"].map {
                    URL(fileURLWithPath: $0, isDirectory: true)
                }
                ?? URL.homeDirectory.appendingPathComponent(".local/state/piton/logs", isDirectory: true)
            self.init(directory: root.appendingPathComponent("macos"), source: .host)
        #endif
    }

    init(directory: URL, source: Source, fileBytes: Int = 2 * 1024 * 1024, files: Int = 5) {
        self.directory = directory
        self.source = source
        storedPolicy =
            switch source {
            case .stored(let settings): Self.readPolicy(settings)
            case .host: .info
            }
        writer = RotatingLog(directory: directory, fileBytes: fileBytes, files: files)
    }

    public var policy: LoggingPolicy {
        lock.lock()
        defer { lock.unlock() }
        return storedPolicy.effective()
    }

    private static func readPolicy(_ url: URL) -> LoggingPolicy {
        guard let size = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize, size <= 4096,
            let data = try? Data(contentsOf: url),
            let policy = try? JSONDecoder().decode(LoggingPolicy.self, from: data)
        else { return .info }
        return policy.effective()
    }

    private func use(_ policy: LoggingPolicy) {
        lock.lock()
        storedPolicy = policy
        lock.unlock()
    }

    /// Stores the local policy (a `.stored` source).
    public func setPolicy(_ policy: LoggingPolicy) async throws(LoggingError) {
        let settings: URL
        switch source {
        case .stored(let url): settings = url
        case .host: throw .hostControlled
        }
        do {
            try await perform {
                try FileManager.default.createDirectory(
                    at: settings.deletingLastPathComponent(), withIntermediateDirectories: true,
                    attributes: [.posixPermissions: 0o700])
                try JSONEncoder().encode(policy).write(to: settings, options: .atomic)
            }
        } catch { throw .storage(code: (error as NSError).code) }
        use(policy)
        record("logging.policy_changed", category: "logging", detail: .info)
    }

    /// Applies the daemon's host policy (a `.host` source); a stored source keeps its own.
    public func follow(_ policy: LoggingPolicy) {
        switch source {
        case .host: break
        case .stored: return
        }
        guard self.policy != policy.effective() else { return }
        use(policy)
        record("logging.policy_changed source=host", category: "logging", detail: .info)
    }

    /// Deletes files, not the policy. Debug stays on if selected.
    public func clear() async throws(LoggingError) {
        do { try await perform { try self.writer.clear() } } catch { throw .storage(code: (error as NSError).code) }
    }

    private func perform(_ body: @escaping @Sendable () throws -> Void) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            queue.async {
                do {
                    try body()
                    continuation.resume()
                } catch { continuation.resume(throwing: error) }
            }
        }
    }

    /// Used by tests and orderly callers to wait until already-admitted writes finish; never called by the UI's log path.
    func drain() async { try? await perform {} }

    private enum Admission { case discard, record }

    private func admit(_ detail: Detail) -> Admission {
        lock.lock()
        defer { lock.unlock() }
        switch (storedPolicy.effective(), detail) {
        case (.info, .debug): return .discard
        case (.info, .info), (.debug, .info), (.debug, .debug): break
        }
        if budgetStarted.duration(to: .now) >= .seconds(1) {
            budgetStarted = .now
            budget = 0
        }
        guard budget < 20 else { return .discard }
        budget += 1
        return .record
    }

    public func record(_ event: String, category: String = "connection", detail: Detail = .debug) {
        switch admit(detail) {
        case .discard: return
        case .record: break
        }
        // Event strings are authored by callers; never pass protocol bodies, localized errors, or credentials.
        let bounded = String(event.prefix(4096))
        let logger = Logger(subsystem: Diagnostics.subsystem, category: category)
        logger.notice("\(bounded, privacy: .public)")
        guard slots.wait(timeout: .now()) == .success else { return }
        let time = Date.now
        queue.async {
            defer { self.slots.signal() }
            // Respect disabling/expiry even for events waiting in the queue.
            switch (self.policy, detail) {
            case (.info, .debug): return
            case (.info, .info), (.debug, .info), (.debug, .debug): break
            }
            let line =
                "\(time.ISO8601Format(.iso8601(timeZone: .gmt, includingFractionalSeconds: true))) [\(category)] \(bounded)\n"
            do { try self.writer.append(Data(line.utf8), now: time) } catch {
                // Do not recurse or flood unified logs on disk full; report at most once a minute.
                if let last = self.lastFileError, last.duration(to: .now) < .seconds(60) { return }
                self.lastFileError = .now
                logger.error("diagnostic_file_write_failed code=\((error as NSError).code)")
            }
        }
    }
}

/// A fixed-size ring. The active file is opened for each batch, so collector snapshots don't depend on a long-lived fd.
/// Calls must be serialized by the owner. At most `files * fileBytes` bytes are retained, including the active file.
final class RotatingLog: @unchecked Sendable {
    let directory: URL
    let fileBytes: Int
    let files: Int
    private let gate = NSLock()
    // Protected by gate; a global rate limit also bounds repeated retry storms.
    private var window = Date.distantPast
    private var count = 0

    init(directory: URL, fileBytes: Int, files: Int) {
        precondition(fileBytes > 0 && files > 0)
        self.directory = directory
        self.fileBytes = fileBytes
        self.files = files
    }

    func file(_ index: Int) -> URL {
        directory.appendingPathComponent(index == 0 ? "current.log" : "archive-\(index).log")
    }

    func append(_ data: Data, now: Date) throws {
        gate.lock()
        defer { gate.unlock() }
        if now.timeIntervalSince(window) >= 1 {
            window = now
            count = 0
        }
        guard count < 20 else { return }
        count += 1
        try FileManager.default.createDirectory(
            at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        // Also recover a bounded ring if a previous build used larger files.
        for index in 0..<files {
            if let size = try? file(index).resourceValues(forKeys: [.fileSizeKey]).fileSize, size > fileBytes {
                try remove(file(index))
            }
        }
        let bytes = data.prefix(fileBytes)
        let size = (try? file(0).resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        if size + bytes.count > fileBytes {
            try remove(file(files - 1))
            if files > 1 {
                for index in stride(from: files - 2, through: 0, by: -1)
                where FileManager.default.fileExists(atPath: file(index).path) {
                    try FileManager.default.moveItem(at: file(index), to: file(index + 1))
                }
            }
        }
        if !FileManager.default.fileExists(atPath: file(0).path) { try Data().write(to: file(0)) }
        let handle = try FileHandle(forWritingTo: file(0))
        defer { try? handle.close() }
        try handle.seekToEnd()
        try handle.write(contentsOf: bytes)
    }

    func clear() throws {
        gate.lock()
        defer { gate.unlock() }
        for index in 0..<files { try remove(file(index)) }
    }

    private func remove(_ url: URL) throws {
        do { try FileManager.default.removeItem(at: url) } catch CocoaError.fileNoSuchFile {}
    }
}
