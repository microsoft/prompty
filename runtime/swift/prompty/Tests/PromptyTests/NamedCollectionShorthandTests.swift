import Foundation

import PromptyModel

import XCTest

/// Pins the named-collection shorthand rules directly, without the shared
/// fixture.
///
/// `NamedCollectionVectorTests` drives the canonical
/// `spec/vectors/model/named_collection_vectors.json`, but that file arrives
/// with PR #447 and skips until then. These tests assert the same rules from
/// this branch so the behaviour is covered now, and so a regression is reported
/// against a named rule rather than only as a vector diff.
///
/// The rules, all for a *name-keyed* `inputs` / `outputs` / nested `properties`
/// map:
///
/// 1. The key supplies `name`.
/// 2. A bare scalar infers `kind` and is stored in `default`; `example` stays
///    absent.
/// 3. An immediate array value is rejected with the full dotted path.
/// 4. Arrays inside declared property fields (`default`, `items`) stay valid.
/// 5. The *list* form is unchanged: a bare scalar there is direct `@coerce`
///    input and keeps landing in `example`.
///
/// Rules 2 and 5 are the pair that matters most. They look alike and differ in
/// the field they populate, so they are asserted against each other rather than
/// in isolation.
@testable import Prompty

final class NamedCollectionShorthandTests: XCTestCase {

  // MARK: - Helpers

  private func loadInputs(_ frontmatter: String) throws -> [[String: Any]] {
    let contents = "---\n\(frontmatter)\n---\nsystem:\nvector\n"
    let agent = try Loader.load(
      contents: contents, basePath: FileManager.default.currentDirectoryPath)
    return try (agent.inputs ?? []).map { try $0.save() }
  }

  private func expectRejection(
    _ frontmatter: String, path expectedPath: String, category expectedCategory: String = "array",
    file: StaticString = #filePath, line: UInt = #line
  ) {
    let contents = "---\n\(frontmatter)\n---\nsystem:\nvector\n"
    do {
      _ = try Loader.load(contents: contents, basePath: FileManager.default.currentDirectoryPath)
      XCTFail(
        "expected rejection at \(expectedPath), but the load succeeded",
        file: file, line: line)
    } catch let error as LoadError {
      guard case .invalidNamedCollectionEntry(let path, let category) = error else {
        XCTFail(
          "expected LoadError.invalidNamedCollectionEntry, got \(error). A generic "
            + "rejection carries neither the path nor the value category.",
          file: file, line: line)
        return
      }
      XCTAssertEqual(path, expectedPath, "rejected path", file: file, line: line)
      XCTAssertEqual(category, expectedCategory, "value category", file: file, line: line)
      XCTAssertTrue(
        String(describing: error).contains("invalid-named-collection-entry"),
        "the diagnostic must carry the machine-readable token: \(error)",
        file: file, line: line)
    } catch {
      XCTFail("expected a LoadError, got \(error)", file: file, line: line)
    }
  }

  // MARK: - Rule 2: scalar shorthand stores `default`

  func testMapFormScalarStoresDefaultAndOmitsExample() throws {
    let cases: [(literal: String, kind: String, expected: Any)] = [
      ("Seattle", "string", "Seattle"),
      ("3", "integer", 3),
      ("1.5", "float", 1.5),
      ("true", "boolean", true),
    ]

    for probe in cases {
      let entries = try loadInputs("name: t\ninputs:\n  city: \(probe.literal)")
      XCTAssertEqual(entries.count, 1, "\(probe.literal): entry count")
      guard let entry = entries.first else { continue }

      XCTAssertEqual(entry["name"] as? String, "city", "\(probe.literal): name from key")
      XCTAssertEqual(entry["kind"] as? String, probe.kind, "\(probe.literal): inferred kind")

      // JSON text rather than `==`: Foundation bridges 0/1 to Bool, so a
      // direct comparison would let `0` satisfy `false`.
      XCTAssertEqual(
        try jsonText(entry["default"] as Any), try jsonText(probe.expected),
        "\(probe.literal): scalar must land in `default`")

      XCTAssertNil(
        entry["example"],
        "\(probe.literal): `example` must stay absent — populating it too would "
          + "blur the named-collection shorthand with the direct @coerce contract")
    }
  }

  func testMapFormScalarShorthandAppliesToOutputs() throws {
    let contents = "---\nname: t\noutputs:\n  answer: hello\n---\nsystem:\nvector\n"
    let agent = try Loader.load(
      contents: contents, basePath: FileManager.default.currentDirectoryPath)
    let entries = try (agent.outputs ?? []).map { try $0.save() }

    XCTAssertEqual(entries.count, 1)
    XCTAssertEqual(entries.first?["name"] as? String, "answer")
    XCTAssertEqual(entries.first?["kind"] as? String, "string")
    XCTAssertEqual(entries.first?["default"] as? String, "hello")
    XCTAssertNil(entries.first?["example"])
  }

  // MARK: - Rule 5: the list form keeps direct @coerce semantics

  func testListFormBareScalarStillUsesExample() throws {
    // The two shorthands are distinguished by position, not by value. A list
    // element is a Property in its own right, so it follows @coerce.
    let entries = try loadInputs("name: t\ninputs:\n  - Seattle")

    XCTAssertEqual(entries.count, 1)
    XCTAssertEqual(entries.first?["kind"] as? String, "string")
    XCTAssertEqual(
      entries.first?["example"] as? String, "Seattle",
      "a bare scalar in list position is direct @coerce input and keeps `example`")
    XCTAssertNil(
      entries.first?["default"],
      "the direct form must not also populate `default`, or the two contracts "
        + "become indistinguishable")
  }

  // MARK: - Rule 3: immediate arrays are rejected, with a path

  func testScalarArrayInNameKeyedInputsIsRejected() {
    expectRejection(
      "name: t\ninputs:\n  arrayDefault: [1, two, null]", path: "inputs.arrayDefault")
  }

  func testObjectArrayInNameKeyedInputsIsRejected() {
    expectRejection(
      "name: t\ninputs:\n  arrayEntry:\n    - kind: string", path: "inputs.arrayEntry")
  }

  func testArrayInNestedPropertiesIsRejectedWithFullPath() {
    // Recursion must thread the path, not restart it — a bare `arrayEntry`
    // would not tell a consumer where the defect is.
    let frontmatter = [
      "name: t",
      "inputs:",
      "  profile:",
      "    kind: object",
      "    properties:",
      "      arrayEntry:",
      "        - kind: string",
    ].joined(separator: "\n")
    expectRejection(frontmatter, path: "inputs.profile.properties.arrayEntry")
  }

  func testArrayInNameKeyedOutputsIsRejected() {
    expectRejection("name: t\noutputs:\n  bad: [1]", path: "outputs.bad")
  }

  // MARK: - Rule 4: arrays inside declared fields remain valid

  func testDeclaredArrayFieldsRemainValid() throws {
    let entries = try loadInputs(
      [
        "name: t",
        "inputs:",
        "  aliases:",
        "    kind: array",
        "    default: [Ada, Grace]",
        "    items:",
        "      kind: string",
      ].joined(separator: "\n"))

    XCTAssertEqual(entries.count, 1)
    let entry = entries[0]
    XCTAssertEqual(entry["name"] as? String, "aliases")
    XCTAssertEqual(entry["kind"] as? String, "array")
    XCTAssertEqual(
      try jsonText(entry["default"] as Any), try jsonText(["Ada", "Grace"]),
      "an array in a declared `default` is data, not a named entry")
    XCTAssertEqual((entry["items"] as? [String: Any])?["kind"] as? String, "string")
  }

  // MARK: - Rule 1: map-form object entries still gain their name

  func testMapFormObjectEntriesTakeNameFromKey() throws {
    let entries = try loadInputs(
      [
        "name: t",
        "inputs:",
        "  beta:",
        "    kind: boolean",
        "  alpha:",
        "    kind: string",
        "    description: first",
      ].joined(separator: "\n"))

    // Keys are sorted so the canonical list is stable across dictionary
    // iteration order.
    XCTAssertEqual(entries.map { $0["name"] as? String }, ["alpha", "beta"])
    XCTAssertEqual(entries[0]["description"] as? String, "first")
  }

  func testNestedMapFormPropertiesAreNormalized() throws {
    let entries = try loadInputs(
      [
        "name: t",
        "inputs:",
        "  profile:",
        "    kind: object",
        "    properties:",
        "      nested: kept",
      ].joined(separator: "\n"))

    XCTAssertEqual(entries.count, 1)
    let nested = entries[0]["properties"] as? [[String: Any]]
    XCTAssertEqual(nested?.count, 1)
    XCTAssertEqual(nested?.first?["name"] as? String, "nested")
    XCTAssertEqual(nested?.first?["kind"] as? String, "string")
    XCTAssertEqual(
      nested?.first?["default"] as? String, "kept",
      "the shorthand applies at every nesting depth, not just the top level")
    XCTAssertNil(nested?.first?["example"])
  }

  // MARK: - Helper

  private func jsonText(_ value: Any) throws -> String {
    let data = try JSONSerialization.data(withJSONObject: ["v": value], options: [.sortedKeys])
    return String(decoding: data, as: UTF8.self)
  }
}
