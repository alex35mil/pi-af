import Foundation

/// A line transport to the daemon: one JSON object per line each way. The Unix socket today; the tailnet WebSocket
/// later implements the same protocol.
public protocol Transport: Sendable {
    /// Sends one line (without the newline).
    func send(_ line: Data) async throws
    /// Incoming lines (without newlines). Finishes when the connection closes; throws when it fails.
    var lines: AsyncThrowingStream<Data, Error> { get }
    func close() async
    /// Checks that the daemon still answers, at most `timeout`. A transport that doesn't is closed, which finishes
    /// `lines`. A connection can die without the client noticing: an app suspended in the background, or a network or
    /// proxy change, and writes into it seem to succeed.
    func probe(within timeout: Duration, reason: String) async -> Bool
}

public enum TransportError: Error, Equatable, CustomStringConvertible {
    case connectFailed(path: String, errno: Int32)
    case pathTooLong(String)
    case writeFailed(errno: Int32)
    case closed

    public var description: String {
        switch self {
        case .connectFailed(let path, let errno): "can't connect to \(path): \(String(cString: strerror(errno)))"
        case .pathTooLong(let path): "socket path too long: \(path)"
        case .writeFailed(let errno): "write failed: \(String(cString: strerror(errno)))"
        case .closed: "connection closed"
        }
    }
}

/// The daemon's Unix socket (local clients: the macOS app, tests). A blocking reader thread splits lines; writes are
/// serialized by the actor.
public actor UnixSocketTransport: Transport {
    private let fd: Int32
    private var closed = false
    public nonisolated let lines: AsyncThrowingStream<Data, Error>

    public init(path: String) throws(TransportError) {
        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else { throw .connectFailed(path: path, errno: errno) }
        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)
        let capacity = MemoryLayout.size(ofValue: address.sun_path)
        guard path.utf8.count < capacity else {
            Darwin.close(fd)
            throw .pathTooLong(path)
        }
        withUnsafeMutableBytes(of: &address.sun_path) { buffer in
            buffer.copyBytes(from: path.utf8)
            buffer[path.utf8.count] = 0
        }
        let result = withUnsafePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                connect(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        guard result == 0 else {
            let err = errno
            Darwin.close(fd)
            throw .connectFailed(path: path, errno: err)
        }
        var on: Int32 = 1
        setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &on, socklen_t(MemoryLayout<Int32>.size))
        self.fd = fd
        let (stream, continuation) = AsyncThrowingStream<Data, Error>.makeStream()
        self.lines = stream
        let thread = Thread {
            var pending = Data()
            var buffer = [UInt8](repeating: 0, count: 65536)
            while true {
                let n = read(fd, &buffer, buffer.count)
                if n <= 0 { break }
                pending.append(contentsOf: buffer[0..<n])
                while let newline = pending.firstIndex(of: 0x0A) {
                    let line = pending[pending.startIndex..<newline]
                    if !line.isEmpty { continuation.yield(Data(line)) }
                    pending.removeSubrange(pending.startIndex...newline)
                }
            }
            continuation.finish()
        }
        thread.name = "piton.transport.read"
        thread.start()
    }

    public func send(_ line: Data) async throws {
        guard !closed else { throw TransportError.closed }
        var bytes = line
        bytes.append(0x0A)
        try bytes.withUnsafeBytes { (buffer: UnsafeRawBufferPointer) throws(TransportError) in
            var offset = 0
            while offset < buffer.count {
                let n = write(fd, buffer.baseAddress! + offset, buffer.count - offset)
                if n < 0 {
                    if errno == EINTR { continue }
                    throw .writeFailed(errno: errno)
                }
                offset += n
            }
        }
    }

    /// A local socket can't go stale: the kernel ends `lines` as soon as the daemon closes it.
    public func probe(within timeout: Duration, reason: String) async -> Bool {
        !closed
    }

    public func close() {
        guard !closed else { return }
        closed = true
        // Wakes the reader thread (read returns 0), which finishes the stream.
        shutdown(fd, SHUT_RDWR)
        Darwin.close(fd)
    }
}
