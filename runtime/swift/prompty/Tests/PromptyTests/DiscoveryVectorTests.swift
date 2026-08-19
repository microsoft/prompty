import Foundation

import PromptyModel

import XCTest

@testable import Prompty
@testable import PromptyAnthropic
@testable import PromptyFoundry
@testable import PromptyOpenAI

/// Conformance for the `discovery` stage (`DiscoveryConformance.mapModel`).
///
/// Each vector maps a raw provider payload into `ModelInfo` through the same
/// per-provider mapping the runtime uses, then compares the saved result. The
/// vector's `provider` and `shape` select the mapping: Foundry distinguishes
/// catalog entries from deployments.
final class DiscoveryVectorTests: XCTestCase {

  func testDiscoveryVectors() throws {
    var run = VectorRun(stage: "discovery")

    for vector in try Spec.vectors("discovery") {
      let name = vector["name"] as? String ?? "<unnamed>"
      let provider = vector["provider"] as? String ?? ""
      let shape = vector["shape"] as? String ?? ""
      let input = vector["input"] ?? [String: Any]()
      let expected = vector["expected"] as? [String: Any] ?? [:]

      run.check(name) {
        let info: ModelInfo
        switch (provider, shape) {
        case ("openai", _):
          info = OpenAIModels.modelInfo(fromWire: input)
        case ("anthropic", _):
          info = AnthropicModels.modelInfo(fromWire: input)
        case ("foundry", "catalog"):
          info = FoundryModels.modelInfo(fromCatalog: input)
        case ("foundry", "deployment"):
          info = FoundryModels.modelInfo(fromDeployment: input)
        default:
          throw VectorFailure("unhandled provider/shape: \(provider)/\(shape)")
        }
        try expectEqual(info.save(), expected, "model_info")
      }
    }

    run.assertClean()
  }
}
