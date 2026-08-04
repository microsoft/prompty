import Foundation

import PromptyModel

import XCTest

/// Conformance against `spec/vectors/parse/parse_vectors.json`.
///
/// Drives the real `PromptyChatParser` and, for the thread vector, the real
/// `Pipeline.expandThreads` rather than a test-local reimplementation.
@testable import Prompty

final class ParseVectorTests: XCTestCase {

  func testParseVectors() async throws {
    Registry.shared.registerDefaults()
    var run = VectorRun(stage: "parse")

    let agent = try Prompty.load([
      "kind": "prompt",
      "name": "parse-vectors",
      "template": ["format": ["kind": "jinja2"], "parser": ["kind": "prompty"]],
    ])

    for vector in try Spec.vectors("parse") {
      let name = vector["name"] as? String ?? "<unnamed>"
      run.started()
      let input = vector["input"] as? [String: Any] ?? [:]
      let expected = vector["expected"] as? [String: Any] ?? [:]
      let rendered = input["rendered"] as? String ?? ""

      do {
        // Vectors carry already-rendered text, so no nonce context exists and
        // parsing runs in the non-strict path.
        var messages = try await Pipeline.parse(agent, rendered: rendered)

        if let threadInputs = input["thread_inputs"] as? [String: Any] {
          messages = Pipeline.expandThreads(
            messages,
            nonces: Self.nonces(in: rendered),
            inputs: threadInputs
          )
        }

        guard let expectedMessages = expected["messages"] as? [[String: Any]] else { continue }
        try Self.compare(messages, expected: expectedMessages)
      } catch {
        run.fail(name, "\(error)")
      }
    }

    run.assertClean()
  }

  /// Recover the `input name -> nonce` map the renderer would have produced.
  private static func nonces(in rendered: String) -> [String: String] {
    let pattern = "\(Defaults.threadNoncePrefix)[a-f0-9]+_(\\w+)__"
    guard let regex = try? NSRegularExpression(pattern: pattern) else { return [:] }

    var result: [String: String] = [:]
    let range = NSRange(rendered.startIndex..., in: rendered)
    for match in regex.matches(in: rendered, range: range) {
      guard
        let full = Range(match.range, in: rendered),
        let nameRange = Range(match.range(at: 1), in: rendered)
      else { continue }
      result[String(rendered[nameRange])] = String(rendered[full])
    }
    return result
  }

  /// Vectors assert on role plus the concatenated text of text parts, which is
  /// the shared cross-runtime comparison.
  private static func compare(_ actual: [Message], expected: [[String: Any]]) throws {
    try expect(
      actual.count == expected.count,
      "message count: expected \(expected.count), got \(actual.count)\n  actual: \(actual.map { "\($0.role.rawValue):\($0.textContent)" })"
    )

    for (index, expectedMessage) in expected.enumerated() {
      let message = actual[index]

      if let role = expectedMessage["role"] as? String {
        try expectEqual(message.role.rawValue, role, "messages[\(index)].role")
      }

      let expectedText =
        (expectedMessage["content"] as? [[String: Any]] ?? [])
        .filter { ($0["kind"] as? String) == "text" }
        .compactMap { $0["value"] as? String }
        .joined()

      try expectEqual(message.textContent, expectedText, "messages[\(index)].content")
    }
  }
}
