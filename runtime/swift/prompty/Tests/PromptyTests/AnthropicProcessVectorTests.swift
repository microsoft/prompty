import Foundation

import PromptyModel

import XCTest

@testable import Prompty

/// Conformance against the Anthropic `process` cases in `vectors.json`.
///
/// Drives the real ``AnthropicProcessor``, including the structured-output
/// finalization path that only engages when the agent declares outputs.
@testable import PromptyAnthropic

final class AnthropicProcessVectorTests: XCTestCase {

  func testAnthropicProcessVectors() async throws {
    var run = VectorRun(stage: "process")

    for vector in try Spec.vectors("process") {
      let name = vector["name"] as? String ?? "<unnamed>"
      let input = vector["input"] as? [String: Any] ?? [:]
      let expected = vector["expected"] as? [String: Any] ?? [:]

      guard (input["provider"] as? String ?? "openai") == "anthropic" else { continue }
      run.started()

      do {
        let agent = try Self.agent(hasOutputs: input["has_outputs"] as? Bool ?? false)
        let result = try await AnthropicProcessor().process(
          agent: agent, response: input["response"] as Any)

        let expectedResult = expected["result"]
        if Self.isEmptyish(result) && Self.isEmptyish(expectedResult) { continue }

        try expectEqual(result, expectedResult, "result")
      } catch {
        run.fail(name, "\(error)")
      }
    }

    run.assertClean()
  }

  private static func agent(hasOutputs: Bool) throws -> Agent {
    var data: [String: Any] = [
      "kind": "prompt",
      "name": "anthropic-process-vectors",
      "model": ["id": "claude-3", "provider": "anthropic"],
      "instructions": "test",
    ]
    if hasOutputs {
      data["outputs"] = [["name": "result", "kind": "string"]]
    }
    return try Agent.load(data)
  }

  private static func isEmptyish(_ value: Any?) -> Bool {
    if value == nil || value is NSNull { return true }
    if let string = value as? String { return string.isEmpty }
    return false
  }
}
