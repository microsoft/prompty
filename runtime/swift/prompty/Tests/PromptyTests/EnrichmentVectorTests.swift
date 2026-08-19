import Foundation

import PromptyModel

import XCTest

@testable import Prompty

/// Conformance for the `enrichment` stage (`DiscoveryConformance.enrich`).
///
/// Each vector loads a sparse `ModelInfo`, applies the shared dataset
/// enrichment for its provider, and compares the saved result. Provider-supplied
/// fields (including a present-but-empty modality list) must always win; the
/// dataset only fills fields left `nil`.
final class EnrichmentVectorTests: XCTestCase {

  func testEnrichmentVectors() throws {
    var run = VectorRun(stage: "enrichment")

    for vector in try Spec.vectors("enrichment") {
      let name = vector["name"] as? String ?? "<unnamed>"
      let provider = vector["provider"] as? String ?? ""
      let input = vector["input"] as? [String: Any] ?? [:]
      let expected = vector["expected"] as? [String: Any] ?? [:]

      run.check(name) {
        var info = try ModelInfo.load(input)
        Discovery.enrich(provider: provider, info: &info)
        try expectEqual(info.save(), expected, "model_info")
      }
    }

    run.assertClean()
  }
}
