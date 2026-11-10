import Foundation
import Testing

@testable import PitonKit

// The fixtures are written by the daemon's tests (`fixtures` in daemon/src/view.rs). A protocol change the Swift types
// don't follow fails here.

private func fixture(_ name: String) throws -> Data {
    let url = try #require(Bundle.module.url(forResource: name, withExtension: nil, subdirectory: "Fixtures"))
    return try Data(contentsOf: url)
}

private func lines(_ name: String) throws -> [Data] {
    try String(decoding: fixture(name), as: UTF8.self)
        .split(separator: "\n")
        .map { Data($0.utf8) }
}

private let decoder = JSONDecoder()

@Test func protocolVersionMatchesDaemon() {
    #expect(protocolVersion == 1)
}

@Test func decodesSnapshots() throws {
    let empty = try decoder.decode(Incoming.self, from: fixture("snapshot-empty.json"))
    guard case .snapshot(let e) = empty else {
        Issue.record("not a snapshot")
        return
    }
    #expect(e.items.isEmpty)
    #expect(e.state == nil)

    let line = try decoder.decode(Incoming.self, from: fixture("snapshot.json"))
    guard case .snapshot(let snapshot) = line else {
        Issue.record("not a snapshot")
        return
    }
    #expect(snapshot.session == 7)
    #expect(snapshot.items.count == 5)
    let state = try #require(snapshot.state)
    #expect(state.status == .needsInput)
    #expect(state.mode == .sandbox)
    #expect(state.title == "run it")
    #expect(state.dialogs.first?.method == .select)
    #expect(state.dialogs.first?.options == ["Allow", "Block"])
    #expect(state.dialogs.first?.timeout == 30000)
}

@Test func changesRebuildTheSnapshot() throws {
    var model = SessionModel(session: 7)
    try model.apply(try decodeSnapshot("snapshot-empty.json"))
    var sawReset = false
    for data in try lines("changes.jsonl") {
        guard case .change(let change) = try decoder.decode(Incoming.self, from: data) else {
            Issue.record("not a change")
            return
        }
        if case .reset = change.change {
            sawReset = true
            #expect(model.items.count == 5, "before the reset, changes alone rebuilt every item")
            let snapshot = try decodeSnapshot("snapshot.json")
            #expect(model.items == snapshot.items, "changes applied in order equal the snapshot")
            #expect(model.state == snapshot.state)
        }
        try model.apply(change)
    }
    #expect(sawReset)
    #expect(model.awaitingSnapshot)
    #expect(model.items.isEmpty)
}

@Test func streamingDeltasAccumulate() throws {
    var model = SessionModel(session: 7)
    try model.apply(try decodeSnapshot("snapshot-empty.json"))
    for data in try lines("changes.jsonl").prefix(5) {
        guard case .change(let change) = try decoder.decode(Incoming.self, from: data) else { return }
        try model.apply(change)
    }
    guard case .assistant(let message) = model.items.last else {
        Issue.record("no assistant item")
        return
    }
    #expect(message.streaming)
    #expect(message.content.first?["text"]?.string == "Running")
}

@Test func imageNotesAreStripped() {
    let note =
        "[Image: original 3604x2440, displayed at 2000x1354. Multiply coordinates by 1.80 to map to original image.]"
    #expect(ImageNotes.strip("look at this\n\n\(note)\n\(note)") == "look at this")
    #expect(ImageNotes.strip("[Image converted from image/heic to image/png.]\n\(note)") == "")
    #expect(ImageNotes.strip("Read image file [image/png]\n\(note)") == "Read image file [image/png]")
    #expect(ImageNotes.strip("see [Image: original 1x1] here") == "see [Image: original 1x1] here")
    #expect(ImageNotes.strip("  untouched  ") == "  untouched  ")
}

@Test func imagesFitTheirNaturalSizeOrTheBounds() {
    let bounds = CGSize(width: 1000, height: 800)
    // A Retina screenshot on a Retina screen: half its pixels, not shrunk further.
    #expect(
        ImageFit.size(pixels: CGSize(width: 1200, height: 800), scale: 2, within: bounds)
            == CGSize(width: 600, height: 400))
    // Larger than the bounds: fitted, proportions kept.
    #expect(
        ImageFit.size(pixels: CGSize(width: 4000, height: 2000), scale: 2, within: bounds)
            == CGSize(width: 1000, height: 500))
    #expect(
        ImageFit.size(pixels: CGSize(width: 1000, height: 3200), scale: 2, within: bounds)
            == CGSize(width: 250, height: 800))
    #expect(ImageFit.size(pixels: .zero, scale: 2, within: bounds) == .zero)
}

@Test func imageWindowsSitJustAboveCenterButNoHigherThanAFullOne() {
    func anchor(_ height: CGFloat) -> CGFloat { ImageFit.verticalAnchor(height: height, available: 1000) }
    // The largest window (80%): its top at 10%, exactly centered.
    #expect(abs(anchor(800) - 0.5) < 0.0001)
    // A small one: 40% of the free space above it, so a little above center.
    #expect(abs(anchor(200) - 0.4) < 0.0001)
    // A large one would sit above 10% at 40% (top at 88): its top is held at 10%.
    #expect(abs(anchor(780) - 100.0 / 220) < 0.0001)
    // No room to move: centered.
    #expect(ImageFit.verticalAnchor(height: 1000, available: 1000) == 0.5)
}

@Test func activityFollowsTheNewestBlock() throws {
    func message(_ blocks: [String], streaming: Bool) throws -> AssistantItem {
        let content = blocks.map { #"{"type":"\#($0)","\#($0)":"x"}"# }.joined(separator: ",")
        let json = #"{"id":1,"content":[\#(content)],"streaming":\#(streaming)}"#
        return try decoder.decode(AssistantItem.self, from: Data(json.utf8))
    }
    #expect(try message([], streaming: true).activity == .responding)
    #expect(try message(["thinking"], streaming: true).activity == .thinking)
    #expect(try message(["thinking", "text"], streaming: true).activity == .responding)
    #expect(try message(["text", "thinking"], streaming: true).activity == .thinking)
    #expect(try message(["thinking"], streaming: false).activity == .finished)
    #expect(try message(["thinking", "text", "text"], streaming: false).text == "x\n\nx")
}

@Test func toolsLinkToTheirMessage() throws {
    let snapshot = try decodeSnapshot("snapshot.json")
    var model = SessionModel(session: 7)
    try model.apply(snapshot)
    guard case .assistant(let message) = model.items[1] else {
        Issue.record("item 1 isn't the assistant message")
        return
    }
    let tools = model.tools(of: message.id)
    #expect(tools.count == 1)
    #expect(tools.first?.name == "bash")
    #expect(tools.first?.status == .done)
    #expect(tools.first?.preview == "a\nb")
    #expect(tools.first?.args["command"]?.string == "ls")
}

@Test func gapsAreDetected() throws {
    var model = SessionModel(session: 7)
    try model.apply(try decodeSnapshot("snapshot-empty.json"))
    let all = try lines("changes.jsonl")
    guard case .change(let second) = try decoder.decode(Incoming.self, from: all[1]) else { return }
    #expect(throws: SessionModel.ApplyError.gap(expected: 1, got: 2)) { try model.apply(second) }
}

@Test func historyPrepends() throws {
    let history = try decoder.decode(History.self, from: fixture("history.json"))
    #expect(history.items.count == 2)
    #expect(!history.hasMore)
    var model = SessionModel(session: 7)
    let snapshot = try decodeSnapshot("snapshot.json")
    try model.apply(snapshot)
    model.prepend(history)
    #expect(model.items.count == snapshot.items.count, "known items aren't duplicated")
}

@Test func decodesDaemonState() throws {
    guard case .daemon(let state) = try decoder.decode(Incoming.self, from: fixture("daemon.json")) else {
        Issue.record("not a daemon line")
        return
    }
    #expect(state.version == "0.1.0 (abc1234567)")
    #expect(state.keepAwake && state.awake && state.sessions == 2)
    #expect(
        state.logging
            == HostLogging(policy: .debug(expiration: .until(unixMS: 1234)), default: .info))
}

@Test func groupsSessionsByProjectWithWorkersAfterTheSource() throws {
    func session(_ key: SessionKey, _ workspace: String, _ checkout: Checkout, _ status: SessionStatus) throws
        -> SessionInfo
    {
        var fields: [String: JSON] = [
            "key": .integer(Int64(key)), "workspace": .string(workspace), "mode": .string("sandbox"),
            "status": .string(status.rawValue), "clients": .integer(0),
        ]
        fields["checkout"] = try JSONDecoder().decode(JSON.self, from: JSONEncoder().encode(checkout))
        return try JSON.object(fields).decode(SessionInfo.self)
    }
    let groups = Store.group([
        try session(1, "/p/app", .source, .idle),
        try session(2, "/p/app--fix", .worker(source: "/p/app", name: "fix"), .idle),
        try session(3, "/p/app--add", .worker(source: "/p/app", name: "add"), .idle),
        // A project whose own name contains the separator is still a project, not a worker of `site`.
        try session(4, "/p/site--v2", .source, .needsInput),
        try session(5, "/p/app", .source, .working),
    ])
    #expect(groups.map(\.name) == ["site--v2", "app"], "the project with a session needing input first")
    let app = groups[1]
    #expect(app.checkouts.map(\.workspace) == ["/p/app", "/p/app--add", "/p/app--fix"])
    #expect(app.checkouts[0].sessions.map(\.key) == [5, 1], "working before idle")
    #expect(app.sessionCount == 4)
}

@Test func decodesSessionsAndReplies() throws {
    guard case .sessions(let sessions) = try decoder.decode(Incoming.self, from: fixture("sessions.json")) else {
        Issue.record("not a session list")
        return
    }
    #expect(sessions.first?.key == 7)
    #expect(sessions.first?.status == .working)
    #expect(sessions.first?.title == "run it")
    #expect(sessions.first?.checkout == .worker(source: "/Users/me/Projects/app", name: "fix-login"))
    #expect(sessions.first?.project == "/Users/me/Projects/app")

    let replies = try lines("replies.jsonl").map { try decoder.decode(Incoming.self, from: $0) }
    #expect(replies[0] == .reply(.ok(id: .string("r1"), data: .object([:]))))
    guard case .reply(.ok(.number(2), let data)) = replies[1] else {
        Issue.record("reply 2")
        return
    }
    #expect(data["session"]?["key"] == .integer(7))
    #expect(replies[2] == .reply(.failed(id: .string("r3"), error: "no live session 9")))
}

@Test func unknownVariantsFailLoudly() {
    let line = Data(#"{"type":"change","session":1,"seq":1,"change":{"op":"teleport"}}"#.utf8)
    #expect(throws: (any Error).self) { try decoder.decode(Incoming.self, from: line) }
}

@Test func requestsEncodeTheWireShape() throws {
    let encoded = try JSONEncoder().encode(
        Request.sessionAnswer(7, requestID: "d1", answer: .value("Allow")).json(id: "x"))
    let back = try decoder.decode(JSON.self, from: encoded)
    #expect(back["type"]?.string == "session.answer")
    #expect(back["session"] == .integer(7))
    #expect(String(decoding: encoded, as: UTF8.self).contains(#""session":7"#), "integers encode without a fraction")
    #expect(back["answer"]?["value"]?.string == "Allow")
    let send = Request.sessionSend(7, messageID: "m1", text: "hi", mode: .followUp).json(id: "y")
    #expect(send["mode"]?.string == "follow_up")
    #expect(send["message_id"]?.string == "m1")
}

@Test func contentBlocksAreTyped() throws {
    let content: JSON = try JSONDecoder().decode(
        JSON.self,
        from: Data(
            #"""
            [{"type":"text","text":"look\n[Image converted from image/heic to image/png.]"},
             {"type":"image","image":3,"mime_type":"image/png"},
             {"type":"thinking","thinking":"hm"},
             {"type":"toolCall","id":"c1","name":"bash","arguments":{"command":"ls"}},
             {"type":"future"}]
            """#.utf8))
    let blocks = ContentBlock.blocks(of: content)
    #expect(blocks.text() == "look", "pi's image notes are dropped")
    #expect(blocks.images.map(\.id) == [3])
    guard case .toolCall(let id, let name, let arguments) = blocks[3] else {
        Issue.record("not a tool call")
        return
    }
    #expect(id == "c1" && name == "bash" && arguments["command"]?.string == "ls")
    guard case .other = blocks[4] else {
        Issue.record("unknown blocks pass through")
        return
    }
    #expect(ContentBlock.blocks(of: .string("plain")).text() == "plain")
}

@Test func imagesArriveAsReferences() throws {
    let snapshot = try decodeSnapshot("snapshot-images.json")
    guard case .user(let user) = snapshot.items.first else {
        Issue.record("not a user item")
        return
    }
    let refs = user.blocks.images
    #expect(refs.map(\.id) == [1])
    #expect(refs.first?.mimeType == "image/png")
    guard case .tool(let tool) = snapshot.items.last else {
        Issue.record("not a tool item")
        return
    }
    #expect(tool.truncated, "an image-only output offers the full output")

    guard case .reply(.ok(_, let data)) = try decoder.decode(Incoming.self, from: fixture("image.json")) else {
        Issue.record("not a reply")
        return
    }
    let image = try data.decode(ImageData.self)
    #expect(image.mimeType == "image/png")
    #expect(image.bytes == Data(base64Encoded: "AAAA"))

    let request = Request.sessionImage(8, image: 1).json(id: "c9")
    #expect(request["type"]?.string == "session.image")
    #expect(request["image"] == .integer(1))
}

private func decodeSnapshot(_ name: String) throws -> Snapshot {
    guard case .snapshot(let snapshot) = try decoder.decode(Incoming.self, from: fixture(name)) else {
        throw UnknownVariant(kind: "fixture", value: name)
    }
    return snapshot
}

@Test func tailnetSessionUsesSystemProxiesAndNoRequestTimeout() {
    let configuration = WebSocketTransport.configuration()
    #expect(configuration.connectionProxyDictionary == nil, "system proxy settings apply, as for any app")
    #expect(configuration.timeoutIntervalForRequest.isInfinite)
    #expect(configuration.timeoutIntervalForResource.isInfinite)
    #expect(!configuration.waitsForConnectivity)
}

@Test func proxyDescriptions() {
    #expect(WebSocketTransport.describeProxies([]) == "none")
    #expect(WebSocketTransport.describeProxies([[kCFProxyTypeKey: kCFProxyTypeNone]]) == "none")
    #expect(
        WebSocketTransport.describeProxies([
            [kCFProxyTypeKey: kCFProxyTypeHTTP, kCFProxyHostNameKey: "proxy.lan", kCFProxyPortNumberKey: 8080],
            [kCFProxyTypeKey: kCFProxyTypeNone],
        ]) == "http:proxy.lan:8080,none")
    #expect(
        WebSocketTransport.describeProxies([
            [
                kCFProxyTypeKey: kCFProxyTypeAutoConfigurationURL,
                kCFProxyAutoConfigurationURLKey: URL(string: "http://wpad/wpad.dat")!,
            ]
        ]) == "pac:http://wpad/wpad.dat")
}

@Test func pingHandlerCalledTwiceResumesOnce() async {
    // URLSession called sendPing's handler twice when a daemon restart dropped the connection mid-ping, which
    // crashed the app (CheckedContinuation resumed twice).
    let alive = await withCheckedContinuation { (continuation: CheckedContinuation<Bool, Never>) in
        let once = WebSocketTransport.Once(continuation)
        #expect(once.resume(returning: true))
        #expect(!once.resume(returning: false), "only the winning callback should log a ping outcome")
    }
    #expect(alive)
}

@Test func diagnosticsKeepNetworkCodesWithoutSensitiveDetails() {
    let underlying = NSError(
        domain: NSPOSIXErrorDomain, code: 60,
        userInfo: [NSLocalizedDescriptionKey: "secret underlying description"])
    let error = NSError(
        domain: NSURLErrorDomain, code: NSURLErrorTimedOut,
        userInfo: [
            NSLocalizedDescriptionKey: "secret message",
            NSURLErrorFailingURLErrorKey: URL(string: "https://user:password@example.com/private")!,
            NSUnderlyingErrorKey: underlying,
        ])
    #expect(Diagnostics.failure(error) == "NSURLErrorDomain:-1001 <- NSPOSIXErrorDomain:60")
    #expect(Diagnostics.failure(Connection.RequestError.refused("secret daemon reply")) == "daemon_refused")
    #expect(Diagnostics.failure(Connection.RequestError.badReply("secret payload")) == "bad_reply")
    #expect(Diagnostics.failure(Connection.RequestError.disconnected) == "disconnected")
    #expect(Diagnostics.failure(WebSocketTransport.WebSocketError.refused("secret URL")) == "websocket_open_failed")
    #expect(Diagnostics.failure(WebSocketTransport.WebSocketError.closed) == "websocket_closed")
}

@Test func diagnosticsBoundUnderlyingErrorChains() {
    var error = NSError(domain: NSPOSIXErrorDomain, code: 60)
    for _ in 0..<10 {
        error = NSError(domain: NSURLErrorDomain, code: -1001, userInfo: [NSUnderlyingErrorKey: error])
    }
    #expect(Diagnostics.failure(error).components(separatedBy: " <- ").count == 3)
}
