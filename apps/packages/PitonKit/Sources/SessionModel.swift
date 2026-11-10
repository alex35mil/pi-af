import Foundation

/// One session's view as a client sees it: apply the daemon's snapshot, then its changes in order.
public struct SessionModel: Sendable, Hashable {
    public let session: SessionKey
    public private(set) var items: [Item] = []
    public private(set) var state: ViewState?
    /// The last applied `seq`; send it as `from` when re-watching after a drop.
    public private(set) var seq: UInt64 = 0
    public private(set) var hasMore = false
    /// Set by a `reset` until the next snapshot: the items are stale.
    public private(set) var awaitingSnapshot = true

    public init(session: SessionKey) {
        self.session = session
    }

    public enum ApplyError: Error, Equatable {
        /// A change arrived out of order; re-watch from `seq` (or without `from`).
        case gap(expected: UInt64, got: UInt64)
        /// A change references an item the model doesn't have.
        case unknownItem(ItemID)
        case wrongSession(SessionKey)
    }

    public mutating func apply(_ snapshot: Snapshot) throws(ApplyError) {
        guard snapshot.session == session else { throw .wrongSession(snapshot.session) }
        items = snapshot.items
        state = snapshot.state
        seq = snapshot.seq
        hasMore = snapshot.hasMore
        awaitingSnapshot = false
    }

    public mutating func apply(_ line: ChangeLine) throws(ApplyError) {
        guard line.session == session else { throw .wrongSession(line.session) }
        guard line.seq == seq + 1 else { throw .gap(expected: seq + 1, got: line.seq) }
        seq = line.seq
        switch line.change {
        case .append(let item):
            items.append(item)
        case .replace(let item):
            guard let index = items.lastIndex(where: { $0.id == item.id }) else { throw .unknownItem(item.id) }
            items[index] = item
        case .delta(let id, let index, let field, let text):
            guard let position = items.lastIndex(where: { $0.id == id }),
                case .assistant(var message) = items[position]
            else { throw .unknownItem(id) }
            while message.content.count <= index { message.content.append(.null) }
            let key =
                switch field {
                case .text: "text"
                case .thinking: "thinking"
                }
            var block: [String: JSON] =
                switch message.content[index] {
                case .object(let map): map
                case .null, .bool, .integer, .number, .string, .array: ["type": .string(key)]
                }
            block[key] = .string((block[key]?.string ?? "") + text)
            message.content[index] = .object(block)
            items[position] = .assistant(message)
        case .state(let newState):
            state = newState
        case .reset:
            items = []
            awaitingSnapshot = true
        }
    }

    /// Older items from `session.history`, prepended.
    public mutating func prepend(_ history: History) {
        let known = Set(items.map(\.id))
        items.insert(contentsOf: history.items.filter { !known.contains($0.id) }, at: 0)
        hasMore = history.hasMore
    }

    /// The tool items of an assistant item, in order.
    public func tools(of message: ItemID) -> [ToolItem] {
        items.compactMap { item in
            switch item {
            case .tool(let tool) where tool.message == message: tool
            case .user, .assistant, .tool, .summary, .notice, .other: nil
            }
        }
    }
}
