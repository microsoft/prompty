import Foundation

/// Durable harness adapters: event capture, journaling, replay verification,
/// checkpoint storage, permission resolution and host tool dispatch.
///
/// These mirror `runtime/rust/prompty/src/harness.rs` so a session recorded by
/// one runtime replays identically in another. The protocols themselves are
/// owned by the generated model (`PromptyModel/pipeline/`); this file only
/// supplies reference implementations.

// MARK: - Event capture

/// Collects emitted events in memory.
///
/// Reference implementations are handed to engines that may fan out across
/// tasks, so the buffers are lock-guarded and the type is `Sendable`.
import PromptyModel

// MARK: - Journaling

/// Appends replayable journal records as newline-delimited JSON.
///
/// Every write is an append to a closed file handle rather than a retained one,
/// which is what makes the journal durable across a crash mid-turn.

// MARK: - Replay verification

/// Compares an expected journal against an actual one, position by position.

// MARK: - Checkpoint storage

/// Stores checkpoints in memory, keyed by session and checkpoint id.

// MARK: - Permission resolution

/// Approves every permission request.

/// Denies every permission request.

// MARK: - Host tool dispatch

/// Dispatches host tool requests to registered local functions.
public final class CollectingEventSink: EventSink, @unchecked Sendable {
  private let lock = NSLock()
  private var turn: [TurnEvent] = []
  private var session: [SessionEvent] = []

  public init() {}

  public var turnEvents: [TurnEvent] {
    lock.lock()
    defer { lock.unlock() }
    return turn
  }

  public var sessionEvents: [SessionEvent] {
    lock.lock()
    defer { lock.unlock() }
    return session
  }

  public func emitTurn(turnEvent: TurnEvent) throws -> Bool {
    lock.lock()
    defer { lock.unlock() }
    turn.append(turnEvent)
    return true
  }

  public func emitSession(sessionEvent: SessionEvent) throws -> Bool {
    lock.lock()
    defer { lock.unlock() }
    session.append(sessionEvent)
    return true
  }
}
public final class JsonlEventJournalWriter: EventJournalWriter, @unchecked Sendable {
  private let lock = NSLock()
  private let url: URL
  private var closed = false

  public init(path: String) {
    self.url = URL(fileURLWithPath: path)
    try? FileManager.default.createDirectory(
      at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
  }

  public var path: String { url.path }

  public func appendTurn(turnEvent: TurnEvent) throws -> Bool {
    try append(["kind": "turn", "event": turnEvent.save()])
  }

  public func appendSession(sessionEvent: SessionEvent) throws -> Bool {
    try append(["kind": "session", "event": sessionEvent.save()])
  }

  /// Writes the summary (when present) and seals the journal. A second close is
  /// reported as `false` rather than silently succeeding, matching Rust.
  public func close(summary: SessionSummary?) throws -> Bool {
    lock.lock()
    defer { lock.unlock() }
    if closed { return false }

    if let summary {
      guard try appendLocked(["kind": "summary", "summary": summary.save()]) else { return false }
    }
    closed = true
    return true
  }

  private func append(_ record: [String: Any]) throws -> Bool {
    lock.lock()
    defer { lock.unlock() }
    if closed { return false }
    return try appendLocked(record)
  }

  private func appendLocked(_ record: [String: Any]) throws -> Bool {
    guard let line = (JSONSupport.toJSON(record) + "\n").data(using: .utf8) else { return false }

    if !FileManager.default.fileExists(atPath: url.path) {
      return FileManager.default.createFile(atPath: url.path, contents: line)
    }
    guard let handle = try? FileHandle(forWritingTo: url) else { return false }
    defer { try? handle.close() }
    try handle.seekToEnd()
    try handle.write(contentsOf: line)
    return true
  }

  /// Read a journal back as records, dropping the trailing summary line.
  ///
  /// Useful for replay verification against a journal written by any runtime.
  public static func readRecords(path: String) throws -> [[String: Any]] {
    let contents = try String(contentsOfFile: path, encoding: .utf8)
    return
      Lines.split(contents)
      .compactMap { JSONSupport.parse(json: String($0)) as? [String: Any] }
  }
}
public struct ReferenceReplayVerifier: Sendable {
  public init() {}

  public func verify(_ request: ReplayVerificationRequest) throws -> ReplayVerificationResult {
    let expected = request.expected
    let actual = request.actual
    var mismatches: [ReplayMismatch] = []

    for index in 0..<max(expected.count, actual.count) {
      let expectedRecord = index < expected.count ? expected[index] : nil
      let actualRecord = index < actual.count ? actual[index] : nil

      let expectedKey = try Self.comparable(expectedRecord)
      let actualKey = try Self.comparable(actualRecord)
      guard expectedKey != actualKey else { continue }

      let message: String
      if expectedRecord == nil {
        message = "Unexpected extra replay record"
      } else if actualRecord == nil {
        message = "Missing replay record"
      } else {
        message = "Replay record mismatch"
      }

      mismatches.append(
        ReplayMismatch(
          index: Int32(index), expected: expectedRecord, actual: actualRecord, message: message))
    }

    return ReplayVerificationResult(
      status: mismatches.isEmpty ? .passed : .failed,
      mismatches: mismatches.isEmpty ? nil : mismatches,
      expectedCount: Int32(expected.count),
      actualCount: Int32(actual.count)
    )
  }

  /// Compare on the saved wire shape so field ordering cannot cause a false
  /// mismatch and unknown forward-compatible fields still participate.
  private static func comparable(_ record: ReplayJournalRecord?) throws -> String? {
    guard let record else { return nil }
    return JSONSupport.toJSON(try record.save())
  }
}
public final class InMemoryCheckpointStore: CheckpointStore, @unchecked Sendable {
  private let lock = NSLock()
  private var checkpoints: [String: Checkpoint] = [:]

  public init() {}

  public func save(checkpoint: Checkpoint) async throws -> Checkpoint {
    guard let sessionId = checkpoint.sessionId, let id = checkpoint.id else {
      throw InvokerError.execution("Checkpoint requires both sessionId and id to be stored")
    }
    store(checkpoint, at: Self.key(sessionId, id))
    return checkpoint
  }

  public func load(sessionId: String, checkpointId: String) async throws -> Checkpoint? {
    read(Self.key(sessionId, checkpointId))
  }

  /// Ordered by id so replay and resume see a stable sequence.
  public func listCheckpoints(sessionId: String) async throws -> [Checkpoint] {
    all(for: sessionId)
  }

  // Locking lives in synchronous helpers: holding a lock across a suspension
  // point is unavailable from async contexts and is an error in Swift 6.

  private func store(_ checkpoint: Checkpoint, at key: String) {
    lock.lock()
    defer { lock.unlock() }
    checkpoints[key] = checkpoint
  }

  private func read(_ key: String) -> Checkpoint? {
    lock.lock()
    defer { lock.unlock() }
    return checkpoints[key]
  }

  private func all(for sessionId: String) -> [Checkpoint] {
    lock.lock()
    defer { lock.unlock() }
    return
      checkpoints.values
      .filter { $0.sessionId == sessionId }
      .sorted { ($0.id ?? "") < ($1.id ?? "") }
  }

  private static func key(_ sessionId: String, _ checkpointId: String) -> String {
    // Escape the separator so ids containing it cannot collide.
    "\(sessionId.replacingOccurrences(of: "\u{1}", with: ""))\u{1}\(checkpointId)"
  }
}
public struct AllowAllPermissionResolver: PermissionResolver, Sendable {
  public init() {}

  public func request(request: PermissionRequest) async throws -> PermissionDecision {
    PermissionDecision(
      requestId: request.requestId,
      toolCallId: request.toolCallId,
      permission: request.permission,
      approved: true,
      reason: "allow_all"
    )
  }
}
public struct DenyAllPermissionResolver: PermissionResolver, Sendable {
  public init() {}

  public func request(request: PermissionRequest) async throws -> PermissionDecision {
    PermissionDecision(
      requestId: request.requestId,
      toolCallId: request.toolCallId,
      permission: request.permission,
      approved: false,
      reason: "deny_all"
    )
  }
}
public struct FunctionHostToolExecutor: HostToolExecutor, Sendable {
  public typealias Handler = @Sendable ([String: Any]) async throws -> Any

  private let handlers: [String: Handler]

  public init(handlers: [String: Handler]) {
    self.handlers = handlers
  }

  /// A missing handler or a throwing handler is reported as an unsuccessful
  /// result rather than propagating, so one bad tool cannot abort the turn.
  public func execute(request: HostToolRequest) async throws -> HostToolResult {
    let started = Date()

    guard let handler = handlers[request.toolName] else {
      return Self.failure(
        request,
        errorKind: "not_found",
        message: "No host tool registered for '\(request.toolName)'",
        started: started
      )
    }

    do {
      let value = try await handler(request.arguments ?? [:])
      var result = HostToolResult(
        requestId: request.requestId,
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        success: true
      )
      result.result = value
      result.durationMs = Self.elapsedMs(started)
      return result
    } catch {
      return Self.failure(
        request, errorKind: "exception", message: "\(error)", started: started)
    }
  }

  private static func failure(
    _ request: HostToolRequest, errorKind: String, message: String, started: Date
  ) -> HostToolResult {
    var result = HostToolResult(
      requestId: request.requestId,
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      success: false
    )
    result.result = ["message": message]
    result.errorKind = errorKind
    result.durationMs = elapsedMs(started)
    return result
  }

  private static func elapsedMs(_ started: Date) -> Double {
    Date().timeIntervalSince(started) * 1000
  }
}
