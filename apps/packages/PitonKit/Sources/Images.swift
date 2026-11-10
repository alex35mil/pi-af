import CoreGraphics
import Foundation

/// pi's notes about the images it sends to the model. When it resizes or converts a prompt or tool-result image, pi adds
/// a line for the model (`[Image: original 3604x2440, displayed at 2000x1354. Multiply coordinates by 1.80 …]`,
/// `[Image converted from image/heic to image/png.]`): appended to the prompt's text, or as a text block of the tool
/// result. They describe the model's copy, not the user's image, so the apps don't show them.
public enum ImageNotes {
    /// `text` without pi's resize and conversion notes. Unchanged when it has none.
    public static func strip(_ text: String) -> String {
        let lines = text.split(separator: "\n", omittingEmptySubsequences: false)
        let kept = lines.filter { !isNote($0) }
        guard kept.count < lines.count else { return text }
        return kept.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// pi 1.3.0's wording (`formatDimensionNote` and `conversionHint` in pi's image utilities).
    static func isNote(_ line: Substring) -> Bool {
        let resized =
            /\[Image: original \d+x\d+, displayed at \d+x\d+\. Multiply coordinates by \d+(\.\d+)? to map to original image\.\]/
        let converted = /\[Image converted from \S+ to \S+\.\]/
        return line.wholeMatch(of: resized) != nil || line.wholeMatch(of: converted) != nil
    }
}

/// Where an image opens at full size.
public enum ImageFit {
    /// The share of the Mac's screen (visible area, each side) an image window may take.
    public static let screenShare: CGFloat = 0.8

    /// Where a window of `height` sits vertically in a screen area of `available` height, as the share of the free
    /// space above it (0 top, 0.5 centered): a little above center, where it looks centered, but never higher than a
    /// window of the largest size would sit, so a window that takes the whole share is exactly centered.
    public static func verticalAnchor(height: CGFloat, available: CGFloat) -> CGFloat {
        let free = available - height
        guard free > 0 else { return 0.5 }
        let optical = free * 0.4
        let highest = available * (1 - screenShare) / 2
        return min(max(optical, highest), free) / free
    }

    /// The size to show an image at: its natural size in points (`pixels` over the screen's `scale`, so a Retina
    /// screenshot isn't doubled), scaled down, keeping its proportions, when it doesn't fit `bounds`.
    public static func size(pixels: CGSize, scale: CGFloat, within bounds: CGSize) -> CGSize {
        guard pixels.width > 0, pixels.height > 0, scale > 0 else { return .zero }
        let natural = CGSize(width: pixels.width / scale, height: pixels.height / scale)
        let factor = min(1, bounds.width / natural.width, bounds.height / natural.height)
        return CGSize(width: (natural.width * factor).rounded(), height: (natural.height * factor).rounded())
    }
}
