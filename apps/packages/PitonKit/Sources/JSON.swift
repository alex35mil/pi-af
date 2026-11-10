import Foundation

/// An arbitrary JSON value: pi's content blocks, tool arguments and results, and dialog records pass through the view
/// protocol unmodeled (piton models structure, not content). Integers are kept apart from other numbers so ids and keys
/// round-trip exactly (the daemon rejects `7.0` where it expects `7`).
public enum JSON: Sendable, Hashable {
    case null
    case bool(Bool)
    case integer(Int64)
    case number(Double)
    case string(String)
    case array([JSON])
    case object([String: JSON])

    public subscript(key: String) -> JSON? {
        switch self {
        case .object(let map): map[key]
        case .null, .bool, .integer, .number, .string, .array: nil
        }
    }

    public subscript(index: Int) -> JSON? {
        switch self {
        case .array(let items): items.indices.contains(index) ? items[index] : nil
        case .null, .bool, .integer, .number, .string, .object: nil
        }
    }

    public var string: String? {
        switch self {
        case .string(let s): s
        case .null, .bool, .integer, .number, .array, .object: nil
        }
    }

    public var array: [JSON]? {
        switch self {
        case .array(let items): items
        case .null, .bool, .integer, .number, .string, .object: nil
        }
    }

    /// Decodes a typed value from this JSON (for reply data).
    public func decode<T: Decodable>(_ type: T.Type) throws -> T {
        try JSONDecoder().decode(type, from: JSONEncoder().encode(self))
    }
}

extension JSON: Codable {
    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let b = try? container.decode(Bool.self) {
            self = .bool(b)
        } else if let i = try? container.decode(Int64.self) {
            self = .integer(i)
        } else if let n = try? container.decode(Double.self) {
            self = .number(n)
        } else if let s = try? container.decode(String.self) {
            self = .string(s)
        } else if let a = try? container.decode([JSON].self) {
            self = .array(a)
        } else {
            self = .object(try container.decode([String: JSON].self))
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .null: try container.encodeNil()
        case .bool(let b): try container.encode(b)
        case .integer(let i): try container.encode(i)
        case .number(let n): try container.encode(n)
        case .string(let s): try container.encode(s)
        case .array(let a): try container.encode(a)
        case .object(let o): try container.encode(o)
        }
    }
}
