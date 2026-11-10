import Foundation
import Testing

@testable import PitonKit

private func temporaryLoggingDirectory() throws -> URL {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("piton-logging-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
}

@Test func loggingPolicyUsesTheDaemonWireShape() throws {
    let file = try #require(
        Bundle.module.url(forResource: "logging-policies", withExtension: "json", subdirectory: "Fixtures"))
    let data = try Data(contentsOf: file)
    let policies = try JSONDecoder().decode([LoggingPolicy].self, from: data)
    #expect(policies == [.info, .debug(expiration: .manual), .debug(expiration: .until(unixMS: 1234))])
    #expect(
        try JSONDecoder().decode(JSON.self, from: JSONEncoder().encode(policies))
            == JSONDecoder().decode(JSON.self, from: data))
}

@Test func expiryDoesNotExtendOnRestart() throws {
    let now = Date(timeIntervalSince1970: 100)
    let policy = LoggingPolicy.forOneHour(now: now)
    let restored = try JSONDecoder().decode(LoggingPolicy.self, from: JSONEncoder().encode(policy))
    #expect(restored.effective(now: now.addingTimeInterval(3599)) == policy)
    #expect(restored.effective(now: now.addingTimeInterval(3600)) == .info)
    #expect(
        LoggingPolicy.debug(expiration: .manual).effective(now: .distantFuture)
            == .debug(expiration: .manual))
}

@Test func infoLevelCapturesOnlyInfoRecords() async throws {
    let dir = try temporaryLoggingDirectory()
    defer { try? FileManager.default.removeItem(at: dir) }
    let logging = AppLogging(
        directory: dir.appendingPathComponent("files"),
        source: .stored(settings: dir.appendingPathComponent("settings.json")))
    logging.record("detailed event")
    logging.record("info event", detail: .info)
    await logging.drain()
    let captured = try String(contentsOf: logging.directory.appendingPathComponent("current.log"), encoding: .utf8)
    #expect(captured.contains("info event"))
    #expect(!captured.contains("detailed event"))
}

@Test func disablingAndClearingAreIndependent() async throws {
    let dir = try temporaryLoggingDirectory()
    defer { try? FileManager.default.removeItem(at: dir) }
    let settings = dir.appendingPathComponent("settings.json")
    let logging = AppLogging(directory: dir.appendingPathComponent("files"), source: .stored(settings: settings))
    try await logging.setPolicy(.debug(expiration: .manual))
    logging.record("captured event")
    await logging.drain()
    let file = logging.directory.appendingPathComponent("current.log")
    #expect(try String(contentsOf: file, encoding: .utf8).contains("captured event"))
    try await logging.setPolicy(.info)
    await logging.drain()
    let before = try Data(contentsOf: file)
    logging.record("must not capture")
    await logging.drain()
    #expect(try Data(contentsOf: file) == before)
    try await logging.clear()
    #expect(logging.policy == .info)
    #expect(try FileManager.default.contentsOfDirectory(atPath: logging.directory.path).isEmpty)
    #expect(FileManager.default.fileExists(atPath: settings.path))
}

@Test func hostSourceFollowsTheDaemonAndStoresNothing() async throws {
    let dir = try temporaryLoggingDirectory()
    defer { try? FileManager.default.removeItem(at: dir) }
    let logging = AppLogging(directory: dir.appendingPathComponent("files"), source: .host)
    #expect(logging.policy == .info, "info until the daemon reports its policy")
    await #expect(throws: AppLogging.LoggingError.hostControlled) {
        try await logging.setPolicy(.debug(expiration: .manual))
    }
    logging.follow(.debug(expiration: .manual))
    logging.record("detailed event")
    await logging.drain()
    #expect(
        try String(contentsOf: logging.directory.appendingPathComponent("current.log"), encoding: .utf8)
            .contains("detailed event"))
    logging.follow(.debug(expiration: .until(unixMS: 1)))
    #expect(logging.policy == .info, "an expired host policy is info")
    #expect(try FileManager.default.contentsOfDirectory(atPath: dir.path) == ["files"], "no settings file")
}

@Test func storedSourceIgnoresTheHostPolicy() throws {
    let dir = try temporaryLoggingDirectory()
    defer { try? FileManager.default.removeItem(at: dir) }
    let logging = AppLogging(
        directory: dir.appendingPathComponent("files"),
        source: .stored(settings: dir.appendingPathComponent("settings.json")))
    logging.follow(.debug(expiration: .manual))
    #expect(logging.policy == .info)
}

@Test func expiredAndMalformedSettingsFailClosed() async throws {
    let dir = try temporaryLoggingDirectory()
    defer { try? FileManager.default.removeItem(at: dir) }
    let settings = dir.appendingPathComponent("settings.json")
    try JSONEncoder().encode(LoggingPolicy.debug(expiration: .until(unixMS: 1))).write(to: settings)
    let logging = AppLogging(directory: dir.appendingPathComponent("files"), source: .stored(settings: settings))
    #expect(logging.policy == .info)
    try Data("invalid".utf8).write(to: settings)
    let malformed = AppLogging(directory: dir.appendingPathComponent("other"), source: .stored(settings: settings))
    #expect(malformed.policy == .info)
    logging.record("expired event")
    await logging.drain()
    #expect(!FileManager.default.fileExists(atPath: logging.directory.path))
}

@Test func rotatingFilesStayBoundedAcrossRestartsAndLargeRecords() throws {
    let dir = try temporaryLoggingDirectory()
    defer { try? FileManager.default.removeItem(at: dir) }
    for _ in 0..<3 {
        let ring = RotatingLog(directory: dir, fileBytes: 64, files: 3)
        for index in 0..<100 {
            try ring.append(
                Data(repeating: 65, count: index == 0 ? 1024 : 40), now: Date(timeIntervalSince1970: Double(index)))
        }
    }
    let files = try FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.fileSizeKey])
    #expect(files.count == 3)
    for file in files { #expect(try Data(contentsOf: file).count <= 64) }
}

@Test func retryStormIsRateLimited() throws {
    let dir = try temporaryLoggingDirectory()
    defer { try? FileManager.default.removeItem(at: dir) }
    let ring = RotatingLog(directory: dir, fileBytes: 4096, files: 2)
    for _ in 0..<1000 { try ring.append(Data("event\n".utf8), now: Date(timeIntervalSince1970: 100)) }
    #expect(try String(contentsOf: ring.file(0), encoding: .utf8).split(separator: "\n").count == 20)
    try ring.append(Data("next\n".utf8), now: Date(timeIntervalSince1970: 101))
    #expect(try String(contentsOf: ring.file(0), encoding: .utf8).split(separator: "\n").count == 21)
}

@Test func unavailableStorageDoesNotBreakLogging() async throws {
    let dir = try temporaryLoggingDirectory()
    defer { try? FileManager.default.removeItem(at: dir) }
    let obstruction = dir.appendingPathComponent("not-a-directory")
    try Data().write(to: obstruction)
    let logging = AppLogging(
        directory: obstruction, source: .stored(settings: dir.appendingPathComponent("settings.json")))
    try await logging.setPolicy(.debug(expiration: .manual))
    logging.record("write cannot succeed, must not crash")
    await logging.drain()
    let brokenSettings = AppLogging(
        directory: dir, source: .stored(settings: obstruction.appendingPathComponent("settings.json")))
    await #expect(throws: AppLogging.LoggingError.self) {
        try await brokenSettings.setPolicy(.debug(expiration: .manual))
    }
}
