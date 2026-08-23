import Foundation

import PromptyModel

import XCTest

/// Conformance against the generated `processStream` vectors.
///
/// This is the provider-level half of the ``Processor.processStream`` contract
/// that the model-only harness cannot reach (importing `PromptyOpenAI` there
/// would be a circular package dependency). The OpenAI classifier turns raw SSE
/// events into `StreamChunk` values — text, and determinate/indeterminate
/// failures — and the provider-agnostic ``reconcileStream(_:)`` reduces them
/// into the reconciliation summary. Both are exercised here against the same
/// vectors every runtime shares.
@testable import Prompty

@testable import PromptyOpenAI

final class ProcessStreamVectorTests: XCTestCase {

  func testProcessStreamVectors() async throws {
    var run = VectorRun(stage: "processStream")

    for vector in try Spec.vectors("processStream") {
      let name = vector["name"] as? String ?? "<unnamed>"
      let input = vector["input"] as? [String: Any] ?? [:]
      let expected = vector["expected"] as? [String: Any] ?? [:]

      guard (input["provider"] as? String ?? "openai") == "openai" else {
        run.skip()
        continue
      }

      await run.checkAsync(name) {
        let events = input["events"] as? [[String: Any]] ?? []
        let raw = Self.rawStream(from: events)

        let decoded = try await OpenAIProcessor().processStream(stream: raw)
        guard let chunkStream = decoded as? ChunkStream else {
          throw VectorFailure("processStream did not return a ChunkStream")
        }

        var chunks: [StreamChunk] = []
        for try await chunk in chunkStream { chunks.append(chunk) }

        let reconciliation = reconcileStream(chunks)
        var observed = reconciliation.save()
        observed["chunks"] = chunks.map(Self.project)

        try expectEqual(observed, expected, name)
      }
    }

    run.assertClean()
  }

  // MARK: - Helpers

  /// Convert the vector's transport-agnostic events into the raw provider
  /// stream the processor consumes.
  ///
  /// A `provider` event is the raw SSE payload verbatim. A `transportError` is
  /// wrapped in the synthetic `sse_transport_error` envelope the OpenAI
  /// classifier recognizes, mirroring the Rust reference adapter.
  private static func rawStream(from events: [[String: Any]]) -> RawChunkStream {
    AsyncThrowingStream { continuation in
      for event in events {
        switch event["kind"] as? String {
        case "provider":
          continuation.yield(event["value"] as? [String: Any] ?? [:])
        case "transportError":
          let message = event["message"] as? String ?? "stream error"
          continuation.yield(["error": ["type": "sse_transport_error", "message": message]])
        default:
          break
        }
      }
      continuation.finish()
    }
  }

  /// Project a classified chunk onto the vector's expected `chunks` shape.
  private static func project(_ chunk: StreamChunk) -> [String: Any] {
    switch chunk {
    case .textChunk(let text):
      return ["kind": "text", "value": text.value]
    case .failureChunk(let failure):
      return [
        "kind": "failure",
        "failure": [
          "outcome": failure.failure.outcome.rawValue,
          "message": failure.failure.message,
        ],
      ]
    default:
      return ["kind": "unknown"]
    }
  }
}
