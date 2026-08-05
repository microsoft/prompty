import Foundation

import PromptyModel

import XCTest

/// Conformance against `spec/vectors/render/render_vectors.json`.
///
/// Exercises both template engines plus the thread-nonce substitution that
/// keeps rich inputs out of the rendered text.
@testable import Prompty

final class RenderVectorTests: XCTestCase {

  func testRenderVectors() async throws {
    Registry.shared.registerDefaults()
    var run = VectorRun(stage: "render")

    for vector in try Spec.vectors("render") {
      let name = vector["name"] as? String ?? "<unnamed>"
      run.started()
      let input = vector["input"] as? [String: Any] ?? [:]
      let expected = vector["expected"] as? [String: Any] ?? [:]

      let template = input["template"] as? String ?? ""
      let engine = input["engine"] as? String ?? Defaults.templateFormat
      let inputs = input["inputs"] as? [String: Any] ?? [:]

      do {
        let agent = try Self.agent(name: name, template: template, engine: engine, inputs: inputs)
        let rendered = try await Pipeline.render(agent, inputs: inputs)

        if let expectedText = expected["rendered"] as? String {
          guard rendered == expectedText else {
            run.fail(
              name,
              "rendered mismatch:\n  actual:   \(Spec.describe(rendered))\n  expected: \(Spec.describe(expectedText))"
            )
            continue
          }
        }

        if let pattern = expected["nonce_pattern"] as? String {
          let regex = try NSRegularExpression(pattern: pattern)
          let range = NSRange(rendered.startIndex..., in: rendered)
          guard regex.firstMatch(in: rendered, range: range) != nil else {
            run.fail(
              name, "rendered text does not match \(pattern):\n  actual: \(Spec.describe(rendered))"
            )
            continue
          }
        }
      } catch {
        run.fail(name, "\(error)")
      }
    }

    run.assertClean()
  }

  /// Build the synthetic agent a render vector implies.
  ///
  /// Rich-kind substitution is driven by the *declared* input property, so any
  /// input the vector marks `_kind: thread` must appear in `inputs` as a
  /// thread-kind property.
  private static func agent(
    name: String, template: String, engine: String, inputs: [String: Any]
  ) throws -> Prompty {
    var properties: [[String: Any]] = []
    for (key, value) in inputs.sorted(by: { $0.key < $1.key }) {
      let kind = (value as? [String: Any])?["_kind"] as? String ?? "string"
      properties.append(["name": key, "kind": kind])
    }

    return try Prompty.load([
      "kind": "prompt",
      "name": name,
      "instructions": template,
      "inputs": properties,
      "template": [
        "format": ["kind": engine],
        "parser": ["kind": Defaults.parser],
      ],
    ])
  }
}
