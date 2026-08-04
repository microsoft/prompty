import Foundation
import PromptyModel
import XCTest

@testable import Prompty
@testable import PromptyOpenAI

/// Conformance against `spec/vectors/process/process_vectors.json`.
///
/// Drives the real `OpenAIProcessor`, including the structured-output
/// finalization path that only engages when the agent declares outputs.
final class ProcessVectorTests: XCTestCase {

  func testProcessVectors() async throws {
    var run = VectorRun(stage: "process")

    for vector in try Spec.vectors("process") {
      let name = vector["name"] as? String ?? "<unnamed>"
      run.started()
      let input = vector["input"] as? [String: Any] ?? [:]
      let expected = vector["expected"] as? [String: Any] ?? [:]

      guard (input["provider"] as? String ?? "openai") == "openai" else { continue }

      do {
        let agent = try Self.agent(hasOutputs: input["has_outputs"] as? Bool ?? false)
        let result = try await OpenAIProcessor().process(
          agent: agent, response: input["response"] as Any)

        // `""` and `null` are interchangeable in the shared expectations.
        let expectedResult = expected["result"]
        if Self.isEmptyish(result) && Self.isEmptyish(expectedResult) { continue }

        try expectEqual(result, expectedResult, "result")
      } catch {
        run.fail(name, "\(error)")
      }
    }

    run.assertClean()
  }

  private static func agent(hasOutputs: Bool) throws -> Prompty {
    var data: [String: Any] = [
      "kind": "prompt",
      "name": "process-vectors",
      "model": ["id": "gpt-4", "provider": "openai"],
      "instructions": "test",
    ]
    if hasOutputs {
      data["outputs"] = [["name": "result", "kind": "string"]]
    }
    return try Prompty.load(data)
  }

  private static func isEmptyish(_ value: Any?) -> Bool {
    if value == nil || value is NSNull { return true }
    if let string = value as? String { return string.isEmpty }
    return false
  }
}
