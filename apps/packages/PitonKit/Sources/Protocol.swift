import Foundation

// The `view` protocol, mirrored from the daemon (daemon/src/view.rs, daemon/src/wire.rs; spec in docs/design.md,
// "Session view" and "The `view` protocol"). Kept in sync by fixtures the daemon's tests write
// (Tests/Fixtures) and PitonKitTests decode.

public typealias SessionKey = UInt64
public typealias ItemID = UInt64

// MARK: Session list

public enum LaunchMode: String, Codable, Sendable {
    case sandbox
    case host
}

public enum SessionStatus: String, Codable, Sendable {
    case idle
    case working
    case needsInput = "needs_input"
    case stopping
}

public struct SessionInfo: Codable, Sendable, Hashable, Identifiable {
    /// piton's key for the pi process: the stable identity while it runs.
    public let key: SessionKey
    /// pi's current session id; changes on `switch_session` / `new_session`.
    public let sessionID: String?
    public let file: String?
    public let workspace: String
    /// What `workspace` is: a project's own checkout or a worker of one.
    public let checkout: Checkout
    public let mode: LaunchMode
    public let status: SessionStatus
    public let clients: Int
    public let pid: UInt32?
    public let title: String?

    public var id: SessionKey { key }

    /// The project's checkout: the workspace itself, or the worker's source.
    public var project: String {
        switch checkout {
        case .source: workspace
        case .worker(let source, _): source
        }
    }

    enum CodingKeys: String, CodingKey {
        case key, file, workspace, checkout, mode, status, clients, pid, title
        case sessionID = "id"
    }
}

/// A session's workspace relative to its project. The daemon decides it from the worker's git config and folder layout
/// (`<repo>--<name>` next to `<repo>`), so a repository whose own name contains `--` isn't mistaken for a worker.
public enum Checkout: Codable, Sendable, Hashable {
    case source
    case worker(source: String, name: String)

    private enum Keys: String, CodingKey { case kind, source, name }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        switch try c.decode(String.self, forKey: .kind) {
        case "source": self = .source
        case "worker":
            self = .worker(
                source: try c.decode(String.self, forKey: .source), name: try c.decode(String.self, forKey: .name))
        case let kind: throw UnknownVariant(kind: "checkout", value: kind)
        }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: Keys.self)
        switch self {
        case .source:
            try c.encode("source", forKey: .kind)
        case .worker(let source, let name):
            try c.encode("worker", forKey: .kind)
            try c.encode(source, forKey: .source)
            try c.encode(name, forKey: .name)
        }
    }
}

// MARK: Items

public enum ToolStatus: String, Codable, Sendable {
    case pending
    case running
    case done
    case error
}

public enum SummaryKind: String, Codable, Sendable {
    case compaction
    case branch
}

public enum NoticeLevel: String, Codable, Sendable {
    case info
    case warning
    case error
}

public struct UserItem: Codable, Sendable, Hashable {
    public let id: ItemID
    public let timestamp: Int64?
    /// pi's content: a string or content blocks.
    public let content: JSON

    public var blocks: [ContentBlock] { ContentBlock.blocks(of: content) }
}

public struct AssistantItem: Codable, Sendable, Hashable {
    public let id: ItemID
    public let timestamp: Int64?
    /// pi's content blocks (`text`, `thinking`, `toolCall`).
    public var content: [JSON]
    public var streaming: Bool
    public let stopReason: String?
    public let error: String?
    public let model: String?

    enum CodingKeys: String, CodingKey {
        case id, timestamp, content, streaming, error, model
        case stopReason = "stop_reason"
    }

    /// What the message is doing now.
    public enum Activity: Sendable, Hashable {
        /// Streaming, and the newest block is thinking.
        case thinking
        /// Streaming text or a tool call (or nothing yet).
        case responding
        case finished
    }

    public var blocks: [ContentBlock] { content.map(ContentBlock.init) }

    public var activity: Activity {
        guard streaming else { return .finished }
        // Blocks not started yet are null placeholders.
        let newest = content.last { block in
            switch block {
            case .object: true
            case .null, .bool, .integer, .number, .string, .array: false
            }
        }
        switch newest.map(ContentBlock.init) {
        case .thinking?: return .thinking
        case .text?, .toolCall?, .image?, .other?, nil: return .responding
        }
    }

    /// The `text` blocks, joined.
    public var text: String { blocks.text(separator: "\n\n") }
}

public struct ToolItem: Codable, Sendable, Hashable {
    public let id: ItemID
    public let callID: String
    /// The assistant item that made the call.
    public let message: ItemID?
    public let name: String
    public let args: JSON
    public let status: ToolStatus
    /// The tail of the output's text; `truncated` when there's more (`session.tool_output`).
    public let preview: String?
    public let truncated: Bool

    enum CodingKeys: String, CodingKey {
        case id, message, name, args, status, preview, truncated
        case callID = "call_id"
    }
}

public struct SummaryItem: Codable, Sendable, Hashable {
    public let id: ItemID
    public let kind: SummaryKind
    public let text: String
}

public struct NoticeItem: Codable, Sendable, Hashable {
    public let id: ItemID
    public let level: NoticeLevel
    public let text: String
}

public struct OtherItem: Codable, Sendable, Hashable {
    public let id: ItemID
    public let role: String
    public let timestamp: Int64?
    public let message: JSON
}

public enum Item: Sendable, Hashable, Identifiable {
    case user(UserItem)
    case assistant(AssistantItem)
    case tool(ToolItem)
    case summary(SummaryItem)
    case notice(NoticeItem)
    case other(OtherItem)

    public var id: ItemID {
        switch self {
        case .user(let i): i.id
        case .assistant(let i): i.id
        case .tool(let i): i.id
        case .summary(let i): i.id
        case .notice(let i): i.id
        case .other(let i): i.id
        }
    }
}

/// A `type` the client doesn't know: the daemon is newer. Fail loudly rather than drop data.
public struct UnknownVariant: Error, CustomStringConvertible {
    public let kind: String
    public let value: String
    public var description: String { "unknown \(kind) \(value): the daemon speaks a newer protocol" }
}

extension Item: Codable {
    private enum TypeKey: String, CodingKey { case type }

    public init(from decoder: Decoder) throws {
        let type = try decoder.container(keyedBy: TypeKey.self).decode(String.self, forKey: .type)
        switch type {
        case "user": self = .user(try UserItem(from: decoder))
        case "assistant": self = .assistant(try AssistantItem(from: decoder))
        case "tool": self = .tool(try ToolItem(from: decoder))
        case "summary": self = .summary(try SummaryItem(from: decoder))
        case "notice": self = .notice(try NoticeItem(from: decoder))
        case "other": self = .other(try OtherItem(from: decoder))
        default: throw UnknownVariant(kind: "item", value: type)
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: TypeKey.self)
        switch self {
        case .user(let i):
            try container.encode("user", forKey: .type)
            try i.encode(to: encoder)
        case .assistant(let i):
            try container.encode("assistant", forKey: .type)
            try i.encode(to: encoder)
        case .tool(let i):
            try container.encode("tool", forKey: .type)
            try i.encode(to: encoder)
        case .summary(let i):
            try container.encode("summary", forKey: .type)
            try i.encode(to: encoder)
        case .notice(let i):
            try container.encode("notice", forKey: .type)
            try i.encode(to: encoder)
        case .other(let i):
            try container.encode("other", forKey: .type)
            try i.encode(to: encoder)
        }
    }
}

// MARK: State

public struct Queue: Codable, Sendable, Hashable {
    public let steering: [String]
    public let followUp: [String]

    enum CodingKeys: String, CodingKey {
        case steering
        case followUp = "follow_up"
    }
}

public struct ViewState: Codable, Sendable, Hashable {
    public let status: SessionStatus
    public let workspace: String
    public let mode: LaunchMode
    public let sessionID: String?
    public let sessionFile: String?
    public let sessionName: String?
    public let title: String?
    public let model: String?
    public let thinkingLevel: String?
    public let queue: Queue
    /// Pending extension dialogs: pi's `extension_ui_request` records.
    public let dialogs: [Dialog]

    enum CodingKeys: String, CodingKey {
        case status, workspace, mode, title, model, queue, dialogs
        case sessionID = "session_id"
        case sessionFile = "session_file"
        case sessionName = "session_name"
        case thinkingLevel = "thinking_level"
    }
}

/// A pending dialog, from pi's `extension_ui_request`.
public struct Dialog: Codable, Sendable, Hashable, Identifiable {
    public enum Method: String, Codable, Sendable {
        case select, confirm, input, editor
    }

    public let id: String
    public let method: Method
    public let title: String?
    public let message: String?
    public let options: [String]?
    public let placeholder: String?
    public let prefill: String?
    public let timeout: Int?
}

/// How to answer a dialog (pi's `extension_ui_response` fields).
public enum DialogAnswer: Sendable, Hashable {
    case value(String)
    case confirmed(Bool)
    case cancelled

    var json: JSON {
        switch self {
        case .value(let v): .object(["value": .string(v)])
        case .confirmed(let c): .object(["confirmed": .bool(c)])
        case .cancelled: .object(["cancelled": .bool(true)])
        }
    }
}

// MARK: Changes

public enum DeltaField: String, Codable, Sendable {
    case text
    case thinking
}

public enum Change: Sendable, Hashable {
    case append(Item)
    case replace(Item)
    /// Append `text` to `content[index][field]` of assistant item `item`.
    case delta(item: ItemID, index: Int, field: DeltaField, text: String)
    case state(ViewState)
    /// The conversation was replaced; a new snapshot follows.
    case reset
}

extension Change: Codable {
    private enum Keys: String, CodingKey { case op, item, index, field, text, state }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        let op = try c.decode(String.self, forKey: .op)
        switch op {
        case "append": self = .append(try c.decode(Item.self, forKey: .item))
        case "replace": self = .replace(try c.decode(Item.self, forKey: .item))
        case "delta":
            self = .delta(
                item: try c.decode(ItemID.self, forKey: .item),
                index: try c.decode(Int.self, forKey: .index),
                field: try c.decode(DeltaField.self, forKey: .field),
                text: try c.decode(String.self, forKey: .text))
        case "state": self = .state(try c.decode(ViewState.self, forKey: .state))
        case "reset": self = .reset
        default: throw UnknownVariant(kind: "change", value: op)
        }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: Keys.self)
        switch self {
        case .append(let item):
            try c.encode("append", forKey: .op)
            try c.encode(item, forKey: .item)
        case .replace(let item):
            try c.encode("replace", forKey: .op)
            try c.encode(item, forKey: .item)
        case .delta(let item, let index, let field, let text):
            try c.encode("delta", forKey: .op)
            try c.encode(item, forKey: .item)
            try c.encode(index, forKey: .index)
            try c.encode(field, forKey: .field)
            try c.encode(text, forKey: .text)
        case .state(let state):
            try c.encode("state", forKey: .op)
            try c.encode(state, forKey: .state)
        case .reset:
            try c.encode("reset", forKey: .op)
        }
    }
}

// MARK: Incoming lines

public struct Snapshot: Codable, Sendable, Hashable {
    public let session: SessionKey
    public let seq: UInt64
    public let items: [Item]
    public let hasMore: Bool
    /// Absent until the daemon has published the session's state.
    public let state: ViewState?

    enum CodingKeys: String, CodingKey {
        case session, seq, items, state
        case hasMore = "has_more"
    }
}

public struct ChangeLine: Codable, Sendable, Hashable {
    public let session: SessionKey
    public let seq: UInt64
    public let change: Change
}

/// The daemon's id for an image in a session. Items and tool outputs carry `{"type": "image", "image": <id>,
/// "mime_type"}` instead of image data; `session.image` returns the data.
public typealias ImageID = UInt64

/// An image's data (`session.image`).
public struct ImageData: Codable, Sendable, Hashable {
    public let mimeType: String?
    /// pi's base64 data.
    public let data: String

    enum CodingKeys: String, CodingKey {
        case data
        case mimeType = "mime_type"
    }

    /// The decoded bytes; nil when the data isn't valid base64.
    public var bytes: Data? { Data(base64Encoded: data) }
}

public struct History: Codable, Sendable, Hashable {
    public let items: [Item]
    public let hasMore: Bool

    enum CodingKeys: String, CodingKey {
        case items
        case hasMore = "has_more"
    }
}

/// A request id: the client sends strings; replies echo whatever was sent.
public enum RequestID: Sendable, Hashable, Codable {
    case string(String)
    case number(Int64)

    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let n = try? c.decode(Int64.self) {
            self = .number(n)
        } else {
            self = .string(try c.decode(String.self))
        }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .string(let s): try c.encode(s)
        case .number(let n): try c.encode(n)
        }
    }
}

public enum Reply: Sendable, Hashable {
    case ok(id: RequestID, data: JSON)
    case failed(id: RequestID, error: String)

    public var id: RequestID {
        switch self {
        case .ok(let id, _), .failed(let id, _): id
        }
    }
}

/// Daemon-wide state.
public struct DaemonState: Codable, Sendable, Hashable {
    /// `<package version> (<git commit>[-dirty])` of the running daemon.
    public let version: String
    /// Keep-awake is enabled: the Mac is held awake while sessions are live (idle ones too), so the phone can reach
    /// them. Toggled at runtime; a daemon restart goes back to the config.
    public let keepAwake: Bool
    /// The Mac is being held awake right now (enabled and at least one live session).
    public let awake: Bool
    public let sessions: Int
    /// Host logging: this Mac's app, the daemon, and the phone-log collector.
    public let logging: HostLogging

    enum CodingKeys: String, CodingKey {
        case version, awake, sessions, logging
        case keepAwake = "keep_awake"
    }
}

/// One line from the daemon on a `view` connection.
public enum Incoming: Sendable, Hashable {
    case reply(Reply)
    case sessions([SessionInfo])
    case daemon(DaemonState)
    case snapshot(Snapshot)
    case change(ChangeLine)
}

extension Incoming: Decodable {
    private enum Keys: String, CodingKey { case type, id, ok, data, error, sessions, state }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        let type = try c.decode(String.self, forKey: .type)
        switch type {
        case "reply":
            let id = try c.decode(RequestID.self, forKey: .id)
            if try c.decode(Bool.self, forKey: .ok) {
                self = .reply(.ok(id: id, data: try c.decodeIfPresent(JSON.self, forKey: .data) ?? .null))
            } else {
                self = .reply(.failed(id: id, error: try c.decode(String.self, forKey: .error)))
            }
        case "sessions": self = .sessions(try c.decode([SessionInfo].self, forKey: .sessions))
        case "daemon": self = .daemon(try c.decode(DaemonState.self, forKey: .state))
        case "snapshot": self = .snapshot(try Snapshot(from: decoder))
        case "change": self = .change(try ChangeLine(from: decoder))
        default: throw UnknownVariant(kind: "line", value: type)
        }
    }
}

// MARK: Requests

// MARK: Workspaces

/// A folder under the daemon's roots.
public enum WorkspaceEntry: Sendable, Hashable, Identifiable, Decodable {
    /// A folder to browse further.
    case group(name: String, path: String)
    /// A git checkout to start sessions in; `source` when it's a worker clone.
    case workspace(name: String, path: String, source: String?)

    public var id: String { path }

    public var path: String {
        switch self {
        case .group(_, let path), .workspace(_, let path, _): path
        }
    }

    public var name: String {
        switch self {
        case .group(let name, _), .workspace(let name, _, _): name
        }
    }

    private enum Keys: String, CodingKey { case kind, name, path, source }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        let kind = try c.decode(String.self, forKey: .kind)
        let name = try c.decode(String.self, forKey: .name)
        let path = try c.decode(String.self, forKey: .path)
        switch kind {
        case "group": self = .group(name: name, path: path)
        case "workspace":
            self = .workspace(name: name, path: path, source: try c.decodeIfPresent(String.self, forKey: .source))
        default: throw UnknownVariant(kind: "workspace entry", value: kind)
        }
    }
}

public enum SendMode: String, Sendable {
    /// A prompt when idle; a follow-up while the agent works.
    case prompt
    case steer
    case followUp = "follow_up"
}

/// A request on a `view` connection (without its id).
public enum Request: Sendable, Hashable {
    case sessionsList
    case sessionsSubscribe
    case daemonState
    case daemonKeepAwake(Bool)
    /// Switches host logging until the policy expires or the daemon restarts.
    case daemonLogging(LoggingPolicy)
    /// Folders under the daemon's roots, one level (the roots when `path` is nil).
    case workspacesBrowse(path: String?)
    case sessionStart(workspace: String, mode: LaunchMode, prompt: String?)
    case sessionStop(SessionKey)
    case sessionWatch(SessionKey, from: UInt64?, limit: Int?)
    case sessionUnwatch(SessionKey)
    case sessionHistory(SessionKey, before: ItemID, limit: Int?)
    case sessionToolOutput(SessionKey, callID: String)
    /// One image's data, by the id in its reference block.
    case sessionImage(SessionKey, image: ImageID)
    /// `messageID` is this client's id for the message: the daemon passes a message to pi once however often it's sent
    /// with the same id, so a send whose reply was lost can be repeated safely.
    case sessionSend(SessionKey, messageID: String, text: String, mode: SendMode)
    case sessionAbort(SessionKey)
    case sessionAnswer(SessionKey, requestID: String, answer: DialogAnswer)

    /// The request as a JSON object with `id`.
    public func json(id: String) -> JSON {
        var fields: [String: JSON] = ["id": .string(id)]
        func session(_ key: SessionKey) { fields["session"] = .integer(Int64(key)) }
        switch self {
        case .sessionsList:
            fields["type"] = .string("sessions.list")
        case .daemonState:
            fields["type"] = .string("daemon.state")
        case .daemonKeepAwake(let on):
            fields["type"] = .string("daemon.keep_awake")
            fields["on"] = .bool(on)
        case .daemonLogging(let policy):
            fields["type"] = .string("daemon.logging")
            // Encoding a plain Codable enum can't fail.
            fields["policy"] = try! JSONDecoder().decode(JSON.self, from: JSONEncoder().encode(policy))
        case .sessionsSubscribe:
            fields["type"] = .string("sessions.subscribe")
        case .workspacesBrowse(let path):
            fields["type"] = .string("workspaces.browse")
            if let path { fields["path"] = .string(path) }
        case .sessionStart(let workspace, let mode, let prompt):
            fields["type"] = .string("session.start")
            fields["workspace"] = .string(workspace)
            fields["mode"] = .string(mode.rawValue)
            if let prompt { fields["prompt"] = .string(prompt) }
        case .sessionStop(let key):
            fields["type"] = .string("session.stop")
            session(key)
        case .sessionWatch(let key, let from, let limit):
            fields["type"] = .string("session.watch")
            session(key)
            if let from { fields["from"] = .integer(Int64(from)) }
            if let limit { fields["limit"] = .integer(Int64(limit)) }
        case .sessionUnwatch(let key):
            fields["type"] = .string("session.unwatch")
            session(key)
        case .sessionHistory(let key, let before, let limit):
            fields["type"] = .string("session.history")
            session(key)
            fields["before"] = .integer(Int64(before))
            if let limit { fields["limit"] = .integer(Int64(limit)) }
        case .sessionToolOutput(let key, let callID):
            fields["type"] = .string("session.tool_output")
            session(key)
            fields["call_id"] = .string(callID)
        case .sessionImage(let key, let image):
            fields["type"] = .string("session.image")
            session(key)
            fields["image"] = .integer(Int64(image))
        case .sessionSend(let key, let messageID, let text, let mode):
            fields["type"] = .string("session.send")
            session(key)
            fields["message_id"] = .string(messageID)
            fields["text"] = .string(text)
            fields["mode"] = .string(mode.rawValue)
        case .sessionAbort(let key):
            fields["type"] = .string("session.abort")
            session(key)
        case .sessionAnswer(let key, let requestID, let answer):
            fields["type"] = .string("session.answer")
            session(key)
            fields["request_id"] = .string(requestID)
            fields["answer"] = answer.json
        }
        return .object(fields)
    }
}

/// The hello that opens a `view` connection.
public func viewHello(client: String) -> JSON {
    .object(["protocol": .string("view"), "version": .integer(Int64(protocolVersion)), "client": .string(client)])
}
