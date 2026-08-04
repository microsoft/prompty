import Foundation
import PromptyModel
import XCTest

@testable import Prompty

/// Conformance against `spec/vectors/harness/replay_vectors.json`.
///
/// Runs the real `ReferenceTurnRunner` against a real on-disk JSONL journal,
/// then normalizes that journal to the shared string form and compares it to
/// the golden sequence. Because the journal is read back from disk rather than
/// from an in-memory sink, this exercises durability as well as ordering.
final class ReplayVectorTests: XCTestCase {

  func testReplayVectors() async throws {
    var run = VectorRun(stage: "replay")

    let file = try Spec.vectorObject("harness/replay_vectors.json")
    XCTAssertEqual(file["version"] as? Int, 1, "unexpected replay vector version")

    let sessionId = file["sessionId"] as? String ?? "session-1"
    let turnId = file["turnId"] as? String ?? "turn-1"
    let clock = file["clock"] as? String ?? "2026-06-28T00:00:00Z"

    for scenario in file["scenarios"] as? [[String: Any]] ?? [] {
      let name = scenario["name"] as? String ?? "<unnamed>"

      await run.checkAsync(name) {
        let actual = try await Self.runScenario(
          scenario, sessionId: sessionId, turnId: turnId, clock: clock)
        let expected = scenario["expected"] as? [String] ?? []
        try expect(!expected.isEmpty, "vector '\(name)' declares no expected journal")

        try expectEqual(actual, expected, "journal for '\(name)'")

        // The same sequence must also verify through the shipped verifier, so
        // a runtime can prove replay equivalence without string comparison.
        try Self.verifyThroughVerifier(expected: expected, actual: actual)
      }
    }

    run.assertClean()
  }

  // MARK: - Scenario execution

  private static func runScenario(
    _ scenario: [String: Any], sessionId: String, turnId: String, clock: String
  ) async throws -> [String] {
    let name = scenario["name"] as? String ?? ""
    let journalPath = NSTemporaryDirectory() + "prompty-replay-\(name)-\(UUID().uuidString).jsonl"
    defer { try? FileManager.default.removeItem(atPath: journalPath) }

    let journal = JsonlEventJournalWriter(path: journalPath)

    // Ids must be deterministic for the journal to be byte-comparable.
    let counter = Counter()
    let runner = ReferenceTurnRunner(
      eventSink: CollectingEventSink(),
      journal: journal,
      checkpointStore: InMemoryCheckpointStore(),
      permissionResolver: name == "permission_denied"
        ? DenyAllPermissionResolver() : AllowAllPermissionResolver(),
      hostToolExecutor: Self.toolExecutor(),
      invokeModel: Self.model(for: name),
      now: { clock },
      nextId: { prefix in "\(prefix)-\(counter.next())" }
    )

    var request = RunTurnRequest(sessionId: sessionId, turnId: turnId)
    request.inputs = scenario["inputs"] as? [String: Any] ?? ["name": "Ada"]
    if let maxIterations = scenario["maxIterations"] as? Int {
      var options = TurnOptions()
      options.maxIterations = Int32(maxIterations)
      request.options = options
    }

    _ = try await runner.run(request)

    return normalize(try JsonlEventJournalWriter.readRecords(path: journalPath))
  }

  /// Mirrors `model_for_scenario` in the Rust reference runner.
  private static func model(for scenario: String) -> ReferenceTurnRunner.ModelCallback {
    { request in
      if scenario == "no_tool" {
        var response = TurnModelResponse()
        let name = (request.inputs?["name"] as? String) ?? ""
        response.output = ["text": "hello \(name)"]
        response.checkpointState = ["stable": true]
        return response
      }

      if request.iteration == 0 {
        var toolRequest = HostToolRequest(
          toolName: scenario == "tool_failure" ? "fail" : "add")
        toolRequest.requestId = "exec-1"
        toolRequest.toolCallId = "call-1"
        toolRequest.arguments = ["a": 2, "b": 3]

        var response = TurnModelResponse()
        response.toolRequests = [toolRequest]
        return response
      }

      var response = TurnModelResponse()
      let first = request.toolResults?.first
      response.output = [
        "toolResult": first?.result as Any,
        "errorKind": first?.errorKind as Any,
      ]
      return response
    }
  }

  private static func toolExecutor() -> FunctionHostToolExecutor {
    FunctionHostToolExecutor(handlers: [
      "add": { arguments in
        let a = (arguments["a"] as? Int) ?? 0
        let b = (arguments["b"] as? Int) ?? 0
        return ["sum": a + b]
      },
      "fail": { _ in
        throw InvokerError.execution("tool unavailable")
      },
    ])
  }

  // MARK: - Journal normalization

  /// Mirrors `normalize_journal` in the Rust reference runner so both runtimes
  /// compare against the same golden strings.
  private static func normalize(_ records: [[String: Any]]) -> [String] {
    records.map { record in
      let kind = record["kind"] as? String ?? ""

      if kind == "summary" {
        let summary = record["summary"] as? [String: Any] ?? [:]
        return [
          "summary",
          summary["sessionId"] as? String ?? "",
          summary["status"] as? String ?? "",
          "turns=\(summary["turns"] ?? 0)",
          "checkpoints=\(summary["checkpoints"] ?? 0)",
        ].joined(separator: ":")
      }

      let event = record["event"] as? [String: Any] ?? [:]
      let type = event["type"] as? String ?? ""
      let payload = event["payload"] as? [String: Any] ?? [:]

      if kind == "session" {
        var parts = ["session", type, event["sessionId"] as? String ?? "",
                     event["turnId"] as? String ?? ""]
        if type == "session_end" { parts.append(payload["status"] as? String ?? "") }
        return parts.joined(separator: ":")
      }

      let iteration = "\(event["iteration"] ?? 0)"
      var parts = ["turn", type, iteration]

      switch type {
      case "permission_requested":
        parts.append(payload["requestId"] as? String ?? "")
      case "permission_completed":
        parts.append("\(payload["approved"] as? Bool ?? false)")
      case "tool_execution_start":
        parts.append(payload["toolName"] as? String ?? "")
      case "tool_execution_complete", "tool_result":
        parts.append(payload["toolName"] as? String ?? "")
        parts.append("\(payload["success"] as? Bool ?? false)")
        if let errorKind = payload["errorKind"] as? String { parts.append(errorKind) }
      case "error":
        parts.append(payload["errorKind"] as? String ?? "")
      case "turn_end":
        parts.append(payload["status"] as? String ?? "")
      default:
        break
      }
      return parts.joined(separator: ":")
    }
  }

  // MARK: - Verifier cross-check

  private static func verifyThroughVerifier(expected: [String], actual: [String]) throws {
    let request = ReplayVerificationRequest(
      expected: expected.map(record), actual: actual.map(record))
    let result = try ReferenceReplayVerifier().verify(request)

    try expect(
      result.status == .passed,
      "replay verifier reported \(result.status.rawValue): \(result.mismatches ?? [])")
    try expectEqual(Int(result.expectedCount), expected.count, "verifier expectedCount")
    try expectEqual(Int(result.actualCount), actual.count, "verifier actualCount")
  }

  /// Project a normalized string back onto a journal record so the verifier
  /// compares the same information the golden vectors pin down.
  private static func record(_ normalized: String) -> ReplayJournalRecord {
    var record = ReplayJournalRecord()
    let parts = normalized.split(separator: ":", maxSplits: 1).map(String.init)
    record.kind = (try? ReplayRecordKind.parse(parts.first ?? "session")) ?? .session
    record.type = normalized
    return record
  }
}

/// Deterministic monotonic counter for id generation.
private final class Counter: @unchecked Sendable {
  private let lock = NSLock()
  private var value = 0

  func next() -> Int {
    lock.lock()
    defer { lock.unlock() }
    value += 1
    return value
  }
}
