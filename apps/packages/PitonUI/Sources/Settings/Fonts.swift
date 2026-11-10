import CoreText
import Foundation

#if canImport(UIKit)
    import UIKit
#else
    import AppKit
#endif

/// Fonts for the Appearance settings. The Mac lists the fonts installed on it. On the phone, fonts the user owns (a paid
/// one like Berkeley Mono can't be bundled) are imported from files: copied into this app's Application Support on
/// this device and registered for the app's process at launch.
public enum FontLibrary {
    public enum ImportError: Error, Equatable {
        /// The file isn't a font CoreText can read.
        case notAFont(file: String)
        /// The file couldn't be read or stored.
        case storage(file: String, code: Int)
    }

    static var directory: URL {
        URL.applicationSupportDirectory.appending(path: "Fonts", directoryHint: .isDirectory)
    }

    /// Registers every imported font file. Call once at launch, before any view asks for the fonts.
    public static func registerImported() {
        for file in importedFiles() {
            CTFontManagerRegisterFontsForURL(file as CFURL, .process, nil)
        }
    }

    /// Copies font files into the app and registers them; returns their families.
    static func importFiles(_ urls: [URL]) throws(ImportError) -> [String] {
        var families: Set<String> = []
        for url in urls {
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            let found = Self.families(in: url)
            guard !found.isEmpty else { throw .notAFont(file: url.lastPathComponent) }
            let target = directory.appending(path: url.lastPathComponent)
            do {
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                if FileManager.default.fileExists(atPath: target.path) {
                    CTFontManagerUnregisterFontsForURL(target as CFURL, .process, nil)
                    try FileManager.default.removeItem(at: target)
                }
                try FileManager.default.copyItem(at: url, to: target)
            } catch {
                throw .storage(file: url.lastPathComponent, code: (error as NSError).code)
            }
            CTFontManagerRegisterFontsForURL(target as CFURL, .process, nil)
            families.formUnion(found)
        }
        return families.sorted()
    }

    /// Removes every imported font file. Fonts already in use stay registered until the app restarts.
    static func removeImported() {
        for file in importedFiles() {
            CTFontManagerUnregisterFontsForURL(file as CFURL, .process, nil)
            try? FileManager.default.removeItem(at: file)
        }
    }

    /// Families of the imported files.
    static func importedFamilies() -> [String] {
        Set(importedFiles().flatMap(families(in:))).sorted()
    }

    /// Every family the app can use: installed (and imported) ones.
    static func availableFamilies() -> [String] {
        #if canImport(UIKit)
            UIFont.familyNames.sorted()
        #else
            NSFontManager.shared.availableFontFamilies.sorted()
        #endif
    }

    private static func importedFiles() -> [URL] {
        (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
    }

    private static func families(in url: URL) -> [String] {
        let descriptors = (CTFontManagerCreateFontDescriptorsFromURL(url as CFURL) as? [CTFontDescriptor]) ?? []
        return descriptors.compactMap { CTFontDescriptorCopyAttribute($0, kCTFontFamilyNameAttribute) as? String }
    }
}
