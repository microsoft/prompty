import Foundation

import XCTest

@testable import Prompty

/// Guards the vendored capability dataset against drift.
///
/// `Sources/Prompty/Resources/model_capabilities.json` is a copy of the
/// canonical `spec/data/model_capabilities.json` so the package can embed it via
/// `Bundle.module`. This test fails if the two diverge, forcing the copy to be
/// refreshed whenever the shared dataset changes.
final class DatasetDriftTests: XCTestCase {

  func testVendoredDatasetMatchesSpec() throws {
    let specURL =
      Spec.repoRoot
      .appendingPathComponent("spec")
      .appendingPathComponent("data")
      .appendingPathComponent("model_capabilities.json")

    let vendoredURL =
      Spec.repoRoot
      .appendingPathComponent("runtime")
      .appendingPathComponent("swift")
      .appendingPathComponent("prompty")
      .appendingPathComponent("Sources")
      .appendingPathComponent("Prompty")
      .appendingPathComponent("Resources")
      .appendingPathComponent("model_capabilities.json")

    let specJSON = try JSONSerialization.jsonObject(with: Data(contentsOf: specURL))
    let vendoredJSON = try JSONSerialization.jsonObject(with: Data(contentsOf: vendoredURL))

    XCTAssertTrue(
      Spec.equal(vendoredJSON, specJSON),
      "vendored model_capabilities.json drifted from spec/data/model_capabilities.json")
  }
}
