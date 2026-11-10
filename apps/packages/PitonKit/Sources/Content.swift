import Foundation

/// One block of pi content, as the apps use it. Items keep pi's content as JSON (the view protocol passes it through and
/// streams deltas into it); this is the one place that reads it, so views match blocks instead of parsing JSON.
public enum ContentBlock: Sendable, Hashable {
    case text(String)
    case thinking(String)
    case toolCall(id: String?, name: String?, arguments: JSON)
    /// A reference to an image the daemon holds (`session.image`); items never carry image data.
    case image(ImageRef)
    /// A block type the apps don't show (or a block still being streamed in).
    case other(JSON)

    public init(_ block: JSON) {
        switch block["type"]?.string {
        case "text": self = .text(block["text"]?.string ?? "")
        case "thinking": self = .thinking(block["thinking"]?.string ?? "")
        case "toolCall":
            self = .toolCall(
                id: block["id"]?.string, name: block["name"]?.string, arguments: block["arguments"] ?? .null)
        case "image": self = ImageRef(block: block).map(Self.image) ?? .other(block)
        default: self = .other(block)
        }
    }

    /// pi's content (a string, or an array of blocks) as blocks.
    public static func blocks(of content: JSON) -> [ContentBlock] {
        switch content {
        case .string(let text): [.text(text)]
        case .array(let blocks): blocks.map(ContentBlock.init)
        case .null, .bool, .integer, .number, .object: []
        }
    }
}

extension Array where Element == ContentBlock {
    /// The text blocks joined by `separator`, without pi's notes to the model about images it resized or converted.
    public func text(separator: String = "\n") -> String {
        let text = compactMap { block -> String? in
            switch block {
            case .text(let text): text
            case .thinking, .toolCall, .image, .other: nil
            }
        }
        return ImageNotes.strip(text.joined(separator: separator))
    }

    public var images: [ImageRef] {
        compactMap { block in
            switch block {
            case .image(let ref): ref
            case .text, .thinking, .toolCall, .other: nil
            }
        }
    }
}

/// An image reference block in pi content.
public struct ImageRef: Sendable, Hashable, Identifiable {
    public let id: ImageID
    public let mimeType: String?

    /// The reference in a content block, or nil when the block isn't one.
    init?(block: JSON) {
        guard block["type"]?.string == "image", case .integer(let id)? = block["image"], id >= 0 else { return nil }
        self.id = ImageID(id)
        mimeType = block["mime_type"]?.string
    }
}
