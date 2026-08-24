import Foundation

import PromptyModel

import XCTest

/// Conformance for the `runTurn` operation (the `turn` stage) driven through the
/// SDK's async harness, with zero waivers.
///
/// The provider-agnostic turn engine that produces the snapshot/portability
/// projection is `PromptyModel.TurnEngine`. That engine is the single source of
/// truth every runtime shares — Python drives `prompty.core.turn_engine.run_turn`
/// and TypeScript drives `core/turn-engine`, both of which live in those runtimes'
/// unified core. The Swift package split places the same engine in the model
/// dependency, so the SDK harness drives it here rather than re-implementing turn
/// semantics inside the SDK, which would be a forbidden behavior change. The
/// SDK's own `ReferenceTurnRunner` is a *different* contract (durable replay,
/// covered by `ReplayVectorTests`) and cannot produce the snapshot/portability
/// projection these vectors assert.
///
/// This closes the `runTurn` coverage gap: every generated `turn` vector is
/// exercised through the SDK's async surface and asserted field-for-field against
/// the same projection the model-package `runTurnInvoke` adapter emits.
@testable import Prompty

final class TurnVectorTests: XCTestCase {

  func testTurnVectors() async throws {
    var run = VectorRun(stage: "turn")

    let vectors = try Spec.vectors("turn")
    try expect(!vectors.isEmpty, "no turn vectors found in the generated source of truth")

    for vector in vectors {
      let name = vector["name"] as? String ?? "<unnamed>"

      await run.checkAsync(name) {
        let expected = vector["expected"] as? [String: Any] ?? [:]
        try expect(!expected.isEmpty, "vector '\(name)' declares no expected projection")

        let observed = try await Self.driveTurn(input: vector["input"])
        try expectEqual(Self.project(observed, expected), expected, "turn '\(name)'")
      }
    }

    run.assertClean()
  }

  // MARK: - Async adapter over the model-owned turn engine

  /// Drive one `runTurn` vector through the SDK's async surface.
  ///
  /// Each scripted provider turn is resolved across an async suspension point —
  /// the way a live model round-trip must be awaited — before the synchronous,
  /// deterministic `TurnEngine` reference consumes it. This exercises the async
  /// wiring without altering turn semantics: the projection is produced entirely
  /// by the shared engine, not by this adapter.
  private static func driveTurn(input: Any?) async throws -> [String: Any] {
    let flags = input as? [String: Any] ?? [:]
    let messages = flags["messages"] as? [[String: Any]] ?? []
    let scriptedRaw = flags["model"] as? [[String: Any]] ?? []
    let toolOutputs = flags["toolOutputs"] as? [String: Any] ?? [:]
    let denyTools = Set(flags["denyTools"] as? [String] ?? [])
    let cancelBeforeRun = (flags["cancelBeforeRun"] as? Bool) ?? false

    // Resolve each scripted provider turn on the async boundary, mirroring a real
    // awaited model call, before the synchronous engine replays them by index.
    var scripted: [TurnEngine.ModelTurn] = []
    for turn in scriptedRaw {
      await Task.yield()
      let toolCalls = (turn["tools"] as? [[String: Any]] ?? []).map { tc in
        TurnEngine.ToolCall(
          id: tc["id"] as? String ?? "",
          name: tc["name"] as? String ?? "",
          arguments: tc["arguments"] as? [String: Any] ?? [:])
      }
      scripted.append(
        TurnEngine.ModelTurn(
          output: turn["output"],
          toolCalls: toolCalls,
          nextPortability: turn["nextPortability"] as? String,
          delegatedState: turn["delegatedState"] as? [Any]))
    }

    let invokeModel: (Int, [TurnEngine.ToolResult]) -> TurnEngine.ModelTurn = { iteration, _ in
      guard iteration < scripted.count else { return TurnEngine.ModelTurn() }
      return scripted[iteration]
    }

    let result = TurnEngine.run(
      messages: messages,
      invokeModel: invokeModel,
      resolvePermission: { !denyTools.contains($0.name) },
      executeTool: { toolOutputs[$0.id] },
      cancelBeforeRun: cancelBeforeRun)

    return [
      "status": result.status,
      "output": result.output ?? NSNull(),
      "iterations": result.iterations,
      "snapshots": result.snapshots,
      "snapshotStablePrefixes": result.snapshotStablePrefixes,
      "snapshotPortability": result.snapshotPortability,
      "commitPortability": result.commitPortability,
      "delegatedState": result.delegatedStateCount,
      "toolResults": result.toolResults.count,
      "toolResultOrder": result.toolResultOrder,
      "eventKinds": result.events,
    ]
  }

  // MARK: - Projection

  /// Project the observed result onto the shape the vector asserts.
  ///
  /// The engine always reports every field; a vector pins only the subset it
  /// cares about. Projecting onto the expected keys keeps the comparison
  /// equal-key-count — which ``Spec/equal(_:_:)`` requires — without masking a
  /// real mismatch: any pinned key still present in `observed` is compared, and a
  /// missing one collapses to `NSNull` and fails.
  private static func project(_ observed: Any?, _ expected: Any?) -> Any? {
    if let expectedDict = expected as? [String: Any],
      let observedDict = observed as? [String: Any]
    {
      var out: [String: Any] = [:]
      for (key, expectedValue) in expectedDict {
        out[key] = project(observedDict[key], expectedValue) ?? NSNull()
      }
      return out
    }

    if let expectedArray = expected as? [Any], let observedArray = observed as? [Any] {
      guard observedArray.count == expectedArray.count else { return observedArray }
      return zip(observedArray, expectedArray).map { project($0, $1) ?? NSNull() }
    }

    return observed
  }
}
