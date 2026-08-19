import Foundation

import PromptyModel

import XCTest

/// Focused tests for the durability adapters.
///
/// The replay vectors prove the *sequence* is right; these prove the adapters
/// behave correctly at their edges — where crash-durability, ordering, and
/// error containment actually live.
@testable import Prompty

final class HarnessAdapterTests: XCTestCase {

  // MARK: - Journal

  /// Each record must be on disk before the call returns, so a crash mid-turn
  /// still leaves a replayable prefix rather than an empty file.
  func testJournalFlushesEachRecordImmediately() throws {
    let path = Self.tempPath()
    defer { try? FileManager.default.removeItem(atPath: path) }
    let journal = JsonlEventJournalWriter(path: path)

    var first = TurnEvent(id: "e1", type: .turnStart, timestamp: "t")
    first.iteration = 0
    _ = try journal.appendTurn(turnEvent: first)

    // Read back without closing — this is the crash case.
    let midFlight = try JsonlEventJournalWriter.readRecords(path: path)
    XCTAssertEqual(midFlight.count, 1)
    XCTAssertEqual(midFlight[0]["kind"] as? String, "turn")

    var session = SessionEvent(id: "e2", type: .sessionEnd, timestamp: "t")
    session.sessionId = "s1"
    _ = try journal.appendSession(sessionEvent: session)

    var summary = SessionSummary(sessionId: "s1")
    summary.turns = 1
    _ = try journal.close(summary: summary)

    let records = try JsonlEventJournalWriter.readRecords(path: path)
    XCTAssertEqual(records.map { $0["kind"] as? String }, ["turn", "session", "summary"])
  }

  /// Closing twice must not append a second summary, or replay would see a
  /// journal that ends after it already ended.
  func testJournalCloseIsIdempotent() throws {
    let path = Self.tempPath()
    defer { try? FileManager.default.removeItem(atPath: path) }
    let journal = JsonlEventJournalWriter(path: path)

    let summary = SessionSummary(sessionId: "s1")
    _ = try journal.close(summary: summary)
    _ = try journal.close(summary: summary)

    let records = try JsonlEventJournalWriter.readRecords(path: path)
    XCTAssertEqual(records.filter { $0["kind"] as? String == "summary" }.count, 1)
  }

  /// A journal must never interleave a record across lines, even when the
  /// payload itself contains newlines.
  func testJournalEscapesEmbeddedNewlines() throws {
    let path = Self.tempPath()
    defer { try? FileManager.default.removeItem(atPath: path) }
    let journal = JsonlEventJournalWriter(path: path)

    var event = TurnEvent(id: "e1", type: .error, timestamp: "t")
    event.payload = ["message": "line one\nline two"]
    _ = try journal.appendTurn(turnEvent: event)

    let raw = try String(contentsOfFile: path, encoding: .utf8)
    XCTAssertEqual(raw.split(separator: "\n", omittingEmptySubsequences: true).count, 1)

    let records = try JsonlEventJournalWriter.readRecords(path: path)
    let payload = (records[0]["event"] as? [String: Any])?["payload"] as? [String: Any]
    XCTAssertEqual(payload?["message"] as? String, "line one\nline two")
  }

  // MARK: - Checkpoints

  /// Checkpoints must come back in creation order regardless of insertion
  /// order, because replay walks them forward.
  func testCheckpointsListInDeterministicOrder() async throws {
    let store = InMemoryCheckpointStore()

    for index in [2, 0, 1] {
      var checkpoint = Checkpoint(title: "cp\(index)")
      checkpoint.id = "cp-\(index)"
      checkpoint.sessionId = "s1"
      checkpoint.checkpointNumber = Int32(index)
      _ = try await store.save(checkpoint: checkpoint)
    }

    let listed = try await store.listCheckpoints(sessionId: "s1")
    XCTAssertEqual(listed.map { $0.id }, ["cp-0", "cp-1", "cp-2"])
  }

  /// Sessions must not read each other's checkpoints.
  func testCheckpointsAreScopedPerSession() async throws {
    let store = InMemoryCheckpointStore()

    for session in ["s1", "s2"] {
      var checkpoint = Checkpoint(title: "cp")
      checkpoint.id = "cp-\(session)"
      checkpoint.sessionId = session
      _ = try await store.save(checkpoint: checkpoint)
    }

    let scoped = try await store.listCheckpoints(sessionId: "s1")
    XCTAssertEqual(scoped.map { $0.id }, ["cp-s1"])
    let loaded = try await store.load(sessionId: "s2", checkpointId: "cp-s2")
    XCTAssertEqual(loaded?.id, "cp-s2")
    let crossSession = try await store.load(sessionId: "s1", checkpointId: "cp-s2")
    XCTAssertNil(crossSession, "a checkpoint must not be readable from another session")
  }

  // MARK: - Permissions

  func testPermissionResolversReportTheirDecision() async throws {
    let request = PermissionRequest(permission: "tool:add")

    let allowed = try await AllowAllPermissionResolver().request(request: request)
    XCTAssertTrue(allowed.approved)
    XCTAssertEqual(allowed.permission, "tool:add")

    let denied = try await DenyAllPermissionResolver().request(request: request)
    XCTAssertFalse(denied.approved)
    XCTAssertEqual(denied.permission, "tool:add")
  }

  // MARK: - Tool execution

  /// A tool executor must convert every failure into a result. If it threw,
  /// one bad tool would abort the turn instead of letting the model recover.
  func testToolExecutorContainsFailures() async throws {
    let executor = FunctionHostToolExecutor(handlers: [
      "ok": { arguments in ["echo": arguments["value"] as Any] },
      "boom": { _ in throw InvokerError.execution("kaboom") },
    ])

    var okRequest = HostToolRequest(toolName: "ok")
    okRequest.arguments = ["value": 7]
    let ok = try await executor.execute(request: okRequest)
    XCTAssertTrue(ok.success)
    XCTAssertNil(ok.errorKind)
    XCTAssertEqual((ok.result as? [String: Any])?["echo"] as? Int, 7)

    let boom = try await executor.execute(request: HostToolRequest(toolName: "boom"))
    XCTAssertFalse(boom.success)
    XCTAssertEqual(boom.errorKind, "exception")

    let missing = try await executor.execute(request: HostToolRequest(toolName: "nope"))
    XCTAssertFalse(missing.success)
    XCTAssertEqual(missing.errorKind, "not_found")
  }

  // MARK: - Replay verification

  func testVerifierDetectsLengthAndContentDrift() throws {
    let verifier = ReferenceReplayVerifier()

    var a = ReplayJournalRecord()
    a.kind = .turn
    a.type = "turn:turn_start:0"
    var b = ReplayJournalRecord()
    b.kind = .turn
    b.type = "turn:turn_end:1"

    let identical = try verifier.verify(
      ReplayVerificationRequest(expected: [a, b], actual: [a, b]))
    XCTAssertEqual(identical.status, .passed)
    XCTAssertEqual(identical.mismatches?.isEmpty ?? true, true)

    let truncated = try verifier.verify(
      ReplayVerificationRequest(expected: [a, b], actual: [a]))
    XCTAssertEqual(truncated.status, .failed)
    XCTAssertEqual(Int(truncated.expectedCount), 2)
    XCTAssertEqual(Int(truncated.actualCount), 1)

    let divergent = try verifier.verify(
      ReplayVerificationRequest(expected: [a, b], actual: [a, a]))
    XCTAssertEqual(divergent.status, .failed)
    XCTAssertEqual(divergent.mismatches?.first?.index, 1)
  }

  // MARK: - Event sink

  func testCollectingSinkPreservesInterleavedOrder() throws {
    let sink = CollectingEventSink()

    _ = try sink.emitSession(
      sessionEvent: SessionEvent(id: "s1", type: .sessionStart, timestamp: "t"))
    _ = try sink.emitTurn(turnEvent: TurnEvent(id: "t1", type: .turnStart, timestamp: "t"))
    _ = try sink.emitTurn(turnEvent: TurnEvent(id: "t2", type: .turnEnd, timestamp: "t"))

    XCTAssertEqual(sink.turnEvents.map(\.id), ["t1", "t2"])
    XCTAssertEqual(sink.sessionEvents.map(\.id), ["s1"])
  }

  private static func tempPath() -> String {
    NSTemporaryDirectory() + "prompty-journal-\(UUID().uuidString).jsonl"
  }
}
